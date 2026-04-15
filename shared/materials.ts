export const MATERIAL_NOTES: Record<string, string> = {
  // N — Non-Ferrous
  "aluminum_wrought":    "Excellent machinability — 6061/6082/5052 are the \"easy\" aluminum grades. Run aggressive SFM with healthy chip load; too light a feed causes built-up edge and welding faster than too heavy. Sharp polished flutes, flood or strong air/mist, climb milling. Uncoated or DLC carbide preferred — TiAlN coatings can stick to aluminum at high temperature.",
  "aluminum_wrought_hs": "High-strength 7075/2024 series — stronger and harder than 6061 (~150 HB vs ~95 HB), cutting forces are higher and tool wear is noticeably faster. Run ~20% lower SFM and slightly lighter chip load than 6061. Rigidity matters more: thin walls and long stickouts will chatter and deform. Sharp tools and good chip evacuation still mandatory; polished carbide or DLC, no TiAlN coatings.",
  "aluminum_cast":       "Silicon particles are the enemy — more Si means more abrasion and shorter tool life. A356/A357 (7% Si) are more forgiving; A380 (8.5% Si) and especially A390 (17% Si high-silicon) eat edges fast. Reduce SFM and chip load vs. wrought, monitor edge condition closely, and shorten change intervals in high-Si grades. PCD tooling cost-justified in high-volume production.",
  "non_ferrous":         "Copper and brass are soft but gummy — copper especially smears and welds to the edge at low chip load. High feed, sharp polished flutes, no dwells. Leaded brass (C360) is much friendlier than copper; bronze varies widely by alloy and lead content.",
  // P — Steel
  "steel_mild":          "Plain low-carbon and structural steels (A36, 1018, 1020, 10xx series). Very consistent — predictable chip load, good tool life. Flood or mist coolant; standard TiAlN coated carbide. A36 hot-rolled can vary heat to heat — check hardness on critical jobs.",
  "steel_free":          "Sulfur-additive free-machining grades (12L14, 1215, 1117). Easiest steel to machine — sulfur breaks chips cleanly at high SFM. Run fast, push the feed, expect excellent tool life. Note: 12L14 is not weldable.",
  "steel_alloy":         "Cr-Mo and NiCrMo alloy steels (4130 Chrom-Moly, 4140, 4340, 8620, 9310 and similar grades). Hardness matters more than the grade name — set it to match your actual condition. 4130 normalized cuts easily; 4140 prehard (~30 HRC) is the most common shop challenge. Variable-pitch geometry and TiAlN coating are the right tool choice for any of these. Never let the tool rub — hardened alloy steel work-hardens at the cut faster than mild steel.",
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
  "cast_iron_gray":      "Excellent machinability — graphite flakes act as a built-in solid lubricant, giving low cutting forces and short, crumbly chips. Machine dry with air blast; flood coolant turns graphite dust into abrasive slurry and risks thermal cracking. Abrasive flank wear is the dominant tool failure — AlTiN coated carbide preferred over uncoated. Break any chilled or skin-hardened surface carefully; white iron inclusions will chip edges instantly.",
  "cast_iron_ductile":   "Machines more like tough alloy steel than gray iron — graphite nodules don't lubricate the cut, so forces are higher and chips are longer. Ferritic grades (65-45-12, GGG-40/50) are more forgiving; pearlitic/high-strength grades (80-55-06, GGG-70/80) need SFM reductions of 15–25% and stronger edge preps. Coolant recommended, especially for drilling and tapping. Foundry practice affects machinability significantly — same grade from different suppliers can behave noticeably differently.",
  "cast_iron_cgi":       "Compacted Graphite Iron (vermicular iron) — graphite between flakes and nodules. Higher strength than gray iron but far harder on tools: expect 30–50% shorter tool life than gray at the same SFM. Used in diesel engine blocks (EGR-era Duramax, Powerstroke, modern HD diesel) where thin walls and high cylinder pressure demand it. Run dry with air blast, drop SFM ~20–30% from gray iron, AlTiN or AlCrN coating required. The graphite partial-lubrication effect is reduced vs. gray — treat it closer to ductile iron for tooling choices.",
  "cast_iron_malleable": "Iron castings heat-treated to convert white iron carbides into irregular graphite nodules — better ductility and impact resistance than gray iron. Good machinability with clean, broken chips due to the graphite nodule structure. More abrasive than gray iron; AlTiN coated carbide recommended over uncoated. Whiteheart (GTW) and blackheart (GTB) behave similarly in the cut.",
  // S — Superalloys / Titanium
  "titanium_cp":         "Springy and prone to galling — the tool wants to weld to the workpiece at low feed. High chip load at low SFM; TSC or flood coolant is not optional. Grade 1 is softest, Grade 4 is toughest — both behave the same way in the cut.",
  "titanium_64":         "Heat-trapping, work-hardening, and notch-sensitive. Sharp geometry, high chip load, high-pressure coolant; never slow down or dwell mid-cut. Beta alloys (Ti-5553, Ti-10-2-3) run conservative end of the range.",
  "hiTemp_fe":           "Iron-based superalloy (A-286, Incoloy 800/825, Incoloy 901) — aggressive work-hardening, heat stays in the tool. Lower SFM than nickel alloys but same unforgiving cut behavior; TSC essential. More cost-effective than Ni-base but same discipline required.",
  "hiTemp_co":           "Cobalt superalloy (Stellite 6/12/21/31, Haynes 188, L-605) — extremely abrasive and punishing on cutting edges. Very high hot hardness retained at temperature makes these among the hardest to machine by volume. PVD coating required; conservative SFM and feed, no exceptions.",
  "monel_k500":          "Nickel-copper age-hardened alloy — the friendliest grade in this family. Still wants consistent chip load and flood coolant, but runs meaningfully faster than 718 or Waspaloy. Monel 400 is similar but softer; K-500 age-hardened is the tougher condition.",
  "inconel_625":         "Corrosion-focused solid-solution Ni alloy (625, C-276, C-22, Hastelloy B-3, Incoloy 825) — more machinable than 718 because gamma-prime precipitation isn't the design goal. Still work-hardens and traps heat; keep the tool engaged and chip load consistent. TSC strongly preferred.",
  "inconel_718":         "Most common aerospace nickel superalloy (718, Allvac 718, 718 Plus, Inconel 706) — work-hardening, heat-building, and gummy. Gamma-prime and delta phase make it punishing on edges. Traditional roughing at conservative SFM; HEM at low WOC (3–8%) is the only practical high-feed strategy for solid carbide.",
  "hastelloy_x":         "Mid-tier aerospace/industrial Ni alloys (Hastelloy X, Inconel 725, X-750, Nimonic C-263, Haynes 242) — solid-solution strengthened, less gamma-prime than 718 but still heat-trapping and abrasive. Drop SFM and chip load below 718 levels; TSC strongly recommended. Harder to cool than steels because low thermal conductivity keeps heat at the edge.",
  "inconel_617":         "Power-generation Ni superalloy (Inconel 617, Haynes 230, Alloy 617) — solid-solution Ni-Cr-Co-Mo designed for oxidation resistance in gas turbine combustors up to 1000°C. No gamma-prime, so less work-hardening than 718 — but still heat-trapping and abrasive. Similar strategy to Hastelloy X: consistent chip load, sharp coated carbide, high-pressure coolant.",
  "waspaloy":            "Hot-section gamma-prime Ni superalloys (Waspaloy, HAYNES 282, René 41/77/80, Nimonic 80A/90/105, Udimet 500/600/700, Inconel 738/939) — among the most demanding Ni alloys to machine. Very high gamma-prime fraction impedes dislocation motion and resists cutting at temperature. Work-hardens rapidly, notches tools aggressively; conservative SFM and consistent engagement are non-negotiable. TSC mandatory.",
  "mp35n":               "Ultra-high-strength Ni-Co-Cr-Mo alloys (MP35N, Udimet 720, René 95) — used in medical implants, sour-service hardware, and turbine disks. Highest unit cutting force in the superalloy family. Extremely work-hardening; even small rubbing or dwell causes immediate edge breakdown. Treat every parameter at the conservative end; TSC and premium PVD coating required.",
  // H — Hardened Steel & Armor
  "hardened_lt55":       "Hard enough to challenge solid carbide — TiAlN/AlCrN coating and conservative chip loads are required. Light WOC with higher DOC is more efficient than full-width cuts.",
  "hardened_gt55":       "At the upper limit for solid carbide — CBN tooling is preferred above 60 HRC. Extremely light chip loads; any tool flex causes immediate chipping. Includes HSS stock (M2/M4 at 62–65 HRC) — machining HSS with carbide is viable but tool life is short; use AlTiN coating, very conservative SFM, and light chip load.",
  "armor_milspec":       "MIL-A-12560 / MIL-A-46100 structural armor — most machinable mil-spec grade (~260–300 HB). Still punishing vs alloy steel; remove mill scale/decarb layer first, maintain chip load at all times, and expect the first pass to be the worst on tool life.",
  "armor_ar400":         "AR400 / AR450 abrasion-resistant plate (~360–480 HB, ~38–47 HRC). Hard and tough simultaneously — you're fighting both abrasion and deformation resistance. HEM / dynamic milling strongly preferred; slotting is a tool killer. AlCrN or AlTiN coating required; strong edge prep (T-land or hone), lower rake angle. Maintain chip load — underfeed causes immediate edge breakdown.",
  "armor_ar500":         "AR500 / Armox 500T (~470–540 HB, ~50–56 HRC) — the most common ballistic target and light vehicle armor grade. Extremely abrasive martensitic microstructure; heat stays at the edge even with coolant. HEM at 5–15% WOC is the only practical solid carbide strategy. First pass (skin/scale) is the worst — expect 40–60% shorter tool life on the entry cut. Never slot, never dwell, never rub. Use larger tools when possible; 5/8\" outperforms 1/2\" in tool life and stability.",
  "armor_ar600":         "AR600 / AR550 / Armox 600T (~570–640 HB, ~58–63 HRC) — extreme hardness, more like grinding than cutting. Very conservative SFM; maintain minimum chip load or the tool wears before it can cut. Plan for frequent insert/tool changes. Pre-drill holes; helical ramp entry only. At these hardness levels, EDM is often a more practical alternative to milling large features.",
  // O — Plastics & Composites
  "plastic_unfilled":    "Heat is the enemy, not cutting force. PEEK, POM/Delrin, PA/Nylon, PC, PPS — all cut easily but melt, smear, or weld to the edge if chip load drops too low or chips aren't cleared. Polished uncoated carbide or DLC preferred — TiAlN coatings can stick to thermoplastic matrices. 2–3 flutes, high-positive rake, flood or strong air blast. Never dwell; never let the tool rub.",
  "plastic_filled":      "Short/long glass or carbon fibers (GF-PA, CF-PA, filled PEEK) raise stiffness and abrasion significantly. Still 'plastic' cutting behavior but tool wear is 3–5× faster than unfilled grades. Fine-grain or DLC-coated carbide preferred. Chip load still matters — rubbing generates heat that melts the matrix around the fibers, creating a fuzzy, smeared surface. Dry with air blast or light mist.",
  "composite_tpc":       "Continuous-fiber thermoplastic laminates (CF-PEEK, GF-PP, CFR-TP tapes/plates) — carbon fiber is less abrasive than glass but both are aggressive on edges. Run lower SFM than unfilled TPs with higher chip load than you'd use on thermoset CFRP (TP matrix is tougher, not brittle). Target solid chips, not dust or powder — if you're making dust, chip load is too light. Dry + extraction mandatory; carbon fiber dust is hazardous. Delamination risk at exits — back up thin laminates.",
};

