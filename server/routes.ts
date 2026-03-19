import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api, mentorSchemas } from "@shared/routes";
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
  // Fall back to system Python (Windows: python, Unix: python3)
  return process.platform === "win32" ? "python" : "python3";
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
        `SELECT s.* FROM skus s
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
      const { tool_type, material, flutes, diameter, dia_min, dia_max, min_loc, loc, lbs_exclude, corner, coating, center_cutting, geometry, required_chamfer_length, chamfer_lengths, chamfer_angle, tip_diameter, axial_depth, part_corner_radius, max_floor_radius, max_flutes, min_flutes, series } = req.query;

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

      const sql = `
        SELECT s.edp, s.tool_type, s.series, s.description1, s.description2,
               s.cutting_diameter_in, s.flutes, s.loc_in, s.lbs_in, s.oal_in,
               s.corner_condition, s.coating, s.geometry,
               s.variable_pitch, s.variable_helix, s.helix,
               s.shank_dia_in, s.flute_wash, s.center_cutting,
               s.chamfer_angle, s.tip_diameter, s.max_cutting_edge_length
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
        for (const s of stability.suggestions) {
          const lookupFlutes = s.suggested_flutes ?? s.lookup_flutes;
        if ((s.type === "tool" || s.type === "diameter") && lookupFlutes && s.lookup_dia) {
            try {
              const flutes = (s.suggested_flutes ?? s.lookup_flutes) as number;
              const currentEdp = String(s.lookup_edp ?? "");
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
                   ORDER BY s.edp`,
                  [derivedBase + "%"]
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
              const corner = (s.lookup_corner ?? "").toLowerCase();
              const cr     = s.lookup_cr ?? 0;
              const cornerStr = (corner === "square" || corner === "ball")
                ? corner
                : String(parseFloat(cr.toFixed(4)));  // "0.03", "0.06", etc.

              // For diameter suggestions: prefer tools where LOC >= required DOC (sufficient reach),
              // sorted by shortest sufficient LOC first. This avoids necked tools whose LOC
              // is shorter than the job needs (e.g. 606711 LOC=0.9375" < 1.0" DOC wins over
              // 606111 LOC=1.25" when using closest-LOC logic — wrong choice).
              if (s.type === "diameter") {
                // Primary: matching corner, LOC >= required, shortest sufficient LOC first
                const qd1 = await pool.query(
                  `SELECT s.edp FROM skus s
                   JOIN sku_uploads u ON s.upload_id = u.id
                   WHERE u.is_current = TRUE
                     AND s.flutes = $1
                     AND ABS(s.cutting_diameter_in - $2) < 0.001
                     AND LOWER(s.corner_condition) = LOWER($3)
                     AND COALESCE(s.loc_in, 0) >= $4
                     ${cbClause}
                     ${noBLK}
                   ORDER BY s.loc_in ASC, s.edp`,
                  [flutes, dia, cornerStr, loc]
                );
                if (qd1.rows.length > 0) {
                  s.suggested_edps = qd1.rows.map((r: any) => r.edp);
                  s.suggested_edp  = s.suggested_edps[0];
                } else {
                  // Fallback: ignore corner, LOC >= required
                  const qd2 = await pool.query(
                    `SELECT s.edp FROM skus s
                     JOIN sku_uploads u ON s.upload_id = u.id
                     WHERE u.is_current = TRUE
                       AND s.flutes = $1
                       AND ABS(s.cutting_diameter_in - $2) < 0.001
                       AND COALESCE(s.loc_in, 0) >= $3
                       AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
                       ${cbClause}
                       ${noBLK}
                     ORDER BY s.loc_in ASC, s.edp`,
                    [flutes, dia, loc]
                  );
                  if (qd2.rows.length > 0) {
                    s.suggested_edps = qd2.rows.map((r: any) => r.edp);
                    s.suggested_edp  = s.suggested_edps[0];
                  } else {
                    // Last resort: closest LOC regardless of length
                    const qd3 = await pool.query(
                      `SELECT s.edp FROM skus s
                       JOIN sku_uploads u ON s.upload_id = u.id
                       WHERE u.is_current = TRUE
                         AND s.flutes = $1
                         AND ABS(s.cutting_diameter_in - $2) < 0.001
                         AND s.tool_type IS DISTINCT FROM 'chamfer_mill'
                         ${cbClause}
                         ${noBLK}
                         AND ABS(COALESCE(s.loc_in, 0) - $3) = (
                           SELECT MIN(ABS(COALESCE(s2.loc_in, 0) - $3))
                           FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                           WHERE u2.is_current = TRUE
                             AND s2.flutes = $1
                             AND ABS(s2.cutting_diameter_in - $2) < 0.001
                             AND s2.tool_type IS DISTINCT FROM 'chamfer_mill'
                             ${cbClause.replace(/\bs\./g, "s2.")}
                             ${noBLK.replace(/\bs\./g, "s2.")}
                         )
                       ORDER BY s.edp`,
                      [flutes, dia, loc]
                    );
                    if (qd3.rows.length > 0) {
                      s.suggested_edps = qd3.rows.map((r: any) => r.edp);
                      s.suggested_edp  = s.suggested_edps[0];
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
                   AND ABS(COALESCE(s.loc_in, 0) - $4) = (
                     SELECT MIN(ABS(COALESCE(s2.loc_in, 0) - $4))
                     FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                     WHERE u2.is_current = TRUE
                       AND s2.flutes = $1
                       AND ABS(s2.cutting_diameter_in - $2) < 0.001
                       AND LOWER(s2.corner_condition) = LOWER($3)
                       ${cbClause.replace(/\bs\./g, "s2.")}
                       ${noBLK.replace(/\bs\./g, "s2.")}
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
                     AND ABS(COALESCE(s.loc_in, 0) - $3) = (
                       SELECT MIN(ABS(COALESCE(s2.loc_in, 0) - $3))
                       FROM skus s2 JOIN sku_uploads u2 ON s2.upload_id = u2.id
                       WHERE u2.is_current = TRUE
                         AND s2.flutes = $1
                         AND ABS(s2.cutting_diameter_in - $2) < 0.001
                         AND s2.tool_type IS DISTINCT FROM 'chamfer_mill'
                         ${cbClause.replace(/\bs\./g, "s2.")}
                         ${noBLK.replace(/\bs\./g, "s2.")}
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
    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
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
        from: `"Core Cutter Advisor" <${smtpUser}>`,
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
    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
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
        from: `"Core Cutter Advisor" <${smtpUser}>`,
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
    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
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
        from: `"Core Cutter Advisor" <${smtpUser}>`,
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
        console.log("Created EZCutCNC snippet");
      } else {
        await storage.updateSnippet(machMentor.id, {
          code: machiningMentorCode,
        });
        console.log("Updated EZCutCNC snippet");
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
          COUNT(i.id) as save_count,
          MAX(i.created_at) as last_active
        FROM toolbox_sessions s
        LEFT JOIN toolbox_items i ON i.email = s.email
        GROUP BY s.email, s.created_at
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
  "tool_type": "endmill|keyseat|dovetail|drill|step_drill|reamer|threadmill|chamfer_mill",
  "tool_dia": <number, cutting diameter in inches — nominal value only, ignore tolerances>,
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
  "cutting_material": <string, the workpiece material this tool is designed for — look for "CUTTING=" or "FOR:" in the notes section. Map to one of: "aluminum_wrought", "steel_alloy", "steel_free", "stainless_304", "stainless_316", "stainless_ph", "cast_iron", "inconel_718", "inconel_625", "titanium", "hardened_lt55", "hardened_gt55" — use null if not specified>
}`;

  app.post("/api/tool-geometry/extract", upload.single("pdf"), async (req, res) => {
    try {
      console.log("PDF extract route hit, file:", req.file?.originalname, "size:", req.file?.size);
      if (!req.file) {
        return res.status(400).json({ error: "No PDF file uploaded" });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      console.log("API key present:", !!apiKey, "length:", apiKey?.length);
      if (!apiKey) {
        return res.status(503).json({ error: "PDF extraction not configured — contact support" });
      }

      const client = new Anthropic({ apiKey });
      const pdfBase64 = req.file.buffer.toString("base64");

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            } as any,
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
    const fromName = "EZCutCNC by Core Cutter";
    const fromAddr = process.env.SMTP_USER || "noreply@corecutterusa.com";
    const mailOptions = {
      from: `"${fromName}" <${fromAddr}>`,
      to: email,
      subject: "Your EZCutCNC Toolbox Access Code",
      text: `Your EZCutCNC Toolbox verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.\n\n— Core Cutter LLC\n120 Technology Drive, Gardiner, ME 04345\nsales@corecutterusa.com`,
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
            <div style="font-size:22px;font-weight:900;letter-spacing:4px;color:#ea6c00;">EZCutCNC</div>
            <div style="font-size:11px;color:#888;margin-top:4px;letter-spacing:1px;">POWERED BY CORE CUTTER LLC</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:15px;color:#111;font-weight:600;">Your Toolbox Access Code</p>
            <p style="margin:0 0 24px;font-size:13px;color:#555;">Enter this code in the EZCutCNC app to access your Toolbox.</p>
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
    const { q } = req.query as { q: string };
    if (!q || q.length < 1) return res.json([]);
    const { pool } = await import("./db");
    const result = await pool.query(
      `SELECT id, brand, model, max_rpm, spindle_hp, taper, drive_type, dual_contact, coolant_types, tsc_psi, machine_type, control
       FROM machines
       WHERE brand ILIKE $1 OR model ILIKE $1 OR (brand || ' ' || model) ILIKE $1
       ORDER BY brand, model LIMIT 20`,
      [`%${q}%`]
    );
    res.json(result.rows);
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

  return httpServer;
}
