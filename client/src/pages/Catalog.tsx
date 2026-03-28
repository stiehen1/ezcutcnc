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

function parseCsvToRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase().replace(/[\s.]+/g, "_"));
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

function normalizeCornerCondition(v: string): string | null {
  if (!v) return null;
  const lower = v.toLowerCase().trim();
  if (lower === "square" || lower === "sq") return "square";
  if (lower === "ball") return "ball";
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  if (!isNaN(n) && n > 0) {
    // Snap to nearest known CR within 5% tolerance; ignore ballnose radii
    const match = VALID_CR.find(cr => Math.abs(cr - n) / cr < 0.05);
    return match ? String(match) : null;
  }
  return null;
}

function coerceRow(raw: Record<string, string>): Record<string, any> {
  const bool = (v: string) => v?.toLowerCase() === "true" || v === "1";
  const num = (v: string) => {
    const clean = v?.replace(/[$,\s]/g, "");
    return clean === "" || clean == null ? null : Number(clean);
  };
  return {
    EDP: raw.edp ?? "",
    series: raw.series || null,
    description1: raw.description1 || null,
    description2: raw.description2 || null,
    tool_type: raw.tool_type || null,
    cutting_diameter_in: snapToFraction(num(raw.cutting_diameter_in)),
    flutes: raw.flutes ? parseInt(raw.flutes, 10) : null,
    loc_in: snapToFraction(num(raw.loc_in)),
    lbs_in: snapToFraction(num(raw.lbs_in)),
    neck_dia_in: num(raw.neck_dia_in),
    shank_dia_in: num(raw.shank_dia_in),
    oal_in: snapToFraction(num(raw.oal_in)),
    corner_condition: normalizeCornerCondition(raw.corner_condition),
    flute_wash: num(raw.flute_wash),
    coating: raw.coating || raw.labeled_coating || null,
    geometry: raw.geometry ? raw.geometry.trim().toLowerCase().replace(/ /g, "_") || null : null,
    variable_pitch: bool(raw.variable_pitch),
    variable_helix: bool(raw.variable_helix),
    helix: raw.helix ? parseInt(raw.helix, 10) : null,
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
  };
}

export default function Catalog() {
  const [uploads, setUploads] = useState<UploadRecord[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
    if (!file.name.endsWith(".csv")) {
      setUploadError("Only CSV files are supported.");
      return;
    }
    const text = await file.text();
    const rawRows = parseCsvToRows(text);
    if (rawRows.length === 0) {
      setUploadError("No data rows found in the CSV.");
      return;
    }
    const rows = rawRows.map(coerceRow);
    setUploading(true);
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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">SKU Catalog</h1>
            <p className="text-sm text-gray-400 mt-1">Upload your cutting tool catalog as CSV. Each upload creates a new version.</p>
          </div>
          <a href="/" className="text-xs text-indigo-400 hover:text-indigo-300 underline">← Back to Mentor</a>
        </div>

        {/* Upload area */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">New Upload</h2>

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
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileInput} />
            {uploading ? (
              <p className="text-indigo-400 text-sm">Uploading…</p>
            ) : (
              <>
                <p className="text-gray-300 text-sm font-medium">Drop CSV here or click to browse</p>
                <p className="text-gray-500 text-xs mt-1">Must match the standard column layout</p>
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

      </div>
    </div>
  );
}
