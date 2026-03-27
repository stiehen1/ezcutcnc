import math
from engine.physics import (
    chip_thinning_factor,
    chip_thickness,
    effective_chip_thickness,
    minimum_chip_thickness,
    engagement_angle,
    cutting_force_per_tooth,
    tool_deflection,
    tool_life,
    enforce_deflection_limit,
    get_mode_defaults,
    rctf,
    hem_feed_boost,
    drill_thrust,
    drill_torque,
    drill_depth_torque_factor,
    drill_min_ipr,
    recommend_drill_cycle,
    REAM_SFM,
    _REAM_NON_CF_MULT,
    _REAM_EXT_COOLANT,
    ream_base_ipr,
    ream_stock_range,
    ream_depth_factors,
    ream_coating,
    ream_helix_angle,
    ream_tool_life,
    # Thread milling tables and geometry helpers
    UN_TPI,
    METRIC_PITCH,
    NPT_DATA,
    NPT_TAPER_PER_IN,
    thread_depth_in,
    thread_minor_dia,
    thread_pitch_dia,
    threadmill_sfm_factor,
    threadmill_passes,
    threadmill_spring_pass,
)

import sys

def ui_print(emit: bool, *args, **kwargs):
    if not emit:
        return
    kwargs.setdefault("file", sys.stderr)  # never pollute stdout
    print(*args, **kwargs)
# ================================
# USER INPUT
# ================================
data = {
    "material": "titanium",
    "rc": 20,
    "mode": "hem",  # slot, dynamic, hem
    "diameter": 0.5,
    "flutes": 6,  # 4 for slot, 6 for HEM, 2 for threadmill
    "tool_type": "endmill",
    "loc": .010,
    "platform": "VST5",
    "custom_tool": False,
    "target_scallop": 0.0002,
    "force_limit": 100,
    "stickout": 3.5,
    "multi_tool_process": False,
    "doc_xd": 2.0,
    "woc_pct": 10,  # 2–3% for HEM Inconel success
    "machine_hp": 15,
    "max_rpm": 12000,
    "rpm_util_pct": 0.90,
    "coolant": "flood",
    "spindle_taper": "CAT40",
    "dual_contact": True,
    "toolholder": "ER",
    "helix": 35,
    "deflection_limit": 0.0005,
    "hem_rub_min": 1.05,
    "debug": False
}

# ================================
# CONSTANTS
# ================================
MATERIAL_COATING_PREF = {
    "inconel": ["T-Max", "P-Max"],
    "titanium": ["T-Max", "P-Max"],
    "stainless": ["P-Max", "T-Max"],
    "steel": ["P-Max", "T-Max"],
    "aluminum": ["Uncoated", "D-Max"],
    "brass": ["Uncoated", "D-Max"],
    "copper": ["Uncoated", "D-Max"],
}

PLATFORM_COATINGS = {
    "FEM4": ["A-Max"],
    "FEM5": ["A-Max"],
    "VST5": ["P-Max", "T-Max"],
    "7FL": ["C-Max"],
}

BASE_SFM = {
    # Legacy group keys (fallback)
    "Aluminum": 900,
    "Non-Ferrous": 800,
    "Plastics": 600,
    "Steel": 300,
    "Stainless": 220,
    "Cast Iron": 250,
    "Inconel": 180,
    "Titanium": 160,
    # ISO subcategory keys (conventional milling base; catalog-validated conservative midpoints)
    "aluminum_wrought":    1400,  # 6061/6082/5052/6xxx — shop-validated 1400 SFM conventional
    "aluminum_wrought_hs": 1100,  # 7075/2024/7xxx/2xxx — ~20% lower; harder/stronger, sharper tools needed
    "aluminum_cast": 650,
    "non_ferrous": 550,
    "steel_mild": 400,              # Plain low-carbon / structural (A36, 1018, 1020, 10xx series)
    "steel_free": 425,              # True free-machining (12L14, 1215, 1117 — sulfur-additive grades)
    "steel_alloy": 350,             # 4140: 350 SFM confirmed at full-slot (worst case)
    "steel_tool": 150,
    "stainless_fm":          290,   # 303/416 free-machining — midpoint 240–340 SFM
    "stainless_ferritic":    230,   # 409/430/441 ferritic — midpoint 180–280 SFM
    "stainless_410":         215,   # 410 martensitic — midpoint 170–260 SFM
    "stainless_420":         180,   # 420 martensitic (annealed) — midpoint 140–220 SFM
    "stainless_440c":        200,   # 440C — high-carbon, abrasive; behaves closer to tool steel
    "stainless_304":         180,   # 304/304L/321 — midpoint 140–220 SFM (was 225 — too high)
    "stainless_316":         160,   # 316/316L Mo-bearing — midpoint 120–200 SFM (was 195 — too high)
    "stainless_ph":          190,   # 17-4PH/15-5PH/13-8MO — midpoint 140–240 SFM (was 240 — too high)
    "stainless_duplex":      145,   # Duplex 2205 — midpoint 110–180 SFM
    "stainless_superduplex": 120,   # Super duplex 2507 — midpoint 90–150 SFM
    "stainless_martensitic": 215,   # legacy fallback → stainless_410
    "stainless_austenitic":  180,   # legacy fallback → stainless_304
    "cast_iron_gray": 375,
    "cast_iron_ductile": 325,
    "cast_iron_cgi": 260,       # Compacted Graphite Iron — 30-50% shorter tool life than gray; run slower
    "cast_iron_malleable": 275,
    "titanium_cp":  250,            # CP Titanium Grade 1–4
    "titanium_64":  180,            # Ti-6Al-4V Grade 5 (180 SFM conventional confirmed)
    "titanium":     180,            # legacy fallback
    "hiTemp_fe":  95,               # A-286 / Incoloy 800 / Udimet — iron-based superalloy; A286 guide mid 95 SFM (was 125)
    "hiTemp_co": 135,               # Stellite — cobalt-based superalloy
    "monel_k500":   115,            # Monel K-500 — guide 90–140, mid 115 SFM (was 110)
    "inconel_625":  110,            # 625 / Hastelloy C-276 — guide 80–120; baseline 110 → HEM 220 SFM (was 100)
    "inconel_718":  110,            # Inconel 718 — guide 70–110; baseline 110 → HEM 220 SFM (was 90)
    "hastelloy_x":   82,            # Hastelloy X/725/X-750/Nimonic C-263/Haynes 242 — avg guide mids 82 SFM
    "inconel_617":   78,            # Inconel 617 / Haynes 230 — solid-solution Ni-Cr-Co-Mo, power-gen combustors
    "waspaloy":      68,            # Waspaloy / HAYNES 282 / René 41/77/80 / Nimonic 80A/90/105 / Udimet 500/700 — hot-section
    "mp35n":         60,            # MP35N / Udimet 720 / René 95 — ultra-high-strength; first test 60 SFM
    "plastic_unfilled":  450,  # Unfilled engineering TPs (PEEK, POM, PA, PC, PPS, PEI) — mid of 300–600 SFM range
    "plastic_filled":    350,  # Short/long fiber GF/CF TPs — abrasion reduces SFM vs unfilled
    "composite_tpc":     400,  # Continuous-fiber TPC laminates (CF-PEEK, GF-PP) — composite milling range
    "inconel":      100,            # legacy fallback
    "tool_steel_p20": 300,  # P20 prehardened ~30 HRC: 260–340 SFM; 300 SFM confirmed
    "tool_steel_a2":  240,  # A2 tool steel: 200–280 SFM; 240 SFM confirmed
    "tool_steel_h13": 220,  # H13 tool steel: 180–260 SFM; 220 SFM confirmed
    "tool_steel_s7":  240,  # S7 tool steel: 190–270 SFM; 240 SFM confirmed
    "tool_steel_d2":  180,  # D2 tool steel: 140–220 SFM; 180 SFM confirmed (high carbide, abrasive)
    "cpm_10v":        85,   # CPM 10V / A11: PM high-vanadium wear steel. Vanadium carbides (~80 HRC) harder than carbide binder — treat as abrasion problem. Assumes premium TiAlSiN HiPIMS coating (e.g. Cemecon Inoxicon); standard AlTiN ~70 SFM. HEM = 2× = 170 SFM.
    "hardened_lt55": 240,   # Carbide endmill in hardened tool steel 35–54 HRC (e.g. H13 45 HRC → 240 SFM confirmed)
    "hardened_gt55": 100,  # Carbide in very hard steel ≥55 HRC (CBN territory starts ~60 HRC)
    # ── Armor plate steels (HEM preferred; abrasion-dominated wear mechanism) ─
    "armor_milspec": 240,   # MIL-A-12560 / MIL-A-46100 structural armor — 260–300 HB (~27–32 HRC); most machinable armor grade
    "armor_ar400":   175,   # AR400 / AR450 abrasion-resistant plate — 360–480 HB (~38–47 HRC)
    "armor_ar500":   130,   # AR500 / Armox 500T — 470–540 HB (~50–56 HRC); most common range for ballistic targets
    "armor_ar600":    75,   # AR550 / AR600 / Armox 600T — 570–640 HB (~58–63 HRC); extreme hardness, treat as grinding
}

# Unit power (HP·min/in³) at nominal chip thickness, TiAlN carbide tooling.
# Hardness correction is applied separately via hardness_kc_mult() in run_milling().
# Sources: Machinery's Handbook 31, Kennametal/Sandvik cutting data handbooks.
HP_PER_CUIN = {
    # Legacy group keys (fallback)
    "Aluminum":   0.28,
    "Non-Ferrous": 0.35,
    "Plastics":   0.20,
    "Steel":      1.00,
    "Stainless":  1.05,
    "Cast Iron":  0.65,
    "Inconel":    1.55,
    "Titanium":   1.15,
    # ISO subcategory keys
    "aluminum_wrought":    0.28,
    "aluminum_wrought_hs": 0.30,   # 7075/2024 — slightly higher unit force than 6061
    "aluminum_cast":    0.32,
    "plastic_unfilled":  0.06,  # Very low unit cutting force — thermoplastics cut easily
    "plastic_filled":    0.10,  # Fibers add abrasion; force higher than unfilled
    "composite_tpc":     0.14,  # Continuous fibers — highest force in this family
    "non_ferrous":      0.35,
    "steel_mild":       0.82,   # Plain low-carbon — softer than alloy, harder than free-machining
    "steel_free":       0.75,
    "steel_alloy":      1.00,  # 4140, 4340 — Machinery's Handbook C=1.0 for alloy steel
    "steel_tool":       1.10,
    "stainless_fm":          0.95,   # 303/416 free-machining
    "stainless_ferritic":    0.95,   # 409/430/441 ferritic — cuts like steel
    "stainless_410":         1.00,   # 410 martensitic
    "stainless_420":         1.05,   # 420 martensitic — harder than 410
    "stainless_440c":        1.20,   # 440C — high carbide content
    "stainless_304":         1.10,   # 304/321 austenitic — gummy, high unit power
    "stainless_316":         1.12,   # 316/316L — Mo adds unit power
    "stainless_ph":          1.15,   # PH stainless — high strength
    "stainless_duplex":      1.20,   # Duplex 2205 — high strength dual-phase
    "stainless_superduplex": 1.30,   # Super duplex 2507 — highest strength SS
    "stainless_martensitic": 1.00,   # legacy fallback
    "stainless_austenitic":  1.10,   # legacy fallback
    "cast_iron_gray":        0.60,
    "cast_iron_ductile":     0.70,
    "cast_iron_cgi":         0.75,   # CGI: higher forces than gray — partial graphite lubrication only
    "cast_iron_malleable":   0.65,
    "titanium_cp":           1.00,
    "titanium_64":           1.15,
    "titanium":              1.15,
    "hiTemp_fe":             1.35,
    "hiTemp_co":             1.45,
    "monel_k500":            1.30,   # Ni-Cu — friendliest in the family
    "inconel_625":           1.40,   # 625/C-276 — corrosion-focused
    "inconel_718":           1.55,   # 718 — standard aerospace Ni
    "hastelloy_x":           1.55,   # X / 725 / X-750 / Nimonic C-263 — mid-tier
    "inconel_617":           1.58,   # 617 / Haynes 230 — solid-solution, between hastelloy_x and waspaloy
    "waspaloy":              1.65,   # Waspaloy/282/René 41/77/80/Nimonic 80A/90 — hot-section
    "mp35n":                 1.70,   # MP35N / Udimet 720 / René 95 — highest unit power in the family
    "inconel":               1.55,   # legacy fallback
    "tool_steel_p20": 1.05,
    "tool_steel_a2":  1.10,
    "tool_steel_h13": 1.10,
    "tool_steel_s7":  1.10,
    "tool_steel_d2":  1.20,  # Higher carbide content — more unit power
    "cpm_10v":        1.30,  # CPM 10V: vanadium carbides harder than tool binder phases = higher cutting force
    "hardened_lt55": 1.35,
    "hardened_gt55": 1.50,
    "armor_milspec": 1.25,  # MIL-A-12560 — tough but lower hardness
    "armor_ar400":   1.38,  # AR400 — high toughness + hardness combined
    "armor_ar500":   1.50,  # AR500 — extreme toughness resists shearing
    "armor_ar600":   1.60,  # AR600 — maximum combined resistance
}

COOLANT_LIFE = {
    "tsc_high": 1.50,  # TSC ~1000 psi
    "tsc_low": 1.35,   # TSC ~300 psi
    "flood": 1.25,
    "mist": 1.10,
    "air": 1.10,
    "dry": 0.85,
}

# Fluid chemistry modifiers — applied on top of delivery method factor
COOLANT_FLUID_FACTOR = {
    "straight_oil":   1.10,   # best lubricity, minimal cooling
    "semi_synthetic": 1.00,   # balanced — baseline reference
    "water_soluble":  1.00,   # soluble oil, similar to semi-synthetic
    "synthetic":      0.97,   # best cooling, least lubricity
}

def _coolant_concentration_mult(pct):
    """Tool-life multiplier from refractometer concentration %."""
    if pct < 5:   return 0.90   # too dilute — poor lubricity and biocide
    if pct < 7:   return 0.95
    if pct <= 12: return 1.00   # sweet spot
    if pct <= 16: return 1.02   # richer mix — better lubricity
    return 0.97                 # over-concentrated — residue/foam risk

def _coolant_fluid_mult(payload):
    """Combined tool-life multiplier for fluid chemistry + concentration."""
    fluid = str(payload.get("coolant_fluid", "semi_synthetic") or "semi_synthetic").lower()
    base  = COOLANT_FLUID_FACTOR.get(fluid, 1.00)
    if fluid == "straight_oil":
        return base  # no dilution — concentration N/A
    pct = float(payload.get("coolant_concentration", 10) or 10)
    return base * _coolant_concentration_mult(pct)

# Coating life multipliers — applied after all other tool life factors.
# Values are realistic shop-floor adjustments, not marketing claims.
# Catalog separation: D-MAX is only offered on non-ferrous (aluminum) tooling;
# T-MAX / A-MAX / P-MAX / C-MAX are only offered on ferrous tooling.
# Cross-material entries default to 1.0 (neutral) since those combinations don't exist.
# T-MAX (AlTiCrN): heat-resistant — stainless 10–20% per shop data → 1.12 midpoint
# A-MAX (AlTiN Arc): Balzers Latuma — Arc PVD, 35 GPa, 1,000°C — baseline ferrous reference 1.0
# P-MAX (AlCrN Arc): Balzers BALINIT ALCRONA EVO — Arc PVD, 44 GPa, 1,100°C — same chemistry as C-Max, Arc vs HiPIMS
# C-MAX (AlCrN HiPIMS): Cemecon CC800 HiPIMS — 1,100°C; good in stainless, steel, abrasive
# D-MAX (ta-C): Balzers BALINIT MAYURA — ta-C, >65 GPa, <0.10 friction, >500°C; non-ferrous only
# Uncoated: baseline for non-ferrous tools without D-MAX
COATING_LIFE_MULT: dict[str, dict[str, float]] = {
    "t-max":    {"default": 1.15},
    "a-max":    {"default": 1.00},
    "p-max":    {"steel": 1.08, "stainless": 1.05, "default": 1.03},
    "c-max":    {"stainless": 1.08, "steel": 1.06, "default": 1.04},
    "d-max":    {"aluminum": 1.20, "default": 1.00},  # only on non-ferrous tools; neutral fallback
    "uncoated": {"aluminum": 1.00, "default": 0.85},  # aluminum baseline is uncoated; ferrous baseline is A-MAX
}

# SFM multiplier by coating — relative to AlTiN (A-Max) baseline = 1.00
# Applied in calc_state() to base_sfm after material lookup, before hardness penalty
# D-Max on ferrous: 0.90 (incompatible — warns in UI, penalizes here)
COATING_SFM_MULT: dict[str, dict[str, float]] = {
    "t-max":    {"inconel": 1.00, "titanium": 1.00, "default": 1.10},
    "a-max":    {"default": 1.00},
    "p-max":    {"steel": 1.05, "stainless": 1.03, "default": 1.02},
    "c-max":    {"stainless": 1.07, "steel": 1.05, "default": 1.03},
    "d-max":    {"aluminum": 1.20, "default": 0.90},  # penalty on ferrous — wrong coating
    "uncoated": {"aluminum": 1.00, "default": 0.85},
}

def _coating_sfm_factor(coating: str, material_group: str) -> float:
    """Return the SFM multiplier for a given coating + material group pairing."""
    key = (coating or "").strip().lower()
    grp = (material_group or "").strip().lower()
    tbl = COATING_SFM_MULT.get(key)
    if tbl is None:
        return 1.0  # unknown/blank → no adjustment (assume A-Max baseline)
    return tbl.get(grp, tbl.get("default", 1.0))

def _coating_life_factor(coating: str, material_group: str) -> float:
    """Return the tool-life multiplier for a given coating + material group pairing."""
    key = (coating or "").strip().lower()
    grp = (material_group or "").strip().lower()
    tbl = COATING_LIFE_MULT.get(key)
    if tbl is None:
        return 1.0  # unknown coating → no adjustment
    return tbl.get(grp, tbl.get("default", 1.0))

BASE_LIFE_MIN = {
    "aluminum_wrought":    180.0,
    "aluminum_wrought_hs": 140.0,  # 7075/2024 — shorter tool life than 6061
    "aluminum_cast":    130.0,
    "plastic_unfilled":  250.0, # Long tool life if sharp tools maintained; BUE/smear is the failure mode
    "plastic_filled":     80.0, # Glass fiber abrasion dramatically shortens tool life
    "composite_tpc":      70.0, # Continuous fibers — aggressive on edges, especially GF laminates
    "non_ferrous":      110.0,
    "steel_mild":       100.0,   # Plain mild steel — good tool life, predictable wear
    "steel_free":        90.0,
    "steel_alloy":       75.0,
    "steel_tool":        55.0,
    "stainless_martensitic": 60.0,
    "stainless_fm":          70.0,
    "stainless_austenitic":  50.0,
    "stainless_ph":          45.0,
    "cast_iron_gray":        95.0,
    "cast_iron_ductile":     75.0,
    "cast_iron_malleable":   80.0,
    "titanium_cp":           45.0,
    "titanium_64":           35.0,
    "titanium":              35.0,
    "hitemp_fe":             22.0,
    "hitemp_co":             18.0,
    "inconel_625":           22.0,
    "inconel_718":           18.0,
    "inconel":               18.0,
    "hardened_lt55":         38.0,
    "hardened_gt55":         20.0,
    "armor_milspec":         55.0,  # Most machinable armor grade — reasonable tool life with correct approach
    "armor_ar400":           30.0,  # AR400 — first pass (scale/decarb) is the killer
    "armor_ar500":           18.0,  # AR500 — brutal; expect 50–70% shorter tool life than alloy steel
    "armor_ar600":           10.0,  # AR600 — extreme; treat it like grinding, plan for frequent changes
    "cpm_10v":               30.0,  # CPM 10V: abrasive wear shortens tool life significantly vs D2
    "steel":      75.0,
    "stainless":  50.0,
    "cast iron":  90.0,
    "aluminum":  150.0,
    "hrsa":       18.0,
    "titanium_legacy": 35.0,
}

SPINDLE_DRIVE_EFF = {
    "direct": 0.96,  # servo-direct, HSK high-speed — minimal loss
    "belt":   0.92,  # most VMC/HMC (Haas, Mazak, Makino) — belt losses
    "gear":   0.88,  # older machines, knee mills — gear mesh losses
}

TOOLHOLDER_RIGIDITY = {
    # new ISO key names
    "er_collet":       1.00,
    "hp_collet":       1.05,  # SK/FX-style precision bearing nut collet — better than ER but still slotted
    "weldon":          1.08,  # Side-lock set screw on flat — positive mechanical lock, moderate runout
    "shell_mill_arbor":1.10,  # Face contact + drive keys + center bolt — rigid face interface, moderate arbor compliance
    "milling_chuck":   1.12,
    "hydraulic":       1.14,
    "press_fit":       1.17,  # Lobed press-fit interface — full bore contact, self-centering under load
    "shrink_fit":      1.18,
    "capto":           1.20,
    # legacy keys (fallback)
    "ER": 1.00,
    "HYDRAULIC": 1.10,
    "SHRINK": 1.15,
    "SHELL": 1.25,
    "standard": 1.00,
}

# Spindle interface torque capacity (in-lbf)
SPINDLE_TORQUE_CAPACITY = {
    "CAT30":  200,
    "CAT40":  550,
    "CAT50": 1300,
    "BT30":   190,
    "BT40":   520,
    "BT50":  1200,
    "HSK63":  460,
    "HSK100": 950,
    # Lathe live-tool turret interfaces — lower torque than machining center tapers
    "VDI30":   90,
    "VDI40":  180,
    "VDI50":  350,
    "BMT45":  130,
    "BMT55":  280,
    "BMT65":  550,
}

# Holder runout correction: factor applied to IPT (1.0 = no correction needed)
# Lower runout → higher effective chip load per tooth → we can use more of the rated IPT
HOLDER_RUNOUT_FACTOR = {
    "shrink_fit": 1.00,   # <1 µm TIR
    "hydraulic": 0.97,    # 1–2 µm TIR
    "capto": 1.00,        # integral shank
    "hp_collet": 0.97,    # SK/FX-style: ~1–2 µm TIR — matches hydraulic, far better than ER
    "milling_chuck": 0.95,
    "er_collet":       0.90,  # 3–5 µm TIR
    "weldon":          0.92,  # set screw can introduce minor runout
    "press_fit":       0.99,  # lobed interface — near shrink fit
    "shell_mill_arbor":0.95,  # face contact good but drive key clearance introduces minor runout
}

# Geometry Kc factor — net effective cutting force relative to standard geometry
# truncated_rougher (VRX): ~25% reduction from segmented flute, offset ~12% by neg K-land → net 0.83
# chipbreaker (-CB): ~20% reduction from chip segmentation, minimal edge prep → net 0.80
GEOMETRY_KC_FACTOR = {
    "standard":          1.00,
    "chipbreaker":       0.80,
    "truncated_rougher": 0.83,
}

# Workholding compliance — multiplies chatter_index
WORKHOLDING_COMPLIANCE = {
    "between_centers": 0.75,  # shaft between centers — most rigid setup possible
    "rigid_fixture":   0.80,  # bolted/doweled fixture plate
    "tombstone":       0.82,  # HMC pallet tombstone — bolted, very rigid
    "collet_chuck":    0.85,  # bar stock collet chuck — very consistent grip
    "4_jaw_chuck":     0.88,  # independent 4-jaw — rigid when dialed in
    "5th_axis_vise":   0.88,  # precision 5-axis vise (Mate, Schunk, etc.)
    "dovetail":        0.90,  # mechanical pull-out lock, some lateral compliance
    "trunnion_4th":    0.91,  # 4th-axis trunnion, axis locked — rigid but rotary axis adds slight compliance
    "face_plate":      0.93,  # face plate with clamps
    "vise":            1.00,  # standard Kurt-style vise — baseline
    "3_jaw_chuck":     1.05,  # standard 3-jaw self-centering chuck
    "toe_clamps":      1.08,  # direct clamping, some flex under radial load
    "soft_jaws":       1.20,  # custom soft jaws — most compliant
}

CORE_FACTOR_BY_FLUTES = {2: 0.75, 3: 0.85, 4: 1.00, 5: 1.10, 6: 1.20, 7: 1.30}

HELIX_FORCE_FACTOR = {35: 1.00, 38: 0.95, 45: 0.90}

# CMH chamfer mill series — shear angle on the flank (like helix on an endmill).
# Distributes cutting load progressively, reduces instantaneous force, spreads heat.
# Update CMH_SHEAR_ANGLE_DEG once a physical measurement is taken off a production tool.
CMH_SHEAR_ANGLE_DEG  = 30.0   # degrees — confirmed from production CMH geometry
# SFM bonus: shear angle lowers force → less heat per unit area → can sustain higher SFM.
# Interpolated from HELIX_FORCE_FACTOR slope: 15° ≈ +10%, 30° ≈ +15%, 45° ≈ +20%.
CMH_SFM_MULT         = 1.15   # +15% SFM vs CMS/baseline at 30° shear
# Force factor: same physics as HELIX_FORCE_FACTOR — shear reduces Kc.
# At 30° shear: 1.00 - (30/45)*(1.00-0.90) = 0.933
CMH_FORCE_FACTOR     = round(1.0 - (CMH_SHEAR_ANGLE_DEG / 45.0) * 0.10, 4)  # ~0.933
# Minimum chip fraction: below this × base_ipt, CMH tip flat rubs instead of cutting.
CMH_MIN_CHIP_FRAC    = 0.30   # 30% of base ipt_frac × body_dia

# Helix angle by Core Cutter tool series.
# QTR3 is variable-helix (40/41/42°); 41° is the representative average for force calcs.
# When a SKU upload includes a helix_angle column, that value takes priority over this table.
SERIES_HELIX: dict[str, int] = {
    "AL2":   45,
    "AL3":   37,
    "FEM5":  45,
    "QTR3":  41,   # variable 40/41/42 — middle value; variable_helix=True applies stability benefit
    "VST4":  38,
    "VST5":  39,
    "VST6":  37,
    "VMF7":  38,
    "VMF9":  38,
    "VMF11": 38,
    "VXR4":  42,
    "VXR5":  39,
}

# Series-specific core diameter ratio (core_dia / cutting_dia).
# Used in tool_deflection() — overrides flute-count-based estimate for known series.
# VST6 has a stepped core (62% cutting zone, 70% shank); use 62% at the flute for deflection.
# VMF series high core ratios (73–75%) make these tools significantly stiffer than generic estimates.
SERIES_CORE_RATIO: dict[str, float] = {
    "AL2":   0.50,
    "AL3":   0.50,
    "FEM5":  0.64,
    "QTR3":  0.55,
    "VST4":  0.55,
    "VST5":  0.60,
    "VST6":  0.62,  # cutting zone (70% at shank — not used for deflection)
    "VMF7":  0.73,
    "VMF9":  0.75,
    "VMF11": 0.75,
    "VXR4":  0.50,
    "VXR5":  0.60,
}

# Radial rake angle (degrees) by series.
# Applied as RAKE_FORCE_FACTOR in cutting_force_per_tooth().
# Normalized to 7° baseline — VXR neutral rake (0°) increases Kc ~5%; AL series (10°) reduces ~5%.
SERIES_RADIAL_RAKE: dict[str, int] = {
    "AL2":   10,
    "AL3":   10,
    "FEM5":   7,
    "QTR3":   8,
    "VST4":   7,
    "VST5":   7,
    "VST6":   8,
    "VMF7":   7,
    "VMF9":   7,
    "VMF11":  7,
    "VXR4":   0,
    "VXR5":   0,
}

# Chip-clearance WOC limits by flute count.
# Tuple: (max_slot_doc_xd, max_side_woc_pct)
#   max_slot_doc_xd  — max DOC as ×D when WOC ≥ 90% (full slot); None = no slotting
#   max_side_woc_pct — max WOC % for conventional/shoulder milling (WOC < 90%)
FLUTE_WOC_LIMITS = {
    2:  (1.0,  50.0),
    3:  (1.0,  50.0),
    4:  (1.0,  50.0),
    5:  (0.5,  35.0),
    6:  (None, 25.0),
    7:  (None, 10.0),
    8:  (None,  9.0),   # interpolated 7→9
    9:  (None,  8.0),
    10: (None,  7.5),   # interpolated 9→11
    11: (None,  7.0),
    12: (None,  6.0),
}

def flute_woc_limits(flutes: int):
    """Return (max_slot_doc_xd, max_side_woc_pct) for a given flute count.
    For counts not in the table, falls back to the nearest lower entry,
    then the most conservative known value for counts above 12.
    """
    if flutes in FLUTE_WOC_LIMITS:
        return FLUTE_WOC_LIMITS[flutes]
    if flutes > 12:
        return (None, 6.0)
    # walk down to nearest defined entry
    for f in range(flutes - 1, 1, -1):
        if f in FLUTE_WOC_LIMITS:
            return FLUTE_WOC_LIMITS[f]
    return (1.0, 50.0)  # 2-flute default fallback

# IPT as a fraction of diameter (chip load = IPT_FRAC * diameter).
# Calibrated from shop data: all user-provided values expressed as %×D.
# Reference points: 4140 slot=0.55%×D, 6061 Al=1.25%×D, 304 HEM base≈0.35%×D,
#   Inconel 718 conv=0.30–0.36%×D, 17-4 finish adj=0.42%×D.
IPT_FRAC = {
    # Legacy group keys (fallback)
    "Aluminum": 0.012,
    "Non-Ferrous": 0.008,
    "Plastics": 0.006,
    "Steel": 0.0055,
    "Stainless": 0.0035,
    "Cast Iron": 0.0055,
    "Inconel": 0.003,
    "Titanium": 0.0035,
    # ISO subcategory keys
    "aluminum_wrought":    0.0125,  # 6061 chipbreaker: 1.25%×D confirmed
    "aluminum_wrought_hs": 0.0100,  # 7075/2024: lighter chip load — stronger alloy, more demanding on edges
    "aluminum_cast":    0.010,
    "plastic_unfilled":  0.010,  # High chip load — too light causes rubbing, heat, BUE (1.0%×D = 0.005" on 0.5" tool)
    "plastic_filled":    0.008,  # Fiber-filled: slightly lower than unfilled — abrasion limits aggressiveness
    "composite_tpc":     0.006,  # Continuous fiber laminates: lower chip load; delamination risk at high IPT
    "non_ferrous":      0.008,
    "steel_mild":       0.0065,   # Plain low-carbon (1018, A36) — between free and alloy chip loads
    "steel_free":       0.007,    # True free-machining (12L14, 1215) — sulfur breaks chips cleanly
    "steel_alloy":      0.0055,   # 4140 slotting: 0.55%×D confirmed
    "steel_tool":       0.005,    # A2 annealed estimated
    "stainless_fm":          0.0048,  # 303/416 — midpoint 0.0018–0.0030 on 0.5" = 0.48%×D
    "stainless_ferritic":    0.0041,  # 409/430/441 — midpoint 0.0015–0.0026 on 0.5" = 0.41%×D
    "stainless_410":         0.0040,  # 410 — midpoint 0.0014–0.0025 on 0.5" = 0.40%×D
    "stainless_420":         0.0034,  # 420 annealed — midpoint 0.0012–0.0022 on 0.5" = 0.34%×D
    "stainless_440c":        0.0030,  # 440C — conservative; abrasive
    "stainless_304":         0.0034,  # 304/321 — midpoint 0.0012–0.0022 on 0.5" = 0.34%×D
    "stainless_316":         0.0030,  # 316/316L — midpoint 0.0010–0.0020 on 0.5" = 0.30%×D
    "stainless_ph":          0.0035,  # 17-4PH/15-5PH — midpoint 0.0012–0.0023 on 0.5" = 0.35%×D
    "stainless_duplex":      0.0028,  # 2205 — midpoint 0.0010–0.0018 on 0.5" = 0.28%×D
    "stainless_superduplex": 0.0024,  # 2507 — midpoint 0.0008–0.0016 on 0.5" = 0.24%×D
    "stainless_martensitic": 0.0040,  # legacy fallback
    "stainless_austenitic":  0.0034,  # legacy fallback
    "cast_iron_gray":        0.0055,
    "cast_iron_ductile":     0.005,
    "cast_iron_cgi":         0.0045,  # CGI: slightly lighter chip load than gray — more demanding on edges
    "cast_iron_malleable":   0.005,
    "titanium_cp":           0.004,
    "titanium_64":           0.0035,  # Ti 6Al-4V conventional est
    "titanium":              0.0035,
    "hiTemp_fe":             0.0034,  # A286 guide mid 0.0017 on 0.5" = 0.34%×D (was 0.003)
    "hiTemp_co":             0.0025,
    "monel_k500":            0.0041,  # K-500 guide 0.0016–0.0025, mid 0.00205 on 0.5" = 0.41%×D ✓
    "inconel_625":           0.0036,  # 625/C-276 guide mid 0.0018 on 0.5" = 0.36%×D ✓
    "inconel_718":           0.0032,  # 718 guide mid 0.0016 on 0.5" = 0.32%×D ✓
    "hastelloy_x":           0.0029,  # X/725/X-750/Nimonic C-263 avg guide mids = 0.29%×D
    "inconel_617":           0.0027,  # 617/Haynes 230: solid-solution, between hastelloy_x and waspaloy
    "waspaloy":              0.0024,  # Waspaloy/282/René41/77/80/Nimonic 80A/90: avg mid ~0.24%×D
    "mp35n":                 0.0022,  # MP35N/Udimet 720/René 95: midpoint 0.0011 on 0.5" = 0.22%×D
    "inconel":               0.003,   # legacy fallback
    "tool_steel_p20": 0.0050,  # P20 ~30 HRC: .0025 IPT on 0.5" → 0.50%×D confirmed
    "tool_steel_a2":  0.0044,  # A2: .0022 IPT on 0.5" → 0.44%×D confirmed
    "tool_steel_h13": 0.0040,  # H13: .0020 IPT on 0.5" → 0.40%×D confirmed
    "tool_steel_s7":  0.0044,  # S7: .0022 IPT on 0.5" → 0.44%×D confirmed
    "tool_steel_d2":  0.0032,  # D2: .0016 IPT on 0.5" → 0.32%×D confirmed (abrasive, conservative)
    "cpm_10v":        0.0030,  # CPM 10V: 0.30%×D — slightly below D2; can't go too light (rubbing on vanadium carbides accelerates wear)
    "hardened_lt55": 0.0045,  # H13/D2/A2 hardened 35–54 HRC: 0.0036/0.750" = 0.0048×D; conservative 0.0045 confirmed
    "hardened_gt55": 0.0012,  # ≥55 HRC — light chip load, avoid rubbing
    "armor_milspec": 0.0042,  # MIL-A-12560 structural armor — maintain chip load, never rub
    "armor_ar400":   0.0038,  # AR400 — chip load critical; underfeed = immediate edge failure
    "armor_ar500":   0.0030,  # AR500 — 0.002–0.004 IPT confirmed on 0.5" endmill (0.004–0.008×D)
    "armor_ar600":   0.0022,  # AR600 — minimum viable chip load; going lighter grinds the edge off
}

# HEM/trochoidal IPT boost per material group (applied on top of chip thinning).
# Calibrated: 304 SS HEM 1.2%×D adj at 7% WOC → 2.0×; Inconel 718 HEM 1.5%×D adj at 5% → 2.4×.
HEM_IPT_MULT = {
    "Aluminum": 2.0,
    "aluminum_wrought":    2.0,
    "aluminum_wrought_hs": 2.0,   # 7075/2024 — HEM strategy same as 6061
    "aluminum_cast": 2.0,
    "plastic_unfilled":  1.5,   # HEM uncommon for plastics — moderate boost only
    "plastic_filled":    1.4,   # Conservative; abrasion limits HEM chip load upside
    "composite_tpc":     1.3,   # Very conservative; composite laminates rarely run HEM
    "Steel": 2.0,
    "steel_mild": 2.0,
    "steel_alloy": 2.0,
    "steel_free": 2.0,
    "steel_tool": 2.0,
    "tool_steel_p20": 1.6,   # Tool steels — conservative HEM boost
    "tool_steel_a2":  1.5,
    "tool_steel_h13": 1.5,
    "tool_steel_s7":  1.5,
    "tool_steel_d2":  1.4,   # D2 — minimal HEM boost; abrasive/hard
    "cpm_10v":        1.4,   # CPM 10V — same as D2; vanadium carbide abrasion limits HEM chip load upside
    "Stainless": 2.0,
    "stainless_fm":          2.0,
    "stainless_ferritic":    2.0,
    "stainless_410":         2.0,
    "stainless_420":         1.8,   # 420 — slightly conservative
    "stainless_440c":        1.5,   # 440C — conservative HEM boost
    "stainless_304":         2.0,
    "stainless_316":         2.0,
    "stainless_ph":          1.8,   # PH — high strength, moderate HEM boost
    "stainless_duplex":      1.6,   # 2205 duplex — conservative; punishes weak engagement
    "stainless_superduplex": 1.4,   # 2507 super duplex — very conservative
    "stainless_martensitic": 2.0,   # legacy fallback
    "stainless_austenitic":  2.0,   # legacy fallback
    "Cast Iron": 1.5,
    "cast_iron_gray": 1.5,
    "cast_iron_ductile": 1.5,
    "cast_iron_cgi": 1.4,         # CGI: slightly conservative HEM boost vs gray
    "cast_iron_malleable": 1.5,
    "Titanium": 2.0,
    "titanium_64": 2.0,
    "titanium_cp": 2.0,
    "titanium": 2.0,
    "Inconel": 2.4,
    "monel_k500":  2.2,   # Monel — friendliest; generous HEM boost
    "inconel_625": 1.8,   # 625/C-276 — HEM 1.5%×D adj at 3% WOC (110 SFM base × 2.0 = 220 HEM)
    "inconel_718": 1.8,   # 718 — HEM 1.5%×D adj at 3% WOC (110 SFM base × 2.0 = 220 HEM)
    "hastelloy_x": 2.0,   # X/725/X-750/Nimonic C-263 — mid-tier; moderate boost
    "inconel_617": 1.8,   # 617/Haynes 230 — solid-solution; same HEM boost tier as 718/625
    "waspaloy":    1.8,   # Waspaloy/282/René 41/77/80/Nimonic 80A/90 — conservative HEM boost
    "mp35n":       1.6,   # MP35N/Udimet 720/René 95 — very conservative; ultra-high-strength
    "inconel":     2.2,   # legacy fallback
    "hiTemp_fe":   2.0,
    "hiTemp_co":   2.0,
    "hardened_lt55": 1.4,
    "hardened_gt55": 1.3,
    "armor_milspec": 2.0,  # HEM is the preferred strategy — constant engagement reduces shock and heat
    "armor_ar400":   2.0,  # HEM strongly recommended for all armor grades
    "armor_ar500":   2.0,
    "armor_ar600":   1.8,  # AR600 — slightly conservative HEM boost; tool life is already very short
}

