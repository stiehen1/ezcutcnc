// Coating catalog — single source of truth for both UI and engine
// SFM multipliers are relative to AlTiN (A-Max) baseline = 1.00

export interface CoatingDef {
  key: string;              // matches engine COATING_SFM_MULT key (case-insensitive)
  label: string;            // display name
  sfm_mult: number;         // SFM multiplier vs A-Max baseline
  max_temp_c: number | null;
  chemistry: string;
  description: string;
  best_iso: string[];       // ISO categories this coating excels at
  avoid_iso: string[];      // ISO categories to warn on
  color: string;            // coating color for display badge
}

export const COATINGS: CoatingDef[] = [
  {
    key: "T-Max",
    label: "T-Max (TiAlSiN HiPIMS)",
    sfm_mult: 1.10,
    max_temp_c: 1100,
    chemistry: "TiAlSiN",
    description: "Cemecon Inoxicon HiPIMS — premium hard & abrasive coating. Nanocomposite TiAlSiN structure, ~3500 HV. Best for hardened steels, PM tool steels, stainless, Inconel.",
    best_iso: ["M", "S", "H", "P"],
    avoid_iso: [],
    color: "text-yellow-400",
  },
  {
    key: "A-Max",
    label: "A-Max (AlTiN)",
    sfm_mult: 1.00,
    max_temp_c: 900,
    chemistry: "AlTiN",
    description: "Aluminum Titanium Nitride — production baseline for ferrous materials. Excellent heat resistance. Best for steel, stainless, titanium.",
    best_iso: ["P", "M", "K", "S"],
    avoid_iso: [],
    color: "text-violet-400",
  },
  {
    key: "P-Max",
    label: "P-Max (TiAlN/TiSiN)",
    sfm_mult: 1.03,
    max_temp_c: 950,
    chemistry: "TiAlN / TiSiN",
    description: "Nanocomposite TiAlN/TiSiN. Strong in steel and stainless — improved hardness and adhesion vs standard AlTiN.",
    best_iso: ["P", "M"],
    avoid_iso: [],
    color: "text-blue-400",
  },
  {
    key: "C-Max",
    label: "C-Max (CrN)",
    sfm_mult: 1.05,
    max_temp_c: 700,
    chemistry: "CrN / nano-CrN",
    description: "Chromium nitride — low friction, excellent for gummy/work-hardening materials. Good for stainless, abrasive cast irons.",
    best_iso: ["M", "K", "P"],
    avoid_iso: [],
    color: "text-slate-300",
  },
  {
    key: "D-Max",
    label: "D-Max (DLC)",
    sfm_mult: 1.20,
    max_temp_c: 350,
    chemistry: "Diamond-Like Carbon",
    description: "Non-ferrous only. Exceptional for aluminum and copper alloys — lowest friction, no built-up edge. Reacts with ferrous materials at cutting temperatures.",
    best_iso: ["N"],
    avoid_iso: ["P", "M", "S", "H", "K"],
    color: "text-zinc-400",
  },
  {
    key: "Uncoated",
    label: "Uncoated",
    sfm_mult: 0.85,
    max_temp_c: null,
    chemistry: "None",
    description: "Uncoated carbide. Best for non-ferrous materials where coating build-up is a concern. Reduce SFM ~15% vs AlTiN baseline on ferrous.",
    best_iso: ["N"],
    avoid_iso: [],
    color: "text-zinc-500",
  },
];

export const COATING_BY_KEY: Record<string, CoatingDef> = Object.fromEntries(
  COATINGS.map(c => [c.key.toLowerCase(), c])
);

/** Return the coating def for a given key (case-insensitive), or undefined */
export function getCoatingDef(key: string): CoatingDef | undefined {
  return COATING_BY_KEY[(key || "").trim().toLowerCase()];
}

/** Return the SFM multiplier for a given coating key (1.0 if unknown) */
export function coatingSfmMult(key: string): number {
  return getCoatingDef(key)?.sfm_mult ?? 1.0;
}

/** Return true if this coating is incompatible with the given ISO category */
export function coatingIncompatible(coatingKey: string, isoCategory: string): boolean {
  const def = getCoatingDef(coatingKey);
  if (!def) return false;
  return def.avoid_iso.includes(isoCategory.toUpperCase());
}
