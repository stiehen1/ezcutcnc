export const MATERIAL_NOTES: Record<string, string> = {
  // N — Non-Ferrous
  "aluminum_wrought":    "Excellent machinability — run aggressive SFM and chip loads. Sharp flutes and flood coolant prevent built-up edge, the main failure mode in aluminum.",
  "aluminum_cast":       "Abrasive silicon particles wear edges faster than wrought. Reduce chip load for high-silicon grades (A390); coated or PCD tooling extends life in production.",
  "non_ferrous":         "Soft but gummy — copper especially smears and grabs the edge. High feed, sharp polished flutes; never dwell or let the tool rub.",
  // P — Steel
  "steel_free":          "Easiest steel to machine. Sulfur additives break chips cleanly at high SFM — run it fast, push the feed, and tool wear is minimal.",
  "steel_alloy":         "Tough alloy steel (4140, 4340) that responds well to high chip loads. Variable-pitch geometry and TiAlN coating control chatter and heat.",
  "tool_steel_p20":      "Prehardened mold steel (~30 HRC) — cuts like firm alloy steel. Well-suited to long roughing passes with standard TiAlN solid carbide endmills.",
  "tool_steel_a2":       "Air-hardening tool steel — tougher than D2 and more forgiving on cutting edges. Machines consistently at working hardness; AlTiN coating preferred.",
  "tool_steel_h13":      "Hot-work die steel (44–48 HRC typical). Work-hardens at the cut if the tool rubs — keep feed up and never let the tool dwell. AlTiN or AlCrN coating required.",
  "tool_steel_s7":       "Shock-resistant and tough, but less abrasive than D2 — more forgiving on cutting edges. Good for punches and dies where impact resistance matters.",
  "tool_steel_d2":       "The most abrasive common tool steel. High chromium carbide content eats edges fast — conservative SFM, reduced chip load, and expect shorter tool life.",
  "cpm_10v":             "PM high-vanadium wear steel (A11). Vanadium carbides are harder than carbide binders — treat this as an abrasion problem, not a heat problem. Lower SFM than D2, moderate chip load (don't baby it — rubbing on vanadium carbides accelerates edge breakdown faster than correct chip load). HEM with 5–15% WOC is the preferred strategy; AlTiN or AlCrN coating required.",
  // M — Stainless Steel
  "stainless_fm":        "303 and 416 are the sulfur-added free-machining grades — the easiest stainless to cut by a wide margin. Fast, clean chips; runs significantly faster than 304.",
  "stainless_ferritic":  "Machines more like carbon steel than austenitic SS — far less work-hardening and gumminess. A good option when corrosion resistance is needed without the headaches of 304/316.",
  "stainless_410":       "Standard martensitic stainless — harder and more force-intensive than austenitic grades, but less gummy. Keep SFM up to prevent built-up edge; TiAlN coating helps.",
  "stainless_420":       "Higher carbon than 410 and more wear-resistant. In the annealed state it cuts like firm 410; in the hardened condition treat it more like a hardened steel.",
  "stainless_440c":      "High-carbon martensitic SS — abrasive and hard (up to 60 HRC hardened). Treat it like a tool steel; conservative chip load, AlTiN coating required.",
  "stainless_304":       "Work-hardens instantly if the tool rubs or dwells. Maintain a positive, consistent chip load at all times — any hesitation notches the edge.",
  "stainless_316":       "High work hardening rate, low thermal conductivity, and high ductility produce stringy, built-up-edge chips. Molybdenum makes it stickier than 304 — run sharp tools, stay off the rubbing zone, and use high-pressure coolant or TSC.",
  "stainless_ph":        "High strength with less gumminess than 304 — but still wants consistent chip load. Flood or TSC coolant recommended; don't treat it like regular alloy steel.",
  "stainless_duplex":    "High-strength dual-phase SS — stronger than 304 and less prone to stress corrosion. Still work-hardens and punishes rubbing; needs a rigid setup and consistent engagement.",
  "stainless_superduplex": "The most demanding common stainless grade. Very high strength means it loads the tool hard — conservative SFM, consistent chip load, and the best rigidity you can get.",
  // K — Cast Iron
  "cast_iron_gray":      "Excellent machinability — graphite flakes lubricate the cut naturally. Machine dry or with mist; flood coolant risks thermal cracking on the part.",
  "cast_iron_ductile":   "Tougher than gray iron with longer, more ductile chips. Slight SFM reduction; same preference for dry or mist cutting.",
  "cast_iron_malleable": "Good machinability with clean chip break. More abrasive on edges than gray iron; standard uncoated or TiN carbide handles it well.",
  // S — Superalloys / Titanium
  "titanium_cp":         "Springy and prone to galling — the tool wants to weld to the workpiece at low feed. High chip load at low SFM; TSC or flood coolant is not optional.",
  "titanium_64":         "Heat-trapping, work-hardening, and notch-sensitive. Sharp geometry, high chip load, high-pressure coolant; never slow down or dwell mid-cut.",
  "hiTemp_fe":           "Iron-based superalloy (A-286, Incoloy 800) — aggressive work-hardening, heat stays in the tool. Lower SFM than nickel alloys but same unforgiving behavior; TSC essential.",
  "hiTemp_co":           "Cobalt superalloy (Stellite) — extremely abrasive and punishing on cutting edges. PVD coating required; conservative SFM and feed, no exceptions.",
  "monel_k500":          "Nickel-copper age-hardened alloy — the friendliest grade in this family. Still wants consistent chip load and flood coolant, but runs meaningfully faster than 718 or Waspaloy.",
  "inconel_625":         "Corrosion-focused nickel alloy — more machinable than 718 because strength-at-temperature isn't the design goal. Still work-hardens; keep the tool engaged and chip load consistent.",
  "inconel_718":         "Most common aerospace nickel alloy — work-hardening, heat-building, and gummy. Traditional roughing at conservative SFM; HEM at low WOC is the only practical high-feed strategy.",
  "hastelloy_x":         "Mid-tier aerospace/industrial Ni alloys — tougher than 625/718 family due to higher strength objectives. Drop SFM and chip load below 718; TSC strongly recommended.",
  "waspaloy":            "Hot-section aerospace alloys — among the most demanding Ni alloys to machine. Work-hardens rapidly, notches tools aggressively; conservative SFM and consistent engagement are non-negotiable.",
  "mp35n":               "Ultra-high-strength Ni-Co-Cr-Mo alloy — used in medical implants and sour-service oilfield hardware. The most demanding grade here; treat every parameter conservatively.",
  // H — Hardened Steel
  "hardened_lt55":       "Hard enough to challenge solid carbide — TiAlN/AlCrN coating and conservative chip loads are required. Light WOC with higher DOC is more efficient than full-width cuts.",
  "hardened_gt55":       "At the upper limit for solid carbide — CBN tooling is preferred above 60 HRC. Extremely light chip loads; any tool flex causes immediate chipping.",
};