# Edge radius proxy (inches) → for minimum chip thickness model
EDGE_RADIUS = {
    "Aluminum": 0.0003,
    "Non-Ferrous": 0.0003,
    "Plastics": 0.00025,
    "Steel": 0.0004,
    "Stainless": 0.00045,
    "Cast Iron": 0.0004,
    "Inconel": 0.0005,
    "Titanium": 0.00045
}


# ================================
# MATERIAL GROUPING
# ================================
_ISO_KEY_TO_GROUP = {
    "aluminum_wrought":    "Aluminum",
    "aluminum_wrought_hs": "Aluminum",
    "aluminum_cast": "Aluminum",
    "plastic_unfilled":  "Plastics",
    "plastic_filled":    "Plastics",
    "composite_tpc":     "Plastics",
    "non_ferrous": "Non-Ferrous",
    "steel_mild": "Steel",
    "steel_free": "Steel",
    "steel_alloy": "Steel",
    "steel_tool": "Steel",
    "stainless_fm":          "Stainless",
    "stainless_ferritic":    "Stainless",
    "stainless_410":         "Stainless",
    "stainless_420":         "Stainless",
    "stainless_440c":        "Stainless",
    "stainless_304":         "Stainless",
    "stainless_316":         "Stainless",
    "stainless_ph":          "Stainless",
    "stainless_duplex":      "Stainless",
    "stainless_superduplex": "Stainless",
    "stainless_martensitic": "Stainless",   # legacy fallback
    "stainless_austenitic":  "Stainless",   # legacy fallback
    "cast_iron_gray":        "Cast Iron",
    "cast_iron_ductile":     "Cast Iron",
    "cast_iron_cgi":         "Cast Iron",
    "cast_iron_malleable":   "Cast Iron",
    "titanium_cp":           "Titanium",
    "titanium_64":           "Titanium",
    "titanium":              "Titanium",
    "hiTemp_fe":             "Inconel",
    "hiTemp_co":             "Inconel",
    "monel_k500":            "Inconel",
    "inconel_625":           "Inconel",
    "inconel_718":           "Inconel",
    "hastelloy_x":           "Inconel",
    "inconel_617":           "Inconel",
    "waspaloy":              "Inconel",
    "mp35n":                 "Inconel",
    "inconel":               "Inconel",   # legacy fallback
    "tool_steel_p20": "Steel",
    "tool_steel_a2":  "Steel",
    "tool_steel_h13": "Steel",
    "tool_steel_s7":  "Steel",
    "tool_steel_d2":  "Steel",
    "cpm_10v":        "Steel",
    "hardened_lt55": "Steel",
    "hardened_gt55": "Steel",
    "armor_milspec": "Steel",
    "armor_ar400":   "Steel",
    "armor_ar500":   "Steel",
    "armor_ar600":   "Steel",
}

def get_material_group(mat):
    if mat in _ISO_KEY_TO_GROUP:
        return _ISO_KEY_TO_GROUP[mat]
    # Legacy substring fallback
    m = mat.upper()
    if "AL" in m: return "Aluminum"
    if "PLASTIC" in m: return "Plastics"
    if "BRASS" in m or "COPPER" in m: return "Non-Ferrous"
    if "STAIN" in m: return "Stainless"
    if "CAST" in m: return "Cast Iron"
    if "INCONEL" in m: return "Inconel"
    if "TITANIUM" in m or "TI" in m: return "Titanium"
    return "Steel"


# ================================
# HARDNESS HELPERS
# ================================
def hrb_to_hrc(hrb: float) -> float:
    """Convert Rockwell B to Rockwell C (ASTM E140 approximation).
    Valid for HRB 80–100 (below 80 is too soft to have meaningful HRC).
    """
    hrb = float(hrb)
    if hrb <= 0:
        return 0.0
    # Piecewise linear fit to ASTM E140 table
    if hrb >= 100: return 21.0
    if hrb >= 95:  return 15.0 + (hrb - 95) * (21.0 - 15.0) / 5.0
    if hrb >= 90:  return 10.0 + (hrb - 90) * (15.0 - 10.0) / 5.0
    if hrb >= 85:  return  5.0 + (hrb - 85) * (10.0 -  5.0) / 5.0
    if hrb >= 80:  return  0.0 + (hrb - 80) * ( 5.0 -  0.0) / 5.0
    return 0.0


def hardness_sfm_mult(hrc: float) -> float:
    """SFM multiplier based on HRC. Soft material (≤20 HRC) = 1.0 baseline."""
    hrc = float(hrc)
    if hrc <= 0:  return 1.00   # not specified — no adjustment
    if hrc <= 20: return 1.00
    if hrc <= 30: return 1.00 - 0.010 * (hrc - 20)   # 1.00 → 0.90
    if hrc <= 40: return 0.90  - 0.020 * (hrc - 30)   # 0.90 → 0.70
    if hrc <= 50: return 0.70  - 0.020 * (hrc - 40)   # 0.70 → 0.50
    if hrc <= 55: return 0.50  - 0.030 * (hrc - 50)   # 0.50 → 0.35
    return max(0.20, 0.35 - 0.030 * (hrc - 55))        # 0.35 → 0.20 at 65 HRC


def hardness_kc_mult(hrc: float) -> float:
    """Kc (specific cutting force) multiplier based on HRC."""
    hrc = float(hrc)
    if hrc <= 0:  return 1.00
    if hrc <= 20: return 1.00
    if hrc <= 30: return 1.00 + 0.005 * (hrc - 20)    # 1.00 → 1.05
    if hrc <= 40: return 1.05 + 0.015 * (hrc - 30)    # 1.05 → 1.20
    if hrc <= 50: return 1.20 + 0.025 * (hrc - 40)    # 1.20 → 1.45
    if hrc <= 55: return 1.45 + 0.030 * (hrc - 50)    # 1.45 → 1.60
    return min(2.00, 1.60 + 0.040 * (hrc - 55))        # 1.60 → 2.00 at 65 HRC

    # ================================
    # CHIP THINNING
    # ================================
    from engine.physics import chip_thinning_factor

    # ================================
    # ENGAGEMENT ANGLE
    # ================================

    # ================================
    # MINIMUM CHIP MODEL
    # ================================

    from engine.physics import chip_thinning_factor, minimum_chip_thickness


# ================================
# FORCE MODEL
# ================================

# ================================
# DEFLECTION
# ================================


# ================================
# TOOL LIFE
# ================================



# ================================
# RIGIDITY
# ================================
def rigidity_factor(data):
    r = TOOLHOLDER_RIGIDITY.get(data.get("toolholder", "er_collet"), 1.0)
    if data.get("dual_contact", False):
        r *= 1.08
    # HSK interfaces are inherently stiffer
    taper = data.get("spindle_taper", "CAT40")
    if taper and taper.startswith("HSK"):
        r *= 1.05
    return r

def hem_target_woc_pct(data, material_group, flutes):
    if "hem_target_woc_pct" in data and data["hem_target_woc_pct"] is not None:
        try:
            return float(data["hem_target_woc_pct"])
        except Exception:
            pass

    # Inconel HEM: shop-validated at 2–3% WOC using 5+ flute variable-pitch tools.
    # Other HRSA/Stainless use a more conservative 8% starting point.
    if material_group == "Inconel":
        base = 3.0
    elif material_group in ("Titanium", "Stainless"):
        base = 8.0
    else:
        base = 12.0

    if flutes >= 6:
        base += 2.0
    elif flutes <= 4:
        base -= 2.0

    D = float(data.get("diameter", 0.0) or 0.0)
    L = float(data.get("stickout", 0.0) or 0.0)
    if D > 0:
        ld = L / D
        if ld >= 6.0:
            base -= 4.0
        elif ld >= 4.0:
            base -= 2.0

    _min_woc = 2.0 if material_group == "Inconel" else 4.0
    return max(_min_woc, min(18.0, base))
    
# ============================================================
# HEM OPTIMIZER REPORTING (strategy-only; NO physics changes)
# Drop-in block for legacy_engine.py
# ============================================================

def hem_report_init(data):
    """Call once per run(). Stores optimizer diagnostics in data['_hem_report']."""
    data["_hem_report"] = {
        "attempts": 0,
        "rejections": {
            "deflection-limited": 0,
            "force-limited": 0,
             "chip-thinning / rubbing limited": 0,
            "  - rub_ratio<1.20": 0,
            "  - chip<=1.05*hmin": 0,
        },
        "chosen": None,   # dict snapshot of chosen point
        "why": None,      # human line
        "notes": [],
    }

def hem_report_reject(data, reason):
    """Increment a standardized rejection reason."""
    rep = data.get("_hem_report")
    if not rep:
        return
    if reason not in rep["rejections"]:
        # keep unknown reasons from crashing, but don't spam
        rep["rejections"][reason] = rep["rejections"].get(reason, 0) + 1
    else:
        rep["rejections"][reason] += 1

def hem_report_choose(data, state, why_line):
    """Record final chosen point + why."""
    rep = data.get("_hem_report")
    if not rep:
        return
    # keep it compact and robust if keys are missing
    rep["chosen"] = {
        "doc": float(state.get("doc", 0.0) or 0.0),
        "woc": float(state.get("woc", 0.0) or 0.0),
        "ipt": float(state.get("ipt", 0.0) or 0.0),
        "mrr": float(state.get("mrr", 0.0) or 0.0),
        "deflection": float(state.get("deflection", 0.0) or 0.0),
        "force": float(state.get("force", 0.0) or 0.0),
        "rub_ratio": float(state.get("rub_ratio", 0.0) or 0.0),
        "chip": float(state.get("chip", 0.0) or 0.0),
        "hmin": float(state.get("hmin", 0.0) or 0.0),
    }
    rep["why"] = str(why_line or "").strip()

def hem_axial_bias_score(doc, woc, diameter):
    """
    Higher is 'more axial-biased'. Used only if you allow balanced roughing.
    Returns a dimensionless score; safe for woc=0.
    """
    D = float(diameter or 0.0)
    d = float(doc or 0.0)
    w = float(woc or 0.0)
    if D <= 0:
        return 0.0
    # normalize by D so it doesn't depend on inches vs mm
    doc_xd = d / D
    woc_xd = w / D
    # bias: reward doc, penalize woc; keep finite
    return doc_xd / max(1e-9, woc_xd)

def hem_print_report(data, state):
    """Prints HEM optimizer reporting lines (safe if not run / no report)."""
    mode = (data.get("mode") or "").lower()
    if mode != "hem":
        return

    rep = data.get("_hem_report") or {}
    chosen = rep.get("chosen")
    why = rep.get("why") or ""

    # --- Axial bias ratio (DOC:WOC) ---
    doc = float(state.get("doc", 0.0) or 0.0)
    woc = float(state.get("woc", 0.0) or 0.0)
    if woc > 0:
        ratio = doc / woc
        ratio_str = f"{ratio:.2f}:1"
    else:
        ratio_str = "∞ (WOC≈0)"

    # --- Force headroom ---
    force = float(state.get("force", 0.0) or 0.0)
    force_limit = float(data.get("force_limit", 1e9) or 1e9)
    force_limited_enabled = (force_limit < 1e8)

    if force_limited_enabled and force_limit > 0:
        headroom = max(0.0, (force_limit - force) / force_limit) * 100.0
        headroom_str = f"{headroom:.1f}%"
    else:
        headroom_str = "N/A (no cap)"
        
    debug = bool(data.get("debug", False))

    if debug:
        print("\n— HEM Optimizer Reporting —")
        print(f"Axial bias (DOC:WOC): {ratio_str}")
        print(f"Force headroom vs limit: {headroom_str}")

        # Deflection headroom vs limit
        defl = float(state.get("deflection", 0.0) or 0.0)
        defl_limit = float(data.get("deflection_limit", 0.001) or 0.001)

        if defl_limit > 0:
            defl_headroom = max(0.0, (defl_limit - defl) / defl_limit) * 100.0
        else:
            defl_headroom = 0.0

        print(f"Deflection headroom vs limit: {defl_headroom:.1f}%")

        # Rub headroom vs threshold
        rub = float(state.get("rub_ratio", 0.0) or 0.0)
        rub_min = float(data.get("hem_rub_min", 1.20) or 1.20)
        print(f"Rub headroom vs threshold: {rub - rub_min:+.2f}")

    # --- Rejection reasons summary ---
    rej = rep.get("rejections") or {}
    # only show the three requested labels (even if missing)
    dcnt = int(rej.get("deflection-limited", 0) or 0)
    fcnt = int(rej.get("force-limited", 0) or 0)
    ccnt = int(rej.get("chip-thinning / rubbing limited", 0) or 0)

    if debug:
        print("Rejection reasons:")
        print(f"  • deflection-limited: {dcnt}")
        print(f"  • force-limited: {fcnt}")
        print(f"  • chip-thinning / rubbing limited: {ccnt}")

    # --- Why chosen line ---
    if debug:
        if why:
            print(f"Why this point was chosen: {why}")
        elif chosen:
            print("Why this point was chosen: best MRR under active limits (no explicit why string set).")
        else:
            print("Why this point was chosen: optimizer did not run (or no diagnostic capture).")

def hem_gate_enabled(data, auto_doc_woc):
    """
    Central gate: only print HEM report when in HEM mode AND the HEM optimizer path is active.
    """
    mode = (data.get("mode") or "").lower()
    return (mode == "hem") and bool(auto_doc_woc)

def hem_allow_balanced(data):
    """
    Toggle to allow 'balanced roughing' competition.
    Default False (axial-bias only).
    """
    return bool(data.get("hem_allow_balanced", False))


# ============================================================
# (Optional) instrumented chooser helper for grid search
# Use inside your HEM grid loop if/when auto_doc_woc == True.
# ============================================================
def hem_consider_candidate(data, best_any, best_force, candidate_state, diameter, defl_limit, force_limit):
    """
    Updates best_any and best_force given a candidate_state, while recording rejections.
    Returns (best_any, best_force).
    """
    if data.get("_hem_dbg_once", False) is False:
        print("DEBUG: hem_consider_candidate is being called")
        data["_hem_dbg_once"] = True
    # Extract
    defl  = float(candidate_state.get("deflection", 1e9) or 1e9)
    force = float(candidate_state.get("force", 1e9) or 1e9)
    mrr   = float(candidate_state.get("mrr", 0.0) or 0.0)

    # Chip/rubbing gate (requested label)
    # --- CHIP / RUB GATE (repair first, then reject) ---
    rub = float(candidate_state.get("rub_ratio", 0.0) or 0.0)
    hmin = float(candidate_state.get("hmin", 0.0) or 0.0)
    chip = float(candidate_state.get("chip", 0.0) or 0.0)

    if hmin > 0 and (rub > 0 and rub < 1.20):
        target_rub = 1.20

        ipt_now = float(candidate_state.get("ipt", 0.0) or 0.0)
        ipt_repair = ipt_now * (target_rub / max(rub, 1e-6))
        ipt_repair = min(ipt_repair, ipt_now * 1.35)

        repaired = calc_state(
            rpm, flutes, ipt_repair,
            float(candidate_state.get("doc", 0.0) or 0.0),
            float(candidate_state.get("woc", 0.0) or 0.0),
            data, material_group, rigidity
        )

        rub2 = float(repaired.get("rub_ratio", 0.0) or 0.0)

        if rub2 >= target_rub:
            candidate_state = repaired
            rub = rub2
            chip = float(candidate_state.get("chip", 0.0) or 0.0)
        else:
            hem_report_reject(data, "chip-thinning / rubbing limited")
            return best_any, best_force

    # optional hard reject if still pinned at hmin
    if hmin > 0 and (chip <= 1.05 * hmin):
        hem_report_reject(data, "chip-thinning / rubbing limited")
        return best_any, best_force

    # Deflection gate
    if defl > defl_limit:
        hem_report_reject(data, "deflection-limited")
        return best_any, best_force

    # Track best under deflection only
    if (best_any is None) or (mrr > float(best_any.get("mrr", -1.0) or -1.0)):
        best_any = {
            "mrr": mrr,
            "doc": float(candidate_state.get("doc", 0.0) or 0.0),
            "woc": float(candidate_state.get("woc", 0.0) or 0.0),
            "defl": defl,
            "force": force,
            "ipt": float(candidate_state.get("ipt", 0.0) or 0.0),
        }

    # Force gate / tracking best under BOTH
    force_enabled = (force_limit < 1e8) and (force_limit > 0)
    if force_enabled and force > force_limit:
        hem_report_reject(data, "force-limited")
        return best_any, best_force

    # If force not enabled, treat as pass-through
    if (best_force is None) or (mrr > float(best_force.get("mrr", -1.0) or -1.0)):
        best_force = {
            "mrr": mrr,
            "doc": float(candidate_state.get("doc", 0.0) or 0.0),
            "woc": float(candidate_state.get("woc", 0.0) or 0.0),
            "defl": defl,
            "force": force,
            "ipt": float(candidate_state.get("ipt", 0.0) or 0.0),
        }

    return best_any, best_force
        
# ================================
# STATE CALC
# ================================
def calc_state(rpm, flutes, ipt, doc, woc, data, material_group, rigidity):
    feed = rpm * flutes * ipt
    mrr = feed * doc * woc
    _mat_key = data.get("material", material_group)
    _geom_hp = GEOMETRY_KC_FACTOR.get(str(data.get("geometry", "standard") or "standard").lower(), 1.0)
    _hrc_cs = float(data.get("hardness_hrc", 0) or 0)
    hp = mrr * HP_PER_CUIN.get(_mat_key, HP_PER_CUIN.get(material_group, 1.0)) * _geom_hp * hardness_kc_mult(_hrc_cs)
    load = hp / data["machine_hp"]

    if data.get("debug_ball", False):
        print("DEBUG tool_type:", data.get("tool_type"))
    
    angle = engagement_angle(woc, data["diameter"])
    # Use actual fractional teeth in cut — do NOT clamp to 1.
    # At 5% WOC with 5 flutes only 0.36 teeth are in cut; max(1,...) was over-predicting
    # force by 2.8× and producing false chatter warnings on HEM/light-WOC passes.
    teeth = max(0.1, (angle / (2 * math.pi)) * flutes)

        # --- Effective diameter for chip thickness (ballnose only) ---
    tool_type = str(data.get("tool_type", "")).lower()
    mode = str(data.get("mode", "")).lower()
    is_ball = (tool_type == "ballnose" or mode == "ballnose")

    D = float(data["diameter"])          # ALWAYS define D
    diam_eff = D                         # default for non-ball tools
    # woc arrives in inches; convert to % for chip-thickness functions
    _woc_pct = (woc / D * 100.0) if D > 0 else data.get("woc_pct", 10.0)

    r_c = None                           # only meaningful for ball
    if is_ball:
        R = D / 2.0
        w = float(woc)

            # Contact radius from stepover on a ball: r_c = sqrt(2*R*w - w^2)
        if w <= 0.0:
                r_c = 0.0
        else:
            r_c = max(0.0, (2.0 * R * w - w * w) ** 0.5)

            # Clamp to sane bounds, avoid 0
        diam_eff = max(0.05 * D, min(D, 2.0 * r_c))

        # ---- Cutting force input ----
        h_eff = effective_chip_thickness(data, material_group, ipt, woc, diam_eff, doc)

    # ---- Cutting force (must scale with DOC) ----
    h_eff = effective_chip_thickness(data, material_group, ipt, woc, diam_eff, doc)

    # Ballnose center-contact ratio (geometry advisory input)
    center_contact_ratio = None
    if is_ball:
        D_true = float(data["diameter"])
        D_eff = float(diam_eff)
        center_contact_ratio = (D_eff / D_true) if D_true > 0 else 0.0
      # Ball-aware minimum chip thickness threshold (strategy-level check)
    min_chip = float(data.get("min_chip", 0.0) or 0.0)

    if is_ball and min_chip > 0:
        D_true = float(data["diameter"])
        D_eff  = float(diam_eff)
        D_eff  = max(0.05 * D_true, min(D_true, D_eff))
        min_chip *= (D_true / D_eff)

    if data.get("debug_ball", False):
        print(f"DEBUG h_eff: ipt={ipt:.6f} doc={doc:.6f} woc={woc:.6f} h_eff={h_eff:.6f}")
        
    force_per_tooth_per_in_axial = cutting_force_per_tooth(
        data.get("material", material_group),
        h_eff,
        data.get("helix", 35),
        data.get("hardness_hrc", 0),
        data.get("radial_rake", 7),
    )

    # Scale with axial engagement (DOC)
    force_tooth = force_per_tooth_per_in_axial * doc

    # Active teeth already computed in your model (or use teeth_engaged)
    total_force = force_tooth * teeth

    # Chipbreaker / truncated rougher geometry reduces effective cutting force
    _geom = str(data.get("geometry", "standard") or "standard").lower()
    total_force *= GEOMETRY_KC_FACTOR.get(_geom, 1.0)

    # Corner radius increases arc engagement → small force/torque penalty
    # Ball nose similarly has a distributed contact arc
    _cc = (data.get("corner_condition") or "square").lower()
    if _cc == "corner_radius":
        _cr  = float(data.get("corner_radius") or 0.0)
        _D   = float(data.get("diameter", 0.5) or 0.5)
        _cr_ratio = (_cr / _D) if _D > 0 else 0.0
        total_force *= (1.0 + min(0.15, _cr_ratio * 0.70))
    elif _cc == "ball":
        total_force *= 1.08   # full-radius arc → ~8% more radial engagement force

    if data.get("debug_calc_state", False) and data.get("debug", False):
        print("DEBUG calc_state inputs doc/woc:", doc, woc)
        print("DEBUG calc_state force:", total_force)
    
    # Convert tangential cutting force to radial force for deflection.
    # Peaks at ~50% WOC (all forces in one direction) then tapers for heavier engagement.
    # At full slot (100% WOC) forces are symmetric — cutting on both sides of the tool
    # partially cancels the net lateral deflecting force, so radial_frac drops back to 0.15.
    _woc_pct_force = float(data.get("woc_pct", 50) or 50)
    if _woc_pct_force <= 50.0:
        _radial_frac = max(0.15, min(0.35, 0.15 + 0.40 * (_woc_pct_force / 100.0)))
    else:
        # Symmetric engagement: taper from 0.35 at 50% WOC to 0.15 at 100% WOC
        _radial_frac = max(0.15, 0.35 - 0.20 * ((_woc_pct_force - 50.0) / 50.0))
    radial_force = total_force * _radial_frac

    deflection = tool_deflection(
        radial_force,
        data["stickout"],
        data["diameter"],
        flutes,
        data.get("loc"),
        data.get("lbs"),
        data.get("neck_dia"),
        data.get("holder_gage_length"),
        data.get("holder_nose_dia"),
        data.get("core_ratio"),
    )
    # Rigidity factor reduces deflection — stiffer holder/interface = less tip movement
    deflection /= rigidity
    _wh_factor = WORKHOLDING_COMPLIANCE.get(data.get("workholding", "vise"), 1.0)
    # Slotting (100% WOC) has interrupted cut with force reversals — 2× chatter multiplier
    _slot_mult = 2.0 if float(data.get("woc_pct", 0) or 0) >= 99.0 else 1.0
    chatter = deflection * rpm / 10000 * _wh_factor * _slot_mult

    chip = h_eff
    hmin = minimum_chip_thickness(material_group)
    rub_ratio = chip / hmin

    return {
        "feed": feed,
        "mrr": mrr,
        "hp": hp,
        "load": load,
        "force": total_force,
        "deflection": deflection,
        "chatter": chatter,
        "chip": chip,
        "hmin": hmin,
        "rub_ratio": rub_ratio,
        "center_contact_ratio": center_contact_ratio,
        "woc": woc,
        "doc": doc,
        "ipt": ipt,
        "flutes": flutes,
        "teeth_in_cut": round(teeth, 2),
    }


# ================================
# AUTO MRR OPTIMIZER + MIN CHIP
# ================================
def optimize_mrr(data, rpm, flutes, ipt, doc, woc, material_group, rigidity):
    target_load = 0.65
    chip_factor = chip_thinning_factor(data["woc_pct"], data["diameter"])
    best = None

    # Cap how far the optimizer can push IPT above the material baseline.
    # Hardened steels have low HP utilisation but cannot take aggressive chip loads.
    _hrc_opt = float(data.get("hardness_hrc", 0) or 0)
    if _hrc_opt > 40:
        _max_ipt_mult = 1.10   # hardened > 40 HRC: stay within 10% of baseline
    elif _hrc_opt > 25:
        _max_ipt_mult = 1.25   # semi-hard 25–40 HRC: allow modest boost
    elif material_group in ("hardened_lt55", "hardened_gt55", "steel_tool"):
        _max_ipt_mult = 1.20
    else:
        _max_ipt_mult = 2.0    # open materials: optimizer free to find best MRR
    _initial_ipt = ipt

    # Early exit: once chip is pinned at minimum, more IPT scaling won't change chip
    #_toggle=0
    for _ in range(14):

        state = calc_state(rpm, flutes, ipt, doc, woc, data, material_group, rigidity)
        
        # Early exit: once chip is pinned at minimum, more IPT scaling won't change chip
        chip = float(state.get("chip", 0.0) or 0.0)
        hmin = float(state.get("hmin", 0.0) or 0.0)

        if hmin > 0 and chip <= (hmin * 1.05):
            break

        # enforce minimum chip thickness
        if state["rub_ratio"] < 1.2:
            ipt *= 1.15
            ipt = min(ipt, _initial_ipt * _max_ipt_mult)
            continue

        # HEM Inconel override (FPT ≈ 1.5% dia allowed)
        if material_group == "Inconel" and data["mode"] == "hem":
            min_ipt = 0.015 * data["diameter"]
            if ipt < min_ipt:
                ipt = min_ipt
                continue

        if best is None or abs(state["load"] -
                               target_load) < abs(best["load"] - target_load):
            best = state

        if state["load"] < target_load:
            ipt *= 1.08
        else:
            ipt *= 0.92

        # Never exceed the material-appropriate cap
        ipt = min(ipt, _initial_ipt * _max_ipt_mult)

    return ipt, doc, woc, best

def hem_typical_woc_range_pct(material_group, flutes):
    # Returns (low_pct, high_pct) for messaging only

    if material_group in ("Inconel", "Titanium", "Stainless"):
        low = 6.0
        high = 10.0
    elif material_group in ("Aluminum", "Non-Ferrous", "Plastics"):
        low = 10.0
        high = 18.0
    else:  # Steel, Cast Iron, default
        low = 8.0
        high = 15.0

    # small flute adjustment
    if flutes >= 6:
        low += 1.0
        high += 1.0
    elif flutes <= 4:
        low -= 1.0
        high -= 1.0

    # clamp to safe bounds
    low = max(3.0, min(20.0, low))
    high = max(low + 1.0, min(25.0, high))

    return low, high

# ============================================================
# DRILLING ENGINE — Solid Carbide Drills
# ============================================================

# SFM for solid carbide drills (base — flood coolant, 135° point)
DRILL_SFM = {
    "aluminum_wrought": 400, "aluminum_wrought_hs": 320, "aluminum_cast": 350, "non_ferrous": 250,
    "plastic_unfilled": 150, "plastic_filled": 120, "composite_tpc": 280,
    "steel_mild": 140, "steel_free": 150, "steel_alloy": 100, "steel_tool": 70,
    "armor_milspec": 80, "armor_ar400": 50, "armor_ar500": 35, "armor_ar600": 18,
    # Base = flood external coolant, non-coolant-fed drill. coolant_fed × 1.15 bonus brings these up to through-coolant target.
    # stainless_304 validated: 60 SFM non-coolant-fed → 69 SFM coolant-fed ≈ 70 reference target.
    "stainless_304": 60, "stainless_316": 52,
    "stainless_410": 74, "stainless_420": 70, "stainless_440c": 57,
    "stainless_martensitic": 74, "stainless_fm": 87, "stainless_ferritic": 78,
    "stainless_ph": 52, "stainless_duplex": 48, "stainless_superduplex": 39,
    "stainless_austenitic": 57,
    "cast_iron_gray": 130, "cast_iron_ductile": 110, "cast_iron_cgi": 100, "cast_iron_malleable": 120,
    "titanium_cp": 60, "titanium_64": 45,
    "hiTemp_fe": 30, "hiTemp_co": 25,
    "inconel_625": 25, "inconel_718": 20,
    "monel_k500": 35, "hastelloy_x": 22, "inconel_617": 20, "waspaloy": 18, "mp35n": 15,
    "hardened_lt55": 50, "hardened_gt55": 30,
    "tool_steel_p20": 75, "tool_steel_a2": 60, "tool_steel_h13": 55,
    "tool_steel_s7": 60, "tool_steel_d2": 45, "cpm_10v": 30,
    # Legacy group fallbacks
    "Aluminum": 350, "Non-Ferrous": 250, "Steel": 100, "Stainless": 80,
    "Cast Iron": 120, "Titanium": 50, "Inconel": 25, "Plastics": 150,
}

# IPR base for 0.5" diameter solid carbide drill — scales with dia^0.6
DRILL_IPR_BASE = {
    "aluminum_wrought": 0.010, "aluminum_wrought_hs": 0.009, "aluminum_cast": 0.008, "non_ferrous": 0.007,
    "plastic_unfilled": 0.006, "plastic_filled": 0.005, "composite_tpc": 0.002,
    "steel_mild": 0.0055, "steel_free": 0.006, "steel_alloy": 0.004, "steel_tool": 0.003,
    "armor_milspec": 0.003, "armor_ar400": 0.002, "armor_ar500": 0.0015, "armor_ar600": 0.001,
    # Base = non-coolant-fed target. coolant_fed × 1.10 bonus in run_drilling() brings to through-coolant target.
    # stainless_304 validated: 0.0055 → 0.0046 non-coolant-fed ≈ 0.0045 ref; × 1.10 = 0.0050 coolant-fed ref.
    "stainless_304": 0.0055, "stainless_316": 0.0050,
    "stainless_410": 0.0062, "stainless_420": 0.0056, "stainless_440c": 0.0047,
    "stainless_martensitic": 0.0059, "stainless_fm": 0.0064, "stainless_ferritic": 0.0059,
    "stainless_ph": 0.0044, "stainless_duplex": 0.0047, "stainless_superduplex": 0.0040,
    "stainless_austenitic": 0.0050,
    "cast_iron_gray": 0.006, "cast_iron_ductile": 0.005, "cast_iron_cgi": 0.0048, "cast_iron_malleable": 0.005,
    "titanium_cp": 0.004, "titanium_64": 0.003,
    "hiTemp_fe": 0.002, "hiTemp_co": 0.0015,
    "inconel_625": 0.002, "inconel_718": 0.0015,
    "monel_k500": 0.0025, "hastelloy_x": 0.0018, "inconel_617": 0.0016, "waspaloy": 0.0015, "mp35n": 0.0013,
    "hardened_lt55": 0.002, "hardened_gt55": 0.001,
    "armor_milspec": 0.0018, "armor_ar400": 0.0015, "armor_ar500": 0.0012, "armor_ar600": 0.0008,
    "tool_steel_p20": 0.0035, "tool_steel_a2": 0.0028, "tool_steel_h13": 0.0025,
    "tool_steel_s7": 0.0028, "tool_steel_d2": 0.0022, "cpm_10v": 0.0018,
    # Legacy group fallbacks
    "Aluminum": 0.009, "Non-Ferrous": 0.007, "Steel": 0.004, "Stainless": 0.0042,
    "Cast Iron": 0.005, "Titanium": 0.003, "Inconel": 0.0015, "Plastics": 0.006,
}

# Point angle modifiers (SFM and IPR)
DRILL_POINT_ANGLE_FACTOR = {118: 1.00, 130: 1.06, 135: 1.10, 140: 1.13, 145: 1.15}

# Flute geometry SFM multiplier — med/high helix improve chip evacuation
DRILL_GEOMETRY_SFM = {"standard": 1.00, "med_helix": 1.10, "high_helix": 1.18}

# Coolant SFM multiplier
DRILL_COOLANT_SFM = {"dry": 0.70, "mist": 0.85, "flood": 1.00, "tsc_low": 1.20, "tsc_high": 1.30}


