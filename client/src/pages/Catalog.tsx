import { useState, useRef } from "react";

type UploadRecord = {
  id: number;
  filename: string;
  row_count: number;
  is_current: boolean;
  notes: string | null;
  uploaded_at: string;
};

type UploadResult = {
  uploadId: number;
  inserted: number;
  skipped: number;
  total: number;
};

// Normalize a header cell the same way for CSV and XLSX so both paths key rows
// identically ("Preferred Stickout" → preferred_stickout).
function normalizeHeader(h: string): string {
  return String(h ?? "").trim().replace(/^"|"$/g, "").toLowerCase().replace(/[\s.]+/g, "_");
}

// ── XLSX parsing ──────────────────────────────────────────────────────────────
// Preferred over CSV because Excel writes the *displayed* value to CSV, not the
// stored one — a column formatted to 2 decimals turns 0.1094 into 0.11, a
// plausible-but-wrong number nothing downstream can flag. Reading the workbook
// takes the underlying numeric cell value at full precision instead.
async function parseXlsxToRows(file: File): Promise<Record<string, any>[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = normalizeHeader(cellToPrimitive(cell) as string);
  });

  const rows: Record<string, any>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;                                   // header
    const obj: Record<string, any> = {};
    let any = false;
    headers.forEach((h, col) => {
      if (!h) return;
      const v = cellToPrimitive(row.getCell(col));
      obj[h] = v;
      if (v !== "" && v !== null && v !== undefined) any = true;
    });
    if (any) rows.push(obj);                                    // skip blank rows
  });
  return rows;
}

// Pull a usable primitive out of an ExcelJS cell. Numbers stay numbers (full
// precision); formulas resolve to their cached result; rich text flattens.
function cellToPrimitive(cell: any): any {
  const v = cell?.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    if ("result" in v) return cellToPrimitive({ value: (v as any).result });   // formula
    if ("richText" in v) return (v as any).richText.map((t: any) => t.text).join("").trim();
    if ("text" in v) return String((v as any).text).trim();                    // hyperlink
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

function parseCsvToRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const vals: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { vals.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
}

const VALID_CR = [0.010, 0.015, 0.020, 0.030, 0.060, 0.090, 0.125];

// Standard fractional sizes in inches — LOC/OAL/LBS snap to nearest within 1%
const FRAC_SIZES = [
  1/64,1/32,3/64,1/16,5/64,3/32,7/64,1/8,9/64,5/32,11/64,3/16,
  13/64,7/32,15/64,1/4,9/32,5/16,11/32,3/8,13/32,7/16,15/32,1/2,
  9/16,5/8,11/16,3/4,13/16,7/8,15/16,1,1+1/16,1+1/8,1+3/16,1+1/4,
  1+5/16,1+3/8,1+7/16,1+1/2,1+3/4,2,2+1/4,2+1/2,2+3/4,3,3+1/2,4,4+1/2,5,6,
];

function snapToFraction(v: number | null): number | null {
  if (v == null || isNaN(v) || v <= 0) return v;
  const match = FRAC_SIZES.find(f => Math.abs(f - v) / f < 0.01);
  return match != null ? parseFloat(match.toFixed(6)) : v;
}

// Accepts "square" | "ball" | a CR number. XLSX hands us a real number for the CR
// case (0.010, not "0.010"), so coerce to string before any string ops.
function normalizeCornerCondition(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  const raw = String(v).trim();
  const lower = raw.toLowerCase();
  if (lower === "square" || lower === "sq") return "square";
  if (lower === "ball") return "ball";
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!isNaN(n) && n > 0) {
    // Snap to nearest known CR within 5% tolerance; ignore ballnose radii
    const match = VALID_CR.find(cr => Math.abs(cr - n) / cr < 0.05);
    return match ? String(match) : null;
  }
  return null;
}

