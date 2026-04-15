import * as React from "react";

// ─────────────────────────────────────────────────────────────────
// Print registry — collects active calc results for PDF output
// ─────────────────────────────────────────────────────────────────
type PrintRow = { label: string; value: string; highlight?: boolean };
type PrintEntry = { category: string; title: string; rows: PrintRow[] };
const PrintCtx = React.createContext<React.MutableRefObject<Map<string, PrintEntry>> | null>(null);

function usePrintRegister(title: string, category: string, rows: PrintRow[] | null) {
  const reg = React.useContext(PrintCtx);
  React.useEffect(() => {
    if (!reg) return;
    if (rows && rows.length > 0) {
      reg.current.set(title, { category, title, rows });
    } else {
      reg.current.delete(title);
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function n(v: string): number {
  if (!v) return 0;
  const trimmed = v.trim();
  // Support fractions: "1/2", "3/8", "1 1/2" etc.
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = trimmed.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return parseFloat(trimmed) || 0;
}
function fmt(v: number, dec = 4): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  return v.toFixed(dec);
}
function fmtIn(v: number): string {
  // returns fractional-ish inch display for tap drills
  const fracs: [number, string][] = [
    [1/64,"1/64"],[1/32,"1/32"],[3/64,"3/64"],[1/16,"1/16"],[5/64,"5/64"],
    [3/32,"3/32"],[7/64,"7/64"],[1/8,"1/8"],[9/64,"9/64"],[5/32,"5/32"],
    [11/64,"11/64"],[3/16,"3/16"],[13/64,"13/64"],[7/32,"7/32"],[15/64,"15/64"],
    [1/4,"1/4"],[17/64,"17/64"],[9/32,"9/32"],[19/64,"19/64"],[5/16,"5/16"],
    [21/64,"21/64"],[11/32,"11/32"],[23/64,"23/64"],[3/8,"3/8"],[25/64,"25/64"],
    [13/32,"13/32"],[27/64,"27/64"],[7/16,"7/16"],[29/64,"29/64"],[15/32,"15/32"],
    [31/64,"31/64"],[1/2,"1/2"],[33/64,"33/64"],[17/32,"17/32"],[35/64,"35/64"],
    [9/16,"9/16"],[37/64,"37/64"],[19/32,"19/32"],[39/64,"39/64"],[5/8,"5/8"],
    [41/64,"41/64"],[21/32,"21/32"],[43/64,"43/64"],[11/16,"11/16"],
    [45/64,"45/64"],[23/32,"23/32"],[47/64,"47/64"],[3/4,"3/4"],
    [49/64,"49/64"],[25/32,"25/32"],[51/64,"51/64"],[13/16,"13/16"],
    [53/64,"53/64"],[27/32,"27/32"],[55/64,"55/64"],[7/8,"7/8"],
    [57/64,"57/64"],[29/32,"29/32"],[59/64,"59/64"],[15/16,"15/16"],
    [61/64,"61/64"],[31/32,"31/32"],[63/64,"63/64"],[1,"1"],
  ];
  const closest = fracs.reduce((a, b) => Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a);
  if (Math.abs(closest[0] - v) < 0.0005) return `${closest[1]}"`;
  return `${v.toFixed(4)}"`;
}

// ─────────────────────────────────────────────────────────────────
// Metric context — provided at page level, consumed by each calc
// ─────────────────────────────────────────────────────────────────
const MetricCtx = React.createContext(false);
const useMetric = () => React.useContext(MetricCtx);

// ─────────────────────────────────────────────────────────────────
// Card shell
// ─────────────────────────────────────────────────────────────────
const CAT_COLOR: Record<string, string> = {
  "Speed & Feed":     "#6366f1",
  "Surface Finish":   "#10b981",
  "Arcs & Contours":  "#f97316",
  "Hole Making":      "#0ea5e9",
  "Power & MRR":      "#f43f5e",
  "Materials":        "#a78bfa",
  "Conversions":      "#f59e0b",
};

function CalcCard({
  title, category, children, onClear, gcode,
}: { title: string; category: string; children: React.ReactNode; onClear?: () => void; gcode?: boolean }) {
  const color = CAT_COLOR[category] ?? "#6366f1";
  return (
    <div style={{ borderLeft: `3px solid ${color}`, background: "#16213e" }}
      className="rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white flex-1">{title}</span>
        {gcode && (
          <span className="text-[9px] font-semibold tracking-wide px-1.5 py-0.5 rounded border border-green-700 text-green-400 bg-green-950/40 shrink-0">G-CODE</span>
        )}
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            title="Clear inputs"
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500"
          >Clear</button>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 text-[11px] text-gray-400 shrink-0 flex items-center gap-1">
        {label}
        {hint && (
          <span className="relative inline-flex">
            <button
              type="button"
              onMouseEnter={() => setShow(true)}
              onMouseLeave={() => setShow(false)}
              onFocus={() => setShow(true)}
              onBlur={() => setShow(false)}
              className="w-3.5 h-3.5 rounded-full bg-gray-700 text-gray-400 text-[8px] font-bold leading-none flex items-center justify-center hover:bg-gray-600 shrink-0"
            >?</button>
            {show && (
              <div className="absolute left-5 top-0 z-50 w-52 rounded bg-gray-800 border border-gray-600 px-2.5 py-2 text-[10px] text-gray-200 shadow-lg leading-relaxed whitespace-normal">
                {hint}
              </div>
            )}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

function NumIn({
  value, onChange, unit, placeholder,
}: { value: string; onChange: (v: string) => void; unit?: string; placeholder?: string }) {
  function handleChange(raw: string) {
    // Accept fractions like 1/2, 3/8 — resolve on blur via the n() helper downstream
    onChange(raw);
  }
  return (
    <div className="flex items-center gap-1 flex-1">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder ?? "0"}
        className="w-full rounded bg-[#0d1b2a] border border-[#2d2d4a] text-white text-xs px-2 py-1.5
                   focus:outline-none focus:border-indigo-500"
      />
      {unit && <span className="text-[11px] text-gray-500 shrink-0 w-8">{unit}</span>}
    </div>
  );
}

function Result({
  label, value, highlight,
}: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded"
      style={{ background: highlight ? "#1a1500" : "#0d1b2a" }}>
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className={`text-sm font-mono font-semibold ${highlight ? "text-yellow-300" : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shared WOC input — accepts decimal inches or % of diameter
// ─────────────────────────────────────────────────────────────────
function WocInput({ dia, value, onChange, metric, hint }: {
  dia: number; value: string; onChange: (raw: string, parsed: number) => void;
  metric?: boolean; hint?: string;
}) {
  const dU = metric ? "mm" : "in";
  const [text, setText] = React.useState(value);
  // keep external resets in sync
  React.useEffect(() => { if (!value) setText(""); }, [value]);

  const parse = (raw: string): number => {
    const t = raw.trim();
    if (!t) return 0;
    if (t.endsWith("%")) return (parseFloat(t) / 100) * dia;
    const v = parseFloat(t);
    if (isNaN(v)) return 0;
    if (v >= 1.5) return (v / 100) * dia; // bare number ≥1.5 treated as %
    return metric ? v / 25.4 : v;
  };

  const handleBlur = () => {
    if (!text.trim() || dia <= 0) return;
    const parsed = parse(text);
    if (parsed > 0) {
      const pct = (parsed / dia) * 100;
      const display = `${pct.toFixed(1)}%`;
      setText(display);
      onChange(display, parsed);
    }
  };

  return (
    <Row label="Radial WOC" hint={hint ?? "Enter as decimal (0.125) or percentage (20% or 20)."}>
      <div className="relative flex-1">
        <input
          type="text" inputMode="decimal"
          className="w-full bg-[#1a1a2e] border border-[#2d2d4a] rounded px-2 py-1 text-sm text-white pr-12"
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={handleBlur}
          placeholder={metric ? "e.g. 20% or 3.175" : "e.g. 20% or 0.125"}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">%/{dU}</span>
      </div>
    </Row>
  );
}

// ─────────────────────────────────────────────────────────────────
// 1. RPM ↔ SFM
// ─────────────────────────────────────────────────────────────────
function RpmSfm() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";
  const sU = metric ? "m/min" : "SFM";

  const [dia, setDia] = React.useState("");
  const [sfm, setSfm] = React.useState("");
  const [rpm, setRpm] = React.useState("");

  const d = metric ? n(dia) / 25.4 : n(dia);
  const s = metric ? n(sfm) / 0.3048 : n(sfm);
  const calcRpm = d > 0 && s > 0 ? (s * 3.8197) / d : null;
  const calcSfm = d > 0 && n(rpm) > 0 ? (n(rpm) * d) / 3.8197 : null;
  const calcSfmDisplay = calcSfm !== null ? (metric ? calcSfm * 0.3048 : calcSfm) : null;

  // Cross-fill: computed result populates the opposing field
  const rpmFieldValue = rpm !== "" ? rpm : (calcRpm !== null ? String(Math.round(calcRpm)) : "");
  const sfmFieldValue = sfm !== "" ? sfm : (calcSfmDisplay !== null ? String(Math.round(calcSfmDisplay)) : "");

  const printRows: PrintRow[] = [];
  if (dia) printRows.push({ label: `Cutting Diameter (${dU})`, value: dia });
  if (calcRpm !== null) { printRows.push({ label: `Surface Speed (${sU})`, value: sfm }); printRows.push({ label: "RPM", value: Math.round(calcRpm).toLocaleString(), highlight: true }); }
  if (calcSfmDisplay !== null) { printRows.push({ label: "Spindle Speed (RPM)", value: rpm }); printRows.push({ label: `Surface Speed (${sU})`, value: Math.round(calcSfmDisplay).toLocaleString(), highlight: true }); }
  usePrintRegister("RPM ↔ SFM", "Speed & Feed", printRows.length > 1 ? printRows : null);

  return (
    <CalcCard title="RPM ↔ SFM" category="Speed & Feed" onClear={() => { setDia(""); setSfm(""); setRpm(""); }}>
      <Row label="Cutting Diameter" hint="Cutting diameter of the tool — not the shank diameter.">
        <NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} />
      </Row>
      <Row label="Surface Speed" hint="Enter SFM to calculate RPM, or leave blank and enter RPM below.">
        <NumIn value={sfmFieldValue} onChange={v => { setSfm(v); setRpm(""); }} unit={sU} placeholder={metric ? "60" : "200"} />
      </Row>
      <Row label="Spindle Speed" hint="Enter RPM to calculate SFM, or leave blank and enter SFM above.">
        <NumIn value={rpmFieldValue} onChange={v => { setRpm(v); setSfm(""); }} unit="RPM" placeholder="3500" />
      </Row>
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 2. IPM Calculator
// ─────────────────────────────────────────────────────────────────
function IpmCalc() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";
  const sU = metric ? "m/min" : "SFM";
  const fU = metric ? "mm/min" : "IPM";

  const [sfm,    setSfm]    = React.useState("");
  const [dia,    setDia]    = React.useState("");
  const [rpm,    setRpm]    = React.useState("");
  const [flutes, setFlutes] = React.useState("");
  const [fpt,    setFpt]    = React.useState("");
  const [ipm,    setIpm]    = React.useState("");

  const sfm_in = metric ? n(sfm) / 0.3048 : n(sfm);
  const dia_in = metric ? n(dia) / 25.4    : n(dia);

  // SFM+dia → RPM, or RPM → SFM+dia display
  const rpmFromSfm  = sfm_in > 0 && dia_in > 0 ? (sfm_in * 3.8197) / dia_in : 0;
  const sfmFromRpm  = n(rpm) > 0 && dia_in > 0  ? (n(rpm) * dia_in) / 3.8197  : 0;
  const R = n(rpm) > 0 ? n(rpm) : rpmFromSfm;
  const F = n(flutes);

  // FPT → IPM
  const fpt_in = metric ? n(fpt) / 25.4 : n(fpt);
  const calcIpm = R > 0 && F > 0 && fpt_in > 0 ? R * F * fpt_in : null;
  const calcIpmDisplay = calcIpm !== null ? (metric ? calcIpm * 25.4 : calcIpm) : null;

  // IPM → FPT
  const ipm_in = metric ? n(ipm) / 25.4 : n(ipm);
  const calcFpt = R > 0 && F > 0 && ipm_in > 0 ? ipm_in / (R * F) : null;
  const calcFptDisplay = calcFpt !== null ? (metric ? calcFpt * 25.4 : calcFpt) : null;

  // Cross-fill: show computed result in the opposing field (read-only appearance via placeholder-style)
  const ipmFieldValue = ipm !== "" ? ipm : (calcIpmDisplay !== null ? calcIpmDisplay.toFixed(metric ? 2 : 1) : "");
  const fptFieldValue = fpt !== "" ? fpt : (calcFptDisplay !== null ? calcFptDisplay.toFixed(metric ? 3 : 4) : "");

  const printRows: PrintRow[] = [];
  if (sfm) printRows.push({ label: `Surface Speed (${sU})`, value: sfm });
  if (dia) printRows.push({ label: `Cutting Diameter (${dU})`, value: dia });
  if (rpm) printRows.push({ label: "Spindle Speed (RPM)", value: rpm });
  if (flutes) printRows.push({ label: "Flutes", value: flutes });
  if (calcIpmDisplay !== null) { printRows.push({ label: `Feed / Tooth (${dU})`, value: fpt }); printRows.push({ label: `Feed Rate (${fU})`, value: calcIpmDisplay.toFixed(metric ? 2 : 1), highlight: true }); }
  if (calcFptDisplay !== null) { printRows.push({ label: `Feed Rate (${fU})`, value: ipm }); printRows.push({ label: `Feed / Tooth (${dU})`, value: calcFptDisplay.toFixed(metric ? 3 : 4), highlight: true }); }
  usePrintRegister("Feed Rate ↔ FPT", "Speed & Feed", printRows.length > 2 ? printRows : null);

  return (
    <CalcCard title="Feed Rate ↔ FPT" category="Speed & Feed" onClear={() => { setSfm(""); setDia(""); setRpm(""); setFlutes(""); setFpt(""); setIpm(""); }}>
      <Row label="Cutting Diameter" hint="Required when entering SFM.">
        <NumIn value={dia} onChange={v => { setDia(v); }} unit={dU} placeholder={metric ? "12.700" : "0.5000"} />
      </Row>
      <Row label="Flutes" hint="Number of cutting edges on the tool."><NumIn value={flutes} onChange={setFlutes} placeholder="4" /></Row>
      <Row label={`Surface Speed (${sU})`} hint="Enter SFM + diameter to auto-fill RPM below.">
        <NumIn value={sfm} onChange={v => { setSfm(v); }} unit={sU} placeholder={metric ? "60" : "200"} />
      </Row>
      <Row label="Spindle Speed" hint="Enter RPM directly, or it auto-fills from SFM + diameter above.">
        <NumIn value={rpm || (rpmFromSfm > 0 ? String(Math.round(rpmFromSfm)) : "")}
          onChange={v => { setRpm(v); }}
          unit="RPM" placeholder="3500" />
      </Row>
      {n(rpm) > 0 && sfmFromRpm > 0 && !sfm && (
        <p className="text-[10px] text-gray-500 -mt-1 mb-1 pl-1">
          {sU}: {metric ? (sfmFromRpm * 0.3048).toFixed(1) : Math.round(sfmFromRpm).toLocaleString()} {sU}
          {dia_in > 0 ? "" : " (enter diameter to calculate SFM)"}
        </p>
      )}
      <div className="border-t border-[#2d2d4a] pt-2">
        <Row label="Feed / Tooth" hint="Enter FPT to get Feed Rate, or enter Feed Rate below to get FPT.">
          <NumIn
            value={fptFieldValue}
            onChange={v => { setFpt(v); setIpm(""); }}
            unit={dU}
            placeholder={metric ? "0.127" : "0.0050"}
          />
        </Row>
        <Row label="Feed Rate" hint="Enter Feed Rate to get FPT, or enter FPT above to get Feed Rate.">
          <NumIn
            value={ipmFieldValue}
            onChange={v => { setIpm(v); setFpt(""); }}
            unit={fU}
            placeholder={metric ? "500" : "20.0"}
          />
        </Row>
      </div>
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 3. Chip Thinning
// ─────────────────────────────────────────────────────────────────
function ChipThinning() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";
  const fU = metric ? "mm/min" : "IPM";

  const [dia,     setDia]     = React.useState("");
  const [woc,     setWoc]     = React.useState("");
  const [fpt,     setFpt]     = React.useState("");
  const [ipm,     setIpm]     = React.useState("");
  const [rpm,     setRpm]     = React.useState("");
  const [flutes,  setFlutes]  = React.useState("");

  const D  = metric ? n(dia)/25.4 : n(dia);

  const ae = n(woc) > 0 ? (metric ? n(woc) / 25.4 : n(woc)) : 0;
  const R  = n(rpm);
  const F  = n(flutes);

  // Cross-fill FPT ↔ IPM
  const fz_entered = metric ? n(fpt)/25.4 : n(fpt);
  const ipm_entered = metric ? n(ipm)/25.4 : n(ipm);
  const calcFptFromIpm = R > 0 && F > 0 && ipm_entered > 0 ? ipm_entered / (R * F) : null;
  const calcIpmFromFpt = R > 0 && F > 0 && fz_entered > 0  ? fz_entered  * R * F  : null;
  const fz = fpt !== "" ? fz_entered : (calcFptFromIpm ?? 0);
  const fptFieldValue = fpt !== "" ? fpt : (calcFptFromIpm !== null ? (metric ? calcFptFromIpm * 25.4 : calcFptFromIpm).toFixed(metric ? 4 : 5) : "");
  const ipmFieldValue = ipm !== "" ? ipm : (calcIpmFromFpt !== null ? (metric ? calcIpmFromFpt * 25.4 : calcIpmFromFpt).toFixed(metric ? 2 : 1) : "");

  let result = null;
  if (D > 0 && ae > 0 && ae <= D && fz > 0) {
    const ratio = 1 - 2 * ae / D;
    const sinAngle = Math.sqrt(1 - ratio * ratio);
    const hex = fz * sinAngle;
    const ctFactor = sinAngle;
    const corrFpt = ae < D / 2 ? fz / sinAngle : fz;
    const progIpm  = R > 0 && F > 0 ? fz      * R * F : null;
    const actualIpm = R > 0 && F > 0 ? hex     * R * F : null;
    const adjIpm   = R > 0 && F > 0 ? corrFpt * R * F : null;
    result = { hex, ctFactor, corrFpt, progIpm, actualIpm, adjIpm };
  }

  const IN = metric ? 25.4 : 1;

  usePrintRegister("Chip Thinning", "Speed & Feed", result ? [
    { label: `Cutting Diameter (${dU})`, value: dia },
    { label: `Radial WOC (${dU})`, value: woc },
    { label: `Programmed FPT (${dU})`, value: fpt },
    ...(rpm ? [{ label: "Spindle Speed (RPM)", value: rpm }] : []),
    ...(flutes ? [{ label: "Flutes", value: flutes }] : []),
    { label: `Actual Chip Thickness (${dU})`, value: (result.hex * IN).toFixed(metric ? 4 : 5) },
    ...(ae < D / 2 ? [{ label: `Adj FPT to Maintain Proper Chip Thickness (${dU})`, value: (result.corrFpt * IN).toFixed(metric ? 4 : 5), highlight: true }] : []),
    ...(result.adjIpm !== null ? [{ label: `Adj Feed Rate (${fU})`, value: (metric ? result.adjIpm * 25.4 : result.adjIpm).toFixed(metric ? 2 : 1), highlight: true }] : []),
  ] : null);

  return (
    <CalcCard title="Chip Thinning" category="Speed & Feed" onClear={() => { setDia(""); setWoc(""); setFpt(""); setIpm(""); setRpm(""); setFlutes(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        At WOC &lt; 50% diameter, programmed FPT over-estimates chip thickness.
      </p>
      <Row label="Cutting Diameter" hint="Cutting diameter of the tool."><NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <Row label="Flutes" hint="Optional — enter with RPM to see feed rates."><NumIn value={flutes} onChange={setFlutes} placeholder="4" /></Row>
      <Row label="Spindle Speed" hint="Optional — enter with flutes to see feed rates."><NumIn value={rpm} onChange={setRpm} unit="RPM" placeholder="3500" /></Row>
      <WocInput dia={D} value={woc} metric={metric} hint="At less than 50% diameter, chip thinning occurs and programmed FPT overstates actual chip thickness." onChange={(_, parsed) => setWoc(String(parsed))} />
      <Row label="Programmed FPT" hint="Enter FPT to calculate feed rate, or enter feed rate below."><NumIn value={fptFieldValue} onChange={v => { setFpt(v); setIpm(""); }} unit={dU} placeholder={metric ? "0.127" : "0.0050"} /></Row>
      <Row label="Programmed Feed Rate" hint="Enter feed rate to calculate FPT, or enter FPT above."><NumIn value={ipmFieldValue} onChange={v => { setIpm(v); setFpt(""); }} unit={fU} placeholder={metric ? "500" : "20.0"} /></Row>
      {result && <>
        <Result label="Engagement" value={`${(ae / D * 100).toFixed(1)}% dia`} />
        {result.progIpm !== null && (
          <Result label="Programmed Feed Rate"
            value={`${fz * IN > 0 ? (fz * IN).toFixed(metric ? 4 : 5) : ""} ${dU}  (${(metric ? result.progIpm * 25.4 : result.progIpm).toFixed(metric ? 2 : 1)} ${fU})`} />
        )}
        <Result label="Actual Chip Thickness"
          value={result.actualIpm !== null
            ? `${(result.hex * IN).toFixed(metric ? 4 : 5)} ${dU}  (${(metric ? result.actualIpm * 25.4 : result.actualIpm).toFixed(metric ? 2 : 1)} ${fU})`
            : `${(result.hex * IN).toFixed(metric ? 4 : 5)} ${dU}`} />
        {ae < D / 2 && (() => {
          const corrFptDisplay = (result.corrFpt * IN).toFixed(metric ? 4 : 5);
          const adjIpmDisplay  = result.adjIpm !== null
            ? (metric ? result.adjIpm * 25.4 : result.adjIpm).toFixed(metric ? 2 : 1)
            : null;
          return (
            <Result
              label="Adj FPT to Maintain Proper Chip Thickness"
              value={adjIpmDisplay !== null
                ? `${corrFptDisplay} ${dU}  (${adjIpmDisplay} ${fU})`
                : `${corrFptDisplay} ${dU}`}
              highlight
            />
          );
        })()}
        {ae >= D / 2 && (
          <div className="text-[11px] text-emerald-400 px-1">✓ WOC ≥ 50% — no chip thinning correction needed.</div>
        )}
        <p className="text-[10px] text-gray-500 px-1 pt-1 border-t border-[#2d2d4a] mt-1">
          Note: adjusted feed is a geometric correction only. Final feed rate should also account for material type, hardness, and toolpath being used.
        </p>
      </>}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 4. Cusp Height (Ball End Mill)
// ─────────────────────────────────────────────────────────────────
function CuspHeight() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [dia,      setDia]      = React.useState("");
  const [stepover, setStepover] = React.useState("");

  const D_in = metric ? n(dia)/25.4 : n(dia);
  const sw_in = metric ? n(stepover)/25.4 : n(stepover);
  const R = D_in / 2;
  let h: number | null = null, ra: number | null = null;
  if (R > 0 && sw_in > 0 && sw_in <= D_in) {
    h  = R - Math.sqrt(R * R - (sw_in / 2) * (sw_in / 2));
    ra = h / 4;
  }

  usePrintRegister("Cusp Height — Ball End", "Surface Finish", h !== null ? [
    { label: `Cutting Diameter (${dU})`, value: dia },
    { label: `Step-Over (${dU})`, value: stepover },
    { label: `Cusp Height (${dU})`, value: metric ? (h * 25.4).toFixed(4) : h.toFixed(5), highlight: true },
    { label: metric ? "Theoretical Ra (µm)" : "Theoretical Ra (µin)", value: metric ? `~${(ra! * 25400).toFixed(3)}` : `~${(ra! * 1000).toFixed(3)}` },
    { label: "Step-Over / Dia", value: `${(sw_in / D_in * 100).toFixed(1)}%` },
  ] : null);

  return (
    <CalcCard title="Cusp Height — Ball End" category="Surface Finish" onClear={() => { setDia(""); setStepover(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Scallop height left between passes when 3D surfacing with a ball end mill.
      </p>
      <Row label="Cutting Diameter"><NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <Row label="Step-Over"><NumIn value={stepover} onChange={setStepover} unit={dU} placeholder={metric ? "0.508" : "0.0200"} /></Row>
      {h !== null && <>
        <Result label="Cusp Height" value={metric ? `${(h * 25.4).toFixed(4)} mm` : `${h.toFixed(5)}"`} highlight />
        <Result label="Theoretical Ra" value={metric ? `~${(ra! * 25400).toFixed(3)} µm` : `~${(ra! * 1000).toFixed(3)} µin`} />
        <Result label="Step-Over / Dia" value={`${(sw_in / D_in * 100).toFixed(1)}%`} />
        {h > 0.001 && (
          <div className="border-t border-[#2d2d4a] pt-2 mt-1">
            <p className="text-[10px] text-amber-400 font-semibold mb-1">How to fix it</p>
            <p className="text-[10px] text-gray-400">Cusp height rises with the square of stepover — halving stepover reduces scallop by 4×. Reduce step-over, or use a larger ball end mill for the same pass spacing.</p>
          </div>
        )}
      </>}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 5. Effective Cutting Diameter (Ball End at Depth)
// ─────────────────────────────────────────────────────────────────
function EffectiveDia() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [dia, setDia] = React.useState("");
  const [ap,  setAp]  = React.useState("");

  const D = metric ? n(dia)/25.4 : n(dia);
  const a = metric ? n(ap)/25.4  : n(ap);
  let deff: number | null = null, sCorrect: number | null = null;
  if (D > 0 && a > 0 && a <= D / 2) {
    deff     = 2 * Math.sqrt(a * (D - a));
    sCorrect = deff / D;
  }

  usePrintRegister("Effective Dia — Ball End", "Surface Finish", deff !== null ? [
    { label: `Cutting Diameter (${dU})`, value: dia },
    { label: `Axial DOC (${dU})`, value: ap },
    { label: `Effective Diameter (${dU})`, value: metric ? (deff * 25.4).toFixed(4) : deff.toFixed(5), highlight: true },
    { label: "SFM Correction", value: `${(sCorrect! * 100).toFixed(1)}% of nominal` },
  ] : null);

  return (
    <CalcCard title="Effective Dia — Ball End" category="Surface Finish" onClear={() => { setDia(""); setAp(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        At shallow DOC, a ball end mill's effective diameter is less than its nominal size —
        use Deff for accurate SFM.
      </p>
      <Row label="Cutting Diameter"><NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <Row label="Axial DOC (ap)"><NumIn value={ap} onChange={setAp} unit={dU} placeholder={metric ? "0.254" : "0.0100"} /></Row>
      {deff !== null && <>
        <Result label="Effective Dia" value={metric ? `${(deff * 25.4).toFixed(4)} mm` : `${deff.toFixed(5)}"`} highlight />
        <Result label="SFM Correction" value={`${(sCorrect! * 100).toFixed(1)}% of nominal`} />
        <Result label="Note" value={a < D * 0.05 ? "⚠ Very shallow — SFM significantly reduced" : "✓"} />
      </>}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 6 & 7. Feed Arc Correction (Inside + Outside combined)
// ─────────────────────────────────────────────────────────────────
function FeedArcCorrection() {
  const metric = useMetric();
  const [feed,    setFeed]    = React.useState("");
  const [arcR,    setArcR]    = React.useState("");
  const [toolDia, setToolDia] = React.useState("");

  // All inputs already in user's unit; formula ratios are unit-agnostic
  const F = n(feed), R = n(arcR), r = n(toolDia) / 2;
  let inside: number | null = null, outside: number | null = null;
  if (F > 0 && R > r && r > 0) {
    inside  = F * (R - r) / R;
    outside = F * (R + r) / R;
  }

  return (
    <CalcCard title="Feed Correction — Arc" category="Arcs & Contours" onClear={() => { setFeed(""); setArcR(""); setToolDia(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        CAM programs the tool centerline. Adjust programmed feed to maintain
        consistent chip load around inside (concave) and outside (convex) arcs.
      </p>
      <Row label="Programmed Feed" hint="The feed rate programmed in CAM along the tool centerline path."><NumIn value={feed} onChange={setFeed} unit={metric ? "mm/min" : "IPM"} placeholder={metric ? "500" : "20.0"} /></Row>
      <Row label="Arc Radius (part)" hint="The radius of the arc feature on the part — not the tool radius."><NumIn value={arcR} onChange={setArcR} unit={metric ? "mm" : "in"} placeholder={metric ? "25.4" : "1.000"} /></Row>
      <Row label="Cutting Diameter" hint="Cutting diameter of the tool. Used to calculate centerline offset from the part arc."><NumIn value={toolDia} onChange={setToolDia} unit={metric ? "mm" : "in"} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      {inside !== null && <>
        <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
          <p className="text-[10px] text-orange-400 font-semibold">Inside Arc (concave — pocket corner)</p>
          <Result label="Corrected Feed" value={`${inside.toFixed(1)} ${metric ? "mm/min" : "IPM"}`} highlight />
          <Result label="Reduction" value={`${(((F - inside) / F) * 100).toFixed(1)}% less than straight`} />
        </div>
        <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
          <p className="text-[10px] text-sky-400 font-semibold">Outside Arc (convex — boss / corner)</p>
          <Result label="Corrected Feed" value={`${outside!.toFixed(1)} ${metric ? "mm/min" : "IPM"}`} highlight />
          <Result label="Increase" value={`${((( outside! - F) / F) * 100).toFixed(1)}% more than straight`} />
        </div>
        {(((F - inside) / F) * 100) > 25 && (
          <div className="border-t border-[#2d2d4a] pt-2">
            <p className="text-[10px] text-amber-400 font-semibold mb-1">How to fix it — tight inside arc</p>
            <p className="text-[10px] text-gray-400">Feed spikes on tight inside arcs because the tool wraps more of the corner. Increase the arc radius in CAM (larger corner blend), or reduce your programmed feed before the arc segment. A radius ≥ 2× tool radius keeps the correction under 50%.</p>
          </div>
        )}
      </>}
      {R > 0 && R <= r && r > 0 && (
        <p className="text-[11px] text-red-400">⚠ Arc radius must be larger than tool radius ({r.toFixed(metric ? 2 : 4)} {metric ? "mm" : '"'})</p>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 8. Tap Drill Size
// ─────────────────────────────────────────────────────────────────
function TapDrill() {
  const [major,    setMajor]    = React.useState("");
  const [tpi,      setTpi]      = React.useState("");
  const [engPct,   setEngPct]   = React.useState("75");

  const D = n(major), T = n(tpi), pct = n(engPct);
  let drill: number | null = null;
  if (D > 0 && T > 0 && pct > 0 && pct <= 100) {
    // UN 60° thread: h_theoretical = 0.866025/TPI; full depth = 2h = 1.7320/TPI
    drill = D - (pct / 100) * (1.2990 / T);
  }

  const [major_mm, setMajorMm] = React.useState("");
  const [pitch_mm, setPitchMm] = React.useState("");
  const Dm = n(major_mm), Pm = n(pitch_mm);
  let drill_m: number | null = null;
  if (Dm > 0 && Pm > 0 && pct > 0) {
    // Metric: h = 0.866025 × pitch; full = 1.7321×pitch
    drill_m = Dm - (pct / 100) * (1.2990 * Pm);
  }

  return (
    <CalcCard title="Tap Drill Size" category="Hole Making" onClear={() => { setMajor(""); setTpi(""); setEngPct("75"); setMajorMm(""); setPitchMm(""); }}>
      <Row label="% Thread Engagement">
        <NumIn value={engPct} onChange={setEngPct} unit="%" placeholder="75" />
      </Row>
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">UN Threads (inch)</p>
        <Row label="Major Dia"><NumIn value={major} onChange={setMajor} unit="in" placeholder="0.5000" /></Row>
        <Row label="TPI"><NumIn value={tpi} onChange={setTpi} placeholder="13" /></Row>
        {drill !== null && drill > 0 && <>
          <Result label="Tap Drill" value={`${drill.toFixed(4)}"`} highlight />
          <Result label="Nearest Fraction" value={fmtIn(drill)} />
          <Result label="Drill (mm)" value={`${(drill * 25.4).toFixed(3)} mm`} />
        </>}
      </div>
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">Metric Threads</p>
        <Row label="Major Dia (mm)"><NumIn value={major_mm} onChange={setMajorMm} unit="mm" placeholder="12" /></Row>
        <Row label="Pitch (mm)"><NumIn value={pitch_mm} onChange={setPitchMm} unit="mm" placeholder="1.75" /></Row>
        {drill_m !== null && drill_m > 0 && <>
          <Result label="Tap Drill" value={`${drill_m.toFixed(3)} mm`} highlight />
          <Result label="Drill (in)" value={`${(drill_m / 25.4).toFixed(4)}"`} />
        </>}
      </div>
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 9. Drill Point Depth
// ─────────────────────────────────────────────────────────────────
function DrillPointDepth() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [dia,   setDia]   = React.useState("");
  const [angle, setAngle] = React.useState("118");

  const D_in = metric ? n(dia)/25.4 : n(dia);
  const A = n(angle);
  let depth_in: number | null = null;
  if (D_in > 0 && A > 0 && A < 180) {
    depth_in = (D_in / 2) / Math.tan((A / 2) * Math.PI / 180);
  }
  const depth_display = depth_in !== null ? (metric ? depth_in * 25.4 : depth_in) : null;

  return (
    <CalcCard title="Drill Point Length" category="Hole Making" onClear={() => { setDia(""); setAngle("118"); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Extra depth to add for the drill tip when drilling to a full-diameter depth.
      </p>
      <Row label="Drill Diameter"><NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <Row label="Point Angle">
        <div className="flex gap-1 flex-1">
          {[118, 135, 140].map((a) => (
            <button key={a} type="button"
              onClick={() => setAngle(String(a))}
              className="rounded px-2 py-1 text-[11px] border transition-all"
              style={{
                background: angle === String(a) ? "#6366f1" : "transparent",
                borderColor: "#6366f1",
                color: angle === String(a) ? "#fff" : "#6366f1",
              }}
            >{a}°</button>
          ))}
          <NumIn value={angle} onChange={setAngle} unit="°" />
        </div>
      </Row>
      {depth_display !== null && <>
        <Result label="Point Length" value={`${depth_display.toFixed(metric ? 4 : 5)} ${dU}`} highlight />
      </>}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Drilling Torque
// ─────────────────────────────────────────────────────────────────
function DrillingTorque() {
  const [hp,      setHp]      = React.useState("");
  const [rpm,     setRpm]     = React.useState("");
  const [torque,  setTorque]  = React.useState("");
  const [torqueN, setTorqueN] = React.useState("");
  const [kw,      setKw]      = React.useState("");

  // HP + RPM → Torque
  const calcTorque     = n(hp) > 0 && n(rpm) > 0 ? (63025 * n(hp)) / n(rpm) : null;
  const calcTorqueNm   = calcTorque !== null ? calcTorque * 0.112985 : null;

  // Torque (in-lbs) + RPM → HP
  const calcHpFromT    = n(torque) > 0 && n(rpm) > 0 ? (n(torque) * n(rpm)) / 63025 : null;

  // kW + RPM → Torque (N-m)
  const calcTorqueFromKw   = n(kw) > 0 && n(rpm) > 0 ? (9549 * n(kw)) / n(rpm) : null;
  const calcTorqueInFromKw = calcTorqueFromKw !== null ? calcTorqueFromKw / 0.112985 : null;

  // Torque (N-m) + RPM → kW
  const calcKwFromNm   = n(torqueN) > 0 && n(rpm) > 0 ? (n(torqueN) * n(rpm)) / 9549 : null;

  usePrintRegister("Drilling Torque", "Hole Making", (calcTorque !== null || calcHpFromT !== null || calcTorqueFromKw !== null) ? [
    ...(calcTorque !== null ? [
      { label: "Spindle Power (HP)", value: hp },
      { label: "Spindle Speed (RPM)", value: rpm },
      { label: "Torque (in-lbs)", value: calcTorque.toFixed(2), highlight: true },
      { label: "Torque (N-m)", value: calcTorqueNm!.toFixed(3) },
    ] : []),
    ...(calcHpFromT !== null ? [
      { label: "Torque (in-lbs)", value: torque },
      { label: "Spindle Speed (RPM)", value: rpm },
      { label: "Power Required (HP)", value: calcHpFromT.toFixed(3), highlight: true },
    ] : []),
  ] : null);

  return (
    <CalcCard title="Drilling Torque" category="Hole Making"
      onClear={() => { setHp(""); setRpm(""); setTorque(""); setTorqueN(""); setKw(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        T = 63,025 × HP / RPM (in-lbs) &nbsp;|&nbsp; T = 9,549 × kW / RPM (N-m)
      </p>

      {/* Inch: HP + RPM → Torque */}
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">HP + RPM → Torque</p>
        <Row label="Spindle Power" hint="Available spindle horsepower at the cut — derate nameplate HP by drive efficiency (~92–96%)."><NumIn value={hp} onChange={setHp} unit="HP" placeholder="20" /></Row>
        <Row label="Spindle Speed" hint="Drilling RPM for the operation."><NumIn value={rpm} onChange={setRpm} unit="RPM" placeholder="3500" /></Row>
        {calcTorque !== null && <>
          <Result label="Torque" value={`${calcTorque.toFixed(2)} in-lbs`} highlight />
          <Result label="Torque (metric)" value={`${calcTorqueNm!.toFixed(3)} N-m`} />
        </>}
      </div>

      {/* Inch: Torque + RPM → HP */}
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">Torque + RPM → HP</p>
        <Row label="Torque (in-lbs)" hint="Known or measured torque at the spindle."><NumIn value={torque} onChange={setTorque} unit="in-lbs" /></Row>
        {calcHpFromT !== null && <Result label="Power Required" value={`${calcHpFromT.toFixed(3)} HP`} highlight />}
      </div>

      {/* Metric: kW + RPM → N-m */}
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">kW + RPM → N-m</p>
        <Row label="Spindle Power" hint="Spindle power in kilowatts."><NumIn value={kw} onChange={setKw} unit="kW" /></Row>
        {calcTorqueFromKw !== null && <>
          <Result label="Torque" value={`${calcTorqueFromKw.toFixed(3)} N-m`} highlight />
          <Result label="Torque (inch)" value={`${calcTorqueInFromKw!.toFixed(2)} in-lbs`} />
        </>}
      </div>

      {/* Metric: N-m + RPM → kW */}
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">N-m + RPM → kW</p>
        <Row label="Torque (N-m)" hint="Known or measured torque in Newton-meters."><NumIn value={torqueN} onChange={setTorqueN} unit="N-m" /></Row>
        {calcKwFromNm !== null && <Result label="Power Required" value={`${calcKwFromNm.toFixed(3)} kW`} highlight />}
      </div>
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 10. Metal Removal Rate
// ─────────────────────────────────────────────────────────────────
function MRR() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";
  const fU = metric ? "mm/min" : "IPM";

  const [woc, setWoc] = React.useState("");
  const [doc, setDoc] = React.useState("");
  const [ipm, setIpm] = React.useState("");

  // Convert inputs to inches for calculation
  const woc_in = metric ? n(woc)/25.4 : n(woc);
  const doc_in = metric ? n(doc)/25.4 : n(doc);
  const ipm_in = metric ? n(ipm)/25.4 : n(ipm);

  const mrr_in3 = woc_in * doc_in * ipm_in;  // in³/min
  const mrr_display = metric ? mrr_in3 * 16387.064 : mrr_in3; // cm³/min if metric
  const valid = woc_in > 0 && doc_in > 0 && ipm_in > 0;

  const HP_KC: [string, number][] = [
    ["Aluminum",    0.3],
    ["Steel 4140",  1.1],
    ["Stainless",   1.3],
    ["Titanium",    1.4],
    ["Inconel",     2.2],
  ];

  usePrintRegister("MRR & HP Estimate", "Power & MRR", valid ? [
    { label: `WOC (${dU})`, value: woc },
    { label: `DOC (${dU})`, value: doc },
    { label: `Feed Rate (${fU})`, value: ipm },
    { label: metric ? "MRR (cm³/min)" : "MRR (in³/min)", value: mrr_display.toFixed(metric ? 2 : 3), highlight: true },
    ...HP_KC.map(([mat, kc]) => ({ label: `HP — ${mat}`, value: (mrr_in3 * kc).toFixed(2) })),
  ] : null);

  return (
    <CalcCard title="MRR & HP Estimate" category="Power & MRR" onClear={() => { setWoc(""); setDoc(""); setIpm(""); }}>
      <Row label="WOC (radial)" hint="Radial width of cut — how far the tool engages the workpiece side-to-side."><NumIn value={woc} onChange={setWoc} unit={dU} placeholder={metric ? "3.175" : "0.125"} /></Row>
      <Row label="DOC (axial)" hint="Axial depth of cut — how deep the tool plunges into the material."><NumIn value={doc} onChange={setDoc} unit={dU} placeholder={metric ? "3.175" : "0.125"} /></Row>
      <Row label="Feed Rate" hint="Table feed — how fast the tool moves through the material."><NumIn value={ipm} onChange={setIpm} unit={fU} placeholder={metric ? "500" : "20.0"} /></Row>
      {valid && <>
        <Result label="Metal Removal Rate" value={metric ? `${mrr_display.toFixed(2)} cm³/min` : `${mrr_display.toFixed(3)} in³/min`} highlight />
        <div className="border-t border-[#2d2d4a] pt-2">
          <p className="text-[10px] text-gray-500 mb-1.5">HP at Spindle (approximate)</p>
          {HP_KC.map(([mat, kc]) => (
            <div key={mat} className="flex justify-between text-[11px] py-0.5">
              <span className="text-gray-400">{mat}</span>
              <span className="text-white font-mono">{(mrr_in3 * kc).toFixed(2)} HP</span>
            </div>
          ))}
        </div>
        <div className="border-t border-[#2d2d4a] pt-2 mt-1">
          <p className="text-[10px] text-amber-400 font-semibold mb-1">How to fix it — if HP exceeds machine capacity</p>
          <p className="text-[10px] text-gray-400">Reduce WOC first (biggest impact on MRR), then DOC, then feed rate. In tough materials, drop to HEM strategy — much smaller WOC with higher feed keeps HP manageable while maintaining tool life.</p>
        </div>
      </>}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// 11. Surface Finish Ra from Step-Over (flat end mill)
// ─────────────────────────────────────────────────────────────────
function SurfaceFinishFlat() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [dia,      setDia]      = React.useState("");
  const [stepover, setStepover] = React.useState("");

  const D = metric ? n(dia)/25.4 : n(dia);
  const ae = metric ? n(stepover)/25.4 : n(stepover);
  let ra_cusp: number | null = null;
  if (D > 0 && ae > 0 && ae <= D) {
    ra_cusp = (ae * ae) / (8 * (D / 2));  // inches
  }

  usePrintRegister("Surface Finish (Step-Over)", "Surface Finish", ra_cusp !== null ? [
    { label: `Cutting Diameter (${dU})`, value: dia },
    { label: `Step-Over (${dU})`, value: stepover },
    { label: `Step / Dia`, value: `${((ae / D) * 100).toFixed(1)}%` },
    { label: metric ? "Theoretical Ra (µm)" : "Theoretical Ra (µin)", value: metric ? `~${(ra_cusp * 25400 / 4).toFixed(3)}` : `~${(ra_cusp * 250000).toFixed(1)}`, highlight: true },
  ] : null);

  return (
    <CalcCard title="Surface Finish (Step-Over)" category="Surface Finish" onClear={() => { setDia(""); setStepover(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Theoretical Ra from radial step-over cusps on a flat end mill floor pass.
      </p>
      <Row label="Cutting Diameter"><NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <Row label="Step-Over"><NumIn value={stepover} onChange={setStepover} unit={dU} placeholder={metric ? "0.508" : "0.020"} /></Row>
      {ra_cusp !== null && <>
        <Result label="Cusp Height" value={metric ? `${(ra_cusp * 25400).toFixed(3)} µm` : `${ra_cusp.toFixed(6)}"`} />
        <Result label="Theoretical Ra" value={metric ? `~${(ra_cusp * 25400 / 4).toFixed(3)} µm` : `~${(ra_cusp * 250000).toFixed(1)} µin`} highlight />
        <Result label="Step / Dia" value={`${((ae / D) * 100).toFixed(1)}%`} />
        {ae / D > 0.5 && (
          <p className="text-[11px] text-amber-400">⚠ Stepover &gt; 50% — formula less accurate at high engagement.</p>
        )}
      </>}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Hardness ↔ Tensile Strength Converter
// ─────────────────────────────────────────────────────────────────
// ASTM E140 — steel (carbon/alloy) HRC ↔ HB pairs
const HRC_HB: [number, number][] = [
  [20,226],[22,237],[24,247],[25,253],[26,258],[28,271],[30,286],[32,301],
  [34,317],[35,327],[36,336],[38,353],[40,371],[42,390],[44,409],[45,421],
  [46,433],[48,456],[50,481],[52,505],[54,530],[55,544],[56,557],[58,584],
  [60,627],[62,670],[64,722],[65,746],
];
// HRB ↔ HB (ASTM E140)
const HRB_HB: [number, number][] = [
  [60,100],[65,110],[70,120],[75,131],[80,143],[85,156],[88,166],[90,170],
  [92,178],[94,188],[96,198],[98,207],[100,217],[102,228],[105,248],
];

function interp(table: [number, number][], x: number): number | null {
  if (x < table[0][0] || x > table[table.length - 1][0]) return null;
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i], [x1, y1] = table[i + 1];
    if (x >= x0 && x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return null;
}
function invertInterp(table: [number, number][], y: number): number | null {
  if (y < table[0][1] || y > table[table.length - 1][1]) return null;
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i], [x1, y1] = table[i + 1];
    if (y >= y0 && y <= y1) return x0 + (x1 - x0) * (y - y0) / (y1 - y0);
  }
  return null;
}

function HardnessTensile() {
  const [scale, setScale] = React.useState<"HRC"|"HRB"|"HB"|"HV">("HRC");
  const [val,   setVal]   = React.useState("");
  const [mat,   setMat]   = React.useState<"steel"|"aluminum"|"cast_iron">("steel");

  const v = n(val);
  let hb: number | null = null;
  if (v > 0) {
    if (scale === "HB")  hb = v;
    if (scale === "HV")  hb = v / 1.05;            // approx HV ≈ HB × 1.05 for steel
    if (scale === "HRC") hb = interp(HRC_HB, v);
    if (scale === "HRB") hb = interp(HRB_HB, v);
  }

  const hrc = hb ? invertInterp(HRC_HB, hb) : null;
  const hrb = hb ? invertInterp(HRB_HB, hb) : null;
  const hv  = hb ? hb * 1.05 : null;

  let uts_ksi: number | null = null;
  if (hb) {
    if (mat === "steel")      uts_ksi = 0.492 * hb;
    if (mat === "aluminum")   uts_ksi = 0.19  * hb + 5;
    if (mat === "cast_iron")  uts_ksi = 0.23  * hb - 12.5;
  }
  const uts_mpa = uts_ksi ? uts_ksi * 6.895 : null;

  const scales = ["HRC","HRB","HB","HV"] as const;
  const mats: { key: typeof mat; label: string }[] = [
    { key: "steel",     label: "Steel" },
    { key: "aluminum",  label: "Aluminum" },
    { key: "cast_iron", label: "Cast Iron" },
  ];

  return (
    <CalcCard title="Hardness ↔ Tensile Strength" category="Materials" onClear={() => { setVal(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Converts between hardness scales and estimates UTS. Steel values per ASTM E140.
      </p>
      <div className="flex gap-1">
        {scales.map((s) => (
          <button key={s} type="button" onClick={() => setScale(s)}
            className="flex-1 rounded py-1.5 text-[11px] font-semibold border transition-all"
            style={{ background: scale === s ? "#a78bfa" : "transparent", borderColor: "#a78bfa", color: scale === s ? "#fff" : "#a78bfa" }}>
            {s}
          </button>
        ))}
      </div>
      <Row label={`Enter ${scale}`}><NumIn value={val} onChange={setVal} unit={scale} placeholder={scale === "HRC" ? "40" : scale === "HRB" ? "90" : scale === "HV" ? "400" : "380"} /></Row>

      {hb && <>
        <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
          <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Hardness Conversions</p>
          {hrc && <Result label="HRC" value={hrc.toFixed(1)} />}
          {hrb && <Result label="HRB" value={hrb.toFixed(1)} />}
          <Result label="HB (Brinell)" value={hb.toFixed(0)} />
          {hv  && <Result label="HV (Vickers)" value={hv.toFixed(0)} />}
        </div>
        <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
          <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Tensile Strength (UTS)</p>
          <div className="flex gap-1">
            {mats.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setMat(key)}
                className="flex-1 rounded py-1 text-[10px] font-semibold border transition-all"
                style={{ background: mat === key ? "#a78bfa" : "transparent", borderColor: "#a78bfa", color: mat === key ? "#fff" : "#a78bfa" }}>
                {label}
              </button>
            ))}
          </div>
          {uts_ksi && uts_ksi > 0 && <>
            <Result label="UTS" value={`${uts_ksi.toFixed(0)} ksi  /  ${uts_mpa!.toFixed(0)} MPa`} highlight />
            <p className="text-[10px] text-gray-600 px-1">Approximate — use certified material data for design.</p>
          </>}
        </div>
      </>}
      {v > 0 && !hb && (
        <p className="text-[11px] text-amber-400">⚠ {scale} {v} is outside the ASTM E140 table range.</p>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Metric ↔ Imperial Converter
// ─────────────────────────────────────────────────────────────────
function UnitConverter() {
  type ConvGroup = { label: string; from: string; to: string; factor: number; dec_a: number; dec_b: number };
  const GROUPS: ConvGroup[] = [
    { label: "Length",        from: "in",      to: "mm",        factor: 25.4,            dec_a: 5, dec_b: 4 },
    { label: "Speed",         from: "SFM",     to: "m/min",     factor: 0.3048,          dec_a: 1, dec_b: 2 },
    { label: "Feed Rate",     from: "IPM",     to: "mm/min",    factor: 25.4,            dec_a: 2, dec_b: 1 },
    { label: "Feed/Tooth",    from: "in/tooth",to: "mm/tooth",  factor: 25.4,            dec_a: 5, dec_b: 4 },
    { label: "Torque",        from: "in·lbf",  to: "N·m",       factor: 0.11298,         dec_a: 2, dec_b: 3 },
    { label: "Force",         from: "lbf",     to: "N",         factor: 4.44822,         dec_a: 1, dec_b: 1 },
    { label: "Power",         from: "HP",      to: "kW",        factor: 0.74570,         dec_a: 3, dec_b: 3 },
    { label: "Pressure/Kc",   from: "psi",     to: "MPa",       factor: 0.0068948,       dec_a: 0, dec_b: 3 },
    { label: "Temperature",   from: "°F",      to: "°C",        factor: 0,               dec_a: 1, dec_b: 1 }, // special
  ];

  const [vals, setVals] = React.useState<Record<number, { a: string; b: string }>>({});
  const get = (i: number) => vals[i] ?? { a: "", b: "" };
  const setA = (i: number, v: string) => {
    const g = GROUPS[i];
    const num = parseFloat(v) || 0;
    const bVal = g.label === "Temperature" ? ((num - 32) * 5/9) : num * g.factor;
    setVals(p => ({ ...p, [i]: { a: v, b: num ? bVal.toFixed(g.dec_b) : "" } }));
  };
  const setB = (i: number, v: string) => {
    const g = GROUPS[i];
    const num = parseFloat(v) || 0;
    const aVal = g.label === "Temperature" ? (num * 9/5 + 32) : num / g.factor;
    setVals(p => ({ ...p, [i]: { b: v, a: num ? aVal.toFixed(g.dec_a) : "" } }));
  };

  return (
    <CalcCard title="Unit Converter" category="Conversions" onClear={() => setVals({})}>
      <p className="text-[10px] text-gray-500 -mt-1">Type in either field — converts both ways live.</p>
      <div className="space-y-2">
        {GROUPS.map((g, i) => (
          <div key={g.label} className="grid grid-cols-[4rem_1fr_0.4rem_1fr] items-center gap-1">
            <span className="text-[10px] text-gray-500 leading-tight">{g.label}</span>
            <div className="flex items-center gap-1">
              <input type="number" value={get(i).a} onChange={e => setA(i, e.target.value)}
                placeholder="0" className="w-full rounded bg-[#0d1b2a] border border-[#2d2d4a] text-white text-xs px-2 py-1.5 focus:outline-none focus:border-indigo-500" />
              <span className="text-[10px] text-gray-500 shrink-0 w-10">{g.from}</span>
            </div>
            <span className="text-center text-gray-600 text-xs">↔</span>
            <div className="flex items-center gap-1">
              <input type="number" value={get(i).b} onChange={e => setB(i, e.target.value)}
                placeholder="0" className="w-full rounded bg-[#0d1b2a] border border-[#2d2d4a] text-white text-xs px-2 py-1.5 focus:outline-none focus:border-indigo-500" />
              <span className="text-[10px] text-gray-500 shrink-0 w-10">{g.to}</span>
            </div>
          </div>
        ))}
      </div>
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Ball Nose Velocity Adjustment
// ─────────────────────────────────────────────────────────────────
function BallNoseVelocity() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";
  const sU = metric ? "m/min" : "SFM";

  const [dia,   setDia]   = React.useState("");
  const [ap,    setAp]    = React.useState("");
  const [sfm,   setSfm]   = React.useState("");
  const [tilt,  setTilt]  = React.useState("15");

  const D   = metric ? n(dia)/25.4   : n(dia);
  const apV = metric ? n(ap)/25.4    : n(ap);
  const S   = metric ? n(sfm)/0.3048 : n(sfm);
  const β = n(tilt) * Math.PI / 180;

  let result: {
    theta_deg: number;
    deff_0: number; deff_tilt: number;
    sfm_0: number;  sfm_tilt: number;
    rpm_nominal: number;
    rpm_for_target_0: number; rpm_for_target_tilt: number;
    penalty_0: number; penalty_tilt: number;
  } | null = null;

  if (D > 0 && apV > 0 && apV <= D / 2 && S > 0) {
    const ratio = 1 - 2 * apV / D;                     // = (R - ap) / R
    const theta = Math.acos(ratio);                      // contact angle from tip (0° tilt)
    const deff_0    = Math.min(D, D * Math.sin(theta));
    const deff_tilt = Math.min(D, D * Math.sin(theta + β));

    result = {
      theta_deg:          theta * 180 / Math.PI,
      deff_0,
      deff_tilt,
      sfm_0:              S * (deff_0 / D),
      sfm_tilt:           S * (deff_tilt / D),
      rpm_nominal:        (S * 3.8197) / D,
      rpm_for_target_0:   (S * 3.8197) / deff_0,
      rpm_for_target_tilt:(S * 3.8197) / deff_tilt,
      penalty_0:          (1 - deff_0   / D) * 100,
      penalty_tilt:       (1 - deff_tilt / D) * 100,
    };
  }

  const tiltBtns = [0, 10, 15, 20, 30];

  usePrintRegister("Ball Nose Velocity", "Surface Finish", result ? [
    { label: `Cutting Diameter (${dU})`, value: dia },
    { label: `Axial DOC (${dU})`, value: ap },
    { label: `Programmed ${sU}`, value: sfm },
    { label: "Tilt Angle", value: `${tilt}°` },
    { label: `Effective Dia — No Tilt (${dU})`, value: metric ? (result.deff_0 * 25.4).toFixed(4) : result.deff_0.toFixed(5) },
    { label: `Actual ${sU} — No Tilt`, value: metric ? (result.sfm_0 * 0.3048).toFixed(1) : result.sfm_0.toFixed(1) },
    { label: `RPM for Target ${sU} — No Tilt`, value: Math.round(result.rpm_for_target_0).toLocaleString() },
    { label: `Effective Dia — ${tilt}° Tilt (${dU})`, value: metric ? (result.deff_tilt * 25.4).toFixed(4) : result.deff_tilt.toFixed(5) },
    { label: `Actual ${sU} — ${tilt}° Tilt`, value: metric ? (result.sfm_tilt * 0.3048).toFixed(1) : result.sfm_tilt.toFixed(1), highlight: true },
    { label: `RPM for Target ${sU} — ${tilt}° Tilt`, value: Math.round(result.rpm_for_target_tilt).toLocaleString(), highlight: true },
  ] : null);

  return (
    <CalcCard title="Ball Nose Velocity Adjustment" category="Surface Finish" onClear={() => { setDia(""); setAp(""); setSfm(""); setTilt("15"); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        A ball nose tip has near-zero cutting velocity at shallow DOC.
        Tilting the spindle moves the contact point away from the dead zone —
        dramatically increasing actual SFM at the cut.
      </p>

      <Row label="Cutting Diameter"><NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <Row label="Axial DOC (ap)"><NumIn value={ap}  onChange={setAp}  unit={dU} placeholder={metric ? "0.254" : "0.0100"} /></Row>
      <Row label={`Programmed ${sU}`}><NumIn value={sfm} onChange={setSfm} unit={sU} placeholder={metric ? "60" : "200"} /></Row>

      {/* Tilt angle buttons */}
      <div className="space-y-1">
        <span className="text-[11px] text-gray-400">Lead / Tilt Angle</span>
        <div className="flex gap-1 flex-wrap">
          {tiltBtns.map((a) => (
            <button key={a} type="button"
              onClick={() => setTilt(String(a))}
              className="rounded px-2.5 py-1 text-[11px] border transition-all"
              style={{
                background:   tilt === String(a) ? "#10b981" : "transparent",
                borderColor:  "#10b981",
                color:        tilt === String(a) ? "#fff" : "#10b981",
              }}
            >{a}°</button>
          ))}
          <NumIn value={tilt} onChange={setTilt} unit="°" placeholder="15" />
        </div>
        <p className="text-[10px] text-gray-600">0° = perpendicular (tip touching) · 10–15° typical CAM lead</p>
      </div>

      {result && (() => {
        const r = result!;
        const zeroColor  = r.penalty_0   > 60 ? "text-red-400"    : r.penalty_0   > 30 ? "text-amber-400" : "text-emerald-400";
        const tiltColor  = r.penalty_tilt > 30 ? "text-amber-400" : "text-emerald-400";
        return (
          <>
            <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Contact Geometry</p>
              <Result label="Contact Angle from Tip" value={`${r.theta_deg.toFixed(1)}°`} />
              <Result label="Effective Dia — 0° tilt"         value={metric ? `${(r.deff_0 * 25.4).toFixed(4)} mm` : `${r.deff_0.toFixed(5)}"`} />
              <Result label={`Effective Dia — ${tilt}° tilt`} value={metric ? `${(r.deff_tilt * 25.4).toFixed(4)} mm` : `${r.deff_tilt.toFixed(5)}"`} />
            </div>

            <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Actual SFM at Contact</p>
              <div className="flex items-center justify-between px-3 py-2 rounded bg-[#0d1b2a]">
                <span className="text-[11px] text-gray-400">0° tilt (perpendicular)</span>
                <span className={`text-sm font-mono font-semibold ${zeroColor}`}>
                  {metric ? (r.sfm_0 * 0.3048).toFixed(1) : Math.round(r.sfm_0)} {sU}
                  <span className="text-[10px] ml-1 text-gray-500">({(100 - r.penalty_0).toFixed(0)}% of programmed)</span>
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 rounded bg-[#1e1b4b]">
                <span className="text-[11px] text-gray-400">{tilt}° tilt</span>
                <span className={`text-sm font-mono font-semibold ${tiltColor}`}>
                  {metric ? (r.sfm_tilt * 0.3048).toFixed(1) : Math.round(r.sfm_tilt)} {sU}
                  <span className="text-[10px] ml-1 text-gray-500">({(100 - r.penalty_tilt).toFixed(0)}% of programmed)</span>
                </span>
              </div>
              {n(tilt) === 0 && r.penalty_0 > 50 && (
                <p className="text-[11px] text-amber-400">
                  ⚠ &lt;{(100 - r.penalty_0).toFixed(0)}% velocity at tip — add {tiltBtns[2]}° lead angle to reach {metric ? (r.sfm_0 * (r.deff_tilt / r.deff_0) * 0.3048).toFixed(1) : Math.round(r.sfm_0 * (r.deff_tilt / r.deff_0))} {sU}.
                </p>
              )}
            </div>

            <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">RPM to Achieve Target {sU} at Contact</p>
              <Result label="Nominal RPM (on tool dia)"  value={`${Math.round(r.rpm_nominal).toLocaleString()} RPM`} />
              <Result label="Corrected — 0° tilt"        value={`${Math.round(r.rpm_for_target_0).toLocaleString()} RPM`} />
              <Result label={`Corrected — ${tilt}° tilt`} value={`${Math.round(r.rpm_for_target_tilt).toLocaleString()} RPM`} highlight />
              <p className="text-[10px] text-gray-600 px-1">
                Use the corrected RPM so the contact point actually runs at your target SFM.
              </p>
            </div>
          </>
        );
      })()}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Material Condition → Hardness Lookup
// ─────────────────────────────────────────────────────────────────
interface MatRow {
  alloy: string;        // e.g. "17-4 PH"
  condition: string;    // e.g. "H900"
  aging_temp?: string;  // e.g. "900°F"
  hrc?: string;
  hb?: string;
  hrb?: string;
  uts_ksi?: string;
  machinability?: string;
  notes?: string;
  tags: string;
}

const MAT_HARDNESS: MatRow[] = [
  // ── 17-4 PH Stainless (ASTM A564 / AMS 5643) ─────────────────
  // "H" = solution annealed then aged at the stated °F temperature
  { alloy:"17-4 PH", condition:"Condition A",   aging_temp:"~1900°F (sol. anneal)", hrc:"≤32",  hb:"~331",  uts_ksi:"~150", machinability:"Best machinability of all 17-4 conditions",         notes:"Solution annealed, not yet aged. Often machined in this state, then heat treated.",          tags:"17-4 ph condition a annealed 630 solution" },
  { alloy:"17-4 PH", condition:"Condition AT",  aging_temp:"~1900°F + tested",      hrc:"≤32",  hb:"~331",  uts_ksi:"~150", machinability:"Same as Condition A",                               notes:"Solution annealed and proof-tested. Same hardness as Condition A.",                         tags:"17-4 ph condition at annealed tested 630" },
  { alloy:"17-4 PH", condition:"H900",          aging_temp:"900°F",                 hrc:"44–47",hb:"420–450",uts_ksi:"190",  machinability:"Hardest, most abrasive — carbide tooling required", notes:"Highest strength, lowest toughness. Aggressive chip, harder on tools.",                     tags:"17-4 ph h900 630 precipitation hardened stainless" },
  { alloy:"17-4 PH", condition:"H925",          aging_temp:"925°F",                 hrc:"42–45",hb:"400–430",uts_ksi:"170",  machinability:"Very challenging — similar to H900",                notes:"Very high strength. Common in oil & gas and aerospace fastener applications.",               tags:"17-4 ph h925 630" },
  { alloy:"17-4 PH", condition:"H1025",         aging_temp:"1025°F",                hrc:"38–42",hb:"360–400",uts_ksi:"155",  machinability:"Most common aerospace machining range",             notes:"Balanced strength and toughness. Most frequently specified aerospace condition.",             tags:"17-4 ph h1025 630" },
  { alloy:"17-4 PH", condition:"H1075",         aging_temp:"1075°F",                hrc:"35–38",hb:"327–360",uts_ksi:"145",  machinability:"Slightly softer, improved toughness",               notes:"Good toughness-to-strength balance. Used where shock resistance matters.",                   tags:"17-4 ph h1075 630" },
  { alloy:"17-4 PH", condition:"H1100",         aging_temp:"1100°F",                hrc:"33–36",hb:"311–340",uts_ksi:"140",  machinability:"Moderately difficult",                              notes:"Good corrosion resistance. Used in chemical processing equipment.",                         tags:"17-4 ph h1100 630" },
  { alloy:"17-4 PH", condition:"H1150",         aging_temp:"1150°F",                hrc:"28–32",hb:"270–311",uts_ksi:"115",  machinability:"Softer but slightly gummy",                         notes:"Best corrosion resistance of aged conditions. High toughness, lower strength.",               tags:"17-4 ph h1150 630" },
  { alloy:"17-4 PH", condition:"H1150M",        aging_temp:"1150°F (modified)",     hrc:"28–31",hb:"270–293",uts_ksi:"105",  machinability:"Softer — easier but can be gummy",                  notes:"Modified aging cycle for stability. Often used for thick sections.",                        tags:"17-4 ph h1150m h1150 modified 630" },
  { alloy:"17-4 PH", condition:"H1150D",        aging_temp:"1150°F double age",     hrc:"28–31",hb:"270–293",uts_ksi:"105",  machinability:"Maximum toughness — most forgiving to machine",     notes:"Double aged for maximum toughness and dimensional stability. Highest impact resistance.",     tags:"17-4 ph h1150d h1150 double age 630" },
  // ── 15-5 PH (XM-12) ──────────────────────────────────────────
  { alloy:"15-5 PH", condition:"H900",          aging_temp:"900°F",  hrc:"40–44",hb:"375–420",uts_ksi:"190",  machinability:"Hard — carbide required",           notes:"No delta ferrite vs 17-4; better transverse toughness.",              tags:"15-5 ph h900 xm12 precipitation hardened" },
  { alloy:"15-5 PH", condition:"H925",          aging_temp:"925°F",  hrc:"38–42",hb:"360–395",uts_ksi:"170",  machinability:"Challenging",                       notes:"",                                                                    tags:"15-5 ph h925" },
  { alloy:"15-5 PH", condition:"H1025",         aging_temp:"1025°F", hrc:"35–39",hb:"327–368",uts_ksi:"155",  machinability:"Common aerospace machining range",  notes:"",                                                                    tags:"15-5 ph h1025" },
  { alloy:"15-5 PH", condition:"H1075",         aging_temp:"1075°F", hrc:"32–36",hb:"301–340",uts_ksi:"145",  machinability:"",                                  notes:"",                                                                    tags:"15-5 ph h1075" },
  { alloy:"15-5 PH", condition:"H1100",         aging_temp:"1100°F", hrc:"30–34",hb:"285–320",uts_ksi:"135",  machinability:"",                                  notes:"",                                                                    tags:"15-5 ph h1100" },
  // ── 13-8 PH (XM-13) ──────────────────────────────────────────
  { alloy:"13-8 PH", condition:"H950",          aging_temp:"950°F",  hrc:"42–46",hb:"395–435",uts_ksi:"200",  machinability:"Very hard",                         notes:"Highest strength PH grade. Excellent transverse properties.",         tags:"13-8 ph h950 xm13" },
  { alloy:"13-8 PH", condition:"H1000",         aging_temp:"1000°F", hrc:"39–43",hb:"368–408",uts_ksi:"185",  machinability:"Hard",                              notes:"",                                                                    tags:"13-8 ph h1000" },
  { alloy:"13-8 PH", condition:"H1050",         aging_temp:"1050°F", hrc:"36–40",hb:"340–375",uts_ksi:"165",  machinability:"",                                  notes:"",                                                                    tags:"13-8 ph h1050" },
  // ── Tool Steels ───────────────────────────────────────────────
  { alloy:"P20",     condition:"Pre-hardened",             hrc:"28–34",hb:"270–325",uts_ksi:"~135", notes:"Ready to machine, no heat treat needed",    tags:"p20 tool steel pre-hardened mold" },
  { alloy:"A2",      condition:"Annealed",                 hrb:"~97",  hb:"~201",  uts_ksi:"~95",  notes:"Soft, for rough machining",                 tags:"a2 tool steel annealed" },
  { alloy:"A2",      condition:"Hardened (typical)",       hrc:"57–62",hb:"~596",  uts_ksi:"~280", notes:"Air hardening; typical working hardness",   tags:"a2 tool steel hardened" },
  { alloy:"D2",      condition:"Annealed",                 hrb:"~105", hb:"~235",  uts_ksi:"~105", notes:"Soft, for rough machining",                 tags:"d2 tool steel annealed" },
  { alloy:"D2",      condition:"Hardened (typical)",       hrc:"58–62",hb:"~600",  uts_ksi:"~285", notes:"High wear resistance; difficult to machine", tags:"d2 tool steel hardened" },
  { alloy:"H13",     condition:"Annealed",                 hrb:"~94",  hb:"~192",  uts_ksi:"~90",  notes:"",                                          tags:"h13 tool steel annealed hot work" },
  { alloy:"H13",     condition:"Hardened (typical)",       hrc:"44–50",hb:"421–512",uts_ksi:"~220", notes:"Hot work die steel",                       tags:"h13 tool steel hardened" },
  { alloy:"S7",      condition:"Annealed",                 hrb:"~95",  hb:"~197",  uts_ksi:"~95",  notes:"",                                          tags:"s7 tool steel annealed shock" },
  { alloy:"S7",      condition:"Hardened (typical)",       hrc:"54–58",hb:"~560",  uts_ksi:"~265", notes:"Shock-resistant; tough",                    tags:"s7 tool steel hardened" },
  { alloy:"M2",      condition:"Annealed",                 hrb:"~102", hb:"~223",  uts_ksi:"~100", notes:"",                                          tags:"m2 hss high speed steel annealed" },
  { alloy:"M2",      condition:"Hardened (typical)",       hrc:"62–65",hb:"~700",  uts_ksi:"~310", notes:"HSS; standard drill/end mill substrate",    tags:"m2 hss high speed steel hardened" },
  { alloy:"O1",      condition:"Hardened (typical)",       hrc:"60–63",hb:"~650",  uts_ksi:"~295", notes:"Oil-hardening; good dimensional stability",  tags:"o1 tool steel hardened oil" },
  // ── Alloy Steels ──────────────────────────────────────────────
  { alloy:"4140",    condition:"Annealed",                 hrb:"~92",  hb:"~197",  uts_ksi:"~95",  notes:"",                                          tags:"4140 alloy steel annealed chromoly" },
  { alloy:"4140",    condition:"Pre-hardened (~32 HRC)",   hrc:"28–34",hb:"270–325",uts_ksi:"~136", notes:"Bar stock commonly supplied this way",     tags:"4140 alloy steel pre-hardened" },
  { alloy:"4140",    condition:"Q&T to ~50 HRC",           hrc:"48–52",hb:"471–512",uts_ksi:"~230", notes:"Q&T at ~315°C temper",                    tags:"4140 alloy steel qt quench temper" },
  { alloy:"4340",    condition:"Annealed",                 hrb:"~97",  hb:"~217",  uts_ksi:"~108", notes:"",                                          tags:"4340 alloy steel annealed" },
  { alloy:"4340",    condition:"Q&T 300M equivalent",      hrc:"50–55",hb:"480–551",uts_ksi:"~260", notes:"Ultra-high strength aircraft steel",       tags:"4340 300m alloy steel hardened" },
  { alloy:"8620",    condition:"Carburized case",          hrc:"58–62",hb:"~600",  uts_ksi:"~285", notes:"Case depth typically 0.020–0.060\"",        tags:"8620 alloy steel carburized case hardened" },
  // ── Aluminum Tempers ──────────────────────────────────────────
  { alloy:"6061",    condition:"T6",                       hrb:"~60",  hb:"~95",   uts_ksi:"45",   notes:"Most common condition; fully precipitation hardened", tags:"6061 t6 aluminum temper" },
  { alloy:"6061",    condition:"T4",                       hrb:"~57",  hb:"~65",   uts_ksi:"35",   notes:"Solution treated, naturally aged",          tags:"6061 t4 aluminum" },
  { alloy:"6061",    condition:"O (annealed)",             hrb:"~30",  hb:"~30",   uts_ksi:"18",   notes:"Fully soft",                                tags:"6061 o annealed aluminum" },
  { alloy:"7075",    condition:"T6",                       hrb:"~87",  hb:"~150",  uts_ksi:"83",   notes:"Highest common aluminum strength",           tags:"7075 t6 aluminum temper" },
  { alloy:"7075",    condition:"T73",                      hrb:"~84",  hb:"~140",  uts_ksi:"73",   notes:"Over-aged; improved SCC resistance",         tags:"7075 t73 aluminum" },
  { alloy:"2024",    condition:"T4",                       hrb:"~75",  hb:"~120",  uts_ksi:"68",   notes:"",                                          tags:"2024 t4 aluminum duralumin" },
  { alloy:"2024",    condition:"T3",                       hrb:"~78",  hb:"~130",  uts_ksi:"70",   notes:"Cold worked after solution treat",           tags:"2024 t3 aluminum" },
  { alloy:"7050",    condition:"T7452",                    hrb:"~86",  hb:"~145",  uts_ksi:"76",   notes:"Thick plate; aerospace",                     tags:"7050 t7452 aluminum plate" },
  // ── Titanium ──────────────────────────────────────────────────
  { alloy:"Ti-6Al-4V",condition:"Annealed",                hrc:"~30",  hb:"~300",  uts_ksi:"130",  notes:"Standard mill-annealed condition",           tags:"titanium ti64 ti-6al-4v annealed grade5" },
  { alloy:"Ti-6Al-4V",condition:"STA (solution + age)",    hrc:"~36",  hb:"~340",  uts_ksi:"160",  notes:"Higher strength, lower toughness",           tags:"titanium ti64 ti-6al-4v sta" },
  // ── Inconel ───────────────────────────────────────────────────
  { alloy:"Inconel 718",condition:"Annealed",              hrc:"~25",  hb:"~241",  uts_ksi:"~150", notes:"",                                          tags:"inconel 718 alloy718 annealed nickel superalloy" },
  { alloy:"Inconel 718",condition:"Aged (AMS 5664)",       hrc:"~40",  hb:"~375",  uts_ksi:"185",  notes:"Double aged per AMS 5664; typical for machined parts", tags:"inconel 718 aged ams5664 nickel superalloy" },
  { alloy:"Inconel 625",condition:"Annealed",              hrc:"~19",  hb:"~185",  uts_ksi:"~130", notes:"Work-hardens significantly during machining", tags:"inconel 625 annealed nickel superalloy" },
];

function MaterialHardnessLookup() {
  const [query, setQuery] = React.useState("");
  const q = query.toLowerCase().trim();

  const filtered = q.length < 2
    ? []
    : MAT_HARDNESS.filter(r =>
        r.tags.includes(q) ||
        r.alloy.toLowerCase().includes(q) ||
        r.condition.toLowerCase().includes(q)
      );

  return (
    <CalcCard title="Material Condition → Hardness" category="Materials" onClear={() => setQuery("")}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Type a material or condition (e.g. "H900", "4140", "7075", "H13") to look up typical hardness and UTS.
      </p>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="e.g. H900  ·  4140  ·  7075 T6  ·  H13  ·  A2"
        className="w-full rounded bg-[#0d1b2a] border border-[#2d2d4a] text-white text-xs px-3 py-2
                   focus:outline-none focus:border-violet-500 placeholder:text-gray-600"
      />

      {q.length >= 2 && filtered.length === 0 && (
        <p className="text-[11px] text-gray-500 text-center py-2">No matches for "{query}"</p>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {filtered.map((r, i) => (
            <div key={i} className="rounded bg-[#0d1b2a] border border-[#2d2d4a] px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">{r.alloy}</span>
                <span className="text-[11px] font-bold text-violet-300 bg-violet-900/40 px-2 py-0.5 rounded">{r.condition}</span>
              </div>
              {r.aging_temp && (
                <div className="text-[10px] text-amber-400/80">⏱ Aged at {r.aging_temp}</div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                {r.hrc  && <><span className="text-gray-500">HRC</span><span className="text-white font-mono">{r.hrc}</span></>}
                {r.hrb  && <><span className="text-gray-500">HRB</span><span className="text-white font-mono">{r.hrb}</span></>}
                {r.hb   && <><span className="text-gray-500">HB (Brinell)</span><span className="text-white font-mono">{r.hb}</span></>}
                {r.uts_ksi && <><span className="text-gray-500">UTS</span><span className="text-emerald-400 font-mono">{r.uts_ksi} ksi</span></>}
                {r.uts_ksi && <><span className="text-gray-500">UTS (MPa)</span><span className="text-emerald-400 font-mono">{(parseFloat(r.uts_ksi.replace(/[^0-9.]/g,"")) * 6.895).toFixed(0)} MPa</span></>}
              </div>
              {r.machinability && (
                <div className="text-[10px] text-sky-400">🔧 {r.machinability}</div>
              )}
              {r.notes && <p className="text-[10px] text-gray-500 italic">{r.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {q.length < 2 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {["H900","H925","H1025","H1075","H1100","H1150","H1150M","H1150D","4140","7075 T6","H13","A2","D2","Inconel 718","Ti-6Al-4V"].map(ex => (
            <button key={ex} type="button" onClick={() => setQuery(ex)}
              className="rounded px-2 py-0.5 text-[10px] border border-violet-800 text-violet-400 hover:bg-violet-900/30 transition-colors">
              {ex}
            </button>
          ))}
        </div>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Engagement Angle
// ─────────────────────────────────────────────────────────────────
function EngagementAngle() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [dia,    setDia]    = React.useState("");
  const [woc,    setWoc]    = React.useState("");
  const [flutes, setFlutes] = React.useState("");
  const [fpt,    setFpt]    = React.useState("");

  const D  = metric ? n(dia)/25.4 : n(dia);
  const ae = n(woc); // stored in inches by WocInput
  const fz = metric ? n(fpt)/25.4 : n(fpt);
  const z  = Math.max(1, Math.round(n(flutes)));

  let result: {
    theta_deg: number;
    pct_in_cut: number;
    teeth_in_cut: number;
    arc_len: number;
    mean_chip: number;
  } | null = null;

  if (D > 0 && ae > 0 && ae <= D) {
    const theta_rad = Math.acos(1 - (2 * ae) / D);
    const theta_deg = theta_rad * (180 / Math.PI);
    const pct_in_cut = (theta_deg / 360) * 100;
    const teeth_in_cut = z * theta_deg / 360;
    const arc_len = (D / 2) * theta_rad;
    // Mean chip thickness = FPT × (1 − cos θ) / θ_rad  [integrated mean of sin over arc]
    const mean_chip = fz > 0 ? fz * (1 - Math.cos(theta_rad)) / theta_rad : 0;
    result = { theta_deg, pct_in_cut, teeth_in_cut, arc_len, mean_chip };
  }

  const arcDisp  = result ? (metric ? result.arc_len * 25.4 : result.arc_len) : null;
  const chipDisp = result && fz > 0 ? (metric ? result.mean_chip * 25.4 : result.mean_chip) : null;

  // Heat risk note
  const heatNote = result
    ? result.pct_in_cut > 50 ? "High heat per tooth — ensure good coolant coverage."
    : result.pct_in_cut > 25 ? "Moderate engagement — standard cutting conditions."
    : "Low engagement — chip thinning likely; consider increasing FPT."
    : null;

  usePrintRegister("Engagement Angle", "Speed & Feed", result ? [
    { label: `Cutting Diameter (${dU})`, value: dia },
    { label: `WOC (${dU})`, value: woc },
    { label: "Engagement Angle", value: `${result.theta_deg.toFixed(1)}°`, highlight: true },
    { label: "% Revolution in Cut", value: `${result.pct_in_cut.toFixed(1)}%` },
    { label: "Teeth Simultaneously Cutting", value: result.teeth_in_cut.toFixed(2) },
    { label: `Contact Arc Length (${dU})`, value: arcDisp!.toFixed(metric ? 3 : 5) },
    ...(chipDisp !== null ? [{ label: `Mean Chip Thickness (${dU})`, value: chipDisp.toFixed(metric ? 4 : 5) }] : []),
  ] : null);

  return (
    <CalcCard title="Engagement Angle" category="Speed & Feed"
      onClear={() => { setDia(""); setWoc(""); setFlutes(""); setFpt(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Arc of contact between tool and workpiece. Drives heat per tooth, chip load, and cutting forces.
      </p>
      <Row label="Cutting Diameter" hint="Cutting diameter of the tool."><NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <WocInput dia={D} value={woc} metric={metric} onChange={(_, parsed) => setWoc(String(parsed))} />
      <Row label="Flutes" hint="Number of cutting edges. Used to calculate simultaneous teeth in cut."><NumIn value={flutes} onChange={setFlutes} placeholder="4" /></Row>
      <Row label="Feed / Tooth" hint="Optional — enter to calculate mean chip thickness across the engagement arc."><NumIn value={fpt} onChange={setFpt} unit={dU} placeholder={metric ? "0.127" : "0.005"} /></Row>
      {result && <>
        <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
          <Result label="Engagement Angle" value={`${result.theta_deg.toFixed(1)}°`} highlight />
          <Result label="% Revolution in Cut" value={`${result.pct_in_cut.toFixed(1)}%`} />
          {n(flutes) > 0 && <Result label="Teeth Simultaneously Cutting" value={result.teeth_in_cut.toFixed(2)} />}
          <Result label={`Contact Arc Length (${dU})`} value={arcDisp!.toFixed(metric ? 3 : 5)} />
          {chipDisp !== null && <Result label={`Mean Chip Thickness (${dU})`} value={chipDisp.toFixed(metric ? 4 : 5)} highlight />}
        </div>
        {heatNote && (
          <p className={`text-[10px] px-1 ${result.pct_in_cut > 50 ? "text-red-400" : result.pct_in_cut > 25 ? "text-amber-400" : "text-sky-400"}`}>
            {heatNote}
          </p>
        )}
      </>}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Minimum Chip Thickness
// ─────────────────────────────────────────────────────────────────
function MinChipThickness() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [toolDia, setToolDia]   = React.useState("");
  const [woc,     setWoc]       = React.useState("");
  const [fpt,     setFpt]       = React.useState("");

  // Fixed edge radius: 0.0003" (typical honed carbide edge prep, midpoint of 0.0002–0.0004" range)
  const er_in  = 0.0003;
  const td     = metric ? n(toolDia) / 25.4 : n(toolDia);
  const woc_in = n(woc); // stored in inches by WocInput
  const fpt_in = metric ? n(fpt) / 25.4 : n(fpt);

  const wocFrac = td > 0 && woc_in > 0 ? woc_in / td : 0;
  const chipThinFactor = wocFrac > 0 ? Math.sqrt(wocFrac / (2 - wocFrac)) : null;

  // Min chip thickness = 20–30% of edge radius (use 25% as midpoint)
  const minChip_in   = 0.25 * er_in;
  const minFpt_in    = chipThinFactor !== null && chipThinFactor > 0
    ? minChip_in / chipThinFactor : null;

  const disp = (v: number) => {
    return metric ? (v * 25400).toFixed(2) + " μm" : (v * 1e6).toFixed(1) + " μin";
  };
  const dispIn = (v: number | null) => {
    if (v === null) return null;
    return metric ? (v * 25.4).toFixed(4) + " mm" : v.toFixed(5) + '"';
  };

  const hasInputs = td > 0 && woc_in > 0;
  const rubbing = fpt_in > 0 && minFpt_in !== null ? fpt_in < minFpt_in : null;

  usePrintRegister("Min Chip Thickness", "Speed & Feed", hasInputs ? [
    { label: `Cutting Diameter (${dU})`, value: toolDia },
    { label: "Radial WOC", value: woc },
    { label: "Min Chip Thickness", value: disp(minChip_in) },
    ...(minFpt_in !== null ? [{ label: "Min FPT to avoid rubbing", value: dispIn(minFpt_in) ?? "" }] : []),
    ...(fpt_in > 0 && rubbing !== null ? [{ label: "Current FPT status", value: rubbing ? "⚠ Below min — tool is rubbing" : "✓ Above min — cutting" }] : []),
  ] : null);

  return (
    <CalcCard title="Min Chip Thickness" category="Speed & Feed"
      onClear={() => { setToolDia(""); setWoc(""); setFpt(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Chip must be ≥20–30% of the cutting edge radius or the tool rubs instead of cuts — accelerating wear.
        Based on a standard honed edge prep of 0.0003".
      </p>
      <Row label={`Cutting Diameter (${dU})`} hint="Cutting diameter of the endmill.">
        <NumIn value={toolDia} onChange={setToolDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} />
      </Row>
      <WocInput dia={td} value={woc} metric={metric} hint="Width of cut — used to calculate chip thinning factor." onChange={(_, parsed) => setWoc(String(parsed))} />
      <Row label={`Current FPT (${dU})`} hint="Optional — enter your programmed feed per tooth to check if you're above the minimum.">
        <NumIn value={fpt} onChange={setFpt} unit={dU} placeholder="optional" />
      </Row>
      {hasInputs && (
        <div className="border-t border-[#2d2d4a] pt-2 space-y-1.5">
          <Result label={`Min Chip Thickness`} value={disp(minChip_in)} highlight />
          {chipThinFactor !== null && <Result label="Chip Thinning Factor" value={chipThinFactor.toFixed(3)} />}
          {minFpt_in !== null && <Result label={`Min FPT to cut (not rub)`} value={dispIn(minFpt_in) ?? ""} highlight />}
          {fpt_in > 0 && rubbing !== null && (
            <p className={`text-[10px] px-1 font-semibold ${rubbing ? "text-red-400" : "text-emerald-400"}`}>
              {rubbing
                ? `⚠ Current FPT is below minimum — tool is rubbing, not cutting. Increase feed.`
                : `✓ Current FPT exceeds minimum — tool is cutting properly.`}
            </p>
          )}
          <p className="text-[10px] text-gray-500 px-1">Rule of thumb: min chip = 25% × edge radius. Range: 20–30% depending on material.</p>
        </div>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helix Entry / Ramp Angle
// ─────────────────────────────────────────────────────────────────
function HelixEntry() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [toolDia, setToolDia] = React.useState("");
  const [helixDia, setHelixDia] = React.useState("");
  const [rampAngle, setRampAngle] = React.useState("");
  const [pitch, setPitch] = React.useState("");

  const td = metric ? n(toolDia)/25.4 : n(toolDia);
  const hd = metric ? n(helixDia)/25.4 : n(helixDia);
  const ra = n(rampAngle);
  const p  = metric ? n(pitch)/25.4 : n(pitch);

  // Helix centerline radius
  const cr = hd > 0 && td > 0 ? (hd - td) / 2 : 0;
  // Circumference of helix path
  const circ = cr > 0 ? 2 * Math.PI * cr : 0;

  // From angle → pitch
  const calcPitch = ra > 0 && circ > 0 ? circ * Math.tan(ra * Math.PI / 180) : null;
  const calcPitchDisplay = calcPitch !== null ? (metric ? calcPitch * 25.4 : calcPitch) : null;

  // From pitch → angle
  const calcAngle = p > 0 && circ > 0 ? Math.atan(p / circ) * 180 / Math.PI : null;

  const minDia = td > 0 ? td * 1.1 : null; // minimum helix dia (10% over tool)

  usePrintRegister("Helix Entry", "Arcs & Contours", (calcPitchDisplay !== null || calcAngle !== null) ? [
    { label: `Cutting Diameter (${dU})`, value: toolDia },
    { label: `Helix Diameter (${dU})`, value: helixDia },
    ...(calcPitchDisplay !== null ? [
      { label: "Ramp Angle (°)", value: rampAngle },
      { label: `Pitch per Rev (${dU})`, value: calcPitchDisplay.toFixed(metric ? 3 : 5), highlight: true },
    ] : []),
    ...(calcAngle !== null ? [
      { label: `Pitch per Rev (${dU})`, value: pitch },
      { label: "Ramp Angle (°)", value: calcAngle.toFixed(2), highlight: true },
    ] : []),
  ] : null);

  return (
    <CalcCard title="Helix Entry" category="Arcs & Contours"
      onClear={() => { setToolDia(""); setHelixDia(""); setRampAngle(""); setPitch(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Helical interpolation entry into a pocket. Helix dia = bore dia minus tool dia (clearance needed).
      </p>
      <Row label="Cutting Diameter" hint="Cutting diameter of the tool entering the pocket."><NumIn value={toolDia} onChange={setToolDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <Row label="Helix Diameter" hint="Diameter of the circular path the tool center follows. Must be larger than the tool diameter. Typically: bore diameter minus tool diameter."><NumIn value={helixDia} onChange={setHelixDia} unit={dU} placeholder={metric ? "19.050" : "0.7500"} /></Row>
      {minDia && hd > 0 && hd < td * 1.001 && (
        <p className="text-[11px] text-red-400">⚠ Helix dia must be larger than tool dia.</p>
      )}
      {cr > 0 && <Result label="Centerline Radius" value={`${(metric ? cr*25.4 : cr).toFixed(metric?3:5)} ${dU}`} />}
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">Enter Ramp Angle → get Pitch</p>
        <Row label="Ramp Angle" hint="Angle of descent per revolution. Typical range 1–5°. Steeper angles remove more material per rev but increase axial load."><NumIn value={rampAngle} onChange={setRampAngle} unit="°" placeholder="3" /></Row>
        {calcPitchDisplay !== null && <Result label={`Pitch per Rev (${dU})`} value={calcPitchDisplay.toFixed(metric?3:5)} highlight />}
      </div>
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">Enter Pitch → get Ramp Angle</p>
        <Row label={`Pitch per Rev`}><NumIn value={pitch} onChange={setPitch} unit={dU} placeholder={metric ? "0.254" : "0.0100"} /></Row>
        {calcAngle !== null && <Result label="Ramp Angle" value={`${calcAngle.toFixed(2)}°`} highlight />}
      </div>
      {(n(rampAngle) > 5 || calcAngle !== null && calcAngle > 5) && (
        <div className="border-t border-[#2d2d4a] pt-2 mt-1">
          <p className="text-[10px] text-amber-400 font-semibold mb-1">How to fix it — steep ramp angle</p>
          <p className="text-[10px] text-gray-400">Above 5° the axial load on the tip increases rapidly. Use 1–3° for most endmills, up to 5° max. Increase the helix diameter to reduce the angle for the same pitch, or reduce pitch per revolution. Ball end mills tolerate steeper ramps than square-end tools.</p>
        </div>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// No Middle Post (Helical Entry Core Check)
// ─────────────────────────────────────────────────────────────────
function NoMiddlePost() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";
  const dec = metric ? 3 : 4;

  const [boreDia, setBoreDia] = React.useState("");
  const [toolDia, setToolDia] = React.useState("");

  const bd = metric ? n(boreDia) / 25.4 : n(boreDia);
  const td = metric ? n(toolDia) / 25.4 : n(toolDia);

  const postDia = bd > 0 && td > 0 ? bd - 2 * td : null;
  const minTool  = bd > 0 ? bd / 2 : null;
  const hasPost  = postDia !== null && postDia > 0.0001;
  const noPost   = postDia !== null && postDia <= 0.0001;

  const postDisplay  = postDia !== null ? (metric ? postDia * 25.4 : postDia) : null;
  const minToolDisplay = minTool !== null ? (metric ? minTool * 25.4 : minTool) : null;

  usePrintRegister("No Middle Post", "Arcs & Contours", bd > 0 && td > 0 ? [
    { label: `Bore / Pocket Dia (${dU})`, value: boreDia },
    { label: `Cutting Diameter (${dU})`, value: toolDia },
    { label: "Post Diameter", value: hasPost ? `${postDisplay!.toFixed(dec)} ${dU} — POST EXISTS` : "None — tool passes center", highlight: true },
    ...(hasPost && minToolDisplay !== null ? [{ label: `Min Tool to Clear Post (${dU})`, value: minToolDisplay.toFixed(dec), highlight: true }] : []),
  ] : null);

  return (
    <CalcCard title="No Middle Post" category="Arcs & Contours"
      onClear={() => { setBoreDia(""); setToolDia(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        When helically entering solid stock, a tool smaller than half the bore diameter leaves a standing core post in the center that cannot be removed. Enter bore and tool diameters to check.
      </p>
      <Row label="Bore / Pocket Dia" hint="Final bore or pocket diameter being machined."><NumIn value={boreDia} onChange={setBoreDia} unit={dU} placeholder={metric ? "25.4" : "1.0000"} /></Row>
      <Row label="Cutting Diameter" hint="Cutting diameter of the endmill being used for helical entry."><NumIn value={toolDia} onChange={setToolDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      {bd > 0 && td > 0 && td >= bd && (
        <p className="text-[11px] text-red-400">⚠ Tool diameter cannot exceed bore diameter.</p>
      )}
      {noPost && (
        <Result label="Post Check" value={`✓ No post — tool (${(metric ? td*25.4 : td).toFixed(dec)}) ≥ half bore (${(metric ? (bd/2)*25.4 : bd/2).toFixed(dec)})`} highlight />
      )}
      {hasPost && postDisplay !== null && (
        <>
          <Result label="Standing Post Diameter" value={`${postDisplay.toFixed(dec)} ${dU}`} highlight />
          {minToolDisplay !== null && <Result label={`Min Tool to Avoid Post (${dU})`} value={minToolDisplay.toFixed(dec)} highlight />}
          <p className="text-[10px] text-amber-400 mt-1">
            ⚠ This tool leaves a {postDisplay.toFixed(dec)} {dU} core post. Options: use a tool ≥{minToolDisplay?.toFixed(dec)} {dU}, pre-drill / pre-interpolate a center pocket, or use a center-cutting plunge mill.
          </p>
        </>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Bolt Circle
// ─────────────────────────────────────────────────────────────────
function BoltCircle() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";
  const dec = metric ? 3 : 5;

  const [cx,         setCx]         = React.useState("0");
  const [cy,         setCy]         = React.useState("0");
  const [bcr,        setBcr]        = React.useState("");
  const [holes,      setHoles]      = React.useState("");
  const [startAngle, setStartAngle] = React.useState("0");
  const [gcMode,     setGcMode]     = React.useState<"position"|"g81">("position");
  const [zDepth,     setZDepth]     = React.useState("");
  const [zClear,     setZClear]     = React.useState("0.100");
  const [feedRate,   setFeedRate]   = React.useState("");
  const [showGcode,  setShowGcode]  = React.useState(false);
  const [copied,     setCopied]     = React.useState(false);

  const R  = metric ? n(bcr)/25.4 : n(bcr);
  const N  = Math.round(n(holes));
  const sa = n(startAngle) * Math.PI / 180;
  const CX = metric ? n(cx)/25.4 : n(cx);
  const CY = metric ? n(cy)/25.4 : n(cy);
  const ZD = metric ? n(zDepth)/25.4 : n(zDepth);
  const ZR = metric ? n(zClear)/25.4 : n(zClear);
  const F  = n(feedRate);

  const pts = R > 0 && N >= 2 ? Array.from({ length: N }, (_, i) => {
    const angle = sa + (2 * Math.PI * i) / N;
    const x = CX + R * Math.cos(angle);
    const y = CY + R * Math.sin(angle);
    return { i: i + 1, x: metric ? x*25.4 : x, y: metric ? y*25.4 : y };
  }) : null;

  function buildGcode(): string {
    if (!pts) return "";
    const xf = (v: number) => v.toFixed(dec);
    const zf  = (v: number) => v.toFixed(metric ? 3 : 4);
    const lines: string[] = ["(Bolt Circle — CoreCutCNC)", "G90 G17"];
    if (gcMode === "g81") {
      const zVal = ZD !== 0 ? -Math.abs(ZD) : -0.500;
      const rVal = Math.abs(ZR);
      const fVal = F > 0 ? F : (metric ? 100 : 4);
      lines.push(`G81 X${xf(pts[0].x)} Y${xf(pts[0].y)} Z${zf(-Math.abs(zVal))} R${zf(rVal)} F${fVal.toFixed(metric?1:0)}`);
      for (let i = 1; i < pts.length; i++) {
        lines.push(`    X${xf(pts[i].x)} Y${xf(pts[i].y)}`);
      }
      lines.push("G80");
    } else {
      for (const p of pts) {
        lines.push(`G00 X${xf(p.x)} Y${xf(p.y)}  (Hole ${p.i})`);
      }
    }
    return lines.join("\n");
  }

  const gcode = showGcode && pts ? buildGcode() : "";

  function copyGcode() {
    navigator.clipboard.writeText(gcode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  usePrintRegister("Bolt Circle", "Arcs & Contours", pts ? [
    { label: `BCD Radius (${dU})`, value: bcr },
    { label: "Holes", value: String(N) },
    { label: "Start Angle (°)", value: startAngle || "0" },
    ...pts.map(p => ({ label: `Hole ${p.i}`, value: `X ${p.x.toFixed(dec)}  Y ${p.y.toFixed(dec)}` })),
  ] : null);

  return (
    <CalcCard title="Bolt Circle" category="Arcs & Contours" gcode
      onClear={() => { setCx("0"); setCy("0"); setBcr(""); setHoles(""); setStartAngle("0"); setZDepth(""); setFeedRate(""); setShowGcode(false); }}>
      <p className="text-[10px] text-gray-500 -mt-1">X/Y coordinates for equally-spaced holes on a bolt circle.</p>
      <Row label={`Center X (${dU})`}><NumIn value={cx} onChange={setCx} unit={dU} placeholder="0" /></Row>
      <Row label={`Center Y (${dU})`}><NumIn value={cy} onChange={setCy} unit={dU} placeholder="0" /></Row>
      <Row label={`BCD Radius (${dU})`} hint="Bolt circle diameter radius — distance from the circle center to each hole center."><NumIn value={bcr} onChange={setBcr} unit={dU} placeholder={metric ? "25.4" : "1.0000"} /></Row>
      <Row label="# Holes" hint="Total number of equally-spaced holes around the bolt circle."><NumIn value={holes} onChange={setHoles} placeholder="6" /></Row>
      <Row label="Start Angle (°)" hint="Angle of the first hole from 3 o'clock (0°) counterclockwise. 90° = 12 o'clock."><NumIn value={startAngle} onChange={setStartAngle} unit="°" placeholder="0" /></Row>

      {pts && (
        <>
          <div className="border-t border-[#2d2d4a] pt-2 space-y-1">
            {pts.map(p => (
              <div key={p.i} className="flex items-center justify-between px-3 py-1.5 rounded bg-[#0d1b2a]">
                <span className="text-[11px] text-gray-400">Hole {p.i}</span>
                <span className="text-xs font-mono text-yellow-300">
                  X {p.x.toFixed(dec)} &nbsp; Y {p.y.toFixed(dec)}
                </span>
              </div>
            ))}
          </div>

          {/* G-code toggle */}
          <button
            type="button"
            onClick={() => setShowGcode(v => !v)}
            className="w-full mt-1 text-[11px] font-semibold rounded border border-indigo-600 text-indigo-400 hover:bg-indigo-600/20 py-1.5 transition-colors">
            {showGcode ? "▲ Hide G-code" : "▼ Generate G-code Snippet"}
          </button>

          {showGcode && (
            <div className="space-y-2">
              {/* Mode selector */}
              <div className="flex gap-1">
                {([["position","G00 Positioning"],["g81","G81 Drill Cycle"]] as const).map(([m,label]) => (
                  <button key={m} type="button" onClick={() => setGcMode(m)}
                    className="flex-1 px-2 py-1 rounded text-[11px] font-semibold border transition-colors"
                    style={{ borderColor: gcMode===m?"#6366f1":"#3f3f5a", backgroundColor: gcMode===m?"#6366f1":"transparent", color: gcMode===m?"#fff":"#9ca3af" }}>
                    {label}
                  </button>
                ))}
              </div>

              {gcMode === "g81" && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">Z Depth ({dU})</div>
                    <input type="text" value={zDepth} onChange={e => setZDepth(e.target.value)}
                      placeholder={metric?"-12.7":"-0.500"}
                      className="w-full rounded bg-[#0d1b2a] border border-[#2d2d4a] text-white text-xs px-2 py-1.5 focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">R Clearance ({dU})</div>
                    <input type="text" value={zClear} onChange={e => setZClear(e.target.value)}
                      placeholder={metric?"2.540":"0.100"}
                      className="w-full rounded bg-[#0d1b2a] border border-[#2d2d4a] text-white text-xs px-2 py-1.5 focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">Feed ({metric?"mm/min":"IPM"})</div>
                    <input type="text" value={feedRate} onChange={e => setFeedRate(e.target.value)}
                      placeholder={metric?"100":"4"}
                      className="w-full rounded bg-[#0d1b2a] border border-[#2d2d4a] text-white text-xs px-2 py-1.5 focus:outline-none focus:border-indigo-500" />
                  </div>
                </div>
              )}

              {/* G-code block */}
              <div className="relative">
                <pre className="rounded bg-[#050d18] border border-[#2d2d4a] text-[11px] font-mono text-green-400 px-3 py-2.5 overflow-x-auto leading-relaxed whitespace-pre">
                  {gcode}
                </pre>
                <button
                  type="button"
                  onClick={copyGcode}
                  className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded border border-indigo-600 text-indigo-400 hover:bg-indigo-600/30 transition-colors">
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[10px] text-gray-600">Verify Z values, tool offsets, and work coordinate system before running. Always dry-run or single-block first.</p>
            </div>
          )}
        </>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Chord / Sagitta
// ─────────────────────────────────────────────────────────────────
function ChordSagitta() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [radius,  setRadius]  = React.useState("");
  const [chord,   setChord]   = React.useState("");
  const [sagitta, setSagitta] = React.useState("");

  const R = metric ? n(radius)/25.4 : n(radius);
  const c = metric ? n(chord)/25.4  : n(chord);
  const s = metric ? n(sagitta)/25.4 : n(sagitta);

  // From radius + chord → sagitta
  let calcSag: number | null = null;
  if (R > 0 && c > 0 && c <= 2 * R) {
    calcSag = R - Math.sqrt(R * R - (c / 2) * (c / 2));
  }
  const calcSagDisplay = calcSag !== null ? (metric ? calcSag * 25.4 : calcSag) : null;

  // From radius + sagitta → chord
  let calcChord: number | null = null;
  if (R > 0 && s > 0 && s <= R) {
    calcChord = 2 * Math.sqrt(R * R - (R - s) * (R - s));
  }
  const calcChordDisplay = calcChord !== null ? (metric ? calcChord * 25.4 : calcChord) : null;

  // Arc length (from radius + chord path)
  const calcArc = calcSag !== null && R > 0 ? 2 * R * Math.asin(c / (2 * R)) : null;
  const calcArcDisplay = calcArc !== null ? (metric ? calcArc * 25.4 : calcArc) : null;

  usePrintRegister("Chord / Sagitta", "Arcs & Contours", (calcSagDisplay !== null || calcChordDisplay !== null) ? [
    { label: `Arc Radius (${dU})`, value: radius },
    ...(calcSagDisplay !== null ? [
      { label: `Chord Length (${dU})`, value: chord },
      { label: `Sagitta / Arc Height (${dU})`, value: calcSagDisplay.toFixed(metric?4:5), highlight: true },
      ...(calcArcDisplay !== null ? [{ label: `Arc Length (${dU})`, value: calcArcDisplay.toFixed(metric?3:5) }] : []),
    ] : []),
    ...(calcChordDisplay !== null ? [
      { label: `Sagitta (${dU})`, value: sagitta },
      { label: `Chord Length (${dU})`, value: calcChordDisplay.toFixed(metric?4:5), highlight: true },
    ] : []),
  ] : null);

  return (
    <CalcCard title="Chord / Sagitta" category="Arcs & Contours"
      onClear={() => { setRadius(""); setChord(""); setSagitta(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Sagitta = arc height above the chord. Useful for understanding depth of curved surfaces.
      </p>
      <Row label={`Arc Radius (${dU})`}><NumIn value={radius} onChange={setRadius} unit={dU} placeholder={metric ? "25.4" : "1.0000"} /></Row>
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">Chord → Sagitta</p>
        <Row label={`Chord Length (${dU})`}><NumIn value={chord} onChange={setChord} unit={dU} placeholder={metric ? "25.4" : "1.0000"} /></Row>
        {calcSagDisplay !== null && <>
          <Result label={`Sagitta / Arc Height (${dU})`} value={calcSagDisplay.toFixed(metric?4:5)} highlight />
          {calcArcDisplay !== null && <Result label={`Arc Length (${dU})`} value={calcArcDisplay.toFixed(metric?3:5)} />}
        </>}
      </div>
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">Sagitta → Chord</p>
        <Row label={`Sagitta (${dU})`}><NumIn value={sagitta} onChange={setSagitta} unit={dU} placeholder={metric ? "2.540" : "0.1000"} /></Row>
        {calcChordDisplay !== null && <Result label={`Chord Length (${dU})`} value={calcChordDisplay.toFixed(metric?4:5)} highlight />}
      </div>
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Bore Enlargement
// ─────────────────────────────────────────────────────────────────
function BoreEnlargement() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [toolDia,    setToolDia]    = React.useState("");
  const [existingDia, setExistingDia] = React.useState("");
  const [targetDia,  setTargetDia]  = React.useState("");
  const [wocPerPass, setWocPerPass] = React.useState("");

  const td = metric ? n(toolDia)/25.4    : n(toolDia);
  const ed = metric ? n(existingDia)/25.4: n(existingDia);
  const tg = metric ? n(targetDia)/25.4  : n(targetDia);
  const wocRaw = metric ? n(wocPerPass)/25.4 : n(wocPerPass);

  const totalStock = (ed > 0 && tg > ed) ? (tg - ed) / 2 : null;

  // Auto WOC: 6% of tool dia if not set
  const autoWoc = td > 0 ? td * 0.06 : null;
  const woc = wocRaw > 0 ? wocRaw : (autoWoc ?? 0);

  type PassRow = { pass: number; boreDia: number; woc: number; arc: number; zone: string; zoneColor: string; feedMult: number };
  const passes: PassRow[] = [];
  if (totalStock !== null && totalStock > 0 && woc > 0 && td > 0) {
    let currentBore = ed;
    let pass = 0;
    while (currentBore < tg - 0.0001 && pass < 50) {
      pass++;
      const thisWoc = Math.min(woc, tg - currentBore) / 2; // radial only
      const stepWoc = Math.min(woc, (tg - currentBore) / 2);
      if (stepWoc <= 0) break;
      const newBore = Math.min(currentBore + 2 * stepWoc, tg);
      const arg = Math.max(-1, Math.min(1, 1 - (2 * stepWoc) / td));
      const arcDeg = 2 * Math.acos(arg) * (180 / Math.PI);
      const zone = arcDeg < 90   ? { label: "Light",    color: "#4ade80" }
        : arcDeg < 150  ? { label: "Moderate",  color: "#facc15" }
        : arcDeg <= 180 ? { label: "Heavy",     color: "#fb923c" }
        : { label: "Too High", color: "#f87171" };
      const feedMult = arcDeg < 90 ? 1.0 : arcDeg < 150 ? 0.75 : arcDeg <= 180 ? 0.55 : 0.40;
      passes.push({ pass, boreDia: newBore, woc: stepWoc, arc: arcDeg, zone: zone.label, zoneColor: zone.color, feedMult });
      currentBore = newBore;
    }
  }

  const hasHighArc = passes.some(p => p.arc > 180);
  const displayWoc = wocRaw > 0 ? wocRaw : autoWoc;

  usePrintRegister("Bore Enlargement", "Arcs & Contours", passes.length > 0 ? [
    { label: `Cutting Diameter (${dU})`, value: toolDia },
    { label: `Existing Hole Dia (${dU})`, value: existingDia },
    { label: `Target Hole Dia (${dU})`, value: targetDia },
    { label: `WOC per Pass (${dU})`, value: displayWoc ? (metric ? (displayWoc*25.4).toFixed(3) : displayWoc.toFixed(4)) : "—" },
    { label: "Total Radial Stock", value: totalStock ? `${(metric ? totalStock*25.4 : totalStock).toFixed(metric?3:4)} ${dU}` : "—", highlight: true },
    { label: "Passes Required", value: String(passes.length), highlight: true },
  ] : null);

  return (
    <CalcCard title="Bore Enlargement" category="Arcs & Contours"
      onClear={() => { setToolDia(""); setExistingDia(""); setTargetDia(""); setWocPerPass(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Circular interpolation bore enlargement. Shows arc engagement and feed multiplier per radial pass.
      </p>
      <Row label="Cutting Diameter" hint="Cutting diameter of the end mill used for circular interpolation."><NumIn value={toolDia} onChange={setToolDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} /></Row>
      <Row label="Existing Hole Ø" hint="Diameter of the existing pre-drilled or bored hole the tool enters. Must be larger than the tool diameter."><NumIn value={existingDia} onChange={setExistingDia} unit={dU} placeholder={metric ? "19.050" : "0.7500"} /></Row>
      <Row label="Target Hole Ø" hint="Final bore diameter needed after circular interpolation."><NumIn value={targetDia} onChange={setTargetDia} unit={dU} placeholder={metric ? "25.4" : "1.0000"} /></Row>
      <Row label="WOC per Pass" hint="Radial step (width of cut) per circular orbit. Leave blank to use auto (6% of tool dia — light engagement)."><NumIn value={wocPerPass} onChange={setWocPerPass} unit={dU} placeholder="auto" /></Row>

      {totalStock !== null && (
        <Result label={`Total Radial Stock (${dU})`} value={(metric ? totalStock*25.4 : totalStock).toFixed(metric?3:4)} highlight />
      )}
      {displayWoc !== null && wocRaw === 0 && (
        <p className="text-[10px] text-gray-500">Auto WOC: {(metric ? displayWoc*25.4 : displayWoc).toFixed(metric?3:4)} {dU} (6% of tool dia)</p>
      )}

      {passes.length > 0 && (
        <div className="border-t border-[#2d2d4a] pt-2 space-y-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-400">Pass breakdown</span>
            <span className="text-[10px] font-semibold text-white">{passes.length} pass{passes.length !== 1 ? "es" : ""}</span>
          </div>
          {/* Table header */}
          <div className="grid text-[9px] text-gray-500 font-semibold px-1" style={{ gridTemplateColumns: "2rem 1fr 1fr 2.5rem 3.5rem 2.5rem" }}>
            <span>#</span>
            <span>Bore Ø</span>
            <span>WOC</span>
            <span>Arc°</span>
            <span>Zone</span>
            <span>Feed×</span>
          </div>
          {passes.map((p) => (
            <div key={p.pass}
              className="grid items-center px-2 py-1 rounded text-[10px]"
              style={{ gridTemplateColumns: "2rem 1fr 1fr 2.5rem 3.5rem 2.5rem", background: "#0d1b2a" }}>
              <span className="text-gray-500">{p.pass}</span>
              <span className="font-mono text-white">{(metric ? p.boreDia*25.4 : p.boreDia).toFixed(metric?3:4)}</span>
              <span className="font-mono text-gray-300">{(metric ? p.woc*25.4 : p.woc).toFixed(metric?3:4)}</span>
              <span className="font-mono text-gray-300">{p.arc.toFixed(1)}</span>
              <span className="font-semibold" style={{ color: p.zoneColor }}>{p.zone}</span>
              <span className="font-mono text-gray-300">{p.feedMult.toFixed(2)}×</span>
            </div>
          ))}
          {hasHighArc && (
            <p className="text-[10px] text-red-400 pt-1">⚠ Arc &gt;180° — reduce WOC per pass or use more passes</p>
          )}
        </div>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Corner Radius Clearance
// ─────────────────────────────────────────────────────────────────
// Generic 1/16" step diameters — for geometric "ideal next size" recommendation
const GENERIC_DIAMETERS_IN = [
  0.0625, 0.1250, 0.1875, 0.2500, 0.3125, 0.3750, 0.4375,
  0.5000, 0.5625, 0.6250, 0.7500, 0.8750, 1.0000,
];

// Core Cutter stocked cutting diameters (inches) — from SKU catalog
const CC_DIAMETERS_IN = [
  0.0625, 0.0781, 0.0938, 0.1094, 0.1250, 0.1563, 0.1875, 0.2188, 0.2500,
  0.3125, 0.3750, 0.5000, 0.6250, 0.7500, 1.0000,
];

function fmtDia(d: number, metric: boolean) {
  if (metric) return `${(d * 25.4).toFixed(3)} mm`;
  // Express as fraction if it lines up cleanly, else decimal
  const fracs: [number, string][] = [
    [0.0625,'1/16"'],[0.0781,'5/64"'],[0.0938,'3/32"'],[0.1094,'7/64"'],
    [0.1250,'1/8"'],[0.1563,'5/32"'],[0.1875,'3/16"'],[0.2188,'7/32"'],
    [0.2500,'1/4"'],[0.3125,'5/16"'],[0.3750,'3/8"'],[0.5000,'1/2"'],
    [0.6250,'5/8"'],[0.7500,'3/4"'],[1.0000,'1"'],
  ];
  const match = fracs.find(([v]) => Math.abs(v - d) < 0.00005);
  return match ? match[1] : d.toFixed(4) + '"';
}

function CornerClearance() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [partCr, setPartCr] = React.useState("");
  const [toolDia, setToolDia] = React.useState("");

  const cr = metric ? n(partCr)/25.4 : n(partCr);
  const td = metric ? n(toolDia)/25.4 : n(toolDia);
  const toolR = td / 2;

  const fits = cr > 0 && td > 0 ? toolR <= cr : null;
  const atMax = cr > 0 && td > 0 ? Math.abs(toolR - cr) < 0.00005 : false; // tool exactly at max — high engagement
  const maxToolDia = cr > 0 ? cr * 2 : null;
  const maxDisplay = maxToolDia !== null ? (metric ? maxToolDia * 25.4 : maxToolDia) : null;
  const clearance = (fits && cr > 0 && td > 0) ? (cr - toolR) : null;
  const clearDisplay = clearance !== null ? (metric ? clearance * 25.4 : clearance) : null;

  // Geometric ideal — next 1/16" step below max
  const idealDia = maxToolDia !== null
    ? GENERIC_DIAMETERS_IN.filter(d => d < maxToolDia - 0.00005).slice(-1)[0] ?? null
    : null;
  const idealCr = idealDia !== null ? idealDia / 2 : null;

  // Core Cutter stocked — nearest stocked size at or below ideal (may equal ideal if we stock it)
  const ccDia = idealDia !== null
    ? CC_DIAMETERS_IN.filter(d => d <= idealDia + 0.00005).slice(-1)[0] ?? null
    : null;
  const ccCr = ccDia !== null ? ccDia / 2 : null;
  const ccSameAsIdeal = idealDia !== null && ccDia !== null && Math.abs(ccDia - idealDia) < 0.00005;

  // Engagement angle when tool traces the corner arc (WOC = part corner radius)
  const engAngle = (toolD: number) => {
    if (toolD <= 0 || cr <= 0) return null;
    const woc = cr; // tool centerline offset = partCR, so WOC into corner = partCR
    const wocPct = woc / toolD;
    if (wocPct > 1) return null;
    const theta = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * wocPct))) * 180 / Math.PI;
    return { theta, wocPct: wocPct * 100 };
  };
  const enteredEng = td > 0 ? engAngle(td) : null;
  const idealEng   = idealDia ? engAngle(idealDia) : null;
  const ccEng      = ccDia ? engAngle(ccDia) : null;

  usePrintRegister("Corner Clearance", "Arcs & Contours", cr > 0 ? [
    { label: `Part Corner Radius (${dU})`, value: partCr },
    ...(td > 0 ? [{ label: `Cutting Diameter (${dU})`, value: toolDia }] : []),
    { label: `Max Cutting Diameter`, value: maxDisplay !== null ? `${maxDisplay.toFixed(metric?3:4)} ${dU}` : "" },
    ...(idealDia !== null ? [{ label: "Ideal Next Size", value: fmtDia(idealDia, metric) }] : []),
    ...(idealCr !== null ? [{ label: "Ideal Resulting Corner Radius", value: metric ? `${(idealCr*25.4).toFixed(3)} mm` : `${idealCr.toFixed(4)}"` }] : []),
    ...(ccDia !== null ? [{ label: "Core Cutter Stocked Size", value: fmtDia(ccDia, metric), highlight: true }] : []),
    ...(ccCr !== null ? [{ label: "CC Resulting Corner Radius", value: metric ? `${(ccCr*25.4).toFixed(3)} mm` : `${ccCr.toFixed(4)}"` }] : []),
    ...(td > 0 && fits !== null ? [{ label: "Tool Fits Corner", value: fits ? "Yes ✓" : "No — tool too large" }] : []),
    ...(clearDisplay !== null ? [{ label: `Radial Clearance (${dU})`, value: clearDisplay.toFixed(metric?4:5) }] : []),
  ] : null);

  return (
    <CalcCard title="Corner Clearance" category="Arcs & Contours"
      onClear={() => { setPartCr(""); setToolDia(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Checks if a tool fits a part corner radius and recommends the next smaller standard diameter.
      </p>
      <Row label="Part Corner Radius" hint="The inside corner radius on the part drawing. The tool radius must be equal to or smaller than this value to fit.">
        <NumIn value={partCr} onChange={setPartCr} unit={dU} placeholder={metric ? "6.350" : "0.2500"} />
      </Row>
      <Row label="Cutting Diameter" hint="Optional — check if a specific tool fits this corner.">
        <NumIn value={toolDia} onChange={setToolDia} unit={dU} placeholder={metric ? "12.700" : "0.5000"} />
      </Row>

      {maxDisplay !== null && (
        <Result label="Max Cutting Diameter" value={`${maxDisplay.toFixed(metric?3:4)} ${dU}`} />
      )}

      {/* Entered tool section */}
      {td > 0 && fits !== null && (
        <div className="border border-[#2d2d4a] rounded px-3 py-2 mt-1 space-y-1">
          <p className="text-[10px] text-gray-400 mb-1">Entered tool ({fmtDia(td, metric)}):</p>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-400">Fits corner?</span>
            <span className="font-semibold" style={{ color: atMax ? "#fb923c" : fits ? "#4ade80" : "#f87171" }}>
              {atMax ? "Yes — but high engagement ⚠" : fits ? "Yes ✓" : "No — too large"}
            </span>
          </div>
          {clearDisplay !== null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-400">Radial Clearance</span>
              <span className="font-semibold" style={{ color: atMax ? "#fb923c" : "#4ade80" }}>
                {clearDisplay.toFixed(metric?4:5)} {dU}
              </span>
            </div>
          )}
          {enteredEng !== null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-400">Corner Engagement</span>
              <span className="font-semibold" style={{ color: atMax ? "#fb923c" : "#4ade80" }}>
                {enteredEng.theta.toFixed(1)}° ({enteredEng.wocPct.toFixed(1)}% dia)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Geometric ideal — next 1/16" step */}
      {idealDia !== null && idealCr !== null && (
        <div className="border border-[#2d2d4a] rounded px-3 py-2 mt-1 space-y-1">
          <p className="text-[10px] text-gray-400 font-semibold mb-1">Ideal next size down (lower engagement):</p>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-400">Diameter</span>
            <span className="font-semibold text-white">{fmtDia(idealDia, metric)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-400">Resulting Corner Radius</span>
            <span className="font-semibold text-white">{metric ? `${(idealCr*25.4).toFixed(3)} mm` : `${idealCr.toFixed(4)}"`}</span>
          </div>
          {idealEng !== null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-400">Corner Engagement</span>
              <span className="font-semibold text-white">{idealEng.theta.toFixed(1)}° ({idealEng.wocPct.toFixed(1)}% dia)</span>
            </div>
          )}
          {!ccSameAsIdeal && (
            <p className="text-[10px] text-amber-400 pt-1 border-t border-[#2d2d4a] mt-1">
              Not a standard stocked size — Core Cutter can produce this as a special order with quick delivery. Contact us at 207-588-7519 or sales@corecutterusa.com
            </p>
          )}
        </div>
      )}

      {/* Core Cutter stocked option */}
      {ccDia !== null && ccCr !== null && (
        <div className="border border-emerald-800 rounded px-3 py-2 mt-1 space-y-1" style={{ background: "#052e16" }}>
          <p className="text-[10px] text-emerald-400 font-semibold mb-1">
            {ccSameAsIdeal ? "✓ Core Cutter stocks this size:" : "✓ Nearest Core Cutter stocked size:"}
          </p>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-300">Standard Diameter</span>
            <span className="font-semibold text-emerald-300">{fmtDia(ccDia, metric)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-300">Resulting Corner Radius</span>
            <span className="font-semibold text-white">{metric ? `${(ccCr*25.4).toFixed(3)} mm` : `${ccCr.toFixed(4)}"`}</span>
          </div>
          {ccEng !== null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-300">Corner Engagement</span>
              <span className="font-semibold text-emerald-300">{ccEng.theta.toFixed(1)}° ({ccEng.wocPct.toFixed(1)}% dia)</span>
            </div>
          )}
        </div>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Entry Angle & Load Spike Warning
// ─────────────────────────────────────────────────────────────────
function EntryLoadSpike() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [dia,        setDia]        = React.useState("");
  const [woc,        setWoc]        = React.useState("");
  const [entryType,  setEntryType]  = React.useState<"radial"|"ramp"|"arc">("radial");
  const [leadRadius, setLeadRadius] = React.useState("");

  const D  = metric ? n(dia) / 25.4 : n(dia);
  const ae = n(woc); // stored in inches by WocInput
  const lr = metric ? n(leadRadius) / 25.4 : n(leadRadius);
  const IN = metric ? 25.4 : 1;

  const valid = D > 0 && ae > 0 && ae <= D;

  // Steady-state engagement angle (degrees) — same formula as EngagementAngle calc
  const engRad       = valid ? Math.acos(Math.max(-1, Math.min(1, 1 - 2 * ae / D))) : 0;
  const engDeg       = engRad * 180 / Math.PI;

  // Entry type multiplier k: scales how abruptly the tool picks up load
  //   radial straight: k=1.0 — instant full chip, worst case
  //   ramp (1–5°):    k=0.5 — axial ramp softens it but radial shock remains
  //   tangential arc: k=0.15 — gradual pick-up, near-smooth
  const entryK: Record<string,number> = { radial: 1.0, ramp: 0.50, arc: 0.15 };
  const k = entryK[entryType] ?? 1.0;

  // Load spike multiplier: 1 + k × (engagement_angle / 180°)
  // At slot (180°): radial=2.0×, ramp=1.5×, arc=1.15×
  // At 25% WOC (90°): radial=1.5×, ramp=1.25×, arc=1.075×
  const spikeMult = valid ? 1 + k * (engDeg / 180) : 0;

  // Effective spike if arc lead-in radius is specified
  const arcEngRad   = lr > 0 && D > 0 ? Math.acos(Math.max(-1, Math.min(1, 1 - 2 * Math.min(lr, D/2) / D))) : engRad;
  const arcSpike    = entryType === "arc" && lr > 0
    ? 1 + entryK.arc * (arcEngRad * 180 / Math.PI) / 180
    : spikeMult;

  // Risk level
  const spike = entryType === "arc" && lr > 0 ? arcSpike : spikeMult;
  const risk  = spike < 1.25 ? "low" : spike < 1.55 ? "medium" : "high";
  const riskColor = { low: "#4ade80", medium: "#fbbf24", high: "#f87171" }[risk];
  const riskLabel = { low: "Low — entry is controlled", medium: "Moderate — consider a sweep / roll-in", high: "High — sweep / roll-in strongly recommended" }[risk];

  // Recommended minimum lead-in arc radius to bring spike below 1.2×
  // 1 + 0.15 × (acos(1 - 2r/D)×180/π / 180) < 1.20
  // acos(1 - 2r/D) < 0.20×π → 1 - 2r/D > cos(0.2π) ≈ 0.809 → r < D×(1-0.809)/2 ≈ 0.0955×D
  const recLeadRad = D > 0 ? D * 0.10 : 0;   // ~10% of tool dia keeps spike < 1.2× with arc entry

  usePrintRegister("Entry Load Spike", "Arcs & Contours", valid ? [
    { label: `Cutting Diameter (${dU})`, value: (D * IN).toFixed(metric?3:4) },
    { label: `WOC (${dU})`,           value: (ae * IN).toFixed(metric?3:4) },
    { label: "Entry Type",            value: { radial:"Straight Radial", ramp:"Ramp", arc:"Sweep / Roll-in" }[entryType] },
    { label: "Engagement Angle",      value: `${engDeg.toFixed(1)}°` },
    { label: "Load Spike Multiplier", value: `${spike.toFixed(2)}×`, highlight: true },
    { label: "Risk",                  value: riskLabel },
    { label: `Rec. Lead-In Radius (${dU})`, value: (recLeadRad * IN).toFixed(metric?3:4) },
  ] : null);

  return (
    <CalcCard title="Entry Angle & Load Spike" category="Arcs & Contours"
      onClear={() => { setDia(""); setWoc(""); setLeadRadius(""); setEntryType("radial"); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        When a tool first contacts material, instantaneous load spikes above steady-state. Entry method and arc lead-in radius determine how severe the spike is.
      </p>

      <Row label="Cutting Diameter" hint="Cutting diameter of the tool.">
        <NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric?"12.7":"0.500"} />
      </Row>
      <WocInput dia={D} value={woc} metric={metric} hint="Width of cut the tool will be at once in full engagement. Determines steady-state engagement angle and the load the tool ramps into at entry." onChange={(_, parsed) => setWoc(String(parsed))} />
      {ae > D && D > 0 && <p className="text-[11px] text-red-400">⚠ WOC cannot exceed tool diameter.</p>}

      {valid && (
        <div className="rounded bg-[#0d1b2a] border border-[#2d2d4a] px-3 py-2 flex justify-between text-[11px]">
          <span className="text-gray-400">Steady-state engagement angle</span>
          <span className="font-mono font-semibold text-white">{engDeg.toFixed(1)}°
            <span className="text-gray-500 ml-1">({(ae/D*100).toFixed(0)}% WOC)</span>
          </span>
        </div>
      )}

      {/* Entry type */}
      <Row label="Entry Method" hint="How the tool enters the cut. Straight radial is the most aggressive — the tool hits full chip thickness instantly. Arc lead-in gradually picks up material.">
        <div className="flex gap-1 flex-wrap">
          {([["radial","Straight Radial"],["ramp","Ramp"],["arc","Sweep / Roll-in"]] as const).map(([k,label]) => (
            <button key={k} type="button" onClick={() => setEntryType(k)}
              className="px-2 py-1 rounded text-[11px] font-semibold border transition-colors"
              style={{ borderColor: entryType===k?"#f97316":"#3f3f5a", backgroundColor: entryType===k?"#f97316":"transparent", color: entryType===k?"#fff":"#9ca3af" }}>
              {label}
            </button>
          ))}
        </div>
      </Row>

      {entryType === "arc" && (
        <Row label="Sweep Radius" hint="Radius of the tangential sweep arc used to enter the cut. Larger = smoother pick-up = lower spike. Minimum recommended: 10% of tool diameter.">
          <NumIn value={leadRadius} onChange={setLeadRadius} unit={dU} placeholder={metric?(D*IN*0.10).toFixed(2).toString():(D*0.10).toFixed(4).toString()} />
        </Row>
      )}

      {valid && (
        <>
          {/* Spike result */}
          <div className="rounded-lg border px-3 py-2.5 space-y-1.5"
            style={{ borderColor: riskColor + "55", backgroundColor: riskColor + "11" }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold" style={{ color: riskColor }}>Entry Load Spike</span>
              <span className="text-lg font-mono font-bold" style={{ color: riskColor }}>{spike.toFixed(2)}×</span>
            </div>
            <div className="text-[10px]" style={{ color: riskColor }}>{riskLabel}</div>
            <div className="text-[10px] text-gray-400 border-t border-white/10 pt-1.5 mt-1">
              {entryType !== "arc"
                ? <>Your spindle load meter will spike <span className="text-white font-semibold">{((spike-1)*100).toFixed(0)}% above steady-state</span> at first contact — e.g. if your normal cutting load is 40%, entry hits ~{(40 * spike).toFixed(0)}%.</>
                : lr > 0
                  ? <>Sweep arc picks up engagement gradually — first contact is only {(arcEngRad*180/Math.PI).toFixed(1)}° of arc, spiking <span className="text-white font-semibold">{((arcSpike-1)*100).toFixed(0)}% above steady-state</span> instead of {((spikeMult-1)*100).toFixed(0)}% for straight radial.</>
                  : <>Enter a sweep radius above to see how the arc reduces the entry spike.</>
              }
            </div>
          </div>

          {/* Spike bar */}
          <div>
            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
              <span>1.00× (steady state)</span>
              <span>2.00× (slot entry)</span>
            </div>
            <div className="h-2 rounded-full bg-[#1a1a2e] relative overflow-hidden">
              {/* Background zones */}
              <div className="absolute inset-y-0 left-0 w-[25%] bg-green-900/40 rounded-l-full" />
              <div className="absolute inset-y-0 left-[25%] w-[30%] bg-yellow-900/40" />
              <div className="absolute inset-y-0 left-[55%] right-0 bg-red-900/40 rounded-r-full" />
              {/* Spike marker */}
              <div className="absolute top-0 bottom-0 w-1 rounded-full -ml-0.5 transition-all"
                style={{ left: `${Math.min(98, (spike - 1) * 100)}%`, backgroundColor: riskColor }} />
            </div>
            <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
              <span>Safe</span><span>Moderate</span><span>High risk</span>
            </div>
          </div>

          {/* Recommendation */}
          <div className="rounded bg-[#0d1b2a] border border-[#2d2d4a] px-3 py-2 space-y-1 text-[11px]">
            <div className="text-gray-400 font-semibold mb-1">How to fix it</div>
            {entryType === "radial" && risk !== "low" && (
              <div className="space-y-1">
                <p className="text-white font-semibold">① Switch to Sweep / Roll-in entry in CAM <span className="text-green-400">(best fix — no cut parameter changes needed)</span></p>
                <p className="text-gray-400">Add a tangential arc lead-in move of ≥ {(recLeadRad * IN).toFixed(metric?2:4)} {dU} radius before the cut starts. This brings the spike from {spikeMult.toFixed(2)}× down to &lt;1.20× — a CAM programming change only, your feeds and speeds stay the same.</p>
                <p className="text-gray-500">② Reduce WOC — smaller stepover lowers the engagement angle and reduces the spike, but you'd need a significant WOC reduction for meaningful impact. Fix it in CAM first.</p>
              </div>
            )}
            {entryType === "ramp" && risk !== "low" && (
              <div className="space-y-1">
                <p className="text-white font-semibold">Add a sweep / roll-in arc to your ramp entry <span className="text-green-400">(CAM change only)</span></p>
                <p className="text-gray-400">Ramp reduces axial shock but the radial engagement still spikes at {spikeMult.toFixed(2)}× on first contact. Adding a tangential arc (≥ {(recLeadRad * IN).toFixed(metric?2:4)} {dU} radius) into the ramp entry fully controls it.</p>
              </div>
            )}
            {entryType === "arc" && lr > 0 && lr < recLeadRad && (
              <p className="text-amber-400">Increase sweep radius to ≥ {(recLeadRad * IN).toFixed(metric?2:4)} {dU} to bring spike below 1.20×.</p>
            )}
            {risk === "low" && (
              <p className="text-green-400">Entry is controlled — spike is within safe range for carbide tooling. No changes needed.</p>
            )}
            <p className="text-gray-500 mt-1.5 border-t border-white/10 pt-1.5">
              Chamfer mills: always enter via helical interpolation (G02/G03) — never straight plunge. Even a small sweep arc dramatically extends first-contact tool life.
            </p>
          </div>
        </>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Chamfer Mill Calculator
// ─────────────────────────────────────────────────────────────────
function ChamferMill() {
  const metric = useMetric();
  const dU = metric ? "mm" : "in";

  const [dia,    setDia]    = React.useState("");
  const [angle,  setAngle]  = React.useState("90");
  const [tipDia, setTipDia] = React.useState("");
  const [depth,  setDepth]  = React.useState("");
  const [flutes, setFlutes] = React.useState("");
  const [rpm,    setRpm]    = React.useState("");
  const [fpt,    setFpt]    = React.useState("");

  const D      = metric ? n(dia)    / 25.4 : n(dia);
  const tipD   = metric ? n(tipDia) / 25.4 : n(tipDia);
  const dep    = metric ? n(depth)  / 25.4 : n(depth);
  const fz     = metric ? n(fpt)    / 25.4 : n(fpt);
  const ang    = n(angle);
  const fl     = n(flutes);
  const sp     = n(rpm);
  const IN     = metric ? 25.4 : 1;

  const halfRad       = (ang / 2) * (Math.PI / 180);
  const sinH          = Math.sin(halfRad);
  const cosH          = Math.cos(halfRad);
  const tanH          = Math.tan(halfRad);
  const radialReach   = D > 0 && tipD < D ? (D - tipD) / 2 : 0;
  const edgeLength    = sinH > 0 && radialReach > 0 ? radialReach / sinH : 0;
  const maxDepth      = tanH > 0 && radialReach > 0 ? radialReach / tanH : 0;

  const depValid = dep > 0 && dep <= maxDepth && D > 0;
  const dEff          = depValid ? tipD + 2 * dep * tanH : 0;
  const edgeUsed      = depValid && cosH > 0 ? dep / cosH : 0;
  const edgePct       = edgeLength > 0 ? edgeUsed / edgeLength * 100 : 0;

  // Chip thinning: chamfer flank is at half_angle from tool axis.
  // Actual chip thickness = FPT × sin(half_angle) — much thinner than a vertical flute.
  const ctFactor      = sinH; // chip thin factor
  const hexActual     = fz * ctFactor;
  const fptCorrected  = ctFactor > 0 && fz > 0 ? fz / ctFactor : 0; // FPT needed to match same chip thickness as vertical cutter

  const ipmProgrammed = fl > 0 && sp > 0 && fz > 0 ? sp * fl * fz : 0;
  const ipmCorrected  = fl > 0 && sp > 0 && fptCorrected > 0 ? sp * fl * fptCorrected : 0;

  const hasGeo   = D > 0 && ang > 0;
  const hasFeed  = fz > 0 && hasGeo;
  const hasIpm   = fl > 0 && sp > 0 && hasFeed;

  usePrintRegister("Chamfer Mill", "Arcs & Contours", hasGeo ? [
    { label: `Tool Dia (${dU})`,          value: (D * IN).toFixed(metric ? 3 : 4) },
    { label: "Chamfer Angle (°)",          value: ang.toString() },
    { label: `Tip Dia (${dU})`,            value: (tipD * IN).toFixed(metric ? 3 : 4) },
    { label: `Edge Length (${dU})`,        value: (edgeLength * IN).toFixed(metric ? 3 : 4) },
    { label: `Max Depth (${dU})`,          value: (maxDepth * IN).toFixed(metric ? 3 : 4) },
    ...(depValid ? [
      { label: `Depth Entered (${dU})`,    value: (dep * IN).toFixed(metric ? 3 : 4) },
      { label: `Eff. Cut Dia (${dU})`,     value: (dEff * IN).toFixed(metric ? 3 : 4), highlight: true },
      { label: "Edge Engaged",             value: `${edgePct.toFixed(1)}%` },
    ] : []),
    ...(hasFeed ? [
      { label: "Chip Thin Factor",         value: ctFactor.toFixed(4) },
      { label: `Actual Chip Thickness (${dU})`, value: (hexActual * IN).toFixed(metric ? 4 : 5) },
      { label: `Adj FPT to match chip (${dU})`, value: (fptCorrected * IN).toFixed(metric ? 4 : 5), highlight: true },
    ] : []),
    ...(hasIpm ? [
      { label: "Programmed IPM",           value: (ipmProgrammed * IN).toFixed(metric ? 2 : 1) },
      { label: "Adj IPM (corrected FPT)",  value: (ipmCorrected * IN).toFixed(metric ? 2 : 1), highlight: true },
    ] : []),
  ] : null);

  return (
    <CalcCard title="Chamfer Mill" category="Arcs & Contours"
      onClear={() => { setDia(""); setTipDia(""); setDepth(""); setFlutes(""); setRpm(""); setFpt(""); }}>
      <p className="text-[10px] text-gray-500 -mt-1">
        Effective dia, edge engagement, and chip thinning along the angled flank.
      </p>

      {/* Tool Geometry */}
      <Row label="Tool Dia (outer)" hint="Outer cutting diameter — largest diameter of the chamfer teeth.">
        <NumIn value={dia} onChange={setDia} unit={dU} placeholder={metric ? "12.7" : "0.500"} />
      </Row>
      <Row label="Chamfer Angle" hint="Included angle of the tool (tip-to-tip). Common: 60°, 90°, 120°. CMH series also offers 82° and 100°.">
        <div className="flex gap-1 flex-wrap">
          {([60, 82, 90, 100, 120] as const).map(a => (
            <button key={a} type="button"
              onClick={() => setAngle(String(a))}
              className="px-2 py-1 rounded text-[11px] font-semibold border transition-colors"
              style={{ borderColor: ang === a ? "#f97316" : "#3f3f5a", backgroundColor: ang === a ? "#f97316" : "transparent", color: ang === a ? "#fff" : "#9ca3af" }}>
              {a}°
            </button>
          ))}
        </div>
      </Row>
      <Row label="Tip Dia" hint="Flat at the very tip. CMS series = 0 (point / center-cutting). CMH series has a non-zero tip flat — check catalog.">
        <NumIn value={tipDia} onChange={setTipDia} unit={dU} placeholder="0 = point" />
      </Row>

      {hasGeo && (
        <div className="rounded bg-[#0d1b2a] border border-[#2d2d4a] px-3 py-2 space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-400">Cutting edge length</span>
            <span className="font-mono text-orange-400 font-semibold">{(edgeLength * IN).toFixed(metric ? 3 : 4)} {dU}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-400">Max achievable depth</span>
            <span className="font-mono text-orange-400 font-semibold">{(maxDepth * IN).toFixed(metric ? 3 : 4)} {dU}</span>
          </div>
        </div>
      )}

      {/* Depth & Engagement */}
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">Enter chamfer depth to cut → engagement &amp; effective dia</p>
        <Row label="Chamfer Depth" hint="Axial depth of the chamfer being cut into the part.">
          <NumIn value={depth} onChange={setDepth} unit={dU} placeholder={metric ? "1.0" : "0.040"} />
        </Row>
        {dep > 0 && hasGeo && dep > maxDepth && (
          <p className="text-[11px] text-red-400 mt-1">⚠ Depth exceeds tool capacity ({(maxDepth * IN).toFixed(metric ? 3 : 4)} {dU} max)</p>
        )}
        {depValid && <>
          <Result label={`Effective Cut Dia at Depth (${dU})`} value={`${(dEff * IN).toFixed(metric ? 3 : 4)}`} highlight />
          <Result label="Cutting Edge Engaged" value={`${edgePct.toFixed(1)}% of flank (${(edgeUsed * IN).toFixed(metric ? 3 : 4)} ${dU})`} />
        </>}
      </div>

      {/* Chip Thinning */}
      <div className="border-t border-[#2d2d4a] pt-2">
        <p className="text-[10px] text-gray-500 mb-2">Enter programmed FPT → chip thinning impact</p>
        <Row label="Programmed FPT" hint="Feed per tooth programmed in CAM. On a chamfer mill, the angled flank thins the chip — you often need to program a higher FPT to get real chip load.">
          <NumIn value={fpt} onChange={setFpt} unit={dU} placeholder={metric ? "0.025" : "0.001"} />
        </Row>
        {hasFeed && <>
          <div className="rounded bg-[#0d1b2a] border border-[#2d2d4a] px-3 py-2 space-y-1 mt-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-400">Chip thin factor (sin {ang/2}°)</span>
              <span className="font-mono text-gray-200">{ctFactor.toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-400">Actual chip thickness</span>
              <span className="font-mono text-amber-400">{(hexActual * IN).toFixed(metric ? 4 : 5)} {dU} ({(ctFactor * 100).toFixed(1)}% of FPT)</span>
            </div>
          </div>
          <Result
            label={`Adjusted FPT to maintain chip load (${dU})`}
            value={`${(fptCorrected * IN).toFixed(metric ? 4 : 5)}`}
            highlight
          />
        </>}
      </div>

      {/* Feed Rate */}
      {hasFeed && (
        <div className="border-t border-[#2d2d4a] pt-2">
          <p className="text-[10px] text-gray-500 mb-2">Enter spindle speed + flutes → compare programmed vs adjusted IPM</p>
          <Row label="Flutes" hint="Number of cutting flutes on the chamfer mill.">
            <NumIn value={flutes} onChange={setFlutes} placeholder="2" />
          </Row>
          <Row label="Spindle Speed" hint="RPM — use the RPM↔SFM calculator above if needed.">
            <NumIn value={rpm} onChange={setRpm} unit="RPM" placeholder="3500" />
          </Row>
          {hasIpm && <>
            <Result label={`Programmed IPM (at entered FPT)`} value={`${(ipmProgrammed * IN).toFixed(metric ? 2 : 1)} ${metric ? "mm/min" : "IPM"}`} />
            <Result label={`Adjusted IPM (corrected FPT)`}    value={`${(ipmCorrected  * IN).toFixed(metric ? 2 : 1)} ${metric ? "mm/min" : "IPM"}`} highlight />
          </>}
        </div>
      )}
    </CalcCard>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────
const SECTIONS: { heading: string; color: string; ids: string[] }[] = [
  { heading: "Speed & Feed",    color: "#6366f1", ids: ["rpm-sfm","ipm","chip-thin","engagement","min-chip"] },
  { heading: "Surface Finish",  color: "#10b981", ids: ["cusp","eff-dia","surf-finish","ballnose-vel"] },
  { heading: "Arcs & Contours", color: "#f97316", ids: ["arc-feed","helix-entry","bore-enlarge","no-middle-post","bolt-circle","chord-sag","corner-clear","chamfer-mill","entry-spike"] },
  { heading: "Hole Making",     color: "#0ea5e9", ids: ["tap-drill","drill-point","drill-torque"] },
  { heading: "Power & MRR",     color: "#f43f5e", ids: ["mrr"] },
  { heading: "Materials",       color: "#a78bfa", ids: ["hardness","mat-cond"] },
  { heading: "Conversions",     color: "#f59e0b", ids: ["unit-conv"] },
];

const CALC_MAP: Record<string, React.ReactNode> = {
  "rpm-sfm":     <RpmSfm />,
  "ipm":         <IpmCalc />,
  "chip-thin":   <ChipThinning />,
  "engagement":  <EngagementAngle />,
  "min-chip":    <MinChipThickness />,
  "cusp":        <CuspHeight />,
  "eff-dia":     <EffectiveDia />,
  "surf-finish":  <SurfaceFinishFlat />,
  "ballnose-vel": <BallNoseVelocity />,
  "arc-feed":     <FeedArcCorrection />,
  "helix-entry":  <HelixEntry />,
  "bore-enlarge": <BoreEnlargement />,
  "no-middle-post": <NoMiddlePost />,
  "bolt-circle":  <BoltCircle />,
  "chord-sag":    <ChordSagitta />,
  "corner-clear": <CornerClearance />,
  "chamfer-mill": <ChamferMill />,
  "entry-spike":  <EntryLoadSpike />,
  "tap-drill":   <TapDrill />,
  "drill-point":  <DrillPointDepth />,
  "drill-torque": <DrillingTorque />,
  "mrr":         <MRR />,
  "hardness":    <HardnessTensile />,
  "mat-cond":    <MaterialHardnessLookup />,
  "unit-conv":   <UnitConverter />,
};

export default function Calculators() {
  const [search, setSearch] = React.useState("");
  const [metric, setMetric] = React.useState(false);
  const q = search.toLowerCase();

  const TITLES: Record<string, string> = {
    "rpm-sfm":     "rpm sfm surface speed converter",
    "ipm":         "ipm feed rate chip load fpt flutes",
    "peripheral":  "peripheral feed sfm rpm surface speed",
    "chip-thin":   "chip thinning woc radial engagement correction",
    "engagement":  "engagement angle arc contact woc teeth in cut heat chip thickness radial immersion",
    "cusp":        "cusp height ball end mill scallop stepover surface finish",
    "eff-dia":     "effective diameter ball end depth axial",
    "surf-finish":  "surface finish ra stepover flat end mill",
    "ballnose-vel": "ball nose velocity sfm dead zone tilt lead angle contact effective diameter",
    "arc-feed":     "feed correction arc inside outside concave convex",
    "helix-entry":  "helix entry ramp angle pitch helical interpolation pocket plunge",
    "bore-enlarge": "bore enlargement circular interpolation radial pass arc engagement woc feed multiplier",
    "no-middle-post": "core post helical entry solid stock standing post endmill bore pocket diameter minimum tool",
    "bolt-circle":  "bolt circle hole pattern xy coordinates bcd radius",
    "chord-sag":    "chord sagitta arc height curved surface depth",
    "corner-clear": "corner radius clearance tool fits pocket inside corner",
    "chamfer-mill": "chamfer mill effective diameter depth engagement chip thinning feed adjustment fpt angled flank",
    "entry-spike":  "entry angle load spike tool entry ramp arc lead-in radial engagement shock force first contact chamfer",
    "tap-drill":   "tap drill size thread engagement percent metric inch",
    "drill-point":  "drill point depth tip angle 118 135",
    "drill-torque": "drilling torque in-lbs nm hp kw rpm spindle power",
    "mrr":         "metal removal rate mrr hp horsepower power",
    "hardness":    "hardness tensile strength hrc hrb hb vickers brinell rockwell uts ksi mpa steel aluminum",
    "mat-cond":    "material condition hardness h900 h925 h1025 4140 7075 h13 a2 d2 inconel titanium temper annealed",
    "unit-conv":   "unit converter metric imperial mm inch sfm m/min ipm mm/min temperature celsius fahrenheit",
  };

  const visible = (id: string) => !q || TITLES[id]?.toLowerCase().includes(q);
  const printRegistry = React.useRef<Map<string, PrintEntry>>(new Map());
  const [textCopied, setTextCopied] = React.useState(false);

  function copyAsText() {
    const entries = Array.from(printRegistry.current.values());
    if (entries.length === 0) { alert("No calculator results to copy yet — enter some values first."); return; }
    const now = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const divider = "─".repeat(44);
    const lines: string[] = [
      "CoreCutCNC — Calculator Results",
      `Generated: ${now}`,
      divider,
      "",
    ];
    for (const e of entries) {
      lines.push(`[${e.category}]  ${e.title}`);
      const maxLabel = Math.max(...e.rows.map(r => r.label.length));
      for (const r of e.rows) {
        const pad = ".".repeat(Math.max(2, maxLabel - r.label.length + 3));
        lines.push(`  ${r.label} ${pad} ${r.highlight ? "► " : "  "}${r.value}`);
      }
      lines.push("");
    }
    lines.push(divider);
    lines.push("Produced with CoreCutCNC by Core Cutter LLC  |  corecutcnc.com");
    lines.push(`© ${new Date().getFullYear()} Core Cutter LLC. All Rights Reserved.`);
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2500);
    });
  }

  function printCalcPdf() {
    const entries = Array.from(printRegistry.current.values());
    if (entries.length === 0) { alert("No calculator results to print yet — enter some values first."); return; }
    const now = new Date().toLocaleString();
    const row = (label: string, value: string, hi = false) =>
      `<tr><td style="padding:5px 10px;color:#555;font-size:11px;border-bottom:1px solid #eee">${label}</td><td style="padding:5px 10px;font-size:12px;font-weight:600;text-align:right;border-bottom:1px solid #eee;${hi ? "color:#e55a00" : "color:#111"}">${value}</td></tr>`;
    const sections = entries.map(e =>
      `<div style="break-inside:avoid;margin-bottom:16px">
        <div style="background:#f5f5f5;padding:4px 10px;border-left:3px solid #e55a00;margin-bottom:4px">
          <span style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.05em">${e.category}</span>
          <span style="font-size:13px;font-weight:700;color:#111;margin-left:8px">${e.title}</span>
        </div>
        <table style="width:100%;border-collapse:collapse">${e.rows.map(r => row(r.label, r.value, r.highlight)).join("")}</table>
      </div>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><title>Core Cutter — Calculator Results</title>
    <style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#fff;color:#111}
    @media print{body{padding:0}}</style></head><body>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border-bottom:2px solid #e55a00;padding-bottom:12px;margin-bottom:20px;gap:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${window.location.origin}/CCLogo-long-whiteback%20TRANSPARENT.png" alt="Core Cutter" style="height:48px;width:auto">
      </div>
      <div style="text-align:center;color:#555;font-size:10px">
        <strong style="font-size:13px;color:#111;display:block">Calculator Results</strong>
        ${now}
      </div>
      <div style="text-align:right;font-size:10px;color:#555;line-height:1.6">
        120 Technology Drive<br>Gardiner, ME 04345<br>(p) 207-588-7519<br>sales@corecutterusa.com
      </div>
    </div>
    <div style="columns:2;column-gap:20px">${sections}</div>
    <div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#999;line-height:1.6">
      <strong style="color:#555">Starting parameters only — not a guarantee of performance.</strong> These values are calculated references and should be verified against actual setup conditions including machine rigidity, material lot variation, and tooling condition. Always begin conservatively.<br>
      ════════════════════════════════════════<br>
      <strong>© ${new Date().getFullYear()} Core Cutter LLC. All Rights Reserved.</strong> &nbsp;|&nbsp; CoreCutCNC &nbsp;|&nbsp; corecutcnc.com
    </div>
    <script>window.onload=()=>{window.print()}</script></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  return (
    <PrintCtx.Provider value={printRegistry}>
    <MetricCtx.Provider value={metric}>
    <div className="space-y-6 pb-10">

      {/* Unit toggle + print header */}
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={printCalcPdf}
          className="px-3 py-1.5 rounded text-xs font-semibold border border-orange-600 text-orange-400 hover:bg-orange-900/30 transition-colors"
        >Print / Save PDF</button>
        <button
          type="button"
          onClick={copyAsText}
          className="px-3 py-1.5 rounded text-xs font-semibold border border-indigo-600 text-indigo-400 hover:bg-indigo-900/30 transition-colors"
        >{textCopied ? "✓ Copied!" : "Copy as Text"}</button>
        <div className="flex items-center gap-1 rounded-lg border border-[#2d2d4a] p-0.5" style={{ background: "#16213e" }}>
          <button
            type="button"
            onClick={() => setMetric(false)}
            className="px-4 py-1.5 rounded text-xs font-semibold transition-all"
            style={{ background: !metric ? "#6366f1" : "transparent", color: !metric ? "#fff" : "#9ca3af" }}
          >in / SFM</button>
          <button
            type="button"
            onClick={() => setMetric(true)}
            className="px-4 py-1.5 rounded text-xs font-semibold transition-all"
            style={{ background: metric ? "#6366f1" : "transparent", color: metric ? "#fff" : "#9ca3af" }}
          >mm / m·min⁻¹</button>
        </div>
        </div>
      </div>

      {/* Search */}
      <div className="sticky top-0 z-10 pt-1 pb-3" style={{ background: "#0d1b2a" }}>
        <input
          type="text"
          placeholder="Search calculators…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-[#2d2d4a] bg-[#16213e] text-white text-sm px-4 py-2
                     focus:outline-none focus:border-indigo-500 placeholder:text-gray-500"
        />
      </div>

      {SECTIONS.map(({ heading, color, ids }) => {
        const visIds = ids.filter(visible);
        if (visIds.length === 0) return null;
        return (
          <div key={heading}>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-0.5 w-4 rounded" style={{ background: color }} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color }}>{heading}</span>
              <div className="flex-1 h-px" style={{ background: color + "33" }} />
            </div>
            <div className="block sm:columns-2 gap-4">
              {visIds.map((id) => (
                <div key={id} className="break-inside-avoid mb-4">{CALC_MAP[id]}</div>
              ))}
            </div>
          </div>
        );
      })}

      {SECTIONS.every(({ ids }) => ids.filter(visible).length === 0) && (
        <p className="text-center text-gray-500 text-sm pt-10">No calculators match "{search}"</p>
      )}
    </div>
    </MetricCtx.Provider>
    </PrintCtx.Provider>
  );
}