export const ISO_CATEGORIES = [
  { iso: "N", label: "Non-Ferrous",    color: "#8BC34A" },
  { iso: "P", label: "Steel",          color: "#90CAF9" },
  { iso: "M", label: "Stainless",      color: "#FDD835" },
  { iso: "K", label: "Cast Iron",      color: "#EF5350" },
  { iso: "S", label: "Superalloys",    color: "#FFA726" },
  { iso: "H", label: "Hardened Steel / Armor Plate", color: "#BDBDBD" },
  { iso: "O", label: "Plastics & Composites", color: "#26C6DA" },
] as const;

export type IsoCategory = (typeof ISO_CATEGORIES)[number]["iso"];

export const ISO_SUBCATEGORIES = [
  // N — Non-Ferrous (hardness not applicable)
  { iso: "N" as IsoCategory, key: "aluminum_wrought",      label: "Wrought Aluminum — General (6061, 6082, 5052, 6xxx/5xxx)", hardness: { value: 0,  scale: "hrb" as const } },
  { iso: "N" as IsoCategory, key: "aluminum_wrought_hs",   label: "Wrought Aluminum — High Strength (7075, 2024, 7xxx/2xxx)", hardness: { value: 0,  scale: "hrb" as const } },
  { iso: "N" as IsoCategory, key: "aluminum_cast",         label: "Cast Aluminum (A356, A380, A390, high-Si)", hardness: { value: 0,  scale: "hrb" as const } },
  { iso: "N" as IsoCategory, key: "non_ferrous",           label: "Copper / Brass / Bronze",                  hardness: { value: 0,  scale: "hrb" as const } },
  // P — Steel
  { iso: "P" as IsoCategory, key: "steel_alloy",           label: "Alloy Steel (4130 Chrom-Moly, 4140, 4340, 8620, 9310)", hardness: { value: 32, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "steel_mild",            label: "Mild / Low-Carbon Steel (A36, 1018, 1020)", hardness: { value: 75, scale: "hrb" as const } },
  { iso: "P" as IsoCategory, key: "steel_free",            label: "Free Machining Steel (12L14, 1215, 1117)",  hardness: { value: 80, scale: "hrb" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_p20",        label: "P20 Tool Steel (prehardened ~30 HRC)",      hardness: { value: 30, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_a2",         label: "A2 Tool Steel",                             hardness: { value: 36, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_h13",        label: "H13 Tool Steel",                            hardness: { value: 44, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_s7",         label: "S7 Tool Steel",                             hardness: { value: 38, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "tool_steel_d2",         label: "D2 Tool Steel",                             hardness: { value: 58, scale: "hrc" as const } },
  { iso: "P" as IsoCategory, key: "cpm_10v",               label: "CPM 10V / A11 (PM Tool Steel)",               hardness: { value: 60, scale: "hrc" as const } },
  // M — Stainless Steel
  { iso: "M" as IsoCategory, key: "stainless_304",         label: "304 / 304L / 321 Stainless",                  hardness: { value: 85, scale: "hrb" as const } },
  { iso: "M" as IsoCategory, key: "stainless_fm",          label: "303 / 416 Free-Machining Stainless",          hardness: { value: 85, scale: "hrb" as const } },
  { iso: "M" as IsoCategory, key: "stainless_ferritic",    label: "Ferritic Stainless (409 / 430 / 441)",         hardness: { value: 80, scale: "hrb" as const } },
  { iso: "M" as IsoCategory, key: "stainless_410",         label: "410 Martensitic Stainless",                   hardness: { value: 22, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_420",         label: "420 Martensitic Stainless",                   hardness: { value: 25, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_440c",        label: "440C Stainless",                              hardness: { value: 58, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_316",         label: "316 / 316L Stainless (Mo-bearing)",           hardness: { value: 85, scale: "hrb" as const } },
  { iso: "M" as IsoCategory, key: "stainless_ph",          label: "17-4PH / 15-5PH / 13-8MO Stainless",         hardness: { value: 33, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_duplex",      label: "Duplex Stainless (2205)",                     hardness: { value: 22, scale: "hrc" as const } },
  { iso: "M" as IsoCategory, key: "stainless_superduplex", label: "Super Duplex Stainless (2507)",               hardness: { value: 28, scale: "hrc" as const } },
  // K — Cast Iron
  { iso: "K" as IsoCategory, key: "cast_iron_gray",        label: "Gray Cast Iron (Class 30/40, GG20/25, HT200/250)",        hardness: { value: 92, scale: "hrb" as const } },
  { iso: "K" as IsoCategory, key: "cast_iron_ductile",     label: "Ductile / Nodular Iron (65-45-12, GGG-40/50/60)",         hardness: { value: 90, scale: "hrb" as const } },
  { iso: "K" as IsoCategory, key: "cast_iron_cgi",         label: "Compacted Graphite Iron / CGI (GJV-300/400)",             hardness: { value: 95, scale: "hrb" as const } },
  { iso: "K" as IsoCategory, key: "cast_iron_malleable",   label: "Malleable Cast Iron (GTW/GTB, GTS-35-10)",                hardness: { value: 82, scale: "hrb" as const } },
  // S — Superalloys / Titanium
  { iso: "S" as IsoCategory, key: "titanium_64",           label: "Ti-6Al-4V (Grade 5)",                         hardness: { value: 36, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "titanium_cp",           label: "CP Titanium Grade 1–4",                       hardness: { value: 80, scale: "hrb" as const } },
  { iso: "S" as IsoCategory, key: "hiTemp_fe",             label: "A-286 / Incoloy 800 / Udimet (Fe-based)",     hardness: { value: 85, scale: "hrb" as const } },
  { iso: "S" as IsoCategory, key: "hiTemp_co",             label: "Stellite (Co-based superalloy)",              hardness: { value: 35, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "monel_k500",            label: "Monel K-500 (Ni-Cu age-hardened)",            hardness: { value: 30, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "inconel_625",           label: "Inconel 625 / Hastelloy C-276 / C-22 / Incoloy 825", hardness: { value: 25, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "inconel_718",           label: "Inconel 718 / 718 Plus / Allvac 718",         hardness: { value: 40, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "hastelloy_x",           label: "Hastelloy X / Inconel X-750 / Nimonic C-263", hardness: { value: 85, scale: "hrb" as const } },
  { iso: "S" as IsoCategory, key: "inconel_617",           label: "Inconel 617 / Haynes 230 (power-gen Ni)",     hardness: { value: 85, scale: "hrb" as const } },
  { iso: "S" as IsoCategory, key: "waspaloy",              label: "Waspaloy / René 41/77/80 / Nimonic 80A/90",   hardness: { value: 40, scale: "hrc" as const } },
  { iso: "S" as IsoCategory, key: "mp35n",                 label: "MP35N / Udimet 720 / René 95 (ultra-high-str)", hardness: { value: 40, scale: "hrc" as const } },
  // H — Hardened Steel & Armor
  { iso: "H" as IsoCategory, key: "hardened_lt55",         label: "Hardened Steel < 55 HRC",                              hardness: { value: 48, scale: "hrc" as const } },
  { iso: "H" as IsoCategory, key: "hardened_gt55",         label: "Hardened Steel > 55 HRC",                              hardness: { value: 60, scale: "hrc" as const } },
  { iso: "H" as IsoCategory, key: "armor_milspec",         label: "Mil-Spec Armor (MIL-A-12560 / 46100, ~260-300 HB)",    hardness: { value: 29, scale: "hrc" as const } },
  { iso: "H" as IsoCategory, key: "armor_ar400",           label: "AR400 / AR450 Armor Plate (~360-480 HB)",              hardness: { value: 43, scale: "hrc" as const } },
  { iso: "H" as IsoCategory, key: "armor_ar500",           label: "AR500 / Armox 500T Armor Plate (~470-540 HB)",         hardness: { value: 53, scale: "hrc" as const } },
  { iso: "H" as IsoCategory, key: "armor_ar600",           label: "AR550 / AR600 / Armox 600T (~570-640 HB)",             hardness: { value: 60, scale: "hrc" as const } },
  // O — Plastics & Composites
  { iso: "O" as IsoCategory, key: "plastic_unfilled",      label: "Unfilled Engineering Thermoplastics (PEEK, POM, PA, PC)", hardness: { value: 0, scale: "hrb" as const } },
  { iso: "O" as IsoCategory, key: "plastic_filled",        label: "Fiber-Reinforced Thermoplastics (GF/CF-PA, PEEK-GF)",     hardness: { value: 0, scale: "hrb" as const } },
  { iso: "O" as IsoCategory, key: "composite_tpc",         label: "Continuous-Fiber TPC Laminates (CF-PEEK, GF-PP, CFR-TP)", hardness: { value: 0, scale: "hrb" as const } },
];

export type MaterialKey = (typeof ISO_SUBCATEGORIES)[number]["key"];

// Realistic hardness range per material, in the material's native scale.
// Used to warn the user if they enter a physically implausible hardness.
// "note" is displayed when out of range or wrong scale is selected.
export const MATERIAL_HARDNESS_RANGE: Record<string, {
  min: number; max: number; scale: "hrb" | "hrc"; note: string;
}> = {
  // P — Steel
  "steel_mild":      { min: 50, max: 90,  scale: "hrb", note: "Mild and structural steels (A36, 1018, 1020) range 50–90 HRB depending on condition. Cold-rolled is harder than hot-rolled of the same grade." },
  "steel_free":      { min: 55, max: 95,  scale: "hrb", note: "Free-machining grades (12L14, 1215, 1117) range 55–95 HRB — sulfur additives improve chip breaking, not hardenability." },
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
  "stainless_duplex":    { min: 18, max: 25,  scale: "hrc", note: "Duplex 2205 max 217 HB (~22 HRC) — not heat-treatable, but work-hardens significantly." },
  "stainless_superduplex": { min: 22, max: 32, scale: "hrc", note: "Super duplex 2507 typical 22–32 HRC as-annealed — not heat-treatable beyond solution anneal." },
  // K — Cast Iron
  "cast_iron_gray":     { min: 80, max: 111, scale: "hrb", note: "Gray iron ranges 80–111 HRB (150–241 HB). Class 20–25 ≈ 80–90 HRB; Class 40–60 ≈ 95–111 HRB. Not heat-treatable." },
  "cast_iron_ductile":  { min: 82, max: 110, scale: "hrb", note: "Ductile iron 65-45-12 / GGG-50 ≈ 90–99 HRB (187–217 HB). High-strength grades 100-70-03 / GGG-70 can reach 21–26 HRC (241–270 HB)." },
  "cast_iron_cgi":      { min: 85, max: 110, scale: "hrb", note: "Compacted Graphite Iron (GJV-300/400) typically 160–240 HB = 85–110 HRB. Not heat-treatable by grade definition." },
  "cast_iron_malleable":{ min: 78, max: 105, scale: "hrb", note: "Malleable iron ranges 78–105 HRB. Blackheart (GTB) tends toward the lower end; whiteheart (GTW) toward the upper." },
  // S — Superalloys / Titanium
  "titanium_cp":    { min: 65, max: 92,  scale: "hrb", note: "CP Titanium Grade 1–4 ranges 65–92 HRB — not heat-treatable to HRC levels." },
  "titanium_64":    { min: 30, max: 42,  scale: "hrc", note: "Ti-6Al-4V solution treated and aged ranges 30–42 HRC." },
  "hiTemp_fe":      { min: 22, max: 42,  scale: "hrc", note: "A-286/Incoloy 800 ranges 22–42 HRC depending on aging condition." },
  "hiTemp_co":      { min: 32, max: 55,  scale: "hrc", note: "Stellite cobalt alloys range 32–55 HRC depending on grade and casting condition." },
  "monel_k500":     { min: 22, max: 35,  scale: "hrc", note: "Monel K-500 age-hardened ranges 22–35 HRC." },
  "inconel_625":    { min: 18, max: 30,  scale: "hrc", note: "Inconel 625 solution annealed ranges 18–30 HRC — it's a corrosion alloy, not a hardening alloy." },
  "inconel_718":    { min: 35, max: 45,  scale: "hrc", note: "Inconel 718 age-hardened ranges 35–45 HRC — this is its standard working condition." },
  "hastelloy_x":    { min: 80, max: 100, scale: "hrb", note: "Hastelloy X / Inconel X-750 / Nimonic C-263 are typically solution annealed — HRB scale, not heat-treatable to HRC levels." },
  "inconel_617":    { min: 75, max: 100, scale: "hrb", note: "Inconel 617 / Haynes 230 are solid-solution alloys, typically solution annealed — HRB scale only, not age-hardenable." },
  "waspaloy":       { min: 35, max: 44,  scale: "hrc", note: "Waspaloy / René 41/77/80 / Nimonic 80A/90 age-hardened ranges 35–44 HRC. Udimet 700 can reach 48 HRC." },
  "mp35n":          { min: 38, max: 62,  scale: "hrc", note: "MP35N ranges 38–62 HRC; cold-worked + aged can reach 62 HRC. Udimet 720 turbine disk: 40–48 HRC typical." },
  // H — Hardened Steel & Armor
  "hardened_lt55":  { min: 40, max: 54,  scale: "hrc", note: "Use this category for hardened steels 40–54 HRC. Below 40 HRC, standard alloy steel parameters apply." },
  "hardened_gt55":  { min: 55, max: 68,  scale: "hrc", note: "Use this category for hardened steels 55–68 HRC. CBN tooling is preferred above 60 HRC." },
  "armor_milspec":  { min: 26, max: 33,  scale: "hrc", note: "MIL-A-12560 / MIL-A-46100 structural armor is specified at 260–300 HB (~26–33 HRC). Values outside this range may indicate a different armor class." },
  "armor_ar400":    { min: 38, max: 47,  scale: "hrc", note: "AR400 / AR450 plate is 360–480 HB (~38–47 HRC). Below this range, use steel_alloy parameters; above 47 HRC, step up to AR500." },
  "armor_ar500":    { min: 50, max: 57,  scale: "hrc", note: "AR500 / Armox 500T is 470–540 HB (~50–57 HRC). The most common grade for ballistic targets and light vehicle armor." },
  "armor_ar600":    { min: 57, max: 64,  scale: "hrc", note: "AR550 / AR600 / Armox 600T is 570–640 HB (~57–64 HRC). At the practical limit for solid carbide — consider EDM for complex features." },
  // O — Plastics & Composites (hardness not used in calculations)
  "plastic_unfilled": { min: 0, max: 0, scale: "hrb", note: "Hardness not applicable for thermoplastics — leave at 0. Parameters are not affected by hardness input for this category." },
  "plastic_filled":   { min: 0, max: 0, scale: "hrb", note: "Hardness not applicable for fiber-reinforced thermoplastics — leave at 0." },
  "composite_tpc":    { min: 0, max: 0, scale: "hrb", note: "Hardness not applicable for continuous-fiber TPC laminates — leave at 0." },
};

// ── Material Aliases ─────────────────────────────────────────────────────────
// Maps common grade names, trade names, UNS numbers, and DIN numbers to
// catalog material keys. Used for Level-1 (instant) material matching.
// Keys are lowercase — normalize input before lookup.
export const MATERIAL_ALIASES: Record<string, string> = {
  // ── Wrought Aluminum — General (6xxx / 5xxx / 1xxx) ──────────────────────
  "6061": "aluminum_wrought", "6061-t6": "aluminum_wrought", "6061-t651": "aluminum_wrought",
  "6063": "aluminum_wrought", "6063-t5": "aluminum_wrought", "6063-t6": "aluminum_wrought",
  "6082": "aluminum_wrought", "6082-t6": "aluminum_wrought",
  "6262": "aluminum_wrought", "6101": "aluminum_wrought",
  "5052": "aluminum_wrought", "5052-h32": "aluminum_wrought",
  "5083": "aluminum_wrought", "5086": "aluminum_wrought", "5251": "aluminum_wrought",
  "5454": "aluminum_wrought", "5754": "aluminum_wrought",
  "1100": "aluminum_wrought", "1050": "aluminum_wrought", "1060": "aluminum_wrought",
  "1350": "aluminum_wrought",  // electrical grade
  "mic-6": "aluminum_wrought", "atp-5": "aluminum_wrought",  // cast tooling plate — machines like wrought
  "tooling plate": "aluminum_wrought", "cast tooling plate": "aluminum_wrought",
  // ── Wrought Aluminum — High Strength (7xxx / 2xxx) ───────────────────────
  "7075": "aluminum_wrought_hs", "7075-t6": "aluminum_wrought_hs", "7075-t651": "aluminum_wrought_hs",
  "7075-t7351": "aluminum_wrought_hs",
  "7050": "aluminum_wrought_hs", "7050-t7451": "aluminum_wrought_hs",
  "7055": "aluminum_wrought_hs", "7068": "aluminum_wrought_hs",
  "7049": "aluminum_wrought_hs", "7150": "aluminum_wrought_hs",
  "2024": "aluminum_wrought_hs", "2024-t3": "aluminum_wrought_hs",
  "2024-t351": "aluminum_wrought_hs", "2024-t4": "aluminum_wrought_hs",
  "2014": "aluminum_wrought_hs", "2014-t6": "aluminum_wrought_hs",
  "2219": "aluminum_wrought_hs", "2011": "aluminum_wrought_hs",
  "2618": "aluminum_wrought_hs",  // piston alloy
  "7075 aluminum": "aluminum_wrought_hs", "2024 aluminum": "aluminum_wrought_hs",
  // ── Cast Aluminum ────────────────────────────────────────────────────────
  "a360": "aluminum_cast", "a380": "aluminum_cast", "a390": "aluminum_cast",
  "a356": "aluminum_cast", "a356-t6": "aluminum_cast", "356": "aluminum_cast",
  "a357": "aluminum_cast",  // premium structural casting (lower Fe, higher Mg)
  "319": "aluminum_cast",   // engine blocks — copper-bearing
  "380": "aluminum_cast",   "a383": "aluminum_cast", "a413": "aluminum_cast",
  "lm4": "aluminum_cast",   "lm25": "aluminum_cast",  // UK BS designation
  "en ac-46000": "aluminum_cast", "en ac-42100": "aluminum_cast",  // EN casting grades
  "a380.0": "aluminum_cast", "a356.0": "aluminum_cast",
  // ── Copper / Brass ────────────────────────────────────────────────────────
  "copper": "non_ferrous", "brass": "non_ferrous", "bronze": "non_ferrous",
  "c360": "non_ferrous", "c260": "non_ferrous", "c932": "non_ferrous",
  "naval brass": "non_ferrous", "red brass": "non_ferrous",
  // ── Mild / Low-Carbon Steel ───────────────────────────────────────────────
  "1005": "steel_mild", "1006": "steel_mild", "1008": "steel_mild",
  "1010": "steel_mild", "1012": "steel_mild", "1015": "steel_mild",
  "1018": "steel_mild", "1020": "steel_mild", "1022": "steel_mild", "1025": "steel_mild",
  "a36": "steel_mild",  "a-36": "steel_mild",
  "a283": "steel_mild", "a285": "steel_mild",
  "a572": "steel_mild", "a588": "steel_mild",
  "a1008": "steel_mild", "a1011": "steel_mild",
  "s235": "steel_mild", "s275": "steel_mild", "s355": "steel_mild",
  "ss400": "steel_mild",
  "s10c": "steel_mild", "s15c": "steel_mild", "s20c": "steel_mild",
  "c10": "steel_mild", "c15": "steel_mild", "c20": "steel_mild",
  "mild steel": "steel_mild", "low carbon": "steel_mild", "low carbon steel": "steel_mild",
  "structural steel": "steel_mild", "hot rolled": "steel_mild", "cold rolled": "steel_mild",
  // ── True Free Machining Steel (sulfur-additive) ───────────────────────────
  "1215": "steel_free", "12l14": "steel_free", "1144": "steel_free",
  "1117": "steel_free", "1118": "steel_free", "b1112": "steel_free",
  "1213": "steel_free",
  "free machining": "steel_free", "free machining steel": "steel_free",
  // ── Medium Carbon (harder than mild, no alloy additions) ─────────────────
  "1030": "steel_alloy", "1035": "steel_alloy", "1040": "steel_alloy",
  "1045": "steel_alloy", "1055": "steel_alloy",
  "1070": "steel_alloy", "1080": "steel_alloy",
  "1090": "steel_alloy", "1095": "steel_alloy",
  "medium carbon": "steel_alloy", "medium carbon steel": "steel_alloy",
  // ── Cr-Mo (Chromoly / 41xx series) ───────────────────────────────────────
  "4130": "steel_alloy", "4135": "steel_alloy",
  "4140": "steel_alloy", "4140 ph": "steel_alloy", "4140 prehard": "steel_alloy",
  "4142": "steel_alloy", "4145": "steel_alloy", "4147": "steel_alloy", "4150": "steel_alloy",
  "chromoly": "steel_alloy", "chrom-moly": "steel_alloy", "chrome-moly": "steel_alloy",
  "chromemoly": "steel_alloy", "4130 normalized": "steel_alloy",
  "4130 n": "steel_alloy", "4130 ht": "steel_alloy",
  // ── NiCrMo (43xx, high-toughness) ────────────────────────────────────────
  "4320": "steel_alloy", "4340": "steel_alloy", "4340 ht": "steel_alloy",
  "e4340": "steel_alloy", "300m": "steel_alloy",
  // ── NiCrMo case-hardening / gear steels ──────────────────────────────────
  "4620": "steel_alloy", "4820": "steel_alloy",
  "8620": "steel_alloy", "8640": "steel_alloy",
  "9310": "steel_alloy",
  // ── Mo steels ─────────────────────────────────────────────────────────────
  "4037": "steel_alloy", "4047": "steel_alloy",
  // ── Spring / Si-Mn steels ─────────────────────────────────────────────────
  "9260": "steel_alloy", "6150": "steel_alloy", "5160": "steel_alloy",
  "spring steel": "steel_alloy",
  // ── Bearing steel ─────────────────────────────────────────────────────────
  "52100": "steel_alloy", "100cr6": "steel_alloy", "1.3505": "steel_alloy",
  "gcr15": "steel_alloy", "bearing steel": "steel_alloy",
  // ── Maraging steels (route to steel_alloy; set hardness to actual condition)
  "18ni 250": "steel_alloy", "18ni 300": "steel_alloy",
  "18ni250": "steel_alloy", "18ni300": "steel_alloy",
  "maraging 250": "steel_alloy", "maraging 300": "steel_alloy",
  "maraging steel": "steel_alloy",
  // ── ASTM Cr-Mo pressure / structural grades ───────────────────────────────
  "a182 f11": "steel_alloy", "a182 f22": "steel_alloy", "f11": "steel_alloy", "f22": "steel_alloy",
  "a387 gr 11": "steel_alloy", "a387 gr 22": "steel_alloy", "a387": "steel_alloy",
  "a335 p11": "steel_alloy", "a335 p22": "steel_alloy", "a335": "steel_alloy",
  "a193 b7": "steel_alloy",  // Cr-Mo bolting
  // ── European / DIN equivalents ────────────────────────────────────────────
  "25crmo4": "steel_alloy", "34crmo4": "steel_alloy", "42crmo4": "steel_alloy",
  "1.7218": "steel_alloy", "1.7220": "steel_alloy", "1.7225": "steel_alloy",
  "30crnimod8": "steel_alloy", "30crnimod": "steel_alloy", "30crnimo8": "steel_alloy",
  "36crnimod4": "steel_alloy", "36crnimod": "steel_alloy",
  "40crmnnimod8-6-4": "steel_alloy",
  "en19": "steel_alloy", "en24": "steel_alloy", "en36": "steel_alloy",
  "en25": "steel_alloy", "en26": "steel_alloy", "en30b": "steel_alloy",
  "817m40": "steel_alloy",  // UK equiv of 4340
  // ── HSS (rare to machine; routes to hardened_gt55 — they're 62–65 HRC) ───
  "m2": "hardened_gt55", "m4": "hardened_gt55", "m42": "hardened_gt55",
  "t1": "hardened_gt55", "t15": "hardened_gt55",
  "hss": "hardened_gt55", "high speed steel": "hardened_gt55",
  // ── Generic text matches ──────────────────────────────────────────────────
  "alloy steel": "steel_alloy", "cr-mo steel": "steel_alloy", "crmo": "steel_alloy",
  "nickel steel": "steel_alloy", "chrome moly": "steel_alloy",
  // ── P20 Tool Steel ────────────────────────────────────────────────────────
  "p20": "tool_steel_p20", "p-20": "tool_steel_p20", "1.2311": "tool_steel_p20",
  "1.2312": "tool_steel_p20", "718 mold": "tool_steel_p20", "nak80": "tool_steel_p20",
  "prehardened mold": "tool_steel_p20", "4130 prehardened": "tool_steel_p20",
  // ── A2 Tool Steel ─────────────────────────────────────────────────────────
  "a2": "tool_steel_a2", "a-2": "tool_steel_a2", "1.2363": "tool_steel_a2",
  "x100crmov5": "tool_steel_a2",
  // ── H13 Tool Steel ────────────────────────────────────────────────────────
  "h13": "tool_steel_h13", "h-13": "tool_steel_h13", "1.2344": "tool_steel_h13",
  "skd61": "tool_steel_h13", "h11": "tool_steel_h13", "1.2343": "tool_steel_h13",
  "dac": "tool_steel_h13", "dievar": "tool_steel_h13", "hotvar": "tool_steel_h13",
  "hot work steel": "tool_steel_h13",
  // ── S7 Tool Steel ─────────────────────────────────────────────────────────
  "s7": "tool_steel_s7", "s-7": "tool_steel_s7", "shock steel": "tool_steel_s7",
  // ── D2 Tool Steel ─────────────────────────────────────────────────────────
  "d2": "tool_steel_d2", "d-2": "tool_steel_d2", "1.2379": "tool_steel_d2",
  "skd11": "tool_steel_d2", "cr12mov": "tool_steel_d2", "x155crvmo12-1": "tool_steel_d2",
  // ── CPM 10V ───────────────────────────────────────────────────────────────
  "cpm10v": "cpm_10v", "cpm-10v": "cpm_10v", "a11": "cpm_10v",
  "10v": "cpm_10v", "cpm 10v": "cpm_10v",
  // ── Mil-Spec Armor ────────────────────────────────────────────────────────
  "mil-a-12560": "armor_milspec", "mila12560": "armor_milspec", "12560": "armor_milspec",
  "mil-a-46100": "armor_milspec", "mila46100": "armor_milspec", "46100": "armor_milspec",
  "mil-dtl-32332": "armor_milspec", "32332": "armor_milspec",
  "milspec armor": "armor_milspec", "mil spec armor": "armor_milspec",
  "military armor": "armor_milspec", "structural armor": "armor_milspec",
  // ── AR400 / AR450 ─────────────────────────────────────────────────────────
  "ar400": "armor_ar400", "ar-400": "armor_ar400", "ar 400": "armor_ar400",
  "ar450": "armor_ar400", "ar-450": "armor_ar400", "ar 450": "armor_ar400",
  "abrasion resistant 400": "armor_ar400", "wear plate 400": "armor_ar400",
  "hardox 400": "armor_ar400", "hardox400": "armor_ar400",
  // ── AR500 / Armox 500T ────────────────────────────────────────────────────
  "ar500": "armor_ar500", "ar-500": "armor_ar500", "ar 500": "armor_ar500",
  "armox 500t": "armor_ar500", "armox500t": "armor_ar500", "armox 500": "armor_ar500",
  "ramor 500": "armor_ar500", "mars 500": "armor_ar500",
  "abrasion resistant 500": "armor_ar500", "ballistic steel": "armor_ar500",
  "hardox 500": "armor_ar500", "hardox500": "armor_ar500",
  // ── AR550 / AR600 / Armox 600T ────────────────────────────────────────────
  "ar600": "armor_ar600", "ar-600": "armor_ar600", "ar 600": "armor_ar600",
  "ar550": "armor_ar600", "ar-550": "armor_ar600", "ar 550": "armor_ar600",
  "armox 600t": "armor_ar600", "armox600t": "armor_ar600", "armox 600": "armor_ar600",
  "ramor 600": "armor_ar600", "mars 600": "armor_ar600",
  "abrasion resistant 600": "armor_ar600",
  "hardox 600": "armor_ar600", "hardox600": "armor_ar600",
  "armor plate": "armor_ar500",  // generic fallback → most common grade
  "armor steel": "armor_ar500",
  // ── 303 / 416 Free-Machining Stainless ───────────────────────────────────
  "303": "stainless_fm", "303se": "stainless_fm", "416": "stainless_fm",
  "1.4305": "stainless_fm", "free machining stainless": "stainless_fm",
  // ── Ferritic Stainless ────────────────────────────────────────────────────
  "409": "stainless_ferritic", "430": "stainless_ferritic", "434": "stainless_ferritic",
  "436": "stainless_ferritic", "441": "stainless_ferritic", "439": "stainless_ferritic",
  "1.4016": "stainless_ferritic", "1.4510": "stainless_ferritic",
  // ── 410 Martensitic ───────────────────────────────────────────────────────
  "410": "stainless_410", "410s": "stainless_410", "414": "stainless_410",
  "greek ascoloy": "stainless_410", "1.4006": "stainless_410",
  // ── 420 Martensitic ───────────────────────────────────────────────────────
  "420": "stainless_420", "420hc": "stainless_420", "1.4028": "stainless_420",
  "1.4034": "stainless_420",
  // ── 440C ─────────────────────────────────────────────────────────────────
  "440c": "stainless_440c", "440": "stainless_440c", "440a": "stainless_440c",
  "440b": "stainless_440c", "1.4125": "stainless_440c",
  // ── 304 Austenitic ────────────────────────────────────────────────────────
  "304": "stainless_304", "304l": "stainless_304", "321": "stainless_304",
  "347": "stainless_304", "18-8": "stainless_304", "1.4301": "stainless_304",
  "1.4307": "stainless_304", "1.4541": "stainless_304", "a2 stainless": "stainless_304",
  // ── 316 Mo-Bearing ────────────────────────────────────────────────────────
  "316": "stainless_316", "316l": "stainless_316", "316ti": "stainless_316",
  "316h": "stainless_316", "316n": "stainless_316", "316/l": "stainless_316",
  "316 stainless": "stainless_316", "316 ss": "stainless_316",
  "316 stainless steel": "stainless_316", "316l stainless": "stainless_316",
  "316l stainless steel": "stainless_316", "316 stainless steel": "stainless_316",
  "317": "stainless_316", "317l": "stainless_316",
  "1.4401": "stainless_316", "1.4404": "stainless_316", "1.4432": "stainless_316",
  "s31600": "stainless_316", "s31603": "stainless_316", "s31609": "stainless_316",
  "sus 316": "stainless_316", "x5crnimo17-12-2": "stainless_316",
  "ugima 316": "stainless_316", "ugima": "stainless_316",
  "904l": "stainless_316",  // super-austenitic — closest available; AI will note higher difficulty
  "a4 stainless": "stainless_316", "marine grade": "stainless_316",
  // ── PH Stainless ──────────────────────────────────────────────────────────
  "17-4": "stainless_ph", "17-4ph": "stainless_ph", "17-4 ph": "stainless_ph",
  "15-5": "stainless_ph", "15-5ph": "stainless_ph", "13-8mo": "stainless_ph",
  "ph13-8mo": "stainless_ph", "630": "stainless_ph", "s17400": "stainless_ph",
  "1.4542": "stainless_ph", "17-7": "stainless_ph",
  // ── Duplex ────────────────────────────────────────────────────────────────
  "2205": "stainless_duplex", "s31803": "stainless_duplex", "s32205": "stainless_duplex",
  "1.4462": "stainless_duplex", "2304": "stainless_duplex",
  "duplex stainless": "stainless_duplex", "duplex": "stainless_duplex",
  "2205 duplex": "stainless_duplex",
  // ── Super Duplex ──────────────────────────────────────────────────────────
  "2507": "stainless_superduplex", "s32750": "stainless_superduplex",
  "s32760": "stainless_superduplex", "zeron 100": "stainless_superduplex",
  "1.4410": "stainless_superduplex",
  // ── Gray Cast Iron ────────────────────────────────────────────────────────
  "gray iron": "cast_iron_gray", "grey iron": "cast_iron_gray",
  "gray cast iron": "cast_iron_gray", "grey cast iron": "cast_iron_gray",
  // ASTM A48 classes
  "class 20": "cast_iron_gray", "class 25": "cast_iron_gray", "class 30": "cast_iron_gray",
  "class 35": "cast_iron_gray", "class 40": "cast_iron_gray", "class 45": "cast_iron_gray",
  "class 50": "cast_iron_gray", "class 55": "cast_iron_gray", "class 60": "cast_iron_gray",
  // EN / ISO GJL grades
  "gjl-100": "cast_iron_gray", "gjl-150": "cast_iron_gray", "gjl-200": "cast_iron_gray",
  "gjl-250": "cast_iron_gray", "gjl-300": "cast_iron_gray", "gjl-350": "cast_iron_gray",
  "en-gjl-150": "cast_iron_gray", "en-gjl-200": "cast_iron_gray",
  "en-gjl-250": "cast_iron_gray", "en-gjl-300": "cast_iron_gray",
  // DIN grades
  "gg10": "cast_iron_gray", "gg15": "cast_iron_gray", "gg20": "cast_iron_gray",
  "gg25": "cast_iron_gray", "gg30": "cast_iron_gray", "gg35": "cast_iron_gray", "gg40": "cast_iron_gray",
  // Chinese HT grades
  "ht100": "cast_iron_gray", "ht150": "cast_iron_gray", "ht200": "cast_iron_gray",
  "ht250": "cast_iron_gray", "ht300": "cast_iron_gray", "ht350": "cast_iron_gray",
  // JIS FC grades
  "fc100": "cast_iron_gray", "fc150": "cast_iron_gray", "fc200": "cast_iron_gray",
  "fc250": "cast_iron_gray", "fc300": "cast_iron_gray", "fc350": "cast_iron_gray",
  // Indian FG grades
  "fg200": "cast_iron_gray", "fg260": "cast_iron_gray", "fg300": "cast_iron_gray",
  // ── Ductile / Nodular Iron ────────────────────────────────────────────────
  "ductile iron": "cast_iron_ductile", "nodular iron": "cast_iron_ductile",
  "spheroidal graphite iron": "cast_iron_ductile", "sg iron": "cast_iron_ductile",
  // ASTM A536 grades
  "60-40-18": "cast_iron_ductile", "65-45-12": "cast_iron_ductile",
  "80-55-06": "cast_iron_ductile",
  "100-70-03": "cast_iron_ductile", "120-90-02": "cast_iron_ductile",
  // EN / ISO GJS grades
  "gjs-400-15": "cast_iron_ductile", "gjs-400-18": "cast_iron_ductile",
  "gjs-450-10": "cast_iron_ductile", "gjs-500-7": "cast_iron_ductile",
  "gjs-600-3": "cast_iron_ductile",  "gjs-700-2": "cast_iron_ductile",
  "gjs-800-2": "cast_iron_ductile",
  "en-gjs-400-15": "cast_iron_ductile", "en-gjs-450-10": "cast_iron_ductile",
  "en-gjs-500-7": "cast_iron_ductile", "en-gjs-600-3": "cast_iron_ductile",
  // DIN GGG grades
  "ggg40": "cast_iron_ductile", "ggg45": "cast_iron_ductile", "ggg50": "cast_iron_ductile",
  "ggg60": "cast_iron_ductile", "ggg70": "cast_iron_ductile", "ggg80": "cast_iron_ductile",
  // Chinese QT grades
  "qt400-15": "cast_iron_ductile", "qt450-10": "cast_iron_ductile",
  "qt500-7": "cast_iron_ductile",   "qt600-3": "cast_iron_ductile",
  "qt700-2": "cast_iron_ductile",   "qt800-2": "cast_iron_ductile", "qt900-2": "cast_iron_ductile",
  // JIS FCD grades
  "fcd400": "cast_iron_ductile", "fcd450": "cast_iron_ductile", "fcd500": "cast_iron_ductile",
  "fcd600": "cast_iron_ductile", "fcd700": "cast_iron_ductile",
  // ── Compacted Graphite Iron / CGI ─────────────────────────────────────────
  "cgi": "cast_iron_cgi",
  "compacted graphite iron": "cast_iron_cgi", "compacted graphite": "cast_iron_cgi",
  "vermicular iron": "cast_iron_cgi", "vermicular graphite iron": "cast_iron_cgi",
  "gjv-300": "cast_iron_cgi", "gjv-350": "cast_iron_cgi", "gjv-400": "cast_iron_cgi",
  "gjv-450": "cast_iron_cgi", "gjv-500": "cast_iron_cgi",
  "en-gjv-300": "cast_iron_cgi", "en-gjv-400": "cast_iron_cgi", "en-gjv-450": "cast_iron_cgi",
  "rt300": "cast_iron_cgi",   // old DIN designation for vermicular iron
  // ── Malleable Cast Iron ───────────────────────────────────────────────────
  "malleable iron": "cast_iron_malleable", "malleable cast iron": "cast_iron_malleable",
  "whiteheart": "cast_iron_malleable",    "blackheart": "cast_iron_malleable",
  "gtw": "cast_iron_malleable",           "gtb": "cast_iron_malleable",
  "gts-35-10": "cast_iron_malleable",     "gts-45-06": "cast_iron_malleable",
  "gts-55-04": "cast_iron_malleable",     "gts-65-02": "cast_iron_malleable",
  "m3210": "cast_iron_malleable", "m5003": "cast_iron_malleable", "m7002": "cast_iron_malleable",
  // ── CP Titanium (Grade 1–4 + near-alpha Grade 9) ──────────────────────────
  "cp titanium": "titanium_cp", "commercially pure titanium": "titanium_cp",
  "grade 1": "titanium_cp", "grade 2": "titanium_cp",
  "grade 3": "titanium_cp", "grade 4": "titanium_cp",
  "titanium grade 1": "titanium_cp", "titanium grade 2": "titanium_cp",
  "titanium grade 3": "titanium_cp", "titanium grade 4": "titanium_cp",
  "uns r50250": "titanium_cp", "uns r50400": "titanium_cp",
  "uns r50550": "titanium_cp", "uns r50700": "titanium_cp",
  "grade 9": "titanium_cp",          // Ti-3Al-2.5V near-alpha — similar machinability to CP
  "ti-3al-2.5v": "titanium_cp", "ti 3-2.5": "titanium_cp",
  "3al-2.5v": "titanium_cp",
  // ── Ti-6Al-4V and alpha-beta alloys ───────────────────────────────────────
  "ti-6al-4v": "titanium_64", "ti64": "titanium_64", "6al-4v": "titanium_64",
  "grade 5": "titanium_64", "titanium grade 5": "titanium_64",
  "grade 23": "titanium_64", "titanium grade 23": "titanium_64",  // ELI
  "ti-6-4": "titanium_64", "titanium 6-4": "titanium_64",
  "ti-6al-4v eli": "titanium_64", "6-4 eli": "titanium_64",
  "uns r56400": "titanium_64", "uns r56407": "titanium_64",
  "ti-5553": "titanium_64", "5al-5mo-5v-3cr": "titanium_64",   // beta alloy — similar difficulty
  "ti-10-2-3": "titanium_64", "beta c": "titanium_64",
  "ti-6al-2sn-4zr-2mo": "titanium_64",                          // Ti-6242 near-alpha
  "ti-6242": "titanium_64",
  // ── A-286 / Fe-Based Superalloy ───────────────────────────────────────────
  "a-286": "hiTemp_fe", "a286": "hiTemp_fe", "v57": "hiTemp_fe",
  "incoloy 800": "hiTemp_fe", "incoloy 800h": "hiTemp_fe", "incoloy 800ht": "hiTemp_fe",
  "incoloy 801": "hiTemp_fe", "incoloy 901": "hiTemp_fe", "incoloy 909": "hiTemp_fe",
  "uns n08800": "hiTemp_fe", "uns n09901": "hiTemp_fe",
  "udimet l-605": "hiTemp_fe",  // Fe-based version of L-605
  // ── Stellite / Co-Based Superalloy ────────────────────────────────────────
  "stellite": "hiTemp_co", "stellite 1": "hiTemp_co", "stellite 3": "hiTemp_co",
  "stellite 6": "hiTemp_co", "stellite 12": "hiTemp_co", "stellite 21": "hiTemp_co",
  "stellite 31": "hiTemp_co", "tribaloy t-400": "hiTemp_co",
  "haynes 25": "hiTemp_co", "haynes 188": "hiTemp_co",
  "l605": "hiTemp_co", "l-605": "hiTemp_co",
  "cobalt superalloy": "hiTemp_co", "cobalt alloy": "hiTemp_co",
  "mar-m 509": "hiTemp_co",         // cast cobalt turbine alloy
  // ── Monel ─────────────────────────────────────────────────────────────────
  "monel": "monel_k500", "monel k500": "monel_k500", "monel k-500": "monel_k500",
  "k500": "monel_k500", "uns n05500": "monel_k500",
  "monel 400": "monel_k500", "uns n04400": "monel_k500",  // 400 is similar difficulty
  // ── Inconel 625 / Corrosion-Grade Ni ─────────────────────────────────────
  "625": "inconel_625", "inconel 625": "inconel_625", "in625": "inconel_625",
  "uns n06625": "inconel_625", "alloy 625": "inconel_625",
  "hastelloy c-276": "inconel_625", "hastelloy c276": "inconel_625", "c-276": "inconel_625",
  "hastelloy c-22": "inconel_625", "hastelloy c22": "inconel_625", "c-22": "inconel_625",
  "hastelloy c-4": "inconel_625",  "hastelloy b-2": "inconel_625",
  "hastelloy b-3": "inconel_625",  "hastelloy c-2000": "inconel_625",
  "inconel 600": "inconel_625",    "inconel 601": "inconel_625",
  "inconel 686": "inconel_625",    "inconel 690": "inconel_625",
  "incoloy 825": "inconel_625",    "incoloy 925": "inconel_625",  "incoloy 945": "inconel_625",
  "uns n06600": "inconel_625",     "uns n06601": "inconel_625",
  "custom age 625+": "inconel_625",
  // ── Inconel 718 / Gamma-Prime Aerospace Ni ───────────────────────────────
  "718": "inconel_718", "inconel 718": "inconel_718", "in718": "inconel_718",
  "uns n07718": "inconel_718", "allvac 718": "inconel_718",
  "ati 718 plus": "inconel_718", "718 plus": "inconel_718",
  "inconel 706": "inconel_718",    // close in machinability to 718
  "uns n09706": "inconel_718",
  // ── Hastelloy X / Mid-Tier Solution-Strengthened Ni ──────────────────────
  "hastelloy x": "hastelloy_x", "uns n06002": "hastelloy_x",
  "inconel x-750": "hastelloy_x", "inconel 725": "hastelloy_x",
  "uns n07750": "hastelloy_x",    "uns n07725": "hastelloy_x",
  "nimonic c-263": "hastelloy_x", "nimonic 263": "hastelloy_x",
  "haynes 263": "hastelloy_x",    "haynes 242": "hastelloy_x",
  "hastelloy g-30": "hastelloy_x", "hastelloy n": "hastelloy_x",
  "hastelloy w": "hastelloy_x",   "hastelloy s": "hastelloy_x",
  "vdm alloy 602ca": "hastelloy_x",
  // ── Inconel 617 / Haynes 230 — Power-Gen Combustor Ni ────────────────────
  "inconel 617": "inconel_617",   "alloy 617": "inconel_617",
  "uns n06617": "inconel_617",    "haynes 230": "inconel_617",
  "617": "inconel_617",
  // ── Waspaloy / Hot-Section Gamma-Prime Ni ─────────────────────────────────
  "waspaloy": "waspaloy", "uns n07001": "waspaloy",
  "haynes 282": "waspaloy",       "haynes282": "waspaloy",
  "rene 41": "waspaloy",  "rené 41": "waspaloy",
  "rene 77": "waspaloy",  "rené 77": "waspaloy",
  "rene 80": "waspaloy",  "rené 80": "waspaloy",
  "rene 88": "waspaloy",  "rene 88dt": "waspaloy",
  "nimonic 80a": "waspaloy",      "nimonic 90": "waspaloy",
  "nimonic 105": "waspaloy",      "nimonic 115": "waspaloy",
  "udimet 500": "waspaloy",       "udimet 600": "waspaloy",
  "udimet 700": "waspaloy",
  "inconel 738": "waspaloy",      "inconel 939": "waspaloy",
  "mar-m 247": "waspaloy",        // cast nickel — similar milling difficulty
  // ── MP35N / Ultra-High-Strength Ni-Co ─────────────────────────────────────
  "mp35n": "mp35n", "uns r30035": "mp35n",
  "udimet 720": "mp35n",          // turbine disk Ni — most demanding PM grade
  "rene 95": "mp35n", "rené 95": "mp35n",
  "rene 104": "mp35n",
  // ── Unfilled Engineering Thermoplastics ───────────────────────────────────
  "peek": "plastic_unfilled",    "polyether ether ketone": "plastic_unfilled",
  "pom": "plastic_unfilled",     "delrin": "plastic_unfilled", "acetal": "plastic_unfilled",
  "pa": "plastic_unfilled",      "nylon": "plastic_unfilled",
  "pa6": "plastic_unfilled",     "pa66": "plastic_unfilled",   "pa12": "plastic_unfilled",
  "nylon 6": "plastic_unfilled", "nylon 66": "plastic_unfilled",
  "pc": "plastic_unfilled",      "polycarbonate": "plastic_unfilled", "lexan": "plastic_unfilled",
  "pps": "plastic_unfilled",     "polyphenylene sulfide": "plastic_unfilled",
  "pei": "plastic_unfilled",     "ultem": "plastic_unfilled",  "ultem 1000": "plastic_unfilled",
  "ptfe": "plastic_unfilled",    "teflon": "plastic_unfilled",
  "hdpe": "plastic_unfilled",    "uhmwpe": "plastic_unfilled", "uhmw": "plastic_unfilled",
  "pp": "plastic_unfilled",      "polypropylene": "plastic_unfilled",
  "abs": "plastic_unfilled",     "pbt": "plastic_unfilled",
  "pla": "plastic_unfilled",     "pmma": "plastic_unfilled",   "acrylic": "plastic_unfilled",
  "engineering plastic": "plastic_unfilled", "thermoplastic": "plastic_unfilled",
  // ── Fiber-Reinforced Thermoplastics ──────────────────────────────────────
  "gf-pa": "plastic_filled",     "glass filled nylon": "plastic_filled",
  "cf-pa": "plastic_filled",     "carbon filled nylon": "plastic_filled",
  "gf-peek": "plastic_filled",   "cf-peek filled": "plastic_filled",
  "gf-pp": "plastic_filled",     "pps-gf": "plastic_filled",
  "peek-cf": "plastic_filled",   "peek-gf": "plastic_filled",
  "glass filled peek": "plastic_filled", "carbon filled peek": "plastic_filled",
  "filled thermoplastic": "plastic_filled", "fiber reinforced thermoplastic": "plastic_filled",
  // ── Continuous-Fiber TPC Laminates ───────────────────────────────────────
  "cf-peek": "composite_tpc",    "cf peek laminate": "composite_tpc",
  "cfr-tp": "composite_tpc",     "gfr-tp": "composite_tpc",
  "cfrtp": "composite_tpc",      "gfrtp": "composite_tpc",
  "cf-pekk": "composite_tpc",    "pekk composite": "composite_tpc",
  "tpc laminate": "composite_tpc", "thermoplastic composite": "composite_tpc",
  "tpc": "composite_tpc",
};

export function matchMaterialAlias(input: string): string | null {
  const key = input.trim().toLowerCase();
  return MATERIAL_ALIASES[key] ?? null;
}

export function getIsoForKey(key: string): IsoCategory | null {
  const found = ISO_SUBCATEGORIES.find((s) => s.key === key);
  return found ? found.iso : null;
}

export function getCategoryColor(iso: IsoCategory): string {
  return ISO_CATEGORIES.find((c) => c.iso === iso)?.color ?? "#888";
}