// Accepts rows from either parser. CSV yields all-strings; XLSX yields real
// numbers/booleans — so bool()/num() must handle both rather than assuming string.
function coerceRow(raw: Record<string, any>): Record<string, any> {
  const bool = (v: any) => {
    if (typeof v === "boolean") return v;
    const s = String(v ?? "").trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x";
  };
  const num = (v: any) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;   // XLSX: full precision
    const clean = String(v ?? "").replace(/[$,\s]/g, "");
    if (clean === "") return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: any) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };
  return {
    EDP: String(raw.edp ?? "").trim(),
    series: str(raw.series),
    description1: str(raw.description1),
    description2: str(raw.description2),
    tool_type: str(raw.tool_type),
    cutting_diameter_in: snapToFraction(num(raw.cutting_diameter_in)),
    flutes: num(raw.flutes) != null ? Math.round(num(raw.flutes) as number) : null,
    loc_in: snapToFraction(num(raw.loc_in)),
    lbs_in: snapToFraction(num(raw.lbs_in)),
    neck_dia_in: num(raw.neck_dia_in),
    shank_dia_in: num(raw.shank_dia_in),
    oal_in: snapToFraction(num(raw.oal_in)),
    corner_condition: normalizeCornerCondition(raw.corner_condition),
    flute_wash: num(raw.flute_wash),
    coating: str(raw.coating) ?? str(raw.labeled_coating),
    geometry: str(raw.geometry)?.toLowerCase().replace(/ /g, "_") ?? null,
    variable_pitch: bool(raw.variable_pitch),
    variable_helix: bool(raw.variable_helix),
    helix: num(raw.helix) != null ? Math.round(num(raw.helix) as number) : null,
    chamfer_angle: num(raw.chamfer_angle),
    tip_diameter: num(raw.tip_diameter),
    iso_n: bool(raw.iso_n),
    iso_p: bool(raw.iso_p),
    iso_m: bool(raw.iso_m),
    iso_k: bool(raw.iso_k),
    iso_s: bool(raw.iso_s),
    iso_h: bool(raw.iso_h),
    op_hem: bool(raw.op_hem),
    op_traditional: bool(raw.op_traditional),
    op_finishing: bool(raw.op_finishing),
    max_woc_traditional_pct: num(raw.max_woc_traditional_pct),
    center_cutting: bool(raw.center_cutting),
    max_cutting_edge_length: num(raw.max_cutting_edge_length),
    // Per-tool stickout overrides. Blank cell → null → server falls back to the
    // geometric rule (preferred = floor + 0.20×D, minimum = floor). Header names are
    // normalized to lowercase-underscore by parseCsvToRows, so "Preferred Stickout"
    // arrives as preferred_stickout. Aliases accepted for either naming style.
    default_stickout_in: num(raw.preferred_stickout ?? raw.preferred_stickout_in ?? raw.default_stickout_in ?? raw.max_stickout_in ?? ""),
    min_stickout_in: num(raw.minimum_stickout ?? raw.min_stickout ?? raw.min_stickout_in ?? ""),
  };
}

// ── CSV upload template ───────────────────────────────────────────────────────
// Headers MUST stay in sync with coerceRow() above — that whitelist is what the
// upload actually reads; anything not listed there is silently dropped. Column
// ORDER is irrelevant (rows are keyed by header name), so this is just a
// convenient canonical layout. tool_type is deliberately omitted: the server
// auto-derives it (chamfer_angle > 0 → chamfer_mill, else endmill).
const TEMPLATE_HEADERS = [
  "EDP", "series", "description1", "description2",
  "cutting_diameter_in", "flutes", "loc_in", "lbs_in", "neck_dia_in",
  "shank_dia_in", "oal_in", "corner_condition", "flute_wash", "coating",
  "geometry", "variable_pitch", "variable_helix", "helix",
  "chamfer_angle", "tip_diameter",
  "Preferred Stickout", "Minimum Stickout",
  "iso_n", "iso_p", "iso_m", "iso_k", "iso_s", "iso_h",
  "op_hem", "op_traditional", "op_finishing",
  "max_woc_traditional_pct", "center_cutting", "max_cutting_edge_length",
];

