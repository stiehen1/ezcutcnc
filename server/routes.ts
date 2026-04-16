import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api, mentorSchemas } from "@shared/routes";
import { matchMaterialAlias, ISO_SUBCATEGORIES } from "@shared/materials";
import { z } from "zod";
import { exec, spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

function resolvePython(): string {
  const cwd = process.cwd();
  const replitPath = path.join(cwd, ".pythonlibs", "bin", "python3");
  if (fs.existsSync(replitPath)) return replitPath;
  if (process.platform === "win32") {
    // Check known local install paths before falling back to "python", which may
    // be the Windows Store stub (App Execution Alias) rather than a real install.
    const localApp = process.env.LOCALAPPDATA || "";
    const candidates = [
      path.join(localApp, "Python", "bin", "python.exe"),
      path.join(localApp, "Programs", "Python", "Python313", "python.exe"),
      path.join(localApp, "Programs", "Python", "Python312", "python.exe"),
      path.join(localApp, "Programs", "Python", "Python311", "python.exe"),
      "C:\\Python313\\python.exe",
      "C:\\Python312\\python.exe",
      "C:\\Python311\\python.exe",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return "python";
  }
  return "python3";
}

function runMentorBridge(payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    const pythonPath = resolvePython();

    const replitSitePackages = path.join(cwd, ".pythonlibs", "lib", "python3.11", "site-packages");
    const extraPythonPath = fs.existsSync(replitSitePackages) ? replitSitePackages : "";

    const py = spawn(pythonPath, ["mentor_bridge.py"], {
      cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        ...(extraPythonPath ? { PYTHONPATH: extraPythonPath } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));
    py.on("error", reject);

    py.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(stderr || stdout || `mentor_bridge.py exited with code ${code}`),
        );
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Bad JSON from mentor_bridge.py: ${stdout}`));
      }
    });

    py.stdin.write(JSON.stringify(payload ?? {}));
    py.stdin.end();
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // ── One-time column migrations ────────────────────────────────────────────
  try {
    const { pool } = await import("./db");
    await pool.query(`ALTER TABLE skus ADD COLUMN IF NOT EXISTS center_cutting BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE skus ADD COLUMN IF NOT EXISTS max_cutting_edge_length FLOAT`);
  } catch { /* table may not exist yet — uploads will create it */ }

  // ── ROI comparisons table ─────────────────────────────────────────────────
  try {
    const { pool } = await import("./db");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roi_comparisons (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        user_email TEXT,
        user_name TEXT,
        material TEXT,
        operation TEXT,
        tool_dia FLOAT,
        feed_ipm FLOAT,
        cc_edp TEXT,
        cc_tool_price FLOAT,
        cc_parts_per_tool FLOAT,
        cc_time_in_cut FLOAT,
        comp_edp TEXT,
        comp_price FLOAT,
        comp_parts_per_tool FLOAT,
        comp_time_in_cut FLOAT,
        shop_rate FLOAT,
        monthly_volume FLOAT,
        savings_per_part FLOAT,
        monthly_savings FLOAT,
        annual_savings FLOAT,
        savings_pct FLOAT,
        city TEXT,
        region TEXT,
        country TEXT,
        ip TEXT
      )
    `);
    console.log("[DB] roi_comparisons table ready");
  } catch (e: any) { console.warn("[DB] roi_comparisons migration failed:", e?.message); }

  // Migrate roi_comparisons to full sales-app-compatible schema
  try {
    const { pool } = await import("./db");
    const cols = [
      // existing stragglers
      "roi_name TEXT", "comp_brand TEXT",
      "roi_session_id TEXT UNIQUE",
      "user_type TEXT",
      "rep_id TEXT",
      "rep_name TEXT",
      "distributor_name TEXT",
      "distributor_code TEXT",
      "end_user_name TEXT",
      "end_user_email TEXT",
      "end_user_company TEXT",
      // new columns aligned to sales app schema
      "company TEXT",
      "postal TEXT",
      "phone TEXT",
      "hardness TEXT",
      "life_mode TEXT",
      "breakeven_n FLOAT",
      "mrr_time_savings_per_part FLOAT",
      "mat_vol_per_part FLOAT",
      "machine_name TEXT",
      "synced_to_sales_app BOOLEAN DEFAULT FALSE",
      "updated_at TIMESTAMPTZ",
      // CC tool geometry
      "cc_num_flutes INT",
      "cc_length_of_cut FLOAT",
      "cc_overall_length FLOAT",
      "cc_coating TEXT",
      "cc_corner_type TEXT",
      "cc_sfm FLOAT",
      "cc_rpms FLOAT",
      "cc_ipt FLOAT",
      "cc_radial_doc FLOAT",
      "cc_axial_doc FLOAT",
      "cc_cycle_time FLOAT",
      "cc_tool_life_minutes FLOAT",
      // Comp tool geometry
      "comp_num_flutes INT",
      "comp_length_of_cut FLOAT",
      "comp_overall_length FLOAT",
      "comp_coating TEXT",
      "comp_corner_type TEXT",
      "comp_sfm FLOAT",
      "comp_rpms FLOAT",
      "comp_ipt FLOAT",
      "comp_radial_doc FLOAT",
      "comp_axial_doc FLOAT",
      "comp_cycle_time FLOAT",
      "comp_tool_life_minutes FLOAT",
    ];
    for (const col of cols) {
      const colName = col.split(" ")[0];
      await pool.query(`ALTER TABLE roi_comparisons ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }
  } catch (e: any) { console.warn("[DB] roi_comparisons migration failed:", e?.message); }

  // ── Toolbox tables ────────────────────────────────────────────────────────
  try {
    const { pool } = await import("./db");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS toolbox_sessions (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        otp TEXT,
        otp_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE toolbox_sessions ADD CONSTRAINT toolbox_sessions_email_unique UNIQUE (email)
    `).catch(() => { /* constraint may already exist */ });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS toolbox_items (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'result',
        title TEXT NOT NULL,
        data JSONB,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE toolbox_items ADD COLUMN IF NOT EXISTS job_no TEXT DEFAULT ''`).catch(() => {});
    await pool.query(`ALTER TABLE toolbox_items ADD COLUMN IF NOT EXISTS part_name TEXT DEFAULT ''`).catch(() => {});
  } catch (err: any) {
    console.warn("[Toolbox migration]", err?.message ?? err);
  }

  // announcements table
  try {
    const { pool } = await import("./db");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        version TEXT NOT NULL UNIQUE,
        headline TEXT NOT NULL,
        subheadline TEXT NOT NULL DEFAULT '',
        bullets JSONB NOT NULL DEFAULT '[]',
        active BOOLEAN NOT NULL DEFAULT FALSE,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err: any) {
    console.warn("[Announcements migration]", err?.message ?? err);
  }

  try {
    const { pool } = await import("./db");
    // user_specials: repository of special/custom CC tools per user
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_specials (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        cc_number TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS user_specials_email_idx ON user_specials (email)`);
  } catch (err: any) {
    console.warn("[Toolbox migration]", err?.message ?? err);
  }

  // ── user_machines: add job/status columns if not present ─────────────────
  try {
    const { pool } = await import("./db");
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS job_tags JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS machine_status TEXT DEFAULT 'operational'`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS status_note TEXT`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS maintenance_date DATE`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS sub_spindle_rpm INTEGER`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS live_tool_max_rpm INTEGER`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS live_tool_hp NUMERIC(6,2)`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS live_tool_connection TEXT`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS live_tool_drive_type TEXT`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS mill_spindle_max_rpm INTEGER`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS mill_spindle_hp NUMERIC(6,2)`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS mill_spindle_taper TEXT`);
  } catch (err: any) {
    console.warn("[user_machines migration]", err?.message ?? err);
  }

  // ── machines: add live-tool columns if not present ────────────────────────
  try {
    const { pool } = await import("./db");
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS live_tool_max_rpm INTEGER`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS live_tool_hp NUMERIC(6,2)`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS live_tool_coolant TEXT`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS live_tool_connection TEXT`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS live_tool_drive_type TEXT`);

    // Insert live-tool lathe catalog entries (INSERT … WHERE NOT EXISTS to stay idempotent)
    const liveToolMachines = [
      // [brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, machine_type, control, lt_rpm, lt_hp, lt_coolant, lt_conn, lt_drive]
      ["Haas",          "ST-10Y",        6000,  20,  "VDI/BMT", "belt",  false, "flood",  null, "lathe", "Haas",         4000, 5,   "External (no thru-tool)", "VDI/BMT", "Belt"],
      ["Haas",          "ST-15Y",        6000,  20,  "VDI/BMT", "belt",  false, "flood",  null, "lathe", "Haas",         4000, 5,   "External (no thru-tool)", "VDI/BMT", "Belt"],
      ["Haas",          "ST-20Y",        6000,  20,  "VDI/BMT", "belt",  false, "flood",  null, "lathe", "Haas",         4000, 5,   "External (no thru-tool)", "VDI/BMT", "Belt"],
      ["Haas",          "ST-30Y",        4000,  30,  "VDI/BMT", "belt",  false, "flood",  null, "lathe", "Haas",         4000, 5,   "External (no thru-tool)", "VDI/BMT", "Belt"],
      ["Mazak",         "QT-200MY",      5000,  15,  "VDI/BMT/Capto", "direct", false, "flood", null, "lathe", "MAZATROL", 5000, 7.5, "Optional thru-tool",   "VDI/BMT/Capto", "Direct"],
      ["Mazak",         "QT-250MY",      5000,  15,  "VDI/BMT/Capto", "direct", false, "flood", null, "lathe", "MAZATROL", 5000, 7.5, "Optional thru-tool",   "VDI/BMT/Capto", "Direct"],
      ["Mazak",         "QT-300MY",      4000,  20,  "VDI/BMT/Capto", "direct", false, "flood", null, "lathe", "MAZATROL", 5000, 7.5, "Optional thru-tool",   "VDI/BMT/Capto", "Direct"],
      ["DMG MORI",      "NLX 2000 SY",   4000,  22,  "Capto",   "direct", false, "flood,tsc", null, "lathe", "CELOS",   12000, 10,  "High-pressure thru-tool", "Capto",  "Motorized"],
      ["DMG MORI",      "NLX 2500 SY",   3500,  30,  "Capto",   "direct", false, "flood,tsc", null, "lathe", "CELOS",   12000, 10,  "High-pressure thru-tool", "Capto",  "Motorized"],
      ["Nakamura-Tome", "WT-150II",      5000,  15,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Nakamura-Tome", "SC-200",        5000,  15,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Nakamura-Tome", "AS-200",        5000,  15,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Okuma",         "LB3000 EX II MY", 5000, 22, "VDI/BMT", "direct", false, "flood", null, "lathe", "OSP-P300L",    6000, 7.5, "Thru-tool available",    "VDI/BMT", "Direct"],
      ["Okuma",         "GENOS L3000-e MY", 4000,22, "VDI/BMT", "direct", false, "flood", null, "lathe", "OSP-P300L",    6000, 7.5, "Thru-tool available",    "VDI/BMT", "Direct"],
      ["Tsugami",       "BO326-III",     5000,  10,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Tsugami",       "S206-II",       7000,  7.5, "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Citizen",       "L20",           10000, 7.5, "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Citizen",       "A20",           10000, 7.5, "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Miyano",        "BNA-42MSY",     6000,  10,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Miyano",        "ABX-51THY",     5000,  15,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Hyundai-Wia",   "LYNX 2100LY",   5000,  15,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Hyundai-Wia",   "LYNX 2600Y",    4000,  22,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Johnford",      "ST-40Y",        4000,  20,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Johnford",      "ST-60Y",        3500,  25,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Daewoo",        "PUMA 240MS",    5000,  15,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Daewoo",        "PUMA 250MS",    5000,  15,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Doosan/DN Solutions", "PUMA 2100SY II", 5000, 30, "A2-6/A2-8", "direct", false, "tsc", null, "mill_turn", "FANUC", 5000, 30, "Turret Coolant", "VDI/BMT", "Direct"],
      ["Kia / Hyundai-Kia", "SKT21LMS", 5000,  15,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Kia / Hyundai-Kia", "SKT2000Y", 4000,  22,  "VDI/BMT", "direct", false, "flood", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
    ];
    for (const m of liveToolMachines) {
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, machine_type, control, live_tool_max_rpm, live_tool_hp, live_tool_coolant, live_tool_connection, live_tool_drive_type)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE $1 AND model ILIKE $2)
      `, m);
    }
    // Fix any rows inserted under old brand names so search aliases work
    await pool.query(`UPDATE machines SET brand = 'Doosan/DN Solutions' WHERE model ILIKE 'PUMA 2100SY II' AND brand ILIKE 'DN Solutions'`);
  } catch (err: any) {
    console.warn("[live_tool migration]", err?.message ?? err);
  }

  // ── Leads table ───────────────────────────────────────────────────────────
  try {
    const { pool } = await import("./db");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        operation TEXT,
        material TEXT,
        machine_name TEXT,
        results_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS name TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS city TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS region TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS country TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ip TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS postal TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS company TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS zip TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_name TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_name TEXT`);
  } catch (err: any) {
    console.warn("[Leads migration]", err?.message ?? err);
  }

  // ── IP Geolocation helper ─────────────────────────────────────────────────
  async function geoFromIp(ip: string): Promise<{ city: string|null; region: string|null; country: string|null; postal: string|null }> {
    const blank = { city: null, region: null, country: null, postal: null };
    try {
      if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
        return blank;
      }
      // Primary: ipinfo.io (50k/month free, HTTPS, token via IPINFO_TOKEN env var)
      const token = process.env.IPINFO_TOKEN;
      const url = token ? `https://ipinfo.io/${ip}?token=${token}` : `https://ipinfo.io/${ip}/json`;
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const d = await r.json() as any;
        if (!d.bogon && d.city) {
          const countryNames: Record<string,string> = { US:"United States", CA:"Canada", MX:"Mexico", GB:"United Kingdom", DE:"Germany", FR:"France", AU:"Australia", JP:"Japan", CN:"China", IN:"India", BR:"Brazil", KR:"South Korea", IT:"Italy", ES:"Spain", NL:"Netherlands", SE:"Sweden", NO:"Norway", DK:"Denmark", FI:"Finland", CH:"Switzerland", AT:"Austria", BE:"Belgium", PL:"Poland", CZ:"Czech Republic", SG:"Singapore", NZ:"New Zealand", IE:"Ireland", IL:"Israel", ZA:"South Africa", AE:"United Arab Emirates" };
          const country = d.country ? (countryNames[d.country] ?? d.country) : null;
          return { city: d.city || null, region: d.region || null, country, postal: d.postal || null };
        }
      }
      // Fallback: ipwho.is (HTTPS, 10k/month)
      const r2 = await fetch(`https://ipwho.is/${ip}`, { signal: AbortSignal.timeout(3000) });
      if (!r2.ok) return blank;
      const d2 = await r2.json() as any;
      if (!d2.success) return blank;
      return { city: d2.city || null, region: d2.region || null, country: d2.country || null, postal: d2.postal || null };
    } catch {
      return blank;
    }
  }

  // ── Access control tables ──────────────────────────────────────────────────
  try {
    const { pool } = await import("./db");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS allowed_emails (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        notes TEXT DEFAULT '',
        added_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_domains (
        id SERIAL PRIMARY KEY,
        domain TEXT NOT NULL UNIQUE,
        reason TEXT DEFAULT '',
        added_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE toolbox_sessions ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE
    `).catch(() => { /* column may already exist */ });
  } catch (err: any) {
    console.warn("[Access control migration]", err?.message ?? err);
  }

  app.get(api.snippets.list.path, async (req, res) => {
    const snippets = await storage.getSnippets();
    res.json(snippets);
  });

  app.get(api.snippets.get.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const snippet = await storage.getSnippet(id);
    if (!snippet) {
      return res.status(404).json({ message: "Snippet not found" });
    }
    res.json(snippet);
  });

  app.post(api.snippets.create.path, async (req, res) => {
    try {
      const input = api.snippets.create.input.parse(req.body);
      const snippet = await storage.createSnippet(input);
      res.status(201).json(snippet);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.snippets.delete.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    // Check if exists first
    const existing = await storage.getSnippet(id);
    if (!existing) {
      return res.status(404).json({ message: "Snippet not found" });
    }

    await storage.deleteSnippet(id);
    res.status(204).send();
  });

  // ── SKU / EDP# catalog search (searches current upload only) ────────────────
  app.get("/api/skus", async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim().toLowerCase();
      if (!q) return res.json([]);
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT s.*, s.default_stickout_in::float AS default_stickout_in
         FROM skus s
         JOIN sku_uploads u ON s.upload_id = u.id
         WHERE u.is_current = TRUE AND LOWER(s.edp) LIKE $1
         ORDER BY s.edp LIMIT 10`,
        [`${q}%`]
      );
      return res.json(result.rows);
    } catch {
      return res.json([]);
    }
  });

  // ── Stickout lookup: closest standard SKU by series + dia + loc ─────────────
  app.get("/api/skus/stickout-lookup", async (req, res) => {
    try {
      const series = String(req.query.series ?? "").trim().toUpperCase();
      const dia    = parseFloat(String(req.query.dia ?? "0"));
      const loc    = parseFloat(String(req.query.loc ?? "0"));
      if (!series || !dia) return res.json({ stickout: null });
      const { pool } = await import("./db");
      // Find closest match: same series, closest cutting dia, then closest LOC
      const result = await pool.query(
        `SELECT default_stickout_in::float AS stickout
         FROM skus s
         JOIN sku_uploads u ON s.upload_id = u.id
         WHERE u.is_current = TRUE
           AND UPPER(s.series) = $1
           AND s.default_stickout_in IS NOT NULL
         ORDER BY ABS(s.cutting_diameter_in::float - $2),
                  ABS(COALESCE(s.loc_in::float, 0) - $3)
         LIMIT 1`,
        [series, dia, loc]
      );
      const stickout = result.rows[0]?.stickout ?? null;
      return res.json({ stickout });
    } catch {
      return res.json({ stickout: null });
    }
  });

  // ── SKU upload history ────────────────────────────────────────────────────
  app.get("/api/skus/uploads", async (req, res) => {
    try {
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT id, filename, row_count, is_current, notes, uploaded_at
         FROM sku_uploads ORDER BY uploaded_at DESC`
      );
      return res.json(result.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? "Failed to load upload history" });
    }
  });

  // ── Set an upload as current ──────────────────────────────────────────────
  app.post("/api/skus/uploads/:id/set-current", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid upload ID" });
      const { pool } = await import("./db");
      // Clear current flag on all, then set on target
      await pool.query(`UPDATE sku_uploads SET is_current = FALSE`);
      await pool.query(`UPDATE sku_uploads SET is_current = TRUE WHERE id = $1`, [id]);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? "Failed to set current" });
    }
  });

  // ── Delete an upload and its SKU rows ────────────────────────────────────
  app.delete("/api/skus/uploads/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid upload ID" });
      const { pool } = await import("./db");
      const check = await pool.query(`SELECT is_current FROM sku_uploads WHERE id = $1`, [id]);
      if (!check.rows.length) return res.status(404).json({ message: "Upload not found" });
      if (check.rows[0].is_current) return res.status(400).json({ message: "Cannot delete the current upload" });
      await pool.query(`DELETE FROM skus WHERE upload_id = $1`, [id]);
      await pool.query(`DELETE FROM sku_uploads WHERE id = $1`, [id]);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? "Delete failed" });
    }
  });

  // ── SKU catalog CSV upload (creates a new versioned batch) ────────────────
  app.post("/api/skus/upload", async (req, res) => {
    try {
      const { rows, filename = "upload.csv", notes = "" } = req.body as {
        rows: any[];
        filename?: string;
        notes?: string;
      };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "Expected a non-empty rows array" });
      }
      const { pool } = await import("./db");

      // Create upload record and immediately mark as current
      await pool.query(`UPDATE sku_uploads SET is_current = FALSE`);
      const uploadRes = await pool.query(
        `INSERT INTO sku_uploads (filename, row_count, is_current, notes)
         VALUES ($1, $2, TRUE, $3) RETURNING id`,
        [filename, rows.length, notes || null]
      );
      const uploadId: number = uploadRes.rows[0].id;

      // Build valid rows first
      const validRows: any[][] = [];
      let skipped = 0;
      for (const r of rows) {
        const edp = String(r.EDP ?? r.edp ?? "").trim();
        if (!edp) { skipped++; continue; }
        // Auto-derive tool_type: chamfer mills have chamfer_angle set, everything else is endmill
        const rawType = String(r.tool_type ?? "").trim().toLowerCase();
        const toolType = rawType ? rawType
          : (r.chamfer_angle && Number(r.chamfer_angle) > 0) ? "chamfer_mill"
          : "endmill";

        validRows.push([
          edp,
          r.series ?? null, r.description1 ?? null, r.description2 ?? null,
          toolType,
          r.cutting_diameter_in ?? null, r.flutes ?? null,
          r.loc_in ?? null, r.lbs_in ?? null, r.neck_dia_in ?? null,
          r.shank_dia_in ?? null, r.oal_in ?? null,
          r.corner_condition ?? null, r.flute_wash ?? null, r.coating ?? null,
          r.geometry ?? null,
          r.variable_pitch ?? false, r.variable_helix ?? false, r.helix ?? null,
          r.chamfer_angle ?? null, r.tip_diameter ?? null,
          r.iso_n ?? false, r.iso_p ?? false, r.iso_m ?? false,
          r.iso_k ?? false, r.iso_s ?? false, r.iso_h ?? false,
          r.op_hem ?? false, r.op_traditional ?? false, r.op_finishing ?? false,
          r.max_woc_traditional_pct ?? null,
          r.center_cutting ?? false,
          r.max_cutting_edge_length ?? null,
          uploadId,
        ]);
      }

      // Batch insert 200 rows at a time
      const COLS = 34;
      const BATCH = 200;
      for (let i = 0; i < validRows.length; i += BATCH) {
        const batch = validRows.slice(i, i + BATCH);
        const params: any[] = [];
        const valueClauses = batch.map((row, ri) => {
          const base = ri * COLS;
          row.forEach(v => params.push(v));
          return `(${Array.from({ length: COLS }, (_, ci) => `$${base + ci + 1}`).join(",")})`;
        });
        await pool.query(
          `INSERT INTO skus (
            edp, series, description1, description2, tool_type,
            cutting_diameter_in, flutes, loc_in, lbs_in, neck_dia_in,
            shank_dia_in, oal_in, corner_condition, flute_wash, coating,
            geometry, variable_pitch, variable_helix, helix,
            chamfer_angle, tip_diameter,
            iso_n, iso_p, iso_m, iso_k, iso_s, iso_h,
            op_hem, op_traditional, op_finishing, max_woc_traditional_pct,
            center_cutting, max_cutting_edge_length, upload_id
          ) VALUES ${valueClauses.join(",")}
          ON CONFLICT (edp) DO UPDATE SET
            series=EXCLUDED.series, description1=EXCLUDED.description1,
            description2=EXCLUDED.description2, tool_type=EXCLUDED.tool_type,
            cutting_diameter_in=EXCLUDED.cutting_diameter_in, flutes=EXCLUDED.flutes,
            loc_in=EXCLUDED.loc_in, lbs_in=EXCLUDED.lbs_in, neck_dia_in=EXCLUDED.neck_dia_in,
            shank_dia_in=EXCLUDED.shank_dia_in, oal_in=EXCLUDED.oal_in,
            corner_condition=EXCLUDED.corner_condition, flute_wash=EXCLUDED.flute_wash,
            coating=EXCLUDED.coating, geometry=EXCLUDED.geometry,
            variable_pitch=EXCLUDED.variable_pitch, variable_helix=EXCLUDED.variable_helix,
            helix=EXCLUDED.helix, chamfer_angle=EXCLUDED.chamfer_angle,
            tip_diameter=EXCLUDED.tip_diameter,
            iso_n=EXCLUDED.iso_n, iso_p=EXCLUDED.iso_p, iso_m=EXCLUDED.iso_m,
            iso_k=EXCLUDED.iso_k, iso_s=EXCLUDED.iso_s, iso_h=EXCLUDED.iso_h,
            op_hem=EXCLUDED.op_hem, op_traditional=EXCLUDED.op_traditional,
            op_finishing=EXCLUDED.op_finishing,
            max_woc_traditional_pct=EXCLUDED.max_woc_traditional_pct,
            center_cutting=EXCLUDED.center_cutting,
            max_cutting_edge_length=EXCLUDED.max_cutting_edge_length,
            upload_id=EXCLUDED.upload_id`,
          params
        );
      }

      const inserted = validRows.length;
      return res.json({ uploadId, inserted, skipped, total: rows.length });
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? "Upload failed" });
    }
  });

  // ── Tool Finder — distinct dropdown options ───────────────────────────────
  app.get("/api/tools/options", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const { pool } = await import("./db");
      const tt = req.query.tool_type ? String(req.query.tool_type) : null;
      const diaRaw = req.query.diameter ? String(req.query.diameter) : null;
      const dias = diaRaw ? diaRaw.split(",").map(Number).filter(n => !isNaN(n) && n > 0) : [];
      const mat = req.query.material ? String(req.query.material) : null;
      const lbsRaw = req.query.lbs ? parseFloat(String(req.query.lbs)) : null;
      const TYPE_FILTER = tt ? ` AND s.tool_type = '${tt.replace(/'/g, "''")}'` : "";
      const DIA_FILTER = dias.length === 1
        ? ` AND s.cutting_diameter_in = ${dias[0]}`
        : dias.length > 1
          ? ` AND s.cutting_diameter_in = ANY(ARRAY[${dias.join(",")}]::float[])`
          : "";
      const MAT_COL = mat && mat !== "all" ? `iso_${mat.toLowerCase()}` : null;
      const VALID_ISO = ["iso_p","iso_m","iso_k","iso_n","iso_s","iso_h"];
      const MAT_FILTER = (MAT_COL && VALID_ISO.includes(MAT_COL)) ? ` AND s.${MAT_COL} = TRUE` : "";
      const LBS_FILTER = (lbsRaw && !isNaN(lbsRaw)) ? ` AND s.lbs_in = ${lbsRaw}` : "";
      const crRaw = req.query.part_corner_radius ? parseFloat(String(req.query.part_corner_radius)) : null;
      const CR_FILTER = (crRaw && !isNaN(crRaw) && crRaw > 0) ? ` AND s.cutting_diameter_in < ${crRaw * 2}` : "";
      const frRaw = req.query.max_floor_radius ? parseFloat(String(req.query.max_floor_radius)) : null;
      const FR_FILTER = (frRaw && !isNaN(frRaw) && frRaw > 0) ? ` AND (s.corner_condition = 'square' OR (s.corner_condition NOT IN ('square','ball') AND s.corner_condition::float <= ${frRaw}))` : "";
      const axialRaw = req.query.axial_depth ? parseFloat(String(req.query.axial_depth)) : null;
      const AXIAL_FILTER     = (axialRaw && !isNaN(axialRaw) && axialRaw > 0) ? ` AND s.loc_in >= ${axialRaw}` : "";
      const LBS_AXIAL_FILTER = (axialRaw && !isNaN(axialRaw) && axialRaw > 0) ? ` AND s.lbs_in >= ${axialRaw}` : "";
      const REACH_FILTER     = (axialRaw && !isNaN(axialRaw) && axialRaw > 0) ? ` AND (s.loc_in >= ${axialRaw} OR (s.lbs_in IS NOT NULL AND s.lbs_in > 0 AND s.lbs_in >= ${axialRaw}))` : "";
      const maxFlutesRaw = req.query.max_flutes ? parseInt(String(req.query.max_flutes)) : null;
      const MAX_FLUTES_FILTER = (maxFlutesRaw && !isNaN(maxFlutesRaw)) ? ` AND s.flutes <= ${maxFlutesRaw}` : "";
      const minFlutesRaw = req.query.min_flutes ? parseInt(String(req.query.min_flutes)) : null;
      const MIN_FLUTES_FILTER = (minFlutesRaw && !isNaN(minFlutesRaw)) ? ` AND s.flutes >= ${minFlutesRaw}` : "";
      const BASE = `FROM skus s JOIN sku_uploads u ON s.upload_id = u.id WHERE u.is_current = TRUE`;
      const [diameters, locs, lbsLengths, coatings, flutes, corners, geometries, chamferLengths, chamferAngles, tipDiameters, series, centerCuttingVals] = await Promise.all([
        pool.query(`SELECT DISTINCT cutting_diameter_in AS v ${BASE}${TYPE_FILTER}${MAT_FILTER}${CR_FILTER}${FR_FILTER}${REACH_FILTER} AND cutting_diameter_in IS NOT NULL ORDER BY cutting_diameter_in`),
        pool.query(`SELECT DISTINCT loc_in AS v ${BASE}${TYPE_FILTER}${DIA_FILTER}${MAT_FILTER}${LBS_FILTER}${AXIAL_FILTER} AND loc_in IS NOT NULL ORDER BY loc_in`),
        pool.query(`SELECT DISTINCT lbs_in AS v ${BASE}${TYPE_FILTER}${DIA_FILTER}${MAT_FILTER}${LBS_AXIAL_FILTER} AND lbs_in IS NOT NULL AND lbs_in > 0 ORDER BY lbs_in`),
        pool.query(`SELECT DISTINCT coating AS v ${BASE}${TYPE_FILTER}${MAT_FILTER} AND coating IS NOT NULL ORDER BY coating`),
        pool.query(`SELECT DISTINCT flutes AS v ${BASE}${TYPE_FILTER}${DIA_FILTER}${MAT_FILTER}${MAX_FLUTES_FILTER}${MIN_FLUTES_FILTER} AND flutes IS NOT NULL ORDER BY flutes`),
        pool.query(`SELECT DISTINCT corner_condition AS v ${BASE}${TYPE_FILTER}${DIA_FILTER}${MAT_FILTER}${FR_FILTER} AND corner_condition IS NOT NULL ORDER BY corner_condition`),
        pool.query(`SELECT DISTINCT geometry AS v ${BASE}${TYPE_FILTER}${DIA_FILTER}${MAT_FILTER} AND geometry IS NOT NULL ORDER BY geometry`),
        pool.query(`SELECT DISTINCT max_cutting_edge_length AS v ${BASE}${TYPE_FILTER}${DIA_FILTER}${MAT_FILTER} AND max_cutting_edge_length IS NOT NULL ORDER BY max_cutting_edge_length`),
        pool.query(`SELECT DISTINCT chamfer_angle AS v ${BASE}${TYPE_FILTER}${MAT_FILTER} AND chamfer_angle IS NOT NULL ORDER BY chamfer_angle`),
        pool.query(`SELECT DISTINCT tip_diameter AS v ${BASE}${TYPE_FILTER}${MAT_FILTER} AND tip_diameter IS NOT NULL ORDER BY tip_diameter`),
        pool.query(`SELECT DISTINCT series AS v ${BASE}${TYPE_FILTER}${DIA_FILTER}${MAT_FILTER}${CR_FILTER}${FR_FILTER}${REACH_FILTER}${MAX_FLUTES_FILTER}${MIN_FLUTES_FILTER} AND series IS NOT NULL ORDER BY series`),
        pool.query(`SELECT DISTINCT center_cutting AS v ${BASE}${TYPE_FILTER}${DIA_FILTER}${MAT_FILTER} AND center_cutting IS NOT NULL ORDER BY center_cutting`),
      ]);
      return res.json({
        diameters: diameters.rows.map((r: any) => r.v),
        locs: locs.rows.map((r: any) => r.v),
        lbsLengths: lbsLengths.rows.map((r: any) => r.v),
        coatings: coatings.rows.map((r: any) => r.v),
        flutes: flutes.rows.map((r: any) => r.v),
        toolTypes: ["endmill", "chamfer_mill"],
        corners: corners.rows.map((r: any) => r.v),
        geometries: geometries.rows.map((r: any) => r.v),
        chamferLengths: chamferLengths.rows.map((r: any) => r.v),
        chamferAngles: chamferAngles.rows.map((r: any) => r.v),
        tipDiameters: tipDiameters.rows.map((r: any) => r.v),
        series: series.rows.map((r: any) => r.v),
        centerCuttingVals: centerCuttingVals.rows.map((r: any) => r.v),
      });
    } catch {
      return res.json({ diameters: [], locs: [], lbsLengths: [], coatings: [], flutes: [], toolTypes: [], corners: [], geometries: [], chamferLengths: [], chamferAngles: [], tipDiameters: [], series: [], centerCuttingVals: [] });
    }
  });

  // ── Tool Finder — filtered search ─────────────────────────────────────────
  app.get("/api/tools/search", async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { tool_type, material, flutes, diameter, dia_min, dia_max, min_loc, loc, lbs_exclude, corner, coating, center_cutting, geometry, required_chamfer_length, chamfer_lengths, chamfer_angle, tip_diameter, axial_depth, part_corner_radius, max_floor_radius, max_flutes, min_flutes, series, flute5_max_loc } = req.query;

      const conditions: string[] = ["u.is_current = TRUE"];
      const params: any[] = [];
      let p = 1;

      if (tool_type) {
        const list = String(tool_type).split(",").map(s => s.trim()).filter(Boolean);
        if (list.length === 1) { conditions.push(`s.tool_type = $${p++}`); params.push(list[0]); }
        else if (list.length > 1) { conditions.push(`s.tool_type = ANY($${p++}::text[])`); params.push(list); }
      }
      if (material && material !== "all") {
        const col = `iso_${String(material).toLowerCase()}`;
        const valid = ["iso_p","iso_m","iso_k","iso_n","iso_s","iso_h"];
        if (valid.includes(col)) conditions.push(`s.${col} = TRUE`);
      }
      if (series) {
        const list = String(series).split(",").map(s => s.trim()).filter(Boolean);
        if (list.length) { conditions.push(`s.series = ANY($${p++}::text[])`); params.push(list); }
      }
      if (flutes) {
        const list = String(flutes).split(",").map(Number).filter(n => !isNaN(n));
        if (list.length) { conditions.push(`s.flutes = ANY($${p++}::int[])`); params.push(list); }
      }
      if (diameter) {
        const list = String(diameter).split(",").map(Number).filter(n => !isNaN(n));
        if (list.length) { conditions.push(`s.cutting_diameter_in = ANY($${p++}::float[])`); params.push(list); }
      } else if (dia_min || dia_max) {
        const mn = dia_min ? parseFloat(String(dia_min)) : 0;
        const mx = dia_max ? parseFloat(String(dia_max)) : 999;
        if (!isNaN(mn)) { conditions.push(`s.cutting_diameter_in >= $${p++}`); params.push(mn); }
        if (!isNaN(mx) && mx < 999) { conditions.push(`s.cutting_diameter_in < $${p++}`); params.push(mx); }
      }
      if (loc) {
        const list = String(loc).split(",").map(Number).filter(n => !isNaN(n));
        if (list.length) { conditions.push(`s.loc_in = ANY($${p++}::float[])`); params.push(list); }
      }
      if (min_loc) {
        const v = parseFloat(String(min_loc));
        if (!isNaN(v) && v > 0) { conditions.push(`s.loc_in >= $${p++}`); params.push(v); }
      }
      if (lbs_exclude === "true") conditions.push(`(s.lbs_in IS NULL OR s.lbs_in = 0)`);
      if (lbs_exclude !== "true" && req.query.lbs) {
        const v = parseFloat(String(req.query.lbs));
        if (!isNaN(v) && v > 0) { conditions.push(`s.lbs_in = $${p++}`); params.push(v); }
      }
      if (corner) {
        const list = String(corner).split(",");
        if (list.length) { conditions.push(`s.corner_condition = ANY($${p++}::text[])`); params.push(list); }
      }
      if (coating) {
        const list = String(coating).split(",");
        if (list.length) { conditions.push(`s.coating = ANY($${p++}::text[])`); params.push(list); }
      }
      if (center_cutting === "yes") conditions.push(`s.center_cutting = TRUE`);
      if (center_cutting === "no")  conditions.push(`s.center_cutting = FALSE`);
      if (geometry) {
        const list = String(geometry).split(",");
        if (list.length) { conditions.push(`s.geometry = ANY($${p++}::text[])`); params.push(list); }
      }
      if (chamfer_lengths) {
        const list = String(chamfer_lengths).split(",").map(Number).filter(n => !isNaN(n));
        if (list.length) { conditions.push(`s.max_cutting_edge_length = ANY($${p++}::float[])`); params.push(list); }
      } else if (required_chamfer_length) {
        const v = parseFloat(String(required_chamfer_length));
        if (!isNaN(v) && v > 0) { conditions.push(`s.max_cutting_edge_length >= $${p++}`); params.push(v); }
      }
      if (chamfer_angle) {
        const list = String(chamfer_angle).split(",").map(Number).filter(n => !isNaN(n));
        if (list.length) { conditions.push(`s.chamfer_angle = ANY($${p++}::float[])`); params.push(list); }
      }
      if (tip_diameter) {
        const list = String(tip_diameter).split(",").map(Number).filter(n => !isNaN(n));
        if (list.length) { conditions.push(`s.tip_diameter = ANY($${p++}::float[])`); params.push(list); }
      }
      if (axial_depth) {
        const v = parseFloat(String(axial_depth));
        if (!isNaN(v) && v > 0) {
          // Must reach the depth
          conditions.push(`(s.loc_in >= $${p} OR (s.lbs_in IS NOT NULL AND s.lbs_in >= $${p}))`);
          params.push(v); p++;
          // Cap at depth + 0.5" — e.g. 2.5" depth allows up to 3.0", not 3.5" or 4.0"
          conditions.push(`(s.loc_in <= $${p} OR (s.lbs_in IS NOT NULL AND s.lbs_in <= $${p}))`);
          params.push(v + 0.5); p++;
        }
      }
      if (part_corner_radius) {
        const cr = parseFloat(String(part_corner_radius));
        if (!isNaN(cr) && cr > 0) {
          conditions.push(`s.cutting_diameter_in < $${p++}`);
          params.push(cr * 2);
        }
      }
      if (max_floor_radius) {
        const fr = parseFloat(String(max_floor_radius));
        if (!isNaN(fr) && fr > 0) {
          conditions.push(`(s.corner_condition = 'square' OR (s.corner_condition NOT IN ('square','ball') AND s.corner_condition::float <= $${p++}))`);
          params.push(fr);
        }
      }
      if (max_flutes) {
        const mf = parseInt(String(max_flutes));
        if (!isNaN(mf)) { conditions.push(`s.flutes <= $${p++}`); params.push(mf); }
      }
      if (min_flutes) {
        const mf = parseInt(String(min_flutes));
        if (!isNaN(mf)) { conditions.push(`s.flutes >= $${p++}`); params.push(mf); }
      }
      if (flute5_max_loc === "shortest") {
        // 5-flute slotting: only show shortest LOC per diameter (max slot depth = 0.5×D)
        conditions.push(`(s.flutes <> 5 OR s.loc_in = (SELECT MIN(s2.loc_in) FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id WHERE u2.is_current = TRUE AND s2.flutes = 5 AND s2.cutting_diameter_in = s.cutting_diameter_in AND s2.series = s.series))`);
      } else if (flute5_max_loc) {
        const maxLoc = parseFloat(String(flute5_max_loc));
        if (!isNaN(maxLoc)) { conditions.push(`(s.flutes <> 5 OR s.loc_in <= $${p++})`); params.push(maxLoc); }
      }

      const sql = `
        SELECT s.edp, s.tool_type, s.series, s.description1, s.description2,
               s.cutting_diameter_in, s.flutes, s.loc_in, s.lbs_in, s.oal_in,
               s.corner_condition, s.coating, s.geometry,
               s.variable_pitch, s.variable_helix, s.helix,
               s.shank_dia_in, s.flute_wash, s.center_cutting,
               s.chamfer_angle, s.tip_diameter, s.max_cutting_edge_length,
               s.default_stickout_in::float AS default_stickout_in
        FROM skus s JOIN sku_uploads u ON s.upload_id = u.id
        WHERE ${conditions.join(" AND ")}
        ORDER BY s.cutting_diameter_in, s.flutes, s.loc_in, s.edp
        LIMIT 200`;

      const result = await pool.query(sql, params);
      return res.json(result.rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? "Search failed" });
    }
  });

  app.post(api.mentor.run.path, async (req, res) => {
    const parsed = mentorSchemas.input.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.errors[0]?.message ?? "Invalid input",
        field: parsed.error.errors[0]?.path?.join("."),
      });
    }

    try {
      // Apply speeder transform before engine sees the payload
      const enginePayload: any = { ...parsed.data };
      if (enginePayload.speeder_enabled) {
        const ratio       = Math.max(1, Number(enginePayload.speeder_ratio) || 1);
        const speederMax  = Math.max(0, Number(enginePayload.speeder_max_rpm) || 0);
        const torqueNm    = Math.max(0, Number(enginePayload.speeder_max_torque_nm) || 0);

        // Effective RPM: machine × ratio, capped at speeder output limit
        const effectiveRpm = speederMax > 0
          ? Math.min(Math.round(enginePayload.max_rpm * ratio), speederMax)
          : Math.round(enginePayload.max_rpm * ratio);
        enginePayload.max_rpm = effectiveRpm;

        // Effective HP: lower of (machine HP / ratio) or torque-limited HP at effective RPM
        // P(HP) = T(N·m) × RPM / 9549 × 1.341 (converts kW → HP)
        const hpFromRatio  = enginePayload.machine_hp / ratio;
        const hpFromTorque = torqueNm > 0 ? (torqueNm * effectiveRpm / 9549) * 1.341 : Infinity;
        enginePayload.machine_hp = Math.min(hpFromRatio, hpFromTorque);
      }

      const raw = await runMentorBridge(enginePayload);
      // Attach HP-vs-machine metrics (customer-facing)
      const customer = ((raw as any).customer ??= {});
      const hpReq = Number(customer.hp_required ?? 0);
      const machineHp = Number((parsed.data as any).machine_hp ?? 0);
      const SPINDLE_DRIVE_EFF: Record<string, number> = { direct: 0.96, belt: 0.92, gear: 0.88 };
      const driveEff = SPINDLE_DRIVE_EFF[String((parsed.data as any).spindle_drive ?? "belt")] ?? 0.92;
      const availableHp = machineHp * driveEff;

      customer.machine_hp = availableHp > 0 ? availableHp : null;
      customer.hp_util_pct =
        availableHp > 0 && hpReq > 0 ? (hpReq / availableHp) * 100 : null;
      customer.hp_margin_hp = availableHp > 0 ? availableHp - hpReq : null;

      // ── Torque zone calculation ──────────────────────────────────────────────
      const { pool } = await import("./db");
      const machineId = (parsed.data as any).machine_id;
      if (machineId) {
        const mrow = await pool.query(
          `SELECT base_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence, max_rpm
           FROM machines WHERE id = $1`,
          [machineId]
        );
        if (mrow.rows.length && mrow.rows[0].base_torque_ftlb) {
          const { base_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence, max_rpm } = mrow.rows[0];
          const recRpm = Number(customer.rpm ?? 0);
          // Two-segment torque model: flat below peak_torque_rpm, hyperbolic (HP×5252/RPM) above
          let torqueAvail: number;
          if (recRpm <= 0) {
            torqueAvail = Number(base_torque_ftlb);
          } else if (recRpm <= Number(peak_torque_rpm)) {
            torqueAvail = Number(base_torque_ftlb);
          } else {
            torqueAvail = (availableHp * 5252) / recRpm;
          }
          // Required torque from engineering output (convert in-lbf → ft-lbf)
          const torqueInlbf = Number((raw as any).engineering?.torque_inlbf ?? 0);
          const torqueReqFtlb = torqueInlbf / 12;
          const torqueUtilPct = torqueAvail > 0 ? (torqueReqFtlb / torqueAvail) * 100 : null;
          const torqueZone =
            torqueUtilPct === null ? null
            : torqueUtilPct < 75 ? "green"
            : torqueUtilPct < 100 ? "yellow"
            : "red";
          customer.torque_avail_ftlb = Math.round(torqueAvail * 10) / 10;
          customer.torque_req_ftlb = Math.round(torqueReqFtlb * 10) / 10;
          customer.torque_util_pct = torqueUtilPct !== null ? Math.round(torqueUtilPct * 10) / 10 : null;
          customer.torque_zone = torqueZone;
          customer.torque_curve_confidence = curve_confidence ?? null;
          customer.machine_max_rpm = max_rpm ? Number(max_rpm) : null;
          customer.machine_peak_torque_rpm = peak_torque_rpm ? Number(peak_torque_rpm) : null;
        }
      }
      // Enrich flute-upgrade suggestions with matching EDP from catalog
      const stability = (raw as any).stability;
      if (stability?.suggestions) {
        // Exclude roughing geometries from suggestions when engagement is too light:
        //   chipbreaker: min 8% WOC, 1×D DOC
        //   truncated_rougher: min 10% WOC, 1×D DOC
        const payloadWocPct  = Number((parsed.data as any).woc_pct  ?? 0);
        const payloadToolDia = Number((parsed.data as any).tool_dia  ?? 0);
        const payloadDocXd   = Number((parsed.data as any).doc_xd   ?? 0);  // axial depth in multiples of D
        const docTooLow  = payloadDocXd > 0 && payloadDocXd < 1.0;  // less than 1×D
        // Geometry preference for flute-bump suggestions — stay in same geometry if available
        const VALID_GEOMS = ["standard", "chipbreaker", "truncated_rougher"];
        const rawGeom = String((parsed.data as any).geometry ?? "standard").toLowerCase();
        const payloadGeometry = VALID_GEOMS.includes(rawGeom) ? rawGeom : "standard";
        const excludeCB  = payloadWocPct > 0 && (payloadWocPct < 8  || docTooLow);
        const excludeVRX = payloadWocPct > 0 && (payloadWocPct < 10 || docTooLow);
        const cbClause =
          (excludeCB && excludeVRX)
            ? `AND LOWER(COALESCE(s.geometry, 'standard')) NOT IN ('chipbreaker', 'truncated_rougher')`
          : excludeVRX
            ? `AND LOWER(COALESCE(s.geometry, 'standard')) != 'truncated_rougher'`
          : excludeCB
            ? `AND LOWER(COALESCE(s.geometry, 'standard')) != 'chipbreaker'`
          : ``;
        // BLK suffix = unfinished blanks (no neck ground yet) — never suggest these
        const noBLK = `AND s.edp NOT ILIKE '%-BLK'`;
        // Material → ISO column map for diameter suggestions (filter out wrong-material tools)
        const MATERIAL_ISO: Record<string, string> = {
          aluminum_wrought: "iso_n", aluminum_wrought_hs: "iso_n", aluminum_cast: "iso_n", non_ferrous: "iso_n",
          // Abrasive non-ferrous — micro-abrasive intermetallics; route to P-coat tools, not aluminum tooling
          manganese_bronze: "iso_p", silicon_bronze: "iso_p", copper_beryllium: "iso_p",
          steel_alloy: "iso_p", steel_mild: "iso_p", steel_free: "iso_p",
          tool_steel_p20: "iso_p", tool_steel_a2: "iso_p", tool_steel_h13: "iso_p",
          tool_steel_s7: "iso_p", tool_steel_d2: "iso_p", cpm_10v: "iso_p",
          stainless_304: "iso_m", stainless_316: "iso_m", stainless_fm: "iso_m",
          stainless_ferritic: "iso_m", stainless_410: "iso_m", stainless_420: "iso_m",
          stainless_440c: "iso_m", stainless_ph: "iso_m", stainless_duplex: "iso_m",
          stainless_superduplex: "iso_m",
          cast_iron_gray: "iso_k", cast_iron_ductile: "iso_k", cast_iron_cgi: "iso_k",
          cast_iron_malleable: "iso_k",
          titanium_64: "iso_s", titanium_cp: "iso_s", hiTemp_fe: "iso_s", hiTemp_co: "iso_s",
          monel_k500: "iso_s", inconel_625: "iso_s", inconel_718: "iso_s",
          hastelloy_x: "iso_s", waspaloy: "iso_s", mp35n: "iso_s",
          hardened_lt55: "iso_h", hardened_gt55: "iso_h",
          armor_ar400: "iso_h", armor_ar500: "iso_h",
        };
        const payloadMaterial = String((parsed.data as any).material ?? "");
        const matIsoCol = MATERIAL_ISO[payloadMaterial] ?? null;
        // QTR3/QTR3-RN are universal (all materials) — always include them even in material-filtered queries
        const matClause = matIsoCol
          ? `AND (s.${matIsoCol} = TRUE OR UPPER(s.series) IN ('QTR3','QTR3-RN'))`
          : "";
        const matClause2 = matIsoCol
          ? `AND (s2.${matIsoCol} = TRUE OR UPPER(s2.series) IN ('QTR3','QTR3-RN'))`
          : "";
        for (const s of stability.suggestions) {
          const lookupFlutes = s.suggested_flutes ?? s.lookup_flutes;
        if ((s.type === "tool" || s.type === "diameter" || s.type === "shorter_loc") && lookupFlutes && s.lookup_dia) {
            try {
              const flutes = (s.suggested_flutes ?? s.lookup_flutes) as number;
              const currentEdp = String(s.lookup_edp ?? "");

              // Corner radius constraint: if input tool has a CR, suggestions must have CR > 0 (no square/ball).
              // For standard geometry: CR <= input CR (can go smaller, never larger).
              // For chipbreaker/rougher: allow any CR — roughing just needs corner protection,
              //   so a .090 CR is a valid alternative to a .060 CR tool.
              const corner = (s.lookup_corner ?? "").toLowerCase();
              const cr     = s.lookup_cr ?? 0;
              const inputHasCr = corner !== "square" && corner !== "ball" && cr > 0;
              // LBS/necked tool: require suggested tool to have lbs_in >= lookup_lbs (sufficient reach)
              const lookupLbs = s.lookup_lbs ? parseFloat(String(s.lookup_lbs)) : 0;
              const lbsClause = lookupLbs > 0 ? ` AND COALESCE(s.lbs_in, 0) >= ${lookupLbs}` : "";
              const lbsClause2 = lookupLbs > 0 ? ` AND COALESCE(s2.lbs_in, 0) >= ${lookupLbs}` : "";
              const isRoughingGeom = payloadGeometry === "chipbreaker" || payloadGeometry === "truncated_rougher";
              const isDiameterSugg = s.type === "diameter";
              // Diameter suggestions: relax CR filter to "any CR" — going to a larger tool,
              // the exact CR size is secondary and shouldn't exclude the only available option.
              const crFilterS  = inputHasCr && !isRoughingGeom && !isDiameterSugg
                ? ` AND CASE WHEN s.corner_condition  ~ '^[0-9]' THEN s.corner_condition::numeric  ELSE 999 END <= ${cr}`
                : inputHasCr
                  ? ` AND LOWER(s.corner_condition)  NOT IN ('square','ball')`  // roughing or diameter: any CR ok
                  : "";
              const crFilterS2 = inputHasCr && !isRoughingGeom && !isDiameterSugg
                ? ` AND CASE WHEN s2.corner_condition ~ '^[0-9]' THEN s2.corner_condition::numeric ELSE 999 END <= ${cr}`
                : inputHasCr
                  ? ` AND LOWER(s2.corner_condition) NOT IN ('square','ball')`
                  : "";

              // Primary: derive EDP by replacing first digit (flute count) — e.g. 505221 → 605221
              // Search for all coating variants (same base, last digit varies)
              // Only valid for flute-change suggestions (type === "tool"), not diameter changes
              if (s.type === "tool" && currentEdp.length > 1 && /^\d/.test(currentEdp)) {
                const derivedBase = String(flutes) + currentEdp.slice(1, -1); // all but last char
                const q = await pool.query(
                  `SELECT s.edp FROM skus s
                   JOIN sku_uploads u ON s.upload_id = u.id
                   WHERE u.is_current = TRUE AND s.edp ILIKE $1
                   ${cbClause}
                   ${noBLK}
                   ${crFilterS}
                   ${lbsClause}
                   ORDER BY
                     CASE WHEN LOWER(COALESCE(s.geometry, 'standard')) = $2 THEN 0 ELSE 1 END,
                     s.edp`,
                  [derivedBase + "%", payloadGeometry]
                );
                if (q.rows.length > 0) {
                  s.suggested_edps = q.rows.map((r: any) => r.edp);
                  s.suggested_edp  = s.suggested_edps[0];
                  continue;
                }
              }

              const dia = s.lookup_dia;
              const loc = s.lookup_loc ?? 0;

              // Build corner condition string for direct text match
              // DB stores CR as text e.g. "0.03", "0.06"; square/ball as "square"/"ball"
              const cornerStr = (corner === "square" || corner === "ball")
                ? corner
                : String(parseFloat(cr.toFixed(4)));  // "0.03", "0.06", etc.

              // Shorter-LOC same tool: find shortest stocked LOC >= required minimum but < input LOC.
              // Same flutes, dia, corner — just a shorter-reach version of the same tool.
              if (s.type === "shorter_loc") {
                const inputLoc = Number((parsed.data as any).loc ?? 999);
                const qsl = await pool.query(
                  `SELECT s.edp FROM skus s
                   JOIN sku_uploads u ON s.upload_id = u.id
                   WHERE u.is_current = TRUE
                     AND s.flutes = $1
                     AND ABS(s.cutting_diameter_in - $2) < 0.001
                     AND LOWER(s.corner_condition) = LOWER($3)
                     AND COALESCE(s.loc_in, 0) >= $4
                     AND COALESCE(s.loc_in, 0) < $5 - 0.05
                     ${cbClause}
                     ${noBLK}
                     ${crFilterS}
                   ORDER BY s.loc_in ASC, s.edp`,
                  [flutes, dia, cornerStr, loc, inputLoc]
                );
                if (qsl.rows.length > 0) {
                  s.suggested_edps = qsl.rows.map((r: any) => r.edp);
                  s.suggested_edp  = s.suggested_edps[0];
                }
                continue;
              }

              // For diameter suggestions: prefer tools where LOC >= required DOC (sufficient reach),
              // sorted by shortest sufficient LOC first. This avoids necked tools whose LOC
              // is shorter than the job needs (e.g. 606711 LOC=0.9375" < 1.0" DOC wins over
              // 606111 LOC=1.25" when using closest-LOC logic — wrong choice).
              if (s.type === "diameter") {
                // Helper: attach CR note if suggested tool has a different CR than input
                const attachDiaCrNote = (rows: any[]) => {
                  if (!rows.length) return;
                  s.suggested_edps = rows.map((r: any) => r.edp);
                  s.suggested_edp  = s.suggested_edps[0];
                  // Check if the suggested CR differs from input CR
                  const suggestedCr = rows[0].corner_condition ?? "";
                  const suggestedCrNum = parseFloat(suggestedCr);
                  const inputCrNum = cr;  // input corner radius in inches
                  if (inputHasCr && !isNaN(suggestedCrNum) && Math.abs(suggestedCrNum - inputCrNum) > 0.0005) {
                    s.suggested_cr_note = `${suggestedCrNum.toFixed(3)}" CR`;
                  }
                };
                // Primary: matching corner, tools at the minimum sufficient LOC only (all coating variants)
                const qd1 = await pool.query(
                  `SELECT s.edp, s.corner_condition FROM skus s
                   JOIN sku_uploads u ON s.upload_id = u.id
                   WHERE u.is_current = TRUE
                     AND s.flutes = $1
                     AND ABS(s.cutting_diameter_in - $2) < 0.001
                     AND LOWER(s.corner_condition) = LOWER($3)
                     AND COALESCE(s.loc_in, 0) = (
                       SELECT MIN(COALESCE(s2.loc_in, 0))
                       FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                       WHERE u2.is_current = TRUE
                         AND s2.flutes = $1
                         AND ABS(s2.cutting_diameter_in - $2) < 0.001
                         AND LOWER(s2.corner_condition) = LOWER($3)
                         AND COALESCE(s2.loc_in, 0) >= $4
                         ${cbClause.replace(/\bs\./g, "s2.")}
                         ${noBLK.replace(/\bs\./g, "s2.")}
                         ${matClause2}
                     )
                     ${cbClause}
                     ${noBLK}
                     ${matClause}
                   ORDER BY s.edp`,
                  [flutes, dia, cornerStr, loc]
                );
                if (qd1.rows.length > 0) {
                  attachDiaCrNote(qd1.rows);
                } else {
                  // Fallback: ignore corner, tools at minimum sufficient LOC only
                  const qd2 = await pool.query(
                    `SELECT s.edp, s.corner_condition FROM skus s
                     JOIN sku_uploads u ON s.upload_id = u.id
                     WHERE u.is_current = TRUE
                       AND s.flutes = $1
                       AND ABS(s.cutting_diameter_in - $2) < 0.001
                       AND COALESCE(s.loc_in, 0) = (
                         SELECT MIN(COALESCE(s2.loc_in, 0))
                         FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                         WHERE u2.is_current = TRUE
                           AND s2.flutes = $1
                           AND ABS(s2.cutting_diameter_in - $2) < 0.001
                           AND COALESCE(s2.loc_in, 0) >= $3
                           AND s2.tool_type IS DISTINCT FROM 'chamfer_mill'
                           ${cbClause.replace(/\bs\./g, "s2.")}
                           ${noBLK.replace(/\bs\./g, "s2.")}
                           ${crFilterS2}
                           ${matClause2}
                       )
                       AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
                       ${cbClause}
                       ${noBLK}
                       ${crFilterS}
                       ${matClause}
                     ORDER BY s.edp`,
                    [flutes, dia, loc]
                  );
                  if (qd2.rows.length > 0) {
                    attachDiaCrNote(qd2.rows);
                  } else {
                    // Last resort: closest LOC regardless of length
                    const qd3 = await pool.query(
                      `SELECT s.edp, s.corner_condition FROM skus s
                       JOIN sku_uploads u ON s.upload_id = u.id
                       WHERE u.is_current = TRUE
                         AND s.flutes = $1
                         AND ABS(s.cutting_diameter_in - $2) < 0.001
                         AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
                         ${cbClause}
                         ${noBLK}
                         ${crFilterS}
                         ${matClause}
                         AND ABS(COALESCE(s.loc_in, 0) - $3) = (
                           SELECT MIN(ABS(COALESCE(s2.loc_in, 0) - $3))
                           FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                           WHERE u2.is_current = TRUE
                             AND s2.flutes = $1
                             AND ABS(s2.cutting_diameter_in - $2) < 0.001
                             AND s2.tool_type IS DISTINCT FROM 'chamfer_mill'
                             ${cbClause.replace(/\bs\./g, "s2.")}
                             ${noBLK.replace(/\bs\./g, "s2.")}
                             ${crFilterS2}
                             ${matClause2}
                         )
                       ORDER BY s.edp`,
                      [flutes, dia, loc]
                    );
                    if (qd3.rows.length > 0) {
                      attachDiaCrNote(qd3.rows);
                    }
                  }
                }
              } else {
              // Non-diameter suggestions: find the closest LOC
              const q2 = await pool.query(
                `SELECT s.edp FROM skus s
                 JOIN sku_uploads u ON s.upload_id = u.id
                 WHERE u.is_current = TRUE
                   AND s.flutes = $1
                   AND ABS(s.cutting_diameter_in - $2) < 0.001
                   AND LOWER(s.corner_condition) = LOWER($3)
                   ${cbClause}
                   ${noBLK}
                   ${lbsClause}
                   AND ABS(COALESCE(s.loc_in, 0) - $4) = (
                     SELECT MIN(ABS(COALESCE(s2.loc_in, 0) - $4))
                     FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                     WHERE u2.is_current = TRUE
                       AND s2.flutes = $1
                       AND ABS(s2.cutting_diameter_in - $2) < 0.001
                       AND LOWER(s2.corner_condition) = LOWER($3)
                       ${cbClause.replace(/\bs\./g, "s2.")}
                       ${noBLK.replace(/\bs\./g, "s2.")}
                       ${lbsClause2}
                   )
                 ORDER BY s.edp`,
                [flutes, dia, cornerStr, loc]
              );
              if (q2.rows.length > 0) {
                s.suggested_edps = q2.rows.map((r: any) => r.edp);
                s.suggested_edp  = s.suggested_edps[0];
              } else {
                // Fallback: ignore corner, just match flutes + dia + closest LOC
                // Still enforce LBS requirement so we don't return a short-reach tool for an LBS job
                const q3 = await pool.query(
                  `SELECT s.edp FROM skus s
                   JOIN sku_uploads u ON s.upload_id = u.id
                   WHERE u.is_current = TRUE
                     AND s.flutes = $1
                     AND ABS(s.cutting_diameter_in - $2) < 0.001
                     AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
                     ${cbClause}
                     ${noBLK}
                     ${crFilterS}
                     ${lbsClause}
                     AND ABS(COALESCE(s.loc_in, 0) - $3) = (
                       SELECT MIN(ABS(COALESCE(s2.loc_in, 0) - $3))
                       FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                       WHERE u2.is_current = TRUE
                         AND s2.flutes = $1
                         AND ABS(s2.cutting_diameter_in - $2) < 0.001
                         AND s2.tool_type IS DISTINCT FROM 'chamfer_mill'
                         ${cbClause.replace(/\bs\./g, "s2.")}
                         ${noBLK.replace(/\bs\./g, "s2.")}
                         ${crFilterS2}
                         ${lbsClause2}
                     )
                   ORDER BY s.edp`,
                  [flutes, dia, loc]
                );
                if (q3.rows.length > 0) {
                  s.suggested_edps = q3.rows.map((r: any) => r.edp);
                  s.suggested_edp  = s.suggested_edps[0];
                } else if (lookupLbs > 0) {
                  // Final fallback: no tool meets lbs >= lookupLbs — use highest available LBS
                  // (user may have manually entered a larger LBS than any stocked tool)
                  const q4 = await pool.query(
                    `SELECT s.edp FROM skus s
                     JOIN sku_uploads u ON s.upload_id = u.id
                     WHERE u.is_current = TRUE
                       AND s.flutes = $1
                       AND ABS(s.cutting_diameter_in - $2) < 0.001
                       AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
                       AND COALESCE(s.lbs_in, 0) > 0
                       ${cbClause}
                       ${noBLK}
                       AND COALESCE(s.lbs_in, 0) = (
                         SELECT MAX(COALESCE(s2.lbs_in, 0))
                         FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                         WHERE u2.is_current = TRUE
                           AND s2.flutes = $1
                           AND ABS(s2.cutting_diameter_in - $2) < 0.001
                           AND s2.tool_type IS DISTINCT FROM 'chamfer_mill'
                           AND COALESCE(s2.lbs_in, 0) > 0
                           ${cbClause.replace(/\bs\./g, "s2.")}
                           ${noBLK.replace(/\bs\./g, "s2.")}
                       )
                     ORDER BY s.edp`,
                    [flutes, dia]
                  );
                  if (q4.rows.length > 0) {
                    s.suggested_edps = q4.rows.map((r: any) => r.edp);
                    s.suggested_edp  = s.suggested_edps[0];
                  }
                }
              }
              } // end non-diameter branch
            } catch (_) { /* catalog unavailable — skip enrichment */ }
          }
          // Same-diameter flute-count suggestions with no catalog match are special orders
          if (s.type === "tool" && !s.suggested_edp) {
            s.label = (s.label ?? "") + " — available as a special";
          }
        }

        // Post-enrichment: flag suggested EDPs whose LOC is shorter than input tool LOC.
        // These get "Can you use [EDP] (X.XXX" LOC)?" phrasing in the UI instead of "Try:".
        if (stability?.suggestions) {
          for (const s of stability.suggestions) {
            if (!s.suggested_edp || !s.lookup_loc) continue;
            try {
              const locResult = await pool.query(
                `SELECT s2.loc_in, s2.oal_in FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                 WHERE u2.is_current = TRUE AND s2.edp = $1 LIMIT 1`,
                [s.suggested_edp]
              );
              if (locResult.rows.length) {
                const sugLoc = Number(locResult.rows[0].loc_in);
                const sugOal = Number(locResult.rows[0].oal_in);
                if (sugLoc > 0 && sugLoc < Number(s.lookup_loc) - 0.001) {
                  s.suggested_edp_loc = sugLoc;
                  if (sugOal > 0) s.suggested_edp_oal = sugOal;
                }
              }
            } catch (_) { /* skip */ }
          }
        }
      }

      const out = mentorSchemas.response.safeParse(raw);
      if (!out.success) {
        const firstErr = out.error.errors[0];
        return res
          .status(500)
          .json({ message: `Mentor output validation failed: ${firstErr?.path?.join(".")} — ${firstErr?.message}` });
      }

      return res.status(200).json(out.data);
    } catch (e: any) {
      return res.status(500).json({ message: e?.message || "Internal error" });
    }
  });

  // ── Optimal tool recommendation ────────────────────────────────────────────
  app.post("/api/optimal-tool", async (req, res) => {
    try {
      const { current_edp, payload, current_mrr, current_feed_ipm, current_stability_pct } = req.body;
      if (!payload || !current_edp) return res.json({ found: false });
      const { pool } = await import("./db");

      const dia     = Number(payload.tool_dia ?? 0);
      const mode    = String(payload.mode ?? "");
      const wocPct  = Number(payload.woc_pct ?? 0);
      const docXd   = Number(payload.doc_xd ?? 0);
      const matKey  = String(payload.material ?? "");

      // ISO category needed before peer query (used in peer filter for slot/aluminum)
      const ISO_MAP: Record<string, string> = {
        aluminum_wrought: "N", aluminum_cast: "N",
        steel_mild: "P", steel_free: "P", steel_alloy: "P",
        stainless_304: "M", stainless_316: "M", stainless_ph: "M",
        stainless_duplex: "M", stainless_superduplex: "M", stainless_fm: "M",
        stainless_ferritic: "M", stainless_410: "M", stainless_420: "M", stainless_440c: "M",
        titanium_64: "S", inconel_718: "S", inconel_625: "S",
        hastelloy_x: "S", waspaloy: "S", mp35n: "S", monel_k500: "S",
        cast_iron_gray: "K", cast_iron_ductile: "K",
        hardened_lt55: "H", hardened_gt55: "H",
        tool_steel_p20: "H", tool_steel_a2: "H", tool_steel_h13: "H",
        tool_steel_s7: "H", tool_steel_d2: "H",
      };
      const isoCategory = ISO_MAP[matKey] ?? "P";

      // Peers: same diameter, exclude chamfer mills, not current EDP, not blanks
      // For surfacing: restrict to ball-nose and corner-radius (bull-nose) tools only
      const isSurfacing = mode === "surfacing";
      const curLoc = Number(payload.loc ?? 0);
      const curLbs = Number(payload.lbs ?? 0);
      // LBS/necked tool: only consider peers with sufficient reach (lbs_in >= curLbs)
      const lbsPeerClause = curLbs > 0 ? ` AND COALESCE(s.lbs_in, 0) >= ${curLbs}` : "";
      console.log(`[OptimalTool] edp=${current_edp} lbs=${curLbs} lbsClause=${lbsPeerClause || "(none)"}`);
      const peers = await pool.query(
        `SELECT s.* FROM skus s
         JOIN sku_uploads u ON s.upload_id = u.id
         WHERE u.is_current = TRUE
           AND ABS(s.cutting_diameter_in - $1) < 0.001
           AND LOWER(s.edp) != LOWER($2)
           AND s.edp NOT ILIKE '%-BLK'
           AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
           ${lbsPeerClause}
           ${isSurfacing ? `AND LOWER(s.corner_condition) IN ('ball','corner_radius')` : ""}
           ${mode === "circ_interp" ? `AND COALESCE(s.geometry,'standard') NOT IN ('chipbreaker','truncated_rougher')` : ""}
           ${mode === "slot" && isoCategory === "N" ? `AND COALESCE(s.geometry,'standard') != 'truncated_rougher' AND s.flutes IN (2,3)` : ""}
           ${mode === "slot" && isoCategory !== "N" ? `AND s.flutes <= 5` : ""}
         ORDER BY s.edp`,
        [dia, current_edp]
      );
      console.log(`[OptimalTool] peers=${peers.rows.length}`);
      if (peers.rows.length === 0) return res.json({ found: false });

      // Scoring helpers
      // Slotting is always 100% WOC — CB/VRX always valid regardless of DOC (chip breaking aids evacuation)
      // Slot geometry priority is material-dependent:
      //   Aluminum (N): 3-fl CB preferred — chip clearance trumps toughness; VRX overkill
      //   Steel (P):    4-fl CB preferred
      //   Tough (M/S/H): 4-fl VRX preferred — hard materials need tougher edge
      const isSlot       = mode === "slot";
      const isCircInterp = mode === "circ_interp";
      const slotAlum     = isSlot && isoCategory === "N";
      const slotTough    = isSlot && (isoCategory === "M" || isoCategory === "S" || isoCategory === "H");
      const cbOk  = (docXd >= 1.0 && (mode === "hem" || mode === "trochoidal" || wocPct >= 8)) || (isSlot);
      const vrxOk = (docXd >= 1.0 && wocPct >= 12) || (slotTough && docXd >= 0.5);

      const scoreGeometry = (g: string | null): number => {
        if (isSurfacing || isCircInterp) return 2; // geometry irrelevant — coating/pitch/helix decide
        const geom = (g ?? "standard").toLowerCase();
        // Slot aluminum: CB is top pick; VRX is overkill (penalize)
        if (slotAlum && geom === "chipbreaker")        return 4;
        if (slotAlum && geom === "truncated_rougher")  return 1;
        if (vrxOk && geom === "truncated_rougher") return 4;
        if (cbOk && geom === "chipbreaker")        return 3;
        if (geom === "standard")                   return 2;
        if (geom === "chipbreaker")                return 1;
        return 1;
      };

      const scoreCoating = (coating: string | null): number => {
        const c = (coating ?? "").toLowerCase();
        if (isoCategory === "N") return (c.includes("zrn") || c === "uncoated" || c.includes("d-max") || c.includes("a-max") || c.includes("dlc")) ? 2 : 0;
        if (isoCategory === "P") return (c.includes("altin") || c.includes("p-max") || c.includes("alcrn") || c.includes("t-max")) ? 2 : c.includes("tin") ? 1 : 0;
        if (isoCategory === "M") return c.includes("t-max") ? 3 : (c.includes("c-max") || c.includes("alcrn")) ? 2 : (c.includes("altin") || c.includes("p-max")) ? 1 : 0;
        if (isoCategory === "S") return c.includes("t-max") ? 3 : (c.includes("altin") || c.includes("c-max") || c.includes("alcrn")) ? 2 : 0;
        if (isoCategory === "H") return (c.includes("alcrn") || c.includes("c-max") || c.includes("t-max")) ? 2 : 0;
        return 0;
      };

      const curFlutes = Number(payload.flutes ?? 0);

      const GEOM_SPECIALIZED = ["qtr3", "cmh", "cms"];
      const isGeomSpecialized = (row: any): boolean => {
        const s = (row.tool_series ?? "").toLowerCase();
        return GEOM_SPECIALIZED.some(prefix => s.startsWith(prefix));
      };

      const scoreSku = (row: any): number => {
        const coatScore = isGeomSpecialized(row) ? 1 : scoreCoating(row.coating);
        let s = scoreGeometry(row.geometry) + coatScore;
        if (row.variable_pitch) s += 1;
        if (row.variable_helix) s += 1;
        return s;
      };

      // Score current EDP
      const curResult = await pool.query(
        `SELECT s.* FROM skus s JOIN sku_uploads u ON s.upload_id = u.id
         WHERE u.is_current = TRUE AND LOWER(s.edp) = LOWER($1)`,
        [current_edp]
      );
      const curSku   = curResult.rows[0];
      const curScore = curSku ? scoreSku(curSku) : 0;
      console.log(`[OptimalTool] curSkuFound=${!!curSku} curCorner=${String(curSku?.corner_condition ?? "MISSING")} curLbs=${curLbs}`);

      // When setup is already deflecting, flute count upgrade is as important as coating/geometry.
      // Merge same-flute and next-flute candidates into one pool and apply a stability bonus
      // to flute-count upgrades so they can beat a coating-only variant.
      // For circ_interp: always include next flute up — more flutes = smoother bore wall.
      const stabOver  = Number(current_stability_pct ?? 0) >= 100;
      const isFinish  = mode === "finish";
      const STAB_FLUTE_BONUS  = 2;
      const CIRC_FLUTE_BONUS  = 2;
      const FINISH_FLUTE_BONUS = 2; // more flutes = better surface finish, less chatter at light WOC

      // ── Priority 1: Same LOC — same flutes OR flute-count shift based on mode/material ──
      const nextFlutes = curFlutes + 1;
      const prevFlutes = curFlutes - 1;
      // Corner condition of current tool — recommendations must never change the corner.
      // "square" stays square; CR tools stay at same CR; ball stays ball.
      const curCorner = String(curSku?.corner_condition ?? "square").toLowerCase();
      const cornerMatch = (r: any): boolean => {
        const rc = String(r.corner_condition ?? "square").toLowerCase();
        return rc === curCorner;
      };
      const sameLocCandidates = peers.rows.filter((r: any) => {
        const locMatch  = Math.abs(Number(r.loc_in) - curLoc) < 0.001;
        const rf        = Number(r.flutes);
        const geom      = (r.geometry ?? "standard").toLowerCase();
        // 5-fl VXR in slotting only at ≤ 0.5xD — exclude 5-fl VXR if deeper
        if (isSlot && geom === "truncated_rougher" && rf >= 5 && docXd > 0.5) return false;
        // Never recommend a different corner condition than what the current tool has
        if (!cornerMatch(r)) return false;
        // Slotting: never go up in flutes — chip clearance gets worse, not better.
        // Steel/stainless/tough slot: prefer dropping to 4-flute (or 4-fl chipbreaker).
        // Aluminum slot: prefer dropping to 3-flute.
        const fluteMatch = rf === curFlutes
          || (!isSlot && (stabOver || isCircInterp || isFinish) && rf === nextFlutes)
          || (isSlot && stabOver && rf === nextFlutes && nextFlutes <= 5) // slot + deflecting: allow 4→5fl only
          || (slotAlum  && rf === prevFlutes && prevFlutes >= 2)
          || (isSlot && !slotAlum && rf === prevFlutes && prevFlutes >= 4);
        return locMatch && fluteMatch;
      });
      let bestSku: any = null;
      let bestScore = -1;
      for (const row of sameLocCandidates) {
        let sc = scoreSku(row);
        const rf = Number(row.flutes);
        if (stabOver && rf === nextFlutes && (!isSlot || nextFlutes <= 5)) sc += STAB_FLUTE_BONUS;
        else if (!isSlot && isCircInterp && rf === nextFlutes) sc += CIRC_FLUTE_BONUS;
        else if (!isSlot && isFinish  && rf === nextFlutes) sc += FINISH_FLUTE_BONUS;
        else if (slotAlum  && rf === prevFlutes) sc += 2;
        else if (isSlot && !slotAlum && rf === prevFlutes && prevFlutes >= 4) sc += 2; // steel/tough: prefer 4-fl for slotting
        if (sc > bestScore) { bestScore = sc; bestSku = row; }
      }
      if (bestSku && bestScore > curScore) {
        // Found a same-LOC upgrade (coating, geometry, or flute count when deflecting)
      } else {
        bestSku = null; bestScore = -1; // clear — tie or loss doesn't count as upgrade
        // ── Priority 1.5: Next diameter up, same series ───────────────────────
        const curSeries = (curSku?.series ?? "").toLowerCase();
        const STD_DIAMETERS = [0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.500, 0.5625, 0.625, 0.6875, 0.750, 0.875, 1.000, 1.25, 1.5];
        const nextDia = STD_DIAMETERS.find(d => d > dia + 0.001) ?? null;
        if (curSeries && nextDia) {
          const nextDiaRows = await pool.query(
            `SELECT s.* FROM skus s JOIN sku_uploads u ON s.upload_id = u.id
             WHERE u.is_current = TRUE
               AND ABS(s.cutting_diameter_in - $1) < 0.005
               AND LOWER(s.tool_series) = LOWER($2)
               AND s.flutes = $3
               AND s.edp NOT ILIKE '%-BLK'
             ORDER BY s.edp`,
            [nextDia, curSeries, curFlutes]
          );
          if (nextDiaRows.rows.length > 0) {
            bestSku = null; bestScore = -1;
            for (const row of nextDiaRows.rows) {
              const sc = scoreSku(row);
              if (sc > bestScore) { bestScore = sc; bestSku = row; }
            }
          }
        }
        if (!bestSku) {
          // ── Priority 2: Same LOC, next flute count up (non-deflecting path) ──
          const sameLocNextFlute = peers.rows.filter((r: any) =>
            Math.abs(Number(r.loc_in) - curLoc) < 0.001 && Number(r.flutes) === nextFlutes && cornerMatch(r)
          );
          bestSku = null; bestScore = -1;
          for (const row of sameLocNextFlute) {
            const sc = scoreSku(row);
            if (sc > bestScore) { bestScore = sc; bestSku = row; }
          }
          if (!bestSku || bestScore < curScore) {
            bestSku = null; bestScore = -1;
          }
        }
      }

      // No recommendation found
      console.log(`[OptimalTool] bestSku=${bestSku?.edp ?? "none"} bestScore=${bestScore} curScore=${curScore}`);
      if (!bestSku) return res.json({ found: false });

      // ── VXR rigidity gate ─────────────────────────────────────────────────
      // VXR4/VXR5 are aggressive roughers — suppress if setup can't handle the forces.
      // If VXR is blocked, fall back to best non-VXR peer rather than returning nothing.
      const sameLocSameFlute = peers.rows.filter((r: any) =>
        Math.abs(Number(r.loc_in) - curLoc) < 0.001 && Number(r.flutes) === curFlutes && cornerMatch(r)
      );
      const isVxr = /^vxr/i.test(bestSku.series ?? "");
      let vxrRigidityNote: string | null = null;
      if (isVxr) {
        const holder      = String(payload.toolholder ?? "").toLowerCase();
        const wh          = String(payload.workholding ?? "").toLowerCase();
        const availHp     = Number(payload.machine_hp ?? 0);
        const taper       = String(payload.spindle_taper ?? "").toUpperCase();
        // Hard blocks — setup cannot support VXR forces
        const weakHolder  = ["er_collet", "weldon"].includes(holder);
        const weakWh      = ["toe_clamps", "soft_jaws", "3_jaw_chuck", "4_jaw_chuck", "collet_chuck", "between_centers", "face_plate"].includes(wh);
        const weakMachine = availHp > 0 && availHp < 10;
        const smallTaper  = taper === "CAT30" || taper === "BT30" || taper === "R8";
        const shallowDoc  = docXd > 0 && docXd < 0.5;
        const lowWoc      = wocPct > 0 && wocPct < 8;
        const deflOver    = Number(current_stability_pct ?? 0) >= 100; // already deflecting — VXR increases force, makes it worse
        if (weakHolder || weakWh || weakMachine || smallTaper || shallowDoc || lowWoc || deflOver) {
          // Fall back to best non-VXR peer at same LOC + same flutes
          const nonVxrPeers = sameLocSameFlute.filter((r: any) => !/^vxr/i.test(r.series ?? ""));
          bestSku = null; bestScore = -1;
          for (const row of nonVxrPeers) {
            const sc = scoreSku(row);
            if (sc > bestScore) { bestScore = sc; bestSku = row; }
          }
          if (!bestSku || bestScore <= curScore) return res.json({ found: false });
        } else {
          // Borderline setup — show card with a note
          const borderlineHolder = ["hp_collet", "milling_chuck"].includes(holder);
          const borderlineWh     = wh === "vise";
          if (borderlineHolder || borderlineWh || (availHp > 0 && availHp < 15)) {
            vxrRigidityNote = "VXR geometry is aggressive — best results with shrink-fit or hydraulic holder, rigid fixture or vise with solid workholding, and 15+ HP.";
          }
        }
      }

      // Build modified payload with recommended SKU geometry
      const crNum  = Number(bestSku.corner_condition);
      const isBall = String(bestSku.corner_condition ?? "").toLowerCase() === "ball";
      const recFlutes = Number(bestSku.flutes);
      // Slotting DOC cap by flute count — 5-fl max 0.5×D, 4-fl and below max 1.0×D
      // When recommending a higher flute count in slot mode, pull DOC down to the new tool's limit.
      const recDocXd = (() => {
        if (mode !== "slot") return docXd;
        const slotDocCap = recFlutes >= 5 ? 0.5 : 1.0;
        return Math.min(docXd, slotDocCap);
      })();
      const modPayload = {
        ...payload,
        edp:             bestSku.edp,
        tool_dia:        Number(bestSku.cutting_diameter_in),
        flutes:          recFlutes,
        loc:             Number(bestSku.loc_in),
        lbs:             bestSku.lbs_in != null ? Number(bestSku.lbs_in) : 0,
        doc_xd:          recDocXd,
        geometry:        bestSku.geometry ?? "standard",
        variable_pitch:  !!bestSku.variable_pitch,
        variable_helix:  !!bestSku.variable_helix,
        helix_angle:     bestSku.helix ?? payload.helix_angle ?? 35,
        coating:         bestSku.coating ?? payload.coating,
        corner_condition: isBall ? "ball" : (!isNaN(crNum) && crNum > 0) ? "corner_radius" : "square",
        corner_radius:   (!isNaN(crNum) && crNum > 0) ? crNum : 0,
      };

      let recRaw: any = null;
      try { recRaw = await runMentorBridge(modPayload); } catch { /* delta unavailable — still surface card */ }

      // ── Results-based safety filter ───────────────────────────────────────
      // Score is the positive gate (encodes engineering judgment — CB for HEM,
      // right coating, var pitch etc). Results filter is a safety net only:
      // suppress the recommendation if the engine says the swap is actually worse
      // (e.g. a longer LOC peer that deflects more at the same setup).
      // If engine failed to run for the recommended tool, skip the filter entirely
      // — recRaw=null would set recMrr=0, falsely triggering mrrWorse.
      if (recRaw !== null) {
        const recMrr     = Number(recRaw?.customer?.mrr_in3_min ?? 0);
        const recStabPct = Number(recRaw?.stability?.deflection_pct ?? 0);
        const curMrrNum  = Number(current_mrr  ?? 0);
        const curStabNum = Number(current_stability_pct ?? 0);

        // Suppress only if recommended tool is materially worse (>10% MRR drop OR stability gets worse)
        const mrrWorse  = curMrrNum > 0 && recMrr > 0 && recMrr < curMrrNum * 0.90;
        const stabWorse = curStabNum > 0 && recStabPct > 0 && recStabPct > curStabNum * 1.10;
        if (mrrWorse || stabWorse) return res.json({ found: false });
      }

      return res.json({
        found: true,
        recommended_edp: bestSku.edp,
        rigidity_note: vxrRigidityNote ?? undefined,
        recommended_sku: {
          edp:                bestSku.edp,
          tool_type:          bestSku.tool_type,
          flutes:             bestSku.flutes,
          cutting_diameter_in: bestSku.cutting_diameter_in,
          loc_in:             bestSku.loc_in,
          geometry:           bestSku.geometry ?? "standard",
          coating:            bestSku.coating,
          series:             bestSku.series,
          variable_pitch:     bestSku.variable_pitch,
          variable_helix:     bestSku.variable_helix,
          description1:       bestSku.description1,
          description2:       bestSku.description2,
          corner_condition:   bestSku.corner_condition,
          lbs_in:             bestSku.lbs_in,
          neck_dia_in:        bestSku.neck_dia_in,
          shank_dia_in:       bestSku.shank_dia_in,
          oal_in:             bestSku.oal_in,
          flute_wash:         bestSku.flute_wash,
          helix:              bestSku.helix,
        },
        recommended_result: recRaw,
      });
    } catch (_e: any) {
      return res.json({ found: false });
    }
  });

  app.post("/api/execute", async (req, res) => {
    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ message: "Code is required" });
    }

    const tmpDir = process.platform === "win32"
      ? (process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp")
      : "/tmp";
    const tmpFile = path.join(tmpDir, `script_${Date.now()}.py`);
    try {
      await writeFile(tmpFile, code, "utf-8");

      const pythonPath = resolvePython();
      const cwd = process.cwd();

      const replitSitePackages = path.join(cwd, ".pythonlibs", "lib", "python3.11", "site-packages");
      const extraPythonPath = fs.existsSync(replitSitePackages) ? replitSitePackages : "";

      const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          exec(
            `"${pythonPath}" "${tmpFile}"`,
            {
              timeout: 30000,
              cwd,
              env: {
                ...process.env,
                ...(extraPythonPath ? { PYTHONPATH: extraPythonPath } : {}),
              },
            },
            (error, stdout, stderr) => {
              resolve({ stdout: stdout || "", stderr: stderr || "" });
            },
          );
        },
      );

      let output = result.stdout;
      if (result.stderr) {
        output += (output ? "\n" : "") + result.stderr;
      }

      res.json({ output: output || ">>> Execution finished (No output)" });
    } catch (err: any) {
      res.status(500).json({ output: `Execution error: ${err.message}` });
    } finally {
      try {
        await unlink(tmpFile);
      } catch {}
    }
  });

  // ── Custom Reamer Quote Request ───────────────────────────────────────────
  app.post("/api/quote/reamer", async (req, res) => {
    const { customer, spec } = req.body ?? {};
    if (!customer?.name || !customer?.email) {
      return res.status(400).json({ message: "Name and email are required." });
    }

    const to = process.env.QUOTE_TO_EMAIL || "sales@corecutterusa.com";
    const smtpUser = process.env.SMTP_USER || "";
    const smtpPass = process.env.SMTP_PASS || "";
    const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
    const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);

    const subjectLine = `Custom Reamer Quote Request — ${spec?.diameter || "?"}" ø — ${customer.name}`;

    const textBody = [
      "=== CUSTOM REAMER QUOTE REQUEST ===",
      "",
      "-- Customer Info --",
      `Name:      ${customer.name}`,
      `Company:   ${customer.company || "(not provided)"}`,
      `Email:     ${customer.email}`,
      `Phone:     ${customer.phone || "(not provided)"}`,
      `Quantity:  ${customer.qty || "(not provided)"}`,
      `Tolerance: ${customer.tolerance || "(not provided)"}`,
      "",
      "-- Reamer Specification --",
      `Diameter:    ${spec?.diameter || "?"}`,
      `Shank Dia:   ${spec?.shank_dia || "?"}`,
      `Flutes:      ${spec?.flutes || "?"}`,
      `Hole Depth:  ${spec?.depth || "?"}`,
      `Hole Type:   ${spec?.hole_type || "?"}`,
      `Helix:       ${spec?.helix || "?"}`,
      `Coating:     ${spec?.coating || "?"}`,
      `Coolant Thru: ${spec?.coolant_thru || "?"}`,
      `Material:    ${spec?.material || "?"}`,
      `Pre-Drill:   ${spec?.pre_drill || "?"}`,
      "",
      "-- Notes --",
      customer.notes || "(none)",
      "",
      "---",
      "Submitted via Core Cutter Machining Mentor",
    ].join("\n");

    // Log quote regardless of SMTP status
    console.log("[Quote Request]", JSON.stringify({ customer, spec }, null, 2));

    // Only send email if SMTP credentials are configured
    if (!smtpUser || !smtpPass) {
      console.warn("[Quote] SMTP credentials not configured — quote logged to console only.");
      return res.status(200).json({
        ok: true,
        note: "Quote received. Email delivery pending SMTP configuration.",
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "scott@corecutterusa.com"}>`,
        to,
        replyTo: customer.email,
        subject: subjectLine,
        text: textBody,
      });

      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error("[Quote] Email send failed:", err?.message);
      return res.status(500).json({ message: "Quote logged but email delivery failed. We'll follow up." });
    }
  });

  // ── Custom Drill Quote Request ────────────────────────────────────────────
  app.post("/api/quote/drill", async (req, res) => {
    const { customer, spec } = req.body ?? {};
    if (!customer?.name || !customer?.email) {
      return res.status(400).json({ message: "Name and email are required." });
    }

    const to = process.env.QUOTE_TO_EMAIL || "sales@corecutterusa.com";
    const smtpUser = process.env.SMTP_USER || "";
    const smtpPass = process.env.SMTP_PASS || "";
    const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
    const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);

    const subjectLine = `Custom Drill Quote Request — ${spec?.diameter || "?"} ø — ${customer.name}`;

    const stepLines: string[] = (spec?.steps ?? []).map((s: any, i: number) =>
      `Step ${i + 1}:      ø${s.dia}  ×  ${s.length} from tip`
    );

    const textBody = [
      "=== CUSTOM DRILL QUOTE REQUEST ===",
      "",
      "-- Customer Info --",
      `Name:        ${customer.name}`,
      `Company:     ${customer.company || "(not provided)"}`,
      `Email:       ${customer.email}`,
      `Phone:       ${customer.phone || "(not provided)"}`,
      `Quantity:    ${customer.qty || "(not provided)"}`,
      `Tolerance:   ${customer.tolerance || "(not provided)"}`,
      "",
      "-- Drill Specification --",
      `Diameter:    ${spec?.diameter || "?"}`,
      `Flutes:      ${spec?.flutes || "?"}`,
      `Point Angle: ${spec?.point_angle || "?"}`,
      `Flute Length:${spec?.flute_length || "?"}`,
      `Hole Depth:  ${spec?.hole_depth || "?"}`,
      `Hole Type:   ${spec?.hole_type || "?"}`,
      `Coolant Thru:${spec?.coolant_thru || "?"}`,
      `Material:    ${spec?.material || "?"}`,
      `Cycle:       ${spec?.cycle || "?"}`,
      ...(stepLines.length ? ["", "-- Step Configuration --", ...stepLines] : []),
      "",
      "-- Notes --",
      customer.notes || "(none)",
      "",
      "---",
      "Submitted via Core Cutter Machining Mentor",
    ].join("\n");

    console.log("[Drill Quote Request]", JSON.stringify({ customer, spec }, null, 2));

    if (!smtpUser || !smtpPass) {
      console.warn("[Drill Quote] SMTP credentials not configured — quote logged to console only.");
      return res.status(200).json({
        ok: true,
        note: "Quote received. Email delivery pending SMTP configuration.",
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "scott@corecutterusa.com"}>`,
        to,
        replyTo: customer.email,
        subject: subjectLine,
        text: textBody,
      });

      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error("[Drill Quote] Email send failed:", err?.message);
      return res.status(500).json({ message: "Quote logged but email delivery failed. We'll follow up." });
    }
  });

  // ── Custom Thread Mill Quote Request ─────────────────────────────────────
  app.post("/api/quote/threadmill", async (req, res) => {
    const { customer, spec } = req.body ?? {};
    if (!customer?.name || !customer?.email) {
      return res.status(400).json({ message: "Name and email are required." });
    }

    const to = process.env.QUOTE_TO_EMAIL || "sales@corecutterusa.com";
    const smtpUser = process.env.SMTP_USER || "";
    const smtpPass = process.env.SMTP_PASS || "";
    const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
    const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);

    const subjectLine = `Custom Thread Mill Quote — ${spec?.thread_standard || "?"} ${spec?.major_dia || "?"} × ${spec?.tpi || spec?.pitch_mm || "?"} — ${customer.name}`;

    const textBody = [
      "=== CUSTOM THREAD MILL QUOTE REQUEST ===",
      "",
      "-- Customer Info --",
      `Name:            ${customer.name}`,
      `Company:         ${customer.company || "(not provided)"}`,
      `Email:           ${customer.email}`,
      `Phone:           ${customer.phone || "(not provided)"}`,
      `Quantity:        ${customer.qty || "(not provided)"}`,
      `Tolerance:       ${customer.tolerance || "(not provided)"}`,
      "",
      "-- Thread Mill Specification --",
      `Standard:        ${spec?.thread_standard || "?"}`,
      `Major Dia:       ${spec?.major_dia || "?"}`,
      `TPI:             ${spec?.tpi || "—"}`,
      `Pitch (mm):      ${spec?.pitch_mm || "—"}`,
      `Class / Hand:    ${spec?.thread_class || "?"} · ${spec?.hand || "?"}`,
      `Int / Ext:       ${spec?.int_ext || "?"}`,
      `Cutter Dia:      ${spec?.cutter_dia || "?"}`,
      `Thread Profiles: ${spec?.thread_profiles || "?"}`,
      `Neck Length:     ${spec?.neck_length || "?"}`,
      `Material:        ${spec?.material || "?"}`,
      `Coating:         ${spec?.coating || "?"}`,
      "",
      "-- Notes --",
      customer.notes || "(none)",
      "",
      "---",
      "Submitted via Core Cutter Machining Mentor",
    ].join("\n");

    console.log("[Thread Mill Quote Request]", JSON.stringify({ customer, spec }, null, 2));

    if (!smtpUser || !smtpPass) {
      console.warn("[Thread Mill Quote] SMTP credentials not configured — quote logged to console only.");
      return res.status(200).json({ ok: true, note: "Quote received. Email delivery pending SMTP configuration." });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "scott@corecutterusa.com"}>`,
        to,
        replyTo: customer.email,
        subject: subjectLine,
        text: textBody,
      });

      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error("[Thread Mill Quote] Email send failed:", err?.message);
      return res.status(500).json({ message: "Quote logged but email delivery failed. We'll follow up." });
    }
  });

  // ── Email Results (lead capture) ─────────────────────────────────────────
  app.post("/api/results/email", async (req, res) => {
    try {
      const { email, operation, material, machine_name, results_text } = (req.body ?? {}) as {
        email?: string; operation?: string; material?: string;
        machine_name?: string; results_text?: string;
      };

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email address required." });
      }

      // Store lead in DB regardless of email delivery
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "";
      const geo = await geoFromIp(clientIp);
      try {
        const { pool } = await import("./db");
        await pool.query(
          `INSERT INTO leads (email, operation, material, machine_name, results_text, ip, city, region, country, postal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [email.toLowerCase().trim(), operation ?? null, material ?? null, machine_name ?? null, results_text ?? null,
           clientIp, geo.city, geo.region, geo.country, geo.postal]
        );
      } catch (dbErr: any) {
        console.warn("[Results Email] DB insert failed:", dbErr?.message);
      }

      // Internal staff get the results email but skip the sales lead notification
      const isStaff = typeof email === "string" && (email.endsWith("@corecutterusa.com") || email.endsWith("@corecutter.com"));

      const smtpUser = process.env.SMTP_USER || "";
      const smtpPass = process.env.SMTP_PASS || "";
      const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
      const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);

      if (!smtpUser || !smtpPass) {
        console.log("[Results Email] Lead captured (SMTP not configured):", email, operation, material);
        return res.json({ ok: true });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost, port: smtpPort, secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      // Send results to user (including internal staff)
      await transporter.sendMail({
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "scott@corecutterusa.com"}>`,
        to: email,
        subject: "Your Core Cutter Speeds & Feeds Results",
        text: [
          "Here are your machining parameters from the Core Cutter Machining App.",
          "",
          results_text ?? "(no results attached)",
          "",
          "─────────────────────────────────────",
          "Questions? Contact us at sales@corecutterusa.com",
          "corecutcnc.com",
        ].join("\n"),
      }).catch((e: any) => console.warn("[Results Email] User email failed:", e?.message));

      // Per-query sales notification removed — registration emails handle new user alerts
      // (also skip for internal staff — they're testing, not leads)
      if (isStaff) return res.json({ ok: true });

      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[Results Email]", err?.message);
      return res.status(500).json({ error: "Failed to process request." });
    }
  });

  // ── Disposable / throwaway email domain blocklist ────────────────────────
  const DISPOSABLE_DOMAINS = new Set([
    "mailinator.com","guerrillamail.com","guerrillamail.net","guerrillamail.org",
    "guerrillamail.biz","guerrillamail.de","guerrillamail.info","grr.la","spam4.me",
    "tempmail.com","temp-mail.org","temp-mail.io","tempinbox.com","throwam.com",
    "throwaway.email","trashmail.com","trashmail.me","trashmail.net","trashmail.org",
    "trashmail.at","trashmail.io","trashmail.xyz","dispostable.com","discard.email",
    "yopmail.com","yopmail.fr","cool.fr.nf","jetable.fr.nf","nospam.ze.tc",
    "nomail.xl.cx","mega.zik.dj","speed.1s.fr","courriel.fr.nf","moncourrier.fr.nf",
    "monemail.fr.nf","monmail.fr.nf","sharklasers.com","guerrillamailblock.com",
    "spam.la","spamfree24.org","spamgourmet.com","spamgourmet.net","spamgourmet.org",
    "spamgourmet.me","maildrop.cc","mailnull.com","mailnesia.com","mailnew.com",
    "mailscrap.com","mailsiphon.com","mailtemp.info","mailzilla.com","mailzilla.org",
    "fakeinbox.com","fakeinbox.net","fakemail.fr","fakemail.net","fakemailgenerator.com",
    "filzmail.com","fizmail.com","fleckens.hu","frapmail.com","gawab.com","get1mail.com",
    "getairmail.com","getmails.eu","getonemail.net","goemailgo.com","gotmail.net",
    "gotmail.org","grangmi.com","greensloth.com","hailmail.net","hatespam.org",
    "herp.in","hidemail.de","hidzz.com","hmamail.com","hopemail.biz","hulapla.de",
    "ieatspam.eu","ieatspam.info","ihateyoualot.info","iheartspam.org","imails.info",
    "inboxclean.com","inboxclean.org","inoutmail.de","inoutmail.eu","inoutmail.info",
    "inoutmail.net","jetable.com","jetable.net","jetable.org","jetable.pp.ua",
    "jnxjn.com","jourrapide.com","jsrsolutions.com","kasmail.com","kaspop.com",
    "killmail.com","killmail.net","klzlk.com","koszmail.pl","kurzepost.de",
    "letthemeatspam.com","lhsdv.com","ligsb.com","linkingsky.com","litedrop.com",
    "lol.ovpn.to","lolfreak.net","lookugly.com","lortemail.dk","losemymail.com",
    "lroid.com","lukop.dk","m21.cc","mail-filter.com","mail-temporaire.fr",
    "mail.by","mail.mezimages.net","mail2rss.org","mail333.com","mailbidon.com",
    "mailbiz.biz","mailblocks.com","mailbucket.org","mailcat.biz","mailcatch.com",
    "mailde.de","mailde.info","maildo.de","maileater.com","mailed.ro","mailexpire.com",
    "mailfa.tk","mailforspam.com","mailfreeonline.com","mailguard.me","mailhazard.com",
    "mailhz.me","mailimate.com","mailin8r.com","mailinater.com","mailismagic.com",
    "mailme.ir","mailme.lv","mailme24.com","mailmetrash.com","mailmoat.com",
    "mailms.com","mailnew.com","mailnull.com","mailpick.biz","mailproxsy.com",
    "mailquack.com","mailrock.biz","mailseal.de","mailshell.com","mailshuttle.com",
    "mailslapping.com","mailslite.com","mailsuck.com","mailtemp.net","mailtome.de",
    "mailtothis.com","mailtrash.net","mailtv.net","mailvirgule.com","mailwithyou.com",
    "mailworks.org","mailzy.com","mbx.cc","mega.zik.dj","meltmail.com","mierdamail.com",
    "mintemail.com","moncourrier.fr.nf","monemail.fr.nf","monmail.fr.nf","msa.minsmail.com",
    "mt2009.com","mt2014.com","mx0.wwwnew.eu","my10minutemail.com","mypartyclip.de",
    "myphantomemail.com","mysamp.de","mytempemail.com","mytrashmail.com","nabuma.com",
    "netmails.com","netmails.net","neverbox.com","nincsmail.hu","nnh.com","no-spam.ws",
    "nobulk.com","noclickemail.com","nodezine.com","nogmailspam.info","nomail.pw",
    "nomail.xl.cx","nomail2me.com","nomorespamemails.com","nonspam.eu","nonspammer.de",
    "noref.in","nospam.ze.tc","nospamfor.us","nospammail.net","nospamthanks.info",
    "notmailinator.com","nowmymail.com","nwldx.com","objectmail.com","obobbo.com",
    "odnorazovoe.ru","oneoffemail.com","onewaymail.com","onlatedotcom.info","online.ms",
    "oopi.org","opayq.com","ordinaryamerican.net","otherinbox.comsafe-mail.net",
    "owlpic.com","pancakemail.com","pjjkp.com","plexolan.de","pookmail.com",
    "proxymail.eu","prtnx.com","punkass.com","putthisinyourspamdatabase.com",
    "pwrby.com","quickinbox.com","rcpt.at","recode.me","recursor.net","recyclemail.dk",
    "regbypass.com","regbypass.comsafe-mail.net","rejectmail.com","rklips.com",
    "rmqkr.net","rocketmail.com","rppkn.com","rtrtr.com","s0ny.net","safe-mail.net",
    "safetymail.info","safetypost.de","sandelf.de","saynotospams.com","selfdestructingmail.com",
    "sendspamhere.com","sharklasers.com","shieldemail.com","shiftmail.com","shitmail.me",
    "shitmail.org","shortmail.net","sibmail.com","sinnlos-mail.de","slapsfromlastnight.com",
    "slaskpost.se","slippery.email","slowslow.de","smail.com","smashmail.de","smellfear.com",
    "snakemail.com","sneakemail.com","sneakmail.de","snkmail.com","sofimail.com",
    "sofort-mail.de","sogetthis.com","soodonims.com","spam.su","spamavert.com",
    "spambob.com","spambob.net","spambob.org","spambog.com","spambog.de","spambog.ru",
    "spambox.info","spambox.irishspringrealty.com","spambox.us","spamcannon.com",
    "spamcannon.net","spamcero.com","spamcon.org","spamcorptastic.com","spamcowboy.com",
    "spamcowboy.net","spamcowboy.org","spamday.com","spamex.com","spamfree.eu",
    "spamfree24.de","spamfree24.eu","spamfree24.info","spamfree24.net","spamfree24.org",
    "spamgoes.in","spamgourmet.com","spamgourmet.net","spamgourmet.org","spamherelots.com",
    "spamhereplease.com","spamhole.com","spamify.com","spaminator.de","spamkill.info",
    "spaml.com","spaml.de","spammotel.com","spammy.host","spamoff.de","spamslicer.com",
    "spamspot.com","spamthis.co.uk","spamthisplease.com","spamtrail.com","spamtroll.net",
    "speed.1s.fr","spoofmail.de","squizzy.de","sry.li","ssoia.com","startfu.com",
    "stinkefinger.net","stopspam.org","stuffmail.de","super-auswahl.de","supergreatmail.com",
    "supermailer.jp","superrito.com","superstachel.de","suremail.info","svk.jp",
    "sweetxxx.de","tafmail.com","tagyourself.com","talkinator.com","techemail.com",
    "tempalias.com","tempe-mail.com","tempemail.biz","tempemail.com","tempemail.net",
    "tempemail.org","tempinbox.co.uk","tempinbox.com","tempmail.de","tempmail.eu",
    "tempmail.it","tempmail2.com","tempmaildemo.com","tempmailer.com","tempmailer.de",
    "tempomail.fr","temporaryemail.net","temporaryemail.us","temporaryforwarding.com",
    "temporaryinbox.com","temporarymail.org","tempsky.com","tempthe.net","tempymail.com",
    "thanksnospam.info","thecloudindex.com","thelimestones.com","thisisnotmyrealemail.com",
    "thismail.net","thisurl.website","throwam.com","throwaway.email","throwam.com",
    "tilien.com","tittbit.in","tizi.com","tmailinator.com","toiea.com","tradermail.info",
    "trash-amil.com","trash-mail.at","trash-mail.com","trash-mail.de","trash-mail.ga",
    "trash-mail.io","trash-mail.me","trash-mail.net","trash-me.com","trashemail.de",
    "trashimail.de","trashinbox.com","trashmail.app","trashmail.at","trashmail.com",
    "trashmail.io","trashmail.me","trashmail.net","trashmail.org","trashmail.xyz",
    "trashmailer.com","trashme.de","trashspot.de","trashymail.com","trillianpro.com",
    "trmailbox.com","tropicalbass.info","trq.pl","turual.com","twinmail.de",
    "tyldd.com","uggsrock.com","umail.net","uroid.com","username.e4ward.com",
    "venompen.com","veryrealemail.com","viditag.com","viewcastmedia.com","viewcastmedia.net",
    "viewcastmedia.org","vkcode.ru","vomoto.com","vpn.st","vsimcard.com","vubby.com",
    "w3internet.co.uk","walala.org","walkmail.net","walkmail.ru","webemail.me",
    "webm4il.info","wegwerfadresse.de","wegwerf-email.de","wegwerfmail.de","wegwerfmail.net",
    "wegwerfmail.org","wh4f.org","whyspam.me","willhackforfood.biz","willselfdestruct.com",
    "winemaven.info","wronghead.com","wuzupmail.net","www.e4ward.com","www.gishpuppy.com",
    "www.mailinator.com","wwwnew.eu","x.ip6.li","xagloo.com","xemaps.com","xents.com",
    "xmaily.com","xoxy.net","xyzfree.net","yapped.net","yeah.net","yep.it",
    "yogamaven.com","yomail.info","yopmail.com","yopmail.fr","yourdomain.com",
    "ypmail.webarnak.fr.eu.org","yuurok.com","z1p.biz","za.com","zebins.com",
    "zebins.eu","zehnminuten.de","zeitsenke.de","zetmail.com","zippymail.info",
    "zoemail.com","zoemail.net","zoemail.org","zomg.info",
  ]);

  // ── Email MX validation helper ────────────────────────────────────────────
  async function hasMxRecord(email: string): Promise<boolean> {
    const domain = (email.split("@")[1] || "").toLowerCase();
    if (!domain) return false;
    // Always pass internal/admin domains
    if (domain === "corecutterusa.com" || domain === "corecutter.com") return true;
    try {
      const { resolveMx } = await import("dns/promises");
      const records = await resolveMx(domain);
      return records.length > 0;
    } catch {
      // DNS lookup failed (timeout, NXDOMAIN, no MX records) — fail open
      return true;
    }
  }

  // ── Email MX validation endpoint ──────────────────────────────────────────
  app.post("/api/validate-email", async (req, res) => {
    const { email } = req.body ?? {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ valid: false, error: "Invalid email format." });
    }
    const domain = (email.split("@")[1] || "").toLowerCase();
    if (DISPOSABLE_DOMAINS.has(domain)) {
      return res.json({ valid: false, error: "Please use your real work or personal email — disposable addresses aren't accepted." });
    }
    const valid = await hasMxRecord(email);
    if (!valid) {
      return res.json({ valid: false, error: "That email domain doesn't appear to be valid — please use your real work or personal email." });
    }
    return res.json({ valid: true });
  });

  // ── Welcome modal registration (geo capture, no email sent) ──────────────
  app.post("/api/register", async (req, res) => {
    try {
      const { name, email, company, zip } = (req.body ?? {}) as { name?: string; email?: string; company?: string; zip?: string };
      const firstName = name ? name.trim().split(/\s+/)[0] : null;
      const lastName = name ? name.trim().split(/\s+/).slice(1).join(" ") || null : null;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email required" });
      }
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "";
      const geo = await geoFromIp(clientIp);
      const { pool } = await import("./db");
      const isNew = await pool.query(
        `INSERT INTO leads (email, operation, name, first_name, last_name, company, zip, ip, city, region, country, postal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (email) DO UPDATE SET
           name       = COALESCE(EXCLUDED.name, leads.name),
           first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
           last_name  = COALESCE(EXCLUDED.last_name, leads.last_name),
           company    = COALESCE(EXCLUDED.company, leads.company),
           zip        = COALESCE(EXCLUDED.zip, leads.zip)
         RETURNING id, (xmax = 0) AS is_new`,
        [email.toLowerCase().trim(), "tool_request", name ?? null, firstName, lastName, company ?? null, zip ?? null, clientIp, geo.city, geo.region, geo.country, geo.postal]
      );
      // Send registration notification to Scott for new users only (not duplicates)
      const isNewRow = isNew.rows[0]?.is_new === true;
      if (isNewRow) {
        const newId = isNew.rows[0]?.id;
        const smtpUser = process.env.SMTP_USER || "";
        const smtpPass = process.env.SMTP_PASS || "";
        if (!smtpUser || !smtpPass) {
          console.warn(`[Register] *** SMTP NOT CONFIGURED — new registration NOT emailed: ${name ?? "—"} <${email}> from ${[geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "Unknown"} (leads.id=${newId})`);
        } else {
          try {
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
              port: parseInt(process.env.SMTP_PORT || "587", 10),
              secure: parseInt(process.env.SMTP_PORT || "587", 10) === 465,
              auth: { user: smtpUser, pass: smtpPass },
            });
            await transporter.sendMail({
              from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "scott@corecutterusa.com"}>`,
              to: "scott@corecutterusa.com",
              subject: `New App Registration — ${name ?? email}`,
              headers: { "X-Mailin-no-track": "1" },
              text: [
                `Name:     ${name ?? "—"}`,
                `Email:    ${email}`,
                `Company:  ${company ?? "—"}`,
                `Zip:      ${zip ?? "—"}`,
                `Location: ${[geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "Unknown"}`,
                ``,
                `— CoreCutCNC App`,
              ].join("\n"),
            });
            // Mark as notified so we can audit gaps
            if (newId) {
              await pool.query(`UPDATE leads SET notified_at = NOW() WHERE id = $1`, [newId]);
            }
          } catch (mailErr: any) {
            console.warn(`[Register] *** EMAIL SEND FAILED for new registration: ${name ?? "—"} <${email}> (leads.id=${newId}) — ${mailErr?.message}`);
          }
        }
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.warn("[Register]", err?.message);
      res.json({ ok: true }); // never block the user
    }
  });

  // ── Admin: registrations that were never emailed to Scott ────────────────
  app.get("/api/admin/missed-registrations", async (req, res) => {
    try {
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT id, name, email, city, region, country, created_at
         FROM leads
         WHERE operation = 'tool_request'
           AND notified_at IS NULL
         ORDER BY created_at DESC`
      );
      res.json({ count: result.rowCount, rows: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Tool Request Contact ──────────────────────────────────────────────────
  app.post("/api/contact/tool-request", async (req, res) => {
    try {
      const { name, email, message } = (req.body ?? {}) as { name?: string; email?: string; message?: string };
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email address required." });
      }

      // Store as lead
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "";
      const geo = await geoFromIp(clientIp);
      try {
        const { pool } = await import("./db");
        await pool.query(
          `INSERT INTO leads (email, operation, material, machine_name, results_text, name, ip, city, region, country, postal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [email.toLowerCase().trim(), "tool_request", null, null, `Name: ${name ?? "—"}\n\n${message ?? ""}`.trim(), name ?? null, clientIp, geo.city, geo.region, geo.country, geo.postal]
        );
      } catch (dbErr: any) {
        console.warn("[Tool Request] DB insert failed:", dbErr?.message);
      }

      const to = process.env.TOOL_REQUEST_EMAIL || "scott@corecutterusa.com";
      const smtpUser = process.env.SMTP_USER || "";
      const smtpPass = process.env.SMTP_PASS || "";
      const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
      const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);

      console.log("[Tool Request]", { name, email, message });

      if (!smtpUser || !smtpPass) {
        return res.json({ ok: true });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost, port: smtpPort, secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "scott@corecutterusa.com"}>`,
        to,
        replyTo: email,
        subject: `Tool Request — ${name ?? email}`,
        text: [`Name:    ${name ?? "—"}`, `Email:   ${email}`, ``, message ?? "(no message)", ``, `Submitted via CoreCutCNC Tool Finder`].join("\n"),
      }).catch((e: any) => console.warn("[Tool Request] Email failed:", e?.message));

      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[Tool Request]", err?.message);
      return res.status(500).json({ error: "Failed to send request." });
    }
  });

  // ── Beta Feedback Form ───────────────────────────────────────────────────
  app.post("/api/feedback", async (req, res) => {
    try {
      const { type, message, email, screenshot, screenshotName } = (req.body ?? {}) as { type?: string; message?: string; email?: string; screenshot?: string; screenshotName?: string };
      if (!message?.trim()) return res.status(400).json({ error: "Message required." });

      const smtpUser = process.env.SMTP_USER || "";
      const smtpPass = process.env.SMTP_PASS || "";
      const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
      const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);

      // Store in DB
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "";
      const geo = await geoFromIp(clientIp);
      try {
        const { pool } = await import("./db");
        await pool.query(
          `INSERT INTO leads (email, operation, material, machine_name, results_text, ip, city, region, country, postal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [(email || "anonymous").toLowerCase().trim(), "feedback", null, type || "Other", message.trim(), clientIp, geo.city, geo.region, geo.country, geo.postal]
        );
      } catch (dbErr: any) {
        console.warn("[Feedback] DB insert failed:", dbErr?.message);
      }

      if (smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost, port: smtpPort, secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });
        const screenshotHtml = screenshot
          ? `<br><br><strong>Screenshot:</strong><br><img src="${screenshot}" style="max-width:600px;border:1px solid #444;border-radius:4px;" alt="${screenshotName || 'screenshot'}"/>`
          : "";
        await transporter.sendMail({
          from: `"CoreCutCNC Feedback" <${smtpUser}>`,
          to: "scott@corecutterusa.com",
          subject: `[${type || "Feedback"}] CoreCutCNC — ${email || "anonymous"}`,
          html: `<p><strong>Type:</strong> ${type || "—"}</p><p><strong>From:</strong> ${email || "anonymous"}</p><p><strong>Message:</strong></p><p style="white-space:pre-wrap">${message.trim()}</p>${screenshotHtml}`,
        });
      }

      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: "Failed to send feedback." });
    }
  });

  // ── STEP File Request ────────────────────────────────────────────────────
  app.post("/api/step-request", async (req, res) => {
    try {
      const { email, tool_number } = (req.body ?? {}) as { email?: string; tool_number?: string };
      if (!email?.trim()) return res.status(400).json({ error: "Email required." });

      // Log to leads table
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "";
      const geo = await geoFromIp(clientIp);
      try {
        const { pool } = await import("./db");
        await pool.query(
          `INSERT INTO leads (email, operation, material, machine_name, results_text, ip, city, region, country, postal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [email.toLowerCase().trim(), "step_request", null, tool_number?.trim() || null, "STEP file request", clientIp, geo.city, geo.region, geo.country, geo.postal]
        );
      } catch (dbErr: any) {
        console.warn("[StepRequest] DB insert failed:", dbErr?.message);
      }

      // Email notification
      const smtpUser = process.env.SMTP_USER || "";
      const smtpPass = process.env.SMTP_PASS || "";
      const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
      const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
      if (smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost, port: smtpPort, secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });
        await transporter.sendMail({
          from: `"CoreCutCNC" <${smtpUser}>`,
          to: "scott@corecutterusa.com",
          subject: `STEP file request — ${tool_number || "unknown tool"}`,
          text: `STEP file requested by: ${email}\nTool number: ${tool_number || "not specified"}\n\nSend the .STEP file to: ${email}`,
        });
      }

      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: "Failed to submit request." });
    }
  });

  // ── Beta Feedback / Newsletter Signup ────────────────────────────────────
  app.post("/api/newsletter-signup", async (req, res) => {
    try {
      const { email } = (req.body ?? {}) as { email?: string };
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email required." });
      }

      // Store in DB leads table
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "";
      const geo = await geoFromIp(clientIp);
      try {
        const { pool } = await import("./db");
        await pool.query(
          `INSERT INTO leads (email, operation, material, machine_name, results_text, ip, city, region, country) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [email.toLowerCase().trim(), "newsletter_signup", null, null, "Beta feedback nudge", clientIp, geo.city, geo.region, geo.country, geo.postal]
        );
      } catch (dbErr: any) {
        console.warn("[Newsletter] DB insert failed:", dbErr?.message);
      }

      // Add to Brevo contacts via REST API
      const apiKey = process.env.BREVO_API_KEY;
      if (apiKey) {
        try {
          await fetch("https://api.brevo.com/v3/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": apiKey },
            body: JSON.stringify({ email: email.toLowerCase().trim(), updateEnabled: true, attributes: { SOURCE: "beta_nudge" } }),
          });
        } catch (e: any) {
          console.warn("[Newsletter] Brevo API failed:", e?.message);
        }
      }

      // Notify scott
      try {
        const smtpUser = process.env.SMTP_USER || "";
        const smtpPass = process.env.SMTP_PASS || "";
        const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
        const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
        if (smtpUser && smtpPass) {
          const transporter = nodemailer.createTransport({
            host: smtpHost, port: smtpPort, secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass },
          });
          await transporter.sendMail({
            from: `"CoreCutCNC" <${smtpUser}>`,
            to: "scott@corecutterusa.com",
            subject: "New beta signup — CoreCutCNC",
            text: `New email signup from the beta feedback nudge:\n\n${email}`,
          });
        }
      } catch (e: any) {
        console.warn("[Newsletter] Notification email failed:", e?.message);
      }

      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: "Signup failed." });
    }
  });

  // ── ROI Comparison ────────────────────────────────────────────────────────
  app.post("/api/roi", async (req, res) => {
    try {
      const {
        action, roiSessionId,
        userEmail, userName, userType,
        repId, repName,
        distributorName, distributorCode,
        endUserName, endUserEmail, endUserCompany,
        company, phone,
        material, hardness, operation, toolDia, feedIpm, machineName,
        ccEdp, ccToolPrice, ccPartsPer, ccTimeInCut, ccMrr,
        ccNumFlutes, ccLoc, ccOal, ccCoating, ccCornerType,
        ccSfm, ccRpms, ccIpt, ccRadialDoc, ccAxialDoc, ccCycleTime, ccToolLifeMinutes,
        compEdp, compBrand, compPrice, compPartsPer, compTimeInCut, compMrr,
        compNumFlutes, compLoc, compOal, compCoating, compCornerType,
        compSfm, compRpms, compIpt, compRadialDoc, compAxialDoc, compCycleTime, compToolLifeMinutes,
        shopRate, annualVolume, lifeMode,
        savingsPerPart, monthlySavings, annualSavings, savingsPct, mrrGainPct,
        mrrTimeSavingsPerPart, matVolPerPart, breakevenN,
        reconGrinds, reconSavingsPerPart, oneTimeSavings, roiName,
      } = (req.body ?? {}) as {
        action?: string;
        roiSessionId?: string;
        userEmail?: string; userName?: string; userType?: string;
        repId?: string; repName?: string;
        distributorName?: string; distributorCode?: string;
        endUserName?: string; endUserEmail?: string; endUserCompany?: string;
        company?: string; phone?: string;
        material?: string; hardness?: string; operation?: string;
        toolDia?: number; feedIpm?: number; machineName?: string;
        // CC tool
        ccEdp?: string; ccToolPrice?: number; ccPartsPer?: number; ccTimeInCut?: number; ccMrr?: number;
        ccNumFlutes?: number; ccLoc?: number; ccOal?: number; ccCoating?: string; ccCornerType?: string;
        ccSfm?: number; ccRpms?: number; ccIpt?: number; ccRadialDoc?: number; ccAxialDoc?: number;
        ccCycleTime?: number; ccToolLifeMinutes?: number;
        // Comp tool
        compEdp?: string; compBrand?: string; compPrice?: number; compPartsPer?: number; compTimeInCut?: number; compMrr?: number;
        compNumFlutes?: number; compLoc?: number; compOal?: number; compCoating?: string; compCornerType?: string;
        compSfm?: number; compRpms?: number; compIpt?: number; compRadialDoc?: number; compAxialDoc?: number;
        compCycleTime?: number; compToolLifeMinutes?: number;
        // ROI results
        shopRate?: number; annualVolume?: number; lifeMode?: string;
        savingsPerPart?: number; monthlySavings?: number; annualSavings?: number; savingsPct?: number; mrrGainPct?: number;
        mrrTimeSavingsPerPart?: number; matVolPerPart?: number; breakevenN?: number | null;
        reconGrinds?: number; reconSavingsPerPart?: number; oneTimeSavings?: number; roiName?: string;
      };

      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "";
      const geo = await geoFromIp(clientIp);

      // Upsert into DB — one row per roi_session_id (name-scoped, new name = new row)
      try {
        const { pool } = await import("./db");
        const isEmail = action === "email";
        await pool.query(
          `INSERT INTO roi_comparisons (
            roi_session_id,
            user_email, user_name, user_type,
            rep_id, rep_name,
            distributor_name, distributor_code,
            end_user_name, end_user_email, end_user_company,
            company, phone, material, hardness, operation,
            tool_dia, feed_ipm, machine_name,
            cc_edp, cc_tool_price, cc_parts_per_tool, cc_time_in_cut, cc_mrr,
            cc_num_flutes, cc_length_of_cut, cc_overall_length, cc_coating, cc_corner_type,
            cc_sfm, cc_rpms, cc_ipt, cc_radial_doc, cc_axial_doc, cc_cycle_time, cc_tool_life_minutes,
            comp_edp, comp_brand, comp_price, comp_parts_per_tool, comp_time_in_cut, comp_mrr,
            comp_num_flutes, comp_length_of_cut, comp_overall_length, comp_coating, comp_corner_type,
            comp_sfm, comp_rpms, comp_ipt, comp_radial_doc, comp_axial_doc, comp_cycle_time, comp_tool_life_minutes,
            shop_rate, annual_volume, monthly_volume, life_mode,
            savings_per_part, monthly_savings, annual_savings, savings_pct, mrr_gain_pct,
            mrr_time_savings_per_part, mat_vol_per_part, breakeven_n,
            recon_grinds, recon_savings_per_part, one_time_savings,
            roi_name,
            city, region, country, ip, updated_at,
            emailed_at
          ) VALUES (
            $1,
            $2,$3,$4,
            $5,$6,
            $7,$8,
            $9,$10,$11,
            $12,$13,$14,$15,$16,
            $17,$18,$19,
            $20,$21,$22,$23,$24,
            $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,
            $37,$38,$39,$40,$41,$42,
            $43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,
            $55,$56,$56,$57,
            $58,$59,$60,$61,$62,
            $63,$64,$65,
            $66,$67,$68,
            $69,
            $70,$71,$72,$73,now(),
            ${isEmail ? "now()" : "NULL"})
          ON CONFLICT (roi_session_id)
          WHERE roi_session_id IS NOT NULL
          DO UPDATE SET
            user_name = EXCLUDED.user_name,
            user_type = EXCLUDED.user_type,
            rep_id = EXCLUDED.rep_id,
            rep_name = EXCLUDED.rep_name,
            distributor_name = EXCLUDED.distributor_name,
            distributor_code = EXCLUDED.distributor_code,
            end_user_name = EXCLUDED.end_user_name,
            end_user_email = EXCLUDED.end_user_email,
            end_user_company = EXCLUDED.end_user_company,
            company = EXCLUDED.company,
            phone = EXCLUDED.phone,
            hardness = EXCLUDED.hardness,
            operation = EXCLUDED.operation,
            tool_dia = EXCLUDED.tool_dia,
            feed_ipm = EXCLUDED.feed_ipm,
            machine_name = EXCLUDED.machine_name,
            cc_tool_price = EXCLUDED.cc_tool_price,
            cc_parts_per_tool = EXCLUDED.cc_parts_per_tool,
            cc_time_in_cut = EXCLUDED.cc_time_in_cut,
            cc_mrr = EXCLUDED.cc_mrr,
            cc_num_flutes = EXCLUDED.cc_num_flutes,
            cc_length_of_cut = EXCLUDED.cc_length_of_cut,
            cc_overall_length = EXCLUDED.cc_overall_length,
            cc_coating = EXCLUDED.cc_coating,
            cc_corner_type = EXCLUDED.cc_corner_type,
            cc_sfm = EXCLUDED.cc_sfm,
            cc_rpms = EXCLUDED.cc_rpms,
            cc_ipt = EXCLUDED.cc_ipt,
            cc_radial_doc = EXCLUDED.cc_radial_doc,
            cc_axial_doc = EXCLUDED.cc_axial_doc,
            cc_cycle_time = EXCLUDED.cc_cycle_time,
            cc_tool_life_minutes = EXCLUDED.cc_tool_life_minutes,
            comp_edp = EXCLUDED.comp_edp,
            comp_brand = EXCLUDED.comp_brand,
            comp_price = EXCLUDED.comp_price,
            comp_parts_per_tool = EXCLUDED.comp_parts_per_tool,
            comp_time_in_cut = EXCLUDED.comp_time_in_cut,
            comp_mrr = EXCLUDED.comp_mrr,
            comp_num_flutes = EXCLUDED.comp_num_flutes,
            comp_length_of_cut = EXCLUDED.comp_length_of_cut,
            comp_overall_length = EXCLUDED.comp_overall_length,
            comp_coating = EXCLUDED.comp_coating,
            comp_corner_type = EXCLUDED.comp_corner_type,
            comp_sfm = EXCLUDED.comp_sfm,
            comp_rpms = EXCLUDED.comp_rpms,
            comp_ipt = EXCLUDED.comp_ipt,
            comp_radial_doc = EXCLUDED.comp_radial_doc,
            comp_axial_doc = EXCLUDED.comp_axial_doc,
            comp_cycle_time = EXCLUDED.comp_cycle_time,
            comp_tool_life_minutes = EXCLUDED.comp_tool_life_minutes,
            shop_rate = EXCLUDED.shop_rate,
            annual_volume = EXCLUDED.annual_volume,
            monthly_volume = EXCLUDED.annual_volume,
            life_mode = EXCLUDED.life_mode,
            savings_per_part = EXCLUDED.savings_per_part,
            monthly_savings = EXCLUDED.monthly_savings,
            annual_savings = EXCLUDED.annual_savings,
            savings_pct = EXCLUDED.savings_pct,
            mrr_gain_pct = EXCLUDED.mrr_gain_pct,
            mrr_time_savings_per_part = EXCLUDED.mrr_time_savings_per_part,
            mat_vol_per_part = EXCLUDED.mat_vol_per_part,
            breakeven_n = EXCLUDED.breakeven_n,
            recon_grinds = EXCLUDED.recon_grinds,
            recon_savings_per_part = EXCLUDED.recon_savings_per_part,
            one_time_savings = EXCLUDED.one_time_savings,
            roi_name = EXCLUDED.roi_name,
            city = EXCLUDED.city,
            region = EXCLUDED.region,
            country = EXCLUDED.country,
            ip = EXCLUDED.ip,
            updated_at = now(),
            synced_to_sales_app = FALSE
            ${isEmail ? ", emailed_at = COALESCE(roi_comparisons.emailed_at, now())" : ""}`,
          [
            // $1: session
            roiSessionId || null,
            // $2–$19: user + context
            userEmail || null, userName || null, userType || null,
            repId || null, repName || null,
            distributorName || null, distributorCode || null,
            endUserName || null, endUserEmail || null, endUserCompany || null,
            company || null, phone || null, material || null, hardness || null, operation || null,
            toolDia ?? null, feedIpm ?? null, machineName || null,
            // $16–$32: CC tool
            ccEdp || null, ccToolPrice ?? null, ccPartsPer ?? null, ccTimeInCut ?? null, ccMrr ?? null,
            ccNumFlutes ?? null, ccLoc ?? null, ccOal ?? null, ccCoating || null, ccCornerType || null,
            ccSfm ?? null, ccRpms ?? null, ccIpt ?? null, ccRadialDoc ?? null, ccAxialDoc ?? null,
            ccCycleTime ?? null, ccToolLifeMinutes ?? null,
            // $33–$50: comp tool
            compEdp || null, compBrand || null, compPrice ?? null, compPartsPer ?? null, compTimeInCut ?? null, compMrr ?? null,
            compNumFlutes ?? null, compLoc ?? null, compOal ?? null, compCoating || null, compCornerType || null,
            compSfm ?? null, compRpms ?? null, compIpt ?? null, compRadialDoc ?? null, compAxialDoc ?? null,
            compCycleTime ?? null, compToolLifeMinutes ?? null,
            // $47–$49: volume + life mode
            shopRate ?? null, annualVolume ?? null, lifeMode || null,
            // $50–$60: ROI results
            savingsPerPart ?? null, monthlySavings ?? null, annualSavings ?? null, savingsPct ?? null, mrrGainPct ?? null,
            mrrTimeSavingsPerPart ?? null, matVolPerPart ?? null, breakevenN ?? null,
            reconGrinds ?? null, reconSavingsPerPart ?? null, oneTimeSavings ?? null,
            // $61: roi name
            roiName || null,
            // $62–$65: geo
            geo.city, geo.region, geo.country, clientIp,
          ]
        );
      } catch (dbErr: any) {
        console.warn("[ROI] DB upsert failed:", dbErr?.message);
      }

      // If this is just a calculate save (not email), return early
      if (action !== "email") return res.json({ ok: true });

      // Send email
      const smtpUser = process.env.SMTP_USER || "";
      const smtpPass = process.env.SMTP_PASS || "";
      const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
      const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
      const salesTo = process.env.QUOTE_TO_EMAIL || "sales@corecutterusa.com";

      if (smtpUser && smtpPass && userEmail) {
        const fmtD = (n: number | undefined) => (n != null ? n.toFixed(2) : "—");
        const fmtFour = (n: number | undefined) => (n != null ? n.toFixed(4) : "—");
        const subjectSavings = (savingsPerPart ?? 0) >= 0
          ? `CC Saves $${fmtD(savingsPerPart)}/part`
          : "Competitor Comparison";

        const ccToolCost = (ccToolPrice ?? 0) / (ccPartsPer ?? 1);
        const ccMachineCost = ((ccTimeInCut ?? 0) / 60) * (shopRate ?? 0);
        const ccTotalCost = ccToolCost + ccMachineCost;
        const compToolCost = (compPrice ?? 0) / (compPartsPer ?? 1);
        const compMachineCost = ((compTimeInCut ?? 0) / 60) * (shopRate ?? 0);
        const compTotalCost = compToolCost + compMachineCost;

        const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#111;color:#e5e7eb;margin:0;padding:32px;">
  <div style="max-width:620px;margin:0 auto;background:#1c1c1c;border-radius:12px;overflow:hidden;">
    <div style="background:#ea580c;padding:20px 28px;">
      <h1 style="margin:0;font-size:20px;color:#fff;letter-spacing:-0.3px;">CoreCutCNC ROI Summary</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#fed7aa;">Your machining cost comparison report</p>
    </div>
    <div style="padding:24px 28px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
        <tr>
          <td style="padding:6px 10px;color:#9ca3af;width:40%;">Material</td>
          <td style="padding:6px 10px;color:#f3f4f6;">${material || "—"}</td>
        </tr>
        <tr style="background:#262626;">
          <td style="padding:6px 10px;color:#9ca3af;">Operation</td>
          <td style="padding:6px 10px;color:#f3f4f6;">${operation || "—"}</td>
        </tr>
        <tr>
          <td style="padding:6px 10px;color:#9ca3af;">Tool Diameter</td>
          <td style="padding:6px 10px;color:#f3f4f6;">${fmtFour(toolDia)}"</td>
        </tr>
        ${feedIpm ? `<tr style="background:#262626;"><td style="padding:6px 10px;color:#9ca3af;">Feed Rate</td><td style="padding:6px 10px;color:#f3f4f6;">${fmtD(feedIpm)} IPM</td></tr>` : ""}
        ${ccEdp ? `<tr><td style="padding:6px 10px;color:#9ca3af;">CC EDP</td><td style="padding:6px 10px;color:#f3f4f6;">${ccEdp}</td></tr>` : ""}
        ${compEdp ? `<tr style="background:#262626;"><td style="padding:6px 10px;color:#9ca3af;">Competitor EDP</td><td style="padding:6px 10px;color:#f3f4f6;">${compEdp}</td></tr>` : ""}
        <tr>
          <td style="padding:6px 10px;color:#9ca3af;">Shop Rate</td>
          <td style="padding:6px 10px;color:#f3f4f6;">$${fmtD(shopRate)}/hr</td>
        </tr>
        <tr style="background:#262626;">
          <td style="padding:6px 10px;color:#9ca3af;">Annual Volume</td>
          <td style="padding:6px 10px;color:#f3f4f6;">${annualVolume ?? "—"} parts</td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
        <thead>
          <tr>
            <th style="padding:10px 12px;text-align:left;background:#1a1a1a;color:#9ca3af;font-weight:500;border-bottom:2px solid #333;"></th>
            <th style="padding:10px 12px;text-align:left;background:#ea580c;color:#fff;font-weight:600;">Core Cutter</th>
            <th style="padding:10px 12px;text-align:left;background:#3f3f46;color:#e4e4e7;font-weight:600;">Competitor</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:9px 12px;color:#9ca3af;border-bottom:1px solid #2a2a2a;">Tool Price</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">$${fmtD(ccToolPrice)}</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">$${fmtD(compPrice)}</td>
          </tr>
          <tr style="background:#1f1f1f;">
            <td style="padding:9px 12px;color:#9ca3af;border-bottom:1px solid #2a2a2a;">Parts per Tool</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">${ccPartsPer ?? "—"}</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">${compPartsPer ?? "—"}</td>
          </tr>
          <tr>
            <td style="padding:9px 12px;color:#9ca3af;border-bottom:1px solid #2a2a2a;">Time in Cut (min/part)</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">${ccTimeInCut ?? "—"}</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">${compTimeInCut ?? "—"}</td>
          </tr>
          <tr style="background:#1f1f1f;">
            <td style="padding:9px 12px;color:#9ca3af;border-bottom:1px solid #2a2a2a;">Tool Cost / Part</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">$${fmtD(ccToolCost)}</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">$${fmtD(compToolCost)}</td>
          </tr>
          <tr>
            <td style="padding:9px 12px;color:#9ca3af;border-bottom:1px solid #2a2a2a;">Machine Cost / Part</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">$${fmtD(ccMachineCost)}</td>
            <td style="padding:9px 12px;color:#f3f4f6;border-bottom:1px solid #2a2a2a;">$${fmtD(compMachineCost)}</td>
          </tr>
          <tr style="background:#1a1a1a;">
            <td style="padding:9px 12px;color:#f3f4f6;font-weight:700;border-bottom:1px solid #333;">Total Cost / Part</td>
            <td style="padding:9px 12px;color:#fb923c;font-weight:700;border-bottom:1px solid #333;">$${fmtD(ccTotalCost)}</td>
            <td style="padding:9px 12px;color:#e4e4e7;font-weight:700;border-bottom:1px solid #333;">$${fmtD(compTotalCost)}</td>
          </tr>
        </tbody>
      </table>

      <div style="background:#052e16;border:2px solid #16a34a;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
        <div style="display:flex;gap:20px;flex-wrap:wrap;">
          <div style="flex:1;min-width:120px;">
            <div style="font-size:28px;font-weight:700;color:#4ade80;">$${fmtD(savingsPerPart)}</div>
            <div style="font-size:12px;color:#86efac;">Savings per part</div>
          </div>
          <div style="flex:1;min-width:120px;">
            <div style="font-size:24px;font-weight:700;color:#4ade80;">$${fmtD(monthlySavings)}</div>
            <div style="font-size:12px;color:#86efac;">Monthly savings</div>
          </div>
          <div style="flex:1;min-width:120px;">
            <div style="font-size:24px;font-weight:700;color:#4ade80;">$${fmtD(annualSavings)}</div>
            <div style="font-size:12px;color:#86efac;">Annual savings</div>
          </div>
          <div style="flex:1;min-width:80px;">
            <div style="font-size:24px;font-weight:700;color:#4ade80;">${fmtD(savingsPct)}%</div>
            <div style="font-size:12px;color:#86efac;">Cost reduction</div>
          </div>
        </div>
      </div>

      <p style="font-size:12px;color:#6b7280;margin:0;">Generated by CoreCutCNC — <a href="https://corecutcnc.com" style="color:#ea580c;">corecutcnc.com</a></p>
    </div>
  </div>
</body>
</html>`;

        const transporter = nodemailer.createTransport({
          host: smtpHost, port: smtpPort, secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });
        await transporter.sendMail({
          from: `"CoreCutCNC" <${smtpUser}>`,
          to: userEmail,
          cc: salesTo,
          subject: `Your CoreCutCNC ROI Summary — ${subjectSavings}`,
          html: htmlBody,
        });
      }

      return res.json({ ok: true });
    } catch (e: any) {
      console.error("[ROI] Error:", e?.message);
      return res.status(500).json({ error: "Failed to save ROI comparison." });
    }
  });

  // ── Distributor search — partial name match, never returns full list ─────────
  const DISTRIBUTORS: { name: string; code: string }[] = [
    { name: "A&M Industrial", code: "AMINDUSTRI_4twr" },
    { name: "AFI", code: "AFI_4tvj" },
    { name: "AZ Tools", code: "AZTOOLS_4u46" },
    { name: "American Tools & Metals", code: "AMERICANTO_4txq" },
    { name: "Bald Eagle Tool Supply", code: "BETS" },
    { name: "BlackHawk - O'Fallon (MO)", code: "BLACKHAWKO_4xbd" },
    { name: "BlackHawk - SPX Flow", code: "BLACKHAWKS_4u2m" },
    { name: "BlackHawk Industrial - AXIS", code: "BLACKHAWKI_4tww" },
    { name: "Butler Bros", code: "BUTLERBROS_4tvx" },
    { name: "C&B Supply, Inc.", code: "CBSUPPLYIN_4u1z" },
    { name: "Cline Tool", code: "CLINETOOL_4txf" },
    { name: "DB Industrial Supply", code: "DBINDUSTRI_4tuv" },
    { name: "DGI Supply - IMI Site Spec", code: "DGISUPPLYI_4u1h" },
    { name: "DGI Supply - San Leandro", code: "DGISUPPLYS_4tvq" },
    { name: "DGI Supply - Site Spec APEX", code: "DGISUPPLYS_4u4l" },
    { name: "DXP - Chicago", code: "DXPCHICAGO_4txn" },
    { name: "DXP - Kenneth Crosby - Axis Site Specific", code: "DXPKENNETH_4u26" },
    { name: "DXP-WI", code: "DXPWI_4u3z" },
    { name: "DXP/ASI", code: "DXPASI_4tvz" },
    { name: "Dolen Tool Sales", code: "DOLENTOOLS_4tuk" },
    { name: "Dykehouse Co.", code: "DYKEHOUSEC_4tv4" },
    { name: "Eisenking Products, Inc.", code: "EISENKINGP_4txa" },
    { name: "Element Machine Tools", code: "ELEMENTMAC_NEW" },
    { name: "Everett J. Prescott, Inc.", code: "EVERETTJPR_4xb4" },
    { name: "Ewie Co.", code: "EWIECO_4u2w" },
    { name: "Extreme Tooling, LLC", code: "EXTREMETOO_4u3q" },
    { name: "Fournier & Assoc LLC", code: "FOURNIERAS_4u4q" },
    { name: "Gordon Industrial", code: "GORDONINDU_4two" },
    { name: "Hill Industrial Tools", code: "HILLINDUST_4twf" },
    { name: "ITS - Inactive Account", code: "ITSINACTIV_4xbi" },
    { name: "ITS - Industrial Tooling & Supply", code: "ITSINDUSTR_4tx6" },
    { name: "Iwen Tool Supply Company", code: "IWENTOOLSU_4tw7" },
    { name: "JAC Industrial Tool & Supply", code: "JACINDUSTR_4u10" },
    { name: "JFG Enterprises", code: "JFGENTERPR_4u0g" },
    { name: "Keyline Cutting Tools", code: "KEYLINECUT_4tvc" },
    { name: "LNR Tool & Supply", code: "LNRTOOLSUP_4tx3" },
    { name: "Lloyd Gage & Tool", code: "LLOYDGAGET_4txj" },
    { name: "M&H Supply", code: "MHSUPPLY_4u0p" },
    { name: "Mackintosh Tool Company", code: "MACKINTOSH_4tw3" },
    { name: "Martin Supply", code: "MARTINSUPP_4twk" },
    { name: "Next Industries, Inc.", code: "NEXTINDUST_4u42" },
    { name: "OneSource", code: "ONESOURCE_4u0x" },
    { name: "PM Industrial Supply", code: "PMINDUSTRI_4u2r" },
    { name: "PT Solutions (Chicago)", code: "PTSOLUTION_4u3h" },
    { name: "PT Solutions (Four State)", code: "PTSOLUTION_4u30" },
    { name: "PT Solutions (MI)", code: "PTSOLUTION_4xbp" },
    { name: "PT Solutions (VA)", code: "PTSOLUTION_4xav" },
    { name: "PT Solutions - Site Specific (FM Industries)", code: "PTSOLUTION_4xah" },
    { name: "Production Machine & Tool", code: "PRODUCTION_4u0a" },
    { name: "Quality Tooling Inc.", code: "QUALITYTOO_4u0l" },
    { name: "R.S. Hughes Co., Inc.", code: "RSHUGHESCO_4u0t" },
    { name: "Ramstar Carbide", code: "RAMSTARCAR_NEW" },
    { name: "S&D Industrial Tool Supply", code: "SDINDUSTRI_4u3b" },
    { name: "Shively Bros.", code: "SHIVELYBRO_4u4b" },
    { name: "Spyder Tool", code: "SPYDERTOOL_4u1a" },
    { name: "Techni-Tool Inc.", code: "TECHNITOOL_4u3u" },
    { name: "Tensile Mill CNC", code: "TENSILEMIL_4u1v" },
    { name: "Tip Top Sales", code: "TIPTOPSALE_4u1l" },
    { name: "Tool Technology Distributors Inc.", code: "TOOLTECHNO_4xaq" },
    { name: "US Tool Group - GE Rutland", code: "USTOOLGROU_4u4h" },
    { name: "Valley Tool & Supply Co.", code: "VALLEYTOOL_4twz" },
  ];

  // ── Authorized sales reps — server-side only, never exposed in bulk ─────────
  const SALES_REPS: { id: string; name: string; email: string }[] = [
    { id: "2c7b3424-7467-41dd-bee8-bf65e029b601", name: "Adam Estes",      email: "adam@corecutterusa.com" },
    { id: "a9f0b0d8-e1a1-420b-9847-d8e5683be970", name: "Brian Beachy",    email: "brian@ipstooling.com" },
    { id: "a09ca13c-63c3-4610-a642-d4be1b7c7bca", name: "Bryce Wright",    email: "bryce@cmscustomerservice.com" },
    { id: "6cd48a49-120e-47e7-b5c8-c547a1b3dcfb", name: "Chris Roberts",   email: "chris@cmscustomerservice.com" },
    { id: "9fe57cb9-9fc2-40d6-a24d-735c8455a3d9", name: "Chris Sellers",   email: "chris@motorcityim.com" },
    { id: "4d82e71a-45dd-44a2-b07b-ef599d29552e", name: "Corey Cranford",  email: "cctechforceta@yahoo.com" },
    { id: "3e63b231-0f5f-42c1-9b6a-1017fbf6f041", name: "Dan Schaefer",    email: "iptsfm@yahoo.com" },
    { id: "76199582-bb22-4dca-96e2-8caea2e97241", name: "James Graham",     email: "james@corecutterusa.com" },
    { id: "8f7531ec-8243-4d9d-beaa-c0802f2f7f6f", name: "Jeff Richmond",   email: "jeff@ipstooling.com" },
    { id: "da9f3c02-c0c0-4988-8567-36449fe214ac", name: "Joe Ziegler",      email: "joe@cmscustomerservice.com" },
    { id: "2a727a76-2e4a-43c3-9981-16029b21758c", name: "Kerry Cranford",   email: "kcranford54@yahoo.com" },
    { id: "4928eca4-058a-4e21-b4e2-48e37635acd6", name: "Lindsey Mattson", email: "lindsey@corecutterusa.com" },
    { id: "2326689b-ef3d-4bf2-9eb9-ee165fee3fb8", name: "Rick Woods",      email: "rick.woods.ets@outlook.com" },
    { id: "9d2edf2d-cc59-4e30-90a2-33d9be4da989", name: "Ryan Monahan",    email: "ryan@rpmsales-inc.com" },
    { id: "b5736dbc-0f97-4213-9ba9-cef5baca90e5", name: "Sarah Bean",      email: "sarah@corecutterusa.com" },
    { id: "6426cf0a-2935-4098-985c-a7de074e5542", name: "Scott Tiehen",    email: "scott@corecutterusa.com" },
  ];

  // Returns { authorized: true, name, repId } or { authorized: false }
  app.get("/api/sales-rep/verify", (req, res) => {
    const email = ((req.query.email as string) || "").trim().toLowerCase();
    if (!email) return res.json({ authorized: false });
    const rep = SALES_REPS.find(r => r.email.toLowerCase() === email);
    if (!rep) return res.json({ authorized: false });
    return res.json({ authorized: true, name: rep.name, repId: rep.id });
  });

  app.get("/api/distributors/search", (req, res) => {
    const q = ((req.query.q as string) || "").trim().toLowerCase();
    if (q.length < 2) return res.json([]);
    const matches = DISTRIBUTORS
      .filter(d => d.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map(d => ({ name: d.name, code: d.code }));
    return res.json(matches);
  });

  // Cross-device session recovery: return existing roi_session_id for a rep+name combo
  app.get("/api/roi/session", async (req, res) => {
    try {
      const { email, name } = req.query as { email?: string; name?: string };
      if (!email || !name) return res.json({ sessionId: null });
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT roi_session_id FROM roi_comparisons
         WHERE LOWER(user_email) = LOWER($1) AND LOWER(roi_name) = LOWER($2)
         AND roi_session_id IS NOT NULL
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1`,
        [email, name]
      );
      const sessionId = result.rows[0]?.roi_session_id ?? null;
      return res.json({ sessionId });
    } catch (e: any) {
      console.error("[ROI SESSION] Error:", e?.message);
      return res.status(500).json({ sessionId: null });
    }
  });

  app.get("/api/roi", async (req, res) => {
    try {
      const { email } = req.query as { email?: string };
      if (!email) return res.json([]);
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT * FROM roi_comparisons WHERE LOWER(user_email) = LOWER($1) ORDER BY created_at DESC`,
        [email]
      );
      return res.json(result.rows);
    } catch (e: any) {
      console.error("[ROI GET] Error:", e?.message);
      return res.status(500).json({ error: "Failed to load ROI history." });
    }
  });

  app.delete("/api/roi/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { email } = req.query as { email?: string };
      if (!email) return res.status(400).json({ error: "email required" });
      const { pool } = await import("./db");
      // Only delete rows belonging to the requesting user
      const result = await pool.query(
        `DELETE FROM roi_comparisons WHERE id = $1 AND LOWER(user_email) = LOWER($2)`,
        [id, email]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Not found or not authorized" });
      return res.json({ ok: true });
    } catch (e: any) {
      console.error("[ROI DELETE] Error:", e?.message);
      return res.status(500).json({ error: "Failed to delete ROI." });
    }
  });


  // Seed data — wrapped in try/catch so a Neon cold-start ECONNRESET doesn't crash the server
  let snippets: Awaited<ReturnType<typeof storage.getSnippets>> = [];
  try {
    snippets = await storage.getSnippets();
  } catch (err) {
    console.warn("DB unavailable at startup (seed skipped):", (err as any)?.message ?? err);
  }
  const machiningMentorCode = [
    "import pandas as pd",
    "import os",
    "",
    "# ==========================================================",
    "# USER CONFIG (ONLY EDIT THIS SECTION)",
    "# ==========================================================",
    "",
    'EXCEL_PATH = "attached_assets/sample_upload_-_partial_(250214)_1771098142626.xlsx"',
    "",
    "TEST_CASE = {",
    '    "edp": 205221,',
    '    "material": "4140 32Rc",',
    '    "rpm": 2674,',
    '    "mode_selected": "hem",   # slotting, heavy_peripheral, light_peripheral, finishing, hem',
    '    "woc_pct": 8,             # radial engagement %',
    '    "doc_xd": 3.0             # axial depth in multiples of diameter',
    "}",
    "",
    "# ==========================================================",
    "# SERIES RULES (SCALES TO 4000+ TOOLS)",
    "# ==========================================================",
    "",
    "SERIES_RULES = {",
    '    "VST": {',
    '        "fpt": {',
    '            "slotting": 0.0025,',
    '            "heavy_peripheral": 0.0030,',
    '            "light_peripheral": 0.0035,',
    '            "finishing": 0.0023,',
    '            "hem": 0.0063',
    "        },",
    '        "woc_ranges": {',
    '            "slotting": (75, 100),',
    '            "heavy_peripheral": (35, 74),',
    '            "light_peripheral": (15, 34),',
    '            "finishing": (0, 6),',
    '            "hem": (3, 14)',
    "        },",
    '        "doc_limits_xd": {',
    '            "slotting": 1.0,',
    '            "heavy_peripheral": 2.0,',
    '            "light_peripheral": 2.5,',
    '            "finishing": 1.0,',
    '            "hem": 3.5',
    "        }",
    "    },",
    '    "AL2": { # Added generic rules for AL2/AL3 based on VST for now to avoid crashes',
    '        "fpt": {',
    '            "slotting": 0.0025,',
    '            "heavy_peripheral": 0.0030,',
    '            "light_peripheral": 0.0035,',
    '            "finishing": 0.0023,',
    '            "hem": 0.0063',
    "        },",
    '        "woc_ranges": {',
    '            "slotting": (75, 100),',
    '            "heavy_peripheral": (35, 74),',
    '            "light_peripheral": (15, 34),',
    '            "finishing": (0, 6),',
    '            "hem": (3, 14)',
    "        },",
    '        "doc_limits_xd": {',
    '            "slotting": 1.0,',
    '            "heavy_peripheral": 2.0,',
    '            "light_peripheral": 2.5,',
    '            "finishing": 1.0,',
    '            "hem": 3.5',
    "        }",
    "    },",
    '    "AL3": {',
    '         "fpt": {',
    '            "slotting": 0.0025,',
    '            "heavy_peripheral": 0.0030,',
    '            "light_peripheral": 0.0035,',
    '            "finishing": 0.0023,',
    '            "hem": 0.0063',
    "        },",
    '        "woc_ranges": {',
    '            "slotting": (75, 100),',
    '            "heavy_peripheral": (35, 74),',
    '            "light_peripheral": (15, 34),',
    '            "finishing": (0, 6),',
    '            "hem": (3, 14)',
    "        },",
    '        "doc_limits_xd": {',
    '            "slotting": 1.0,',
    '            "heavy_peripheral": 2.0,',
    '            "light_peripheral": 2.5,',
    '            "finishing": 1.0,',
    '            "hem": 3.5',
    "        }",
    "    }",
    "}",
    "",
    "# ==========================================================",
    "# LOAD TOOL DATA",
    "# ==========================================================",
    "",
    "def load_tool_registry(path):",
    "    if not os.path.exists(path):",
    '        print(f"Error: Excel file not found at {path}")',
    "        return {}",
    "",
    "    try:",
    "        df = pd.read_excel(path)",
    "        # Clean column names",
    "        df.columns = df.columns.str.strip()",
    "        ",
    "        registry = {}",
    "        for _, row in df.iterrows():",
    "            try:",
    "                # Skip rows where EDP might be missing or invalid",
    '                if pd.isna(row["Core_Cutter_EDP"]):',
    "                    continue",
    "                    ",
    '                edp = int(row["Core_Cutter_EDP"])',
    "                registry[edp] = {",
    '                    "series": str(row["CORE_CUTTER_SERIES"]),',
    '                    "diameter": float(row["CUT_DIA"]),',
    '                    "flutes": int(row["FLUTE_COUNT"]),',
    '                    "loc": float(row["LOC"]),',
    '                    "coating": str(row["COATING"]) if not pd.isna(row["COATING"]) else "Uncoated"',
    "                }",
    "            except Exception as e:",
    '                print(f"Skipping row due to error: {e}")',
    "                continue",
    "                ",
    "        return registry",
    "    except Exception as e:",
    '        print(f"Error reading excel file: {e}")',
    "        return {}",
    "",
    "# ==========================================================",
    "# PHYSICS",
    "# ==========================================================",
    "",
    "def calc_feed(rpm, flutes, fpt):",
    "    return rpm * flutes * fpt",
    "",
    "def calc_mrr(woc, doc, feed):",
    "    return woc * doc * feed",
    "",
    "# ==========================================================",
    "# MODE CLASSIFICATION (OPTION 1)",
    "# ==========================================================",
    "",
    "def classify_actual_mode(woc_pct, rules):",
    "    for mode, (low, high) in rules.items():",
    "        if low <= woc_pct <= high:",
    "            return mode",
    '    return "unknown"',
    "",
    "# ==========================================================",
    "# MENTOR LOGIC",
    "# ==========================================================",
    "",
    "def mentor_messages(tool, selected_mode, actual_mode, woc_pct, doc_xd, limits):",
    "    messages = []",
    "",
    "    if selected_mode != actual_mode:",
    "        messages.append(",
    "            f\"This cut behaves like {actual_mode.replace('_',' ')} milling \"",
    "            f\"rather than {selected_mode.replace('_',' ')} based on radial engagement.\"",
    "        )",
    "",
    '    if woc_pct < limits["woc"][0] or woc_pct > limits["woc"][1]:',
    "        messages.append(",
    "            f\"Radial engagement is outside typical {selected_mode.replace('_',' ')} range.\"",
    "        )",
    "",
    '    if doc_xd > limits["doc_xd"]:',
    "        messages.append(",
    '            f"Axial depth exceeds typical limit for this tool and cut style."',
    "        )",
    "",
    '    if tool["flutes"] >= 5 and actual_mode in ["slotting", "heavy_peripheral"]:',
    "        messages.append(",
    '            "Higher flute count increases chip evacuation risk at this engagement."',
    "        )",
    "",
    "    if not messages:",
    "        messages.append(",
    '            "Parameters align well with how this tool series is normally run."',
    "        )",
    "",
    "    return messages",
    "",
    "# ==========================================================",
    "# MAIN EXECUTION",
    "# ==========================================================",
    "",
    "def run_case(cfg):",
    "    tools = load_tool_registry(EXCEL_PATH)",
    "    ",
    "    if not tools:",
    '        print("Registry empty or failed to load.")',
    "        return",
    "",
    '    edp = cfg["edp"]',
    "    if edp not in tools:",
    '        print(f"EDP {edp} not found in registry.")',
    "        return",
    "",
    "    tool = tools[edp]",
    '    series_key = tool["series"][:3]',
    "    # Default to VST if series not found in rules, just for safety in this demo",
    '    rules = SERIES_RULES.get(series_key) or SERIES_RULES.get("VST")',
    "",
    "    if not rules:",
    "        print(f\"No rules defined for series {tool['series']}\")",
    "        return",
    "",
    '    dia = tool["diameter"]',
    '    flutes = tool["flutes"]',
    '    rpm = cfg["rpm"]',
    "",
    '    mode_selected = cfg["mode_selected"]',
    '    woc_pct = cfg["woc_pct"]',
    '    doc_xd = cfg["doc_xd"]',
    "",
    '    fpt = rules["fpt"][mode_selected]',
    "    feed = calc_feed(rpm, flutes, fpt)",
    "",
    "    woc = dia * (woc_pct / 100)",
    "    doc = dia * doc_xd",
    "    mrr = calc_mrr(woc, doc, feed)",
    "",
    "    actual_mode = classify_actual_mode(",
    '        woc_pct, rules["woc_ranges"]',
    "    )",
    "",
    "    limits = {",
    '        "woc": rules["woc_ranges"][mode_selected],',
    '        "doc_xd": min(rules["doc_limits_xd"][mode_selected], tool["loc"] / dia)',
    "    }",
    "",
    "    mentor = mentor_messages(",
    "        tool, mode_selected, actual_mode, woc_pct, doc_xd, limits",
    "    )",
    "",
    "    # ==========================",
    "    # OUTPUT",
    "    # ==========================",
    "",
    '    print("\\n===================================")',
    '    print(" MACHINING MENTOR OUTPUT")',
    '    print("===================================")',
    '    print(f"EDP: {edp}")',
    "    print(f\"Series: {tool['series']}\")",
    '    print(f"Diameter: {dia:.3f} in")',
    '    print(f"Flutes: {flutes}")',
    '    print(f"Selected Mode: {mode_selected}")',
    '    print(f"Detected Mode: {actual_mode}")',
    '    print(f"RPM: {rpm}")',
    '    print(f"Feed: {feed:.1f} IPM")',
    '    print(f"WOC: {woc_pct}%")',
    '    print(f"DOC: {doc_xd:.2f} × D")',
    '    print(f"MRR: {mrr:.2f} in³/min")',
    "",
    '    print("\\nMentor Guidance:")',
    "    for msg in mentor:",
    '        print("•", msg)',
    "",
    "# ==========================================================",
    "# RUN",
    "# ==========================================================",
    "",
    'if __name__ == "__main__":',
    "    run_case(TEST_CASE)",
  ].join("\n");

  try {
    if (snippets.length === 0) {
      console.log("Seeding database...");
      await storage.createSnippet({
        title: "Hello World",
        code: "print('Hello, World!')",
        language: "python",
      });
      await storage.createSnippet({
        title: "Machining Mentor",
        code: machiningMentorCode,
        language: "python",
      });
      console.log("Seeding complete");
    } else {
      // Upsert Machining Mentor if it doesn't exist or update it
      const machMentor = snippets.find((s) => s.title === "Machining Mentor");
      if (!machMentor) {
        await storage.createSnippet({
          title: "Machining Mentor",
          code: machiningMentorCode,
          language: "python",
        });
        console.log("Created CoreCutCNC snippet");
      } else {
        await storage.updateSnippet(machMentor.id, {
          code: machiningMentorCode,
        });
        console.log("Updated CoreCutCNC snippet");
      }
    }
  } catch (err) {
    console.warn("Seed/upsert failed (non-fatal):", (err as any)?.message ?? err);
  }

  // ── Engineering mode password check ──────────────────────────────────────
  app.post("/api/eng-auth", async (req, res) => {
    const { password } = req.body ?? {};
    const engPassword = process.env.ENG_PASSWORD;
    if (!engPassword) {
      return res.status(503).json({ ok: false, error: "Engineering mode not configured" });
    }
    if (password !== engPassword) {
      return res.status(401).json({ ok: false, error: "Incorrect password" });
    }
    // Auto-create a Toolbox session for the admin email so eng mode gets Toolbox access
    const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
    if (adminEmail) {
      const { pool } = await import("./db");
      const token = crypto.randomBytes(24).toString("hex");
      await pool.query(
        `INSERT INTO toolbox_sessions (email, token, created_at)
         VALUES ($1, $2, now())
         ON CONFLICT (email) DO UPDATE SET token = $2, created_at = now()`,
        [adminEmail, token]
      );
      return res.json({ ok: true, tb_email: adminEmail, tb_token: token });
    }
    return res.json({ ok: true });
  });

  // ── Admin auth ────────────────────────────────────────────────────────────
  app.post("/api/admin/auth", (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ ok: false });
    }
  });

  // ── Admin stats ───────────────────────────────────────────────────────────
  app.get("/api/admin/stats", async (req, res) => {
    const { token } = req.query as { token: string };
    if (token !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
    const { pool } = await import("./db");

    const [users, activity, operations, registrations] = await Promise.all([
      // Users: email, signup date, save count, last active
      pool.query(`
        SELECT
          s.email,
          s.created_at as joined,
          s.blocked,
          COUNT(i.id) as save_count,
          MAX(i.created_at) as last_active
        FROM toolbox_sessions s
        LEFT JOIN toolbox_items i ON i.email = s.email
        GROUP BY s.email, s.created_at, s.blocked
        ORDER BY s.created_at DESC
      `),
      // Recent activity: last 50 saves
      pool.query(`
        SELECT id, email, title, type, created_at
        FROM toolbox_items
        ORDER BY created_at DESC
        LIMIT 50
      `),
      // Usage by operation type
      pool.query(`
        SELECT
          data->'inputs'->>'operation' as operation,
          COUNT(*) as count
        FROM toolbox_items
        WHERE data->'inputs'->>'operation' IS NOT NULL
        GROUP BY operation
        ORDER BY count DESC
      `),
      // All registrations from welcome modal (leads table)
      pool.query(`
        SELECT id, name, email, city, region, country, postal, created_at, notified_at
        FROM leads
        WHERE operation = 'tool_request'
        ORDER BY created_at DESC
      `),
    ]);

    res.json({
      users: users.rows,
      activity: activity.rows,
      operations: operations.rows,
      registrations: registrations.rows,
      totals: {
        users: users.rows.length,
        registrations: registrations.rowCount ?? 0,
        saves: activity.rows.length > 0 ? (await pool.query(`SELECT COUNT(*) FROM toolbox_items`)).rows[0].count : 0,
      },
    });
  });

  // ── Admin: access control ─────────────────────────────────────────────────
  function requireAdmin(req: any, res: any): boolean {
    const token = ((req.query.token || req.headers["x-admin-token"] || "") as string);
    if (token !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  app.get("/api/admin/access", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { pool } = await import("./db");
    const [emails, domains, blockedUsers] = await Promise.all([
      pool.query(`SELECT email, notes, added_at FROM allowed_emails ORDER BY added_at DESC`),
      pool.query(`SELECT domain, reason, added_at FROM blocked_domains ORDER BY added_at DESC`),
      pool.query(`SELECT email, created_at FROM toolbox_sessions WHERE blocked = TRUE ORDER BY email`),
    ]);
    res.json({
      allowed_emails: emails.rows,
      blocked_domains: domains.rows,
      blocked_users: blockedUsers.rows,
    });
  });

  app.post("/api/admin/allowed-emails", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { email, notes } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });
    const { pool } = await import("./db");
    await pool.query(
      `INSERT INTO allowed_emails (email, notes) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET notes = $2`,
      [email.toLowerCase().trim(), notes || ""]
    );
    res.json({ ok: true });
  });

  app.delete("/api/admin/allowed-emails/:email", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { pool } = await import("./db");
    await pool.query(`DELETE FROM allowed_emails WHERE email = $1`, [
      decodeURIComponent(req.params.email).toLowerCase(),
    ]);
    res.json({ ok: true });
  });

  app.post("/api/admin/blocked-domains", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { domain, reason } = req.body;
    if (!domain) return res.status(400).json({ error: "domain required" });
    const { pool } = await import("./db");
    const clean = domain.toLowerCase().trim().replace(/^@/, "");
    await pool.query(
      `INSERT INTO blocked_domains (domain, reason) VALUES ($1, $2)
       ON CONFLICT (domain) DO UPDATE SET reason = $2`,
      [clean, reason || ""]
    );
    res.json({ ok: true });
  });

  app.delete("/api/admin/blocked-domains/:domain", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { pool } = await import("./db");
    await pool.query(`DELETE FROM blocked_domains WHERE domain = $1`, [
      decodeURIComponent(req.params.domain).toLowerCase(),
    ]);
    res.json({ ok: true });
  });

  app.post("/api/admin/block-user", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });
    const { pool } = await import("./db");
    await pool.query(`UPDATE toolbox_sessions SET blocked = TRUE WHERE email = $1`, [email.toLowerCase()]);
    res.json({ ok: true });
  });

  app.post("/api/admin/unblock-user", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });
    const { pool } = await import("./db");
    await pool.query(`UPDATE toolbox_sessions SET blocked = FALSE WHERE email = $1`, [email.toLowerCase()]);
    res.json({ ok: true });
  });

  // ── Admin: team management ────────────────────────────────────────────────
  app.get("/api/admin/teams", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { pool } = await import("./db");
    // Return all users who are connected to a team, grouped by team_email
    const r = await pool.query(`
      SELECT email, team_email, created_at
      FROM toolbox_sessions
      WHERE team_email IS NOT NULL AND team_email <> ''
      ORDER BY team_email, created_at
    `);
    res.json(r.rows);
  });

  app.post("/api/admin/teams/disconnect", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });
    const { pool } = await import("./db");
    await pool.query(`UPDATE toolbox_sessions SET team_email = NULL WHERE email = $1`, [email.toLowerCase()]);
    res.json({ ok: true });
  });

  // ── Admin: announcements ──────────────────────────────────────────────────
  app.get("/api/admin/announcements", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { pool } = await import("./db");
    const r = await pool.query(`SELECT * FROM announcements ORDER BY created_at DESC`);
    res.json(r.rows);
  });

  app.post("/api/admin/announcements", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { version, headline, subheadline, bullets } = req.body;
    if (!version?.trim() || !headline?.trim()) return res.status(400).json({ error: "version and headline required" });
    const { pool } = await import("./db");
    // Deactivate all others first
    await pool.query(`UPDATE announcements SET active = FALSE`);
    const r = await pool.query(
      `INSERT INTO announcements (version, headline, subheadline, bullets, active, published_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (version) DO UPDATE SET headline=$2, subheadline=$3, bullets=$4, active=TRUE, published_at=NOW()
       RETURNING *`,
      [version.trim(), headline.trim(), subheadline?.trim() || "", JSON.stringify(bullets || [])]
    );
    res.json(r.rows[0]);
  });

  app.post("/api/admin/announcements/:id/deactivate", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { pool } = await import("./db");
    await pool.query(`UPDATE announcements SET active = FALSE WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  });

  app.delete("/api/admin/announcements/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { pool } = await import("./db");
    await pool.query(`DELETE FROM announcements WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  });

  // ── PDF print geometry extraction ─────────────────────────────────────────
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  const EXTRACTION_PROMPT = `You are reading a Core Cutter LLC engineering print (technical drawing).

FIRST — verify this is a genuine Core Cutter LLC print:
1. Look for "CORE CUTTER" or "Core Cutter" or "CORE CUTTER, LLC" in the title block, header, or logo area.
2. Look for a tool number in the format "CC-XXXXX" (e.g. CC-12650) in the title block (labeled "TOOL #").

If you do NOT find "Core Cutter" on the print, return ONLY:
{"error": "not_core_cutter"}

If you find "Core Cutter" but NO "CC-XXXXX" tool number, still extract all dimensions but include:
{"tool_number": null, "no_tool_number": true, ...rest of fields}

If both are present, extract the tool number as "tool_number" (e.g. "CC-12650") along with all tool geometry dimensions, and return ONLY valid JSON — no explanation, no markdown, just the raw JSON object.

UNITS — CHECK FIRST:
Look for a units indicator on the print — typically in the title block, notes section, or dimension callouts. Common indicators: "DIMENSIONS IN MM", "ALL DIMS IN MILLIMETERS", "mm", or dimension values that are clearly metric (e.g. 12.70, 6.350, 25.4).
- If the print is in MILLIMETERS: set "units": "mm" in your response and extract all dimension values exactly as shown on the print (do NOT convert — the server will convert).
- If the print is in INCHES (default for Core Cutter): set "units": "in" and extract as normal.
- If uncertain, default to "units": "in".

CRITICAL RULES — READ CAREFULLY:

1. ALL dimensions on Core Cutter prints have tolerances. You MUST extract the NOMINAL (base) value only and discard all tolerance information:
   - "Ø0.750-.0001/.0004" → 0.750
   - "1.875+.06/.00" → 1.875
   - "Ø0.250+.000/-.005" → 0.250
   - "4.00±.05" → 4.00
   - ".1875±.001" → 0.1875
   The nominal value is always the FIRST number before any +, -, or ± symbol.

2. tool_dia is the CUTTING diameter — the Ø dimension at the tip/cutting end of the tool. On standard endmills the cutting dia equals the shank dia. On REDUCED-SHANK / MICRO tools (e.g. QTR3-style, stub cutters) the shank is LARGER than the cutting end — in this case tool_dia is the SMALL Ø at the tip (e.g. Ø0.0590), NOT the shank. The shank Ø (e.g. Ø0.250) goes in shank_dia. Rule: tool_dia = the Ø callout nearest the cutting tip/flutes. shank_dia = the Ø callout on the large body/shank end. If both ends are labeled with different diameters, the SMALLER one at the cutting tip is tool_dia. tool_dia is NEVER 0. On keyseat cutters it is the disc/wheel diameter (the big cutting part).

3. For KEYSEAT cutters specifically:
   - loc = the disc WIDTH (thickness of the cutting wheel, e.g. ".1875±.001" → 0.1875)
   - lbs = the REACH/TSC dimension (distance from shank face to cutter, e.g. "1.875+.06/.00 TSC" → 1.875)
   For all other tool types: loc = flute/cutting length, lbs = length below shank if necked.

4. For DOVETAIL cutters specifically:
   - dovetail_angle = the INCLUDED angle of the dovetail V-form. This is the FULL angle, NOT the half-angle. If the print shows 30° on one side of the V, the included angle is 60°. If it shows 45° on one side, the included is 90°. Look for the angle labeled at the V-groove or cutting tip — use the largest angle shown at the cutting form as the included angle.
   - lbs = the REACH/TSC dimension (distance from shank face to cutter zone, labeled TSC, e.g. ".625+.06/-.00 TSC" → 0.625)
   - keyseat_arbor_dia = the narrow neck diameter between the shank and the cutting head (e.g. "Ø0.200" neck → 0.200)

5. keyseat_arbor_dia is the small narrow neck connecting the cutter disc/head to the shank — applies to both keyseat AND dovetail cutters.

6. For HIGH-FEED MILL (feedmill) cutters specifically:
   - tool_type = "feedmill"
   - tool_dia = the cutting diameter
   - loc = the axial flute length / cutting height
   - lbs = the reach/TSC dimension if it is a long-reach feed mill with a reduced neck (0 if standard body)
   - lead_angle = the lead angle in degrees — look for a dimension callout on the cutting insert face angle or a note like "20° LEAD", "LEAD ANGLE: 17°", or an angular dimension on the cutting face. Common values: 10, 12, 15, 17, 20. Use 20 if not explicitly shown.
   - corner_radius = the insert corner radius (from the insert designation or a callout, e.g. "R0.060" → 0.060)

5. shank_dia is the large cylindrical body at the far end (shank) of the tool.

6. For THREAD MILLS specifically:
   - tool_dia = the CUTTING diameter (the thread form OD, e.g. "Ø0.745+.000/-.002" → 0.745)
   - loc = the LOC (length of cut / flute length, labeled "LOC", e.g. ".127 LOC" → 0.127)
   - lbs = the TSC dimension (reach from shank face to cutting zone, e.g. "1.00+.06/-.00 TSC" → 1.00)
   - shank_dia = the large shank OD (e.g. "Ø0.750-.0001/.0004" → 0.750)
   - thread_tpi = threads per inch if shown; 0 if not labeled (single-profile mills show thread angle only)
   - The neck diameter (smaller Ø between shank and cutter, e.g. "Ø0.525") maps to keyseat_arbor_dia for deflection modeling

CRITICAL — LOC vs LBS for ENDMILLS (read this carefully before extracting):

On long-reach / reduced-neck endmill prints you will see TWO horizontal length dimensions stacked near the cutting end of the tool — one short, one long. Identify them like this:

STEP 1 — Find the FLUTED zone: Look at the right end of the tool profile. The fluted/cutting zone is the short section at the tip where the cutting edges are. It typically spans 0.5×D to 3×D. The dimension arrow bracketing ONLY this short fluted section is the LOC.

STEP 2 — Find the REACH/NECK: There is often a second, longer dimension arrow that spans from the shank step (where the diameter reduces) all the way to the tool tip. This longer dimension is the REACH or LBS (length below shank). It will always be LARGER than the LOC.

STEP 3 — Assign correctly:
- loc = the SHORT dimension (fluted cutting length only). Example: .625+.06/.00 → loc = 0.625
- lbs = the LONG dimension (shank face to tip). Example: 3.25+.06/.00 → lbs = 3.25
- If the print also shows a reduced neck diameter (smaller Ø between the shank body and the cutting tip, e.g. Ø0.475), this confirms it is a reduced-neck tool with both loc AND lbs.

RULE: If you see two unlabeled length dimensions on the cutting end — one roughly equal to 1–2× the cutting diameter, and one much larger — the small one is loc, the large one is lbs. NEVER put the large reach dimension in loc.

VALIDATION: lbs must ALWAYS be greater than loc. If your extracted lbs is less than or equal to your extracted loc, you have them backwards — swap them.

Required fields (use 0 for unknown numbers, null for unknown strings):
{
  "units": "in|mm",
  "tool_type": "endmill|feedmill|keyseat|dovetail|drill|step_drill|reamer|threadmill|chamfer_mill",
  "tool_dia": <number, cutting diameter — nominal value only, in the print's native units>,
  "flutes": <integer>,
  "loc": <number, FLUTED CUTTING LENGTH ONLY — the SHORT dimension at the tip (e.g. 0.625). NEVER the long reach. 0 if unknown>,
  "lbs": <number, REACH / length below shank — the LONG dimension from shank step to tip on reduced-neck tools (e.g. 3.25). 0 if no neck>,
  "helix_angle": <integer degrees, 0 if not shown>,
  "corner_condition": "square|corner_radius|ball",
  "corner_radius": <number in inches, 0 if square>,
  "shank_dia": <number in inches, 0 if same as cutting dia>,
  "coating": <string or null>,
  "material": "carbide|hss",
  "keyseat_arbor_dia": <number, neck/arbor diameter for keyseat cutters, 0 if not applicable>,
  "dovetail_angle": <number, included dovetail angle in degrees, 0 if not applicable>,
  "chamfer_angle": <number, included chamfer angle in degrees, 0 if not applicable>,
  "chamfer_tip_dia": <number in inches, 0 if not applicable>,
  "thread_tpi": <number, threads per inch for threadmills, 0 if not applicable>,
  "drill_step_diameters": <array of step diameters in inches for step drills, [] if not applicable>,
  "cutting_material": <string, the workpiece material this tool is designed for — look for "CUTTING=" or "FOR:" in the notes section. Map to one of: "aluminum_wrought", "steel_alloy", "steel_free", "stainless_304", "stainless_316", "stainless_ph", "cast_iron", "inconel_718", "inconel_625", "titanium", "hardened_lt55", "hardened_gt55" — use null if not specified>,
  "coolant_fed": <boolean, true if the print includes any note indicating coolant-through capability — look for text like "COOLANT FED", "COOLANT THROUGH", "COOLANT THRU", "THRU COOLANT", "TSC", "THROUGH SPINDLE COOLANT", or any note referencing internal coolant passages. false if no such note is found.>,
  "shank_type": <string or null — look in the title block, notes section, or shank detail for shank type callouts. Return "weldon" if "WELDON FLAT", "WELDON", or "W/FLAT" is noted. Return "safe_lock" if "SAFE LOCK", "SAFELOCK", "SAFE-LOCK", "HAIMER", or "HAIMER SAFE-LOCK" is noted. Return null if no special shank type is noted.>,
  "oal": <number, overall length of the tool in inches — labeled "OAL" on the print. 0 if not shown.>,
  "lead_angle": <number, lead angle in degrees for feed mills — see rule 6 above. 0 for all other tool types.>,
  "variable_pitch": <boolean — true if the notes or title explicitly say "VARIABLE PITCH" or "VAR PITCH". false otherwise.>,
  "variable_helix": <boolean — true if the notes or title explicitly say "VARIABLE HELIX" or "VAR HELIX". false otherwise.>,
  "tool_series": <string or null — look in the NOTES section for a series callout like "QTR3-STYLE", "QTR3-RN", "QTR3". Return "QTR3-RN" if noted, "QTR3" if "QTR3-STYLE" or "QTR3" is noted, null otherwise.>
}`;

  app.post("/api/tool-geometry/extract", upload.single("pdf"), async (req, res) => {
    try {
      console.log("PDF extract route hit, file:", req.file?.originalname, "size:", req.file?.size);
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      console.log("API key present:", !!apiKey, "length:", apiKey?.length);
      if (!apiKey) {
        return res.status(503).json({ error: "PDF extraction not configured — contact support" });
      }

      const client = new Anthropic({ apiKey });
      const fileBase64 = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype;
      const isImage = mimeType.startsWith("image/");

      // Build content block — PDF uses document type, images use image type
      const fileBlock: any = isImage
        ? {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: fileBase64,
            },
          }
        : {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: fileBase64,
            },
          };

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            fileBlock,
            {
              type: "text",
              text: EXTRACTION_PROMPT,
            },
          ],
        }],
      });

      const text = response.content.find(c => c.type === "text")?.text ?? "";

      // Extract JSON — find first { to last } to handle any surrounding text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const cleaned = jsonMatch ? jsonMatch[0] : text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
      console.log("Raw Claude response:", text.substring(0, 500));
      console.log("Cleaned for parse:", cleaned.substring(0, 500));

      let extracted: Record<string, unknown>;
      try {
        extracted = JSON.parse(cleaned);
        console.log("Extracted:", JSON.stringify(extracted));
      } catch {
        return res.status(422).json({
          error: "Could not read print — please enter dimensions manually",
          raw: text,
        });
      }

      // ── Metric → inch conversion ──────────────────────────────────────────
      if (extracted.units === "mm") {
        const MM_FIELDS = ["tool_dia", "loc", "lbs", "corner_radius", "shank_dia",
                           "keyseat_arbor_dia", "chamfer_tip_dia"];
        for (const f of MM_FIELDS) {
          if (typeof extracted[f] === "number" && (extracted[f] as number) > 0) {
            extracted[f] = Math.round(((extracted[f] as number) / 25.4) * 100000) / 100000;
          }
        }
        if (Array.isArray(extracted.drill_step_diameters)) {
          extracted.drill_step_diameters = (extracted.drill_step_diameters as number[]).map(
            (d: number) => Math.round((d / 25.4) * 100000) / 100000
          );
        }
        extracted._converted_from_mm = true;
      }

      // Safety: lbs must always be >= loc — if reversed, swap them
      const eLoc = typeof extracted.loc === "number" ? extracted.loc : 0;
      const eLbs = typeof extracted.lbs === "number" ? extracted.lbs : 0;
      if (eLbs > 0 && eLoc > 0 && eLbs < eLoc) {
        console.log(`LOC/LBS swap detected: loc=${eLoc} lbs=${eLbs} — swapping`);
        extracted.loc = eLbs;
        extracted.lbs = eLoc;
      }

      return res.json({ ok: true, extracted });
    } catch (err: any) {
      console.error("PDF extraction error:", err?.message ?? err, err?.status, err?.error);
      return res.status(500).json({ error: "Extraction failed — please enter dimensions manually", detail: err?.message ?? String(err) });
    }
  });

  // ── Toolbox: send OTP ─────────────────────────────────────────────────────
  app.post("/api/toolbox/send-code", async (req, res) => {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const { pool } = await import("./db");

    // ── Access control checks ──────────────────────────────────────────────
    const emailLower = email.toLowerCase().trim();
    const domain = emailLower.split("@")[1];

    // 1. Domain blocklist
    const domainBlock = await pool.query(`SELECT 1 FROM blocked_domains WHERE domain = $1`, [domain]);
    if (domainBlock.rows.length > 0) {
      return res.status(403).json({ error: "This email domain is not authorized to access CoreCutCNC." });
    }

    // 2. User-level block
    const userRow = await pool.query(`SELECT blocked FROM toolbox_sessions WHERE email = $1`, [emailLower]);
    if (userRow.rows.length > 0 && userRow.rows[0].blocked) {
      return res.status(403).json({ error: "This account has been suspended. Contact sales@corecutterusa.com for assistance." });
    }

    // 3. Allowlist — only enforced when the list has at least one entry
    const { rows: [{ count: allowCount }] } = await pool.query(`SELECT COUNT(*) FROM allowed_emails`);
    if (Number(allowCount) > 0) {
      const allowed = await pool.query(`SELECT 1 FROM allowed_emails WHERE email = $1`, [emailLower]);
      if (allowed.rows.length === 0) {
        return res.status(403).json({ error: "Access to CoreCutCNC is by invitation only. Contact sales@corecutterusa.com to request access." });
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await pool.query(
      `INSERT INTO toolbox_sessions (email, token, otp, otp_expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET otp = $3, otp_expires_at = $4`,
      [email.toLowerCase(), crypto.randomUUID(), otp, expires]
    );
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const fromName = "CoreCutCNC by Core Cutter";
    const fromAddr = process.env.FROM_EMAIL || "scott@corecutterusa.com";
    const mailOptions = {
      from: `"${fromName}" <${fromAddr}>`,
      to: email,
      subject: "Your CoreCutCNC Toolbox Access Code",
      text: `Your CoreCutCNC Toolbox verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.\n\n— Core Cutter LLC\n120 Technology Drive, Gardiner, ME 04345\nsales@corecutterusa.com`,
      html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#111111;padding:24px 32px;text-align:center;">
            <div style="font-size:22px;font-weight:900;letter-spacing:4px;color:#ea6c00;">CoreCutCNC</div>
            <div style="font-size:11px;color:#888;margin-top:4px;letter-spacing:1px;">POWERED BY CORE CUTTER LLC</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:15px;color:#111;font-weight:600;">Your Toolbox Access Code</p>
            <p style="margin:0 0 24px;font-size:13px;color:#555;">Enter this code in the CoreCutCNC app to access your Toolbox.</p>
            <div style="background:#f4f4f5;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
              <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#ea6c00;">${otp}</div>
            </div>
            <p style="margin:0 0 4px;font-size:12px;color:#888;">This code expires in <strong>10 minutes</strong>.</p>
            <p style="margin:0;font-size:12px;color:#888;">If you didn't request this, you can safely ignore this email.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#aaa;">Core Cutter LLC · 120 Technology Drive · Gardiner, ME 04345</p>
            <p style="margin:4px 0 0;font-size:11px;color:#aaa;">sales@corecutterusa.com · (207) 588-7519</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    };
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.sendMail(mailOptions);
    } else {
      console.log(`[Toolbox OTP] ${email}: ${otp}`);
    }
    res.json({ sent: true });
  });

  // ── Toolbox: verify OTP ───────────────────────────────────────────────────
  app.post("/api/toolbox/verify-code", async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Email and code required" });
    const { pool } = await import("./db");
    const result = await pool.query(
      `SELECT token, otp, otp_expires_at FROM toolbox_sessions WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (!result.rows.length) return res.status(401).json({ error: "Code not found" });
    const row = result.rows[0];
    if (row.otp !== String(code)) return res.status(401).json({ error: "Incorrect code" });
    if (new Date(row.otp_expires_at) < new Date()) return res.status(401).json({ error: "Code expired" });
    await pool.query(`UPDATE toolbox_sessions SET otp = NULL, otp_expires_at = NULL WHERE email = $1`, [email.toLowerCase()]);
    res.json({ ok: true, token: row.token });
  });

  // ── Toolbox: auto-auth (for users already registered via welcome modal) ───
  app.post("/api/toolbox/auto-auth", async (req, res) => {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const { pool } = await import("./db");
    const emailLower = email.toLowerCase().trim();
    const domain = emailLower.split("@")[1];

    // Domain blocklist
    const domainBlock = await pool.query(`SELECT 1 FROM blocked_domains WHERE domain = $1`, [domain]);
    if (domainBlock.rows.length > 0) {
      return res.status(403).json({ error: "Email domain not authorized" });
    }

    // User-level block
    const userRow = await pool.query(`SELECT blocked FROM toolbox_sessions WHERE email = $1`, [emailLower]);
    if (userRow.rows.length > 0 && userRow.rows[0].blocked) {
      return res.status(403).json({ error: "Account suspended" });
    }

    // Allowlist check
    const { rows: [{ count: allowCount }] } = await pool.query(`SELECT COUNT(*) FROM allowed_emails`);
    if (Number(allowCount) > 0) {
      const allowed = await pool.query(`SELECT 1 FROM allowed_emails WHERE email = $1`, [emailLower]);
      if (allowed.rows.length === 0) {
        return res.status(403).json({ error: "Access by invitation only" });
      }
    }

    // Create or return existing session (no OTP required — user already verified via welcome modal)
    const token = crypto.randomBytes(24).toString("hex");
    const existing = await pool.query(`SELECT token FROM toolbox_sessions WHERE email = $1`, [emailLower]);
    if (existing.rows.length > 0) {
      // Return existing token — don't overwrite it (preserves existing saves)
      return res.json({ ok: true, token: existing.rows[0].token });
    }
    await pool.query(
      `INSERT INTO toolbox_sessions (email, token, created_at) VALUES ($1, $2, now())`,
      [emailLower, token]
    );
    res.json({ ok: true, token });
  });

  // ── Announcements: public ─────────────────────────────────────────────────
  app.get("/api/announcement", async (req, res) => {
    const { pool } = await import("./db");
    const r = await pool.query(
      `SELECT id, version, headline, subheadline, bullets, published_at
       FROM announcements WHERE active = TRUE ORDER BY published_at DESC LIMIT 1`
    );
    if (!r.rows.length) return res.json(null);
    res.json(r.rows[0]);
  });

  // ── Team: connect ─────────────────────────────────────────────────────────
  app.post("/api/team/connect", async (req, res) => {
    const { email, token, team_email } = req.body;
    if (!email || !token || !team_email) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    // Verify caller session
    const auth = await pool.query(
      `SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    // Verify team email exists as a registered session
    const teamRow = await pool.query(
      `SELECT email FROM toolbox_sessions WHERE email = $1`,
      [team_email.toLowerCase().trim()]
    );
    if (!teamRow.rows.length) return res.status(404).json({ error: "Team email not found. That email must be registered in the app first." });
    // Prevent connecting to your own email
    if (team_email.toLowerCase().trim() === email.toLowerCase()) {
      return res.status(400).json({ error: "You cannot connect to your own email as a team." });
    }
    await pool.query(
      `UPDATE toolbox_sessions SET team_email = $1 WHERE email = $2`,
      [team_email.toLowerCase().trim(), email.toLowerCase()]
    );
    res.json({ ok: true, team_email: team_email.toLowerCase().trim() });
  });

  // ── Team: leave ───────────────────────────────────────────────────────────
  app.post("/api/team/leave", async (req, res) => {
    const { email, token } = req.body;
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    await pool.query(
      `UPDATE toolbox_sessions SET team_email = NULL WHERE email = $1`,
      [email.toLowerCase()]
    );
    res.json({ ok: true });
  });

  // ── Team: get current team info ───────────────────────────────────────────
  app.get("/api/team/info", async (req, res) => {
    const { email, token } = req.query as { email: string; token: string };
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    res.json({ team_email: auth.rows[0].team_email ?? null });
  });

  // ── Toolbox: save item ────────────────────────────────────────────────────
  app.post("/api/toolbox/save", async (req, res) => {
    const { email, token, type, title, data, notes, job_no, part_name } = req.body;
    if (!email || !token || !title) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const dataEmail = auth.rows[0].team_email ?? email.toLowerCase();
    const result = await pool.query(
      `INSERT INTO toolbox_items (email, type, title, data, notes, job_no, part_name) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [dataEmail, type || "result", title, data ? JSON.stringify(data) : null, notes || "", job_no || "", part_name || ""]
    );
    res.json(result.rows[0]);
  });

  // ── Toolbox: list items ───────────────────────────────────────────────────
  app.get("/api/toolbox/items", async (req, res) => {
    const { email, token } = req.query as { email: string; token: string };
    if (!email || !token) return res.status(400).json({ error: "Missing email or token" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    // Use team email if connected, otherwise own email
    const dataEmail = auth.rows[0].team_email ?? email.toLowerCase();
    const result = await pool.query(
      `SELECT * FROM toolbox_items WHERE email = $1 ORDER BY created_at DESC`,
      [dataEmail]
    );
    res.json(result.rows);
  });

  // ── Machine catalog search ────────────────────────────────────────────────
  app.get("/api/machines/search", async (req, res) => {
    try {
      const { q, email, token } = req.query as { q: string; email?: string; token?: string };
      if (!q || q.length < 1) return res.json([]);
      const { pool } = await import("./db");

      // Split query into tokens — all tokens must match somewhere in brand/model/control/machine_type.
      // Strip dashes and spaces for matching so "VF2" matches "VF-2", "haasVF2" matches "Haas VF-2".
      // Also map user-friendly type labels to machine_type keys so "lathe", "VMC", "mill-turn" etc. work.
      const MACHINE_TYPE_ALIASES: Record<string, string> = {
        "lathe": "lathe", "lathes": "lathe",
        "vmc": "vmc", "vertical": "vmc", "vertical mill": "vmc", "vertical machining": "vmc",
        "hmc": "hmc", "horizontal": "hmc", "horizontal mill": "hmc", "horizontal machining": "hmc",
        "mill-turn": "mill_turn", "millturn": "mill_turn", "mill turn": "mill_turn", "multitask": "mill_turn",
        "swiss": "swiss", "swiss lathe": "swiss", "swiss turn": "swiss",
        "5axis": "5axis", "5-axis": "5axis", "five axis": "5axis",
        "edm": "edm", "wire edm": "edm",
        "grinder": "grinder", "grinding": "grinder",
      };
      const tokens = q.trim().split(/\s+/).filter(Boolean);
      const params: string[] = tokens.map(t => `%${t}%`);
      // For each token, also check if it (or lowercased phrase) maps to a machine_type key
      const tokenConds = tokens.map((t, i) => {
        const typeKey = MACHINE_TYPE_ALIASES[t.toLowerCase()];
        const typeClause = typeKey ? ` OR machine_type = '${typeKey}'` : "";
        return `(brand ILIKE $${i+1}
          OR model ILIKE $${i+1}
          OR control ILIKE $${i+1}
          OR (brand || ' ' || model) ILIKE $${i+1}
          OR REPLACE(model, '-', '') ILIKE REPLACE($${i+1}, '-', '')
          OR REPLACE(brand || ' ' || model, '-', '') ILIKE REPLACE($${i+1}, '-', '')
          OR REPLACE(REPLACE(brand || model, '-', ''), ' ', '') ILIKE REPLACE(REPLACE($${i+1}, '-', ''), ' ', '')${typeClause})`;
      }).join(" AND ");

      // Relevance: model exact match > model starts-with > brand+model starts-with > rest
      const lastTok = `%${tokens[tokens.length - 1]}%`;
      const lastTokStart = `${tokens[tokens.length - 1]}%`;
      const catalogRows = await pool.query(
        `SELECT id, brand, model, max_rpm, sub_spindle_rpm, spindle_hp, live_tool_max_rpm, live_tool_hp, live_tool_drive_type, mill_spindle_max_rpm, mill_spindle_hp, mill_spindle_taper, taper, drive_type, dual_contact, coolant_types, tsc_psi, machine_type, control, NULL::text AS nickname, NULL::text AS shop_machine_no, false AS _saved,
           CASE
             WHEN model ILIKE $${tokens.length + 1}        THEN 1
             WHEN model ILIKE $${tokens.length + 2}        THEN 2
             WHEN (brand || ' ' || model) ILIKE $${tokens.length + 2} THEN 3
             ELSE 4
           END AS _rank
         FROM machines
         WHERE ${tokenConds}
         ORDER BY _rank, brand, model LIMIT 50`,
        [...params, lastTok, lastTokStart]
      );

      // Also search user's saved machines if logged in
      let savedRows: any[] = [];
      if (email && token) {
        try {
          const auth = await pool.query(
            `SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`,
            [email.toLowerCase(), token]
          );
          if (auth.rows.length) {
            const userTokenConds = tokens.map((t, i) => {
              const typeKey = MACHINE_TYPE_ALIASES[t.toLowerCase()];
              const typeClause = typeKey ? ` OR um.machine_type = '${typeKey}'` : "";
              return `(um.brand ILIKE $${i+3} OR um.model ILIKE $${i+3} OR um.nickname ILIKE $${i+3} OR um.shop_machine_no ILIKE $${i+3} OR um.control ILIKE $${i+3}
                OR REPLACE(um.model, '-', '') ILIKE REPLACE($${i+3}, '-', '')
                OR REPLACE(REPLACE(um.brand || um.model, '-', ''), ' ', '') ILIKE REPLACE(REPLACE($${i+3}, '-', ''), ' ', '')${typeClause})`;
            }).join(" AND ");
            const userParams = [email.toLowerCase(), token, ...tokens.map(t => `%${t}%`)];
            const ur = await pool.query(
              `SELECT um.id, um.brand, um.model, um.max_rpm, um.spindle_hp, um.taper, um.drive_type, um.dual_contact, um.coolant_types, um.tsc_psi, um.machine_type, um.control, um.nickname, um.shop_machine_no,
                      c.mill_spindle_max_rpm,
                      c.mill_spindle_hp,
                      c.mill_spindle_taper,
                      c.sub_spindle_rpm,
                      true AS _saved
               FROM user_machines um
               LEFT JOIN machines c ON c.id = um.machine_id
               WHERE um.email = $1 AND (${userTokenConds})
               ORDER BY um.created_at DESC LIMIT 10`,
              userParams
            );
            savedRows = ur.rows;
          }
        } catch (savedErr) {
          console.error("[machines/search] user_machines query failed:", savedErr);
          // Fall through — still return catalog results
        }
      }

      // Saved machines first, then catalog
      res.json([...savedRows, ...catalogRows.rows]);
    } catch (err: any) {
      console.error("[machines/search] error:", err);
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ── User machines: save ───────────────────────────────────────────────────
  app.post("/api/user-machines", async (req, res) => {
    const { email, token, nickname, shop_machine_no, serial_number, machine_id,
            brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact,
            coolant_types, tsc_psi, machine_type, control, notes,
            sub_spindle_rpm, live_tool_max_rpm, live_tool_hp, live_tool_connection, live_tool_drive_type,
            mill_spindle_max_rpm, mill_spindle_hp, mill_spindle_taper } = req.body;
    if (!email || !token || !nickname) return res.status(400).json({ error: "Missing required fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const dataEmail = auth.rows[0].team_email ?? email.toLowerCase();
    const result = await pool.query(
      `INSERT INTO user_machines (email, nickname, shop_machine_no, serial_number, machine_id,
         brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact,
         coolant_types, tsc_psi, machine_type, control, notes,
         sub_spindle_rpm, live_tool_max_rpm, live_tool_hp, live_tool_connection, live_tool_drive_type,
         mill_spindle_max_rpm, mill_spindle_hp, mill_spindle_taper)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING id`,
      [dataEmail, nickname, shop_machine_no || null, serial_number || null,
       machine_id || null, brand || null, model || null, max_rpm || null,
       spindle_hp || null, taper || null, drive_type || null,
       dual_contact ?? false, coolant_types || null, tsc_psi || null,
       machine_type || null, control || null, notes || null,
       sub_spindle_rpm || null, live_tool_max_rpm || null, live_tool_hp || null,
       live_tool_connection || null, live_tool_drive_type || null,
       mill_spindle_max_rpm || null, mill_spindle_hp || null, mill_spindle_taper || null]
    );
    res.json({ ok: true, id: result.rows[0].id });
  });

  // ── User machines: list ───────────────────────────────────────────────────
  app.get("/api/user-machines", async (req, res) => {
    const { email, token } = req.query as { email: string; token: string };
    if (!email || !token) return res.status(400).json({ error: "Missing email or token" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    // Use team email if connected, otherwise own email
    const dataEmail = auth.rows[0].team_email ?? email.toLowerCase();
    const result = await pool.query(
      `SELECT * FROM user_machines WHERE email = $1 ORDER BY created_at DESC`,
      [dataEmail]
    );
    res.json(result.rows);
  });

  // ── User machines: update ─────────────────────────────────────────────────
  app.patch("/api/user-machines/:id", async (req, res) => {
    const { email, token, job_tags, machine_status, status_note, maintenance_date,
            nickname, shop_machine_no, serial_number, brand, model,
            max_rpm, spindle_hp, control, notes } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const dataEmail = auth.rows[0].team_email ?? email.toLowerCase();
    const fields: string[] = [];
    const vals: any[] = [];
    const add = (col: string, val: any) => { fields.push(`${col} = $${fields.length + 1}`); vals.push(val); };
    if (job_tags !== undefined) add("job_tags", JSON.stringify(job_tags));
    if (machine_status !== undefined) add("machine_status", machine_status);
    if (status_note !== undefined) add("status_note", status_note);
    if (maintenance_date !== undefined) add("maintenance_date", maintenance_date);
    if (nickname !== undefined) add("nickname", nickname);
    if (shop_machine_no !== undefined) add("shop_machine_no", shop_machine_no || null);
    if (serial_number !== undefined) add("serial_number", serial_number || null);
    if (brand !== undefined) add("brand", brand || null);
    if (model !== undefined) add("model", model || null);
    if (max_rpm !== undefined) add("max_rpm", max_rpm || null);
    if (spindle_hp !== undefined) add("spindle_hp", spindle_hp || null);
    if (control !== undefined) add("control", control || null);
    if (notes !== undefined) add("notes", notes || null);
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(id, dataEmail);
    const r = await pool.query(
      `UPDATE user_machines SET ${fields.join(", ")} WHERE id = $${vals.length - 1} AND email = $${vals.length} RETURNING *`,
      vals
    );
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
  });

  // ── User machines: add job tag ────────────────────────────────────────────
  app.post("/api/user-machines/:id/job-tags", async (req, res) => {
    const { email, token, job_no, type } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token || !job_no) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const dataEmail = auth.rows[0].team_email ?? email.toLowerCase();
    const row = await pool.query(`SELECT job_tags FROM user_machines WHERE id = $1 AND email = $2`, [id, dataEmail]);
    if (!row.rows.length) return res.status(404).json({ error: "Not found" });
    const existing: any[] = Array.isArray(row.rows[0].job_tags) ? row.rows[0].job_tags : [];
    const updated = [...existing.filter((t: any) => t.job_no !== job_no), { job_no, type: type || "assigned" }];
    await pool.query(`UPDATE user_machines SET job_tags = $1 WHERE id = $2 AND email = $3`, [JSON.stringify(updated), id, dataEmail]);
    res.json({ job_tags: updated });
  });

  // ── User machines: remove job tag ─────────────────────────────────────────
  app.delete("/api/user-machines/:id/job-tags/:job_no", async (req, res) => {
    const { email, token } = req.body;
    const id = parseInt(req.params.id);
    const job_no = req.params.job_no;
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const dataEmail = auth.rows[0].team_email ?? email.toLowerCase();
    const row = await pool.query(`SELECT job_tags FROM user_machines WHERE id = $1 AND email = $2`, [id, dataEmail]);
    if (!row.rows.length) return res.status(404).json({ error: "Not found" });
    const existing: any[] = Array.isArray(row.rows[0].job_tags) ? row.rows[0].job_tags : [];
    const updated = existing.filter((t: any) => t.job_no !== job_no);
    await pool.query(`UPDATE user_machines SET job_tags = $1 WHERE id = $2 AND email = $3`, [JSON.stringify(updated), id, dataEmail]);
    res.json({ job_tags: updated });
  });

  // ── User machines: delete ─────────────────────────────────────────────────
  app.delete("/api/user-machines/:id", async (req, res) => {
    const { email, token } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    await pool.query(`DELETE FROM user_machines WHERE id = $1 AND email = $2`, [id, email.toLowerCase()]);
    res.json({ ok: true });
  });

  // ── Toolbox: delete item ──────────────────────────────────────────────────
  app.delete("/api/toolbox/items/:id", async (req, res) => {
    const { email, token } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    await pool.query(`DELETE FROM toolbox_items WHERE id = $1 AND email = $2`, [id, email.toLowerCase()]);
    res.json({ ok: true });
  });

  app.patch("/api/toolbox/items/:id", async (req, res) => {
    const { email, token, title, job_no, part_name } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT team_email FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const dataEmail = auth.rows[0].team_email ?? email.toLowerCase();
    const fields: string[] = [];
    const vals: any[] = [];
    if (title?.trim()) { fields.push(`title = $${fields.length + 1}`); vals.push(title.trim()); }
    if (job_no !== undefined) { fields.push(`job_no = $${fields.length + 1}`); vals.push(job_no || ""); }
    if (part_name !== undefined) { fields.push(`part_name = $${fields.length + 1}`); vals.push(part_name || ""); }
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(id, dataEmail);
    const r = await pool.query(`UPDATE toolbox_items SET ${fields.join(", ")} WHERE id = $${vals.length - 1} AND email = $${vals.length} RETURNING *`, vals);
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
  });

  // ── Toolbox: toggle favorite (star) on a standard SKU ────────────────────
  // POST /api/toolbox/favorites  { email, token, edp, sku_data }
  //   → { ok, favorited: bool, id? }
  // DELETE /api/toolbox/favorites  { email, token, edp }  → { ok }
  // GET /api/toolbox/favorites?email=&token=  → [{ edp }]
  app.get("/api/toolbox/favorites", async (req, res) => {
    const { email, token } = req.query as { email: string; token: string };
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const rows = await pool.query(
      `SELECT data->>'edp' AS edp, id FROM toolbox_items WHERE email = $1 AND type = 'favorite' ORDER BY created_at DESC`,
      [email.toLowerCase()]
    );
    res.json(rows.rows);
  });

  app.post("/api/toolbox/favorites", async (req, res) => {
    const { email, token, edp, sku_data } = req.body;
    if (!email || !token || !edp) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    // Idempotent — only insert if not already favorited
    const existing = await pool.query(
      `SELECT id FROM toolbox_items WHERE email = $1 AND type = 'favorite' AND data->>'edp' = $2`,
      [email.toLowerCase(), edp]
    );
    if (existing.rows.length > 0) {
      return res.json({ ok: true, favorited: true, id: existing.rows[0].id });
    }
    const row = await pool.query(
      `INSERT INTO toolbox_items (email, type, title, data) VALUES ($1, 'favorite', $2, $3) RETURNING id`,
      [email.toLowerCase(), `Favorite — ${edp}`, JSON.stringify({ edp, ...sku_data })]
    );
    res.json({ ok: true, favorited: true, id: row.rows[0].id });
  });

  app.delete("/api/toolbox/favorites", async (req, res) => {
    const { email, token, edp } = req.body;
    if (!email || !token || !edp) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    await pool.query(
      `DELETE FROM toolbox_items WHERE email = $1 AND type = 'favorite' AND data->>'edp' = $2`,
      [email.toLowerCase(), edp]
    );
    res.json({ ok: true, favorited: false });
  });

  // ── User Specials: per-user repository of custom CC tools ─────────────────
  // GET    /api/specials?email=&token=          → [{ id, cc_number, description, notes, created_at }]
  // POST   /api/specials  { email, token, cc_number, description, notes }  → row
  // DELETE /api/specials/:id  { email, token }  → { ok }
  // PATCH  /api/specials/:id  { email, token, description?, notes? }  → row
  app.get("/api/specials", async (req, res) => {
    const { email, token } = req.query as { email: string; token: string };
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const rows = await pool.query(
      `SELECT id, cc_number, description, notes, created_at FROM user_specials WHERE email = $1 ORDER BY created_at DESC`,
      [email.toLowerCase()]
    );
    res.json(rows.rows);
  });

  app.post("/api/specials", async (req, res) => {
    const { email, token, cc_number, description, notes } = req.body;
    if (!email || !token || !cc_number?.trim()) return res.status(400).json({ error: "CC# is required" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const row = await pool.query(
      `INSERT INTO user_specials (email, cc_number, description, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
      [email.toLowerCase(), cc_number.trim().toUpperCase(), (description || "").trim(), (notes || "").trim()]
    );
    res.json(row.rows[0]);
  });

  app.delete("/api/specials/:id", async (req, res) => {
    const { email, token } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    await pool.query(`DELETE FROM user_specials WHERE id = $1 AND email = $2`, [id, email.toLowerCase()]);
    res.json({ ok: true });
  });

  app.patch("/api/specials/:id", async (req, res) => {
    const { email, token, description, notes } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const row = await pool.query(
      `UPDATE user_specials SET description = COALESCE($1, description), notes = COALESCE($2, notes) WHERE id = $3 AND email = $4 RETURNING *`,
      [description?.trim() ?? null, notes?.trim() ?? null, id, email.toLowerCase()]
    );
    if (!row.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(row.rows[0]);
  });

  // ── Material match: Level 1 alias + Level 3 AI ───────────────────────────
  app.post("/api/materials/match", async (req, res) => {
    try {
    const { input } = (req.body ?? {}) as { input?: string };
    if (!input || input.trim().length < 2) return res.status(400).json({ error: "Input too short" });

    // Level 1 — alias lookup: try full string, then each word/token, then pairs
    const normalized = input.trim().toLowerCase();
    let aliasMatch = matchMaterialAlias(normalized);
    if (!aliasMatch) {
      // try tokens (longest first so "17-4 ph" beats "ph")
      const tokens = normalized.split(/[\s,/]+/).filter(t => t.length > 1);
      const pairs = tokens.slice(0, -1).map((t, i) => `${t} ${tokens[i+1]}`);
      for (const candidate of [...pairs, ...tokens].sort((a,b) => b.length - a.length)) {
        const m = matchMaterialAlias(candidate);
        if (m) { aliasMatch = m; break; }
      }
    }
    if (aliasMatch) {
      const sub = ISO_SUBCATEGORIES.find(s => s.key === aliasMatch);
      return res.json({ key: aliasMatch, label: sub?.label ?? aliasMatch, confidence: "high", source: "alias", note: null });
    }

    // Level 3 — Claude AI matching
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "AI matching unavailable" });

    const catalogList = ISO_SUBCATEGORIES.map(s => `${s.key}: ${s.label}`).join("\n");
    try {
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [{
          role: "user",
          content: `You are a materials engineering expert. A machinist entered this material name: "${input}"

Match it to the CLOSEST entry from this catalog. Reply with ONLY a JSON object — no explanation:
{"key":"<catalog_key>","confidence":"high|medium|low","note":"<one sentence why, or null if obvious>"}

If truly unmatchable, reply: {"key":null,"confidence":"low","note":"<brief reason>"}

CATALOG:
${catalogList}`
        }]
      });
      const text = (msg.content[0] as any).text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.key) return res.json({ key: null, confidence: "low", source: "ai", note: parsed.note ?? "No close match found in catalog." });
      const sub = ISO_SUBCATEGORIES.find(s => s.key === parsed.key);
      return res.json({ key: parsed.key, label: sub?.label ?? parsed.key, confidence: parsed.confidence, source: "ai", note: parsed.note ?? null });
    } catch (e) {
      return res.status(500).json({ error: "AI matching failed" });
    }
    } catch (e) {
      return res.status(500).json({ error: "Match request failed" });
    }
  });

  // ── Deep Pocket / Thin Wall sequence advisor ─────────────────────────────
  app.post("/api/deep-pocket/sequence", async (req, res) => {
    try {
      const { target_depth, corner_radius, floor_radius, cutting_style, thin_wall, closed_pocket, pocket_length, pocket_width, pre_drill_dia, material, iso_category, flutes, tool_dia, stickout, toolholder, machine_hp, machine_max_rpm, spindle_drive } = req.body as {
        target_depth: number; corner_radius: number; floor_radius: number; cutting_style: "hem" | "traditional";
        thin_wall: boolean; closed_pocket: boolean; pocket_length: number; pocket_width: number;
        pre_drill_dia: number; material: string; iso_category: string;
        flutes: number; tool_dia: number; stickout: number; toolholder: string;
        machine_hp: number; machine_max_rpm: number; spindle_drive: string;
      };

      if (!(target_depth > 0)) return res.status(400).json({ error: "target_depth required" });
      if (!(corner_radius > 0)) return res.status(400).json({ error: "corner_radius required" });

      const { pool } = await import("./db");

      // ── 1. Corner radius → max tool diameters ──────────────────────────────
      // Bulk roughers just need to fit inside the pocket — no corner constraint.
      // Corner radius only limits the FINAL finishing tool (must be ≤ wall-to-wall corner dia).
      // wall-to-wall diameter = corner_radius * 2; finishing tool must be ≤ that × cornerFactor.
      const cornerFactor = 0.99; // finishing tool dia ≤ wall-to-wall dia (corner_radius*2), slight clearance
      const maxCornerDia = corner_radius * 2 * cornerFactor;

      // For closed pockets, bulk tool must physically fit inside — cap by pocket narrowest dim × 0.85
      // For closed pockets, bulk tool must fit AND leave clearance for HEM passes.
      // HEM needs the tool to traverse the pocket — cap at 50% of narrowest dim so the
      // non-cutting side doesn't rub the opposite wall during radial passes.
      // Traditional: 65% (wider WOC, less traversal needed).
      // Open pockets: no pocket-dim constraint.
      const hemFit   = cutting_style === "hem" ? 0.50 : 0.65;
      const pocketCeilingDia = closed_pocket && pocket_length > 0 && pocket_width > 0
        ? Math.min(pocket_length, pocket_width) * hemFit
        : Infinity;
      // HEM: hard cap at 0.625" — keeps radial forces manageable at depth.
      // Traditional: no hard cap beyond pocket ceiling (wider WOC tolerates larger dia).
      const hemDiaCap = cutting_style === "hem" ? 0.625 : Infinity;
      const maxBulkDia = Math.min(
        pocketCeilingDia < Infinity ? pocketCeilingDia : 2.0,
        hemDiaCap
      );

      // ── Material-appropriate coating + flute filters ───────────────────────
      // ISO N (aluminum): D-Max or A-Max coating, 2–3 flutes
      // ISO P/M/K/S/H (steel/stainless/titanium/superalloy/hardened): P-Max or T-Max, 4+ flutes
      const isoUpper = (iso_category ?? "").toUpperCase();
      const isAluminum = isoUpper === "N";
      const coatingFilter = isAluminum
        ? `AND (coating ILIKE 'D-Max%' OR coating ILIKE 'A-Max%' OR coating IS NULL OR coating = '')`
        : `AND (coating ILIKE 'P-Max%' OR coating ILIKE 'T-Max%')`;
      const fluteFilter = isAluminum
        ? `AND flutes <= 3`
        : `AND flutes >= 4`;

      // ── 2. Catalog lookup — available diameters with depth coverage ─────────
      // Key rule: for RN tools, lbs_in IS the reach; for standard tools, loc_in is the reach
      // LBS tools always have shorter LOC — reach = lbs_in when lbs_in > 0, else loc_in
      const coverageRows = await pool.query(`
        SELECT
          cutting_diameter_in,
          MAX(loc_in)                                          AS max_loc,
          MAX(lbs_in)                                         AS max_lbs,
          MAX(COALESCE(lbs_in, loc_in))                       AS max_reach,
          COUNT(CASE WHEN lbs_in > 0 THEN 1 END)              AS rn_count,
          COUNT(CASE WHEN corner_condition = 'ball' THEN 1 END) AS ball_count
        FROM skus
        WHERE tool_type = 'endmill'
          AND cutting_diameter_in > 0
          ${coatingFilter}
          ${fluteFilter}
        GROUP BY cutting_diameter_in
        ORDER BY cutting_diameter_in DESC
      `);
      const coverage: Array<{
        cutting_diameter_in: string; max_loc: string; max_lbs: string;
        max_reach: string; rn_count: string; ball_count: string;
      }> = coverageRows.rows;

      // ── 2b. Corner-specific coverage — only ball/CR tools that reach depth ──
      const cornerCoverageRows = await pool.query(`
        SELECT cutting_diameter_in, MAX(COALESCE(lbs_in, loc_in)) AS max_reach
        FROM skus
        WHERE tool_type = 'endmill'
          AND cutting_diameter_in > 0
          AND corner_condition != 'square'
          AND (
            corner_condition = 'ball'
            OR (corner_condition ~ '^[0-9.]+$'
                AND (corner_condition::numeric <= $1::numeric)
                AND ($2::numeric = 0 OR corner_condition::numeric >= $2::numeric))
          )
          ${coatingFilter}
        GROUP BY cutting_diameter_in
        ORDER BY cutting_diameter_in DESC
      `, [corner_radius, floor_radius ?? 0]);
      const cornerCoverage: Array<{ cutting_diameter_in: string; max_reach: string }> = cornerCoverageRows.rows;

      // ── 3. Corner dia picker (unchanged single-pass logic) ────────────────────
      // L/D target: HEM 5×D (light WOC keeps radial force low, tolerates more reach),
      // Traditional 4×D (higher radial force at 40-60% WOC needs shorter reach).
      // Higher flute count tools have larger core dia → stiffer → effectively better L/D,
      // but we use a single target and let flute-count sorting pick the best EDP within it.
      const ldTarget = cutting_style === "hem" ? 5.0 : 4.0;

      const findBestCornerDia = (maxDia: number, cov: Array<{ cutting_diameter_in: string; max_reach: string }>): typeof cov[0] | null => {
        for (const row of cov) {
          const dia = parseFloat(row.cutting_diameter_in);
          if (dia > maxDia) continue;
          if (parseFloat(row.max_reach) < target_depth) continue;
          if (target_depth / dia <= ldTarget) return row;
        }
        for (const row of cov) {
          const dia = parseFloat(row.cutting_diameter_in);
          if (dia > maxDia) continue;
          if (parseFloat(row.max_reach) >= target_depth) return row;
        }
        return null;
      };

      const cornerRow = findBestCornerDia(maxCornerDia, cornerCoverage);

      // ── 4. Progressive bulk sequence — multi-diameter, top to bottom ─────────
      // Walk depth bands: at each band pick the LARGEST diameter whose max_reach
      // covers that band AND whose L/D (band_depth / dia) stays within ldTarget.
      // Larger tools at shallow depth → smaller/longer tools as depth increases.
      // Cap at 3 tools to keep the sequence practical.
      interface SeqTool {
        role: "bulk" | "corner_finish";
        edp: string; description: string;
        dia: number; flutes: number; loc_in: number; lbs_in: number; reach_in: number;
        depth_band_from: number; depth_band_to: number;
        corner_condition: string; series: string; geometry: string;
        helix: number; variable_pitch: boolean; variable_helix: boolean; shank_dia: number;
        entry: { type: string; helix_dia?: number; angle_deg?: number };
        is_rn: boolean;
      }

      interface ToolRow { edp: string; description1: string; description2: string;
        cutting_diameter_in: string; flutes: number; loc_in: string; lbs_in: string;
        reach_in: string; corner_condition: string; series: string; geometry: string;
        helix: number; variable_pitch: boolean; variable_helix: boolean; shank_dia_in: string; is_rn: boolean; }

      // Fetch best tool at a given diameter that reaches the required depth.
      //
      // Stability selection priority:
      //   1. Chipbreaker geometry preferred for standard-LOC (non-RN) slots — ~20% force
      //      reduction improves deflection directly. Not available in necked tooling, so
      //      RN slots exclude it. Truncated rougher excluded (needs wide WOC we can't guarantee).
      //   2. Variable pitch preferred — disrupts regenerative chatter, critical for HEM.
      //   3. Higher flute count for HEM (more teeth → larger core → stiffer, higher MRR).
      //      Lower flute count for Traditional (chip clearance at 40–60% WOC).
      //      More flutes also means larger core diameter → higher second moment of area → stiffer.
      //   4. Shortest reach that covers the band (minimize L/D within the band).
      //
      // allowRn: false for the final deep tool (will be fetched separately as RN); true means
      //   we want the shortest standard LOC tool — chipbreaker eligible.
      // Flute count order by context:
      // - Upper bands (standard LOC): HEM → more flutes (MRR); Traditional → fewer (chip clearance at wide WOC)
      // - Deep RN bands (long reach): always prefer MORE flutes regardless of style —
      //   more flutes = lighter chip load per tooth = less radial force = less deflection.
      //   At long reach you must reduce WOC anyway so chip clearance isn't the constraint.
      const fluteOrderUpper = cutting_style === "hem" ? "DESC" : "ASC";
      const fluteOrderDeep  = "DESC"; // always more flutes for deep RN — force/deflection dominant

      const fetchBestToolAtDia = async (dia: number, minReach: number, preferRn = false): Promise<ToolRow | null> => {
        const fluteOrder = preferRn ? fluteOrderDeep : fluteOrderUpper;

        const selectCols = `edp, description1, description2, cutting_diameter_in, flutes,
                   loc_in, lbs_in, COALESCE(lbs_in, loc_in) as reach_in,
                   corner_condition, series, geometry, helix, variable_pitch, variable_helix, shank_dia_in,
                   (lbs_in IS NOT NULL AND lbs_in != '0') as is_rn`;
        const orderBy = `CASE WHEN variable_pitch = true THEN 0 ELSE 1 END ASC, flutes ${fluteOrder}, COALESCE(lbs_in, loc_in) ASC`;

        // Corner radius preferred for all roughing — better tool life, edge protection
        // Priority for standard-LOC (non-RN) bands:
        //   1. R030 CR + chipbreaker  (best stocked CR size + force reduction)
        //   2. R030 CR + standard
        //   3. Any other CR + chipbreaker
        //   4. Any other CR + standard
        //   5. Square + chipbreaker
        //   6. Square + standard
        // For RN bands: same CR preference order, no chipbreaker (not available in RN)

        // DB stores CR as plain decimal string: '0.03', '0.06', '0.09', '0.125' etc. — NOT 'corner_radius'
        const R030  = `AND corner_condition = '0.03'`;
        const anyCR = `AND corner_condition NOT IN ('square','ball') AND corner_condition ~ '^[0-9.]+'`;
        const square = `AND corner_condition = 'square'`;
        const cbGeo  = `AND geometry = 'chipbreaker' AND lbs_in IS NULL`;
        const stdGeo = `AND geometry NOT IN ('chipbreaker','truncated_rougher') AND lbs_in IS NULL`;
        const rnGeo  = `AND geometry NOT IN ('chipbreaker','truncated_rougher')`;

        const tryQuery = (cornerFilter: string, geoFilter: string) => pool.query(`
          SELECT ${selectCols} FROM skus
          WHERE tool_type = 'endmill' AND cutting_diameter_in = $1
            ${cornerFilter} ${geoFilter}
            AND COALESCE(lbs_in, loc_in) >= $2
            ${coatingFilter} ${fluteFilter}
          ORDER BY ${orderBy} LIMIT 1
        `, [dia, minReach]);

        if (!preferRn) {
          const r1 = await tryQuery(R030, cbGeo);   if (r1.rows.length) return r1.rows[0];
          const r2 = await tryQuery(R030, stdGeo);  if (r2.rows.length) return r2.rows[0];
          const r3 = await tryQuery(anyCR, cbGeo);  if (r3.rows.length) return r3.rows[0];
          const r4 = await tryQuery(anyCR, stdGeo); if (r4.rows.length) return r4.rows[0];
          const r5 = await tryQuery(square, cbGeo); if (r5.rows.length) return r5.rows[0];
          const r6 = await tryQuery(square, `AND geometry NOT IN ('truncated_rougher') AND lbs_in IS NULL`);
          return r6.rows[0] ?? null;
        } else {
          // RN bands — .030 CR first, then any CR, then square; no chipbreaker
          const r1 = await tryQuery(R030, rnGeo);   if (r1.rows.length) return r1.rows[0];
          const r2 = await tryQuery(anyCR, rnGeo);  if (r2.rows.length) return r2.rows[0];
          const r3 = await tryQuery(square, rnGeo);
          return r3.rows[0] ?? null;
        }
      };

      const buildBulkSequence = async (): Promise<SeqTool[]> => {
        // Build candidate list: all diameters <= maxBulkDia that have any reach > 0, sorted largest first
        const candidates = coverage.filter(r => parseFloat(r.cutting_diameter_in) <= maxBulkDia);
        if (!candidates.length) return [];

        // Progressive band selection: greedily pick largest-dia tool for each depth band
        const sequence: { tool: ToolRow; bandFrom: number; bandTo: number }[] = [];
        let depthCovered = 0;
        const MAX_TOOLS = 4;

        while (depthCovered < target_depth && sequence.length < MAX_TOOLS) {
          let picked: { tool: ToolRow; reach: number; dia: number; useRn: boolean } | null = null;

          const isLastSlot = sequence.length === MAX_TOOLS - 1;

          for (const row of candidates) {
            const dia = parseFloat(row.cutting_diameter_in);
            const maxLoc   = parseFloat(row.max_loc   || "0"); // longest standard LOC (no LBS)
            const maxReach = parseFloat(row.max_reach || "0"); // longest reach incl. RN/LBS

            // For non-last slots: prefer standard LOC tool (short, stiff) — use max_loc as band ceiling
            // For last slot: must reach full depth — allow RN/LBS
            const effectiveReach = isLastSlot ? maxReach : (maxLoc > depthCovered ? maxLoc : maxReach);
            if (effectiveReach <= depthCovered) continue;

            const ld = effectiveReach / dia;
            const reachesAll = maxReach >= target_depth;

            if (isLastSlot) {
              if (reachesAll) { picked = { tool: null as any, reach: maxReach, dia, useRn: true }; break; }
            } else {
              const bandGain = effectiveReach - depthCovered;
              if (ld <= ldTarget && bandGain >= dia * 0.5) {
                // Prefer standard LOC; only use RN reach if no standard LOC extends coverage
                const useRn = maxLoc <= depthCovered;
                picked = { tool: null as any, reach: effectiveReach, dia, useRn }; break;
              }
            }
          }

          if (!picked) {
            // No candidate met criteria — fall back to largest that extends coverage at all
            const fallback = candidates.find(r => parseFloat(r.max_reach) > depthCovered);
            if (!fallback) break;
            picked = { tool: null as any, reach: parseFloat(fallback.max_reach), dia: parseFloat(fallback.cutting_diameter_in), useRn: true };
          }

          // Fetch actual EDP: standard LOC for upper bands, RN for last/deep bands
          const bandTo = Math.min(picked.reach, target_depth);
          const isLastBand = bandTo >= target_depth;
          const tool = await fetchBestToolAtDia(picked.dia, bandTo, picked.useRn || isLastBand);
          if (!tool) break;

          // Avoid duplicate diameter (same dia twice in a row)
          if (sequence.length > 0 && parseFloat(sequence[sequence.length-1].tool.cutting_diameter_in) === picked.dia) break;

          sequence.push({ tool, bandFrom: depthCovered, bandTo });
          depthCovered = bandTo;
        }

        if (!sequence.length) return [];

        // Map to SeqTool with entry logic
        return sequence.map(({ tool: t, bandFrom, bandTo }, i) => {
          const reach = parseFloat(t.reach_in);
          const loc = parseFloat(t.loc_in);
          const lbs = parseFloat(t.lbs_in ?? "0") || 0;
          const toolDia = parseFloat(t.cutting_diameter_in);

          let entry: SeqTool["entry"];
          if (i === 0) {
            if (!closed_pocket) {
              // Open pocket — tool sweeps in from open edge, no ramp needed
              entry = { type: "sweep_in" };
            } else if (pre_drill_dia > 0 && pre_drill_dia >= toolDia) {
              entry = { type: "straight_drop" };
            } else if (pre_drill_dia > 0 && pre_drill_dia < toolDia) {
              entry = { type: "helical", helix_dia: +(pre_drill_dia - 0.020).toFixed(4), angle_deg: cutting_style === "hem" ? 2 : 3 };
            } else {
              entry = { type: "helical", helix_dia: +(toolDia * 0.93).toFixed(4), angle_deg: cutting_style === "hem" ? 2 : 3 };
            }
          } else {
            entry = { type: "plunge_to_prior_depth" };
          }

          return {
            role: "bulk" as const,
            edp: t.edp,
            description: [t.description1, t.description2].filter(Boolean).join(" — "),
            dia: toolDia, flutes: t.flutes,
            loc_in: loc, lbs_in: lbs, reach_in: reach,
            depth_band_from: +bandFrom.toFixed(4), depth_band_to: +bandTo.toFixed(4),
            corner_condition: t.corner_condition, series: t.series ?? "", geometry: t.geometry ?? "standard",
            helix: t.helix ?? 0, variable_pitch: !!t.variable_pitch, variable_helix: !!t.variable_helix,
            shank_dia: parseFloat(t.shank_dia_in ?? "0") || 0,
            entry, is_rn: t.is_rn,
          } as SeqTool;
        });
      };

      // ── 5. Corner finish tool (single tool) ────────────────────────────────
      const buildCornerTool = async (row: { cutting_diameter_in: string; max_reach: string; [k: string]: any }): Promise<SeqTool | null> => {
        const dia = parseFloat(row.cutting_diameter_in);
        const useBallNose = dia < 0.250;

        // Ball nose: corner dia < 0.250" — matches corner radius exactly via axial engagement
        // Corner radius (bull nose): corner dia >= 0.250" — CR tool whose radius <= pocket corner radius
        // Never use square corner for a corner finishing tool
        let toolRows;
        if (useBallNose) {
          toolRows = await pool.query(`
            SELECT edp, description1, description2, cutting_diameter_in, flutes,
                   loc_in, lbs_in, COALESCE(lbs_in, loc_in) as reach_in,
                   corner_condition, series, geometry, helix, variable_pitch, variable_helix, shank_dia_in,
                   (lbs_in > 0) as is_rn
            FROM skus
            WHERE tool_type = 'endmill'
              AND cutting_diameter_in = $1
              AND corner_condition = 'ball'
              AND COALESCE(lbs_in, loc_in) >= $2
              ${coatingFilter}
            ORDER BY COALESCE(lbs_in, loc_in) DESC
            LIMIT 1
          `, [dia, target_depth]);
        } else {
          // Prefer corner radius tool; fall back to ball nose if no CR tool stocked at this dia
          toolRows = await pool.query(`
            SELECT edp, description1, description2, cutting_diameter_in, flutes,
                   loc_in, lbs_in, COALESCE(lbs_in, loc_in) as reach_in,
                   corner_condition, series, geometry, helix, variable_pitch, variable_helix, shank_dia_in,
                   (lbs_in > 0) as is_rn
            FROM skus
            WHERE tool_type = 'endmill'
              AND cutting_diameter_in = $1
              AND corner_condition NOT IN ('square')
              AND (
                corner_condition = 'ball'
                OR (corner_condition ~ '^[0-9.]+$'
                    AND (corner_condition::numeric <= $3::numeric)
                    AND ($4::numeric = 0 OR corner_condition::numeric >= $4::numeric))
              )
              AND COALESCE(lbs_in, loc_in) >= $2
              ${coatingFilter}
            ORDER BY
              -- Prefer CR over ball; among CR tools prefer largest radius that still fits floor (closest match)
              CASE WHEN corner_condition = 'ball' THEN 1 ELSE 0 END ASC,
              CASE WHEN corner_condition ~ '^[0-9.]+$' THEN corner_condition::numeric ELSE 999 END DESC,
              COALESCE(lbs_in, loc_in) ASC
            LIMIT 1
          `, [dia, target_depth, corner_radius, floor_radius || 0]);
        }

        if (!toolRows.rows.length) return null;
        const t = toolRows.rows[0];
        const reach = parseFloat(t.reach_in);
        const loc = parseFloat(t.loc_in);
        const lbs = parseFloat(t.lbs_in ?? "0") || 0;

        return {
          role: "corner_finish",
          edp: t.edp,
          description: [t.description1, t.description2].filter(Boolean).join(" — "),
          dia: parseFloat(t.cutting_diameter_in), flutes: t.flutes,
          loc_in: loc, lbs_in: lbs, reach_in: reach,
          depth_band_from: 0, depth_band_to: target_depth,
          corner_condition: t.corner_condition, series: t.series ?? "", geometry: t.geometry ?? "standard",
          helix: t.helix ?? 0, variable_pitch: !!t.variable_pitch, variable_helix: !!t.variable_helix,
          shank_dia: parseFloat(t.shank_dia_in ?? "0") || 0,
          entry: { type: "plunge_from_bulk_path" },
          is_rn: t.is_rn,
        };
      };

      // ── 6. Assemble result ──────────────────────────────────────────────────
      const bulk_tools: SeqTool[] = await buildBulkSequence();
      const needs_special = bulk_tools.length === 0;
      type CovRow = typeof coverage[0];

      // Corner tool: if no tool fits the corner radius constraint, fall back to the
      // smallest-diameter tool in the full coverage list that reaches depth.
      // This clears as much material as possible — leaves stock at corners for manual finish or special.
      let corner_tool: SeqTool | null = cornerRow ? await buildCornerTool(cornerRow) : null;
      let corner_oversize = false;
      let corner_oversize_note: string | null = null;

      if (!corner_tool) {
        // Find smallest dia in full coverage that reaches depth (unconstrained by corner)
        const fallbackRow = [...coverage].reverse().find(
          r => parseFloat(r.max_reach) >= target_depth
        );
        if (fallbackRow) {
          const fallbackTool = await buildCornerTool(fallbackRow as CovRow);
          if (fallbackTool) {
            corner_tool = fallbackTool;
            corner_oversize = true;
            const stockLeft = (fallbackTool.dia / 2 - corner_radius).toFixed(4);
            corner_oversize_note = `No standard ball/CR tool reaches ${target_depth}" at ≤${maxCornerDia.toFixed(4)}" dia. Using Ø${fallbackTool.dia.toFixed(4)}" as closest available — leaves ~${stockLeft}" stock at corners. Contact Core Cutter for a deep-reach reduced-neck CR tool to finish corners to print.`;
          }
        }
      }

      // Feed mill eligibility + estimated cycle time
      const feedmill_eligible = true;

      // Feed mill cycle time estimate — show two sizes:
      //   Large: matches largest bulk rougher (max MRR, fewer passes, more Z force)
      //   Small: matches smallest bulk rougher or one step down (less Z force, fits tighter pockets)
      // Standard feed mill CR = 0.060" dual-radius design
      const FM_FLUTES = 4;
      const FM_CR = 0.060;
      const fmParams: Record<string, { sfm: number; ipt: number }> = {
        P: { sfm: 337, ipt: 0.010 },
        M: { sfm: 230, ipt: 0.008 },
        K: { sfm: 315, ipt: 0.010 },
        S: { sfm: 115, ipt: 0.005 },
        H: { sfm: 200, ipt: 0.007 },
        N: { sfm: 850, ipt: 0.014 },
      };
      const fmMat = fmParams[(iso_category ?? "P").toUpperCase()] ?? fmParams["P"];

      // Standard sizes available as specials
      const FM_SIZES = [0.250, 0.375, 0.500, 0.625, 0.750, 1.000];
      const bulkDias = bulk_tools.map(t => t.dia).filter(d => d > 0);
      const largestBulk = bulkDias.length > 0 ? Math.max(...bulkDias) : 0.625;
      const smallestBulk = bulkDias.length > 0 ? Math.min(...bulkDias) : 0.375;

      // Large FM: largest standard size ≤ largestBulk (same footprint as first rougher)
      const fmLargeDia = FM_SIZES.filter(d => d <= largestBulk).slice(-1)[0] ?? 0.625;
      // Small FM: one step down from smallest bulk tool (less Z pressure option)
      const fmSmallDia = FM_SIZES.filter(d => d < smallestBulk).slice(-1)[0] ?? FM_SIZES[0];

      function fmEstimate(dia: number) {
        const doc = Math.min(0.8 * FM_CR, 0.12 * dia);
        const rpm = (fmMat.sfm * 12) / (Math.PI * dia);
        const feed = rpm * FM_FLUTES * fmMat.ipt;
        const woc = dia * 0.08;
        const depth = target_depth * 0.95;
        const zPasses = Math.ceil(depth / doc);
        const xPasses = closed_pocket && pocket_length > 0 && pocket_width > 0
          ? Math.ceil((pocket_width - dia) / woc)
          : Math.ceil((corner_radius * 2 * 4) / woc);
        const passLen = closed_pocket && pocket_length > 0 ? pocket_length : corner_radius * 8;
        const minutes = Math.round((zPasses * xPasses * passLen) / feed * 1.10);
        const timeStr = minutes < 1 ? "< 1 min" : minutes === 1 ? "~1 min" : `~${minutes} min`;
        return { dia, doc_in: +doc.toFixed(4), z_passes: zPasses, feed_ipm: +feed.toFixed(0), rpm: +rpm.toFixed(0), est_str: timeStr };
      }

      const feedmill_estimate = {
        large: fmEstimate(fmLargeDia),
        small: fmSmallDia !== fmLargeDia ? fmEstimate(fmSmallDia) : null,
      };

      // Thin wall WOC taper schedule
      const woc_taper = thin_wall ? (
        cutting_style === "hem"
          ? [
              { zone: "> 0.100\" from wall", woc_pct: 10 },
              { zone: "0.030–0.100\" from wall", woc_pct: 5 },
              { zone: "Final wall pass", woc_pct: 3, note: "Spring pass recommended" },
            ]
          : [
              { zone: "Open zone", woc_pct: 50 },
              { zone: "Mid zone", woc_pct: 30 },
              { zone: "< 0.100\" from wall", woc_pct: 10 },
              { zone: "Final wall pass", woc_pct: 5, note: "Spring pass recommended" },
            ]
      ) : null;

      // Special flag details
      let special_note: string | null = null;
      if (needs_special) {
        // Find largest dia that fits corner at all (even if it can't reach depth)
        const anyFit = coverage.find(r => parseFloat(r.cutting_diameter_in) <= maxBulkDia);
        if (anyFit) {
          special_note = `Depth ${target_depth}" exceeds max catalog reach (${anyFit.max_reach}") for Ø${parseFloat(anyFit.cutting_diameter_in).toFixed(4)}" tools. Step up to a larger diameter if corner allows, or contact Core Cutter for a quoted special.`;
        } else {
          special_note = `Corner radius ${corner_radius}" is too tight for any standard diameter at this depth. Contact Core Cutter for a quoted special.`;
        }
      }

      // For closed pockets, recommend the largest standard drill that fits the pocket,
      // drilled to full depth. Drill is the fastest axial roughing tool — use it to its max.
      // Max drill dia = pocketCeilingDia (min pocket dim × 0.85), capped at maxBulkDia for
      // endmill clearance. Snapped down to nearest standard fractional/letter/number drill.
      const STANDARD_DRILLS_IN = [
        0.0135,0.0145,0.0156,0.0160,0.0177,0.0180,0.0197,0.0200,0.0210,0.0225,0.0240,0.0250,
        0.0260,0.0280,0.0292,0.0310,0.0313,0.0320,0.0330,0.0350,0.0360,0.0370,0.0380,0.0390,
        0.0400,0.0410,0.0420,0.0430,0.0465,0.0469,0.0520,0.0550,0.0595,0.0625,0.0635,0.0670,
        0.0700,0.0730,0.0760,0.0785,0.0810,0.0820,0.0860,0.0890,0.0935,0.0938,0.0960,0.0980,
        0.1015,0.1040,0.1065,0.1094,0.1100,0.1110,0.1130,0.1160,0.1200,0.1250,0.1285,0.1360,
        0.1405,0.1406,0.1440,0.1470,0.1495,0.1520,0.1540,0.1563,0.1570,0.1590,0.1610,0.1660,
        0.1695,0.1719,0.1730,0.1770,0.1800,0.1820,0.1850,0.1875,0.1890,0.1910,0.1935,0.1960,
        0.1990,0.2010,0.2031,0.2040,0.2055,0.2090,0.2130,0.2188,0.2210,0.2280,0.2340,0.2344,
        0.2380,0.2420,0.2460,0.2500,0.2570,0.2610,0.2656,0.2660,0.2720,0.2770,0.2813,0.2900,
        0.2950,0.3020,0.3125,0.3160,0.3230,0.3281,0.3320,0.3390,0.3438,0.3480,0.3580,0.3594,
        0.3680,0.3750,0.3860,0.3906,0.3970,0.4040,0.4063,0.4130,0.4219,0.4375,0.4531,0.4688,
        0.4844,0.5000,0.5156,0.5313,0.5469,0.5625,0.5781,0.5938,0.6094,0.6250,0.6406,0.6563,
        0.6719,0.6875,0.7031,0.7188,0.7344,0.7500,0.7656,0.7813,0.7969,0.8125,0.8281,0.8438,
        0.8594,0.8750,0.8906,0.9063,0.9219,0.9375,0.9531,0.9688,0.9844,1.0000,1.0156,1.0313,
        1.0469,1.0625,1.0781,1.0938,1.1094,1.1250,1.1406,1.1563,1.1719,1.1875,1.2031,1.2188,
        1.2344,1.2500,1.2656,1.2813,1.2969,1.3125,1.3281,1.3438,1.3594,1.3750,1.3906,1.4063,
        1.4219,1.4375,1.4531,1.4688,1.4844,1.5000,1.5625,1.6250,1.6875,1.7500,1.8125,1.8750,
        1.9375,2.0000,2.0625,2.1250,2.1875,2.2500,2.3125,2.3750,2.4375,2.5000,
      ];
      function snapDrillDown(maxDia: number): number | null {
        const fits = STANDARD_DRILLS_IN.filter(d => d <= maxDia);
        return fits.length > 0 ? fits[fits.length - 1] : null;
      }
      const drillMaxDia = pocketCeilingDia < Infinity ? Math.min(pocketCeilingDia, maxBulkDia) : maxBulkDia;
      const recommended_pre_drill_dia = closed_pocket
        ? snapDrillDown(drillMaxDia * 0.99) // tiny margin so we're clearly under ceiling
        : null;
      // Depth = pocket depth - 5% — leaves floor stock for endmill to clean up
      const recommended_pre_drill_depth = closed_pocket
        ? +( target_depth * 0.95).toFixed(4)
        : null;

      // Min clearance dia — endmill needs at least this to drop in (kept for warning logic)
      const largestBulkDia = bulk_tools.length > 0 ? bulk_tools[0].dia : null;
      const required_pre_drill_dia = closed_pocket && largestBulkDia
        ? +( largestBulkDia * 1.05).toFixed(4)
        : null;
      const required_pre_drill_depth = null; // deprecated — use recommended_pre_drill_depth

      return res.json({
        ok: true,
        inputs: { target_depth, corner_radius, floor_radius: floor_radius || 0, cutting_style, thin_wall, closed_pocket, pre_drill_dia, pocket_length, pocket_width, iso_category },
        constraints: {
          max_bulk_dia: +maxBulkDia.toFixed(4),
          max_corner_dia: +maxCornerDia.toFixed(4),
          pocket_ceiling_dia: pocketCeilingDia === Infinity ? null : +pocketCeilingDia.toFixed(4),
          bulk_dia: bulk_tools[0]?.dia ?? null,
          corner_dia: cornerRow ? parseFloat(cornerRow.cutting_diameter_in) : null,
        },
        needs_special,
        special_note,
        bulk_tools,
        corner_tool,
        corner_oversize,
        corner_oversize_note,
        feedmill_eligible,
        feedmill_estimate,
        woc_taper,
        closed_pocket,
        required_pre_drill_dia,
        required_pre_drill_depth,
        recommended_pre_drill_dia,
        recommended_pre_drill_depth,
      });

    } catch (err: any) {
      console.error("deep-pocket sequence error:", err?.message ?? err);
      return res.status(500).json({ error: "Sequence lookup failed" });
    }
  });

  return httpServer;
}
