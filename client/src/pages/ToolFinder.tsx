import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const STP_CDN = "https://cdn.ezcutcnc.app";
function stpUrl(edp: string): string {
  return `${STP_CDN}/${encodeURIComponent("Core_Cutter_" + edp + " v1.step")}`;
}

type SkuRow = {
  edp: string;
  tool_type: string | null;
  series: string | null;
  description1: string | null;
  description2: string | null;
  cutting_diameter_in: number | null;
  flutes: number | null;
  loc_in: number | null;
  lbs_in: number | null;
  oal_in: number | null;
  corner_condition: string | number | null;
  coating: string | null;
  geometry: string | null;
  variable_pitch: boolean | null;
  variable_helix: boolean | null;
  helix: number | null;
  shank_dia_in: number | null;
  flute_wash: number | null;
  center_cutting: boolean | null;
  chamfer_angle: number | null;
  tip_diameter: number | null;
  max_cutting_edge_length: number | null;
  default_stickout_in?: number | null;
};

type Options = {
  toolTypes: string[];
  diameters: number[];
  locs: number[];
  lbsLengths: number[];
  flutes: number[];
  coatings: string[];
  corners: string[];
  geometries: string[];
  chamferLengths: number[];
  chamferAngles: number[];
  tipDiameters: number[];
  series: string[];
  centerCuttingVals: boolean[];
};

const TOOL_TYPE_LABELS: Record<string, string> = {
  endmill: "Endmill",
  chamfer_mill: "Chamfer Mill",
};

const ISO_MATERIALS = [
  { value: "p", label: "P — Carbon & Alloy Steel" },
  { value: "m", label: "M — Stainless Steel" },
  { value: "k", label: "K — Cast Iron" },
  { value: "n", label: "N — Non-Ferrous / Aluminum" },
  { value: "s", label: "S — Superalloys / Titanium" },
  { value: "h", label: "H — Hardened Steel" },
];

const VALID_CR = [0.010, 0.015, 0.020, 0.030, 0.060, 0.090, 0.125];

const FRAC_MAP: [number, string][] = [
  [1/64,"1/64"],[1/32,"1/32"],[3/64,"3/64"],[1/16,"1/16"],[5/64,"5/64"],[3/32,"3/32"],
  [7/64,"7/64"],[1/8,"1/8"],[9/64,"9/64"],[5/32,"5/32"],[11/64,"11/64"],[3/16,"3/16"],
  [13/64,"13/64"],[7/32,"7/32"],[15/64,"15/64"],[1/4,"1/4"],[5/16,"5/16"],[3/8,"3/8"],
  [7/16,"7/16"],[1/2,"1/2"],[9/16,"9/16"],[5/8,"5/8"],[3/4,"3/4"],[7/8,"7/8"],
  [1,"1"],[1.25,"1-1/4"],[1.5,"1-1/2"],
];

function fmtFrac(d: number | null, decimals = 4) {
  if (d == null) return "—";
  for (const [val, label] of FRAC_MAP) {
    if (Math.abs(d - val) < 0.0002) return `${label}" (${d.toFixed(decimals)})`;
  }
  return `${d.toFixed(decimals)}"`;
}

function fmtDia(d: number | null) { return fmtFrac(d, 4); }

// Decimal-first format for lengths: .5000 (1/2")
function fmtLen(d: number | null, decimals = 4) {
  if (d == null) return "—";
  for (const [val, label] of FRAC_MAP) {
    if (Math.abs(d - val) < 0.0002) return `${d.toFixed(decimals)} (${label}")`;
  }
  return `${d.toFixed(decimals)}"`;
}

function fmtCorner(c: string | number | null) {
  if (c == null || c === "") return "—";
  if (c === "square") return "Square";
  if (c === "ball") return "Ball";
  const n = parseFloat(String(c));
  if (!isNaN(n) && n > 0) return `.${String(n.toFixed(3)).split(".")[1]} Radius`;
  return String(c);
}

