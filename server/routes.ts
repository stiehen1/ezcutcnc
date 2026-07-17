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
        // Never write .pyc bytecode. A stale __pycache__/legacy_engine.*.pyc whose
        // mtime ended up NEWER than the source caused Python to load old bytecode and
        // silently ignore engine edits (e.g. the min-chip-floor fix didn't take effect
        // on dev until the cache was deleted). Running from source every spawn prevents
        // that — the bridge is short-lived so there's no compile-cost concern.
        PYTHONDONTWRITEBYTECODE: "1",
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
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS job_number TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS job_description TEXT NOT NULL DEFAULT ''`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS user_specials_email_cc_idx ON user_specials (email, cc_number)`);
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS tool_dia NUMERIC`);
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS flutes INTEGER`);
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS loc NUMERIC`);
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS step_diameters JSONB`);
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS point_angle INTEGER`);
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS oal NUMERIC`);
    await pool.query(`ALTER TABLE user_specials ADD COLUMN IF NOT EXISTS step_lengths JSONB`);
    // Back-fill geometry from description for existing rows that have nulls
    // Description format: "Ø0.103", 2-fl, step drill, 0.625" LOC, A-MAX"
    await pool.query(`
      UPDATE user_specials SET
        tool_dia = CASE WHEN tool_dia IS NULL AND description ~ 'Ø[0-9]+\\.[0-9]+'
                        THEN (regexp_match(description, 'Ø([0-9]+\\.[0-9]+)'))[1]::NUMERIC ELSE tool_dia END,
        flutes   = CASE WHEN flutes IS NULL AND description ~ '[0-9]+-fl'
                        THEN (regexp_match(description, '([0-9]+)-fl'))[1]::INTEGER ELSE flutes END,
        loc      = CASE WHEN loc IS NULL AND description ~ '[0-9]+\\.[0-9]+" LOC'
                        THEN (regexp_match(description, '([0-9]+\\.[0-9]+)" LOC'))[1]::NUMERIC ELSE loc END
      WHERE tool_dia IS NULL OR flutes IS NULL OR loc IS NULL
    `);
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
    // sub_spindle_rpm also needs to exist on the catalog (machines) table — was missing
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS sub_spindle_rpm INTEGER`);
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
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS way_type TEXT`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS way_type TEXT`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS base_torque_ftlb NUMERIC(8,2)`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS peak_torque_ftlb NUMERIC(8,2)`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS peak_torque_rpm INTEGER`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS rated_rpm INTEGER`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS curve_confidence TEXT`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS spindle_count INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS spindle_count INTEGER DEFAULT 1`);

    // ── Makino MAG spindle corrections (ids 346-353) ────────────────────────
    // MAG A-series and MAG1/3/4 all use 33,000 rpm HSK-F80 direct-drive spindle,
    // 130 kW peak (~170 hp). Previous data had wrong CAT50/gear entries.
    await pool.query(`
      UPDATE machines SET
        taper = 'HSK-F80',
        drive_type = 'direct',
        max_rpm = 33000,
        spindle_hp = 170,
        base_torque_ftlb = 208,
        peak_torque_rpm = 26000,
        rated_rpm = 26000,
        curve_confidence = 'medium',
        way_type = 'linear'
      WHERE id IN (346, 347, 348, 349, 350, 351, 352, 353)
        AND brand = 'Makino'
    `);

    // ── Haas way_type corrections ───────────────────────────────────────────
    // All modern Haas VF/UMC/EC-40-taper/DM/DT series: linear guides
    await pool.query(`
      UPDATE machines SET way_type = 'linear'
      WHERE brand = 'Haas'
        AND (taper = 'CAT40' OR taper = 'BT30')
        AND way_type IS NULL
    `);
    // Large Haas EC 50-taper horizontals: box ways
    await pool.query(`
      UPDATE machines SET way_type = 'box'
      WHERE brand = 'Haas'
        AND taper = 'CAT50'
        AND way_type IS NULL
    `);

    // ── Mazak way_type and spindle corrections ──────────────────────────────
    // VCN series: CAT40 direct 12000 rpm, MX roller guideways = linear
    await pool.query(`
      UPDATE machines SET way_type = 'linear', drive_type = 'direct', max_rpm = 12000, taper = 'CAT40'
      WHERE brand = 'Mazak' AND model ILIKE 'VCN-%' AND way_type IS NULL
    `);
    // VARIAXIS i-series: HSK-A63, direct, 15000+ rpm, linear
    await pool.query(`
      UPDATE machines SET way_type = 'linear', drive_type = 'direct', taper = 'HSK-A63'
      WHERE brand = 'Mazak' AND model ILIKE 'VARIAXIS%' AND way_type IS NULL
    `);
    // INTEGREX i-series: linear guideways
    await pool.query(`
      UPDATE machines SET way_type = 'linear'
      WHERE brand = 'Mazak' AND model ILIKE 'INTEGREX%' AND way_type IS NULL
    `);
    // HCN-4000: linear; HCN-5000/6800: box (heavy HMC, gear drive)
    await pool.query(`
      UPDATE machines SET way_type = 'linear'
      WHERE brand = 'Mazak' AND model ILIKE 'HCN-4000%' AND way_type IS NULL
    `);
    await pool.query(`
      UPDATE machines SET way_type = 'box', drive_type = 'gear'
      WHERE brand = 'Mazak' AND (model ILIKE 'HCN-5000%' OR model ILIKE 'HCN-6800%') AND way_type IS NULL
    `);
    // HCN-6800 is CAT50
    await pool.query(`
      UPDATE machines SET taper = 'CAT50'
      WHERE brand = 'Mazak' AND model ILIKE 'HCN-6800%'
    `);

    // ── Okuma way_type and spindle corrections ──────────────────────────────
    // GENOS M-series: CAT40 BIG-PLUS direct, linear roller guides
    await pool.query(`
      UPDATE machines SET way_type = 'linear', drive_type = 'direct', taper = 'CAT40'
      WHERE brand = 'Okuma' AND model ILIKE 'GENOS M%' AND way_type IS NULL
    `);
    // MB-V series vertical machining centers: CAT40/BT40 direct, linear
    await pool.query(`
      UPDATE machines SET way_type = 'linear', drive_type = 'direct'
      WHERE brand = 'Okuma' AND model ILIKE 'MB-%V%' AND way_type IS NULL
    `);
    // MB-H 40-taper horizontals (MB-4000H): linear
    await pool.query(`
      UPDATE machines SET way_type = 'linear'
      WHERE brand = 'Okuma' AND model ILIKE 'MB-4%H%' AND way_type IS NULL
    `);
    // MB-H 50-taper heavy horizontals (MB-5000H, MB-8000H, MB-10000H): box
    await pool.query(`
      UPDATE machines SET way_type = 'box'
      WHERE brand = 'Okuma'
        AND (model ILIKE 'MB-5%H%' OR model ILIKE 'MB-8%H%' OR model ILIKE 'MB-10%H%')
        AND way_type IS NULL
    `);
    // MA-H series: heavy-duty HMC, box ways
    await pool.query(`
      UPDATE machines SET way_type = 'box'
      WHERE brand = 'Okuma' AND model ILIKE 'MA-%H%' AND way_type IS NULL
    `);

    // ── DMG Mori (mill) way_type and spindle corrections ───────────────────
    // NMV series: HSK-A63, direct, 20000 rpm, linear
    await pool.query(`
      UPDATE machines SET way_type = 'linear', drive_type = 'direct', taper = 'HSK-A63', max_rpm = 20000
      WHERE brand ILIKE 'DMG%' AND model ILIKE 'NMV%' AND way_type IS NULL
    `);
    // DMU/DMC 5-axis: HSK-A63, direct, linear
    await pool.query(`
      UPDATE machines SET way_type = 'linear', drive_type = 'direct', taper = 'HSK-A63'
      WHERE brand ILIKE 'DMG%' AND (model ILIKE 'DMU%' OR model ILIKE 'DMC%') AND way_type IS NULL
    `);
    // NHX/NHC 40-taper horizontals: linear
    await pool.query(`
      UPDATE machines SET way_type = 'linear'
      WHERE brand ILIKE 'DMG%' AND (model ILIKE 'NHX%' OR model ILIKE 'NHC%')
        AND (taper = 'CAT40' OR taper = 'HSK-A63' OR taper ILIKE 'BT40%')
        AND way_type IS NULL
    `);
    // NHX/NHC 50-taper heavy horizontals: box
    await pool.query(`
      UPDATE machines SET way_type = 'box'
      WHERE brand ILIKE 'DMG%' AND (model ILIKE 'NHX%' OR model ILIKE 'NHC%')
        AND (taper = 'CAT50' OR taper = 'HSK-A100' OR taper ILIKE 'BT50%')
        AND way_type IS NULL
    `);

    // ── Doosan / DN Solutions way_type corrections ──────────────────────────
    // DNM series: CAT40, linear roller guides
    await pool.query(`
      UPDATE machines SET way_type = 'linear'
      WHERE (brand ILIKE 'Doosan%' OR brand ILIKE 'DN Solutions%')
        AND model ILIKE 'DNM%' AND way_type IS NULL
    `);
    // Mynx and 50-taper heavy verticals: box
    await pool.query(`
      UPDATE machines SET way_type = 'box'
      WHERE (brand ILIKE 'Doosan%' OR brand ILIKE 'DN Solutions%')
        AND (model ILIKE 'Mynx%' OR taper = 'CAT50')
        AND way_type IS NULL
    `);
    // NHP 40-taper horizontals: linear; 50-taper: box
    await pool.query(`
      UPDATE machines SET way_type = 'linear'
      WHERE (brand ILIKE 'Doosan%' OR brand ILIKE 'DN Solutions%')
        AND model ILIKE 'NHP%'
        AND (taper = 'CAT40' OR taper ILIKE 'BT40%' OR taper ILIKE 'HSK-A63%')
        AND way_type IS NULL
    `);
    await pool.query(`
      UPDATE machines SET way_type = 'box'
      WHERE (brand ILIKE 'Doosan%' OR brand ILIKE 'DN Solutions%')
        AND model ILIKE 'NHP%'
        AND (taper = 'CAT50' OR taper ILIKE 'BT50%' OR taper ILIKE 'HSK-A100%')
        AND way_type IS NULL
    `);

    // ── Brother: all Speedio linear-guide machines ──────────────────────────
    await pool.query(`
      UPDATE machines SET way_type = 'linear'
      WHERE brand ILIKE 'Brother%' AND way_type IS NULL
    `);

    // ── Fanuc Robodrill: all α-D series, HSK32/BBT30, direct, 24k rpm, linear ─
    await pool.query(`
      UPDATE machines SET way_type = 'linear', drive_type = 'direct', max_rpm = 24000
      WHERE brand ILIKE 'Fanuc%' AND model ILIKE '%Robodrill%' AND way_type IS NULL
    `);

    // ── Hurco: all VM/VMX verticals, CAT40 direct, linear roller guides ────────
    await pool.query(`
      UPDATE machines SET way_type = 'linear', drive_type = 'direct'
      WHERE brand ILIKE 'Hurco%' AND way_type IS NULL
    `);

    // ── Giddings & Lewis horizontal boring mills: box-way, gear drive, CAT50 ──
    // High torque, low RPM, extreme rigidity. Older PC/HBM series = CAT50;
    // newer HMC-class machines may use HSK100. Box-way construction is standard.
    await pool.query(`
      UPDATE machines SET way_type = 'box', drive_type = 'gear', machine_type = 'hbm'
      WHERE (brand ILIKE 'Giddings%' OR brand ILIKE 'G&L%' OR brand ILIKE 'G %26 L%')
        AND way_type IS NULL
    `);
    // Default older G&L PC/HBM models to CAT50 if taper not set
    await pool.query(`
      UPDATE machines SET taper = 'CAT50'
      WHERE (brand ILIKE 'Giddings%' OR brand ILIKE 'G&L%')
        AND taper IS NULL
        AND (model ILIKE 'PC%' OR model ILIKE 'HBM%' OR model ILIKE '%boring%')
    `);

    // Insert live-tool lathe catalog entries (INSERT … WHERE NOT EXISTS to stay idempotent)
    const liveToolMachines = [
      // [brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, machine_type, control, lt_rpm, lt_hp, lt_coolant, lt_conn, lt_drive]
      ["Haas",          "ST-10Y",        6000,  20,  "VDI/BMT", "belt",  false, "{flood}", null, "lathe", "Haas",         4000, 5,   "External (no thru-tool)", "VDI/BMT", "Belt"],
      ["Haas",          "ST-15Y",        6000,  20,  "VDI/BMT", "belt",  false, "{flood}", null, "lathe", "Haas",         4000, 5,   "External (no thru-tool)", "VDI/BMT", "Belt"],
      ["Haas",          "ST-20Y",        6000,  20,  "VDI/BMT", "belt",  false, "{flood}", null, "lathe", "Haas",         4000, 5,   "External (no thru-tool)", "VDI/BMT", "Belt"],
      ["Haas",          "ST-30Y",        4000,  30,  "VDI/BMT", "belt",  false, "{flood}", null, "lathe", "Haas",         4000, 5,   "External (no thru-tool)", "VDI/BMT", "Belt"],
      ["Mazak",         "QT-200MY",      5000,  15,  "VDI/BMT/Capto", "direct", false, "{flood}", null, "lathe", "MAZATROL", 5000, 7.5, "Optional thru-tool",   "VDI/BMT/Capto", "Direct"],
      ["Mazak",         "QT-250MY",      5000,  15,  "VDI/BMT/Capto", "direct", false, "{flood}", null, "lathe", "MAZATROL", 5000, 7.5, "Optional thru-tool",   "VDI/BMT/Capto", "Direct"],
      ["Mazak",         "QT-300MY",      4000,  20,  "VDI/BMT/Capto", "direct", false, "{flood}", null, "lathe", "MAZATROL", 5000, 7.5, "Optional thru-tool",   "VDI/BMT/Capto", "Direct"],
      ["DMG MORI",      "NLX 2000 SY",   4000,  22,  "Capto",   "direct", false, "{flood,tsc}", null, "lathe", "CELOS",   12000, 10,  "High-pressure thru-tool", "Capto",  "Motorized"],
      ["DMG MORI",      "NLX 2500 SY",   3500,  30,  "Capto",   "direct", false, "{flood,tsc}", null, "lathe", "CELOS",   12000, 10,  "High-pressure thru-tool", "Capto",  "Motorized"],
      ["Nakamura-Tome", "WT-150II",      5000,  15,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Nakamura-Tome", "SC-200",        5000,  15,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Nakamura-Tome", "AS-200",        5000,  15,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Okuma",         "LB3000 EX II MY", 5000, 22, "VDI/BMT", "direct", false, "{flood}", null, "lathe", "OSP-P300L",    6000, 7.5, "Thru-tool available",    "VDI/BMT", "Direct"],
      ["Okuma",         "GENOS L3000-e MY", 4000,22, "VDI/BMT", "direct", false, "{flood}", null, "lathe", "OSP-P300L",    6000, 7.5, "Thru-tool available",    "VDI/BMT", "Direct"],
      ["Tsugami",       "BO326-III",     5000,  10,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Tsugami",       "S206-II",       7000,  7.5, "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Citizen",       "L20",           10000, 7.5, "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Citizen",       "A20",           10000, 7.5, "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5000, 6,   "Varies",                 "VDI/BMT", "Direct"],
      ["Miyano",        "BNA-42MSY",     6000,  10,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Miyano",        "ABX-51THY",     5000,  15,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Hyundai-Wia",   "LYNX 2100LY",   5000,  15,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Hyundai-Wia",   "LYNX 2600Y",    4000,  22,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Johnford",      "ST-40Y",        4000,  20,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Johnford",      "ST-60Y",        3500,  25,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Daewoo",        "PUMA 240MS",    5000,  15,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Daewoo",        "PUMA 250MS",    5000,  15,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Doosan/DN Solutions", "PUMA 2100SY II", 5000, 30, "A2-6/A2-8", "direct", false, "{tsc}", null, "mill_turn", "FANUC", 5000, 30, "Turret Coolant", "VDI/BMT", "Direct"],
      ["Kia / Hyundai-Kia", "SKT21LMS", 5000,  15,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
      ["Kia / Hyundai-Kia", "SKT2000Y", 4000,  22,  "VDI/BMT", "direct", false, "{flood}", null, "lathe", "FANUC",         5500, 7,   "Varies",                 "VDI/BMT", "Direct"],
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

    // ── Re-categorize Y-axis live-tool lathes from 'mill_turn' → 'lathe' ──────
    // True mill-turns have a dedicated tilting B-axis milling spindle (CAPTO/HSK,
    // 25–80 HP). Y-axis live-tool lathes only have small VDI/BMT tools in the turret.
    // The two have completely different cutting physics — they need different calc paths.
    await pool.query(`
      UPDATE machines SET machine_type = 'lathe'
      WHERE machine_type = 'mill_turn' AND (
        (brand = 'DMG Mori' AND (model ILIKE 'CLX %' OR model = 'CTX alpha 500' OR model ILIKE 'NLX %'))
        OR (brand IN ('Doosan','DN Solutions','Doosan/DN Solutions') AND model NOT ILIKE '%SMX%' AND (
          model ILIKE '%LM' OR model ILIKE '%LSY%' OR model ILIKE '%LY%' OR model ILIKE '%SY%'
          OR model ILIKE '%Y II%' OR model ILIKE '%YB%' OR model ILIKE 'Lynx%'
        ))
        OR (brand = 'Hardinge' AND (model ILIKE 'CONQUEST%' OR model ILIKE 'TALENT%'))
        OR (brand = 'Hwacheon')
        OR (brand = 'Hyundai WIA' AND model NOT IN ('L300LMC','L400LMC'))
        OR (brand = 'Mazak' AND (model ILIKE 'QT-%MY' OR model ILIKE 'QTN-%MY'))
        OR (brand = 'Miyano')
        OR (brand = 'Mori Seiki' AND model ILIKE 'NL%')
        OR (brand = 'Muratec')
        OR (brand = 'Nakamura-Tome' AND model NOT ILIKE 'NTRX%')
        OR (brand = 'Okuma' AND (model ILIKE 'GENOS L%' OR model ILIKE 'LB%'))
      )
    `);

    // ── B-axis (milling spindle) specs for true mill-turn platforms ──────────
    // Only applied when fields are NULL (idempotent — won't overwrite user edits).
    // Sources: OEM spec sheets (Mazak, DMG, Okuma, WFL, Doosan/DN, Matsuura, Grob).
    // Mazak Integrex i-100/i-200: 12k RPM, 30 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 30, mill_spindle_taper = 'CAPTO C6'
      WHERE brand = 'Mazak' AND machine_type = 'mill_turn'
        AND (model ILIKE 'INTEGREX i-100' OR model ILIKE 'Integrex i-100' OR model ILIKE 'INTEGREX i-200' OR model ILIKE 'Integrex i-200')
        AND mill_spindle_max_rpm IS NULL
    `);
    // Mazak Integrex i-300/i-400: 12k RPM, 35 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 35, mill_spindle_taper = 'CAPTO C6'
      WHERE brand = 'Mazak' AND machine_type = 'mill_turn'
        AND (model ILIKE 'INTEGREX i-300' OR model ILIKE 'Integrex i-300' OR model ILIKE 'INTEGREX i-400' OR model ILIKE 'Integrex i-400')
        AND mill_spindle_max_rpm IS NULL
    `);
    // Mazak Integrex j-series: 12k RPM, 25 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 25, mill_spindle_taper = 'CAPTO C6'
      WHERE brand = 'Mazak' AND machine_type = 'mill_turn' AND model ILIKE 'Integrex j-%'
        AND mill_spindle_max_rpm IS NULL
    `);
    // Mazak Integrex e-410H / e-670H / e-1060V (each different HP/taper)
    await pool.query(`UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 30, mill_spindle_taper = 'CAPTO C6' WHERE brand = 'Mazak' AND model = 'Integrex e-410H' AND mill_spindle_max_rpm IS NULL`);
    await pool.query(`UPDATE machines SET mill_spindle_max_rpm = 10000, mill_spindle_hp = 40, mill_spindle_taper = 'CAPTO C8' WHERE brand = 'Mazak' AND model = 'Integrex e-670H' AND mill_spindle_max_rpm IS NULL`);
    await pool.query(`UPDATE machines SET mill_spindle_max_rpm = 6000,  mill_spindle_hp = 50, mill_spindle_taper = 'CAPTO C8' WHERE brand = 'Mazak' AND model = 'Integrex e-1060V' AND mill_spindle_max_rpm IS NULL`);
    // Mazak Variaxis i-500T / i-700T: 12k RPM, 35 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 35, mill_spindle_taper = 'CAPTO C6'
      WHERE brand = 'Mazak' AND machine_type = 'mill_turn' AND model ILIKE 'Variaxis i-%T'
        AND mill_spindle_max_rpm IS NULL
    `);
    // DMG Mori NTX 1000/2000: 12k RPM, 25 HP, HSK63
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 25, mill_spindle_taper = 'HSK63'
      WHERE brand = 'DMG Mori' AND model IN ('NTX 1000','NTX 2000') AND mill_spindle_max_rpm IS NULL
    `);
    // DMG Mori CTX beta TC: 12k RPM, 30 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 30, mill_spindle_taper = 'CAPTO C6'
      WHERE brand = 'DMG Mori' AND model IN ('CTX beta 450 TC','CTX beta 800 TC') AND mill_spindle_max_rpm IS NULL
    `);
    // DMG Mori CTX gamma 2000 TC: 10k RPM, 40 HP, CAPTO C8
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 10000, mill_spindle_hp = 40, mill_spindle_taper = 'CAPTO C8'
      WHERE brand = 'DMG Mori' AND model = 'CTX gamma 2000 TC' AND mill_spindle_max_rpm IS NULL
    `);
    // Okuma Multus B250/B300/B400: 12k RPM, 30 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 30, mill_spindle_taper = 'CAPTO C6'
      WHERE brand = 'Okuma' AND model IN ('MULTUS B250','MULTUS B300','MULTUS B400') AND mill_spindle_max_rpm IS NULL
    `);
    // Okuma Multus B750: 6k RPM, 50 HP, CAPTO C8
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 6000, mill_spindle_hp = 50, mill_spindle_taper = 'CAPTO C8'
      WHERE brand = 'Okuma' AND model = 'MULTUS B750' AND mill_spindle_max_rpm IS NULL
    `);
    // Okuma Multus U3000/U4000: 12k RPM, 25 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 25, mill_spindle_taper = 'CAPTO C6'
      WHERE brand = 'Okuma' AND model IN ('MULTUS U3000','MULTUS U4000') AND mill_spindle_max_rpm IS NULL
    `);
    // Doosan/DN SMX 2600/2600ST: 10k RPM, 25 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 10000, mill_spindle_hp = 25, mill_spindle_taper = 'CAPTO C6'
      WHERE (brand = 'DN Solutions' OR brand = 'Doosan') AND model IN ('PUMA SMX2600ST','Puma SMX 2600') AND mill_spindle_max_rpm IS NULL
    `);
    // Doosan/DN SMX 3100 family: 10k RPM, 30 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 10000, mill_spindle_hp = 30, mill_spindle_taper = 'CAPTO C6'
      WHERE (brand = 'DN Solutions' OR brand = 'Doosan') AND model IN ('PUMA SMX3100L','PUMA SMX3100ST','Puma SMX 3100') AND mill_spindle_max_rpm IS NULL
    `);
    // Doosan/DN SMX 5100L: 8k RPM, 35 HP, CAPTO C8
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 8000, mill_spindle_hp = 35, mill_spindle_taper = 'CAPTO C8'
      WHERE (brand = 'DN Solutions' OR brand = 'Doosan') AND model = 'PUMA SMX5100L' AND mill_spindle_max_rpm IS NULL
    `);
    // WFL M35/M65: 6k RPM, 50 HP, CAPTO C8
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 6000, mill_spindle_hp = 50, mill_spindle_taper = 'CAPTO C8'
      WHERE brand = 'WFL' AND model IN ('M35 Millturn','M65 Millturn') AND mill_spindle_max_rpm IS NULL
    `);
    // WFL M80/M120 (large): 5k RPM, 70 HP, CAPTO C8
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 5000, mill_spindle_hp = 70, mill_spindle_taper = 'CAPTO C8'
      WHERE brand = 'WFL' AND model IN ('M80 Millturn','M120 Millturn') AND mill_spindle_max_rpm IS NULL
    `);
    // Nakamura-Tome NTRX-300: 12k RPM, 25 HP, CAPTO C6
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 25, mill_spindle_taper = 'CAPTO C6'
      WHERE brand = 'Nakamura-Tome' AND model = 'NTRX-300' AND mill_spindle_max_rpm IS NULL
    `);
    // Grob G350T/G550T: 18k RPM, 35 HP, HSK63
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 18000, mill_spindle_hp = 35, mill_spindle_taper = 'HSK63'
      WHERE brand = 'Grob' AND model IN ('G350T','G550T') AND mill_spindle_max_rpm IS NULL
    `);
    // Matsuura CUBLEX-35: 20k RPM, 25 HP, HSK63
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 20000, mill_spindle_hp = 25, mill_spindle_taper = 'HSK63'
      WHERE brand = 'Matsuura' AND model = 'CUBLEX-35' AND mill_spindle_max_rpm IS NULL
    `);
    // Matsuura CUBLEX-63: 15k RPM, 30 HP, HSK63
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 15000, mill_spindle_hp = 30, mill_spindle_taper = 'HSK63'
      WHERE brand = 'Matsuura' AND model = 'CUBLEX-63' AND mill_spindle_max_rpm IS NULL
    `);
    // Bumotec s-181 (HSK-E40 ≈ HSK50 in our enum): 30k RPM, 7.4 HP, HSK50
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 30000, mill_spindle_hp = 7.4, mill_spindle_taper = 'HSK50'
      WHERE brand = 'Bumotec' AND model = 's-181' AND mill_spindle_max_rpm IS NULL
    `);
    // Bumotec s-191 / s-191+: 36k RPM, 11 HP, HSK50 (HSK-E40)
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 36000, mill_spindle_hp = 11, mill_spindle_taper = 'HSK50'
      WHERE brand = 'Bumotec' AND model IN ('s-191','s-191+') AND mill_spindle_max_rpm IS NULL
    `);
    // Index G220 (HSK-T63 config): 12k RPM, 22.8 HP, HSK63
    await pool.query(`
      UPDATE machines SET mill_spindle_max_rpm = 12000, mill_spindle_hp = 22.8, mill_spindle_taper = 'HSK63'
      WHERE brand = 'Index' AND model = 'G220' AND mill_spindle_hp IS NULL
    `);
    // Hyundai WIA L300LMC / L400LMC: actually Y-axis box-way live-tool lathes,
    // not B-axis mill-turns. Re-tag from mill_turn to lathe.
    await pool.query(`
      UPDATE machines SET machine_type = 'lathe'
      WHERE brand = 'Hyundai WIA' AND model IN ('L300LMC','L400LMC') AND machine_type = 'mill_turn'
    `);
    // Matsuura MX-520T: 5-axis trunnion VMC with C-axis turning, NOT a B-axis
    // head mill-turn. Re-tag to 5axis (uses main spindle for both milling + turning).
    await pool.query(`
      UPDATE machines SET machine_type = '5axis',
        mill_spindle_max_rpm = NULL, mill_spindle_hp = NULL, mill_spindle_taper = NULL
      WHERE brand = 'Matsuura' AND model = 'MX-520T' AND machine_type = 'mill_turn'
    `);

    // ── Live-tool turret connection by brand for Y-axis live-tool lathes ─────
    // (Group A: machines that already had RPM/HP but were missing taper)
    await pool.query(`UPDATE machines SET live_tool_connection = 'VDI40' WHERE brand = 'DMG Mori' AND model IN ('CLX 350','CLX 550','CTX alpha 500','NLX 2500|700','NLX 3000|700') AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT55' WHERE brand IN ('Doosan','DN Solutions','Doosan/DN Solutions') AND (model ILIKE '%2100%' OR model ILIKE '%2600%' OR model = 'Lynx 2100LM') AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT65' WHERE brand IN ('Doosan','DN Solutions','Doosan/DN Solutions') AND model = 'Puma 3100LM' AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'VDI40' WHERE brand = 'Hardinge' AND model IN ('CONQUEST GT27','TALENT 8/52','TALENT 10/78') AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT55' WHERE brand = 'Hwacheon' AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT55' WHERE brand = 'Hyundai WIA' AND model IN ('L300LMC','L3100SY') AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT65' WHERE brand = 'Hyundai WIA' AND model = 'L400LMC' AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT55' WHERE brand = 'Mazak' AND (model ILIKE 'QT-%MY' OR model ILIKE 'QTN-%MY') AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT45' WHERE brand = 'Miyano' AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT55' WHERE brand = 'Mori Seiki' AND model ILIKE 'NL%' AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'VDI40' WHERE brand = 'Muratec' AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT55' WHERE brand = 'Nakamura-Tome' AND model NOT ILIKE 'NTRX%' AND (live_tool_connection IS NULL OR live_tool_connection = '')`);
    await pool.query(`UPDATE machines SET live_tool_connection = 'BMT55' WHERE brand = 'Okuma' AND (model ILIKE 'GENOS L%' OR model ILIKE 'LB%') AND (live_tool_connection IS NULL OR live_tool_connection = '')`);

    // Group B: lathes missing live_tool_max_rpm/hp — apply DN/Hyundai house spec (6k RPM, 7.5 HP)
    await pool.query(`
      UPDATE machines SET live_tool_max_rpm = 6000, live_tool_hp = 7.5
      WHERE brand IN ('Doosan','DN Solutions','Doosan/DN Solutions') AND model IN ('LYNX 2100','LYNX 2600','PUMA GT2100M','PUMA GT2100MB')
        AND (live_tool_max_rpm IS NULL OR live_tool_max_rpm = 0)
    `);
    await pool.query(`
      UPDATE machines SET live_tool_max_rpm = 6000, live_tool_hp = 7.5
      WHERE brand = 'Hyundai WIA' AND model IN ('L160','L2000','L230','L2600','L280','L3000')
        AND (live_tool_max_rpm IS NULL OR live_tool_max_rpm = 0)
    `);

    // Group C: G&L Vertical Turning Centers are turning-only — clear any live tool data
    await pool.query(`
      UPDATE machines SET live_tool_max_rpm = NULL, live_tool_hp = NULL, live_tool_connection = NULL
      WHERE brand ILIKE 'Giddings%' AND model ILIKE '%VTC%'
    `);

    // Group D: Swiss live tool defaults — 5000 RPM, 1.5 HP (Citizen A32 reference).
    // live_tool_connection left NULL since Swiss rotary blocks aren't VDI/BMT.
    await pool.query(`
      UPDATE machines SET live_tool_max_rpm = 5000, live_tool_hp = 1.5
      WHERE machine_type = 'swiss' AND model IN ('A32','R07','MS16C','MS22C','MS32C','DECO 13','DECO 20','MultiSwiss 6x16','SIGMA 20','SIGMA 32')
        AND (live_tool_max_rpm IS NULL OR live_tool_max_rpm = 0)
    `);

    // ── Giddings & Lewis catalog (43 models) ─────────────────────────────────
    // Heavy boring mills, VTLs, HMCs, and modern MAG platform.
    // [model, machine_type, taper, max_rpm, spindle_hp, base_tq_ftlb, peak_tq_ftlb, peak_tq_rpm, way_type, drive_type]
    const gnlMachines: [string, string, string, number, number, number, number, number, string, string][] = [
      // Floor-type HBM
      ["G60-FX",   "hbm", "CAT50",  2500, 50,  650, 1500, 400, "box", "gear"],
      ["G60-FXi",  "hbm", "CAT50",  3000, 60,  700, 1600, 450, "box", "gear"],
      ["G50-FX",   "hbm", "CAT50",  2500, 40,  520, 1200, 400, "box", "gear"],
      ["G70-FX",   "hbm", "CAT50",  2200, 60,  780, 1800, 350, "box", "gear"],
      ["G80-FX",   "hbm", "CAT50",  2000, 75,  950, 2200, 300, "box", "gear"],
      ["G90-FX",   "hbm", "CAT50",  1800, 100, 1200, 3000, 250, "box", "gear"],
      ["G100-FX",  "hbm", "CAT50",  1500, 125, 1500, 4000, 200, "box", "gear"],
      // Table-type HBM
      ["MC40",     "hbm", "CAT50",  3000, 30,  400, 900,  500, "box", "gear"],
      ["MC50",     "hbm", "CAT50",  2500, 40,  525, 1200, 400, "box", "gear"],
      ["MC60",     "hbm", "CAT50",  2500, 50,  650, 1500, 400, "box", "gear"],
      ["MC60-2P",  "hbm", "CAT50",  2500, 50,  650, 1500, 400, "box", "gear"],
      ["MC70",     "hbm", "CAT50",  2200, 60,  750, 1700, 350, "box", "gear"],
      ["MC80",     "hbm", "CAT50",  2000, 60,  800, 1800, 350, "box", "gear"],
      ["MC100",    "hbm", "CAT50",  1800, 75,  1000, 2500, 300, "box", "gear"],
      // Legacy / classic boring mills
      ["300",      "hbm", "CAT50",  1200, 50,  1100, 2500, 200, "box", "gear"],
      ["340T",     "hbm", "CAT50",  1600, 60,  900, 2200, 300, "box", "gear"],
      ["350T",     "hbm", "CAT50",  1500, 75,  1200, 3000, 250, "box", "gear"],
      ["360T",     "hbm", "CAT50",  1400, 100, 1400, 3500, 250, "box", "gear"],
      ["380T",     "hbm", "CAT50",  1200, 125, 1600, 4200, 200, "box", "gear"],
      ["70H6T",    "hbm", "CAT50",  2000, 50,  650, 1600, 350, "box", "gear"],
      // VTLs (older CAT50/KM80)
      ["48 VTC",   "lathe","CAT50", 300,  20,  350, 900,  150, "box", "gear"],
      ["60 VTC",   "lathe","CAT50", 280,  25,  470, 1200, 150, "box", "gear"],
      ["72 VTC",   "lathe","KM80",  250,  30,  600, 1500, 120, "box", "gear"],
      ["84 VTC",   "lathe","KM80",  220,  40,  800, 2000, 120, "box", "gear"],
      ["96 VTC",   "lathe","KM80",  200,  50,  1000, 2500, 100, "box", "gear"],
      // VTLs (modern Capto C8)
      ["VTC1600",  "lathe","CAPTO C8", 2000, 30,  400, 900,  300, "linear", "direct"],
      ["VTC2000",  "lathe","CAPTO C8", 2000, 35,  500, 1100, 300, "linear", "direct"],
      ["VTC2500",  "lathe","CAPTO C8", 1800, 40,  600, 1400, 250, "linear", "direct"],
      ["VTC3000",  "lathe","CAPTO C8", 1500, 45,  750, 1700, 250, "linear", "direct"],
      ["VTC3500",  "lathe","CAPTO C8", 1200, 50,  900, 2000, 200, "linear", "direct"],
      // Orion HMCs
      ["Orion 2000", "hmc", "CAT50", 6000, 35,  300, 500,  1200, "box", "gear"],
      ["Orion 2300", "hmc", "CAT50", 6000, 40,  350, 600,  1000, "box", "gear"],
      ["Orion 3000", "hmc", "CAT50", 8000, 50,  330, 550,  1500, "box", "gear"],
      ["Orion 4000", "hmc", "CAT50", 8000, 60,  400, 650,  1500, "box", "gear"],
      ["MC1250",   "hmc", "CAT50",  6000, 40,  350, 600,  1200, "box", "gear"],
      ["MC1600",   "hmc", "CAT50",  6000, 50,  400, 700,  1200, "box", "gear"],
      // Modern MAG platform (HSK100, linear ways, direct drive)
      ["MAG RT1000", "hbm", "HSK100", 10000, 50, 260, 420, 2000, "linear", "direct"],
      ["MAG RT1250", "hbm", "HSK100", 10000, 60, 315, 500, 2000, "linear", "direct"],
      ["MAG XT",     "hmc", "HSK100", 12000, 70, 300, 480, 2500, "linear", "direct"],
      ["MAG FTV",    "hbm", "HSK100", 8000,  80, 500, 900, 1500, "linear", "direct"],
    ];
    for (const m of gnlMachines) {
      const [model, mtype, taper, maxRpm, hp, baseTq, peakTq, peakRpm, wayType, driveType] = m;
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, machine_type, way_type, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence)
        SELECT 'Giddings & Lewis (G&L)', $1, $2, $3, $4, $5, false, '{flood}', $6, $7, $8, $9, $10, $10, 'medium'
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE (brand ILIKE 'Giddings%' OR brand ILIKE 'G&L%') AND model ILIKE $1)
      `, [model, maxRpm, hp, taper, driveType, mtype, wayType, baseTq, peakTq, peakRpm]);
    }
    // Backfill: any older rows already inserted without the (G&L) alias
    await pool.query(`UPDATE machines SET brand = 'Giddings & Lewis (G&L)' WHERE brand = 'Giddings & Lewis'`);

    // ── Swiss machines: re-tag from 'lathe' to 'swiss' and populate sub-spindle ─
    await pool.query(`
      UPDATE machines SET machine_type = 'swiss'
      WHERE machine_type = 'lathe'
        AND (
          brand ILIKE 'Citizen%' OR brand ILIKE 'Tsugami%' OR brand ILIKE 'Tornos%'
          OR brand ILIKE 'Star %' OR brand = 'Star' OR brand ILIKE 'Star CNC%'
        )
    `);
    // Swiss machines almost always have a sub-spindle for back-working —
    // default sub_spindle_rpm to the live_tool RPM if not set
    await pool.query(`
      UPDATE machines SET sub_spindle_rpm = COALESCE(sub_spindle_rpm, live_tool_max_rpm, max_rpm)
      WHERE machine_type = 'swiss' AND sub_spindle_rpm IS NULL
    `);

    // ── Starrag catalog ──────────────────────────────────────────────────────
    // Multi-spindle architecture: each spindle variant loaded as a separate row
    // so users pick the spindle config they're running.
    // [model, machine_type, taper, max_rpm, spindle_hp, base_tq_ftlb, way_type, drive_type]
    const starragMachines: [string, string, string, number, number, number, string, string][] = [];
    // STC series — 10 base models × 4 spindles = 40 rows (HMC, 5-axis aerospace structural)
    const stcSizes = ["500", "630", "800", "1000", "1250", "1600", "1800", "2000", "2500", "3000"];
    for (const sz of stcSizes) {
      // Motor spindle 18k HSK100 — high-speed titanium/aerospace
      starragMachines.push([`STC ${sz} (Motor 18k)`,    "5axis", "HSK100", 18000, 107, 184,  "linear", "direct"]);
      // Gear High 12k HSK100
      starragMachines.push([`STC ${sz} (Gear High 12k)`, "5axis", "HSK100", 12000, 50,  457,  "linear", "gear"]);
      // Gear Mid 8k HSK100
      starragMachines.push([`STC ${sz} (Gear Mid 8k)`,   "5axis", "HSK100", 8000,  50,  693,  "linear", "gear"]);
      // Gear Low 5.6k HSK100 — max torque for heavy roughing
      starragMachines.push([`STC ${sz} (Gear Low 5.6k)`, "5axis", "HSK100", 5600,  50,  958,  "linear", "gear"]);
    }
    // STC X series — high-speed aluminum, 30k motor spindle HSK63 (6 rows)
    for (const sz of ["1000", "1250", "1600", "1800", "2000", "2500"]) {
      starragMachines.push([`STC ${sz} X`, "5axis", "HSK63", 30000, 161, 61, "linear", "direct"]);
    }
    // NB series — blisk machines, motor spindle HSK100 (6 rows)
    for (const sz of ["151", "251", "351", "451", "551", "651"]) {
      starragMachines.push([`NB ${sz}`, "5axis", "HSK100", 18000, 80, 184, "linear", "direct"]);
    }
    // LX series — blade machines (8 rows)
    starragMachines.push(["LX 021", "5axis", "HSK32", 30000, 25, 44,  "linear", "direct"]);
    starragMachines.push(["LX 031", "5axis", "HSK32", 30000, 25, 44,  "linear", "direct"]);
    starragMachines.push(["LX 041", "5axis", "HSK32", 30000, 25, 44,  "linear", "direct"]);
    starragMachines.push(["LX 051", "5axis", "HSK63", 18000, 37, 120, "linear", "direct"]);
    starragMachines.push(["LX 101", "5axis", "HSK63", 18000, 37, 120, "linear", "direct"]);
    starragMachines.push(["LX 151", "5axis", "HSK63", 18000, 38, 133, "linear", "direct"]);
    starragMachines.push(["LX 251", "5axis", "HSK63", 18000, 38, 133, "linear", "direct"]);
    starragMachines.push(["LX 351", "5axis", "HSK63", 18000, 38, 133, "linear", "direct"]);
    // Ecospeed series — large aero structures (5 rows)
    starragMachines.push(["Ecospeed F", "5axis", "HSK63",  30000, 120, 60,  "linear", "direct"]);
    starragMachines.push(["Ecospeed B", "5axis", "HSK63",  30000, 120, 60,  "linear", "direct"]);
    starragMachines.push(["Ecospeed C", "5axis", "HSK63",  24000, 100, 90,  "linear", "direct"]);
    starragMachines.push(["Ecospeed D", "5axis", "HSK100", 18000, 80,  180, "linear", "direct"]);
    starragMachines.push(["Ecospeed E", "5axis", "HSK100", 12000, 70,  250, "linear", "direct"]);
    // Heckert series — horizontal production (5 rows)
    starragMachines.push(["HEC 500",  "hmc", "HSK63",  12000, 50,  150, "linear", "direct"]);
    starragMachines.push(["HEC 630",  "hmc", "HSK63",  12000, 60,  180, "linear", "direct"]);
    starragMachines.push(["HEC 800",  "hmc", "HSK100", 10000, 70,  220, "linear", "direct"]);
    starragMachines.push(["HEC 1000", "hmc", "HSK100", 8000,  80,  300, "linear", "direct"]);
    starragMachines.push(["HEC 1250", "hmc", "HSK100", 6000,  100, 500, "box",    "gear"]);
    // Droop+Rein — portal/gantry (6 rows)
    starragMachines.push(["FOGS NEO",  "5axis", "HSK100", 6000,  54,  920, "box",    "gear"]);
    starragMachines.push(["TFS NEO",   "5axis", "HSK100", 6000,  80,  800, "box",    "gear"]);
    starragMachines.push(["G Series",  "5axis", "HSK100", 8000,  100, 600, "linear", "direct"]);
    starragMachines.push(["GF Series", "5axis", "HSK100", 10000, 120, 500, "linear", "direct"]);
    starragMachines.push(["T Series",  "5axis", "HSK100", 6000,  80,  700, "box",    "gear"]);
    starragMachines.push(["TF Series", "5axis", "HSK100", 6000,  90,  750, "box",    "gear"]);

    for (const m of starragMachines) {
      const [model, mtype, taper, maxRpm, hp, baseTq, wayType, driveType] = m;
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, machine_type, way_type, base_torque_ftlb, rated_rpm, curve_confidence)
        SELECT 'Starrag', $1, $2, $3, $4, $5, true, '{flood,tsc}', $6, $7, $8, $2, 'medium'
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'Starrag%' AND model ILIKE $1)
      `, [model, maxRpm, hp, taper, driveType, mtype, wayType, baseTq]);
    }

    // ── Modig catalog ────────────────────────────────────────────────────────
    // Aerospace-focused: inverted 5-axis (IM), mill-turn (MTX), horizontal HMC (MHM),
    // gantry (FlexiMill / RigiMill / Horizon / MILL-EX), high-velocity (HHV), VMC (VMP).
    // Taper enum has HSK63 / HSK100 only — HSK-A63 → HSK63, HSK-A80 + HSK-A100 → HSK100.
    // machine_type: 4-axis HMC (MHM) → hmc, MTX → mill_turn, all others → 5axis.
    // [model, machine_type, taper, max_rpm, spindle_hp, peak_torque_ftlb, base_torque_rpm, way_type, drive_type, notes]
    const modigMachines: [string, string, string, number, number, number, number, string, string, string][] = [
      ["IM-8",            "5axis",     "HSK63",  30000, 201, 406, 4500, "linear", "direct", "Flagship inverted aerospace machine"],
      ["IM-8 Heavy Duty", "5axis",     "HSK100", 18000, 201, 406, 3500, "linear", "direct", "Heavy-duty inverted aerospace"],
      ["IM-6",            "5axis",     "HSK63",  30000, 204, 330, 5000, "linear", "direct", "Compact inverted aerospace"],
      ["IM-6 HD",         "5axis",     "HSK100", 18000, 204, 330, 3500, "linear", "direct", "Titanium-focused inverted"],
      ["IM-10",           "5axis",     "HSK63",  30000, 204, 330, 5000, "linear", "direct", "Large-format inverted aerospace"],
      ["MTX",             "mill_turn", "HSK63",  30000, 201, 300, 5000, "linear", "direct", "Mill-turn hybrid"],
      ["MTX HD",          "mill_turn", "HSK100", 18000, 201, 400, 3500, "linear", "direct", "High-torque mill-turn"],
      ["MHM-800",         "hmc",       "HSK63",  20000, 150, 180, 4500, "linear", "direct", "Aerospace HMC"],
      ["MHM-1250",        "hmc",       "HSK100", 15000, 200, 350, 3500, "linear", "direct", "Heavy-duty HMC"],
      ["FlexiMill",       "5axis",     "HSK63",  30000, 168, 200, 5000, "linear", "direct", "Wing spars / composites gantry"],
      ["FlexiMill HD",    "5axis",     "HSK100", 18000, 180, 350, 3500, "linear", "direct", "Structural titanium gantry"],
      ["HHV2",            "5axis",     "HSK63",  30000, 109, 120, 7000, "linear", "direct", "Horizontal high velocity"],
      ["HHV3",            "5axis",     "HSK63",  30000, 150, 150, 6500, "linear", "direct", "Larger HHV aluminum/composite"],
      ["RigiMill",        "5axis",     "HSK100", 15000, 200, 450, 3000, "box",    "direct", "Maximum rigidity Ti/steel"],
      ["MILL-EX",         "5axis",     "HSK63",  24000, 100, 120, 6000, "linear", "direct", "Extrusion machining center"],
      ["VMP-800",         "5axis",     "HSK63",  24000, 100, 120, 6000, "linear", "direct", "Compact aerospace VMC"],
      ["VMP-1200",        "5axis",     "HSK63",  24000, 120, 150, 5500, "linear", "direct", "Larger aerospace VMC"],
      ["Horizon",         "5axis",     "HSK63",  24000, 150, 180, 5000, "linear", "direct", "Horizontal Aerospace Mill"],
      ["Horizon HD",      "5axis",     "HSK100", 15000, 180, 350, 3500, "linear", "direct", "Heavy structural titanium"],
    ];
    for (const m of modigMachines) {
      const [model, mtype, taper, maxRpm, hp, peakTq, baseRpm, wayType, driveType, notes] = m;
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, machine_type, way_type, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence)
        SELECT 'Modig', $1, $2, $3, $4, $5, true, '{flood,tsc}', $6, $7, $8, $8, $9, $2, 'medium'
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'Modig%' AND model ILIKE $1)
      `, [model, maxRpm, hp, taper, driveType, mtype, wayType, peakTq, baseRpm]);
    }

    // ── SNK catalog ──────────────────────────────────────────────────────────
    // Two-family architecture: heavy CAT50/BT50 gear-driven (massive low-end torque)
    // and HSK motor-spindle aerospace (broad constant-power, modest torque).
    // machine_type mapping:
    //   - true moving-bridge / portal / gantry-5-axis  → 'gantry'
    //   - fixed-bridge / double-column bridge mill     → 'double_column'
    //   - 5-axis horizontal                            → '5axis'
    //   - horizontal boring mill                       → 'hbm'
    // Confidence: 'medium' for rows with published torque (NB130P/HPS-120B); 'low' where
    // torque was inferred from HP/RPM/class (most rows). HSK-A80 (HPS-120B) uses HSK80.
    // [model, machine_type, taper, max_rpm, spindle_hp, base_tq_ftlb, peak_tq_ftlb, peak_tq_rpm, way_type, drive_type, confidence]
    const snkMachines: [string, string, string, number, number, number, number, number, string, string, string][] = [
      ["HPS-120B",     "5axis",         "HSK80",  20000, 39, 84,   115,  2500, "linear", "direct", "medium"], // aerospace 5-axis horizontal; torque inferred from HP curve
      ["NB130P",       "hbm",           "CAT50",  2000,  60, 1900, 2793, 400,  "box",    "gear",   "medium"], // 2793 ft-lb peak published; HP/base inferred
      ["AIC-150",      "double_column", "CAT50",  3000,  25, 220,  450,  500,  "box",    "gear",   "low"],   // older fixed-bridge mill, classic gearbox architecture
      ["RB-5M",        "double_column", "BT50",   6000,  40, 150,  300,  1000, "box",    "gear",   "low"],   // mold/die double column
      ["HF-5M",        "gantry",        "HSK63",  20000, 50, 55,   95,   4000, "linear", "direct", "low"],   // high-speed aerospace aluminum moving gantry
      ["DC-5A",        "gantry",        "HSK100", 15000, 60, 175,  320,  3000, "linear", "direct", "low"],   // 5-axis gantry, titanium-capable integral spindle
      ["CM-5",         "gantry",        "CAT50",  4000,  50, 320,  650,  600,  "box",    "gear",   "low"],   // moving-portal mill, large castings
      ["RB-200F",      "double_column", "BT50",   8000,  50, 180,  340,  1200, "box",    "gear",   "low"],   // double column general heavy
      ["UH-50P",       "5axis",         "HSK63",  24000, 40, 42,   75,   5000, "linear", "direct", "low"],   // representative high-speed profiler (UH series)
      ["NeoV-5M",      "gantry",        "HSK100", 18000, 80, 230,  400,  3500, "linear", "direct", "low"],   // representative NeoV gantry 5-axis
    ];
    for (const m of snkMachines) {
      const [model, mtype, taper, maxRpm, hp, baseTq, peakTq, peakRpm, wayType, driveType, confidence] = m;
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, machine_type, way_type, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence)
        SELECT 'SNK', $1, $2, $3, $4, $5, $11, '{flood}', $6, $7, $8, $9, $10, $10, $12
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'SNK%' AND model ILIKE $1)
      `, [model, maxRpm, hp, taper, driveType, mtype, wayType, baseTq, peakTq, peakRpm, taper.startsWith("HSK"), confidence]);
    }
    // Backfill: SNK rows seeded under the original '5axis'/'double_column' mapping
    // need to be reclassified now that 'gantry' is a valid machine_type.
    await pool.query(`
      UPDATE machines SET machine_type = 'gantry'
      WHERE brand ILIKE 'SNK%' AND model IN ('HF-5M', 'DC-5A', 'CM-5', 'NeoV-5M')
    `);
    // Reclassify Modig moving-gantry machines (FlexiMill, RigiMill, MILL-EX
    // are true moving-portal aerospace gantries, not 5-axis HMC class).
    await pool.query(`
      UPDATE machines SET machine_type = 'gantry'
      WHERE brand ILIKE 'Modig%' AND model IN ('FlexiMill', 'FlexiMill HD', 'RigiMill', 'MILL-EX')
    `);

    // ── Aerospace Gantry Catalog ─────────────────────────────────────────────
    // Tier-1 aerospace gantry builders. All rows are single-spindle except where
    // spindle_count > 1 (synchronized multi-head extrusion/profile gantries).
    // Torque values converted from Nm to ft-lb (×0.7376). Most are 'low' confidence
    // because aerospace OEMs publish RPM/HP but rarely full torque curves.
    // Taper normalization: HSK63A/HSK63F → HSK63, HSK-A100 → HSK100, BIG-PLUS CAT50 → CAT50.
    // way_type: aerospace HSK gantries are linear; heavy CAT50 gantries are box/hydrostatic.
    // [brand, model, machine_type, taper, max_rpm, hp, base_tq_ftlb, peak_tq_ftlb, peak_tq_rpm, way_type, drive_type, spindle_count, confidence, notes]
    const gantryMachines: [string, string, string, string, number, number, number, number, number, string, string, number, string, string][] = [
      // Ingersoll Machine Tools — massive aerospace portals, CFRP/Al/Ti
      ["Ingersoll", "MasterMill",       "gantry", "HSK100", 12000, 100, 350,  700,  2000, "box",    "gear",   1, "low", "Large aerospace portal mill"],
      ["Ingersoll", "PowerMill",        "gantry", "CAT50",  6000,  150, 800,  1800, 500,  "box",    "gear",   1, "low", "Heavy structural roughing portal"],
      ["Ingersoll", "CyberMill",        "gantry", "HSK63",  24000, 60,  90,   170,  4000, "linear", "direct", 1, "low", "High-speed aero aluminum CFRP"],
      // Fives / Forest-Liné — ultra-high-speed aerospace aluminum
      ["Fives",     "Modumill",         "gantry", "HSK63",  30000, 60,  60,   135,  5000, "linear", "direct", 1, "low", "Forest-Liné high-speed aero aluminum"],
      ["Fives",     "Flexmill",         "gantry", "HSK63",  24000, 50,  70,   145,  4500, "linear", "direct", 1, "low", "Forest-Liné monolithic aluminum"],
      ["Fives",     "MGB",              "gantry", "HSK100", 18000, 75,  170,  295,  3000, "linear", "direct", 1, "low", "Forest-Liné aero structures HSK100"],
      ["Fives",     "Modumill MultiSpindle 3", "gantry", "HSK63", 24000, 50, 70, 145, 4500, "linear", "direct", 3, "low", "3-head synchronized aero extrusion"],
      // Zimmermann — dynamic 5-axis aero aluminum
      ["Zimmermann", "FZ33",            "gantry", "HSK63",  30000, 55,  55,   120,  5000, "linear", "direct", 1, "low", "Thin-wall aluminum 5-axis"],
      ["Zimmermann", "FZ37",            "gantry", "HSK63",  24000, 60,  65,   150,  4500, "linear", "direct", 1, "low", "Mid-size aero aluminum 5-axis"],
      ["Zimmermann", "FZU",             "gantry", "HSK100", 18000, 75,  130,  220,  3500, "linear", "direct", 1, "low", "Large bridge aero structures"],
      ["Zimmermann", "FZH",             "gantry", "HSK63",  30000, 60,  60,   140,  5000, "linear", "direct", 1, "low", "Horizontal gantry aero aluminum"],
      // Fooke — linear-drive long-part portals
      ["Fooke",     "ENDURA 700LINEAR", "gantry", "HSK63",  24000, 60,  150,  295,  3500, "linear", "direct", 1, "low", "Linear-motor aero extrusion machining"],
      ["Fooke",     "ENDURA 900",       "gantry", "HSK100", 18000, 80,  220,  440,  3000, "linear", "direct", 1, "low", "Heavy aero structural"],
      // DMG MORI gantry-class
      ["DMG MORI",  "DMU 600 P",        "gantry", "HSK100", 12000, 80,  220,  440,  2500, "linear", "direct", 1, "low", "Large 5-axis portal"],
      ["DMG MORI",  "DMC 340 U",        "gantry", "HSK63",  18000, 50,  90,   180,  3500, "linear", "direct", 1, "low", "Universal 5-axis portal"],
      // TARUS — North American aero tooling
      ["TARUS",     "5-Axis Bridge",    "gantry", "CAT50",  10000, 60,  500,  1100, 1000, "box",    "gear",   1, "low", "Aero fixture and tooling gantry"],
      ["TARUS",     "Heavy Portal",     "gantry", "HSK100", 12000, 100, 400,  900,  1500, "box",    "gear",   1, "low", "Tooling and large alloy work"],
      // Fidia — precision contour gantries
      ["Fidia",     "GTF",              "gantry", "HSK63",  24000, 50,  75,   175,  4000, "linear", "direct", 1, "low", "High-speed contour aero surfacing"],
      ["Fidia",     "D321",             "gantry", "HSK63",  30000, 60,  75,   220,  4500, "linear", "direct", 1, "low", "Ultra-precision aero surfacing"],
      // Waldrich Coburg — extreme heavy aerospace
      ["Waldrich Coburg", "Taurus",     "gantry", "CAT50",  6000,  150, 1100, 2950, 400,  "hydrostatic", "gear", 1, "low", "Heavy Ti / large steel structures"],
      ["Waldrich Coburg", "Tectri",     "gantry", "HSK100", 10000, 125, 700,  1850, 800,  "hydrostatic", "gear", 1, "low", "Heavy aerospace alloy roughing"],
      ["Waldrich Coburg", "PowerTec",   "gantry", "CAT50",  4500,  200, 1500, 3690, 350,  "hydrostatic", "gear", 1, "low", "Extreme titanium/steel portal"],
      // Parpas — mold/die gantries
      ["Parpas",    "THS",              "gantry", "HSK63",  24000, 60,  100,  160,  4000, "linear", "direct", 1, "low", "Mold & die direct-drive gantry"],
      // Shibaura Machine — large iron cutting
      ["Shibaura",  "MPF",              "gantry", "CAT50",  6000,  55,  400,  740,  600,  "box",    "gear",   1, "low", "Large iron cutting gantry"],
      // KAAST — general-purpose gantry
      ["KAAST",     "GBM Gantry",       "gantry", "CAT50",  6000,  30,  220,  370,  800,  "box",    "gear",   1, "low", "General purpose belt/geared gantry"],
      // CMS — aluminum extrusion profilers (often multi-spindle)
      ["CMS",       "Antares",          "gantry", "HSK63",  24000, 30,  60,   135,  4500, "linear", "direct", 1, "low", "Aluminum extrusion profile"],
      ["CMS",       "Ares MultiSpindle 3", "gantry", "HSK63", 24000, 30, 60, 135, 4500, "linear", "direct", 3, "low", "3-head extrusion profiler"],
      // Belotti — composite trimming twin/triple heads
      ["Belotti",   "FLU MultiSpindle 2", "gantry", "HSK63", 24000, 30, 45, 110, 5000, "linear", "direct", 2, "low", "Twin-head composite trimming"],
      ["Belotti",   "FLU MultiSpindle 3", "gantry", "HSK63", 24000, 30, 45, 110, 5000, "linear", "direct", 3, "low", "Triple-head composite trimming"],
      // Handtmann — structural aluminum multi-spindle
      ["Handtmann", "PBZ MultiSpindle 4", "gantry", "HSK63", 24000, 35, 75, 150, 4500, "linear", "direct", 4, "low", "4-head structural aluminum"],
      // Jobs — Italian high-speed aero
      ["Jobs",      "LinX 30",          "gantry", "HSK63",  30000, 60,  110,  220,  4500, "linear", "direct", 1, "low", "Linear-motor high-speed aero"],
      ["Jobs",      "LinX 100",         "gantry", "HSK100", 18000, 75,  170,  295,  3000, "linear", "direct", 1, "low", "Large aero structures"],
      // Breton — composite & aluminum gantries
      ["Breton",    "Matrix",           "gantry", "HSK63",  24000, 45,  90,   180,  4000, "linear", "direct", 1, "low", "Composite & aluminum gantry"],
      ["Breton",    "Matrix MultiSpindle 2", "gantry", "HSK63", 24000, 45, 90, 180, 4000, "linear", "direct", 2, "low", "Twin-head composite/aluminum"],
    ];
    for (const m of gantryMachines) {
      const [brand, model, mtype, taper, maxRpm, hp, baseTq, peakTq, peakRpm, wayType, driveType, spindleCount, confidence, notes] = m;
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, machine_type, way_type, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence, spindle_count)
        SELECT $1, $2, $3, $4, $5, $6, $13, '{flood,tsc}', $7, $8, $9, $10, $11, $11, $12, $14
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE $1 || '%' AND model ILIKE $2)
      `, [brand, model, maxRpm, hp, taper, driveType, mtype, wayType, baseTq, peakTq, peakRpm, confidence, taper.startsWith("HSK"), spindleCount]);
    }

    // ── Makino V300 ──────────────────────────────────────────────────────────
    // Precision die-mold VMC. 20k HSK-A63 direct-drive spindle, dual-contact (HSK).
    // Travels X650/Y450/Z350 mm = 25.6/17.7/13.8 in. Linear roller guides.
    // Torque inferred from 30 HP / 20k class curve (no published full curve).
    await pool.query(`
      INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, x_travel_in, y_travel_in, z_travel_in, machine_type, control, way_type, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence)
      SELECT 'Makino', 'V300', 20000, 30, 'HSK-A63', 'direct', true, '{flood,tsc}', 1000, 25.6, 17.7, 13.8, 'vmc', 'Pro 5', 'linear', 75, 140, 6000, 6000, 'low'
      WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'Makino' AND model ILIKE 'V300')
    `);

    // ── Makino a51nx torque-note correction ──────────────────────────────────
    // The a51nx row's curve_source_note was copied from the a71nx (378 ft-lb /
    // 689 rpm). The a51nx is the 400mm-pallet 40-taper class (~240 Nm ≈ 177 ft-lb).
    // Fix the note text so it references the correct model. (Torque values left as
    // seeded — flagged 'low' confidence pending a Makino spec sheet.)
    await pool.query(`
      UPDATE machines SET
        curve_source_note = 'Makino a51nx 40-taper direct-drive spindle; torque estimated from HP nameplate — a51nx-specific curve not published, verify with Makino tech docs.'
      WHERE brand ILIKE 'Makino' AND model ILIKE 'a51nx'
        AND curve_source_note ILIKE '%a71nx%'
    `);

    // ── Makino a-series 5-axis variants ──────────────────────────────────────
    // 5-axis machines built on the nx HMC platform (verified against makino.com
    // /horizontal-5-axis category pages). Distinct from the already-seeded
    // a500Z/a800Z/a900Z/a500iR. Travels are workpiece-envelope class figures;
    // torque estimated from spindle kW class → 'low' confidence.
    //   a51nx-5XU: BT40/HSK-A63 cutting spindle, 14k/20k, work-pallet magazine.
    //   a61nx-5E : aluminum/aerospace 5-axis, HSK-A63 class, up to 24k.
    //   a92-5XR  : 5-axis variant of the a92 (CAT50/HSK-A100 class).
    // [model, max_rpm, hp, taper, drive, x_in, y_in, z_in, base_tq, rated_rpm, notes]
    const makino5x: [string, number, number, string, string, number, number, number, number, number, string][] = [
      ["a51nx-5XU", 14000, 50, "HSK-A63", "direct", 22.0, 22.0, 22.0, 240, 14000, "5-axis on a51nx platform; direct-drive B & C; work-pallet magazine (WPM22). 20k spindle optional."],
      ["a61nx-5E",  14000, 50, "HSK-A63", "direct", 28.7, 28.7, 26.8, 240, 14000, "5-axis aluminum/aerospace; twin direct-drive rotary; 24k / 80 kW aluminum spindle optional."],
      ["a92-5XR",   10000, 100, "CAT50",  "gear",   59.8, 49.2, 53.1, 525, 10000, "5-axis variant of the a92; large-part CAT50 platform."],
    ];
    for (const m of makino5x) {
      const [model, maxRpm, hp, taper, drive, xIn, yIn, zIn, baseTq, ratedRpm, notes] = m;
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, x_travel_in, y_travel_in, z_travel_in, machine_type, control, base_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence, curve_source_note, notes)
        SELECT 'Makino', $1, $2, $3, $4, $5, false, '{flood,tsc}', 300, $6, $7, $8, '5axis', 'Fanuc', $9, 1200, $10, 'low', 'Estimated spindle curve from kW class; Makino full curve not published — verify with Makino tech docs.', $11
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'Makino' AND model ILIKE $1)
      `, [model, maxRpm, hp, taper, drive, xIn, yIn, zIn, baseTq, ratedRpm, notes]);
    }

    // ── Makino legacy A-series horizontals (bare-name, pre-"nx") ──────────────
    // The older horizontal A-series marketed before the current nx generation.
    // Distinct from the already-seeded nx HMCs (a51nx/a61nx/…) and the "A51"
    // and "a40 Special Edition" rows. Specs cross-referenced from Makino
    // brochures / Techspex / dealer spec sheets (headland a71.a81 PDF,
    // techspex a40/a71, machinetoolsonline A100E, surplusrecord/tramar A99).
    // Travels are catalog X/Y/Z; torque is ESTIMATED from HP/kW class — Makino
    // does not publish full torque curves for these, so curve_confidence='low'.
    // NOTE: there is no standalone legacy "A63" horizontal — "A63" is the
    // HSK-A63 spindle taper (already on the a61nx), not a model. Not seeded.
    // [model, max_rpm, hp, taper, drive, x_in, y_in, z_in, mtype, control, base_tq, peak_tq, peak_rpm, notes]
    const makinoLegacyHmc: [string, number, number, string, string, number, number, number, string, string, number, number, number, string][] = [
      ["a40",   12000, 40, "CAT40", "direct", 22.0, 25.2, 25.2, "hmc", "Pro 5", 130, 200, 3000, "Non-ferrous/die-cast HMC; #40 spindle to 12k (SE variant 20k). Travels 560x640x640 mm."],
      ["a61",   12000, 40, "CAT40", "direct", 28.7, 25.6, 31.5, "hmc", "Pro 5", 130, 210, 3000, "Legacy a61 horizontal (pre-nx); ±0.0025 mm positioning. HSK-A63 spindle optional."],
      ["a71",   10000, 47, "CAT50", "gear",   28.7, 28.7, 31.5, "hmc", "SGI.3", 260, 340, 1500, "Legacy a71; 730x730x800 mm travels, 360deg B pallet. #50 taper, HSK100A optional. 47 HP 30-min rating."],
      ["a81",   10000, 60, "CAT50", "gear",   28.7, 28.7, 31.5, "hmc", "SGI.3", 320, 420, 1500, "Legacy a81; shares a71 730x730x800 mm platform; higher-power #50 spindle. HSK100A optional."],
      ["A99",   12000, 40, "CAT50", "gear",   39.0, 39.0, 37.0, "hmc", "Pro 3", 200, 300, 2000, "Legacy A99 (2000-2001 era); 31.5\" pallets, 40 ATC, 1000 psi TSC, full 4th-axis contouring."],
      ["A100E", 10000, 60, "CAT50", "gear",   66.9, 53.1, 55.1, "hmc", "Pro/GI",320, 430, 1500, "Large-part legacy HMC; 1700x1350x1400 mm travels, 1000 mm pallet (3000/5000 kg). #50 taper, HSK-A100 optional. GI high-feed."],
    ];
    for (const m of makinoLegacyHmc) {
      const [model, maxRpm, hp, taper, drive, xIn, yIn, zIn, mtype, control, baseTq, peakTq, peakRpm, notes] = m;
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, x_travel_in, y_travel_in, z_travel_in, machine_type, control, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence, curve_source_note, notes)
        SELECT 'Makino', $1, $2, $3, $4, $5, $6, '{flood,tsc}', 1000, $7, $8, $9, $10, $11, $12, $13, $14, $2, 'low', 'Estimated spindle curve from HP/kW class; Makino full torque curve not published for legacy A-series — verify with Makino tech docs.', $15
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'Makino' AND model ILIKE $1)
      `, [model, maxRpm, hp, taper, drive, taper.startsWith("HSK"), xIn, yIn, zIn, mtype, control, baseTq, peakTq, peakRpm, notes]);
    }

    // ── Fadal legacy VMC catalog ─────────────────────────────────────────────
    // Complete legacy VMC family (TRM through 6535), from Fadal maintenance-manual
    // spec pages. All CAT40 (No. 40 taper) except the 6535 50-taper option (own row).
    // Box ways + gear drive (all 10K machines use an auto 2-speed belt/gear drive;
    // 7.5K machines a single lower-torque package) → dual_contact false, way_type box.
    // Torque model: base_torque_ftlb = low-range peak (published), which occurs in the
    // ~150-500 RPM band (peak_torque_rpm 500); peak_torque_ftlb = optional/HT-package
    // peak where one exists, else same as base. Travels use the STANDARD Z (20");
    // optional deeper Z noted in `notes`. Control = 'Fadal' (CNC88/32MP era). TSC was
    // an option, not standard — base rows are flood-only. Confidence 'medium' (specs
    // published, but no plotted torque curves).
    // [model, max_rpm, hp, x_in, y_in, z_in, base_tq, peak_tq, notes]
    const fadalMachines: [string, number, number, number, number, number, number, number, string][] = [
      ["VMC TRM",   4000,  5,    30, 14, 14, 28,  28,  "Toolroom mill, CAT/BT40"],
      ["VMC EMC",   7500,  12,   20, 16, 14, 36,  36,  "Economy machining center"],
      ["VMC 15",    7500,  15,   20, 16, 20, 75,  75,  "28\" Z optional"],
      ["VMC 15XT",  7500,  15,   30, 16, 20, 75,  75,  "28\" Z optional"],
      ["VMC 2016L", 7500,  15,   20, 16, 20, 75,  75,  "28\" Z optional"],
      ["VMC 2216",  10000, 15,   22, 16, 20, 160, 220, "15K spindle optional; 22.5 HP HT package gives 220 ft-lb; 28\" Z optional"],
      ["VMC 3016",  10000, 15,   30, 16, 20, 160, 220, "15K spindle optional; 22.5 HP HT package gives 220 ft-lb; 28\" Z optional"],
      ["VMC 3016L", 7500,  15,   30, 16, 20, 75,  75,  "28\" Z optional"],
      ["VMC 3020",  10000, 15,   30, 20, 20, 160, 290, "15K spindle optional; HT 22.5 HP gives 290 ft-lb; 24\" Z optional"],
      ["VMC 4020",  10000, 15,   40, 20, 20, 160, 220, "15K optional; 22.5 HP HT / 30 HP VHT packages; 28\" Z optional"],
      ["VMC 4020A", 7500,  22.5, 40, 20, 20, 120, 120, "28\" Z optional"],
      ["VMC 5020A", 7500,  22.5, 50, 20, 20, 120, 120, "28\" Z optional"],
      ["VMC 4525",  10000, 22.5, 45, 25, 24, 220, 270, "15K optional; 30 HP option gives 270 ft-lb"],
      ["VMC 6030",  10000, 15,   60, 30, 30, 160, 220, "22.5 HP HT package gives 220 ft-lb"],
      ["VMC 8030",  10000, 15,   80, 30, 30, 160, 220, "15K optional; 22.5 HP HT gives 220 ft-lb"],
      ["VMC 6535",  10000, 22.5, 65, 35, 34, 220, 270, "40-taper; 15K optional; 30 HP option gives 270 ft-lb; 15 lb (40 lb on 6535) max tool weight"],
    ];
    for (const m of fadalMachines) {
      const [model, maxRpm, hp, xIn, yIn, zIn, baseTq, peakTq, notes] = m;
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, x_travel_in, y_travel_in, z_travel_in, machine_type, control, way_type, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence, notes)
        SELECT 'Fadal', $1, $2, $3, 'CAT40', 'gear', false, '{flood}', $4, $5, $6, 'vmc', 'Fadal', 'box', $7, $8, 500, $2, 'medium', $9
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'Fadal' AND model ILIKE $1)
      `, [model, maxRpm, hp, xIn, yIn, zIn, baseTq, peakTq, notes]);
    }
    // VMC 6535 50-taper option — materially different spindle package (CAT50,
    // 7,500 RPM ceiling, 35 HP cont. / 50 HP peak, 24-tool dual-arm changer).
    await pool.query(`
      INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, x_travel_in, y_travel_in, z_travel_in, machine_type, control, way_type, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence, notes)
      SELECT 'Fadal', 'VMC 6535 (50-taper)', 7500, 35, 'CAT50', 'gear', false, '{flood}', 65, 35, 34, 'vmc', 'Fadal', 'box', 270, 350, 500, 7500, 'medium', '50-taper option; 35 HP continuous / 50 HP peak; 24-tool dual-arm changer; 40 lb max tool weight'
      WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'Fadal' AND model ILIKE 'VMC 6535 (50-taper)')
    `);
    // Larger Fadal VMCs (mid-size and up) offered Fadal's "Cool Power" thermal
    // system with TSC/washdown options — the small TRM/EMC/15-class did not.

    // ── Fadal current (relaunched) lineup ────────────────────────────────────
    // All mills (FG5/FL turning centers dropped from catalog). Relaunched line
    // uses a dual-belt hi/lo 2-speed drive (→ 'belt', a correction from the
    // legacy 'gear' rows) except the 30-taper 2015HS (direct integral spindle)
    // and the 50-taper transmission machines ('gear'). Control = 'Fadal MP'
    // (backward-compatible with 88HS/MP; some used units carry '64MP').
    // 4020 named 'VMC 4020 B-II' so it does NOT collide with the legacy 4020.
    // Where Fadal doesn't publish specs (3320, 4022, 8032, /50T pair, VM5ax320)
    // unknowns are NULL and confidence 'low' with a verify note. TSC (CTS) is
    // optional on all → base rows flood-only.
    // [model, max_rpm, hp, taper, drive, x, y, z, mtype, way, baseTq, peakTq, peakRpm, conf, notes]
    const fadalCurrentMachines: [string, number, number|null, string|null, string, number|null, number|null, number|null, string, string, number|null, number|null, number|null, string, string][] = [
      ["VMC 2015HS",   12000, 10,   "BT30",  "direct", 19.7, 15.7, 16, "vmc",   "linear", 43.5, 43.5, 6000, "medium", "Current lineup. High-speed 30-taper; 15K/20K/24K RPM optional; 20-tool dual-arm ATC 1.0s tool-to-tool; 1890 IPM rapids. CTS optional."],
      ["VMC 2520",     10000, 22.5, "CAT40", "belt",   25.5, 20,   20, "vmc",   "box",    220,  220,  500,  "medium", "Current lineup. 30\" Z optional; dual-belt hi/lo 2-speed; 24-tool dual-arm ATC; rapids 1410/1410/1187 IPM. CTS optional."],
      ["VMC 4020 B-II", 10000, 22.5, "CAT40", "belt",  40,   20,   20, "vmc",   "box",    220,  300,  500,  "medium", "Current lineup (relaunched 4020, distinct from legacy). CAT40 std / BT40 opt; 15K RPM opt; 30 HP VHT opt gives 300 ft-lb; 30\" Z opt; 1000 IPM rapids. CTS opt."],
      ["VMC 6032",     10000, 22.5, "CAT40", "belt",   60,   32,   30, "vmc",   "box",    220,  300,  500,  "medium", "Current lineup. CAT40 std / BT40 opt; 15K RPM opt; 30 HP VHT opt gives 300 ft-lb; 50mm ballscrews; 787/787/590 IPM rapids; four chip augers. CTS opt."],
      ["VMC 8032",     10000, 22.5, "CAT40", "belt",   80,   32,   30, "vmc",   "box",    220,  300,  500,  "medium", "Current lineup. CAT40 std / BT40 opt; 10K std / 15K opt; 22.5 HP std / 30 HP (15K package) peak; 220 std / 300 ft-lb peak; belt drive; rapids 787/787/590 IPM; 24/30/40-tool dual-arm ATC. Travels 80/32/30 and full spindle package CONFIRMED on fadal.com/vmc-8032. CTS optional."],
      // 3320 = VMC-3320R-II. Dual-belt hi/lo 2-speed: 15 HP/175 ft-lb low, 22.5 HP/220 high.
      ["VMC 3320",     10000, 22.5, "CAT40", "belt",   33,   20,   20, "vmc",   "box",    175,  220,  500,  "medium", "Current lineup (VMC-3320R-II). CAT40 std / BT40 opt; 10K std / 15K opt; dual-belt hi/lo 2-speed: 15 HP/175 ft-lb low range, 22.5 HP/220 ft-lb high-torque range; 30\" Z opt; rapids 1410/1410/1187 IPM; 24-tool (30 opt) dual-arm ATC ~1.5s. peak_torque_rpm ~500 inferred from 4020 family. CTS optional."],
      // 4022 travels/rapids CONFIRMED; HP/torque genuinely unpublished by Fadal (do NOT infer from 4020).
      ["VMC 4022",     10000, null, "CAT40", "belt",   40,   22,   22, "vmc",   "box",    null, null, null, "low",    "Current lineup. CAT40, 10K RPM, belt drive; travels 40/22/22 and rapids 1410/1410/1410 IPM CONFIRMED on fadal.com; 30-tool ATC optional. Spindle HP/torque NOT published by Fadal for the 4022 (do not infer from 4020) — verify (844) 323-2526."],
      ["VMC 6032/50T", 6000,  null, "CAT50", "gear",   60,   32,   30, "vmc",   "box",    null, null, null, "low",    "Current lineup. 50-taper, 6000 RPM two-speed transmission; HP/torque not published by Fadal — verify (844) 323-2526."],
      ["VMC 8032/50T", 6000,  null, "CAT50", "gear",   80,   32,   30, "vmc",   "box",    null, null, null, "low",    "Current lineup. 50-taper, 6000 RPM two-speed transmission; HP/torque not published by Fadal — verify (844) 323-2526."],
      // VM5ax320: BIG-PLUS CAT40 (dual-contact), 15K direct-drive, 5-axis trunnion. HP/torque unpublished.
      ["VM5ax320",     15000, null, "CAT40", "direct", 18.11, 24.01, 20.07, "5axis","linear", null, null, null, "medium", "Current lineup. 5-axis trunnion (A-axis +30/-120 deg, C-axis 360 deg; 320mm/12.6\" rotary table). BIG-PLUS CAT40 (dual-contact), 15,000 RPM direct-drive, CTS-ready; 30-tool swing-arm ATC; 945 IPM feed; work env 400mm dia x 300mm, 220 lb. Travels/taper/RPM CONFIRMED on fadal.com/5-axis. Spindle HP/torque NOT published — verify (844) 323-2526."],
    ];
    for (const m of fadalCurrentMachines) {
      const [model, maxRpm, hp, taper, driveType, xIn, yIn, zIn, mtype, wayType, baseTq, peakTq, peakRpm, confidence, notes] = m;
      // dual_contact: BT30 face-contact + VM5ax320's BIG-PLUS CAT40 are dual-contact; plain CAT40/CAT50 are not.
      const dualContact = taper === "BT30" || model === "VM5ax320";
      await pool.query(`
        INSERT INTO machines (brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, x_travel_in, y_travel_in, z_travel_in, machine_type, control, way_type, base_torque_ftlb, peak_torque_ftlb, peak_torque_rpm, rated_rpm, curve_confidence, notes)
        SELECT 'Fadal', $1, $2, $3, $4, $5, $6, '{flood}', $7, $8, $9, $10, 'Fadal MP', $11, $12, $13, $14, $2, $15, $16
        WHERE NOT EXISTS (SELECT 1 FROM machines WHERE brand ILIKE 'Fadal' AND model ILIKE $1)
      `, [model, maxRpm, hp, taper, driveType, dualContact, xIn, yIn, zIn, mtype, wayType, baseTq, peakTq, peakRpm, confidence, notes]);
    }
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
    // Per-email blocklist: cut off a specific address you recognize as bad
    // access (sits between "block whole domain" and "suspend an existing user").
    // The legacy allowed_emails allowlist is dead (open-access); this replaces it.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_emails (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
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
      const celRaw = req.query.required_chamfer_length ? parseFloat(String(req.query.required_chamfer_length)) : null;
      const CEL_FILTER = (celRaw && !isNaN(celRaw) && celRaw > 0) ? ` AND s.max_cutting_edge_length >= ${celRaw}` : "";

      // Cross-filter inputs from other dropdowns (each excluded from its own dropdown query)
      const seriesRaw = req.query.series ? String(req.query.series).split(",").map(s => s.trim()).filter(Boolean) : [];
      const SERIES_FILTER = seriesRaw.length
        ? ` AND s.series = ANY(ARRAY[${seriesRaw.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[])`
        : "";
      const flutesRaw = req.query.flutes ? String(req.query.flutes).split(",").map(Number).filter(n => !isNaN(n)) : [];
      const FLUTES_FILTER = flutesRaw.length
        ? ` AND s.flutes = ANY(ARRAY[${flutesRaw.join(",")}]::int[])`
        : "";
      const locRaw = req.query.loc ? String(req.query.loc).split(",").map(Number).filter(n => !isNaN(n)) : [];
      const LOC_FILTER = locRaw.length
        ? ` AND s.loc_in = ANY(ARRAY[${locRaw.join(",")}]::float[])`
        : "";
      const cornerRaw = req.query.corner ? String(req.query.corner).split(",").map(s => s.trim()).filter(Boolean) : [];
      const CORNER_FILTER = cornerRaw.length
        ? ` AND s.corner_condition = ANY(ARRAY[${cornerRaw.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[])`
        : "";
      const coatingRaw = req.query.coating ? String(req.query.coating).split(",").map(s => s.trim()).filter(Boolean) : [];
      const COATING_FILTER = coatingRaw.length
        ? ` AND s.coating = ANY(ARRAY[${coatingRaw.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[])`
        : "";
      const geomRaw = req.query.geometry ? String(req.query.geometry).split(",").map(s => s.trim()).filter(Boolean) : [];
      const GEOM_FILTER = geomRaw.length
        ? ` AND s.geometry = ANY(ARRAY[${geomRaw.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[])`
        : "";
      const ccRaw = req.query.center_cutting ? String(req.query.center_cutting) : "all";
      const CC_FILTER = ccRaw === "yes" ? ` AND s.center_cutting = TRUE`
                      : ccRaw === "no"  ? ` AND s.center_cutting = FALSE`
                      : "";
      const chAngleRaw = req.query.chamfer_angle ? String(req.query.chamfer_angle).split(",").map(Number).filter(n => !isNaN(n)) : [];
      const CHANGLE_FILTER = chAngleRaw.length
        ? ` AND s.chamfer_angle = ANY(ARRAY[${chAngleRaw.join(",")}]::float[])`
        : "";
      const tipDiaRaw = req.query.tip_diameter ? String(req.query.tip_diameter).split(",").map(Number).filter(n => !isNaN(n)) : [];
      const TIPDIA_FILTER = tipDiaRaw.length
        ? ` AND s.tip_diameter = ANY(ARRAY[${tipDiaRaw.join(",")}]::float[])`
        : "";
      const LBS_EXCLUDE_FILTER = (req.query.lbs_exclude === "true") ? ` AND (s.lbs_in IS NULL OR s.lbs_in = 0)` : "";

      const BASE = `FROM skus s JOIN sku_uploads u ON s.upload_id = u.id WHERE u.is_current = TRUE`;

      // Every active filter goes into COMMON. Each dropdown query then strips
      // only its own column's filter so its current selection doesn't hide
      // other reachable values — but every OTHER filter (including diameter)
      // still narrows it.
      const COMMON =
        `${TYPE_FILTER}${MAT_FILTER}${DIA_FILTER}` +                                       // structural + diameter
        `${SERIES_FILTER}${FLUTES_FILTER}${LOC_FILTER}${CORNER_FILTER}${COATING_FILTER}` + // discrete dropdowns
        `${GEOM_FILTER}${CC_FILTER}${CHANGLE_FILTER}${TIPDIA_FILTER}` +
        `${LBS_FILTER}${LBS_EXCLUDE_FILTER}` +
        `${CR_FILTER}${FR_FILTER}${AXIAL_FILTER}${REACH_FILTER}${CEL_FILTER}` +            // continuous inputs
        `${MAX_FLUTES_FILTER}${MIN_FLUTES_FILTER}`;

      // Helper: strip named filter chunks out of COMMON for the dropdown of that column
      const without = (...exclude: string[]) =>
        exclude.filter(s => s.length > 0).reduce((acc, e) => acc.replace(e, ""), COMMON);

      const [diameters, locs, lbsLengths, coatings, flutes, corners, geometries, chamferLengths, chamferAngles, tipDiameters, series, centerCuttingVals] = await Promise.all([
        pool.query(`SELECT DISTINCT cutting_diameter_in AS v ${BASE}${without(DIA_FILTER)} AND cutting_diameter_in IS NOT NULL ORDER BY cutting_diameter_in`),
        pool.query(`SELECT DISTINCT loc_in AS v ${BASE}${without(LOC_FILTER)} AND loc_in IS NOT NULL ORDER BY loc_in`),
        pool.query(`SELECT DISTINCT lbs_in AS v ${BASE}${without(LBS_FILTER, LBS_EXCLUDE_FILTER, AXIAL_FILTER, REACH_FILTER)}${LBS_AXIAL_FILTER} AND lbs_in IS NOT NULL AND lbs_in > 0 ORDER BY lbs_in`),
        pool.query(`SELECT DISTINCT coating AS v ${BASE}${without(COATING_FILTER)} AND coating IS NOT NULL ORDER BY coating`),
        pool.query(`SELECT DISTINCT flutes AS v ${BASE}${without(FLUTES_FILTER, MAX_FLUTES_FILTER, MIN_FLUTES_FILTER)} AND flutes IS NOT NULL ORDER BY flutes`),
        pool.query(`SELECT DISTINCT corner_condition AS v ${BASE}${without(CORNER_FILTER, FR_FILTER)} AND corner_condition IS NOT NULL ORDER BY corner_condition`),
        pool.query(`SELECT DISTINCT geometry AS v ${BASE}${without(GEOM_FILTER)} AND geometry IS NOT NULL ORDER BY geometry`),
        pool.query(`SELECT DISTINCT max_cutting_edge_length AS v ${BASE}${without(CEL_FILTER)} AND max_cutting_edge_length IS NOT NULL ORDER BY max_cutting_edge_length`),
        pool.query(`SELECT DISTINCT chamfer_angle AS v ${BASE}${without(CHANGLE_FILTER)} AND chamfer_angle IS NOT NULL ORDER BY chamfer_angle`),
        pool.query(`SELECT DISTINCT tip_diameter AS v ${BASE}${without(TIPDIA_FILTER)} AND tip_diameter IS NOT NULL ORDER BY tip_diameter`),
        pool.query(`SELECT DISTINCT series AS v ${BASE}${without(SERIES_FILTER)} AND series IS NOT NULL ORDER BY series`),
        pool.query(`SELECT DISTINCT center_cutting AS v ${BASE}${without(CC_FILTER)} AND center_cutting IS NOT NULL ORDER BY center_cutting`),
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
          stainless_440c: "iso_m", stainless_15_5: "iso_m", stainless_ph: "iso_m",
          stainless_13_8: "iso_m", stainless_duplex: "iso_m",
          stainless_superduplex: "iso_m", manganese_steel: "iso_m",
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
        // Set suggested_edps + a per-EDP {dia, loc, flutes} map so the UI can label each chip.
        const setSuggestedEdps = (sug: any, rows: any[]) => {
          sug.suggested_edps = rows.map((r: any) => r.edp);
          sug.suggested_edp  = sug.suggested_edps[0];
          sug.suggested_edp_meta = {};
          for (const r of rows) {
            if (r.edp == null) continue;
            sug.suggested_edp_meta[String(r.edp)] = {
              dia: r.cutting_diameter_in != null ? Number(r.cutting_diameter_in) : null,
              loc: r.loc_in != null ? Number(r.loc_in) : null,
              flutes: r.flutes != null ? Number(r.flutes) : null,
            };
          }
        };
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
                  `SELECT s.edp, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
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
                  setSuggestedEdps(s, q.rows);
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
                  `SELECT s.edp, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
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
                  setSuggestedEdps(s, qsl.rows);
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
                  setSuggestedEdps(s, rows);
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
                  `SELECT s.edp, s.corner_condition, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
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
                    `SELECT s.edp, s.corner_condition, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
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
                      `SELECT s.edp, s.corner_condition, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
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
                // HEM slot step-up: also surface CHIPBREAKER variants at this diameter across
                // the whole flute-option set (e.g. 4/5/6-flute). The deep, light-radial HEM cut
                // evacuates well with a segmented chip, and CB comes in these flute counts here.
                // Attached separately as suggested_edps_cb so the UI can show std + CB side by side.
                if (s.hem_slot_stepup) {
                  const fluteOpts: number[] = Array.isArray(s.lookup_flute_opts) && s.lookup_flute_opts.length
                    ? s.lookup_flute_opts.map((n: any) => Number(n)).filter((n: number) => n > 0)
                    : [flutes];
                  try {
                    const qcb = await pool.query(
                      `SELECT s.edp, s.corner_condition, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
                       JOIN sku_uploads u ON s.upload_id = u.id
                       WHERE u.is_current = TRUE
                         AND LOWER(COALESCE(s.geometry, '')) = 'chipbreaker'
                         AND s.flutes = ANY($1::int[])
                         AND ABS(s.cutting_diameter_in - $2) < 0.001
                         AND COALESCE(s.loc_in, 0) >= $3
                         AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
                         ${noBLK}
                         ${matClause}
                       ORDER BY s.flutes ASC, s.loc_in ASC, s.edp`,
                      [fluteOpts, dia, loc]
                    );
                    if (qcb.rows.length > 0) {
                      s.suggested_edps_cb = qcb.rows.map((r: any) => r.edp);
                      s.suggested_edp_cb  = s.suggested_edps_cb[0];
                      s.suggested_edp_cb_meta = {};
                      for (const r of qcb.rows) {
                        if (r.edp == null) continue;
                        s.suggested_edp_cb_meta[String(r.edp)] = {
                          dia: r.cutting_diameter_in != null ? Number(r.cutting_diameter_in) : null,
                          loc: r.loc_in != null ? Number(r.loc_in) : null,
                          flutes: r.flutes != null ? Number(r.flutes) : null,
                        };
                      }
                    }
                  } catch (_) { /* skip CB enrichment on error */ }
                }
              } else {
              // Non-diameter suggestions: find the closest LOC
              const q2 = await pool.query(
                `SELECT s.edp, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
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
                setSuggestedEdps(s, q2.rows);
              } else {
                // Fallback: ignore corner, just match flutes + dia + closest LOC
                // Still enforce LBS requirement so we don't return a short-reach tool for an LBS job
                const q3 = await pool.query(
                  `SELECT s.edp, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
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
                  setSuggestedEdps(s, q3.rows);
                } else if (lookupLbs > 0) {
                  // Final fallback: no tool meets lbs >= lookupLbs — use highest available LBS
                  // (user may have manually entered a larger LBS than any stocked tool)
                  const q4 = await pool.query(
                    `SELECT s.edp, s.cutting_diameter_in, s.loc_in, s.flutes FROM skus s
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
                    setSuggestedEdps(s, q4.rows);
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

        // Chipbreaker upgrade EDP lookup — when the deep-slot advisory fired in
        // the engine, find chipbreaker SKUs at the same dia / flute / corner /
        // sufficient LOC so the UI can offer concrete "-CB" alternatives.
        const cbUp = (raw as any)?.customer?.cb_upgrade;
        if (cbUp && cbUp.tool_dia > 0 && cbUp.flutes > 0) {
          try {
            const cbDia    = Number(cbUp.tool_dia);
            const cbFlutes = Number(cbUp.flutes);
            const cbLoc    = Number(cbUp.lookup_loc ?? cbUp.loc ?? 0);
            const cbCorner = String(cbUp.lookup_corner ?? "").toLowerCase();
            const cbCr     = Number(cbUp.lookup_cr ?? 0);
            const cbLbs    = Number(cbUp.lookup_lbs ?? 0);
            const cbInputHasCr = cbCorner !== "square" && cbCorner !== "ball" && cbCr > 0;
            const cbCornerStr = (cbCorner === "square" || cbCorner === "ball") ? cbCorner : String(parseFloat(cbCr.toFixed(4)));
            const cbCrFilter = cbInputHasCr
              ? ` AND CASE WHEN s.corner_condition ~ '^[0-9]' THEN s.corner_condition::numeric ELSE 999 END <= ${cbCr}`
              : "";
            const cbLbsFilter = cbLbs > 0 ? ` AND COALESCE(s.lbs_in, 0) >= ${cbLbs}` : "";
            // First try: exact dia + same/more flutes + sufficient LOC + matching corner
            const cbQ = await pool.query(
              `SELECT s.edp, s.series, s.loc_in, s.flutes
               FROM skus s
               JOIN sku_uploads u ON s.upload_id = u.id
               WHERE u.is_current = TRUE
                 AND LOWER(COALESCE(s.geometry, '')) = 'chipbreaker'
                 AND ABS(s.cutting_diameter_in - $1) < 0.001
                 AND s.flutes >= $2
                 AND COALESCE(s.loc_in, 0) >= $3
                 AND (LOWER(s.corner_condition) = LOWER($4) OR LOWER(s.corner_condition) NOT IN ('square','ball'))
                 ${cbCrFilter}
                 ${cbLbsFilter}
                 ${matClause}
               ORDER BY s.flutes ASC, s.loc_in ASC, s.edp
               LIMIT 5`,
              [cbDia, cbFlutes, cbLoc, cbCornerStr]
            );
            if (cbQ.rows.length > 0) {
              cbUp.suggested_edps = cbQ.rows.map((r: any) => r.edp);
              cbUp.suggested_edp  = cbUp.suggested_edps[0];
              cbUp.suggested_series = cbQ.rows[0].series;
              cbUp.suggested_loc    = Number(cbQ.rows[0].loc_in);
              cbUp.suggested_flutes = Number(cbQ.rows[0].flutes);
            }
          } catch (_) { /* skip on error */ }
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

  // ── Slotting diameter chips: best stocked EDP per candidate diameter ─────────
  // The slotting panel shows clickable Ø chips. This resolves the actual best-scored
  // stocked tool at each candidate diameter for the material + strategy, so each chip
  // names a real EDP. Chips with no stocked tool are omitted (client hides them).
  //   Traditional: candidate dias ≤ slot width (plow + side passes).
  //   HEM:         candidate dias 0.40–0.70× slot width (trochoidal), multi-flute.
  // Corner default: 0.030" CR — when the slot doesn't demand square, a CR0.030 tool
  // is the common stock choice; we prefer it but accept square as fallback.
  app.post("/api/slot-dia-tools", async (req, res) => {
    try {
      const { slot_width_in, slot_strategy, material, final_slot_depth, default_cr } = req.body ?? {};
      const width = Number(slot_width_in ?? 0);
      if (!(width > 0)) return res.json({ chips: [] });
      const strat = String(slot_strategy ?? "traditional").toLowerCase();
      const depth = Number(final_slot_depth ?? 0);
      const defCr = Number(default_cr ?? 0.030);
      const { pool } = await import("./db");

      // Material → ISO column (same map used by EDP enrichment).
      const MATERIAL_ISO: Record<string, string> = {
        aluminum_wrought: "iso_n", aluminum_wrought_hs: "iso_n", aluminum_cast: "iso_n", non_ferrous: "iso_n",
        manganese_bronze: "iso_p", silicon_bronze: "iso_p", copper_beryllium: "iso_p",
        steel_alloy: "iso_p", steel_mild: "iso_p", steel_free: "iso_p",
        tool_steel_p20: "iso_p", tool_steel_a2: "iso_p", tool_steel_h13: "iso_p",
        tool_steel_s7: "iso_p", tool_steel_d2: "iso_p", cpm_10v: "iso_p",
        stainless_304: "iso_m", stainless_316: "iso_m", stainless_fm: "iso_m",
        stainless_ferritic: "iso_m", stainless_410: "iso_m", stainless_420: "iso_m",
        stainless_440c: "iso_m", stainless_15_5: "iso_m", stainless_ph: "iso_m",
        stainless_13_8: "iso_m", stainless_duplex: "iso_m",
        stainless_superduplex: "iso_m", manganese_steel: "iso_m",
        cast_iron_gray: "iso_k", cast_iron_ductile: "iso_k", cast_iron_cgi: "iso_k", cast_iron_malleable: "iso_k",
        titanium_64: "iso_s", titanium_cp: "iso_s", hiTemp_fe: "iso_s", hiTemp_co: "iso_s",
        monel_k500: "iso_s", inconel_625: "iso_s", inconel_718: "iso_s",
        hastelloy_x: "iso_s", waspaloy: "iso_s", mp35n: "iso_s",
        hardened_lt55: "iso_h", hardened_gt55: "iso_h", armor_ar400: "iso_h", armor_ar500: "iso_h",
      };
      const isoCol = MATERIAL_ISO[String(material ?? "")] ?? null;
      const isN = isoCol === "iso_n";
      const isHem = strat === "hem";

      const STD_DIAS = [0.0625, 0.09375, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.75, 1.0, 1.25, 1.5];
      // Traditional full-width slotting wants the LARGEST tool that fits the slot —
      // fewest side passes, most rigid. Laddering all the way down to tiny tools just
      // surfaces many-side-pass / many-Z-step suggestions nobody wants, so cap to the
      // largest 3 diameters ≤ width (e.g. 3/4, 5/8, 1/2 for a 3/4" slot — gives the
      // user a couple of step-down options without flooding with tiny tools). HEM
      // uses a 0.40–0.80× window (tool < slot): the 0.80× ceiling matches the 10%
      // per-wall clearance floor (leaves >=10% of slot width per side to loop) and
      // the engine's 0.85× sizing target, so a stiffer near-slot-width tool is
      // offered — e.g. a 0.350" slot now admits 0.250" as well as 0.1875" (was 0.70×
      // -> 0.1875" only, which surfaced NO chip when no small HEM tool was stocked).
      const candidates = isHem
        ? STD_DIAS.filter(d => d >= width * 0.40 - 1e-6 && d <= width * 0.80 + 1e-6)
        : STD_DIAS.filter(d => d <= width + 1e-4).slice(-3);
      if (!candidates.length) return res.json({ chips: [] });

      // Strategy-aware flute filter (mirrors optimal-tool scorer).
      // HEM's light radial bite rewards high flute counts (more teeth in the cut), so
      // there's no upper cap: ferrous ≥5fl, non-ferrous ≥3fl. Traditional full-slot is
      // gullet-limited: non-ferrous 2–3fl. Ferrous → 4-flute is the workhorse: a real
      // slot runs deeper than ½×D per pass, and a 5-flute tool is chip-clearance-capped
      // to 0.5×D in a full slot (see slot_doc_ceiling), so it would force extra Z-levels.
      // Surface 4fl (and below) only — the deep-slot guidance text says "go 4-flute."
      const fluteClause = isHem
        ? (isN ? `AND s.flutes >= 3` : `AND s.flutes >= 5`)
        : isN
          ? `AND COALESCE(s.geometry,'standard') != 'truncated_rougher' AND s.flutes IN (2,3)`
          : `AND s.flutes <= 4`;
      const matClause = isoCol ? `AND (s.${isoCol} = TRUE OR UPPER(s.series) IN ('QTR3','QTR3-RN'))` : "";
      // Reach is RANKED, not filtered: a tool that reaches the full slot depth in one
      // pass sorts ahead of a shorter one, but short-LOC tools still appear — the user
      // may run a longer-reach tool they have on hand and let the stability advisor pull
      // back feeds/DOC for the extra overhang. (LBS reach counts as reaching, too.)
      const reachRank = depth > 0
        ? `(CASE WHEN COALESCE(s.loc_in,0) >= ${(depth - 1e-4).toFixed(4)} OR COALESCE(s.lbs_in,0) >= ${(depth - 1e-4).toFixed(4)} THEN 0 ELSE 1 END) ASC,`
        : "";

      // Preferred default corner radius is SERIES- and DIAMETER-dependent (what Core
      // Cutter actually offers), not a continuous ladder:
      //   QTR series (QTR3 / QTR3-RN), 0.0625"–0.250" → 0.010"
      //   all other series,            0.125"–0.250"  → 0.015"
      //   larger tools (> 0.250")                     → 0.030" (defCr baseline)
      // Computed per row in SQL since it depends on each candidate's series.
      //
      // Flute-count preference (traditional ferrous only): the 4-flute is the slotting
      // workhorse — surface it ahead of a 3-flute so each Ø shows 4fl CB then 4fl std,
      // not a mix of flute counts. (HEM and non-ferrous already filter their own flute
      // band, so this orderer is a no-op there.) Lower distance-from-4 sorts first.
      const fluteRank = (!isHem && !isN)
        ? `ABS(s.flutes - 4) ASC,`
        : "";
      const chips: any[] = [];
      for (const dia of candidates) {
        // Pull the top-scored candidates at this diameter, then surface up to TWO
        // chips with a DISTINCT flute+geometry signature so the user sees the choice at
        // the same Ø (traditional ferrous → 4fl chipbreaker + 4fl standard; HEM → its
        // top two high-flute variants), not just one tool.
        const q = await pool.query(
          `SELECT s.edp, s.flutes, s.geometry, s.coating, s.corner_condition, s.loc_in, s.lbs_in, s.series,
                  (CASE WHEN LOWER(COALESCE(s.geometry,'standard')) = 'chipbreaker' THEN 3
                        WHEN LOWER(COALESCE(s.geometry,'standard')) = 'truncated_rougher' THEN 2
                        ELSE 1 END)
                + (CASE WHEN s.corner_condition ~ '^[0-9]'
                        THEN GREATEST(0, 2 - (ABS(s.corner_condition::numeric -
                              (CASE
                                 WHEN UPPER(COALESCE(s.series,'')) IN ('QTR3','QTR3-RN')
                                      AND s.cutting_diameter_in <= 0.250 THEN 0.010
                                 WHEN s.cutting_diameter_in <= 0.250 THEN 0.015
                                 ELSE ${defCr}
                               END)
                            ) * 40))
                        ELSE 1 END)        -- prefer the series/dia-appropriate CR; square = neutral
                  AS score
           FROM skus s JOIN sku_uploads u ON s.upload_id = u.id
           WHERE u.is_current = TRUE
             AND ABS(s.cutting_diameter_in - ${dia}) < 0.001
             AND s.edp NOT ILIKE '%-BLK'
             AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
             ${fluteClause} ${matClause}
           ORDER BY ${reachRank} ${fluteRank} score DESC, s.loc_in ASC NULLS LAST
           LIMIT 12`
        );
        // Z-steps to clear the slot are cut by the FLUTES, so the axial bite = LOC
        // (LBS = the non-fluted necked body below the flutes; it's clearance so the
        // tool can DESCEND to depth without the neck rubbing, not cutting length).
        const zStepsFor = (r: any) => {
          const reach = Number(r.loc_in) || 0;
          if (!(depth > 0) || !(reach > 0)) return 1;
          return Math.ceil((depth - 1e-4) / reach);
        };
        // A HEM candidate qualifies if it can PHYSICALLY reach the full slot depth —
        // either its flutes are long enough (LOC ≥ depth) OR it's a reduced-neck tool
        // whose necked body clears to depth (LBS ≥ depth). A necked tool still cuts in
        // LOC-sized Z-levels, so we surface it WITH its true Z-step count (the client
        // badges "N Z-steps") rather than hiding it — the user may have that RN tool on
        // hand and prefer it over a shorter-reach standard. (Was filtered to ≤2 Z-steps
        // on LOC alone, which wrongly hid necked tools that reach depth via LBS —
        // e.g. a 3/16" 5fl RN with 0.25" LOC + 1.0" LBS in a 1.0" slot.)
        const reachesDepth = (r: any) =>
          (Number(r.loc_in) || 0) >= depth - 1e-4 || (Number(r.lbs_in) || 0) >= depth - 1e-4;
        let rows = q.rows;
        if (isHem && depth > 0) {
          const reachable = rows.filter(reachesDepth);
          // Rank fewest Z-steps (deepest single-pass reach) first, then score. If nothing
          // reaches full depth at this Ø, suppress it (client hides empty Ø).
          rows = reachable.sort((a, b) => zStepsFor(a) - zStepsFor(b) || Number(b.score) - Number(a.score));
        }
        // Surface the best EDP for each distinct flute+geometry signature. A 5fl
        // chipbreaker and a 5fl standard are different tools — so are 6fl CB vs 6fl
        // standard — so dedupe on flutes+geometry, not flutes. HEM shows up to FOUR
        // signatures per Ø (e.g. 5fl CB / 6fl CB / 5fl std / 6fl std) so the customer
        // sees the full choice — in tougher materials the CB geometry takes a beating,
        // and some shops prefer to run the standard. Traditional stays at 2-per-Ø
        // (4fl CB + 4fl std) to avoid flooding the panel with side-pass options.
        // `rows` is already ordered best-first (reach/z-steps then score), so the first
        // row seen for each signature is that signature's best EDP.
        const sig = (r: any) => `${r.flutes}|${String(r.geometry ?? "standard").toLowerCase()}`;
        const maxPerDia = isHem ? 4 : 2;
        const seenSig = new Set<string>();
        const picks: any[] = [];
        for (const r of rows) {
          const g = sig(r);
          if (seenSig.has(g)) continue;
          seenSig.add(g);
          picks.push(r);
          if (picks.length >= maxPerDia) break;
        }
        // HEM display order: chipbreaker first (tougher-material choice up front), then
        // standard; within each geometry, fewer flutes first — i.e. 5fl CB, 6fl CB,
        // 5fl std, 6fl std. Z-steps are equal across same-LOC tools at one Ø, so this
        // reorder doesn't fight the cross-diameter fewest-Z-passes ranking above.
        if (isHem) {
          const geomRank = (r: any) => (String(r.geometry ?? "standard").toLowerCase() === "chipbreaker" ? 0 : 1);
          picks.sort((a, b) => geomRank(a) - geomRank(b) || Number(a.flutes) - Number(b.flutes));
        }
        for (const r of picks) {
          chips.push({
            dia,
            edp: r.edp,
            flutes: r.flutes,
            geometry: r.geometry ?? "standard",
            coating: r.coating ?? null,
            corner_condition: r.corner_condition ?? "square",
            loc_in: r.loc_in ?? null,
            lbs_in: r.lbs_in ?? null,
            series: r.series ?? null,
          });
        }
      }
      return res.json({ chips });
    } catch (e: any) {
      return res.status(500).json({ message: e?.message || "Internal error", chips: [] });
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
      // Slotting sub-strategy + dimensions drive WHICH tools we surface:
      //   traditional, width = dia → plow at dia (peers at current dia, as before)
      //   traditional, width > dia → plow + side pass: any stocked dia ≤ width works
      //   hem                      → trochoidal: smaller dias (~0.4–0.7× width), multi-flute
      const slotStrategy = String(payload.slot_strategy ?? "traditional").toLowerCase();
      const slotWidth    = Number(payload.slot_width_in ?? 0);
      const slotDepth    = Number(payload.final_slot_depth ?? 0);
      const isHemSlot    = mode === "slot" && slotStrategy === "hem" && slotWidth > dia;
      const isTradWideSlot = mode === "slot" && slotStrategy !== "hem" && slotWidth > dia + 1e-4;

      // ISO category needed before peer query (used in peer filter for slot/aluminum)
      const ISO_MAP: Record<string, string> = {
        aluminum_wrought: "N", aluminum_cast: "N",
        steel_mild: "P", steel_free: "P", steel_alloy: "P",
        stainless_304: "M", stainless_316: "M", stainless_15_5: "M", stainless_ph: "M", stainless_13_8: "M",
        stainless_duplex: "M", stainless_superduplex: "M", stainless_fm: "M",
        stainless_ferritic: "M", stainless_410: "M", stainless_420: "M", stainless_440c: "M",
        manganese_steel: "M",
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
      // Diameter is set by the slotting strategy's diameter CHIPS on the client (the
      // user taps a suggested size before running), so the scorer stays locked to the
      // chosen diameter and just finds the best tool AT that size — the tuned same-dia
      // candidate cascade below depends on this. We do NOT relax the dia clause here.
      // isHemSlot / isTradWideSlot remain available for strategy-aware flute & LOC rules.
      void isTradWideSlot;

      // Reach vs slot depth is RANKED, not filtered. Full-reach tools (LOC or LBS ≥
      // depth, established in one Z pass) sort first, but shorter tools still show —
      // a user may run a longer tool on hand, or step Z in HEM, and let the stability
      // advisor derate feeds/DOC for the actual reach. No hard LOC≥depth gate.
      const slotDepthRank = (mode === "slot" && slotDepth > 0)
        ? `(CASE WHEN COALESCE(s.loc_in, 0) >= ${(slotDepth - 1e-4).toFixed(4)} OR COALESCE(s.lbs_in, 0) >= ${(slotDepth - 1e-4).toFixed(4)} THEN 0 ELSE 1 END) ASC,`
        : "";

      // Flute filter — strategy-aware for slotting:
      //   HEM ferrous:     ≥5 flute (no upper cap — light bite rewards more teeth)
      //   HEM non-ferrous: ≥3 flute (no upper cap)
      //   trad N (aluminum): 2–3 flute, no VRX (gullet-limited, soft chips)
      //   trad ferrous:      ≤5 flute
      const isNslot = isoCategory === "N";
      let slotFluteClause = "";
      if (mode === "slot") {
        if (isHemSlot)                slotFluteClause = isNslot ? ` AND s.flutes >= 3` : ` AND s.flutes >= 5`;
        else if (isNslot)             slotFluteClause = ` AND COALESCE(s.geometry,'standard') != 'truncated_rougher' AND s.flutes IN (2,3)`;
        else                          slotFluteClause = ` AND s.flutes <= 5`;
      }

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
           ${slotFluteClause}
         ORDER BY ${slotDepthRank} s.edp`,
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
        // 5-fl VXR in slotting only at ≤ 0.5xD — exclude 5-fl VXR if deeper.
        // EXCEPT HEM slot, which is meant to run deep with multi-flute tools.
        if (isSlot && !isHemSlot && geom === "truncated_rougher" && rf >= 5 && docXd > 0.5) return false;
        // Never recommend a different corner condition than what the current tool has
        if (!cornerMatch(r)) return false;
        // Flute preference depends on strategy:
        //   HEM slot: light engagement — same or MORE flutes is good (5–6, capped in query).
        //   Traditional slot: never go up — chip clearance worsens; prefer dropping
        //     (aluminum → 3-fl, steel/tough → 4-fl).
        const fluteMatch = isHemSlot
          ? (rf === curFlutes || rf === nextFlutes || rf === prevFlutes)  // HEM: any nearby flute count is fine
          : (rf === curFlutes
            || (!isSlot && (stabOver || isCircInterp || isFinish) && rf === nextFlutes)
            || (isSlot && stabOver && rf === nextFlutes && nextFlutes <= 5) // slot + deflecting: allow 4→5fl only
            || (slotAlum  && rf === prevFlutes && prevFlutes >= 2)
            || (isSlot && !slotAlum && rf === prevFlutes && prevFlutes >= 4));
        return locMatch && fluteMatch;
      });
      let bestSku: any = null;
      let bestScore = -1;
      for (const row of sameLocCandidates) {
        let sc = scoreSku(row);
        const rf = Number(row.flutes);
        if (isHemSlot) {
          // HEM slot: more flutes raises feed and offsets the smaller-dia stiffness loss.
          if (rf > curFlutes) sc += 2;
        } else if (stabOver && rf === nextFlutes && (!isSlot || nextFlutes <= 5)) sc += STAB_FLUTE_BONUS;
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
      const { email, cc, operation, material, machine_name, results_text } = (req.body ?? {}) as {
        email?: string; cc?: string; operation?: string; material?: string;
        machine_name?: string; results_text?: string;
      };

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email address required." });
      }

      // CC is optional and delivery-only — it is NOT captured as a sales lead.
      const ccClean = typeof cc === "string" ? cc.trim() : "";
      if (ccClean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccClean)) {
        return res.status(400).json({ error: "Valid CC email address required." });
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
        console.warn("[Results Email] *** SMTP not configured (SMTP_USER/SMTP_PASS missing) — lead captured but NO email sent:", email, operation, material);
        // Lead is saved, but be honest that nothing was delivered.
        return res.json({ ok: true, sent: false, reason: "smtp_not_configured" });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost, port: smtpPort, secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      // Send results to user (including internal staff). Surface failures to the
      // caller instead of swallowing them — a silent {ok:true} made a failed send
      // indistinguishable from a successful one during dev testing.
      try {
        await transporter.sendMail({
          from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "scott@corecutterusa.com"}>`,
          to: email,
          ...(ccClean ? { cc: ccClean } : {}),
          subject: "Your Core Cutter Speeds & Feeds Results",
          text: [
            "Here are your machining parameters from the Core Cutter Machining App.",
            "",
            results_text ?? "(no results attached)",
            "",
            "─────────────────────────────────────",
            "Questions? Contact us at sales@corecutterusa.com or call us at 207-588-7519",
            "corecutcnc.com",
          ].join("\n"),
        });
      } catch (mailErr: any) {
        console.error("[Results Email] *** Send FAILED:", email, "—", mailErr?.message);
        return res.status(502).json({ ok: false, sent: false, error: "Email delivery failed. Please try again or contact us directly." });
      }

      // Per-query sales notification removed — registration emails handle new user alerts
      // (isStaff distinction retained for future routing; both paths now confirm delivery)
      return res.json({ ok: true, sent: true });
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

  // ── Welcome-modal diagnostics (TEMPORARY) ─────────────────────────────────
  // Confirms whether registered users are being re-prompted because their
  // localStorage was evicted (iOS PWA / Safari ITP) vs. some logic path.
  // The client pings this ONLY when the welcome modal is about to show with
  // zero identity keys. We drop a long-lived probe cookie; cookies survive ITP
  // far better than localStorage, so a returning user who reports
  // hadProbeCookie=true while their localStorage is empty = storage eviction.
  app.post("/api/diag/welcome-prompt", (req, res) => {
    try {
      const { standalone, lsAvailable, event } = (req.body ?? {}) as {
        standalone?: boolean; lsAvailable?: boolean; event?: "prompt" | "tag";
      };
      const ua = (req.headers["user-agent"] as string) || "";
      const cookieHeader = (req.headers["cookie"] as string) || "";
      // Authoritative eviction signal: cookie present BUT no localStorage identity.
      const probeMatch = /(?:^|;\s*)cc_probe=(\d+)/.exec(cookieHeader);
      const serverSawProbe = !!probeMatch;
      const daysSinceProbe = probeMatch ? ((Date.now() - Number(probeMatch[1])) / 86400000).toFixed(1) : "n/a";
      const ios = /iphone|ipad|ipod/i.test(ua);
      const safari = /safari/i.test(ua) && !/chrome|crios|fxios|edg/i.test(ua);
      // "tag" = an already-identified user loaded the app; we only drop the probe
      // cookie so a LATER eviction is detectable. "prompt" = the modal is showing
      // with no identity keys — the event we're actually hunting.
      if (event !== "tag") {
        console.warn(
          `[WelcomePrompt] modal shown w/ NO identity keys — ` +
          `ios=${ios} safari=${safari} standalone=${!!standalone} ` +
          `lsAvailable=${lsAvailable !== false} ` +
          `serverSawProbeCookie=${serverSawProbe} daysSinceProbe=${daysSinceProbe} ` +
          `ua="${ua.slice(0, 120)}"`
        );
      }
      // (Re)set the probe cookie only if absent — preserve the ORIGINAL timestamp
      // so daysSinceProbe measures real elapsed time, not the last page load.
      if (!serverSawProbe) {
        res.setHeader(
          "Set-Cookie",
          `cc_probe=${Date.now()}; Max-Age=31536000; Path=/; SameSite=Lax; Secure; HttpOnly`
        );
      }
      return res.json({ ok: true });
    } catch {
      return res.json({ ok: false });
    }
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
        userEmail, cc, userName, userType,
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
        userEmail?: string; cc?: string; userName?: string; userType?: string;
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
      // CC is now user-controlled (optional). Sales lead is still captured via the
      // DB upsert above, so no automatic sales@ CC is added on outbound ROI email.
      const ccClean = typeof cc === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cc.trim()) ? cc.trim() : "";

      let emailSent = false;
      let emailReason: string | undefined;
      if (!smtpUser || !smtpPass) emailReason = "smtp_not_configured";

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
      <img src="https://corecutcnc.com/CCLogo-long-whiteback%20TRANSPARENT.png" alt="CoreCutCNC" height="34" style="height:34px;width:auto;display:block;max-height:34px;margin-bottom:12px;">
      <h1 style="margin:0;font-size:20px;color:#fff;letter-spacing:-0.3px;">ROI Summary</h1>
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

      <div style="border-top:1px solid #333;padding-top:16px;margin-top:4px;">
        <p style="font-size:13px;color:#e5e7eb;font-weight:600;margin:0 0 6px;">Core Cutter USA</p>
        <p style="font-size:12px;color:#9ca3af;margin:0 0 3px;">Phone: <a href="tel:+12075887519" style="color:#fb923c;text-decoration:none;">207-588-7519</a></p>
        <p style="font-size:12px;color:#9ca3af;margin:0 0 3px;">Email: <a href="mailto:sales@corecutterusa.com" style="color:#fb923c;text-decoration:none;">sales@corecutterusa.com</a></p>
        <p style="font-size:12px;color:#9ca3af;margin:0 0 12px;">Web: <a href="https://corecutcnc.com" style="color:#fb923c;text-decoration:none;">corecutcnc.com</a></p>
        <p style="font-size:11px;color:#6b7280;margin:0;">Generated by CoreCutCNC — figures are starting estimates for comparison.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

        const transporter = nodemailer.createTransport({
          host: smtpHost, port: smtpPort, secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });
        // FROM must be a Brevo-verified sender — using the raw SMTP login
        // (smtpUser) gets silently dropped, which is why ROI emails never arrived.
        try {
          await transporter.sendMail({
            from: `"CoreCutCNC" <${process.env.FROM_EMAIL || "scott@corecutterusa.com"}>`,
            to: userEmail,
            ...(ccClean ? { cc: ccClean } : {}),
            subject: `Your CoreCutCNC ROI Summary — ${subjectSavings}`,
            html: htmlBody,
          });
          emailSent = true;
        } catch (mailErr: any) {
          console.error("[ROI] sendMail failed:", mailErr?.message);
          emailReason = "send_failed";
        }
      }

      return res.json({ ok: true, sent: emailSent, ...(emailReason ? { reason: emailReason } : {}) });
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
    const [blockedEmails, domains, blockedUsers] = await Promise.all([
      pool.query(`SELECT email, reason, added_at FROM blocked_emails ORDER BY added_at DESC`),
      pool.query(`SELECT domain, reason, added_at FROM blocked_domains ORDER BY added_at DESC`),
      pool.query(`SELECT email, created_at FROM toolbox_sessions WHERE blocked = TRUE ORDER BY email`),
    ]);
    res.json({
      blocked_emails: blockedEmails.rows,
      blocked_domains: domains.rows,
      blocked_users: blockedUsers.rows,
    });
  });

  app.post("/api/admin/blocked-emails", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { email, reason } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });
    const { pool } = await import("./db");
    await pool.query(
      `INSERT INTO blocked_emails (email, reason) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET reason = $2`,
      [email.toLowerCase().trim(), reason || ""]
    );
    res.json({ ok: true });
  });

  app.delete("/api/admin/blocked-emails/:email", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { pool } = await import("./db");
    await pool.query(`DELETE FROM blocked_emails WHERE email = $1`, [
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

  // Spelling + grammar check for announcement text (admin preview, before publish)
  app.post("/api/admin/announcements/check", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { headline, subheadline, bullets } = req.body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "Grammar check not configured — contact support" });

    // Build a stable, indexed list of fields so we can map corrections back to inputs
    const fields: { id: string; label: string; text: string }[] = [];
    if (typeof headline === "string" && headline.trim()) fields.push({ id: "headline", label: "Headline", text: headline });
    if (typeof subheadline === "string" && subheadline.trim()) fields.push({ id: "subheadline", label: "Subheadline", text: subheadline });
    (Array.isArray(bullets) ? bullets : []).forEach((b: unknown, i: number) => {
      if (typeof b === "string" && b.trim()) fields.push({ id: `bullet:${i}`, label: `Bullet ${i + 1}`, text: b });
    });
    if (!fields.length) return res.json({ fields: [] });

    try {
      const client = new Anthropic({ apiKey });
      const prompt = `You are a copy editor for short product-announcement UI text. For each field below, return a corrected version fixing spelling and grammar ONLY. Do NOT rewrite for style, change meaning, add/remove content, or alter intentional product names, capitalization, or punctuation choices beyond what grammar requires (e.g. "CORECutCNC", "SFM" stay as-is). Preserve the original tone and any exclamation marks.

Return ONLY a JSON object of this exact shape, no prose:
{"fields":[{"id":"<id>","corrected":"<corrected text>","changed":<true|false>}]}

Fields:
${JSON.stringify(fields.map(f => ({ id: f.id, text: f.text })), null, 2)}`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content.find(c => c.type === "text")?.text ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      const byId: Record<string, { corrected: string; changed: boolean }> = {};
      for (const f of parsed.fields ?? []) byId[f.id] = { corrected: String(f.corrected ?? ""), changed: !!f.changed };

      // Re-join with original text + labels so the client can render side-by-side
      const result = fields.map(f => {
        const c = byId[f.id];
        const corrected = c?.corrected ?? f.text;
        return {
          id: f.id,
          label: f.label,
          original: f.text,
          corrected,
          changed: !!c?.changed && corrected.trim() !== f.text.trim(),
        };
      });
      res.json({ fields: result });
    } catch (err: any) {
      console.warn("[Announcement check]", err?.message ?? err);
      res.status(502).json({ error: "Grammar check failed — try again" });
    }
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

FIRST — verify this is a genuine Core Cutter LLC ENGINEERING PRINT (a CAD tool drawing), NOT some other document:
1. Look for the Core Cutter TITLE-BLOCK COMPANY HEADER. Every genuine custom tool print carries this header block in the title block (top-center/upper area of the drawing border). The STRUCTURE is always the same — company name, street, city/state/ZIP, phone, fax, website:
       CORE CUTTER, LLC
       <street address>
       <city>, ME <zip>
       PHONE: 207-588-7519
       FAX: 207-588-7614
       WEBSITE: CORECUTTERUSA.COM
   The company has used / is transitioning between two addresses — ACCEPT EITHER:
       • 362 MAINE AVE, FARMINGDALE, ME 04344   (older prints)
       • 120 TECHNOLOGY DRIVE, GARDINER, ME 04345 (newer prints)
   Do NOT key off the address text to authenticate — the address is changing. The authoritative tells are the STRUCTURE (the "CORE CUTTER, LLC" company header with PHONE/FAX/WEBSITE lines and "CORECUTTERUSA.COM") TOGETHER WITH item 2 below (a real TOOL # title-block field and a CAD tool drawing).
2. Find the TOOL # field in the title block. It contains a number like "CC-14371". The title block is a table (typically lower-right or bottom of the drawing border) with rows labeled TOOL #, CUSTOMER, DRAWN BY, DATE, COATING/VENDOR, MATERIAL #, SCALE, PAGE, etc.
3. Confirm there is an actual CAD TOOL-PROFILE DRAWING (a dimensioned side/front view of the physical cutting tool with Ø callouts, length dimensions, etc.). A genuine print always has this.

REJECT NON-PRINTS — CRITICAL:
- This tool ONLY accepts genuine engineering tool drawings. It must NOT accept CoreCutCNC software output (the app's own parameter/results sheets) — even though those ALSO say "Core Cutter LLC" and may show the SAME Gardiner address. The address does NOT distinguish them; the document STRUCTURE does.
- A CoreCutCNC PARAMETER/RESULTS SHEET is NOT a print. Reject it. Tell-tale signs of a results sheet: a header reading "Produced with CoreCutCNC by Core Cutter LLC"; section headings like "SETUP", "RECOMMENDED PARAMETERS", "ENTRY MOVES", "ENGINEERING DATA", "RIGIDITY & CHATTER AUDIT"; parameter labels like "RPM", "SFM", "FEED (IPM)", "MRR", "HP REQUIRED", "WOC", "DOC". CRUCIALLY, a results sheet has NO CAD tool-profile drawing and NO "TOOL #" title-block field with a CC-XXXXX number.
- DECISION RULE: Accept (extract) ONLY if BOTH the "CORE CUTTER, LLC" title-block header structure (item 1) AND a real "TOOL #" CC-XXXXX field on a CAD tool drawing (items 2–3) are present. If the document is a CoreCutCNC results/parameter sheet, or lacks the TOOL # title-block field / CAD tool drawing, return ONLY:
{"error": "not_core_cutter"}

TOOL NUMBER EXTRACTION — CRITICAL:
- ALWAYS read the tool number from the "TOOL #" field in the drawing's title block. NEVER infer it from the filename — you cannot see the filename; rely solely on the text rendered on the drawing.
- The TOOL # field contains the tool number. Example: if it says "CC-14371" extract exactly "CC-14371".
- Do NOT confuse TOOL # with CUSTOMER TOOL # (a different field). Use only the "TOOL #" field.
- The format is always CC- followed by 4 or 5 digits (e.g. CC-14371, CC-12650, CC-9823).
- This field is ALWAYS present on genuine Core Cutter prints. Look carefully — it often appears in a large font in the title block (e.g. "TOOL #  CC-14810").

If you find "Core Cutter" but NO "CC-XXXXX" tool number, still extract all dimensions but include:
{"tool_number": null, "no_tool_number": true, ...rest of fields}

If both are present, return ONLY valid JSON — no explanation, no markdown, just the raw JSON object. Include "tool_number" as the first field.

UNITS — CHECK FIRST:
Look for a units indicator on the print — typically in the title block, notes section, or dimension callouts. Common indicators: "DIMENSIONS IN MM", "ALL DIMS IN MILLIMETERS", "mm", or dimension values that are clearly metric (e.g. 12.70, 6.350, 25.4).
- If the print is in MILLIMETERS: set "units": "mm" in your response and extract all dimension values exactly as shown on the print (do NOT convert — the server will convert).
- If the print is in INCHES (default for Core Cutter): set "units": "in" and extract as normal.
- If uncertain, default to "units": "in".

CRITICAL RULES — READ CAREFULLY:

0. BOLD LINES = CUTTING SURFACES. This is the universal convention on ALL Core Cutter prints. In the profile/drawing view, lines drawn BOLD (thick/heavy weight) represent surfaces that are intended to cut material. Lines drawn THIN or DASHED represent non-cutting surfaces (shank, body, clearance relief, back taper). Use this to identify which diameters, lengths, and features are cutting geometry vs. non-cutting geometry. When multiple Ø callouts appear on a print, only extract as cutting diameters those associated with bold-line profiles. Thin-line or dashed-line Ø callouts are shank/body dimensions and go in shank_dia.

1. ALL dimensions on Core Cutter prints have tolerances. You MUST extract the NOMINAL (base) value only and discard all tolerance information:
   - "Ø0.750-.0001/.0004" → 0.750
   - "1.875+.06/.00" → 1.875
   - "Ø0.250+.000/-.005" → 0.250
   - "4.00±.05" → 4.00
   - ".1875±.001" → 0.1875
   The nominal value is always the FIRST number before any +, -, or ± symbol.

2. tool_dia is the CUTTING diameter — the Ø dimension at the tip/cutting end of the tool. On standard endmills the cutting dia equals the shank dia. On REDUCED-SHANK / MICRO tools (e.g. QTR3-style, stub cutters) the shank is LARGER than the cutting end — in this case tool_dia is the SMALL Ø at the tip (e.g. Ø0.0590), NOT the shank. The shank Ø (e.g. Ø0.250) goes in shank_dia. Rule: tool_dia = the Ø callout nearest the cutting tip/flutes. shank_dia = the Ø callout on the large body/shank end. If both ends are labeled with different diameters, the SMALLER one at the cutting tip is tool_dia. tool_dia is NEVER 0. On keyseat cutters it is the disc/wheel diameter (the big cutting part).

2b. For STEP DRILLS specifically — this is the most important rule for step drills:
   - Bold lines = cutting surfaces, thin/dashed lines = non-cutting (rule 0 above). Apply this to EACH diameter callout on the profile.
   - tool_dia = the SMALLEST cutting diameter (at the very tip of the drill — the first material it contacts).
   - drill_step_diameters = ALL larger cutting diameters in ascending order, NOT including tool_dia. Add a callout to this list ONLY if its profile line in the main side view is drawn BOLD. If the line is thin or dashed, it is non-cutting body and goes in shank_dia instead.
   - shank_dia = the large cylindrical body OD at the far end (away from the tip). Two cases:
       (a) If the shank line in the main profile view is THIN or DASHED, the shank is non-cutting. Put it in shank_dia and DO NOT include it in drill_step_diameters. (Most step drills.)
       (b) If the shank line in the main profile view is BOLD, the tool cuts all the way up to the shank diameter — meaning the shank OD IS the largest cutting diameter. In this case, ALSO add the shank value as the last entry of drill_step_diameters (so the engine treats it as the largest cutting step) AND keep it in shank_dia. The same number appears in both fields. Example: CC-09440 has Ø.125 shank drawn bold with the cutting profile running into it — drill_step_diameters includes 0.125 as the largest step AND shank_dia = 0.125.
   - drill_step_lengths = the "STEP END" dimension(s) measured from the drill tip — one per entry in drill_step_diameters, in the same order. If case (b) applies, the last step length is the dimension from the tip to where the cutting profile meets the shank.
   - drill_flute_length = the "LOC" dimension (fluted cutting length). The "CLEAR" dimension is the clearance relief length (slightly longer) — use LOC, not CLEAR.
   - Example A (shank non-cutting): CC-14371 — Ø0.1875 shank (thin/dashed), Ø0.141 step (bold), Ø0.103 tip (bold) → tool_dia=0.103, drill_step_diameters=[0.141], shank_dia=0.1875.
   - Example B (shank IS the largest cutting dia): CC-09440 — Ø0.125 shank line drawn BOLD because the cutting profile runs into the shank; intermediate steps Ø0.062/0.084/0.090 bold; tip Ø0.040 bold → tool_dia=0.040, drill_step_diameters=[0.062, 0.084, 0.090, 0.125], shank_dia=0.125.

3. For KEYSEAT cutters specifically:
   - tool_dia = the cutting WHEEL diameter — the LARGE Ø on the disc/head profile, e.g. "Ø0.750-.0001/-.0004" → 0.750. The cutting head usually shows this Ø callout TWICE (once on the front face / cutting profile and once on the back collar) — they are the same value. This is NOT the small Ø on the narrow neck and NOT the shank Ø.
   - keyseat_arbor_dia = the NARROW NECK diameter between the cutting wheel and the shank, e.g. "Ø0.250+.000/-.005" → 0.250. This is the small Ø callout on the neck shaft running between the disc and the shank. It is ALWAYS smaller than tool_dia. If multiple narrow-diameter callouts appear, take the one on the neck section directly behind the cutting wheel.
   - shank_dia = the shank OD at the holder end of the tool, e.g. "Ø0.1875±.001" → 0.1875. On staggered-tooth / flute-key cutters this is often the smallest Ø on the print. Do NOT put the shank value into tool_dia.
   - Sanity check: for a standard keyseat cutter, tool_dia > keyseat_arbor_dia and tool_dia ≥ shank_dia. If your extraction has tool_dia == keyseat_arbor_dia, you picked the neck — re-read the head profile for the large wheel Ø.
   - loc = the disc WIDTH (thickness of the cutting wheel, e.g. ".1875±.001" → 0.1875)
   - lbs = the REACH/TSC dimension (distance from shank face to cutter, e.g. "1.875+.06/.00 TSC" → 1.875)
   For all other tool types: loc = flute/cutting length, lbs = length below shank if necked.

4. For DOVETAIL cutters specifically:
   - dovetail_angle = the INCLUDED angle of the dovetail V-form. This is the FULL angle, NOT the half-angle. If the print shows 30° on one side of the V, the included angle is 60°. If it shows 45° on one side, the included is 90°. Look for the angle labeled at the V-groove or cutting tip — use the largest angle shown at the cutting form as the included angle.
   - lbs = the NECK / REACH dimension (distance from shank face to the cutting head along the narrow neck). This is the SHORT horizontal length callout that brackets ONLY the necked-down section between the shank and the cutting wheel — NOT the OAL and NOT the LOC. It is sometimes labeled "TSC" (e.g. ".625+.06/-.00 TSC") but on many dovetail prints it is shown as an UNLABELED length dimension on the neck (e.g. ".97+.06/-.00"). On a typical dovetail you will see THREE horizontal dimensions stacked near the cutting end: (a) the OAL spanning the full tool — IGNORE for lbs, (b) the neck length spanning shank step to cutter back face — THIS is lbs, (c) the LOC bracketing only the cutting wheel thickness — this is loc. lbs > loc; lbs < OAL.
   - keyseat_arbor_dia = the narrow neck diameter between the shank and the cutting head (e.g. "Ø0.750" neck → 0.750). This is the small Ø callout on the neck shaft, NOT the cutting wheel diameter.
   - corner_radius = the R callout on the cutting wheel profile (e.g. "R.234" → 0.234). Dovetail cutters often have a corner radius at the wheel periphery — if you see an R.XXX callout on the cutting head (bold profile lines), extract it and set corner_condition = "corner_radius". Do NOT confuse with R callouts on the neck-to-wheel transition fillet (e.g. "R.083") — only extract the R on the cutting profile itself.

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

7. For TAPERED tools (tapered ballnose AND tapered bull-nose — 3D surfacing tools) specifically:
   - THE TELL: the cutting body is CONICAL — it flares from a SMALL diameter at the tip up to a LARGER diameter toward the shank, with straight angled profile lines (not parallel). A ball tip (full radius) makes it a TAPERED BALLNOSE; a corner radius at the tip makes it a TAPERED BULL-NOSE. Look for an angular callout on the tapered flank like "3° PER SIDE", "6° INCLUDED", "1.5° / SIDE", "TAPER 3°", or an angle dimension between the profile line and the tool centerline.
   - tool_dia = the BALL TIP diameter (the SMALL end where the tool actually contacts the surface), NOT the larger base/shank Ø. This is the single most common mistake on tapered prints — if you extracted the big base diameter as tool_dia, you read the wrong end. On a tapered ballnose, tool_dia = 2 × tip ball radius. The tip radius is usually a "R.XXXX BALL" callout (e.g. "R.1875 BALL" → tip dia 0.375). A "Ø.XXX @ TAN." callout is the diameter where the ball blends tangent into the taper — it CONFIRMS the tip end but is NOT the ball tip dia; still use 2×R for tool_dia.
   - taper_included_angle_deg = the FULL INCLUDED cone angle in degrees. CRITICAL — CORE CUTTER TAPERED PRINTS CALL OUT THE ANGLE PER SIDE (half angle), so you must DOUBLE almost every taper angle you read: the angle dimension sits between the tool CENTERLINE (the green dash-dot line) and ONE tapered flank. An angle measured from the centerline to one flank is ALWAYS per-side → included = 2× that value. Example on a real print: a "4.00°" dimension drawn above the centerline means 4° per side → taper_included_angle_deg = 8.0. Treat a bare angle callout on a taper (e.g. "4.00°", "3°", "TAPER 4°", "4°/SIDE", "4.00° PER SIDE") as PER-SIDE and double it. ONLY use the value as-is (do NOT double) when the print explicitly says "INCLUDED" or "INCL" next to the angle. Geometry cross-check: base_dia ≈ tip_dia + 2·tan(included/2)·taper_length should land near the shank Ø — if doubling makes the base overshoot the shank wildly, reconsider, but per-side is the default for these prints. 0 if the tool is not tapered.
   - taper_length_in = the axial length of the TAPERED body — from the ball tip up to where the taper reaches full base diameter. On these prints it is the LONGER length dimension spanning the tapered flank (e.g. a "(1.980)" reference dim from the shank step to the tip region), NOT the LOC (which is the shorter fluted-length callout, e.g. "1.00 LOC"). If both a LOC and a longer tapered-body dimension are shown, taper_length_in = the longer one. 0 if not tapered.
   - Still set corner_condition normally: "ball" for a tapered ballnose, "corner_radius" (+ corner_radius R value) for a tapered bull-nose.
   - Set taper_included_angle_deg = 0 and taper_length_in = 0 for ALL non-tapered tools (straight ballnose, straight endmills, etc.). Only populate these when the conical taper + angle callout are actually present.

8. BARREL / TANGENT / OVAL-FORM tools (detection only — NOT yet fully modeled):
   - THE TELL: the cutting profile is a large-radius CONVEX arc along the FLANK (side) of the tool, not a small tip radius. The flank bulges out like a barrel or oval, and the profile radius is LARGE — typically many times the tool diameter (a big R callout on the side profile, e.g. "R6.00" on a Ø0.5 tool). Notes may say "BARREL", "BARREL FORM", "OVAL FORM", "TANGENT", "TANGENT FORM", "CONICAL BARREL", "LENS FORM", or "PARABOLIC". These are 5-axis high-efficiency surfacing tools that contact on the flank arc, not the tip.
   - Set barrel_form = true if ANY of those tells are present. Otherwise barrel_form = false.
   - Extract tool_dia (the max cutting Ø), corner_condition, and the flank profile radius into barrel_profile_radius_in if a large side-profile R is called out (0 if unclear). Do your best on the other fields, but these tools are flagged as approximate downstream.

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

CENTER-NECK (REDUCED-NECK REACH) ENDMILL — the hardest case, read carefully:
Some reach endmills are NOT shank-reduced. Instead the SHANK and the CUTTING FLUTES are the SAME diameter (e.g. Ø0.750 at the holder end AND Ø0.750 at the tip), and a REDUCED NECK sits in the MIDDLE (a smaller Ø callout such as "Ø0.712+.000/-.005" running along the central body). This is a reduced-neck reach tool — the neck gives clearance for deep slots/pockets. Identify it like this:
- There will be THREE stacked horizontal length dimensions near the cutting end: a SHORT one at the very tip (the fluted/cutting length), a MIDDLE one spanning from a step back toward the holder to the tip (the REACH / neck length, e.g. 3.00), and the LONGEST one spanning the whole tool (OAL, e.g. 5.00).
- loc = the SHORT tip dimension ONLY (the cutting/fluted length, e.g. 1.125). Do NOT use the middle reach dimension as loc — that is the single most common mistake on these prints. If you find yourself assigning a value of 2–4× the cutting diameter to loc on a tool that has a mid-body neck Ø callout, STOP — that is the reach (lbs), not the loc.
- lbs = the MIDDLE reach dimension (step-to-tip, e.g. 3.00). This is the depth the tool can plunge.
- oal = the LONGEST dimension (e.g. 5.00).
- shank_dia = the holder-end body Ø (e.g. 0.750). When it equals tool_dia, that is normal for this geometry — still report it.
- keyseat_arbor_dia = the reduced NECK Ø (the smaller mid-body callout, e.g. 0.712). Always extract this — it drives the two-segment deflection model. (This neck-Ø field is reused for endmill necks even though the name says keyseat.)
- flute_wash / parallel relief = there is NONE on a center-neck tool (the neck tapers/blends, e.g. a "10° FEATHER BLEND"). Do not invent a flute-wash land.
- STRONG TELL: a "FEATHER BLEND" callout (e.g. "10° FEATHER BLEND") almost always marks a necked tool. It is the blended/tapered transition from the reduced neck back up to the shank Ø, located at the back end of the neck (between the LOC/flute zone and the shank). If you see "FEATHER BLEND" anywhere on an endmill print, treat it as a reduced-neck reach tool: there WILL be a neck Ø (keyseat_arbor_dia) smaller than tool_dia, a short tip LOC, and a longer reach (lbs) — find all three even if dimensions are partly cut off. Never report flute_wash on a feather-blend tool.
- Example: CC-14796 — Ø0.750 shank, Ø0.750 cutting dia, Ø0.712 mid neck, dims 1.125 / 3.00 / 5.00 → tool_dia=0.750, loc=1.125, lbs=3.00, oal=5.00, shank_dia=0.750, keyseat_arbor_dia=0.712.

UNSUPPORTED TOOL TYPES — CRITICAL:
The app models ONLY these nine cutting-tool families: endmill, feedmill, keyseat, dovetail, drill, step_drill, reamer, threadmill, chamfer_mill. If the print's NOTES, title block, or CAD profile clearly describe a tool OUTSIDE this list — for example a FORM TOOL / custom-form cutter, BURR, COUNTERSINK, SPOT DRILL, CENTER DRILL, FLY CUTTER, BORING BAR, PORT TOOL, BROACH, ENGRAVER, GEAR/HOB, SLITTING SAW, T-SLOT cutter, or any special profile the nine types above do not cover — do NOT force-fit it into the enum. Instead return ONLY:
{"tool_number": <the CC-XXXXX value if present, else null>, "unsupported_form": true, "unsupported_reason": <short string naming what you saw, e.g. "form tool", "countersink", "port tool">}
Do NOT extract dimensions for an unsupported form — the app cannot calculate it and must simply tell the user to call. When in doubt (the tool clearly maps to one of the nine supported types), do NOT set unsupported_form — classify it normally.

Required fields (use 0 for unknown numbers, null for unknown strings):
{
  "tool_number": <string — the value from the TOOL # field in the title block, e.g. "CC-14371". ALWAYS present on Core Cutter prints. Do NOT use the CUSTOMER TOOL # field.>,
  "units": "in|mm",
  "tool_type": "endmill|feedmill|keyseat|dovetail|drill|step_drill|reamer|threadmill|chamfer_mill",
  "tool_dia": <number, cutting diameter — nominal value only, in the print's native units>,
  "flutes": <integer>,
  "loc": <number, the CUT DEPTH of the tool — the dimension that defines how deep the tool cuts. For endmills/reamers/drills this is labeled "LOC" on the print (Length Of Cut). For drills and reamers specifically: LOC is the bold-line cutting zone length — NOT the "CLEAR" dimension and NOT the "flute length" which are ambiguous relief dimensions. LOC is the only meaningful cut depth for calculation. NEVER use the long reach/OAL. 0 if unknown>,
  "lbs": <number, REACH / length below shank — the LONG dimension from shank step to tip on reduced-neck tools (e.g. 3.25). 0 if no neck>,
  "helix_angle": <integer degrees, 0 if not shown>,
  "corner_condition": "square|corner_radius|ball",
  "corner_radius": <number in inches. CRITICAL: Look CAREFULLY for "R.XXX" callouts at the cutting end of the tool — these are typically small text annotations near the corner of the cutting profile, like "R.010", "R.015", "R.030", "R.060". Endmill prints almost ALWAYS have a corner radius callout (even ".010" small CR on a "square" endmill is common — it's an edge prep). If you find ANY R.XXX callout at the cutting tip corner, set corner_condition = "corner_radius" and corner_radius = the R value (e.g. R.010 → 0.010). Only return 0 / "square" if you are CERTAIN there is no R callout anywhere on the cutting end. If the print shows a ball nose (full hemisphere at tip with R = tool_dia/2), set corner_condition = "ball" and corner_radius = tool_dia/2.>,
  "shank_dia": <number in inches, 0 if same as cutting dia>,
  "coating": <string or null>,
  "material": "carbide|hss",
  "keyseat_arbor_dia": <number, neck/arbor diameter for keyseat cutters, 0 if not applicable>,
  "dovetail_angle": <number, included dovetail angle in degrees, 0 if not applicable>,
  "chamfer_angle": <number, included chamfer angle in degrees, 0 if not applicable>,
  "chamfer_tip_dia": <number in inches, 0 if not applicable>,
  "thread_tpi": <number, threads per inch for threadmills, 0 if not applicable>,
  "drill_step_diameters": <array — for step drills: the larger cutting diameters ONLY (NOT the shank, NOT tool_dia). Ascending order. Example: tool_dia=0.103, step=0.141, shank=0.1875 → [0.141]. [] if single-diameter drill>,
  "drill_step_lengths": <array of "STEP END" lengths in inches measured from the drill tip, one per step diameter. Example: 0.268 → [0.268]. [] if not applicable>,
  "drill_point_angle": <number, the included point angle in degrees at the drill tip (e.g. 140°). Return closest standard: 118, 120, 130, 135, 140, or 145. 120° is common on straight-flute step drills for non-ferrous (plunging) work. 135 if not shown.>,
  "drill_flute_length": 0,
  "ream_step_diameters": <array of step diameters in ascending order (smallest first) for step reamers — read from the print's step Ø callouts. [] if single-diameter reamer or not applicable>,
  "ream_step_lengths": <array of step lengths in inches measured from the reamer tip — one entry per step diameter, same order. [] if not applicable>,
  "ream_flute_length": 0,
  "cutting_material": <string, the workpiece material this tool is designed for. Look for "CUTTING=", "FOR:", "MATERIAL TO CUT:", "MAT'L:", or any similar callout in the NOTES section, title block, or geometry-callout area (e.g. "ALUMINUM GEOMETRY", "STEEL GEOMETRY"). Map the text to ONE of these keys EXACTLY:
    ALUMINUM (N1): "aluminum_wrought" (6061, 6082, 5052, plain "ALUMINUM", "AL", "ALUM", or any 6xxx/5xxx series — DEFAULT if just "ALUMINUM" with no grade); "aluminum_wrought_hs" (7075, 2024, or any 7xxx/2xxx); "aluminum_cast" (A356, A380, A390, 356, 380, "cast aluminum", "high-silicon").
    COPPER/BRASS/BRONZE (N1/N2): "non_ferrous" (copper, free-cutting brass, leaded bronze, C360, C260); "manganese_bronze" (C86300, C86500); "silicon_bronze" (C65500, C64200); "copper_beryllium" (C17200, C17300, BeCu).
    STEEL (P): "steel_alloy" (4130, 4140, 4340, 8620, 9310, chrom-moly, "alloy steel"); "steel_mild" (A36, 1018, 1020, mild/low-carbon); "steel_free" (12L14, 1215, 1117, free-machining); "tool_steel_p20" (P20); "tool_steel_a2" (A2); "tool_steel_h13" (H13); "tool_steel_s7" (S7); "tool_steel_d2" (D2); "cpm_10v" (CPM 10V, A11, PM tool steel).
    STAINLESS (M): "stainless_304" (304, 304L, 321, plain "STAINLESS" with no grade — DEFAULT for unqualified stainless); "stainless_fm" (303, 416, free-machining stainless); "stainless_ferritic" (409, 430, 441, ferritic); "stainless_410" (410); "stainless_trimrite" (TrimRite, S42010); "stainless_420" (420); "stainless_440c" (440C); "stainless_316" (316, 316L, Mo-bearing); "stainless_ph" (17-4, 17-4PH, 15-5, 15-5PH, 13-8, 13-8MO, all precipitation-hardening / PH grades); "stainless_duplex" (2205, duplex); "stainless_superduplex" (2507, super duplex); "manganese_steel" (A128, Hadfield, austenitic manganese steel, 11-14% Mn, mangalloy).
    CAST IRON (K): "cast_iron_gray" (Class 30/40, GG20/25, gray, HT200/250); "cast_iron_ductile" (65-45-12, ductile, nodular, GGG); "cast_iron_cgi" (CGI, compacted graphite, GJV); "cast_iron_malleable" (malleable, GTW, GTB, GTS).
    TITANIUM / SUPERALLOY (S): "titanium_64" (Ti-6Al-4V, Grade 5, Ti64); "titanium_cp" (CP Ti Grade 1–4); "hiTemp_fe" (A-286, Incoloy 800, Udimet — Fe-based superalloy); "hiTemp_co" (Stellite — Co-based); "monel_k500" (Monel K-500); "inconel_625" (Inconel 625, Hastelloy C-276, C-22, Incoloy 825); "inconel_718" (Inconel 718, 718 Plus, Allvac 718); "hastelloy_x" (Hastelloy X, Inconel X-750, Nimonic C-263); "inconel_617" (Inconel 617, Haynes 230); "waspaloy" (Waspaloy, René 41/77/80, Nimonic 80A/90); "mp35n" (MP35N, Udimet 720, René 95).
    HARDENED / ARMOR (H): "hardened_lt55" (generic hardened steel below 55 HRC, no specific grade); "hardened_gt55" (generic hardened steel above 55 HRC); "armor_milspec" (MIL-A-12560, 46100); "armor_ar400" (AR400, AR450); "armor_ar500" (AR500, Armox 500T); "armor_ar600" (AR550, AR600, Armox 600T).
    PLASTICS / COMPOSITES (O): "plastic_unfilled" (PEEK, POM, PA, PC, Delrin, Acetal, unfilled engineering thermoplastics); "plastic_filled" (GF/CF-PA, PEEK-GF, fiber-reinforced); "composite_tpc" (CF-PEEK, GF-PP, CFR-TP, continuous-fiber laminates).
   Rules: (a) ALWAYS try to map — only return null if the print is COMPLETELY silent about workpiece material. (b) Pick the most specific match — if the print says "17-4 PH", return "stainless_ph", not null. (c) If a grade is mentioned but doesn't fit any key, fall back to the closest family default (e.g. "1045 steel" → "steel_alloy"; "PH stainless" → "stainless_ph"; "Ti grade 7" → "titanium_cp"). (d) A bare "STEEL" with no grade → "steel_alloy". A bare "STAINLESS" with no grade → "stainless_304". A bare "ALUMINUM" with no grade → "aluminum_wrought".>,
  "coolant_fed": <boolean, true if the print includes any note indicating coolant-through capability — look for text like "COOLANT FED", "COOLANT THROUGH", "COOLANT THRU", "THRU COOLANT", "TSC", "THROUGH SPINDLE COOLANT", or any note referencing internal coolant passages. false if no such note is found.>,
  "shank_type": <string or null — look in the title block, notes section, or shank detail for shank type callouts. Return "weldon" if "WELDON FLAT", "WELDON", or "W/FLAT" is noted. Return "safe_lock" if "SAFE LOCK", "SAFELOCK", "SAFE-LOCK", "HAIMER", or "HAIMER SAFE-LOCK" is noted. Return null if no special shank type is noted.>,
  "oal": <number, overall length of the tool in inches — labeled "OAL" on the print. 0 if not shown.>,
  "lead_angle": <number, lead angle in degrees for feed mills — see rule 6 above. 0 for all other tool types.>,
  "taper_included_angle_deg": <number, FULL INCLUDED taper cone angle in degrees for tapered ballnose / tapered bull-nose tools — see rule 7. Normalize per-side/half angles to included (double them). 0 for all non-tapered tools.>,
  "taper_length_in": <number in inches, axial length of the tapered body (tip to full base dia) — see rule 7. 0 for all non-tapered tools.>,
  "barrel_form": <boolean — true if this is a barrel / tangent / oval-form / lens / conical-barrel surfacing tool (large convex flank arc), see rule 8. false for all standard ball/bull-nose/tapered tools.>,
  "barrel_profile_radius_in": <number in inches, the LARGE flank profile radius on a barrel/tangent tool (usually several × the tool dia), 0 if not a barrel tool or not clearly called out.>,
  "variable_pitch": <boolean — true if the notes or title explicitly say "VARIABLE PITCH" or "VAR PITCH". ALSO true if the print mentions "QTR3", "QTR3-STYLE", or "QTR3-RN" (QTR3 series tools always have variable pitch by design). false otherwise.>,
  "variable_helix": <boolean — true if the notes or title explicitly say "VARIABLE HELIX" or "VAR HELIX". ALSO true if the print mentions "QTR3", "QTR3-STYLE", or "QTR3-RN" (QTR3 series tools always have variable helix by design). false otherwise.>,
  "geometry": <string — the flute geometry, one of "standard" | "chipbreaker" | "truncated_rougher". Read the NOTES section carefully:
    - "chipbreaker" if the notes mention "CHIPBREAKER", "CHIPBREAKERS", "CHIP BREAKER", "STAGGERED CHIPBREAKERS", "SERRATED", "STAGGERED TOOTH", or any chip-splitting flute feature (these flutes have notches/serrations along the cutting edge that break the chip). On Core Cutter prints a "STAGGERED CHIPBREAKERS" note in the geometry callouts is the clearest tell.
    - "truncated_rougher" if the notes mention "TRUNCATED ROUGHER", "ROUGHER", "RIPPER", "KNUCKLE", "CORN COB", or call out the VRX / VXR rougher series.
    - "standard" otherwise (smooth/continuous cutting edge — most finishing and general-purpose endmills).
    Default to "standard" only when no roughing-flute note is present.>,
  "tool_series": <string or null — look in the NOTES section for a series callout like "QTR3-STYLE", "QTR3-RN", "QTR3". Return "QTR3-RN" if noted, "QTR3" if "QTR3-STYLE" or "QTR3" is noted, null otherwise.>
}`;

  // NOTE: This route takes a JSON body { filename, mime, data(base64) }, NOT
  // multipart/form-data. The Replit edge proxy was hanging on multipart upload
  // bodies (headers forwarded, body never reaching the container → multer waited
  // forever, route never ran, client aborted after ~95s). JSON bodies forward
  // fine through the edge, so the client base64-encodes the file and posts JSON.
  app.post("/api/tool-geometry/extract", async (req, res) => {
    try {
      const { filename, mime, data } = (req.body ?? {}) as {
        filename?: string; mime?: string; data?: string;
      };
      console.log("PDF extract route hit, file:", filename, "b64len:", data?.length ?? 0);
      if (!data || typeof data !== "string") {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      console.log("API key present:", !!apiKey, "length:", apiKey?.length);
      if (!apiKey) {
        return res.status(503).json({ error: "PDF extraction not configured — contact support" });
      }

      const client = new Anthropic({ apiKey });
      // Strip any data-URL prefix (e.g. "data:application/pdf;base64,") if present.
      const fileBase64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;

      // Sniff the ACTUAL bytes — do NOT trust the browser-reported MIME. Renaming a
      // file in Windows (or re-saving from a viewer) can make file.type come back ""
      // or "application/octet-stream", which previously forced the wrong media_type
      // and made Claude unable to read the doc → false "not_core_cutter". Magic bytes
      // are authoritative: PDF starts with "%PDF" (base64 "JVBER"); PNG/JPEG/GIF/WEBP
      // have their own signatures.
      const sniffImageMedia = (b64: string): string | null => {
        if (b64.startsWith("/9j/")) return "image/jpeg";            // FF D8 FF
        if (b64.startsWith("iVBORw0KGgo")) return "image/png";       // 89 50 4E 47
        if (b64.startsWith("R0lGOD")) return "image/gif";            // GIF8
        if (b64.startsWith("UklGR")) return "image/webp";            // RIFF (webp)
        return null;
      };
      const isPdfBytes = fileBase64.startsWith("JVBER");             // "%PDF"
      const sniffedImage = sniffImageMedia(fileBase64);
      const mimeType = mime || "application/pdf";
      // Prefer sniffed type; fall back to the declared MIME only when bytes are inconclusive.
      const isImage = isPdfBytes ? false : (sniffedImage != null ? true : mimeType.startsWith("image/"));
      const imageMedia = sniffedImage ?? mimeType;

      // Build content block — PDF uses document type, images use image type
      const fileBlock: any = isImage
        ? {
            type: "image",
            source: {
              type: "base64",
              media_type: imageMedia as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
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

      // Bound the call so it can't hang behind the autoscale proxy. The SDK default
      // request timeout is 10 min — far longer than the proxy will hold the connection,
      // so a slow call would leave the client spinning forever. One clean attempt with
      // generous headroom: a retry can't help here because the client aborts at 95s, so
      // a 2nd attempt would never finish — it only guarantees a client-side timeout.
      // Server 85s < client 95s, so the client always outlives the server attempt and we
      // surface a real error response instead of a bare abort.
      const _t0 = Date.now();
      console.log(`[extract] calling Anthropic model=claude-sonnet-4-6 b64len=${fileBase64.length} isImage=${isImage}`);
      let response;
      try {
        response = await client.messages.create(
          {
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
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
          },
          { timeout: 85_000, maxRetries: 0 },
        );
      } catch (apiErr: any) {
        const ms = Date.now() - _t0;
        // Surface the REAL failure class so prod logs/clients show cause, not "timed out".
        console.error(`[extract] Anthropic call FAILED after ${ms}ms`, {
          name: apiErr?.name,
          status: apiErr?.status,
          type: apiErr?.error?.type ?? apiErr?.error?.error?.type,
          message: apiErr?.message,
        });
        const status = apiErr?.status ?? 502;
        return res.status(status === 401 || status === 403 ? 503 : 502).json({
          error: "Print extraction failed — please enter dimensions manually",
          detail: `${apiErr?.name ?? "Error"}${apiErr?.status ? ` ${apiErr.status}` : ""}: ${apiErr?.message ?? "unknown"}`,
        });
      }
      console.log(`[extract] Anthropic call OK in ${Date.now() - _t0}ms`);

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
                           "keyseat_arbor_dia", "chamfer_tip_dia", "taper_length_in"];
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
        if (Array.isArray(extracted.drill_step_lengths)) {
          extracted.drill_step_lengths = (extracted.drill_step_lengths as number[]).map(
            (d: number) => Math.round((d / 25.4) * 100000) / 100000
          );
        }
        if (Array.isArray(extracted.ream_step_diameters)) {
          extracted.ream_step_diameters = (extracted.ream_step_diameters as number[]).map(
            (d: number) => Math.round((d / 25.4) * 100000) / 100000
          );
        }
        if (Array.isArray(extracted.ream_step_lengths)) {
          extracted.ream_step_lengths = (extracted.ream_step_lengths as number[]).map(
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

      // QTR3 series tools always have variable pitch + variable helix by design.
      // If the model identified a QTR3 series tool but missed either flag, force both true.
      const _series = typeof extracted.tool_series === "string" ? extracted.tool_series.toUpperCase() : "";
      if (_series.startsWith("QTR3")) {
        if (extracted.variable_pitch !== true) extracted.variable_pitch = true;
        if (extracted.variable_helix !== true) extracted.variable_helix = true;
      }

      // Tapered ballnose / bull-nose: derive is_tapered from the extracted angle+length
      // (post mm-conversion) so the client can activate the stiffer cantilever model.
      const _tapAng = typeof extracted.taper_included_angle_deg === "number" ? extracted.taper_included_angle_deg : 0;
      const _tapLen = typeof extracted.taper_length_in === "number" ? extracted.taper_length_in : 0;
      extracted.is_tapered = _tapAng > 0 && _tapLen > 0;

      // Uncoated + no stated material → N1 Non-Ferrous. An uncoated tool with no
      // workpiece material called out is almost always an aluminum/non-ferrous
      // cutter (TiAlN-style coatings stick to aluminum, so aluminum tools ship
      // uncoated or DLC). Default to aluminum_wrought, the general N1 bucket.
      const _matMissing = !extracted.cutting_material ||
        (typeof extracted.cutting_material === "string" && extracted.cutting_material.trim() === "");
      const _coatStr = typeof extracted.coating === "string" ? extracted.coating.toLowerCase() : "";
      const _isUncoated = _coatStr.includes("uncoat") || _coatStr === "none" || _coatStr === "bright";
      if (_matMissing && _isUncoated) {
        console.log("[extract] no material + uncoated → defaulting cutting_material=aluminum_wrought (N1)");
        extracted.cutting_material = "aluminum_wrought";
      }

      // Step drill/reamer collapse — engine only needs entry dia (smallest, feed basis)
      // and largest dia (SFM basis). Intermediate steps don't affect SFM/RPM/IPR.
      // Peck advice falls back to depth / feed_dia (worst-case) when step_lengths is empty.
      // UI also only renders one step row, so submitting more would mismatch the display.
      if (Array.isArray(extracted.drill_step_diameters) && extracted.drill_step_diameters.length > 0) {
        const dias = (extracted.drill_step_diameters as number[]).filter(d => typeof d === "number" && d > 0);
        if (dias.length > 0) {
          const maxDia = Math.max(...dias);
          extracted.drill_step_diameters = [maxDia];
          extracted.drill_steps = 1;
        } else {
          extracted.drill_step_diameters = [];
          extracted.drill_steps = 0;
        }
        extracted.drill_step_lengths = [];
      }
      if (Array.isArray(extracted.ream_step_diameters) && extracted.ream_step_diameters.length > 0) {
        const dias = (extracted.ream_step_diameters as number[]).filter(d => typeof d === "number" && d > 0);
        if (dias.length > 0) {
          const maxDia = Math.max(...dias);
          extracted.ream_step_diameters = [maxDia];
          extracted.ream_steps = 1;
        } else {
          extracted.ream_step_diameters = [];
          extracted.ream_steps = 0;
        }
        extracted.ream_step_lengths = [];
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

    // 2. Email blocklist — a specific address flagged as bad access (admin → Access tab).
    const emailBlock = await pool.query(`SELECT 1 FROM blocked_emails WHERE email = $1`, [emailLower]);
    if (emailBlock.rows.length > 0) {
      return res.status(403).json({ error: "This email address is not authorized to access CoreCutCNC." });
    }

    // 3. User-level block
    const userRow = await pool.query(`SELECT blocked FROM toolbox_sessions WHERE email = $1`, [emailLower]);
    if (userRow.rows.length > 0 && userRow.rows[0].blocked) {
      return res.status(403).json({ error: "This account has been suspended. Contact sales@corecutterusa.com for assistance." });
    }

    // NOTE: Open access — no invitation/allowlist gate. Once a user registers
    // they may use the Toolbox freely. The only access controls are deny-lists:
    // blocked domain (#1), blocked email (#2), per-user suspend (#3).
    // (allowed_emails allowlist removed 2026-06-04 — a single stray row had
    // silently locked out all 45 users.)
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

    // Email blocklist — cuts off an already-registered address on its next
    // auto-auth (so blocking someone mid-session ends their access).
    const emailBlock = await pool.query(`SELECT 1 FROM blocked_emails WHERE email = $1`, [emailLower]);
    if (emailBlock.rows.length > 0) {
      return res.status(403).json({ error: "Email address not authorized" });
    }

    // User-level block
    const userRow = await pool.query(`SELECT blocked FROM toolbox_sessions WHERE email = $1`, [emailLower]);
    if (userRow.rows.length > 0 && userRow.rows[0].blocked) {
      return res.status(403).json({ error: "Account suspended" });
    }

    // NOTE: Open access — invitation/allowlist gate removed 2026-06-04.
    // Registered users may use the Toolbox freely; only the deny-lists above
    // (blocked domain, blocked email, per-user suspend) gate access.

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
      `SELECT data->>'edp' AS edp, id, data FROM toolbox_items WHERE email = $1 AND type = 'favorite' ORDER BY created_at DESC`,
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
  // GET    /api/specials?email=&token=          → [{ id, cc_number, description, notes, job_number, job_description, created_at }]
  // POST   /api/specials  { email, token, cc_number, description, notes, job_number, job_description }  → row (no-op if duplicate cc_number)
  // DELETE /api/specials/:id  { email, token }  → { ok }
  // PATCH  /api/specials/:id  { email, token, description?, notes?, job_number?, job_description? }  → row
  app.get("/api/specials", async (req, res) => {
    const { email, token } = req.query as { email: string; token: string };
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const rows = await pool.query(
      `SELECT id, cc_number, description, notes, job_number, job_description, tool_dia, flutes, loc, step_diameters, step_lengths, point_angle, oal, created_at FROM user_specials WHERE email = $1 ORDER BY created_at DESC`,
      [email.toLowerCase()]
    );
    res.json(rows.rows);
  });

  app.post("/api/specials", async (req, res) => {
    const { email, token, cc_number, description, notes, job_number, job_description, tool_dia, flutes, loc, step_diameters, step_lengths, point_angle, oal } = req.body;
    if (!email || !token || !cc_number?.trim()) return res.status(400).json({ error: "CC# is required" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const row = await pool.query(
      `INSERT INTO user_specials (email, cc_number, description, notes, job_number, job_description, tool_dia, flutes, loc, step_diameters, step_lengths, point_angle, oal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (email, cc_number) DO UPDATE SET
         description    = EXCLUDED.description,
         tool_dia       = COALESCE(EXCLUDED.tool_dia,       user_specials.tool_dia),
         flutes         = COALESCE(EXCLUDED.flutes,         user_specials.flutes),
         loc            = COALESCE(EXCLUDED.loc,            user_specials.loc),
         step_diameters = COALESCE(EXCLUDED.step_diameters, user_specials.step_diameters),
         step_lengths   = COALESCE(EXCLUDED.step_lengths,   user_specials.step_lengths),
         point_angle    = COALESCE(EXCLUDED.point_angle,    user_specials.point_angle),
         oal            = COALESCE(EXCLUDED.oal,            user_specials.oal)
       RETURNING *`,
      [
        email.toLowerCase(), cc_number.trim().toUpperCase(),
        (description || "").trim(), (notes || "").trim(),
        (job_number || "").trim(), (job_description || "").trim(),
        tool_dia > 0 ? tool_dia : null,
        flutes > 0 ? flutes : null,
        loc > 0 ? loc : null,
        step_diameters?.length ? JSON.stringify(step_diameters) : null,
        step_lengths?.length   ? JSON.stringify(step_lengths)   : null,
        point_angle > 0 ? point_angle : null,
        oal > 0 ? oal : null,
      ]
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

  // PATCH by cc_number — used when auto-save happened at PDF upload and job fields filled in later
  app.patch("/api/specials/by-cc", async (req, res) => {
    const { email, token, cc_number, job_number, job_description } = req.body;
    if (!email || !token || !cc_number?.trim()) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    await pool.query(
      `UPDATE user_specials SET
         job_number = COALESCE(NULLIF($1, ''), job_number),
         job_description = COALESCE(NULLIF($2, ''), job_description)
       WHERE email = $3 AND cc_number = $4`,
      [job_number?.trim() ?? '', job_description?.trim() ?? '', email.toLowerCase(), cc_number.trim().toUpperCase()]
    );
    res.json({ ok: true });
  });

  app.patch("/api/specials/:id", async (req, res) => {
    const { email, token, description, notes, job_number, job_description } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const row = await pool.query(
      `UPDATE user_specials SET
         description = COALESCE($1, description),
         notes = COALESCE($2, notes),
         job_number = COALESCE($3, job_number),
         job_description = COALESCE($4, job_description)
       WHERE id = $5 AND email = $6 RETURNING *`,
      [description?.trim() ?? null, notes?.trim() ?? null, job_number?.trim() ?? null, job_description?.trim() ?? null, id, email.toLowerCase()]
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
      //
      // Roughers can EXCEED the wall-to-wall fit (corner_radius * 2) — they leave
      // stock at corners for the corner finisher to clean up. BUT they shouldn't
      // go too far above it: the larger the rougher, the more material the finisher
      // has to remove in every corner — full-radial spike loads, slow cycle.
      //
      // Shop-validated rule: rougher dia ≤ 3× corner_radius (i.e. 1.5× wall-to-wall
      // dia). For R0.236" wall corners this caps roughers at ~0.708" → 0.750" stock
      // size, which lines up with what shop operators actually choose. Was 4×
      // historically; that left too much corner stock at typical aerospace radii.
      //
      // The corner finisher MUST be ≤ wall-to-wall fit to produce the radius —
      // enforced in the corner picker via maxCornerDia, not here.
      const hemDiaCap = cutting_style === "hem" ? 0.625 : Infinity;
      const roughCornerCap = corner_radius > 0 ? corner_radius * 3.0 : Infinity;
      const maxBulkDia = Math.min(
        pocketCeilingDia < Infinity ? pocketCeilingDia : 2.0,
        hemDiaCap,
        roughCornerCap
      );

      // ── Material-appropriate coating + flute filters ───────────────────────
      // ISO N (aluminum): D-Max or A-Max coating, 2–3 flutes
      // ISO P/M/K/S/H (steel/stainless/titanium/superalloy/hardened): P-Max or T-Max, 4+ flutes
      const isoUpper = (iso_category ?? "").toUpperCase();
      const isAluminum = isoUpper === "N";
      const coatingFilter = isAluminum
        ? `AND (coating ILIKE 'D-Max%' OR coating ILIKE 'A-Max%' OR coating IS NULL OR coating = '')`
        : `AND (coating ILIKE 'P-Max%' OR coating ILIKE 'T-Max%')`;
      // Flute count rules for pocketing roughing:
      //   Aluminum (ISO N): 2–3 flutes for chip clearance.
      //   Ferrous: 4+ flutes. Traditional prefers 5-fl (better chip clearance at
      //     wider WOC) but allows 6-fl when deeper pockets need the stiffer core.
      //     The fluteOrderUpper = 'ASC' for traditional puts 4/5-fl first; 6-fl
      //     only wins when nothing smaller fits the dia/reach combo.
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
      // Filter for tools whose corner radius is suitable for the floor radius requirement:
      //   - If floor_radius is set: tool CR must be ≤ floor_radius (smaller is fine, larger
      //     would leave an oversized floor radius — wrong geometry).
      //   - If floor_radius is NOT set: any CR ≤ wall corner_radius qualifies.
      // Ball nose tools satisfy any floor radius via axial engagement so they pass through.
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
                AND ($2::numeric = 0 OR corner_condition::numeric <= $2::numeric))
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

        // Extended pool — used when no in-cap candidate reaches the remaining depth.
        // For HEM, maxBulkDia caps at 0.625" to keep radial forces manageable at depth.
        // But on a deep pocket (e.g. 4"), there may be no 0.625" tool with sufficient reach,
        // leaving a depth gap. When that happens, allow slightly larger diameters for the
        // final-reach band — but conservatively. Going too big (1"+ on a 4" deep HEM pocket)
        // creates a 4×D+ chatter risk that defeats the purpose.
        //
        const extendedCap = Math.min(
          maxBulkDia * 1.5,  // step up by at most 50% from the HEM force-management cap
          closed_pocket && pocket_length > 0 && pocket_width > 0
            ? Math.min(pocket_length, pocket_width) * 0.65
            : 1.0,
          1.0  // absolute ceiling — past 1" tools, the L/D for deep work is unmanageable
        );
        const extendedCandidates = coverage.filter(r => parseFloat(r.cutting_diameter_in) <= extendedCap);

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
            // No in-cap candidate met criteria. Try the extended pool — a slightly
            // larger diameter tool to reach the remaining depth. Iterate SMALLEST
            // first so we pick the most rigid (best L/D) tool that gets reach,
            // not the biggest one available.
            //
            // Intermediate-ladder logic: when the remaining gap is large
            // (≥ 1×D of the extended-pool dia), look for a SHORTER RN at the
            // same dia first — it's stiffer and covers part of the gap. The
            // long RN can then take only the bottom portion as a 2nd tool
            // (or be the corner finisher, same dia).
            //
            // Example: 4" pocket, 0.625" bulk only reaches 2.5". Extended
            // pool has 0.75" tools with 3.0" LBS and 4.0" LBS available.
            // Sequencer picks the 3.0" LBS for the 2.5→3.0" band, then the
            // 4.0" LBS for the 3.0→4.0" band (or as corner finisher).
            const extendedAsc = [...extendedCandidates].sort((a, b) =>
              parseFloat(a.cutting_diameter_in) - parseFloat(b.cutting_diameter_in)
            );
            for (const row of extendedAsc) {
              const dia = parseFloat(row.cutting_diameter_in);
              if (dia <= maxBulkDia) continue;  // already tried in the main loop
              const maxReach = parseFloat(row.max_reach || "0");
              if (maxReach < target_depth) continue;
              const remaining = target_depth - depthCovered;

              // Check for intermediate ladder opportunity: is there a SHORTER
              // RN at this dia that covers >= 50% of the remaining depth?
              // If yes, pick it now and let the next loop iteration grab the
              // longer RN for the final band.
              if (remaining >= dia * 1.0 && !isLastSlot) {
                // Look for an RN with reach in (depthCovered, target_depth)
                // — strictly shorter than the longest RN at this dia.
                const intermediate = await pool.query(`
                  SELECT MIN(COALESCE(lbs_in, loc_in)) AS reach
                  FROM skus
                  WHERE tool_type = 'endmill'
                    AND cutting_diameter_in = $1
                    AND lbs_in IS NOT NULL
                    AND COALESCE(lbs_in, loc_in) > $2
                    AND COALESCE(lbs_in, loc_in) < $3
                    AND corner_condition NOT IN ('square','ball')
                    AND corner_condition ~ '^[0-9.]+'
                    ${coatingFilter}
                `, [dia, depthCovered + dia * 0.3, target_depth]);
                const intermediateReach = parseFloat(intermediate.rows[0]?.reach ?? "0");
                if (intermediateReach > depthCovered && intermediateReach < target_depth) {
                  // Use the intermediate as this slot — final RN will fall to
                  // either the last slot or the corner finisher (same dia, longer)
                  picked = { tool: null as any, reach: intermediateReach, dia, useRn: true };
                  break;
                }
              }

              // No intermediate exists or gap too small — use the long RN
              const bandGain = maxReach - depthCovered;
              if (bandGain >= dia * 0.4) {
                picked = { tool: null as any, reach: maxReach, dia, useRn: true };
                break;
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
            // Tools 2+ rapid down through the cavity the prior tool cleared,
            // then must enter virgin stock at the bottom of their band — helical ramp.
            // (Open pockets: subsequent tools can still sweep around if there's a side wall opening,
            // but conservatively we ramp into virgin band material the same way.)
            entry = { type: "helical", helix_dia: +(toolDia * 0.93).toFixed(4), angle_deg: cutting_style === "hem" ? 2 : 3 };
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
          // Prefer corner radius tool; fall back to ball nose if no CR tool stocked at this dia.
          // Floor radius matching: when user specifies floor_radius, pick the CR tool whose
          // radius is CLOSEST to that target (exact match wins). Picking the largest CR that
          // satisfies the filter produces oversized floor radii — wrong geometry on the part.
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
                    AND (corner_condition::numeric <= $3::numeric))
              )
              AND COALESCE(lbs_in, loc_in) >= $2
              ${coatingFilter}
            ORDER BY
              -- Prefer CR over ball
              CASE WHEN corner_condition = 'ball' THEN 1 ELSE 0 END ASC,
              -- When floor_radius set: pick CR closest to target (abs distance ASC).
              -- When not set: prefer largest CR (legacy behavior — DESC).
              CASE
                WHEN $4::numeric > 0 AND corner_condition ~ '^[0-9.]+$'
                  THEN ABS(corner_condition::numeric - $4::numeric)
                ELSE NULL
              END ASC NULLS LAST,
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

      const fmEstimate = (dia: number) => {
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
      };

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
      const snapDrillDown = (maxDia: number): number | null => {
        const fits = STANDARD_DRILLS_IN.filter(d => d <= maxDia);
        return fits.length > 0 ? fits[fits.length - 1] : null;
      };
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