// Two real rows so the expected formats are unambiguous: a corner-radius endmill
// with both stickout overrides filled, and a square endmill leaving them blank
// (which falls back to the geometric rule).
const TEMPLATE_EXAMPLES = [
  ["Q1093R", "QTR3", "3-Flute High-Performance P-Max Coated Endmill", "Corner Radius",
   "0.1094", "3", "0.328", "", "", "0.250", "2.000", "0.010", "0.164", "p_max",
   "standard", "true", "true", "38", "", "",
   "0.830", "0.700",
   "true", "true", "true", "false", "false", "false",
   "true", "true", "true", "", "true", ""],
  ["505221", "VST5", "5-Flute High-Performance P-Max Coated Endmill", "Corner Radius",
   "0.5000", "5", "1.250", "", "", "0.500", "3.000", "0.030", "0.139", "p_max",
   "standard", "true", "false", "38", "", "",
   "", "",
   "false", "true", "true", "false", "true", "false",
   "true", "true", "true", "", "true", ""],
];

// Columns that must keep full decimal precision. Given an explicit numFmt so Excel
// DISPLAYS all the digits — if it shows 0.11 for a 0.1094 value, a Save-As-CSV would
// write the rounded 0.11. Formatting them wide makes that failure mode impossible.
const TEMPLATE_DECIMAL_FMT: Record<string, string> = {
  cutting_diameter_in: "0.0000",
  loc_in: "0.000", lbs_in: "0.000", neck_dia_in: "0.000",
  shank_dia_in: "0.000", oal_in: "0.000",
  flute_wash: "0.000", corner_condition: "0.000", tip_diameter: "0.0000",
  "Preferred Stickout": "0.000", "Minimum Stickout": "0.000",
  max_cutting_edge_length: "0.000",
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Real .xlsx so numbers download as numbers with wide decimal formats — no CSV
// display-rounding round-trip. Values are written as numbers where numeric.
async function downloadTemplateXlsx() {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CoreCutCNC";
  const ws = wb.addWorksheet("SKUs");

  ws.addRow(TEMPLATE_HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  TEMPLATE_EXAMPLES.forEach((ex) => {
    ws.addRow(ex.map((v) => {
      if (v === "") return null;
      if (v === "true") return true;
      if (v === "false") return false;
      const n = Number(v);
      return String(v).trim() !== "" && Number.isFinite(n) ? n : v;
    }));
  });

  TEMPLATE_HEADERS.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(12, Math.min(38, h.length + 4));
    const fmt = TEMPLATE_DECIMAL_FMT[h];
    if (fmt) col.numFmt = fmt;
  });

  triggerDownload(
    new Blob([await wb.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "sku-upload-template.xlsx",
  );
}

function downloadTemplateCsv() {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [
    TEMPLATE_HEADERS.map(esc).join(","),
    ...TEMPLATE_EXAMPLES.map((r) => r.map(esc).join(",")),
  ].join("\r\n");
  // BOM so Excel opens it as UTF-8 rather than mangling it.
  triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }), "sku-upload-template.csv");
}