export const ISO_CATEGORIES = [
  { iso: "N", label: "Non-Ferrous",    color: "#8BC34A" },
  { iso: "P", label: "Steel",          color: "#90CAF9" },
  { iso: "M", label: "Stainless",      color: "#FDD835" },
  { iso: "K", label: "Cast Iron",      color: "#EF5350" },
  { iso: "S", label: "Superalloys",    color: "#FFA726" },
  { iso: "H", label: "Hardened Steel", color: "#BDBDBD" },
] as const;

export type IsoCategory = (typeof ISO_CATEGORIES)[number]["iso"];

export const ISO_SUBCATEGORIES = [
  // N — Non-Ferrous (hardness not applicable)
  { iso: "N" as IsoCategory, key: "aluminum_wrought",      label: "Wrought Aluminum (6061, 7075)",           hardness: { value: 0,  scale: "hrb" as const } },
  { iso: "N" as IsoCategory, key: "aluminum_cast",         label: "Cast Aluminum (A360, A380, A390)",         hardness: { value: 0,  scale: "hrb" as const } },
  { iso: "N" as IsoCategory, key: "non_ferrous",           label: "Copper / Brass / Bronze",                  hardness: { value: 0,  scale: "hrb" as const } },
  // P — Steel
  { iso: "P" as IsoCategory, key: "steel_free",            label: "Free Machining Steel (1018, 1215, 12L14)", hardness: { value: 80, scale: "hrb" as const } },
  { iso: "P" as IsoCategory, key: "steel_alloy",           label: "Alloy Steel (4130, 4140, 4340, 8620)",     hardness: { value: 32, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_p20",        label: "P20 Tool Steel (prehardened ~30 HRC)",      hardness: { value: 30, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_a2",         label: "A2 Tool Steel",                             hardness: { value: 36, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_h13",        label: "H13 Tool Steel",                            hardness: { value: 44, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_s7",         label: "S7 Tool Steel",                             hardness: { value: 38, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_d2",         label: "D2 Tool Steel",                             hardness: { value: 58, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "cpm_10v",               label: "CPM 10V / A11 (PM Tool Steel)",               hardness: { value: 60, scale: "hrc" as const } },
  // M — Stainless Steel
  { iso: "M" as IsoCategory, key: "stainless_fm",          label: "303 / 416 Free-Machining Stainless",          hardness: { value: 85, scale: "hrb" as const } },
  { iso: "M" as IsoCategory, key: "stainless_ferritic",    label: "Ferritic Stainless (409 / 430 / 441)",         hardness: { value: 80, scale: "hrb" as const } },
  { iso: "M" as IsoCategory, key: "stainless_410",         label: "410 Martensitic Stainless",                   hardness: { value: 22, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_420",         label: "420 Martensitic Stainless",                   hardness: { value: 25, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_440c",        label: "440C Stainless",                              hardness: { value: 58, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_304",         label: "304 / 304L / 321 Stainless",                  hardness: { value: 85, scale: "hrb" as const } },
  { iso: "M" as IsoCategory, key: "stainless_316",         label: "316 / 316L Stainless (Mo-bearing)",           hardness: { value: 85, scale: "hrb" as const } },
  { iso: "M" as IsoCategory, key: "stainless_ph",          label: "17-4PH / 15-5PH / 13-8MO Stainless",         hardness: { value: 33, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_duplex",      label: "Duplex Stainless (2205)",                     hardness: { value: 30, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_superduplex", label: "Super Duplex Stainless (2507)",               hardness: { value: 32, scale: "hrc" as const } },
  // K — Cast Iron
  { iso: "K" as IsoCategory, key: "cast_iron_gray",        label: "Gray Cast Iron (GG10, GG20, GG30)",           hardness: { value: 92, scale: "hrb" as const } },
  { iso: "K" as IsoCategory, key: "cast_iron_ductile",     label: "Ductile Cast Iron (GGG-40, GGG-50, GGG-60)",  hardness: { value: 90, scale: "hrb" as const } },
  { iso: "K" as IsoCategory, key: "cast_iron_malleable",   label: "Malleable Cast Iron (GTS-35-10, GTS-45-06)",  hardness: { value: 82, scale: "hrb" as const } },
  // S — Superalloys / Titanium
  { iso: "S" as IsoCategory, key: "titanium_cp",           label: "CP Titanium Grade 1–4",                       hardness: { value: 80, scale: "hrb" as const } },
  { iso: "S" as IsoCategory, key: "titanium_64",           label: "Ti-6Al-4V (Grade 5)",                         hardness: { value: 36, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "hiTemp_fe",             label: "A-286 / Incoloy 800 / Udimet (Fe-based)",     hardness: { value: 85, scale: "hrb" as const } },
  { iso: "S" as IsoCategory, key: "hiTemp_co",             label: "Stellite (Co-based superalloy)",              hardness: { value: 35, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "monel_k500",            label: "Monel K-500 (Ni-Cu age-hardened)",            hardness: { value: 30, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "inconel_625",           label: "Inconel 625 / Hastelloy C-276",               hardness: { value: 25, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "inconel_718",           label: "Inconel 718",                                 hardness: { value: 40, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "hastelloy_x",           label: "Hastelloy X / Inconel 725 / X-750",           hardness: { value: 85, scale: "hrb" as const } },
  { iso: "S" as IsoCategory, key: "waspaloy",              label: "Waspaloy / HAYNES 282 / René 41",             hardness: { value: 40, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "mp35n",                 label: "MP35N (Ni-Co-Cr-Mo ultra-high-strength)",     hardness: { value: 40, scale: "hrc" as const } },
  // H — Hardened Steel
  { iso: "H" as IsoCategory, key: "hardened_lt55",         label: "Hardened Steel < 55 HRC",  hardness: { value: 48, scale: "hrc" as const } },
  { iso: "H" as IsoCategory, key: "hardened_gt55",         label: "Hardened Steel > 55 HRC",  hardness: { value: 60, scale: "hrc" as const } },
];

export type MaterialKey = (typeof ISO_SUBCATEGORIES)[number]["key"];

// Realistic hardness range per material, in the material's native scale.
// Used to warn the user if they enter a physically implausible hardness.
// "note" is displayed when out of range or wrong scale is selected.
export const MATERIAL_HARDNESS_RANGE: Record<string, {
  min: number; max: number; scale: "hrb" | "hrc"; note: string;
}> = {
  // P — Steel
  "steel_free":      { min: 55, max: 95,  scale: "hrb", note: "Free-machining steels (1018, 1215) range 55–95 HRB — they cannot be significantly hardened." },
  "steel_alloy":     { min: 18, max: 52,  scale: "hrc", note: "Alloy steels (4140, 4340) range 18–52 HRC depending on temper condition." },
  "tool_steel_p20":  { min: 28, max: 36,  scale: "hrc", note: "P20 is supplied prehardened 28–36 HRC — outside this range it's likely a different condition." },
  "tool_steel_a2":   { min: 54, max: 62,  scale: "hrc", note: "A2 in working condition is hardened 54–62 HRC. Annealed (~92 HRB) is pre-heat treat stock." },
  "tool_steel_h13":  { min: 44, max: 54,  scale: "hrc", note: "H13 die steel typical working range is 44–54 HRC. Below 44 is annealed or under-tempered." },
  "tool_steel_s7":   { min: 54, max: 60,  scale: "hrc", note: "S7 shock-resistant tool steel is hardened 54–60 HRC in service." },
  "tool_steel_d2":   { min: 58, max: 64,  scale: "hrc", note: "D2 tool steel hardened range is 58–64 HRC. It's rarely machined at lower hardness." },
  "cpm_10v":         { min: 58, max: 64,  scale: "hrc", note: "CPM 10V / A11 is typically used at 58–64 HRC. Below 55 HRC is annealed stock — machinability improves substantially but is still worse than D2 due to vanadium carbide abrasion." },
  // M — Stainless
  "stainless_fm":        { min: 65, max: 95,  scale: "hrb", note: "303/416 free-machining stainless ranges 65–95 HRB — sulfur additives prevent heat-treat hardening." },
  "stainless_ferritic":  { min: 65, max: 95,  scale: "hrb", note: "Ferritic stainless (409/430/441) cannot be hardened by heat treatment — HRB scale only." },
  "stainless_410":       { min: 20, max: 40,  scale: "hrc", note: "410 martensitic stainless: annealed ~80 HRB, hardened up to ~40 HRC." },
  "stainless_420":       { min: 22, max: 52,  scale: "hrc", note: "420 can reach 50–52 HRC fully hardened; annealed condition is ~92 HRB." },
  "stainless_440c":      { min: 55, max: 62,  scale: "hrc", note: "440C is the highest-hardness common stainless — 55–62 HRC fully hardened." },
  "stainless_304":       { min: 65, max: 95,  scale: "hrb", note: "304/316/321 austenitic stainless cannot be hardened by heat treatment — HRB scale only." },
  "stainless_316":       { min: 65, max: 95,  scale: "hrb", note: "316 austenitic stainless cannot be hardened by heat treatment — HRB scale only." },
  "stainless_ph":        { min: 28, max: 45,  scale: "hrc", note: "PH stainless (17-4PH, 15-5PH) age-hardens to 28–45 HRC depending on condition (H900–H1150)." },
  "stainless_duplex":    { min: 24, max: 35,  scale: "hrc", note: "Duplex 2205 is not heat-treatable — typical range 24–35 HRC." },
  "stainless_superduplex": { min: 26, max: 38, scale: "hrc", note: "Super duplex 2507 typical range 26–38 HRC — not heat-treatable beyond solution anneal." },
  // K — Cast Iron
  "cast_iron_gray":     { min: 80, max: 105, scale: "hrb", note: "Gray cast iron ranges 80–105 HRB depending on grade. Not heat-treatable to HRC levels." },
  "cast_iron_ductile":  { min: 82, max: 108, scale: "hrb", note: "Ductile iron ranges 82–108 HRB. Some grades can be surface hardened." },
  "cast_iron_malleable":{ min: 78, max: 105, scale: "hrb", note: "Malleable cast iron ranges 78–105 HRB." },
  // S — Superalloys / Titanium
  "titanium_cp":    { min: 65, max: 92,  scale: "hrb", note: "CP Titanium Grade 1–4 ranges 65–92 HRB — not heat-treatable to HRC levels." },
  "titanium_64":    { min: 30, max: 42,  scale: "hrc", note: "Ti-6Al-4V solution treated and aged ranges 30–42 HRC." },
  "hiTemp_fe":      { min: 22, max: 42,  scale: "hrc", note: "A-286/Incoloy 800 ranges 22–42 HRC depending on aging condition." },
  "hiTemp_co":      { min: 32, max: 55,  scale: "hrc", note: "Stellite cobalt alloys range 32–55 HRC depending on grade and casting condition." },
  "monel_k500":     { min: 22, max: 35,  scale: "hrc", note: "Monel K-500 age-hardened ranges 22–35 HRC." },
  "inconel_625":    { min: 18, max: 30,  scale: "hrc", note: "Inconel 625 solution annealed ranges 18–30 HRC — it's a corrosion alloy, not a hardening alloy." },
  "inconel_718":    { min: 35, max: 45,  scale: "hrc", note: "Inconel 718 age-hardened ranges 35–45 HRC — this is its standard working condition." },
  "hastelloy_x":    { min: 80, max: 100, scale: "hrb", note: "Hastelloy X / Inconel 725 / X-750 are typically solution annealed — HRB scale, not heat-treatable to HRC." },
  "waspaloy":       { min: 35, max: 44,  scale: "hrc", note: "Waspaloy / HAYNES 282 age-hardened ranges 35–44 HRC." },
  "mp35n":          { min: 38, max: 62,  scale: "hrc", note: "MP35N ranges 38–62 HRC — the wide range reflects cold-worked vs. fully aged conditions." },
  // H — Hardened Steel
  "hardened_lt55":  { min: 40, max: 54,  scale: "hrc", note: "Use this category for hardened steels 40–54 HRC. Below 40 HRC, standard alloy steel parameters apply." },
  "hardened_gt55":  { min: 55, max: 68,  scale: "hrc", note: "Use this category for hardened steels 55–68 HRC. CBN tooling is preferred above 60 HRC." },
};

export function getIsoForKey(key: string): IsoCategory | null {
  const found = ISO_SUBCATEGORIES.find((s) => s.key === key);
  return found ? found.iso : null;
}

export function getCategoryColor(iso: IsoCategory): string {
  return ISO_CATEGORIES.find((c) => c.iso === iso)?.color ?? "#888";
}