def run_chamfer_mill(payload: dict) -> dict:
    """Chamfer mill calc — CMS (center-cutting, point tip) and CMH (non-center, tip flat).
    D_eff = tip_dia + 2 * chamfer_depth * tan(included_angle / 2).
    RPM driven by D_eff. IPT uses lead-angle chip thinning: programmed_fpt = base_ipt / sin(half_angle).
    CMH series (flat tip) benefits significantly from this correction vs the old flat 0.55 factor.
    """
    material  = str(payload.get("material", "steel_alloy") or "steel_alloy")
    mat_group = get_material_group(material)
    _mat_key  = material

    flutes       = max(1, int(payload.get("flutes", 4) or 4))
    max_rpm      = int(float(payload.get("max_rpm", 12000) or 12000))
    rpm_util     = float(payload.get("rpm_util_pct", 0.95) or 0.95)

    chamfer_angle = float(payload.get("chamfer_angle", 90) or 90)   # included degrees
    tip_dia       = float(payload.get("chamfer_tip_dia", 0) or 0)
    chamfer_depth = float(payload.get("chamfer_depth", 0) or 0)
    body_dia      = float(payload.get("tool_dia", 0.5) or 0.5)      # max body diameter

    # Hardness
    _hv  = float(payload.get("hardness_value", 0) or 0)
    _hs  = str(payload.get("hardness_scale", "hrc") or "hrc").lower()
    _hrc = hrb_to_hrc(_hv) if _hs == "hrb" else _hv

    # SFM — same base as endmills; chamfering is still a peripheral cut
    base_sfm = BASE_SFM.get(_mat_key, BASE_SFM.get(mat_group, 300))
    sfm_target = base_sfm * hardness_sfm_mult(_hrc)

    # D_eff at the outer edge of the chamfer
    half_angle_rad = math.radians(chamfer_angle / 2.0)
    if chamfer_depth > 0:
        d_eff = tip_dia + 2.0 * chamfer_depth * math.tan(half_angle_rad)
    else:
        # No depth — show RPM at a nominal 0.010" depth so the field isn't useless
        d_eff = tip_dia + 2.0 * 0.010 * math.tan(half_angle_rad)
    d_eff = max(0.005, min(d_eff, body_dia))

    # RPM — cap at max_rpm × rpm_util (same logic as milling path)
    target_rpm = (sfm_target * 12.0) / (math.pi * d_eff)
    rpm = min(target_rpm, float(max_rpm) * rpm_util)
    rpm = max(1.0, rpm)
    sfm_actual = (rpm * math.pi * d_eff) / 12.0

    # IPT — lead angle chip thinning for chamfer mills
    # Scale chip load to body_dia (manufacturer rates the tool at full body diameter).
    # D_eff only drives RPM — it is NOT the correct diameter for chip load scaling.
    # Lead angle CTF: programmed_fpt = target_chip / sin(half_angle).
    #   60° chamfer (30° half): ×2.00   90° (45°): ×1.41   120° (60°): ×1.15
    # Capped at 2.0× to prevent unrealistic feeds at very shallow included angles.
    ipt_frac = IPT_FRAC.get(_mat_key, IPT_FRAC.get(mat_group, 0.005))
    lead_ctf = min(2.0, 1.0 / max(0.10, math.sin(half_angle_rad)))

    chamfer_series = str(payload.get("chamfer_series", "CMH")).upper()
    is_cmh = chamfer_series == "CMH"

    # CMH: shear angle on the flank → lower force, higher SFM ceiling, needs aggressive chip load
    # CMS: straight flute, center-cutting → 65% of CMH chip load, no SFM boost
    if is_cmh:
        sfm_target = sfm_target * CMH_SFM_MULT   # shear angle allows higher SFM
        series_mult = 1.0
    else:
        series_mult = 0.65

    # Recalculate RPM with CMH-adjusted SFM target
    target_rpm = (sfm_target * 12.0) / (math.pi * d_eff)
    rpm = min(target_rpm, float(max_rpm) * rpm_util)
    rpm = max(1.0, rpm)
    sfm_actual = (rpm * math.pi * d_eff) / 12.0

    ipt = ipt_frac * body_dia * lead_ctf * series_mult

    # CMH minimum chip load — tip flat rubs below this threshold
    cmh_min_ipt = ipt_frac * body_dia * CMH_MIN_CHIP_FRAC * lead_ctf if is_cmh else 0.0

    feed_ipm = rpm * ipt * flutes

    # HP estimate — chamfer geometry is triangular, not rectangular.
    # WOC grows with depth: actual_woc = depth × tan(half_angle) = (D_eff - tip_dia) / 2
    # Cross-section removed is a triangle → MRR = 0.5 × woc × depth × feed
    # (was incorrectly using fixed 5% of D_eff — badly understated load at real depths)
    _depth_for_hp = chamfer_depth if chamfer_depth > 0 else 0.010
    _actual_woc   = _depth_for_hp * math.tan(half_angle_rad)          # radial reach at this depth
    _woc_as_pct   = _actual_woc / max(0.001, d_eff)                   # fraction of D_eff engaged
    mrr_equiv     = feed_ipm * _depth_for_hp * _actual_woc * 0.5      # 0.5 = triangular cross-section
    _hp_unit      = HP_PER_CUIN.get(_mat_key, HP_PER_CUIN.get(mat_group, 1.0))
    hp_required   = max(0.01, mrr_equiv * _hp_unit * hardness_kc_mult(_hrc))

    # Machine HP
    _spindle_drive = str(payload.get("spindle_drive", "belt") or "belt").lower()
    _drive_eff     = SPINDLE_DRIVE_EFF.get(_spindle_drive, 0.92)
    machine_hp     = float(payload.get("machine_hp", 10.0) or 10.0) * _drive_eff

    # ── Flute count validation & chip room depth scaling ──────────────────────
    # Standard Core Cutter flute counts by series:
    #   CMS: 2-flute (max chip room, deepest cuts) or 4-flute (better finish, shallower limit)
    #   CMH: 3-flute (good chip room, deep capable) or 5-flute (finish quality, shallower limit)
    # More chip gullet volume at lower flute count = better evacuation as WOC grows with depth.
    CHAMFER_SERIES_FLUTES = {"CMS": [2, 4], "CMH": [3, 5]}
    _std_flutes = CHAMFER_SERIES_FLUTES.get(chamfer_series, [])
    _flute_nonstandard = _std_flutes and flutes not in _std_flutes

    # Chip room depth multiplier: fewer flutes → bigger gullets → deeper single pass
    # 2-fl: 1.35×, 3-fl: 1.15×, 4-fl: 1.00× (baseline), 5-fl: 0.85×
    _chip_room_mult = {2: 1.35, 3: 1.15, 4: 1.00, 5: 0.85}.get(flutes, 1.00)

    # ── Multi-pass strategy ────────────────────────────────────────────────────
    # Chamfer WOC grows with depth (50% engagement for CMS at any depth) — aggressive
    # single-pass cuts degrade finish and tool life as material removal grows quadratically.
    # Base max safe single-pass depth: 15% of body dia (10% for hard materials),
    # scaled by chip room multiplier from flute count.
    _hard_mat = mat_group in ("Stainless", "Inconel", "Titanium", "Hardened")
    _max_rough_depth = body_dia * (0.10 if _hard_mat else 0.15) * _chip_room_mult
    _finish_allow    = 0.015 if _hard_mat else 0.010
    notes = []
    multi_pass = None
    if chamfer_depth > 0:
        if chamfer_depth <= _max_rough_depth + _finish_allow:
            # Single pass — shallow enough
            multi_pass = {
                "num_passes":           1,
                "depth_per_pass_in":    round(chamfer_depth, 4),
                "finish_depth_in":      round(chamfer_depth, 4),
                "rough_depth_per_pass": None,
                "num_rough_passes":     0,
                "finish_allowance_in":  0.0,
                "single_pass_ok":       True,
            }
        else:
            _rough_total    = chamfer_depth - _finish_allow
            _num_rough      = max(1, math.ceil(_rough_total / _max_rough_depth))
            _depth_per_rough = round(_rough_total / _num_rough, 4)
            multi_pass = {
                "num_passes":           _num_rough + 1,
                "depth_per_pass_in":    _depth_per_rough,
                "finish_depth_in":      round(chamfer_depth, 4),
                "rough_depth_per_pass": _depth_per_rough,
                "num_rough_passes":     _num_rough,
                "finish_allowance_in":  round(_finish_allow, 4),
                "single_pass_ok":       False,
            }
            notes.append(
                f"Multi-pass recommended: {_num_rough} roughing pass{'es' if _num_rough > 1 else ''} "
                f"of {_depth_per_rough:.4f}\" each, then 1 finish pass to {chamfer_depth:.4f}\" full depth "
                f"({_finish_allow:.3f}\" finish allowance). "
                f"WOC is {_woc_as_pct*100:.0f}% of D_eff — force scales with depth, single-pass risks poor finish."
            )

    # Tool life — light engagement means chamfer mills outlast endmills significantly
    # Use same base life as endmills × 1.5 bonus for shallow radial engagement
    _base_life = BASE_LIFE_MIN.get(_mat_key, BASE_LIFE_MIN.get(mat_group, 60.0)) * 1.5
    _sfm_ratio = sfm_actual / max(1.0, sfm_target)
    _coolant = str(payload.get("coolant", "flood") or "flood").lower()
    _coolant_factor = COOLANT_LIFE.get(_coolant, 1.0) * _coolant_fluid_mult(payload)
    tool_life_min = (_base_life / max(0.20, _sfm_ratio ** 0.40)) * _coolant_factor

    if chamfer_depth <= 0:
        notes.append(
            f"No chamfer depth entered — RPM based on nominal 0.010\" depth. "
            f"Enter actual chamfer depth for accurate D_eff and feed rate."
        )
    if d_eff >= body_dia * 0.95:
        notes.append(
            f"Chamfer depth creates D_eff ({d_eff:.4f}\") near body diameter ({body_dia:.4f}\"). "
            f"Verify depth doesn't exceed tool geometry."
        )
    if _flute_nonstandard:
        notes.append(
            f"{chamfer_series} series is standard in {_std_flutes[0]}- and {_std_flutes[1]}-flute. "
            f"Entered {flutes} flutes — verify this is a special/custom configuration."
        )
    if is_cmh and ipt < cmh_min_ipt:
        notes.append(
            f"⚠ Chip load ({ipt:.5f}\") is below CMH minimum ({cmh_min_ipt:.5f}\"). "
            f"The tip flat will rub rather than cut — increase feed or chamfer depth."
        )

    # Contextual tips
    tips = []
    _coolant_str = str(payload.get("coolant", "flood") or "flood").lower()
    # Toolpath tip — always shown, most impactful
    tips.append(
        "Circular interpolation (G02/G03 helical entry) produces a far better finish than a straight plunge — "
        "it distributes wear evenly around the full cutting edge and avoids the dwell mark a straight plunge leaves at the bottom."
    )
    if _coolant_str in ("dry", "mist"):
        tips.append("Flood or TSC coolant significantly extends chamfer mill life — heat builds quickly at the tip flat on CMH series even at low forces.")
    if mat_group in ("Stainless", "Inconel", "Titanium"):
        tips.append("Climb milling only in this material — conventional cut direction work-hardens the entry edge and shortens tool life.")
    # Growing WOC tip — always shown when depth is entered, core chamfer physics
    if chamfer_depth > 0:
        tips.append(
            f"WOC grows with depth: at {chamfer_depth:.4f}\" depth, radial engagement is "
            f"{_actual_woc:.4f}\" ({_woc_as_pct*100:.0f}% of D_eff). "
            f"{'CMS point tools always run ~50% WOC (slot-equivalent) — do not treat as a light finishing cut.' if not is_cmh and tip_dia < 0.001 else 'Engagement and cutting force increase proportionally as you go deeper — program your final depth pass separately from roughing passes.'}"
        )
    if chamfer_depth > 0 and chamfer_depth / body_dia > 0.25:
        tips.append("Deep chamfer: consider two lighter axial passes for better edge finish and longer tool life.")
    if flutes <= 2:
        tips.append("More flutes (4–6) improve finish quality on chamfer mills — light chip load per tooth reduces edge burnishing.")
    tips.append("Keep chip load per tooth consistent — verify actual SFM at D_eff matches target before adjusting feed.")
    # Saddling tip — always shown: position chamfer in middle of cutting edge, not at extremes
    _saddle_pct  = 80 if is_cmh else 60
    _saddle_excl = (100 - _saddle_pct) // 2
    tips.append(
        f"Saddle the tool: position your chamfer so it engages the middle {_saddle_pct}% of the cutting edge length (L2), "
        f"staying clear of the bottom {_saddle_excl}% near the tip and the top {_saddle_excl}% near the shoulder. "
        f"{'CMH tip flat is robust enough for 10% exclusion at each end.' if is_cmh else 'CMS point tip is fragile — keep a 20% exclusion zone at the tip to avoid chipping.'} "
        f"If your chamfer is shallow relative to L2, shift Z up so contact lands in that center band."
    )
    # Z-oscillation tip — always shown: up-down motion distributes wear, prevents notching
    tips.append(
        "Z-oscillate to distribute wear: program a slow Z-shift (up and down within the available flank length) "
        "while feeding around the part. This spreads the contact line across the full cutting edge "
        "instead of notching a single groove — the same principle as Z-shifting a turning insert. "
        "Even 0.010–0.020\" of Z travel significantly extends tool life on production runs."
    )

    return {
        "customer": {
            "material":        material,
            "diameter":        body_dia,
            "flutes":          flutes,
            "rpm":             round(rpm),
            "sfm":             round(sfm_actual, 1),
            "sfm_target":      round(sfm_target, 1),
            "feed_ipm":        round(feed_ipm, 2),
            "doc_in":          round(chamfer_depth, 4),
            "woc_in":          round(d_eff, 4),  # repurposed: D_eff stored here for display
            "mrr_in3_min":     0.0,
            "spindle_load_pct": round((hp_required / machine_hp) * 100.0, 1) if machine_hp > 0 else 0.0,
            "hp_required":     round(hp_required, 3),
            "fpt":             round(ipt, 6),
            "adj_fpt":         None,
            "peripheral_feed_ipm": None,
            "ci_a_e_in":       None,
            "ci_feed_ratio":   None,
            "status":          None,
            "status_hint":     None,
            "risk":            "low",
            "notes":           notes if notes else None,
        },
        "engineering": {
            "deflection_in":          0.0,
            "chip_thickness_in":      round(ipt, 6),
            "chatter_index":          0.0,
            # Teeth in cut: derived from actual WOC/D_eff radial engagement fraction.
            # woc = depth × tan(half_angle); woc/D_eff = 0.5 always for CMS (point tip).
            # engagement_arc = acos(1 - 2 × woc/D_eff); teeth = arc/(2π) × flutes
            "teeth_in_cut":           round(max(0.1, (math.acos(max(-1.0, min(1.0, 1.0 - 2.0 * min(0.5, _woc_as_pct)))) / (2.0 * math.pi)) * flutes), 2),
            "helix_wrap_deg":         None,
            "engagement_continuous":  None,
            "tool_life_min":          round(tool_life_min, 1),
            "force_lbf":              None,
            "torque_inlbf":           round(hp_required * 63025.0 / rpm, 3) if rpm > 0 else None,
            "torque_capacity_inlbf":  SPINDLE_TORQUE_CAPACITY.get(str(payload.get("spindle_taper", "CAT40")), None),
            "torque_pct":             None,
        },
        "stability": None,
        "multi_pass": multi_pass,
        "chamfer": {
            "d_eff_in":          round(d_eff, 4),
            "chamfer_angle_deg": chamfer_angle,
            "tip_dia_in":        tip_dia,
            "chamfer_depth_in":  chamfer_depth,
            "tips":              tips,
            # Chip-thinning physics (for UI display)
            "lead_ctf":          round(lead_ctf, 3),            # programmed FPT multiplier (e.g. 2.00× at 60°)
            "chip_thin_factor":  round(math.sin(half_angle_rad), 4),  # actual chip is this fraction of programmed FPT
            "base_chip_in":      round(ipt_frac * body_dia * series_mult, 6),  # target chip before CTF
            # Edge geometry
            "radial_reach_in":   round((body_dia - tip_dia) / 2.0, 4),
            "edge_length_in":    round((body_dia - tip_dia) / 2.0 / math.sin(half_angle_rad), 4) if math.sin(half_angle_rad) > 0 else 0,
            "max_depth_in":      round((body_dia - tip_dia) / 2.0 / math.tan(half_angle_rad), 4) if math.tan(half_angle_rad) > 0 else 0,
            "edge_pct":          round(
                (chamfer_depth / math.cos(half_angle_rad)) /
                max(0.0001, (body_dia - tip_dia) / 2.0 / math.sin(half_angle_rad)) * 100, 1
            ) if chamfer_depth > 0 and math.cos(half_angle_rad) > 0 and (body_dia - tip_dia) > 0 else 0.0,
            # Growing WOC with depth
            "actual_woc_in":     round(_actual_woc, 4),
            "woc_pct_d_eff":     round(_woc_as_pct * 100, 1),
            # Flute count / chip room
            "std_flutes":        _std_flutes,
            "flute_nonstandard": _flute_nonstandard,
            "chip_room_mult":    round(_chip_room_mult, 2),
            "max_rough_depth_in": round(_max_rough_depth, 4),
            # CMH shear angle physics
            "cmh_shear_angle_deg": round(CMH_SHEAR_ANGLE_DEG, 1) if is_cmh else None,
            "cmh_sfm_boost_pct":   round((CMH_SFM_MULT - 1.0) * 100, 0) if is_cmh else None,
            "cmh_force_factor":    round(CMH_FORCE_FACTOR, 4) if is_cmh else None,
            "cmh_min_ipt":         round(cmh_min_ipt, 6) if is_cmh else None,
            "cmh_min_ipt_ok":      ipt >= cmh_min_ipt if is_cmh else None,
        },
        "debug": None,
    }


def run_drilling(payload: dict) -> dict:
    """Full drilling calc — solid carbide drills, geometry + material driven."""
    D      = float(payload.get("tool_dia", 0.5) or 0.5)
    depth  = float(payload.get("drill_hole_depth", 0) or 0)
    fl     = float(payload.get("drill_flute_length", 0) or 0)
    blind  = bool(payload.get("drill_blind", False))
    pa     = int(payload.get("drill_point_angle", 135) or 135)
    coolant = str(payload.get("coolant", "flood") or "flood")
    coolant_fed    = bool(payload.get("drill_coolant_fed", False))
    drill_geometry = str(payload.get("drill_geometry", "standard") or "standard")
    max_rpm    = float(payload.get("max_rpm", 12000) or 12000)
    rpm_util   = float(payload.get("rpm_util_pct", 0.95) or 0.95)
    feed_util  = float(payload.get("drill_feed_util_pct", 0.90) or 0.90)
    _drill_drive_eff = SPINDLE_DRIVE_EFF.get(str(payload.get("spindle_drive", "belt") or "belt").lower(), 0.92)
    machine_hp = float(payload.get("machine_hp", 10) or 10) * _drill_drive_eff
    mat    = str(payload.get("material", "steel_alloy") or "steel_alloy")
    mat_group = get_material_group(mat)

    # Step drill — SFM on largest dia, feed on entry (smallest) dia
    raw_steps = payload.get("drill_step_diameters") or []
    step_diameters = [float(d) for d in raw_steps if d and float(d) > 0]
    sfm_dia  = max([D] + step_diameters)   # largest dia drives SFM / RPM
    feed_dia = D                            # entry dia drives IPR scaling

    # Hardness
    _hv = float(payload.get("hardness_value", 0) or 0)
    _hs = str(payload.get("hardness_scale", "hrc") or "hrc").lower()
    hrc = hrb_to_hrc(_hv) if _hs == "hrb" else _hv

    # SFM — calculated at largest diameter
    pa_factor   = DRILL_POINT_ANGLE_FACTOR.get(pa, 1.10)
    cool_factor = DRILL_COOLANT_SFM.get(coolant, 1.00)
    if coolant_fed:
        cool_factor = min(cool_factor * 1.15, 1.50)   # through-drill coolant: +15% SFM bonus
    geo_factor  = DRILL_GEOMETRY_SFM.get(drill_geometry, 1.00)
    base_sfm = DRILL_SFM.get(mat, DRILL_SFM.get(mat_group, 100))
    base_sfm *= cool_factor * geo_factor * hardness_sfm_mult(hrc)  # PA factor applies to IPR only, not SFM

    # RPM — uses sfm_dia (largest)
    target_rpm = (base_sfm * 3.82) / sfm_dia
    rpm = min(target_rpm, max_rpm * rpm_util)
    sfm_actual = (rpm * sfm_dia) / 3.82

    # IPR — scales with entry (feed) diameter
    ipr_base = DRILL_IPR_BASE.get(mat, DRILL_IPR_BASE.get(mat_group, 0.004))
    ipr_base *= pa_factor                               # better point = can feed more
    ipr_base *= (feed_dia / 0.5) ** 0.6                # entry dia sets chip load
    ipr_base *= hardness_kc_mult(hrc) ** -0.4           # harder = back off feed slightly
    ipr_base *= feed_util                               # feed utilization — default 0.90 (safety margin)
    if coolant_fed:
        ipr_base *= 1.10                                # through-coolant flushes chips → allows 10% heavier feed
    ipr = max(0.0005, ipr_base)

    # Feed — IPM at entry dia chip load, RPM from largest dia
    ipm = rpm * ipr
    mrr = (math.pi / 4.0) * sfm_dia ** 2 * ipm

    # Depth metrics — use entry dia for most conservative depth/D ratio
    depth_to_dia = depth / feed_dia if feed_dia > 0 else 0.0

    # Force / torque / HP — based on largest dia (total cross-section area being cut)
    # All step shoulders cut simultaneously; total load ≈ drilling sfm_dia from solid.
    # Using entry dia would underestimate power by (sfm_dia/feed_dia)^1.8 on step drills.
    # Torque is depth-corrected: chip column friction + margin contact increase load with depth.
    tsc = coolant in ("tsc_low", "tsc_high")
    depth_factor  = drill_depth_torque_factor(depth_to_dia, coolant_fed=coolant_fed, tsc=tsc, mat_group=mat_group)
    thrust_lbf    = drill_thrust(sfm_dia, ipr, mat_group, hrc) * depth_factor
    torque_inlbf  = drill_torque(sfm_dia, ipr, mat_group, hrc) * depth_factor
    hp_required   = torque_inlbf * rpm / 63025.0

    # Flute length warning — usable depth = flute_length minus point clearance (~0.3×D)
    flute_warning = None
    if fl > 0 and depth > 0:
        usable = fl - feed_dia * 0.3
        if depth > usable:
            flute_warning = (
                f"Hole depth {depth:.3f}\" exceeds usable flute depth {max(usable,0):.3f}\" "
                f"— a longer drill is required."
            )

    # Critical chip thickness check — if IPR falls below the material floor, clamp up and inform.
    # Especially dangerous in stainless/titanium (work hardening).
    chip_warning = None
    min_ipr = drill_min_ipr(feed_dia, mat_group)
    if ipr < min_ipr:
        chip_warning = (
            f"Calculated feed ({ipr:.5f} ipr) was below the critical chip thickness floor for this "
            f"material (min ≈ {min_ipr:.4f} ipr) — feed has been raised to the minimum to prevent "
            f"rubbing, work hardening, and accelerated wear."
        )
        ipr = min_ipr

    # G-code recommendation
    cycle, cycle_note, peck, r_plane, peck_schedule = recommend_drill_cycle(
        feed_dia, depth, mat_group, hrc, pa, coolant, blind, coolant_fed, drill_geometry
    )

    # Drill Stability Triangle — three-side balance check
    # Side 1: Feed (chip thickness)
    feed_ratio = ipr / min_ipr if min_ipr > 0 else 1.0
    if feed_ratio >= 1.30:
        feed_status = "ok"
    elif feed_ratio >= 1.0:
        feed_status = "caution"   # at the floor — marginal
    else:
        feed_status = "warning"   # rubbing zone

    # Side 2: Chip evacuation (peck cycle)
    if cycle in ("G81", "G82"):
        evac_status = "ok"
    elif cycle == "G73":
        evac_status = "caution"   # chip-break peck needed
    else:  # G83
        evac_status = "warning" if not (coolant_fed or coolant in ("tsc_low", "tsc_high")) else "caution"

    # Side 3: Hole depth (chip column length)
    if depth_to_dia <= 3.0:
        depth_status = "ok"
    elif depth_to_dia <= 5.0:
        depth_status = "caution"
    else:
        depth_status = "warning"

    drill_stability = {
        "feed_status":  feed_status,
        "feed_ratio":   round(feed_ratio, 2),
        "evac_status":  evac_status,
        "depth_status": depth_status,
        "depth_xd":     round(depth_to_dia, 1),
    }

    # Geometry upgrade tip — guide the user toward a better drill design for this application
    stringy_mat = mat_group in ("Stainless", "Titanium", "Inconel")
    geometry_tip = None
    if not coolant_fed:
        if depth_to_dia > 7.0:
            geometry_tip = (
                f"At {depth_to_dia:.1f}×D, coolant-through is strongly recommended regardless of flute style — "
                f"chip column friction and heat will overwhelm standard coolant delivery."
            )
        elif depth_to_dia > 7.0 and drill_geometry in ("standard", "med_helix"):
            geometry_tip = (
                f"At {depth_to_dia:.1f}×D, a high-helix drill would handle this depth more reliably "
                f"(7–9×D range) — or add coolant-through for best chip evacuation."
            )
        elif depth_to_dia > 5.0 and drill_geometry == "standard":
            if stringy_mat:
                geometry_tip = (
                    f"Drilling {depth_to_dia:.1f}×D in a stringy material with a standard drill is challenging. "
                    f"A medium or high-helix drill would improve chip evacuation significantly."
                )
            else:
                geometry_tip = (
                    f"At {depth_to_dia:.1f}×D a medium or high-helix drill would reduce pecking frequency "
                    f"and improve chip flow vs a standard twist drill."
                )
        elif depth_to_dia > 3.0 and drill_geometry == "standard" and stringy_mat:
            geometry_tip = (
                f"For {mat_group} at {depth_to_dia:.1f}×D, a medium-helix drill's steeper flute angle "
                f"evacuates stringy chips more effectively than a standard twist drill."
            )

    flutes = int(payload.get("flutes", 0) or 2)

    # Stub customer/engineering blocks so the response shape is consistent
    result = {
        "customer": {
            "material": mat,
            "diameter": sfm_dia,
            "flutes": flutes,
            "rpm": round(rpm, 0),
            "sfm": round(sfm_actual, 1),
            "sfm_target": round(base_sfm, 1),
            "feed_ipm": round(ipm, 2),
            "doc_in": depth,
            "woc_in": sfm_dia,
            "mrr_in3_min": round(mrr, 4),
            "spindle_load_pct": round(min(hp_required / machine_hp, 9.99), 3),
            "hp_required": round(hp_required, 2),
            "fpt": round(ipr, 6),
            "adj_fpt": None,
            "status": "ok",
            "status_hint": None,
        },
        "engineering": {
            "force_lbf": round(thrust_lbf, 1),
            "torque_inlbf": round(torque_inlbf, 2),
            "torque_capacity_inlbf": SPINDLE_TORQUE_CAPACITY.get(
                str(payload.get("spindle_taper", "CAT40")), None
            ),
            "torque_pct": None,
            "deflection_in": 0.0,
            "chip_thickness_in": ipr,
            "chatter_index": 0.0,
            "tool_life_min": None,
        },
        "drilling": {
            "rpm": round(rpm, 0),
            "sfm": round(sfm_actual, 1),
            "ipm": round(ipm, 2),
            "ipr": round(ipr, 5),
            "mrr_in3_min": round(mrr, 4),
            "thrust_lbf": round(thrust_lbf, 1),
            "torque_inlbf": round(torque_inlbf, 2),
            "hp_required": round(hp_required, 2),
            "depth_to_dia": round(depth_to_dia, 2),
            "cycle": cycle,
            "cycle_note": cycle_note,
            "peck_depth_in": round(peck, 4) if peck else None,
            "r_plane_in": round(r_plane, 4),
            "peck_schedule": peck_schedule,
            "flute_warning": flute_warning,
            "chip_warning": chip_warning,
            "geometry_tip": geometry_tip,
            "drill_stability": drill_stability,
            "entry_dia": round(feed_dia, 4),
            "largest_dia": round(sfm_dia, 4),
        },
        "stability": None,
        "debug": None,
    }
    return result