export default function Catalog({ embedded = false }: { embedded?: boolean } = {}) {
  const [uploads, setUploads] = useState<UploadRecord[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // First few parsed rows, echoed so silent Excel decimal truncation is visible.
  const [parsePreview, setParsePreview] = useState<Array<Record<string, any>> | null>(null);
  const [notes, setNotes] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/skus/uploads");
      setUploads(await res.json());
    } finally {
      setLoadingHistory(false);
    }
  }

  async function setCurrent(id: number) {
    await fetch(`/api/skus/uploads/${id}/set-current`, { method: "POST" });
    loadHistory();
  }

  async function deleteUpload(id: number) {
    if (!confirm("Delete this upload and all its SKU rows?")) return;
    await fetch(`/api/skus/uploads/${id}`, { method: "DELETE" });
    loadHistory();
  }

  async function handleFile(file: File) {
    setUploadError(null);
    setUploadResult(null);
    setParsePreview(null);
    const lower = file.name.toLowerCase();
    const isXlsx = lower.endsWith(".xlsx") || lower.endsWith(".xlsm");
    const isCsv = lower.endsWith(".csv");
    if (!isXlsx && !isCsv) {
      setUploadError(lower.endsWith(".xls")
        ? "Legacy .xls isn't supported — open it in Excel and Save As .xlsx."
        : "Only .xlsx or .csv files are supported.");
      return;
    }
    setUploading(true);
    let rawRows: Record<string, any>[] = [];
    try {
      rawRows = isXlsx ? await parseXlsxToRows(file) : parseCsvToRows(await file.text());
    } catch (err: any) {
      setUploading(false);
      setUploadError(`Could not read ${isXlsx ? "workbook" : "CSV"}: ${err?.message ?? "unknown error"}`);
      return;
    }
    if (rawRows.length === 0) {
      setUploading(false);
      setUploadError(`No data rows found in the ${isXlsx ? "workbook" : "CSV"}. Row 1 must be the header row.`);
      return;
    }
    const rows = rawRows.map(coerceRow);
    // Echo back what was actually parsed for the first couple of rows. Excel-to-CSV
    // silently writes the *displayed* value (a column formatted to 2 decimals turns
    // 0.1094 into 0.11), so a truncated diameter/stickout is a plausible wrong number
    // nothing downstream can flag. Showing it here makes it visible immediately.
    setParsePreview(rows.slice(0, 3).map((r) => ({
      edp: String(r.EDP ?? ""),
      dia: r.cutting_diameter_in,
      loc: r.loc_in,
      wash: r.flute_wash,
      pref: r.default_stickout_in,
      min: r.min_stickout_in,
    })));
    try {
      const res = await fetch("/api/skus/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, filename: file.name, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Upload failed");
      setUploadResult(data);
      setNotes("");
      loadHistory();
    } catch (err: any) {
      setUploadError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  // Load history on first render
  if (uploads === null && !loadingHistory) loadHistory();

  const Outer = embedded
    ? ({ children }: { children: React.ReactNode }) => <div className="space-y-8">{children}</div>
    : ({ children }: { children: React.ReactNode }) => (
        <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
          <div className="max-w-3xl mx-auto space-y-8">{children}</div>
        </div>
      );

  return (
    <Outer>

        {/* Header — hidden in embedded mode (Admin provides its own chrome) */}
        {!embedded && (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">SKU Catalog</h1>
              <p className="text-sm text-gray-400 mt-1">Upload your cutting tool catalog as CSV. Each upload creates a new version.</p>
            </div>
            <a href="/" className="text-xs text-indigo-400 hover:text-indigo-300 underline">← Back to Mentor</a>
          </div>
        )}

        {/* Upload area */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">New Upload</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { downloadTemplateXlsx(); }}
                className="text-xs px-3 py-1.5 rounded border border-indigo-600 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors"
                title="Download the upload template as a formatted Excel workbook (recommended — keeps full decimal precision)"
              >
                ↓ Template (.xlsx)
              </button>
              <button
                type="button"
                onClick={downloadTemplateCsv}
                className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
                title="Download the same template as CSV"
              >
                ↓ .csv
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Column <strong>order doesn't matter</strong> — rows are matched by header name, and unknown columns are ignored.
            Leave <code className="text-gray-400">Preferred Stickout</code> / <code className="text-gray-400">Minimum Stickout</code> blank
            to use the standard rule (preferred = minimum + 0.20×D). No <code className="text-gray-400">tool_type</code> column needed —
            it's derived (<code className="text-gray-400">chamfer_angle</code> &gt; 0 → chamfer mill, else endmill).
            <span className="text-amber-500/80"> Prefer .xlsx:</span> saving as CSV from Excel writes the <em>displayed</em> value,
            so a column formatted to 2 decimals turns 0.1094 into 0.11.
          </p>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes (e.g. 'March 2026 standard catalog')"
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:border-indigo-500"
          />

          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors"
            style={{ borderColor: dragOver ? "#6366f1" : "#374151", backgroundColor: dragOver ? "#1e1b4b" : "#111827" }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={onFileInput} />
            {uploading ? (
              <p className="text-indigo-400 text-sm">Reading &amp; uploading…</p>
            ) : (
              <>
                <p className="text-gray-300 text-sm font-medium">Drop .xlsx or .csv here or click to browse</p>
                <p className="text-gray-500 text-xs mt-1">Header row first · .xlsx recommended (exact decimals)</p>
              </>
            )}
          </div>

          {uploadResult && (
            <div className="bg-green-900/30 border border-green-700 rounded px-4 py-3 text-sm text-green-300">
              Upload complete — <strong>{uploadResult.inserted}</strong> rows inserted
              {uploadResult.skipped > 0 && `, ${uploadResult.skipped} skipped (no EDP)`}.
              This upload is now set as <strong>Current</strong>.
            </div>
          )}

          {uploadError && (
            <div className="bg-red-900/30 border border-red-700 rounded px-4 py-3 text-sm text-red-300">
              {uploadError}
            </div>
          )}

          {/* Parsed-value echo — catches silent decimal truncation before it's live. */}
          {parsePreview && parsePreview.length > 0 && (
            <div className="bg-gray-900 border border-gray-700 rounded px-4 py-3">
              <p className="text-xs text-gray-400 mb-2">
                Parsed values (first {parsePreview.length} row{parsePreview.length === 1 ? "" : "s"}) — check the decimals landed exactly as intended:
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs text-gray-300 tabular-nums">
                  <thead className="text-gray-500">
                    <tr>
                      {["EDP", "Cut Dia", "LOC", "Flute Wash", "Preferred SO", "Minimum SO"].map((h) => (
                        <th key={h} className="text-left font-medium pr-5 pb-1">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsePreview.map((r, i) => (
                      <tr key={i}>
                        <td className="pr-5 py-0.5 font-mono">{r.edp || "—"}</td>
                        {[r.dia, r.loc, r.wash, r.pref, r.min].map((v, j) => (
                          <td key={j} className="pr-5 py-0.5 font-mono">
                            {v == null || v === "" ? <span className="text-gray-600">blank → formula</span> : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Upload history */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Upload History</h2>

          {loadingHistory && <p className="text-xs text-gray-500">Loading…</p>}

          {uploads && uploads.length === 0 && (
            <p className="text-xs text-gray-500">No uploads yet.</p>
          )}

          {uploads && uploads.length > 0 && (
            <div className="space-y-2">
              {uploads.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-lg px-4 py-3 border"
                  style={{
                    borderColor: u.is_current ? "#6366f1" : "#374151",
                    backgroundColor: u.is_current ? "#1e1b4b" : "#1f2937",
                  }}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-100 truncate">{u.filename}</span>
                      {u.is_current && (
                        <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                          CURRENT
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {u.row_count.toLocaleString()} SKUs &middot; {new Date(u.uploaded_at).toLocaleString()}
                      {u.notes && <> &middot; {u.notes}</>}
                    </div>
                  </div>

                  <div className="shrink-0 ml-4 flex gap-2">
                    {!u.is_current && (
                      <button
                        onClick={() => setCurrent(u.id)}
                        className="text-xs px-3 py-1 rounded border border-indigo-500 text-indigo-400 hover:bg-indigo-900 transition-colors"
                      >
                        Set as Current
                      </button>
                    )}
                    {!u.is_current && (
                      <button
                        onClick={() => deleteUpload(u.id)}
                        className="text-xs px-3 py-1 rounded border border-red-800 text-red-400 hover:bg-red-900/40 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

    </Outer>
  );
}