// ── Tooltip hint ─────────────────────────────────────────────────────────────
function Hint({ text, diagram }: { text: React.ReactNode; diagram?: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help text-muted-foreground hover:text-foreground transition-colors text-[11px]">ⓘ</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-xs space-y-1.5">
          {diagram && <div className="flex justify-center">{diagram}</div>}
          <div>{text}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Inline SVG diagrams for hints ─────────────────────────────────────────────
const DiagramCornerRadius = () => (
  <div style={{ display: "inline-block", textAlign: "center" }}>
  {/* top-down view: left wall vertical, bottom wall horizontal, large part corner R */}
  {/* Part R=48, center=(66,52). Tool r=11, tangent to left wall (x=18), coming down */}
  <svg width="150" height="125" viewBox="0 0 150 125" style={{ display: "block" }}>
    {/* Part material */}
    <path d="M0,0 L150,0 L150,125 L0,125 Z" fill="#374151"/>
    {/* Pocket: left wall x=18, bottom wall y=100, corner R=48, center=(66,52) */}
    {/* Arc from (18,52) to (66,100) — quarter circle */}
    <path d="M18,0 L150,0 L150,100 L66,100 A48,48 0 0,1 18,52 Z" fill="#111827"/>
    {/* Wall inner edges */}
    <line x1="18" y1="0" x2="18" y2="52" stroke="#6b7280" strokeWidth="1"/>
    <line x1="66" y1="100" x2="150" y2="100" stroke="#6b7280" strokeWidth="1"/>
    {/* Part corner arc — bright blue, thick, the hero of the diagram */}
    <path d="M18,52 A48,48 0 0,0 66,100" stroke="#60a5fa" fill="none" strokeWidth="2.5"/>
    {/* R dimension line: center(66,52) → arc midpoint(32,86) at 45° into corner */}
    <line x1="66" y1="52" x2="35" y2="83" stroke="#60a5fa" strokeWidth="1.2"/>
    {/* Arrowhead pointing SW at 45° */}
    <polygon points="32,86 40,82 36,78" fill="#60a5fa"/>
    {/* Arc center dot */}
    <circle cx="66" cy="52" r="2" fill="#60a5fa"/>
    {/* R label — offset to right of diagonal line */}
    <text x="62" y="68" fill="#60a5fa" fontSize="13" fontFamily="monospace" fontWeight="bold">R</text>
    <text x="57" y="78" fill="#60a5fa" fontSize="7">← enter this</text>
    {/* Tool: r=11, OD tangent to left wall means center x=18+11=29 */}
    {/* Position coming down wall, center y=22 */}
    <circle cx="29" cy="22" r="11" fill="rgba(251,191,36,0.12)" stroke="#f59e0b" strokeWidth="1.5"/>
    {/* Flute cross-hairs */}
    <line x1="29" y1="11" x2="29" y2="33" stroke="#f59e0b" strokeWidth="0.6" opacity="0.5"/>
    <line x1="18" y1="22" x2="40" y2="22" stroke="#f59e0b" strokeWidth="0.6" opacity="0.5"/>
    <circle cx="29" cy="22" r="1.5" fill="#f59e0b"/>
    {/* Motion arrow — straight down from tool OD */}
    <line x1="29" y1="35" x2="29" y2="47" stroke="#f59e0b" strokeWidth="1.4" strokeDasharray="2,1.5"/>
    <polygon points="29,51 26,44 32,44" fill="#f59e0b"/>
    {/* Wall labels */}
    <text x="3" y="32" fill="#9ca3af" fontSize="7" transform="rotate(-90,8,32)">wall</text>
    <text x="100" y="114" fill="#9ca3af" fontSize="7">wall</text>
  </svg>
  <div style={{ fontSize: 7, color: "#94a3b8", marginTop: 2 }}>top-down view — tool OD tangent to wall</div>
  </div>
);

const DiagramFloorRadius = () => (
  <div style={{ display: "inline-block", textAlign: "center" }}>
  {/* Side view: large endmill, small floor-to-wall R */}
  <svg width="150" height="130" viewBox="0 0 150 130" style={{ display: "block" }}>
    {/* Part material */}
    <rect x="0" y="0" width="150" height="130" fill="#374151"/>
    {/* Pocket: floor y=102, wall x=112, arc R=12, center=(112,102) */}
    <path d="M0,0 L112,0 L112,90 A12,12 0 0,1 100,102 L0,102 Z" fill="#111827"/>
    {/* Wall inner edge */}
    <line x1="112" y1="0" x2="112" y2="90" stroke="#6b7280" strokeWidth="1"/>
    {/* Floor inner edge */}
    <line x1="0" y1="102" x2="100" y2="102" stroke="#6b7280" strokeWidth="1"/>
    {/* Floor-to-wall blend arc — bright blue, small */}
    <path d="M100,102 A12,12 0 0,0 112,90" stroke="#60a5fa" fill="none" strokeWidth="2.5"/>
    {/* Arc center dot */}
    <circle cx="112" cy="102" r="2" fill="#60a5fa"/>
    {/* R line at 45° from center(112,102) to arc midpoint(112-8.5,102-8.5)=(103.5,93.5) */}
    <line x1="112" y1="102" x2="104" y2="94" stroke="#60a5fa" strokeWidth="1.2"/>
    <polygon points="103,93 109,93 106,99" fill="#60a5fa"/>
    {/* R label offset to right */}
    <text x="114" y="96" fill="#60a5fa" fontSize="11" fontFamily="monospace" fontWeight="bold">R</text>
    <text x="110" y="105" fill="#60a5fa" fontSize="6.5">← enter this</text>
    {/* Tool body tangent to floor (y=102), corner radius tip */}
    <path d="M25,0 L25,96 A6,6 0 0,0 31,102 L57,102 A6,6 0 0,0 63,96 L63,0 Z"
          fill="#4b5563" stroke="#f59e0b" strokeWidth="1.5"/>
    {/* Flute lines */}
    <line x1="33" y1="0" x2="33" y2="95" stroke="#f59e0b" strokeWidth="0.6" opacity="0.4"/>
    <line x1="44" y1="0" x2="44" y2="95" stroke="#f59e0b" strokeWidth="0.6" opacity="0.4"/>
    <line x1="55" y1="0" x2="55" y2="95" stroke="#f59e0b" strokeWidth="0.6" opacity="0.4"/>
    {/* CR label pointing to corner radius */}
    <line x1="63" y1="96" x2="74" y2="86" stroke="#f59e0b" strokeWidth="0.8"/>
    <text x="75" y="85" fill="#f59e0b" fontSize="7" fontFamily="monospace">CR</text>
    {/* Wall label */}
    <text x="116" y="40" fill="#9ca3af" fontSize="7">wall</text>
    {/* Floor label */}
    <text x="18" y="116" fill="#9ca3af" fontSize="7">floor</text>
  </svg>
  <div style={{ fontSize: 7, color: "#94a3b8", marginTop: 2 }}>side view — floor-to-wall blend</div>
  </div>
);

const DiagramAxialDepth = () => (
  <svg width="130" height="115" viewBox="0 0 130 115" style={{ display: "block" }}>
    {/* Part pocket walls */}
    <rect x="10" y="0"  width="18" height="100" fill="#374151" stroke="#6b7280" strokeWidth="1"/>
    <rect x="102" y="0" width="18" height="100" fill="#374151" stroke="#6b7280" strokeWidth="1"/>
    {/* Pocket floor */}
    <rect x="10" y="95" width="110" height="8" fill="#374151" stroke="#6b7280" strokeWidth="1"/>
    {/* Pocket cavity */}
    <rect x="28" y="0" width="74" height="95" fill="#111827"/>
    {/* Tool shank */}
    <rect x="53" y="0" width="24" height="25" fill="#4b5563" stroke="#9ca3af" strokeWidth="1"/>
    {/* Tool flutes (LOC) */}
    <rect x="55" y="25" width="20" height="45" fill="#374151" stroke="#f59e0b" strokeWidth="1.2"/>
    {/* Flute detail */}
    <line x1="60" y1="25" x2="60" y2="70" stroke="#f59e0b" strokeWidth="0.4" opacity="0.5"/>
    <line x1="65" y1="25" x2="65" y2="70" stroke="#f59e0b" strokeWidth="0.4" opacity="0.5"/>
    <line x1="70" y1="25" x2="70" y2="70" stroke="#f59e0b" strokeWidth="0.4" opacity="0.5"/>
    {/* Tool tip */}
    <polygon points="55,70 65,75 75,70" fill="#f59e0b"/>
    {/* Axial depth arrow — surface to tip */}
    <line x1="85" y1="0"  x2="85" y2="75" stroke="#60a5fa" strokeWidth="1.2"/>
    <polygon points="85,75 82,68 88,68" fill="#60a5fa"/>
    <polygon points="85,0 82,7 88,7" fill="#60a5fa"/>
    <text x="88" y="40" fill="#60a5fa" fontSize="8" fontFamily="monospace">DOC</text>
    {/* LOC brace */}
    <line x1="42" y1="25" x2="42" y2="70" stroke="#a78bfa" strokeWidth="1"/>
    <line x1="39" y1="25" x2="45" y2="25" stroke="#a78bfa" strokeWidth="1"/>
    <line x1="39" y1="70" x2="45" y2="70" stroke="#a78bfa" strokeWidth="1"/>
    <text x="25" y="50" fill="#a78bfa" fontSize="7" fontFamily="monospace">LOC</text>
    {/* Label — LOC must be >= DOC */}
    <text x="10" y="110" fill="#94a3b8" fontSize="7">LOC must be ≥ axial depth</text>
  </svg>
);

// ── Single-select with chip display ──────────────────────────────────────────
function SingleSelect<T extends string | number>({
  placeholder, options, value, onChange, fmt,
}: {
  placeholder: string;
  options: T[];
  value: T | null;
  onChange: (v: T | null) => void;
  fmt?: (v: T) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const f = fmt ?? String;

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen(o => !o)}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm flex flex-wrap items-center gap-1 min-h-[38px] cursor-pointer"
      >
        {value == null
          ? <span className="text-muted-foreground px-1 py-0.5 text-sm flex-1">{placeholder}</span>
          : <span className="inline-flex items-center gap-1 rounded border border-orange-400 bg-orange-50 dark:bg-orange-950 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
              {f(value)}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onChange(null); }}
                className="hover:text-orange-900 dark:hover:text-orange-100 leading-none"
              >×</button>
            </span>
        }
        <span className="text-muted-foreground text-xs ml-auto flex-shrink-0 px-1">{open ? "▴" : "▾"}</span>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-52 overflow-y-auto">
          {(options ?? []).length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No options available</div>
          )}
          {(options ?? []).map(opt => (
            <div
              key={String(opt)}
              onClick={() => { onChange(opt); setOpen(false); }}
              className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-accent ${value === opt ? "font-semibold text-orange-600" : ""}`}
            >
              {f(opt)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Simple multi-select dropdown ─────────────────────────────────────────────
function MultiSelect<T extends string | number>({
  placeholder, options, selected, onChange, fmt,
}: {
  placeholder: string;
  options: T[];
  selected: T[];
  onChange: (v: T[]) => void;
  fmt?: (v: T) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const f = fmt ?? String;

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const safeOptions = options ?? [];

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen(o => !o)}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm flex flex-wrap items-center gap-1 min-h-[38px] cursor-pointer"
      >
        {selected.length === 0
          ? <span className="text-muted-foreground px-1 py-0.5 text-sm flex-1">{placeholder}</span>
          : selected.map(opt => (
            <span key={String(opt)} className="inline-flex items-center gap-1 rounded border border-orange-400 bg-orange-50 dark:bg-orange-950 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
              {f(opt)}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onChange(selected.filter(v => v !== opt)); }}
                className="hover:text-orange-900 dark:hover:text-orange-100 leading-none"
              >×</button>
            </span>
          ))
        }
        <span className="text-muted-foreground text-xs ml-auto flex-shrink-0 px-1">{open ? "▴" : "▾"}</span>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-52 overflow-y-auto">
          {safeOptions.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No options available</div>
          )}
          {safeOptions.map(opt => (
            <label
              key={String(opt)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent"
            >
              <input
                type="checkbox"
                className="accent-orange-500"
                checked={selected.includes(opt)}
                onChange={() => {
                  if (selected.includes(opt)) onChange(selected.filter(v => v !== opt));
                  else onChange([...selected, opt]);
                  setOpen(false);
                }}
              />
              <span>{f(opt)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quick Pick wizard ─────────────────────────────────────────────────────────
const QP_MATERIALS = [
  { value: "p", label: "Steel / Alloy Steel",        emoji: "⚙️" },
  { value: "m", label: "Stainless Steel",             emoji: "🔩" },
  { value: "k", label: "Cast Iron",                   emoji: "🏭" },
  { value: "n", label: "Aluminum / Non-Ferrous",      emoji: "✈️" },
  { value: "s", label: "Titanium / Superalloys",      emoji: "🚀" },
  { value: "h", label: "Hardened Steel",              emoji: "💎" },
];

const QP_OPERATIONS = [
  { value: "hem",         label: "Roughing — HEM",                        desc: "High-efficiency / Trochoidal / Dynamic / Adaptive — low-WOC deep passes", geo: "chipbreaker", toolType: "endmill" },
  { value: "traditional", label: "Roughing — Traditional",                desc: "Standard side milling and full-width roughing",                           geo: "standard",    toolType: "endmill" },
  { value: "finish",      label: "Finishing",                             desc: "Light cuts, tight tolerances, high surface quality",                      geo: "standard",    toolType: "endmill" },
  { value: "face",        label: "Facing (Planar Milling)",               desc: "Wide shallow passes across flat surfaces",                                geo: "standard",    toolType: "endmill" },
  { value: "slot",        label: "Slotting",                              desc: "Full-width slot or keyway",                                               geo: "standard",    toolType: "endmill" },
  { value: "circ_interp", label: "Circular Interpolation",                desc: "Helical or circular bore interpolation",                                  geo: "standard",    toolType: "endmill" },
  { value: "surfacing",   label: "3D Surface Contouring",                 desc: "Ball nose / bull nose — scallop and flow-line finishing",                 geo: "standard",    toolType: "endmill" },
  { value: "chamfer",     label: "Chamfering / Deburring",                desc: "Edge break and chamfer",                                                  geo: null,          toolType: "chamfer_mill" },
];

const QP_DIAMETERS: { label: string; min: number; max: number; pick: number }[] = [
  { label: 'Small  (≤ 1/4")',    min: 0,    max: 0.251, pick: 0.25  },
  { label: 'Medium (5/16"–1/2")',min: 0.251,max: 0.501, pick: 0.5   },
  { label: 'Large  (> 1/2")',    min: 0.501,max: 99,    pick: 0.75  },
];

const QP_DOCS = [
  { label: "Shallow  (< 0.5×D)", desc: "Finishing, spring passes, skim cuts",      docXd: 0.4 },
  { label: "Standard (0.5–1.5×D)", desc: "General roughing and semi-finishing",    docXd: 1.0 },
  { label: "Deep     (> 1.5×D)", desc: "HEM/trochoidal roughing · Slotting requires reduced neck tool", docXd: 2.0 },
];

function QuickPick({ onApply, onOperationPick, onClear, applied, summary }: {
  onApply: (mat: string, toolType: string, geo: string | null, diaRange: { min: number; max: number }, minLoc: number | null, summary: string[], mode: string, minLbs?: number | null, docXd?: number | null) => void;
  onOperationPick: (toolType: string) => void;
  onClear: () => void;
  applied: boolean;
  summary?: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [mat,  setMat]  = React.useState<string | null>(null);
  const [op,   setOp]   = React.useState<typeof QP_OPERATIONS[0] | null>(null);
  const [dia,  setDia]  = React.useState<typeof QP_DIAMETERS[0] | null>(null);

  function reset(clearAll = false) { setStep(0); setMat(null); setOp(null); setDia(null); if (clearAll) { onOperationPick(""); onClear(); } }

  function apply(d: typeof QP_DIAMETERS[0], docXd: number | null, docLabel?: string) {
    if (!mat || !op) return;
    // If DOC is shallow, chipbreaker/VXR won't engage — downgrade to standard
    let geo = op.geo;
    if (docXd !== null && docXd < 1.0 && (geo === "chipbreaker" || geo === "truncated_rougher")) {
      geo = "standard";
    }
    const isDeepSlot = op.value === "slot" && docXd !== null && docXd > 1.0;
    const minLoc = (isDeepSlot || docXd === null || d.pick <= 0) ? null : docXd * d.pick;
    const minLbs = isDeepSlot && docXd !== null && d.pick > 0 ? docXd * d.pick : null;
    const matLabel = QP_MATERIALS.find(m => m.value === mat)?.label ?? mat;
    const depthLabel = isDeepSlot ? "Deep Slot (RN tool)" : docLabel;
    const summary = [
      matLabel,
      op.toolType === "endmill" ? "Endmill" : "Chamfer Mill",
      op.label,
      `Cut Dia (${d.label.trim().replace(/[()]/g, "").replace(/\s+/g, " ").trim()})`,
      ...(depthLabel ? [`Cut Depth (${depthLabel.trim()})`] : []),
    ];
    onApply(mat, op.toolType, geo, { min: d.min, max: d.max }, minLoc, summary, op.value, minLbs, docXd);
    setOpen(false);
    reset();
  }

  const isChamfer = op?.toolType === "chamfer_mill";
  const stepLabels = isChamfer ? ["Material", "Operation", "Diameter"] : ["Material", "Operation", "Diameter", "Depth of Cut"];

  return (
    <div className="rounded-xl border border-yellow-400/50 bg-yellow-400/5 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-yellow-400 p-1.5 text-white text-base leading-none">⚡</span>
          <div>
            <h2 className="font-bold text-base leading-tight">Quick Pick</h2>
            {applied && !open && summary && summary.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {summary.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setOpen(true)}
                    className="rounded border border-yellow-400/50 bg-yellow-400/10 px-2 py-0.5 text-[11px] text-yellow-200 font-medium hover:bg-yellow-400/25 hover:border-yellow-400 transition-colors"
                    title="Click to change Quick Pick selections"
                  >
                    {s} ✏
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-yellow-400/80">{applied ? "Filters applied — refine below or start over" : "Answer 3 questions — we'll set the filters for you"}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(o => !o); if (open) reset(true); }}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors border-2 ${
            open
              ? "border-yellow-500 bg-yellow-400 text-zinc-900"
              : "border-yellow-400/60 bg-background text-yellow-400 hover:bg-yellow-400 hover:text-zinc-900"
          }`}
        >
          {open ? "✕ Close" : applied ? "✓ Applied" : "Help me choose →"}
        </button>
      </div>


      {open && (
        <div className="mt-4 space-y-4">
          {/* step breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {stepLabels.map((l, i) => (
              <React.Fragment key={l}>
                <span className={`font-semibold ${i === step ? "text-yellow-400" : i < step ? "text-emerald-400" : ""}`}>
                  {i < step ? "✓ " : ""}{l}
                </span>
                {i < stepLabels.length - 1 && <span className="text-muted-foreground/40">›</span>}
              </React.Fragment>
            ))}
          </div>

          {/* Step 0 — Material */}
          {step === 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">What material are you cutting?</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {QP_MATERIALS.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => { setMat(m.value); setStep(1); }}
                    className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-left hover:border-yellow-400 hover:bg-yellow-400/10 transition-colors"
                  >
                    <span>{m.emoji}</span>
                    <span className="font-medium leading-tight">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 — Operation */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">What type of operation?</p>
              {(["endmill", "chamfer_mill"] as const).map(tt => {
                const ops = QP_OPERATIONS.filter(o => o.toolType === tt);
                return (
                  <div key={tt}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-bold uppercase tracking-widest text-yellow-400">
                        {tt === "endmill" ? "Endmill" : "Chamfer Mill"}
                      </span>
                      <div className="flex-1 h-px bg-yellow-400/30" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ops.map(o => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => { setOp(o); setStep(2); onOperationPick(o.toolType); }}
                          className="flex flex-col rounded-lg border border-border bg-background px-3 py-2.5 text-left hover:border-yellow-400 hover:bg-yellow-400/10 transition-colors"
                        >
                          <span className="text-sm font-semibold">{o.label}</span>
                          <span className="text-xs text-muted-foreground mt-0.5">{o.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={() => { setStep(0); setOp(null); onOperationPick(""); onClear(); }} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
            </div>
          )}

          {/* Step 2 — Diameter */}
          {step === 2 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Approximate tool diameter?</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {QP_DIAMETERS.map(d => (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => {
                      setDia(d);
                      if (isChamfer) apply(d, null, undefined);
                      else setStep(3);
                    }}
                    className="flex items-center justify-center rounded-lg border border-border bg-background px-3 py-3 text-sm font-semibold hover:border-yellow-400 hover:bg-yellow-400/10 transition-colors text-center"
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setStep(1)} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
            </div>
          )}

          {/* Step 3 — Depth of Cut */}
          {step === 3 && dia && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">How deep are you cutting?</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {QP_DOCS.map(d => (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => apply(dia, d.docXd, d.label)}
                    className="flex flex-col items-center rounded-lg border border-border bg-background px-3 py-3 text-sm hover:border-yellow-400 hover:bg-yellow-400/10 transition-colors text-center"
                  >
                    <span className="font-semibold">{d.label}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">{d.desc}</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setStep(2)} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Tool Finder component ────────────────────────────────────────────────
export default function ToolFinder({ onSelectTool }: { onSelectTool: (tool: SkuRow, extras?: { mode?: string; isoMat?: string }) => void }) {
  const EMPTY_OPTIONS: Options = {
    toolTypes: [], diameters: [], locs: [], lbsLengths: [], flutes: [], coatings: [], corners: [], geometries: [], chamferLengths: [], chamferAngles: [], tipDiameters: [], series: [], centerCuttingVals: [],
  };
  const [options, setOptions] = React.useState<Options>(EMPTY_OPTIONS);
  const [loadingOpts, setLoadingOpts] = React.useState(true);

  const [selToolTypes, setSelToolTypes]   = React.useState<string[]>([]);
  const [material, setMaterial]         = React.useState("all");
  const [selFlutes, setSelFlutes]       = React.useState<number[]>([]);
  const [selDias, setSelDias]           = React.useState<number[]>([]);
  const [selLoc, setSelLoc]             = React.useState("");
  const [excludeLbs, setExcludeLbs]     = React.useState(false);
  const [selLbs, setSelLbs]             = React.useState("");
  const [selCorners, setSelCorners]       = React.useState<string[]>([]);
  const [selCoatings, setSelCoatings]     = React.useState<string[]>([]);
  const [centerCutting, setCenterCutting] = React.useState("all");
  const [selGeometries, setSelGeometries] = React.useState<string[]>([]);
  const [selChamferLengths, setSelChamferLengths] = React.useState<number[]>([]);
  const [reqChamferLength, setReqChamferLength]   = React.useState("");
  const [axialDepth, setAxialDepth]               = React.useState("");
  const [partCornerRadius, setPartCornerRadius]   = React.useState("");
  const [maxFloorRadius, setMaxFloorRadius]       = React.useState("");
  const [selChamferAngles, setSelChamferAngles]   = React.useState<number[]>([]);
  const [selTipDiameters, setSelTipDiameters]     = React.useState<number[]>([]);
  const [chamferFluteStyle, setChamferFluteStyle] = React.useState<"" | "helical" | "straight">("");
  const [selSeries, setSelSeries]                 = React.useState<string[]>([]);

  const [results, setResults]   = React.useState<SkuRow[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchErr, setSearchErr] = React.useState<string | null>(null);

  // ── Email gate ─────────────────────────────────────────────────────────
  const [tfGateOpen, setTfGateOpen] = React.useState(false);
  const [tfGateStpUrl, setTfGateStpUrl] = React.useState("");
  const [tfGateInput, setTfGateInput] = React.useState(() => localStorage.getItem("er_email") || "");
  const [tfGateError, setTfGateError] = React.useState("");

  function tfRequireStp(url: string) {
    const email = localStorage.getItem("er_email") || "";
    if (email) { window.open(url, "_blank"); return; }
    setTfGateStpUrl(url);
    setTfGateOpen(true);
  }

  // ── Contact modal ───────────────────────────────────────────────────────
  const [showTfContact, setShowTfContact] = React.useState(false);
  const [tfContactName, setTfContactName] = React.useState("");
  const [tfContactEmail, setTfContactEmail] = React.useState(() => localStorage.getItem("er_email") || "");
  const [tfContactMsg, setTfContactMsg] = React.useState("");
  const [tfContactStatus, setTfContactStatus] = React.useState<"idle" | "sending" | "sent">("idle");

  async function submitTfContact() {
    if (!tfContactEmail.trim()) return;
    setTfContactStatus("sending");
    try {
      await fetch("/api/contact/tool-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tfContactName.trim(), email: tfContactEmail.trim(), message: tfContactMsg.trim() }),
      });
      localStorage.setItem("er_email", tfContactEmail.trim().toLowerCase());
      setTfContactStatus("sent");
    } catch {
      setTfContactStatus("idle");
    }
  }
  const [qpTip, setQpTip] = React.useState<{ summary: string[]; geo: string | null; mode: string; isoMat: string; docXd: number | null } | null>(null);
  const [qpDiaRange, setQpDiaRange] = React.useState<{ min: number; max: number } | null>(null);
  const [qpMinLoc,   setQpMinLoc]   = React.useState<number | null>(null);

  React.useEffect(() => {
    setLoadingOpts(true);
    const params = new URLSearchParams({ v: String(Date.now()) });
    if (selToolTypes.length === 1) params.set("tool_type", selToolTypes[0]);
    if (selDias.length > 0) params.set("diameter", selDias.join(","));
    if (material !== "all") params.set("material", material);
    if (selLbs && !excludeLbs) params.set("lbs", selLbs);
    if (partCornerRadius) params.set("part_corner_radius", partCornerRadius);
    if (maxFloorRadius)   params.set("max_floor_radius",   maxFloorRadius);
    if (axialDepth)       params.set("axial_depth",        axialDepth);
    if (qpTip) applyQpFluteParams(params);
    fetch(`/api/tools/options?${params}`)
      .then(r => r.json())
      .then((d: Options) => setOptions({
        ...d,
        diameters: d.diameters.map(Number),
        locs: (() => {
          const all = d.locs.map(Number).sort((a, b) => a - b);
          const depth = axialDepth ? parseFloat(axialDepth) : 0;
          if (!depth || isNaN(depth)) return all;
          // Only show the shortest LOC that meets the depth, plus the next one up
          const idx = all.findIndex(l => l >= depth);
          if (idx === -1) return all;
          return all.slice(idx, idx + 2);
        })(),
        lbsLengths: (() => {
          const all = (d.lbsLengths ?? []).map(Number).filter(n => n > 0).sort((a, b) => a - b);
          const depth = axialDepth ? parseFloat(axialDepth) : 0;
          if (!depth || isNaN(depth)) return all;
          const idx = all.findIndex(l => l >= depth);
          if (idx === -1) return all;
          return all.slice(idx, idx + 2);
        })(),
        flutes: d.flutes.map(Number),
        chamferLengths: (d.chamferLengths ?? []).map(Number),
        chamferAngles: (d.chamferAngles ?? []).map(Number),
        tipDiameters: (d.tipDiameters ?? []).map(Number),
        corners: [...(d.corners ?? [])]
          .filter(c => c === "square" || c === "ball" || VALID_CR.includes(parseFloat(c)))
          .sort((a, b) => {
            const order: Record<string, number> = { square: 0, ball: 1 };
            const oa = order[a] ?? 2, ob = order[b] ?? 2;
            if (oa !== ob) return oa - ob;
            return parseFloat(a) - parseFloat(b);
          }),
        geometries: [...(d.geometries ?? [])].sort((a, b) => {
          const order: Record<string, number> = { standard: 0, chipbreaker: 1, truncated_rougher: 2 };
          return (order[a] ?? 9) - (order[b] ?? 9);
        }),
      }))
      .catch(() => {})
      .finally(() => setLoadingOpts(false));
  }, [selToolTypes, selDias, material, selLbs, excludeLbs, partCornerRadius, maxFloorRadius, axialDepth, qpTip]);

  // LBS tools only come in standard geometry — hide chipbreaker/truncated rougher when LBS is selected
  const lbsActive = selLbs !== "" && !excludeLbs;
  const displayedGeometries = lbsActive
    ? options.geometries.filter(g => g !== "chipbreaker" && g !== "truncated_rougher")
    : options.geometries;

  // Clear incompatible geometry selections when LBS mode toggles on
  React.useEffect(() => {
    if (lbsActive && selGeometries.some(g => g === "chipbreaker" || g === "truncated_rougher")) {
      setSelGeometries(prev => prev.filter(g => g !== "chipbreaker" && g !== "truncated_rougher"));
    }
  }, [lbsActive]); // eslint-disable-line

  const hasFilter = selToolTypes.length > 0 || material !== "all" || selFlutes.length > 0
    || selDias.length > 0 || selLoc !== "" || selCorners.length > 0
    || selCoatings.length > 0 || centerCutting !== "all" || selGeometries.length > 0
    || selChamferLengths.length > 0 || reqChamferLength !== ""
    || selChamferAngles.length > 0 || selTipDiameters.length > 0 || chamferFluteStyle !== ""
    || axialDepth !== "" || partCornerRadius !== "" || maxFloorRadius !== "" || selSeries.length > 0;

  function applyQpFluteParams(p: URLSearchParams) {
    const mode = qpTip?.mode;
    const mat  = qpTip?.isoMat; // "n"=aluminum, "p"=steel, "m"=stainless, "s"=superalloy, "h"=hardened, "k"=cast iron
    const isAlum = mat === "n";
    const isHardened = mat === "h";
    const isFerrous = mat && mat !== "n";
    if (mode === "slot") {
      const docXd = qpTip?.docXd ?? null;
      if (isAlum) {
        // Non-ferrous slotting: 2–3 flute only for chip evacuation
        p.set("min_flutes", "2");
        p.set("max_flutes", "3");
      } else if (docXd !== null && docXd > 1.5) {
        // Deep ferrous slotting (> 1.5×D): 4-flute only — 5-flute chips pack at depth
        p.set("min_flutes", "4");
        p.set("max_flutes", "4");
      } else {
        // Ferrous slotting shallow/standard: 4–5 flute; 5-flute capped at 0.625" LOC
        p.set("min_flutes", "4");
        p.set("max_flutes", "5");
        p.set("flute5_max_loc", "shortest");
      }
    } else if (isHardened) {
      // Hardened ≥50 HRC — 6+ flutes required for all non-slot operations
      p.set("min_flutes", "6");
    } else if (mode === "hem") {
      if (isAlum)    { p.set("min_flutes", "3"); p.set("max_flutes", "3"); }
      else if (isFerrous) { p.set("min_flutes", "5"); }
    } else if (mode === "traditional") {
      if (isAlum)    { p.set("min_flutes", "2"); p.set("max_flutes", "3"); }
      else if (isFerrous) { p.set("min_flutes", "4"); p.set("max_flutes", "5"); }
    }
  }

  async function handleSearch(diaRangeOverride?: { min: number; max: number }) {
    setSearching(true);
    setSearchErr(null);
    try {
      const p = new URLSearchParams();
      if (selToolTypes.length)       p.set("tool_type",     selToolTypes.join(","));
      if (material    !== "all") p.set("material",      material);
      if (selSeries.length)          p.set("series",        selSeries.join(","));
      if (chamferFluteStyle === "helical") p.set("flutes", "3,5");
      else if (chamferFluteStyle === "straight") p.set("flutes", "2,4");
      else if (selFlutes.length) p.set("flutes", selFlutes.join(","));
      if (diaRangeOverride) {
        p.set("dia_min", String(diaRangeOverride.min));
        p.set("dia_max", String(diaRangeOverride.max));
      } else if (selDias.length) p.set("diameter", selDias.join(","));
      if (selLoc)                p.set("loc",           selLoc);
      if (excludeLbs)            p.set("lbs_exclude",   "true");
      if (selLbs && !excludeLbs) p.set("lbs",           selLbs);
      if (selCorners.length)     p.set("corner",        selCorners.join(","));
      if (selCoatings.length)      p.set("coating",        selCoatings.join(","));
      if (centerCutting !== "all") p.set("center_cutting", centerCutting);
      if (selGeometries.length)    p.set("geometry",       selGeometries.join(","));
      if (selChamferAngles.length)   p.set("chamfer_angle",            selChamferAngles.join(","));
      if (selTipDiameters.length)    p.set("tip_diameter",             selTipDiameters.join(","));
      if (selChamferLengths.length)  p.set("chamfer_lengths",          selChamferLengths.join(","));
      else if (reqChamferLength)     p.set("required_chamfer_length",  reqChamferLength);
      if (axialDepth)       p.set("axial_depth",       axialDepth);
      if (maxFloorRadius)   p.set("max_floor_radius",  maxFloorRadius);
      if (qpTip) applyQpFluteParams(p);
      if (partCornerRadius) {
        p.set("part_corner_radius", partCornerRadius);
        // Corner radius caps the max tool diameter: tool must fit inside the corner
        const crMax = parseFloat(partCornerRadius) * 2;
        if (!isNaN(crMax) && crMax > 0) p.set("dia_max", String(crMax));
      }

      const r = await fetch(`/api/tools/search?${p}`);
      const data = await r.json();
      if (!r.ok) setSearchErr(data.message ?? "Search failed");
      else {
        let sorted = [...data];
        if (selChamferLengths.length || reqChamferLength) {
          sorted.sort((a: SkuRow, b: SkuRow) =>
            (Number(a.max_cutting_edge_length) || 0) - (Number(b.max_cutting_edge_length) || 0));
        } else if (partCornerRadius) {
          // Sort largest diameter first — closest tool that still fits the corner
          sorted.sort((a: SkuRow, b: SkuRow) =>
            (Number(b.cutting_diameter_in) || 0) - (Number(a.cutting_diameter_in) || 0));
        }
        setResults(sorted);
      }
    } catch {
      setSearchErr("Search failed — check server connection");
    } finally {
      setSearching(false);
    }
  }

  const resultsRef = React.useRef<HTMLDivElement>(null);

  async function applyQuickPick(
    mat: string,
    toolType: string,
    geo: string | null,
    diaRange: { min: number; max: number },
    minLoc: number | null,
    summary: string[],
    mode: string,
    minLbs?: number | null,
    docXd?: number | null,
  ) {
    // Update visible filter state so the filter panel reflects what was picked
    setMaterial(mat);
    setSelToolTypes([toolType]);
    setSelFlutes([]); setSelDias([]); setSelLoc(""); setSelLbs(""); setExcludeLbs(false);
    setSelCorners([]); setSelCoatings([]); setCenterCutting("all"); setSelSeries([]);
    setSelChamferAngles([]); setSelTipDiameters([]); setSelChamferLengths([]);
    setReqChamferLength(""); setAxialDepth(""); setPartCornerRadius(""); setChamferFluteStyle("");
    setSelGeometries([]); // don't pre-filter by geometry — show all, recommend below
    setQpDiaRange(diaRange);
    setQpMinLoc(minLoc);
    if (minLbs != null && minLbs > 0) { setSelLbs(String(minLbs)); setExcludeLbs(false); }
    // Do NOT auto-fill axial depth from Quick Pick — user should enter their specific depth
    setAxialDepth("");
    setPartCornerRadius("");

    const GEO_LABELS: Record<string, string> = {
      chipbreaker: "Chipbreaker (CB)",
      truncated_rougher: "Truncated Rougher (VXR)",
      standard: "Standard",
    };
    setQpTip({ summary, geo: geo ? (GEO_LABELS[geo] ?? geo) : null, mode, isoMat: mat, docXd: docXd ?? null });

    // Run search directly with the known params (avoids waiting for state to settle)
    setSearching(true);
    setSearchErr(null);
    setResults(null);
    try {
      // Fetch available diameters for this tool type + material, then filter to range
      const optParams = new URLSearchParams({ v: String(Date.now()), tool_type: toolType, material: mat });
      const optRes = await fetch(`/api/tools/options?${optParams}`);
      const optData = await optRes.json();
      const diasInRange: number[] = ((optData.diameters ?? []) as number[])
        .map(Number)
        .filter(d => d >= diaRange.min && d < diaRange.max);

      // Push diameters into filter state — this triggers the options useEffect which
      // cascades DIA_FILTER to all other dropdowns (corners, LOC, flutes, geometry, etc.)
      if (diasInRange.length > 0) setSelDias(diasInRange);

      const p = new URLSearchParams();
      p.set("tool_type", toolType);
      p.set("material", mat);
      // geometry intentionally not filtered — show all options, tip guides the user
      if (diasInRange.length > 0) p.set("diameter", diasInRange.join(","));
      else { p.set("dia_min", String(diaRange.min)); p.set("dia_max", String(diaRange.max)); }
      if (minLoc != null) p.set("min_loc", String(minLoc));
      if (minLbs != null) p.set("lbs", String(minLbs));
      // Apply flute constraints for this mode/material directly (qpTip state not yet settled)
      if (mode === "slot") {
        const isAlumQp = mat === "n";
        if (isAlumQp) { p.set("min_flutes", "2"); p.set("max_flutes", "3"); }
        else if (docXd != null && docXd > 1.5) { p.set("min_flutes", "4"); p.set("max_flutes", "4"); }
        else { p.set("min_flutes", "4"); p.set("max_flutes", "5"); p.set("flute5_max_loc", "shortest"); }
      } else if (mat === "h") {
        p.set("min_flutes", "6");
      } else if (mode === "hem") {
        if (mat === "n") { p.set("min_flutes", "3"); p.set("max_flutes", "3"); }
        else if (mat && mat !== "n") p.set("min_flutes", "5");
      } else if (mode === "traditional") {
        if (mat === "n") { p.set("min_flutes", "2"); p.set("max_flutes", "3"); }
        else if (mat && mat !== "n") { p.set("min_flutes", "4"); p.set("max_flutes", "5"); }
      }
      const r = await fetch(`/api/tools/search?${p}`);
      const data = await r.json();
      if (!r.ok) setSearchErr(data.message ?? "Search failed");
      else setResults(data);
    } catch {
      setSearchErr("Search failed — check server connection");
    } finally {
      setSearching(false);
    }
  }

  function clearAll() {
    setSelToolTypes([]); setMaterial("all"); setSelFlutes([]); setSelDias([]);
    setSelLoc(""); setSelLbs(""); setExcludeLbs(false); setSelCorners([]); setSelCoatings([]);
    setCenterCutting("all"); setSelGeometries([]); setSelChamferLengths([]); setReqChamferLength("");
    setSelChamferAngles([]); setSelTipDiameters([]); setChamferFluteStyle("");
    setAxialDepth(""); setPartCornerRadius(""); setSelSeries([]);
    setResults(null); setSearchErr(null); setQpTip(null);
    setQpDiaRange(null); setQpMinLoc(null);
  }

  return (
    <>
    <div className="space-y-4">

      {/* ── Quick Pick ── */}
      <QuickPick
        onApply={applyQuickPick}
        summary={qpTip?.summary}
        onOperationPick={tt => { if (tt) setSelToolTypes([tt]); else setSelToolTypes([]); }}
        onClear={() => {
          setQpTip(null);
          setSelToolTypes([]);
          setSelDias([]);
          setMaterial("all");
          setSelFlutes([]); setSelLoc(""); setSelLbs(""); setExcludeLbs(false);
          setSelCorners([]); setSelCoatings([]); setCenterCutting("all");
          setSelGeometries([]); setSelSeries([]);
          setAxialDepth(""); setPartCornerRadius(""); setMaxFloorRadius("");
          setResults(null); setSearchErr(null);
        }}
        applied={qpTip !== null}
      />

      {/* ── Filter card ── */}
      <div className="rounded-xl border bg-card p-4 space-y-4">




        {/* Product Category — single centered row */}
        <div className="flex items-center justify-center gap-3 py-4 border-b border-border flex-wrap">
          <label className="text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
            <span className="rounded bg-blue-500 px-1 py-0.5 text-[9px] font-bold text-white leading-tight">REQ</span>
            Product Category
            <Hint text="Endmills: square, ballnose, corner radius. Chamfer mills: angled edge for deburring and chamfering." />
          </label>
          <div className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all ${
            selToolTypes.length === 0
              ? "border-2 border-yellow-400 bg-yellow-400/5 animate-pulse"
              : "border-2 border-transparent"
          }`}>
            {(["endmill", "chamfer_mill"] as const).map(t => {
              const active = selToolTypes.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setSelToolTypes(active ? [] : [t]);
                    setResults(null); setSearchErr(null);
                    setMaterial("all"); setSelFlutes([]); setSelDias([]); setSelLoc("");
                    setSelLbs(""); setExcludeLbs(false); setSelCorners([]); setSelCoatings([]);
                    setCenterCutting("all"); setSelGeometries([]); setSelSeries([]);
                    setSelChamferAngles([]); setSelTipDiameters([]); setChamferFluteStyle("");
                    setSelChamferLengths([]); setReqChamferLength("");
                    setAxialDepth(""); setPartCornerRadius("");
                  }}
                  className={`w-36 text-center whitespace-nowrap rounded-md px-6 py-2 text-sm font-semibold border-2 transition-colors ${
                    active
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-border bg-background text-muted-foreground hover:border-blue-400 hover:text-foreground"
                  }`}
                >
                  {TOOL_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
          {selToolTypes.length === 0 && (
            <span className="text-xs text-yellow-400 font-semibold whitespace-nowrap">⚠ Select one to activate filters</span>
          )}
        </div>



        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 pt-2">
          <div className={`contents ${selToolTypes.length === 0 ? "opacity-40 pointer-events-none select-none" : ""}`}>

          {/* Cut Material */}
          <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Cut Material
              <Hint text="ISO category — P: steel, M: stainless, K: cast iron, N: aluminum, S: superalloys/titanium, H: hardened steel." />
            </label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={material}
              onChange={e => { setMaterial(e.target.value); setSelDias([]); setSelLoc(""); setSelLbs(""); setSelFlutes([]); }}
            >
              <option value="all">All Cut Materials</option>
              {ISO_MATERIALS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Tool Series */}
          <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Tool Series
              <Hint text="Filter by product series (e.g. VST5, VXR, CMH120). Useful when you already know which line you want." />
            </label>
            <MultiSelect
              placeholder="All series..."
              options={options.series}
              selected={selSeries}
              onChange={setSelSeries}
            />
          </div>

          {/* Cut Diameter */}
          <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Cut Diameter
              <Hint text="The cutting diameter." />
            </label>
            <SingleSelect
              placeholder={qpTip && selDias.length > 1 ? `${selDias.length} sizes from Quick Pick — pick one to narrow` : "Select a diameter..."}
              options={qpTip && selDias.length > 1 ? selDias : options.diameters}
              value={selDias.length === 1 ? selDias[0] : null}
              onChange={v => { setSelDias(v != null ? [v] : []); setSelLoc(""); setSelLbs(""); setSelFlutes([]); }}
              fmt={v => fmtDia(v as number)}
            />
          </div>

          {/* Chamfer Angle — chamfer mill only, right after Cut Diameter */}
          {selToolTypes[0] === "chamfer_mill" && <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Chamfer Angle (°)
              <Hint text="Half-angle of the cutting edge. 45°: standard chamfer. 60°: thread prep. 82°/90°: countersinking." />
            </label>
            <MultiSelect
              placeholder="All angles..."
              options={options.chamferAngles}
              selected={selChamferAngles}
              onChange={setSelChamferAngles}
              fmt={v => `${v}°`}
            />
          </div>}

          {/* Tip Diameter — chamfer mill only, right after Chamfer Angle */}
          {selToolTypes[0] === "chamfer_mill" && <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Tip Diameter (in)
              <Hint text="Diameter at the tool tip. Smaller tip = chamfer closer to a shoulder or in tighter spaces." />
            </label>
            <MultiSelect
              placeholder="All tip diameters..."
              options={options.tipDiameters}
              selected={selTipDiameters}
              onChange={setSelTipDiameters}
              fmt={v => fmtDia(v as number)}
            />
          </div>}

          {/* Flute Count — hidden for chamfer mills */}
          {selToolTypes[0] !== "chamfer_mill" && <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Flute Count
              <Hint text="More flutes = better finish and higher feeds. Fewer flutes = better chip evacuation for aluminum." />
            </label>
            <MultiSelect
              placeholder="Select flute counts..."
              options={options.flutes}
              selected={selFlutes}
              onChange={setSelFlutes}
              fmt={v => `${v} Flute${v !== 1 ? "s" : ""}`}
            />
          </div>}

          {/* LOC */}
          <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Length of Cut (LOC)
              <Hint text="Usable flute length. Must meet or exceed your axial depth. Longer LOC reduces rigidity." />
            </label>
            <SingleSelect
              placeholder={selDias.length !== 1 ? "Select a diameter first" : "All Lengths"}
              options={selDias.length === 1 ? options.locs : []}
              value={selLoc !== "" ? Number(selLoc) : null}
              onChange={v => setSelLoc(v != null ? String(v) : "")}
              fmt={v => fmtLen(v as number)}
            />
          </div>

          {/* LBS — hidden for chamfer mills */}
          {selToolTypes[0] !== "chamfer_mill" && <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                Length Below Shank (LBS)
                <Hint text="Reduced neck below shank for deeper reach. Short LBS lengths can be extended quickly as a modification — contact Core Cutter. Check 'Exclude LBS' for standard straight-shank tools only." />
              </span>
              <label className="flex items-center gap-1 text-[10px] font-normal cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  className="accent-orange-500"
                  checked={excludeLbs}
                  onChange={e => setExcludeLbs(e.target.checked)}
                />
                Exclude LBS tools
              </label>
            </label>
            <SingleSelect
              placeholder={selDias.length !== 1 ? "Select a diameter first" : "All LBS Lengths"}
              options={!excludeLbs && selDias.length === 1 ? options.lbsLengths : []}
              value={selLbs !== "" ? Number(selLbs) : null}
              onChange={v => setSelLbs(v != null ? String(v) : "")}
              fmt={v => fmtLen(v as number)}
            />
          </div>}

          {/* Corner Condition — hidden for chamfer mills */}
          {selToolTypes[0] !== "chamfer_mill" && <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Corner Condition
              <Hint text="Square: sharp corners. Ballnose: 3D contouring. Corner radius: added strength and better finish on shoulders." />
            </label>
            <MultiSelect
              placeholder="Select corner conditions..."
              options={options.corners}
              selected={selCorners}
              onChange={setSelCorners}
              fmt={v => fmtCorner(v)}
            />
          </div>}

          {/* Coating */}
          <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Coating
              <Hint text="AlTiN: high-temp alloys. TiN: general purpose. ZrN: aluminum/non-ferrous." />
            </label>
            <MultiSelect
              placeholder="Select coatings..."
              options={options.coatings}
              selected={selCoatings}
              onChange={setSelCoatings}
            />
          </div>

          {/* Center Cutting */}
          <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Center Cutting
              <Hint text="Center cutting: can plunge directly. Non-center cutting: requires pre-drilled hole or ramp entry." />
            </label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={centerCutting}
              onChange={e => setCenterCutting(e.target.value)}
            >
              <option value="all">All Tools</option>
              {((options.centerCuttingVals ?? []).length === 0 || (options.centerCuttingVals ?? []).includes(true)) && (
                <option value="yes">Center Cutting</option>
              )}
              {((options.centerCuttingVals ?? []).length === 0 || (options.centerCuttingVals ?? []).includes(false)) && (
                <option value="no">Non-Center Cutting</option>
              )}
            </select>
          </div>

          {/* Chipbreaker / Geometry — hidden for chamfer mills */}
          {selToolTypes[0] !== "chamfer_mill" && <div className="space-y-1">
            <label className="text-xs font-semibold flex items-center gap-1.5">
              Flute Geometry
              <Hint text="Standard: general milling. Chipbreaker: high-feed roughing (≥8% WOC, ≥1×D). Truncated Rougher: aggressive removal (≥10% WOC, ≥1×D)." />
            </label>
            <MultiSelect
              placeholder="All geometries..."
              options={displayedGeometries}
              selected={selGeometries}
              onChange={setSelGeometries}
              fmt={v => v === "chipbreaker" ? "Chipbreaker" : v === "truncated_rougher" ? "Truncated Rougher" : "Standard"}
            />
          </div>}

          {/* Final Axial Cut Depth + Part Corner Radius — endmill only, wrapped together */}
          {selToolTypes[0] !== "chamfer_mill" && (
            <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/5 p-3 space-y-3 col-span-full">
              <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">Part Feature Match</p>
              <div className="space-y-1">
                <label className="text-xs font-semibold flex items-center gap-1.5">
                  Final Axial Cut Depth (in)
                  <span className="text-[10px] font-normal text-muted-foreground italic">optional</span>
                  <Hint text="Shows only tools whose LOC (length of cut) can reach this depth — either by flute length alone or via a reduced-neck LBS extension. LOC must be ≥ axial depth." diagram={<DiagramAxialDepth />} />
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="e.g. 1.000"
                  value={axialDepth}
                  onChange={e => setAxialDepth(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                {(() => {
                  const d = parseFloat(axialDepth);
                  if (isNaN(d) || d <= 0 || !qpMinLoc) return null;
                  if (d > qpMinLoc * 1.1) return (
                    <p className="text-[11px] text-yellow-400">⚠ Exceeds Quick Pick depth selection ({qpMinLoc.toFixed(3)}") — results may not include tools with enough LOC for this depth.</p>
                  );
                  return <p className="text-[11px] text-zinc-400">Coordinated with Quick Pick depth ({qpMinLoc.toFixed(3)}" min LOC).</p>;
                })()}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold flex items-center gap-1.5">
                  Min. Part Radius — Wall to Wall (in)
                  <span className="text-[10px] font-normal text-muted-foreground italic">optional</span>
                  <Hint text="Tightest inside corner on your part. Tool diameter must be ≤ corner radius × 2 — the tool body must physically fit the corner. Largest valid tool sorts first." diagram={<DiagramCornerRadius />} />
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="e.g. 0.125"
                  value={partCornerRadius}
                  onChange={e => {
                    const val = e.target.value;
                    setPartCornerRadius(val);
                    const cr = parseFloat(val);
                    if (!isNaN(cr) && cr > 0) {
                      setSelDias(prev => prev.filter(d => d < cr * 2));
                    }
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                {(() => {
                  const cr = parseFloat(partCornerRadius);
                  if (isNaN(cr) || cr <= 0) return null;
                  // Red: only warn when a single specific diameter is chosen and radius >= that diameter
                  if (selDias.length === 1 && cr >= selDias[0]) return (
                    <p className="text-[11px] text-red-500 font-semibold">⚠ Part radius ({cr}") is ≥ selected tool diameter ({selDias[0]}") — the tool body will fit but engagement is 180° (full half-circumference) resulting in extreme chatter and possible breakage. Reduce tool diameter and use a circular toolpath to generate this radius for maximum success.</p>
                  );
                  const maxDia = cr * 2;
                  const removedByQp = qpDiaRange && qpDiaRange.min >= maxDia;
                  const someRemoved = qpDiaRange && qpDiaRange.min < maxDia && qpDiaRange.max >= maxDia;
                  if (removedByQp) return (
                    <p className="text-[11px] text-red-500 font-semibold">⚠ All Quick Pick diameters exceed this corner radius — no tools can safely fit. Increase corner radius or re-run Quick Pick with a smaller diameter range.</p>
                  );
                  if (someRemoved) return (
                    <p className="text-[11px] text-yellow-400">⚠ Larger Quick Pick diameters filtered out — remaining tools can generate this corner.</p>
                  );
                  return <p className="text-[11px] text-yellow-400">⚠ Max tool diameter capped at {maxDia.toFixed(4)}" — tools with tool radius ≥ {cr}" excluded.</p>;
                })()}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold flex items-center gap-1.5">
                  Max. Part Floor Radius — Floor to Wall (in)
                  <span className="text-[10px] font-normal text-muted-foreground italic">optional</span>
                  <Hint text="The blend radius where the pocket floor meets the wall. The tool's corner radius must be ≤ this value — a larger corner radius leaves too much material in the floor-to-wall transition. Square tools (CR=0) always pass." diagram={<DiagramFloorRadius />} />
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="e.g. 0.030"
                  value={maxFloorRadius}
                  onChange={e => setMaxFloorRadius(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                {(() => {
                  const fr = parseFloat(maxFloorRadius);
                  if (isNaN(fr) || fr <= 0) return null;
                  return <p className="text-[11px] text-yellow-400">⚠ Tools with corner radius &gt; {fr}" excluded — only square or CR ≤ {fr}" tools shown.</p>;
                })()}
              </div>
              <p className="text-[11px] text-muted-foreground border-t border-indigo-500/20 pt-2">
                Results show standard catalog sizes. Need a closer fit?{" "}
                <span className="text-indigo-400 font-medium">Core Cutter can manufacture custom diameters</span>{" "}
                — contact us for a special order.
              </p>
            </div>
          )}

          {/* Chamfer-mill-only fields */}
          {selToolTypes[0] === "chamfer_mill" && (<>

            {/* Required chamfer length — narrows the Max CEL options below */}
            <div className="space-y-1">
              <label className="text-xs font-semibold flex items-center gap-1.5">
                Required Chamfer Hypotenuse Length (in)
                <Hint text="Enter the hypotenuse length that your chamfer requires. This will help filter chamfer mills with cutting edge lengths your chamfer requires — just need to decide on which cut diameter to use." />
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                placeholder="e.g. 0.125"
                value={reqChamferLength}
                onChange={e => { setReqChamferLength(e.target.value); setSelChamferLengths([]); }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Min. Cutting Edge Length — filtered by required length above */}
            <div className="space-y-1">
              <label className="text-xs font-semibold flex items-center gap-1.5">
                Min. Cutting Edge Length
                <Hint text="Showing all hypotenuse lengths ≥ based upon your Required Chamfer Hypotenuse Length (in) input." />
              </label>
              <MultiSelect
                placeholder="All chamfer hypotenuse lengths..."
                options={options.chamferLengths.filter(l => {
                  const req = parseFloat(reqChamferLength);
                  return isNaN(req) || req <= 0 || l >= req;
                })}
                selected={selChamferLengths}
                onChange={setSelChamferLengths}
                fmt={v => `${(v as number).toFixed(3)}"`}
              />
            </div>

            {/* Flute Style — optional, shown last */}
            <div className="space-y-1">
              <label className="text-xs font-semibold flex items-center gap-1.5">
                Flute Style
                <span className="text-[10px] font-normal text-muted-foreground italic">optional</span>
                <Hint text="Helically Fluted (3 & 5 flute): better finish, harder materials. Straight Fluted (2 & 4 flute): general purpose. Leave unselected to show all styles." />
              </label>
              <div className="flex gap-2">
                {([
                  { key: "helical", label: "Helically Fluted", sub: "3 & 5 flute" },
                  { key: "straight", label: "Straight Fluted", sub: "2 & 4 flute" },
                ] as const).map(({ key, label, sub }) => {
                  const active = chamferFluteStyle === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setChamferFluteStyle(active ? "" : key)}
                      className={`flex-1 rounded-md px-2 py-2 text-xs font-semibold border-2 transition-colors leading-tight ${
                        active
                          ? "border-orange-500 bg-orange-500 text-white"
                          : "border-border bg-background text-muted-foreground hover:border-orange-400 hover:text-foreground"
                      }`}
                    >
                      <div>{label}</div>
                      <div className={`text-[10px] font-normal ${active ? "text-orange-100" : "text-muted-foreground"}`}>{sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

          </>)}

          </div>
        </div>

        {/* Search / Clear buttons */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            disabled={searching}
            onClick={() => handleSearch()}
            className="flex-1 rounded-lg py-3 font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60"
            style={{
              backgroundColor: hasFilter ? "#3b82f6" : "#3b82f620",
              color: hasFilter ? "#fff" : "#3b82f6",
              border: hasFilter ? "none" : "1px solid #3b82f6",
            }}
          >
            <span>🔍</span>
            {searching ? "Searching…" : hasFilter ? "Search Tools" : "Select Filters to Search"}
          </button>
          {(results !== null || hasFilter) && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-lg border px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-accent transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {searchErr && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {searchErr}
        </div>
      )}

      {/* ── Quick Pick tip ── */}
      {qpTip && results !== null && results.length > 0 && (
        <div className="rounded-lg border border-yellow-400/40 bg-yellow-400/5 px-4 py-2.5 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-yellow-300 whitespace-nowrap">⚡ Quick Pick:</span>
            {qpTip.summary.map((s, i) => (
              <React.Fragment key={i}>
                <span className="rounded border border-yellow-400/50 bg-yellow-400/10 px-2 py-0.5 text-yellow-200 font-medium">{s}</span>
                {i < qpTip.summary.length - 1 && <span className="text-yellow-400/40">·</span>}
              </React.Fragment>
            ))}
            {qpTip.geo && (
              <>
                <span className="text-yellow-400/40 mx-0.5">—</span>
                <span className="text-yellow-400/80 italic">Recommended geometry: <span className="font-semibold not-italic text-yellow-300">{qpTip.geo}</span></span>
              </>
            )}
          </div>
          <button type="button" onClick={() => setQpTip(null)} className="text-yellow-400/60 hover:text-yellow-300 text-xs leading-none flex-shrink-0 mt-0.5">✕</button>
        </div>
      )}

      {/* ── Results ── */}
      {results !== null && (
        <div ref={resultsRef} className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                {results.length === 0
                  ? "No tools found — adjust filters or contact us"
                  : `${results.length} tool${results.length !== 1 ? "s" : ""} found`}
              </span>
              {results.length === 200 && (
                <span className="text-xs text-amber-400">Showing first 200 — narrow filters to see more</span>
              )}
            </div>
            {/* Active filter chips — clickable to clear */}
            {(selDias.length > 0 || (material && material !== "all") || selFlutes.length > 0 || selCorners.length > 0 || selLbs || selCoatings.length > 0 || selSeries.length > 0 || selGeometries.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider">Filters:</span>
                {selDias.map(d => (
                  <button key={d} onClick={() => setSelDias(v => v.filter(x => x !== d))}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1">
                    Ø {d}" <span className="opacity-60">✕</span>
                  </button>
                ))}
                {material && (
                  <button onClick={() => setMaterial("")}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1">
                    {material.toUpperCase()} <span className="opacity-60">✕</span>
                  </button>
                )}
                {selFlutes.map(f => (
                  <button key={f} onClick={() => setSelFlutes(v => v.filter(x => x !== f))}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1">
                    {f}fl <span className="opacity-60">✕</span>
                  </button>
                ))}
                {selCorners.map(c => (
                  <button key={c} onClick={() => setSelCorners(v => v.filter(x => x !== c))}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1">
                    {c} <span className="opacity-60">✕</span>
                  </button>
                ))}
                {selLbs && (
                  <button onClick={() => setSelLbs("")}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1">
                    LBS ≥ {selLbs}" <span className="opacity-60">✕</span>
                  </button>
                )}
                {selCoatings.map(c => (
                  <button key={c} onClick={() => setSelCoatings(v => v.filter(x => x !== c))}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1">
                    {c} <span className="opacity-60">✕</span>
                  </button>
                ))}
                {selSeries.map(s => (
                  <button key={s} onClick={() => setSelSeries(v => v.filter(x => x !== s))}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1">
                    {s} <span className="opacity-60">✕</span>
                  </button>
                ))}
                {selGeometries.map(g => (
                  <button key={g} onClick={() => setSelGeometries(v => v.filter(x => x !== g))}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1">
                    {g} <span className="opacity-60">✕</span>
                  </button>
                ))}
              </div>
            )}

            {/* Part Feature Match active filters */}
            {(axialDepth || partCornerRadius || maxFloorRadius) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">Part Match:</span>
                {axialDepth && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                    Depth ≥ {axialDepth}"
                  </span>
                )}
                {partCornerRadius && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                    Wall-to-Wall R ≤ {parseFloat(partCornerRadius) * 2}" dia
                  </span>
                )}
                {maxFloorRadius && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                    Floor-to-Wall CR ≤ {maxFloorRadius}"
                  </span>
                )}
              </div>
            )}
          </div>

          {results.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-zinc-400 mb-1">Can't find what you need?</p>
              <p className="text-xs text-zinc-500 mb-4">Tell us what you're trying to cut — we'll recommend the right tool or build a custom one.</p>
              <button
                type="button"
                onClick={() => { setShowTfContact(true); setTfContactStatus("idle"); }}
                className="rounded-lg bg-orange-600 hover:bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                Contact Us →
              </button>
            </div>
          )}

          {results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground">
                    <th className="text-left px-2 py-2 font-semibold">EDP</th>
                    <th className="text-left px-2 py-2 font-semibold">Series</th>
                    <th className="text-left px-2 py-2 font-semibold">Description</th>
                    <th className="text-center px-2 py-2 font-semibold">Dia</th>
                    <th className="text-center px-2 py-2 font-semibold">FL</th>
                    <th className="text-center px-2 py-2 font-semibold">LOC</th>
                    <th className="text-center px-2 py-2 font-semibold">OAL</th>
                    {selToolTypes[0] !== "chamfer_mill" && <th className="text-center px-2 py-2 font-semibold"><span className="inline-flex items-center justify-center gap-1">LBS <Hint text="Reduced-neck extension for deeper reach. Core Cutter can extend short LBS lengths quickly as a modification — contact us." /></span></th>}
                    {selToolTypes[0] !== "chamfer_mill" && <th className="text-center px-2 py-2 font-semibold">Corner</th>}
                    <th className="text-center px-2 py-2 font-semibold">Coating</th>
                    {selToolTypes[0] === "chamfer_mill" && <>
                      <th className="text-center px-2 py-2 font-semibold">Angle</th>
                      <th className="text-center px-2 py-2 font-semibold">Tip Dia</th>
                      <th className={`text-center px-2 py-2 font-semibold ${selChamferLengths.length || reqChamferLength ? "text-amber-400" : ""}`}>Max CEL</th>
                    </>}
                    <th className="px-2 py-2 text-center font-normal text-[10px] text-muted-foreground italic leading-tight">3D Model</th>
                    <th className="px-2 py-2 text-center font-normal text-[10px] text-muted-foreground italic leading-tight">Insert into<br/>Speed &amp; Feed</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr
                      key={row.edp}
                      className={`border-b transition-colors hover:bg-accent/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      <td className="px-2 py-2 font-mono font-semibold text-indigo-400 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          {row.edp}
                          {row.geometry === "chipbreaker" && (
                            <span className="rounded-full border border-sky-400 text-sky-400 text-[9px] font-bold px-1.5 py-0.5 leading-none">CB</span>
                          )}
                          {row.geometry === "truncated_rougher" && (
                            <span className="rounded-full border border-purple-400 text-purple-400 text-[9px] font-bold px-1.5 py-0.5 leading-none">VXR</span>
                          )}
                          {(() => {
                            if (!axialDepth) return null;
                            const depth = parseFloat(axialDepth);
                            const loc = Number(row.loc_in);
                            const lbs = Number(row.lbs_in);
                            const exactLoc = Math.abs(loc - depth) < 0.001;
                            const exactLbs = lbs > 0 && Math.abs(lbs - depth) < 0.001;
                            if (exactLoc || exactLbs) return null;
                            return <span className="rounded border border-amber-400 text-amber-400 text-[9px] font-bold px-1.5 py-0.5 leading-none">Close Match</span>;
                          })()}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{row.series ?? "—"}</td>
                      <td className="px-2 py-2 max-w-[140px] truncate">
                        {[row.description1, row.description2].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{fmtDia(row.cutting_diameter_in != null ? Number(row.cutting_diameter_in) : null)}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.flutes ?? "—"}</td>
                      <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                        {row.loc_in != null ? `${Number(row.loc_in).toFixed(4)}"` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                        {row.oal_in != null ? `${Number(row.oal_in).toFixed(4)}"` : "—"}
                      </td>
                      {selToolTypes[0] !== "chamfer_mill" && (
                        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                          {row.lbs_in && Number(row.lbs_in) > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              {`${Number(row.lbs_in).toFixed(4)}"`}
                              <span className="rounded border border-orange-500 text-orange-400 text-[9px] font-bold px-1 py-0.5 leading-none">LBS</span>
                            </span>
                          ) : "—"}
                        </td>
                      )}
                      {selToolTypes[0] !== "chamfer_mill" && (
                        <td className="px-2 py-2 whitespace-nowrap">{fmtCorner(row.corner_condition)}</td>
                      )}
                      <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{row.coating ?? "—"}</td>
                      {selToolTypes[0] === "chamfer_mill" && <>
                        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                          {row.chamfer_angle != null ? `${row.chamfer_angle}°` : "—"}
                        </td>
                        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                          {fmtDia(row.tip_diameter != null ? Number(row.tip_diameter) : null)}
                        </td>
                        <td className={`px-2 py-2 text-right font-mono whitespace-nowrap ${selChamferLengths.length || reqChamferLength ? "text-amber-400 font-bold" : ""}`}>
                          {row.max_cutting_edge_length != null ? `${Number(row.max_cutting_edge_length).toFixed(3)}"` : "—"}
                        </td>
                      </>}
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => tfRequireStp(stpUrl(row.edp))}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold border border-emerald-600 text-emerald-400 hover:bg-emerald-600 hover:text-white transition-colors whitespace-nowrap"
                          title={`Download ${row.edp} v1.step`}
                        >
                          ⬇ .STP
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => onSelectTool(row, qpTip ? { mode: qpTip.mode, isoMat: qpTip.isoMat } : undefined)}
                          className="rounded px-2.5 py-1 text-[10px] font-semibold border border-indigo-500 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-colors whitespace-nowrap"
                        >
                          Use Tool →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
    {/* STP Email Gate Modal */}
    {tfGateOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setTfGateOpen(false)}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-base font-semibold text-white mb-1">Enter your email to download</h2>
          <p className="text-xs text-zinc-400 mb-4">One-time per device — auto-fills next time.</p>
          <input
            type="email"
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
            placeholder="your@email.com"
            value={tfGateInput}
            onChange={e => { setTfGateInput(e.target.value); setTfGateError(""); }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                const v = tfGateInput.trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setTfGateError("Enter a valid email address."); return; }
                localStorage.setItem("er_email", v.toLowerCase());
                setTfGateOpen(false);
                window.open(tfGateStpUrl, "_blank");
              }
            }}
            autoFocus
          />
          {tfGateError && <p className="text-xs text-red-400 mt-1">{tfGateError}</p>}
          <div className="flex gap-2 mt-3">
            <button
              className="flex-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg py-2 text-sm font-medium"
              onClick={() => {
                const v = tfGateInput.trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setTfGateError("Enter a valid email address."); return; }
                localStorage.setItem("er_email", v.toLowerCase());
                setTfGateOpen(false);
                window.open(tfGateStpUrl, "_blank");
              }}
            >
              Download
            </button>
            <button className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm" onClick={() => setTfGateOpen(false)}>Cancel</button>
          </div>
        </div>
      </div>
    )}

    {/* Persistent contact link — always visible */}
    <div className="px-4 py-3 text-center border-t border-zinc-800 mt-2">
      <button
        type="button"
        onClick={() => { setShowTfContact(true); setTfContactStatus("idle"); }}
        className="text-xs text-zinc-500 hover:text-orange-400 transition-colors"
      >
        Not sure which tool you need? Contact us →
      </button>
    </div>

    {/* Contact Modal */}
    {showTfContact && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowTfContact(false); setTfContactStatus("idle"); }}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
          {tfContactStatus === "sent" ? (
            <>
              <div className="text-emerald-400 text-2xl mb-2">✓</div>
              <h2 className="text-base font-semibold text-white mb-1">Message received!</h2>
              <p className="text-xs text-zinc-400 mb-4">Our team will reach out at <span className="text-white">{tfContactEmail}</span> with a recommendation.</p>
              <button className="w-full bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm" onClick={() => { setShowTfContact(false); setTfContactStatus("idle"); }}>Close</button>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-white mb-1">Not sure which tool you need?</h2>
              <p className="text-xs text-zinc-400 mb-4">Tell us what you're trying to cut and we'll point you to the right tool.</p>
              <div className="space-y-2">
                <input type="text" placeholder="Your name" value={tfContactName} onChange={e => setTfContactName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500" />
                <input type="email" placeholder="your@email.com *" value={tfContactEmail} onChange={e => setTfContactEmail(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500" />
                <textarea placeholder="What are you trying to cut? Material, depth, finish requirements…" value={tfContactMsg} onChange={e => setTfContactMsg(e.target.value)} rows={3}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500 resize-none" />
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium"
                  disabled={tfContactStatus === "sending" || !tfContactEmail.trim()}
                  onClick={submitTfContact}
                >
                  {tfContactStatus === "sending" ? "Sending…" : "Send Request"}
                </button>
                <button className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm" onClick={() => { setShowTfContact(false); setTfContactStatus("idle"); }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
