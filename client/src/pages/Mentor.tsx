import * as React from "react";

const STP_CDN = "https://cdn.ezcutcnc.app";
function stpUrl(edp: string): string {
  return `${STP_CDN}/${encodeURIComponent("Core_Cutter_" + edp + " v1.step")}`;
}
import { useMentor } from "@/hooks/use-mentor";
import Calculators from "./Calculators";
import ToolFinder from "./ToolFinder";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch as UiSwitch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ISO_CATEGORIES, ISO_SUBCATEGORIES, MATERIAL_NOTES, MATERIAL_HARDNESS_RANGE, type IsoCategory } from "@shared/materials";
import { COATINGS, getCoatingDef, coatingIncompatible } from "@shared/coatings";

// ── Thread TPI / pitch lookup tables (mirrors engine/physics.py) ─────────────
const UN_TPI: Record<string, Record<number, number>> = {
  unc:  { 0.0600:80, 0.0730:64, 0.0860:56, 0.0990:48, 0.1120:40, 0.1250:40, 0.1380:32, 0.1640:32, 0.1900:24, 0.2160:24, 0.2500:20, 0.3125:18, 0.3750:16, 0.4375:14, 0.5000:13, 0.5625:12, 0.6250:11, 0.7500:10, 0.8750:9, 1.0000:8, 1.1250:7, 1.2500:7, 1.3750:6, 1.5000:6, 1.7500:5, 2.0000:4.5 },
  unf:  { 0.0600:80, 0.0730:72, 0.0860:64, 0.0990:56, 0.1120:48, 0.1250:44, 0.1380:40, 0.1640:36, 0.1900:32, 0.2160:28, 0.2500:28, 0.3125:24, 0.3750:24, 0.4375:20, 0.5000:20, 0.5625:18, 0.6250:18, 0.7500:16, 0.8750:14, 1.0000:12, 1.1250:12, 1.2500:12 },
  unef: { 0.2500:32, 0.3125:32, 0.3750:32, 0.4375:28, 0.5000:28, 0.5625:24, 0.6250:24, 0.7500:20, 0.8750:20, 1.0000:20, 1.0625:18, 1.1250:18, 1.1875:18, 1.2500:18 },
};
const METRIC_PITCH: Record<number, number> = {
  1.0:0.25, 1.2:0.25, 1.4:0.30, 1.6:0.35, 2.0:0.40, 2.5:0.45, 3.0:0.50, 3.5:0.60,
  4.0:0.70, 5.0:0.80, 6.0:1.00, 8.0:1.25, 10.0:1.50, 12.0:1.75, 14.0:2.00, 16.0:2.00,
  18.0:2.50, 20.0:2.50, 22.0:2.50, 24.0:3.00, 27.0:3.00, 30.0:3.50, 33.0:3.50, 36.0:4.00,
  39.0:4.00, 42.0:4.50, 48.0:5.00, 56.0:5.50, 64.0:6.00,
};
/** Closest-match lookup: returns TPI for UN standards or pitch_mm for metric. */
function lookupTpi(standard: string, inchVal: number): { tpi?: number; pitch_mm?: number } {
  if (standard === "metric") {
    const mmVal = inchVal * 25.4;
    const keys = Object.keys(METRIC_PITCH).map(Number);
    const closest = keys.reduce((a, b) => Math.abs(b - mmVal) < Math.abs(a - mmVal) ? b : a);
    if (Math.abs(closest - mmVal) < 2.0) return { pitch_mm: METRIC_PITCH[closest] };
    return {};
  }
  const table = UN_TPI[standard];
  if (!table) return {};
  const keys = Object.keys(table).map(Number);
  const closest = keys.reduce((a, b) => Math.abs(b - inchVal) < Math.abs(a - inchVal) ? b : a);
  if (Math.abs(closest - inchVal) < 0.010) return { tpi: table[closest] };
  return {};
}

/** Default thread mill flute count based on cutter diameter. */
function defaultThreadFlutes(dia: number): number {
  if (dia < 0.1875) return 3;
  if (dia < 0.500)  return 4;
  return 5;
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Label className="flex items-center gap-1 cursor-default w-fit text-xs">
            {children}
            <span className="text-muted-foreground/60 text-[10px] leading-none">ⓘ</span>
          </Label>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-xs">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border p-3">
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {hint ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 cursor-default">
                  {label}
                  <svg className="inline w-3 h-3 opacity-50" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <text x="8" y="12" textAnchor="middle" fontSize="10" fontWeight="bold">i</text>
                  </svg>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-56 text-xs">{hint}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : label}
      </div>
      <div className="mt-1 text-lg font-bold leading-tight">{value}</div>
    </div>
  );
}

type SkuRecord = {
  // Identity — DB returns lowercase column names; EDP is an alias for edp
  EDP?: string;
  edp?: string;
  series?: string;
  description?: string;
  description1?: string;
  description2?: string;
  // Geometry
  tool_type?: string;
  cutting_diameter_in: number;
  flutes: number;
  loc_in: number;
  lbs_in?: number;
  neck_dia_in?: number;
  shank_dia_in?: number;
  oal_in?: number;
  corner_condition?: string | number;  // "square" | "ball" | 0.030 (CR in inches)
  flute_wash?: number;
  coating?: string;
  // Flute character
  geometry?: "standard" | "chipbreaker" | "truncated_rougher";
  variable_pitch?: boolean;
  variable_helix?: boolean;
  helix?: number;
  // Chamfer mills
  chamfer_angle?: number;
  tip_diameter?: number;
  max_cutting_edge_length?: number;
};

function fmtNum(n: unknown, digits = 2): string {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(digits) : "—";
}

function fmtInt(n: unknown): string {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x).toLocaleString() : "—";
}

// Mirror of engine/physics.py ream_stock_range — keeps pre-drill recommendation
// in sync without an extra API round-trip.
const REAM_STOCK_ANCHORS: [number, number, number][] = [
  [0.0625, 0.003, 0.005],
  [0.125,  0.007, 0.010],
  [0.250,  0.010, 0.012],
  [0.375,  0.012, 0.013],
  [0.500,  0.013, 0.014],
  [0.750,  0.016, 0.017],
  [1.000,  0.018, 0.019],
];
function reamStockRange(D: number): { min: number; ideal: number; max: number } | null {
  if (!D || D <= 0) return null;
  let lo: number, hi: number;
  if (D <= REAM_STOCK_ANCHORS[0][0]) {
    [, lo, hi] = REAM_STOCK_ANCHORS[0];
  } else if (D >= REAM_STOCK_ANCHORS[REAM_STOCK_ANCHORS.length - 1][0]) {
    [, lo, hi] = REAM_STOCK_ANCHORS[REAM_STOCK_ANCHORS.length - 1];
  } else {
    lo = 0; hi = 0;
    for (let i = 0; i < REAM_STOCK_ANCHORS.length - 1; i++) {
      const [d0, lo0, hi0] = REAM_STOCK_ANCHORS[i];
      const [d1, lo1, hi1] = REAM_STOCK_ANCHORS[i + 1];
      if (D >= d0 && D <= d1) {
        const t = (D - d0) / (d1 - d0);
        lo = lo0 + t * (lo1 - lo0);
        hi = hi0 + t * (hi1 - hi0);
        break;
      }
    }
  }
  const ideal = (lo + hi) / 2;
  return { min: lo, ideal, max: hi };
}

// Generate metric drill sizes: label "X.Xmm", diameter in inches
function _metricDrills(fromMm: number, toMm: number, stepMm: number): [string, number][] {
  const out: [string, number][] = [];
  // Use integer arithmetic to avoid float drift
  const factor = Math.round(1 / stepMm);
  const start  = Math.round(fromMm * factor);
  const end    = Math.round(toMm   * factor);
  for (let i = start; i <= end; i++) {
    const mm  = i / factor;
    const lbl = Number.isInteger(mm) ? `${mm}mm` : `${mm}mm`;
    out.push([lbl, mm / 25.4]);
  }
  return out;
}

// Standard drill sizes: [label, diameter (in)]
// Number drills #80–#1, Letter drills A–Z, Fractional 1/64–1-1/2", Metric 0.5–38mm
const DRILL_SIZES: [string, number][] = ([
  // Number drills
  ["#80",0.0135],["#79",0.0145],["#78",0.0160],["#77",0.0180],["#76",0.0200],
  ["#75",0.0210],["#74",0.0225],["#73",0.0240],["#72",0.0250],["#71",0.0260],
  ["#70",0.0280],["#69",0.0292],["#68",0.0310],["#67",0.0320],["#66",0.0330],
  ["#65",0.0350],["#64",0.0360],["#63",0.0370],["#62",0.0380],["#61",0.0390],
  ["#60",0.0400],["#59",0.0410],["#58",0.0420],["#57",0.0430],["#56",0.0465],
  ["#55",0.0520],["#54",0.0550],["#53",0.0595],["#52",0.0635],["#51",0.0670],
  ["#50",0.0700],["#49",0.0730],["#48",0.0760],["#47",0.0785],["#46",0.0810],
  ["#45",0.0820],["#44",0.0860],["#43",0.0890],["#42",0.0935],["#41",0.0960],
  ["#40",0.0980],["#39",0.0995],["#38",0.1015],["#37",0.1040],["#36",0.1065],
  ["#35",0.1100],["#34",0.1110],["#33",0.1130],["#32",0.1160],["#31",0.1200],
  ["#30",0.1285],["#29",0.1360],["#28",0.1405],["#27",0.1440],["#26",0.1470],
  ["#25",0.1495],["#24",0.1520],["#23",0.1540],["#22",0.1570],["#21",0.1590],
  ["#20",0.1610],["#19",0.1660],["#18",0.1695],["#17",0.1730],["#16",0.1770],
  ["#15",0.1800],["#14",0.1820],["#13",0.1850],["#12",0.1890],["#11",0.1910],
  ["#10",0.1935],["#9",0.1960],["#8",0.1990],["#7",0.2010],["#6",0.2040],
  ["#5",0.2055],["#4",0.2090],["#3",0.2130],["#2",0.2210],["#1",0.2280],
  // Letter drills
  ["A",0.2340],["B",0.2380],["C",0.2420],["D",0.2460],["E",0.2500],
  ["F",0.2570],["G",0.2610],["H",0.2660],["I",0.2720],["J",0.2770],
  ["K",0.2810],["L",0.2900],["M",0.2950],["N",0.3020],["O",0.3160],
  ["P",0.3230],["Q",0.3320],["R",0.3390],["S",0.3480],["T",0.3580],
  ["U",0.3680],["V",0.3770],["W",0.3860],["X",0.3970],["Y",0.4040],["Z",0.4130],
  // Fractional drills 1/64" through 1-1/2"
  ["1/64\"",0.015625],["1/32\"",0.03125],["3/64\"",0.046875],["1/16\"",0.0625],
  ["5/64\"",0.078125],["3/32\"",0.09375],["7/64\"",0.109375],["1/8\"",0.125],
  ["9/64\"",0.140625],["5/32\"",0.15625],["11/64\"",0.171875],["3/16\"",0.1875],
  ["13/64\"",0.203125],["7/32\"",0.21875],["15/64\"",0.234375],["1/4\"",0.25],
  ["17/64\"",0.265625],["9/32\"",0.28125],["19/64\"",0.296875],["5/16\"",0.3125],
  ["21/64\"",0.328125],["11/32\"",0.34375],["23/64\"",0.359375],["3/8\"",0.375],
  ["25/64\"",0.390625],["13/32\"",0.40625],["27/64\"",0.421875],["7/16\"",0.4375],
  ["29/64\"",0.453125],["15/32\"",0.46875],["31/64\"",0.484375],["1/2\"",0.5],
  ["33/64\"",0.515625],["17/32\"",0.53125],["35/64\"",0.546875],["9/16\"",0.5625],
  ["37/64\"",0.578125],["19/32\"",0.59375],["39/64\"",0.609375],["5/8\"",0.625],
  ["41/64\"",0.640625],["21/32\"",0.65625],["43/64\"",0.671875],["11/16\"",0.6875],
  ["45/64\"",0.703125],["23/32\"",0.71875],["47/64\"",0.734375],["3/4\"",0.75],
  ["49/64\"",0.765625],["25/32\"",0.78125],["51/64\"",0.796875],["13/16\"",0.8125],
  ["53/64\"",0.828125],["27/32\"",0.84375],["55/64\"",0.859375],["7/8\"",0.875],
  ["57/64\"",0.890625],["29/32\"",0.90625],["59/64\"",0.921875],["15/16\"",0.9375],
  ["61/64\"",0.953125],["31/32\"",0.96875],["63/64\"",0.984375],["1\"",1.0],
  ["1-1/16\"",1.0625],["1-1/8\"",1.125],["1-3/16\"",1.1875],["1-1/4\"",1.25],
  ["1-5/16\"",1.3125],["1-3/8\"",1.375],["1-7/16\"",1.4375],["1-1/2\"",1.5],
  // Metric — 0.5mm steps 0.5–3mm, 0.05mm steps 3–13mm, 0.5mm steps 13.5–38mm
  // 0.05mm resolution fills gaps 0.1mm misses (e.g. 12.35mm lands in range for a 1/2" reamer)
  ..._metricDrills(0.5,  3.0,  0.5),
  ..._metricDrills(3.0,  13.0, 0.05),
  ..._metricDrills(13.5, 38.0, 0.5),
] as [string, number][]).sort((a, b) => a[1] - b[1]);

interface DrillMatch { label: string; dia: number; inRange: boolean; }

function nearestDrills(target: number, lo: number, hi: number): DrillMatch[] {
  const result: DrillMatch[] = [];
  const byDist = (a: [string,number], b: [string,number]) =>
    Math.abs(a[1] - target) - Math.abs(b[1] - target);

  // 1. Best in-range match (any type — metric often wins here)
  const inRange = DRILL_SIZES.filter(([, d]) => d >= lo && d <= hi);
  const bestInRange = inRange.length > 0
    ? [...inRange].sort(byDist)[0]
    : null;
  if (bestInRange) {
    result.push({ label: bestInRange[0], dia: bestInRange[1], inRange: true });
  }

  // 2. Nearest fractional drill — always shown as a shop-floor reference
  const fractionals = DRILL_SIZES.filter(([lbl]) => lbl.includes("/"));
  const nearestFrac = fractionals.length > 0
    ? [...fractionals].sort(byDist)[0]
    : null;
  if (nearestFrac && nearestFrac[0] !== bestInRange?.[0]) {
    const fracInRange = nearestFrac[1] >= lo && nearestFrac[1] <= hi;
    result.push({ label: nearestFrac[0], dia: nearestFrac[1], inRange: fracInRange });
  }

  // 3. Fallback when nothing was in range: nearest drill below and above
  if (result.length === 0) {
    const below = [...DRILL_SIZES].filter(([, d]) => d < lo).sort((a,b) => b[1]-a[1])[0];
    const above = [...DRILL_SIZES].filter(([, d]) => d > hi).sort((a,b) => a[1]-b[1])[0];
    if (below) result.push({ label: below[0], dia: below[1], inRange: false });
    if (above) result.push({ label: above[0], dia: above[1], inRange: false });
  }

  return result;
}

/** Core Cutter standard reamer flute count by diameter. */
/** ISO tolerance band (total) for a reamed hole, returned as a display string. */
function reamTolBand(D: number, cls: "H6" | "H7" | "H8"): string {
  // H7 total tolerance in inches, by diameter range (approximate ISO 286)
  const h7 = D <= 0.125 ? 0.0004 : D <= 0.250 ? 0.0005 : D <= 0.500 ? 0.0007 : D <= 1.000 ? 0.0008 : 0.0010;
  const tol = cls === "H6" ? h7 * 0.60 : cls === "H8" ? h7 * 1.60 : h7;
  return `+0.0000 / −${tol.toFixed(4)}"`;
}

function reamFlutes(D: number): number {
  if (!D || D <= 0) return 6;
  if (D <= 0.125)  return 4;
  if (D <= 0.375)  return 4;
  if (D <= 0.750)  return 6;
  return 8;
}

export default function Mentor() {
  const { toast } = useToast();
  const mentor = useMentor();


  const [isoCategory, setIsoCategory] = React.useState<IsoCategory>("P");
  const [matSearchInput, setMatSearchInput]   = React.useState("");
  const [matSearchLoading, setMatSearchLoading] = React.useState(false);
  const [matMatchResult, setMatMatchResult]   = React.useState<{ key: string; label: string; confidence: string; source: string; note: string | null } | null>(null);
  const [matMatchError, setMatMatchError]     = React.useState<string | null>(null);
  const [operation, setOperation] = React.useState<"milling" | "drilling" | "reaming" | "threadmilling" | "keyseat" | "dovetail" | "feedmilling" | "toolfinder">("milling");
  const [units, setUnits] = React.useState<"imperial" | "metric">("imperial");

  // ── Engineering / Customer mode ──────────────────────────────────────────
  const [engMode, setEngMode] = React.useState<boolean>(() =>
    localStorage.getItem("cc_eng_mode") === "true"
  );
  const [showEngModal, setShowEngModal] = React.useState(false);
  const [showEngPassword, setShowEngPassword] = React.useState(false);
  const [engPasswordInput, setEngPasswordInput] = React.useState("");
  const [engPasswordError, setEngPasswordError] = React.useState("");
  const [engAuthLoading, setEngAuthLoading] = React.useState(false);

  // ── Toolbox state ──────────────────────────────────────────────────────────
  const [tbSaving, setTbSaving] = React.useState(false);
  const [tbSaved, setTbSaved] = React.useState(false);
  const [tbShowModal, setTbShowModal] = React.useState(false);
  const [tbEmail, setTbEmail] = React.useState(() => localStorage.getItem("tb_email") || "");
  const [tbToken, setTbToken] = React.useState(() => localStorage.getItem("tb_token") || "");
  const [tbStep, setTbStep] = React.useState<"email" | "code" | "saving">(
    localStorage.getItem("tb_email") && localStorage.getItem("tb_token") ? "saving" : "email"
  );
  const [tbInputEmail, setTbInputEmail] = React.useState("");
  const [tbInputCode, setTbInputCode] = React.useState("");
  const [tbError, setTbError] = React.useState("");
  const [tbTitle, setTbTitle] = React.useState("");
  const [tbItemCount, setTbItemCount] = React.useState<number | null>(null);

  // ── Email results (lead capture) ──────────────────────────────────────────
  const [erEmail, setErEmail] = React.useState(() => localStorage.getItem("er_email") || localStorage.getItem("tb_email") || "");
  const [erStatus, setErStatus] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [erError, setErError] = React.useState("");

  // ── Email gate (lock all outputs behind email) ─────────────────────────
  const [erGateOpen, setErGateOpen] = React.useState(false);
  const [erGatePending, setErGatePending] = React.useState<"copy" | "print" | "pdf" | "stp" | null>(null);
  const [erGateStpUrl, setErGateStpUrl] = React.useState("");
  const [erGateInput, setErGateInput] = React.useState(() => localStorage.getItem("er_email") || localStorage.getItem("tb_email") || "");
  const [erGateError, setErGateError] = React.useState("");

  // ── Contact modal ("Don't know which tool?") ──────────────────────────
  const [showContactModal, setShowContactModal] = React.useState(false);
  const [contactName, setContactName] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState(() => localStorage.getItem("er_email") || localStorage.getItem("tb_email") || "");
  const [contactMsg, setContactMsg] = React.useState("");
  const [contactStatus, setContactStatus] = React.useState<"idle" | "sending" | "sent">("idle");

  // ── Machine state ──────────────────────────────────────────────────────────
  const [machineQuery, setMachineQuery] = React.useState("");
  const [machineResults, setMachineResults] = React.useState<any[]>([]);
  const [machineDropOpen, setMachineDropOpen] = React.useState(false);
  const machineTouchingDropRef = React.useRef(false);
  const machineInputRef = React.useRef<HTMLInputElement>(null);
  const [savedMachines, setSavedMachines] = React.useState<any[]>([]);
  const [showSaveMachineModal, setShowSaveMachineModal] = React.useState(false);
  const [machineNickname, setMachineNickname] = React.useState("");
  const [machineShopNo, setMachineShopNo] = React.useState("");
  const [machineSerial, setMachineSerial] = React.useState("");
  const [machineSaving, setMachineSaving] = React.useState(false);
  const [activeMachineId, setActiveMachineId] = React.useState<number | null>(null); // catalog id
  const [activeMachineName, setActiveMachineName] = React.useState("");
  const [showManageMachines, setShowManageMachines] = React.useState(false);

  // Search catalog (+ user saved machines if logged in)
  React.useEffect(() => {
    if (machineQuery.length < 2) { setMachineResults([]); return; }
    const t = setTimeout(async () => {
      const e = tbEmail || localStorage.getItem("tb_email") || "";
      const tk = tbToken || localStorage.getItem("tb_token") || "";
      let url = `/api/machines/search?q=${encodeURIComponent(machineQuery)}`;
      if (e && tk) url += `&email=${encodeURIComponent(e)}&token=${encodeURIComponent(tk)}`;
      const r = await fetch(url);
      if (r.ok) setMachineResults(await r.json());
    }, 250);
    return () => clearTimeout(t);
  }, [machineQuery, tbEmail, tbToken]);

  // Load saved machines + item count when toolbox session is active
  React.useEffect(() => {
    const e = tbEmail || localStorage.getItem("tb_email") || "";
    const t = tbToken || localStorage.getItem("tb_token") || "";
    if (!e || !t) return;
    fetch(`/api/user-machines?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`)
      .then(r => r.ok ? r.json() : [])
      .then(setSavedMachines)
      .catch(() => {});
    fetch(`/api/toolbox/items?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`)
      .then(r => r.ok ? r.json() : [])
      .then((items: any[]) => setTbItemCount(items.length))
      .catch(() => {});
  }, [tbEmail, tbToken]);

  function applyMachineToForm(m: any) {
    const dualContact = m.taper?.startsWith("HSK") || m.taper?.startsWith("CAPTO") || m.dual_contact;
    const drive = m.drive_type ?? "direct";
    setForm(p => ({
      ...p,
      max_rpm: m.max_rpm ?? p.max_rpm,
      machine_hp: m.spindle_hp ? Number(m.spindle_hp) : p.machine_hp,
      spindle_taper: m.taper ?? p.spindle_taper,
      spindle_drive: drive as any,
      dual_contact: dualContact,
      machine_type: m.machine_type ?? p.machine_type,
    }));
    setActiveMachineId(m.id ?? null);
    const _namePart = m.brand && m.model?.startsWith(m.brand) ? m.model : [m.brand, m.model].filter(Boolean).join(" ");
    const _machNo = m.shop_machine_no ? ` #${m.shop_machine_no}` : "";
    setActiveMachineName(_namePart ? `${_namePart}${_machNo}${m.nickname ? ` (${m.nickname})` : ""}` : `${m.nickname ?? ""}${_machNo}`);
    setMachineQuery("");
    setMachineDropOpen(false);
    setMachineResults([]);
  }

  async function saveMachine() {
    const e = tbEmail || localStorage.getItem("tb_email") || "";
    const t = tbToken || localStorage.getItem("tb_token") || "";
    if (!e || !t) { setShowSaveMachineModal(false); setTbShowModal(true); return; }
    if (!machineNickname.trim()) return;
    setMachineSaving(true);
    try {
      const res = await fetch("/api/user-machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: e, token: t,
          nickname: machineNickname.trim(),
          shop_machine_no: machineShopNo.trim() || null,
          serial_number: machineSerial.trim() || null,
          machine_id: activeMachineId,
          brand: form.max_rpm ? (machineQuery || activeMachineName.split(" ")[0] || null) : null,
          model: activeMachineName || null,
          max_rpm: form.max_rpm || null,
          spindle_hp: form.machine_hp || null,
          taper: form.spindle_taper,
          drive_type: form.spindle_drive,
          dual_contact: form.dual_contact,
          machine_type: form.machine_type,
        }),
      });
      if (res.ok) {
        setShowSaveMachineModal(false);
        setMachineNickname(""); setMachineShopNo(""); setMachineSerial("");
        // Refresh saved list
        const r2 = await fetch(`/api/user-machines?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`);
        if (r2.ok) setSavedMachines(await r2.json());
      } else if (res.status === 401) {
        // Token expired or invalid — clear and re-prompt
        localStorage.removeItem("tb_email"); localStorage.removeItem("tb_token");
        setTbEmail(""); setTbToken("");
        setTbStep("email");
        setShowSaveMachineModal(false);
        setTbShowModal(true);
      }
    } finally { setMachineSaving(false); }
  }

  const enterEngMode = async () => {
    setEngAuthLoading(true);
    setEngPasswordError("");
    try {
      const res = await fetch("/api/eng-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: engPasswordInput }),
      });
      if (res.ok) {
        setEngMode(true);
        localStorage.setItem("cc_eng_mode", "true");
        setShowEngModal(false);
        setEngPasswordInput("");
        // Auto-connect Toolbox session for admin
        const d = await res.json();
        if (d.tb_email && d.tb_token) {
          setTbEmail(d.tb_email);
          setTbToken(d.tb_token);
          setTbStep("saving");
          localStorage.setItem("tb_email", d.tb_email);
          localStorage.setItem("tb_token", d.tb_token);
          // Load saved machines
          const r2 = await fetch(`/api/user-machines?email=${encodeURIComponent(d.tb_email)}&token=${encodeURIComponent(d.tb_token)}`);
          if (r2.ok) setSavedMachines(await r2.json());
        }
      } else {
        setEngPasswordError("Incorrect password");
      }
    } catch {
      setEngPasswordError("Connection error — try again");
    }
    setEngAuthLoading(false);
  };

  const exitEngMode = () => {
    setEngMode(false);
    localStorage.removeItem("cc_eng_mode");
  };

  // ── Toolbox functions ──────────────────────────────────────────────────────
  async function saveToToolbox() {
    const e = tbEmail || localStorage.getItem("tb_email") || "";
    const t = tbToken || localStorage.getItem("tb_token") || "";
    if (!e || !t) { setTbShowModal(true); return; }
    setTbSaving(true);
    try {
      const title = tbTitle || `${pdfToolNumber ? `${pdfToolNumber} — ` : ""}${form.operation} — ${form.material} — Ø${form.tool_dia}"`;
      const r = await fetch("/api/toolbox/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: e, token: t,
          type: "result",
          title,
          data: { inputs: form, customer: result?.customer, engineering: result?.engineering, tool_number: pdfToolNumber ?? undefined },
        }),
      });
      if (r.status === 401) { setTbShowModal(true); return; }
      setTbSaved(true);
      setTbItemCount(c => c !== null ? c + 1 : 1);
      setTimeout(() => setTbSaved(false), 3000);
    } finally { setTbSaving(false); }
  }

  async function tbSendCode() {
    setTbError("");
    setTbSaving(true);
    try {
      const r = await fetch("/api/toolbox/send-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: tbInputEmail }),
      });
      const d = await r.json();
      if (!r.ok) { setTbError(d.error || "Failed"); return; }
      setTbStep("code");
    } catch { setTbError("Network error"); }
    finally { setTbSaving(false); }
  }

  async function tbVerifyCode() {
    setTbError("");
    setTbSaving(true);
    try {
      const r = await fetch("/api/toolbox/verify-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: tbInputEmail, code: tbInputCode }),
      });
      const d = await r.json();
      if (!r.ok) { setTbError(d.error || "Invalid code"); return; }
      localStorage.setItem("tb_email", tbInputEmail.toLowerCase());
      localStorage.setItem("tb_token", d.token);
      setTbEmail(tbInputEmail.toLowerCase());
      setTbToken(d.token);
      setTbStep("saving");
      // now save
      const title = tbTitle || `${form.operation} — ${form.material} — Ø${form.tool_dia}"`;
      await fetch("/api/toolbox/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: tbInputEmail.toLowerCase(), token: d.token,
          type: "result", title,
          data: { inputs: form, customer: result?.customer, engineering: result?.engineering },
        }),
      });
      setTbShowModal(false);
      setTbSaved(true);
      setTimeout(() => setTbSaved(false), 3000);
    } catch { setTbError("Network error"); }
    finally { setTbSaving(false); }
  }

  // ── PDF Print Upload ──────────────────────────────────────────────────────
  const [pdfUploading, setPdfUploading] = React.useState(false);
  const [pdfExtracted, setPdfExtracted] = React.useState(false);
  const [pdfToolNumber, setPdfToolNumber] = React.useState<string | null>(null);

  const uploadPrintPdf = async (file: File) => {
    setPdfUploading(true);
    setPdfExtracted(false);
    try {
      const formData = new FormData();
      formData.append("pdf", file);
      const res = await fetch("/api/tool-geometry/extract", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Could not read print", description: err.error ?? "Please enter dimensions manually", variant: "destructive" });
        return;
      }
      const data = await res.json();
      const e = data.extracted ?? {};

      // Reject non-Core Cutter prints
      if (e.error === "not_core_cutter") {
        toast({ title: "Unauthorized Print", description: "This print does not appear to be a Core Cutter LLC document. Only Core Cutter prints can be uploaded.", variant: "destructive" });
        return;
      }
      if (e.no_tool_number) {
        toast({ title: "Concept Tool — No CC Number", description: "No CC-XXXXX number found. Dimensions extracted — note this tool has not yet been assigned a Core Cutter number.", variant: "default" });
      }

      // Map extracted fields to form — only set fields that have real values
      setForm((p) => {
        const next = { ...p };
        if (e.tool_dia > 0) { next.tool_dia = e.tool_dia; setToolDiaText(String(e.tool_dia)); }
        if (e.flutes > 0) next.flutes = e.flutes;
        if (e.loc > 0) { next.loc = e.loc; setLocText(String(e.loc)); }
        if (e.lbs > 0) {
          const tt = (e.tool_type ?? "").toLowerCase();
          if (tt === "threadmill") {
            next.thread_neck_length = e.lbs;
            setTmNeckText(String(e.lbs));
          } else if (tt === "dovetail" || tt === "keyseat") {
            // lbs = TSC/reach for dovetail and keyseat
            next.lbs = e.lbs;
            setLbsText(e.lbs.toFixed(4));
          } else {
            next.lbs = e.lbs;
            setLbsText(String(e.lbs));
          }
        }
        // Always set helix_angle — 0 is valid (straight flute)
        if (e.helix_angle !== undefined) next.helix_angle = Number(e.helix_angle);
        if (e.helix_angle > 0) next.helix_angle = e.helix_angle;
        if (e.corner_condition) next.corner_condition = e.corner_condition;
        if (e.corner_radius > 0) next.corner_radius = e.corner_radius;
        if (e.shank_dia > 0) next.shank_dia = e.shank_dia;
        if (e.coating) next.coating = e.coating;
        if (e.keyseat_arbor_dia > 0) next.keyseat_arbor_dia = e.keyseat_arbor_dia;
        if (e.dovetail_angle > 0) next.dovetail_angle = e.dovetail_angle;
        if (e.chamfer_angle > 0) next.chamfer_angle = e.chamfer_angle;
        if (e.chamfer_tip_dia > 0) next.chamfer_tip_dia = e.chamfer_tip_dia;
        if (e.drill_step_diameters?.length > 0) {
          next.drill_step_diameters = e.drill_step_diameters;
          next.drill_steps = 1;
        }
        if (e.cutting_material) {
          const matKey = e.cutting_material as string;
          next.material = matKey as any;
          const sub = ISO_SUBCATEGORIES.find(s => s.key === matKey);
          if (sub) {
            setIsoCategory(sub.iso);
            next.hardness_value = sub.hardness.value;
            next.hardness_scale = sub.hardness.scale;
          }
        }
        // Auto-switch operation based on detected tool type
        const tt = (e.tool_type ?? "").toLowerCase();
        if (tt === "keyseat") { setOperation("keyseat"); next.operation = "keyseat" as any; }
        else if (tt === "dovetail") { setOperation("dovetail"); next.operation = "dovetail" as any; }
        else if (tt === "drill" || tt === "step_drill") { setOperation("drilling"); next.operation = "drilling"; }
        else if (tt === "reamer") { setOperation("reaming"); next.operation = "reaming"; }
        else if (tt === "threadmill") { setOperation("threadmilling"); next.operation = "threadmilling"; }
        else if (tt === "chamfer_mill") {
          next.tool_type = "chamfer_mill";
        }
        return next;
      });
      setPdfExtracted(true);
      setPdfToolNumber(e.tool_number ?? null);
      mentor.reset();
      toast({ title: "Print read successfully", description: `${e.tool_number ? `Tool ${e.tool_number} — ` : ""}Review extracted dimensions below and correct any misreads before running.` });
    } catch {
      toast({ title: "Upload failed", description: "Please enter dimensions manually", variant: "destructive" });
    }
    setPdfUploading(false);
  };
  const metric = units === "metric";

  // Conversion factors: imperial → metric
  const UL = (imp: string, met: string) => metric ? met : imp;
  const UC = (val: number | null | undefined, factor: number, digits: number) => {
    const x = Number(val);
    return Number.isFinite(x) ? (metric ? x * factor : x).toFixed(digits) : "—";
  };

  // Unit-aware input: displays metric, stores imperial
  const onUnitNum = (key: keyof typeof form, factor: number) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = Number(e.target.value);
      setForm((p) => ({ ...p, [key]: Number.isFinite(n) ? (metric ? n / factor : n) as any : p[key] }));
    };

  // Parse a dimension string: supports decimals and fractions like "3/4"
  const parseDim = (raw: string): number => {
    const s = raw.trim();
    const slash = s.indexOf("/");
    if (slash > 0) {
      const num = parseFloat(s.slice(0, slash));
      const den = parseFloat(s.slice(slash + 1));
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
    }
    return parseFloat(s);
  };

  // This matches shared/routes.ts input schema keys (or is trivially mappable)
  const INITIAL_FORM = {
    operation: "milling" as "milling" | "drilling" | "reaming" | "threadmilling" | "keyseat" | "dovetail",
    mode: "" as "hem" | "traditional" | "finish" | "face" | "slot" | "trochoidal" | "circ_interp" | "",
    material: "steel_alloy",
    tool_dia: 0,
    flutes: 0,
    loc: 0,
    lbs: 0,
    edp: "",
    tool_type: "endmill" as "endmill" | "ballnose" | "corner_radius" | "chamfer_mill",
    corner_condition: "square" as "square" | "corner_radius" | "ball",
    corner_radius: 0,
    geometry: "standard" as "standard" | "chipbreaker" | "truncated_rougher",
    variable_pitch: false,
    variable_helix: false,
    shank_dia: 0,
    coating: "",
    target_ra_uin: 0,
    tool_series: "",
    helix_angle: 0,

    // Chamfer mill
    chamfer_series: "CMH" as "CMS" | "CMH",
    chamfer_angle: 90,
    chamfer_tip_dia: 0,
    chamfer_depth: 0,

    spindle_taper: "CAT40" as "CAT30" | "CAT40" | "CAT50" | "BT30" | "BT40" | "BT50" | "HSK63" | "HSK100" | "VDI30" | "VDI40" | "VDI50" | "BMT45" | "BMT55" | "BMT65" | "CAPTO C6" | "CAPTO C8",
    machine_type: "vmc" as "vmc" | "hmc" | "5axis" | "mill_turn" | "lathe",
    toolholder: "er_collet" as "er_collet" | "hp_collet" | "weldon" | "shell_mill_arbor" | "milling_chuck" | "hydraulic" | "press_fit" | "shrink_fit" | "capto",
    dual_contact: false,
    holder_gage_length: 0,
    holder_nose_dia: 0,
    extension_holder: false,
    workholding: "vise" as "rigid_fixture" | "dovetail" | "vise" | "soft_jaws" | "tombstone" | "toe_clamps" | "5th_axis_vise" | "3_jaw_chuck" | "4_jaw_chuck" | "collet_chuck" | "between_centers" | "face_plate",
    coolant: "flood" as "dry" | "mist" | "flood" | "tsc_low" | "tsc_high",
    coolant_fluid: "semi_synthetic" as "water_soluble" | "semi_synthetic" | "synthetic" | "straight_oil",
    coolant_concentration: 10,

    max_rpm: 0,
    rpm_util_pct: 0.95,
    drill_feed_util_pct: 0.90,

    woc_pct: 10, // default = HEM med (10%)
    doc_xd: 0,

    machine_hp: 0,
    spindle_drive: "belt" as "direct" | "belt" | "gear",
    stickout: 0,

    existing_hole_dia: 0,
    target_hole_dia: 0,

    hardness_value: ISO_SUBCATEGORIES.find((s) => s.key === "steel_alloy")?.hardness.value ?? 0,
    hardness_scale: (ISO_SUBCATEGORIES.find((s) => s.key === "steel_alloy")?.hardness.scale ?? "hrc") as "hrb" | "hrc",

    // Drilling-specific
    drill_point_angle: 135 as 118 | 130 | 135 | 140 | 145,
    drill_flute_length: 0,
    drill_hole_depth: 0,
    drill_blind: false,
    drill_geometry: "standard" as "standard" | "med_helix" | "high_helix",
    drill_coolant_fed: false,
    drill_steps: 0,
    drill_step_diameters: [] as number[],
    drill_step_lengths: [] as number[],

    // Reaming
    ream_pre_drill_dia: 0,
    ream_hole_depth: 0,
    ream_shank_dia: 0,
    ream_blind: false,
    ream_coolant_fed: false,
    ream_steps: 0,
    ream_step_diameters: [] as number[],
    ream_step_lengths: [] as number[],
    ream_lead_chamfer: "standard" as "standard" | "long_lead" | "short_lead",

    // Keyseat-specific
    keyseat_arbor_dia: 0,
    final_slot_depth: 0,

    // Dovetail-specific
    dovetail_angle: 0,

    // Thread milling-specific
    thread_standard: "unc" as "unc" | "unf" | "unef" | "metric" | "npt" | "nptf",
    thread_major_dia: 0,
    thread_tpi: undefined as number | undefined,
    thread_pitch_mm: undefined as number | undefined,
    thread_class: "2B" as "1A" | "1B" | "2A" | "2B" | "3A" | "3B" | "6H" | "6g",
    thread_internal: true,
    thread_engagement: 0,
    thread_hand: "right" as "right" | "left",
    thread_rows: 1,
    thread_neck_length: 0,
    npt_size: "",
    thread_gcode_dialect: "fanuc" as "fanuc" | "siemens",
    thread_cut_direction: "top_down" as "top_down" | "bottom_up",

    quiet: true,
  };
  const [form, setForm] = React.useState(INITIAL_FORM);

  // ── Flute+Material aware WOC/DOC med lookup ─────────────────────────────
  // Returns { wocMed (%), docMed (xD) } for HEM and Traditional.
  // DOC is always capped at LOC (caller must apply cap).
  function getHemMed(iso: string, flutes: number): { wocMed: number; docMed: number } {
    const f = flutes <= 5 ? 5 : flutes <= 6 ? 6 : flutes <= 7 ? 7 : flutes <= 9 ? 9 : 11;
    // WOC med % by ISO × flute bucket
    const wocTable: Record<string, Record<number, number>> = {
      N: { 5: 30, 6: 25, 7: 20, 9: 18, 11: 15 },  // aluminum — high WOC in HEM
      P: { 5: 12, 6: 10, 7:  9, 9:  7, 11:  5 },
      M: { 5: 10, 6:  8, 7:  7, 9:  6, 11:  4 },
      K: { 5:  8, 6:  7, 7:  6, 9:  5, 11:  4 },
      S: { 5:  7, 6:  6, 7:  5, 9:  4, 11:  3 },
      H: { 5:  5, 6:  4, 7:  4, 9:  3, 11:  3 },
    };
    // DOC med xD by ISO × flute bucket
    const docTable: Record<string, Record<number, number>> = {
      N: { 5: 2.5, 6: 3.0, 7: 3.0, 9: 3.5, 11: 4.0 },  // aluminum — deep DOC in HEM
      P: { 5: 2.0, 6: 2.5, 7: 2.5, 9: 3.0, 11: 3.0 },
      M: { 5: 1.5, 6: 2.0, 7: 2.5, 9: 2.5, 11: 3.0 },
      K: { 5: 1.5, 6: 2.0, 7: 2.5, 9: 2.5, 11: 3.0 },
      S: { 5: 1.5, 6: 2.0, 7: 2.5, 9: 2.5, 11: 3.0 },
      H: { 5: 0.75,6: 1.0, 7: 1.0, 9: 1.0, 11: 1.25 },
    };
    const wocMed = wocTable[iso]?.[f] ?? wocTable["P"][5];
    const docMed = docTable[iso]?.[f] ?? docTable["P"][5];
    return { wocMed, docMed };
  }

  function getTradMed(iso: string, flutes: number): { wocMed: number; docMed: number } {
    // Aluminum — 2 & 3 flute only
    if (iso === "N") {
      return { wocMed: flutes <= 2 ? 45 : 40, docMed: 0.75 };
    }
    const f = flutes <= 4 ? 4 : flutes <= 5 ? 5 : 6;
    const wocTable: Record<string, Record<number, number>> = {
      P: { 4: 35, 5: 30, 6: 25 },
      M: { 4: 30, 5: 25, 6: 20 },
      K: { 4: 35, 5: 30, 6: 25 },
      S: { 4: 25, 5: 20, 6: 18 },
      H: { 4:  7, 5:  6, 6:  5 },
    };
    const docTable: Record<string, Record<number, number>> = {
      P: { 4: 1.0, 5: 1.25, 6: 1.25 },
      M: { 4: 0.75,5: 1.0,  6: 1.0  },
      K: { 4: 1.0, 5: 1.25, 6: 1.25 },
      S: { 4: 0.5, 5: 0.75, 6: 0.75 },
      H: { 4: 0.5, 5: 0.5,  6: 0.75 },
    };
    const wocMed = wocTable[iso]?.[f] ?? 30;
    const docMed = docTable[iso]?.[f] ?? 1.0;
    return { wocMed, docMed };
  }

  // Derive dynamic presets for the current mode/material/flutes
  function getDynamicPresets(mode: string, iso: string, flutes: number, dia: number, loc: number): {
    woc: { low: number; med: number; high: number };
    doc: { low: number; med: number; high: number };
  } {
    if (mode === "hem" || mode === "trochoidal") {
      const { wocMed, docMed } = getHemMed(iso, flutes);
      const wocLow  = Math.max(iso === "S" ? 2 : 2, Math.round(wocMed * 0.40));
      const wocHigh = iso === "N"
        ? Math.round(wocMed * 1.50)           // aluminum: no 15% cap
        : Math.min(15, Math.round(wocMed * 1.50)); // others: cap at 15%
      const docLow  = Math.round(docMed * 0.6 * 4) / 4;
      // HEM high = full LOC (not capped at 1.5×med) — using full flute length is normal in HEM
      const docHigh = loc > 0 && dia > 0 ? loc / dia : docMed * 2.0;
      return {
        woc: { low: wocLow, med: wocMed, high: wocHigh },
        doc: { low: docLow, med: loc > 0 && dia > 0 ? Math.min(docMed, loc / dia) : docMed, high: Math.round(docHigh * 4) / 4 },
      };
    }
    if (mode === "traditional") {
      const { wocMed, docMed } = getTradMed(iso, flutes);
      const wocLow  = Math.max(10, Math.round(wocMed * 0.55));
      const wocHigh = Math.min(60, Math.round(wocMed * 1.50));
      const docLow  = Math.round(docMed * 0.6 * 4) / 4;
      const docHigh = loc > 0 && dia > 0 ? Math.min(docMed * 1.5, loc / dia) : docMed * 1.5;
      return {
        woc: { low: wocLow, med: wocMed, high: wocHigh },
        doc: { low: docLow, med: loc > 0 && dia > 0 ? Math.min(docMed, loc / dia) : docMed, high: Math.round(docHigh * 4) / 4 },
      };
    }
    // Fallback for finish, face, slot, circ_interp — keep flat presets
    const flatWoc: Record<string, { low: number; med: number; high: number }> = {
      finish:     { low: 2,  med: 5,  high: 10  },
      face:       { low: 50, med: 75, high: 90 },
      trochoidal: { low: 5,  med: 8,  high: 12 },
      slot:       { low: 100,med: 100,high: 100 },
      circ_interp:{ low: 10, med: 25, high: 50 },
    };
    const flatDoc: Record<string, { low: number; med: number; high: number }> = {
      finish:     { low: 0.25, med: 1.0, high: loc > 0 && dia > 0 ? Math.round((loc / dia) * 100) / 100 : 2.0 },
      face:       { low: 0.03,med: 0.08, high: 0.15 },
      trochoidal: { low: 1.0, med: 1.5,  high: 2.0 },
      slot:       { low: flutes === 5 ? 0.15 : 0.25, med: flutes === 5 ? 0.30 : 0.5, high: flutes === 5 ? 0.5 : 1.0 },
      circ_interp:{ low: 0.25,med: 0.5,  high: 1.0 },
    };
    return {
      woc: flatWoc[mode] ?? { low: 10, med: 30, high: 50 },
      doc: flatDoc[mode] ?? { low: 0.25, med: 0.5, high: 1.0 },
    };
  }

  // Convenience: get presets for current form state
  const dynPresets = React.useMemo(() =>
    getDynamicPresets(form.mode, isoCategory, form.flutes, form.tool_dia, form.loc),
    [form.mode, isoCategory, form.flutes, form.tool_dia, form.loc] // eslint-disable-line
  );

  // Keep WOC_PRESETS / DOC_PRESETS as aliases pointing to dynamic values for
  // any existing code that references them directly
  const WOC_PRESETS: Record<string, { low: number; med: number; high: number }> = {
    hem:         dynPresets.woc,
    traditional: dynPresets.woc,
    finish:      { low: 2, med: 5, high: 10 },
    face:        { low: 50, med: 75, high: 90 },
    trochoidal:  dynPresets.woc,
    slot:        { low: 100,med: 100,high: 100 },
    circ_interp: { low: 10, med: 25, high: 50 },
  };
  const DOC_PRESETS: Record<string, { low: number; med: number; high: number }> = {
    hem:         dynPresets.doc,
    traditional: dynPresets.doc,
    finish:      { low: 0.25, med: 1.0, high: form.loc > 0 && form.tool_dia > 0 ? Math.round((form.loc / form.tool_dia) * 100) / 100 : 2.0 },
    face:        { low: 0.03,med: 0.08, high: 0.15 },
    trochoidal:  dynPresets.doc,
    slot:        { low: form.flutes === 5 ? 0.15 : 0.25, med: form.flutes === 5 ? 0.30 : 0.5, high: form.flutes === 5 ? 0.5 : 1.0 },
    circ_interp: { low: 0.05, med: 0.10, high: 0.25 },
  };
  const [wocPreset, setWocPreset] = React.useState<"low" | "med" | "high" | "optimal" | null>("med");
  const [docPreset, setDocPreset] = React.useState<"low" | "med" | "high" | "optimal" | null>("med");

  // Local text state for WOC/DOC — WOC shows actual inches (woc_pct/100 × tool_dia)
  const [wocText, setWocText] = React.useState("");
  const [docText, setDocText] = React.useState("");
  const [crText, setCrText] = React.useState("");
  const [toolDiaText, setToolDiaText] = React.useState("");
  const [locText, setLocText] = React.useState("");
  const [lbsText, setLbsText] = React.useState("");
  const [finalSlotDepthText, setFinalSlotDepthText] = React.useState("");
  const [entryTypes, setEntryTypes] = React.useState<string[]>(["sweep"]);
  const [holderGageText, setHolderGageText] = React.useState("");
  const [holderNoseDiaText, setHolderNoseDiaText] = React.useState("");
  const [existingHoleText, setExistingHoleText] = React.useState("");
  const [targetHoleText, setTargetHoleText] = React.useState("");
  const [drillFluteLenText, setDrillFluteLenText] = React.useState("");
  const [drillHoleDepthText, setDrillHoleDepthText] = React.useState("");
  const [stepDiaTexts, setStepDiaTexts] = React.useState<string[]>([]);
  const [stepLenTexts, setStepLenTexts] = React.useState<string[]>([]);
  const [raText, setRaText] = React.useState("");
  const [chamferTipDiaText, setChamferTipDiaText] = React.useState("");
  const [chamferDepthText, setChamferDepthText] = React.useState("");
  const [tmMajorDiaText, setTmMajorDiaText] = React.useState("");
  const [tmTpiText, setTmTpiText] = React.useState("");
  const [tmPitchMmText, setTmPitchMmText] = React.useState("");
  const [tmEngText, setTmEngText] = React.useState("");
  // Reaming mode
  const [reamMode, setReamMode] = React.useState<"print" | "known">("print");
  const [reamTolClass, setReamTolClass] = React.useState<"H6" | "H7" | "H8">("H7");
  const [reamFinishedDiaText, setReamFinishedDiaText] = React.useState("");

  const [tmNeckText, setTmNeckText] = React.useState("");
  const [stickoutText, setStickoutText] = React.useState("");
  const [tmStickoutText, setTmStickoutText] = React.useState("");
  const [neckAutoSuggested, setNeckAutoSuggested] = React.useState(false);
  const [stickoutAutoSuggested, setStickoutAutoSuggested] = React.useState(false);
  const [tmGcodeExpanded, setTmGcodeExpanded] = React.useState(false);
  const [modeTipsOpen, setModeTipsOpen] = React.useState(false);

  // EDP# / SKU lookup state
  const [edpText, setEdpText] = React.useState("");
  const [skuResults, setSkuResults] = React.useState<SkuRecord[]>([]);
  const [skuDropdownOpen, setSkuDropdownOpen] = React.useState(false);
  const [skuLocked, setSkuLocked] = React.useState(false);
  const [skuDescription, setSkuDescription] = React.useState<string>("");
  const [edpNotFound, setEdpNotFound] = React.useState(false);
  const [optimalRec, setOptimalRec] = React.useState<any>(null);
  const [optimalLoading, setOptimalLoading] = React.useState(false);
  const [skuChamferEdgeLength, setSkuChamferEdgeLength] = React.useState<number | null>(null);

  // Quote modals — shared customer form, separate open/status per product
  const [quoteForm, setQuoteForm] = React.useState({ name: "", company: "", email: "", phone: "", qty: "", tolerance: "H7", notes: "" });
  const [showQuote, setShowQuote] = React.useState(false);
  const [quoteSending, setQuoteSending] = React.useState(false);
  const [quoteSent, setQuoteSent] = React.useState(false);
  const [showDrillQuote, setShowDrillQuote] = React.useState(false);
  const [drillQuoteSending, setDrillQuoteSending] = React.useState(false);
  const [drillQuoteSent, setDrillQuoteSent] = React.useState(false);
  const [showTmQuote, setShowTmQuote] = React.useState(false);
  const [tmQuoteSending, setTmQuoteSending] = React.useState(false);
  const [tmQuoteSent, setTmQuoteSent] = React.useState(false);

  // Keep WOC/DOC inch displays in sync when diameter changes (skip if no dia yet)
  React.useEffect(() => {
    if (!form.tool_dia) return;
    if (form.woc_pct) setWocText(((form.woc_pct / 100) * form.tool_dia).toFixed(4));
    if (form.doc_xd) setDocText((form.doc_xd * form.tool_dia).toFixed(3));
  }, [form.tool_dia]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNum =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = Number(e.target.value);
      setForm((p) => ({
        ...p,
        [key]: Number.isFinite(n) ? (n as any) : p[key],
      }));
    };

  const onStr =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((p) => ({ ...p, [key]: e.target.value as any }));
    };

  const [formDirty, setFormDirty] = React.useState(false);
  const [runWarnings, setRunWarnings] = React.useState<string[]>([]);

  // Auto-populate keyseat cut pass depth when both diameters are known
  React.useEffect(() => {
    if (operation === "keyseat" && form.tool_dia > 0 && form.keyseat_arbor_dia > 0 && form.doc_xd <= 0) {
      const fluteReach = (form.tool_dia - form.keyseat_arbor_dia) / 2;
      const suggestedDoc = fluteReach / 2;
      setForm((p) => ({ ...p, doc_xd: suggestedDoc / p.tool_dia }));
    }
  }, [operation, form.tool_dia, form.keyseat_arbor_dia]); // eslint-disable-line react-hooks/exhaustive-deps


  // Mark dirty whenever form changes after a successful run
  React.useEffect(() => {
    if (mentor.data) setFormDirty(true);
    setRunWarnings([]);
  }, [form]); // eslint-disable-line react-hooks/exhaustive-deps

  // EDP# debounced search
  React.useEffect(() => {
    if (!edpText.trim() || skuLocked) { setSkuResults([]); setSkuDropdownOpen(false); setEdpNotFound(false); return; }
    setEdpNotFound(false); // reset while user is still typing
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/skus?q=${encodeURIComponent(edpText.trim())}`);
        const data: SkuRecord[] = await r.json();
        setSkuResults(data);
        setSkuDropdownOpen(data.length > 0);
        setEdpNotFound(data.length === 0);
      } catch { setSkuResults([]); setEdpNotFound(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [edpText, skuLocked]);

  function applySkuToForm(sku: SkuRecord) {
    // Parse corner_condition: "square" | "ball" | number (CR in inches)
    const skuToolType = (sku.tool_type ?? "endmill").toLowerCase();
    const isChamfer = skuToolType === "chamfer_mill";
    const cc = sku.corner_condition;
    const ccStr = String(cc ?? "square").toLowerCase();
    const isBall = ccStr === "ball" || skuToolType === "ballnose";
    const crIn = (!isBall && cc !== undefined && cc !== "square" && Number(cc) > 0) ? Number(cc) : 0;
    const corner_condition = isBall ? "ball" : crIn > 0 ? "corner_radius" : "square";
    const form_tool_type = isBall ? "ballnose" : isChamfer ? "chamfer_mill" : crIn > 0 ? "corner_radius" : "endmill";

    // Default stickout: LOC + flute_wash + 0.5×D — keeps flutes clear of the holder
    const _dia = Number(sku.cutting_diameter_in);
    const _loc = Number(sku.loc_in);
    const _fw  = Number(sku.flute_wash ?? 0);
    const defaultStickout = Math.ceil((_loc + _fw + 0.33 * _dia) * 200) / 200;

    setEdpText(sku.EDP ?? (sku as any).edp ?? "");
    setSkuDescription([sku.description1, sku.description2].filter(Boolean).join(" — ") || sku.description || "");
    setSkuDropdownOpen(false);
    setSkuResults([]);
    setSkuLocked(true);
    setDocText("");
    setDocPreset(null);
    setToolDiaText(Number(sku.cutting_diameter_in).toFixed(4));
    setLocText(Number(sku.loc_in).toFixed(3));
    setStickoutText(defaultStickout.toFixed(3));
    setLbsText(sku.lbs_in ? Number(sku.lbs_in).toFixed(3) : "");
    setCrText(crIn > 0 ? crIn.toFixed(4) : "");
    if (isChamfer) {
      setChamferTipDiaText(sku.tip_diameter ? Number(sku.tip_diameter).toFixed(4) : "");
      setChamferDepthText("");
    }
    setForm((p) => ({
      ...p,
      edp: String(sku.EDP ?? (sku as any).edp ?? ""),
      tool_dia: Number(sku.cutting_diameter_in),
      doc_xd: 0,
      flutes: Number(sku.flutes),
      loc: Number(sku.loc_in),
      lbs: sku.lbs_in ? Number(sku.lbs_in) : 0,
      corner_condition,
      tool_type: form_tool_type as any,
      corner_radius: crIn,
      geometry: sku.geometry ?? "standard",
      variable_pitch: sku.variable_pitch ?? false,
      variable_helix: sku.variable_helix ?? false,
      shank_dia: Number(sku.shank_dia_in ?? 0),
      stickout: defaultStickout,
      tool_series: sku.series ?? "",
      helix_angle: Number(sku.helix ?? 0),
      coating: String(sku.coating ?? ""),
      ...(isChamfer ? {
        chamfer_angle: Number(sku.chamfer_angle ?? 90),
        chamfer_tip_dia: Number(sku.tip_diameter ?? 0),
        chamfer_depth: 0,
        chamfer_series: String(sku.series ?? "").toUpperCase().startsWith("CMS") ? "CMS" as const : "CMH" as const,
      } : {}),
    }));
    setSkuChamferEdgeLength(isChamfer ? 1 : null); // just a truthy flag — values computed from geometry
  }

  function clearSku() {
    setSkuLocked(false);
    setSkuDescription("");
    setOptimalRec(null);
    setEdpText("");
    setSkuResults([]);
    setSkuDropdownOpen(false);
    setSkuChamferEdgeLength(null);
    setEdpNotFound(false);
  }

  function resetAll() {
    setForm(INITIAL_FORM);
    setIsoCategory("P");
    setOperation("milling");
    setWocPreset("med");
    setDocPreset("med");
    setWocText("");
    setDocText("");
    setCrText("");
    setToolDiaText("");
    setLocText("");
    setLbsText("");
    setHolderGageText("");
    setHolderNoseDiaText("");
    setExistingHoleText("");
    setTargetHoleText("");
    setDrillFluteLenText("");
    setDrillHoleDepthText("");
    setStepDiaTexts([]);
    setStepLenTexts([]);
    setChamferTipDiaText("");
    setChamferDepthText("");
    setTmMajorDiaText("");
    setTmTpiText("");
    setTmPitchMmText("");
    setTmEngText("");
    setTmNeckText("");
    setTmGcodeExpanded(false);
    clearSku();
    setFormDirty(false);
    mentor.reset();
  }

  function getCoatingRec(cat: string): { code: string; desc: string } {
    if (cat === "N" || cat === "O") return { code: "Uncoated or D-MAX", desc: "non-ferrous / plastics & composites" };
    if (cat === "P" || cat === "K") return { code: "P-MAX", desc: "steel & cast iron" };
    return { code: "T-MAX", desc: "stainless, superalloys & hardened" };
  }

  function getMillingCoatings(cat: string): { coatings: string[]; note: string } {
    if (cat === "N") return { coatings: ["D-MAX"], note: "non-ferrous / aluminum" };
    if (cat === "O") return { coatings: ["D-MAX"], note: "plastics & composites — polished uncoated or DLC; avoid TiAlN" };
    if (cat === "P") return { coatings: ["A-MAX", "P-MAX"], note: "steel" };
    if (cat === "K") return { coatings: ["A-MAX", "P-MAX", "T-MAX", "C-MAX"], note: "cast iron" };
    if (cat === "M") return { coatings: ["A-MAX", "P-MAX", "T-MAX", "C-MAX"], note: "stainless" };
    if (cat === "S") return { coatings: ["A-MAX", "P-MAX", "T-MAX", "C-MAX"], note: "superalloys & titanium" };
    if (cat === "H") return { coatings: ["T-MAX", "C-MAX"], note: "hardened steel" };
    return { coatings: ["P-MAX"], note: "" };
  }

  const runRef = React.useRef<() => Promise<void>>(async () => {});
  // Keep ref in sync so deferred calls always use the latest form state
  React.useEffect(() => { runRef.current = run; });

  const run = async () => {
    // Customer mode lock — must have an EDP or CC print PDF
    if (!engMode && !skuLocked && !pdfExtracted) {
      setRunWarnings(["Enter a Core Cutter EDP# or upload a CC print PDF to run the calculator."]);
      return;
    }
    // Pre-flight validation — show friendly inline warnings instead of a red crash
    const missing: string[] = [];
    if (!(form.machine_hp > 0)) missing.push("Machine HP");
    if (!(form.max_rpm > 0)) missing.push("Max RPM");
    if (!(form.tool_dia > 0)) missing.push("Tool Diameter");
    if (form.tool_type === "chamfer_mill") {
      if (!(form.flutes > 0)) missing.push("Flute Count");
      if (!(form.chamfer_angle > 0)) missing.push("Chamfer Angle");
      if (!(form.chamfer_depth > 0)) missing.push("Chamfer Depth");
    } else if (operation === "milling" || operation === "feedmilling") {
      if (!form.mode) missing.push("Process (HEM / Conventional / Slot…)");
      if (!(form.flutes > 0)) missing.push("Flute Count");
      if (form.mode === "circ_interp") {
        if (!(form.doc_xd > 0)) missing.push("Bore Depth");
      } else {
        if (!(form.doc_xd > 0)) missing.push("Depth of Cut (DOC)");
      }
      if (!(form.woc_pct > 0)) missing.push("Width of Cut (WOC)");
    }
    if (operation === "drilling" && !(form.drill_hole_depth > 0)) missing.push("Hole Depth");
    if (operation === "reaming" && !(form.ream_pre_drill_dia > 0) && !(form.existing_hole_dia > 0)) missing.push("Pre-Drill / Existing Hole Diameter");
    if (missing.length > 0) {
      setRunWarnings(missing);
      return;
    }

    // Slotting safety block — chip packing risk with too many flutes
    if ((operation === "milling" || operation === "feedmilling") && form.mode === "slot") {
      const fl = form.flutes;
      const isHardened50Plus =
        form.material === "hardened_gt55" ||
        (form.hardness_scale === "hrc" && form.hardness_value >= 50);
      // Flute count limits for traditional slotting
      if (fl >= 6) {
        setRunWarnings([`Traditional slotting is not recommended with ${fl} flutes — chip packing will break the tool. Use 2–5 flutes for slotting.`]);
        return;
      }
      if (fl === 5 && form.doc_xd > 0.5) {
        setRunWarnings([`5-flute slotting is limited to 0.5×D DOC maximum for chip clearance. Reduce axial depth or use a 2–4 flute tool for 1×D DOC.`]);
        return;
      }
      if (fl <= 4 && form.doc_xd > 1.0) {
        setRunWarnings([`Slotting DOC is limited to 1×D maximum. Reduce axial depth.`]);
        return;
      }
      // Hardened material conventional slotting — strict DOC limits
      if (isHardened50Plus && fl > 0) {
        if (fl === 5 && form.doc_xd > 0.10) {
          setRunWarnings([`5-flute slotting in hardened material (≥50 HRC) is limited to 10% DOC (0.10×D) maximum. Reduce axial depth or switch to a 4-flute tool at 15% DOC max.`]);
          return;
        }
        if (fl <= 4 && form.doc_xd > 0.15) {
          setRunWarnings([`Slotting in hardened material (≥50 HRC) is limited to 15% DOC (0.15×D) maximum with a 4-flute tool. Reduce axial depth.`]);
          return;
        }
      }
    }

    // Hardened material block — 50 HRC+ requires 6+ flutes (non-slotting)
    if ((operation === "milling" || operation === "feedmilling") && form.mode !== "slot") {
      const isHardened50Plus =
        form.material === "hardened_gt55" ||
        (form.hardness_scale === "hrc" && form.hardness_value >= 50);
      const fl = form.flutes;
      if (isHardened50Plus && fl > 0 && fl < 6) {
        setRunWarnings([`Milling hardened material at ≥50 HRC requires 6 or more flutes for adequate edge strength and surface finish. Select a 6-flute (or higher) tool.`]);
        return;
      }
    }

    setRunWarnings([]);
    setErStatus("idle");
    setErError("");
    try {
      const runResult: any = await mentor.mutateAsync({
        ...form,
        flutes: operation === "reaming" ? reamFlutes(form.tool_dia) : (form.flutes > 0 ? form.flutes : 2),
        stickout: form.stickout || form.loc * 1.25,
        debug: false,
      });
      setFormDirty(false);
      setOptimalRec(null);
      // Fetch optimal tool recommendation if a specific EDP is locked
      const isQtr3 = /^qtr3/i.test(form.tool_series ?? "");
      if (skuLocked && edpText && form.tool_type !== "chamfer_mill" && !isQtr3) {
        setOptimalLoading(true);
        try {
          const optPayload = {
            ...form,
            flutes: operation === "reaming" ? reamFlutes(form.tool_dia) : (form.flutes > 0 ? form.flutes : 2),
            stickout: form.stickout || form.loc * 1.25,
          };
          const r = await fetch("/api/optimal-tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              current_edp: edpText,
              payload: optPayload,
              current_mrr:          runResult?.customer?.mrr_in3_min ?? null,
              current_feed_ipm:     runResult?.customer?.feed_ipm ?? null,
              current_stability_pct: runResult?.stability?.deflection_pct ?? null,
            }),
          });
          if (r.ok) {
            const rec = await r.json();
            if (rec.found) setOptimalRec(rec);
          }
        } catch { /* silently skip */ }
        setOptimalLoading(false);
      }
    } catch (e: any) {
      // Server-side error — shown inline in the error box below the button
    }
  };

  const result: any = mentor.data;
  const customer = result?.customer ?? null;

  // Auto-cap keyseat pass depth when result flags it as aggressive, then re-run
  const autoCorrectingRef = React.useRef(false);
  React.useEffect(() => {
    const mp = result?.keyseat?.multi_pass;
    if (mp?.aggressive && mp.max_safe_doc_in > 0 && !autoCorrectingRef.current) {
      autoCorrectingRef.current = true;
      setForm((p) => p.tool_dia > 0 ? { ...p, doc_xd: mp.max_safe_doc_in / p.tool_dia } : p);
      toast({ title: "Pass depth auto-corrected", description: `Set to max safe depth of ${mp.max_safe_doc_in.toFixed(4)}" — re-running.`, variant: "default" });
      setTimeout(() => { autoCorrectingRef.current = false; }, 2000);
    }
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const printSummary = () => {
    const r = result;
    if (!r) return;
    const cust  = r.customer    ?? null;
    const eng   = r.engineering ?? null;
    const stab  = r.stability   ?? null;
    const drill = r.drilling    ?? null;
    const ream  = r.reaming     ?? null;
    // milling params live in customer (when not drill/ream)
    const mil   = (!drill && !ream && cust?.rpm) ? cust : null;
    const nowDt = new Date();
    const now = nowDt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) + "  " + nowDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const matLabel = ISO_SUBCATEGORIES.find(s => s.key === form.material)?.label ?? form.material.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const MODE_LABELS: Record<string, string> = {
      hem: "Roughing — HEM", traditional: "Roughing — Traditional", finish: "Finishing",
      face: "Facing (Planar Milling)", slot: "Slotting", trochoidal: "Roughing — HEM", circ_interp: "Circular Interpolation",
    };
    const baseOpLabel = operation === "milling" ? "Milling" : operation === "drilling" ? "Drilling" : operation === "reaming" ? "Reaming" : operation === "threadmilling" ? "Thread Milling" : operation.charAt(0).toUpperCase() + operation.slice(1);
    const opLabel = operation === "milling" ? (MODE_LABELS[form.mode] ?? baseOpLabel) : baseOpLabel;
    const modeLabel = MODE_LABELS[form.mode] ?? form.mode.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    const row = (label: string, value: string | null | undefined) =>
      value ? `<tr><td class="lbl">${label}</td><td class="val">${value}</td></tr>` : "";

    const isBlank = (v: string | null | undefined) =>
      !v || v === "—" || /^0+\.?0*["x×%]?$/.test(v.trim());
    const kpiBox = (label: string, value: string | null | undefined) =>
      !isBlank(value) ? `<div class="kpi"><div class="kpi-val">${value}</div><div class="kpi-lbl">${label}</div></div>` : "";

    const milSection = mil ? `
      <div class="kpi-grid">
        ${kpiBox("RPM", mil.rpm ? Math.round(mil.rpm).toLocaleString() : null)}
        ${kpiBox("SFM", mil.sfm != null ? mil.sfm.toFixed(0) : null)}
        ${kpiBox("Feed (IPM)", mil.feed_ipm != null ? mil.feed_ipm.toFixed(2) : null)}
        ${kpiBox("FPT (in)", mil.fpt != null ? mil.fpt.toFixed(5) : null)}
        ${kpiBox("Adj FPT (in)", mil.adj_fpt != null ? mil.adj_fpt.toFixed(5) : null)}
        ${kpiBox(form.mode === "face" ? "Step-Over (in)" : "WOC (in)", mil.woc_in != null ? `${mil.woc_in.toFixed(4)}" (${((mil.woc_in / (form.tool_dia || 0.5)) * 100).toFixed(1)}%)` : null)}
        ${kpiBox(form.mode === "face" ? "Pass Depth (in)" : "DOC (in)", mil.doc_in != null ? `${mil.doc_in.toFixed(4)}" (${(mil.doc_in / (form.tool_dia || 0.5)).toFixed(2)}xD)` : null)}
        ${kpiBox("MRR (in³/min)", mil.mrr_in3_min != null ? mil.mrr_in3_min.toFixed(4) : null)}
        ${kpiBox("HP Required", mil.hp_required != null ? mil.hp_required.toFixed(2) : null)}
        ${(() => {
          if (form.mode !== "face" || mil.ra_actual_uin == null) return "";
          const raUin = mil.ra_actual_uin;
          const target = form.target_ra_uin;
          const capped = mil.ra_feed_capped;
          const label = `${raUin.toFixed(1)} µin${target > 0 ? ` ✓ target ${target}` : ""}${capped ? " (feed capped)" : ""}`;
          return kpiBox("Theoretical Ra", label);
        })()}
      </div>` : drill ? `
      <div class="kpi-grid">
        ${kpiBox("RPM", drill.rpm != null ? drill.rpm.toLocaleString() : null)}
        ${kpiBox("SFM", drill.sfm != null ? drill.sfm.toFixed(0) : null)}
        ${kpiBox("Feed (IPM)", drill.ipm != null ? drill.ipm.toFixed(3) : null)}
        ${kpiBox("IPR", drill.ipr != null ? drill.ipr.toFixed(5) : null)}
        ${kpiBox("HP Required", drill.hp_required != null ? drill.hp_required.toFixed(2) : null)}
        ${kpiBox("Depth / D", drill.depth_to_dia != null ? `${drill.depth_to_dia.toFixed(1)}×` : null)}
      </div>
      ${drill.cycle ? `<div style="margin:6px 0 4px;font-size:10px;"><strong>Recommended Cycle:</strong> ${drill.cycle}${drill.peck_depth_in != null ? ` — Peck Q=${drill.peck_depth_in.toFixed(4)}"` : ""}${drill.cycle_note ? `<br><span style="color:#666">${drill.cycle_note}</span>` : ""}</div>` : ""}
      ${drill.peck_schedule?.length > 0 ? `
        <div style="margin:4px 0 6px;font-size:10px;">
          <strong>Pecking Optimizer</strong> <span style="color:#666;font-weight:normal">— decrease peck depth as hole deepens</span><br>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
            ${drill.peck_schedule.map((q: number, i: number) =>
              `<div style="border:1px solid #a5b4fc;border-radius:4px;padding:3px 8px;text-align:center;font-size:10px;">
                <div style="color:#6366f1;font-size:9px;">Peck ${i + 1}${i === drill.peck_schedule.length - 1 ? "+" : ""}</div>
                <div style="font-weight:700;">${q.toFixed(4)}"</div>
              </div>`
            ).join("")}
          </div>
        </div>` : ""}
      ` : ream ? `
      <div class="kpi-grid">
        ${kpiBox("RPM", ream.rpm != null ? ream.rpm.toLocaleString() : null)}
        ${kpiBox("SFM", ream.sfm != null ? ream.sfm.toFixed(0) : null)}
        ${kpiBox("Feed (IPM)", ream.ipm != null ? ream.ipm.toFixed(3) : null)}
        ${kpiBox("IPR", ream.ipr != null ? ream.ipr.toFixed(5) : null)}
        ${kpiBox("HP Required", ream.hp_required != null ? ream.hp_required.toFixed(2) : null)}
      </div>` : "";

    const em = result?.entry_moves;
    const emFeedPct = em?.entry_feed_pct ?? 50;
    const emCaution = em?.entry_caution ?? null;
    const sweepRows = (em && entryTypes.includes("sweep")) ? `
        <tr><td colspan="2" style="padding:3px 0 1px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#16a34a;border-bottom:1px solid #16a34a40;">Sweep / Roll-in ★ Recommended</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;width:40%">Arc Radius (min)</td><td style="font-weight:600;">${(em.sweep_arc_radius_min_in ?? (form.tool_dia ?? 0) * 0.50).toFixed(4)}"</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Arc Radius (rec)</td><td style="font-weight:600;color:#16a34a;">${(em.sweep_arc_radius_rec_in ?? (form.tool_dia ?? 0) * 0.75).toFixed(4)}"</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Entry Feed</td><td style="font-weight:600;">${(em.sweep_entry_ipm ?? em.standard_ramp_ipm).toFixed(1)} IPM <span style="color:#888;font-weight:400;">(${emFeedPct}%)</span></td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Full Feed (after arc)</td><td style="font-weight:600;color:#16a34a;">${(em.sweep_full_ipm ?? result?.milling?.feed_ipm ?? 0).toFixed(1)} IPM</td></tr>` : "";
    const rampRows = (em && entryTypes.includes("ramp")) ? `
        <tr><td colspan="2" style="padding:${sweepRows ? "6px" : "3px"} 0 1px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6366f1;border-bottom:1px solid #6366f140;">Ramp Entry</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;width:40%">Max Ramp Angle</td><td style="font-weight:600;">≤${em.ramp_angle_deg}°</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Standard Feed</td><td style="font-weight:600;">${em.standard_ramp_ipm.toFixed(1)} IPM</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Advanced Feed</td><td style="font-weight:600;color:#818cf8;">${em.advanced_ramp_ipm.toFixed(1)} IPM <span style="color:#888;font-weight:400;">(0.5–1°, chip-thinning)</span></td></tr>` : "";
    const helixRows = (em && entryTypes.includes("helical")) ? `
        <tr><td colspan="2" style="padding:${(sweepRows || rampRows) ? "6px" : "3px"} 0 1px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6366f1;border-bottom:1px solid #6366f140;">Helical Entry</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Min Bore Dia</td><td style="font-weight:600;">≥${em.helix_bore_min_in.toFixed(4)}"</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Ideal Bore Dia</td><td style="font-weight:600;">${em.helix_bore_ideal_low.toFixed(4)}" – ${em.helix_bore_ideal_high.toFixed(4)}"</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Standard Feed</td><td style="font-weight:600;">${em.standard_helix_ipm.toFixed(1)} IPM &nbsp;·&nbsp; ${em.helix_pitch_in.toFixed(5)}" / rev &nbsp;@&nbsp; ${em.helix_angle_deg.toFixed(2)}°</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Advanced Feed</td><td style="font-weight:600;color:#818cf8;">${em.advanced_helix_ipm.toFixed(1)} IPM &nbsp;·&nbsp; ${((em as any).adv_helix_pitch_in ?? em.helix_pitch_in).toFixed(5)}" / rev &nbsp;@&nbsp; ${((em as any).adv_helix_angle_deg ?? em.helix_angle_deg).toFixed(2)}°</td></tr>` : "";
    const straightRows = (em && entryTypes.includes("straight")) ? `
        <tr><td colspan="2" style="padding:6px 0 1px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#d97706;border-bottom:1px solid #d9770640;">Straight-In Entry</td></tr>
        <tr><td style="color:#888;padding:2px 8px 2px 0;">Entry Feed</td><td style="font-weight:600;">${(em.straight_entry_ipm ?? em.standard_ramp_ipm).toFixed(1)} IPM <span style="color:#888;font-weight:400;">(${emFeedPct}%)</span></td></tr>` : "";
    const entrySection = (mil && em && (sweepRows || rampRows || helixRows || straightRows)) ? `
      <h3>Entry Moves</h3>
      ${emCaution ? `<p style="font-size:9px;padding:4px 6px;border-radius:4px;margin-bottom:6px;background:${emCaution === "high_hardness" ? "#450a0a" : "#451a03"};color:${emCaution === "high_hardness" ? "#fca5a5" : "#fcd34d"};">⚠ ${emCaution === "high_hardness" ? `Hard material (≥55 HRC): entry feed reduced to ${emFeedPct}% — do not skip arc lead-in.` : `Medium-hard material: entry feed reduced to ${emFeedPct}% of full feed.`}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:6px;">
        ${sweepRows}${rampRows}${helixRows}${straightRows}
      </table>` : "";

    const tic = eng?.teeth_in_cut ?? null;
    const ticZone = tic == null ? null : tic < 1.0 ? "low" : tic >= 1.5 && tic <= 2.5 ? "sweet" : tic > 2.5 ? "high" : "ok";
    const ticZoneLabel = ticZone === "sweet" ? "Sweet Spot ✓" : ticZone === "ok" ? "Acceptable" : ticZone === "low" ? "Too Low" : "Too High";
    const ticZoneColor = ticZone === "sweet" ? "#166534" : ticZone === "ok" ? "#854d0e" : ticZone === "low" ? "#991b1b" : "#9a3412";
    const ticZoneBg   = ticZone === "sweet" ? "#f0fdf4" : ticZone === "ok" ? "#fefce8" : ticZone === "low" ? "#fef2f2" : "#fff7ed";
    const ticTip = tic == null ? "" : ticZone === "sweet" ? "" :
      ticZone === "low" ? "Increase WOC% or add a flute to get more teeth engaged." :
      ticZone === "ok"  ? `Bump WOC% slightly${form.flutes < 7 ? ` or try ${form.flutes + 1} flutes` : ""} to enter the Sweet Spot (1.5–2.5 teeth).` :
      `Reduce WOC% or use fewer flutes.`;
    const maxDisplay = 4.0;
    const pctBar = (v: number) => `${Math.min(100, (v / maxDisplay) * 100).toFixed(1)}%`;
    const ticGauge = tic != null && form.mode !== "face" && form.mode !== "circ_interp" && form.mode !== "slot" ? `
      <div style="margin:8px 0 4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;">Tooth Engagement</span>
          <span style="font-size:10px;font-weight:700;color:${ticZoneColor};background:${ticZoneBg};padding:2px 7px;border-radius:4px;">${tic.toFixed(2)} teeth — ${ticZoneLabel}</span>
        </div>
        <div style="position:relative;height:14px;border-radius:7px;background:linear-gradient(to right,#ef4444 0%,#ef4444 ${pctBar(1.0)},#eab308 ${pctBar(1.0)},#eab308 ${pctBar(1.5)},#22c55e ${pctBar(1.5)},#22c55e ${pctBar(2.5)},#f97316 ${pctBar(2.5)},#f97316 100%);-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <div style="position:absolute;top:0;bottom:0;width:3px;background:#111;left:calc(${pctBar(tic)} - 1px);border-radius:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        </div>
        <div style="position:relative;height:14px;">
          <div style="position:absolute;transform:translateX(-50%);left:${pctBar(tic)};font-size:9px;font-weight:700;color:#111;white-space:nowrap;">${tic.toFixed(2)}</div>
        </div>
        <div style="position:relative;height:14px;font-size:8px;margin-top:2px;">
          <span style="position:absolute;left:calc(${pctBar(0.5)});transform:translateX(-50%);color:#ef4444;font-weight:600;white-space:nowrap;">Too Low</span>
          <span style="position:absolute;left:calc((${pctBar(1.0)} + ${pctBar(1.5)}) / 2);transform:translateX(-50%);color:#eab308;font-weight:600;white-space:nowrap;">Acceptable</span>
          <span style="position:absolute;left:calc((${pctBar(1.5)} + ${pctBar(2.5)}) / 2);transform:translateX(-50%);color:#22c55e;font-weight:700;white-space:nowrap;">Sweet Spot</span>
          <span style="position:absolute;left:calc((${pctBar(2.5)} + 100%) / 2);transform:translateX(-50%);color:#f97316;font-weight:600;white-space:nowrap;">Too High</span>
        </div>
        ${ticTip ? `<p style="font-size:9px;color:#555;margin-top:4px;">→ ${ticTip}</p>` : ""}
      </div>` : "";

    const printWocFrac = (form.woc_pct ?? 0) / 100;
    const printEngAngleDeg = printWocFrac > 0
      ? 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 2 * printWocFrac))) * (180 / Math.PI)
      : null;
    const printEngZone = printEngAngleDeg == null ? null
      : printEngAngleDeg < 90 ? "light" : printEngAngleDeg < 180 ? "moderate" : printEngAngleDeg < 270 ? "heavy" : "extreme";
    const printEngZoneLabel = printEngZone === "light" ? "Light" : printEngZone === "moderate" ? "Moderate" : printEngZone === "heavy" ? "Heavy" : printEngZone === "extreme" ? "Extreme" : "";
    const printEngZoneColor = (printEngZone === "light" || printEngZone === "moderate") ? "#166534" : printEngZone === "heavy" ? "#9a3412" : "#991b1b";
    const printEngZoneBg = (printEngZone === "light" || printEngZone === "moderate") ? "#f0fdf4" : printEngZone === "heavy" ? "#fff7ed" : "#fef2f2";
    const printEngTip = printEngZone === "light" ? "Light radial engagement — consider increasing WOC% for better MRR."
      : printEngZone === "heavy" ? "Heavy engagement — monitor heat buildup and chip evacuation."
      : printEngZone === "extreme" ? "Near-full slot — reduce WOC% to extend tool life."
      : "";
    const pctEng = (v: number) => `${Math.min(100, (v / 360) * 100).toFixed(1)}%`;
    const engAngleGauge = printEngAngleDeg != null && form.tool_type !== "chamfer_mill" && form.mode !== "face" && form.mode !== "circ_interp" ? `
      <div style="margin:8px 0 4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;">Engagement Angle</span>
          <span style="font-size:10px;font-weight:700;color:${printEngZoneColor};background:${printEngZoneBg};padding:2px 7px;border-radius:4px;">${printEngAngleDeg.toFixed(1)}° — ${printEngZoneLabel}</span>
        </div>
        <div style="position:relative;height:14px;border-radius:7px;background:linear-gradient(to right,#22c55e 0%,#22c55e ${pctEng(90)},#eab308 ${pctEng(90)},#eab308 ${pctEng(180)},#f97316 ${pctEng(180)},#f97316 ${pctEng(270)},#ef4444 ${pctEng(270)},#ef4444 100%);-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <div style="position:absolute;top:0;bottom:0;width:3px;background:#111;left:calc(${pctEng(printEngAngleDeg)} - 1px);border-radius:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        </div>
        <div style="position:relative;height:14px;">
          <div style="position:absolute;transform:translateX(-50%);left:${pctEng(printEngAngleDeg)};font-size:9px;font-weight:700;color:#111;white-space:nowrap;">${printEngAngleDeg.toFixed(1)}°</div>
        </div>
        <div style="position:relative;height:14px;font-size:8px;margin-top:2px;">
          <span style="position:absolute;left:${pctEng(45)};transform:translateX(-50%);color:#166534;font-weight:600;white-space:nowrap;">Light</span>
          <span style="position:absolute;left:calc((${pctEng(90)} + ${pctEng(180)}) / 2);transform:translateX(-50%);color:#ca8a04;font-weight:600;white-space:nowrap;">Moderate</span>
          <span style="position:absolute;left:calc((${pctEng(180)} + ${pctEng(270)}) / 2);transform:translateX(-50%);color:#f97316;font-weight:600;white-space:nowrap;">Heavy</span>
          <span style="position:absolute;left:calc((${pctEng(270)} + 100%) / 2);transform:translateX(-50%);color:#ef4444;font-weight:600;white-space:nowrap;">Extreme</span>
        </div>
        ${printEngTip ? `<p style="font-size:9px;color:#555;margin-top:4px;">→ ${printEngTip}</p>` : ""}
      </div>` : "";

    const engSection = eng ? `
      <h3>Engineering Data</h3>
      <div class="kpi-grid">
        ${kpiBox("Force (lbf)", eng.force_lbf != null ? eng.force_lbf.toFixed(0) : null)}
        ${kpiBox("Torque (in-lbf)", eng.torque_in_lbf != null ? eng.torque_in_lbf.toFixed(1) : null)}
        ${kpiBox("Deflection (in)", eng.deflection_in != null ? eng.deflection_in.toFixed(6) : null)}
        ${kpiBox("Chip Thick (in)", eng.chip_thickness_in != null ? eng.chip_thickness_in.toFixed(6) : null)}
        ${form.mode !== "face" && form.mode !== "circ_interp" ? kpiBox("Teeth in Cut", tic != null ? tic.toFixed(2) : null) : ""}
        ${printEngAngleDeg != null && form.tool_type !== "chamfer_mill" && form.mode !== "face" && form.mode !== "circ_interp" ? kpiBox("Eng Angle (°)", printEngAngleDeg.toFixed(1)) : ""}
      </div>
      ${ticGauge}
      ${engAngleGauge}
      ${form.mode === "face" ? `
      <div style="margin-top:10px;padding:8px 10px;border:1px solid #e55a00;border-radius:6px;background:#fff7f0;">
        <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#e55a00;margin-bottom:6px;">Facing / Planar Milling — Setup Notes</p>
        <ul style="font-size:9px;color:#333;line-height:1.6;padding-left:12px;">
          ${form.tool_dia > 0 && form.corner_radius > 0 ? `<li>Optimal stepover: (D − 2×CR) × 0.75 = <strong>${((form.tool_dia - 2 * form.corner_radius) * 0.75).toFixed(4)}"</strong> — wiper overlaps each pass by 25%</li>` : ""}
          ${form.corner_radius > 0 ? `<li>DOC must exceed CR (${form.corner_radius.toFixed(4)}") — below CR the wiper effect disappears and floor looks scalloped</li>` : ""}
          <li>0.005–0.020" finish DOC is normal — facing DOC is much shallower than peripheral milling</li>
          <li>Minimize stickout — #1 rule for facing. Full diameter engages; any deflection shows as flatness error</li>
          <li>Climb mill on finish pass — bi-directional OK for roughing, uni-directional on finish pass only</li>
          <li>Spring pass: re-run at zero Z offset, same direction — removes deflection bow from first pass</li>
          <li>Air blast over flood — chips under the wiper get smeared and streak the surface</li>
          <li>Axial runout &lt;0.0005" — Z-wobble leaves repeating witness arcs. Use shrink-fit or precision collet, check face TIR</li>
        </ul>
      </div>` : ""}
      ${form.mode === "circ_interp" ? `
      <div style="margin-top:10px;padding:8px 10px;border:1px solid #e55a00;border-radius:6px;background:#fff7f0;">
        <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#e55a00;margin-bottom:6px;">Circular Interpolation — Setup Notes</p>
        <ul style="font-size:9px;color:#333;line-height:1.6;padding-left:12px;">
          <li>Feed shown is tool centerline (CAM programmed feed) — peripheral cutting edge moves faster</li>
          <li>Use CCW direction for climb milling — conventional milling shortens tool life in bore work</li>
          <li>Leave 0.005–0.010" stock for a final light cleanup pass at reduced feed for bore tolerance</li>
          <li>Minimize stickout — bore work amplifies deflection into roundness error</li>
          <li>Never dwell at the bottom — marks the bore wall</li>
          <li>No pre-hole? Use helical interpolation entry in CAM — ramp feed typically 40–50% of lateral feed</li>
        </ul>
      </div>` : ""}
      ${eng.tool_life_min != null ? `<p style="font-size:9px;color:#555;margin-top:10px;">Est. tool life: <strong>${Math.round(eng.tool_life_min)} min (${(eng.tool_life_min / 60).toFixed(1)} hrs)</strong> of cutting time — varies with coating, runout, coolant &amp; machine condition. Estimate only, not a guarantee from Core Cutter LLC.</p>` : ""}
      ${(() => {
        if (form.mode !== "face" || mil?.ra_actual_uin == null) return "";
        const raUin = mil.ra_actual_uin;
        const target = form.target_ra_uin;
        const capped = mil.ra_feed_capped;
        const raDisclaimer = `<p style="font-size:8px;color:#888;font-style:italic;margin-top:3px;">Surface finish is theoretical. Actual results depend on spindle condition, toolholder accuracy, tool runout, workholding rigidity, chip evacuation, coolant delivery, and material lot variation. Estimate only — not a guarantee from Core Cutter.</p>`;
        if (capped && target > 0) {
          return `<p style="font-size:9px;color:#166534;background:#f0fdf4;padding:4px 6px;border-radius:4px;margin-top:4px;"><strong>Surface Finish:</strong> Feed capped to <strong>${mil.feed_ipm?.toFixed(2)} IPM</strong> to achieve Ra ≤ ${target} µin. Theoretical Ra: ${raUin.toFixed(1)} µin (${(raUin * 0.0254).toFixed(3)} µm).</p>${raDisclaimer}`;
        }
        return `<p style="font-size:9px;color:#555;margin-top:2px;">Theoretical Ra: <strong>${raUin.toFixed(1)} µin</strong> (${(raUin * 0.0254).toFixed(3)} µm)${target > 0 ? ` — meets ${target} µin target ✓` : ""}.</p>${raDisclaimer}`;
      })()}` : "";

    const stabSection = stab ? `
      <h3>Rigidity & Chatter Audit</h3>
      <p class="verdict ${stab.deflection_pct >= 175 ? "red" : stab.deflection_pct >= 100 ? "yellow" : "green"}">
        ${stab.deflection_pct >= 175 ? "High Chatter Risk" : stab.deflection_pct >= 100 ? "Chatter Risk" : "Setup Looks Stable"}
        — ${stab.deflection_pct?.toFixed(0)}% of safe limit · L/D ${stab.l_over_d?.toFixed(1)} · Stickout ${stab.stickout_in?.toFixed(3)}"
      </p>
      ${stab.suggestions?.filter((s: any) => s.type !== "info").length > 0 ? `
        <ol class="suggestions">
          ${stab.suggestions.filter((s: any) => s.type !== "info").map((s: any) =>
            `<li><strong>${s.label}</strong>${s.detail ? ` — ${s.detail}` : ""}${s.suggested_edps?.length ? ` <span class="edp">EDP# ${s.suggested_edps.join(", ")}</span>` : ""}</li>`
          ).join("")}
        </ol>` : ""}` : "";

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; background: #fff; padding: 24px 32px; }
  .header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; border-bottom: 2px solid #e55a00; padding-bottom: 12px; margin-bottom: 16px; gap: 12px; }
  .header img { height: 44px; width: auto; justify-self: start; }
  .header-center { text-align: center; color: #555; font-size: 10px; }
  .header-center strong { font-size: 13px; color: #111; display: block; }
  .header-contact { text-align: right; font-size: 10px; color: #555; line-height: 1.6; justify-self: end; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #e55a00; border-bottom: 1px solid #eee; padding-bottom: 4px; margin: 14px 0 8px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin: 12px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .lbl { color: #555; width: 45%; padding: 2px 0; }
  .val { font-weight: 600; padding: 2px 0; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
  .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; }
  .kpi-val { font-size: 14px; font-weight: 700; }
  .kpi-lbl { font-size: 9px; color: #666; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em; }
  .verdict { padding: 6px 10px; border-radius: 4px; font-weight: 600; font-size: 11px; margin-bottom: 8px; }
  .verdict.green { background: #f0fdf4; color: #166534; }
  .verdict.yellow { background: #fefce8; color: #854d0e; }
  .verdict.red { background: #fef2f2; color: #991b1b; }
  .suggestions { padding-left: 18px; }
  .suggestions li { margin-bottom: 3px; }
  .edp { color: #b45309; font-weight: 700; }
  .disclaimer { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 9px; color: #888; line-height: 1.5; }
  h2 { page-break-after: avoid; }
  h3 { page-break-after: avoid; }
  .kpi-grid { page-break-inside: avoid; }
  .kpi { page-break-inside: avoid; }
  table { page-break-inside: avoid; }
  .verdict { page-break-inside: avoid; }
  .suggestions { page-break-inside: avoid; }
  .disclaimer { page-break-inside: avoid; }
  tr { page-break-inside: avoid; }
  @media print { body { padding: 12px 18px; } }
</style>
</head>
<body>
<div class="header">
  <div style="display:flex;align-items:center;gap:10px">
    <img src="${window.location.origin}/CCLogo-long-whiteback TRANSPARENT.png" alt="Core Cutter" style="height:40px;width:auto">
  </div>
  <div class="header-center">
    <strong>Produced with CoreCutCNC by Core Cutter LLC</strong>
    ${now}<br>
    ${opLabel}${mil && modeLabel !== opLabel ? ` · ${modeLabel}` : ""}
  </div>
  <div class="header-contact">
    120 Technology Drive<br>
    Gardiner, ME 04345<br>
    (p) 207-588-7519<br>
    sales@corecutterusa.com
  </div>
</div>

<h2>Setup</h2>
<table>
  ${form.edp ? row("EDP #", `<span class="edp">${form.edp}</span>${skuDescription ? ` &nbsp;—&nbsp; <span style="color:#444;font-weight:400;">${skuDescription}</span>` : ""}`) : ""}
  ${row("Material", matLabel + (form.hardness_value ? ` — ${form.hardness_value} ${form.hardness_scale?.toUpperCase() ?? "HRC"}` : ""))}
  ${row("Operation", opLabel)}
  ${row("Tool Diameter", `${form.tool_dia?.toFixed(4)}" (${(form.tool_dia * 25.4).toFixed(2)} mm)`)}
  ${row("Flute Count", `${form.flutes}-flute`)}
  ${form.loc ? row("LOC (in)", form.loc.toFixed(4) + '"') : ""}
  ${row("Corner Condition", form.corner_condition === "corner_radius" ? `CR ${form.corner_radius?.toFixed(4)}"` : form.corner_condition)}
  ${row("Flute Geometry", form.geometry ?? "standard")}
  ${form.stickout > 0 ? row("Tool Stickout (in)", `${form.stickout.toFixed(3)}"`) : ""}
  ${row("Machine", `${activeMachineName ? activeMachineName + " · " : ""}${form.machine_type?.toUpperCase()} · ${form.spindle_taper}${form.dual_contact ? " · Big-Plus Dual Contact" : ""} · ${form.toolholder?.replace(/_/g," ")}`)}
  ${row("Coolant", form.coolant?.replace(/_/g," "))}
  ${(() => {
    if (!drill && !ream) {
      if (form.coating) return row("Tool Coating", form.coating);
      const cr = getMillingCoatings(isoCategory);
      return row("Recommended Coating(s)", cr.coatings.join(" / ") + (cr.note ? " — " + cr.note : ""));
    } else {
      const cr = getCoatingRec(isoCategory);
      return row("Recommended Coating", cr.code + " — " + cr.desc);
    }
  })()}
</table>

<h2>Recommended Parameters</h2>
${milSection}
${entrySection}
${engSection}
${stabSection}

<div class="disclaimer">
  <strong>Disclaimer:</strong> These recommendations are generated by the Core Cutter Engineering Department and are intended as a starting point only. Actual speeds, feeds, and depths of cut should be adjusted based on machine condition, fixturing rigidity, material lot variation, coolant delivery, tool condition, and operator experience. Core Cutter LLC assumes no liability for damages arising from use of these parameters. Always start conservatively and adjust based on observed results. This is not a guarantee of performance.
  <span> · Developed by S. Tiehen</span>
  <br><strong>© ${new Date().getFullYear()} Core Cutter LLC. All Rights Reserved.</strong> CoreCutCNC is a proprietary tool of Core Cutter LLC. Unauthorized reproduction or distribution is prohibited.
</div>
<script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) { alert("Please allow popups for this site to print the summary."); return; }
    w.focus();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const downloadPDF = async () => {
    if (!result) return;
    // Re-use same HTML but strip the auto-print script
    const printBtn = document.querySelector("[data-print-trigger]") as HTMLButtonElement | null;
    // Generate the HTML by temporarily patching window.open to capture it
    let capturedHtml = "";
    const origOpen = window.open.bind(window);
    (window as any).open = (url: string) => {
      // fetch the blob content
      fetch(url).then(r => r.text()).then(t => { capturedHtml = t; });
      return { focus: () => {} };
    };
    printSummary();
    (window as any).open = origOpen;
    // Wait a tick for fetch
    await new Promise(r => setTimeout(r, 300));
    if (!capturedHtml) return;
    const bodyMatch = capturedHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const styleMatch = capturedHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    if (!bodyMatch) return;
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:fixed;left:-9999px;top:0;width:816px;background:#fff;font-family:Arial,sans-serif;font-size:11px;color:#111;";
    if (styleMatch) {
      const styleEl = document.createElement("style");
      styleEl.textContent = styleMatch[1];
      wrapper.appendChild(styleEl);
    }
    const content = document.createElement("div");
    content.innerHTML = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "");
    wrapper.appendChild(content);
    document.body.appendChild(wrapper);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const edp = (result as any)?.engineering?.edp || form.edp || "Summary";
      const date = new Date().toISOString().slice(0, 10);
      await html2pdf().set({
        margin: [8, 8, 8, 8],
        filename: `CoreCutter_${edp}_${date}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "letter", orientation: "portrait" },
      }).from(wrapper).save();
    } finally {
      document.body.removeChild(wrapper);
    }
  };
  const engineering = result?.engineering ?? null;
  const stability = result?.stability ?? null;
  const drillResult   = result?.drilling   ?? null;
  const reamResult    = result?.reaming    ?? null;
  const threadResult  = result?.thread_mill ?? null;
  const chamferResult = result?.chamfer    ?? null;
  const keyseatResult = result?.keyseat    ?? null;
  const dovetailResult = result?.dovetail  ?? null;

  // ── Machining Stability Index ─────────────────────────────────────────────
  function calcStabilityIndex(
    stab: typeof result.stability,
    eng: typeof result.engineering,
    cust: typeof result.customer,
  ): { overall: number; defl: number; load: number; chip: number; ld: number } | null {
    if (!stab && !eng && !cust) return null;
    // Deflection score (0–100): 0% deflection = 100, 100% = 50, 175%+ = 0
    const deflPct = stab?.deflection_pct ?? 0;
    const deflScore = Math.max(0, Math.min(100, deflPct < 100
      ? 100 - deflPct * 0.5
      : 50 - (deflPct - 100) * (50 / 75)));
    // Machine load score — only include when HP data is available
    const hasMachineHp = (cust?.machine_hp ?? 0) > 0;
    const loadPct = cust?.spindle_load_pct ?? 0;
    const loadScore = hasMachineHp ? Math.max(0, Math.min(100, 100 - loadPct * 1.25)) : null;
    // Chip thickness score: below min fpt*0.30 = bad
    const ct = eng?.chip_thickness_in ?? null;
    const minCt = (cust?.fpt ?? 0) * 0.30;
    const chipScore = ct == null ? 75
      : minCt <= 0 ? 75
      : Math.max(0, Math.min(100, (ct / minCt) * 60));
    // L/D score: ≤3 = 100, 4 = 88, 5 = 72, 6 = 54, 7 = 36, 8+ = 15
    const ld = stab?.l_over_d ?? 3;
    const ldScore = Math.max(10, Math.min(100, 100 - Math.max(0, ld - 3) * 18));
    // Weight redistribution when machine HP not available
    const overall = loadScore !== null
      ? Math.round(deflScore * 0.30 + loadScore * 0.20 + chipScore * 0.25 + ldScore * 0.25)
      : Math.round(deflScore * 0.375 + chipScore * 0.3125 + ldScore * 0.3125);
    return {
      overall,
      defl:  Math.round(deflScore),
      load:  loadScore !== null ? Math.round(loadScore) : -1,
      chip:  Math.round(chipScore),
      ld:    Math.round(ldScore),
    };
  }

  const stabilityIndex = React.useMemo(() =>
    calcStabilityIndex(result?.stability, result?.engineering, result?.customer),
    [result]
  );

  const [camCopied, setCamCopied] = React.useState(false);
  function buildResultsText(): string | null {
    const L = (label: string, value: string) => `${(label + ":").padEnd(18)} ${value}`;
    const DIV = "────────────────────────────────────────";
    const cust   = result?.customer;
    const eng    = result?.engineering;
    const stab   = result?.stability;
    const em     = result?.entry_moves;
    const matLabel = ISO_SUBCATEGORIES.find(s => s.key === form.material)?.label ?? form.material ?? "—";

    const toolTypeLabel: Record<string, string> = {
      endmill: "Solid Carbide Endmill", ballnose: "Ball Nose Endmill",
      corner_radius: "Corner Radius Endmill", chamfer_mill: "Chamfer Mill",
    };
    const cornerLabel = form.corner_condition === "ball" ? "Ball Nose"
      : form.corner_condition === "corner_radius" ? `Corner Radius  ${form.corner_radius?.toFixed(4)}"`
      : "Square";
    const geoLabel: Record<string, string> = {
      standard: "Standard", chipbreaker: "Chipbreaker (CB)", truncated_rougher: "VXR Rougher",
    };
    const modeLabel: Record<string, string> = {
      hem: "Roughing — HEM", traditional: "Roughing — Traditional", finish: "Finishing",
      face: "Facing (Planar Milling)", slot: "Slotting",
      trochoidal: "Roughing — HEM", circ_interp: "Circular Interpolation",
    };
    const isRoughing = form.mode === "hem" || form.mode === "traditional" || form.mode === "trochoidal";

    const lines: string[] = [];
    lines.push("Produced with CoreCutCNC by Core Cutter LLC");
    const _now = new Date();
    lines.push(`Generated: ${_now.toLocaleDateString()} ${_now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`);
    lines.push("════════════════════════════════════════");
    lines.push("");

    // ── TOOL ─────────────────────────────────
    lines.push("TOOL");
    lines.push(DIV);
    lines.push(L("Brand",        "Core Cutter"));
    lines.push(L("Tool Type",    toolTypeLabel[form.tool_type] ?? form.tool_type));
    if (form.edp)        lines.push(L("EDP",          skuDescription ? `${form.edp}  —  ${skuDescription}` : form.edp));
    if (form.tool_series) lines.push(L("Series",       form.tool_series));
    lines.push(L("Diameter",     `${form.tool_dia?.toFixed(4) ?? "—"}"`));
    lines.push(L("Flutes",       String(form.flutes || "—")));
    if (form.loc > 0)    lines.push(L("LOC",           `${form.loc.toFixed(4)}"`));
    if (form.lbs > 0)    lines.push(L("LBS",           `${form.lbs.toFixed(4)}"`));
    lines.push(L("Corner",       cornerLabel));
    lines.push(L("Geometry",     geoLabel[form.geometry] ?? form.geometry));
    if (form.coating)    lines.push(L("Coating",       form.coating));
    lines.push("");

    // ── MATERIAL ──────────────────────────────
    lines.push("MATERIAL");
    lines.push(DIV);
    lines.push(L("Material",     matLabel));
    if (form.hardness_value > 0) lines.push(L("Hardness", `${form.hardness_value} ${form.hardness_scale.toUpperCase()}`));
    lines.push("");

    if (drillResult) {
      // ── HOLE SETUP ───────────────────────────────
      lines.push("HOLE SETUP");
      lines.push(DIV);
      lines.push(L("Hole Type",     form.drill_blind ? "Blind" : "Through"));
      if (form.drill_hole_depth > 0) {
        const depthD = form.tool_dia > 0 ? (form.drill_hole_depth / form.tool_dia) : 0;
        lines.push(L("Hole Depth",  `${form.drill_hole_depth.toFixed(4)}"  (${depthD.toFixed(1)}×D)`));
      }
      lines.push(L("Point Angle",   `${form.drill_point_angle}°`));
      lines.push(L("Flute Geometry",{ standard: "Standard", med_helix: "Medium Helix", high_helix: "High Helix" }[form.drill_geometry as string] ?? form.drill_geometry));
      if (form.coolant) lines.push(L("Coolant",       form.coolant));
      if (drillResult.entry_dia != null && drillResult.largest_dia != null && drillResult.entry_dia !== drillResult.largest_dia) {
        lines.push(L("Step Drill",  `Entry ø${drillResult.entry_dia.toFixed(4)}" · Largest ø${drillResult.largest_dia.toFixed(4)}"`));
        lines.push(L("  SFM basis", `ø${drillResult.largest_dia.toFixed(4)}"  (largest dia)`));
        lines.push(L("  Feed basis",`ø${drillResult.entry_dia.toFixed(4)}"  (entry/smallest dia)`));
      }
      lines.push("");

      // ── SPEEDS & FEEDS ───────────────────────────
      lines.push("SPEEDS & FEEDS");
      lines.push(DIV);
      lines.push(L("Spindle Speed", `${Math.round(drillResult.rpm).toLocaleString()} RPM`));
      lines.push(L("SFM",           String(Math.round(drillResult.sfm ?? 0))));
      lines.push(L("Feed Rate",     `${drillResult.ipm?.toFixed(3) ?? "—"} IPM`));
      lines.push(L("Feed / Rev",    `${drillResult.ipr?.toFixed(5) ?? "—"} IPR`));
      lines.push(L("MRR",           `${drillResult.mrr_in3_min?.toFixed(4) ?? "—"} in³/min`));
      lines.push("");

      // ── CYCLE ────────────────────────────────────
      lines.push("DRILL CYCLE");
      lines.push(DIV);
      lines.push(L("Cycle",         drillResult.cycle ?? "—"));
      if (drillResult.cycle_note) lines.push(`  ${drillResult.cycle_note}`);
      lines.push(L("R Plane",       `${drillResult.r_plane_in?.toFixed(3) ?? "—"}"`));
      if (drillResult.peck_depth_in != null)
        lines.push(L("Q (Peck Depth)", `${drillResult.peck_depth_in.toFixed(4)}"`));
      if (drillResult.peck_schedule && drillResult.peck_schedule.length > 0) {
        lines.push("  Peck schedule:");
        drillResult.peck_schedule.forEach((q: number, i: number) => {
          const isLast = i === drillResult.peck_schedule!.length - 1;
          lines.push(`    Peck ${i + 1}${isLast ? "+" : ""}:  ${q.toFixed(4)}"`);
        });
      }
      lines.push("");

      // ── PERFORMANCE ──────────────────────────────
      lines.push("PERFORMANCE");
      lines.push(DIV);
      lines.push(L("HP Required",   `${drillResult.hp_required?.toFixed(2) ?? "—"} HP`));
      lines.push(L("Thrust",        `${drillResult.thrust_lbf?.toFixed(1) ?? "—"} lbf`));
      lines.push(L("Torque",        `${drillResult.torque_inlbf?.toFixed(2) ?? "—"} in·lbf`));

      // ── NOTES ────────────────────────────────────
      const drillNotes: string[] = [];
      if (drillResult.geometry_tip)  drillNotes.push(drillResult.geometry_tip);
      if (drillResult.chip_warning)  drillNotes.push(`⚠ Chip warning: ${drillResult.chip_warning}`);
      if (drillResult.flute_warning) drillNotes.push(`⚠ ${drillResult.flute_warning}`);
      if (drillNotes.length > 0) {
        lines.push("");
        lines.push("NOTES");
        lines.push(DIV);
        drillNotes.forEach(n => lines.push(`  ${n}`));
      }

    } else if (reamResult) {
      // ── HOLE SETUP ───────────────────────────────
      lines.push("HOLE SETUP");
      lines.push(DIV);
      lines.push(L("Hole Type",     form.ream_blind ? "Blind" : "Through"));
      if (form.ream_hole_depth > 0) {
        lines.push(L("Hole Depth",  `${form.ream_hole_depth.toFixed(4)}"  (${reamResult.depth_xd?.toFixed(1)}×D)`));
      }
      if (form.ream_pre_drill_dia > 0) lines.push(L("Pre-Drill Dia",`${form.ream_pre_drill_dia.toFixed(4)}"`));
      if (form.existing_hole_dia  > 0) lines.push(L("Existing Hole", `${form.existing_hole_dia.toFixed(4)}"`));
      lines.push(L("Coolant",       reamResult.coolant_identity ?? form.coolant ?? "—"));
      lines.push(L("Lead Chamfer",  { standard: "Standard 45°", long_lead: "Long Lead 15–30°", short_lead: "Short Lead 60°+" }[form.ream_lead_chamfer as string] ?? form.ream_lead_chamfer));
      if (reamResult.entry_dia != null && reamResult.largest_dia != null && reamResult.entry_dia !== reamResult.largest_dia) {
        lines.push(L("Step Reamer", `Entry ø${reamResult.entry_dia.toFixed(4)}" · Largest ø${reamResult.largest_dia.toFixed(4)}"`));
      }
      lines.push("");

      // ── SPEEDS & FEEDS ───────────────────────────
      lines.push("SPEEDS & FEEDS");
      lines.push(DIV);
      lines.push(L("Spindle Speed", `${Math.round(reamResult.rpm).toLocaleString()} RPM`));
      lines.push(L("SFM",           String(Math.round(reamResult.sfm ?? 0))));
      lines.push(L("Feed Rate",     `${reamResult.ipm?.toFixed(3) ?? "—"} IPM`));
      lines.push(L("Feed / Rev",    `${reamResult.ipr?.toFixed(5) ?? "—"} IPR`));
      lines.push("");

      // ── STOCK ────────────────────────────────────
      if (reamResult.stock_per_side_in != null || reamResult.stock_status) {
        lines.push("STOCK CONDITION");
        lines.push(DIV);
        if (reamResult.stock_per_side_in != null)
          lines.push(L("Stock / Side",  `${reamResult.stock_per_side_in.toFixed(4)}"  (${reamResult.stock_total_in?.toFixed(4)}" total diametral)`));
        lines.push(L("Ideal Range",   `${reamResult.stock_min_in?.toFixed(4)}"–${reamResult.stock_max_in?.toFixed(4)}"  (target ${reamResult.stock_ideal_in?.toFixed(4)}")`));
        if (reamResult.stock_status)   lines.push(L("Status",         reamResult.stock_status.toUpperCase()));
        if (reamResult.stock_warning)  lines.push(`  ⚠ ${reamResult.stock_warning}`);
        lines.push("");
      }

      // ── PERFORMANCE ──────────────────────────────
      lines.push("PERFORMANCE");
      lines.push(DIV);
      lines.push(L("HP Required",   `${reamResult.hp_required?.toFixed(2) ?? "—"} HP`));
      lines.push(L("Depth / D",     `${reamResult.depth_xd?.toFixed(1) ?? "—"}×D`));
      if (reamResult.depth_note) lines.push(`  ${reamResult.depth_note}`);
      lines.push("");

      // ── QUALITY PREDICTION ───────────────────────
      if (reamResult.finish_risk || reamResult.straightness_risk) {
        lines.push("QUALITY PREDICTION");
        lines.push(DIV);
        if (reamResult.finish_risk) {
          lines.push(L("Surface Finish",  reamResult.finish_risk.toUpperCase()));
          if (reamResult.finish_ra_base_min != null)
            lines.push(L("Expected Ra",   `${reamResult.finish_ra_base_min}–${reamResult.finish_ra_base_max} μin`));
          (reamResult.finish_notes ?? []).forEach((n: string) => lines.push(`  ${n}`));
        }
        if (reamResult.straightness_risk) {
          lines.push(L("Straightness",    reamResult.straightness_risk.toUpperCase()));
          (reamResult.straightness_notes ?? []).forEach((n: string) => lines.push(`  ${n}`));
        }
        lines.push("");
      }

      // ── TOOL GUIDANCE ────────────────────────────
      lines.push("TOOL GUIDANCE");
      lines.push(DIV);
      if (reamResult.helix_rec)        lines.push(L("Helix Direction",  reamResult.helix_rec));
      if (reamResult.coating_rec)      lines.push(L("Coating",          reamResult.coating_rec));
      if (reamResult.iso_category)     lines.push(L("ISO Category",     `ISO ${reamResult.iso_category}`));
      if (reamResult.tool_life_lo != null && reamResult.tool_life_hi != null)
        lines.push(L("Tool Life",       `${reamResult.tool_life_lo}–${reamResult.tool_life_hi} holes typical`));
      if (reamResult.helix_note)       lines.push(`  ${reamResult.helix_note}`);
      if (reamResult.helix_angle_note) lines.push(`  ${reamResult.helix_angle_note}`);
      (reamResult.helix_warnings ?? []).forEach((w: string) => lines.push(`  ⚠ ${w}`));
      if (reamResult.confidence && reamResult.confidence !== "green") {
        lines.push("");
        lines.push(L("Confidence",      reamResult.confidence.toUpperCase()));
        (reamResult.risk_flags ?? []).forEach((f: string) => lines.push(`  • ${f}`));
      }

    } else if (threadResult) {
      lines.push("THREAD MILLING");
      lines.push(DIV);
      lines.push(L("Spindle Speed", `${Math.round(threadResult.rpm).toLocaleString()} RPM`));
      lines.push(L("SFM",           String(Math.round(threadResult.sfm ?? 0))));
      lines.push(L("Feed Rate",     `${threadResult.feed_ipm?.toFixed(2) ?? "—"} IPM`));
      lines.push(L("FPT",           `${threadResult.fpt?.toFixed(6) ?? "—"}"`));
      lines.push(L("Pitch",         `${threadResult.pitch_in?.toFixed(5) ?? "—"}"`));
      lines.push(L("Thread Depth",  `${threadResult.thread_depth_in?.toFixed(5) ?? "—"}"`));
      lines.push("");
      // ── RADIAL PASS STRATEGY ─────────────────────
      {
        const n = threadResult.radial_passes ?? 1;
        const docEa = threadResult.doc_per_pass_in ?? 0;
        const perPassDocs: number[] = (threadResult.pass_docs && threadResult.pass_docs.length === n)
          ? threadResult.pass_docs
          : Array(n).fill(docEa);
        const pitch = threadResult.pitch_in ?? 0;
        const reasons: string[] = [];
        if (pitch >= 0.100)       reasons.push("very coarse pitch (TPI ≤ 10)");
        else if (pitch >= 0.0625) reasons.push("coarse pitch (TPI ≤ 16)");
        const matLow = form.material.toLowerCase();
        const isInconelTi = ["inconel","titanium","hastelloy","waspaloy","monel","mp35n","hitemp"].some(k => matLow.includes(k));
        const isStainless  = matLow.includes("stainless");
        if (isInconelTi)   reasons.push("Inconel / titanium — 3 passes minimum for tool life");
        else if (isStainless) reasons.push("stainless — work-hardens, needs light finishing cut");
        if (form.thread_neck_length > 0) reasons.push("necked tool — reduced rigidity");
        lines.push(`RADIAL PASS STRATEGY  (${n} pass${n > 1 ? "es" : ""}${threadResult.spring_pass ? " + spring" : ""})`);
        lines.push(DIV);
        if (reasons.length > 0) lines.push(`  Why: ${reasons.join(", ")}.`);
        for (let i = 0; i < n; i++) {
          const label = n === 1 ? "Pass 1 (single-pass finish)" : i < n - 1 ? `Pass ${i + 1} (roughing)` : `Pass ${n} (finish)`;
          lines.push(L(label, `${perPassDocs[i].toFixed(5)}"`));
        }
        if (threadResult.spring_pass) {
          lines.push(L(`Spring pass (repeat pass ${n} at same offset)`, `${docEa.toFixed(5)}"`));
        }
        if (threadResult.finish_pass_frac != null && n > 1) {
          lines.push(`  Finish pass = ${Math.round(threadResult.finish_pass_frac * 100)}% of thread depth`);
        }
      }
      lines.push(L("Deflection",    `${threadResult.deflection_in?.toFixed(5) ?? "—"}"`));

    } else if (cust?.rpm) {
      const dia    = form.tool_dia || 0.5;
      const wocIn  = cust.woc_in ?? (form.woc_pct && dia ? (form.woc_pct / 100) * dia : null);
      const docIn  = cust.doc_in ?? (form.doc_xd && dia ? form.doc_xd * dia : null);
      const wocPct = wocIn != null && dia > 0 ? (wocIn / dia) * 100 : form.woc_pct;
      const docXd  = docIn != null && dia > 0 ? docIn / dia : form.doc_xd;

      // ── STRATEGY ────────────────────────────
      lines.push("STRATEGY");
      lines.push(DIV);
      lines.push(L("Operation",    modeLabel[form.mode] ?? form.mode));
      if (wocIn != null) lines.push(L("WOC (Radial)",  `${wocIn.toFixed(4)}"  (${wocPct.toFixed(1)}% Ø)`));
      if (docIn != null) lines.push(L("DOC (Axial)",   `${docIn.toFixed(4)}"  (${docXd.toFixed(2)}×D)`));
      if (wocPct)        lines.push(L("Optimal Load",  `${wocPct.toFixed(1)}%`));
      if (isRoughing)    lines.push(L("Stock to Leave","0.010\" radial  /  0.005\" axial  (suggested)"));
      lines.push("");

      // ── SPEEDS & FEEDS ───────────────────────
      lines.push("SPEEDS & FEEDS");
      lines.push(DIV);
      lines.push(L("Spindle Speed",  `${Math.round(cust.rpm).toLocaleString()} RPM`));
      lines.push(L("SFM",            String(Math.round(cust.sfm ?? 0))));
      lines.push(L("Feed Rate",      `${(cust.feed_ipm ?? 0).toFixed(2)} IPM`));
      if (cust.fpt != null)     lines.push(L("Chipload (FPT)", `${cust.fpt.toFixed(5)}"`));
      if (cust.adj_fpt != null && cust.fpt != null && Math.abs(cust.adj_fpt - cust.fpt) > 0.000005) {
        lines.push(L("Adj Chipload",  `${cust.adj_fpt.toFixed(5)}"  (chip-thinned)`));
        lines.push(L("Chip Thin Factor", `${(cust.adj_fpt / cust.fpt).toFixed(2)}×  — why feedrate looks high in adaptive paths`));
      }
      if (eng?.chip_thickness_in != null) {
        const ct = eng.chip_thickness_in;
        const minCt = (cust.fpt ?? ct) * 0.30;
        const ctStatus = ct >= minCt ? "✓ Cutting" : "⚠ Near rubbing threshold";
        lines.push(L("Chip Thickness",  `${ct.toFixed(5)}"  (min ~${minCt.toFixed(5)}")  ${ctStatus}`));
      }
      if (cust.peripheral_feed_ipm != null)
        lines.push(L("Peripheral Feed",`${cust.peripheral_feed_ipm.toFixed(2)} IPM`));
      lines.push("");

      // ── ENTRY MOVES ─────────────────────────
      if (em) {
        lines.push("ENTRY MOVES");
        lines.push(DIV);
        lines.push(L("Entry Type",    "Helical / Ramp"));
        lines.push(L("Helix Bore",    `≥${em.helix_bore_min_in.toFixed(4)}"  (ideal ${em.helix_bore_ideal_low.toFixed(4)}"–${em.helix_bore_ideal_high.toFixed(4)}")`));
        lines.push(L("Helix Std",     `${em.standard_helix_ipm.toFixed(1)} IPM  ·  ${em.helix_pitch_in.toFixed(5)}" / rev  @  ${em.helix_angle_deg.toFixed(2)}°`));
        lines.push(L("Helix Adv",     `${em.advanced_helix_ipm.toFixed(1)} IPM  ·  ${(em.adv_helix_pitch_in ?? em.helix_pitch_in).toFixed(5)}" / rev  @  ${(em.adv_helix_angle_deg ?? em.helix_angle_deg).toFixed(2)}°  (chip-thinned)`));
        lines.push(L("Ramp Angle",    `≤${em.ramp_angle_deg}°`));
        lines.push(L("Ramp Feed",     `${em.standard_ramp_ipm.toFixed(1)} IPM  (standard)  |  ${em.advanced_ramp_ipm.toFixed(1)} IPM  (advanced)`));
        lines.push("");
      }

      // ── PERFORMANCE ─────────────────────────
      lines.push("PERFORMANCE");
      lines.push(DIV);
      if (stabilityIndex) {
        const si = stabilityIndex;
        const siLabel = si.overall >= 80 ? "✓ Excellent" : si.overall >= 65 ? "✓ Good" : si.overall >= 50 ? "⚠ Moderate" : si.overall >= 35 ? "⚠ Caution" : "⚠ High Risk";
        lines.push(L("Stability Index", `${si.overall} / 100  ${siLabel}`));
        lines.push(L("  └ Deflection",  `${si.defl} / 100`));
        lines.push(L("  └ Machine Load",`${si.load} / 100`));
        lines.push(L("  └ Chip Quality",`${si.chip} / 100`));
        lines.push(L("  └ L/D Ratio",   `${si.ld} / 100`));
        lines.push("");
      }
      lines.push(L("MRR",           `${(cust.mrr_in3_min ?? 0).toFixed(3)} in³/min`));
      if (cust.hp_required != null) lines.push(L("HP Required",  `${cust.hp_required.toFixed(2)} HP`));
      if (cust.machine_hp && cust.hp_util_pct != null)
        lines.push(L("Spindle Load",  `${(cust.spindle_load_pct ?? 0).toFixed(0)}%  (of ${cust.machine_hp.toFixed(0)} HP avail)`));
      if (eng?.force_lbf != null)   lines.push(L("Cutting Force", `${eng.force_lbf.toFixed(1)} lbf`));
      if (eng?.torque_inlbf != null) lines.push(L("Torque",        `${eng.torque_inlbf.toFixed(2)} in·lbf`));
      if (stab) {
        const stable = stab.deflection_pct < 100;
        lines.push(L("Deflection",   `${stab.deflection_in.toFixed(5)}"  (${stab.deflection_pct.toFixed(0)}% of limit)  ${stable ? "✓ Stable" : "⚠ Chatter Risk"}`));
        lines.push(L("Stickout",     `${stab.stickout_in.toFixed(3)}"  (L/D ${stab.l_over_d.toFixed(1)}×D)  ${stab.l_over_d <= 4 ? "✓ Good" : stab.l_over_d <= 6 ? "⚠ Moderate" : "⚠ High — reduce if possible"}`));
      }

      // Chip evacuation advisory
      const chipEvacRisk = form.mode === "slot" ? "⚠ Full-width slot — ensure flood coolant or air blast to clear chips"
        : (form.woc_pct ?? 0) > 50 ? "⚠ High WOC — coolant/air blast critical for chip clearance"
        : form.flutes >= 7 ? "⚠ High flute count — chip clearance critical; use adequate coolant pressure"
        : "✓ OK — standard flood coolant or air blast";
      lines.push(L("Chip Evacuation", chipEvacRisk));

      // Engine advisory notes
      if (cust.status && cust.status !== "ok") lines.push(L("Status", cust.status));
      if (cust.risk)    lines.push(L("Risk Flag",   cust.risk));
      if (cust.notes?.length) {
        lines.push("");
        lines.push("ADVISOR NOTES");
        lines.push(DIV);
        cust.notes.forEach((n: string, i: number) => lines.push(`  ${i + 1}. ${n}`));
      }
    }

    if (lines.filter(l => l.startsWith("TOOL")).length === 0) return null;
    lines.push("");
    lines.push("════════════════════════════════════════");
    lines.push(`© ${new Date().getFullYear()} Core Cutter LLC. All Rights Reserved.  |  CoreCutCNC  |  corecutcnc.com`);
    return lines.join("\n");
  }

  function copyCamParams() {
    const text = buildResultsText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCamCopied(true);
      setTimeout(() => setCamCopied(false), 2000);
    });
  }

  async function emailResults() {
    if (!erEmail.trim()) { setErError("Enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(erEmail.trim())) { setErError("Enter a valid email address."); return; }
    setErStatus("sending");
    setErError("");
    const matLabel = ISO_SUBCATEGORIES.find(s => s.key === form.material)?.label ?? form.material ?? undefined;
    try {
      const resp = await fetch("/api/results/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: erEmail.trim(),
          operation,
          material: matLabel,
          machine_name: activeMachineName || undefined,
          results_text: buildResultsText() ?? undefined,
        }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        setErError((d as any).error ?? "Something went wrong — try again.");
        setErStatus("error");
      } else {
        setErStatus("sent");
        localStorage.setItem("er_email", erEmail.trim().toLowerCase());
      }
    } catch {
      setErError("Network error — check your connection.");
      setErStatus("error");
    }
  }

  function runGatedAction(action: "copy" | "print" | "pdf" | "stp", stpHref?: string) {
    if (action === "copy") copyCamParams();
    else if (action === "print") printSummary();
    else if (action === "pdf") downloadPDF();
    else if (action === "stp" && stpHref) window.open(stpHref, "_blank");
  }

  function requireEmail(action: "copy" | "print" | "pdf" | "stp", stpHref?: string) {
    const email = erEmail || localStorage.getItem("er_email") || "";
    if (email || engMode) {
      runGatedAction(action, stpHref);
    } else {
      setErGatePending(action);
      if (stpHref) setErGateStpUrl(stpHref);
      setErGateOpen(true);
    }
  }

  async function submitContactModal() {
    if (!contactEmail.trim()) return;
    setContactStatus("sending");
    try {
      await fetch("/api/contact/tool-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: contactName.trim(), email: contactEmail.trim(), message: contactMsg.trim() }),
      });
      localStorage.setItem("er_email", contactEmail.trim().toLowerCase());
      setErEmail(contactEmail.trim().toLowerCase());
      setErGateInput(contactEmail.trim().toLowerCase());
      setContactStatus("sent");
    } catch {
      setContactStatus("idle");
    }
  }

  // Optional: gate engineering even if toggle is on but no data returned

  // ── Tool Finder → apply SKU and switch to milling ────────────────────────
  function handleToolFinderSelect(tool: any, extras?: { mode?: string; isoMat?: string }) {
    applySkuToForm(tool as any);
    setOperation("milling");
    mentor.reset();
    if (extras?.mode) setForm(p => ({ ...p, mode: extras.mode as any }));
    if (extras?.isoMat) {
      setIsoCategory(extras.isoMat.toUpperCase() as IsoCategory);
      setForm(p => ({ ...p, material: "" }));
    }
  }

  // ── Shared tab bar used by Tool Finder and Calculators views ─────────────
  const ALL_OPS = ["toolfinder","feedmilling","milling","drilling","reaming","threadmilling","keyseat","dovetail"] as const;
  const OP_LABELS: Record<string, string> = {
    toolfinder: "Tool Finder", feedmilling: "Calculators",
    milling: "Milling", drilling: "Drilling", reaming: "Reaming", threadmilling: "Thread Milling",
    keyseat: "Keyseat", dovetail: "Dovetail",
  };
  function SharedTabBar() {
    return (
      <div className="flex flex-wrap gap-2 mb-6">
        {ALL_OPS.map((op) => (
          <button key={op} type="button"
            onClick={() => { setOperation(op); mentor.reset(); }}
            className="rounded px-3 py-1.5 text-xs font-semibold border transition-all"
            style={{
              backgroundColor: operation === op ? "#6366f1" : "transparent",
              borderColor: "#6366f1",
              color: operation === op ? "#fff" : "#6366f1",
            }}
          >
            {OP_LABELS[op]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-3 sm:p-4 overflow-x-hidden">
      {/* App header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
        <img src="/CCLogo-long-blackback TRANSPARENT-01.png" alt="Core Cutter" className="h-10 w-auto" />
        <div className="flex items-center gap-3">
          {/* Toolbox */}
          {tbEmail && tbToken ? (
            <a href="/toolbox" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
              </svg>
              <span className="text-[10px] text-orange-400 font-semibold">Toolbox</span>
              {tbItemCount !== null && tbItemCount > 0 && (
                <span className="text-[9px] font-bold bg-orange-500 text-white rounded-full px-1.5 py-0.5 leading-none">{tbItemCount}</span>
              )}
            </a>
          ) : (
            <button type="button" onClick={() => setTbShowModal(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-600 hover:border-orange-500/60 hover:bg-orange-500/10 transition-colors group">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 group-hover:text-orange-400">
                <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
              </svg>
              <span className="text-[10px] text-zinc-300 group-hover:text-orange-400">Toolbox</span>
            </button>
          )}
          {/* Eng Mode */}
          {engMode ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#f59e0b", color: "#000" }}>ENG MODE</span>
              <button type="button" onClick={exitEngMode} className="text-[10px] text-gray-400 hover:text-white underline">Exit</button>
            </div>
          ) : (
            <button type="button" onClick={() => { setShowEngModal(true); setEngPasswordError(""); setEngPasswordInput(""); }} className="text-[10px] text-zinc-500 hover:text-white underline">Eng Mode</button>
          )}
          <span className="text-xs text-zinc-500 font-medium tracking-wide">Powered by <span className="text-zinc-300 font-semibold">Core Cutter LLC</span></span>
        </div>
      </div>

      {operation === "toolfinder" && (
        <div>
          <SharedTabBar />
          <ToolFinder onSelectTool={handleToolFinderSelect} />
        </div>
      )}
      {operation === "feedmilling" && (
        <div>
          <SharedTabBar />
          <Calculators />
        </div>
      )}
      {operation !== "feedmilling" && operation !== "toolfinder" && <div className="grid grid-cols-1 md:grid-cols-2 md:gap-5 gap-4 items-start">

      {/* LEFT — INPUT CARD */}
      <Card className="rounded-2xl">
        <CardHeader className="pt-0 pb-0">
          {/* Header: logo left, vertical toggle right */}
          <div className="flex items-center justify-between pt-1 pb-1 gap-2">
            <img
              src="/COREcutCNC_HORZ.png"
              alt="CoreCutCNC"
              className="h-[86px] w-auto flex-shrink-0"
              style={{ mixBlendMode: "screen" }}
            />
            {/* IN/MM toggle — vertical stack */}
            <div className="flex flex-col rounded-md border border-zinc-600 overflow-hidden text-xs font-semibold flex-shrink-0">
              {(["imperial", "metric"] as const).map((u) => (
                <button key={u} type="button" onClick={() => setUnits(u)} className="px-2 py-1 transition-colors"
                  style={{ backgroundColor: units === u ? "#6366f1" : "transparent", color: units === u ? "#fff" : "#9ca3af" }}>
                  {u === "imperial" ? "IN" : "MM"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {/* Operation / Process */}
          <div className="flex items-center gap-3 my-3">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Operation / Process</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>
          <div className="space-y-2">
            {/* Top row: Tool Finder + Calculators — equal width */}
            <div className="flex gap-2">
              {([
                { op: "toolfinder",  label: "Tool Finder", icon: "🔍" },
                { op: "feedmilling", label: "Calculators",  icon: "⊞" },
              ] as const).map(({ op, label, icon }) => {
                const active = (operation as string) === op;
                return (
                  <button
                    key={op}
                    type="button"
                    onClick={() => {
                      setOperation(op as any);
                      mentor.reset();
                      setPdfExtracted(false);
                      setForm((p) => ({ ...p, operation: "milling" }));
                    }}
                    className="flex-1 rounded-lg flex flex-col items-center justify-center gap-1 px-2 py-3 text-[10px] font-semibold border transition-all"
                    style={{
                      backgroundColor: active ? "#6366f1" : "transparent",
                      borderColor: "#6366f1",
                      color: active ? "#fff" : "#6366f1",
                    }}
                  >
                    <span>{label}</span>
                    <span className="text-lg leading-none">{icon}</span>
                  </button>
                );
              })}
            </div>
            {/* Second row: operation calculators */}
            <div className="flex flex-wrap gap-2">
              {([
                { op: "milling",       label: "Milling",       icon: "⟳" },
                { op: "drilling",      label: "Drilling",      icon: "↓" },
                { op: "reaming",       label: "Reaming",       icon: "◎" },
                { op: "threadmilling", label: "Thread Milling",icon: "⌇" },
                { op: "keyseat",       label: "Keyseat",       icon: "⊟" },
                { op: "dovetail",      label: "Dovetail",      icon: "◇" },
              ] as const).map(({ op, label, icon }) => {
                const active = operation === op;
                return (
                  <button
                    key={op}
                    type="button"
                    onClick={() => {
                      setOperation(op);
                      mentor.reset();
                      setPdfExtracted(false);
                      setForm((p) => ({
                        ...p,
                        operation: op as any,
                        ...(op === "milling" ? { mode: "" } : {}),
                      }));
                    }}
                    className="rounded-lg flex flex-col items-center justify-center gap-1 px-2 py-3 text-[10px] font-semibold border transition-all flex-1"
                    style={{
                      backgroundColor: active ? "#6366f1" : "transparent",
                      borderColor: "#6366f1",
                      color: active ? "#fff" : "#6366f1",
                    }}
                  >
                    <span>{label}</span>
                    <span className="text-lg leading-none">{icon}</span>
                  </button>
                );
              })}
            </div>

            {/* Tool type card — appears below the operation row when Milling is active */}
            {operation === "milling" && (
              <div className="rounded-lg border border-indigo-500/40 bg-indigo-950/30 px-3 py-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-indigo-400/70 mb-2">Milling — Tool Type</div>
                <div className="flex gap-2">
                  {([
                    { key: "endmill",      label: "Endmill" },
                    { key: "chamfer_mill", label: "Chamfer Mill" },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (key === "endmill") {
                          setForm((p) => ({
                            ...p,
                            tool_type: "endmill",
                            corner_condition: "square",
                            chamfer_angle: 90,
                            chamfer_tip_dia: 0,
                            chamfer_depth: 0,
                            chamfer_series: "CMH" as const,
                          }));
                          setChamferTipDiaText("");
                          setChamferDepthText("");
                          setSkuChamferEdgeLength(null);
                        } else {
                          // Switching to chamfer mill — clear endmill-specific fields
                          setForm((p) => ({
                            ...p,
                            tool_type: "chamfer_mill",
                            corner_condition: "square",
                            corner_radius: 0,
                            geometry: "standard",
                            mode: "",
                            woc_pct: 0,
                            doc_xd: 0,
                          }));
                          setWocText("");
                          setDocText("");
                          setWocPreset(null);
                          setDocPreset(null);
                        }
                      }}
                      className="flex-1 rounded px-3 py-1.5 text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: form.tool_type === key || (key === "endmill" && !["chamfer_mill"].includes(form.tool_type)) ? "#6366f1" : "transparent",
                        borderColor: "#6366f1",
                        color: form.tool_type === key || (key === "endmill" && !["chamfer_mill"].includes(form.tool_type)) ? "#fff" : "#6366f1",
                      }}
                    >{label}</button>
                  ))}
                </div>
              </div>
            )}

            {operation === "milling" && form.tool_type !== "chamfer_mill" && (
              <select
                className={`w-full rounded-md border px-3 py-2 text-sm ${!form.mode ? "border-zinc-500 bg-zinc-800 text-zinc-300" : "bg-background"}`}
                aria-label="Milling process"
                value={form.mode}
                onChange={(e) => {
                  const mode = e.target.value as typeof form.mode;
                  const dia = form.tool_dia || 0.5;
                  const cr = form.corner_radius || 0;
                  // Compute fresh presets for the NEW mode (dynPresets still has old mode at this point)
                  const freshPresets = getDynamicPresets(mode, isoCategory, form.flutes, dia, form.loc);
                  const wp = freshPresets.woc;
                  const dp = freshPresets.doc;

                  // For face mode, auto-fill stepover from formula: (dia - 2×cr) × 0.75
                  const faceStepover = mode === "face" ? Math.max(0, (dia - 2 * cr) * 0.75) : null;
                  const faceWocPct   = faceStepover !== null && dia > 0 ? (faceStepover / dia) * 100 : wp.med;

                  setForm((p) => ({
                    ...p,
                    mode,
                    ...(mode === "slot" ? { woc_pct: 100 } : mode === "face" ? { woc_pct: faceWocPct } : { woc_pct: wp.med }),
                    doc_xd: dp.med,
                  }));
                  if (mode === "slot") {
                    setWocText(dia ? dia.toFixed(4) : "");
                    setWocPreset(null);
                  } else if (mode === "face" && faceStepover !== null) {
                    setWocText(faceStepover.toFixed(4));
                    setWocPreset(null);
                  } else {
                    setWocText(((wp.med / 100) * dia).toFixed(4));
                    setWocPreset("med");
                  }
                  setDocText((dp.med * dia).toFixed(3));
                  setDocPreset("med");
                }}
              >
                <option value="" disabled>— Select Process —</option>
                <option value="hem">Roughing — HEM  (incl. Trochoidal / Dynamic / Adaptive)</option>
                <option value="traditional">Roughing — Traditional</option>
                <option value="finish">Finishing</option>
                <option value="face">Facing (Planar Milling)</option>
                <option value="slot">Slotting</option>
                <option value="circ_interp">Circular Interpolation</option>
              </select>
            )}


            {/* circ_interp hole dimensions moved to CUT ENGAGEMENT section */}
          </div>

          {/* Material */}
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Material</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>
          {/* Grade search */}
          <div className="mb-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={matSearchInput}
                onChange={e => { setMatSearchInput(e.target.value); setMatMatchResult(null); setMatMatchError(null); }}
                onKeyDown={async e => {
                  if (e.key !== "Enter") return;
                  if (!matSearchInput.trim()) return;
                  setMatSearchLoading(true); setMatMatchResult(null); setMatMatchError(null);
                  try {
                    const r = await fetch("/api/materials/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: matSearchInput.trim() }) });
                    const data = await r.json();
                    if (!r.ok || !data.key) { setMatMatchError(data.note ?? "No match found — try selecting the material manually."); }
                    else {
                      setMatMatchResult(data);
                      const sub = ISO_SUBCATEGORIES.find(s => s.key === data.key);
                      if (sub) {
                        setIsoCategory(sub.iso);
                        setForm(p => ({ ...p, material: sub.key, hardness_value: sub.hardness.value, hardness_scale: sub.hardness.scale }));
                      }
                    }
                  } catch { setMatMatchError("Match request failed."); }
                  finally { setMatSearchLoading(false); }
                }}
                placeholder='Search by grade name — e.g. "4140", "17-4 PH", "Inconel 718"'
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
              />
              <button
                type="button"
                disabled={matSearchLoading || !matSearchInput.trim()}
                onClick={async () => {
                  if (!matSearchInput.trim()) return;
                  setMatSearchLoading(true); setMatMatchResult(null); setMatMatchError(null);
                  try {
                    const r = await fetch("/api/materials/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: matSearchInput.trim() }) });
                    const data = await r.json();
                    if (!r.ok || !data.key) { setMatMatchError(data.note ?? "No match found — try selecting the material manually."); }
                    else {
                      setMatMatchResult(data);
                      const sub = ISO_SUBCATEGORIES.find(s => s.key === data.key);
                      if (sub) {
                        setIsoCategory(sub.iso);
                        setForm(p => ({ ...p, material: sub.key, hardness_value: sub.hardness.value, hardness_scale: sub.hardness.scale }));
                      }
                    }
                  } catch { setMatMatchError("Match request failed."); }
                  finally { setMatSearchLoading(false); }
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded border border-orange-500/50 text-orange-400 hover:bg-orange-500/10 disabled:opacity-40 transition-colors"
              >
                {matSearchLoading ? "Matching…" : "Match"}
              </button>
            </div>
            {matMatchResult && (
              <div className={`mt-1.5 text-xs rounded px-2.5 py-1.5 border ${matMatchResult.confidence === "high" ? "border-green-500/40 bg-green-500/10 text-green-300" : "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"}`}>
                {matMatchResult.confidence === "high" ? "✓" : "⚠"} Running as <strong>{matMatchResult.label}</strong>
                {matMatchResult.source === "ai" && " (AI match)"}
                {matMatchResult.confidence !== "high" && " — closest available. Verify with your tooling supplier."}
                {matMatchResult.note && <span className="block opacity-75 mt-0.5">{matMatchResult.note}</span>}
              </div>
            )}
            {matMatchError && (
              <div className="mt-1.5 text-xs rounded px-2.5 py-1.5 border border-red-500/40 bg-red-500/10 text-red-300">
                ✗ {matMatchError}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 items-center">
              {ISO_CATEGORIES.map((cat) => (
                <button
                  key={cat.iso}
                  type="button"
                  onClick={() => {
                    setIsoCategory(cat.iso);
                    const first = ISO_SUBCATEGORIES.find((s) => s.iso === cat.iso);
                    if (first) setForm((p) => ({
                      ...p,
                      material: first.key,
                      hardness_value: first.hardness.value,
                      hardness_scale: first.hardness.scale,
                    }));
                  }}
                  className="rounded px-3 py-1 text-xs font-bold border transition-all"
                  style={{
                    backgroundColor: isoCategory === cat.iso ? cat.color : "transparent",
                    borderColor: cat.color,
                    color: isoCategory === cat.iso ? "#111" : cat.color,
                  }}
                >
                  {cat.iso} <span className="font-normal opacity-80">{cat.label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 shrink-0">Grade</span>
              <select
                className="flex-1 rounded-md border border-orange-500/40 bg-background px-2 py-1 text-xs text-orange-200"
                value={form.material}
                onChange={(e) => {
                  const sub = ISO_SUBCATEGORIES.find((s) => s.key === e.target.value);
                  setForm((p) => ({
                    ...p,
                    material: e.target.value,
                    ...(sub ? { hardness_value: sub.hardness.value, hardness_scale: sub.hardness.scale } : {}),
                  }));
                }}
              >
                {(!form.material || !ISO_SUBCATEGORIES.find(s => s.key === form.material && s.iso === isoCategory)) && (
                  <option value="" disabled>— Please select actual material subgroup —</option>
                )}
                {ISO_SUBCATEGORIES.filter((s) => s.iso === isoCategory).map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Hardness — ferrous only (P, M, K, H, S) */}
            {["P","M","K","H","S"].includes(isoCategory) && (() => {
              const hRange = MATERIAL_HARDNESS_RANGE[form.material];
              const hVal = form.hardness_value;
              const wrongScale = hRange && hVal > 0 && form.hardness_scale !== hRange.scale;
              const outOfRange = hRange && hVal > 0 && !wrongScale && (hVal < hRange.min || hVal > hRange.max);
              return (
                <>
                  <div className="mt-3 flex items-center gap-2">
                    <FieldLabel hint="Material hardness. HRC (Rockwell C) for hardened/alloy steels; HRB (Rockwell B) for softer steels and stainless. Affects SFM, cutting force, and torque.">
                      Hardness
                    </FieldLabel>
                    <div className="flex rounded-md border overflow-hidden text-xs font-semibold ml-1">
                      {(["hrc","hrb"] as const).map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          onClick={() => setForm((p) => ({ ...p, hardness_scale: scale }))}
                          className="px-2 py-1 transition-colors"
                          style={{
                            backgroundColor: form.hardness_scale === scale ? "#6366f1" : "transparent",
                            color: form.hardness_scale === scale ? "#fff" : undefined,
                          }}
                        >
                          {scale.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={form.hardness_scale === "hrc" ? 70 : 110}
                      step={1}
                      placeholder={form.hardness_scale === "hrc" ? "e.g. 32" : "e.g. 95"}
                      className={`no-spinners w-24 text-sm${(wrongScale || outOfRange) ? " border-amber-500" : ""}`}
                      value={form.hardness_value || ""}
                      onChange={(e) => setForm((p) => ({ ...p, hardness_value: Number(e.target.value) || 0 }))}
                    />
                    <span className="text-xs text-muted-foreground">{form.hardness_scale.toUpperCase()}</span>
                  </div>
                  {wrongScale && hRange && (
                    <p className="mt-1 text-xs text-amber-500 leading-snug px-1">
                      ⚠ This material is typically measured in {hRange.scale.toUpperCase()} ({hRange.min}–{hRange.max} {hRange.scale.toUpperCase()}). Switching scales may give unexpected results.
                    </p>
                  )}
                  {outOfRange && hRange && (
                    <p className="mt-1 text-xs text-amber-500 leading-snug px-1">
                      ⚠ {hRange.note}
                    </p>
                  )}
                </>
              );
            })()}
          </div>

          {/* Material note */}
          {MATERIAL_NOTES[form.material] && (
            <p className="mt-2 text-xs text-muted-foreground italic leading-snug px-1">
              {MATERIAL_NOTES[form.material]}
            </p>
          )}

          {/* Hole Details — drilling only, shown BEFORE tool geometry so point angle can be recommended */}
          {operation === "drilling" && (<>
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Hole Details</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <FieldLabel hint={form.drill_steps > 0 ? `How deep the drill travels into the part — measured from the part's top surface down to the full bottom of the hole, to drill point. For step drills, this must be greater than the last step length (${(Math.max(...form.drill_step_lengths.slice(0, form.drill_steps).filter(l => l > 0)) || 0).toFixed(3)}") so all diameters fully engage. Through hole: enter full material thickness. Blind hole: enter the required full depth. Used to determine total depth-to-diameter ratio and recommend the correct G-code peck cycle.` : "How deep the drill travels into the part — measured from the part's top surface down to the full bottom of the hole, to drill point. Through hole: enter full material thickness. Blind hole: enter the required full depth. Used to determine total depth-to-diameter ratio and recommend the correct G-code peck cycle."}>Hole Depth (in)</FieldLabel>
              <Input
                type="text" inputMode="decimal" className="no-spinners"
                placeholder="e.g. 1.25"
                value={drillHoleDepthText}
                onChange={(e) => setDrillHoleDepthText(e.target.value)}
                onBlur={() => {
                  const n = parseDim(drillHoleDepthText);
                  if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, drill_hole_depth: n })); setDrillHoleDepthText(n.toFixed(3)); }
                  else setDrillHoleDepthText(form.drill_hole_depth > 0 ? form.drill_hole_depth.toFixed(3) : "");
                }}
              />
              {(() => {
                if (form.drill_steps < 1) return null;
                const maxStepLen = Math.max(...form.drill_step_lengths.slice(0, form.drill_steps).filter(l => l > 0));
                if (!isFinite(maxStepLen) || maxStepLen <= 0) return null;
                if (form.drill_hole_depth > 0 && form.drill_hole_depth <= maxStepLen) {
                  return (
                    <p className="text-xs text-amber-400 mt-1">
                      ⚠ Hole depth must exceed step {form.drill_steps} length ({maxStepLen.toFixed(3)}") for all steps to engage.
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Blind holes may need a dwell (G82) at the bottom for clean finish. Through holes can use a standard drill cycle.">Hole Type</FieldLabel>
              <div className="flex gap-2 pt-1">
                {([{ val: false, label: "Through" }, { val: true, label: "Blind" }] as const).map(({ val, label }) => (
                  <button key={label} type="button"
                    onClick={() => setForm((p) => ({ ...p, drill_blind: val }))}
                    className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.drill_blind === val ? "#6366f1" : "transparent",
                      borderColor: "#6366f1", color: form.drill_blind === val ? "#fff" : "#6366f1",
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
          </div>
          </>)}

          {/* Tool Geometry — adapts per operation */}
          {operation !== "threadmilling" && operation !== "keyseat" && operation !== "dovetail" && (
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Tool Geometry</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>
          )}

          {operation === "milling" ? (<>
          {/* EDP# / SKU lookup */}
          <div className="mb-4 relative">
            <FieldLabel hint="Enter a Core Cutter EDP# to auto-populate tool geometry fields and enable the calculator.">Core Cutter EDP# (required to run — auto-fills tool specifications)</FieldLabel>
            <div className="relative mt-1.5">
              <Input
                type="text"
                className="no-spinners pr-8"
                placeholder={form.tool_type === "chamfer_mill" ? "e.g. H09055" : "e.g. 505221"}
                value={edpText}
                onChange={(e) => { if (skuLocked) clearSku(); setEdpText(e.target.value); }}
                onFocus={() => { if (skuResults.length > 0 && !skuLocked) setSkuDropdownOpen(true); }}
                onBlur={() => setTimeout(() => setSkuDropdownOpen(false), 150)}
              />
              {skuLocked && skuDescription && (
                <span className="pointer-events-none absolute inset-y-0 left-[5rem] right-8 flex items-center overflow-hidden">
                  <span className="text-[11px] text-muted-foreground truncate">— {skuDescription}</span>
                </span>
              )}
              {skuLocked && (
                <button
                  type="button"
                  title="Clear EDP# and unlock fields"
                  onClick={clearSku}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-orange-500 hover:text-orange-700 text-sm leading-none"
                >✕</button>
              )}
            </div>
            {edpNotFound && !skuLocked && (
              <p className="mt-1 text-xs font-semibold text-red-500">⚠ Invalid EDP Number Entered</p>
            )}
            {skuLocked && (
              <p className="mt-1 text-[11px] text-orange-400 flex items-center gap-2 flex-wrap">
                <span>Auto-filled from {edpText} — fields populated from catalog.{" "}
                <button type="button" onClick={clearSku} className="underline hover:text-orange-600">Clear</button></span>
                <button
                  type="button"
                  onClick={() => requireEmail("stp", stpUrl(edpText))}
                  className="inline-flex items-center gap-0.5 rounded border border-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-600 hover:text-white transition-colors"
                  title={`Download Core_Cutter_${edpText} v1.step`}
                >⬇ .STP</button>
              </p>
            )}
            {skuDropdownOpen && skuResults.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-52 overflow-y-auto">
                {skuResults.map((s) => (
                  <button
                    key={s.EDP ?? s.edp}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-baseline gap-2 overflow-hidden"
                    onMouseDown={(e) => { e.preventDefault(); applySkuToForm(s); }}
                  >
                    <span className="font-semibold">{s.EDP ?? s.edp}</span>
                    <span className="text-muted-foreground text-xs whitespace-nowrap truncate">
                      {s.flutes}fl · {Number(s.cutting_diameter_in).toFixed(4)}" · {Number(s.loc_in).toFixed(3)}" LOC{s.oal_in ? ` · ${Number(s.oal_in).toFixed(3)}" OAL` : ""}
                      {s.series ? ` · ${s.series}` : ""}
                      {" · "}{(() => {
                        const cc = String(s.corner_condition ?? "square").toLowerCase();
                        if (cc === "ball") return "Ball";
                        const cr = Number(s.corner_condition);
                        if (!isNaN(cr) && cr > 0) return `CR ${cr.toFixed(4)}"`;
                        return "Square";
                      })()}
                      {s.coating ? <span className="ml-1 text-orange-400 font-medium">· {s.coating}</span> : null}
                      {s.geometry === "chipbreaker" ? <span className="ml-1 text-sky-400 font-medium">· Chipbreaker</span> : null}
                      {s.geometry === "truncated_rougher" ? <span className="ml-1 text-sky-400 font-medium">· VXR Rougher</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* PDF Print Upload — shown in customer mode or as shortcut in eng mode */}
          {(operation === "milling") && (!skuLocked) && (
            <div className={`rounded-lg border p-3 ${pdfExtracted ? "border-amber-500 bg-amber-950/20" : "border-dashed border-gray-600"}`}>
              {pdfExtracted ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-amber-400 font-medium">✓ Dimensions extracted from CC print{pdfToolNumber ? ` (${pdfToolNumber})` : ""} — review fields below</span>
                  <button type="button" onClick={() => setPdfExtracted(false)} className="text-[10px] text-gray-400 hover:text-white underline">Clear</button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-1 cursor-pointer">
                  <span className="text-xs text-gray-400">{engMode ? "Or upload CC print to auto-fill" : "Upload CC-XXXXX print to auto-fill dimensions"}</span>
                  <span className="rounded border border-orange-500 text-orange-400 hover:bg-orange-500 hover:text-white transition-colors px-3 py-1.5 text-xs font-semibold inline-block">
                    {pdfUploading ? "Reading print…" : "⬆ Upload CC Print (PDF)"}
                  </span>
                  <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={pdfUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPrintPdf(f); e.target.value = ""; }} />
                </label>
              )}
            </div>
          )}

          <div className="grid gap-3" style={{ gridTemplateColumns: form.tool_type === "chamfer_mill" ? "4rem 1fr 1fr" : "4rem 1fr 1fr 1fr" }}>
            <div className="space-y-2">
              <FieldLabel hint="Number of cutting edges. More flutes = higher feed rate but less chip clearance. HEM typically uses 5–7 flutes.">Flutes</FieldLabel>
              <Input
                type="number"
                step="1"
                className="no-spinners"
                value={form.flutes || ""}
                onChange={onNum("flutes")}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Cutting diameter in inches. Affects SFM, deflection stiffness (D⁴), and chip thinning calculations.">{UL("Cut Dia (in)", "Cut Dia (mm)")}</FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                className="no-spinners"
                value={toolDiaText}
                onChange={(e) => setToolDiaText(e.target.value)}
                onFocus={() => {
                  if (form.tool_dia) setToolDiaText(metric ? (form.tool_dia * 25.4).toFixed(2) : form.tool_dia.toFixed(3));
                }}
                onBlur={() => {
                  const n = parseDim(toolDiaText);
                  if (Number.isFinite(n) && n > 0) {
                    const stored = metric ? n / 25.4 : n;
                    setForm((p) => ({ ...p, tool_dia: stored }));
                    setToolDiaText(metric ? (stored * 25.4).toFixed(2) : stored.toFixed(3));
                  } else {
                    setToolDiaText(form.tool_dia ? (metric ? (form.tool_dia * 25.4).toFixed(2) : form.tool_dia.toFixed(3)) : "");
                  }
                }}
              />
            </div>
            {<div className="space-y-2">
              <FieldLabel hint="Length of Cut — the fluted cutting length. The engine caps DOC at this value and uses it for stickout calculations.">{UL("LOC (in)", "LOC (mm)")}</FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                className="no-spinners"
                value={locText}
                onChange={(e) => setLocText(e.target.value)}
                onFocus={() => {
                  if (form.loc) setLocText(metric ? (form.loc * 25.4).toFixed(2) : form.loc.toFixed(3));
                }}
                onBlur={() => {
                  const n = parseDim(locText);
                  if (Number.isFinite(n) && n > 0) {
                    const stored = metric ? n / 25.4 : n;
                    setForm((p) => ({ ...p, loc: stored }));
                    setLocText(metric ? (stored * 25.4).toFixed(2) : stored.toFixed(3));
                  } else {
                    setLocText(form.loc ? (metric ? (form.loc * 25.4).toFixed(2) : form.loc.toFixed(3)) : "");
                  }
                }}
              />
            </div>}
            {form.tool_type !== "chamfer_mill" && form.lbs > 0 && <div className="space-y-2">
              <FieldLabel hint={'Length Below Shank — the full reach from shank base to tool tip on a necked tool. LOC is contained within LBS, not added to it.'}>{UL("LBS (in)", "LBS (mm)")}</FieldLabel>
              <Input
                type="text"
                inputMode="decimal"
                className="no-spinners"
                value={lbsText}
                onChange={(e) => setLbsText(e.target.value)}
                onFocus={() => {
                  if (form.lbs) setLbsText(metric ? (form.lbs * 25.4).toFixed(2) : form.lbs.toFixed(3));
                }}
                onBlur={() => {
                  const n = parseDim(lbsText);
                  if (Number.isFinite(n) && n > 0) {
                    const stored = metric ? n / 25.4 : n;
                    setForm((p) => ({ ...p, lbs: stored }));
                    setLbsText(metric ? (stored * 25.4).toFixed(2) : stored.toFixed(3));
                  } else if (!lbsText.trim() || lbsText.trim() === "0") {
                    setForm((p) => ({ ...p, lbs: 0 }));
                    setLbsText("");
                  } else {
                    setLbsText(form.lbs ? (metric ? (form.lbs * 25.4).toFixed(2) : form.lbs.toFixed(3)) : "");
                  }
                }}
              />
            </div>}
          </div>

          {/* Chamfer Mill specific fields */}
          {form.tool_type === "chamfer_mill" && (
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <FieldLabel hint="CMH series: high-performance with shear angle and edge prep — runs significantly higher chip load. CMS series: straight-flute, center-cutting — lower chip load (~65% of CMH).">Series</FieldLabel>
                <div className="flex gap-1.5">
                  {(["CMH", "CMS"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, chamfer_series: s }))}
                      className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: form.chamfer_series === s ? "#6366f1" : "transparent",
                        borderColor: "#6366f1",
                        color: form.chamfer_series === s ? "#fff" : "#6366f1",
                      }}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <FieldLabel hint="Included angle of the chamfer mill (tip angle). CMS series: 60°, 90°, 120°. CMH series: 60°, 82°, 90°, 100°, 120°.">Chamfer Angle</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {([60, 82, 90, 100, 120] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, chamfer_angle: a }))}
                      className="rounded px-3 py-1 text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: form.chamfer_angle === a ? "#6366f1" : "transparent",
                        borderColor: "#6366f1",
                        color: form.chamfer_angle === a ? "#fff" : "#6366f1",
                      }}
                    >{a}°</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <FieldLabel hint="Tip diameter (flat at the very tip). CMH series has a tip flat — enter from catalog. CMS series is center-cutting with a point, leave at 0.">Tip Dia (in)</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="no-spinners"
                      placeholder="0 = point (CMS)"
                      value={chamferTipDiaText}
                      onChange={(e) => setChamferTipDiaText(e.target.value)}
                      onBlur={() => {
                        const n = parseFloat(chamferTipDiaText);
                        if (Number.isFinite(n) && n >= 0) {
                          setForm((p) => ({ ...p, chamfer_tip_dia: n }));
                          setChamferTipDiaText(n > 0 ? n.toFixed(4) : "");
                        } else {
                          setChamferTipDiaText(form.chamfer_tip_dia > 0 ? form.chamfer_tip_dia.toFixed(4) : "");
                        }
                      }}
                    />
                  </div>
                </div>
                {skuChamferEdgeLength && form.tool_dia > 0 && (() => {
                  const halfRad = (form.chamfer_angle / 2) * (Math.PI / 180);
                  const radialReach = (form.tool_dia - (form.chamfer_tip_dia ?? 0)) / 2;
                  const edgeLength = halfRad > 0 ? radialReach / Math.sin(halfRad) : 0;
                  const maxDepth = halfRad > 0 ? radialReach / Math.tan(halfRad) : 0;
                  const isCms = !(form.chamfer_tip_dia > 0);
                  const tipX = isCms ? 138 : 128;
                  return (
                    <div className="col-span-2 rounded-lg bg-zinc-800/60 border border-zinc-700 px-3 py-2 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-orange-400">Cutting Edge Length</span>
                        <span className="font-mono font-semibold text-orange-400">{edgeLength.toFixed(4)}"</span>
                        <span className="text-zinc-600">|</span>
                        <span className="text-blue-400">Max Chamfer Depth</span>
                        <span className="font-mono font-semibold text-blue-400">{maxDepth.toFixed(4)}"</span>
                      </div>
                      {(() => {
                        const topY = 12, clY = 74;
                        const bodyX1 = 22, chamferX = 58;
                        const tipX = isCms ? 230 : 205;
                        const tipHalfPx = (!isCms && form.tool_dia > 0)
                          ? Math.max(5, (form.chamfer_tip_dia / form.tool_dia) * (clY - topY))
                          : 0;
                        const tipY = clY - tipHalfPx;
                        const lMidX = (chamferX + tipX) / 2;
                        const lMidY = (topY + tipY) / 2;
                        const lAngle = Math.round(Math.atan2(tipY - topY, tipX - chamferX) * 180 / Math.PI);
                        const dArrowY = clY + 13;
                        return (
                          <svg viewBox="0 0 265 98" width="100%" height="88" className="block mt-1">
                            <defs>
                              <clipPath id="cc-hatch2">
                                <rect x={bodyX1} y={topY} width="9" height={clY - topY}/>
                              </clipPath>
                            </defs>
                            {/* Cross-hatch on left end face */}
                            <g clipPath="url(#cc-hatch2)">
                              {[0,7,14,21,28,35,42,49,56,63,70].map((d,i) =>
                                <line key={i} x1={bodyX1+d-(clY-topY)} y1={clY} x2={bodyX1+d} y2={topY} stroke="#666" strokeWidth="0.75"/>
                              )}
                            </g>
                            {/* Tool body top wall */}
                            <line x1={bodyX1} y1={topY} x2={chamferX} y2={topY} stroke="#888" strokeWidth="1.5"/>
                            {/* Left end cap */}
                            <line x1={bodyX1} y1={topY} x2={bodyX1} y2={clY} stroke="#888" strokeWidth="1.5"/>
                            {/* Shoulder line where body meets chamfer */}
                            <line x1={chamferX} y1={topY} x2={chamferX} y2={clY} stroke="#555" strokeWidth="1" strokeDasharray="3,2"/>
                            {/* Centerline — proper long-short-long drafting linetype */}
                            <line x1={bodyX1-6} y1={clY} x2={tipX+12} y2={clY} stroke="#4a4a5a" strokeWidth="1" strokeDasharray="12,3,3,3"/>
                            {/* Chamfer cutting edge (orange) */}
                            <line x1={chamferX} y1={topY} x2={tipX} y2={tipY} stroke="#f97316" strokeWidth="2.5"/>
                            {/* CMS: point on CL */}
                            {isCms && <polygon points={`${tipX},${clY} ${tipX-9},${clY-7} ${tipX-9},${clY}`} fill="#f97316" opacity="0.85"/>}
                            {/* CMH: gray flat face from tipY down to CL */}
                            {!isCms && <line x1={tipX} y1={tipY} x2={tipX} y2={clY} stroke="#52525b" strokeWidth="2.5"/>}
                            {/* Depth ref ticks */}
                            <line x1={chamferX} y1={clY} x2={chamferX} y2={dArrowY+2} stroke="#3b82f6" strokeWidth="0.5" strokeDasharray="2,2"/>
                            <line x1={tipX} y1={clY} x2={tipX} y2={dArrowY+2} stroke="#3b82f6" strokeWidth="0.5" strokeDasharray="2,2"/>
                            {/* Depth arrow */}
                            <line x1={chamferX} y1={dArrowY} x2={tipX} y2={dArrowY} stroke="#3b82f6" strokeWidth="1.5"/>
                            <polygon points={`${chamferX},${dArrowY} ${chamferX+7},${dArrowY-3} ${chamferX+7},${dArrowY+3}`} fill="#3b82f6"/>
                            <polygon points={`${tipX},${dArrowY} ${tipX-7},${dArrowY-3} ${tipX-7},${dArrowY+3}`} fill="#3b82f6"/>
                            <text x={(chamferX+tipX)/2} y={dArrowY+9} fontSize="8" fill="#60a5fa" fontFamily="monospace" textAnchor="middle">d={maxDepth.toFixed(3)}"</text>
                            {/* L label along cutting edge */}
                            <text x={lMidX} y={lMidY-4} fontSize="8.5" fill="#fb923c" fontFamily="monospace" textAnchor="middle" transform={`rotate(${lAngle},${lMidX},${lMidY-4})`}>L={edgeLength.toFixed(3)}"</text>
                            {/* Series label */}
                            <text x={tipX - 10} y={topY - 1} fontSize="8" fill="#6b7280" textAnchor="end">{isCms ? "CMS — Center Cutting" : "CMH — Non-Center (flat tip)"}</text>
                          </svg>
                        );
                      })()}
                    </div>
                  );
                })()}
                <div className="space-y-1.5">
                  <FieldLabel hint={
                    <div className="space-y-2">
                      <p>Axial depth of the chamfer being cut. D_eff = tip_dia + 2 × depth × tan(angle/2).</p>
                      {/* Chamfer geometry diagram */}
                      <svg viewBox="0 0 160 100" width="160" height="100" className="block mx-auto">
                        {/* Tool body outline */}
                        <line x1="20" y1="10" x2="20" y2="50" stroke="#888" strokeWidth="1.5"/>
                        <line x1="20" y1="10" x2="100" y2="10" stroke="#888" strokeWidth="1.5"/>
                        {/* Chamfer cutting edge */}
                        <line x1="100" y1="10" x2={form.chamfer_tip_dia > 0 ? "130" : "140"} y2="50" stroke="#f97316" strokeWidth="2"/>
                        {/* Tip flat (CMH) or point (CMS) */}
                        {form.chamfer_tip_dia > 0
                          ? <line x1="130" y1="50" x2="130" y2="70" stroke="#f97316" strokeWidth="2"/>
                          : null}
                        {/* Bottom of tool / axis */}
                        <line x1="20" y1="50" x2={form.chamfer_tip_dia > 0 ? "130" : "140"} y2="50" stroke="#555" strokeWidth="1" strokeDasharray="3,2"/>
                        {/* Depth arrow */}
                        <line x1="145" y1="10" x2="145" y2="50" stroke="#60a5fa" strokeWidth="1"/>
                        <polygon points="145,10 142,17 148,17" fill="#60a5fa"/>
                        <polygon points="145,50 142,43 148,43" fill="#60a5fa"/>
                        <text x="150" y="33" fontSize="9" fill="#60a5fa">d</text>
                        {/* Edge length label along cutting edge */}
                        <text x="108" y="26" fontSize="9" fill="#f97316" transform="rotate(35,108,26)">L</text>
                        {/* OD label */}
                        <text x="55" y="8" fontSize="8" fill="#aaa" textAnchor="middle">OD</text>
                        {/* Tip label */}
                        {form.chamfer_tip_dia > 0
                          ? <text x="135" y="65" fontSize="8" fill="#aaa">tip</text>
                          : <text x="133" y="48" fontSize="8" fill="#aaa">▲</text>}
                        {/* Series label */}
                        <text x="5" y="90" fontSize="8" fill="#aaa">{form.chamfer_tip_dia > 0 ? "CMH — flat tip" : "CMS — center cutting"}</text>
                      </svg>
                    </div>
                  }>Chamfer Depth (in)</FieldLabel>
                  <Input
                    type="text"
                    inputMode="decimal"
                    className="no-spinners"
                    placeholder={(() => {
                      if (!(form.tool_dia > 0) || !(form.chamfer_angle > 0)) return "e.g. 0.050";
                      const halfRad = (form.chamfer_angle / 2) * (Math.PI / 180);
                      const radialReach = (form.tool_dia - (form.chamfer_tip_dia ?? 0)) / 2;
                      const maxD = halfRad > 0 ? radialReach / Math.tan(halfRad) : 0;
                      if (!(maxD > 0)) return "e.g. 0.050";
                      // Saddling sweet spot: middle 60% for CMS, middle 80% for CMH
                      const skip = form.chamfer_series === "CMS" ? 0.20 : 0.10;
                      const lo = maxD * skip;
                      const hi = maxD * (1 - skip);
                      return `saddle ${lo.toFixed(3)}"–${hi.toFixed(3)}"`;
                    })()}
                    value={chamferDepthText}
                    onChange={(e) => setChamferDepthText(e.target.value)}
                    onBlur={() => {
                      const n = parseFloat(chamferDepthText);
                      if (Number.isFinite(n) && n > 0) {
                        setForm((p) => ({ ...p, chamfer_depth: n }));
                        setChamferDepthText(n.toFixed(4));
                      } else {
                        setChamferDepthText(form.chamfer_depth > 0 ? form.chamfer_depth.toFixed(4) : "");
                      }
                    }}
                  />
                  {(() => {
                    if (!(form.chamfer_depth > 0) || !(form.tool_dia > 0) || !(form.chamfer_angle > 0)) return null;
                    const halfRad = (form.chamfer_angle / 2) * (Math.PI / 180);
                    const radialReach = (form.tool_dia - (form.chamfer_tip_dia ?? 0)) / 2;
                    const edgeLength = halfRad > 0 ? radialReach / Math.sin(halfRad) : 0;
                    const maxDepth = halfRad > 0 ? radialReach / Math.tan(halfRad) : 0;
                    if (form.chamfer_depth <= maxDepth) return null;
                    return (
                      <p className="mt-1 text-xs text-red-400">
                        ⚠ Depth exceeds max ({maxDepth.toFixed(4)}") — tool cutting edge is only {edgeLength.toFixed(4)}" long. Reduce depth or use a larger tool.
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Corner Condition — endmill only */}
          {form.tool_type !== "chamfer_mill" && <div className="space-y-1.5">
            <FieldLabel hint="End geometry of the tool. Square = sharp corner, 0° entry radius. Corner Radius = honed edge for strength. Ball Nose = hemispherical tip for 3D contouring.">Corner Condition</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {(["square", "corner_radius"] as const).map((key) => {
                const label = key === "square" ? "Square" : "Corner Radius";
                const tt = key === "square" ? "endmill" : "corner_radius";
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setForm((p) => ({ ...p, corner_condition: key, tool_type: tt, corner_radius: key === "square" ? 0 : p.corner_radius })); if (key === "square") setCrText(""); }}
                    className="rounded px-3 py-1 text-xs font-semibold border transition-all"
                    style={{ backgroundColor: form.corner_condition === key ? "#6366f1" : "transparent", borderColor: "#6366f1", color: form.corner_condition === key ? "#fff" : "#6366f1" }}
                  >
                    {label}
                  </button>
                );
              })}
              {form.corner_condition === "corner_radius" && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{UL("CR (in)", "CR (mm)")}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="h-7 w-20 text-xs no-spinners rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
                    value={crText}
                    onChange={(e) => setCrText(e.target.value)}
                    onBlur={() => {
                      const n = parseFloat(crText);
                      if (Number.isFinite(n) && n > 0) {
                        const val = metric ? n / 25.4 : n;
                        setForm((p) => ({ ...p, corner_radius: val }));
                        setCrText(metric ? n.toFixed(2) : val.toFixed(3));
                      } else {
                        setCrText(form.corner_radius > 0 ? (metric ? (form.corner_radius * 25.4).toFixed(2) : form.corner_radius.toFixed(3)) : "");
                      }
                    }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, corner_condition: "ball", tool_type: "ballnose", corner_radius: 0 }))}
                className="rounded px-3 py-1 text-xs font-semibold border transition-all"
                style={{ backgroundColor: form.corner_condition === "ball" ? "#6366f1" : "transparent", borderColor: "#6366f1", color: form.corner_condition === "ball" ? "#fff" : "#6366f1" }}
              >
                Ball Nose
              </button>
            </div>
          </div>}

          {form.tool_type !== "chamfer_mill" && <div className="space-y-1.5">
            <FieldLabel hint="Standard = full-length flute. Chipbreaker (-CB) = notched flute that segments the chip, net ~20% force reduction. Truncated Rougher (VXR) = serrated flute with negative K-land edge prep — K-land strengthens the edge but adds back ~12% pressure, so net force reduction is ~17% vs standard.">
              Flute Geometry
            </FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {([
                { key: "standard",          label: "Standard" },
                { key: "chipbreaker",       label: "Chipbreaker (CB)" },
                { key: "truncated_rougher", label: "Truncated Rougher (VXR)" },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, geometry: key }))}
                  className="rounded px-3 py-1 text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: form.geometry === key ? "#6366f1" : "transparent",
                    borderColor: "#6366f1",
                    color: form.geometry === key ? "#fff" : "#6366f1",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>}

          {form.tool_type !== "chamfer_mill" && <div className="space-y-1.5 mt-1">
            <FieldLabel hint="Variable Pitch spaces flute angles unevenly to disrupt regenerative chatter — the primary driver of vibration in steel, stainless, and titanium. Variable Helix varies the helix angle along the flute length to spread axial cutting forces and further dampen vibration. Most Core Cutter steel/stainless/titanium tools are Variable Pitch; select tools add Variable Helix. Aluminum tools are typically neither.">
              Tool Design
            </FieldLabel>
            <div className="flex gap-4">
              {([
                { key: "variable_pitch" as const, label: "Variable Pitch" },
                { key: "variable_helix" as const, label: "Variable Helix" },
              ]).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.checked }))}
                    className="w-4 h-4 rounded accent-indigo-500"
                  />
                  <span className="text-xs font-semibold text-indigo-400">{label}</span>
                </label>
              ))}
            </div>
          </div>}
          </>) : operation === "drilling" ? (<>
          {/* PDF Upload for drilling */}
          {!pdfExtracted && (
            <div className="rounded-lg border border-dashed border-gray-600 p-3 mb-3">
              <label className="flex flex-col items-center gap-1 cursor-pointer">
                <span className="text-xs text-gray-400">Upload CC-XXXXX print to auto-fill dimensions</span>
                <span className="rounded border border-orange-500 text-orange-400 hover:bg-orange-500 hover:text-white transition-colors px-3 py-1.5 text-xs font-semibold inline-block">
                  {pdfUploading ? "Reading print…" : "⬆ Upload CC Print (PDF)"}
                </span>
                <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={pdfUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPrintPdf(f); e.target.value = ""; }} />
              </label>
            </div>
          )}
          {pdfExtracted && (
            <div className="rounded-lg border border-amber-500 bg-amber-950/20 p-2 mb-3 flex items-center justify-between">
              <span className="text-xs text-amber-400 font-medium">✓ Dimensions extracted from CC print{pdfToolNumber ? ` (${pdfToolNumber})` : ""} — review fields below</span>
              <button type="button" onClick={() => setPdfExtracted(false)} className="text-[10px] text-gray-400 hover:text-white underline">Clear</button>
            </div>
          )}
          {/* Drilling tool fields */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <FieldLabel hint="Entry diameter — the smallest (tip) diameter. SFM is set by the largest step diameter; feed (IPR) is set by this entry diameter.">{form.drill_steps > 0 ? "Entry Dia (in)" : "Drill Dia (in)"}</FieldLabel>
              <Input
                type="text" inputMode="decimal" className="no-spinners"
                value={toolDiaText}
                onChange={(e) => setToolDiaText(e.target.value)}
                onFocus={() => { if (form.tool_dia) setToolDiaText(form.tool_dia.toFixed(4)); }}
                onBlur={() => {
                  const n = parseDim(toolDiaText);
                  if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, tool_dia: n })); setToolDiaText(n.toFixed(4)); }
                  else setToolDiaText(form.tool_dia > 0 ? form.tool_dia.toFixed(4) : "");
                }}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Flute length — the fluted portion of the drill from tip to where the shank begins. Sets the maximum usable hole depth; the engine warns if hole depth exceeds flute length minus point clearance.">Flute Length (in)</FieldLabel>
              <Input
                type="text" inputMode="decimal" className="no-spinners"
                placeholder="e.g. 1.5"
                value={drillFluteLenText}
                onChange={(e) => setDrillFluteLenText(e.target.value)}
                onBlur={() => {
                  const n = parseDim(drillFluteLenText);
                  if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, drill_flute_length: n })); setDrillFluteLenText(n.toFixed(3)); }
                  else setDrillFluteLenText(form.drill_flute_length > 0 ? form.drill_flute_length.toFixed(3) : "");
                }}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Number of flutes on the drill. Standard jobber drills are 2-flute. Some specialty drills use 3 or 4 flutes for improved chip evacuation in non-ferrous materials.">Flutes</FieldLabel>
              <Input
                type="number"
                step="1"
                className="no-spinners"
                value={form.flutes > 0 ? form.flutes : 2}
                onChange={(e) => {
                  const n = parseInt(e.target.value);
                  setForm((p) => ({ ...p, flutes: Number.isFinite(n) && n > 0 ? n : 2 }));
                }}
              />
            </div>
          </div>
          {/* Steps selector */}
          <div className="space-y-1.5 mt-3">
            <FieldLabel hint="Standard = single diameter drill. Step Drill = enter the largest diameter; SFM is set by the largest diameter, feed (IPR) by the entry (smallest) diameter.">Drill Type</FieldLabel>
            <div className="flex gap-2">
              {([0, 1] as const).map((n) => (
                <button key={n} type="button"
                  onClick={() => {
                    setStepDiaTexts(n === 0 ? [] : [""]);
                    setStepLenTexts([]);
                    setForm((p) => ({ ...p, drill_steps: n, drill_step_diameters: [], drill_step_lengths: [] }));
                  }}
                  className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: form.drill_steps === n ? "#6366f1" : "transparent",
                    borderColor: "#6366f1", color: form.drill_steps === n ? "#fff" : "#6366f1",
                  }}
                >{n === 0 ? "Standard" : "Step Drill"}</button>
              ))}
            </div>
          </div>

          {/* Step drill — largest diameter only */}
          {form.drill_steps > 0 && (
            <div className="mt-3">
              <div className="space-y-1">
                <FieldLabel hint="Largest diameter on the step drill. SFM and RPM are calculated on this diameter.">Largest Dia (in)</FieldLabel>
                <Input
                  type="text" inputMode="decimal" className="no-spinners"
                  placeholder="e.g. 0.500"
                  value={stepDiaTexts[0] ?? ""}
                  onChange={(e) => setStepDiaTexts([e.target.value])}
                  onBlur={() => {
                    const n = parseDim(stepDiaTexts[0] ?? "");
                    if (Number.isFinite(n) && n > 0) {
                      setForm((p) => ({ ...p, drill_step_diameters: [n] }));
                      setStepDiaTexts([n.toFixed(4)]);
                    }
                  }}
                />
              </div>
            </div>
          )}


          {/* Coolant Fed — drill tool property */}
          <div className="space-y-1.5 mt-3">
            <FieldLabel hint="Coolant-fed drills have internal through-holes that deliver coolant directly to the cutting edge. This significantly improves chip evacuation, extends tool life, and allows deeper holes without pecking vs non-coolant-fed drills.">Coolant Delivery</FieldLabel>
            <div className="flex gap-2">
              {([{ val: false, label: "Non-Coolant Fed" }, { val: true, label: "Coolant Fed (Through)" }] as const).map(({ val, label }) => (
                <button key={String(val)} type="button"
                  onClick={() => setForm((p) => ({ ...p, drill_coolant_fed: val }))}
                  className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: form.drill_coolant_fed === val ? "#6366f1" : "transparent",
                    borderColor: "#6366f1", color: form.drill_coolant_fed === val ? "#fff" : "#6366f1",
                  }}
                >{label}</button>
              ))}
            </div>
          </div>

          {/* Flute Geometry */}
          {(() => {
            const iso = isoCategory;
            const depthD = form.tool_dia > 0 && form.drill_hole_depth > 0 ? form.drill_hole_depth / form.tool_dia : 0;
            const isDeep = depthD > 5;
            const isVeryDeep = depthD > 7;
            const hasCoolant = form.drill_coolant_fed;

            // Base recommendation by material
            let recGeo: string[] = [];
            if (iso === "N" || iso === "K") {
              recGeo = ["standard"];
            } else if (iso === "P") {
              recGeo = isDeep ? ["med_helix"] : ["standard"];
            } else if (iso === "M") {
              recGeo = isDeep ? ["high_helix"] : ["med_helix"];
            } else if (iso === "S") {
              recGeo = ["high_helix"];
            } else if (iso === "H") {
              recGeo = ["standard", "med_helix"];
            }

            // Coolant-through: can step down one level (coolant does evacuation work)
            if (hasCoolant && recGeo.includes("high_helix") && !isVeryDeep) {
              recGeo = ["med_helix"];
            } else if (hasCoolant && recGeo.includes("med_helix") && !isDeep) {
              recGeo = ["standard"];
            }

            // No coolant + deep: nudge up
            if (!hasCoolant && isDeep && recGeo.includes("standard")) {
              recGeo = ["med_helix"];
            }
            if (!hasCoolant && isVeryDeep && recGeo.includes("med_helix")) {
              recGeo = ["high_helix"];
            }

            const hasRec = recGeo.length > 0;
            return (
              <div className="space-y-1.5 mt-3">
                <div className="flex items-center justify-between">
                  <FieldLabel hint="Flute geometry determines chip storage capacity and evacuation speed. Standard: up to 5×D. Med Helix: 5–7×D, better chip lift. High Helix: 7–9×D, steep flute for deep hole chip flow. Coolant-through can allow one step lower geometry.">Flute Geometry</FieldLabel>
                  {hasRec && (
                    <span className="text-[10px] text-amber-400 font-medium">★ recommended for this setup</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {([
                    { val: "standard",   label: "Standard",   depth: "up to 5×D", desc: "General purpose twist drill" },
                    { val: "med_helix",  label: "Med Helix",  depth: "5–7×D",     desc: "Moderate helix, better chip lift" },
                    { val: "high_helix", label: "High Helix", depth: "7–9×D",     desc: "Steep helix, deep hole chip flow" },
                  ] as const).map(({ val, label, depth, desc }) => {
                    const active = form.drill_geometry === val;
                    const isRec = recGeo.includes(val);
                    return (
                      <button key={val} type="button"
                        onClick={() => setForm((p) => ({ ...p, drill_geometry: val }))}
                        className="flex-1 rounded border transition-all px-2 py-2 text-left"
                        style={{
                          backgroundColor: active ? "#6366f1" : isRec ? "rgba(245,158,11,0.12)" : "transparent",
                          borderColor: active ? "#6366f1" : isRec ? "#f59e0b" : "#6366f1",
                        }}
                      >
                        <div className={`text-xs font-semibold leading-tight ${active ? "text-white" : isRec ? "text-amber-400" : "text-indigo-400"}`}>
                          {label}{isRec && !active ? " ★" : ""}
                        </div>
                        <div className={`text-[10px] font-bold mt-0.5 ${active ? "text-indigo-200" : isRec ? "text-amber-500" : "text-indigo-500"}`}>{depth}</div>
                        <div className={`text-[9px] leading-tight mt-0.5 ${active ? "text-indigo-100" : "text-muted-foreground"}`}>{desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Point Angle */}
          {(() => {
            // Recommend point angle based on material, depth, and hole type
            const iso = isoCategory;
            const depthD = form.tool_dia > 0 && form.drill_hole_depth > 0 ? form.drill_hole_depth / form.tool_dia : 0;
            const isDeep = depthD > 5;
            const isBlind = form.drill_blind;

            let recommended: number[] = [];
            if (iso === "N") {
              recommended = [118];
            } else if (iso === "P") {
              recommended = isDeep ? [135, 140] : [130, 135];
            } else if (iso === "K") {
              recommended = [118, 130];
            } else if (iso === "M") {
              recommended = isDeep ? [140, 145] : [135, 140];
            } else if (iso === "S") {
              recommended = [140, 145];
            } else if (iso === "H") {
              recommended = [135, 140];
            }
            // Blind holes favor higher angle (stronger edge)
            if (isBlind && recommended.length > 0) {
              const max = Math.max(...recommended);
              if (!recommended.includes(max + 5) && max < 145) recommended = [max];
              else recommended = [Math.min(...recommended) + 5 <= 145 ? Math.min(...recommended) + 5 : max];
            }

            const hasRecommendation = recommended.length > 0;

            return (
              <div className="space-y-1.5 mt-3">
                <div className="flex items-center justify-between">
                  <FieldLabel hint="Controls cutting aggressiveness, chip formation, and centering. 118° = soft materials & aluminum. 130° = general purpose carbide (alloy/stainless). 135° = stainless & tough alloys. 140° = high-performance / deep holes. 145° = superalloys & aerospace (Inconel, Ti).">Point Angle</FieldLabel>
                  {hasRecommendation && (
                    <span className="text-[10px] text-amber-400 font-medium">★ recommended for this setup</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {([118, 130, 135, 140, 145] as const).map((pa) => {
                    const isSelected = form.drill_point_angle === pa;
                    const isRec = recommended.includes(pa);
                    return (
                      <button key={pa} type="button"
                        onClick={() => setForm((p) => ({ ...p, drill_point_angle: pa }))}
                        className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                        style={{
                          backgroundColor: isSelected ? "#6366f1" : isRec ? "rgba(245,158,11,0.12)" : "transparent",
                          borderColor: isSelected ? "#6366f1" : isRec ? "#f59e0b" : "#6366f1",
                          color: isSelected ? "#fff" : isRec ? "#f59e0b" : "#6366f1",
                        }}
                      >{pa}°{isRec && !isSelected ? " ★" : ""}</button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          </>) : null}

          {/* Reaming Tool Geometry */}
          {operation === "reaming" && (<>
          {/* PDF Upload for reaming */}
          <div className={`mt-3 rounded-xl border-2 border-dashed px-4 py-3 ${pdfExtracted ? "border-amber-500 bg-amber-500/10" : "border-zinc-600"}`}>
            {pdfExtracted ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-400 font-medium">✓ Dimensions extracted from CC print{pdfToolNumber ? ` (${pdfToolNumber})` : ""} — review fields below</span>
                <button type="button" onClick={() => setPdfExtracted(false)} className="text-[10px] text-gray-400 hover:text-white underline">Clear</button>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-1 cursor-pointer">
                <span className="text-xs text-gray-400">Upload CC-XXXXX print to auto-fill dimensions</span>
                <span className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white transition-colors pointer-events-none">
                  {pdfUploading ? "Reading print…" : "⬆ Upload CC Print (PDF)"}
                </span>
                <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={pdfUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPrintPdf(f); e.target.value = ""; }} />
              </label>
            )}
          </div>
          {/* Mode toggle */}
          <div className="flex gap-2 mt-3">
            {(["print", "known"] as const).map((m) => (
              <button key={m} type="button"
                onClick={() => setReamMode(m)}
                className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                style={{
                  backgroundColor: reamMode === m ? "#6366f1" : "transparent",
                  borderColor: "#6366f1", color: reamMode === m ? "#fff" : "#6366f1",
                }}>
                {m === "print" ? "📐 From Print Dimension" : "🔧 I Know My Reamer Size"}
              </button>
            ))}
          </div>

          {reamMode === "print" ? (<>
            {/* Print-dimension workflow */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <FieldLabel hint="The finished hole diameter called out on the print. The reamer will be ground to this nominal size.">
                  {UL("Finished Hole Dia (in.)", "Finished Hole Dia (mm)")}
                </FieldLabel>
                <Input type="text" inputMode="decimal" className="no-spinners"
                  placeholder={metric ? "e.g. 12.700" : "e.g. 0.5000"}
                  value={reamFinishedDiaText}
                  onChange={(e) => setReamFinishedDiaText(e.target.value)}
                  onBlur={() => {
                    const n = parseDim(reamFinishedDiaText);
                    if (Number.isFinite(n) && n > 0) {
                      const stock = reamStockRange(n);
                      const preDrill = stock ? +(n - stock.ideal).toFixed(4) : 0;
                      setForm((p) => ({ ...p, tool_dia: n, ream_pre_drill_dia: preDrill }));
                      setReamFinishedDiaText(metric ? (n * 25.4).toFixed(3) : n.toFixed(4));
                    }
                  }}
                />
              </div>
              <div>
                <FieldLabel hint="ISO hole tolerance class. H7 is the standard for most reaming applications. H6 is tighter (precision bores); H8 is looser (general clearance fits).">Tolerance Class</FieldLabel>
                <div className="flex gap-1 mt-1">
                  {(["H6","H7","H8"] as const).map((cls) => (
                    <button key={cls} type="button"
                      onClick={() => setReamTolClass(cls)}
                      className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: reamTolClass === cls ? "#6366f1" : "transparent",
                        borderColor: "#6366f1", color: reamTolClass === cls ? "#fff" : "#6366f1",
                      }}>{cls}</button>
                  ))}
                </div>
              </div>
            </div>
            {form.tool_dia > 0 && (
              <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2.5 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Reamer OD</span>
                  <span className="font-semibold text-foreground">{metric ? (form.tool_dia * 25.4).toFixed(3) + " mm" : form.tool_dia.toFixed(4) + '"'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Tolerance Band ({reamTolClass})</span>
                  <span className="font-mono text-indigo-300">{reamTolBand(form.tool_dia, reamTolClass)}</span>
                </div>
                {(() => {
                  const stock = reamStockRange(form.tool_dia);
                  if (!stock) return null;
                  const ideal = +(form.tool_dia - stock.ideal).toFixed(4);
                  const lo    = +(form.tool_dia - stock.max).toFixed(4);
                  const hi    = +(form.tool_dia - stock.min).toFixed(4);
                  const drills = nearestDrills(ideal, lo, hi);
                  const ranked = [...drills].sort((a, b) => Math.abs(a.dia - ideal) - Math.abs(b.dia - ideal));
                  const rankStyle = [
                    "border-emerald-500/60 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-400",
                    "border-amber-500/60  bg-amber-500/10  text-amber-300  hover:bg-amber-500/25  hover:border-amber-400",
                  ];
                  return (<>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Recommended Pre-Drill</span>
                      <span className="font-semibold text-foreground">{metric ? (ideal * 25.4).toFixed(3) + " mm" : ideal.toFixed(4) + '"'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-400">Nearest Drill Sizes</span>
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        {ranked.map((d, i) => (
                          <button key={d.label} type="button"
                            title="Click to use this pre-drill size"
                            onClick={() => setForm((p) => ({ ...p, ream_pre_drill_dia: +d.dia.toFixed(4) }))}
                            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold transition-all cursor-pointer ${rankStyle[i] ?? "border-zinc-600 bg-zinc-800 text-foreground"}`}>
                            {d.label}
                            <span className="font-normal text-[10px] opacity-60">{d.dia.toFixed(4)}"</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>);
                })()}
              </div>
            )}
          </>) : (<>
            {/* Known-reamer workflow */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <FieldLabel hint="Reamer cutting diameter.">{UL("Reamer Dia (in.)", "Reamer Dia (mm)")}</FieldLabel>
                <Input type="number" step={metric ? "0.01" : "0.0001"} className="no-spinners"
                  value={form.tool_dia ? (metric ? (form.tool_dia * 25.4).toFixed(3) : form.tool_dia) : ""}
                  onChange={onUnitNum("tool_dia", 25.4)} />
              </div>
              <div>
                <FieldLabel hint="Pre-drilled hole diameter. Must be within the correct undersize range for the reamer.">{UL("Pre-Drill Dia (in.)", "Pre-Drill Dia (mm)")}</FieldLabel>
                <Input type="text" inputMode="decimal" className="no-spinners"
                  placeholder={(() => {
                    const s = reamStockRange(form.tool_dia);
                    if (!s) return metric ? "e.g. 12.34" : "e.g. 0.4865";
                    const lo = form.tool_dia - s.max, hi = form.tool_dia - s.min;
                    return metric ? `${(lo * 25.4).toFixed(2)} – ${(hi * 25.4).toFixed(2)}` : `${lo.toFixed(4)} – ${hi.toFixed(4)}`;
                  })()}
                  value={form.ream_pre_drill_dia ? (metric ? (form.ream_pre_drill_dia * 25.4).toFixed(3) : form.ream_pre_drill_dia) : ""}
                  onChange={onUnitNum("ream_pre_drill_dia", 25.4)} />
                {(() => {
                  const stock = reamStockRange(form.tool_dia);
                  if (!stock) return null;
                  const ideal  = +(form.tool_dia - stock.ideal).toFixed(4);
                  const lo     = +(form.tool_dia - stock.max).toFixed(4);
                  const hi     = +(form.tool_dia - stock.min).toFixed(4);
                  const drills = nearestDrills(ideal, lo, hi);
                  const ranked = [...drills].sort((a, b) => Math.abs(a.dia - ideal) - Math.abs(b.dia - ideal));
                  const rankStyle = [
                    "border-emerald-500/60 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-400",
                    "border-amber-500/60  bg-amber-500/10  text-amber-300  hover:bg-amber-500/25  hover:border-amber-400",
                  ];
                  return (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {ranked.map((d, i) => (
                        <button key={d.label} type="button"
                          onClick={() => setForm((p) => ({ ...p, ream_pre_drill_dia: +d.dia.toFixed(4) }))}
                          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold transition-all cursor-pointer ${rankStyle[i] ?? "border-zinc-600 bg-zinc-800 text-foreground"}`}>
                          {d.label}
                          <span className="font-normal text-[10px] opacity-60">{d.dia.toFixed(4)}"</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </>)}

          {/* Flutes + Shank — shared across both modes */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <FieldLabel hint="Number of flutes on the reamer. Leave blank to use the standard count for this diameter.">Flutes</FieldLabel>
              <Input type="number" step="1" className="no-spinners"
                placeholder={String(reamFlutes(form.tool_dia))}
                value={form.flutes || ""} onChange={onNum("flutes")} />
              {form.tool_dia > 0 && (
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">
                    Standard: <span className="font-semibold text-foreground">{reamFlutes(form.tool_dia)}-flute</span>
                  </span>
                  {form.flutes > 0 && form.flutes !== reamFlutes(form.tool_dia) && (
                    <button type="button"
                      className="rounded bg-indigo-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300 hover:bg-indigo-600/50 transition-colors"
                      onClick={() => setForm((p) => ({ ...p, flutes: reamFlutes(form.tool_dia) }))}>
                      Use standard
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <FieldLabel hint="Shank diameter. Defaults to cut diameter if left blank.">{UL("Shank Dia (in.)", "Shank Dia (mm)")}</FieldLabel>
              <Input type="number" step={metric ? "0.01" : "0.0001"} className="no-spinners"
                placeholder={form.tool_dia ? (metric ? (form.tool_dia * 25.4).toFixed(3) : form.tool_dia.toFixed(4)) : (metric ? "e.g. 12.70" : "e.g. 0.500")}
                value={form.ream_shank_dia ? (metric ? (form.ream_shank_dia * 25.4).toFixed(3) : form.ream_shank_dia) : ""}
                onChange={onUnitNum("ream_shank_dia", 25.4)} />
            </div>
          </div>

          {/* Reaming — Coolant Delivery (Identity 1 vs 2/3) */}
          <div className="space-y-1.5 mt-3">
            <FieldLabel hint="Coolant-fed reamers have internal coolant passages that deliver coolant directly to the cutting edges — critical for blind holes, deep holes, and gummy materials. Non-coolant-fed relies entirely on external coolant.">Coolant Delivery</FieldLabel>
            <div className="flex gap-2">
              {([
                { val: false, label: "Non-Coolant Fed" },
                { val: true,  label: "Coolant Fed (Through)" },
              ] as const).map(({ val, label }) => (
                <button key={String(val)} type="button"
                  onClick={() => setForm((p) => ({ ...p, ream_coolant_fed: val }))}
                  className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: form.ream_coolant_fed === val ? "#6366f1" : "transparent",
                    borderColor: "#6366f1", color: form.ream_coolant_fed === val ? "#fff" : "#6366f1",
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
          </>)}

          {/* Cut Engagement — milling only, not chamfer mills */}
          {operation === "milling" && form.tool_type !== "chamfer_mill" && (<>
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Cut Engagement</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>
          {/* circ_interp: hole dimensions live here */}
          {form.mode === "circ_interp" && (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="space-y-1.5">
                <FieldLabel hint="Diameter of the existing pre-drilled or pre-bored hole the tool will enter. Must be larger than the tool diameter.">{UL("Existing Hole Ø (in)", "Existing Hole Ø (mm)")}</FieldLabel>
                <input type="text" inputMode="decimal" placeholder="e.g. 0.750"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring no-spinners"
                  value={existingHoleText}
                  onChange={(e) => setExistingHoleText(e.target.value)}
                  onBlur={() => {
                    const n = parseFloat(existingHoleText);
                    if (Number.isFinite(n) && n > 0) {
                      const val = metric ? n / 25.4 : n;
                      setForm((p) => ({ ...p, existing_hole_dia: val }));
                      setExistingHoleText(metric ? n.toFixed(2) : val.toFixed(3));
                    } else { setExistingHoleText(form.existing_hole_dia > 0 ? form.existing_hole_dia.toFixed(3) : ""); }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel hint="Final target hole diameter after circular interpolation. The radial wall removed per pass = (Target − Existing) / 2.">{UL("Target Hole Ø (in)", "Target Hole Ø (mm)")}</FieldLabel>
                <input type="text" inputMode="decimal" placeholder="e.g. 1.250"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring no-spinners"
                  value={targetHoleText}
                  onChange={(e) => setTargetHoleText(e.target.value)}
                  onBlur={() => {
                    const n = parseFloat(targetHoleText);
                    if (Number.isFinite(n) && n > 0) {
                      const val = metric ? n / 25.4 : n;
                      setForm((p) => ({ ...p, target_hole_dia: val }));
                      setTargetHoleText(metric ? n.toFixed(2) : val.toFixed(3));
                    } else { setTargetHoleText(form.target_hole_dia > 0 ? form.target_hole_dia.toFixed(3) : ""); }
                  }}
                />
              </div>
              {form.existing_hole_dia > 0 && form.target_hole_dia > form.existing_hole_dia && form.tool_dia > 0 && (() => {
                const tooBig = form.existing_hole_dia < form.tool_dia * 1.1;
                const radialClearance = (form.existing_hole_dia - form.tool_dia) / 2;
                const tightClearance = radialClearance > 0 && radialClearance < 0.050;
                if (!tooBig && !tightClearance) return null;
                return (
                  <div className="col-span-2 space-y-1">
                    {tooBig && <p className="text-xs text-red-400">⛔ Entry bore too small — must be &gt;1.1× tool diameter.</p>}
                    {!tooBig && tightClearance && <p className="text-xs text-amber-400">⚠ Radial clearance {radialClearance.toFixed(3)}" per side — tight, rubbing risk on entry.</p>}
                  </div>
                );
              })()}
            </div>
          )}
          <div className="flex gap-3 items-start">
            <div className="flex-1 min-w-0 space-y-2 border-r border-border pr-3">
              <div className="flex items-center justify-between">
                <FieldLabel hint="Radial width of cut — also known as Stepover or Cut Width. Enter as a decimal (0.100 = 10% of dia) or percent (10%).">WOC</FieldLabel>
                {DOC_PRESETS[form.mode] && form.doc_xd > 0 && (
                  <button
                    type="button"
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors leading-tight"
                    style={wocPreset === "optimal" ? { borderColor: "#38bdf8", background: "#38bdf8", color: "#000" } : { borderColor: "rgba(56,189,248,0.5)", color: "#38bdf8" }}
                    onClick={() => {
                      const wp = WOC_PRESETS[form.mode];
                      if (!wp) return;
                      const dia = form.tool_dia || 0.5;
                      const geoFloor = form.geometry === "chipbreaker" ? 8 : form.geometry === "truncated_rougher" ? 10 : 0;
                      // Start from material+mode+flute-aware target (wp.med already encodes ISO category)
                      let optPct = wp.med;
                      // Chip-thinning floor: ensure sin(acos(1-2*woc/100)) >= 0.25 (no rubbing)
                      const chipThinAtTarget = Math.sin(Math.acos(Math.max(-1, Math.min(1, 1 - 2 * optPct / 100))));
                      if (chipThinAtTarget < 0.25) {
                        // Solve: sin(acos(1-2*woc/100)) = 0.25 → woc = (1-cos(asin(0.25)))*50
                        optPct = Math.max(optPct, (1 - Math.cos(Math.asin(0.25))) * 50);
                      }
                      // Apply floors
                      optPct = Math.min(100, Math.max(geoFloor, Math.max(wp.low, optPct)));
                      setForm((p) => ({ ...p, woc_pct: optPct }));
                      setWocText(((optPct / 100) * dia).toFixed(4));
                      const wocMatch = (["low","med","high"] as const).find(k => Math.abs(wp[k] - optPct) < 0.5);
                      setWocPreset(wocMatch ?? "optimal");
                    }}
                  >Optimal</button>
                )}
              </div>
              <div className="flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm gap-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                <input
                  type="text"
                  inputMode="decimal"
                  className="flex-1 min-w-0 bg-transparent outline-none no-spinners"
                  value={wocText}
                  onChange={(e) => setWocText(e.target.value)}
                  onBlur={() => {
                    const raw = wocText.trim();
                    const hasPercent = raw.includes("%");
                    const n = parseFloat(raw.replace(/[^\d.]/g, ""));
                    const dia = form.tool_dia || 0.5;
                    if (Number.isFinite(n) && n > 0) {
                      // % or integer (≥1) → treat as percent; decimal (<1, no %) → treat as inches
                      const pct = (hasPercent || n >= 1) ? n : (n / dia) * 100;
                      setForm((p) => ({ ...p, woc_pct: pct }));
                      setWocText(((pct / 100) * dia).toFixed(4));
                      setWocPreset(null);
                    } else {
                      setWocText(((form.woc_pct / 100) * dia).toFixed(4));
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">{form.woc_pct ? `${form.woc_pct.toFixed(1)}%` : ""}</span>
              </div>
              {/* WOC Low/Med/High buttons */}
              {WOC_PRESETS[form.mode] && (() => {
                const wp = WOC_PRESETS[form.mode];
                const dia = form.tool_dia || 0.5;
                const geoMinWoc = form.geometry === "chipbreaker" ? 8 : form.geometry === "truncated_rougher" ? 10 : 0;
                const btns = [
                  { key: "low" as const,  label: "Low",  val: geoMinWoc > 0 ? Math.max(geoMinWoc, wp.low) : wp.low },
                  { key: "med" as const,  label: "Med",  val: wp.med },
                  { key: "high" as const, label: "High", val: wp.high },
                ];
                return (
                  <div className="flex gap-1 mt-1">
                    {btns.map(({ key, label, val }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setForm((p) => ({ ...p, woc_pct: val }));
                          setWocText(((val / 100) * dia).toFixed(4));
                          setWocPreset(key);
                        }}
                        className="flex-1 rounded py-0.5 text-[10px] font-semibold border transition-all leading-tight"
                        style={{
                          background: wocPreset === key ? "#eab308" : "transparent",
                          borderColor: wocPreset === key ? "#eab308" : "rgba(255,255,255,0.25)",
                          color: wocPreset === key ? "#000" : "rgba(255,255,255,0.6)",
                        }}
                      >
                        {label} <span className="opacity-75">{val}%</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
              {/* WOC out-of-range note */}
              {WOC_PRESETS[form.mode] && form.woc_pct > 0 && (() => {
                const wp = WOC_PRESETS[form.mode];
                if (form.woc_pct < wp.low) return <p className="text-[10px] text-amber-400 mt-1">⚠ Below {form.mode === "hem" ? "HEM" : form.mode} range ({wp.low}–{wp.high}%) — chip clearance may suffer</p>;
                if (form.woc_pct > wp.high) return <p className="text-[10px] text-amber-400 mt-1">⚠ Above {form.mode === "hem" ? "HEM" : form.mode} range ({wp.low}–{wp.high}%) — consider reducing for stability</p>;
                return null;
              })()}
              {/* Engagement physics mini-chart — not shown for face or circ_interp (3-phase cards replace this) */}
              {form.woc_pct > 0 && form.flutes > 0 && form.mode !== "face" && form.mode !== "circ_interp" && (() => {
                const wocFrac = form.woc_pct / 100;
                const arg = Math.max(-1, Math.min(1, 1 - 2 * wocFrac));
                // Engine uses 2×acos(...) — full included arc entry-to-exit
                const engAngleDeg = 2 * Math.acos(arg) * (180 / Math.PI);
                const chipThin = Math.sin(Math.acos(arg));
                const teethInCut = (engAngleDeg / 360) * form.flutes;
                const chipThinPct = Math.round(chipThin * 100);
                const chipColor = chipThin < 0.30 ? "#f87171" : chipThin < 0.55 ? "#facc15" : "#4ade80";
                const chipLabel = chipThin < 0.30 ? "Low" : chipThin < 0.55 ? "Mod" : "Good";
                const engPct = engAngleDeg / 180; // 0–1 for arc bar (180° = slot)
                // SVG arc for engagement angle
                const r = 14; const cx = 18; const cy = 18;
                const startAngle = -90; // top
                const endAngle = startAngle + engAngleDeg;
                const toRad = (d: number) => d * Math.PI / 180;
                const x1 = cx + r * Math.cos(toRad(startAngle));
                const y1 = cy + r * Math.sin(toRad(startAngle));
                const x2 = cx + r * Math.cos(toRad(endAngle));
                const y2 = cy + r * Math.sin(toRad(endAngle));
                const largeArc = engAngleDeg > 180 ? 1 : 0;
                const arcColor = engAngleDeg > 270 ? "#f87171" : engAngleDeg > 180 ? "#facc15" : "#4ade80";
                const cardStyle = { background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)" };
                const labelStyle = { color: "#64748b" };
                return (
                  <div className="mt-2 flex gap-1.5">
                    {/* Engagement Angle */}
                    <div className="flex-1 rounded-md px-2 pt-1.5 pb-2 cursor-help" style={cardStyle}
                      title={`Arc of tool in contact with material. At ${form.woc_pct.toFixed(1)}% WOC the tool engages ${engAngleDeg.toFixed(1)}° of its 360° rotation. Higher angle = more heat and cutting force per revolution.`}>
                      <div className="text-[9px] uppercase tracking-widest mb-1" style={labelStyle}>Eng. Angle</div>
                      <div className="text-sm font-bold leading-tight" style={{ color: arcColor }}>{engAngleDeg.toFixed(1)}°</div>
                      <div className="mt-1.5 rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.08)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (engAngleDeg / 360) * 100)}%`, background: arcColor }} />
                      </div>
                    </div>
                    {/* Chip Thinning */}
                    <div className="flex-1 rounded-md px-2 pt-1.5 pb-2 cursor-help" style={cardStyle}
                      title={`Chip thinning factor — at low WOC the chip formed is thinner than your programmed FPT. ${chipThinPct}% means the actual chip is only ${chipThinPct}% as thick as programmed. The engine compensates automatically by boosting feed. Below 30% risks rubbing instead of cutting.`}>
                      <div className="text-[9px] uppercase tracking-widest mb-1" style={labelStyle}>Chip Thin</div>
                      <div className="text-sm font-bold leading-tight" style={{ color: chipColor }}>{chipThinPct}%</div>
                      <div className="mt-1.5 rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.08)" }}>
                        <div className="h-full rounded-full" style={{ width: `${chipThinPct}%`, background: chipColor }} />
                      </div>
                    </div>
                    {/* Teeth in Cut */}
                    {(() => {
                      const ticColor = teethInCut < 1.0 ? "#f87171" : teethInCut <= 1.5 ? "#facc15" : teethInCut <= 2.5 ? "#4ade80" : "#fb923c";
                      return (
                        <div className="flex-1 rounded-md px-2 pt-1.5 pb-2 cursor-help" style={cardStyle}
                          title={`Average number of flutes simultaneously cutting. Sweet spot is 1.5–2.5 teeth — enough for smooth cutting without heat buildup. Too low = interrupted, chattery cut. Too high = heat and tool wear.`}>
                          <div className="text-[9px] uppercase tracking-widest mb-1" style={labelStyle}>Teeth in Cut</div>
                          <div className="text-sm font-bold leading-tight" style={{ color: ticColor }}>{teethInCut.toFixed(2)}</div>
                          <div className="mt-1.5 text-[9px]" style={labelStyle}>of {form.flutes} flutes</div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
              {/* circ_interp 3-phase advisory moved to results panel */}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              {form.mode === "circ_interp" ? (
                <div className="space-y-1">
                  <FieldLabel hint="Total depth of the bore or pocket feature — this is a part dimension, not a tool dimension. Cannot exceed the tool's LOC (or LBS on reduced-neck tools).">Bore Depth</FieldLabel>
                  <div className="flex h-9 items-center overflow-hidden rounded-md border border-input bg-background px-3 text-sm gap-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="flex-1 min-w-0 bg-transparent outline-none no-spinners"
                      value={docText}
                      placeholder={form.loc > 0 ? form.loc.toFixed(3) : "0.000"}
                      onChange={(e) => setDocText(e.target.value)}
                      onBlur={() => {
                        const n = parseFloat(docText);
                        const dia = form.tool_dia || 0.5;
                        // Cap = LBS if set (reduced-neck reach), else LOC
                        const reach = form.lbs > 0 ? form.lbs : form.loc;
                        if (Number.isFinite(n) && n > 0) {
                          const clamped = reach > 0 ? Math.min(n, reach) : n;
                          const xd = clamped / dia;
                          setForm((p) => ({ ...p, doc_xd: xd }));
                          setDocText(clamped.toFixed(3));
                          setDocPreset(null);
                        } else {
                          setDocText(form.doc_xd ? (form.doc_xd * dia).toFixed(3) : "");
                        }
                      }}
                    />
                    <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                      {form.doc_xd ? `${parseFloat(form.doc_xd.toFixed(2))}xD` : ""}
                    </span>
                  </div>
                  {/* Bore depth vs reach warnings */}
                  {form.doc_xd > 0 && form.tool_dia > 0 && (() => {
                    const boreIn = form.doc_xd * form.tool_dia;
                    const reach = form.lbs > 0 ? form.lbs : form.loc;
                    if (reach <= 0) return null;
                    const ratio = boreIn / reach;
                    if (ratio <= 1.0) return null;
                    const reachLabel = form.lbs > 0 ? "LBS" : "LOC";
                    return (
                      <p className="text-[10px] text-red-400">
                        ⛔ Bore depth ({boreIn.toFixed(3)}") exceeds tool {reachLabel} ({reach.toFixed(3)}") — clamped to max reach.
                      </p>
                    );
                  })()}
                  {form.loc > 0 && form.doc_xd === 0 && (
                    <p className="text-[10px] text-zinc-500">Max depth: {form.lbs > 0 ? `${form.lbs.toFixed(3)}" LBS` : `${form.loc.toFixed(3)}" LOC`}</p>
                  )}
                </div>
              ) : (<>
              <div className="flex items-center justify-between">
                <FieldLabel hint="Axial depth of cut — also known as Depth of Cut or Z-depth. Enter as a decimal inch value or with xD suffix (1.5xD = 1.5× tool diameter).">DOC</FieldLabel>
                {WOC_PRESETS[form.mode] && form.woc_pct > 0 && (
                  <button
                    type="button"
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors leading-tight"
                    style={docPreset === "optimal" ? { borderColor: "#38bdf8", background: "#38bdf8", color: "#000" } : { borderColor: "rgba(56,189,248,0.5)", color: "#38bdf8" }}
                    onClick={() => {
                      const dp = DOC_PRESETS[form.mode];
                      if (!dp) return;
                      const dia = form.tool_dia || 0.5;
                      // Use material+mode+flute-aware target directly — no MRR-balance scaling
                      const locCap = form.loc > 0 ? form.loc / dia : 99;
                      const optXd = Math.min(locCap, Math.max(dp.low, dp.med));
                      const optIn = optXd * dia;
                      setForm((p) => ({ ...p, doc_xd: optXd }));
                      setDocText(optIn.toFixed(3));
                      const docMatch = (["low","med","high"] as const).find(k => Math.abs(dp[k] - optXd) < 0.05);
                      setDocPreset(docMatch ?? "optimal");
                    }}
                  >Optimal</button>
                )}
              </div>
              <div className="flex h-9 items-center overflow-hidden rounded-md border border-input bg-background px-3 text-sm gap-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                <input
                  type="text"
                  inputMode="decimal"
                  className="flex-1 min-w-0 bg-transparent outline-none no-spinners"
                  value={docText}
                  onChange={(e) => setDocText(e.target.value)}
                  onBlur={() => {
                    const n = parseFloat(docText);
                    const dia = form.tool_dia || 0.5;
                    if (Number.isFinite(n) && n > 0) {
                      const clamped = Math.min(n, form.loc);
                      const xd = clamped / dia;
                      setForm((p) => ({ ...p, doc_xd: xd }));
                      setDocText(clamped.toFixed(3));
                      setDocPreset(null);
                    } else {
                      setDocText(form.doc_xd ? (form.doc_xd * dia).toFixed(3) : "");
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                  {form.doc_xd ? `${parseFloat(form.doc_xd.toFixed(3))}xD` : ""}
                </span>
              </div>
              {/* DOC Low/Med/High buttons */}
              {DOC_PRESETS[form.mode] && (() => {
                const dp = DOC_PRESETS[form.mode];
                const dia = form.tool_dia || 0.5;
                const btns = [
                  { key: "low" as const,  label: "Low",  val: dp.low },
                  { key: "med" as const,  label: "Med",  val: dp.med },
                  { key: "high" as const, label: "High", val: dp.high },
                ];
                return (
                  <div className="flex gap-1 mt-1">
                    {btns.map(({ key, label, val }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          const rawInches = val * dia;
                          const clampedInches = form.loc > 0 ? Math.min(rawInches, form.loc) : rawInches;
                          const clampedXd = clampedInches / dia;
                          setForm((p) => ({ ...p, doc_xd: clampedXd }));
                          setDocText(clampedInches.toFixed(3));
                          setDocPreset(clampedXd < val - 0.001 ? null : key);
                        }}
                        className="flex-1 rounded py-0.5 text-[9px] font-semibold border transition-all leading-tight"
                        style={{
                          background: docPreset === key ? "#eab308" : "transparent",
                          borderColor: docPreset === key ? "#eab308" : "rgba(255,255,255,0.25)",
                          color: docPreset === key ? "#000" : "rgba(255,255,255,0.6)",
                        }}
                      >
                        {label} <span className="opacity-75">{val}xD</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
              {/* DOC out-of-range note — suppressed for circ_interp (DOC = full bore depth, not axial pitch) */}
              {DOC_PRESETS[form.mode] && form.doc_xd > 0 && form.mode !== "circ_interp" && (() => {
                const dp = DOC_PRESETS[form.mode];
                const isHem = form.mode === "hem" || form.mode === "trochoidal";
                const locXd = form.loc > 0 && form.tool_dia > 0 ? form.loc / form.tool_dia : null;
                if (form.doc_xd < dp.low) return <p className="text-[10px] text-amber-400 mt-1">⚠ Below typical range ({dp.low}–{dp.high}×D) — axial engagement may be too light</p>;
                if (form.doc_xd > dp.high) {
                  // HEM: only warn if exceeding full flute length, not just the "High" preset
                  if (isHem && locXd != null && form.doc_xd <= locXd) return null;
                  return <p className="text-[10px] text-amber-400 mt-1">⚠ Above typical range ({dp.low}–{dp.high}×D) — deflection and force increase significantly</p>;
                }
                return null;
              })()}
              {/* DOC > LOC warning */}
              {form.doc_xd > 0 && form.loc > 0 && form.tool_dia > 0 && (() => {
                const docIn = form.doc_xd * form.tool_dia;
                const ratio = docIn / form.loc;
                if (ratio <= 1.05) return null;
                const isRed = ratio > 1.30;
                return (
                  <p className={`text-xs mt-1 ${isRed ? "text-red-400" : "text-amber-400"}`}>
                    {isRed
                      ? `⛔ DOC (${docIn.toFixed(3)}") exceeds LOC (${form.loc.toFixed(3)}") — tool cannot reach at this depth. Select a longer reach or reduced-neck (RN) tool.`
                      : `⚠ DOC (${docIn.toFixed(3)}") is approaching LOC (${form.loc.toFixed(3)}") — consider a longer reach or reduced-neck (RN) tool.`}
                    {" "}A reduced-neck version may be available — check EDP suffix -RN.
                  </p>
                );
              })()}
              </>)}
              {/* Tool Stickout — lives under DOC */}
              <div className="mt-3 space-y-2">
                <FieldLabel hint="Distance from the toolholder face to the tip of the tool. Longer stickout reduces rigidity — deflection scales with length³.">{UL("Tool Stickout (in)", "Tool Stickout (mm)")}</FieldLabel>
                <Input
                  type="text" inputMode="decimal"
                  className="no-spinners"
                  placeholder="e.g. 1.500"
                  value={stickoutText}
                  onChange={(e) => setStickoutText(e.target.value)}
                  onFocus={() => { if (form.stickout > 0) setStickoutText(metric ? (form.stickout * 25.4).toFixed(1) : form.stickout.toFixed(3)); }}
                  onBlur={() => {
                    const n = parseDim(stickoutText);
                    const val = metric ? n / 25.4 : n;
                    if (Number.isFinite(val) && val > 0) { setForm((p) => ({ ...p, stickout: val })); setStickoutText(metric ? (val * 25.4).toFixed(1) : val.toFixed(3)); }
                    else setStickoutText(form.stickout > 0 ? (metric ? (form.stickout * 25.4).toFixed(1) : form.stickout.toFixed(3)) : "");
                  }}
                />
              </div>
            </div>
          </div>
          {form.mode === "face" && (
            <div className="mt-3 w-52 space-y-2">
              <FieldLabel hint="Target surface roughness in micro-inches (µin). Common finish specs: 63 µin = machined, 32 µin = smooth machined, 16 µin = fine, 8 µin = very fine. The advisor will show the theoretical Ra with your current parameters and the max feed needed to hit this target.">Target Ra (µin) <span className="text-xs font-normal text-muted-foreground">(optional)</span></FieldLabel>
              <div className="flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm gap-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 32"
                  className="flex-1 min-w-0 bg-transparent outline-none no-spinners"
                  value={raText}
                  onChange={(e) => setRaText(e.target.value)}
                  onBlur={() => {
                    const n = parseFloat(raText);
                    if (Number.isFinite(n) && n > 0) {
                      setForm((p) => ({ ...p, target_ra_uin: n }));
                      setRaText(n.toFixed(0));
                    } else {
                      setForm((p) => ({ ...p, target_ra_uin: 0 }));
                      setRaText("");
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground shrink-0">µin</span>
              </div>
              <div className="flex gap-1">
                {[8, 16, 32, 63, 125].map(v => (
                  <button key={v} type="button"
                    onClick={() => { setForm((p) => ({ ...p, target_ra_uin: v })); setRaText(String(v)); }}
                    className="flex-1 rounded py-0.5 text-[9px] font-semibold border transition-all leading-tight"
                    style={{
                      background: form.target_ra_uin === v ? "#eab308" : "transparent",
                      borderColor: form.target_ra_uin === v ? "#eab308" : "rgba(255,255,255,0.25)",
                      color: form.target_ra_uin === v ? "#000" : "rgba(255,255,255,0.6)",
                    }}
                  >{v}</button>
                ))}
              </div>
            </div>
          )}

          {/* Chipbreaker / truncated rougher engagement warning */}
          {(form.geometry === "chipbreaker" || form.geometry === "truncated_rougher") && (() => {
            const dia = form.tool_dia || 0.5;
            const minWoc = form.geometry === "truncated_rougher" ? 10 : 8;
            const wocTooLow = form.woc_pct > 0 && form.woc_pct < minWoc;
            const docTooLow = form.doc_xd > 0 && form.doc_xd < 1.0;
            if (!wocTooLow && !docTooLow) return null;
            const geoLabel = form.geometry === "chipbreaker" ? "Chipbreaker" : "Truncated Rougher";
            const reasons = [
              wocTooLow && `WOC ${form.woc_pct.toFixed(1)}% is below ${minWoc}% minimum`,
              docTooLow && `DOC ${form.doc_xd.toFixed(2)}×D is below 1×D minimum`,
            ].filter(Boolean).join(" · ");
            return (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                <span className="mt-0.5 shrink-0">⚠</span>
                <span><span className="font-semibold">{geoLabel} geometry inactive</span> — {reasons}. Requires ≥{minWoc}% WOC and ≥1×D DOC to engage. Consider Standard geometry at this engagement.</span>
              </div>
            );
          })()}
          </>)}

          {/* Hole Details — reaming */}
          {operation === "reaming" && (<>
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Hole Details</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <FieldLabel hint="Total depth of the hole to be reamed. Used to calculate depth-to-diameter ratio and apply depth correction factors.">{UL("Hole Depth (in.)", "Hole Depth (mm)")}</FieldLabel>
              <Input type="number" step={metric ? "0.1" : "0.001"} className="no-spinners"
                value={form.ream_hole_depth ? (metric ? (form.ream_hole_depth * 25.4).toFixed(2) : form.ream_hole_depth) : ""}
                onChange={onUnitNum("ream_hole_depth", 25.4)} />
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Through holes allow chips to exit ahead of the reamer. Blind holes trap chips — coolant-fed is strongly recommended for blind holes in any difficult material.">Hole Type</FieldLabel>
              <div className="flex gap-2 pt-1">
                {([{ val: false, label: "Through" }, { val: true, label: "Blind" }] as const).map(({ val, label }) => (
                  <button key={label} type="button"
                    onClick={() => setForm((p) => ({ ...p, ream_blind: val }))}
                    className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.ream_blind === val ? "#6366f1" : "transparent",
                      borderColor: "#6366f1", color: form.ream_blind === val ? "#fff" : "#6366f1",
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Lead Chamfer */}
          {(() => {
            const iso = isoCategory;
            const isBlind = form.ream_blind;

            let recChamfer: string;
            if (iso === "N" || iso === "K") {
              recChamfer = isBlind ? "standard" : "short_lead";
            } else if (iso === "P") {
              recChamfer = isBlind ? "long_lead" : "standard";
            } else if (iso === "M" || iso === "S" || iso === "H") {
              recChamfer = "long_lead";
            } else {
              recChamfer = "standard";
            }

            return (
              <div className="space-y-1.5 mt-3">
                <div className="flex items-center justify-between">
                  <FieldLabel hint="The lead chamfer is the angled entry at the tip of the reamer that eases it into the hole. Standard (45°) is the Core Cutter default and works well for most applications. Long Lead (15–30°) spreads the cut over more edge — better surface finish and chatter reduction, preferred for blind holes, stainless, and tight tolerance work. Short Lead (60°+) is more aggressive — higher feed rates, good for production through-hole work in softer materials.">Lead Chamfer</FieldLabel>
                  <span className="text-[10px] text-amber-400 font-medium">★ recommended for this setup</span>
                </div>
                <div className="flex gap-2">
                  {([
                    { val: "standard",   label: "Standard",   angle: "45°",    desc: "Default — balanced performance",
                      hint: "✓ Balanced entry force\n✓ Works on most materials and hole types\n✓ Easy to regrind\n✗ Not optimized for finish or speed" },
                    { val: "long_lead",  label: "Long Lead",  angle: "15–30°", desc: "Fine finish, blind & hard materials",
                      hint: "✓ Gradual load — lower chatter, better finish\n✓ Spreads wear over more edge → longer tool life\n✓ Best for stainless, Inconel, blind holes\n✗ Higher thrust on entry\n✗ Slower feed rates\n✗ Needs more clearance at blind hole bottom" },
                    { val: "short_lead", label: "Short Lead", angle: "60°+",   desc: "Production, high feed, through holes",
                      hint: "✓ Fast stock removal, high production feed rates\n✓ Lower thrust force\n✓ Good chip clearance in through holes\n✗ Higher chatter risk on entry\n✗ Edge wears faster in hard or stringy materials\n✗ Poor finish in difficult materials" },
                  ] as const).map(({ val, label, angle, desc, hint }) => {
                    const active = form.ream_lead_chamfer === val;
                    const isRec = recChamfer === val;
                    return (
                      <TooltipProvider key={val} delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button"
                              onClick={() => setForm((p) => ({ ...p, ream_lead_chamfer: val }))}
                              className="flex-1 rounded border transition-all px-2 py-2 text-left"
                              style={{
                                backgroundColor: active ? "#6366f1" : isRec ? "rgba(245,158,11,0.12)" : "transparent",
                                borderColor: active ? "#6366f1" : isRec ? "#f59e0b" : "#6366f1",
                              }}
                            >
                              <div className={`text-xs font-semibold leading-tight ${active ? "text-white" : isRec ? "text-amber-400" : "text-indigo-400"}`}>
                                {label}{isRec && !active ? " ★" : ""}
                              </div>
                              <div className={`text-[10px] font-bold mt-0.5 ${active ? "text-indigo-200" : isRec ? "text-amber-500" : "text-indigo-500"}`}>{angle}</div>
                              <div className={`text-[9px] leading-tight mt-0.5 ${active ? "text-indigo-100" : "text-muted-foreground"}`}>{desc}</div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-56 text-xs whitespace-pre-line">{hint}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          </>)}

          {/* Thread Details — thread milling */}
          {operation === "threadmilling" && (<>
          {/* PDF Upload for thread milling */}
          <div className={`mt-3 rounded-xl border-2 border-dashed px-4 py-3 ${pdfExtracted ? "border-amber-500 bg-amber-500/10" : "border-zinc-600"}`}>
            {pdfExtracted ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-400 font-medium">✓ Dimensions extracted from CC print{pdfToolNumber ? ` (${pdfToolNumber})` : ""} — review fields below</span>
                <button type="button" onClick={() => setPdfExtracted(false)} className="text-[10px] text-gray-400 hover:text-white underline">Clear</button>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-1 cursor-pointer">
                <span className="text-xs text-gray-400">Upload CC-XXXXX print to auto-fill dimensions</span>
                <span className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white transition-colors pointer-events-none">
                  {pdfUploading ? "Reading print…" : "⬆ Upload CC Print (PDF)"}
                </span>
                <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={pdfUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPrintPdf(f); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Thread Details</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>

          {/* Standard + Internal/External */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FieldLabel hint="Thread standard. UN = Unified inch. Metric = ISO metric. NPT/NPTF = tapered pipe threads.">Thread Standard</FieldLabel>
              <div className="flex flex-wrap gap-1">
                {(["unc", "unf", "unef", "metric", "npt", "nptf"] as const).map((s) => (
                  <button key={s} type="button"
                    onClick={() => setForm((p) => ({
                      ...p,
                      thread_standard: s,
                      thread_class: s === "metric" ? (p.thread_internal ? "6H" : "6g") : (p.thread_internal ? "2B" : "2A"),
                    }))}
                    className="rounded px-2 py-1 text-xs font-semibold border uppercase transition-all"
                    style={{
                      backgroundColor: form.thread_standard === s ? "#6366f1" : "transparent",
                      borderColor: "#6366f1", color: form.thread_standard === s ? "#fff" : "#6366f1",
                    }}
                  >{s === "unef" ? "UNEF" : s.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel hint="Internal (bore/hole) or External (stud/OD). Affects cutter path direction and diameter selection.">Thread Type</FieldLabel>
              <div className="flex gap-2">
                {([{ val: true, label: "Internal" }, { val: false, label: "External" }] as const).map(({ val, label }) => (
                  <button key={label} type="button"
                    onClick={() => setForm((p) => ({
                      ...p,
                      thread_internal: val,
                      thread_class: p.thread_standard === "metric" ? (val ? "6H" : "6g") : (val ? "2B" : "2A"),
                    }))}
                    className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.thread_internal === val ? "#6366f1" : "transparent",
                      borderColor: "#6366f1", color: form.thread_internal === val ? "#fff" : "#6366f1",
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* NPT Size selector */}
          {(form.thread_standard === "npt" || form.thread_standard === "nptf") && (
            <div className="mt-3 space-y-1.5">
              <FieldLabel hint="NPT/NPTF pipe size. Sets major diameter and TPI automatically from the standard table.">Pipe Size</FieldLabel>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.npt_size}
                onChange={(e) => setForm((p) => ({ ...p, npt_size: e.target.value }))}
              >
                <option value="">Select size…</option>
                {["1/16", "1/8", "1/4", "3/8", "1/2", "3/4", "1", "1-1/4", "1-1/2", "2", "4"].map((sz) => (
                  <option key={sz} value={sz}>{sz}"</option>
                ))}
              </select>
            </div>
          )}

          {/* Major Dia + TPI/Pitch (hidden for NPT when size is selected) */}
          {!((form.thread_standard === "npt" || form.thread_standard === "nptf") && form.npt_size) && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="space-y-1.5">
                <FieldLabel hint={form.thread_standard === "metric" ? "Thread major diameter in millimeters (e.g. 10 for M10×1.5)." : "Thread major diameter — accepts fractions (1/2, 3/4, 5/16) or decimal inches (0.5000). For 1/2\"-13 UNC enter 1/2 or 0.5000."}>
                  Major Dia {form.thread_standard === "metric" ? "(mm)" : "(in)"}
                </FieldLabel>
                <Input
                  type="text" inputMode="decimal" className="no-spinners"
                  placeholder={form.thread_standard === "metric" ? "e.g. 10" : "e.g. 1/2 or 0.5000"}
                  value={tmMajorDiaText}
                  onChange={(e) => setTmMajorDiaText(e.target.value)}
                  onBlur={() => {
                    // parseDim handles fractions (1/2, 3/8, etc.) and decimals
                    const n = form.thread_standard === "metric"
                      ? parseFloat(tmMajorDiaText)
                      : parseDim(tmMajorDiaText);
                    if (Number.isFinite(n) && n > 0) {
                      const inchVal = form.thread_standard === "metric" ? n / 25.4 : n;
                      // Auto-lookup TPI / pitch from standard table
                      const looked = lookupTpi(form.thread_standard, inchVal);
                      setForm((p) => {
                        const next: any = {
                          ...p,
                          thread_major_dia: inchVal,
                          thread_tpi: looked.tpi ?? undefined,
                          thread_pitch_mm: looked.pitch_mm ?? undefined,
                        };
                        // Auto-suggest cutter dia if not yet set
                        if (!p.tool_dia || p.tool_dia === 0) {
                          const suggested = parseFloat((inchVal * (p.thread_internal ? 0.65 : 0.50)).toFixed(4));
                          next.tool_dia = suggested;
                          next.flutes = defaultThreadFlutes(suggested);
                          setToolDiaText(suggested.toFixed(4));
                        }
                        return next;
                      });
                      setTmMajorDiaText(inchVal.toFixed(4));
                      if (looked.tpi) { setTmTpiText(looked.tpi.toString()); setTmPitchMmText(""); }
                      else if (looked.pitch_mm) { setTmPitchMmText(looked.pitch_mm.toString()); setTmTpiText(""); }
                      else { setTmTpiText(""); setTmPitchMmText(""); }
                    } else {
                      const d = form.thread_major_dia > 0
                        ? (form.thread_standard === "metric" ? (form.thread_major_dia * 25.4).toFixed(2) : form.thread_major_dia.toFixed(4))
                        : "";
                      setTmMajorDiaText(d);
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel hint={form.thread_standard === "metric" ? "Pitch in mm. Leave blank to auto-look up from ISO standard table for the entered diameter." : "Threads per inch. Leave blank to auto-look up from ANSI standard table for the entered diameter."}>
                  {form.thread_standard === "metric" ? "Pitch (mm)" : "TPI"}
                </FieldLabel>
                <Input
                  type="text" inputMode="decimal" className="no-spinners"
                  placeholder="auto"
                  value={form.thread_standard === "metric" ? tmPitchMmText : tmTpiText}
                  onChange={(e) => form.thread_standard === "metric" ? setTmPitchMmText(e.target.value) : setTmTpiText(e.target.value)}
                  onBlur={() => {
                    if (form.thread_standard === "metric") {
                      const n = parseFloat(tmPitchMmText);
                      if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, thread_pitch_mm: n })); setTmPitchMmText(n.toString()); }
                      else { setTmPitchMmText(""); setForm((p) => ({ ...p, thread_pitch_mm: undefined })); }
                    } else {
                      const n = parseFloat(tmTpiText);
                      if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, thread_tpi: n })); setTmTpiText(n.toString()); }
                      else { setTmTpiText(""); setForm((p) => ({ ...p, thread_tpi: undefined })); }
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Thread Class + Hand + Engagement */}
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="space-y-1.5">
              <FieldLabel hint="Tolerance class. 2B/2A = commercial. 3B/3A = precision. 6H/6g = ISO metric.">Thread Class</FieldLabel>
              <div className="flex flex-wrap gap-1">
                {(form.thread_standard === "metric"
                  ? (form.thread_internal ? ["6H"] : ["6g"])
                  : (form.thread_internal ? ["2B", "3B"] : ["2A", "3A"])
                ).map((cls) => (
                  <button key={cls} type="button"
                    onClick={() => setForm((p) => ({ ...p, thread_class: cls as any }))}
                    className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.thread_class === cls ? "#6366f1" : "transparent",
                      borderColor: "#6366f1", color: form.thread_class === cls ? "#fff" : "#6366f1",
                    }}
                  >{cls}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel hint="Thread hand. RH (standard) = G2 helical climb. LH = G3 reverse helix.">Hand</FieldLabel>
              <div className="flex gap-1">
                {([{ val: "right", label: "RH" }, { val: "left", label: "LH" }] as const).map(({ val, label }) => (
                  <button key={val} type="button"
                    onClick={() => setForm((p) => ({ ...p, thread_hand: val }))}
                    className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.thread_hand === val ? "#6366f1" : "transparent",
                      borderColor: "#6366f1", color: form.thread_hand === val ? "#fff" : "#6366f1",
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel hint="Axial thread depth — how far the thread mill travels in Z. Typically 1–1.5× major dia for through threads; use actual depth for blind holes.">Thread Depth (in)</FieldLabel>
              <Input
                type="text" inputMode="decimal" className="no-spinners"
                placeholder="e.g. 0.500"
                value={tmEngText}
                onChange={(e) => setTmEngText(e.target.value)}
                onBlur={() => {
                  const n = parseDim(tmEngText);
                  if (Number.isFinite(n) && n > 0) {
                    setForm((p) => {
                      const suggestedNeck = +(n + 0.075).toFixed(3);
                      const suggestedStickout = +(suggestedNeck + 0.750).toFixed(3);
                      const newNeck = p.thread_neck_length > 0 ? p.thread_neck_length : suggestedNeck;
                      const newStickout = p.stickout > 0 ? p.stickout : suggestedStickout;
                      if (p.thread_neck_length === 0) { setTmNeckText(suggestedNeck.toFixed(3)); setNeckAutoSuggested(true); }
                      if (p.stickout === 0) { setTmStickoutText(suggestedStickout.toFixed(3)); setStickoutAutoSuggested(true); }
                      return { ...p, thread_engagement: n, thread_neck_length: newNeck, stickout: newStickout };
                    });
                    setTmEngText(n.toFixed(4));
                  } else setTmEngText(form.thread_engagement > 0 ? form.thread_engagement.toFixed(4) : "");
                }}
              />
            </div>
          </div>

          {/* G-Code Dialect */}
          <div className="mt-3 space-y-1.5">
            <FieldLabel hint="CNC control dialect for G-code output. Fanuc/Haas: ( ) comments, T01 M06, G43 TLO. Siemens 840D: ; comments, T1 D1, TURN=1 helical arc.">G-Code Dialect</FieldLabel>
            <div className="flex gap-2">
              {([{ val: "fanuc", label: "Fanuc / Haas" }, { val: "siemens", label: "Siemens 840D" }] as const).map(({ val, label }) => (
                <button key={val} type="button"
                  onClick={() => setForm((p) => ({ ...p, thread_gcode_dialect: val }))}
                  className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: form.thread_gcode_dialect === val ? "#6366f1" : "transparent",
                    borderColor: "#6366f1", color: form.thread_gcode_dialect === val ? "#fff" : "#6366f1",
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
          {/* Cut Direction */}
          {(() => {
            const isTough = isoCategory === "S" || isoCategory === "H" ||
              form.material.includes("titanium") || form.material.includes("inconel") ||
              form.material.includes("hastelloy") || form.material.includes("waspaloy");
            const isBlindInternal = form.thread_internal && (form.thread_engagement > 0);
            const recDir = (isTough || isBlindInternal) ? "bottom_up" : "top_down";
            return (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <FieldLabel hint="Top-down: cutter plunges to Z0 and helices downward — standard approach. Bottom-up: cutter plunges to full depth first then helices upward — preferred for blind holes and tough materials (Inconel, titanium) as chips evacuate toward the opening.">Cut Direction</FieldLabel>
                  <span className="text-[10px] text-amber-400 font-medium">★ recommended for this setup</span>
                </div>
                <div className="flex gap-1">
                  {([
                    { val: "top_down",  label: "Top Down"  },
                    { val: "bottom_up", label: "Bottom Up" },
                  ] as const).map(({ val, label }) => {
                    const active = form.thread_cut_direction === val;
                    const isRec = recDir === val;
                    return (
                      <button key={val} type="button"
                        onClick={() => setForm((p) => ({ ...p, thread_cut_direction: val }))}
                        className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                        style={{
                          backgroundColor: active ? "#6366f1" : isRec ? "rgba(245,158,11,0.12)" : "transparent",
                          borderColor: active ? "#6366f1" : isRec ? "#f59e0b" : "#6366f1",
                          color: active ? "#fff" : isRec ? "#f59e0b" : "#6366f1",
                        }}
                      >{label}{isRec && !active ? " ★" : ""}</button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          </>)}

          {/* Thread Mill Tool Geometry */}
          {operation === "threadmilling" && (<>
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Tool Geometry</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <FieldLabel hint="Outer diameter of the thread mill cutter. Must be smaller than the thread minor diameter for internal threads.">Cutter Dia (in)</FieldLabel>
              <Input
                type="text" inputMode="decimal" className="no-spinners"
                placeholder="e.g. 0.375"
                value={toolDiaText}
                onChange={(e) => setToolDiaText(e.target.value)}
                onBlur={() => {
                  const n = parseDim(toolDiaText);
                  if (Number.isFinite(n) && n > 0) {
                    setForm((p) => ({ ...p, tool_dia: n, flutes: defaultThreadFlutes(n) }));
                    setToolDiaText(n.toFixed(4));
                  } else setToolDiaText(form.tool_dia > 0 ? form.tool_dia.toFixed(4) : "");
                }}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Number of cutting flutes on the thread mill. Directly multiplies the feed rate — a 4-flute tool feeds 4× faster than a 1-flute at the same chip load.">Flutes</FieldLabel>
              <div className="flex gap-1">
                {([3, 4, 5, 6] as const).map((n) => (
                  <button key={n} type="button"
                    onClick={() => setForm((p) => ({ ...p, flutes: n }))}
                    className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.flutes === n ? "#6366f1" : "transparent",
                      borderColor: "#6366f1", color: form.flutes === n ? "#fff" : "#6366f1",
                    }}
                  >{n}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Number of thread profiles on the cutter — how many pitches it cuts per helical pass. Single-profile = 1 axial pitch per pass; multi-profile = all pitches in one pass.">Tool Thread Profiles</FieldLabel>
              <div className="flex gap-1">
                {([1, 2, 3, 4] as const).map((n) => (
                  <button key={n} type="button"
                    onClick={() => setForm((p) => ({ ...p, thread_rows: n }))}
                    className="flex-1 rounded py-2 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.thread_rows === n ? "#6366f1" : "transparent",
                      borderColor: "#6366f1", color: form.thread_rows === n ? "#fff" : "#6366f1",
                    }}
                  >{n}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 w-48 space-y-2">
            <FieldLabel hint="Distance from the part surface down to where the threads start — the tool neck must clear this zone before the thread profiles engage. Enter the pocket depth, boss height, or counterbore depth. Leave 0 if threads are at the surface.">Reach / Neck Length (in)</FieldLabel>
            <Input
              type="text" inputMode="decimal" className="no-spinners"
              placeholder="0 = no reach/neck needed"
              value={tmNeckText}
              onChange={(e) => { setTmNeckText(e.target.value); setNeckAutoSuggested(false); }}
              onBlur={() => {
                const n = parseDim(tmNeckText);
                if (Number.isFinite(n) && n >= 0) { setForm((p) => ({ ...p, thread_neck_length: n })); setTmNeckText(n > 0 ? n.toFixed(3) : ""); }
                else setTmNeckText(form.thread_neck_length > 0 ? form.thread_neck_length.toFixed(3) : "");
              }}
            />
            {neckAutoSuggested && <p className="text-[10px] text-amber-400 mt-1">Auto-suggested from thread depth — override anytime</p>}
          </div>
          <div className="mt-3 w-40 space-y-2">
            <FieldLabel hint="Distance from toolholder face to tool tip. Used to calculate deflection. Shorter stickout = better rigidity.">Tool Stickout (in)</FieldLabel>
            <Input
              type="text" inputMode="decimal" className="no-spinners"
              placeholder="e.g. 1.500"
              value={tmStickoutText}
              onChange={(e) => { setTmStickoutText(e.target.value); setStickoutAutoSuggested(false); }}
              onFocus={() => { if (form.stickout > 0) setTmStickoutText(form.stickout.toFixed(3)); }}
              onBlur={() => {
                const n = parseDim(tmStickoutText);
                if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, stickout: n })); setTmStickoutText(n.toFixed(3)); }
                else setTmStickoutText(form.stickout > 0 ? form.stickout.toFixed(3) : "");
              }}
            />
            {stickoutAutoSuggested && <p className="text-[10px] text-amber-400 mt-1">Auto-suggested from thread depth — override anytime</p>}
          </div>
          </>)}


          {/* ── Keyseat / Dovetail Tool Geometry ─────────────────────────────────────── */}
          {(operation === "keyseat" || operation === "dovetail") && (<>
            <div className="flex items-center gap-3 my-7">
              <div className="flex-1 border-t-2 border-orange-500" />
              <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Tool Geometry</div>
              <div className="flex-1 border-t-2 border-orange-500" />
            </div>

            {/* PDF Upload for keyseat/dovetail */}
            <div className={`rounded-lg border p-3 mb-3 ${pdfExtracted ? "border-amber-500 bg-amber-950/20" : "border-dashed border-gray-600"}`}>
              {pdfExtracted ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-amber-400 font-medium">✓ Dimensions extracted from CC print{pdfToolNumber ? ` (${pdfToolNumber})` : ""} — review fields below</span>
                  <button type="button" onClick={() => setPdfExtracted(false)} className="text-[10px] text-gray-400 hover:text-white underline">Clear</button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-1 cursor-pointer">
                  <span className="text-xs text-gray-400">Upload CC-XXXXX print to auto-fill dimensions</span>
                  <span className="rounded border border-orange-500 text-orange-400 hover:bg-orange-500 hover:text-white transition-colors px-3 py-1.5 text-xs font-semibold inline-block">
                    {pdfUploading ? "Reading print…" : "⬆ Upload CC Print (PDF)"}
                  </span>
                  <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={pdfUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPrintPdf(f); e.target.value = ""; }} />
                </label>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <FieldLabel hint="Cutting diameter (keyseat width for keyseat cutters, max cutting diameter for dovetail cutters).">Cut Dia (in)</FieldLabel>
                <Input type="text" inputMode="decimal" className="no-spinners"
                  placeholder="e.g. 0.750"
                  value={toolDiaText}
                  onChange={(e) => setToolDiaText(e.target.value)}
                  onBlur={() => {
                    const n = parseDim(toolDiaText);
                    if (Number.isFinite(n) && n > 0) {
                      setForm((p) => ({ ...p, tool_dia: n }));
                      setToolDiaText(n.toFixed(4));
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <FieldLabel hint="Number of cutting teeth/flutes.">Flutes</FieldLabel>
                <Input type="number" step="1" className="no-spinners" value={form.flutes || ""} onChange={onNum("flutes")} />
              </div>
              <div className="space-y-2">
                <FieldLabel hint="Length of cut — for keyseat cutters this is the disc width (tooth width).">LOC (in)</FieldLabel>
                <Input type="text" inputMode="decimal" className="no-spinners"
                  placeholder="e.g. 0.1875"
                  value={locText}
                  onChange={(e) => setLocText(e.target.value)}
                  onBlur={() => { const n = parseDim(locText); if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, loc: n })); setLocText(n.toFixed(4)); } }}
                />
              </div>
            </div>

            {operation === "keyseat" && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-2">
                  <FieldLabel hint="Arbor (neck) diameter — the narrow section between the shank and the cutting teeth. Critical for deflection. Found on the engineering print as the neck or arbor OD.">Arbor/Neck Dia (in)</FieldLabel>
                  <Input type="text" inputMode="decimal" className="no-spinners"
                    placeholder="e.g. 0.250"
                    value={form.keyseat_arbor_dia > 0 ? form.keyseat_arbor_dia.toFixed(4) : ""}
                    onChange={(e) => { const n = parseDim(e.target.value); if (Number.isFinite(n) && n > 0) setForm((p) => ({ ...p, keyseat_arbor_dia: n })); }}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel hint="Reach (TSC) — total distance from shank face to the cutter disc. From the engineering print. Used for deflection calculations.">Reach / TSC (in)</FieldLabel>
                  <Input type="text" inputMode="decimal" className="no-spinners"
                    placeholder="e.g. 1.875"
                    value={lbsText}
                    onChange={(e) => setLbsText(e.target.value)}
                    onBlur={() => { const n = parseDim(lbsText); if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, lbs: n })); setLbsText(n.toFixed(4)); } }}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel hint="How deep the cutter takes each pass in inches. Multi-pass is often safer — neck strength, material toughness, and setup rigidity all affect how much you can take per pass. The engine will suggest a safe starting depth.">Cut Pass Depth (in)</FieldLabel>
                  <Input type="text" inputMode="decimal" className="no-spinners"
                    placeholder="e.g. 0.125"
                    value={form.doc_xd > 0 ? (form.doc_xd * form.tool_dia).toFixed(4) : ""}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n) && n > 0 && form.tool_dia > 0)
                        setForm((p) => ({ ...p, doc_xd: n / p.tool_dia }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel hint="Total final slot depth required in inches. Used to calculate how many passes are needed and whether a multi-pass strategy is recommended for tool survivability.">
                    <span className="text-yellow-400 animate-pulse font-semibold">⚠ Final Slot Depth (in)</span>
                  </FieldLabel>
                  <Input type="text" inputMode="decimal" className={`no-spinners ${form.final_slot_depth === 0 ? "border-yellow-400/70 ring-1 ring-yellow-400/50 animate-pulse placeholder-yellow-600/60" : "border-zinc-600"}`}
                    placeholder={form.tool_dia > 0 && form.keyseat_arbor_dia > 0 ? `max ${((form.tool_dia - form.keyseat_arbor_dia) / 2).toFixed(4)}"` : "e.g. 0.250"}
                    value={finalSlotDepthText}
                    onChange={(e) => setFinalSlotDepthText(e.target.value)}
                    onBlur={() => {
                      let n = parseFloat(finalSlotDepthText);
                      if (!Number.isFinite(n) || n <= 0) { setForm((p) => ({ ...p, final_slot_depth: 0 })); setFinalSlotDepthText(""); return; }
                      const maxDepth = form.tool_dia > 0 && form.keyseat_arbor_dia > 0 ? (form.tool_dia - form.keyseat_arbor_dia) / 2 : Infinity;
                      if (n > maxDepth) {
                        n = maxDepth;
                        toast({ title: "Final slot depth capped", description: `Max depth for this tool is ${maxDepth.toFixed(4)}" — limited by flute reach (cut dia − neck dia) / 2.`, variant: "destructive" });
                      }
                      setForm((p) => ({ ...p, final_slot_depth: n }));
                      setFinalSlotDepthText(n.toFixed(4));
                    }}
                  />
                </div>
              </div>
            )}

            {operation === "dovetail" && (
              <>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-2">
                  <FieldLabel hint="Included angle of the dovetail V-form. This is the FULL included angle — if the print shows 45° on one side of the V, enter 90°. Affects chip load correction and SFM.">Dovetail Angle (°)</FieldLabel>
                  <Input type="number" step="5" className="no-spinners"
                    placeholder="e.g. 60"
                    value={form.dovetail_angle || ""}
                    onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n) && n > 0) setForm((p) => ({ ...p, dovetail_angle: n })); }}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel hint="Reach (TSC) — distance from shank face to the cutting zone. From the engineering print, labeled TSC.">Reach / TSC (in)</FieldLabel>
                  <Input type="text" inputMode="decimal" className="no-spinners"
                    placeholder="e.g. 0.625"
                    value={lbsText}
                    onChange={(e) => setLbsText(e.target.value)}
                    onBlur={() => { const n = parseDim(lbsText); if (Number.isFinite(n) && n > 0) { setForm((p) => ({ ...p, lbs: n })); setLbsText(n.toFixed(4)); } }}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel hint="Neck diameter — the narrow section between the shank and the cutting head. Used for deflection modeling.">Neck Dia (in)</FieldLabel>
                  <Input type="text" inputMode="decimal" className="no-spinners"
                    placeholder="e.g. 0.200"
                    value={form.keyseat_arbor_dia > 0 ? form.keyseat_arbor_dia.toFixed(4) : ""}
                    onChange={(e) => { const n = parseDim(e.target.value); if (Number.isFinite(n) && n > 0) setForm((p) => ({ ...p, keyseat_arbor_dia: n })); }}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel hint="Axial depth of cut per pass in inches. Cannot exceed (cutter dia − neck dia) / 2 — the physical flute reach limit.">Cut Pass Depth (in)</FieldLabel>
                  <Input type="text" inputMode="decimal" className="no-spinners"
                    placeholder={form.tool_dia > 0 && form.keyseat_arbor_dia > 0 ? `max ${((form.tool_dia - form.keyseat_arbor_dia) / 2).toFixed(4)}"` : "e.g. 0.050"}
                    value={form.doc_xd > 0 && form.tool_dia > 0 ? (form.doc_xd * form.tool_dia).toFixed(4) : ""}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n) && n > 0 && form.tool_dia > 0)
                        setForm((p) => ({ ...p, doc_xd: n / p.tool_dia }));
                    }}
                    onBlur={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!Number.isFinite(n) || n <= 0) return;
                      const maxDepth = form.tool_dia > 0 && form.keyseat_arbor_dia > 0 ? (form.tool_dia - form.keyseat_arbor_dia) / 2 : Infinity;
                      if (n > maxDepth) {
                        setForm((p) => ({ ...p, doc_xd: maxDepth / p.tool_dia }));
                        toast({ title: "Cut pass depth capped", description: `Max depth for this tool is ${maxDepth.toFixed(4)}" — limited by (cutter dia − neck dia) / 2.`, variant: "destructive" });
                      }
                    }}
                  />
                </div>
              </div>
              {/* Final Slot Depth — multi-pass strategy */}
              <div className="mt-3 space-y-2">
                <FieldLabel hint="Total final slot depth required in inches. Used to calculate how many passes are needed and whether a multi-pass strategy is recommended for tool survivability.">
                  <span className="text-yellow-400 animate-pulse font-semibold">⚠ Final Slot Depth (in)</span>
                </FieldLabel>
                <Input type="text" inputMode="decimal" className={`no-spinners ${form.final_slot_depth === 0 ? "border-yellow-400/70 ring-1 ring-yellow-400/50 animate-pulse placeholder-yellow-600/60" : "border-zinc-600"}`}
                  placeholder={form.tool_dia > 0 && form.keyseat_arbor_dia > 0 ? `max ${((form.tool_dia - form.keyseat_arbor_dia) / 2).toFixed(4)}"` : "e.g. 0.250"}
                  value={finalSlotDepthText}
                  onChange={(e) => setFinalSlotDepthText(e.target.value)}
                  onBlur={() => {
                    let n = parseFloat(finalSlotDepthText);
                    if (!Number.isFinite(n) || n <= 0) { setForm((p) => ({ ...p, final_slot_depth: 0 })); setFinalSlotDepthText(""); return; }
                    const maxDepth = form.tool_dia > 0 && form.keyseat_arbor_dia > 0 ? (form.tool_dia - form.keyseat_arbor_dia) / 2 : Infinity;
                    if (n > maxDepth) {
                      n = maxDepth;
                      toast({ title: "Final slot depth capped", description: `Max depth for this tool is ${maxDepth.toFixed(4)}" — limited by flute reach (cut dia − neck dia) / 2.`, variant: "destructive" });
                    }
                    setForm((p) => ({ ...p, final_slot_depth: n }));
                    setFinalSlotDepthText(n.toFixed(4));
                  }}
                />
              </div>
              </>
            )}

            <div className="mt-3 space-y-2">
              <FieldLabel hint="Helix angle in degrees. Enter 0 for straight flute tools. Affects cutting force direction and chip evacuation.">Helix Angle (°) — 0 = straight flute</FieldLabel>
              <Input type="number" step="1" className="no-spinners"
                placeholder="0"
                value={form.helix_angle !== undefined ? form.helix_angle : ""}
                onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n) && n >= 0) setForm((p) => ({ ...p, helix_angle: n })); }}
              />
            </div>
          </>)}

          {/* Entry Type Preferences — milling only */}
          {(operation === "milling") && (
            <div className="mt-5 space-y-2">
              <FieldLabel hint="Select which entry strategies to show in results. Sweep/Roll-in is recommended for most HEM toolpaths — the tangential arc builds engagement gradually (chip starts thin) instead of slamming the full WOC at once. Straight-in is rarely correct and is included for reference only.">
                Entry Type Preferences
              </FieldLabel>
              <div className="flex flex-wrap gap-3">
                {[
                  { key: "sweep",    label: "Sweep / Roll-in", color: "text-green-400 border-green-500/60",  recommended: true },
                  { key: "ramp",     label: "Ramp",            color: "text-indigo-300 border-indigo-500/60", recommended: false },
                  { key: "helical",  label: "Helical",         color: "text-indigo-300 border-indigo-500/60", recommended: false },
                  { key: "straight", label: "Straight-In",     color: "text-amber-400 border-amber-500/60",  recommended: false },
                ].map(({ key, label, color, recommended }) => {
                  const checked = entryTypes.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEntryTypes(p => checked ? p.filter(k => k !== key) : [...p, key])}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-colors ${checked ? color + " bg-zinc-800" : "text-zinc-500 border-zinc-700 bg-transparent"}`}
                    >
                      <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 ${checked ? "bg-current border-current" : "border-zinc-600"}`}>
                        {checked && <svg className="w-2.5 h-2.5 text-zinc-900" viewBox="0 0 10 10" fill="currentColor"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                      </span>
                      {label}{recommended && <span className="text-[9px] text-green-500 ml-0.5">★</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Machine Power */}
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Machine Power</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>

          {/* Machine selector */}
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel hint="Search by brand or model to auto-fill RPM, HP, taper, and drive type. Or enter manually below.">Machine Lookup</FieldLabel>
              <div className="flex items-center gap-2">
                {activeMachineName && (
                  <span className="text-xs text-orange-400 font-semibold border border-orange-400/40 rounded px-2 py-0.5">
                    {activeMachineName}
                  </span>
                )}
                <button
                  type="button"
                  className="text-[10px] text-zinc-500 hover:text-orange-400 underline underline-offset-2"
                  onClick={() => setShowSaveMachineModal(true)}
                >
                  Save machine
                </button>
              </div>
            </div>

            {/* My Machines dropdown (if toolbox session active) */}
            {savedMachines.length > 0 && (
              <div className="space-y-1 mb-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300 font-semibold">My Machines:</span>
                  <button
                    type="button"
                    onClick={() => setShowManageMachines(p => !p)}
                    className="text-[10px] text-zinc-500 hover:text-orange-400 underline underline-offset-2"
                  >
                    {showManageMachines ? "Done" : "Manage"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {savedMachines.map(m => (
                    <div key={m.id} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => applyMachineToForm(m)}
                        className={`text-xs px-2 py-0.5 rounded-l border transition-colors ${activeMachineName === m.nickname ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-600 text-zinc-300 hover:border-orange-400 hover:text-orange-400"}`}
                      >
                        {m.nickname}{m.shop_machine_no ? ` #${m.shop_machine_no}` : ""}
                      </button>
                      {showManageMachines && (
                        <button
                          type="button"
                          onClick={async () => {
                            const e = tbEmail || localStorage.getItem("tb_email") || "";
                            const t = tbToken || localStorage.getItem("tb_token") || "";
                            if (!e || !t) return;
                            await fetch(`/api/user-machines/${m.id}`, {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ email: e, token: t }),
                            });
                            setSavedMachines(p => p.filter(x => x.id !== m.id));
                            if (activeMachineName === m.nickname) setActiveMachineName("");
                          }}
                          className="text-xs px-1.5 py-0.5 rounded-r border border-l-0 border-red-500/50 text-red-400 hover:bg-red-500/20"
                        >✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Catalog search */}
            <div className="relative">
              <Input
                ref={machineInputRef}
                type="text"
                placeholder="Search catalog — e.g. Haas VF-2, Mazak, DMG..."
                value={machineQuery || (!machineDropOpen ? activeMachineName : "")}
                onChange={e => { setMachineQuery(e.target.value); setMachineDropOpen(true); }}
                onFocus={() => {
                  setMachineDropOpen(true);
                  const e = tbEmail || localStorage.getItem("tb_email") || "";
                  const t = tbToken || localStorage.getItem("tb_token") || "";
                  if (e && t) fetch(`/api/user-machines?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`).then(r => r.ok ? r.json() : []).then(setSavedMachines).catch(() => {});
                }}
                onBlur={() => setTimeout(() => { if (!machineTouchingDropRef.current) setMachineDropOpen(false); }, 500)}
                className="text-sm"
              />
              {machineDropOpen && machineResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl max-h-60 overflow-y-auto">
                  {machineResults.map((m, i) => (
                    <button
                      key={`${m._saved ? "u" : "c"}-${m.id}-${i}`}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); applyMachineToForm(m); }}
                      onTouchStart={e => { machineTouchingDropRef.current = true; (e.currentTarget as any)._touchY = e.touches[0].clientY; }}
                      onTouchEnd={e => { const startY = (e.currentTarget as any)._touchY ?? 0; const moved = Math.abs(e.changedTouches[0].clientY - startY); machineTouchingDropRef.current = false; if (moved < 8) { e.preventDefault(); applyMachineToForm(m); } }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800 flex items-baseline gap-2"
                    >
                      <span className="font-semibold text-orange-400">
                        {m._saved && m.nickname ? m.nickname : [m.brand, m.model].filter(Boolean).join(" ")}
                        {m._saved && m.shop_machine_no ? ` #${m.shop_machine_no}` : ""}
                      </span>
                      {m._saved && <span className="text-[10px] font-bold text-emerald-400 border border-emerald-600/50 rounded px-1">Saved</span>}
                      <span className="text-xs text-zinc-400">{m.max_rpm?.toLocaleString()} RPM · {m.spindle_hp} HP · {m.taper} · {m.drive_type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <FieldLabel hint="Spindle speed ceiling from your machine spec. The engine will not exceed this value.">Max RPM</FieldLabel>
              <Input
                type="number"
                step="10"
                className="no-spinners"
                value={form.max_rpm || ""}
                onChange={onNum("max_rpm")}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Rated nameplate spindle power. The engine applies a drive efficiency factor (Direct 96%, Belt 92%, Gear 88%) to get available cutting HP.">{UL("Machine HP", "Machine kW")}</FieldLabel>
              <Input
                type="number"
                step={metric ? "0.1" : "0.5"}
                className="no-spinners"
                value={form.machine_hp === 0 ? "" : metric ? (form.machine_hp * 0.7457).toFixed(1) : form.machine_hp}
                onChange={onUnitNum("machine_hp", 0.7457)}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel hint="Spindle drive type determines power transmission efficiency. Direct drive (servo-direct, HSK): 96%. Belt drive (most VMC/HMC): 92%. Gear drive (older machines): 88%. Nameplate HP is derated accordingly.">Spindle Drive</FieldLabel>
              <div className="flex gap-1">
                {(["direct", "belt", "gear"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, spindle_drive: d }))}
                    className="rounded px-2.5 py-1 text-xs font-semibold border transition-all capitalize"
                    style={{
                      backgroundColor: form.spindle_drive === d ? "#f97316" : "transparent",
                      borderColor: "#f97316",
                      color: form.spindle_drive === d ? "#fff" : "#f97316",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            {operation !== "drilling" && operation !== "reaming" && <div className="space-y-2 col-span-3">
              <FieldLabel hint="Caps the spindle speed as a percentage of your Max RPM. Use 95% for standard work. Drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern.">Max RPM Use</FieldLabel>
              <div className="flex w-full gap-1.5">
                {([
                  { val: 1.00, label: "100%" },
                  { val: 0.95, label: "95%"  },
                  { val: 0.90, label: "90%"  },
                  { val: 0.80, label: "80%"  },
                  { val: 0.70, label: "70%"  },
                ] as const).map(({ val, label }) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, rpm_util_pct: val }))}
                    className="flex-1 rounded py-2 text-xs font-semibold border transition-all text-center"
                    style={{
                      backgroundColor: form.rpm_util_pct === val ? "#6366f1" : "transparent",
                      borderColor: "#6366f1",
                      color: form.rpm_util_pct === val ? "#fff" : "#6366f1",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>}
            {operation === "drilling" && (
              <div className="space-y-2">
                <FieldLabel hint="Applies a safety factor to the calculated drill feed. Use 90% for standard holes. Reduce to 80–70% for deep holes (>3×D), difficult materials, or worn machines.">Feed Safety Factor</FieldLabel>
                <div className="flex w-full gap-1.5">
                  {([
                    { val: 1.00, label: "100%" },
                    { val: 0.90, label: "90%"  },
                    { val: 0.80, label: "80%"  },
                    { val: 0.70, label: "70%"  },
                  ] as const).map(({ val, label }) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, drill_feed_util_pct: val }))}
                      className="flex-1 rounded py-2 text-xs font-semibold border transition-all text-center"
                      style={{
                        backgroundColor: form.drill_feed_util_pct === val ? "#6366f1" : "transparent",
                        borderColor: "#6366f1",
                        color: form.drill_feed_util_pct === val ? "#fff" : "#6366f1",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Machine Setup */}
          <div className="flex items-center gap-3 my-7">
            <div className="flex-1 border-t-2 border-orange-500" />
            <div className="text-xs font-bold uppercase tracking-widest text-orange-500">Machine Setup</div>
            <div className="flex-1 border-t-2 border-orange-500" />
          </div>
          <div className="space-y-6">

            {/* Machine Type */}
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/30 border-l-4 border-l-indigo-500 p-3 space-y-1.5">
              <FieldLabel hint="Machine configuration affects rigidity and chatter tendency. HMC and 5-axis spindles are often stiffer than VMC. Mill/Turn and Lathe live tooling have lower RPM and HP limits.">Machine Type</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { key: "vmc",       label: "VMC",        hint: "Vertical Machining Center — spindle is vertical. Most common shop machine. Good all-around rigidity for prismatic parts." },
                  { key: "hmc",       label: "HMC",        hint: "Horizontal Machining Center — spindle is horizontal. Chips fall away from the cut, better for deep pockets and high-volume production. Typically stiffer than VMC." },
                  { key: "5axis",     label: "5-Axis",     hint: "5-Axis simultaneous machining — spindle can tilt and rotate. Enables complex contoured surfaces in one setup, but shorter effective stickout required for stability." },
                  { key: "mill_turn", label: "Mill/Turn",  hint: "Mill/Turn machine (e.g. Mazak Integrex, DMG NTX) — dedicated multi-tasking center with full milling spindle and turning capability. Live tool RPM and HP are typically lower than a VMC." },
                  { key: "lathe",     label: "Lathe",      hint: "Lathe with live tooling — driven tool stations in the turret. RPM typically limited to 3,000–6,000. HP per station is limited. Use for milling, drilling, and cross-hole ops on turned parts." },
                ] as const).map(({ key, label, hint }) => (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setForm((p) => {
                          const isLathe    = key === "lathe";
                          const isMillTurn = key === "mill_turn";
                          const isLatheLike = isLathe || isMillTurn;
                          // workholding default
                          const defaultWH = isLatheLike ? "3_jaw_chuck" as const : key === "hmc" ? "rigid_fixture" as const : "vise" as const;
                          // toolholder — reset if switching away from a lathe-incompatible holder
                          const latheSafe = ["er_collet","hp_collet","weldon","hydraulic","shrink_fit","capto"] as const;
                          const thReset = isLatheLike && !(latheSafe as readonly string[]).includes(p.toolholder) ? "er_collet" as const : p.toolholder;
                          // spindle taper default per machine type
                          const defaultTaper = (
                            isLathe    ? "VDI40"      :
                            isMillTurn ? "CAPTO C6"  :
                            key === "5axis" ? "HSK63" :
                            "CAT40"
                          ) as typeof p.spindle_taper;
                          // if current taper isn't valid for new machine type, reset to default
                          const latheTapers  = ["VDI30","VDI40","VDI50","BMT45","BMT55","BMT65"] as const;
                          const millingTapers = ["CAT30","CAT40","CAT50","BT30","BT40","BT50","HSK63","HSK100","CAPTO C6","CAPTO C8"] as const;
                          const taperReset =
                            isLathe && !(latheTapers as readonly string[]).includes(p.spindle_taper)  ? defaultTaper :
                            !isLathe && !(millingTapers as readonly string[]).includes(p.spindle_taper) ? defaultTaper :
                            p.spindle_taper;
                          return { ...p, machine_type: key, workholding: defaultWH, toolholder: thReset, spindle_taper: taperReset };
                        })}
                        className="rounded px-3 py-1 text-xs font-semibold border transition-all"
                        style={{
                          backgroundColor: form.machine_type === key ? "#6366f1" : "transparent",
                          borderColor: "#6366f1",
                          color: form.machine_type === key ? "#fff" : "#6366f1",
                        }}
                      >
                        {label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-60 text-xs">{hint}</TooltipContent>
                  </Tooltip>
                ))}
              </div>

              {/* Lathe note — live tooling implied, turning not yet supported */}
              {form.machine_type === "lathe" && (
                <p className="mt-2 text-xs text-gray-400">
                  Live tooling assumed. Turning operations (dead tooling) are not yet supported.
                </p>
              )}
            </div>

            {/* Spindle Interface */}
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/30 border-l-4 border-l-sky-500 p-3 space-y-1.5">
              <FieldLabel hint={
                form.machine_type === "lathe"
                  ? "Live tool turret interface standard. VDI (DIN 69880) is most common on CNC lathes. BMT (Built-in Motor Turret) offers higher rigidity and RPM on modern machines."
                  : "Spindle interface standard. CV40 (CAT40) is most common in VMCs. BT50 and CAT50 handle higher torque on large HMCs. HSK is inherently dual-contact and stiffer at high RPM."
              }>Spindle Interface</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {(
                  form.machine_type === "lathe"
                  ? (["VDI30","VDI40","VDI50","BMT45","BMT55","BMT65"] as const)
                  : form.machine_type === "hmc"
                  ? (["CAT40","CAT50","BT40","BT50","HSK63","HSK100"] as const)
                  : (form.machine_type === "5axis" || form.machine_type === "mill_turn")
                  ? (["CAT40","BT40","HSK63","HSK100","CAPTO C6","CAPTO C8"] as const)
                  : /* vmc */ (["CAT30","CAT40","CAT50","BT30","BT40","HSK63","HSK100"] as const)
                ).map((t) => {
                  const taperLabel: Record<string, string> = { CAT30: "CV30", CAT40: "CV40", CAT50: "CV50" };
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, spindle_taper: t }))}
                      className="rounded px-2.5 py-1 text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: form.spindle_taper === t ? "#0ea5e9" : "transparent",
                        borderColor: "#0ea5e9",
                        color: form.spindle_taper === t ? "#fff" : "#0ea5e9",
                      }}
                    >
                      {taperLabel[t] ?? t}
                    </button>
                  );
                })}
              </div>
              {/* Dual Contact — only relevant for CAT/BT tapers; HSK is inherently dual contact; VDI/BMT N/A */}
              {!form.spindle_taper.startsWith("HSK") && !form.spindle_taper.startsWith("VDI") && !form.spindle_taper.startsWith("BMT") && !form.spindle_taper.startsWith("CAPTO") && (
                <div className="flex items-center gap-2 pt-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={form.dual_contact}
                        onClick={() => setForm((p) => ({ ...p, dual_contact: !p.dual_contact }))}
                        className="rounded px-2.5 py-1 text-xs font-semibold border transition-all"
                        style={{
                          backgroundColor: form.dual_contact ? "#ef4444" : "transparent",
                          borderColor: "#ef4444",
                          color: form.dual_contact ? "#fff" : "#ef4444",
                        }}
                      >
                        {form.dual_contact ? "Dual Contact ✓" : "Dual Contact"}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-64 text-xs">
                      Big-Plus dual contact — adds simultaneous taper and face contact between spindle and holder. Increases rigidity ~8%, reduces deflection and micro-vibration. Available on CAT/BT Big-Plus holders.
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>

            {/* Toolholder */}
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/30 border-l-4 border-l-emerald-500 p-3 space-y-1.5">
              <FieldLabel hint="Toolholder type affects runout and rigidity. Shrink fit and HP Collet (SK/FX-style) have the lowest runout. HP Collet uses a shallow taper angle with a precision bearing nut for superior grip vs standard ER.">Tool Holder</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {(
                  (form.machine_type === "lathe" || form.machine_type === "mill_turn")
                  ? ([
                      { key: "er_collet",  label: "ER Collet",  hint: "Standard ER collet — most common live tooling holder. 3–5 µm runout. Versatile across drills, end mills, and taps." },
                      { key: "hp_collet",  label: "HP Collet",  hint: "SK/FX-style precision bearing nut collet — better clamping and runout than standard ER. Good upgrade for live tool stations." },
                      { key: "weldon",     label: "Weldon",     hint: "Side-lock set screw on a flat — positive mechanical lock, prevents pullout under heavy radial load on live tool turrets." },
                      { key: "hydraulic",  label: "Hydraulic",  hint: "Oil-membrane clamping — excellent vibration damping and 1–2 µm runout. Available on premium live tool heads." },
                      { key: "shrink_fit", label: "Shrink Fit", hint: "Thermally shrunk onto shank — maximum grip and <1 µm runout. Available on high-end live tool turret stations." },
                      { key: "capto",      label: "Capto",      hint: "Sandvik Capto polygon taper — designed for turning/milling centres. Exceptional rigidity and fast changeover on live tool turrets." },
                    ] as const)
                  : ([
                      { key: "er_collet",       label: "ER Collet",       hint: "Standard ER collet — versatile and widely available. 3–5 µm runout. Good for general use; upgrade for precision or HEM work." },
                      { key: "hp_collet",       label: "HP Collet",       hint: "SK/FX-style precision bearing nut collet — better clamping than standard ER but still a slotted collet. Good all-around upgrade from ER. (e.g. Lyndex SK, Pioneer FX)" },
                      { key: "weldon",          label: "Weldon",          hint: "Side-lock set screw on a flat ground into the shank — positive mechanical lock, prevents pullout under heavy load. Larger tools (≥1\") often use double Weldon flats." },
                      { key: "shell_mill_arbor",label: "Shell Mill Arbor",hint: "Face contact + drive keys + center bolt — used for indexable face mills and shell mills. Rigid face interface; swap insert bodies without re-indicating." },
                      { key: "milling_chuck",   label: "Milling Chuck",   hint: "Full-bore mechanical chuck — high clamping torque, good radial stiffness. Well suited for heavy interrupted cuts and roughing." },
                      { key: "hydraulic",       label: "Hydraulic",       hint: "Oil-membrane clamping — full circumferential contact, excellent vibration damping, 1–2 µm runout. Great for finishing and long-reach applications." },
                      { key: "press_fit",       label: "Press-Fit",       hint: "Lobed press-fit interface — full bore contact with self-centering geometry under load. High rigidity and excellent runout. Requires dedicated press tooling to assemble." },
                      { key: "shrink_fit",      label: "Shrink Fit",      hint: "Thermally shrunk onto shank — <1 µm runout, maximum grip and rigidity. Best for high-speed and heavy roughing." },
                      { key: "capto",           label: "Capto",           hint: "Polygon taper with face contact — exceptional rigidity and repeatability. Common on turning/milling centres." },
                    ] as const)
                ).map(({ key, label, hint }) => (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, toolholder: key }))}
                        className="rounded px-2.5 py-1 text-xs font-semibold border transition-all"
                        style={{
                          backgroundColor: form.toolholder === key ? "#10b981" : "transparent",
                          borderColor: "#10b981",
                          color: form.toolholder === key ? "#fff" : "#10b981",
                        }}
                      >
                        {label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-56 text-xs">{hint}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
              {/* Extension holder Yes/No */}
              <div className="flex items-center gap-3 pt-2 mt-1 border-t border-border flex-wrap">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs font-medium text-zinc-300 cursor-default">Is an Extension Holder being used? <span className="text-muted-foreground/60 text-[10px]">ⓘ</span></span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-64 text-xs">
                    An extension holder is clamped inside your main toolholder to gain extra reach. Each added interface (spindle → holder → extension → tool) multiplies compliance and runout — the stability advisor will flag this.
                  </TooltipContent>
                </Tooltip>
                {([{ val: false, label: "No" }, { val: true, label: "Yes" }] as const).map(({ val, label }) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, extension_holder: val }))}
                    className="rounded px-3 py-1 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.extension_holder === val ? (val ? "#f59e0b" : "#52525b") : "transparent",
                      borderColor: val ? "#f59e0b" : "#52525b",
                      color: form.extension_holder === val ? (val ? "#111" : "#fff") : (val ? "#f59e0b" : "#71717a"),
                    }}
                  >
                    {label}
                  </button>
                ))}
                {form.extension_holder && (
                  <span className="text-[11px] text-amber-400">⚠ Multi-joint setup — added compliance and runout at each interface</span>
                )}
              </div>

              {/* Holder extension inputs */}
              <div className="flex gap-3 pt-2 mt-1 border-t border-border">
                <div className="flex-1 space-y-1">
                  <FieldLabel hint="Total projection from spindle face to end of holder (where tool starts). Accounts for long-nose, extended shrink fit, or any holder that adds reach before the tool. Leave blank for standard holders.">Holder Gage Length (in)</FieldLabel>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 4.0"
                    className="no-spinners"
                    value={holderGageText}
                    onChange={(e) => setHolderGageText(e.target.value)}
                    onBlur={() => {
                      const n = parseDim(holderGageText);
                      if (Number.isFinite(n) && n > 0) {
                        setForm((p) => ({ ...p, holder_gage_length: n }));
                        setHolderGageText(n.toFixed(3));
                      } else {
                        setForm((p) => ({ ...p, holder_gage_length: 0 }));
                        setHolderGageText("");
                      }
                    }}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <FieldLabel hint="Diameter of the holder nose / extension section. Critical for long-nose and slender extension holders — a thin nose deflects much more than a standard body. Leave blank to use a default estimate (2× tool diameter).">Nose Dia (in)</FieldLabel>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 1.25"
                    className="no-spinners"
                    value={holderNoseDiaText}
                    onChange={(e) => setHolderNoseDiaText(e.target.value)}
                    onBlur={() => {
                      const n = parseDim(holderNoseDiaText);
                      if (Number.isFinite(n) && n > 0) {
                        setForm((p) => ({ ...p, holder_nose_dia: n }));
                        setHolderNoseDiaText(n.toFixed(3));
                      } else {
                        setForm((p) => ({ ...p, holder_nose_dia: 0 }));
                        setHolderNoseDiaText("");
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Coolant */}
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/30 border-l-4 border-l-amber-500 p-3 space-y-2">
              <FieldLabel hint="Coolant delivery method affects tool life and surface finish. TSC (through-spindle coolant) significantly extends tool life in tough materials.">Coolant</FieldLabel>
              {/* Row 1: Delivery */}
              <div className="flex flex-wrap gap-1.5">
                {([
                  { key: "dry",      label: "Dry",         hint: null },
                  { key: "mist",     label: "Mist",        hint: null },
                  { key: "flood",    label: "Flood",       hint: null },
                  { key: "tsc_low",  label: "TSC 300psi",  hint: "Through-Spindle Coolant — pumped at high pressure through the spindle and toolholder, exiting at the cutting edge. 300 psi is effective for aluminum and mild steel." },
                  { key: "tsc_high", label: "TSC 1000psi", hint: "Through-Spindle Coolant at high pressure — coolant blasts directly at the cutting edge through the tool body. Dramatically extends tool life in stainless, titanium, and Inconel." },
                ] as const).map(({ key, label, hint }) => {
                  const btn = (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, coolant: key }))}
                      className="rounded px-2.5 py-1 text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: form.coolant === key ? "#f59e0b" : "transparent",
                        borderColor: "#f59e0b",
                        color: form.coolant === key ? "#111" : "#f59e0b",
                      }}
                    >
                      {label}
                    </button>
                  );
                  if (!hint) return btn;
                  return (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>{btn}</TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-64 text-xs">{hint}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>

              {/* Row 2: Fluid Type (hidden when dry) */}
              {form.coolant !== "dry" && (
                <div className="space-y-1">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Fluid Type</p>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { key: "water_soluble",  label: "Water-Soluble",  hint: "Soluble oil (oil-in-water emulsion). Good lubricity and cooling. Measure with a refractometer — target 8–12%. Best all-around for steel and stainless." },
                      { key: "semi_synthetic", label: "Semi-Synthetic",  hint: "Partial synthetic + partial mineral oil. Balanced lubricity and cooling. Very common in job shops — good for steel, stainless, and cast iron." },
                      { key: "synthetic",      label: "Synthetic",       hint: "Water-based, no mineral oil. Excellent cooling, lower lubricity. Preferred for aluminum. Less ideal for stainless/Inconel where lubricity reduces built-up edge." },
                      { key: "straight_oil",   label: "Straight Oil",    hint: "Pure cutting oil — no water. Best lubricity, minimal cooling. Preferred for difficult stainless, Inconel, and threading. Not ideal for high-speed aluminum." },
                    ] as const).map(({ key, label, hint }) => (
                      <Tooltip key={key}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setForm((p) => ({ ...p, coolant_fluid: key }))}
                            className="rounded px-2.5 py-1 text-xs font-semibold border transition-all"
                            style={{
                              backgroundColor: form.coolant_fluid === key ? "#f59e0b" : "transparent",
                              borderColor: "#f59e0b",
                              color: form.coolant_fluid === key ? "#111" : "#f59e0b",
                            }}
                          >
                            {label}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-64 text-xs">{hint}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}

              {/* Row 3: Concentration (water-based fluids only) */}
              {form.coolant !== "dry" && form.coolant_fluid !== "straight_oil" && (() => {
                const pct = form.coolant_concentration ?? 10;
                const concTip =
                  pct < 7  ? "⚠ Below recommended — poor lubricity and bacterial risk. Target 8–12%." :
                  pct <= 12 ? "Optimal for most metals — good balance of lubricity and cooling." :
                  pct <= 16 ? "Richer mix — better lubricity for tough materials (stainless, Inconel)." :
                              "⚠ Over-concentrated — residue buildup and foaming risk. Check with fluid supplier.";
                return (
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                      Refractometer Reading (Concentration %)
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="w-7 h-7 rounded border border-zinc-600 text-zinc-300 text-sm font-bold flex items-center justify-center hover:bg-zinc-700"
                        onClick={() => setForm(p => ({ ...p, coolant_concentration: Math.max(1, (p.coolant_concentration ?? 10) - 1) }))}
                      >−</button>
                      <span className="text-sm font-semibold text-white w-10 text-center">{pct}%</span>
                      <button
                        type="button"
                        className="w-7 h-7 rounded border border-zinc-600 text-zinc-300 text-sm font-bold flex items-center justify-center hover:bg-zinc-700"
                        onClick={() => setForm(p => ({ ...p, coolant_concentration: Math.min(25, (p.coolant_concentration ?? 10) + 1) }))}
                      >+</button>
                      <span className={`text-[11px] ${pct < 7 || pct > 16 ? "text-amber-400" : "text-zinc-400"}`}>{concTip}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Workholding */}
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/30 border-l-4 border-l-purple-500 p-3 space-y-1.5">
              <FieldLabel hint="Workholding rigidity affects chatter and deflection. Rigid fixtures and between-centers setups minimize compliance; soft jaws and standard chucks introduce more vibration tendency.">Workholding</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {(
                  (form.machine_type === "lathe" || form.machine_type === "mill_turn")
                  ? ([
                      { key: "3_jaw_chuck",     label: "3-Jaw Chuck"      },
                      { key: "4_jaw_chuck",     label: "4-Jaw Chuck"      },
                      { key: "collet_chuck",    label: "Collet Chuck"     },
                      { key: "between_centers", label: "Between Centers"  },
                      { key: "face_plate",      label: "Face Plate"       },
                      { key: "soft_jaws",       label: "Soft Jaws"        },
                    ] as const)
                  : form.machine_type === "hmc"
                  ? ([
                      { key: "rigid_fixture", label: "Rigid Fixture" },
                      { key: "tombstone",     label: "Tombstone"     },
                      { key: "dovetail",      label: "Dovetail"      },
                      { key: "vise",          label: "Vise"          },
                      { key: "soft_jaws",     label: "Soft Jaws"     },
                    ] as const)
                  : form.machine_type === "5axis"
                  ? ([
                      { key: "rigid_fixture", label: "Rigid Fixture"  },
                      { key: "5th_axis_vise", label: "5th-Axis Vise"  },
                      { key: "dovetail",      label: "Dovetail"       },
                      { key: "vise",          label: "Vise"           },
                      { key: "soft_jaws",     label: "Soft Jaws"      },
                    ] as const)
                  : /* vmc default */ ([
                      { key: "rigid_fixture", label: "Rigid Fixture"  },
                      { key: "5th_axis_vise", label: "5th-Axis Vise"  },
                      { key: "dovetail",      label: "Dovetail"       },
                      { key: "vise",          label: "Vise"           },
                      { key: "toe_clamps",    label: "Toe Clamps"     },
                      { key: "soft_jaws",     label: "Soft Jaws"      },
                    ] as const)
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, workholding: key }))}
                    className="rounded px-2.5 py-1 text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: form.workholding === key ? "#a855f7" : "transparent",
                      borderColor: "#a855f7",
                      color: form.workholding === key ? "#fff" : "#a855f7",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          {!engMode && !skuLocked && !pdfExtracted && (
            <div className="mb-2">
              <p className="text-xs text-amber-400">
                {operation === "milling"
                  ? "Enter a Core Cutter EDP# or upload a CC print PDF to run the calculator."
                  : "Upload a CC print PDF to run the calculator."}
              </p>
              <button
                type="button"
                onClick={() => { setShowContactModal(true); setContactStatus("idle"); }}
                className="mt-1 text-xs text-zinc-400 hover:text-orange-400 underline underline-offset-2 transition-colors"
              >
                Not sure which tool? Contact us →
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              className="w-full transition-all"
              onClick={run}
              disabled={mentor.isPending || (!engMode && !skuLocked && !pdfExtracted)}
              style={formDirty && (engMode || skuLocked || pdfExtracted) ? { boxShadow: "0 0 0 2px #f97316", borderColor: "#f97316" } : {}}
            >
              {mentor.isPending ? "Running…" : formDirty ? "⟳ Inputs changed — Re-run CoreCutCNC" : "Run CoreCutCNC"}
            </Button>
            <Button
              variant="secondary"
              onClick={resetAll}
              disabled={mentor.isPending}
            >
              Clear
            </Button>
          </div>

          {runWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
              <p className="font-semibold mb-1">Please fill in the following before running:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {runWarnings.map(w => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}
          {!runWarnings.length && mentor.error ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
              <p className="font-semibold mb-1">Something went wrong — check your inputs:</p>
              <p>{(mentor.error as any)?.message || "Unknown error"}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* RIGHT — OUTPUT + STABILITY */}
      <div className="flex flex-col gap-4">

      {/* OUTPUT CARD */}
      <Card className="rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recommendation</CardTitle>
            {customer && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => copyCamParams()}
                  className="text-[10px] font-semibold px-2 py-1 rounded border transition-colors leading-tight whitespace-nowrap"
                  style={camCopied
                    ? { borderColor: "#22c55e", background: "#14532d", color: "#86efac" }
                    : { borderColor: "#6366f1", background: "#1e1b4b", color: "#a5b4fc" }}
                >
                  {camCopied ? "✓ Copied!" : "📋 Copy Setup Sheet"}
                </button>
                <button
                  type="button"
                  onClick={() => printSummary()}
                  className="text-[10px] font-semibold px-2 py-1 rounded border border-orange-500/60 text-orange-400 hover:bg-orange-500/15 transition-colors leading-tight whitespace-nowrap"
                >
                  Print PDF
                </button>
                <button
                  type="button"
                  onClick={() => requireEmail("pdf")}
                  className="text-[10px] font-semibold px-2 py-1 rounded border border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/15 transition-colors leading-tight whitespace-nowrap"
                >
                  ⬇ PDF
                </button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!customer ? (
            <div className="text-sm text-muted-foreground">
              Run Mentor to see recommendations.
            </div>
          ) : threadResult ? (
            /* ── THREAD MILLING OUTPUT ───────────────────────────── */
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Kpi label="RPM"           hint="Spindle speed for thread milling, based on target SFM at the cutter OD." value={fmtInt(threadResult.rpm)} />
                <Kpi label="SFM"           hint="Surface Feet per Minute at the cutter OD. Thread form engagement reduces SFM target vs. flat milling." value={fmtNum(threadResult.sfm, 0)} />
                <Kpi label="Feed (IPM)"    hint="Table feed rate. Scales with number of thread rows — each row cuts simultaneously, increasing effective feed." value={fmtNum(threadResult.feed_ipm, 2)} />
                <Kpi label="FPT"           hint="Feed per tooth per row. Reduced ~20% from base milling chip load due to thread form engagement." value={threadResult.fpt.toFixed(6)} />
                <Kpi label="Radial Passes" hint="Number of radial passes to reach full thread depth. Coarser pitch, harder material, and tight-class threads require more passes." value={String(threadResult.radial_passes)} />
                <Kpi label="DOC / Pass"    hint="Radial depth of cut per pass — thread depth divided by pass count." value={`${threadResult.doc_per_pass_in.toFixed(5)}"`} />
              </div>

              {/* Thread Geometry card */}
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2.5">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Thread Geometry</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div><span className="text-zinc-500">TPI</span><span className="ml-2 font-semibold text-foreground">{threadResult.tpi % 1 === 0 ? threadResult.tpi : threadResult.tpi.toFixed(2)}</span></div>
                  <div><span className="text-zinc-500">Pitch</span><span className="ml-2 font-semibold text-foreground">{threadResult.pitch_in.toFixed(5)}"</span></div>
                  <div><span className="text-zinc-500">Thread Depth</span><span className="ml-2 font-semibold text-foreground">{threadResult.thread_depth_in.toFixed(5)}"</span></div>
                  <div><span className="text-zinc-500">Minor Dia</span><span className="ml-2 font-semibold text-foreground">{threadResult.minor_dia_in.toFixed(5)}"</span></div>
                  <div><span className="text-zinc-500">Pitch Dia</span><span className="ml-2 font-semibold text-foreground">{threadResult.pitch_dia_in.toFixed(5)}"</span></div>
                  <div>
                    <span className="text-zinc-500">{threadResult.internal ? "Internal" : "External"}</span>
                    <span className="ml-2 text-zinc-500">·</span>
                    <span className="ml-2 text-zinc-500">{threadResult.hand === "right" ? "RH" : "LH"}</span>
                    {threadResult.is_tapered && <span className="ml-2 text-sky-400 font-semibold">Tapered</span>}
                  </div>
                </div>
              </div>

              {/* Pass Strategy card */}
              {(() => {
                const n = threadResult.radial_passes;
                const docEa = threadResult.doc_per_pass_in;
                // Derive why reasons from pitch and inputs
                const pitch = threadResult.pitch_in;
                const reasons: string[] = [];
                if (pitch >= 0.100)       reasons.push("very coarse pitch (TPI ≤ 10)");
                else if (pitch >= 0.0625) reasons.push("coarse pitch (TPI ≤ 16)");
                const mat = form.material.toLowerCase();
                const isInconelTi = ["inconel","titanium","hastelloy","waspaloy","monel","mp35n","hiTemp"].some(k => mat.includes(k));
                const isStainless = mat.includes("stainless");
                if (isInconelTi)  reasons.push("Inconel / titanium — 3 passes minimum for tool life (reduces heat and edge load per pass)");
                else if (isStainless) reasons.push("stainless — work-hardens, needs light finishing cut");
                if (form.thread_neck_length > 0) reasons.push("necked tool — reduced rigidity");
                // Build pass rows using per-pass DOCs from engine (variable split), fall back to equal
                const perPassDocs: number[] = (threadResult.pass_docs && threadResult.pass_docs.length === n)
                  ? threadResult.pass_docs
                  : Array(n).fill(docEa);
                const passes = Array.from({ length: n }, (_, i) => ({
                  label: n === 1 ? "Pass 1 (single-pass finish)" : i < n - 1 ? `Pass ${i + 1} (roughing)` : `Pass ${n} (finish)`,
                  doc: perPassDocs[i],
                }));
                return (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2.5 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Radial Pass Strategy</p>
                      <span className="text-muted-foreground font-medium">{n} pass{n > 1 ? "es" : ""}{threadResult.spring_pass ? " + spring" : ""}</span>
                    </div>
                    {reasons.length > 0 && (
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        <span className="text-zinc-500">Why: </span>{reasons.join(", ")}.
                      </p>
                    )}
                    <div className="space-y-1">
                      {passes.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">{p.label}</span>
                          <span className="font-medium text-foreground tabular-nums">{p.doc.toFixed(5)}" DOC</span>
                        </div>
                      ))}
                      {threadResult.spring_pass && (
                        <div className="flex items-center justify-between text-[11px] text-indigo-300">
                          <span>Spring pass (repeat pass {n} at same offset)</span>
                          <span className="font-medium tabular-nums">{docEa.toFixed(5)}" DOC</span>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Total thread depth: <span className="text-foreground font-medium">{threadResult.thread_depth_in.toFixed(5)}"</span>
                      {threadResult.finish_pass_frac != null && n > 1 && (
                        <span> · finish pass = <span className="text-foreground font-medium">{Math.round(threadResult.finish_pass_frac * 100)}%</span> of depth</span>
                      )}
                    </p>
                  </div>
                );
              })()}

              {/* Deflection indicator */}
              {(() => {
                const pct = threadResult.deflection_pct;
                const cfg = pct < 100
                  ? { border: "border-emerald-500/50", bg: "bg-emerald-500/10", bar: "bg-emerald-500", text: "text-emerald-300", label: "OK" }
                  : pct < 175
                  ? { border: "border-amber-500/50",  bg: "bg-amber-500/10",  bar: "bg-amber-500",  text: "text-amber-300",  label: "CAUTION" }
                  : { border: "border-red-500/50",     bg: "bg-red-500/10",     bar: "bg-red-500",     text: "text-red-300",     label: "WARNING" };
                const limitIn = threadResult.deflection_pct > 0 ? (threadResult.deflection_in / (threadResult.deflection_pct / 100)) : 0;
                return (
                  <div className={`rounded-lg border ${cfg.border} ${cfg.bg} px-3 py-2 text-xs`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Tool Deflection</span>
                      <span className={`font-bold ${cfg.text}`}>{cfg.label} — {pct.toFixed(0)}% of limit</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-zinc-700">
                      <div className={`h-1.5 rounded-full ${cfg.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <p className="mt-1 text-muted-foreground">{threadResult.deflection_in.toFixed(6)}" deflection · limit {limitIn.toFixed(6)}"</p>
                  </div>
                );
              })()}

              {/* Stability suggestions */}
              {(() => {
                const pct = threadResult.deflection_pct;
                if (pct < 100) return null;
                const isRed = pct >= 175;
                const border = isRed ? "border-red-500/40" : "border-amber-500/40";
                const bg     = isRed ? "bg-red-500/10"     : "bg-amber-500/10";
                const hdr    = isRed ? "text-red-400"       : "text-amber-400";
                const txt    = isRed ? "text-red-300"       : "text-amber-200";
                const suggestions: string[] = [];
                if (form.stickout > 0) suggestions.push(`Reduce stickout — current ${form.stickout.toFixed(3)}". Deflection scales with length³; even 10% less stickout cuts force ~27%.`);
                if (form.thread_neck_length === 0) suggestions.push("Add a neck — a necked thread mill lets you shorten the cutting engagement length while reaching full depth.");
                suggestions.push(`Increase radial passes — currently ${threadResult.radial_passes}. More passes = smaller DOC per pass = less radial force per pass.`);
                if (form.tool_dia < form.thread_major_dia * 0.55) suggestions.push("Use a larger cutter diameter — bigger shank = higher second moment of area (I = πd⁴/64), dramatically stiffer.");
                return (
                  <div className={`rounded-lg border ${border} ${bg} px-3 py-2.5 text-xs space-y-2`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${hdr}`}>
                      {isRed ? "⚠ High Deflection — Action Recommended" : "Deflection Caution — Review Setup"}
                    </p>
                    <ol className={`list-decimal list-inside space-y-1 ${txt}`}>
                      {suggestions.map((s, i) => <li key={i} className="leading-relaxed">{s}</li>)}
                    </ol>
                  </div>
                );
              })()}

              {/* Spring pass note */}
              {threadResult.spring_pass && (
                <div className="rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
                  Class {form.thread_class}: <span className="font-semibold">Spring pass recommended</span> — repeat the final radial pass at the same offset to achieve consistent thread accuracy.
                </div>
              )}

              {/* Engine notes / warnings */}
              {threadResult.notes.length > 0 && (
                <div className="space-y-1.5">
                  {threadResult.notes.map((note: string, i: number) => (
                    <div key={i} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      ⚠ {note}
                    </div>
                  ))}
                </div>
              )}

              {/* G-Code section */}
              <div className="rounded-xl border-2 border-indigo-500 bg-indigo-500/10 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wide">
                    G-Code — {form.thread_gcode_dialect === "siemens" ? "Siemens 840D" : "Fanuc / Haas"} · {form.thread_cut_direction === "bottom_up" ? "Bottom-Up" : "Top-Down"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTmGcodeExpanded((v) => !v)}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded border border-indigo-400/50 text-indigo-300 hover:bg-indigo-500/10 transition-colors"
                    >
                      {tmGcodeExpanded ? "Hide" : "Show G-Code"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(threadResult.gcode).then(() => {
                          toast({ title: "G-Code copied", description: "Paste into your CNC program editor." });
                        });
                      }}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded border border-indigo-400/50 text-indigo-300 hover:bg-indigo-500/10 transition-colors"
                    >
                      Copy G-Code
                    </button>
                  </div>
                </div>
                {tmGcodeExpanded && (
                  <pre className="overflow-x-auto rounded bg-zinc-900 p-3 text-[11px] font-mono text-emerald-300 whitespace-pre max-h-72 overflow-y-auto">
                    {threadResult.gcode}
                  </pre>
                )}
              </div>

              {/* Core Cutter Recommends — thread mill quote card (Engineering Mode only) */}
              {engMode && (() => {
                const matLabel = ISO_SUBCATEGORIES.find(s => s.key === form.material)?.label ?? form.material ?? "?";
                const cr = getCoatingRec(isoCategory);
                const tpiLabel = form.thread_tpi
                  ? `× ${form.thread_tpi} TPI`
                  : form.thread_pitch_mm
                  ? `× ${form.thread_pitch_mm} mm pitch`
                  : "";
                return (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500/70 mb-0.5">Core Cutter Recommends</p>
                        <p className="font-semibold text-foreground text-sm">Custom Thread Mill — Built to Order</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setTmQuoteSent(false); setShowTmQuote(true); }}
                        className="shrink-0 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-colors"
                      >
                        Request Quote
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                      <div><span className="text-zinc-500">Thread</span><span className="ml-2 font-medium text-foreground">{form.thread_standard.toUpperCase()} {form.thread_major_dia > 0 ? `ø${form.thread_major_dia.toFixed(4)}"` : "—"} {tpiLabel}</span></div>
                      <div><span className="text-zinc-500">Class / Hand</span><span className="ml-2 font-medium text-foreground">{form.thread_class} · {form.thread_hand === "right" ? "RH" : "LH"}</span></div>
                      <div><span className="text-zinc-500">Int / Ext</span><span className="ml-2 font-medium text-foreground">{form.thread_internal ? "Internal" : "External"}</span></div>
                      <div><span className="text-zinc-500">Cutter Dia</span><span className="ml-2 font-medium text-foreground">{form.tool_dia > 0 ? `${form.tool_dia.toFixed(4)}"` : "—"}</span></div>
                      <div><span className="text-zinc-500">Flutes</span><span className="ml-2 font-medium text-foreground">{form.flutes}</span></div>
                      <div><span className="text-zinc-500">Thread Profiles</span><span className="ml-2 font-medium text-foreground">{form.thread_rows}</span></div>
                      <div><span className="text-zinc-500">Reach / Neck</span><span className="ml-2 font-medium text-foreground">{form.thread_neck_length > 0 ? `${form.thread_neck_length.toFixed(3)}"` : "None"}</span></div>
                      <div><span className="text-zinc-500">Material</span><span className="ml-2 font-medium text-foreground">{matLabel}</span></div>
                      <div><span className="text-zinc-500">Recommended Coating</span><span className="ml-2 font-bold text-orange-400">{cr.code}</span></div>
                    </div>
                  </div>
                );
              })()}

              {/* Thread Mill quote modal */}
              {showTmQuote && (() => {
                const qf = quoteForm;
                const setQf = (patch: Partial<typeof quoteForm>) => setQuoteForm(p => ({ ...p, ...patch }));
                const matLabel = ISO_SUBCATEGORIES.find(s => s.key === form.material)?.label ?? form.material ?? "?";
                const spec = {
                  thread_standard: form.thread_standard.toUpperCase(),
                  major_dia: form.thread_major_dia > 0 ? `${form.thread_major_dia.toFixed(4)}"` : "?",
                  tpi: form.thread_tpi ? String(form.thread_tpi) : "—",
                  pitch_mm: form.thread_pitch_mm ? `${form.thread_pitch_mm} mm` : "—",
                  thread_class: form.thread_class,
                  hand: form.thread_hand === "right" ? "RH" : "LH",
                  int_ext: form.thread_internal ? "Internal" : "External",
                  cutter_dia: form.tool_dia > 0 ? `${form.tool_dia.toFixed(4)}"` : "?",
                  thread_profiles: String(form.thread_rows),
                  neck_length: form.thread_neck_length > 0 ? `${form.thread_neck_length.toFixed(3)}"` : "None",
                  material: matLabel,
                  coating: getCoatingRec(isoCategory).code,
                };
                const handleSubmit = async (e: React.FormEvent) => {
                  e.preventDefault();
                  if (!qf.name || !qf.email) return;
                  setTmQuoteSending(true);
                  try {
                    const r = await fetch("/api/quote/threadmill", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ customer: qf, spec }),
                    });
                    if (r.ok) {
                      setTmQuoteSent(true);
                    } else {
                      const d = await r.json().catch(() => ({}));
                      toast({ title: "Submission failed", description: d.message || "Please try again.", variant: "destructive" });
                    }
                  } catch {
                    toast({ title: "Network error", description: "Could not reach server.", variant: "destructive" });
                  } finally {
                    setTmQuoteSending(false);
                  }
                };
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowTmQuote(false)}>
                    <div className="relative w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => setShowTmQuote(false)} className="absolute top-3 right-3 text-zinc-400 hover:text-white text-lg leading-none">✕</button>

                      {tmQuoteSent ? (
                        <div className="py-8 text-center space-y-3">
                          <div className="text-4xl">✓</div>
                          <p className="font-semibold text-emerald-400">Quote Request Sent</p>
                          <p className="text-xs text-zinc-400">The Core Cutter team at <span className="text-zinc-200">sales@corecutterusa.com</span> will follow up shortly.</p>
                          <button type="button" onClick={() => setShowTmQuote(false)} className="mt-2 rounded-lg bg-zinc-700 px-5 py-1.5 text-xs font-semibold hover:bg-zinc-600 transition-colors">Close</button>
                        </div>
                      ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                          <h2 className="font-semibold text-sm text-foreground">Request Custom Thread Mill Quote</h2>

                          <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-xs space-y-1 text-zinc-300">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Thread Mill Spec</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                              <span className="text-zinc-500">Standard</span><span>{spec.thread_standard}</span>
                              <span className="text-zinc-500">Major Dia</span><span>{spec.major_dia}</span>
                              {form.thread_standard === "metric"
                                ? <><span className="text-zinc-500">Pitch</span><span>{spec.pitch_mm}</span></>
                                : <><span className="text-zinc-500">TPI</span><span>{spec.tpi}</span></>}
                              <span className="text-zinc-500">Class / Hand</span><span>{spec.thread_class} · {spec.hand}</span>
                              <span className="text-zinc-500">Int / Ext</span><span>{spec.int_ext}</span>
                              <span className="text-zinc-500">Cutter Dia</span><span>{spec.cutter_dia}</span>
                              <span className="text-zinc-500">Thread Profiles</span><span>{spec.thread_profiles}</span>
                              <span className="text-zinc-500">Neck Length</span><span>{spec.neck_length}</span>
                              <span className="text-zinc-500">Material</span><span>{spec.material}</span>
                              <span className="text-zinc-500">Coating</span><span className="font-bold text-orange-400">{spec.coating}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Name <span className="text-red-400">*</span></label>
                              <input required value={qf.name} onChange={e => setQf({ name: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="Your name" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Company</label>
                              <input value={qf.company} onChange={e => setQf({ company: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="Company name" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Phone</label>
                              <input value={qf.phone} onChange={e => setQf({ phone: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="(555) 000-0000" />
                            </div>
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Email <span className="text-red-400">*</span></label>
                              <input required type="email" value={qf.email} onChange={e => setQf({ email: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="you@company.com" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Quantity</label>
                              <input value={qf.qty} onChange={e => setQf({ qty: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="e.g. 5" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Tolerance</label>
                              <input value={qf.tolerance} onChange={e => setQf({ tolerance: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="e.g. 2B, 6H" />
                            </div>
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Notes</label>
                              <textarea value={qf.notes} onChange={e => setQf({ notes: e.target.value })} rows={2} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none" placeholder="Coating, shank style, special profile, drawing notes…" />
                            </div>
                          </div>

                          <button type="submit" disabled={tmQuoteSending || !qf.name || !qf.email} className="w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            {tmQuoteSending ? "Sending…" : "Send Quote Request to Core Cutter"}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          ) : reamResult ? (
            /* ── REAMING OUTPUT ──────────────────────────────────── */
            <>
              {/* KPI grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Kpi label="RPM"          hint="Spindle speed for reaming. Significantly lower than drilling — typically 50–65% of the equivalent drill speed to maintain surface finish and dimensional accuracy." value={fmtInt(reamResult.rpm)} />
                <Kpi label="SFM"          hint="Surface Feet per Minute for the reamer. Conservative SFM protects the cutting edge and ensures consistent hole geometry. For step reamers, based on the largest diameter." value={fmtNum(reamResult.sfm, 0)} />
                <Kpi label="Feed (IPM)"   hint="Table feed rate in inches per minute for reaming. Reaming uses higher IPR (feed per rev) than drilling — sufficient feed is critical to prevent rubbing and built-up edge." value={fmtNum(reamResult.ipm, 3)} />
                <Kpi label="IPR"          hint="Inches Per Revolution for reaming — the key parameter for hole quality. Too light causes rubbing and poor finish; too heavy risks bell-mouthing and size overrun. The engine targets 0.001–0.003 in stock removal per side." value={reamResult.ipr?.toFixed(5) ?? "—"} />
                <Kpi label="HP Required"  hint="Estimated cutting power for reaming. Much lower than drilling since the reamer removes only a thin stock layer (0.002–0.006 in total). HP scales with reamer diameter and material." value={fmtNum(reamResult.hp_required, 2)} />
                <Kpi label="Depth / D"    hint="Hole depth as a multiple of reamer diameter. Deep reamers (above 3×D) are prone to deflection and chatter — consider a longer-shank reamer or guide bushing above 5×D." value={`${fmtNum(reamResult.depth_xd, 1)}×`} />
              </div>

              {/* Coating recommendation */}
              {(() => { const cr = getCoatingRec(isoCategory); return (
                <div className="flex items-center gap-2 px-1 text-xs">
                  <span className="text-muted-foreground">Recommended Coating:</span>
                  <span className="font-bold text-orange-400">{cr.code}</span>
                  <span className="text-muted-foreground">— optimized for {cr.desc}</span>
                </div>
              ); })()}

              {/* Step reamer note */}
              {reamResult.largest_dia != null && reamResult.entry_dia != null && reamResult.largest_dia !== reamResult.entry_dia && (
                <div className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
                  Step reamer — SFM on ø{reamResult.largest_dia.toFixed(4)}" (largest) · Feed (IPR) on ø{reamResult.entry_dia.toFixed(4)}" (entry)
                </div>
              )}

              {/* Stock allowance card */}
              {(() => {
                const stockColor =
                  reamResult.stock_status === "ok"        ? { border: "border-emerald-500/50", bg: "bg-emerald-500/10", text: "text-emerald-300", badge: "bg-emerald-500/20 text-emerald-300" }
                  : reamResult.stock_status === "low"     ? { border: "border-amber-500/50",  bg: "bg-amber-500/10",  text: "text-amber-300",  badge: "bg-amber-500/20  text-amber-300"  }
                  : reamResult.stock_status === "high"    ? { border: "border-orange-500/50",  bg: "bg-orange-500/10",  text: "text-orange-300",  badge: "bg-orange-500/20  text-orange-300"  }
                  : reamResult.stock_status === "excessive"? { border: "border-red-500/50",    bg: "bg-red-500/10",     text: "text-red-300",     badge: "bg-red-500/20     text-red-300"     }
                  :                                         { border: "border-zinc-600",       bg: "bg-zinc-800/40",    text: "text-zinc-300",    badge: "bg-zinc-700      text-zinc-300"    };
                return (
                  <div className={`rounded-lg border ${stockColor.border} ${stockColor.bg} px-3 py-2.5 text-xs space-y-1`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">Stock Allowance</span>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${stockColor.badge}`}>
                        {reamResult.stock_status.toUpperCase()}
                      </span>
                    </div>
                    {reamResult.stock_per_side_in != null && reamResult.stock_total_in != null && (
                      <p className={stockColor.text}>
                        {reamResult.stock_per_side_in.toFixed(4)}" per side · {reamResult.stock_total_in.toFixed(4)}" total diametral
                      </p>
                    )}
                    <p className="text-muted-foreground">
                      Ideal: {reamResult.stock_ideal_in.toFixed(4)}" total · Range: {reamResult.stock_min_in.toFixed(4)}"–{reamResult.stock_max_in.toFixed(4)}"
                    </p>
                    {reamResult.stock_warning && (
                      <p className={`font-medium ${stockColor.text}`}>⚠ {reamResult.stock_warning}</p>
                    )}
                  </div>
                );
              })()}

              {/* Depth status */}
              {(() => {
                const depthColor =
                  reamResult.depth_status === "ok"      ? { border: "border-emerald-500/50", bg: "bg-emerald-500/10", text: "text-emerald-300" }
                  : reamResult.depth_status === "caution"? { border: "border-amber-500/50",  bg: "bg-amber-500/10",  text: "text-amber-300"  }
                  :                                        { border: "border-red-500/50",      bg: "bg-red-500/10",     text: "text-red-300"     };
                return (
                  <div className={`rounded-lg border ${depthColor.border} ${depthColor.bg} px-3 py-2 text-xs`}>
                    <span className="font-semibold text-foreground">Hole Depth: </span>
                    <span className={depthColor.text}>{reamResult.depth_xd.toFixed(1)}×D</span>
                    {reamResult.depth_note && (
                      <p className={`mt-0.5 ${depthColor.text}`}>{reamResult.depth_note}</p>
                    )}
                  </div>
                );
              })()}

              {/* Confidence score + risk flags */}
              {(() => {
                const confColor =
                  reamResult.confidence === "green"  ? { border: "border-emerald-500/50", bg: "bg-emerald-500/10", text: "text-emerald-300", label: "Setup Optimized — Good to Go"  }
                  : reamResult.confidence === "yellow"? { border: "border-amber-500/50",  bg: "bg-amber-500/10",  text: "text-amber-300",  label: "Tool Optimization Suggestion(s)"    }
                  : reamResult.confidence === "orange"? { border: "border-orange-500/50",  bg: "bg-orange-500/10",  text: "text-orange-300",  label: "Tool Optimization Suggestion(s)"  }
                  :                                     { border: "border-red-500/50",      bg: "bg-red-500/10",     text: "text-red-300",     label: "Setup Needs Attention"        };
                return (
                  <div className={`rounded-lg border ${confColor.border} ${confColor.bg} px-3 py-2.5 text-xs space-y-1.5`}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{confColor.label}</span>
                    </div>
                    {reamResult.risk_flags.length > 0 && (
                      <ul className="list-none space-y-1 mt-0.5">
                        {reamResult.risk_flags.map((flag: string, i: number) => (
                          <li key={i} className={`flex gap-1.5 ${confColor.text}`}>
                            <span className="shrink-0">💡</span>
                            <span>{flag}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}

              {/* Quality Considerations — finish + straightness */}
              {(reamResult.finish_risk || reamResult.straightness_risk) && (() => {
                const dotColor = (r: string) =>
                  r === "green"  ? "bg-emerald-400"
                  : r === "yellow" ? "bg-amber-400"
                  : r === "orange" ? "bg-orange-400"
                  : "bg-red-400";
                return (
                  <div className="rounded-lg border border-zinc-600 bg-zinc-800/40 px-3 py-2.5 text-xs space-y-3">
                    <p className="font-semibold text-foreground uppercase tracking-wide text-[10px]">Hole Quality Considerations</p>

                    {/* Surface finish section */}
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 inline-block h-2 w-2 rounded-full flex-shrink-0 ${dotColor(reamResult.finish_risk ?? "green")}`} />
                      <div className="space-y-1">
                        <div className="font-semibold text-foreground">Surface Finish</div>
                        {reamResult.finish_ra_base_min != null && reamResult.finish_ra_base_max != null && (
                          <div className="text-zinc-400">
                            Expected: {reamResult.finish_ra_base_min}–{reamResult.finish_ra_base_max} μin under good conditions
                          </div>
                        )}
                        {reamResult.finish_notes && reamResult.finish_notes.length > 0 && (
                          <ul className="list-disc list-inside space-y-0.5 text-zinc-400">
                            {reamResult.finish_notes.map((n: string, i: number) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    {/* Straightness section */}
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 inline-block h-2 w-2 rounded-full flex-shrink-0 ${dotColor(reamResult.straightness_risk ?? "green")}`} />
                      <div className="space-y-1">
                        <div className="font-semibold text-foreground">Hole Straightness</div>
                        {reamResult.straightness_notes && reamResult.straightness_notes.length > 0 && (
                          <ul className="list-disc list-inside space-y-0.5 text-zinc-400">
                            {reamResult.straightness_notes.map((n: string, i: number) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Recommended Reamer + Quote CTA — combined card */}
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500/70 mb-0.5">Core Cutter Recommends</p>
                    <p className="font-semibold text-foreground text-sm">Custom Reamer — Built to Order</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setQuoteSent(false); setShowQuote(true); }}
                    className="shrink-0 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-colors"
                  >
                    Request Quote
                  </button>
                </div>

                {/* Flute configuration — full width, no wrap */}
                {reamResult.helix_rec && (
                  <div className="text-[11px]">
                    <span className="text-zinc-500">Flute Configuration</span>
                    <span className="ml-2 font-medium text-foreground whitespace-nowrap">{reamResult.helix_rec}</span>
                  </div>
                )}

                {/* Spec grid */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                  <div><span className="text-zinc-500">Cutting Diameter</span><span className="ml-2 font-medium text-foreground">{form.tool_dia ? `${form.tool_dia.toFixed(4)}"` : "—"}</span></div>
                  <div><span className="text-zinc-500">Flutes</span><span className="ml-2 font-medium text-foreground">{form.flutes || reamFlutes(form.tool_dia)}</span></div>
                  {reamResult.coating_rec && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-500">Coating</span>
                      <span className="font-medium text-foreground ml-2">{reamResult.coating_rec}</span>
                      {reamResult.iso_category && (
                        <span className="rounded bg-zinc-700 px-1 py-0.5 text-[9px] font-bold text-zinc-300">ISO {reamResult.iso_category}</span>
                      )}
                    </div>
                  )}
                  <div><span className="text-zinc-500">Shank Dia</span><span className="ml-2 font-medium text-foreground">{form.ream_shank_dia ? `${form.ream_shank_dia.toFixed(4)}"` : form.tool_dia ? `${form.tool_dia.toFixed(4)}" (= cut dia)` : "—"}</span></div>
                  <div><span className="text-zinc-500">Flute Length</span><span className="ml-2 font-medium text-foreground">{form.ream_hole_depth ? `${form.ream_hole_depth.toFixed(3)}"` : "—"}</span></div>
                  <div><span className="text-zinc-500">Hole Type</span><span className="ml-2 font-medium text-foreground">{form.ream_blind ? "Blind" : "Through"}</span></div>
                  <div><span className="text-zinc-500">Coolant Thru</span><span className="ml-2 font-medium text-foreground">{form.ream_coolant_fed ? "Yes — coolant-through shank" : "No — standard shank"}</span></div>
                  {reamResult.tool_life_lo != null && reamResult.tool_life_hi != null && (
                    <div className="col-span-2">
                      <span className="text-zinc-500">Est. Tool Life</span>
                      <span className="ml-2 font-medium text-foreground">{reamResult.tool_life_lo}–{reamResult.tool_life_hi} holes typical</span>
                      <span className="ml-2 text-zinc-500 text-[10px]">varies with runout, pre-drill accuracy & coolant — estimate only, not a guarantee from Core Cutter</span>
                    </div>
                  )}
                </div>

                {/* Helix rationale — hand direction + angle reason */}
                {(reamResult.helix_note || reamResult.helix_angle_note) && (
                  <div className="space-y-1">
                    {reamResult.helix_note && (
                      <p className="text-zinc-400 text-[11px] leading-relaxed">{reamResult.helix_note}</p>
                    )}
                    {reamResult.helix_angle_note && (
                      <p className="text-zinc-300 text-[11px] leading-relaxed">{reamResult.helix_angle_note}</p>
                    )}
                  </div>
                )}

                {/* Helix warnings */}
                {reamResult.helix_warnings && reamResult.helix_warnings.length > 0 && (
                  <ul className="list-disc list-inside space-y-0.5 text-amber-300 text-[11px]">
                    {reamResult.helix_warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Quote modal */}
              {showQuote && (() => {
                const qf = quoteForm;
                const setQf = (patch: Partial<typeof quoteForm>) => setQuoteForm(p => ({ ...p, ...patch }));
                const matLabel = ISO_SUBCATEGORIES.find(s => s.key === form.material)?.label ?? form.material ?? "?";
                const spec = {
                  diameter: form.tool_dia ? `${form.tool_dia.toFixed(4)}"` : "?",
                  shank_dia: form.ream_shank_dia ? `${form.ream_shank_dia.toFixed(4)}"` : form.tool_dia ? `${form.tool_dia.toFixed(4)}" (= cut dia)` : "?",
                  flutes: form.flutes ? String(form.flutes) : "?",
                  depth: form.ream_hole_depth ? `${form.ream_hole_depth.toFixed(4)}"` : "?",
                  hole_type: form.ream_blind ? "Blind" : "Through",
                  helix: reamResult?.helix_rec ?? "?",
                  coating: reamResult?.coating_rec ?? "?",
                  coolant_thru: form.ream_coolant_fed ? "Yes — coolant-through shank" : "No — standard shank",
                  material: matLabel,
                  pre_drill: form.ream_pre_drill_dia ? `${form.ream_pre_drill_dia.toFixed(4)}"` : "?",
                };
                const handleSubmit = async (e: React.FormEvent) => {
                  e.preventDefault();
                  if (!qf.name || !qf.email) return;
                  setQuoteSending(true);
                  try {
                    const r = await fetch("/api/quote/reamer", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ customer: qf, spec }),
                    });
                    if (r.ok) {
                      setQuoteSent(true);
                    } else {
                      const d = await r.json().catch(() => ({}));
                      toast({ title: "Submission failed", description: d.message || "Please try again.", variant: "destructive" });
                    }
                  } catch {
                    toast({ title: "Network error", description: "Could not reach server.", variant: "destructive" });
                  } finally {
                    setQuoteSending(false);
                  }
                };
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowQuote(false)}>
                    <div className="relative w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => setShowQuote(false)} className="absolute top-3 right-3 text-zinc-400 hover:text-white text-lg leading-none">✕</button>

                      {quoteSent ? (
                        <div className="py-8 text-center space-y-3">
                          <div className="text-4xl">✓</div>
                          <p className="font-semibold text-emerald-400">Quote Request Sent</p>
                          <p className="text-xs text-zinc-400">The Core Cutter team at <span className="text-zinc-200">sales@corecutterusa.com</span> will follow up shortly.</p>
                          <button type="button" onClick={() => setShowQuote(false)} className="mt-2 rounded-lg bg-zinc-700 px-5 py-1.5 text-xs font-semibold hover:bg-zinc-600 transition-colors">Close</button>
                        </div>
                      ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                          <h2 className="font-semibold text-sm text-foreground">Request Custom Reamer Quote</h2>

                          {/* Spec summary */}
                          <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-xs space-y-1 text-zinc-300">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Reamer Spec</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                              <span className="text-zinc-500">Diameter</span><span>{spec.diameter}"</span>
                              <span className="text-zinc-500">Flutes</span><span>{spec.flutes}</span>
                              <span className="text-zinc-500">Hole Depth</span><span>{spec.depth}"</span>
                              <span className="text-zinc-500">Hole Type</span><span>{spec.hole_type}</span>
                              <span className="text-zinc-500">Helix</span><span>{spec.helix}</span>
                              <span className="text-zinc-500">Coating</span><span>{spec.coating}</span>
                              <span className="text-zinc-500">Coolant</span><span>{spec.coolant_thru}</span>
                              <span className="text-zinc-500">Material</span><span>{spec.material}</span>
                            </div>
                          </div>

                          {/* Customer fields */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Name <span className="text-red-400">*</span></label>
                              <input required value={qf.name} onChange={e => setQf({ name: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="Your name" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Company</label>
                              <input value={qf.company} onChange={e => setQf({ company: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="Company name" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Phone</label>
                              <input value={qf.phone} onChange={e => setQf({ phone: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="(555) 000-0000" />
                            </div>
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Email <span className="text-red-400">*</span></label>
                              <input required type="email" value={qf.email} onChange={e => setQf({ email: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="you@company.com" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Quantity</label>
                              <input value={qf.qty} onChange={e => setQf({ qty: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="e.g. 5" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Tolerance Class</label>
                              <select value={qf.tolerance} onChange={e => setQf({ tolerance: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500">
                                <option>H6</option>
                                <option>H7</option>
                                <option>H8</option>
                                <option>Custom</option>
                              </select>
                            </div>
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Notes</label>
                              <textarea value={qf.notes} onChange={e => setQf({ notes: e.target.value })} rows={2} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none" placeholder="Tolerance, surface finish target, drawing notes…" />
                            </div>
                          </div>

                          <button type="submit" disabled={quoteSending || !qf.name || !qf.email} className="w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            {quoteSending ? "Sending…" : "Send Quote Request to Core Cutter"}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })()}

            </>
          ) : drillResult ? (
            /* ── DRILLING OUTPUT ─────────────────────────────────── */
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Kpi label="RPM"           hint="Spindle speed for this drill, based on target SFM for the material and drill diameter, capped at your Max RPM setting." value={fmtInt(drillResult.rpm)} />
                <Kpi label="SFM"           hint="Surface Feet per Minute at the drill OD. Primary driver of tool life and heat in drilling. For step drills, SFM is based on the largest (outer) diameter." value={fmtNum(drillResult.sfm, 0)} />
                <Kpi label="Feed (IPM)"    hint="Table feed rate in inches per minute. Equal to RPM × IPR. Applies to all diameters — entry and steps use the same IPM." value={fmtNum(drillResult.ipm, 2)} />
                <Kpi label="IPR"           hint="Inches Per Revolution — chip load for drilling. Scales with drill diameter (larger drills take heavier feeds). The engine applies a feed safety factor for depth and chip evacuation." value={drillResult.ipr?.toFixed(5) ?? "—"} />
                <Kpi label="MRR (in³/min)" hint="Material Removal Rate for drilling. Equal to (π/4 × D² × IPM) for a standard drill. Lower than milling MRR at equivalent HP due to the chisel edge inefficiency." value={fmtNum(drillResult.mrr_in3_min, 4)} />
                <Kpi label="HP Required"   hint="Cutting power for this drill derived from torque and RPM (HP = T × RPM / 63,025). Includes a depth factor that increases HP estimate for deeper holes due to chip evacuation resistance." value={fmtNum(drillResult.hp_required, 2)} />
                <Kpi label="Thrust (lbf)"  hint="Axial thrust force pushing the drill into the workpiece. High thrust stresses the drill point and workholding. Parabolic and high-helix drills reduce thrust vs standard geometry." value={fmtNum(drillResult.thrust_lbf, 0)} />
                <Kpi label="Torque (in-lbf)" hint="Twisting torque at the drill shank. Compared against your spindle taper's grip capacity. Excessive torque can cause drill spin-out in the holder — use a Weldon flat or drill chuck with torque ring for deep holes." value={fmtNum(drillResult.torque_inlbf, 1)} />
                <Kpi label="Depth / D"     hint="Hole depth expressed as a multiple of drill diameter. Below 3×D: standard cycle. 3–5×D: consider chip-breaking peck. Above 5×D: peck drilling recommended. Above 8×D: high-helix or parabolic flute strongly advised." value={`${fmtNum(drillResult.depth_to_dia, 1)}×`} />
              </div>

              {/* Coating recommendation */}
              {(() => { const cr = getCoatingRec(isoCategory); return (
                <div className="flex items-center gap-2 px-1 text-xs">
                  <span className="text-muted-foreground">Recommended Coating:</span>
                  <span className="font-bold text-orange-400">{cr.code}</span>
                  <span className="text-muted-foreground">— optimized for {cr.desc}</span>
                </div>
              ); })()}

              {/* Step drill note */}
              {drillResult.largest_dia != null && drillResult.entry_dia != null && drillResult.largest_dia !== drillResult.entry_dia && (
                <div className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
                  Step drill — SFM on ø{drillResult.largest_dia.toFixed(4)}" (largest) · Feed (IPR) on ø{drillResult.entry_dia.toFixed(4)}" (entry)
                </div>
              )}

              {/* Drill Stability Triangle */}
              {drillResult.drill_stability && (() => {
                const s = drillResult.drill_stability!;
                const cfg = (st: string) => st === "ok"
                  ? { border: "border-emerald-500/50", bg: "bg-emerald-500/10", badge: "bg-emerald-500/20 text-emerald-300", label: "OK" }
                  : st === "caution"
                  ? { border: "border-amber-500/50",  bg: "bg-amber-500/10",  badge: "bg-amber-500/20 text-amber-200",  label: "CAUTION" }
                  : { border: "border-red-500/50",     bg: "bg-red-500/10",     badge: "bg-red-500/20 text-red-300",        label: "WARNING" };
                return (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Drill Stability Triangle</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Feed",      status: s.feed_status,  sub: `${(s.feed_ratio * 100).toFixed(0)}% of min` },
                        { label: "Chip Evac", status: s.evac_status,  sub: drillResult.cycle },
                        { label: "Depth",     status: s.depth_status, sub: `${s.depth_xd}×D` },
                      ].map(({ label, status, sub }) => {
                        const c = cfg(status);
                        return (
                          <div key={label} className={`rounded-lg border ${c.border} ${c.bg} px-2 py-2.5 text-center`}>
                            <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${c.badge}`}>{c.label}</span>
                            <div className="mt-1.5 text-[10px] font-semibold text-foreground uppercase tracking-wide">{label}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Drill Design Advisor */}
              {drillResult.geometry_tip && (
                <div className="rounded-lg border border-sky-500/50 bg-sky-500/10 px-3 py-2.5 text-xs">
                  <p className="font-semibold text-sky-300 mb-0.5">Drill Design Advisor</p>
                  <p className="text-sky-100/80">{drillResult.geometry_tip}</p>
                </div>
              )}

              {/* G-code recommendation */}
              <div className="rounded-xl border-2 border-indigo-500 bg-indigo-500/10 p-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-extrabold text-indigo-400">{drillResult.cycle}</span>
                  <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wide">Recommended Cycle</span>
                </div>
                <p className="text-sm text-foreground">{drillResult.cycle_note}</p>
                {drillResult.peck_depth_in != null && (
                  <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Q (peck): <span className="font-semibold text-foreground">{drillResult.peck_depth_in.toFixed(4)}"</span></span>
                    <span>R (clearance): <span className="font-semibold text-foreground">{drillResult.r_plane_in.toFixed(3)}"</span></span>
                  </div>
                )}
              </div>

              {/* Pecking Optimizer — decreasing schedule for G83 */}
              {drillResult.peck_schedule != null && drillResult.peck_schedule.length > 0 && (
                <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2">
                  <p className="mb-1.5 text-xs font-semibold text-indigo-300 uppercase tracking-wide">Pecking Optimizer</p>
                  <p className="mb-2 text-xs text-muted-foreground">Chip column builds with depth — decrease peck size as you go deeper.</p>
                  <div className="flex flex-wrap gap-2">
                    {drillResult.peck_schedule.map((q: number, i: number) => (
                      <div key={i} className="flex flex-col items-center rounded bg-indigo-900/40 px-2 py-1">
                        <span className="text-[10px] text-indigo-400">Peck {i + 1}{i === drillResult.peck_schedule!.length - 1 ? "+" : ""}</span>
                        <span className="text-xs font-bold text-foreground">{q.toFixed(4)}"</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Critical chip thickness warning */}
              {drillResult.chip_warning && (
                <div className="rounded-lg border border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  ⚠ <span className="font-semibold">Critical Chip Thickness:</span> {drillResult.chip_warning}
                </div>
              )}

              {/* Flute length warning */}
              {drillResult.flute_warning && (
                <div className="rounded-lg border border-orange-500 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
                  ⚠ {drillResult.flute_warning}
                </div>
              )}

              {/* Core Cutter Recommends — drill quote card */}
              {(() => {
                const matLabel = ISO_SUBCATEGORIES.find(s => s.key === form.material)?.label ?? form.material ?? "?";
                const hasSteps = form.drill_steps > 0;
                return (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500/70 mb-0.5">Core Cutter Recommends</p>
                        <p className="font-semibold text-foreground text-sm">Custom {hasSteps ? "Step Drill" : "Drill"} — Built to Order</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setDrillQuoteSent(false); setShowDrillQuote(true); }}
                        className="shrink-0 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-colors"
                      >
                        Request Quote
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                      <div><span className="text-zinc-500">Drill Diameter</span><span className="ml-2 font-medium text-foreground">{form.tool_dia ? `${form.tool_dia.toFixed(4)}"` : "—"}</span></div>
                      <div><span className="text-zinc-500">Flutes</span><span className="ml-2 font-medium text-foreground">{form.flutes || "—"}</span></div>
                      <div><span className="text-zinc-500">Point Angle</span><span className="ml-2 font-medium text-foreground">{form.drill_point_angle}°</span></div>
                      <div><span className="text-zinc-500">Flute Length</span><span className="ml-2 font-medium text-foreground">{form.drill_flute_length ? `${form.drill_flute_length.toFixed(3)}"` : "—"}</span></div>
                      <div><span className="text-zinc-500">Hole Depth</span><span className="ml-2 font-medium text-foreground">{form.drill_hole_depth ? `${form.drill_hole_depth.toFixed(3)}"` : "—"}</span></div>
                      <div><span className="text-zinc-500">Hole Type</span><span className="ml-2 font-medium text-foreground">{form.drill_blind ? "Blind" : "Through"}</span></div>
                      <div><span className="text-zinc-500">Flute Geometry</span><span className="ml-2 font-medium text-foreground">{{ standard: "Standard", high_helix: "High Helix", parabolic: "Parabolic" }[form.drill_geometry as string] ?? form.drill_geometry}</span></div>
                      <div><span className="text-zinc-500">Coolant Thru</span><span className="ml-2 font-medium text-foreground">{form.drill_coolant_fed ? "Yes — coolant-through shank" : "No — standard shank"}</span></div>
                      <div><span className="text-zinc-500">Material</span><span className="ml-2 font-medium text-foreground">{matLabel}</span></div>
                      {hasSteps && form.drill_step_diameters.map((d: number, i: number) => (
                        <div key={i} className="col-span-2">
                          <span className="text-zinc-500">Step {i + 1}</span>
                          <span className="ml-2 font-medium text-foreground">ø{d.toFixed(4)}"</span>
                          {form.drill_step_lengths[i] != null && (
                            <span className="ml-2 text-zinc-400">× {form.drill_step_lengths[i].toFixed(3)}" from tip</span>
                          )}
                        </div>
                      ))}
                      <div className="col-span-2">
                        <span className="text-zinc-500">Recommended Coating</span>
                        <span className="ml-2 font-bold text-orange-400">{getCoatingRec(isoCategory).code}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Drill quote modal */}
              {showDrillQuote && (() => {
                const qf = quoteForm;
                const setQf = (patch: Partial<typeof quoteForm>) => setQuoteForm(p => ({ ...p, ...patch }));
                const matLabel = ISO_SUBCATEGORIES.find(s => s.key === form.material)?.label ?? form.material ?? "?";
                const hasSteps = form.drill_steps > 0;
                const spec = {
                  diameter: form.tool_dia ? `${form.tool_dia.toFixed(4)}"` : "?",
                  flutes: form.flutes ? String(form.flutes) : "?",
                  point_angle: `${form.drill_point_angle}°`,
                  flute_length: form.drill_flute_length ? `${form.drill_flute_length.toFixed(3)}"` : "?",
                  hole_depth: form.drill_hole_depth ? `${form.drill_hole_depth.toFixed(3)}"` : "?",
                  hole_type: form.drill_blind ? "Blind" : "Through",
                  coolant_thru: form.drill_coolant_fed ? "Yes" : "No",
                  material: matLabel,
                  cycle: drillResult.cycle ?? "?",
                  steps: hasSteps ? form.drill_step_diameters.map((d: number, i: number) => ({
                    dia: `${d.toFixed(4)}"`,
                    length: form.drill_step_lengths[i] != null ? `${form.drill_step_lengths[i].toFixed(3)}"` : "?",
                  })) : [],
                };
                const handleSubmit = async (e: React.FormEvent) => {
                  e.preventDefault();
                  if (!qf.name || !qf.email) return;
                  setDrillQuoteSending(true);
                  try {
                    const r = await fetch("/api/quote/drill", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ customer: qf, spec }),
                    });
                    if (r.ok) {
                      setDrillQuoteSent(true);
                    } else {
                      const d = await r.json().catch(() => ({}));
                      toast({ title: "Submission failed", description: d.message || "Please try again.", variant: "destructive" });
                    }
                  } catch {
                    toast({ title: "Network error", description: "Could not reach server.", variant: "destructive" });
                  } finally {
                    setDrillQuoteSending(false);
                  }
                };
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowDrillQuote(false)}>
                    <div className="relative w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => setShowDrillQuote(false)} className="absolute top-3 right-3 text-zinc-400 hover:text-white text-lg leading-none">✕</button>

                      {drillQuoteSent ? (
                        <div className="py-8 text-center space-y-3">
                          <div className="text-4xl">✓</div>
                          <p className="font-semibold text-emerald-400">Quote Request Sent</p>
                          <p className="text-xs text-zinc-400">The Core Cutter team at <span className="text-zinc-200">sales@corecutterusa.com</span> will follow up shortly.</p>
                          <button type="button" onClick={() => setShowDrillQuote(false)} className="mt-2 rounded-lg bg-zinc-700 px-5 py-1.5 text-xs font-semibold hover:bg-zinc-600 transition-colors">Close</button>
                        </div>
                      ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                          <h2 className="font-semibold text-sm text-foreground">Request Custom {hasSteps ? "Step Drill" : "Drill"} Quote</h2>

                          {/* Spec summary */}
                          <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-xs space-y-1 text-zinc-300">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Drill Spec</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                              <span className="text-zinc-500">Diameter</span><span>{spec.diameter}</span>
                              <span className="text-zinc-500">Flutes</span><span>{spec.flutes}</span>
                              <span className="text-zinc-500">Point Angle</span><span>{spec.point_angle}</span>
                              <span className="text-zinc-500">Flute Length</span><span>{spec.flute_length}</span>
                              <span className="text-zinc-500">Hole Depth</span><span>{spec.hole_depth}</span>
                              <span className="text-zinc-500">Hole Type</span><span>{spec.hole_type}</span>
                              <span className="text-zinc-500">Coolant Thru</span><span>{spec.coolant_thru}</span>
                              <span className="text-zinc-500">Material</span><span>{spec.material}</span>
                              <span className="text-zinc-500">Cycle</span><span>{spec.cycle}</span>
                            </div>
                            {spec.steps.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                <p className="text-zinc-500 text-[10px] uppercase tracking-wide mt-1">Steps</p>
                                {spec.steps.map((s: { dia: string; length: string }, i: number) => (
                                  <div key={i} className="grid grid-cols-2 gap-x-4">
                                    <span className="text-zinc-500">Step {i + 1} Dia</span><span>{s.dia}</span>
                                    <span className="text-zinc-500">Step {i + 1} Length</span><span>{s.length}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Customer fields */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Name <span className="text-red-400">*</span></label>
                              <input required value={qf.name} onChange={e => setQf({ name: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="Your name" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Company</label>
                              <input value={qf.company} onChange={e => setQf({ company: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="Company name" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Phone</label>
                              <input value={qf.phone} onChange={e => setQf({ phone: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="(555) 000-0000" />
                            </div>
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Email <span className="text-red-400">*</span></label>
                              <input required type="email" value={qf.email} onChange={e => setQf({ email: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="you@company.com" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Quantity</label>
                              <input value={qf.qty} onChange={e => setQf({ qty: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="e.g. 5" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Tolerance</label>
                              <input value={qf.tolerance} onChange={e => setQf({ tolerance: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="e.g. ±0.0005&quot;" />
                            </div>
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs text-zinc-400">Notes</label>
                              <textarea value={qf.notes} onChange={e => setQf({ notes: e.target.value })} rows={2} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none" placeholder="Coating, shank style, special geometry, drawing notes…" />
                            </div>
                          </div>

                          <button type="submit" disabled={drillQuoteSending || !qf.name || !qf.email} className="w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            {drillQuoteSending ? "Sending…" : "Send Quote Request to Core Cutter"}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })()}

            </>
          ) : (
            <>
              {/* Chamfer Mill: geometry + chip thinning panel */}
              {chamferResult && (
                <div className="mb-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 text-sm space-y-3">
                  <div className="text-xs font-bold uppercase tracking-widest text-indigo-400">Chamfer Geometry</div>

                  {/* Tool identity */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Series</span><span className="ml-2 font-semibold text-indigo-300">{form.chamfer_series}</span></div>
                    <div><span className="text-muted-foreground">Included Angle</span><span className="ml-2 font-semibold">{chamferResult.chamfer_angle_deg}°</span></div>
                    <div><span className="text-muted-foreground">Tip Dia</span><span className="ml-2 font-semibold">{chamferResult.tip_dia_in > 0 ? `${chamferResult.tip_dia_in.toFixed(4)}"` : "0 — point (CMS)"}</span></div>
                    <div><span className="text-muted-foreground">Cutting Edge Length</span><span className="ml-2 font-semibold">{chamferResult.edge_length_in?.toFixed(4)}"</span></div>
                    <div><span className="text-muted-foreground">Max Achievable Depth</span><span className="ml-2 font-semibold text-orange-300">{chamferResult.max_depth_in?.toFixed(4)}"</span></div>
                    <div><span className="text-muted-foreground">Chamfer Depth</span><span className="ml-2 font-semibold">{chamferResult.chamfer_depth_in > 0 ? `${chamferResult.chamfer_depth_in.toFixed(4)}"` : "—"}</span></div>
                  </div>

                  {/* D_eff */}
                  <div className="flex items-center justify-between rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2">
                    <div>
                      <span className="text-xs font-semibold text-orange-400">Effective Cut Dia (D_eff)</span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">RPM &amp; SFM are based on D_eff — diameter at the outer edge of the chamfer, not the body OD.</p>
                    </div>
                    <span className="text-base font-mono font-bold text-orange-400 ml-3 shrink-0">{chamferResult.d_eff_in.toFixed(4)}"</span>
                  </div>

                  {/* Growing WOC + edge engagement */}
                  {chamferResult.edge_pct > 0 && (
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                          <span>Flank engaged at depth</span>
                          <span className="font-semibold text-white">{chamferResult.edge_pct.toFixed(1)}% of cutting edge</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-700">
                          <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${Math.min(100, chamferResult.edge_pct)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                          <span>Radial WOC at this depth <span className="text-zinc-600">(grows as depth increases)</span></span>
                          <span className="font-semibold text-amber-400">{chamferResult.actual_woc_in?.toFixed(4)}" — {chamferResult.woc_pct_d_eff?.toFixed(0)}% of D_eff</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-700">
                          <div className="h-1.5 rounded-full bg-amber-500" style={{ width: `${Math.min(100, chamferResult.woc_pct_d_eff ?? 0)}%` }} />
                        </div>
                        <p className="text-[10px] text-zinc-600 mt-0.5">
                          {(chamferResult.woc_pct_d_eff ?? 0) >= 45
                            ? "≈ slot-equivalent engagement — not a light finishing cut"
                            : "WOC and cutting force scale proportionally with depth"}
                        </p>
                      </div>
                      {/* Chip room / flute count context */}
                      <div className="flex items-center justify-between rounded-lg bg-zinc-800/60 border border-zinc-700 px-3 py-2 text-xs">
                        <div>
                          <span className="text-zinc-400">Chip room factor </span>
                          <span className="font-mono font-semibold text-white">{chamferResult.chip_room_mult?.toFixed(2)}×</span>
                          <span className="text-zinc-600 ml-2">({form.flutes}-flute {form.chamfer_series})</span>
                        </div>
                        <div className="text-right">
                          <span className="text-zinc-400">Max single rough pass </span>
                          <span className="font-mono font-semibold text-amber-400">{chamferResult.max_rough_depth_in?.toFixed(4)}"</span>
                        </div>
                      </div>
                      {chamferResult.flute_nonstandard && (
                        <p className="text-[10px] text-amber-400">
                          ⚠ {form.chamfer_series} is standard in {(chamferResult.std_flutes as number[])?.join('- and ')}-flute. Verify {form.flutes}-flute is a custom configuration.
                        </p>
                      )}
                      {chamferResult.std_flutes && !chamferResult.flute_nonstandard && (
                        <p className="text-[10px] text-zinc-600">
                          {form.chamfer_series} standard: {(chamferResult.std_flutes as number[]).map((f: number, i: number) =>
                            `${f}-flute (${f === Math.min(...chamferResult.std_flutes as number[]) ? "more chip room, deeper cuts" : "better finish, lighter DOC"})`
                          ).join(" · ")}
                        </p>
                      )}
                    </div>
                  )}

                  {/* CMH shear angle badge */}
                  {chamferResult.cmh_shear_angle_deg != null && (
                    <div className="flex items-start gap-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                      <div className="flex-1 space-y-0.5">
                        <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">CMH Shear Angle — {chamferResult.cmh_shear_angle_deg}°</div>
                        <div className="grid grid-cols-2 gap-x-4 text-xs mt-1">
                          <div><span className="text-muted-foreground">SFM boost</span><span className="ml-2 font-semibold text-emerald-400">+{chamferResult.cmh_sfm_boost_pct}%</span></div>
                          <div><span className="text-muted-foreground">Force factor</span><span className="ml-2 font-semibold">{chamferResult.cmh_force_factor?.toFixed(3)}×</span></div>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed mt-1">
                          Shear geometry distributes load progressively along the flank — like a helical endmill vs straight-flute. Lower instantaneous force means less heat and a higher SFM ceiling. CMH must be run aggressively enough to cut through the tip flat, not rub.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* CMH minimum chip warning */}
                  {chamferResult.cmh_min_ipt != null && chamferResult.cmh_min_ipt_ok === false && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
                      ⚠ Chip load below CMH minimum ({chamferResult.cmh_min_ipt.toFixed(5)}"). Tip flat will rub — increase feed or chamfer depth.
                    </div>
                  )}

                  {/* Chip thinning */}
                  <div className="border-t border-white/10 pt-2 space-y-1">
                    <div className="text-[10px] font-semibold text-indigo-300 uppercase tracking-wider mb-1">Angled-Flank Chip Thinning</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div><span className="text-muted-foreground">Chip thin factor</span><span className="ml-2 font-mono font-semibold">{chamferResult.chip_thin_factor?.toFixed(4)} × FPT</span></div>
                      <div><span className="text-muted-foreground">FPT multiplier applied</span><span className="ml-2 font-mono font-semibold text-emerald-400">{chamferResult.lead_ctf?.toFixed(2)}×</span></div>
                      <div><span className="text-muted-foreground">Target chip thickness</span><span className="ml-2 font-mono font-semibold">{chamferResult.base_chip_in?.toFixed(5)}"</span></div>
                      <div><span className="text-muted-foreground">Programmed FPT</span><span className="ml-2 font-mono font-semibold text-yellow-300">{result?.customer?.fpt?.toFixed(5)}"</span></div>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      At {chamferResult.chamfer_angle_deg}° ({chamferResult.chamfer_angle_deg/2}° half-angle), each tooth only removes {((chamferResult.chip_thin_factor ?? 1) * 100).toFixed(0)}% of the programmed FPT as actual chip thickness.
                      Feed is corrected {chamferResult.lead_ctf?.toFixed(2)}× so real chip load matches a standard endmill at the same material target.
                    </p>
                  </div>
                </div>
              )}

              {/* Chamfer tips */}
              {chamferResult?.tips && (chamferResult.tips as string[]).length > 0 && (
                <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-widest text-emerald-400">Chamfer Tips</div>
                  {(chamferResult.tips as string[]).map((tip: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground leading-relaxed">• {tip}</p>
                  ))}
                </div>
              )}


              {/* Chamfer multi-pass strategy card */}
              {result?.multi_pass && form.tool_type === "chamfer_mill" && (() => {
                const mp = result.multi_pass as any;
                if (mp.single_pass_ok) return (
                  <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 flex items-center gap-2">
                    <span className="text-emerald-400 text-sm">✓</span>
                    <span className="text-xs text-emerald-300 font-semibold">Single pass OK</span>
                    <span className="text-xs text-muted-foreground">— depth is within single-pass limit for this tool/material</span>
                  </div>
                );
                const nRough: number = mp.num_rough_passes;
                const dRough: number = mp.rough_depth_per_pass;
                const dFull: number  = mp.finish_depth_in;
                const dAllow: number = mp.finish_allowance_in;
                const passes = [
                  ...Array.from({ length: nRough }, (_, i) => ({
                    label: `Pass ${i + 1} — Roughing`,
                    depth: dRough * (i + 1),
                    isFinish: false,
                  })),
                  { label: `Pass ${nRough + 1} — Finish`, depth: dFull, isFinish: true },
                ];
                return (
                  <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 space-y-2">
                    <div className="text-xs font-bold uppercase tracking-widest text-amber-400">Multi-Pass Chamfer Strategy</div>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs mb-1">
                      <div><span className="text-muted-foreground">Total depth</span><span className="ml-2 font-semibold">{dFull.toFixed(4)}"</span></div>
                      <div><span className="text-muted-foreground">Total passes</span><span className="ml-2 font-semibold">{mp.num_passes}</span></div>
                      <div><span className="text-muted-foreground">Finish allowance</span><span className="ml-2 font-semibold">{dAllow.toFixed(3)}"</span></div>
                    </div>
                    <div className="space-y-1">
                      {passes.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.isFinish ? "bg-green-400" : "bg-amber-400"}`} />
                          <span className="text-zinc-300 flex-1">{p.label}</span>
                          <span className="text-zinc-400">to {p.depth.toFixed(4)}"</span>
                          {!p.isFinish && <span className="text-zinc-600 text-[10px]">({dRough.toFixed(4)}"/pass)</span>}
                          {p.isFinish && <span className="text-emerald-500 text-[10px]">(full depth)</span>}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      WOC grows proportionally with depth — single-pass on large chamfers risks poor finish and accelerated wear.
                      Use helical interpolation (G02/G03) for each pass for best surface quality.
                    </p>
                  </div>
                );
              })()}

              {/* Dovetail info */}
              {dovetailResult && (
                <div className="mb-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-widest text-indigo-400">Dovetail Details</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Dovetail Angle</span><span className="ml-2 font-semibold">{dovetailResult.dovetail_angle_deg}°</span></div>
                    <div><span className="text-muted-foreground">DOC</span><span className="ml-2 font-semibold">{dovetailResult.doc_in?.toFixed(4)}"</span></div>
                    <div><span className="text-muted-foreground">Lead CTF</span><span className="ml-2 font-semibold">{dovetailResult.lead_ctf?.toFixed(3)}×</span></div>
                    {dovetailResult.max_safe_doc_in != null && (
                      <div><span className="text-muted-foreground">Max Safe DOC</span><span className="ml-2 font-semibold">{dovetailResult.max_safe_doc_in.toFixed(4)}"</span></div>
                    )}
                    {dovetailResult.flute_reach_in != null && (
                      <div><span className="text-muted-foreground">Flute Reach</span><span className="ml-2 font-semibold">{dovetailResult.flute_reach_in.toFixed(4)}"</span></div>
                    )}
                  </div>
                  {dovetailResult.tips?.map((tip: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground leading-relaxed">• {tip}</p>
                  ))}
                </div>
              )}

              {/* Dovetail multi-pass strategy card */}
              {dovetailResult?.multi_pass && (() => {
                const mp = dovetailResult.multi_pass;
                const n = mp.num_passes;
                const d = mp.depth_per_pass_in;
                const total = mp.final_slot_depth_in;
                const passes = Array.from({ length: n }, (_, i) => ({
                  label: n === 1 ? "Pass 1 (single pass)" : i < n - 1 ? `Pass ${i + 1} (roughing)` : `Pass ${n} (finish)`,
                  doc: d,
                }));
                return (
                  <div className={`mb-3 rounded-xl border px-4 py-3 space-y-2 ${mp.aggressive ? "border-red-500/40 bg-red-500/5" : "border-yellow-500/40 bg-yellow-500/5"}`}>
                    <div className={`text-xs font-bold uppercase tracking-widest ${mp.aggressive ? "text-red-400" : "text-yellow-400"}`}>
                      Multi-Pass Strategy{mp.aggressive ? " ⚠ Aggressive DOC" : ""}
                    </div>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs mb-1">
                      <div><span className="text-muted-foreground">Total Depth</span><span className="ml-2 font-semibold">{total.toFixed(4)}"</span></div>
                      <div><span className="text-muted-foreground">Passes</span><span className="ml-2 font-semibold">{n}</span></div>
                      <div><span className="text-muted-foreground">Depth/Pass</span><span className="ml-2 font-semibold">{d.toFixed(4)}"</span></div>
                    </div>
                    <div className="space-y-1">
                      {passes.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${i === n - 1 && n > 1 ? "bg-green-400" : "bg-yellow-400"}`} />
                          <span className="text-zinc-300">{p.label}</span>
                          <span className="ml-auto text-zinc-400">{p.doc.toFixed(4)}"</span>
                        </div>
                      ))}
                    </div>
                    {mp.aggressive && (
                      <p className="text-xs text-red-400 leading-relaxed">⚠ Current pass depth exceeds recommended safe limit. Consider reducing Cut Pass Depth to {mp.max_safe_doc_in.toFixed(4)}" or less.</p>
                    )}
                  </div>
                );
              })()}

              {/* Optimal Tool Recommendation Card */}
              {optimalLoading && (
                <div className="mb-4 rounded-xl border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-400 animate-pulse">
                  Finding optimal tool match…
                </div>
              )}
              {!optimalLoading && optimalRec && (() => {
                const rec = optimalRec;
                const recSku = rec.recommended_sku;
                const recCust = rec.recommended_result?.customer ?? {};
                const recEng  = rec.recommended_result?.engineering ?? {};
                const recStab = rec.recommended_result?.stability ?? {};
                const curMrr     = customer?.mrr_in3_min ?? 0;
                const recMrr     = recCust?.mrr_in3_min ?? 0;
                const curFeed    = customer?.feed_ipm ?? 0;
                const recFeed    = recCust?.feed_ipm ?? 0;
                const curStabPct = result?.stability?.deflection_pct ?? null;
                const recStabPct = recStab?.deflection_pct ?? null;
                const curForce   = result?.engineering?.force_lbf ?? null;
                const recForce   = recEng?.force_lbf ?? null;
                const geomLabel: Record<string, string> = {
                  chipbreaker: "CB", truncated_rougher: "VRX", standard: "Std"
                };
                const tags = [
                  recSku.geometry && recSku.geometry !== "standard" ? geomLabel[recSku.geometry] ?? recSku.geometry : null,
                  recSku.coating ?? null,
                  recSku.series ?? null,
                  recSku.variable_pitch && recSku.variable_helix ? "Var Pitch+Helix"
                    : recSku.variable_pitch ? "Var Pitch"
                    : recSku.variable_helix ? "Var Helix" : null,
                ].filter(Boolean).join(" · ");
                const geom = recSku.geometry ?? "standard";
                const wocOk = geom === "truncated_rougher" ? (form.woc_pct ?? 0) >= 10
                            : geom === "chipbreaker"       ? (form.woc_pct ?? 0) >= 8
                            : true;

                // Comparison rows — only show rows where we have both values
                const cmpRows: { label: string; cur: string; opt: string; better: boolean }[] = [];
                const meaningfulGain = (cur: number, opt: number, pct = 5) => Math.abs((opt - cur) / (cur || 1)) * 100 >= pct;
                if (curStabPct != null && recStabPct != null)
                  cmpRows.push({ label: "Stability", cur: `${Math.round(curStabPct)}%`, opt: `${Math.round(recStabPct)}%`, better: recStabPct < curStabPct && meaningfulGain(curStabPct, recStabPct) });
                if (curForce != null && recForce != null)
                  cmpRows.push({ label: "Force (lbf)", cur: Math.round(curForce).toString(), opt: Math.round(recForce).toString(), better: recForce < curForce && meaningfulGain(curForce, recForce) });
                if (curMrr > 0 && recMrr > 0)
                  cmpRows.push({ label: "MRR (in³/min)", cur: curMrr.toFixed(3), opt: recMrr.toFixed(3), better: recMrr > curMrr && meaningfulGain(curMrr, recMrr) });
                if (curFeed > 0 && recFeed > 0)
                  cmpRows.push({ label: "Feed (IPM)", cur: curFeed.toFixed(1), opt: recFeed.toFixed(1), better: recFeed > curFeed && meaningfulGain(curFeed, recFeed) });

                return (
                  <div className="mb-4 rounded-xl border border-emerald-600/50 bg-emerald-950/25 px-4 py-3 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">💡 Optimized EDP Match for This Setup</span>
                    <div className="text-xs text-zinc-200 font-semibold">
                      EDP# {recSku.edp}
                      {tags ? <span className="ml-2 font-normal text-zinc-400">· {tags}</span> : null}
                    </div>

                    {/* Side-by-side comparison table */}
                    {cmpRows.length > 0 && (
                      <div className="rounded-lg overflow-hidden border border-zinc-700/50 text-xs">
                        <div className="grid grid-cols-3 bg-zinc-800/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          <span></span>
                          <span className="text-center">Current</span>
                          <span className="text-center text-emerald-400">Optimized</span>
                        </div>
                        {cmpRows.map((r) => (
                          <div key={r.label} className="grid grid-cols-3 px-2 py-1.5 border-t border-zinc-700/30 items-center">
                            <span className="text-zinc-400">{r.label}</span>
                            <span className="text-center text-zinc-300">{r.cur}</span>
                            <span className={`text-center font-semibold ${r.better ? "text-emerald-400" : "text-zinc-300"}`}>
                              {r.opt}{r.better ? " ✓" : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Geometry benefit note */}
                    {geom === "chipbreaker" && (
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Chipbreaker geometry reduces cutting forces and interrupts chip flow — lowering chatter risk at the same feed rate. MRR stays similar; the gain is stability and tool life.
                      </p>
                    )}
                    {geom === "truncated_rougher" && (
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        VXR (truncated rougher) geometry reduces radial forces during heavy cuts, improving stability and allowing higher DOC/WOC without chatter.
                      </p>
                    )}
                    {rec.rigidity_note && (
                      <p className="text-[11px] text-amber-400 leading-relaxed">
                        ⚠ {rec.rigidity_note}
                      </p>
                    )}
                    {geom === "standard" && recSku.flutes > (form.flutes ?? 0) && (
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        More flutes means a higher feed rate at the same chip load per tooth — directly increasing MRR with the same spindle speed.
                      </p>
                    )}

                    {/* WOC warning only when geometry won't engage */}
                    {!wocOk && (
                      <div className="text-xs rounded px-2 py-1 bg-amber-900/40 border border-amber-600/40 text-amber-300">
                        ⚠ {geom === "truncated_rougher" ? "VRX requires ≥10% WOC" : "CB requires ≥8% WOC"} — increase WOC after switching.
                      </div>
                    )}
                    <button
                      type="button"
                      className="mt-1 w-full rounded-lg border border-emerald-600 bg-emerald-900/40 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-700/50 hover:text-white transition-colors text-center"
                      onClick={() => {
                        applySkuToForm(recSku as any);
                        setOptimalRec(null);
                        setTimeout(() => runRef.current(), 100);
                      }}
                    >
                      Run Optimal Tool Parameters
                    </button>
                  </div>
                );
              })()}

              {/* Customer KPIs (single grid, auto-flows) */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Kpi
                  label="Material"
                  value={(() => {
                    const full = ISO_SUBCATEGORIES.find((s) => s.key === customer.material)?.label
                      ?? String(customer.material ?? "—");
                    const parenIdx = full.indexOf("(");
                    if (parenIdx === -1) return <>{full}</>;
                    const main = full.slice(0, parenIdx).trim();
                    const sub  = full.slice(parenIdx);
                    return (
                      <>
                        {main}
                        <span className="block text-[11px] font-normal text-zinc-400 leading-snug mt-0.5">{sub}</span>
                      </>
                    );
                  })()}
                />
                <Kpi label={UL("Ø (in)", "Ø (mm)")} hint="Cutting diameter of the tool as confirmed by the engine." value={UC(customer.diameter, 25.4, metric ? 2 : 3)} />
                <Kpi label="Flutes" hint="Number of cutting flutes. More flutes increase feed rate but reduce chip clearance — critical in gummy materials like aluminum and stainless." value={fmtInt(customer.flutes)} />

                <Kpi label="RPM" hint="Spindle speed in revolutions per minute. Derived from target SFM and tool diameter, capped at your Max RPM × RPM Limiter setting." value={fmtInt(customer.rpm)} />
                <Kpi label={UL("SFM", "m/min")} hint="Surface Feet per Minute — the cutting edge velocity at the tool OD. The primary driver of heat generation and tool life. Too high for the material causes rapid edge wear; too low causes rubbing." value={UC(customer.sfm, 0.3048, metric ? 1 : 0)} />
                <Kpi
                  label={form.mode === "circ_interp" ? UL("Feed (IPM) — tool centerline", "Feed (mm/min) — tool centerline") : UL("Feed (IPM)", "Feed (mm/min)")}
                  hint={form.mode === "circ_interp" ? "ENTER THIS NUMBER IN YOUR CAM. This is the tool centerline feed — already corrected for bore geometry. The cutting edge at the wall travels faster; see Peripheral Feed for the actual chip load the tool sees." : "Programmed table feed rate in inches per minute. Equal to RPM × flutes × chip load per tooth. The ⚠ note shows if the engine had to limit feed (deflection, HP, or RPM cap)."}
                  value={
                    <>
                      {UC(customer.feed_ipm, 25.4, metric ? 1 : 2)}
                      {customer.status ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {customer.status === "User input" ? "✓" : `⚠ ${customer.status}`}
                        </span>
                      ) : null}
                    </>
                  }
                />

                {customer.peripheral_feed_ipm != null && (
                  <Kpi
                    label={UL("Peripheral Feed (IPM)", "Peripheral Feed (mm/min)")}
                    value={
                      <span className="text-amber-400">
                        {UC(customer.peripheral_feed_ipm, 25.4, metric ? 1 : 2)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">at wall</span>
                      </span>
                    }
                  />
                )}

                <Kpi
                  label={UL("FPT (in)", "FPT (mm)")}
                  hint="Base chip load per tooth before radial chip thinning correction. Calculated as a fixed fraction of diameter for the material. This is the starting point; the engine adjusts it for WOC via the chip thinning factor."
                  value={
                    <>
                      {UC(customer.fpt, 25.4, metric ? 4 : 5)}
                      {customer.diameter ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({fmtNum((customer.fpt / customer.diameter) * 100, 1)}%)
                        </span>
                      ) : null}
                    </>
                  }
                />
                {customer.adj_fpt != null ? (
                  <Kpi
                    label={UL("Adj FPT (in)", "Adj FPT (mm)")}
                    hint="Adjusted chip load per tooth after applying the radial chip thinning factor (RCTF) for your WOC. At low radial engagement, the tool must feed faster to generate the same actual chip thickness. This is the value the engine uses to compute feed IPM."
                    value={
                      <>
                        {UC(customer.adj_fpt, 25.4, metric ? 4 : 5)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({fmtNum((customer.adj_fpt / customer.diameter) * 100, 1)}%)
                        </span>
                      </>
                    }
                  />
                ) : null}

                <Kpi
                  label={form.mode === "face" ? UL("Pass Depth (in)", "Pass Depth (mm)") : UL("DOC (in)", "DOC (mm)")}
                  value={
                    <>
                      {UC(customer.doc_in, 25.4, metric ? 2 : 4)}
                      {customer.diameter ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({(customer.doc_in / customer.diameter).toFixed(1).replace(/\.0$/, "")}D)
                        </span>
                      ) : null}
                    </>
                  }
                />
                <Kpi
                  label={form.mode === "face" ? UL("Step-Over (in)", "Step-Over (mm)") : form.mode === "circ_interp" ? UL("Radial Wall ae (in)", "Radial Wall ae (mm)") : UL("WOC (in)", "WOC (mm)")}
                  hint={form.mode === "circ_interp" ? "Total radial stock to remove = (target bore − existing bore) ÷ 2. This is the total wall the tool must interpolate through, split across radial passes." : undefined}
                  value={
                    <>
                      {form.mode === "circ_interp" && customer.ci_a_e_in != null
                        ? <span>{UC(customer.ci_a_e_in, 25.4, metric ? 3 : 4)}</span>
                        : <>
                            {UC(customer.woc_in, 25.4, metric ? 2 : 4)}
                            {customer.diameter ? (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                ({fmtNum((customer.woc_in / customer.diameter) * 100, 1)}%)
                              </span>
                            ) : null}
                          </>
                      }
                    </>
                  }
                />
                {customer.recommended_stepover != null && form.mode !== "circ_interp" && (
                  <Kpi
                    label={UL("Rec. Step-Over (in)", "Rec. Step-Over (mm)")}
                    hint="Recommended facing step-over per pass based on (Cut Diameter − 2 × Corner Radius) × 75%. Ensures the flat face of the tool does the cutting — not the corner radius — with 25% overlap for consistent surface finish."
                    value={
                      <span className="text-amber-400 font-semibold">
                        {UC(customer.recommended_stepover, 25.4, metric ? 3 : 4)}
                        {customer.diameter ? (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({fmtNum((customer.recommended_stepover / customer.diameter) * 100, 1)}% dia)
                          </span>
                        ) : null}
                      </span>
                    }
                  />
                )}
                {form.mode === "circ_interp" && customer.ci_a_e_in != null && (() => {
                  const passes = Math.max(1, Math.ceil(customer.ci_a_e_in / (form.tool_dia * 0.25)));
                  const stepPerPass = customer.ci_a_e_in / passes;
                  return (
                    <Kpi
                      label={UL("Radial Step / Pass (in)", "Radial Step / Pass (mm)")}
                      hint="Radial stock removed per pass = total radial wall ÷ number of passes. Keeps each pass load manageable and bore geometry accurate."
                      value={
                        <span className="text-amber-400 font-semibold">
                          {UC(stepPerPass, 25.4, metric ? 3 : 4)}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">({passes} pass{passes !== 1 ? "es" : ""})</span>
                        </span>
                      }
                    />
                  );
                })()}
                {form.mode === "face" && (() => {
                  const cr = form.corner_radius ?? 0;
                  if (cr <= 0) return (
                    <Kpi label="Theoretical Ra" hint="Surface finish prediction requires a corner radius > 0. Square-corner tools produce finish limited by runout and engagement geometry." value={<span className="text-muted-foreground text-xs">CR required</span>} />
                  );
                  const raUin = customer.ra_actual_uin;
                  const capped = customer.ra_feed_capped;
                  const target = form.target_ra_uin;
                  if (raUin == null) return null;
                  const meetsTarget = target > 0 ? raUin <= target + 0.01 : null;
                  return (
                    <>
                      <Kpi
                        label="Theoretical Ra (µin)"
                        hint="Estimated surface roughness from Ra = FPT² × 1,000,000 / (8 × CR). Assumes sharp tool, no runout, consistent engagement. Actual finish depends on machine condition, tool runout, and coolant."
                        value={
                          <span className={meetsTarget === true ? "text-emerald-400 font-semibold" : meetsTarget === false ? "text-red-400 font-semibold" : "font-semibold"}>
                            {raUin.toFixed(1)} µin
                            <span className="ml-1 text-xs font-normal text-muted-foreground">({(raUin * 0.0254).toFixed(3)} µm)</span>
                            {meetsTarget === true && <span className="ml-1 text-xs"> ✓ meets {target} µin target</span>}
                          </span>
                        }
                      />
                      {capped && target > 0 && (
                        <div className="col-span-full px-1 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
                          Feed capped to <span className="font-semibold">{customer.feed_ipm?.toFixed(2)} IPM</span> to achieve Ra ≤ {target} µin. RPM unchanged — only feed was reduced.
                        </div>
                      )}
                      <p className="col-span-full text-[10px] text-muted-foreground italic px-1">
                        Surface finish is theoretical and depends on many factors beyond tool geometry and cutting parameters — including spindle condition, toolholder accuracy, tool runout, workholding rigidity, chip evacuation, coolant delivery, and material lot variation. Actual results will vary. This is an estimate only and is not a guarantee from Core Cutter.
                      </p>
                    </>
                  );
                })()}
                <Kpi label={UL("MRR (in³/min)", "MRR (cm³/min)")} hint="Material Removal Rate — volume of material removed per minute. The key productivity metric: higher MRR = faster cycle time. MRR = WOC × DOC × Feed IPM." value={UC(customer.mrr_in3_min, 16.387, metric ? 2 : 4)} />

                <Kpi label={UL("HP Req", "kW Req")} hint="Estimated cutting power required for this operation. Calculated from MRR × material unit power (HP·min/in³), adjusted for geometry and workpiece hardness." value={UC(customer.hp_required, 0.7457, 2)} />
                <Kpi label={UL("Avail HP", "Avail kW")} hint="Your machine's nameplate HP derated by spindle drive efficiency (Direct 96%, Belt 92%, Gear 88%). This is the actual cutting power available at the spindle." value={UC(customer.machine_hp, 0.7457, metric ? 1 : 1)} />
                <Kpi
                  label="HP Util (%)"
                  hint="HP Required as a percentage of available spindle HP. Above 90% risks spindle overload and poor surface finish. Ideally 50–80% for a productive cut with headroom."
                  value={
                    customer.hp_util_pct != null
                      ? `${fmtNum(customer.hp_util_pct, 0)}%`
                      : "—"
                  }
                />

                <Kpi label={UL("HP Margin", "kW Margin")} hint="Available HP minus HP Required — your power headroom. Positive means the machine can handle this cut. Negative means the cut will overload the spindle." value={UC(customer.hp_margin_hp, 0.7457, 2)} />
              </div>

              {/* Engineering */}
              {engineering ? (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Kpi label={UL("Force (lbf)", "Force (N)")} hint="Estimated radial cutting force at the tool tip. Drives deflection and chatter. Increases with chip load, DOC, and material hardness. Key input to the stability model." value={UC(engineering?.force_lbf, 4.44822, 0)} />
                    <Kpi
                      label={UL("Torque (in-lbf)", "Torque (N·m)")}
                      hint="Cutting torque derived from HP and RPM (T = HP × 63,025 / RPM). The % shown is cutting torque vs. your spindle taper's interface grip capacity — not the machine's motor torque limit. It indicates toolholder pullout risk, not spindle overload."
                      value={
                        <>
                          {UC(engineering?.torque_inlbf, 0.112985, metric ? 2 : 1)}
                          {engineering?.torque_pct != null ? (
                            <span className={`ml-1 text-xs font-normal ${engineering.torque_pct > 90 ? "text-red-400" : engineering.torque_pct > 70 ? "text-amber-400" : "text-muted-foreground"}`}>
                              ({fmtNum(engineering.torque_pct, 0)}% cap)
                            </span>
                          ) : null}
                        </>
                      }
                    />
                    <Kpi label={UL("Deflection (in)", "Deflection (mm)")} hint="Estimated tool tip deflection under radial cutting force, modeled as a cantilever beam. Excessive deflection causes dimensional error, chatter, and poor surface finish. The stability limit is shown in the Stability Check section." value={UC(engineering?.deflection_in, 25.4, metric ? 4 : 6)} />
                    <Kpi label={UL("Chip Thick (in)", "Chip Thick (mm)")} hint="Effective chip thickness after radial chip thinning (RCTF). At low WOC, the actual chip is thinner than the programmed FPT — the engine boosts feed to compensate. Must exceed the minimum chip thickness to avoid rubbing." value={UC(engineering?.chip_thickness_in, 25.4, metric ? 4 : 6)} />
                    {form.mode !== "face" && <Kpi
                      label="Tooth Engagement"
                      hint="Average number of cutting teeth simultaneously in contact with the workpiece. Derived from WOC engagement arc and flute count. The helix wrap shows how many degrees the flute spirals over the DOC. Continuous means at least one tooth is always cutting — smoother force, better surface finish."
                      value={
                        engineering?.teeth_in_cut != null ? (
                          <div className="leading-snug">
                            <div>{fmtNum(engineering.teeth_in_cut, 2)} teeth</div>
                            {engineering?.helix_wrap_deg != null && (
                              <div className="text-xs font-normal text-muted-foreground mt-0.5">
                                {fmtNum(engineering.helix_wrap_deg, 0)}° helix wrap
                                {engineering?.engagement_continuous
                                  ? " · continuous"
                                  : " · interrupted"}
                              </div>
                            )}
                          </div>
                        ) : "—"
                      }
                    />}
                    <Kpi label="Chatter" hint="Chatter index — a relative indicator combining deflection, RPM, and workholding compliance. Lower is better. This is an internal diagnostic value; use the Rigidity & Chatter Audit section for actionable guidance." value={fmtNum(engineering?.chatter_index, 3)} />
                  </div>
                </>
              ) : null}

              {/* Circular Interpolation Advisory — shown after KPIs when circ_interp */}
              {form.mode === "circ_interp" && customer && form.tool_dia > 0 && (() => {
                const D = form.tool_dia;
                const entryBore = form.existing_hole_dia > 0 ? form.existing_hole_dia : 0;
                const targetBore = form.target_hole_dia > entryBore ? form.target_hole_dia : 0;
                const radialWall = customer.ci_a_e_in ?? ((targetBore - entryBore) / 2);
                if (radialWall <= 0) return null;
                const aePerPass = Math.max(0.001, (form.woc_pct / 100) * D);
                const passes = Math.max(1, Math.ceil(radialWall / aePerPass));
                const aeFinish = 0.007;
                const radialClearance = entryBore > 0 ? (entryBore - D) / 2 : null;
                const feedCam = customer.feed_ipm ?? 0;
                const feedPeripheral = customer.peripheral_feed_ipm ?? 0;
                const engAngle = (ae: number) => {
                  const arg = Math.max(-1, Math.min(1, 1 - (2 * ae) / D));
                  return 2 * Math.acos(arg) * (180 / Math.PI);
                };
                const zoneColor = (deg: number) =>
                  deg < 90 ? "#4ade80" : deg < 150 ? "#facc15" : deg <= 180 ? "#fb923c" : "#f87171";
                const zoneLabel = (deg: number) =>
                  deg < 90 ? "Light" : deg < 150 ? "Moderate" : deg <= 180 ? "Heavy" : "Too High";
                const entryDeg = engAngle(aePerPass);
                const finishDeg = engAngle(aeFinish);
                const phaseStyle = { background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)" };
                return (
                  <div className="mt-3 rounded-xl border border-indigo-600/40 bg-indigo-950/20 px-3 py-3 space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-300 mb-1">Circular Interpolation — Process Advisory</div>
                    {/* Feed summary */}
                    <div className="rounded-md px-2 py-1.5 flex items-center justify-between gap-4" style={phaseStyle}>
                      <div>
                        <div className="text-[9px] text-zinc-500 mb-0.5">CAM Feed (tool centerline)</div>
                        <div className="text-sm font-bold text-white">{feedCam.toFixed(2)} IPM</div>
                        <div className="text-[9px] text-amber-300">Enter this in CAM</div>
                      </div>
                      {feedPeripheral > 0 && (
                        <div>
                          <div className="text-[9px] text-zinc-500 mb-0.5">Peripheral Feed (at wall)</div>
                          <div className="text-sm font-bold text-amber-400">{feedPeripheral.toFixed(2)} IPM</div>
                          <div className="text-[9px] text-zinc-400">Actual chip load</div>
                        </div>
                      )}
                      <div>
                        <div className="text-[9px] text-zinc-500 mb-0.5">Radial wall</div>
                        <div className="text-sm font-bold text-white">{radialWall.toFixed(4)}"</div>
                        <div className="text-[9px] text-zinc-400">{passes} pass{passes !== 1 ? "es" : ""} · {aePerPass.toFixed(4)}"/pass</div>
                      </div>
                    </div>
                    {/* Phase 1 — Entry */}
                    <div className="rounded-md px-2 py-1.5" style={phaseStyle}>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-1">① Entry</div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-400">Bore clearance</span>
                        <span className="text-[10px] font-semibold" style={{ color: radialClearance == null ? "#94a3b8" : radialClearance >= 0.050 ? "#4ade80" : "#f87171" }}>
                          {radialClearance != null ? `${radialClearance.toFixed(3)}" per side ${radialClearance >= 0.050 ? "✓" : "⚠ tight"}` : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-zinc-400">Entry type</span>
                        <span className="text-[10px] font-semibold text-sky-300">Sweep / Roll-in preferred</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-zinc-400">Ramp angle (if no pre-drill)</span>
                        <span className="text-[10px] font-semibold text-sky-300">≤2°</span>
                      </div>
                    </div>
                    {/* Phase 2 — Cutting */}
                    <div className="rounded-md px-2 py-1.5" style={phaseStyle}>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-1">② Cutting — {passes} radial pass{passes !== 1 ? "es" : ""} · {aePerPass.toFixed(4)}"/pass</div>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <div className="text-[9px] text-zinc-500 mb-0.5">Engagement / pass</div>
                          <div className="text-sm font-bold" style={{ color: zoneColor(entryDeg) }}>{entryDeg.toFixed(1)}°</div>
                          <div className="text-[9px]" style={{ color: zoneColor(entryDeg) }}>{zoneLabel(entryDeg)}</div>
                          <div className="mt-1 rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.08)" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (entryDeg / 360) * 100)}%`, background: zoneColor(entryDeg) }} />
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="text-[9px] text-zinc-500 mb-0.5">Direction</div>
                          <div className="text-[10px] text-zinc-300 leading-snug">CCW = climb cut (preferred for finish). CW = conventional.</div>
                        </div>
                        <div className="flex-1">
                          <div className="text-[9px] text-zinc-500 mb-0.5">Bore-to-feed note</div>
                          <div className="text-[10px] text-zinc-300 leading-snug">Larger bore → lower arc → higher feed is correct.</div>
                        </div>
                      </div>
                      {entryDeg > 150 && (
                        <p className="text-[10px] text-amber-400 mt-1">⚠ High engagement — increase radial passes or reduce step per pass</p>
                      )}
                    </div>
                    {/* Phase 3 — Finish */}
                    <div className="rounded-md px-2 py-1.5" style={phaseStyle}>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-1">③ Finish Pass</div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-400">Engagement (0.007" stock)</span>
                        <span className="text-[10px] font-semibold" style={{ color: zoneColor(finishDeg) }}>{finishDeg.toFixed(1)}° — {zoneLabel(finishDeg)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-zinc-400">Leave stock</span>
                        <span className="text-[10px] font-semibold text-sky-300">0.005–0.010" for cleanup pass</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-zinc-400">Feed on finish</span>
                        <span className="text-[10px] font-semibold text-sky-300">50–70% of roughing · never dwell inside bore</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Mode-specific Setup Tips — collapsible toggle */}
              {customer && (form.mode === "face" || form.mode === "circ_interp") && (
                <div className="mt-3 rounded-xl border border-sky-700/40 bg-sky-950/20 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setModeTipsOpen(o => !o)}
                    className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-sky-300 hover:text-sky-100 transition-colors"
                  >
                    <span>{form.mode === "face" ? "Facing / Planar Milling — Setup Tips" : "Circular Interpolation — Setup Tips"}</span>
                    <span className="text-sky-500 text-[11px]">{modeTipsOpen ? "▲ Hide" : "▼ Show"}</span>
                  </button>
                  {modeTipsOpen && (
                    <div className="mt-2 space-y-1.5 border-t border-sky-800/40 pt-2">
                      {form.mode === "face" ? (<>
                        {form.tool_dia > 0 && form.corner_radius > 0 && (
                          <p className="text-[10px] text-sky-200">• <span className="text-white">Optimal stepover = (D − 2×CR) × 0.75</span> = <span className="font-semibold text-sky-100">{((form.tool_dia - 2 * form.corner_radius) * 0.75).toFixed(4)}"</span> — wiper overlaps each pass by 25%, burnishing out the cusp line</p>
                        )}
                        {!form.corner_radius && (
                          <p className="text-[10px] text-sky-200">• <span className="text-white">Use a corner radius tool</span> — CR 0.030"+ creates a wiper flat. Square corners leave visible lines at every stepover</p>
                        )}
                        {form.tool_dia > 0 && form.corner_radius > 0 && (
                          <p className="text-[10px] text-sky-200">• <span className="text-white">DOC must exceed CR ({form.corner_radius.toFixed(4)}")</span> — below CR you're cutting only on the arc; wiper effect disappears and floor looks scalloped. Minimum DOC: {(form.corner_radius + 0.003).toFixed(4)}"</p>
                        )}
                        <p className="text-[10px] text-sky-200">• <span className="text-white">0.005–0.020" finish DOC</span> is normal and correct — facing DOC is much shallower than peripheral milling</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Minimize stickout</span> — #1 rule for facing. Full diameter engages; any deflection shows as flatness error</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Climb mill on finish pass</span> — bi-directional OK for roughing. Uni-directional on finish pass only</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Spring pass:</span> re-run at zero Z offset, same direction — removes deflection bow from first pass</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Air blast over flood</span> — chips under the wiper get smeared and streak the surface</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Axial runout &lt;0.0005"</span> — Z-wobble leaves repeating witness arcs at every stepover. Use shrink-fit or precision collet, check face TIR</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Troubleshoot:</span> Scallop lines = stepover too wide or CR too small · Witness arcs = check axial runout · Wavy surface = reduce stickout + spring pass</p>
                      </>) : (<>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">CAM feed vs. peripheral feed:</span> <strong>Feed (IPM)</strong> in results is already corrected for arc — enter that number in your CAM. <strong>Peripheral Feed</strong> is the actual chip load at the wall — use it to verify the cut, not to program.</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Larger bore = higher feed is correct:</span> As bore diameter increases, arc of engagement decreases and chip thinning kicks in — the engine boosts feed automatically. Higher Feed (IPM) on a large bore is expected, not a mistake.</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">CCW toolpath = climb milling</span> on an internal bore. Use CCW for finish passes; CW is conventional (better if backlash is a concern)</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Leave 0.005–0.010" stock</span> for a final cleanup pass at reduced feed — bore tolerances are tight and deflection on roughing passes leaves material</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Entry bore clearance:</span> radial clearance (entry bore − tool dia) ÷ 2 should be ≥0.050" for rigid entry. Tighter = rubbing risk</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Stepover ≤15% of tool dia</span> for finishing passes — excessive stepover causes chatter and poor bore finish</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Minimize stickout</span> — at 2×D+ depth, deflection bows the bore. Keep gauge line as close to holder as part clearance allows</p>
                        <p className="text-[10px] text-sky-200">• <span className="text-white">No pre-drilled hole? Use helical interpolation entry in CAM</span> — ramp in a continuous helix to bore depth, then circular passes to size the wall. Set ramp feed to <strong>40–50% of Feed (IPM)</strong>. Ramp angle ≤2°; center-cutting geometry required.</p>
                        {(() => {
                          const D = form.tool_dia;
                          const boreDia = form.target_hole_dia > 0 ? form.target_hole_dia : form.bore_dia;
                          if (!(D > 0) || !(boreDia > 0)) return (
                            <p className="text-[10px] text-sky-200">• <span className="text-white">Core post check:</span> Enter tool and bore diameters above to see whether helical entry leaves a standing post.</p>
                          );
                          const postDia = boreDia - 2 * D;
                          if (postDia <= 0) return (
                            <p className="text-[10px] text-sky-200">• <span className="text-white">Core post check ✓</span> — tool ({D.toFixed(4)}") ≥ half bore ({(boreDia/2).toFixed(4)}"). No standing post.</p>
                          );
                          return (
                            <p className="text-[10px] text-sky-200">• <span className="text-white text-amber-300">⚠ Core post warning:</span> Helical entry leaves a <strong className="text-amber-300">{postDia.toFixed(4)}" standing post</strong>. Use a tool ≥{(boreDia/2).toFixed(4)}" or pre-interpolate a center pocket first.</p>
                          );
                        })()}
                        <p className="text-[10px] text-sky-200">• <span className="text-white">Never dwell mid-pass</span> — stopping feed inside the bore leaves a witness ring. Lead tool out past bore edge on exit</p>
                      </>)}
                    </div>
                  )}
                </div>
              )}

              {/* Spindle-Limited Advisory — shown when machine can't reach target SFM */}
              {customer?.sfm_target > 0 && customer?.rpm > 0 && form.max_rpm > 0 && (() => {
                const sfmActual  = customer.sfm ?? 0;
                const sfmTarget  = customer.sfm_target;
                const sfmPct     = sfmActual / sfmTarget;      // 0–1
                const dia        = form.tool_dia ?? 0;
                // Only fire when genuinely RPM-limited (>3% below target)
                if (sfmPct >= 0.97) return null;

                const isAmber = sfmPct >= 0.60;
                const isRed   = sfmPct < 0.40;
                const borderColor = isRed ? "border-red-500" : isAmber ? "border-amber-500" : "border-orange-500";
                const bgColor     = isRed ? "bg-red-500/10"  : isAmber ? "bg-amber-500/10"  : "bg-orange-500/10";
                const textColor   = isRed ? "text-red-400"   : isAmber ? "text-amber-400"   : "text-orange-400";

                // ── #2: Min diameter to hit target SFM at max RPM ──────────
                // target_rpm = (sfm_target × 3.82) / dia  →  dia = (sfm_target × 3.82) / max_rpm
                const minDiaForSfm = (sfmTarget * 3.82) / (form.max_rpm * (form.rpm_util_pct ?? 0.95));

                // ── #3: Speeder threshold ───────────────────────────────────
                const suggestSpeeder = dia <= 0.375 && sfmPct < 0.70;
                const suggestSpeederStrong = dia <= 0.250 && sfmPct < 0.70;

                return (
                  <div className={`rounded-lg border ${borderColor} ${bgColor} px-3 py-2.5 space-y-2`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${textColor}`}>
                        Spindle Limited
                      </span>
                      <span className={`text-xs font-bold ${textColor}`}>
                        {Math.round(sfmPct * 100)}% of target SFM
                      </span>
                    </div>

                    {/* #1 — RPM-limited SFM warning */}
                    <p className="text-xs text-zinc-300">
                      Your machine achieves <span className={`font-semibold ${textColor}`}>{Math.round(sfmActual)} SFM</span> of the{" "}
                      <span className="font-semibold text-white">{Math.round(sfmTarget)} SFM</span> target at{" "}
                      {form.max_rpm.toLocaleString()} RPM max.{" "}
                      {isRed
                        ? "Productivity is severely reduced — tool life will be longer but MRR is a fraction of what's possible."
                        : "Feed rate and MRR are proportionally reduced."}
                    </p>

                    {/* #2 — Min diameter to reach full SFM */}
                    {minDiaForSfm > dia && (
                      <p className="text-xs text-zinc-400">
                        <span className="text-zinc-200 font-semibold">Larger tool option:</span>{" "}
                        A diameter of <span className="font-semibold text-white">≥{minDiaForSfm.toFixed(3)}"</span> would reach{" "}
                        {Math.round(sfmTarget)} SFM at your spindle's max RPM — if the feature geometry allows it, a larger tool will cut significantly faster.
                      </p>
                    )}

                    {/* #3 — Spindle speeder recommendation */}
                    {suggestSpeeder && (
                      <p className="text-xs text-zinc-400">
                        <span className="text-zinc-200 font-semibold">
                          {suggestSpeederStrong ? "Spindle speed increaser recommended:" : "Spindle speed increaser may help:"}
                        </span>{" "}
                        A speeder head (e.g. NSK, IBAG, Parlec) multiplies your spindle RPM 3–5× and can unlock full SFM for small-diameter tools like this. Commonly used for tools ≤¼" diameter on standard VMCs.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Tooth Engagement Advisory — hidden for slotting, circ_interp, and face (wiper geometry drives facing, not arc engagement) */}
              {engineering?.teeth_in_cut != null && form.mode !== "slot" && form.mode !== "circ_interp" && form.mode !== "face" && (() => {
                const tic = engineering.teeth_in_cut;
                const low = 1.0, sweetLo = 1.5, sweetHi = 2.5, high = 3.0;
                const zone = tic < low ? "low" : tic <= sweetHi ? tic >= sweetLo ? "sweet" : "ok" : "high";
                const maxDisplay = 4.0;
                const pct = (v: number) => `${Math.min(100, (v / maxDisplay) * 100).toFixed(1)}%`;
                const tipsByOp: Record<string, { low: string; ok: string; high: string }> = {
                  hem:       { low: `Increase WOC% (try 6–10%)${form.flutes < 5 ? " or add flutes (5–7 fl recommended for HEM)" : form.flutes < 7 ? ` or try ${form.flutes + 1}–7 flutes` : ""}`, ok: `Try pushing WOC% up slightly${form.flutes < 7 ? ` or adding a flute (try ${form.flutes + 1} fl)` : ""} to reach 1.5–2.5 teeth engaged`, high: `Reduce WOC%${form.flutes > 4 ? ` or drop to ${form.flutes - 1} flutes` : ""}` },
                  slot:      { low: "Slotting uses 2 teeth naturally at 4fl — check flute count", ok: "Increase flute count to reach the sweet spot", high: "Reduce flutes for slotting — 4fl is standard" },
                  finish:    { low: "Light WOC is normal for finishing — this is expected", ok: "Finishing WOC is fine — consider a light WOC increase if surface finish allows", high: "Reduce WOC% for finishing passes" },
                  default:   { low: "Increase WOC% or add a flute to get more teeth engaged", ok: `Bump WOC% slightly${form.flutes < 7 ? ` or try ${form.flutes + 1} flutes` : ""} to enter the Sweet Spot (1.5–2.5 teeth)`, high: "Reduce WOC% or use fewer flutes" },
                };
                const tips = tipsByOp[form.mode ?? ""] ?? tipsByOp.default;
                return (
                  <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300 flex items-center gap-1">
                        Tooth Engagement
                        <span className="group relative cursor-pointer">
                          <span className="text-zinc-500 hover:text-zinc-300 text-[10px]">ⓘ</span>
                          <div className="absolute bottom-full left-0 mb-2 w-64 rounded-lg border border-zinc-600 bg-zinc-800 p-3 text-[11px] text-zinc-300 leading-relaxed shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                            <p className="font-bold text-white mb-1">Why tooth engagement matters</p>
                            <p className="mb-1"><span className="text-red-400 font-semibold">Too low (&lt;1.0):</span> Edge rubs on re-entry, work-hardening the surface. Chip load spikes unevenly — built-up edge and poor finish result.</p>
                            <p className="mb-1"><span className="text-orange-400 font-semibold">Too high (&gt;3.0):</span> Chips pack in the flutes, heat spikes, torque overloads spindle. Multiple teeth in simultaneous contact drives chatter.</p>
                            <p><span className="text-green-400 font-semibold">Sweet spot (1.5–2.5):</span> One tooth always cutting while the previous clears. Smooth, continuous force — this is why HEM works so well.</p>
                          </div>
                        </span>
                      </span>
                      <span className={`text-xs font-bold ${zone === "sweet" ? "text-green-400" : zone === "ok" ? "text-yellow-300" : zone === "low" ? "text-red-400" : "text-orange-400"}`}>
                        {tic.toFixed(2)} teeth — {zone === "sweet" ? "Sweet Spot ✓" : zone === "ok" ? "Acceptable" : zone === "low" ? "Too Low" : "Too High"}
                      </span>
                    </div>
                    {/* Gauge bar */}
                    <div className="relative rounded-full overflow-hidden" style={{ height: "18px", background: "#18181b" }}>
                      {/* Zone colors — fully opaque, vivid */}
                      <div className="absolute inset-y-0 left-0" style={{ width: pct(low), background: "#ef4444" }} />
                      <div className="absolute inset-y-0" style={{ left: pct(low), width: `calc(${pct(sweetLo)} - ${pct(low)})`, background: "#eab308" }} />
                      <div className="absolute inset-y-0" style={{ left: pct(sweetLo), width: `calc(${pct(sweetHi)} - ${pct(sweetLo)})`, background: "#22c55e" }} />
                      <div className="absolute inset-y-0" style={{ left: pct(sweetHi), right: 0, background: "#f97316" }} />
                      {/* Marker line */}
                      <div className="absolute inset-y-0" style={{ left: pct(tic), width: "3px", background: "black", transform: "translateX(-50%)", boxShadow: "0 0 6px rgba(0,0,0,0.9)" }} />
                      {/* Value label that follows marker */}
                      <div className="absolute top-0 bottom-0 flex items-center" style={{ left: `calc(${pct(tic)} + 5px)` }}>
                        <span className="text-[10px] font-black text-black drop-shadow" style={{ textShadow: "0 0 4px rgba(255,255,255,0.8)" }}>{tic.toFixed(2)}</span>
                      </div>
                    </div>
                    {/* Zone labels */}
                    <div className="relative text-[9px] font-semibold" style={{ height: "14px" }}>
                      <span className="absolute text-red-400" style={{ left: "0%", transform: "translateX(5%)" }}>Too Low</span>
                      <span className="absolute text-yellow-300" style={{ left: `calc((${pct(low)} + ${pct(sweetLo)}) / 2)`, transform: "translateX(-50%)" }}>Acceptable</span>
                      <span className="absolute text-green-400" style={{ left: `calc((${pct(sweetLo)} + ${pct(sweetHi)}) / 2)`, transform: "translateX(-50%)" }}>Sweet Spot</span>
                      <span className="absolute text-orange-400" style={{ left: `calc((${pct(sweetHi)} + 100%) / 2)`, transform: "translateX(-50%)" }}>Too High</span>
                    </div>
                    {zone !== "sweet" && (
                      <p className="text-[11px] text-zinc-300">
                        {zone === "low" ? `⬆ ${tips.low}` : zone === "high" ? `⬇ ${tips.high}` : `→ ${tips.ok}`}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Engagement Angle Advisory — hidden for circ_interp and face */}
              {form.woc_pct > 0 && form.tool_type !== "chamfer_mill" && form.mode !== "circ_interp" && form.mode !== "face" && (() => {
                const wocFrac = form.woc_pct / 100;
                const arg = Math.max(-1, Math.min(1, 1 - 2 * wocFrac));
                const engAngleDeg = 2 * Math.acos(arg) * (180 / Math.PI);
                const zone = engAngleDeg < 90 ? "light" : engAngleDeg < 180 ? "moderate" : engAngleDeg < 270 ? "heavy" : "extreme";
                const maxDisplay = 360;
                const pct = (v: number) => `${Math.min(100, (v / maxDisplay) * 100).toFixed(1)}%`;
                const tips: Record<string, string> = {
                  light: "Light radial engagement — consider increasing WOC% for better MRR and chip formation.",
                  moderate: "",
                  heavy: "Heavy engagement — monitor heat buildup and ensure adequate chip evacuation.",
                  extreme: "Near-full slot — reduce WOC% to extend tool life and reduce cutting forces.",
                };
                return (
                  <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300 flex items-center gap-1">
                        Engagement Angle
                        <span className="group relative cursor-pointer">
                          <span className="text-zinc-500 hover:text-zinc-300 text-[10px]">ⓘ</span>
                          <div className="absolute bottom-full left-0 mb-2 w-64 rounded-lg border border-zinc-600 bg-zinc-800 p-3 text-[11px] text-zinc-300 leading-relaxed shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                            <p className="font-bold text-white mb-1">Arc of engagement</p>
                            <p className="mb-1">The angle swept by the cutter as it enters and exits the workpiece. Formula: 2×arccos(1 − 2×WOC/D) — the full included arc entry to exit.</p>
                            <p className="mb-1"><span className="text-green-400 font-semibold">Light (&lt;90°):</span> Short arc — low heat per pass. Typical of HEM and trochoidal toolpaths.</p>
                            <p className="mb-1"><span className="text-yellow-300 font-semibold">Moderate (90–180°):</span> Standard conventional milling. Good balance of MRR and tool life.</p>
                            <p className="mb-1"><span className="text-orange-400 font-semibold">Heavy (180–270°):</span> Extended contact arc — high heat, needs strong coolant and chip evacuation.</p>
                            <p><span className="text-red-400 font-semibold">Extreme (&gt;270°):</span> Near full-slot — maximum heat concentration. Limit feed and monitor tool aggressively.</p>
                          </div>
                        </span>
                      </span>
                      <span className={`text-xs font-bold ${zone === "light" || zone === "moderate" ? "text-green-400" : zone === "heavy" ? "text-orange-400" : "text-red-400"}`}>
                        {engAngleDeg.toFixed(1)}° — {zone === "light" ? "Light" : zone === "moderate" ? "Moderate" : zone === "heavy" ? "Heavy" : "Extreme"}
                      </span>
                    </div>
                    {/* Gauge bar */}
                    <div className="relative rounded-full overflow-hidden" style={{ height: "18px", background: "#18181b" }}>
                      <div className="absolute inset-y-0 left-0" style={{ width: pct(90), background: "#22c55e" }} />
                      <div className="absolute inset-y-0" style={{ left: pct(90), width: `calc(${pct(180)} - ${pct(90)})`, background: "#eab308" }} />
                      <div className="absolute inset-y-0" style={{ left: pct(180), width: `calc(${pct(270)} - ${pct(180)})`, background: "#f97316" }} />
                      <div className="absolute inset-y-0" style={{ left: pct(270), right: 0, background: "#ef4444" }} />
                      <div className="absolute inset-y-0" style={{ left: pct(engAngleDeg), width: "3px", background: "black", transform: "translateX(-50%)", boxShadow: "0 0 6px rgba(0,0,0,0.9)" }} />
                      <div className="absolute top-0 bottom-0 flex items-center" style={{ left: `calc(${pct(engAngleDeg)} + 5px)` }}>
                        <span className="text-[10px] font-black text-black drop-shadow" style={{ textShadow: "0 0 4px rgba(255,255,255,0.8)" }}>{engAngleDeg.toFixed(1)}°</span>
                      </div>
                    </div>
                    {/* Zone labels */}
                    <div className="relative text-[9px] font-semibold" style={{ height: "14px" }}>
                      <span className="absolute text-green-400" style={{ left: pct(45), transform: "translateX(-50%)" }}>Light</span>
                      <span className="absolute text-yellow-300" style={{ left: `calc((${pct(90)} + ${pct(180)}) / 2)`, transform: "translateX(-50%)" }}>Moderate</span>
                      <span className="absolute text-orange-400" style={{ left: `calc((${pct(180)} + ${pct(270)}) / 2)`, transform: "translateX(-50%)" }}>Heavy</span>
                      <span className="absolute text-red-400" style={{ left: `calc((${pct(270)} + 100%) / 2)`, transform: "translateX(-50%)" }}>Extreme</span>
                    </div>
                    {tips[zone] && (
                      <p className="text-[11px] text-zinc-300">→ {tips[zone]}</p>
                    )}
                  </div>
                );
              })()}

              {/* Coating — show actual SKU coating if known, otherwise generic recommendation */}
              {form.coating ? (() => {
                const def = getCoatingDef(form.coating);
                const incompatible = coatingIncompatible(form.coating, isoCategory);
                return (
                  <div className="flex flex-col gap-1 px-1 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-muted-foreground">Tool Coating:</span>
                      <span className="font-bold text-orange-400 border border-orange-400/40 rounded px-1.5 py-0.5">{form.coating}</span>
                      {def && (
                        <span className="text-muted-foreground">
                          {def.chemistry} · {def.max_temp_c ? `${def.max_temp_c}°C` : "uncoated"} · {def.sfm_mult >= 1 ? "+" : ""}{Math.round((def.sfm_mult - 1) * 100)}% SFM vs AlTiN
                        </span>
                      )}
                    </div>
                    {incompatible && (
                      <div className="text-amber-400 font-medium">
                        ⚠ {form.coating} is not recommended for {isoCategory}-category materials — coating reacts at cutting temperatures. Switch to A-Max or T-Max.
                      </div>
                    )}
                  </div>
                );
              })() : (() => { const cr = getMillingCoatings(isoCategory); return (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs">
                  <span className="text-muted-foreground">Recommended Coating{cr.coatings.length > 1 ? "s" : ""}:</span>
                  {cr.coatings.map(c => (
                    <span key={c} className="font-bold text-orange-400 border border-orange-400/40 rounded px-1.5 py-0.5">{c}</span>
                  ))}
                  {cr.note && <span className="text-muted-foreground">— {cr.note}</span>}
                </div>
              ); })()}

              {/* Tool life recommendation */}
              {engineering?.tool_life_min != null && (
                <div className="text-xs text-muted-foreground px-1">
                  Estimated tool life: <span className="font-medium text-foreground">{fmtNum(engineering.tool_life_min, 0)} min ({fmtNum(engineering.tool_life_min / 60, 1)} hrs)</span> of cutting time (varies with coating, runout, coolant conditions, machine tool condition, and toolholder condition). <span className="italic">This is an estimate only and is not a guarantee from Core Cutter.</span>
                </div>
              )}

              {/* Entry Moves */}
              {result?.entry_moves && (() => {
                const em = result.entry_moves;
                const caution = em.entry_caution;
                const feedPct = em.entry_feed_pct ?? 50;
                const cautionBanner = caution ? (
                  <div className={`col-span-2 rounded px-2 py-1.5 text-xs leading-snug mb-1 ${caution === "high_hardness" ? "bg-red-950/60 border border-red-500/40 text-red-300" : "bg-amber-950/60 border border-amber-500/40 text-amber-300"}`}>
                    {caution === "high_hardness"
                      ? `⚠ Hard material (≥55 HRC / high-carbide): entry feed reduced to ${feedPct}% of full feed. Edge shock at entry is the #1 cause of first-tooth failure in this material — do not skip the arc lead-in.`
                      : `⚠ Medium-hard material: entry feed reduced to ${feedPct}% of full feed. Avoid straight-in perpendicular entry.`}
                  </div>
                ) : null;
                return (
                  <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/30 px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">Entry Moves</p>
                      <span className="text-[9px] text-zinc-500">★ = recommended</span>
                    </div>

                    {caution && <div className="grid grid-cols-2">{cautionBanner}</div>}

                    <div className="space-y-3 text-xs">

                      {/* Sweep / Roll-in */}
                      {entryTypes.includes("sweep") && (() => {
                        const dia = form.tool_dia ?? 0;
                        const radMin = (em.sweep_arc_radius_min_in != null && em.sweep_arc_radius_min_in > 0) ? em.sweep_arc_radius_min_in : dia * 0.50;
                        const radRec = (em.sweep_arc_radius_rec_in != null && em.sweep_arc_radius_rec_in > 0) ? em.sweep_arc_radius_rec_in : dia * 0.75;
                        const entryFeed = (em.sweep_entry_ipm != null && em.sweep_entry_ipm > 0) ? em.sweep_entry_ipm : (em.standard_ramp_ipm ?? 0);
                        const fullFeed  = (em.sweep_full_ipm  != null && em.sweep_full_ipm  > 0) ? em.sweep_full_ipm  : (result?.milling?.feed_ipm ?? 0);
                        return (
                          <div>
                            <div className="flex items-center gap-1.5 border-b border-green-500/20 pb-1 mb-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-green-400">Sweep / Roll-in ★</span>
                              <span className="text-[9px] text-green-600 ml-1">Recommended — arc builds engagement gradually</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                              <div><span className="text-zinc-500">Arc Radius (min)</span><span className="ml-2 font-medium">{radMin.toFixed(4)}"</span></div>
                              <div><span className="text-zinc-500">Arc Radius (rec)</span><span className="ml-2 font-medium text-green-300">{radRec.toFixed(4)}"</span></div>
                              <div><span className="text-zinc-500">Entry Feed</span><span className="ml-2 font-medium">{entryFeed.toFixed(1)} IPM <span className="text-zinc-500">({feedPct}%)</span></span></div>
                              <div><span className="text-zinc-500">Full Feed (after arc)</span><span className="ml-2 font-medium text-green-300">{fullFeed.toFixed(1)} IPM</span></div>
                            </div>
                            <p className="text-[10px] text-zinc-500 mt-1">Tangent arc approach from outside material. Chip starts at zero, builds to full WOC. Step to full feed once arc completes and engagement stabilizes.</p>
                          </div>
                        );
                      })()}

                      {/* Ramp */}
                      {entryTypes.includes("ramp") && (
                        <div>
                          <div className="border-b border-indigo-500/20 pb-1 mb-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-300">Ramp Entry</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                            <div><span className="text-zinc-500">Max Ramp Angle</span><span className="ml-2 font-medium">≤{em.ramp_angle_deg}°</span></div>
                            <div><span className="text-zinc-500">Entry Feed</span><span className="ml-2 font-medium">{em.standard_ramp_ipm.toFixed(1)} IPM <span className="text-zinc-500">({feedPct}%)</span></span></div>
                            <div className="col-span-2"><span className="text-zinc-500">Advanced Feed</span><span className="ml-2 font-medium text-indigo-300">{em.advanced_ramp_ipm.toFixed(1)} IPM <span className="text-zinc-500">(0.5–1°, chip-thinning)</span></span></div>
                          </div>
                        </div>
                      )}

                      {/* Helical */}
                      {entryTypes.includes("helical") && (
                        <div>
                          <div className="border-b border-indigo-500/20 pb-1 mb-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-300">Helical Entry</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                            <div><span className="text-zinc-500">Min Bore Dia</span><span className="ml-2 font-medium">≥{em.helix_bore_min_in.toFixed(4)}"</span></div>
                            <div><span className="text-zinc-500">Ideal Bore Dia</span><span className="ml-2 font-medium">{em.helix_bore_ideal_low.toFixed(4)}" – {em.helix_bore_ideal_high.toFixed(4)}"</span></div>
                            <div><span className="text-zinc-500">Standard Feed</span><span className="ml-2 font-medium">{em.standard_helix_ipm.toFixed(1)} IPM · {em.helix_pitch_in.toFixed(5)}" / rev @ {em.helix_angle_deg.toFixed(2)}°</span></div>
                            <div><span className="text-zinc-500">Advanced Feed</span><span className="ml-2 font-medium text-indigo-300">{em.advanced_helix_ipm.toFixed(1)} IPM · {(em.adv_helix_pitch_in ?? em.helix_pitch_in).toFixed(5)}" / rev @ {(em.adv_helix_angle_deg ?? em.helix_angle_deg).toFixed(2)}°</span></div>
                          </div>
                          <p className="text-[10px] text-zinc-500 mt-1">Advanced entry uses chip-thinning at light engagement. Use tangent arc lead-in into bore; step to full feed once engagement stabilizes.</p>
                        </div>
                      )}

                      {/* Straight-in */}
                      {entryTypes.includes("straight") && (
                        <div>
                          <div className="border-b border-amber-500/30 pb-1 mb-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-amber-400">Straight-In Entry</span>
                            <span className="text-[9px] text-amber-600 ml-2">Not recommended</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                            <div className="col-span-2"><span className="text-zinc-500">Entry Feed</span><span className="ml-2 font-medium text-amber-300">{em.straight_entry_ipm?.toFixed(1)} IPM <span className="text-zinc-500">({feedPct}% until full engagement)</span></span></div>
                          </div>
                          <p className="text-[10px] text-amber-600/80 mt-1">⚠ Full WOC engages instantly — maximum edge shock. Use only when part geometry prevents arc or ramp approach. Run at {feedPct}% feed minimum; increase to full only after tool is fully engaged.</p>
                        </div>
                      )}

                      {entryTypes.length === 0 && (
                        <p className="text-xs text-zinc-500 italic">No entry types selected — check at least one above.</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Keyseat Details + Tips */}
              {keyseatResult && (
                <div className="mb-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-widest text-indigo-400">Keyseat Details</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Engagement</span><span className="ml-2 font-semibold">Full Slot (100% WOC)</span></div>
                    <div><span className="text-muted-foreground">Pass Depth</span><span className="ml-2 font-semibold">{keyseatResult.doc_in?.toFixed(4)}"</span></div>
                    {keyseatResult.max_safe_doc_in && <div><span className="text-muted-foreground">Max Safe DOC</span><span className="ml-2 font-semibold text-amber-400">{keyseatResult.max_safe_doc_in.toFixed(4)}"</span></div>}
                    {keyseatResult.flute_reach_in && <div><span className="text-muted-foreground">Flute Reach</span><span className="ml-2 font-semibold">{keyseatResult.flute_reach_in.toFixed(4)}"</span></div>}
                    {keyseatResult.arbor_dia_in && <div><span className="text-muted-foreground">Arbor Dia</span><span className="ml-2 font-semibold text-orange-400">{keyseatResult.arbor_dia_in.toFixed(4)}"</span></div>}
                  </div>
                  {keyseatResult.tips?.map((tip: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground leading-relaxed">• {tip}</p>
                  ))}
                </div>
              )}

              {/* Stability / Strength Audit — keyseat structured panel */}
              {operation === "keyseat" && customer.notes && (customer.notes as string[]).length > 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 text-base">⚠</span>
                    <span className="text-xs font-bold uppercase tracking-widest text-amber-400">Stability / Strength Audit</span>
                  </div>
                  <ul className="space-y-2">
                    {(customer.notes as string[]).map((note, i) => {
                      const isWarning = note.startsWith("⚠");
                      return (
                        <li key={i} className={`flex gap-2 text-xs leading-relaxed ${isWarning ? "text-red-300 font-semibold" : "text-amber-200"}`}>
                          <span className="mt-0.5 shrink-0">{isWarning ? "🔴" : "•"}</span>
                          <span>{note.replace(/^⚠\s*/, "")}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {keyseatResult?.multi_pass && keyseatResult.multi_pass.num_passes > 1 && (() => {
                    const mp = keyseatResult.multi_pass;
                    const n = mp.num_passes;
                    const d = mp.depth_per_pass_in;
                    const total = mp.final_slot_depth_in;
                    const passes = Array.from({ length: n }, (_, i) => ({
                      label: n === 1 ? "Pass 1 (single pass)" : i < n - 1 ? `Pass ${i + 1} (roughing)` : `Pass ${n} (finish)`,
                      doc: d,
                      cumulative: (i + 1) * d,
                    }));
                    const matLower = form.material.toLowerCase();
                    const reasons: string[] = [];
                    if (keyseatResult.arbor_dia_in && keyseatResult.arbor_dia_in / (form.tool_dia || 1) < 0.5)
                      reasons.push("narrow neck relative to cutter — reduced rigidity");
                    if (["steel","stainless","inconel","titanium","hastelloy","waspaloy"].some(k => matLower.includes(k)))
                      reasons.push("tough material — multi-pass preserves tool life");
                    return (
                      <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2.5 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Pass Strategy</p>
                          <span className="text-muted-foreground font-medium">{n} passes</span>
                        </div>
                        {reasons.length > 0 && (
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            <span className="text-zinc-500">Why: </span>{reasons.join(", ")}.
                          </p>
                        )}
                        <div className="space-y-1">
                          {passes.map((p, i) => (
                            <div key={i} className="flex items-center justify-between text-[11px]">
                              <span className="text-zinc-400">{p.label}</span>
                              <span className="font-medium text-foreground tabular-nums">{p.doc.toFixed(4)}" DOC</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] text-zinc-500 leading-relaxed">
                          Total slot depth: <span className="text-foreground font-medium">{total.toFixed(4)}"</span>
                          {` · max safe pass depth: `}<span className="text-foreground font-medium">{mp.max_safe_doc_in.toFixed(4)}"</span>
                        </p>
                      </div>
                    );
                  })()}
                </div>
              ) : operation !== "keyseat" && customer.notes && (customer.notes as string[]).length > 0 ? (
                <div className={`rounded-xl border p-3 text-sm space-y-1 ${
                  customer.risk === "warning"
                    ? "border-red-500/40 bg-red-500/8 text-red-300"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-300"
                }`}>
                  {(customer.notes as string[]).map((note, i) => (
                    <div key={i}>{note}</div>
                  ))}
                </div>
              ) : null}

              {/* Feed limiter hint banner — only for non-Deflection limiters; stability section covers deflection */}
              {customer.status_hint && customer.status !== "User input" && customer.status !== "Deflection" ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <span className="font-semibold">Feed limited by {customer.status}:</span>{" "}
                  {customer.status_hint}
                </div>
              ) : null}

            </>
          )}
        </CardContent>
      </Card>

      {/* MACHINING STABILITY INDEX + RIGIDITY AUDIT — milling only */}
      {operation === "milling" && (stabilityIndex || stability) && (
      <div className="rounded-2xl border border-amber-500/30 overflow-hidden">

      {/* MACHINING STABILITY INDEX */}
      {stabilityIndex && (() => {
        const si = stabilityIndex.overall;
        const siLabel = si >= 80 ? "Excellent" : si >= 65 ? "Good" : si >= 50 ? "Moderate" : si >= 35 ? "Caution" : "High Risk";
        const siColor = si >= 65 ? "text-emerald-400" : si >= 35 ? "text-amber-400" : "text-red-400";
        return (
        <Card className="rounded-none border-0 border-b border-amber-500/20">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between gap-4">
              {/* Big score */}
              <div className="flex flex-col items-start">
                <span className={`text-xs font-semibold uppercase tracking-wide ${siColor}`}>
                  {siLabel}
                </span>
                <div className="flex items-baseline gap-1">
                  <span className={`text-5xl font-black leading-none ${siColor}`}>
                    {stabilityIndex.overall}
                  </span>
                  <span className="text-zinc-500 text-xl font-light leading-none">/100</span>
                </div>
              </div>
              {/* Sub-scores */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                {(() => {
                  const deflPct = stability?.deflection_pct;
                  const ld      = stability?.l_over_d;
                  const loadPct = result?.customer?.spindle_load_pct;
                  const ct      = result?.engineering?.chip_thickness_in;
                  const minCt   = (result?.customer?.fpt ?? 0) * 0.30;

                  const deflResult = deflPct != null
                    ? deflPct < 100  ? `✓ Deflection is within safe zone (${deflPct.toFixed(0)}% of limit).`
                    : deflPct < 175  ? `⚠ Deflection exceeds safe limit (${deflPct.toFixed(0)}% of limit) — reduce stickout.`
                    :                  `⚠ Significant over-deflection (${deflPct.toFixed(0)}% of limit) — adjust setup.`
                    : null;

                  const loadResult = loadPct != null
                    ? loadPct < 50   ? `✓ Light load — ${loadPct.toFixed(0)}% of available HP. Plenty of headroom.`
                    : loadPct < 80   ? `✓ Moderate load — ${loadPct.toFixed(0)}% of available HP.`
                    : loadPct < 100  ? `⚠ High load — ${loadPct.toFixed(0)}% of available HP. Monitor for stall.`
                    :                  `⚠ Over limit — ${loadPct.toFixed(0)}% of available HP. Reduce feedrate.`
                    : null;

                  const chipResult = ct != null
                    ? ct >= minCt    ? `✓ Chip thickness ${ct.toFixed(5)}" — tool is cutting cleanly.`
                    :                  `⚠ Chip thickness ${ct.toFixed(5)}" is near rubbing threshold (min ~${minCt.toFixed(5)}") — consider increasing feed.`
                    : null;

                  const ldResult = ld != null
                    ? ld <= 3        ? `✓ L/D is ${ld.toFixed(1)}× — excellent rigidity.`
                    : ld <= 5        ? `⚠ L/D is ${ld.toFixed(1)}× — moderate vibration risk. Reduce stickout if possible.`
                    :                  `⚠ L/D is ${ld.toFixed(1)}× — high chatter risk. Reduce stickout.`
                    : null;

                  return ([
                    ["Defl Score",   stabilityIndex.defl, "Tool deflection score (higher = better). 100 = well within safe limit; 0 = deflection at or beyond safe limit — chatter very likely. See '% of safe limit' below for the raw deflection figure.",     deflResult],
                    ["Mach Load",    stabilityIndex.load, "Spindle power usage vs. available HP. 100 = very light load; drops as HP required approaches machine limit. Only shown when Machine HP is entered.", loadResult],
                    ["Chip Quality", stabilityIndex.chip, "Chip thickness relative to the minimum needed to cut cleanly (~30% of chipload). Too thin = rubbing instead of cutting, which accelerates wear and heat.", null],
                    ["L/D Ratio",    stabilityIndex.ld,   "Length-to-diameter ratio of tool stickout. Below 3× is ideal; above 5× introduces significant vibration risk. Shorter is always stiffer.", ldResult],
                  ] as [string, number, string, string | null][]).map(([label, score, hint, resultLine]) => (
                  <div key={label} className="flex items-center gap-2">
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-zinc-500 w-24 cursor-default flex items-center gap-0.5">
                            {label}
                            <span className="text-muted-foreground/50 text-[9px] leading-none">ⓘ</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-64 text-xs">
                          <p>{hint}</p>
                          {resultLine && <p className="mt-1.5 font-semibold border-t border-zinc-600 pt-1.5">{resultLine}</p>}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {score === -1 ? (
                      <span className="text-xs text-zinc-600 italic">enter machine HP</span>
                    ) : (
                      <>
                        <div className="flex-1 h-1.5 rounded-full bg-zinc-800 min-w-[60px]">
                          <div
                            className={`h-full rounded-full ${score >= 65 ? "bg-emerald-400" : score >= 35 ? "bg-amber-400" : "bg-red-400"}`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                        <span className={`text-right font-semibold text-xs ${score >= 65 ? "text-emerald-400" : score >= 35 ? "text-amber-400" : "text-red-400"}`}>{score}<span className="text-zinc-600 font-normal">/100</span></span>
                      </>
                    )}
                  </div>
                ));
                })()}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Machining Stability Index — composite of deflection, spindle load, chip quality, and L/D ratio</p>
          </CardContent>
        </Card>
        );
      })()}

      {/* STABILITY ADVISOR CARD */}
      {stability ? (
        <>
          {(() => {

            const pct = stability.deflection_pct;
            const isRed    = pct >= 175;
            const isYellow = pct >= 100 && pct < 175;
            const isGreen  = pct < 100;

            const verdict =
              pct >= 175 ? "High Chatter Risk" :
              pct >= 100 ? "Chatter Risk" :
                           "Setup Looks Stable";

            const verdictColor =
              isRed    ? "text-red-400" :
              isYellow ? "text-amber-400" :
                         "text-emerald-500";

            const explanation =
              pct >= 175
                ? "Deflection is significantly over the safe limit — chatter, vibration, and poor surface finish are likely. Review the suggestions below and adjust setup before running."
                : pct >= 100
                ? "Deflection exceeds the safe limit. The setup may run with careful monitoring, but expect some vibration and reduced surface finish or tool life. Review suggestions below."
                : "Deflection is within the safe zone. This setup should produce good surface finish and tool life.";

            // First suggestion that is an actual action (not info/lbs)
            const firstActionIdx = stability.suggestions.findIndex((s: any) => s.type !== "lbs" && s.type !== "info");

            return (
              <Card className="rounded-none border-0">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">Rigidity & Chatter Audit</CardTitle>
                    <span className={`text-sm font-semibold whitespace-nowrap ${verdictColor}`}>
                      {verdict}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">

                  {/* Plain-language verdict */}
                  <div className={`text-sm rounded-lg px-3 py-2 ${isRed ? "bg-red-950/40 text-red-200" : isYellow ? "bg-amber-950/40 text-amber-200" : "bg-emerald-950/30 text-emerald-200"}`}>
                    {explanation}
                  </div>

                  {/* Tech detail row */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Stickout <span className="font-medium text-foreground">{UC(stability.stickout_in, 25.4, metric ? 1 : 2)}{metric ? "mm" : "\""}</span>
                      {" · "}L/D <span className="font-medium text-foreground">{fmtNum(stability.l_over_d, 1)}</span>
                      <span className="ml-1 text-muted-foreground/60">(length-to-diameter ratio)</span>
                    </span>
                    <span className={`font-medium ${verdictColor}`}>
                      {fmtNum(pct, 0)}% of safe limit
                    </span>
                  </div>

                  {/* Deflection bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={isRed ? "h-full rounded-full bg-red-500" : isYellow ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-emerald-500"}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>

                  {/* Suggestions */}
                  {stability.suggestions.length > 0 ? (
                    <>
                      {(() => {
                        const actionItems = stability.suggestions.filter((s: any) => s.type !== "info");
                        const infoItems   = stability.suggestions.filter((s: any) => s.type === "info");
                        return (
                          <>
                            {actionItems.length > 0 && (
                              <>
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
                                  Possible Improvements
                                </div>
                                <ul className="space-y-2">
                                  {actionItems.map((s: any, idx: number) => {
                                    const isBest = stability.suggestions.indexOf(s) === firstActionIdx && isRed;
                                    return (
                                      <li key={idx} className={`flex items-start gap-2 text-sm rounded-lg px-2 py-1.5 ${isBest ? "bg-muted/50 border border-muted" : ""}`}>
                                        <span className="mt-0.5 text-xs font-bold leading-none text-muted-foreground w-4 shrink-0 text-center">{idx + 1}</span>
                                        <span className="flex-1">
                                          <span className="font-medium">{s.label}</span>
                                          {isBest && (
                                            <span className="ml-2 text-xs font-semibold text-orange-400 uppercase tracking-wide">best fix</span>
                                          )}
                                          {s.detail ? (
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                              {s.detail}
                                              {(() => {
                                                const edps = s.suggested_edps?.length ? s.suggested_edps : s.suggested_edp ? [s.suggested_edp] : [];
                                                const dia = form.tool_dia || 0.5;
                                                const minWoc = form.geometry === "truncated_rougher" ? 10 : 8;
                                                const cbInactive = (form.geometry === "chipbreaker" || form.geometry === "truncated_rougher") && (form.woc_pct < minWoc || form.doc_xd < 1.0);
                                                if (!edps.length || cbInactive) return null;
                                                return (
                                                  <span className="ml-2 inline-flex items-center gap-2 flex-wrap">
                                                    <span className="font-semibold text-amber-400">EDP# {edps.join(", ")}</span>
                                                  </span>
                                                );
                                              })()}
                                            </div>
                                          ) : null}
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </>
                            )}
                            {infoItems.map((s: any, idx: number) => (
                              <div key={idx} className="mt-2 flex items-start gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
                                <span className="mt-0.5 shrink-0 font-bold">ℹ</span>
                                <span>
                                  <span className="font-semibold">{s.label}</span>
                                  {s.detail && <div className="mt-0.5 opacity-80">{s.detail}</div>}
                                </span>
                              </div>
                            ))}
                          </>
                        );
                      })()}
                    </>
                  ) : null}

                </CardContent>
              </Card>
            );
          })()}
        </>
      ) : null}

      </div>
      )}

      </div>
      </div>} {/* end grid */}

      {/* Toolbox */}
      {mentor.data && (
        <div className="mt-5 rounded-xl border border-indigo-700/50 bg-indigo-950/30 px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-indigo-200 leading-snug">🧰 Save to Toolbox</p>
              <p className="text-xs text-zinc-500 leading-snug mt-0.5">
                Saves this setup to your account so you can pull it up again in any future session — no re-entering parameters.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={saveToToolbox}
                disabled={tbSaving}
                className="rounded-lg border border-indigo-500 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 text-sm font-semibold px-4 py-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {tbSaved ? "✓ Saved" : tbSaving ? "Saving…" : "Save Setup"}
              </button>
              <a href="/toolbox" className="text-xs text-indigo-400 hover:text-indigo-300 whitespace-nowrap">View Toolbox →</a>
            </div>
          </div>
        </div>
      )}

      {/* Email Results — lead capture */}
      {mentor.data && erStatus !== "sent" && (
        <div className="mt-5 rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200 leading-snug">
                Email me these results
              </p>
              <p className="text-xs text-zinc-500 leading-snug mt-0.5">
                Get a copy sent to your inbox — no account required.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="email"
                placeholder="your@email.com"
                value={erEmail}
                onChange={e => { setErEmail(e.target.value); setErError(""); setErStatus("idle"); }}
                onKeyDown={e => { if (e.key === "Enter") emailResults(); }}
                className="w-52 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                disabled={erStatus === "sending"}
              />
              <button
                onClick={emailResults}
                disabled={erStatus === "sending" || !erEmail.trim()}
                className="rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-3 py-1.5 text-sm font-medium text-white transition-colors whitespace-nowrap"
              >
                {erStatus === "sending" ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
          {erError && <p className="mt-1 text-xs text-red-400">{erError}</p>}
        </div>
      )}
      {mentor.data && erStatus === "sent" && (
        <div className="mt-5 rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-3 flex items-center justify-between gap-2 text-sm text-emerald-300">
          <div className="flex items-center gap-2">
            <span className="text-base">✓</span>
            <span>Sent! Check your inbox at <span className="font-medium">{erEmail}</span>.</span>
          </div>
          <button onClick={() => setErStatus("idle")} className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2 shrink-0">Send again</button>
        </div>
      )}

      {/* Finishing tips — shown at bottom of results when finish mode */}
      {mentor.data && form.mode === "finish" && (
        <div className="mt-4 rounded-md border border-sky-700/40 bg-sky-950/30 px-3 py-2 text-[11px] text-sky-200 space-y-1">
          <p className="font-bold text-sky-100 text-[11px] uppercase tracking-wide mb-1">Finishing Tips</p>
          <p>• WOC <span className="text-white">3–5% of diameter</span> — biggest lever for finish quality</p>
          <p>• DOC <span className="text-white">1–1.5×D</span> — one full-length pass beats stacked shallow cuts</p>
          <p>• <span className="text-white">Climb mill</span> always — less rubbing, better Ra, longer tool life</p>
          <p>• <span className="text-white">Spring pass:</span> repeat same path at zero offset to remove deflection stock</p>
          <p>• Leave <span className="text-white">0.005–0.015" stock</span> after roughing before finishing</p>
          <p>• <span className="text-white">Stickout ≤3×D</span> — check this before adjusting speeds if chatter appears</p>
          <p>• <span className="text-white">Runout &lt;0.0005"</span> at tip — causes lobing if exceeded</p>
          <p>• <span className="text-white">Increase SFM 10–15%, reduce feed 15–25%</span> vs roughing</p>
          <p>• <span className="text-white">Al:</span> air blast, D-Max/uncoated &nbsp;|&nbsp; <span className="text-white">Steel:</span> steady flood coolant &nbsp;|&nbsp; <span className="text-white">SS/Ti:</span> conservative SFM</p>
        </div>
      )}



      {/* HEM / Trochoidal tips */}
      {mentor.data && (form.mode === "hem" || form.mode === "trochoidal") && (
        <div className="mt-4 rounded-md border border-sky-700/40 bg-sky-950/30 px-3 py-2 text-[11px] text-sky-200 space-y-1">
          <p className="font-bold text-sky-100 text-[11px] uppercase tracking-wide mb-1">HEM / Trochoidal Tips</p>
          <p>• <span className="text-white">WOC 5–15% of tool diameter</span> is the sweet spot — keeps chip thinning in the useful range and arc of engagement low enough to prevent heat buildup</p>
          <p>• <span className="text-white">Full LOC engagement</span> is the goal — use 1×D DOC or more. Distributes wear over the entire flute length instead of burning out the bottom edge</p>
          <p>• <span className="text-white">High-feed, high-RPM</span> — HEM feeds are much higher than conventional. If feed sounds alarming, check SFM and IPT; the physics are correct</p>
          <p>• <span className="text-white">Chip evacuation is critical</span> — chips are thin but numerous. Flood coolant directed at the cut or high-pressure air. Poor evacuation re-cuts chips and kills tool life fast</p>
          <p>• <span className="text-white">Entering solid stock (no pre-hole)?</span> Use a helical interpolation entry in CAM — ramp the tool in a continuous helix (circular XY + descending Z) to depth, then open to width with HEM passes. Set ramp feed to <strong>40–50% of the lateral feed</strong> shown in results. Ramp angle ≤2–3° for most endmills; verify center-cutting geometry.</p>
          <p>• <span className="text-white">Core post check:</span> If helically entering a pocket, the tool must be ≥ half the final bore/pocket diameter to pass through center and avoid leaving a standing post. Min tool diameter = bore diameter ÷ 2. Use the <strong>No Middle Post</strong> calculator in the Calculators tab for a live check.</p>
          <p>• <span className="text-white">Avoid dwell and sharp direction changes</span> — trochoidal loops must be smooth arcs. Any abrupt deceleration inside the cut causes a heat spike at the tool edge</p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="mt-6 px-1 text-[11px] text-muted-foreground/60 leading-relaxed border-t border-border pt-4">
        The speeds and feeds shown are recommended starting values only. Actual results will vary depending on the machine, setup rigidity, tooling, coolant, and material condition — adjust parameters as necessary. Core Cutter LLC accepts no responsibility for application results.
        <span className="ml-2">· Developed by S. Tiehen</span>
      </div>

      {/* Footer branding */}
      <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/COREcutCNC_HORZ.png" alt="CoreCutCNC" className="h-12 w-auto" style={{ mixBlendMode: "screen" }} />
        </div>
        <div className="text-right text-[11px] text-muted-foreground/60 leading-snug">
          <div>Generated by CoreCutCNC</div>
          <div>Speeds • Feeds • Intelligence</div>
          <div>Powered by Core Cutter LLC</div>
        </div>
      </div>

    {/* Email Gate Modal */}
    {erGateOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setErGateOpen(false)}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-base font-semibold text-white mb-1">Enter your email to continue</h2>
          <p className="text-xs text-zinc-400 mb-4">
            {erGatePending === "stp" ? "We'll unlock the STEP file download." : erGatePending === "copy" ? "We'll unlock copy & all exports." : "We'll unlock PDF export & all outputs."}
            {" "}One-time per device — auto-fills after.
          </p>
          <input
            type="email"
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
            placeholder="your@email.com"
            value={erGateInput}
            onChange={e => { setErGateInput(e.target.value); setErGateError(""); }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                const v = erGateInput.trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setErGateError("Enter a valid email address."); return; }
                localStorage.setItem("er_email", v.toLowerCase());
                setErEmail(v.toLowerCase());
                setErGateOpen(false);
                if (erGatePending) runGatedAction(erGatePending, erGateStpUrl || undefined);
                setErGatePending(null);
              }
            }}
            autoFocus
          />
          {erGateError && <p className="text-xs text-red-400 mt-1">{erGateError}</p>}
          <div className="flex gap-2 mt-3">
            <button
              className="flex-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg py-2 text-sm font-medium"
              onClick={() => {
                const v = erGateInput.trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setErGateError("Enter a valid email address."); return; }
                localStorage.setItem("er_email", v.toLowerCase());
                setErEmail(v.toLowerCase());
                setErGateOpen(false);
                if (erGatePending) runGatedAction(erGatePending, erGateStpUrl || undefined);
                setErGatePending(null);
              }}
            >
              Continue
            </button>
            <button className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm" onClick={() => setErGateOpen(false)}>Cancel</button>
          </div>
        </div>
      </div>
    )}

    {/* Contact Modal — "Not sure which tool?" */}
    {showContactModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowContactModal(false); setContactStatus("idle"); }}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
          {contactStatus === "sent" ? (
            <>
              <div className="text-emerald-400 text-2xl mb-2">✓</div>
              <h2 className="text-base font-semibold text-white mb-1">Message received!</h2>
              <p className="text-xs text-zinc-400 mb-4">Our team will reach out at <span className="text-white">{contactEmail}</span> with a recommendation.</p>
              <button className="w-full bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm" onClick={() => { setShowContactModal(false); setContactStatus("idle"); }}>Close</button>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-white mb-1">Not sure which tool you need?</h2>
              <p className="text-xs text-zinc-400 mb-4">Tell us what you're trying to cut and we'll point you to the right tool.</p>
              <div className="space-y-2">
                <input type="text" placeholder="Your name" value={contactName} onChange={e => setContactName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500" />
                <input type="email" placeholder="your@email.com *" value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500" />
                <textarea placeholder="What are you trying to cut? Material, depth, finish requirements…" value={contactMsg} onChange={e => setContactMsg(e.target.value)} rows={3}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500 resize-none" />
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium"
                  disabled={contactStatus === "sending" || !contactEmail.trim()}
                  onClick={submitContactModal}
                >
                  {contactStatus === "sending" ? "Sending…" : "Send Request"}
                </button>
                <button className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm" onClick={() => { setShowContactModal(false); setContactStatus("idle"); }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    )}

    {/* Toolbox auth modal */}
    {tbShowModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setTbShowModal(false)}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-base font-semibold text-white mb-1">🧰 Save to Toolbox</h2>
          {tbStep === "email" && (<>
            <p className="text-xs text-zinc-400 mb-3">Enter your email to save this result. We'll send you a quick verification code.</p>
            <input
              type="text"
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 mb-2 focus:outline-none focus:border-indigo-500"
              placeholder="Title (optional)"
              value={tbTitle}
              onChange={e => setTbTitle(e.target.value)}
            />
            <input
              type="email"
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
              placeholder="your@email.com"
              value={tbInputEmail}
              onChange={e => setTbInputEmail(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") tbSendCode(); }}
              autoFocus
            />
            {tbError && <p className="text-xs text-red-400 mt-1">{tbError}</p>}
            <div className="flex gap-2 mt-3">
              <button className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50" onClick={tbSendCode} disabled={tbSaving || !tbInputEmail}>{tbSaving ? "Sending…" : "Send Code"}</button>
              <button className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm" onClick={() => setTbShowModal(false)}>Cancel</button>
            </div>
          </>)}
          {tbStep === "code" && (<>
            <p className="text-xs text-zinc-400 mb-3">Enter the 6-digit code sent to <span className="text-white">{tbInputEmail}</span></p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white text-center tracking-widest text-lg placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
              placeholder="000000"
              value={tbInputCode}
              onChange={e => setTbInputCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={e => { if (e.key === "Enter" && tbInputCode.length === 6) tbVerifyCode(); }}
              autoFocus
            />
            {tbError && <p className="text-xs text-red-400 mt-1">{tbError}</p>}
            <div className="flex gap-2 mt-3">
              <button className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50" onClick={tbVerifyCode} disabled={tbSaving || tbInputCode.length !== 6}>{tbSaving ? "Verifying…" : "Verify & Save"}</button>
              <button className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm" onClick={() => { setTbStep("email"); setTbError(""); setTbInputCode(""); }}>← Back</button>
            </div>
          </>)}
          {tbStep === "saving" && (
            <p className="text-sm text-zinc-400 text-center py-4">Saving…</p>
          )}
        </div>
      </div>
    )}

    {/* Save Machine Modal */}
    {showSaveMachineModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSaveMachineModal(false)}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-base font-semibold text-white mb-1">Save Machine</h2>
          <p className="text-xs text-zinc-400 mb-4">Save the current machine settings to your Toolbox for quick recall.</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Nickname <span className="text-red-400">*</span></label>
              <input
                type="text"
                placeholder="e.g. Shop Floor VF-2, Cell 3 Mazak"
                value={machineNickname}
                onChange={e => setMachineNickname(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Shop Machine #</label>
                <input
                  type="text"
                  placeholder="e.g. M-12, Cell 3"
                  value={machineShopNo}
                  onChange={e => setMachineShopNo(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Serial Number</label>
                <input
                  type="text"
                  placeholder="From machine nameplate"
                  value={machineSerial}
                  onChange={e => setMachineSerial(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
            {(form.max_rpm > 0 || form.machine_hp > 0) && (
              <div className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400 space-y-0.5">
                <div className="font-semibold text-zinc-300 mb-1">Current settings being saved:</div>
                {activeMachineName && <div>Model: <span className="text-white">{activeMachineName}</span></div>}
                {form.max_rpm > 0 && <div>Max RPM: <span className="text-white">{form.max_rpm.toLocaleString()}</span></div>}
                {form.machine_hp > 0 && <div>Spindle HP: <span className="text-white">{form.machine_hp}</span></div>}
                <div>Taper: <span className="text-white">{form.spindle_taper}{form.dual_contact ? " (Dual Contact)" : ""}</span></div>
                <div>Drive: <span className="text-white">{form.spindle_drive}</span></div>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-5">
            <button
              type="button"
              onClick={() => setShowSaveMachineModal(false)}
              className="flex-1 rounded-lg border border-zinc-700 py-2 text-sm text-zinc-400 hover:text-white"
            >Cancel</button>
            <button
              type="button"
              onClick={saveMachine}
              disabled={!machineNickname.trim() || machineSaving}
              className="flex-1 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 py-2 text-sm font-semibold text-white"
            >{machineSaving ? "Saving…" : "Save Machine"}</button>
          </div>
          {(!tbEmail && !localStorage.getItem("tb_email")) && (
            <p className="text-xs text-amber-400 mt-3 text-center">You'll be asked to sign in to your Toolbox first.</p>
          )}
        </div>
      </div>
    )}

    {/* Engineering Mode Password Modal */}
    {showEngModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowEngModal(false)}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-base font-semibold text-white mb-1">Engineering Mode</h2>
          <p className="text-xs text-zinc-400 mb-4">Enter the engineering password to access all manual controls.</p>
          <div className="relative">
            <input
              type={showEngPassword ? "text" : "password"}
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 pr-9 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
              placeholder="Password"
              value={engPasswordInput}
              onChange={e => setEngPasswordInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") enterEngMode(); }}
              autoFocus
            />
            <button type="button" onClick={() => setShowEngPassword(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs">
              {showEngPassword ? "🙈" : "👁️"}
            </button>
          </div>
          {engPasswordError && <p className="text-xs text-red-400 mt-1">{engPasswordError}</p>}
          <div className="flex gap-2 mt-3">
            <button
              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              onClick={enterEngMode}
              disabled={engAuthLoading}
            >
              {engAuthLoading ? "Checking…" : "Unlock"}
            </button>
            <button
              className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm"
              onClick={() => { setShowEngModal(false); setEngPasswordInput(""); setEngPasswordError(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}

    </div>
  );
}