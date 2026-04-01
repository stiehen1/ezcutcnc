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
  } catch (err: any) {
    console.warn("[user_machines migration]", err?.message ?? err);
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
      const raw = await runMentorBridge(parsed.data);
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
      // Enrich flute-upgrade suggestions with matching EDP from catalog
      const { pool } = await import("./db");
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
                     )
                   ORDER BY s.edp`,
                  [flutes, dia, loc]
                );
                if (q3.rows.length > 0) {
                  s.suggested_edps = q3.rows.map((r: any) => r.edp);
                  s.suggested_edp  = s.suggested_edps[0];
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
      const peers = await pool.query(
        `SELECT s.* FROM skus s
         JOIN sku_uploads u ON s.upload_id = u.id
         WHERE u.is_current = TRUE
           AND ABS(s.cutting_diameter_in - $1) < 0.001
           AND LOWER(s.edp) != LOWER($2)
           AND s.edp NOT ILIKE '%-BLK'
           AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
           ${isSurfacing ? `AND LOWER(s.corner_condition) IN ('ball','corner_radius')` : ""}
           ${mode === "circ_interp" ? `AND COALESCE(s.geometry,'standard') NOT IN ('chipbreaker','truncated_rougher')` : ""}
           ${mode === "slot" && isoCategory === "N" ? `AND COALESCE(s.geometry,'standard') != 'truncated_rougher' AND s.flutes IN (2,3)` : ""}
           ${mode === "slot" && isoCategory !== "N" ? `AND s.flutes <= 5` : ""}
         ORDER BY s.edp`,
        [dia, current_edp]
      );
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
      const sameLocCandidates = peers.rows.filter((r: any) => {
        const locMatch  = Math.abs(Number(r.loc_in) - curLoc) < 0.001;
        const rf        = Number(r.flutes);
        const geom      = (r.geometry ?? "standard").toLowerCase();
        // 5-fl VXR in slotting only at ≤ 0.5xD — exclude 5-fl VXR if deeper
        if (isSlot && geom === "truncated_rougher" && rf >= 5 && docXd > 0.5) return false;
        // Slotting: never go up in flutes — chip clearance gets worse, not better.
        // Steel/stainless/tough slot: prefer dropping to 4-flute (or 4-fl chipbreaker).
        // Aluminum slot: prefer dropping to 3-flute.
        const fluteMatch = rf === curFlutes
          || (!isSlot && (stabOver || isCircInterp || isFinish) && rf === nextFlutes)
          || (slotAlum  && rf === prevFlutes && prevFlutes >= 2)
          || (isSlot && !slotAlum && rf === prevFlutes && prevFlutes >= 4);
        return locMatch && fluteMatch;
      });
      let bestSku: any = null;
      let bestScore = -1;
      for (const row of sameLocCandidates) {
        let sc = scoreSku(row);
        const rf = Number(row.flutes);
        if (!isSlot && stabOver && rf === nextFlutes)      sc += STAB_FLUTE_BONUS;
        else if (!isSlot && isCircInterp && rf === nextFlutes) sc += CIRC_FLUTE_BONUS;
        else if (!isSlot && isFinish  && rf === nextFlutes) sc += FINISH_FLUTE_BONUS;
        else if (slotAlum  && rf === prevFlutes) sc += 2;
        else if (isSlot && !slotAlum && rf === prevFlutes && prevFlutes >= 4) sc += 2; // steel/tough: prefer 4-fl for slotting
        if (sc > bestScore) { bestScore = sc; bestSku = row; }
      }
      if (bestSku && bestScore > curScore) {
        // Found a same-LOC upgrade (coating, geometry, or flute count when deflecting)
      } else {
        // ── Priority 1.5: Next diameter up, same series ───────────────────────
        const curSeries = (curSku?.tool_series ?? "").toLowerCase();
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
            Math.abs(Number(r.loc_in) - curLoc) < 0.001 && Number(r.flutes) === nextFlutes
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
      if (!bestSku) return res.json({ found: false });

      // ── VXR rigidity gate ─────────────────────────────────────────────────
      // VXR4/VXR5 are aggressive roughers — suppress if setup can't handle the forces.
      // If VXR is blocked, fall back to best non-VXR peer rather than returning nothing.
      const sameLocSameFlute = peers.rows.filter((r: any) =>
        Math.abs(Number(r.loc_in) - curLoc) < 0.001 && Number(r.flutes) === curFlutes
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
      const modPayload = {
        ...payload,
        edp:             bestSku.edp,
        tool_dia:        Number(bestSku.cutting_diameter_in),
        flutes:          Number(bestSku.flutes),
        loc:             Number(bestSku.loc_in),
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
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "noreply@corecutterusa.com"}>`,
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
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "noreply@corecutterusa.com"}>`,
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
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "noreply@corecutterusa.com"}>`,
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

      // Skip sales notification for internal staff — they're testing, not leads
      const isStaff = typeof email === "string" && (email.endsWith("@corecutterusa.com") || email.endsWith("@corecutter.com"));
      if (isStaff) return res.json({ ok: true });

      const to = process.env.QUOTE_TO_EMAIL || "sales@corecutterusa.com";
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

      // Send results to user
      await transporter.sendMail({
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "noreply@corecutterusa.com"}>`,
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

      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[Results Email]", err?.message);
      return res.status(500).json({ error: "Failed to process request." });
    }
  });

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
    const valid = await hasMxRecord(email);
    if (!valid) {
      return res.json({ valid: false, error: "That email domain doesn't appear to be valid — please use your real work or personal email." });
    }
    return res.json({ valid: true });
  });

  // ── Welcome modal registration (geo capture, no email sent) ──────────────
  app.post("/api/register", async (req, res) => {
    try {
      const { name, email } = (req.body ?? {}) as { name?: string; email?: string };
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email required" });
      }
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "";
      const geo = await geoFromIp(clientIp);
      const { pool } = await import("./db");
      const isNew = await pool.query(
        `INSERT INTO leads (email, operation, name, ip, city, region, country, postal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [email.toLowerCase().trim(), "tool_request", name ?? null, clientIp, geo.city, geo.region, geo.country, geo.postal]
      );
      // Send registration notification to Scott for new users only (not duplicates)
      if (isNew.rowCount && isNew.rowCount > 0) {
        const smtpUser = process.env.SMTP_USER || "";
        const smtpPass = process.env.SMTP_PASS || "";
        if (smtpUser && smtpPass) {
          try {
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
              port: parseInt(process.env.SMTP_PORT || "587", 10),
              secure: parseInt(process.env.SMTP_PORT || "587", 10) === 465,
              auth: { user: smtpUser, pass: smtpPass },
            });
            await transporter.sendMail({
              from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "noreply@corecutterusa.com"}>`,
              to: "scott@corecutterusa.com",
              subject: `New App Registration — ${name ?? email}`,
              text: [
                `Name:     ${name ?? "—"}`,
                `Email:    ${email}`,
                `Location: ${[geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "Unknown"}`,
              ].join("\n"),
            });
          } catch (mailErr: any) {
            console.warn("[Register] Notification email failed:", mailErr?.message);
          }
        }
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.warn("[Register]", err?.message);
      res.json({ ok: true }); // never block the user
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
        from: `"Core Cutter Machining App" <${process.env.FROM_EMAIL || "noreply@corecutterusa.com"}>`,
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

    const [users, activity, operations] = await Promise.all([
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
    ]);

    res.json({
      users: users.rows,
      activity: activity.rows,
      operations: operations.rows,
      totals: {
        users: users.rows.length,
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

2. tool_dia is ALWAYS the largest Ø dimension on the cutter body — it appears labeled on both the left and right ends of the tool profile. It is NEVER 0 and NEVER left blank. On keyseat cutters it is the disc/wheel diameter (the big cutting part).

3. For KEYSEAT cutters specifically:
   - loc = the disc WIDTH (thickness of the cutting wheel, e.g. ".1875±.001" → 0.1875)
   - lbs = the REACH/TSC dimension (distance from shank face to cutter, e.g. "1.875+.06/.00 TSC" → 1.875)
   For all other tool types: loc = flute/cutting length, lbs = length below shank if necked.

4. For DOVETAIL cutters specifically:
   - dovetail_angle = the INCLUDED angle of the dovetail V-form. This is the FULL angle, NOT the half-angle. If the print shows 30° on one side of the V, the included angle is 60°. If it shows 45° on one side, the included is 90°. Look for the angle labeled at the V-groove or cutting tip — use the largest angle shown at the cutting form as the included angle.
   - lbs = the REACH/TSC dimension (distance from shank face to cutter zone, labeled TSC, e.g. ".625+.06/-.00 TSC" → 0.625)
   - keyseat_arbor_dia = the narrow neck diameter between the shank and the cutting head (e.g. "Ø0.200" neck → 0.200)

5. keyseat_arbor_dia is the small narrow neck connecting the cutter disc/head to the shank — applies to both keyseat AND dovetail cutters.

5. shank_dia is the large cylindrical body at the far end (shank) of the tool.

6. For THREAD MILLS specifically:
   - tool_dia = the CUTTING diameter (the thread form OD, e.g. "Ø0.745+.000/-.002" → 0.745)
   - loc = the LOC (length of cut / flute length, labeled "LOC", e.g. ".127 LOC" → 0.127)
   - lbs = the TSC dimension (reach from shank face to cutting zone, e.g. "1.00+.06/-.00 TSC" → 1.00)
   - shank_dia = the large shank OD (e.g. "Ø0.750-.0001/.0004" → 0.750)
   - thread_tpi = threads per inch if shown; 0 if not labeled (single-profile mills show thread angle only)
   - The neck diameter (smaller Ø between shank and cutter, e.g. "Ø0.525") maps to keyseat_arbor_dia for deflection modeling

Required fields (use 0 for unknown numbers, null for unknown strings):
{
  "units": "in|mm",
  "tool_type": "endmill|keyseat|dovetail|drill|step_drill|reamer|threadmill|chamfer_mill",
  "tool_dia": <number, cutting diameter — nominal value only, in the print's native units>,
  "flutes": <integer>,
  "loc": <number, length of cut / flute length / TSC in inches — nominal value only, 0 if unknown>,
  "lbs": <number, length below shank in inches, 0 if standard>,
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
  "oal": <number, overall length of the tool in inches — labeled "OAL" on the print. 0 if not shown.>
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
    const fromAddr = process.env.FROM_EMAIL || "noreply@corecutterusa.com";
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

  // ── Toolbox: save item ────────────────────────────────────────────────────
  app.post("/api/toolbox/save", async (req, res) => {
    const { email, token, type, title, data, notes } = req.body;
    if (!email || !token || !title) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const result = await pool.query(
      `INSERT INTO toolbox_items (email, type, title, data, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [email.toLowerCase(), type || "result", title, data ? JSON.stringify(data) : null, notes || ""]
    );
    res.json(result.rows[0]);
  });

  // ── Toolbox: list items ───────────────────────────────────────────────────
  app.get("/api/toolbox/items", async (req, res) => {
    const { email, token } = req.query as { email: string; token: string };
    if (!email || !token) return res.status(400).json({ error: "Missing email or token" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const result = await pool.query(
      `SELECT * FROM toolbox_items WHERE email = $1 ORDER BY created_at DESC`,
      [email.toLowerCase()]
    );
    res.json(result.rows);
  });

  // ── Machine catalog search ────────────────────────────────────────────────
  app.get("/api/machines/search", async (req, res) => {
    try {
      const { q, email, token } = req.query as { q: string; email?: string; token?: string };
      if (!q || q.length < 1) return res.json([]);
      const { pool } = await import("./db");

      // Split query into tokens — all tokens must match somewhere in brand/model/control/nickname.
      // Also match dash-stripped versions so "VF2" matches "VF-2", "DM4800" matches "DM-4800", etc.
      const tokens = q.trim().split(/\s+/).filter(Boolean);
      const params: string[] = tokens.map(t => `%${t}%`);
      const tokenConds = tokens.map((_, i) =>
        `(brand ILIKE $${i+1} OR model ILIKE $${i+1} OR control ILIKE $${i+1} OR (brand || ' ' || model) ILIKE $${i+1} OR REPLACE(model,'-','') ILIKE REPLACE($${i+1},'-','') OR REPLACE(brand || ' ' || model,'-','') ILIKE REPLACE($${i+1},'-',''))`
      ).join(" AND ");

      const catalogRows = await pool.query(
        `SELECT id, brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, machine_type, control, NULL::text AS nickname, NULL::text AS shop_machine_no, false AS _saved
         FROM machines
         WHERE ${tokenConds}
         ORDER BY brand, model LIMIT 20`,
        params
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
            const userTokenConds = tokens.map((_, i) =>
              `(brand ILIKE $${i+3} OR model ILIKE $${i+3} OR nickname ILIKE $${i+3} OR shop_machine_no ILIKE $${i+3} OR control ILIKE $${i+3} OR REPLACE(model,'-','') ILIKE REPLACE($${i+3},'-',''))`
            ).join(" AND ");
            const userParams = [email.toLowerCase(), token, ...tokens.map(t => `%${t}%`)];
            const ur = await pool.query(
              `SELECT id, brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, machine_type, control, nickname, shop_machine_no, true AS _saved
               FROM user_machines
               WHERE email = $1 AND (${userTokenConds})
               ORDER BY created_at DESC LIMIT 10`,
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
            coolant_types, tsc_psi, machine_type, control, notes } = req.body;
    if (!email || !token || !nickname) return res.status(400).json({ error: "Missing required fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const result = await pool.query(
      `INSERT INTO user_machines (email, nickname, shop_machine_no, serial_number, machine_id,
         brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact,
         coolant_types, tsc_psi, machine_type, control, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [email.toLowerCase(), nickname, shop_machine_no || null, serial_number || null,
       machine_id || null, brand || null, model || null, max_rpm || null,
       spindle_hp || null, taper || null, drive_type || null,
       dual_contact ?? false, coolant_types || null, tsc_psi || null,
       machine_type || null, control || null, notes || null]
    );
    res.json({ ok: true, id: result.rows[0].id });
  });

  // ── User machines: list ───────────────────────────────────────────────────
  app.get("/api/user-machines", async (req, res) => {
    const { email, token } = req.query as { email: string; token: string };
    if (!email || !token) return res.status(400).json({ error: "Missing email or token" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const result = await pool.query(
      `SELECT * FROM user_machines WHERE email = $1 ORDER BY created_at DESC`,
      [email.toLowerCase()]
    );
    res.json(result.rows);
  });

  // ── User machines: update (job tags + status) ────────────────────────────
  app.patch("/api/user-machines/:id", async (req, res) => {
    const { email, token, job_tags, machine_status, status_note, maintenance_date } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(
      `SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`,
      [email.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    await pool.query(
      `UPDATE user_machines SET
         job_tags = COALESCE($3, job_tags),
         machine_status = COALESCE($4, machine_status),
         status_note = $5,
         maintenance_date = $6
       WHERE id = $1 AND email = $2`,
      [id, email.toLowerCase(),
       job_tags !== undefined ? JSON.stringify(job_tags) : null,
       machine_status || null,
       status_note ?? null,
       maintenance_date ?? null]
    );
    res.json({ ok: true });
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
    const { email, token, title } = req.body;
    const id = parseInt(req.params.id);
    if (!email || !token || !title?.trim()) return res.status(400).json({ error: "Missing fields" });
    const { pool } = await import("./db");
    const auth = await pool.query(`SELECT id FROM toolbox_sessions WHERE email = $1 AND token = $2`, [email.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: "Unauthorized" });
    const r = await pool.query(`UPDATE toolbox_items SET title = $1 WHERE id = $2 AND email = $3 RETURNING *`, [title.trim(), id, email.toLowerCase()]);
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
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

  return httpServer;
}