def run_reaming(payload: dict) -> dict:
    """Full reaming calc — solid carbide reamers, 3-identity coolant model.
    Identity 1: coolant_fed=True  (internal through-coolant)
    Identity 2: coolant_fed=False + external flood/mist
    Identity 3: coolant_fed=False + dry
    """
    D            = float(payload.get("tool_dia", 0.5) or 0.5)
    pre_drill    = float(payload.get("ream_pre_drill_dia", 0) or 0)
    depth        = float(payload.get("ream_hole_depth", 0) or 0)
    blind        = bool(payload.get("ream_blind", False))
    coolant_fed  = bool(payload.get("ream_coolant_fed", False))
    lead_chamfer = str(payload.get("ream_lead_chamfer", "standard") or "standard")

    # Lead chamfer multipliers — affects feed rate and surface finish
    # standard (45°): balanced default; long_lead (15-30°): smoother entry, lower feed;
    # short_lead (60°+): aggressive entry, higher feed, production use
    _LEAD_SFM  = {"standard": 1.00, "long_lead": 0.95, "short_lead": 1.00}
    _LEAD_IPR  = {"standard": 1.00, "long_lead": 0.88, "short_lead": 1.12}
    lead_sfm_mult = _LEAD_SFM.get(lead_chamfer, 1.00)
    lead_ipr_mult = _LEAD_IPR.get(lead_chamfer, 1.00)
    coolant      = str(payload.get("coolant", "flood") or "flood")
    max_rpm      = float(payload.get("max_rpm", 12000) or 12000)
    rpm_util     = float(payload.get("rpm_util_pct", 0.95) or 0.95)
    _ream_drive_eff = SPINDLE_DRIVE_EFF.get(str(payload.get("spindle_drive", "belt") or "belt").lower(), 0.92)
    machine_hp   = float(payload.get("machine_hp", 10) or 10) * _ream_drive_eff
    mat          = str(payload.get("material", "steel_alloy") or "steel_alloy")
    mat_group    = get_material_group(mat)

    # Step reamer — SFM/RPM on largest dia, IPR on entry dia
    raw_steps      = payload.get("ream_step_diameters") or []
    step_diameters = [float(d) for d in raw_steps if d and float(d) > 0]
    sfm_dia  = max([D] + step_diameters)
    feed_dia = D

    # Hardness
    _hv = float(payload.get("hardness_value", 0) or 0)
    _hs = str(payload.get("hardness_scale", "hrc") or "hrc").lower()
    hrc = hrb_to_hrc(_hv) if _hs == "hrb" else _hv

    # ── Layer 1: Base SFM and IPR from material ──────────────────────────────
    base_sfm = REAM_SFM.get(mat, REAM_SFM.get(mat_group, 150))
    base_sfm *= hardness_sfm_mult(hrc)
    ipr_base = ream_base_ipr(feed_dia)
    ipr_base *= hardness_kc_mult(hrc) ** -0.3

    # ── Layer 2: Coolant-Fed vs Non-Coolant-Fed identity ─────────────────────
    if coolant_fed:
        cf_sfm_mult = 1.05   # coolant-fed: slight SFM bonus (chip flushing)
        cf_ipr_mult = 1.08   # can push feed harder with internal coolant
    else:
        cf_sfm_mult = _REAM_NON_CF_MULT.get(mat, _REAM_NON_CF_MULT.get(mat_group, 0.92))
        cf_ipr_mult = 0.92

    base_sfm *= cf_sfm_mult
    ipr_base *= cf_ipr_mult

    # ── Layer 3: External coolant condition ───────────────────────────────────
    ext = _REAM_EXT_COOLANT.get(coolant, _REAM_EXT_COOLANT["flood"])
    base_sfm *= ext["sfm"]
    ipr_base *= ext["ipr"]

    # ── Layer 4: Depth correction ─────────────────────────────────────────────
    depth_xd = depth / D if D > 0 else 0.0
    sfm_depth_f, ipr_depth_f, depth_status = ream_depth_factors(depth_xd, coolant_fed)
    base_sfm *= sfm_depth_f
    ipr_base *= ipr_depth_f

    # Hole-type multiplier
    stringy = mat_group in ("Stainless", "Titanium", "Inconel")
    if blind:
        if coolant_fed:
            hole_mult = 0.95
        elif stringy:
            hole_mult = 0.75   # blind + gummy + no internal coolant = high risk
        else:
            hole_mult = 0.85
    else:
        hole_mult = 1.00

    base_sfm *= hole_mult
    ipr_base *= hole_mult

    # Apply lead chamfer multipliers
    base_sfm *= lead_sfm_mult
    ipr_base *= lead_ipr_mult

    # Final RPM / IPR / IPM
    target_rpm = (base_sfm * 3.82) / sfm_dia
    rpm = min(target_rpm, max_rpm * rpm_util)
    sfm_actual = (rpm * sfm_dia) / 3.82
    ipr = max(0.0002, ipr_base)
    ipm = rpm * ipr

    # HP estimate — reamers are low-force but still useful to report
    # Simplified: torque ≈ 0.25 × drill torque at same D/IPR (finishing cut, not full engagement)
    from engine.physics import drill_torque as _dt
    torque_inlbf = _dt(sfm_dia, ipr, mat_group, hrc) * 0.25
    hp_required  = torque_inlbf * rpm / 63025.0

    # ── Layer 5: Stock allowance validation ───────────────────────────────────
    total_stock = D - pre_drill if pre_drill > 0 else None
    stock_min, stock_ideal, stock_max = ream_stock_range(D)

    stock_status  = "unknown"
    stock_warning = None

    if total_stock is not None:
        ratio = total_stock / stock_ideal if stock_ideal > 0 else 1.0
        if ratio < 0.70:
            stock_status  = "low"
            stock_warning = (
                f"Stock {total_stock:.4f}\" ({ratio*100:.0f}% of ideal {stock_ideal:.4f}\") is too low — "
                f"reamer will rub, produce poor finish, and lose size control. "
                f"Pre-drill to ø{round(D - stock_ideal, 4):.4f}\" (ideal stock)."
            )
        elif ratio <= 1.30:
            stock_status = "ok"
        elif ratio <= 1.60:
            stock_status  = "high"
            stock_warning = (
                f"Stock {total_stock:.4f}\" ({ratio*100:.0f}% of ideal) is above recommended — "
                f"monitor for chatter and taper. Consider a roughing pass."
            )
        else:
            stock_status  = "excessive"
            stock_warning = (
                f"Stock {total_stock:.4f}\" ({ratio*100:.0f}% of ideal) is excessive — "
                f"high risk of chatter, oversized hole, and edge damage. "
                f"Pre-drill to ø{round(D - stock_max, 4):.4f}\" minimum."
            )

    # Coating recommendation
    coating_rec, iso_cat = ream_coating(mat_group, hrc)

    # Confidence / risk score
    risk_flags = []
    if D < 0.0625:
        risk_flags.append(f"Minimum manufacturable diameter is 1/16\" — consider a larger reamer diameter")
    if depth_xd > 10.0:
        risk_flags.append(f"At {depth_xd:.1f}×D, consider breaking into two operations or using a gun reamer designed for deep-hole work")
    if blind and not coolant_fed:
        risk_flags.append("Switching to a coolant-fed reamer in this blind hole would significantly improve chip evacuation and finish")
    if not coolant_fed and depth_xd > 4.0:
        risk_flags.append(f"At {depth_xd:.1f}×D, a coolant-fed (through-coolant) reamer would flush chips more effectively and allow higher feed rates")
    if stock_status in ("low", "excessive"):
        stock_dir = "increase" if stock_status == "low" else "reduce"
        stock_ideal_str = f"{round(D - stock_ideal, 4):.4f}\""
        risk_flags.append(f"Pre-drill stock is {stock_status} — {stock_dir} stock by adjusting pre-drill to ø{stock_ideal_str} for best size control and finish")
    if stringy and not coolant_fed:
        risk_flags.append(f"{mat_group} produces stringy chips — a coolant-fed reamer with higher-helix flutes would greatly improve chip control")
    if coolant == "dry" and not coolant_fed:
        risk_flags.append("Adding flood or mist coolant would reduce heat, extend tool life, and improve hole finish")

    if len(risk_flags) == 0:
        confidence = "green"
    elif len(risk_flags) == 1:
        confidence = "yellow"
    elif len(risk_flags) == 2:
        confidence = "orange"
    else:
        confidence = "red"

    depth_note = None
    if depth_status == "caution":
        depth_note = f"Depth {depth_xd:.1f}×D — speed and feed derated. Monitor for chatter."
    elif depth_status == "warning":
        depth_note = f"Depth {depth_xd:.1f}×D — significant derate applied. Consider coolant-fed reamer."

    # ── Surface finish estimate ────────────────────────────────────────────────
    # Base Ra (μin) ranges by material group
    _FINISH_BASE = {
        "Aluminum":    (16,  32),
        "Non-Ferrous": (16,  32),
        "Plastics":    (16,  32),
        "Steel":       (32,  63),
        "Cast Iron":   (32,  63),
        "Stainless":   (32,  63),
        "Titanium":    (32,  63),
        "Inconel":     (63, 125),
    }
    ra_lo, ra_hi = _FINISH_BASE.get(mat_group, (32, 63))

    # Coolant identity
    if coolant_fed:
        ra_mult = 0.75          # through-coolant = finer finish
    elif coolant in ("tsc_low", "tsc_high"):
        ra_mult = 0.85
    elif coolant == "flood":
        ra_mult = 1.00
    elif coolant == "mist":
        ra_mult = 1.20
    else:                       # dry
        ra_mult = 1.60

    # Stock penalty
    if stock_status == "low":
        ra_mult *= 1.50         # rubbing → glazed/torn
    elif stock_status == "high":
        ra_mult *= 1.30         # chatter risk
    elif stock_status == "excessive":
        ra_mult *= 1.80

    # Depth penalty
    if depth_xd > 6.0:
        ra_mult *= 1.40
    elif depth_xd > 4.0:
        ra_mult *= 1.20

    # Stringy material penalty (built-up edge, smearing)
    if stringy:
        ra_mult *= 1.25

    finish_ra_adjusted = round(ra_hi * ra_mult)

    if finish_ra_adjusted <= 32:
        finish_risk = "green"
    elif finish_ra_adjusted <= 63:
        finish_risk = "yellow"
    elif finish_ra_adjusted <= 125:
        finish_risk = "orange"
    else:
        finish_risk = "red"

    # Base Ra range shown as "under good conditions" — material only, no penalties
    finish_ra_base_min = ra_lo
    finish_ra_base_max = ra_hi

    # Surface finish improvement suggestions
    finish_notes = [
        "Correct pre-drill size is the single biggest factor — stay within the recommended stock range.",
        "Shrink-fit or hydraulic holder keeps runout under 0.0002\" — runout sets the floor on achievable Ra.",
    ]
    if not coolant_fed:
        finish_notes.append(
            "Through-coolant or flood coolant flushes chips and reduces heat — both directly improve surface finish."
        )
    if stock_status == "low":
        finish_notes.append(
            "Pre-drill too close to reamer size causes rubbing instead of cutting — open up the pre-drill."
        )
    elif stock_status in ("high", "excessive"):
        finish_notes.append(
            "Excess stock causes chatter — reduce pre-drill diameter to stay within the recommended range."
        )
    if stringy:
        finish_notes.append(
            f"Helical flutes help prevent chip smearing on {mat_group} — consider a spiral reamer if finish is critical."
        )
    if depth_xd > 4.0:
        finish_notes.append(
            f"At {depth_xd:.1f}\u00d7D, consistent feed rate is critical — any dwell or hesitation creates chatter marks."
        )

    # ── Hole straightness assessment ───────────────────────────────────────────
    # Base risk from depth and hole type
    straight_score = 0          # higher = worse
    if depth_xd > 8.0:
        straight_score += 3
    elif depth_xd > 6.0:
        straight_score += 2
    elif depth_xd > 3.0:
        straight_score += 1

    if blind:
        straight_score += 1     # chip packing adds lateral force
    if not coolant_fed and depth_xd > 4.0:
        straight_score += 1
    if stock_status in ("high", "excessive"):
        straight_score += 1     # excess stock creates lateral cutting force
    if stringy and not coolant_fed:
        straight_score += 1
    if coolant_fed:
        straight_score = max(0, straight_score - 1)  # through-coolant helps

    if straight_score == 0:
        straightness_risk = "green"
    elif straight_score == 1:
        straightness_risk = "yellow"
    elif straight_score == 2:
        straightness_risk = "orange"
    else:
        straightness_risk = "red"

    straightness_notes = [
        "Pre-drill quality sets straightness — a wandered drill produces a wandered reamed hole.",
        "Use a spot drill to establish a precise entry point before drilling.",
    ]
    if depth_xd > 3.0:
        straightness_notes.append(
            f"At {depth_xd:.1f}\u00d7D, rigidity of the setup and holder runout become critical."
        )
    if blind:
        straightness_notes.append(
            "Leave bottom clearance — chip packing at the floor creates lateral pressure that pushes the reamer off-center."
        )
    if stock_status in ("high", "excessive"):
        straightness_notes.append(
            "Excess stock increases lateral cutting forces — correct pre-drill size directly protects straightness."
        )
    if not coolant_fed and depth_xd > 4.0:
        straightness_notes.append(
            f"Chip accumulation at {depth_xd:.1f}\u00d7D creates lateral force — coolant-fed reamer recommended."
        )
    if stringy:
        straightness_notes.append(
            f"{mat_group} tends to push the reamer off-center — minimize runout with a shrink-fit or hydraulic holder."
        )
    straightness_notes.append(
        "Shrink-fit or hydraulic holder keeps runout under 0.0002\" — directly impacts size, finish, and geometry."
    )

    # ── Helix geometry recommendation ─────────────────────────────────────────
    _angle_deg, _angle_label, helix_angle_note = ream_helix_angle(
        mat_group, depth_xd, finish_risk, hrc, blind=blind, coolant_fed=coolant_fed
    )

    helix_warnings = []

    if _angle_deg == 0:
        # Straight flute — no helical chip action, direction is irrelevant
        helix_rec  = "Straight flute, right-hand cut"
        if blind:
            helix_note = (
                "Straight flute has no helical chip action — chip evacuation relies entirely on coolant flow. "
                "Do not bottom the reamer; leave clearance at the floor for chips."
            )
            if not coolant_fed:
                helix_warnings.append(
                    "Coolant-fed strongly recommended with straight flute in a blind hole — no helix to lift chips out."
                )
            if stringy:
                helix_warnings.append(
                    f"{mat_group} is ductile/gummy — monitor hole size closely; straight flute can drag in soft materials."
                )
        else:
            helix_note = (
                "Straight flute has no helical chip action — flush chips forward with flood coolant or air blast. "
                "Ensure the exit is fully open."
            )
            if not coolant_fed:
                helix_warnings.append(
                    "Use flood or strong flute-directed coolant to flush chips ahead of the tool."
                )
            if depth_xd > 4.0:
                helix_warnings.append(
                    f"Deep through hole ({depth_xd:.1f}\u00d7D) with straight flute — verify chips can clear the exit freely."
                )
    elif blind:
        helix_rec  = f"Right-hand helix, right-hand cut ({_angle_label})"
        helix_note = (
            "RH helix pulls chips back up out of the hole — correct for blind holes. "
            "Do not bottom the reamer; leave clearance at the floor for chips."
        )
        if not coolant_fed:
            helix_warnings.append(
                "Internal coolant preferred for blind holes — chip packing risk without it."
            )
        if depth_xd > 4.0 and not coolant_fed:
            helix_warnings.append(
                f"Deep blind hole ({depth_xd:.1f}\u00d7D) without internal coolant — "
                "coolant-fed strongly recommended to prevent chip packing."
            )
        if stringy:
            helix_warnings.append(
                f"{mat_group} is ductile/gummy — RH helix may cut slightly oversize; monitor hole size closely."
            )
    else:
        helix_rec  = f"Left-hand helix, right-hand cut ({_angle_label})"
        helix_note = (
            "LH helix pushes chips forward ahead of the tool — correct for through holes. "
            "Ensure the exit is open so chips can clear ahead. "
            "If the hole exits into a pocket or blind face, treat as a blind-hole condition."
        )
        if not coolant_fed:
            helix_warnings.append(
                "Use flood or strong flute-directed coolant to flush chips ahead of the tool."
            )
        if depth_xd > 4.0:
            helix_warnings.append(
                f"Deep through hole ({depth_xd:.1f}\u00d7D) — verify the exit is truly open and chips can clear freely."
            )
        if stringy and not coolant_fed:
            helix_warnings.append(
                f"{mat_group} through hole without internal coolant — avoid a marginal pre-hole that leaves torn material at the exit."
            )

    return {
        "customer": {
            "material": mat, "diameter": sfm_dia, "flutes": int(payload.get("flutes", 0) or 6),
            "rpm": round(rpm, 0), "sfm": round(sfm_actual, 1), "sfm_target": round(base_sfm / (sfm_depth_f * hole_mult), 1),
            "feed_ipm": round(ipm, 2), "doc_in": 0, "woc_in": sfm_dia,
            "mrr_in3_min": 0.0, "spindle_load_pct": round(min(hp_required / machine_hp, 9.99), 3),
            "hp_required": round(hp_required, 2),
            "fpt": round(ipr, 6), "adj_fpt": None, "status": "ok", "status_hint": None,
        },
        "engineering": {
            "force_lbf": None, "torque_inlbf": round(torque_inlbf, 2),
            "torque_capacity_inlbf": None, "torque_pct": None,
            "deflection_in": 0.0, "chip_thickness_in": ipr, "chatter_index": 0.0, "tool_life_min": None,
        },
        "reaming": {
            "rpm": round(rpm, 0),
            "sfm": round(sfm_actual, 1),
            "ipm": round(ipm, 2),
            "ipr": round(ipr, 5),
            "hp_required": round(hp_required, 2),
            "depth_xd": round(depth_xd, 2),
            "depth_status": depth_status,
            "depth_note": depth_note,
            "stock_per_side_in": round(total_stock / 2, 5) if total_stock is not None else None,
            "stock_total_in": round(total_stock, 5) if total_stock is not None else None,
            "stock_ideal_in": round(stock_ideal, 5),
            "stock_min_in": round(stock_min, 5),
            "stock_max_in": round(stock_max, 5),
            "stock_status": stock_status,
            "stock_warning": stock_warning,
            "confidence": confidence,
            "risk_flags": risk_flags,
            "coolant_identity": (
                "coolant-fed" if coolant_fed
                else f"non-coolant-fed / {coolant}"
            ),
            "entry_dia": round(feed_dia, 4),
            "largest_dia": round(sfm_dia, 4),
            "helix_rec": helix_rec,
            "helix_note": helix_note,
            "helix_angle_note": helix_angle_note,
            "helix_warnings": helix_warnings,
            "coating_rec": coating_rec,
            "iso_category": iso_cat,
            "finish_ra_base_min": finish_ra_base_min,
            "finish_ra_base_max": finish_ra_base_max,
            "finish_risk": finish_risk,
            "finish_notes": finish_notes,
            "straightness_risk": straightness_risk,
            "straightness_notes": straightness_notes,
            "tool_life_lo": ream_tool_life(mat_group, hrc, coolant_fed, coolant, stock_status, depth_xd)[0],
            "tool_life_hi": ream_tool_life(mat_group, hrc, coolant_fed, coolant, stock_status, depth_xd)[1],
        },
        "drilling": None,
        "stability": None,
        "debug": None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# KEYSEAT / DOVETAIL SFM TABLES
# Full-slot engagement (keyseat) and angled-slot engagement (dovetail).
# Conservative vs endmill SFM: both tool types see continuous full-width
# engagement which raises heat and force vs peripheral milling.
# ─────────────────────────────────────────────────────────────────────────────
KEYSEAT_SFM = {
    # Aluminum
    "Aluminum":          900,
    "aluminum_wrought":    900,
    "aluminum_wrought_hs": 700,   # 7075/2024 keyseat: lower full-slot SFM — stronger alloy
    "aluminum_cast":     500,
    "non_ferrous":       400,
    "plastic_unfilled":  350,   # Unfilled TPs: moderate keyseat SFM — heat is the constraint
    "plastic_filled":    275,   # Fiber-filled: lower to manage abrasion in full-slot
    "composite_tpc":     250,   # Continuous-fiber laminates: conservative; delamination risk
    # Steel
    "Steel":             220,
    "steel_mild":        250,   # Plain low-carbon full-slot — between free and alloy
    "steel_free":        280,
    "steel_alloy":       200,
    "steel_tool":        120,
    "tool_steel_p20":    220,
    "tool_steel_a2":     180,
    "tool_steel_h13":    160,
    "tool_steel_s7":     180,
    "tool_steel_d2":     130,
    "cpm_10v":            60,  # CPM 10V keyseat: full-slot = high abrasive exposure; very conservative
    "hardened_lt55":     160,
    "hardened_gt55":      70,
    "armor_milspec":     160,  # MIL-A-12560 keyseat — full-slot is harsh, reduce vs endmill
    "armor_ar400":       115,  # AR400 keyseat — full-slot engagement is a tool killer
    "armor_ar500":        85,  # AR500 keyseat — borderline viable; use largest tool possible
    "armor_ar600":        50,  # AR600 keyseat — extremely conservative; consider EDM alternative
    # Stainless
    "Stainless":         120,
    "stainless_fm":      200,
    "stainless_ferritic":160,
    "stainless_410":     150,
    "stainless_420":     130,
    "stainless_440c":    140,
    "stainless_304":     120,
    "stainless_316":     100,
    "stainless_ph":      130,
    "stainless_duplex":  100,
    "stainless_superduplex": 85,
    "stainless_martensitic": 150,
    "stainless_austenitic":  120,
    # Cast iron
    "Cast Iron":         220,
    "cast_iron_gray":    260,
    "cast_iron_ductile": 220,
    "cast_iron_cgi":     190,
    "cast_iron_malleable": 190,
    # Titanium
    "Titanium":           90,
    "titanium_cp":        90,
    "titanium_64":        80,
    # Superalloys / Inconel
    "Inconel":            55,
    "inconel_625":        55,
    "inconel_718":        55,
    "hastelloy_x":        45,
    "inconel_617":        42,
    "waspaloy":           40,
    "mp35n":              35,
    "monel_k500":         60,
    "hiTemp_fe":          65,
    "hiTemp_co":          80,
}

# Dovetail SFM ≈ keyseat × 0.88 — angled engagement increases interrupted-cut
# impact loading and heat at the edge, warranting a modest SFM reduction.
DOVETAIL_SFM = {k: round(v * 0.88) for k, v in KEYSEAT_SFM.items()}

# Feed mill SFM — solid carbide high-feed endwork tools.
# Light axial DOC + lead-angle chip thinning lets feed mills run faster SFM than keyseat/dovetail.
# Upper limit: 52 HRC (hardness_sfm_mult handles derating above that).
FEEDMILL_SFM = {
    # Aluminum
    "Aluminum":              1200,
    "aluminum_wrought":      1200,
    "aluminum_wrought_hs":    900,
    "aluminum_cast":          700,
    "non_ferrous":            550,
    # Steel
    "Steel":                  450,
    "steel_mild":             500,
    "steel_free":             550,
    "steel_alloy":            425,
    "tool_steel_p20":         375,
    "tool_steel_a2":          300,
    "tool_steel_h13":         275,
    "tool_steel_s7":          300,
    "tool_steel_d2":          220,
    "cpm_10v":                 80,
    "hardened_lt55":           175,
    "hardened_gt55":            70,   # above 52 HRC: not recommended
    "armor_milspec":           175,
    "armor_ar400":             130,
    "armor_ar500":              95,
    "armor_ar600":              55,
    # Stainless
    "Stainless":               225,
    "stainless_fm":            300,
    "stainless_ferritic":      250,
    "stainless_410":           230,
    "stainless_420":           200,
    "stainless_440c":          210,
    "stainless_304":           225,
    "stainless_316":           200,
    "stainless_ph":            240,
    "stainless_duplex":        175,
    "stainless_superduplex":   150,
    "stainless_martensitic":   230,
    "stainless_austenitic":    220,
    # Cast iron
    "Cast Iron":               500,
    "cast_iron_gray":          500,
    "cast_iron_ductile":       450,
    "cast_iron_cgi":           375,
    "cast_iron_malleable":     375,
    # Titanium
    "Titanium":                225,
    "titanium_cp":             225,
    "titanium_64":             200,
    # Superalloys / Inconel
    "Inconel":                  90,
    "inconel_625":              90,
    "inconel_718":              90,
    "hastelloy_x":              75,
    "inconel_617":              70,
    "waspaloy":                 60,
    "mp35n":                    55,
    "monel_k500":               95,
    "hiTemp_fe":               100,
    "hiTemp_co":               120,
    # Plastics / composites
    "plastic_unfilled":        400,
    "plastic_filled":          300,
    "composite_tpc":           275,
}


def run_keyseat(payload: dict) -> dict:
    """Speed & feed calc for keyseat / flute key cutters.
    Full-slot engagement: WOC = 100% of cutting diameter.
    SFM is based on cutting diameter (keyseat width).
    arbor_dia (neck between shank and teeth) is used for stability notes.
    """
    D          = float(payload.get("tool_dia", 0.5) or 0.5)
    flutes     = int(payload.get("flutes", 4) or 4)
    loc        = float(payload.get("loc", 0.5) or 0.5)
    lbs        = float(payload.get("lbs", 0.0) or 0.0)
    stickout   = float(payload.get("stickout", 2.0) or 2.0)
    arbor_dia  = float(payload.get("keyseat_arbor_dia", 0.0) or 0.0)
    mat        = str(payload.get("material", "steel_alloy") or "steel_alloy")
    mat_group  = get_material_group(mat)

    flute_reach = (D - arbor_dia) / 2.0 if arbor_dia > 0 else D * 0.25
    final_slot_depth = float(payload.get("final_slot_depth", 0.0) or 0.0)
    if final_slot_depth > flute_reach:
        final_slot_depth = flute_reach  # cap at physical flute reach

    # Material toughness factor for pass depth conservatism
    _mat_factor = {"Aluminum": 1.0, "Steel": 1.5, "Stainless": 1.75,
                   "Inconel": 2.5, "Titanium": 2.0, "Cast Iron": 1.3}.get(mat_group, 1.5)
    # Reach penalty: longer reach = more deflection risk
    _reach_factor = 1.0 + (lbs / (arbor_dia * 8.0)) if (arbor_dia > 0 and lbs > 0) else 1.0
    # Max safe DOC per pass
    max_safe_doc = (flute_reach / 2.0) / (_mat_factor * _reach_factor)
    max_safe_doc = max(0.005, min(max_safe_doc, flute_reach))  # clamp: min 0.005", max flute_reach

    doc_xd     = float(payload.get("doc_xd", 0.0) or 0.0)
    if doc_xd <= 0:
        doc_xd = max_safe_doc / D
    doc_in     = doc_xd * D
    max_rpm    = float(payload.get("max_rpm", 12000) or 12000)
    rpm_util   = float(payload.get("rpm_util_pct", 0.95) or 0.95)
    coolant    = str(payload.get("coolant", "flood") or "flood").lower()
    toolholder = str(payload.get("toolholder", "er_collet") or "er_collet").lower()
    _spindle_drive = str(payload.get("spindle_drive", "belt") or "belt").lower()
    _drive_eff     = SPINDLE_DRIVE_EFF.get(_spindle_drive, 0.92)
    machine_hp     = float(payload.get("machine_hp", 10.0) or 10.0) * _drive_eff

    # Hardness
    _hv  = float(payload.get("hardness_value", 0) or 0)
    _hs  = str(payload.get("hardness_scale", "hrc") or "hrc").lower()
    hrc  = hrb_to_hrc(_hv) if _hs == "hrb" else _hv

    # SFM
    base_sfm   = KEYSEAT_SFM.get(mat, KEYSEAT_SFM.get(mat_group, 150))
    sfm_target = base_sfm * hardness_sfm_mult(hrc)

    # RPM
    target_rpm = (sfm_target * 12.0) / (math.pi * D)
    rpm        = min(target_rpm, max_rpm * rpm_util)
    rpm        = max(1.0, rpm)
    sfm_actual = (rpm * math.pi * D) / 12.0

    # Chip load — IPT_FRAC × D × 0.75 conservative factor for full slot engagement
    ipt_frac  = IPT_FRAC.get(mat, IPT_FRAC.get(mat_group, 0.005))
    ipt       = ipt_frac * D * 0.75
    feed_ipm  = rpm * flutes * ipt

    # MRR
    mrr = feed_ipm * doc_in * D

    # Cutting force — full-slot arc_fraction = 1.0 but staggered tooth (upcut + downcut)
    # means net radial load is lower than a standard slot mill; use 0.50 radial fraction.
    _hp_unit   = HP_PER_CUIN.get(mat, HP_PER_CUIN.get(mat_group, 1.0))
    hp_required = max(0.01, mrr * _hp_unit * hardness_kc_mult(hrc))
    total_force = (hp_required * 33000.0) / max(1.0, feed_ipm / 12.0)
    radial_force = total_force * 0.50

    # Deflection
    rigidity = TOOLHOLDER_RIGIDITY.get(toolholder, 1.0)
    if payload.get("dual_contact", False):
        rigidity *= 1.08
    deflection = tool_deflection(
        radial_force, stickout, D, flutes, loc, lbs, arbor_dia if arbor_dia > 0 else None,
        payload.get("holder_gage_length"), payload.get("holder_nose_dia"),
    )
    deflection /= rigidity

    # Stability pct (simplified — no chatter limit model for keyseat, use deflection threshold)
    # Flag if deflection > 0.001" (0.001" is a practical limit for keyseat finish quality)
    stability_pct = round((deflection / 0.001) * 100.0, 1)

    # Tool life
    _coolant_factor = COOLANT_LIFE.get(coolant, 1.0)
    _base_life      = BASE_LIFE_MIN.get(mat, BASE_LIFE_MIN.get(mat_group, 45.0)) * 0.70  # full-slot penalty
    _sfm_ratio      = sfm_actual / max(1.0, sfm_target)
    tool_life_min   = (_base_life / max(0.20, _sfm_ratio ** 0.40)) * _coolant_factor

    # Notes
    notes = []
    if arbor_dia > 0 and arbor_dia < D * 0.50:
        notes.append(
            f"Arbor diameter ({arbor_dia:.4f}\") is less than 50% of cutting diameter — "
            f"this narrow neck significantly reduces rigidity. Keep stickout as short as possible."
        )
    if deflection > 0.001:
        notes.append(
            f"Estimated deflection ({deflection*1000:.1f} thou) exceeds 1.0 thou threshold for keyseat finish. "
            f"Reduce stickout or use a stiffer toolholder."
        )
    if flutes >= 6 and mat_group in ("Aluminum",):
        notes.append("Staggered-tooth keyseat cutters in aluminum: consider flood coolant or air blast to clear chips from the full-slot cut.")

    # Multi-pass strategy
    multi_pass = None
    if final_slot_depth > 0:
        import math as _math
        num_passes = max(1, _math.ceil(final_slot_depth / max_safe_doc))
        depth_per_pass = final_slot_depth / num_passes
        multi_pass = {
            "final_slot_depth_in": round(final_slot_depth, 4),
            "max_safe_doc_in":     round(max_safe_doc, 4),
            "num_passes":          num_passes,
            "depth_per_pass_in":   round(depth_per_pass, 4),
            "aggressive":          doc_in > max_safe_doc,
        }
        if num_passes > 1:
            notes.append(
                f"Multi-pass strategy recommended: {num_passes} passes of {depth_per_pass:.4f}\" each "
                f"to reach {final_slot_depth:.4f}\" final slot depth. "
                f"Max safe pass depth for this tool/material: {max_safe_doc:.4f}\"."
            )
        if doc_in > max_safe_doc * 1.25:
            notes.append(
                f"⚠ Entered pass depth ({doc_in:.4f}\") exceeds recommended safe limit ({max_safe_doc:.4f}\") "
                f"for this neck diameter and material. Tool breakage risk is elevated."
            )

    tips = [
        "Keyseat cutters run full-slot engagement — chip evacuation is critical. Use flood coolant or high-pressure air blast.",
        "Keep stickout to the absolute minimum. The arbor (neck) section is the most flexible part of the tool.",
        "Climb milling direction: feed so the chip starts thick and ends thin to avoid rubbing at entry.",
    ]
    if mat_group in ("Stainless", "Inconel", "Titanium"):
        tips.append("Use sharp, uncoated or AlTiN-coated tools in this material. Avoid any dwell or pause at the bottom of the cut.")

    return {
        "customer": {
            "material":         mat,
            "diameter":         D,
            "flutes":           flutes,
            "rpm":              round(rpm),
            "sfm":              round(sfm_actual, 1),
            "sfm_target":       round(sfm_target, 1),
            "feed_ipm":         round(feed_ipm, 2),
            "doc_in":           round(doc_in, 4),
            "woc_in":           round(D, 4),           # full-slot: WOC = cutting diameter
            "mrr_in3_min":      round(mrr, 3),
            "spindle_load_pct": round((hp_required / machine_hp) * 100.0, 1) if machine_hp > 0 else 0.0,
            "hp_required":      round(hp_required, 3),
            "fpt":              round(ipt, 6),
            "adj_fpt":          None,
            "peripheral_feed_ipm": None,
            "ci_a_e_in":        None,
            "ci_feed_ratio":    None,
            "status":           "warning" if stability_pct > 100 else "ok",
            "status_hint":      "High deflection — reduce stickout" if stability_pct > 100 else None,
            "risk":             "high" if stability_pct > 175 else ("medium" if stability_pct > 100 else "low"),
            "notes":            notes if notes else None,
        },
        "engineering": {
            "deflection_in":         round(deflection, 5),
            "chip_thickness_in":     round(ipt, 6),
            "chatter_index":         round(stability_pct / 100.0, 3),
            "teeth_in_cut":          round(flutes * 1.0, 2),  # full-slot: all teeth in cut
            "helix_wrap_deg":        None,
            "engagement_continuous": True,
            "tool_life_min":         round(tool_life_min, 1),
            "force_lbf":             round(total_force, 2),
            "torque_inlbf":          round(hp_required * 63025.0 / rpm, 3) if rpm > 0 else None,
            "torque_capacity_inlbf": SPINDLE_TORQUE_CAPACITY.get(str(payload.get("spindle_taper", "CAT40")), None),
            "torque_pct":            None,
        },
        "stability": {
            "stickout_in":         round(stickout, 4),
            "l_over_d":            round(stickout / D, 2) if D > 0 else 0,
            "deflection_in":       round(deflection, 5),
            "deflection_limit_in": 0.001,
            "deflection_pct":      round((deflection / 0.001) * 100.0, 1),
            "stability_pct":       stability_pct,
            "suggestions":         [],
        },
        "keyseat": {
            "arbor_dia_in":     arbor_dia if arbor_dia > 0 else None,
            "doc_in":           round(doc_in, 4),
            "max_safe_doc_in":  round(max_safe_doc, 4),
            "flute_reach_in":   round(flute_reach, 4),
            "engagement":       "full_slot",
            "multi_pass":       multi_pass,
            "tips":             tips,
        },
        "debug": None,
    }


def run_dovetail(payload: dict) -> dict:
    """Speed & feed calc for dovetail cutters.
    SFM based on tool_dia (maximum cutting diameter).
    dovetail_angle = included angle of the dovetail (e.g. 45° or 60°).
    """
    D              = float(payload.get("tool_dia", 0.5) or 0.5)
    flutes         = int(payload.get("flutes", 4) or 4)
    loc            = float(payload.get("loc", 0.5) or 0.5)
    lbs            = float(payload.get("lbs", 0.0) or 0.0)
    arbor_dia      = float(payload.get("keyseat_arbor_dia", 0.0) or 0.0)
    stickout       = float(payload.get("stickout", 2.0) or 2.0)
    dovetail_angle = float(payload.get("dovetail_angle", 60.0) or 60.0)
    doc_xd         = float(payload.get("doc_xd", 0.5) or 0.5)
    doc_in         = doc_xd * D
    final_slot_depth = float(payload.get("final_slot_depth", 0.0) or 0.0)
    flute_reach    = (D - arbor_dia) / 2.0 if arbor_dia > 0 else D / 2.0
    if final_slot_depth > flute_reach:
        final_slot_depth = flute_reach
    mat            = str(payload.get("material", "steel_alloy") or "steel_alloy")
    mat_group      = get_material_group(mat)

    # Material toughness factor for pass depth conservatism
    _mat_factor = {"Aluminum": 1.0, "Steel": 1.5, "Stainless": 1.75,
                   "Inconel": 2.5, "Titanium": 2.0, "Cast Iron": 1.3}.get(mat_group, 1.5)
    # Reach penalty: longer reach (lbs) relative to arbor dia = more flex risk
    _reach_factor = 1.0 + (lbs / (arbor_dia * 8.0)) if (arbor_dia > 0 and lbs > 0) else 1.0
    # Max safe DOC per pass (dovetail: slightly more conservative than keyseat due to angled forces)
    max_safe_doc = (flute_reach / 2.0) / (_mat_factor * _reach_factor * 1.15)
    max_safe_doc = max(0.005, min(max_safe_doc, flute_reach))  # clamp: min 0.005", max flute_reach

    max_rpm        = float(payload.get("max_rpm", 12000) or 12000)
    rpm_util       = float(payload.get("rpm_util_pct", 0.95) or 0.95)
    coolant        = str(payload.get("coolant", "flood") or "flood").lower()
    toolholder     = str(payload.get("toolholder", "er_collet") or "er_collet").lower()
    _spindle_drive = str(payload.get("spindle_drive", "belt") or "belt").lower()
    _drive_eff     = SPINDLE_DRIVE_EFF.get(_spindle_drive, 0.92)
    machine_hp     = float(payload.get("machine_hp", 10.0) or 10.0) * _drive_eff

    # Hardness
    _hv  = float(payload.get("hardness_value", 0) or 0)
    _hs  = str(payload.get("hardness_scale", "hrc") or "hrc").lower()
    hrc  = hrb_to_hrc(_hv) if _hs == "hrb" else _hv

    # Effective cutting diameter at the widest point of the dovetail
    # For a dovetail with included angle θ: effective_dia = D (tool_dia IS the max dia)
    # RPM based on D (max cutting diameter). Note for user display.
    half_angle_rad = math.radians(dovetail_angle / 2.0)

    # SFM
    base_sfm   = DOVETAIL_SFM.get(mat, DOVETAIL_SFM.get(mat_group, 130))
    sfm_target = base_sfm * hardness_sfm_mult(hrc)

    # RPM
    target_rpm = (sfm_target * 12.0) / (math.pi * D)
    rpm        = min(target_rpm, max_rpm * rpm_util)
    rpm        = max(1.0, rpm)
    sfm_actual = (rpm * math.pi * D) / 12.0

    # Chip load — IPT_FRAC × D × 0.70 conservative for dovetail geometry
    # Lead angle chip-thinning correction: programmed fpt = chip / sin(half_angle)
    # (same model as chamfer mill). Capped at 2.0×.
    ipt_frac   = IPT_FRAC.get(mat, IPT_FRAC.get(mat_group, 0.005))
    lead_ctf   = min(2.0, 1.0 / max(0.10, math.sin(half_angle_rad)))
    ipt        = ipt_frac * D * 0.70 * lead_ctf
    feed_ipm   = rpm * flutes * ipt

    # MRR (approximate: treat as partial slot engagement)
    mrr = feed_ipm * doc_in * (D * 0.60)

    # HP & force
    _hp_unit    = HP_PER_CUIN.get(mat, HP_PER_CUIN.get(mat_group, 1.0))
    hp_required = max(0.01, mrr * _hp_unit * hardness_kc_mult(hrc))
    total_force = (hp_required * 33000.0) / max(1.0, feed_ipm / 12.0)
    radial_force = total_force * 0.45   # angled engagement splits force axially/radially

    # Deflection
    rigidity = TOOLHOLDER_RIGIDITY.get(toolholder, 1.0)
    if payload.get("dual_contact", False):
        rigidity *= 1.08
    deflection = tool_deflection(
        radial_force, stickout, D, flutes, loc, lbs, None,
        payload.get("holder_gage_length"), payload.get("holder_nose_dia"),
    )
    deflection /= rigidity

    stability_pct = round((deflection / 0.001) * 100.0, 1)

    # Tool life
    _coolant_factor = COOLANT_LIFE.get(coolant, 1.0)
    _base_life      = BASE_LIFE_MIN.get(mat, BASE_LIFE_MIN.get(mat_group, 45.0)) * 0.75
    _sfm_ratio      = sfm_actual / max(1.0, sfm_target)
    tool_life_min   = (_base_life / max(0.20, _sfm_ratio ** 0.40)) * _coolant_factor

    notes = []
    if dovetail_angle < 45:
        notes.append(
            f"Shallow dovetail angle ({dovetail_angle}°) — the steep wall creates high side thrust. "
            f"Take light axial passes and use the minimum stickout possible."
        )
    if deflection > 0.001:
        notes.append(
            f"Estimated deflection ({deflection*1000:.1f} thou) is high for dovetail geometry. "
            f"Reduce stickout, take lighter passes, or use a stiffer toolholder."
        )

    # Multi-pass strategy
    multi_pass = None
    if final_slot_depth > 0:
        num_passes = max(1, math.ceil(final_slot_depth / max_safe_doc))
        depth_per_pass = final_slot_depth / num_passes
        multi_pass = {
            "final_slot_depth_in": round(final_slot_depth, 4),
            "max_safe_doc_in":     round(max_safe_doc, 4),
            "num_passes":          num_passes,
            "depth_per_pass_in":   round(depth_per_pass, 4),
            "aggressive":          doc_in > max_safe_doc,
        }
        if num_passes > 1:
            notes.append(
                f"Multi-pass strategy recommended: {num_passes} passes of {depth_per_pass:.4f}\" each "
                f"to reach {final_slot_depth:.4f}\" final slot depth. "
                f"Max safe pass depth for this tool/material: {max_safe_doc:.4f}\"."
            )
        if doc_in > max_safe_doc * 1.25:
            notes.append(
                f"⚠ Entered pass depth ({doc_in:.4f}\") exceeds recommended safe limit ({max_safe_doc:.4f}\") "
                f"for this dovetail neck diameter and material. Tool breakage risk is elevated."
            )

    tips = [
        f"Dovetail angle is {dovetail_angle}° included — chip load corrected for lead angle (÷ sin({dovetail_angle/2:.0f}°)).",
        "Make multiple light axial passes rather than one full-depth pass. Dovetail walls are unforgiving of deflection.",
        "Climb milling direction for better finish on the angled walls.",
        "Keep the tool as short as possible — dovetail cutters are very sensitive to stickout.",
    ]

    return {
        "customer": {
            "material":         mat,
            "diameter":         D,
            "flutes":           flutes,
            "rpm":              round(rpm),
            "sfm":              round(sfm_actual, 1),
            "sfm_target":       round(sfm_target, 1),
            "feed_ipm":         round(feed_ipm, 2),
            "doc_in":           round(doc_in, 4),
            "woc_in":           round(D, 4),
            "mrr_in3_min":      round(mrr, 3),
            "spindle_load_pct": round((hp_required / machine_hp) * 100.0, 1) if machine_hp > 0 else 0.0,
            "hp_required":      round(hp_required, 3),
            "fpt":              round(ipt, 6),
            "adj_fpt":          None,
            "peripheral_feed_ipm": None,
            "ci_a_e_in":        None,
            "ci_feed_ratio":    None,
            "status":           "warning" if stability_pct > 100 else "ok",
            "status_hint":      "High deflection — reduce stickout or take lighter passes" if stability_pct > 100 else None,
            "risk":             "high" if stability_pct > 175 else ("medium" if stability_pct > 100 else "low"),
            "notes":            notes if notes else None,
        },
        "engineering": {
            "deflection_in":         round(deflection, 5),
            "chip_thickness_in":     round(ipt / max(0.1, lead_ctf), 6),  # actual chip thickness before lead CTF
            "chatter_index":         round(stability_pct / 100.0, 3),
            "teeth_in_cut":          round(flutes * 0.5, 2),  # approximate: ~half-engagement
            "helix_wrap_deg":        None,
            "engagement_continuous": True,
            "tool_life_min":         round(tool_life_min, 1),
            "force_lbf":             round(total_force, 2),
            "torque_inlbf":          round(hp_required * 63025.0 / rpm, 3) if rpm > 0 else None,
            "torque_capacity_inlbf": SPINDLE_TORQUE_CAPACITY.get(str(payload.get("spindle_taper", "CAT40")), None),
            "torque_pct":            None,
        },
        "stability": {
            "deflection_in":  round(deflection, 5),
            "stability_pct":  stability_pct,
            "suggestions":    [],
        },
        "dovetail": {
            "dovetail_angle_deg": dovetail_angle,
            "doc_in":             round(doc_in, 4),
            "max_safe_doc_in":    round(max_safe_doc, 4),
            "flute_reach_in":     round(flute_reach, 4),
            "lead_ctf":           round(lead_ctf, 3),
            "multi_pass":         multi_pass,
            "tips":               tips,
        },
        "debug": None,
    }


def run_feedmill(payload: dict) -> dict:
    """Speed & feed calc for solid carbide high-feed endmills (endwork / 3D roughing).
    Lead angle chip thinning: programmed FPT = actual chip / sin(lead_angle).
    Axial force is dominant — deflection is low; HP and chip evacuation are the constraints.
    """
    D           = float(payload.get("tool_dia", 0.5) or 0.5)
    flutes      = int(payload.get("flutes", 4) or 4)
    loc         = float(payload.get("loc", 0.5) or 0.5)
    stickout    = float(payload.get("stickout", 2.0) or 2.0)
    corner_r    = float(payload.get("corner_radius", 0.0) or 0.0)
    lead_angle  = float(payload.get("lead_angle", 20.0) or 20.0)
    mat         = str(payload.get("material", "steel_alloy") or "steel_alloy")
    mat_group   = get_material_group(mat)
    toolholder  = str(payload.get("toolholder", "er_collet") or "er_collet").lower()
    coolant     = str(payload.get("coolant", "flood") or "flood").lower()
    _spindle_drive = str(payload.get("spindle_drive", "direct") or "direct").lower()
    _drive_eff     = SPINDLE_DRIVE_EFF.get(_spindle_drive, 0.96)
    machine_hp     = float(payload.get("machine_hp", 10.0) or 10.0) * _drive_eff
    max_rpm        = float(payload.get("max_rpm", 12000) or 12000)
    rpm_util       = float(payload.get("rpm_util_pct", 0.95) or 0.95)

    # Hardness
    _hv  = float(payload.get("hardness_value", 0) or 0)
    _hs  = str(payload.get("hardness_scale", "hrc") or "hrc").lower()
    hrc  = hrb_to_hrc(_hv) if _hs == "hrb" else _hv

    # Lead angle chip thinning factor
    lead_rad   = math.radians(max(1.0, min(lead_angle, 45.0)))
    lead_sin   = math.sin(lead_rad)
    lead_ctf   = 1.0 / lead_sin   # programmed FPT multiplier (e.g. 2.92× at 20°)

    # SFM and RPM
    base_sfm   = FEEDMILL_SFM.get(mat, FEEDMILL_SFM.get(mat_group, 300))
    sfm_target = base_sfm * hardness_sfm_mult(hrc)
    target_rpm = (sfm_target * 12.0) / (math.pi * D)
    rpm        = min(target_rpm, max_rpm * rpm_util)
    rpm        = max(1.0, rpm)
    sfm_actual = (rpm * math.pi * D) / 12.0

    # Chip load — base IPT from standard milling table × 1.15 feed mill boost,
    # then amplify by lead CTF.
    # The 1.15× accounts for feed mill geometry running hotter chip loads than
    # a conventional endmill at the same diameter (shop-validated chart data).
    ipt_base       = IPT_FRAC.get(mat, IPT_FRAC.get(mat_group, 0.005)) * D * 1.15
    programmed_fpt = ipt_base * lead_ctf   # what gets programmed in CAM

    # L/D ratio — used for long-reach derating
    ld_ratio = stickout / D if D > 0 else 0.0

    # Long-reach derating: reduce DOC and IPT when stickout is high.
    # Feed mills are forgiving radially but axial overload increases with reach.
    if ld_ratio > 6.0:
        _ld_doc_factor = 0.65   # 35% DOC reduction at L/D > 6
        _ld_ipt_factor = 0.80   # 20% IPT reduction
    elif ld_ratio > 4.0:
        _ld_doc_factor = 0.80   # 20% DOC reduction at L/D 4–6
        _ld_ipt_factor = 0.90   # 10% IPT reduction
    else:
        _ld_doc_factor = 1.00
        _ld_ipt_factor = 1.00

    ipt_base       *= _ld_ipt_factor
    programmed_fpt  = ipt_base * lead_ctf

    # Feed rate
    feed_ipm = rpm * flutes * programmed_fpt

    # DOC — two constraints: corner radius geometry limit + axial depth limit
    # CR limit: max = 1.5×CR (overloads dual-radius contact zone beyond this)
    # Axial limit: max = 0.15×D (shop-validated for solid carbide HFM)
    # Recommended: 0.10×D or 0.8×CR, whichever is smaller
    cr_max_doc   = corner_r * 1.5 if corner_r > 0 else D * 0.15
    axial_max    = D * 0.15
    max_doc_in   = min(cr_max_doc, axial_max) * _ld_doc_factor
    rec_doc_in   = min(corner_r * 0.8 if corner_r > 0 else D * 0.10, D * 0.12) * _ld_doc_factor
    rec_doc_in   = max(rec_doc_in, D * 0.02)   # floor: at least 2% dia

    doc_in = float(payload.get("feedmill_doc_in", 0.0) or 0.0)
    if doc_in <= 0:
        doc_in = rec_doc_in

    # WOC — HFM sweet spot is 6–12% of diameter. Default to 8%.
    # Do NOT use the standard milling woc_pct (50%) — that would destroy a feed mill.
    _woc_payload = float(payload.get("woc_pct", 0.0) or 0.0)
    woc_pct = _woc_payload if (_woc_payload > 0 and _woc_payload <= 25.0) else 8.0
    woc_in  = (woc_pct / 100.0) * D

    # MRR
    mrr = feed_ipm * doc_in * woc_in

    # HP
    _hp_unit    = HP_PER_CUIN.get(mat, HP_PER_CUIN.get(mat_group, 1.0))
    hp_required = max(0.01, mrr * _hp_unit * hardness_kc_mult(hrc))
    hp_util_pct = (hp_required / machine_hp * 100.0) if machine_hp > 0 else 0.0

    # Deflection — axial force dominant so radial deflection is low,
    # but long-reach setups can still deflect laterally on entry/exit.
    # Use a reduced radial fraction (0.15) vs standard milling (0.30).
    total_force  = (hp_required * 33000.0) / max(1.0, feed_ipm / 12.0)
    radial_force = total_force * 0.15
    rigidity     = TOOLHOLDER_RIGIDITY.get(toolholder, 1.0)
    if payload.get("dual_contact", False):
        rigidity *= 1.08
    deflection = tool_deflection(
        radial_force, stickout, D, flutes, loc, 0.0, None,
        payload.get("holder_gage_length"), payload.get("holder_nose_dia"),
    )
    deflection /= rigidity

    # Max ramp angle — feed mill can ramp steeper than a standard endmill because
    # axial force goes into the spindle. Conservative limit: lead_angle − 3°.
    ramp_angle_max = max(2.0, lead_angle - 3.0)

    # Stability — feed mills rarely deflect into chatter; flag if long reach
    stability_pct = round((deflection / 0.0005) * 100.0, 1)  # 0.0005" threshold for endwork

    # Warnings
    notes = []
    if doc_in > max_doc_in * 1.05:   # 5% tolerance
        notes.append(
            f"DOC ({doc_in:.4f}\") exceeds recommended max ({max_doc_in:.4f}\") for this tool size. "
            f"Reduce to avoid overloading the dual-radius corner zone."
        )
    if hrc > 52:
        # Hard derating above design limit — already baked into sfm_target via hardness_sfm_mult,
        # but add explicit user warning
        notes.append(
            f"Material hardness ({hrc:.0f} HRC) exceeds this tool's 52 HRC design limit. "
            "SFM has been derated. Expect significantly shorter tool life — inspect after every pocket."
        )
    if ld_ratio > 6:
        notes.append(
            f"L/D ratio ({ld_ratio:.1f}×) — DOC and IPT auto-derated 35%/20% for long reach. "
            "Use helical ramp entry and smooth constant-engagement paths."
        )
    elif ld_ratio > 4:
        notes.append(
            f"L/D ratio ({ld_ratio:.1f}×) — DOC and IPT auto-derated 20%/10% for extended reach."
        )
    if hp_util_pct > 90:
        notes.append(
            f"HP utilization ({hp_util_pct:.0f}%) is high. Reduce WOC first, then DOC — "
            "never reduce IPT below minimum chip thickness or you'll rub instead of cut."
        )

    # Tool life
    _coolant_factor = COOLANT_LIFE.get(coolant, 1.0)
    _base_life      = BASE_LIFE_MIN.get(mat, BASE_LIFE_MIN.get(mat_group, 60.0)) * 1.20  # light DOC = longer life
    _sfm_ratio      = sfm_actual / max(1.0, sfm_target)
    tool_life_min   = (_base_life / max(0.20, _sfm_ratio ** 0.35)) * _coolant_factor

    tips = [
        f"Lead angle chip thinning at {lead_angle:.0f}°: program FPT at {programmed_fpt:.5f}\" "
        f"— actual chip on the tool is only {ipt_base:.5f}\". This is correct. Do not reduce feed.",
        f"WOC is your control knob. Running at {woc_pct:.0f}% ({woc_in:.4f}\"). "
        f"Sweet spot is 6–12% of diameter. Adjust WOC first if anything goes wrong — not feed.",
        f"Ramp angle up to {ramp_angle_max:.0f}°. Feed mills ramp far steeper than standard endmills "
        "because axial force drives into the spindle. Use helical or ramp entry — no straight plunge.",
        f"Target DOC: {rec_doc_in:.4f}\". Max: {max_doc_in:.4f}\". "
        "High DOC + low WOC unlocks HFM performance. Low DOC + high WOC defeats it.",
        "Do not use for slotting, side milling, or finishing walls. HFM lives on controlled radial "
        "engagement + high feed — full slot engagement will break it.",
    ]
    if _ld_doc_factor < 1.0:
        tips.append(
            f"Long reach detected (L/D {ld_ratio:.1f}×): parameters auto-derated. "
            "Use adaptive/constant-engagement toolpaths and smooth corner linking — no sharp direction changes."
        )

    return {
        "customer": {
            "material":         mat,
            "diameter":         D,
            "flutes":           flutes,
            "rpm":              round(rpm),
            "sfm":              round(sfm_actual, 1),
            "sfm_target":       round(sfm_target, 1),
            "feed_ipm":         round(feed_ipm, 2),
            "doc_in":           round(doc_in, 4),
            "woc_in":           round(woc_in, 3),
            "mrr_in3_min":      round(mrr, 3),
            "spindle_load_pct": round(hp_util_pct, 1),
            "hp_required":      round(hp_required, 3),
            "fpt":              round(programmed_fpt, 6),
            "adj_fpt":          round(ipt_base, 6),
            "status":           "warning" if (notes and any("HRC" in n or "DOC" in n for n in notes)) else "ok",
            "status_hint":      notes[0] if notes else None,
            "risk":             "high" if stability_pct > 175 else ("medium" if stability_pct > 100 else "low"),
            "notes":            notes if notes else None,
        },
        "engineering": {
            "deflection_in":         round(deflection, 5),
            "chip_thickness_in":     round(ipt_base, 6),
            "chatter_index":         round(stability_pct / 100.0, 3),
            "teeth_in_cut":          round(flutes * (woc_pct / 100.0), 2),
            "tool_life_min":         round(tool_life_min, 1),
            "force_lbf":             round(total_force, 2),
            "radial_force_lbf":      round(radial_force, 2),
        },
        "stability": {
            "stickout_in":         round(stickout, 4),
            "l_over_d":            round(ld_ratio, 2),
            "deflection_in":       round(deflection, 5),
            "deflection_limit_in": 0.0005,
            "deflection_pct":      stability_pct,
            "stability_pct":       stability_pct,
            "suggestions":         [],
        },
        "feedmill": {
            "lead_angle_deg":     lead_angle,
            "lead_ctf":           round(lead_ctf, 3),
            "programmed_fpt_in":  round(programmed_fpt, 6),
            "actual_chip_in":     round(ipt_base, 6),
            "doc_in":             round(doc_in, 4),
            "rec_doc_in":         round(rec_doc_in, 4),
            "max_doc_in":         round(max_doc_in, 4),
            "woc_pct":            round(woc_pct, 1),
            "woc_in":             round(woc_in, 4),
            "ramp_angle_max_deg": round(ramp_angle_max, 1),
            "corner_radius_in":   corner_r if corner_r > 0 else None,
            "ld_ratio":           round(ld_ratio, 2),
            "ld_derated":         _ld_doc_factor < 1.0,
            "tips":               tips,
        },
        "debug": None,
    }


def run(payload=None):
    payload = payload or {}

    # Route to drilling engine if operation == "drilling"
    if str(payload.get("operation", "milling")).lower() == "drilling":
        return run_drilling(payload)

    # Route to reaming engine
    if str(payload.get("operation", "milling")).lower() == "reaming":
        return run_reaming(payload)

    # Route to thread milling engine
    if str(payload.get("operation", "milling")).lower() == "threadmilling":
        return run_thread_mill(payload)

    # Route to feed mill engine
    if str(payload.get("operation", "milling")).lower() == "feedmill":
        return run_feedmill(payload)

    # Route to keyseat engine
    if str(payload.get("operation", "milling")).lower() == "keyseat":
        return run_keyseat(payload)

    # Route to dovetail engine
    if str(payload.get("operation", "milling")).lower() == "dovetail":
        return run_dovetail(payload)

    # Route to chamfer mill engine
    if str(payload.get("tool_type", "")).lower() == "chamfer_mill":
        return run_chamfer_mill(payload)

    # --- UI payload → local data with safe defaults ---

    mode = payload.get("mode", "hem")
    material = payload.get("material", "steel")
    tool_dia = float(payload.get("tool_dia", 0.5))
    flutes = int(payload.get("flutes", 6 if mode in ("hem", "trochoidal") else 4))
    debug = bool(payload.get("debug", False))
    emit = bool(payload.get("debug", False))  # or a separate flag like payload.get("emit_reports")

    # Build/override local data dict so existing code keeps working
    # If you had a global `data` dict already, copy it; otherwise start fresh.
    try:
        base = dict(data)  # uses existing global if present
    except Exception:
        base = {}

    data = base
    data.update(payload)
    data.setdefault("mode", mode)
    data.setdefault("material", material)
    data.setdefault("tool_dia", tool_dia)
    data.setdefault("diameter", tool_dia)
    data.setdefault("flutes", flutes)
    data.setdefault("toolholder", payload.get("toolholder", "er_collet"))
    data["dual_contact"] = bool(payload.get("dual_contact", False))
    data.setdefault("spindle_taper", payload.get("spindle_taper", "CAT40"))
    data.setdefault("machine_type", payload.get("machine_type", "vmc"))
    data.setdefault("workholding", payload.get("workholding", "vise"))
    data.setdefault("max_rpm", int(payload.get("max_rpm", payload.get("machine_max_rpm", 12000))))
    data.setdefault("rpm_util_pct", float(payload.get("rpm_util_pct", 0.95)))
    data.setdefault("woc_pct", float(payload.get("woc_pct", 0.10)))
    data.setdefault("doc_xd", float(payload.get("doc_xd", 1.0)))

    # Apply mode-based smart defaults when the payload didn't supply explicit values
    if "woc_pct" not in payload or "doc_xd" not in payload:
        default_woc, default_doc = get_mode_defaults(mode, material)
        if "woc_pct" not in payload:
            data["woc_pct"] = default_woc
        if "doc_xd" not in payload:
            data["doc_xd"] = default_doc

    _spindle_drive = str(payload.get("spindle_drive", "belt") or "belt").lower()
    _drive_eff = SPINDLE_DRIVE_EFF.get(_spindle_drive, 0.92)
    data.setdefault("machine_hp", float(payload.get("machine_hp", 10.0)) * _drive_eff)
    data.setdefault("stickout", float(payload.get("stickout", 2.0)))
    data.setdefault("coolant", payload.get("coolant", "flood"))
    data.setdefault("geometry", payload.get("geometry", "standard"))

    # Hardness — convert HRB → HRC if needed, store as hrc in data
    _hv = float(payload.get("hardness_value", 0) or 0)
    _hs = str(payload.get("hardness_scale", "hrc") or "hrc").lower()
    _hrc = hrb_to_hrc(_hv) if _hs == "hrb" else _hv
    data["hardness_hrc"] = _hrc

    # ── Shank diameter → composite beam model ────────────────────────────────
    # For tools with a larger shank than cutting dia (e.g. QTR3: 0.250" shank,
    # 1/16–1/4" cutting dia), the deflection model uses a two-segment cantilever:
    # LOC segment at cutting dia (flexible) + shank segment at shank_dia (stiff).
    # This produces dramatically lower predicted deflection vs single-beam model.
    _shank_dia = float(payload.get("shank_dia", 0) or 0)
    if _shank_dia > float(data.get("diameter", 0)):
        data["neck_dia"] = _shank_dia  # physics.tool_deflection uses neck_dia for the body segment

    # ── Helix angle resolution ────────────────────────────────────────────────
    # Priority: payload helix_angle (SKU column) → SERIES_HELIX lookup → default 35°
    _helix_raw = payload.get("helix_angle") or payload.get("helix")
    _series = str(payload.get("tool_series", "") or "").strip().upper()
    if _helix_raw:
        data["helix"] = int(float(_helix_raw))
    elif "helix" not in data or data["helix"] == 35:
        if _series in SERIES_HELIX:
            data["helix"] = SERIES_HELIX[_series]

    # Series-specific core ratio — used by tool_deflection() for accurate stiffness
    if _series in SERIES_CORE_RATIO:
        data["core_ratio"] = SERIES_CORE_RATIO[_series]

    # Series-specific radial rake — applied in cutting_force_per_tooth() via RAKE_FORCE_FACTOR
    if _series in SERIES_RADIAL_RAKE:
        data["radial_rake"] = SERIES_RADIAL_RAKE[_series]

    # ── Circular Interpolation pre-processing ───────────────────────────────
    # Derive WOC and feed correction factor from hole geometry.
    # D_m  = tool diameter
    # D_w  = existing hole diameter
    # D_cap = target hole diameter
    # a_e  = radial wall to remove per pass = (D_cap - D_w) / 2
    # Feed correction: peripheral feed > tool-center feed by ratio D_cap/D_m
    # → programmed (tool-center) feed = straight-calc feed × (D_m / D_cap)
    _ci_a_e_in = None
    _ci_feed_ratio = None
    if mode == "circ_interp":
        _d_w   = float(payload.get("existing_hole_dia", 0) or 0)
        _d_cap = float(payload.get("target_hole_dia",   0) or 0)
        _d_m   = float(payload.get("tool_dia", tool_dia) or tool_dia)
        if _d_cap > _d_w > 0 and _d_m > 0:
            _ci_a_e_in = (_d_cap - _d_w) / 2.0
            # Cap a_e at full tool diameter (can't engage more than the tool width)
            _ci_a_e_in = min(_ci_a_e_in, _d_m)
            data["woc_pct"] = (_ci_a_e_in / _d_m) * 100.0
            _ci_feed_ratio = _d_m / _d_cap   # multiply straight-calc feed by this to get programmed feed
        # Bore depth is a user-entered feature dimension (doc_xd from form); no default override.
    # ── end circ_interp pre-processing ──────────────────────────────────────

    # Ensure these always exist even in stiffness-limited / early-exit branches
    # Ensure these always exist even in stiffness-limited / early-exit branches
    mrr = 0.0
    hp_required = 0.0
    spindle_load = 0.0
    hp = 0.0
    load = 0.0

    # If mrr never got assigned in this branch, compute a fallback
    try:
        if mrr == 0.0:
            feed_ipm = locals().get("feed") or locals().get("feed_ipm")
            doc_in = locals().get("doc") or locals().get("doc_in")
            woc_in = locals().get("woc") or locals().get("woc_in")

            if feed_ipm is not None and doc_in is not None and woc_in is not None:
                mrr = float(feed_ipm) * float(doc_in) * float(woc_in)
    except Exception:
        mrr = 0.0

    quiet = bool(payload.get("quiet", True))   # UI sets True
    debug = bool(payload.get("debug", False))  # only show logs if True
    emit = (not quiet) or debug                # CLI can set quiet=False

    # If mrr never got assigned in this branch, compute a fallback
    try:
        if mrr == 0.0:
            # feed/doc/woc variable names vary; try common ones
            feed_ipm = locals().get("feed") or locals().get("feed_ipm")
            doc_in = locals().get("doc") or locals().get("doc_in")
            woc_in = locals().get("woc") or locals().get("woc_in")

            if feed_ipm is not None and doc_in is not None and woc_in is not None:
                mrr = float(feed_ipm) * float(doc_in) * float(woc_in)
    except Exception:
        mrr = 0.0
        
    if debug:
        import sys
        print("🔥 RUN FUNCTION EXECUTING 🔥", file=sys.stderr)
        
    hem_report_init(data)
  
    debug = bool(data.get("debug", False))

    feed_scale = 1.0  # default: no feed reduction unless we compute one
    
    material_group = get_material_group(data["material"])
    
    # --- BALLNOSE STRATEGY LAYER (strategy only; does not touch physics) ---
    tool_type = (data.get("tool_type") or "").lower()
    mode = (data.get("mode") or "").lower()
    is_ball = tool_type in ("ball", "ballnose", "ball_nose") or mode == "ballnose"
    ball_finish_mode = is_ball
    
    flutes = int(data.get("flutes", 6 if data["mode"] in ("hem", "trochoidal") else 4))
    coating = "T-Max" if material_group in [
        "Inconel", "Titanium", "Stainless"
    ] else "P-Max"

    rigidity = rigidity_factor(data)

    auto_doc_woc = (data.get("mode","").lower() in ("hem", "trochoidal"))

    # --- Apply mode-based defaults (only when not provided) ---
    mode = (data.get("mode") or "hem").lower()
    material = (data.get("material") or "steel_generic")

    woc_pct = data.get("woc_pct", None)
    doc_xd  = data.get("doc_xd", None)

    # Treat None/0 as "not provided" because UI often sends 0
    needs_woc = (woc_pct is None) or (isinstance(woc_pct, (int, float)) and woc_pct <= 0)
    needs_doc = (doc_xd  is None) or (isinstance(doc_xd,  (int, float)) and doc_xd  <= 0)

    if needs_woc or needs_doc:
        default_woc, default_doc = get_mode_defaults(mode, material)
        if needs_woc:
            woc_pct = default_woc
            data["woc_pct"] = woc_pct
        if needs_doc:
            doc_xd = default_doc
            data["doc_xd"] = doc_xd
    # --- end defaults ---

    # ── Surfacing (3D contouring) — D_eff at contact point ────────────────────
    _surf_d_eff        = None
    _surf_scallop_h    = None
    _surf_stepover_in  = None
    _surf_stepover_pct = None

    if mode == "surfacing":
        auto_doc_woc = False  # no HEM optimizer for 3D surfacing
        _surf_ap  = float(data.get("surfacing_ap_in")  or 0.0)
        _surf_D   = float(data.get("diameter",  0.5))
        _surf_R   = _surf_D / 2.0
        _surf_cc  = (data.get("corner_condition") or "ball").lower()
        _surf_CR  = float(data.get("corner_radius") or 0.0)
        _input_m  = str(data.get("surfacing_input_mode") or "stepover").lower()

        # Tool tilt angle (degrees from vertical / surface normal)
        _surf_tilt_deg = float(data.get("surfacing_tilt_deg") or 0.0)
        _surf_tilt_rad = math.radians(max(0.0, min(30.0, _surf_tilt_deg)))

        # D_eff at the contact point
        if _surf_cc == "ball":
            if _surf_tilt_rad > 0.0001:
                # Tilted ball nose: contact shifts away from dead zone
                # D_eff = 2 × sqrt(R² − (R·cos(θ) − ap)²)
                _tilt_offset = _surf_R * math.cos(_surf_tilt_rad)
                _ap_adj = min(_surf_ap, _surf_R + _tilt_offset)  # max depth reachable
                _inner = _surf_R**2 - (_tilt_offset - _ap_adj)**2
                _surf_d_eff = 2.0 * math.sqrt(max(0.0, _inner))
            else:
                _ap_c = max(0.0001, min(_surf_ap, _surf_R))
                _surf_d_eff = 2.0 * math.sqrt(max(0.0, 2.0 * _surf_R * _ap_c - _ap_c**2))
        elif _surf_cc == "corner_radius" and _surf_CR > 0:
            if _surf_ap <= _surf_CR:
                _ap_c = max(0.0001, min(_surf_ap, _surf_CR))
                _surf_d_eff = (_surf_D - 2.0*_surf_CR) + 2.0 * math.sqrt(max(0.0, 2.0*_surf_CR*_ap_c - _ap_c**2))
            else:
                _surf_d_eff = _surf_D
        else:
            _surf_d_eff = _surf_D
        _surf_d_eff = min(max(0.001, _surf_d_eff), _surf_D)  # cap at full OD

        # Scallop radius for cusp height formula
        if _surf_cc == "ball":
            _R_sc = _surf_R
        elif _surf_cc == "corner_radius" and _surf_CR > 0 and _surf_ap <= _surf_CR:
            _R_sc = _surf_CR
        else:
            _R_sc = _surf_R

        # Stepover: derive from scallop target or use direct input
        if _input_m == "scallop":
            _sc_target = float(data.get("surfacing_scallop_in") or 0.001)
            _surf_ae = math.sqrt(8.0 * _R_sc * _sc_target) if _R_sc > 0 else _surf_D * 0.10
            _surf_ae = min(_surf_ae, _surf_D * 0.5)
        else:
            _surf_ae = float(data.get("surfacing_stepover_in") or _surf_D * 0.10)

        _surf_scallop_h    = (_surf_ae**2) / (8.0 * _R_sc) if _R_sc > 0 else 0.0
        _surf_stepover_in  = _surf_ae
        _surf_stepover_pct = (_surf_ae / _surf_D * 100.0) if _surf_D > 0 else 0.0

        # Override WOC/DOC so downstream MRR, force, deflection use surfacing geometry
        data["woc_pct"] = (_surf_ae / _surf_D * 100.0) if _surf_D > 0 else 10.0
        data["doc_xd"]  = (_surf_ap / _surf_D) if _surf_D > 0 and _surf_ap > 0 else 0.1

    if ball_finish_mode:
        auto_doc_woc = False  # no HEM optimizer / auto DOC-WOC for ball finish

        # Scallop -> stepover (WOC)
        target_scallop = data.get("target_scallop", None)
        diameter = float(data["diameter"])
        radius = diameter / 2.0

        if target_scallop:
            ball_woc = (8.0 * radius * float(target_scallop)) ** 0.5
            data["woc"] = ball_woc
            data["woc_pct"] = (ball_woc / diameter) * 100.0
   
    flutes = data.get("flutes", 4)

    if flutes == 5:
        rigidity *= 1.15
    elif flutes >= 6:
        rigidity *= 1.30

    _mat_key = data.get("material", material_group)
    base_sfm = BASE_SFM.get(_mat_key, BASE_SFM.get(material_group, 300))
    if data["mode"] in ("hem", "trochoidal"):
        base_sfm *= 2.0  # HEM = 2× conventional for all materials

    # Apply hardness SFM reduction — skip for Inconel/HRSA (hardness is intrinsic, not a variable)
    _hrc = float(data.get("hardness_hrc", 0) or 0)
    _no_hrc_penalty = ("Inconel", "hiTemp_fe", "hiTemp_co", "hardened_lt55", "hardened_gt55",
                        "tool_steel_p20", "tool_steel_a2", "tool_steel_h13", "tool_steel_s7", "tool_steel_d2",
                        "cpm_10v", "armor_milspec", "armor_ar400", "armor_ar500", "armor_ar600",
                        # PH/duplex stainless: SFM already calibrated for their hardness range — don't double-penalize
                        "stainless_ph", "stainless_duplex", "stainless_superduplex",
                        "stainless_440c", "stainless_420")
    _mat_key_hrc = data.get("material", material_group)
    if material_group not in _no_hrc_penalty and _mat_key_hrc not in _no_hrc_penalty:
        base_sfm *= hardness_sfm_mult(_hrc)

    # Apply coating SFM multiplier — T-Max +10%, D-Max on ferrous -10%, etc.
    _coating_key = str(data.get("coating") or "").strip()
    base_sfm *= _coating_sfm_factor(_coating_key, material_group)

    # Surfacing: RPM driven by D_eff at contact point, not tool OD
    _sfm_dia = _surf_d_eff if (mode == "surfacing" and _surf_d_eff) else data["diameter"]
    target_rpm = (base_sfm * 3.82) / _sfm_dia
    rpm_cap = data["max_rpm"] * data["rpm_util_pct"]
    rpm = min(target_rpm, rpm_cap)
    sfm_actual = (rpm * _sfm_dia) / 3.82
    # Detect RPM-limited condition — spindle ceiling prevents reaching target SFM
    _rpm_limited = rpm < (target_rpm * 0.97)  # >3% below target = genuinely capped
    _sfm_pct_of_target = (sfm_actual / base_sfm * 100) if base_sfm > 0 else 100.0

    _ipt_frac = IPT_FRAC.get(_mat_key, IPT_FRAC.get(material_group, 0.005))
    ipt = _ipt_frac * data["diameter"]
    # Apply holder runout correction: lower runout holders can exploit more of the rated IPT
    _runout_factor = HOLDER_RUNOUT_FACTOR.get(data.get("toolholder", "er_collet"), 0.92)
    ipt *= _runout_factor
    # Workholding feed scaler: weak workholding (toe clamps, soft jaws) requires backing off
    # chip load to avoid chattering the part loose. Rigid fixtures allow a small boost.
    # Cap upside at +5% (conservative — rigidity gain is already captured in stability score).
    _wh_key_feed = str(data.get("workholding", "vise") or "vise")
    _wh_factor_feed = WORKHOLDING_COMPLIANCE.get(_wh_key_feed, 1.0)
    _wh_feed_mult = max(0.70, min(1.05, 1.0 / _wh_factor_feed))
    ipt *= _wh_feed_mult
    # Surfacing: chip thinning based on stepover vs D_eff; otherwise standard woc_pct vs diameter
    if mode == "surfacing" and _surf_d_eff and _surf_stepover_in:
        _surf_ae_pct = (_surf_stepover_in / _surf_d_eff) * 100.0
        chip_factor = chip_thinning_factor(_surf_ae_pct, _surf_d_eff)
    else:
        chip_factor = chip_thinning_factor(data["woc_pct"], data["diameter"])
    ipt *= chip_factor
    # HEM/trochoidal programmed chip load boost (on top of chip thinning)
    if data["mode"] in ("hem", "trochoidal"):
        _hem_ipt_mult = HEM_IPT_MULT.get(_mat_key, HEM_IPT_MULT.get(material_group, 2.0))
        ipt *= _hem_ipt_mult

    doc = data["doc_xd"] * data["diameter"]
    woc = (data["woc_pct"] / 100) * data["diameter"]
    original_woc = woc

    state = calc_state(rpm, flutes, ipt, doc, woc, data, material_group, rigidity)
       
    original_deflection = state["deflection"]

    # ===============================
    # DOC FEASIBILITY SOLVER
    # ===============================

    # Effective deflection limit — apply the same bonuses as calc_state's _dlim
    # so the solver doesn't suggest DOC reductions that the stability display wouldn't flag.
    _base_dlim = float(data.get("deflection_limit", 0.001))
    _vp = bool(data.get("variable_pitch", False))
    _vh = bool(data.get("variable_helix", False))
    if _vp and _vh:
        _base_dlim *= 1.75
    elif _vp:
        _base_dlim *= 1.50
    elif _vh:
        _base_dlim *= 1.25
    _mode_eff = str(data.get("mode", "") or "").lower()
    _woc_eff = float(data.get("woc_pct", 50) or 50)
    if _mode_eff in ("hem", "trochoidal") and _woc_eff < 15.0:
        _base_dlim *= 2.0
    _wh_key_sol = str(data.get("workholding", "vise") or "vise")
    _base_dlim /= WORKHOLDING_COMPLIANCE.get(_wh_key_sol, 1.0)
    deflection_limit = _base_dlim
    current_doc = doc  # current axial depth of cut

    if original_deflection > deflection_limit and current_doc > 0:
        doc_feasible = current_doc * (deflection_limit / original_deflection)

        # Convert to ×D for readability
        doc_xd_feasible = doc_feasible / data["diameter"] if data["diameter"] > 0 else 0

        print(
            f"⚠ Max DOC at current WOC for deflection limit: "
            f"{doc_feasible:.3f}\" ({doc_xd_feasible:.2f}×D)"
        )

        # Back-solve max WOC at current DOC for deflection limit
        if original_deflection > 0:
            max_woc_for_doc = original_woc * (deflection_limit / original_deflection)
            max_woc_pct = (max_woc_for_doc / data["diameter"]) * 100 if data["diameter"] > 0 else 0

            print(
                f"⚠ Max WOC at current DOC for deflection limit: "
                f"{max_woc_for_doc:.4f}\" ({max_woc_pct:.1f}% Ø)"
            )
        # Finish feasibility check (ball finishing)
        if ball_finish_mode and ("target_scallop" in data) and (diameter > 0):
            R = diameter / 2.0
            target_h = float(data["target_scallop"])
            required_stepover = (8.0 * R * target_h) ** 0.5

            if required_stepover > max_woc_for_doc:
                ratio = required_stepover / max(1e-12, max_woc_for_doc)
                print(f"⚠ Finish stepover {required_stepover:.4f}\" exceeds deflection-feasible WOC {max_woc_for_doc:.4f}\".")
                print(f"   Required stiffness increase: ~{ratio:.1f}×")

                L_old = float(data.get("stickout", 0) or 0)
                if L_old > 0:
                    L_new = L_old / (ratio ** (1.0 / 3.0))
                    state["finish_stickout_target"] = L_new

                print("   To hit finish: reduce stickout, reduce DOC, or accept a larger scallop / smaller stepover.")
       
        # ===============================
        # DEFLECTION ADVISOR (strategy)
        # ===============================
        stickout = float(data.get("stickout", 0) or 0)
        diameter = float(data.get("diameter", 1) or 1)
        l_over_d = (stickout / diameter) if diameter > 0 else 0.0

        # Recommend stickout reduction targets (if possible)
        # Deflection ~ L^3  => stiffness gain = (L_old/L_new)^3
        def _stiffness_gain_pct(L_old, L_new):
            if L_new <= 0 or L_old <= 0:
                return 0.0
            return ((L_old / L_new) ** 3 - 1.0) * 100.0

        # practical shortened stickout suggestions
        L_old = stickout
        loc = float(data.get("loc", 0) or 0)
        flute_wash = float(data.get("flute_wash", 0) or 0)
        lbs = float(data.get("lbs", 0) or 0)
        _min_L = max(lbs, loc + flute_wash + (diameter * 0.15))
        targets = []
        for frac in (0.90, 0.80, 0.70):
            L_new = max(L_old * frac, _min_L)
            if L_new >= L_old - 1e-4:
                continue  # floor is at or above current stickout — skip
            gain = _stiffness_gain_pct(L_old, L_new)
            targets.append((L_new, gain))

        ui_print(emit,"\n— Deflection Advisor —")
        ui_print(emit,f"Stickout: {stickout:.2f}\"  (L/D = {l_over_d:.1f})")
        print("Best next moves:")
        print("1) Reduce stickout (biggest win)")
        print("2) Reduce WOC")
        print("3) Reduce DOC")

        print("Best stickout targets:")
        # LOC / reach feasibility check for finish-driven stickout target
        finish_L = float(state.get("finish_stickout_target", 0) or 0)

        # Treat tiny LOC as "unknown" to avoid bogus warnings
        if loc > 0.10 and finish_L > 0:
            if finish_L > loc * 1.05:
                print(f"⚠ Finish stickout target {finish_L:.2f}\" exceeds tool LOC {loc:.2f}\" — likely needs reduced-neck / longer reach tool.")

        merged = []

        # 1) Add finish-driven stickout target first (if it exists)
        finish_stickout = None
        if "finish_stickout_target" in state:
            finish_stickout = state["finish_stickout_target"]
        elif "finish_stickout_target" in locals():
            finish_stickout = L_new  # from finish feasibility calc (use your existing variable name)

        if finish_stickout:
            gain = _stiffness_gain_pct(stickout, finish_stickout)
            merged.append((finish_stickout, gain, "finish-driven"))

        # 2) Add best practical stiffness option (avoid duplicating finish target)
        targets_sorted = sorted(targets, key=lambda t: t[1], reverse=True)
        for L_new, gain in targets_sorted:
            if not finish_stickout or abs(L_new - finish_stickout) > 1e-3:
                merged.append((L_new, gain, "stiffness"))
                break

        # Print merged list (max 2 entries)
        for L_new, gain, tag in merged[:2]:
            label = " (finish target)" if tag == "finish-driven" else ""

            if gain > 300:
                print(f'  • {L_new:.2f}" → >300% stiffer{label}')
            else:
                print(f'  • {L_new:.2f}" → ~{gain:.0f}% stiffer{label}')

        print("  (stiffness scales ~L³, so small stickout cuts help a lot)")

        if l_over_d >= 4.0:
            print("⚠ Suggestion: reduced-neck / reach tool to keep the cutting diameter supported near the cut.")
        if l_over_d >= 6.0:
            print("⚠ High L/D — prioritize shortest stickout possible or increase diameter if finish allows.")
        
        # HEM guidance
        # HEM guidance
        if data.get("mode") == "hem" and doc_xd_feasible < 1.0:

            print("⚠ Current stickout cannot support typical HEM axial depths")

            current_stickout = data.get("stickout", 0)
            diameter = data.get("diameter", 1)
            l_over_d = current_stickout / diameter if diameter > 0 else 0

            if l_over_d >= 3 and l_over_d < 5:
                print("⚠ Consider reduced neck tool to improve stiffness at this projection")

            elif l_over_d >= 5:
                print("⚠ Reduced neck tool recommended for this stickout")

            if l_over_d >= 5 and material_group in ["Inconel", "Titanium", "Stainless"]:

                if data.get("multi_tool_process", True):
                    print("⚠ Strategy: rough with shortest LOC tool for stiffness,")
                    print("   then finish deep walls with reduced neck tool")

                else:
                    print("⚠ Single tool constraint detected — necked tool must run full depth")
                    print("⚠ Use reduced DOC and light radial engagement for stability")


        # 🔹 AUTO-ADJUST FOR SINGLE NECKED TOOL (OUTSIDE HEM BLOCK)
        if not data.get("multi_tool_process", True):

            # Force DOC and WOC to feasible limits
            doc = doc_feasible

            # Ball finish: lock scallop stepover; do NOT overwrite with deflection WOC
            if ball_finish_mode:
                woc = float(data.get("woc", woc))
            else:
                if not ball_finish_mode:
                    woc = max_woc_for_doc

            # --- BALLNOSE STRATEGY LAYER (no physics changes) ---
            tool_type = data.get("tool_type", "").lower()
            mode = data.get("mode", "").lower()

                # Honor user axial DOC (stepdown) if provided
            if "doc" in data:
                    pass
            elif "doc_xd" in data:
                    data["doc"] = data["doc_xd"] * diameter
            else:
                    # Safe default for finishing
                    data["doc"] = 0.02 * diameter

            MIN_WOC_PCT = 0.002   # 0.2% Ø practical lower limit for milling
            min_woc = data["diameter"] * MIN_WOC_PCT

            if max_woc_for_doc < min_woc:
                print("⚠ Required WOC is below practical limit — switching strategy")

                # Do NOT force 20 radial passes
                woc = min_woc
                state["radial_passes"] = 1

                # Flag as deflection-limited process
                state["deflection_limited"] = True
            else:
                if not ball_finish_mode:
                    woc = max_woc_for_doc

            # HEM radial cap for HRSA stability
            if data.get("mode") == "hem" and material_group in ["Inconel", "Titanium", "Stainless"]:
                max_hem_woc = data["diameter"] * 0.15
                if woc > max_hem_woc:
                    print("⚠ HEM radial capped at 15% Ø for HRSA stability")
                    woc = max_hem_woc

            # Trochoidal hard cap: ae must not exceed 20% Dc (spec requirement)
            if data.get("mode") == "trochoidal":
                max_troch_woc = data["diameter"] * 0.20
                if woc > max_troch_woc:
                    print("⚠ Trochoidal radial capped at 20% Ø (ae limit per trochoidal spec)")
                    woc = max_troch_woc

            # Compute L/D once (must exist before IPT derate)
            stickout = float(data.get("stickout", 0) or 0)
            diameter = float(data.get("diameter", 1) or 1)
            l_over_d = stickout / diameter if diameter > 0 else 0

            ipt = IPT_FRAC.get(data.get("material", material_group), IPT_FRAC.get(material_group, 0.005)) * diameter

            # HRSA long-stickout derate (strategy policy)
            if material_group in ["Inconel", "Titanium", "Stainless"]:
                if l_over_d < 3:
                    derate = 1.00
                elif l_over_d < 5:
                    derate = 0.80
                elif l_over_d < 7:
                    derate = 0.70
                else:
                    derate = 0.65   # L/D >= 7

                ipt *= derate
                if debug:
                        print(f"DEBUG IPT derate: L/D={l_over_d:.1f} derate={derate:.2f} IPT={ipt:.6f}")

            best_any = None
            best_force = None
            best = None

            # Force cap (define once so it's always available)
            try:
                force_limit = float(data.get("force_limit", 1e9) or 1e9)
            except Exception:
                force_limit = 1e9
            if not math.isfinite(force_limit) or force_limit <= 0:
                force_limit = 1e9

            # ===============================
            # MRR OPTIMIZER (deflection-safe HEM)
            # Strategy-layer search: adjusts DOC/WOC only
            # ===============================
            mode = (data.get("mode") or "").lower()

            if auto_doc_woc and mode == "hem":
                # compute best

                D = data["diameter"]
                defl_limit = deflection_limit  # already has HEM + var-pitch/helix bonuses applied
                force_limit = float(data.get("force_limit", 1e9) or 1e9)  # default: no force cap
  
                # Axial cap (respect tool LOC if provided)
                max_doc = D * 2.5  # default neck-tool cap

                loc = float(data.get("loc", 0) or 0)
                if loc > 0:
                    max_doc = min(max_doc, loc)
                    if debug:
                        print(f"DEBUG LOC cap active: LOC={loc:.3f}  max_doc={max_doc:.3f}")
                else:
                    if debug:
                        print("DEBUG LOC cap inactive: no data['loc']")

                max_woc = D * 0.15

                # grids (axial-biased)
                doc_grid = [D * x for x in [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5]]

                # 🔒 Remove duplicates after LOC clamp so we don’t test DOC=1.0 ten times
                doc_grid = sorted(set([min(x, max_doc) for x in doc_grid]))

                woc_grid = [D * x for x in [0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.075, 0.10, 0.12, 0.15]]

                # Seed with current point (so never None)
                seed_state = calc_state(
                    rpm, flutes, ipt, doc, min(woc, max_woc),
                    data, material_group, rigidity
                )
                # Early exit: stop IPT stepping once chip thickness is pinned at min chip
                min_chip = float(data.get("min_chip", 0.0) or 0.0)
                h_eff_now = float(state.get("h_eff", 0.0) or 0.0)
              
                def _as_float(x, default=1e9):
                    try:
                        return float(x)
                    except Exception:
                        return default

                best_any = {
                    "mrr": float(seed_state.get("mrr", 0.0) or 0.0),
                    "doc": float(doc),
                    "woc": float(woc),
                    "defl": float(seed_state.get("deflection", 1e9) or 1e9),
                    "force": float(seed_state.get("force", 1e9) or 1e9),
                    "ipt": float(ipt),
                }
                best_force = {"mrr": 0.0}

                force_limit = data.get("force_limit", 180.0)  # lbs, user tunable

                # --- IPT floor: don't go below minimum chip thickness ---
                hmin = minimum_chip_thickness(material_group)   # e.g. 0.0003 for Inconel
                ipt_floor = hmin * 1.05  # small margin above hmin
                
                # Try a small IPT ladder around the derated value
                ipt_base = ipt
                ipt_steps = [ipt_base * x for x in [0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 1.0]]

                if debug:
                    print("DEBUG ipt_steps:", [round(x, 7) for x in ipt_steps], "ipt_floor:", ipt_floor)

                for doc_test in doc_grid:
                    doc_test = min(doc_test, max_doc)

                    for woc_test in woc_grid:
                        woc_test = min(woc_test, max_woc)

                        for ipt_test in ipt_steps:
                            # 1) Run once at candidate IPT
                            state = calc_state(
                                rpm, flutes, ipt_test, doc_test, woc_test,
                                data, material_group, rigidity
                            )

                            force = float(state.get("force", 1e9) or 1e9)

                            # 2) If over force cap, scale IPT down and re-run
                            ipt_used = ipt_test
                            if force_limit > 0 and force > force_limit and force > 0:
                                scale = force_limit / force
                                ipt_used = max(ipt_floor, ipt_test * scale)

                                state = calc_state(
                                    rpm, flutes, ipt_used, doc_test, woc_test,
                                    data, material_group, rigidity
                                )

                            # 3) Read FINAL results
                            force = float(state.get("force", 1e9) or 1e9)
                            defl  = float(state.get("deflection", 1e9) or 1e9)
                            mrr   = float(state.get("mrr", 0.0) or 0.0)

                            # --- rejection + best tracking (replace your current defl/force tracking block) ---
                            rub_min = float(data.get("hem_rub_min", 1.20) or 1.20)
                            rub = float(state.get("rub_ratio", 0.0) or 0.0)
                            hmin = float(state.get("hmin", 0.0) or 0.0)
                            
                            data["_hem_report"]["attempts"] += 1

                            if hmin > 0 and (rub > 0 and rub < rub_min):
                                # Try to fix by increasing IPT to reach target rub ratio
                                target_rub = 1.20
                                ipt_repair = ipt_used * (target_rub / max(rub, 1e-6))

                                # Keep repair conservative (don’t explode forces)
                                ipt_repair = min(ipt_repair, ipt_used * 1.35)

                                state_repair = calc_state(
                                    rpm, flutes, ipt_repair, doc_test, woc_test,
                                    data, material_group, rigidity
                                )

                                rub2 = float(state_repair.get("rub_ratio", 0.0) or 0.0)
                                if rub2 >= rub_min:
                                    state = state_repair
                                    ipt_used = ipt_repair
                                    force = float(state.get("force", 1e9) or 1e9)
                                    defl  = float(state.get("deflection", 1e9) or 1e9)
                                    mrr   = float(state.get("mrr", 0.0) or 0.0)
                                    state["ipt"] = ipt_used
                                    rub = float(state.get("rub_ratio", 0.0) or 0.0)
                                else:
                                    hem_report_reject(data, "chip-thinning / rubbing limited")
                                    continue
                                    
                            # 2) Deflection-limited (counts as rejection)
                            if defl > defl_limit:
                                hem_report_reject(data, "deflection-limited")
                                continue

                            # 3) Track best under deflection only
                            if (best_any is None) or (mrr > best_any["mrr"]):
                                best_any = {
                                    "mrr": mrr,
                                    "doc": doc_test,
                                    "woc": woc_test,
                                    "defl": defl,
                                    "force": force,
                                    "ipt": ipt_used,
                                }

                            # 4) Force-limited (counts as rejection) + best under BOTH
                            force_enabled = (force_limit < 1e8) and (force_limit > 0)

                            if force_enabled and (force > force_limit):
                                hem_report_reject(data, "force-limited")
                                continue

                            if (best_force is None) or (mrr > best_force["mrr"]):
                                best_force = {
                                    "mrr": mrr,
                                    "doc": doc_test,
                                    "woc": woc_test,
                                    "defl": defl,
                                    "force": force,
                                    "ipt": ipt_used,
                                }

            # AFTER loops — final selection
            if best_any is not None:
                if best_force is not None:
                    best = best_force
                else:
                    print(f"⚠ No optimizer point met force_limit={force_limit:g} lbs. Using best available under deflection only.")
                    best = best_any

            # Ensure best always exists (fallback to current state)
            if best is None:
                best = {
                    "doc": float(doc),
                    "woc": float(woc),
                    "ipt": float(ipt),
                    "mrr": float(state.get("mrr", 0.0) or 0.0),
                    "defl": float(state.get("deflection", 1e9) or 1e9),
                    "force": float(state.get("force", 1e9) or 1e9),
                }

            if debug:
                    print(f"DEBUG force-cap: limit={force_limit:.1f} best_force={best['force']:.1f} best_ipt={best['ipt']:.6f}")
            # --- APPLY OPTIMIZER RESULT BACK INTO CURRENT POINT ---
               # ONE final state solve after geometry + optimizer are finalized
            state = calc_state(
                rpm, flutes, ipt, doc, woc,
                data, material_group, rigidity
            )

            why_parts = []
            tested = int(data["_hem_report"].get("attempts", 0) or 0)
            why_parts.append(f"max MRR among {tested} tested points")
            why_parts.append(f"defl={state['deflection']:.6f}<=limit")
            if float(data.get("force_limit", 1e9)) < 1e8:
                why_parts.append(f"force={state['force']:.1f}<=cap")
            why_parts.append(f"rub={state['rub_ratio']:.2f}>=1.20" if state["rub_ratio"] >= 1.2 else f"rub={state['rub_ratio']:.2f}")
            hem_report_choose(data, state, "; ".join(why_parts))
            
            if debug:
                print("DEBUG L/D:", l_over_d, "IPT:", ipt, "Feed:", state["feed"])
                
            original_deflection = state["deflection"]

            state["doc"] = doc
            state["woc"] = woc
            original_woc = woc
    
            optimized_state = None

            # Only run optimizer for non-ball strategies
            if (not ball_finish_mode) and (not auto_doc_woc):
                ipt, doc, woc, optimized_state = optimize_mrr(
                    data, rpm, flutes, ipt, doc, state["woc"], material_group, rigidity
                )

            if optimized_state:
                state.update(optimized_state)
    # Flute-dependent hmin adjustment for ball nose finishing (after final state update)
    if data.get("tool_type") == "ball":
        flutes = data.get("flutes", 4)

        if flutes == 5:
            state["hmin"] *= 0.9
        elif flutes >= 6:
            state["hmin"] *= 0.8

    # 👉 APPLY FEED REDUCTION HERE
    if data.get("tool_type") == "ball":
        deflection_limit = 0.0002
    else:
        deflection_limit = data.get("deflection_limit", 0.001)

    if (not auto_doc_woc) and state["deflection"] > deflection_limit:
        reduction_ratio = deflection_limit / original_deflection

        if reduction_ratio < 0.2:
            print("⚠ Recommend reducing WOC to control deflection rather than feed")

            target_woc = original_woc * reduction_ratio
            target_woc_pct = (target_woc / data["diameter"]) * 100

            radial_pct = original_woc / data["diameter"]

            if radial_pct < 0.40:

                print(f"⚠ Suggested WOC for current feed: {target_woc:.4f} in ({target_woc_pct:.1f}% Ø)")
                state["suggested_stepover"] = target_woc

                if 8 <= target_woc_pct <= 15:
                    print("⚠ Ideal for dynamic/HEM toolpath")
                elif target_woc_pct < 5:
                    if data.get("debug", False):
                        print("⚠ Very light radial engagement — finishing style cut")
                elif data.get("tool_type") == "ball":
                    print("⚠ Ball nose finishing mode — stepover controls surface finish")
                elif target_woc_pct > 40:
                    print("⚠ Heavy radial engagement — conventional milling range")

        state["feed"] *= reduction_ratio
        state["mrr"] *= reduction_ratio
        state["load"] *= reduction_ratio
        state["force"] *= reduction_ratio
        state["hp"] *= reduction_ratio

        state["deflection"] = deflection_limit

        min_feed = 5.0
        if state["feed"] < min_feed:
            print("⚠ Feed dropped below practical limit — reduce WOC instead")
            state["feed"] = min_feed

        if feed_scale < 1.0:
            print(f"⚠ Feed reduced for deflection control (×{feed_scale:.3f})")
        elif feed_scale > 1.0:
            # if your math yields >1 for a reduction, invert it for display (or fix upstream)
            print(f"⚠ Feed reduced for deflection control (×{(1.0/feed_scale):.3f})")

    mode = data.get("mode", "dynamic")

    optimized_state = None
    if (not ball_finish_mode) and (not auto_doc_woc):
        ipt, doc, woc, optimized_state = optimize_mrr(
            data, rpm, flutes, ipt, doc, state["woc"], material_group, rigidity
        )

    if optimized_state:
        state.update(optimized_state)
        if ball_finish_mode:
            radial_passes = 1
            state["radial_passes"] = 1
            state["woc_adjusted"] = float(data.get("woc", state.get("woc", woc)))
        else:
            # normal behavior (whatever you already do)
            state["radial_passes"] = optimized_state.get("radial_passes", 1)
            state["woc_adjusted"] = float(data.get("woc", state.get("woc", woc)))  # keep scallop stepover as-is
            
    else:
        adjusted_woc = state["woc"]
        radial_passes = 1
        capped = False

    if ball_finish_mode:
        state["radial_passes"] = 1
        state["woc_adjusted"] = float(data.get("woc", woc))
    else:
        if debug:
            print("DEBUG radial_passes set here", state.get("radial_passes", 1))
        # existing radial pass computation block below
    if debug:
            print(f"DEBUG radial passes = {radial_passes}")
    
    life = tool_life(material_group, coating, state["load"], data["coolant"],
                     coolant_fluid=data.get("coolant_fluid", "semi_synthetic"),
                     coolant_concentration=data.get("coolant_concentration", 10))
    if debug:
            print("DEBUG post-scale feed:", state["feed"], "mrr:", state["mrr"], "load:", state["load"], "defl:", state["deflection"])
        # FINAL state solve (you already have this)
        # ===============================
        # LIMITER DIAGNOSIS (strategy)
        # ===============================
    print("\n— Limiter Diagnosis —")

    force = float(state.get("force", 0.0) or 0.0)
    defl  = float(state.get("deflection", 0.0) or 0.0)
    load  = float(state.get("load", 0.0) or 0.0)

    defl_limit = float(data.get("deflection_limit", 0.001) or 0.001)
    force_limit = float(data.get("force_limit", 1e9) or 1e9)

    defl_active  = defl >= 0.98 * defl_limit
    force_active = (force_limit < 1e8) and (force >= 0.98 * force_limit)
    hp_active    = load >= 0.90

    if defl_active and not force_active and not hp_active:
        print("Primary limiter: Rigidity / deflection")
        print("  Best fixes: shorten stickout, increase diameter, stiffer holder, reduced neck/reach tool.")
    elif force_active and not defl_active and not hp_active:
        print("Primary limiter: Cutting force")
        print("  Best fixes: reduce IPT, reduce WOC, reduce DOC, use HEM/dynamic path, adjust helix/coating.")
    elif hp_active and not defl_active:
        print("Primary limiter: Machine power")
        print("  Best fixes: reduce MRR (DOC/WOC/feed), lower SFM at low RPM, consider smaller tool engagement.")
    elif defl_active and force_active:
        print("Primary limiter: Deflection + Force (both active)")
        print("  Best fixes: shorten stickout first, then reduce WOC; keep chip thickness above minimum.")
    else:
        if debug:
            print("Limiter status: No hard limiter active (headroom available).")
    # Precompute ball tilt recommendation (store in state for other advisors)
    
    state["tilt_rec_deg"] = None
    state["sfm_eff"] = None
    state["sfm_target_eff"] = None

    if is_ball:
        r = state.get("center_contact_ratio", None)
        if r is not None and r > 0:
            sfm_eff = sfm_actual * r

            material_group = get_material_group(data["material"])
            sfm_floor = {
                "Steel": 180, "Stainless": 160, "Cast Iron": 180,
                "Aluminum": 400, "Non-Ferrous": 300,
                "Inconel": 120, "Titanium": 120, "Plastics": 250
            }.get(material_group, 180)

            sfm_target = max(sfm_floor, 0.60 * sfm_actual)
            ratio_target = min(1.0, sfm_target / max(1e-12, sfm_actual))

            if r < ratio_target:
                theta_now = math.degrees(math.asin(max(0.0, min(1.0, r))))
                theta_tgt = math.degrees(math.asin(max(0.0, min(1.0, ratio_target))))
                tilt_min = max(0.0, theta_tgt - theta_now)
                tilt_rec = max(5.0, min(20.0, tilt_min))

                state["tilt_rec_deg"] = float(tilt_rec)
                state["sfm_eff"] = float(sfm_eff)
                state["sfm_target_eff"] = float(sfm_target)
    
    # ===============================
    # AUTO ANTI-RUBBING IPT BUMP (strategy)
    # ===============================
    rub = float(state.get("rub_ratio", 0.0) or 0.0)
    hmin = float(state.get("hmin", 0.0) or 0.0)

    # Only act if the model says we're rubbing and hmin is meaningful
    if hmin > 0 and rub > 0 and rub < 1.20:
        target_rub = 1.20

        ipt_now = float(state.get("ipt", ipt) or ipt)
        ipt_need = ipt_now * (target_rub / max(1e-6, rub))

        # Keep this conservative: don't jump too far in one step
        ipt_need = min(ipt_need, ipt_now * 1.35)

        # Limits for "safe to auto-apply"
        defl_limit = float(data.get("deflection_limit", 0.001) or 0.001)
        force_limit = float(data.get("force_limit", 1e9) or 1e9)
        if not math.isfinite(force_limit) or force_limit <= 0:
            force_limit = 1e9

        # Simulate the bumped IPT
        state_try = calc_state(
            rpm, flutes, ipt_need, doc, woc,
            data, material_group, rigidity
        )
        state.setdefault("radial_passes", 1)
        state.setdefault("woc_adjusted", float(state.get("woc", 0.0) or 0.0))
        
        defl_try = float(state_try.get("deflection", 1e9) or 1e9)
        force_try = float(state_try.get("force", 1e9) or 1e9)
        load_try = float(state_try.get("load", 1.0) or 1.0)
        rub_try  = float(state_try.get("rub_ratio", 0.0) or 0.0)

        # “Safe” gates: don't worsen deflection, don't violate force cap, don't push power
        ok_defl  = defl_try <= defl_limit * 1.02
        ok_force = (force_limit >= 1e8) or (force_try <= force_limit * 0.98)
        ok_hp    = load_try <= 0.90

        improved = rub_try >= min(target_rub, rub + 0.05)

        if ok_defl and ok_force and ok_hp and improved:
            ipt = ipt_need
            state = state_try
            print(f"✅ Auto-adjusted IPT to avoid rubbing: {ipt_now:.6f} → {ipt_need:.6f} in/tooth (rub {rub:.2f} → {rub_try:.2f})")
        else:
            if tool_type in ("ballnose", "ball") or "ball" in str(tool_type).lower():
                print("⚠️ Rubbing risk detected, but IPT bump did not improve chip thickness enough (likely geometry/center-contact limited).")
            state["rub_notice_printed"] = True
            if not ok_defl:
                print(f"   • Deflection would increase above limit ({defl_try:.5f} > {defl_limit:.5f})")
            if not ok_force and force_limit < 1e8:
                print(f"   • Force would exceed cap ({force_try:.1f} > {force_limit:.1f} lbs)")
            if not ok_hp:
                print(f"   • Spindle load would be high ({load_try*100:.1f}%)")
            tilt_rec = state.get("tilt_rec_deg", None)
            sfm_eff_now = state.get("sfm_eff", None)
            sfm_tgt = state.get("sfm_target_eff", None)
            if tool_type in ("ballnose", "ball") or "ball" in str(tool_type).lower():
                tilt_rec = state.get("tilt_rec_deg", None)
                sfm_eff_now = state.get("sfm_eff", None)
                sfm_tgt = state.get("sfm_target_eff", None)

                if tilt_rec is not None:
                    if sfm_eff_now is not None and sfm_tgt is not None:
                        print(f"   Suggested: tilt ~{tilt_rec:.0f}° minimum (effective SFM ~{sfm_eff_now:.0f} → ~{sfm_tgt:.0f}).")
                    else:
                        print(f"   Suggested: tilt ~{tilt_rec:.0f}° minimum to move contact off the tip.")
                else:
                    tilt_rec = state.get("tilt_rec_deg", None)
                    sfm_eff_now = state.get("sfm_eff", None)
                    sfm_tgt = state.get("sfm_target_eff", None)

                    if tilt_rec is not None and sfm_eff_now is not None and sfm_tgt is not None:
                        print(f"   Suggested: tilt ~{tilt_rec:.0f}° minimum (effective SFM ~{sfm_eff_now:.0f} → ~{sfm_tgt:.0f}).")
                    else:
                        print("   Suggested: tilt (preferred), increase stepover if finish allows, or increase chip load with headroom.")
    if hem_gate_enabled(data, auto_doc_woc):
        hem_print_report(data, state)
        print(f"DOC: {state.get('doc',0):.4f} in   WOC: {state.get('woc',0):.4f} in")

        # --- HEM feasibility messaging (strategy-only) ---
        D = float(data.get("diameter", 0.0) or 0.0)
        doc = float(state.get("doc", 0.0) or 0.0)
        woc = float(state.get("woc", 0.0) or 0.0)

        if D > 0:
            doc_xd = doc / D
            woc_pct = 100.0 * (woc / D)

            if woc_pct < 1.0:
                
                if debug:
                    print(f"⚠ HEM feasibility: WOC is extremely low ({woc_pct:.2f}% Ø). Expect very low MRR.")
                    print("   Primary fix: increase stiffness (shorter stickout, larger Ø, or stiffer holder).")
                    
                low_pct, high_pct = hem_typical_woc_range_pct(material_group, flutes)
                print(f"   Typical productive HEM range: ~{low_pct:.0f}–{high_pct:.0f}% Ø WOC (if stiffness allows).")
                    
                # --- Required stiffness to reach target HEM WOC ---
                target_pct = hem_target_woc_pct(data, material_group, flutes)
                target_woc = (target_pct / 100.0) * D

                woc_now = float(state.get("woc", 0.0) or 0.0)
                defl = float(state.get("deflection", 0.0) or 0.0)
                defl_limit = float(data.get("deflection_limit", 0.001) or 0.001)

                max_woc_feasible = woc_now
                if defl > 0 and defl_limit > 0:
                    # --- diagnostics: hide unless debug ---
                    if debug and D > 0.0 and max_woc_feasible > 0.0:
                        print(f"   Current max feasible WOC at this DOC: {(max_woc_feasible / D) * 100:.2f}% Ø")

                        stiff_need = (target_woc / max_woc_feasible) if target_woc > max_woc_feasible else 1.0
                        print(f"   To reach ~{target_pct:.0f}% Ø WOC: need ~{stiff_need:.1f}× stiffness")

                        L_current = float(data.get("stickout", 0.0) or 0.0)
                        if L_current > 0 and stiff_need > 1.0:
                            L_target = L_current / (stiff_need ** (1.0 / 3.0))
                            print(f"   Stickout target ≈ {L_target:.2f}\" (from {L_current:.2f}\")")

            if (doc_xd < 0.25) and (woc_pct < 2.0):
                print("⚠ Engagement is in micro-cut range (low DOC + tiny WOC).")
                print("   This is stiffness-limited HEM: stable, but MRR will be very low until WOC can increase.")
        
    if emit:
        print("\n=== MACHINING MENTOR OUTPUT ===\n")
    # ===============================
    # BALLNOSE CENTER-CONTACT WARNING (strategy)
    # ===============================
    if is_ball:
        r = state.get("center_contact_ratio", None)
        if r is not None:
            sfm_eff = sfm_actual * r
            if sfm_eff < 150:  # heuristic threshold for "low"
                print(f"⚠ Low effective surface speed at contact: ~{sfm_eff:.0f} SFM (ball contact ratio {r:.2f}).")
                print("   Low SFM at contact can cause rubbing; see advisor above for tilt recommendation.")
                
                # ===============================
                # AUTO TILT SOLVER (ballnose, strategy)
                # ===============================
                if is_ball:
                    r = state.get("center_contact_ratio", None)  # D_eff / D_true
                    if r is not None and r > 0:
                        # Choose a simple material-based target effective SFM
                        # (heuristic: keep at least 60% of commanded SFM, and at least a floor by material)
                        material_group = get_material_group(data["material"])
                        sfm_floor = {
                            "Steel": 180,
                            "Stainless": 160,
                            "Cast Iron": 180,
                            "Aluminum": 400,
                            "Non-Ferrous": 300,
                            "Inconel": 120,
                            "Titanium": 120,
                            "Plastics": 250
                        }.get(material_group, 180)

                        sfm_target = max(sfm_floor, 0.60 * sfm_actual)
                        ratio_target = min(1.0, sfm_target / max(1e-12, sfm_actual))

                        # If we're already above target, no need to tilt
                        if r < ratio_target:
                            theta_now = math.degrees(math.asin(max(0.0, min(1.0, r))))
                            theta_tgt = math.degrees(math.asin(max(0.0, min(1.0, ratio_target))))
                            tilt_min = max(0.0, theta_tgt - theta_now)

                            # Clamp to a practical recommendation band
                            tilt_rec = max(5.0, min(20.0, tilt_min))

                            state["tilt_rec_deg"] = float(tilt_rec)
                            state["sfm_eff"] = float(sfm_eff)
                            state["sfm_target_eff"] = float(sfm_target)

                        if not state.get("rub_notice_printed", False):
                            print(f"💡 Auto-tilt suggestion: ~{tilt_rec:.0f}° minimum (to reach ~{sfm_target:.0f} effective SFM).")
                            print(f"   Target effective SFM: ~{sfm_target:.0f} (current ~{sfm_eff:.0f})")
                            print("   Tip: tilt in the feed/lead direction or use tool-axis control to move contact off the tip.")
    if is_ball:
        r = state.get("center_contact_ratio", None)
        if r is not None and r < 0.10:
            print("⚠ Ballnose is cutting near center (very low effective surface speed).")
            print("   Consider tilting the tool ~10–15° or increasing stepover slightly to move contact outward.")

    material = (data.get("material", "") or "").strip()
    diameter = float(data.get("diameter", 0.0) or 0.0)
    feed_ipm = state.get("feed_ipm", state.get("feed", state.get("feedrate", 0.0)))
    hp = state.get("hp", 0.0)
    spindle_load = state.get("load", 0.0) * 100.0
    stepover = state.get("stepover", state.get("woc_adjusted", state.get("woc", 0.0)))
    cut_force = state.get("force", 0.0)
    deflection = state.get("deflection", 0.0)
    chatter_index = state.get("chatter", 0.0)

    print(f"Material: {material}")
    print(f"Tool: {diameter:.3f}\"  {flutes}-flute  {tool_type}")
    common_sizes = [0.125, 0.1875, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.75, 1.0]
    alt_d = next((s for s in common_sizes if s > diameter + 1e-6), None)
    if alt_d:
        stiff_gain = (alt_d / diameter) ** 4
        print(f"Diameter alt: {alt_d:.3f}\" (next common size) — ~{stiff_gain:.2f}× stiffer (D^4) if reach allows")
        
    # --- Overall Status (smart) ---
    defl_limit = float(data.get("deflection_limit", 0.0) or 0.0)
    defl_ratio = (deflection / defl_limit) if defl_limit > 0 else 0.0

    status = "STABLE"
    hint = "headroom available"

    if woc_pct < 1.0 or defl_ratio > 0.85:
        status = "STIFFNESS-LIMITED"
        hint = "reduce stickout or increase dia"
    elif spindle_load > 80.0:
        status = "MACHINE-LIMITED"
        hint = "reduce DOC/WOC or rpm"
    elif cut_force > float(data.get("force_limit", 0.0) or 0.0) * 0.85:
        status = "FORCE-LIMITED"
        hint = "reduce WOC or chipload"

    print(f"\nOverall Status: {status} — {hint}")

    # --- Risk Indicator ---
    defl = float(state.get("deflection", 0.0) or 0.0)
    defl_limit = float(data.get("deflection_limit", 0.001) or 0.001)

    load_pct = float(state.get("load", 0.0) or 0.0)  # already fraction of 1.0
    chip_ratio = float(state.get("chip_ratio", 1.0) or 1.0)

    risk = "GREEN"

    if defl > defl_limit or chip_ratio < 1.0:
        risk = "RED"
    elif defl > defl_limit * 0.80 or load_pct > 0.80:
        risk = "YELLOW"
    if woc_pct < 1.0 and risk != "RED":
        risk = "YELLOW"
    
    print(f"Risk Level: {risk}")

    if woc_pct < 1.0:
        print(f"⚠ Micro-cutting regime — WOC {woc_pct:.2f}% dia (<1% dia, stiffness-limited)")
        
        if status == "STIFFNESS-LIMITED":
            if material_group in ("Titanium", "Inconel"):
                target_woc_text = "6–10% dia"
            else:
                target_woc_text = "8–12% dia"

            if alt_d:
                print(f'Action: shorten stickout or increase diameter to {alt_d:.3f}", then raise WOC toward {target_woc_text}.')
            else:
                print(f"Action: shorten stickout or increase diameter, then raise WOC toward {target_woc_text}.")

            print("Productivity Hint: tool is stable but under-engaged — increasing WOC will raise MRR significantly once stiffness improves.")
            print(f"Target: WOC {target_woc_text} for productive HEM once stiffness is improved.")

            if material_group in ("Titanium", "Inconel"):
                print("Tip: for heat-sensitive alloys, shorten stickout first before pushing RPM/WOC—keep entry gentle and monitor heat.")
        elif status == "MACHINE-LIMITED":
            print("Action: reduce WOC or DOC ~10–20% until spindle load is comfortable.")
        elif status == "FORCE-LIMITED":
            print("Action: reduce WOC first, then chipload if needed.")
        else:
            print("Action: run and monitor; increase WOC slightly if stable.")
    
    print("\n--- Speed & Feed ---")
    print(f"RPM: {rpm:,.0f}")
    print(f"SFM: {sfm_actual:.0f} (Target: {base_sfm:.0f})")
    print(f"Feed: {feed_ipm:,.1f} IPM")
    print(f"Chipload: {ipt:.4f}\"")

    print("\n--- Entry Moves ---")

    # Standard entry recommendations
    mat = material.lower()

    if mat in ("aluminum", "non-ferrous"):
        ramp_angle = 5.0
    else:
        ramp_angle = 3.0

    # Hardness-aware entry feed multiplier
    # Hard materials: edge shock at entry is the #1 cause of first-tooth failure
    _entry_hrc  = float(data.get("hardness_hrc", 0) or 0)
    _entry_mat  = str(data.get("material", material_group) or "").lower()
    _hard_keys  = ("hardened_gt55", "cpm_10v")
    _medium_keys = ("hardened_lt55", "tool_steel_d2", "tool_steel_a2",
                    "stainless_440c", "tool_steel_h13", "tool_steel_s7")
    if _entry_hrc >= 55 or _entry_mat in _hard_keys:
        entry_feed_mult = 0.25   # 25% — very hard; edge shock is severe
        entry_caution   = "high_hardness"
    elif _entry_hrc >= 40 or _entry_mat in _medium_keys:
        entry_feed_mult = 0.35   # 35% — medium-hard tool steels
        entry_caution   = "medium_hardness"
    else:
        entry_feed_mult = 0.50   # 50% — standard recommendation
        entry_caution   = None

    standard_ramp_feed  = feed_ipm * entry_feed_mult
    standard_helix_feed = feed_ipm * (entry_feed_mult + 0.15)  # helix slightly higher (continuous chip)

    # Sweep / roll-in arc entry calculations
    # Tangential arc = chip builds 0 → full WOC gradually; preferred over straight-in.
    # Arc radius: 0.5D min, 0.75D recommended.
    sweep_arc_radius_min_in = round(diameter * 0.50, 4)
    sweep_arc_radius_rec_in = round(diameter * 0.75, 4)
    sweep_entry_ipm         = round(feed_ipm * entry_feed_mult, 2)  # same conservative mult as ramp
    sweep_full_ipm          = round(feed_ipm, 2)   # transition to full feed once arc completes

    # Straight / perpendicular entry (not recommended — included for reference)
    straight_entry_ipm = round(feed_ipm * entry_feed_mult, 2)
    # Advanced light ramp (dynamic chip-thinning)
    chip_ratio = float(state.get("chip_ratio", 1.0) or 1.0)

    target_ratio = 1.15
    multiplier = target_ratio / chip_ratio if chip_ratio > 0 else 1.0

    if multiplier < 1.0:
        multiplier = 1.0
    elif multiplier > 1.5:
        multiplier = 1.5

    advanced_feed = min(feed_ipm * multiplier, feed_ipm)

    print(f"Standard Ramp: ≤{ramp_angle:.0f}°  @ {standard_ramp_feed:.1f} IPM")
    print(f"Standard Helix: same RPM, {standard_helix_feed:.1f} IPM feed")
    print(f"Advanced Light Ramp: 0.5–1.0°  @ {advanced_feed:.1f} IPM (chip-thinning optimized)")
    advanced_helix_feed = min(feed_ipm * 0.65 * multiplier, feed_ipm * 0.75)
    helix_bore = diameter * 1.20

    # Material max helix angle cap
    mat = material.lower()
    if mat in ("titanium", "inconel"):
        max_angle = 0.6
    elif mat in ("stainless",):
        max_angle = 0.8
    elif mat in ("aluminum", "non-ferrous"):
        max_angle = 2.0
    else:
        max_angle = 1.0

    # Standard helix pitch/angle
    std_pitch = standard_helix_feed / rpm if rpm > 0 else 0.0
    std_angle_deg = math.degrees(math.atan(std_pitch / (math.pi * helix_bore))) if helix_bore > 0 else 0.0
    if std_angle_deg > max_angle:
        std_angle_deg = max_angle
        std_pitch = math.tan(math.radians(max_angle)) * math.pi * helix_bore
        standard_helix_feed = std_pitch * rpm

    # Advanced helix pitch/angle — cap and back-calculate consistent feed
    adv_pitch = advanced_helix_feed / rpm if rpm > 0 else 0.0
    adv_angle_deg = math.degrees(math.atan(adv_pitch / (math.pi * helix_bore))) if helix_bore > 0 else 0.0
    if adv_angle_deg > max_angle:
        adv_angle_deg = max_angle
        adv_pitch = math.tan(math.radians(max_angle)) * math.pi * helix_bore
        advanced_helix_feed = adv_pitch * rpm

    # Keep legacy names pointing to standard (most users will use standard)
    pitch = std_pitch
    angle_deg = std_angle_deg

    print(f"Standard Helix: {standard_helix_feed:.1f} IPM, pitch {std_pitch:.5f}\"/rev, angle {std_angle_deg:.2f}°")
    print(f"Advanced Helix: {advanced_helix_feed:.1f} IPM (chip-thinning), pitch {adv_pitch:.5f}\"/rev, angle {adv_angle_deg:.2f}°")
    print(f"Helix bore: ≥{helix_bore:.3f}\" (ideal {diameter*1.30:.3f}–{diameter*1.60:.3f}\")")
    print("Note: Advanced entry assumes light engagement (chip thinning) and stable setup.")
    print("CAM HEM note: use tangent arc/sweep lead-in; entry feed 60–80% until engagement stabilizes (avoid 90° full-feed entry).")
    print("\n--- Engagement ---")
    print(f"DOC: {doc:.4f}\"")
    print(f"WOC: {woc:.4f}\"")
    print(f"Stepover: {stepover:.4f}\"")

    print("\n--- Performance ---")
    print(f"MRR: {mrr:.3f} in³/min")
    print(f"HP: {hp:.3f}")
    machine_hp = float(data.get("machine_hp", 0.0) or 0.0)
    print(f"Spindle Load: {spindle_load:.2f}% (of {machine_hp:.0f} HP)")

    woc_pct = (woc / max(diameter, 1e-9)) * 100.0

    print("\n--- Tool Health ---")
    print(f"Cutting Force: {cut_force:.1f} lbs")
    print(f"Deflection: {deflection:.5f}\" ({deflection:.2e} in)")
    print(f"Chatter Index: {chatter_index:.2f}")

    # ===== CORNER RADIUS ADVISORY ENGINE =====

    ideal_cr = 0.0
    
    corner_condition = data.get("corner_condition", "square")
    current_cr = data.get("corner_radius", 0.0)

    diameter = data.get("diameter", 0)
    woc = state.get("woc_adjusted", state.get("woc", 0))

    material = data.get("material", "").lower()

    # Radial engagement %
    # Radial engagement %
    radial_pct = (woc / diameter) if diameter > 0 else 0

    # Base ideal CR
    if radial_pct <= 0.15:   # light radial / HEM
        ideal_cr = woc * 2.0
    else:                    # roughing / heavier engagement
        ideal_cr = doc * 0.10

    # Engagement modifiers (do NOT recalc from doc again)
    if radial_pct >= 0.50:   # slotting / heavy radial
        ideal_cr *= 0.6

    # Finishing guard
    if radial_pct <= 0.10:
        ideal_cr = min(ideal_cr, diameter * 0.06)

    # HRSA material cap
    HRSA = ["inconel", "titanium", "waspaloy", "hastelloy"]
    if material in HRSA:
        ideal_cr = min(ideal_cr, doc * 0.12, diameter * 0.12)
    else:
        ideal_cr = min(ideal_cr, diameter * 0.15)

    # Final diameter sanity cap
    ideal_cr = min(ideal_cr, diameter * 0.15)

    ideal_cr = round(ideal_cr, 3)
    # ===== OUTPUT LOGIC =====

    tool_type = (data.get("tool_type") or "").lower()

    if tool_type not in ("ball", "ballnose", "ball_nose") and current_cr == 0:
        print("⚠ Square end mill in use — corner radius ~0.060\" recommended for edge strength")

    elif corner_condition == "corner_radius":
        if current_cr < ideal_cr * 0.7:
            print(f"⚠ Current CR {current_cr:.3f}\" is small for DOC — consider ~{ideal_cr:.3f}\" for strength")
        elif current_cr > ideal_cr * 1.5:
            print(f"⚠ Large CR {current_cr:.3f}\" increases radial force — reduce WOC to avoid deflection")
        else:
            print(f"Corner radius {current_cr:.3f}\" is well matched to DOC")

    # Ball tools handled separately (no CR advisory)

    if is_ball:
        R = data["diameter"] / 2
        
        if "suggested_stepover" in state:
            stepover = state["suggested_stepover"]
        else:
            stepover = state["woc_adjusted"]

        scallop = (stepover ** 2) / (8 * R)

        print(f"Scallop Height: {scallop:.6f} in")

        # ---- Feed mark finish estimate (strategy) ----
        fz = state["feed"] / max(1e-12, (rpm * flutes))  # inches/tooth

        diam_eff = float(state.get("diam_eff", data["diameter"]) or data["diameter"])
        R_eff = max(1e-12, 0.5 * diam_eff)

        h_feed = (fz ** 2) / (8.0 * R_eff)

        print(f"Feed per tooth (path): {fz:.6f} in/tooth")
        print(f"Feed Mark Height: {h_feed:.6f} in")

        h_scallop = scallop
        h_total = (h_scallop**2 + h_feed**2) ** 0.5
        print(f"Estimated Total Cusp: {h_total:.6f} in (scallop + feed marks)")

        if h_total < 0.0001:
            print("Finish Class (predicted from scallop+feed): Fine")
        elif h_total < 0.0003:
            print("Finish Class (predicted from scallop+feed): Medium")
        else:
            print("Finish Class (predicted from scallop+feed): Rough")

    required_stepover = 0.0
    required_pct = 0.0
    if "target_scallop" in data:
        target_h = data["target_scallop"]
        R = data["diameter"] / 2

        required_stepover = (8 * R * target_h) ** 0.5
        required_pct = (required_stepover / data["diameter"]) * 100

    # Deflection check for required stepover
    if "suggested_stepover" in state:
        allowed_stepover = state["suggested_stepover"]

        if required_stepover > 0 and required_stepover > allowed_stepover:
            print("⚠ Target finish stepover exceeds deflection limit")
            print(f"⚠ Max allowable stepover at current feed: {allowed_stepover:.4f} in")
            current_feed = state.get("feed", 0)

            if required_stepover > allowed_stepover and current_feed > 0:
                feed_ratio = allowed_stepover / required_stepover
                required_feed = current_feed * feed_ratio

                print(f"Required feed for target finish: {required_feed:.2f} IPM")
                # Automatic tool recommendation
                stickout = data.get("stickout", 0)
                diameter = data.get("diameter", 1)
                flutes = data.get("flutes", 4)
                material = data.get("material", "").lower()

                l_over_d = stickout / diameter if diameter > 0 else 0

                # Base recommendation logic
                if l_over_d >= 3:
                    if flutes < 6:
                        print("Recommended tool: 6 flute ball nose, reduced neck, shortest stickout possible for stiffness")
                    elif flutes >= 6:
                        print("Recommended tool: larger diameter ball nose or reduced stickout for improved rigidity")
                else:
                    if flutes < 6:
                        print("Recommended tool: higher flute count ball nose for finishing stability")

                platform = data.get("platform", "")
                custom = data.get("custom_tool", False)

                NON_FERROUS = ["aluminum", "brass", "copper"]

                # Non-ferrous catalog
                if material in NON_FERROUS and not custom:
                    print("Recommended coating: Uncoated or D-Max (non-ferrous tooling)")

                # Custom tool — any coating allowed
                elif custom:
                    if material in NON_FERROUS:
                        print("Recommended coating: Uncoated or D-Max (custom tool)")
                    else:
                        preferred = MATERIAL_COATING_PREF.get(material)
                        if preferred:
                            print(f"Recommended coating: {preferred} (custom tool)")
                        else:
                            print("Recommended coating: per application (custom tool)")

                # Ferrous / HRSA catalog
                preferred_list = MATERIAL_COATING_PREF.get(material, [])
                available = PLATFORM_COATINGS.get(platform, [])

                recommended = None
                for coat in preferred_list:
                    if coat in available:
                        recommended = coat
                        break

                if recommended:
                    print(f"Recommended coating: {recommended} ({platform} platform)")
                elif available:
                    print(f"Available coating for this tool: {available[0]} ({platform} platform)")
    
    print(f"Minimum Chip Thickness: {state['hmin']:.6f} in")
    print(f"Chip Ratio: {state['rub_ratio']:.2f}")

    if state["rub_ratio"] < 1.2 and not state.get("rub_notice_printed", False):
        print("⚠️ Rubbing risk — chip thickness near minimum; consider increasing feed per tooth or stepover.")


    print(f"\nEstimated Tool Life: {life:.1f} minutes")
    # Ensure effective chip thickness exists at return time
    try:
        if not locals().get("h_eff"):
            _fb_diam = float(data.get("diameter", data.get("tool_dia", 0.5)) or 0.5)
            _fb_woc_pct = (float(woc) / _fb_diam * 100.0) if _fb_diam > 0 else data.get("woc_pct", 10.0)
            h_eff = effective_chip_thickness(
                data,
                get_material_group(data.get("material", "steel")),
                ipt,
                _fb_woc_pct,
                _fb_diam,
                doc
            )
    except Exception:
        h_eff = locals().get("h_eff", 0.0) or 0.0
  
    # feed_ipm comes from state["feed"] = rpm × flutes × boosted_ipt (set above).
    # Do NOT override with rpm × flutes × h_eff — h_eff is the effective chip after
    # radial chip thinning and would cancel the RCTF boost, making feed constant.
    flutes = float(data.get("flutes") or 0.0)

    chip_t = (
        locals().get("chip_thickness_in", 0.0)
        or locals().get("chip_thickness", 0.0)
        or locals().get("h_eff", 0.0)
        or 0.0
    )
    
    force_lbf = float(locals().get("force", locals().get("force_lbf", 0.0)) or 0.0)
    sfm_actual = float(sfm_actual or 0.0)

    hp_required = (force_lbf * sfm_actual) / 33000.0 if (force_lbf > 0 and sfm_actual > 0) else 0.0
    # --- Tool life estimate (material-based, Taylor-inspired) ---
    material_key = (data.get("material") or "").lower()

    base_life = BASE_LIFE_MIN.get(material_key, BASE_LIFE_MIN.get(
        get_material_group(material_key).lower(), 35.0
    ))

    # SFM ratio: compare against the un-boosted base (conventional) SFM so HEM isn't penalised
    _base_sfm_conv = BASE_SFM.get(_mat_key, BASE_SFM.get(material_group, 300))
    sfm_target_val = float(_base_sfm_conv or sfm_actual or 1.0)
    sfm_ratio = (sfm_actual / sfm_target_val) if sfm_actual > 0 else 1.0
    # Clamp: running below target SFM doesn't give unrealistic life gains
    sfm_ratio = max(0.5, sfm_ratio)

    # Chip load ratio — baseline = rated IPT for this material at actual diameter
    _ipt_baseline = float(IPT_FRAC.get(_mat_key, IPT_FRAC.get(material_group, 0.005))) * float(data.get("diameter", 0.5) or 0.5)
    chip_ratio = (chip_t / _ipt_baseline) if (chip_t > 0 and _ipt_baseline > 0) else 1.0
    chip_ratio = max(0.5, chip_ratio)

    # Force ratio — baseline scales with tool diameter (larger tool handles more force)
    _dia = float(data.get("diameter", 0.5) or 0.5)
    _force_baseline = 80.0 + (_dia / 0.5) * 120.0  # ~200 lbf at 0.5", ~360 at 1.0"
    force_ratio = (force_lbf / _force_baseline) if force_lbf > 0 else 1.0
    force_ratio = max(0.5, force_ratio)

    # Taylor-inspired exponents (carbide tooling empirical).
    # SFM and chip load are the two primary Taylor drivers. Force is NOT included
    # separately — it is already encoded in both ratios and the old force model
    # was inflated for HEM mode (penalising life that should be better, not worse).
    tool_life_min = base_life / max(
        0.20,
        (sfm_ratio ** 0.40) * (chip_ratio ** 0.30)
    )

    # Coolant life bonus (flood/TSC keep edge cooler → longer life)
    _coolant = data.get("coolant", "flood")
    _coolant_factor = COOLANT_LIFE.get(_coolant, 1.0) * _coolant_fluid_mult(data)
    tool_life_min *= _coolant_factor

    # Coating life factor — material-aware multiplier
    _coating = str(data.get("coating") or "")
    tool_life_min *= _coating_life_factor(_coating, material_group)

    # HEM mode: intermittent engagement lets the cutting edge cool between contacts.
    # At 5% WOC the edge is cutting ~1/6 of the revolution vs ~1/4 at 15% WOC.
    # Empirically validated range: ~1.4–2.0× conventional life at equivalent MRR.
    if (data.get("mode") or "").lower() in ("hem", "trochoidal"):
        _woc_fraction = float(data.get("woc_pct", 10.0) or 10.0) / 100.0
        # Linear scale: 2.0× at ≤2% WOC, 1.40× at 20% WOC
        _hem_bonus = 2.0 - (1.0 - 1.40 / 2.0) * min(1.0, _woc_fraction / 0.20) * 2.0
        # Equivalent: interp from 2.0 (woc=0%) down to 1.40 (woc=20%)
        _hem_bonus = 2.0 + (_woc_fraction / 0.20) * (1.40 - 2.0)
        _hem_bonus = max(1.40, min(2.00, _hem_bonus))
        tool_life_min *= _hem_bonus

    # Corner geometry bonus: radius distributes stress away from a sharp corner,
    # reducing chipping and extending life. Ball nose is all-radius → full benefit.
    _corner_cond = (data.get("corner_condition") or "square").lower()
    if _corner_cond == "corner_radius":
        _cr = float(data.get("corner_radius") or 0.0)
        _dia = float(data.get("diameter", 0.5) or 0.5)
        # Larger CR relative to diameter → stronger corner → more life benefit
        _cr_ratio = (_cr / _dia) if _dia > 0 else 0.0
        _cr_bonus = 1.0 + min(0.75, _cr_ratio * 3.33)  # +40% at 12%D, +60% at 18%D, +75% cap at ~23%D
        tool_life_min *= _cr_bonus
    elif _corner_cond == "ball":
        tool_life_min *= 1.20  # full-radius geometry, no sharp corner

    hp_required = (force_lbf * sfm_actual) / 33000.0 if (force_lbf > 0 and sfm_actual > 0) else 0.0
    # --- HP Required (cutting power estimate) ---
    force_val = float(locals().get("force_lbf", locals().get("force", 0.0)) or 0.0)
    sfm_val = float(sfm_actual or 0.0)

    hp_required = (force_val * sfm_val) / 33000.0 if (force_val > 0 and sfm_val > 0) else 0.0

    # --- Feed limiter identification ---
    _defl      = float(state.get("deflection", 0.0) or 0.0)
    _defl_lim  = float(data.get("deflection_limit", 0.001) or 0.001)
    _load      = float(state.get("load", 0.0) or 0.0)
    _rub       = float(state.get("rub_ratio", 0.0) or 0.0)
    _force     = float(state.get("force", 0.0) or 0.0)
    _force_lim = float(data.get("force_limit", 1e9) or 1e9)

    if _defl >= _defl_lim * 0.95:
        feed_limiter = "Deflection"
        feed_limiter_hint = "Shorten stickout or increase diameter"
    elif _load >= 0.85:
        feed_limiter = "Machine HP"
        feed_limiter_hint = "Reduce DOC, WOC, or feed"
    elif _rub > 0 and _rub < 1.20:
        feed_limiter = "Min chip thickness"
        feed_limiter_hint = "Increase feed per tooth to avoid rubbing"
    elif _force_lim < 1e8 and _force >= _force_lim * 0.95:
        feed_limiter = "Cutting force"
        feed_limiter_hint = "Reduce WOC or chip load"
    else:
        feed_limiter = "User input"
        feed_limiter_hint = "Headroom available — parameters within limits"
    # --- end limiter ---

    _ipt_base = float(IPT_FRAC.get(material_group, IPT_FRAC.get(_mat_key, 0.005))) * float(data.get("diameter", 0.5) or 0.5)
    _woc_pct_out = float(data.get("woc_pct", 50) or 50)
    _chip_thinning_active = _woc_pct_out < 50.0 and float(ipt) > _ipt_base * 1.01


    # ── Stickout Stability Advisor ──────────────────────────────────────────
    _so       = float(data.get("stickout", 0) or 0)
    _d        = float(data.get("diameter", 1) or 1)
    _ld       = round(_so / _d, 2) if _d > 0 else 0.0
    _defl     = float(state.get("deflection", 0) or 0)
    # Mode-appropriate deflection limit.
    # Finishing (0.0005") — dimensional tolerance critical.
    # Standard milling (0.001") — good surface finish.
    # Slotting/roughing (0.002") — slot width tolerance is wide, tool just needs to not chatter/break.
    _mode_str = str(data.get("mode", "") or "")
    _woc_for_dlim = float(data.get("woc_pct", 0) or 0)
    if _mode_str in ("finish", "face", "circ_interp", "ballnose"):
        _dlim_default = 0.0005
    elif _woc_for_dlim >= 90.0:  # full slotting — roughing, not precision
        _dlim_default = 0.002
    else:
        _dlim_default = 0.001
    _dlim     = float(data.get("deflection_limit_override") or _dlim_default)

    # Variable Pitch / Variable Helix chatter resistance bonus.
    # These features disrupt the regenerative chatter feedback loop (Tobias-Tlusty mechanism),
    # raising the stable depth of cut. We model this as an increase in the effective
    # deflection limit — the tool can tolerate more tip deflection before chatter onset.
    # Variable Pitch alone:  +50% (×1.50) — disrupts tooth-timing periodicity
    # Variable Helix alone:  +25% (×1.25) — spreads axial force along the flute
    # Both together:         ×1.75 (not fully multiplicative — shared damping benefit)
    _var_pitch = bool(data.get("variable_pitch", False))
    _var_helix = bool(data.get("variable_helix", False))
    if _var_pitch and _var_helix:
        _dlim *= 1.75
    elif _var_pitch:
        _dlim *= 1.50
    elif _var_helix:
        _dlim *= 1.25

    # HEM / Trochoidal stability bonus:
    # At low radial engagement (<15% WOC) the tool is in air >85% of each revolution.
    # This interrupted nature suppresses the regenerative chatter feedback loop —
    # vibration damps out between tooth engagements rather than building up.
    # Shop-validated: setups that would be flagged as high chatter risk in conventional
    # milling run smoothly in HEM at the same DOC (e.g. 0.5" 5-fl VST5 in 17-4 at
    # 2.5×D DOC / 10% WOC). Apply 2× multiplier to reflect this known phenomenon.
    if _mode_str in ("hem", "trochoidal") and _woc_for_dlim < 15.0:
        _dlim *= 2.0

    # Workholding compliance: rigid fixtures raise the effective limit (system can absorb more
    # tool flex without chatter); weak setups like toe clamps lower it.
    # wh_factor < 1.0 = stiffer than vise → _dlim increases (divide by smaller number)
    # wh_factor > 1.0 = weaker than vise  → _dlim decreases (divide by larger number)
    _wh_key    = str(data.get("workholding", "vise") or "vise")
    _wh_factor = WORKHOLDING_COMPLIANCE.get(_wh_key, 1.0)
    _dlim /= _wh_factor

    _defl_pct = round(_defl / _dlim * 100, 1) if _dlim > 0 else 0.0

    _stab_suggestions = []
    _imm_suggestions  = []   # immediate / no-hardware fixes — shown first
    _hw_suggestions   = []   # hardware / setup changes — shown second

    _lbs = float(data.get("lbs", 0) or 0)  # Length Below Shoulder (neck reach)

    # Minimum stickout: LOC + flute_wash + 15% of diameter clearance buffer
    _loc_for_min = float(data.get("loc", 0) or 0)
    _flute_wash_for_min = float(data.get("flute_wash", 0) or 0)
    _min_so = max(_lbs, _loc_for_min + _flute_wash_for_min + (_d * 0.15))
    if _lbs > 0:
        _stab_suggestions.insert(0, {
            "type": "lbs",
            "label": f'Neck reach (LBS) = {_lbs:.3f}"',
            "detail": f"Stickout cannot go below {_lbs:.3f}\" — tool geometry limit",
        })

    _doc_now = float(state.get("doc", 0) or 0)
    _loc_now = float(data.get("loc", 0) or 0)
    _is_hem  = _mode_str in ("hem", "trochoidal")

    # ── IMMEDIATE / NO-HARDWARE FIXES ─────────────────────────────────────────

    # A) Reduce feed rate — fastest fix; force scales linearly with chip load
    if _defl > _dlim:
        _feed_ratio  = _dlim / _defl
        _feed_pct    = round((1.0 - _feed_ratio) * 100)
        _feed_now    = float(state.get("feed", 0.0) or 0.0)
        _feed_target = round(_feed_now * _feed_ratio, 1) if _feed_now > 0 else 0
        if _feed_pct >= 5:
            _feed_label = f"Back off feed rate ~{_feed_pct}%"
            if _feed_target > 0:
                _feed_label += f" — try {_feed_target} IPM"
            _imm_suggestions.append({
                "type": "feed",
                "label": _feed_label,
                "detail": "Cutting force scales directly with feed — easiest adjustment at the control, no hardware needed.",
            })

    # B) Reduce DOC — skip in HEM (tanks MRR); multi-pass reframe when target is too shallow
    if not _is_hem and _doc_now > 0 and _defl > _dlim:
        _doc_ratio     = _dlim / _defl
        _doc_target    = _doc_now * _doc_ratio
        _doc_xd_target = round(_doc_target / _d, 2) if _d > 0 else 0
        _doc_gain      = round((1.0 - _doc_ratio) * 100)
        _woc_for_doc   = float(data.get("woc_pct", 0) or 0)
        _doc_min_xd    = 0.5 if _woc_for_doc >= 90.0 else 0.1
        _doc_min       = _doc_min_xd * _d if _d > 0 else 0
        if _doc_target < _doc_min:
            import math as _math_doc
            _passes = int(_math_doc.ceil(_doc_now / _doc_target)) if _doc_target > 0 else "?"
            _imm_suggestions.append({
                "type": "doc",
                "label": f"Break into {_passes} passes at {_doc_target:.3f}\" DOC ({_doc_xd_target}×D)",
                "detail": (
                    f"Each pass stays within the safe flex limit — {_passes} axial passes to full depth. "
                    f"~{_doc_gain}% less force per pass."
                    + (" (stickout fixed by LBS — DOC is your primary lever)" if _lbs > 0 else "")
                ),
            })
        else:
            _detail = f"~{_doc_gain}% less axial force — brings flex to safe limit"
            if _lbs > 0:
                _detail += " (stickout fixed by LBS — DOC is your primary lever)"
            _imm_suggestions.append({
                "type": "doc",
                "label": f"Reduce DOC to {_doc_target:.3f}\" ({_doc_xd_target}×D)",
                "detail": _detail,
            })

    # C) Reduce WOC — meaningful above ~15%; handled below (kept with WOC section)

    # D) Detune RPM 10–15% — breaks resonant chatter frequency; free, instant at the control
    if _defl > _dlim * 1.10:
        _rpm_now = float(state.get("rpm", 0.0) or 0.0)
        _rpm_low = round(_rpm_now * 0.88)
        _rpm_high = round(_rpm_now * 0.92)
        if _rpm_now > 0:
            _imm_suggestions.append({
                "type": "rpm_detune",
                "label": f"Try reducing RPM to {_rpm_low}–{_rpm_high} (detune ~10–12%)",
                "detail": "Chatter resonance is frequency-dependent — dropping RPM shifts the tooth-pass frequency off the system's natural frequency. Quick to test at the control with no hardware change.",
            })

    # ── HARDWARE / SETUP IMPROVEMENTS ─────────────────────────────────────────

    # 1) Reduce stickout — free, biggest mechanical gain (L³)
    _seen_stickout = set()
    if _so > 0:
        for frac in (0.70, 0.80):
            _ln = round(max(_so * frac, _min_so), 3)
            if _ln >= _so - 1e-4:
                continue
            if _ln in _seen_stickout:
                continue
            _gain = round(((_so / _ln) ** 3 - 1.0) * 100.0) if _ln > 0 else 0
            if _gain < 10:
                continue
            _seen_stickout.add(_ln)
            _at_floor = _ln >= _min_so - 1e-4 and _so * frac < _min_so - 1e-4
            _floor_note = f" (min — LOC{'+wash' if _flute_wash_for_min > 0 else ''} clearance floor)" if _at_floor else ""
            _hw_suggestions.append({
                "type": "stickout",
                "label": f'Shorten stickout to {_ln:.2f}"',
                "detail": f"{_gain}% stiffer{_floor_note}",
                "stickout_in": _ln,
                "gain_pct": _gain,
            })

    # 2) Toolholder upgrade
    _holder_progression = [
        ("er_collet",     1.00, "ER Collet",      ""),
        ("hp_collet",     1.05, "HP Collet",      "e.g. Lyndex SK, Pioneer FX"),
        ("weldon",        1.08, "Weldon / Side-Lock", ""),
        ("milling_chuck", 1.12, "Milling Chuck",  ""),
        ("hydraulic",     1.14, "Hydraulic",      ""),
        ("press_fit",     1.17, "Press-Fit",      ""),
        ("shrink_fit",    1.18, "Shrink Fit",     ""),
        ("capto",         1.20, "Capto",          ""),
    ]
    _current_holder = data.get("toolholder", "er_collet")
    _current_rig    = TOOLHOLDER_RIGIDITY.get(_current_holder, 1.0)
    _current_dc     = bool(data.get("dual_contact", False))
    if _defl > _dlim:
        _next_holder = next(
            ((k, r, lbl, brands) for k, r, lbl, brands in _holder_progression if r > _current_rig + 0.01),
            None
        )
        if _next_holder:
            _nh_key, _nh_rig, _nh_lbl, _nh_brands = _next_holder
            _nh_rig_total = _nh_rig * (1.08 if _current_dc else 1.0)
            _nh_defl_pct  = round(_defl / _nh_rig_total * _current_rig / _dlim * 100, 1) if _dlim > 0 else 0
            _nh_gain      = round((1.0 - _current_rig / _nh_rig) * 100)
            _nh_label     = f"Upgrade to {_nh_lbl}" + (f" ({_nh_brands})" if _nh_brands else "")
            _hw_suggestions.append({
                "type": "holder",
                "label": _nh_label,
                "detail": f"~{_nh_gain}% stiffer grip — est. flex drops to {_nh_defl_pct}% of limit",
            })
        # Dual contact — informational only
        _taper = data.get("spindle_taper", "")
        if not _current_dc and _taper and (_taper.startswith("CAT") or _taper.startswith("BT")):
            _dc_defl_pct = round(_defl / (_current_rig * 1.08) / _dlim * 100, 1) if _dlim > 0 else 0
            _hw_suggestions.append({
                "type": "info",
                "label": "FYI: Dual Contact spindle would help big time here!",
                "detail": (
                    f"Did you forget to select Dual Contact above? If your machine supports it, "
                    f"enable it now — it adds ~8% spindle stiffness and est. deflection drops to {_dc_defl_pct}% of limit. "
                    f"If your machine doesn't support it, it may be worth moving this job to a dual contact spindled machine in your shop."
                ),
            })

    # 3) Reduced-neck tool — same reach, shorter flute section, multiple passes
    if _lbs == 0 and _defl > _dlim and _so > 0 and _doc_now > 0:
        import math as _math
        _flutes_n    = int(data.get("flutes", 4) or 4)
        _core_ratio_n = {2:0.60,3:0.65,4:0.70,5:0.75,6:0.80,7:0.82}.get(_flutes_n, 0.70)
        _E_n         = 90_000_000
        _I_flute_n   = (_math.pi * (_d * _core_ratio_n)**4) / 64.0
        _I_neck_n    = (_math.pi * _d**4) / 64.0
        _loc_neck    = max(min(1.5 * _d, _doc_now * 0.5), _d)
        _passes      = _math.ceil(_doc_now / _loc_neck)
        if _I_flute_n > 0:
            _force_est  = _defl * 3 * _E_n * _I_flute_n / (_so ** 3)
            _defl_neck  = (_force_est / (3 * _E_n)) * (
                _loc_neck**3 / _I_flute_n +
                (_so**3 - _loc_neck**3) / _I_neck_n
            )
            _defl_neck_pct = round(_defl_neck / _dlim * 100, 1) if _dlim > 0 else 0
            if _defl_neck < _defl * 0.85:
                _hw_suggestions.append({
                    "type": "tool",
                    "label": f'Reduced-neck tool: {_so:.2f}" reach, {_loc_neck:.3f}" LOC ({round(_loc_neck/_d,1)}×D)',
                    "detail": f"{_passes} axial pass{'es' if _passes > 1 else ''} to full depth — est. flex drops to {_defl_neck_pct}% of limit",
                })

    # 4) Reduce WOC — lighter engagement, meaningful above ~15%
    _woc_now = float(data.get("woc_pct", 0) or 0)
    if _woc_now > 15 and _defl > _dlim:
        if _woc_now >= 90.0:
            # Full slotting — can't reduce WOC without changing the operation.
            # HEM requires a SMALLER tool so it can trochoidal-path inside the slot.
            # Recommend 0.75× slot width, and more flutes to offset the smaller dia stiffness loss.
            _slot_width = _d  # slot width = current tool dia (100% WOC)
            _hem_dia = round(_slot_width * 0.75 * 16) / 16  # round to nearest 1/16"
            if _hem_dia <= 0:
                _hem_dia = _slot_width * 0.75
            # Flute recommendation by material group
            _mat_grp_hem = get_material_group(str(data.get("material", "") or ""))
            if _mat_grp_hem in ("Aluminum", "aluminum_wrought", "aluminum_wrought_hs", "aluminum_cast", "Non-Ferrous"):
                _hem_flutes = "3 or 5-flute"
            elif _mat_grp_hem in ("Inconel", "Titanium", "Stainless",
                                   "stainless_austenitic", "stainless_ph", "inconel_718",
                                   "titanium_64", "hiTemp_fe", "hiTemp_co"):
                _hem_flutes = "7-flute"
            else:
                _hem_flutes = "5 or 7-flute"
            _hw_suggestions.append({
                "type": "woc",
                "label": f"Switch to HEM / trochoidal — use {_hem_dia:.4f}\" {_hem_flutes} tool",
                "detail": (
                    f"Since our slot width is {_d:.4f}\", we'll need a smaller tool — "
                    f"use a {_hem_dia:.4f}\" {_hem_flutes} tool on a trochoidal path at 5–10% WOC. "
                    f"The smaller diameter reduces stiffness — the extra flutes offset that. "
                    f"Higher SFM and far lower radial force; net MRR is often equal or better."
                ),
            })
        else:
            _woc_target = max(8.0, _woc_now * 0.5)
            _woc_gain = round((1.0 - (_woc_target / _woc_now)) * 100)
            _imm_suggestions.append({
                "type": "woc",
                "label": f"Reduce WOC to {_woc_target:.0f}% Ø",
                "detail": f"~{_woc_gain}% less radial engagement — fewer simultaneous teeth, lower radial force",
            })

    # 5) Shorter holder suggestion — if holder gage length is set and contributing to deflection
    _hgl = float(data.get("holder_gage_length", 0) or 0)
    if _hgl > 0 and _defl > _dlim:
        import math as _math2
        _hnd = float(data.get("holder_nose_dia", 0) or 0) or (_d * 2.0)
        _E_s = 30_000_000
        _I_h = (_math2.pi * _hnd**4) / 64.0
        _flutes_h = int(data.get("flutes", 4) or 4)
        _cr_h = {2:0.60,3:0.65,4:0.70,5:0.75,6:0.80,7:0.82}.get(_flutes_h, 0.70)
        _I_t = (_math2.pi * (_d * _cr_h)**4) / 64.0
        _E_c = 90_000_000
        # What would deflection be with half the holder gage length?
        _hgl_short = _hgl * 0.5
        _L_total_short = _hgl_short + _so
        _force_h = _defl * 3.0 / ((_hgl + _so)**3 / (_E_s * _I_h) - _so**3 / (_E_s * _I_h) + _so**3 / (_E_c * _I_t)) if _I_h > 0 else 0
        if _force_h > 0:
            _defl_short = (_force_h / 3.0) * (
                (_L_total_short**3 - _so**3) / (_E_s * _I_h) +
                _so**3 / (_E_c * _I_t)
            )
            _defl_short_pct = round(_defl_short / _dlim * 100, 1) if _dlim > 0 else 0
            _hw_suggestions.append({
                "type": "holder",
                "label": f'Use shorter extension holder ({_hgl_short:.2f}" gage vs current {_hgl:.2f}")',
                "detail": f"Shorter nose projection — est. deflection drops to {_defl_short_pct}% of limit",
            })

    # 5b) Extension holder warning — multi-joint compliance note
    _ext_holder = bool(data.get("extension_holder", False))
    if _ext_holder:
        _hw_suggestions.append({
            "type": "info",
            "label": "Extension holder in use — spindle → holder → extension → tool",
            "detail": (
                "Each interface adds compliance and runout. Best fix: replace with a long-reach integral holder "
                "(extended shrink fit or hydraulic). If the extension must stay: use the shortest reach possible, "
                "maximize shank diameter in the extension nose, and consider a variable-pitch tool to disrupt resonance."
            ),
        })

    # 7b) Increase flute count — larger core diameter → D_core⁴ stiffness gain
    # Slotting rules (chip clearance limits flute count):
    #   Aluminum slot → max 3 flutes (chip packing); chipbreaker 3-fl even better
    #   Steel slot → max 4 flutes standard; 5-fl only at ≤0.5×D DOC
    _flute_core_map = {2:0.60, 3:0.65, 4:0.70, 5:0.75, 6:0.80, 7:0.82,
                       8:0.84, 9:0.86, 10:0.87, 11:0.88, 12:0.89}
    # Catalog-available flute counts by cutting diameter (Core Cutter)
    _geo = str(data.get("geometry") or "standard").lower()
    _is_cb = "chipbreaker" in _geo
    _dia_key = round(_d * 32) / 32  # round to nearest 1/32"
    _is_vrx = "truncated" in _geo or "rougher" in _geo
    if _is_vrx:
        # Truncated rougher (VRX): only offered in 1/2" and 3/4"; 4 and 5 flutes only
        if _dia_key not in (0.375, 0.500, 0.750):
            _avail_flutes = []  # VRX not available at this diameter — no flute suggestion
        else:
            _avail_flutes = [4, 5]
    elif _is_cb:
        # Chipbreaker: min 3 flutes; same diameter breakdowns
        _dia_flute_catalog = {
            1.000: [3,4,5,6,7,9,11],
            0.750: [3,4,5,6,7,9],
        }
        _avail_flutes = _dia_flute_catalog.get(_dia_key, [3,4,5,6,7])
    else:
        # Standard
        _dia_flute_catalog = {
            1.000: [2,3,4,5,6,7,9,11],
            0.750: [2,3,4,5,6,7,9],
        }
        _avail_flutes = _dia_flute_catalog.get(_dia_key, [2,3,4,5,6,7])
    _cur_flutes = int(data.get("flutes", 4) or 4)
    _cur_cr = _flute_core_map.get(_cur_flutes, 0.70)
    _is_slotting = float(data.get("woc_pct", 0) or 0) >= 90.0
    _doc_xd = float(data.get("doc_xd", 1.0) or 1.0)
    _is_aluminum_grp = material_group in ("Aluminum",)
    _is_steel_grp = material_group in ("Steel",)
    # Next 1-2 available flute counts above current from catalog
    _next_flutes = [f for f in _avail_flutes if f > _cur_flutes][:2]
    for _nf in _next_flutes:
        if _nf > max(_avail_flutes):
            break
        # Chip-clearance gate — use the same FLUTE_WOC_LIMITS table
        _nf_slot_xd, _nf_max_woc = flute_woc_limits(_nf)
        _woc_pct_stab = float(data.get("woc_pct", 0) or 0)
        if _woc_pct_stab >= 90.0:
            # Slotting: proposed flute count must allow slotting at this DOC
            if _nf_slot_xd is None:
                continue  # this flute count can't slot at all
            if _doc_xd > _nf_slot_xd:
                continue  # doc exceeds the slotting limit for this flute count
        else:
            # Side milling: proposed flute count must allow this WOC
            if _woc_pct_stab > _nf_max_woc:
                continue  # chip-clearance violation — skip this suggestion
        _new_cr = _flute_core_map.get(_nf, 0.89)
        _fl_stiff_gain = (_new_cr / _cur_cr) ** 4
        if _fl_stiff_gain < 1.06:   # skip if gain is negligible (<6%)
            continue
        _defl_fl_pct = round(_defl / _fl_stiff_gain / _dlim * 100, 1) if _dlim > 0 else 0
        _fl_pct_gain = round((_fl_stiff_gain - 1.0) * 100)
        # Always note WOC/DOC limits so the user knows what the suggested tool requires
        _fl_note = ""
        if _woc_pct_stab >= 90.0:
            if _nf_slot_xd and _nf_slot_xd <= 0.5:
                _fl_note = f" — slotting max {_nf_slot_xd:.1f}×D DOC; side mill at ≤{_nf_max_woc:.0f}% WOC"
            else:
                _fl_note = f" — side mill max {_nf_max_woc:.0f}% WOC"
        else:
            _fl_note = f" — max {_nf_max_woc:.0f}% WOC for chip clearance"
        _hw_suggestions.append({
            "type": "tool",
            "label": f"Use {_nf}-flute tool (same diameter)",
            "detail": f"~{_fl_pct_gain}% stiffer core — est. deflection drops to {_defl_fl_pct}% of limit{_fl_note}",
            "suggested_flutes": _nf,
            "lookup_dia": _d,
            "lookup_loc": float(data.get("loc", 0) or 0),
            "lookup_series": data.get("tool_series", ""),
            "lookup_corner": data.get("corner_condition", ""),
            "lookup_cr": float(data.get("corner_radius", 0) or 0),
            "lookup_edp": str(data.get("edp", "") or ""),
        })

    # 8) Diameter step-up (D⁴ law)
    _common = [0.125, 0.1875, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.75, 1.0, 1.25, 1.5, 2.0]
    _next_d = next((s for s in _common if s > _d + 1e-4), None)
    if _next_d:
        _d_gain = round((_next_d / _d) ** 4, 1)
        _hw_suggestions.append({
            "type": "diameter",
            "label": f'Increase Tool Diameter to {_next_d:.3f}"',
            "detail": f"{_d_gain}× stiffer (D\u2074 law)",
            "lookup_dia": _next_d,
            "lookup_loc": float(data.get("loc", 0) or 0),
            "lookup_flutes": int(data.get("flutes", 0) or 0),
            "lookup_series": data.get("tool_series", ""),
            "lookup_corner": data.get("corner_condition", ""),
            "lookup_cr": float(data.get("corner_radius", 0) or 0),
            "lookup_edp": str(data.get("edp", "") or ""),
        })

    # Merge: immediate fixes first (change at the control), hardware/setup changes second
    _stab_suggestions = _stab_suggestions + _imm_suggestions + _hw_suggestions

    _stability = {
        "stickout_in": _so,
        "l_over_d": _ld,
        "deflection_in": _defl,
        "deflection_limit_in": _dlim,
        "deflection_pct": _defl_pct,
        "suggestions": _stab_suggestions,
    }
    # ── end Stability Advisor ────────────────────────────────────────────────

    # ── Circular Interpolation output correction ────────────────────────────
    # feed_ipm from the engine = straight-line equivalent (peripheral feed at wall).
    # For circ_interp we display the programmed tool-center feed and note the peripheral.
    _peripheral_feed_ipm = None
    if mode == "circ_interp" and _ci_feed_ratio and _ci_feed_ratio > 0:
        _peripheral_feed_ipm = float(feed_ipm)           # what the tool edge actually sees
        feed_ipm = round(_peripheral_feed_ipm * _ci_feed_ratio, 2)  # programmed tool-center feed
    # ── end circ_interp output ──────────────────────────────────────────────

    # ── Teeth in cut + helix wrap (for display) ──────────────────────────────
    # teeth_in_cut = time-average radial engagement fraction × flutes.
    # This is the correct value for force/HP averaging (independent of helix).
    # helix_wrap_deg = how far the flute spirals over the DOC — shows whether
    # the cut is continuous (always cutting somewhere axially).
    # Continuity condition: helix_wrap + engagement_arc >= pitch_angle.
    _helix_wrap_deg = None
    _engagement_continuous = None
    try:
        _tic_woc   = float(woc or 0)
        _tic_d     = float(data.get("diameter", 0.5) or 0.5)
        _tic_fl    = int(data.get("flutes", 4) or 4)
        _tic_helix = float(data.get("helix", 35) or 35)
        _tic_doc   = float(state.get("doc", 0) or doc or 0)

        _tic_ae  = max(-1.0, min(1.0, 1.0 - 2.0 * _tic_woc / _tic_d)) if _tic_d > 0 else 1.0
        _tic_ang = 2.0 * math.acos(_tic_ae)            # radial engagement arc (rad)

        # Helix wrap angle over DOC
        _helix_wrap_rad = (2.0 * _tic_doc * math.tan(math.radians(_tic_helix)) / _tic_d) if _tic_d > 0 else 0.0
        _helix_wrap_deg = round(math.degrees(_helix_wrap_rad), 1)

        # Continuity: cut is always engaged somewhere if wrap + arc >= pitch
        _pitch_rad = 2.0 * math.pi / max(1, _tic_fl)
        _engagement_continuous = (_helix_wrap_rad + _tic_ang) >= _pitch_rad

        # Time-average teeth — first try state, then compute
        _teeth_in_cut_result = state.get("teeth_in_cut")
        if _teeth_in_cut_result is None:
            _teeth_in_cut_result = round(max(0.1, (_tic_ang / (2.0 * math.pi)) * _tic_fl), 2)
    except Exception:
        _teeth_in_cut_result = None
    # ── end teeth in cut ─────────────────────────────────────────────────────

    # ── Chip-clearance check (WOC vs flute count) ───────────────────────────
    # Skip for face milling — high WOC is normal (stepover), no chip-packing risk
    # at the light axial DOC used for facing passes.
    _cc_notes  = []
    _cc_risk   = None
    _fl_cc     = int(data.get("flutes", 4) or 4)
    _woc_pct_cc = float(data.get("woc_pct", 0) or 0)
    _doc_xd_cc  = float(data.get("doc_xd", 1.0) or 1.0)
    _max_slot_xd, _max_side_woc = flute_woc_limits(_fl_cc)

    if (data.get("mode") or "").lower() in ("face", "circ_interp"):
        pass  # face: high WOC is intentional stepover; circ_interp: WOC = radial wall, not chip-clearance concern
    elif _woc_pct_cc >= 90.0:
        # Slotting check
        if _max_slot_xd is None:
            _cc_notes.append(
                f"⚠ {_fl_cc}-flute tools are not suitable for slotting — insufficient chip clearance. "
                f"Max recommended WOC is {_max_side_woc:.0f}% for side milling. "
                f"For full-slot work use 4-flute or fewer."
            )
            _cc_risk = "warning"
        elif _doc_xd_cc > _max_slot_xd:
            _cc_notes.append(
                f"⚠ {_fl_cc}-flute slotting: DOC {_doc_xd_cc:.2f}×D exceeds chip-clearance limit. "
                f"Max recommended DOC for {_fl_cc}-flute slotting is {_max_slot_xd:.1f}×D."
            )
            _cc_risk = "caution"
    elif _woc_pct_cc > _max_side_woc:
        # Side milling too heavy for flute count
        _over = round(_woc_pct_cc - _max_side_woc, 1)
        _cc_notes.append(
            f"⚠ WOC {_woc_pct_cc:.0f}% is {_over}% above the recommended max for {_fl_cc}-flute tools "
            f"({_max_side_woc:.0f}% max). Chip packing risk — reduce WOC or use fewer flutes."
        )
        _cc_risk = "caution"
    # ── end chip-clearance check ─────────────────────────────────────────────

    # ── RPM-limited SFM warning (micro tools) ────────────────────────────────
    if _rpm_limited:
        _sfm_deficit_pct = round(100.0 - _sfm_pct_of_target, 0)
        _cc_notes.append(
            f"⚠ RPM-limited: running at {_sfm_pct_of_target:.0f}% of target SFM "
            f"({sfm_actual:.0f} vs {base_sfm:.0f} SFM). "
            f"Tool life will be longer than estimated — lower SFM reduces edge heat. "
            f"A higher-speed spindle would allow full chip load at target SFM."
        )
        if _cc_risk is None:
            _cc_risk = "caution"
    # ── HP Required — MRR × unit power (HP_PER_CUIN) ────────────────────────
    # The force-based calc (force × SFM / 33000) inflates HP at HEM chip loads
    # because HEM_IPT_MULT boosts h_eff, which inflates instantaneous force.
    # MRR × unit power matches shop-measured spindle loads for HEM and conventional.
    _mrr_for_hp = float(doc) * float(woc) * float(feed_ipm)
    _mat_key_hp = data.get("material", material_group)
    _geom_hp_factor = GEOMETRY_KC_FACTOR.get(
        str(data.get("geometry", "standard") or "standard").lower(), 1.0
    )
    # Apply hardness correction: harder material takes more power per unit volume removed.
    _hrc_for_hp = float(data.get("hardness_hrc", 0) or 0)
    _hardness_hp_factor = hardness_kc_mult(_hrc_for_hp)
    hp_required = _mrr_for_hp * HP_PER_CUIN.get(
        _mat_key_hp, HP_PER_CUIN.get(material_group, 1.0)
    ) * _geom_hp_factor * _hardness_hp_factor
    # ── end HP Required ──────────────────────────────────────────────────────

    # Facing stepover recommendation: (tool_dia - 2 × corner_radius) × 0.75
    _face_mode = (data.get("mode") or "").lower() == "face"
    _face_tool_dia = float(data.get("tool_dia") or data.get("diameter") or 0)
    _face_cr = float(data.get("corner_radius") or 0)
    _rec_so = round((_face_tool_dia - 2 * _face_cr) * 0.75, 5) if _face_mode and _face_tool_dia > 0 else None

    # Surface finish (Ra) cap for face mode
    _target_ra = float(data.get("target_ra_uin") or 0)
    _ra_actual = None
    _ra_feed_capped = False
    if _face_mode and _face_cr > 0:
        _ra_actual = round((_ipt_base ** 2 * 1_000_000) / (8 * _face_cr), 2)
        if _target_ra > 0:
            _max_fpt = math.sqrt(_target_ra * 8 * _face_cr / 1_000_000)
            if _ipt_base > _max_fpt:
                _ipt_base = _max_fpt
                ipt = _max_fpt  # no chip thinning adjustment for facing (WOC ≈ full dia)
                feed_ipm = round(rpm * ipt * float(data.get("flutes", flutes)), 2)
                _ra_actual = round(_target_ra, 2)  # capped to exactly the target
                _ra_feed_capped = True
                # Recalculate MRR and HP with the capped feed
                _mrr_for_hp = float(doc) * float(woc) * float(feed_ipm)
                hp_required = _mrr_for_hp * HP_PER_CUIN.get(
                    data.get("material", material_group), HP_PER_CUIN.get(material_group, 1.0)
                ) * _geom_hp_factor * _hardness_hp_factor

    result = {
        "customer": {
            "material": data.get("material"),
            "diameter": data.get("diameter"),
            "flutes": data.get("flutes"),
            "rpm": rpm,
            "sfm": sfm_actual,
            "sfm_target": base_sfm,
            "feed_ipm": feed_ipm,
            "doc_in": doc,
            "woc_in": woc,
            "mrr_in3_min": float(doc) * float(woc) * float(feed_ipm),
            "spindle_load_pct": round(min(float(hp_required) / machine_hp, 9.99) * 100, 1) if machine_hp > 0 else 0.0,
            "hp_required": float(hp_required),
            "fpt": round(_ipt_base, 6),
            "adj_fpt": round(float(ipt), 6) if _chip_thinning_active else None,
            "peripheral_feed_ipm": round(_peripheral_feed_ipm, 2) if _peripheral_feed_ipm else None,
            "ci_a_e_in": round(_ci_a_e_in, 4) if _ci_a_e_in else None,
            "ci_feed_ratio": round(_ci_feed_ratio, 3) if _ci_feed_ratio else None,
            "recommended_stepover": _rec_so,
            "ra_actual_uin": _ra_actual,
            "ra_feed_capped": _ra_feed_capped,
            "d_eff_in":          round(_surf_d_eff,        5) if _surf_d_eff        is not None else None,
            "scallop_height_in": round(_surf_scallop_h,    6) if _surf_scallop_h    is not None else None,
            "stepover_in":       round(_surf_stepover_in,  5) if _surf_stepover_in  is not None else None,
            "stepover_pct_d":    round(_surf_stepover_pct, 2) if _surf_stepover_pct is not None else None,
            "status": feed_limiter,
            "status_hint": feed_limiter_hint,
            "risk": _cc_risk,
            "notes": _cc_notes if _cc_notes else None,
        },
        "engineering": {
            "deflection_in": locals().get("deflection", 0.0),
            "chip_thickness_in": float(chip_t),
            "chatter_index": locals().get("chatter_index", 0.0),
            "teeth_in_cut": _teeth_in_cut_result,
            "helix_wrap_deg": _helix_wrap_deg,
            "engagement_continuous": _engagement_continuous,
            "tool_life_min": float(tool_life_min),
            "force_lbf": locals().get("total_force", locals().get("force", 0.0)),
            "torque_inlbf": round(hp_required * 63025.0 / float(rpm), 2) if float(rpm) > 0 else None,
            "torque_capacity_inlbf": SPINDLE_TORQUE_CAPACITY.get(data.get("spindle_taper", "CAT40"), None),
            "torque_pct": (
                round(
                    (hp_required * 63025.0 / float(rpm)) /
                    SPINDLE_TORQUE_CAPACITY[data.get("spindle_taper", "CAT40")] * 100.0, 1
                )
                if float(rpm) > 0 and data.get("spindle_taper", "CAT40") in SPINDLE_TORQUE_CAPACITY
                else None
            ),
        },
        "stability": _stability,
        "entry_moves": {
            "ramp_angle_deg":           round(locals().get("ramp_angle", 3.0), 1),
            "standard_ramp_ipm":        round(locals().get("standard_ramp_feed", 0.0), 2),
            "standard_helix_ipm":       round(locals().get("standard_helix_feed", 0.0), 2),
            "advanced_ramp_ipm":        round(locals().get("advanced_feed", 0.0), 2),
            "advanced_helix_ipm":       round(locals().get("advanced_helix_feed", 0.0), 2),
            "helix_bore_min_in":        round(locals().get("helix_bore", 0.0), 4),
            "helix_bore_ideal_low":     round(locals().get("diameter", 0.0) * 1.30, 4),
            "helix_bore_ideal_high":    round(locals().get("diameter", 0.0) * 1.60, 4),
            "helix_pitch_in":           round(locals().get("pitch", 0.0), 5),
            "helix_angle_deg":          round(locals().get("angle_deg", 0.0), 2),
            "adv_helix_pitch_in":       round(locals().get("adv_pitch", 0.0), 5),
            "adv_helix_angle_deg":      round(locals().get("adv_angle_deg", 0.0), 2),
            # Sweep / roll-in arc entry
            "sweep_arc_radius_min_in":  locals().get("sweep_arc_radius_min_in", 0.0),
            "sweep_arc_radius_rec_in":  locals().get("sweep_arc_radius_rec_in", 0.0),
            "sweep_entry_ipm":          locals().get("sweep_entry_ipm", 0.0),
            "sweep_full_ipm":           locals().get("sweep_full_ipm", 0.0),
            # Straight / perpendicular entry
            "straight_entry_ipm":       locals().get("straight_entry_ipm", 0.0),
            # Entry caution level: null | "medium_hardness" | "high_hardness"
            "entry_caution":            locals().get("entry_caution", None),
            "entry_feed_pct":           round(locals().get("entry_feed_mult", 0.50) * 100),
        },
        "debug": None
    }

    return result


# ============================================================
# THREAD MILLING ENGINE
# ============================================================

def run_thread_mill(payload: dict) -> dict:
    """Thread milling advisor: speeds, feeds, pass count, deflection, and G-code."""
    import math

    mat        = str(payload.get("material", "steel_alloy") or "steel_alloy")
    mat_group  = get_material_group(mat)
    _hv        = float(payload.get("hardness_value", 0) or 0)
    _hs        = str(payload.get("hardness_scale", "hrc") or "hrc").lower()
    hrc        = hrb_to_hrc(_hv) if _hs == "hrb" else _hv

    thread_std      = str(payload.get("thread_standard", "unc") or "unc").lower()
    major_dia       = float(payload.get("thread_major_dia", 0.5) or 0.5)
    tpi_input       = payload.get("thread_tpi", None)
    pitch_mm_input  = payload.get("thread_pitch_mm", None)
    thread_class    = str(payload.get("thread_class", "2B") or "2B")
    internal        = bool(payload.get("thread_internal", True))
    engagement      = float(payload.get("thread_engagement", 0.5) or 0.5)  # inches
    hand            = str(payload.get("thread_hand", "right") or "right").lower()
    npt_size        = str(payload.get("npt_size", "") or "")

    tool_dia        = float(payload.get("tool_dia", 0.375) or 0.375)
    tool_rows       = max(1, min(4, int(payload.get("thread_rows", 1) or 1)))
    neck_length     = float(payload.get("thread_neck_length", 0) or 0)
    stickout        = float(payload.get("stickout", 0) or 0) or (tool_dia * 3)
    max_rpm         = int(float(payload.get("max_rpm", 10000) or 10000))
    machine_hp      = float(payload.get("machine_hp", 25) or 25)
    coolant         = str(payload.get("coolant", "flood") or "flood")
    dialect         = str(payload.get("thread_gcode_dialect", "fanuc") or "fanuc").lower()
    cut_direction   = str(payload.get("thread_cut_direction", "top_down") or "top_down").lower()
    bottom_up       = cut_direction == "bottom_up"

    # ── Resolve pitch ───────────────────────────────────────────────────────
    pitch_in = None
    is_tapered = thread_std in ("npt", "nptf")

    if thread_std in ("unc", "unf", "unef"):
        tpi_table = UN_TPI.get(thread_std, {})
        if tpi_input:
            tpi_val = float(tpi_input)
        else:
            closest = min(tpi_table.keys(), key=lambda d: abs(d - major_dia))
            tpi_val = tpi_table.get(closest, 20)
        pitch_in = 1.0 / tpi_val

    elif thread_std == "metric":
        # major_dia supplied in mm for metric — convert to inches for geometry
        dia_mm = major_dia * 25.4
        if pitch_mm_input:
            pitch_mm = float(pitch_mm_input)
        else:
            closest_mm = min(METRIC_PITCH.keys(), key=lambda d: abs(d - dia_mm))
            pitch_mm = METRIC_PITCH.get(closest_mm, 1.0)
        pitch_in = pitch_mm / 25.4
        tpi_val  = 25.4 / pitch_mm

    elif is_tapered:
        if npt_size and npt_size in NPT_DATA:
            major_dia, tpi_val = NPT_DATA[npt_size]
        else:
            tpi_val = float(tpi_input) if tpi_input else 14
        pitch_in = 1.0 / tpi_val

    else:
        tpi_val  = float(tpi_input) if tpi_input else 20
        pitch_in = 1.0 / tpi_val

    tpi_val = 1.0 / pitch_in

    # ── Thread geometry ─────────────────────────────────────────────────────
    h_thread   = thread_depth_in(pitch_in)
    minor_dia  = thread_minor_dia(major_dia, pitch_in)
    pitch_dia  = thread_pitch_dia(major_dia, pitch_in)

    # Tool center path radius
    if internal:
        r_full = (major_dia - tool_dia) / 2.0
    else:
        r_full = (major_dia + tool_dia) / 2.0

    # ── Radial passes ────────────────────────────────────────────────────────
    has_neck    = neck_length > 0
    num_passes  = threadmill_passes(pitch_in, mat_group, thread_class, tool_dia, has_neck)
    spring_pass = threadmill_spring_pass(thread_class)

    # Variable pass distribution: finish pass fraction scales with material difficulty
    # Tougher materials = lighter finish pass (less spring-back, better thread accuracy)
    finish_frac = {
        "Aluminum":    0.35,
        "Non-Ferrous": 0.35,
        "Plastics":    0.35,
        "Cast Iron":   0.30,
        "Steel":       0.30,
        "Stainless":   0.25,
        "Titanium":    0.25,
        "Inconel":     0.20,
    }.get(mat_group, 0.30)

    if num_passes == 1:
        pass_docs = [round(h_thread, 5)]
    else:
        finish_doc   = round(h_thread * finish_frac, 5)
        rough_each   = round((h_thread - finish_doc) / (num_passes - 1), 5)
        pass_docs    = [rough_each] * (num_passes - 1) + [finish_doc]
        # Correct rounding drift on first pass
        pass_docs[0] = round(h_thread - sum(pass_docs[1:]), 5)

    doc_per_pass = pass_docs[-1]  # finish pass DOC (smallest) used for force/deflection calc

    # ── SFM / RPM ────────────────────────────────────────────────────────────
    base_sfm    = BASE_SFM.get(mat, BASE_SFM.get(mat_group, 200))
    sfm_factor  = threadmill_sfm_factor(mat_group)
    cool_mult   = {
        "dry": 0.75, "mist": 0.88, "flood": 1.00,
        "tsc_low": 1.10, "tsc_high": 1.15,
    }.get(coolant, 1.00)
    target_sfm  = base_sfm * sfm_factor * cool_mult * hardness_sfm_mult(hrc)
    rpm         = min((target_sfm * 3.82) / tool_dia, max_rpm)
    sfm_actual  = (rpm * tool_dia) / 3.82

    # ── Chip load (FPT) ──────────────────────────────────────────────────────
    base_ipt = IPT_FRAC.get(mat, IPT_FRAC.get(mat_group, 0.001)) * tool_dia
    # Thread form engagement reduces effective chip thickness ~20%
    fpt      = base_ipt * 0.80 * (hardness_kc_mult(hrc) ** -0.35)
    # Feed multiplied by actual flute count (cutting teeth), not thread profiles
    thread_flutes = max(1, int(payload.get("flutes", 4) or 4))
    feed_ipm = rpm * fpt * thread_flutes

    # ── Force and deflection ──────────────────────────────────────────────────
    Kc = 150000 * hardness_kc_mult(hrc) * {
        "Steel": 1.0, "Stainless": 1.15, "Inconel": 1.35,
        "Titanium": 1.20, "Aluminum": 0.40, "Cast Iron": 0.80,
    }.get(mat_group, 1.0)
    arc_fraction   = 0.25   # thread mill typically ~90° engagement arc
    teeth_engaged  = max(0.1, arc_fraction * tool_rows)
    force_lbf      = Kc * doc_per_pass * fpt * teeth_engaged

    # Two-segment cantilever if necked
    E       = 9.3e7   # carbide modulus (lbf/in²)
    I_full  = math.pi * tool_dia**4 / 64
    I_neck  = math.pi * tool_dia**4 / 64   # neck = same tip dia

    if has_neck and neck_length > 0:
        L_neck  = neck_length
        L_shank = max(0.0, stickout - neck_length)
        defl = (force_lbf / (3 * E)) * (
            L_neck**3 / I_neck
            + 3 * L_neck**2 * L_shank / I_neck
            + L_shank**3 / I_full
        )
    else:
        defl = force_lbf * stickout**3 / (3 * E * I_full)

    defl_limit = tool_dia * 0.003   # tighter than endmill limit
    defl_pct   = (defl / defl_limit * 100) if defl_limit > 0 else 0

    # ── Notes / warnings ─────────────────────────────────────────────────────
    notes = []
    if tool_dia >= major_dia and internal:
        notes.append(
            f"Tool diameter ({tool_dia:.4f}\") must be smaller than thread minor "
            f"diameter ({minor_dia:.4f}\") for internal threading."
        )
    if defl_pct > 150:
        notes.append(
            f"Deflection {defl_pct:.0f}% of limit — consider reducing radial DOC "
            f"per pass or increasing passes."
        )
    if is_tapered:
        notes.append(
            f"NPT/NPTF taper: {NPT_TAPER_PER_IN:.4f}\" per inch on diameter. "
            f"G-code uses incremental radius steps per pitch."
        )
    if spring_pass:
        notes.append(
            f"Class {thread_class}: spring pass (repeat final pass at same offset) "
            f"recommended for thread accuracy."
        )
    if not bottom_up and mat_group in ("Inconel", "Titanium"):
        notes.append(
            "Bottom-up cutting recommended for Inconel/Titanium — "
            "chips evacuate toward the opening and cutting forces are directed away from the bottom of the hole."
        )

    # ── G-code generation ────────────────────────────────────────────────────
    gcode = _generate_threadmill_gcode(
        thread_std=thread_std, major_dia=major_dia, pitch_in=pitch_in, tpi=tpi_val,
        thread_class=thread_class, internal=internal, engagement=engagement,
        hand=hand, tool_dia=tool_dia, tool_rows=tool_rows,
        r_full=r_full, num_passes=num_passes, spring_pass=spring_pass,
        doc_per_pass=doc_per_pass, feed_ipm=feed_ipm, rpm=int(rpm),
        h_thread=h_thread, is_tapered=is_tapered, mat=mat,
        neck_length=neck_length, stickout=stickout,
        pitch_mm=pitch_in * 25.4, dialect=dialect, bottom_up=bottom_up,
    )

    thread_mill_data = {
        "rpm":             round(rpm),
        "sfm":             round(sfm_actual, 1),
        "feed_ipm":        round(feed_ipm, 2),
        "fpt":             round(fpt, 6),
        "pitch_in":        round(pitch_in, 6),
        "tpi":             round(tpi_val, 2),
        "thread_depth_in": round(h_thread, 5),
        "minor_dia_in":    round(minor_dia, 5),
        "pitch_dia_in":    round(pitch_dia, 5),
        "radial_passes":     num_passes,
        "spring_pass":       spring_pass,
        "doc_per_pass_in":   round(doc_per_pass, 5),
        "pass_docs":         pass_docs,
        "finish_pass_frac":  round(finish_frac, 2),
        "deflection_in":   round(defl, 6),
        "deflection_pct":  round(defl_pct, 1),
        "gcode":           gcode,
        "notes":           notes,
        "tool_rows":       tool_rows,
        "is_tapered":      is_tapered,
        "hand":            hand,
        "internal":        internal,
        "cut_direction":   cut_direction,
    }

    return {
        "customer": {
            "material":         mat,
            "diameter":         tool_dia,
            "flutes":           tool_rows,
            "rpm":              round(rpm),
            "sfm":              round(sfm_actual, 1),
            "sfm_target":       round(target_sfm, 1),
            "feed_ipm":         round(feed_ipm, 2),
            "doc_in":           round(h_thread, 5),
            "woc_in":           round(doc_per_pass, 5),
            "mrr_in3_min":      0.0,
            "spindle_load_pct": 0.0,
            "hp_required":      0.0,
            "fpt":              round(fpt, 6),
            "adj_fpt":          None,
            "status":           "ok",
            "status_hint":      None,
            "notes":            notes,
        },
        "engineering": {
            "force_lbf":       round(force_lbf, 2),
            "deflection_in":   round(defl, 6),
            "chip_thickness_in": round(fpt, 6),
            "chatter_index":   0.0,
            "tool_life_min":   None,
        },
        "thread_mill": thread_mill_data,
        "stability":   None,
        "debug":       None,
    }


def _generate_threadmill_gcode(
    thread_std, major_dia, pitch_in, tpi, thread_class, internal, engagement,
    hand, tool_dia, tool_rows, r_full, num_passes, spring_pass, doc_per_pass,
    feed_ipm, rpm, h_thread, is_tapered, mat, neck_length, stickout, pitch_mm,
    dialect="fanuc", bottom_up=False,
) -> str:
    import math

    # Arc direction — internal RH: G3 (CCW); internal LH: G2 (CW)
    # External RH: G2 (CW); external LH: G3 (CCW)
    if internal:
        arc_cmd  = "G3" if hand == "right" else "G2"
        lead_arc = "G3" if hand == "right" else "G2"
    else:
        arc_cmd  = "G2" if hand == "right" else "G3"
        lead_arc = "G2" if hand == "right" else "G3"

    # Bottom-up: flip arc direction — same hand of thread, opposite Z travel direction
    if bottom_up:
        arc_cmd  = "G2" if arc_cmd  == "G3" else "G3"
        lead_arc = "G2" if lead_arc == "G3" else "G3"

    dir_label = "BOTTOM-UP" if bottom_up else "TOP-DOWN"

    # Thread label
    if thread_std in ("unc", "unf", "unef"):
        std_upper = thread_std.upper()
        frac_map = {
            0.25: "1/4",   0.3125: "5/16", 0.375: "3/8",  0.4375: "7/16",
            0.5:  "1/2",   0.5625: "9/16", 0.625: "5/8",  0.75:   "3/4",
            0.875:"7/8",   1.0:    "1\"",  1.25:  "1-1/4",1.5:    "1-1/2",
            0.073:"#1",    0.086:  "#2",   0.099: "#3",   0.112:  "#4",
            0.125:"#5",    0.138:  "#6",   0.164: "#8",   0.190:  "#10",
        }
        dia_str = frac_map.get(round(major_dia, 4), f"{major_dia:.4f}\"")
        tpi_str = str(int(tpi)) if tpi == int(tpi) else str(tpi)
        thread_label = f"{dia_str}-{tpi_str} {std_upper} {thread_class}"
    elif thread_std == "metric":
        dia_mm = major_dia * 25.4
        thread_label = f"M{dia_mm:.0f}x{pitch_mm:.2f} {thread_class}"
    else:
        tpi_str = str(int(tpi)) if tpi == int(tpi) else str(tpi)
        thread_label = f"{thread_std.upper()} {major_dia:.4f}\" {tpi_str} TPI"

    int_ext  = "INTERNAL" if internal else "EXTERNAL"
    hand_str = "RIGHT-HAND" if hand == "right" else "LEFT-HAND"
    rows_str = "SINGLE-POINT" if tool_rows == 1 else f"{tool_rows}-PROFILE MULTI-THREAD"

    plunge_feed = round(feed_ipm * 0.3, 1)
    side_feed   = round(feed_ipm * 0.5, 1)

    if dialect == "siemens":
        # ── Siemens Sinumerik 840D / 828D ─────────────────────────────────
        c = ";"   # comment char
        lines = [
            f"; {thread_label} {int_ext} {hand_str}",
            f"; TOOL: D={tool_dia:.4f}\"  {rows_str}",
            f"; PITCH: {pitch_in:.5f}\"  THREAD DEPTH: {h_thread:.5f}\"",
            f"; RPM: {rpm}  FEED: {feed_ipm:.1f} IPM",
            f"; RADIAL PASSES: {num_passes}{' + SPRING' if spring_pass else ''}",
            f"; ENGAGEMENT: {engagement:.3f}\"  STICKOUT: {stickout:.3f}\"",
            f"; MATERIAL: {mat.upper().replace('_', ' ')}",
            f"; CUT DIRECTION: {dir_label}",
            ";",
            "; *** SET WORK COORDINATES BEFORE RUNNING ***",
            "; *** VERIFY DRY RUN BEFORE CUTTING ***",
            ";",
            "G17 G90 G94",
            "T1 D1",
            "M6",
            f"S{rpm} M3",
            "M8",
            ";",
            "; POSITION TO THREAD CENTER",
            "G0 X0. Y0.",
        ]
        if is_tapered:
            lines += _gcode_taper_thread_siemens(
                arc_cmd=arc_cmd, lead_arc=lead_arc, engagement=engagement,
                pitch_in=pitch_in, tpi=tpi, r_full=r_full, h_thread=h_thread,
                num_passes=num_passes, spring_pass=spring_pass,
                doc_per_pass=doc_per_pass, feed_ipm=feed_ipm,
                plunge_feed=plunge_feed, side_feed=side_feed,
                hand=hand, internal=internal, bottom_up=bottom_up,
            )
        else:
            lines += _gcode_straight_thread_siemens(
                arc_cmd=arc_cmd, lead_arc=lead_arc, engagement=engagement,
                pitch_in=pitch_in, r_full=r_full, h_thread=h_thread,
                num_passes=num_passes, spring_pass=spring_pass,
                doc_per_pass=doc_per_pass, feed_ipm=feed_ipm,
                plunge_feed=plunge_feed, side_feed=side_feed,
                tool_rows=tool_rows, bottom_up=bottom_up,
            )
        lines += [";", "G0 Z1.0", "M9", "M5", "M30"]

    else:
        # ── Fanuc / Haas ───────────────────────────────────────────────────
        lines = [
            f"({thread_label} {int_ext} {hand_str})",
            f"(TOOL: D={tool_dia:.4f}\"  {rows_str})",
            f"(PITCH: {pitch_in:.5f}\"  THREAD DEPTH: {h_thread:.5f}\")",
            f"(RPM: {rpm}  FEED: {feed_ipm:.1f} IPM)",
            f"(RADIAL PASSES: {num_passes}{' + SPRING' if spring_pass else ''})",
            f"(ENGAGEMENT: {engagement:.3f}\"  STICKOUT: {stickout:.3f}\")",
            f"(MATERIAL: {mat.upper().replace('_', ' ')})",
            f"(CUT DIRECTION: {dir_label})",
            "()",
            "(*** SET TOOL LENGTH OFFSET AND WORK COORDINATES BEFORE RUNNING ***)",
            "(*** VERIFY DRY RUN BEFORE CUTTING ***)",
            "()",
            "G17 G90 G94",
            "T01 M06",
            "G43 Z1.0 H01",
            f"S{rpm} M03",
            "M08",
            "()",
            "(POSITION TO THREAD CENTER)",
            "G00 X0. Y0.",
        ]
        if is_tapered:
            lines += _gcode_taper_thread(
                arc_cmd=arc_cmd, lead_arc=lead_arc, engagement=engagement,
                pitch_in=pitch_in, tpi=tpi, r_full=r_full, h_thread=h_thread,
                num_passes=num_passes, spring_pass=spring_pass,
                doc_per_pass=doc_per_pass, feed_ipm=feed_ipm,
                plunge_feed=plunge_feed, side_feed=side_feed,
                hand=hand, internal=internal, bottom_up=bottom_up,
            )
        else:
            lines += _gcode_straight_thread(
                arc_cmd=arc_cmd, lead_arc=lead_arc, engagement=engagement,
                pitch_in=pitch_in, r_full=r_full, h_thread=h_thread,
                num_passes=num_passes, spring_pass=spring_pass,
                doc_per_pass=doc_per_pass, feed_ipm=feed_ipm,
                plunge_feed=plunge_feed, side_feed=side_feed,
                tool_rows=tool_rows, bottom_up=bottom_up,
            )
        lines += ["()", "G00 Z1.0", "M09", "M05", "M30", "%"]

    return "\n".join(lines)


def _gcode_straight_thread(arc_cmd, lead_arc, engagement, pitch_in, r_full,
                            h_thread, num_passes, spring_pass, doc_per_pass,
                            feed_ipm, plunge_feed, side_feed, tool_rows,
                            bottom_up=False):
    lines = []
    total_passes = num_passes + (1 if spring_pass else 0)

    for p in range(total_passes):
        if p < num_passes:
            r = round(r_full - h_thread + doc_per_pass * (p + 1), 5)
            pass_label = (
                f"PASS {p+1} {'ROUGH' if p < num_passes - 1 else 'FINISH'}"
            )
        else:
            r = round(r_full, 5)
            pass_label = "SPRING PASS (repeat finish)"

        lines.append(f"({pass_label} - R={r:.4f}\")")
        if bottom_up:
            lines.append(f"G00 Z{round(-engagement - 0.1, 4)}")
            lines.append(f"G01 Z{round(-engagement, 4)} F{plunge_feed}")
            lines.append(f"G01 X0. Y{-r:.4f} F{side_feed}")
            lines.append(f"{lead_arc} X{r:.4f} Y0. I0. J{r:.4f} F{round(feed_ipm * 0.6, 1)}")
            z_move = round(engagement, 4)
            lines.append(f"{arc_cmd} X{r:.4f} Y0. I{-r:.4f} J0. Z{z_move} F{feed_ipm:.1f}")
            lines.append(f"{lead_arc} X0. Y{r:.4f} I{-r:.4f} J0. F{round(feed_ipm * 0.6, 1)}")
            lines.append(f"G01 X0. Y0. F{side_feed}")
            lines.append("G00 Z0.1")
        else:
            lines.append("G00 Z0.1")
            lines.append(f"G01 Z0. F{plunge_feed}")
            lines.append(f"G01 X0. Y{-r:.4f} F{side_feed}")
            lines.append(f"{lead_arc} X{r:.4f} Y0. I0. J{r:.4f} F{round(feed_ipm * 0.6, 1)}")
            z_move = round(-engagement, 4)
            lines.append(f"{arc_cmd} X{r:.4f} Y0. I{-r:.4f} J0. Z{z_move} F{feed_ipm:.1f}")
            lines.append(f"{lead_arc} X0. Y{r:.4f} I{-r:.4f} J0. F{round(feed_ipm * 0.6, 1)}")
            lines.append(f"G01 X0. Y0. F{side_feed}")
        lines.append("()")

    return lines


def _gcode_taper_thread(arc_cmd, lead_arc, engagement, pitch_in, tpi,
                        r_full, h_thread, num_passes, spring_pass, doc_per_pass,
                        feed_ipm, plunge_feed, side_feed, hand, internal,
                        bottom_up=False):
    """NPT/NPTF taper helix — radius changes 0.03125\"/inch of Z (half-diameter taper)."""
    import math
    lines = ["(NPT/NPTF TAPER: radius changes 0.03125\"/inch axially)"]
    if bottom_up:
        lines.append("(TAPER: bottom-up not supported — using top-down)")
    taper_per_in  = NPT_TAPER_PER_IN / 2.0   # radius change per axial inch
    total_passes  = num_passes + (1 if spring_pass else 0)

    for p in range(total_passes):
        if p < num_passes:
            depth_offset = h_thread - doc_per_pass * (p + 1)
            pass_label   = f"PASS {p+1}"
        else:
            depth_offset = 0.0
            pass_label   = "SPRING PASS"

        lines.append(f"({pass_label})")
        lines.append("G00 Z0.1")
        lines.append(f"G01 Z0. F{plunge_feed}")

        num_revs = int(math.ceil(engagement / pitch_in))
        lines.append("G91  (INCREMENTAL)")
        for rev in range(num_revs):
            z_start = rev * pitch_in
            r_at_z  = round(r_full - depth_offset - taper_per_in * z_start, 5)
            r_avg   = round(r_at_z - taper_per_in * pitch_in / 2.0, 5)
            lines.append(
                f"{arc_cmd} X0. Y0. I{-r_avg:.4f} J0. Z{-pitch_in:.5f} F{feed_ipm:.1f}"
            )
        lines.append("G90  (ABSOLUTE)")
        lines.append(f"G01 X0. Y0. F{side_feed}")
        lines.append("()")

    return lines


def _gcode_straight_thread_siemens(arc_cmd, lead_arc, engagement, pitch_in, r_full,
                                    h_thread, num_passes, spring_pass, doc_per_pass,
                                    feed_ipm, plunge_feed, side_feed, tool_rows,
                                    bottom_up=False):
    """Siemens 840D straight thread — TURN=1 helical arc, ; comments."""
    lines = []
    total_passes = num_passes + (1 if spring_pass else 0)
    for p in range(total_passes):
        if p < num_passes:
            r = round(r_full - h_thread + doc_per_pass * (p + 1), 5)
            lbl = f"PASS {p+1} {'ROUGH' if p < num_passes - 1 else 'FINISH'} - R={r:.4f}\""
        else:
            r = round(r_full, 5)
            lbl = "SPRING PASS (repeat finish)"
        lines.append(f"; {lbl}")
        if bottom_up:
            lines.append(f"G0 Z{round(-engagement - 0.1, 4)}")
            lines.append(f"G1 Z{round(-engagement, 4)} F{plunge_feed}")
            lines.append(f"G1 X0. Y{-r:.4f} F{side_feed}")
            lines.append(f"{lead_arc} X{r:.4f} Y0. I0. J{r:.4f} F{round(feed_ipm * 0.6, 1)}")
            z_move = round(engagement, 4)
            # Siemens: TURN=1 makes exactly one full revolution while moving Z
            lines.append(f"{arc_cmd} X{r:.4f} Y0. I{-r:.4f} J0. Z{z_move} TURN=1 F{feed_ipm:.1f}")
            lines.append(f"{lead_arc} X0. Y{r:.4f} I{-r:.4f} J0. F{round(feed_ipm * 0.6, 1)}")
            lines.append(f"G1 X0. Y0. F{side_feed}")
            lines.append("G0 Z0.1")
        else:
            lines.append("G0 Z0.1")
            lines.append(f"G1 Z0. F{plunge_feed}")
            lines.append(f"G1 X0. Y{-r:.4f} F{side_feed}")
            lines.append(f"{lead_arc} X{r:.4f} Y0. I0. J{r:.4f} F{round(feed_ipm * 0.6, 1)}")
            z_move = round(-engagement, 4)
            # Siemens: TURN=1 makes exactly one full revolution while moving Z
            lines.append(f"{arc_cmd} X{r:.4f} Y0. I{-r:.4f} J0. Z{z_move} TURN=1 F{feed_ipm:.1f}")
            lines.append(f"{lead_arc} X0. Y{r:.4f} I{-r:.4f} J0. F{round(feed_ipm * 0.6, 1)}")
            lines.append(f"G1 X0. Y0. F{side_feed}")
        lines.append(";")
    return lines


def _gcode_taper_thread_siemens(arc_cmd, lead_arc, engagement, pitch_in, tpi,
                                 r_full, h_thread, num_passes, spring_pass, doc_per_pass,
                                 feed_ipm, plunge_feed, side_feed, hand, internal,
                                 bottom_up=False):
    """NPT/NPTF taper for Siemens — TURN=1 per revolution, ; comments."""
    import math
    lines = ["; NPT/NPTF TAPER: radius changes 0.03125\"/inch axially"]
    if bottom_up:
        lines.append("; TAPER: bottom-up not supported — using top-down")
    taper_per_in = NPT_TAPER_PER_IN / 2.0
    total_passes = num_passes + (1 if spring_pass else 0)
    for p in range(total_passes):
        if p < num_passes:
            depth_offset = h_thread - doc_per_pass * (p + 1)
            lbl = f"PASS {p+1}"
        else:
            depth_offset = 0.0
            lbl = "SPRING PASS"
        lines.append(f"; {lbl}")
        lines.append("G0 Z0.1")
        lines.append(f"G1 Z0. F{plunge_feed}")
        num_revs = int(math.ceil(engagement / pitch_in))
        lines.append("G91  ; INCREMENTAL")
        for rev in range(num_revs):
            z_start = rev * pitch_in
            r_avg = round(r_full - depth_offset - taper_per_in * (z_start + pitch_in / 2.0), 5)
            lines.append(
                f"{arc_cmd} X0. Y0. I{-r_avg:.4f} J0. Z{-pitch_in:.5f} TURN=1 F{feed_ipm:.1f}"
            )
        lines.append("G90  ; ABSOLUTE")
        lines.append(f"G1 X0. Y0. F{side_feed}")
        lines.append(";")
    return lines


# ================================
# RUN
# ================================
if __name__ == "__main__":
    run(data)