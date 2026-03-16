import math

# --- Mode-based default WOC/DOC ---------------------------------------------

def get_mode_defaults(mode: str, material: str):
    def material_family(m: str):
        if m.startswith("al_"): return "al"
        if m.startswith("steel_"): return "steel"
        if m.startswith("ss_") or m == "stainless_generic": return "ss"
        if m.startswith("cast_"): return "ci"
        if m.startswith("ti_"): return "ti"
        if m in ("inconel_718", "hastelloy_c276"): return "hrsa"
        if m.startswith("tool_"): return "tool"
        return "generic"

    fam = material_family(material)

    if mode == "hem":
        woc = 10.0
        doc = 1.5
    elif mode == "finish":
        woc = 3.0
        doc = 0.25
    elif mode == "slot":
        woc = 100.0
        doc = 0.5
    elif mode == "profile":
        woc = 6.0
        doc = 1.0
    elif mode == "face":
        woc = 60.0
        doc = 0.10
    else:
        woc = 8.0
        doc = 0.5

    if fam == "al" and mode == "hem":
        woc, doc = 14.0, 2.0
    elif fam == "steel" and mode == "hem":
        woc, doc = 10.0, 1.5
    elif fam == "ss" and mode == "hem":
        woc, doc = 8.0, 1.25
    elif fam == "ti" and mode == "hem":
        woc, doc = 6.0, 1.0
    elif fam == "hrsa" and mode == "hem":
        woc, doc = 5.0, 0.75

    return woc, doc

HELIX_FORCE_FACTOR = {35: 1.00, 38: 0.95, 45: 0.90}
CORE_FACTOR_BY_FLUTES = {
    2: 0.75,
    3: 0.85,
    4: 1.00,
    5: 1.10,
    6: 1.20,
    7: 1.30
}

COOLANT_LIFE = {
    "flood": 1.25,
    "air": 1.10,
    "dry": 0.85
}

def chip_thinning_factor(woc_pct, diameter=1.0):
    """
    Boost factor for programmed IPT = 1/RCTF = 1/sin(arccos(1 - 2·ae/D)).
    Returns 1.0 at slotting (woc_pct >= 50). Same formula as hem_feed_boost.
    """
    ae_over_D = woc_pct / 100.0
    if ae_over_D >= 0.5 or ae_over_D <= 0.0:
        return 1.0
    inner = max(-1.0, min(1.0, 1.0 - 2.0 * ae_over_D))
    r = math.sin(math.acos(inner))
    return 1.0 / max(0.05, r)


def rctf(woc_pct: float, diameter: float = 1.0) -> float:
    """
    Radial Chip Thinning Factor — ratio of actual chip thickness to programmed IPT.

        RCTF = sin(arccos(1 - 2 * ae/D))

    At 50% WOC (slotting) → 1.0 (no thinning).
    At 10% WOC → 0.60.  At 5% WOC → 0.45.
    Clamped to [0.05, 1.0] for numerical safety.
    """
    ae_over_D = woc_pct / 100.0
    if ae_over_D >= 0.5:
        return 1.0
    if ae_over_D <= 0.0:
        return 0.05
    inner = max(-1.0, min(1.0, 1.0 - 2.0 * ae_over_D))
    return max(0.05, math.sin(math.acos(inner)))


def hem_feed_boost(woc_pct: float, diameter: float = 1.0) -> float:
    """
    IPT multiplier that compensates for radial chip thinning in HEM/adaptive passes.

    Usage:
        programmed_ipt = target_chip_load * hem_feed_boost(woc_pct)
        feed_ipm       = rpm * flutes * programmed_ipt

    At 10% WOC → 1.67×.  At 5% WOC → 2.24×.  Returns 1.0 at slotting.
    """
    r = rctf(woc_pct, diameter)
    return 1.0 / r if r > 1e-9 else 1.0


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x

def ball_effective_geometry(diameter, doc):
    """
    Ball nose at axial DOC:
    D_eff = effective cutting diameter at that height on the ball
    chip_factor ~ sin(contact_angle), scales IPT down near the tip
    """
    D = float(diameter)
    R = 0.5 * D
    a = max(0.0, min(float(doc), D))  # keep sane

    if a <= 1e-12:
        return 0.0, 0.0

    # r^2 = 2 R a - a^2   => D_eff = 2 r
    inside = max(0.0, 2.0 * R * a - a * a)
    D_eff = 2.0 * math.sqrt(inside)

    # cos(phi) = 1 - a/R, chip_factor = sin(phi)
    cosphi = _clamp(1.0 - (a / R), -1.0, 1.0)
    phi = math.acos(cosphi)
    chip_factor = math.sin(phi)

    return D_eff, chip_factor

def chip_thickness(ipt, chip_thin_factor):
    return ipt / chip_thin_factor

def effective_chip_thickness(data, material_group, ipt, woc_pct, diameter, doc):
    """
    Returns effective chip thickness after:
      - radial chip thinning (HEM)
      - ball nose sine reduction near center (if tool_type/mode indicates ballnose)
    """
    # Existing radial thinning
    thin = chip_thinning_factor(woc_pct, diameter)
    h = chip_thickness(ipt, thin)  # your existing function: ipt / thin

    tool_type = (data.get("tool_type") or "").lower()
    mode = (data.get("mode") or "").lower()
    is_ball = (tool_type in ("ball", "ballnose", "ball_nose")) or (mode == "ballnose")

    if is_ball:
        _, chip_factor = ball_effective_geometry(diameter, doc)
        h = h * chip_factor

    # Never go below minimum chip thickness floor (optional but recommended)
    hmin = minimum_chip_thickness(material_group)
    return max(h, hmin * 1.05)

def minimum_chip_thickness(material_group):
    if material_group == "Inconel":
        return 0.0003
    elif material_group == "Titanium":
        return 0.00025
    elif material_group == "Stainless":
        return 0.0002
    elif material_group == "Steel":
        return 0.0002
    else:
        return 0.00015


def engagement_angle(woc, diameter):
    return 2 * math.acos(1 - (2 * woc / diameter))

def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x

def ball_effective_geometry(diameter, doc):
    """
    Returns (chip_factor_ball) ~ sin(contact angle) for ball nose at axial DOC.
    Also returns D_eff if you want later.
    """
    D = float(diameter)
    R = 0.5 * D
    a = max(0.0, min(float(doc), D))

    if a <= 1e-12:
        return 0.0, 0.0

    inside = max(0.0, 2.0 * R * a - a * a)
    D_eff = 2.0 * math.sqrt(inside)

    cosphi = _clamp(1.0 - (a / R), -1.0, 1.0)
    phi = math.acos(cosphi)
    chip_factor_ball = math.sin(phi)

    return D_eff, chip_factor_ball

def effective_chip_thickness(data, material_group, ipt, woc, diameter, doc):
    """
    Effective chip thickness after:
      - radial thinning (via your existing chip_factor)
      - ball nose sine reduction (if mode/tool_type indicates ballnose)
    Returns a thickness (inches).
    """
    D = float(diameter) if diameter else 0.0
    woc = float(woc) if woc else 0.0

    # Your existing radial thinning uses "chip_factor" (sqrt(D/woc) style)
    woc_pct = (woc / D) * 100.0 if D > 0 else 100.0
    thin = chip_thinning_factor(woc_pct, D) if D > 0 else 1.0
    h = chip_thickness(float(ipt), thin)  # ipt / thin

    tool_type = (data.get("tool_type") or "").lower()
    mode = (data.get("mode") or "").lower()
    is_ball = (tool_type in ("ball", "ballnose", "ball_nose")) or (mode == "ballnose")

    if is_ball and D > 0:
        _, ball_factor = ball_effective_geometry(D, doc)
        h *= ball_factor

    # Optional safety floor (keeps NaNs away + respects chip minimum)
    hmin = minimum_chip_thickness(material_group)
    return max(h, hmin * 1.05)

def _hardness_kc_mult(hrc: float) -> float:
    """Kc multiplier from HRC — mirrors legacy_engine.hardness_kc_mult."""
    hrc = float(hrc)
    if hrc <= 0:  return 1.00
    if hrc <= 20: return 1.00
    if hrc <= 30: return 1.00 + 0.005 * (hrc - 20)
    if hrc <= 40: return 1.05 + 0.015 * (hrc - 30)
    if hrc <= 50: return 1.20 + 0.025 * (hrc - 40)
    if hrc <= 55: return 1.45 + 0.030 * (hrc - 50)
    return min(2.00, 1.60 + 0.040 * (hrc - 55))


def cutting_force_per_tooth(material_group, h_eff, helix, hardness_hrc=0):
    K = {
        # Legacy group keys
        "Steel": 180000,
        "Stainless": 200000,
        "Cast Iron": 160000,
        "Inconel": 240000,
        "Titanium": 220000,
        "Aluminum": 60000,
        "Non-Ferrous": 70000,
        "Plastics": 30000,
        # ISO subcategory keys
        "aluminum_wrought": 55000,
        "aluminum_cast": 65000,
        "non_ferrous": 70000,
        "steel_free": 150000,
        "steel_alloy": 180000,
        "steel_tool": 210000,
        "stainless_martensitic": 195000,
        "stainless_fm":          185000,
        "stainless_austenitic":  215000,
        "stainless_ph":          225000,
        "cast_iron_gray":        140000,
        "cast_iron_ductile":     160000,
        "cast_iron_malleable":   150000,
        "titanium_cp":           190000,
        "titanium_64":           220000,
        "titanium":              220000,
        "hiTemp_fe":             235000,
        "hiTemp_co":             250000,
        "inconel_625":           240000,
        "inconel_718":           265000,
        "inconel":               250000,
        "hardened_lt55": 250000,
        "hardened_gt55": 300000,
    }.get(material_group, 180000)
    K *= _hardness_kc_mult(hardness_hrc)
    return K * h_eff * HELIX_FORCE_FACTOR.get(helix, 1.0)


def tool_deflection(force, stickout, diameter, flutes, loc=None, lbs=None, neck_dia=None,
                    holder_gage_len=None, holder_nose_dia=None):
    import math

    # Carbide modulus
    E_carbide = 90_000_000  # psi
    E_steel   = 30_000_000  # psi (holder body)

    # Estimate core diameter ratio based on flute count.
    # More flutes → less flute valley depth → larger core → I scales as D_core^4.
    # Stiffness vs 4-fl ref: 5fl=1.31×, 6fl=1.71×, 7fl=1.89×, 9fl=2.31×, 11fl=2.55×
    core_ratio = {
        2: 0.60,
        3: 0.65,
        4: 0.70,
        5: 0.75,
        6: 0.80,
        7: 0.82,
        8: 0.84,
        9: 0.86,
        10: 0.87,
        11: 0.88,
        12: 0.89,
    }.get(flutes, 0.82 if flutes and flutes > 7 else 0.70)

    core_diameter = diameter * core_ratio
    I_flute = (math.pi * core_diameter**4) / 64.0

    L_t = stickout if stickout else (diameter * 2.5)

    # Composite beam model for necked / reduced-reach tools:
    # δ = F/(3E) * [LOC³/I_flute + (LBS³ - LOC³)/I_neck]
    # This uses Mohr's integral over two beam segments (flute + neck).
    if lbs and loc and float(lbs) > float(loc) and float(lbs) <= L_t:
        nd = neck_dia if neck_dia else (diameter * 0.75)
        I_neck = (math.pi * float(nd)**4) / 64.0
        lbs_f, loc_f = float(lbs), float(loc)
        delta_tool = (force / (3 * E_carbide)) * (loc_f**3 / I_flute + (lbs_f**3 - loc_f**3) / I_neck)
    else:
        delta_tool = (force * L_t**3) / (3 * E_carbide * I_flute)

    # Holder extension model — adds deflection contribution from a slender nose/extension
    # Uses Mohr's integral for two-segment cantilever:
    # δ = F/3 * [(L_total³ - L_t³)/(E_steel × I_holder) + L_t³/(E_carbide × I_tool)]
    # where L_total = holder_gage_len + stickout
    if holder_gage_len and float(holder_gage_len) > 0:
        L_h = float(holder_gage_len)
        # Default nose dia: if not specified, estimate as 2× tool diameter (standard body)
        h_nose = float(holder_nose_dia) if holder_nose_dia and float(holder_nose_dia) > 0 else (diameter * 2.0)
        I_holder = (math.pi * h_nose**4) / 64.0
        L_total = L_h + L_t
        # Full composite beam: holder segment + tool segment
        delta = (force / 3.0) * (
            (L_total**3 - L_t**3) / (E_steel * I_holder) +
            L_t**3 / (E_carbide * I_flute)
        )
    else:
        delta = delta_tool

    return delta

_FLUID_FACTOR = {
    "straight_oil":   1.10,
    "semi_synthetic": 1.00,
    "water_soluble":  1.00,
    "synthetic":      0.97,
}

def _conc_mult(pct):
    """Tool-life multiplier from refractometer concentration %."""
    if pct < 5:    return 0.90
    if pct < 7:    return 0.95
    if pct <= 12:  return 1.00
    if pct <= 16:  return 1.02
    return 0.97

def tool_life(material_group, coating, load, coolant,
              coolant_fluid="semi_synthetic", coolant_concentration=10):
    base = 45 if material_group in ["Steel", "Stainless"] else 120
    coat_factor = 1.2
    coolant_factor = COOLANT_LIFE.get(coolant, 1.0)
    fluid = str(coolant_fluid or "semi_synthetic").lower()
    fluid_factor = _FLUID_FACTOR.get(fluid, 1.0)
    if fluid != "straight_oil":
        fluid_factor *= _conc_mult(float(coolant_concentration or 10))
    load_factor = max(0.4, 1.2 - load)
    return base * coat_factor * coolant_factor * fluid_factor * load_factor

import math

DEFLECTION_LIMITS = {
    "hem": 0.001,
    "finishing": 0.001,
    "threadmill": 0.001,
    "ballnose": 0.0005,
    "roughing": 0.002,
    "dynamic": 0.002,
}

def enforce_deflection_limit(state, data, mode, original_woc, original_deflection):
    deflection_limit = data.get("deflection_limit", 0.001)
    tool_diameter = data.get("diameter", 0)

    radial_engagement_pct = original_woc / tool_diameter if tool_diameter > 0 else 0

    print(f"DEBUG WOC = {original_woc:.4f}, Tool Ø = {tool_diameter:.4f}")

    # Only allow radial splitting for light engagement (HEM)
    if radial_engagement_pct > 0.15:
        return original_woc, 1, False

    # Slotting guard – do not split radial passes
    if tool_diameter > 0 and original_woc >= tool_diameter:
        return original_woc, 1, False

    # No reduction needed
    if original_deflection <= deflection_limit:
        return original_woc, 1, False

    reduction_ratio = deflection_limit / original_deflection
    adjusted_woc = original_woc * reduction_ratio

    # --- MINIMUM PRACTICAL WOC GUARD (HRSA sanity floor) ---
    min_woc = data.get("diameter", 0) * 0.002  # 0.2% Ø floor

    if adjusted_woc < min_woc:
        # Too small to be practical → do NOT split into micro passes
        return original_woc, 1, True

    radial_passes = math.ceil(original_woc / adjusted_woc)

    MAX_RADIAL_PASSES = 20
    radial_passes = min(radial_passes, MAX_RADIAL_PASSES)
    capped = radial_passes == MAX_RADIAL_PASSES

    adjusted_woc = original_woc / radial_passes


# ─── THREAD MILL TABLES ─────────────────────────────────────────────────────

# UN: nominal_dia_in → tpi  (UNC / UNF / UNEF)
UN_TPI = {
    "unc": {
        0.0600: 80,  0.0730: 64,  0.0860: 56,  0.0990: 48,  0.1120: 40,
        0.1250: 40,  0.1380: 32,  0.1640: 32,  0.1900: 24,  0.2160: 24,
        0.2500: 20,  0.3125: 18,  0.3750: 16,  0.4375: 14,  0.5000: 13,
        0.5625: 12,  0.6250: 11,  0.7500: 10,  0.8750:  9,  1.0000:  8,
        1.1250:  7,  1.2500:  7,  1.3750:  6,  1.5000:  6,  1.7500:  5,
        2.0000:  4.5,
    },
    "unf": {
        0.0600: 80,  0.0730: 72,  0.0860: 64,  0.0990: 56,  0.1120: 48,
        0.1250: 44,  0.1380: 40,  0.1640: 36,  0.1900: 32,  0.2160: 28,
        0.2500: 28,  0.3125: 24,  0.3750: 24,  0.4375: 20,  0.5000: 20,
        0.5625: 18,  0.6250: 18,  0.7500: 16,  0.8750: 14,  1.0000: 12,
        1.1250: 12,  1.2500: 12,
    },
    "unef": {
        0.2500: 32,  0.3125: 32,  0.3750: 32,  0.4375: 28,  0.5000: 28,
        0.5625: 24,  0.6250: 24,  0.7500: 20,  0.8750: 20,  1.0000: 20,
        1.0625: 18,  1.1250: 18,  1.1875: 18,  1.2500: 18,
    },
}

# Metric coarse series: nominal_dia_mm → standard pitch_mm
METRIC_PITCH = {
     1.0: 0.25,  1.2: 0.25,  1.4: 0.30,  1.6: 0.35,  2.0: 0.40,  2.5: 0.45,
     3.0: 0.50,  3.5: 0.60,  4.0: 0.70,  5.0: 0.80,  6.0: 1.00,  8.0: 1.25,
    10.0: 1.50, 12.0: 1.75, 14.0: 2.00, 16.0: 2.00, 18.0: 2.50, 20.0: 2.50,
    22.0: 2.50, 24.0: 3.00, 27.0: 3.00, 30.0: 3.50, 33.0: 3.50, 36.0: 4.00,
    39.0: 4.00, 42.0: 4.50, 48.0: 5.00, 56.0: 5.50, 64.0: 6.00,
}

# NPT / NPTF: pipe_size_label → (major_dia_in, tpi)
# Taper: 0.0625 in/in (3/4" per foot) on diameter
NPT_DATA = {
    "1/16": (0.3125, 27),   "1/8":   (0.405,  27),
    "1/4":  (0.540,  18),   "3/8":   (0.675,  18),
    "1/2":  (0.840,  14),   "3/4":   (1.050,  14),
    "1":    (1.315,  11.5), "1-1/4": (1.660,  11.5),
    "1-1/2":(1.900,  11.5), "2":     (2.375,  11.5),
    "2-1/2":(2.875,   8),   "3":     (3.500,   8),
    "4":    (4.500,   8),
}
NPT_TAPER_PER_IN = 0.0625  # change in DIAMETER per inch of axial travel


def thread_depth_in(pitch_in: float) -> float:
    """Functional thread height for 60° form (UN / Metric / NPT). h = 0.6134 × pitch."""
    return 0.6134 * pitch_in


def thread_minor_dia(major_dia: float, pitch_in: float) -> float:
    """Minor diameter for 60° internal thread."""
    return major_dia - 2.0 * thread_depth_in(pitch_in)


def thread_pitch_dia(major_dia: float, pitch_in: float) -> float:
    """Pitch (effective) diameter for 60° thread."""
    return major_dia - 0.6495 * pitch_in


def threadmill_sfm_factor(mat_group: str) -> float:
    """Thread milling runs at ~65–75% of equivalent endmill SFM due to form engagement."""
    return {
        "Aluminum":    0.75,
        "Non-Ferrous": 0.72,
        "Cast Iron":   0.70,
        "Steel":       0.68,
        "Stainless":   0.65,
        "Titanium":    0.62,
        "Inconel":     0.60,
        "Plastics":    0.80,
    }.get(mat_group, 0.68)


def threadmill_passes(pitch_in: float, mat_group: str, thread_class: str,
                      tool_dia: float, neck: bool) -> int:
    """Recommended number of radial passes. Coarse pitch + tough materials = more passes."""
    base = 1
    if pitch_in >= 0.0625:  base = 2   # TPI ≤ 16 — coarse
    if pitch_in >= 0.100:   base = 3   # TPI ≤ 10 — very coarse
    # Inconel / Titanium: minimum 3 passes — smaller DOC per pass reduces heat and edge load,
    # critical for tool life in these work-hardening superalloys
    if mat_group in ("Inconel", "Titanium") and base < 3:
        base = 3
    # Stainless: minimum 2 passes — work-hardens, needs light finishing cut
    if mat_group == "Stainless" and base < 2:
        base = 2
    if neck and base < 2:   base = 2   # necked tool = less rigid, extra pass
    return base


def threadmill_spring_pass(thread_class: str) -> bool:
    """Return True when thread class calls for a spring (repeat finish) pass."""
    return thread_class in ("3A", "3B", "6H", "6g")


# ============================================================
# DRILLING PHYSICS — Solid Carbide Drills
# ============================================================

# Minimum IPR by material group — below this the cutting edge rubs instead of shearing.
# Critical chip thickness ≈ 20–35% of edge radius; practical floor scales with drill diameter.
# Rule of thumb: min_ipr = max(material_floor, 0.002 × D)
_DRILL_MIN_IPR = {
    "Aluminum":    0.002,
    "Non-Ferrous": 0.002,
    "Plastics":    0.001,
    "Steel":       0.003,
    "Stainless":   0.004,   # work-hardens rapidly if rubbing — most critical
    "Cast Iron":   0.003,
    "Titanium":    0.004,
    "Inconel":     0.005,
}

def drill_min_ipr(D: float, material_group: str) -> float:
    """Minimum feed per rev to maintain cutting (not rubbing). Scales with drill diameter."""
    mat_floor = _DRILL_MIN_IPR.get(material_group, 0.003)
    dia_floor  = 0.002 * D   # 0.002×D rule — steel baseline
    return max(mat_floor, dia_floor)

# Thrust force constants by material group (Kronenberg model: F = Kf × D^0.8 × IPR^0.8)
_DRILL_THRUST_K = {
    "Aluminum":    50_000,
    "Non-Ferrous": 70_000,
    "Plastics":    30_000,
    "Steel":      160_000,
    "Stainless":  190_000,
    "Cast Iron":  130_000,
    "Titanium":   170_000,
    "Inconel":    210_000,
}

# Torque constants (T = Kt × D^1.8 × IPR^0.7)
_DRILL_TORQUE_K = {
    "Aluminum":    25_000,
    "Non-Ferrous": 35_000,
    "Plastics":    15_000,
    "Steel":       90_000,
    "Stainless":  110_000,
    "Cast Iron":   75_000,
    "Titanium":    95_000,
    "Inconel":    120_000,
}

def drill_depth_torque_factor(depth_to_dia: float, coolant_fed: bool = False, tsc: bool = False,
                              mat_group: str = "Steel") -> float:
    """Torque rises with depth due to chip column friction and margin contact — even at constant IPR/SFM.
    Stages: 0-1×D (clean), 1-3×D (chip column forming), 3-5×D (compression zone), >5×D (instability).
    Coolant-through drills flatten the curve dramatically by hydraulically lifting chips.
    Work-hardening materials steepen the curve: longer tougher chips = more wall friction at depth.
    """
    # Material slope multiplier — stainless/titanium/inconel chips are longer, tougher, generate more friction
    _slope_mult = {
        "Stainless": 1.20,   # work hardens, long stringy chips, poor thermal conductivity
        "Titanium":  1.25,   # welds to margin at depth, high friction, similar to stainless but worse
        "Inconel":   1.40,   # extreme work hardening, near-zero thermal conductivity, near-indestructible chips
    }.get(mat_group, 1.00)

    if coolant_fed or tsc:
        # Coolant-through: gentler rise, but material still matters
        return 1.0 + (0.02 * _slope_mult) * max(0.0, depth_to_dia - 1.0)

    # Standard/flood: three-stage torque rise, steepened by material
    if depth_to_dia <= 1.0:
        return 1.0
    elif depth_to_dia <= 3.0:
        return 1.0 + (0.05 * _slope_mult) * (depth_to_dia - 1.0)
    elif depth_to_dia <= 5.0:
        s2_end = 1.0 + (0.05 * _slope_mult) * 2.0
        return s2_end + (0.10 * _slope_mult) * (depth_to_dia - 3.0)
    else:
        s2_end = 1.0 + (0.05 * _slope_mult) * 2.0
        s3_end = s2_end + (0.10 * _slope_mult) * 2.0
        return s3_end + (0.15 * _slope_mult) * min(depth_to_dia - 5.0, 3.0)  # cap at 8×D

def drill_thrust(D: float, ipr: float, material_group: str, hardness_hrc: float = 0) -> float:
    """Axial thrust force in lbf for solid carbide drill."""
    Kf = _DRILL_THRUST_K.get(material_group, 160_000)
    Kf *= _hardness_kc_mult(hardness_hrc)
    return Kf * (D ** 0.8) * (ipr ** 0.8)

def drill_torque(D: float, ipr: float, material_group: str, hardness_hrc: float = 0) -> float:
    """Cutting torque in in-lbf for solid carbide drill (at cutting edge — no depth factor)."""
    Kt = _DRILL_TORQUE_K.get(material_group, 90_000)
    Kt *= _hardness_kc_mult(hardness_hrc)
    return Kt * (D ** 1.8) * (ipr ** 0.7)

def recommend_drill_cycle(
    D: float, depth: float, mat_group: str, hrc: float,
    point_angle: int, coolant: str, blind: bool,
    coolant_fed: bool = False, drill_geometry: str = "standard"
) -> tuple:
    """Returns (cycle, note, peck, r_plane, peck_schedule)."""
    depth_to_dia = depth / D if D > 0 else 0
    stringy = mat_group in ("Stainless", "Titanium", "Inconel")
    hard    = hrc >= 40
    tsc     = coolant in ("tsc_low", "tsc_high")

    # Chip-breaking score: 118°=0, 135°=1, 140°=2
    chip_score = {118: 0, 130: 1, 135: 1, 140: 2, 145: 2}.get(int(point_angle), 1)

    # Flute capacity bonus by drill geometry
    # standard: up to 5×D, med_helix: 5–7×D, high_helix: 7–9×D (neutral baseline)
    flute_bonus = {"standard": 0.0, "med_helix": 2.0, "high_helix": 4.0}.get(drill_geometry, 0.0)

    # G81 threshold — how deep before any pecking is needed
    # Neutral baseline (non-stringy, 135° point, no coolant) hits 5/7/9×D per geometry
    g81_limit = 4.0
    g81_limit += flute_bonus                    # full flute bonus on G81 window
    if tsc:              g81_limit += 1.0
    if coolant_fed:      g81_limit += 1.0   # through-drill coolant flushes chips at cutting edge
    if chip_score >= 1:  g81_limit += 0.5
    if chip_score >= 2:  g81_limit += 0.5
    if not stringy:      g81_limit += 0.5
    if stringy:          g81_limit -= 1.5   # stringy chips rope early → start pecking sooner
    if hard:             g81_limit += 0.5   # hard = shorter chips

    # G73 threshold — chip-break peck viable up to here
    # Coolant-through → G73 most of the time (coolant pushes chips out, full retract rarely needed)
    # Flood only → G83 more often (chips must evacuate up the flutes)
    # Stainless/Ti/Inconel with flood: G73 valid ≤4×D, G83 above
    g73_limit = 5.0
    g73_limit += flute_bonus                    # full flute bonus on G73 window
    if tsc:                       g73_limit += 1.5
    if coolant_fed:               g73_limit += 1.5   # through-coolant flushes chips at cutting edge
    if not (tsc or coolant_fed):  g73_limit -= 1.5   # no coolant assist → chips must self-evacuate → G83 sooner
    if chip_score >= 2:           g73_limit += 1.0
    elif chip_score == 1:         g73_limit += 0.5
    if hard:                      g73_limit += 1.0
    if stringy and (tsc or coolant_fed): g73_limit -= 2.0  # coolant-assisted stringy still needs G83 sooner than non-stringy

    # R plane: clearance above part for chip flush between pecks
    # Tight R = faster cycle; needs coolant to actually flush chips in that gap
    if tsc or coolant_fed:
        r_plane = 0.025   # through-coolant flushes chips quickly, tight R is fine
    else:
        r_plane = 0.050   # flood needs a little gap for coolant to wash chips off

    # G82: shallow blind hole needing dwell at bottom
    if blind and depth_to_dia <= g81_limit:
        return ("G82",
                "Dwell at bottom for blind hole — ensures flat, deburred finish at full depth.",
                None, r_plane, None)

    if depth_to_dia <= g81_limit:
        return ("G81",
                f"Standard drill cycle — depth/D {depth_to_dia:.1f}x is within chip evacuation range.",
                None, r_plane, None)

    if depth_to_dia <= g73_limit:
        peck = round(D * (0.5 if stringy else (0.8 if chip_score >= 1 else 0.6)), 4)
        note = (
            f"Chip-break peck at depth/D {depth_to_dia:.1f}x — snaps stringy chips before they rope. Q={peck:.4f}\" R={r_plane:.3f}\""
            if stringy else
            f"High-speed chip-break peck at depth/D {depth_to_dia:.1f}x. Q={peck:.4f}\" R={r_plane:.3f}\""
        )
        return ("G73", note, peck, r_plane, None)

    # G83 — full retract peck
    # Production tip: use larger Q (0.5–1×D) + tight R plane for faster cycle without sacrificing chip evacuation
    if stringy and hard:
        peck_mult = 0.75
    elif stringy:
        peck_mult = 0.50   # conservative start; increase toward 1×D once chips look healthy
    elif hard:
        peck_mult = 1.00
    else:
        peck_mult = 0.75
    if tsc or coolant_fed:
        peck_mult = min(peck_mult + 0.25, 1.0)
    peck = round(D * peck_mult, 4)

    # Pecking Optimizer — decreasing schedule: chip column grows denser with depth,
    # so pecks should get smaller as the hole gets deeper.
    # Start aggressive (1.5× base), step down ~15% each zone, floor at 0.3×D min.
    floor_mult = max(peck_mult * 0.5, 0.30)
    sched_mult = min(peck_mult * 1.5, 1.0)
    peck_schedule = []
    for _ in range(5):
        peck_schedule.append(round(D * sched_mult, 4))
        next_mult = sched_mult * 0.82
        if next_mult <= floor_mult:
            peck_schedule.append(round(D * floor_mult, 4))
            break
        sched_mult = next_mult

    note = (
        f"Full-retract peck at depth/D {depth_to_dia:.1f}x. Q={peck:.4f}\" R={r_plane:.3f}\" — "
        f"chip column builds with depth; use decreasing peck schedule below."
        if stringy else
        f"Full-retract peck at depth/D {depth_to_dia:.1f}x. Q={peck:.4f}\" R={r_plane:.3f}\""
    )
    return ("G83", note, peck, r_plane, peck_schedule)

    return adjusted_woc, radial_passes, capped


# ============================================================
# REAMING PHYSICS — Solid Carbide Reamers
# ============================================================
# Three coolant identities drive separate multiplier paths:
#   Identity 1: Coolant-Fed reamer (internal through-coolant holes)
#   Identity 2: Non-Coolant-Fed + External flood/mist
#   Identity 3: Non-Coolant-Fed + Dry

# Base SFM — solid carbide, flood external, non-coolant-fed baseline
# Midpoints of manufacturer carbide reamer charts
REAM_SFM = {
    "aluminum_wrought": 700, "aluminum_cast": 550, "non_ferrous": 300,
    "steel_free": 275, "steel_alloy": 175, "steel_tool": 75,
    "stainless_martensitic": 85, "stainless_fm": 90,
    "stainless_austenitic": 185, "stainless_ph": 75,
    "cast_iron_gray": 160, "cast_iron_ductile": 135, "cast_iron_malleable": 150,
    "titanium_cp": 85, "titanium_64": 55,
    "hiTemp_fe": 57, "hiTemp_co": 40,
    "inconel_625": 57, "inconel_718": 45,
    "hardened_lt55": 75, "hardened_gt55": 40,
    # Group fallbacks
    "Aluminum": 620, "Non-Ferrous": 300, "Steel": 175, "Stainless": 140,
    "Cast Iron": 148, "Titanium": 70, "Inconel": 50, "Plastics": 400,
}

# Non-coolant-fed SFM multiplier by material group
# Tougher/chip-sensitive materials penalised more heavily without internal coolant
_REAM_NON_CF_MULT = {
    "aluminum_wrought": 0.96, "aluminum_cast": 0.95, "non_ferrous": 0.97,
    "steel_free": 0.95, "steel_alloy": 0.93, "steel_tool": 0.93,
    "stainless_martensitic": 0.92, "stainless_fm": 0.93,
    "stainless_austenitic": 0.92, "stainless_ph": 0.92,
    "cast_iron_gray": 0.97, "cast_iron_ductile": 0.96, "cast_iron_malleable": 0.96,
    "titanium_cp": 0.92, "titanium_64": 0.90,
    "hiTemp_fe": 0.87, "hiTemp_co": 0.87,
    "inconel_625": 0.87, "inconel_718": 0.87,
    "hardened_lt55": 0.92, "hardened_gt55": 0.90,
    "Aluminum": 0.96, "Non-Ferrous": 0.97, "Steel": 0.93, "Stainless": 0.92,
    "Cast Iron": 0.97, "Titanium": 0.90, "Inconel": 0.87, "Plastics": 0.96,
}

# External coolant SFM and IPR multipliers
# (applied on top of coolant-fed / non-coolant-fed base)
_REAM_EXT_COOLANT = {
    "dry":      {"sfm": 0.75, "ipr": 0.85},
    "mist":     {"sfm": 0.88, "ipr": 0.92},
    "flood":    {"sfm": 1.00, "ipr": 1.00},
    "tsc_low":  {"sfm": 1.05, "ipr": 1.02},
    "tsc_high": {"sfm": 1.08, "ipr": 1.03},
}

# IPR diameter anchors — piecewise linear interpolation
# Source: carbide reamer feed charts (midpoint of published ranges)
_REAM_IPR_ANCHORS = [
    (0.125, 0.003),
    (0.250, 0.006),
    (0.375, 0.006),
    (0.500, 0.0085),
    (0.750, 0.012),
    (1.000, 0.020),
]

def ream_base_ipr(D: float) -> float:
    """Interpolate base IPR from diameter anchors."""
    if D <= _REAM_IPR_ANCHORS[0][0]:
        return _REAM_IPR_ANCHORS[0][1]
    if D >= _REAM_IPR_ANCHORS[-1][0]:
        return _REAM_IPR_ANCHORS[-1][1]
    for i in range(len(_REAM_IPR_ANCHORS) - 1):
        d0, ipr0 = _REAM_IPR_ANCHORS[i]
        d1, ipr1 = _REAM_IPR_ANCHORS[i + 1]
        if d0 <= D <= d1:
            t = (D - d0) / (d1 - d0)
            return ipr0 + t * (ipr1 - ipr0)
    return 0.006

# Stock allowance anchors — total diametral stock (ream_dia - pre_drill_dia)
# Source: ~2-3% of reamer diameter, calibrated to manufacturer stock charts
_REAM_STOCK_ANCHORS = [
    (0.125, 0.007, 0.010),
    (0.250, 0.010, 0.012),
    (0.375, 0.012, 0.013),
    (0.500, 0.013, 0.014),
    (0.750, 0.016, 0.017),
    (1.000, 0.018, 0.019),
]

def ream_stock_range(D: float) -> tuple:
    """Returns (stock_min, stock_ideal, stock_max) total diametral stock for solid carbide reamer."""
    if D <= _REAM_STOCK_ANCHORS[0][0]:
        lo, hi = _REAM_STOCK_ANCHORS[0][1], _REAM_STOCK_ANCHORS[0][2]
    elif D >= _REAM_STOCK_ANCHORS[-1][0]:
        lo, hi = _REAM_STOCK_ANCHORS[-1][1], _REAM_STOCK_ANCHORS[-1][2]
    else:
        for i in range(len(_REAM_STOCK_ANCHORS) - 1):
            d0, lo0, hi0 = _REAM_STOCK_ANCHORS[i]
            d1, lo1, hi1 = _REAM_STOCK_ANCHORS[i + 1]
            if d0 <= D <= d1:
                t = (D - d0) / (d1 - d0)
                lo = lo0 + t * (lo1 - lo0)
                hi = hi0 + t * (hi1 - hi0)
                break
    ideal = (lo + hi) / 2
    return (round(lo, 5), round(ideal, 5), round(hi, 5))

# Coating recommendation by ISO material group (Core Cutter product line)
# ISO H (hardened ≥45 HRC) overrides the group lookup
_REAM_COATING_BY_GROUP = {
    "Aluminum":    ("Uncoated or D-Max", "N"),
    "Non-Ferrous": ("Uncoated or D-Max", "N"),
    "Plastics":    ("Uncoated or D-Max", "N"),
    "Steel":       ("A-Max",             "P"),
    "Cast Iron":   ("A-Max",             "K"),
    "Stainless":   ("T-Max",             "M"),
    "Titanium":    ("T-Max",             "S"),
    "Inconel":     ("T-Max",             "S"),
}

def ream_coating(mat_group: str, hrc: float) -> tuple:
    """Returns (coating_name, iso_category) for solid carbide reamer."""
    if hrc >= 45:
        return ("T-Max", "H")
    return _REAM_COATING_BY_GROUP.get(mat_group, ("A-Max", "P"))


# Short/brittle chip materials — straight flute regardless of depth or hole type
_STRAIGHT_CHIP_GROUPS = {"Cast Iron", "Non-Ferrous", "Plastics"}
# Stringy chip materials — benefit from 30° spiral for chip breaking
_STRINGY_GROUPS = {"Stainless", "Titanium", "Inconel"}
# Soft/gummy chip materials — benefit from 30° spiral to prevent built-up edge
_SOFT_GROUPS    = {"Aluminum"}

def ream_helix_angle(mat_group: str, depth_xd: float, finish_risk: str, hrc: float,
                     blind: bool = False, coolant_fed: bool = True) -> tuple:
    """Returns (angle_deg, angle_label, angle_note) for reamer helix angle selection.

    Core Cutter builds straight flute (0°) and 30° spiral reamers.
    Caller assigns hand based on hole type:
      Through hole → LH spiral / RH cut  (chips pushed forward and out)
      Blind hole   → RH spiral / RH cut  (helical assist evacuates chips)

    Depth thresholds:
      ≤ 2×D  — straight flute usually fine
      2–4×D  — material (chip type) drives the call
      > 4×D  — spiral preferred
      > 6×D  — spiral mandatory
    """
    # Hardened: straight flute — accuracy and stability over chip flow
    if hrc >= 45:
        return (0, "straight flute",
                "Straight flute maximises dimensional accuracy and tool life on hardened material — "
                "helical cutting forces increase deflection and risk oversize.")

    # Short-chip / brittle materials: straight flute regardless of depth
    # Cast iron, brass, bronze clear without helical assist
    if mat_group in _STRAIGHT_CHIP_GROUPS:
        return (0, "straight flute",
                f"{mat_group} produces short, brittle chips that clear without helical action — "
                "straight flute gives maximum stability and tightest size control.")

    # Blind hole without coolant: spiral required — no coolant flush to move chips
    if blind and not coolant_fed:
        return (30, "30° spiral",
                "Blind hole without internal coolant requires helical flutes to evacuate chips — "
                "straight flute would pack chips at the hole bottom.")

    # Deep holes: spiral preferred (>4×D) or mandatory (>6×D)
    if depth_xd > 6.0:
        return (30, "30° spiral",
                f"At {depth_xd:.1f}\u00d7D, helical flutes are mandatory — "
                "chip packing at this depth causes oversize, poor finish, and tool breakage.")

    if depth_xd > 4.0:
        return (30, "30° spiral",
                f"At {depth_xd:.1f}\u00d7D, 30° spiral is preferred to keep chips moving — "
                "straight flute risks chip packing at this depth.")

    # Moderate depth (2–4×D): material chip type drives the call
    if depth_xd > 2.0:
        if mat_group in _SOFT_GROUPS:
            return (30, "30° spiral",
                    f"At {depth_xd:.1f}\u00d7D with {mat_group}, 30° spiral clears gummy chips "
                    "before they weld to the cutting edge.")
        if mat_group in _STRINGY_GROUPS:
            return (30, "30° spiral",
                    f"At {depth_xd:.1f}\u00d7D with {mat_group}, 30° spiral breaks up stringy chips "
                    "and prevents re-cutting swarf.")

    # Shallow (≤2×D) or general steel at moderate depth: straight flute
    return (0, "straight flute",
            "Straight flute is standard — excellent size accuracy, minimal deflection, "
            "and best surface finish for tolerance work.")


# Base tool life ranges (holes) by material group for solid carbide reamers
_TOOL_LIFE_BASE = {
    "Aluminum":    (1000, 3000),
    "Non-Ferrous": (800,  2500),
    "Plastics":    (500,  2000),
    "Steel":       (300,  800),
    "Cast Iron":   (400,  1000),
    "Stainless":   (150,  400),
    "Titanium":    (100,  300),
    "Inconel":     (50,   150),
}

def ream_tool_life(mat_group: str, hrc: float, coolant_fed: bool, coolant: str,
                   stock_status: str, depth_xd: float) -> tuple:
    """Returns (lo_holes, hi_holes) estimated tool life range for solid carbide reamer.

    Ranges are general guidelines — actual life varies with pre-drill accuracy,
    runout, coolant consistency, and specific alloy.
    """
    lo, hi = _TOOL_LIFE_BASE.get(mat_group, (200, 600))

    mult = 1.0

    # Hardness penalty
    if hrc >= 45:
        mult *= 0.35
    elif hrc >= 35:
        mult *= 0.70

    # Coolant modifier
    if coolant_fed:
        mult *= 1.40
    elif coolant in ("tsc_low", "tsc_high", "flood"):
        mult *= 1.10
    elif coolant == "mist":
        mult *= 0.80
    elif coolant == "dry":
        mult *= 0.55

    # Stock condition
    if stock_status == "low":
        mult *= 0.55   # rubbing accelerates wear
    elif stock_status in ("high", "excessive"):
        mult *= 0.70

    # Depth penalty
    if depth_xd > 6.0:
        mult *= 0.65
    elif depth_xd > 4.0:
        mult *= 0.80

    raw_lo = lo * mult
    raw_hi = hi * mult

    def _round_nice(n: float) -> int:
        if n < 100:
            return max(10, round(n / 10) * 10)
        if n < 500:
            return max(50, round(n / 25) * 25)
        return max(100, round(n / 100) * 100)

    return (_round_nice(raw_lo), _round_nice(raw_hi))


def ream_depth_factors(depth_xd: float, coolant_fed: bool) -> tuple:
    """Returns (sfm_factor, ipr_factor, depth_status) based on depth/D ratio and coolant delivery.
    Two separate tables per user spec — coolant-fed and non-coolant-fed have different tolerance for depth."""
    if coolant_fed:
        if depth_xd <= 2.0:   return (1.00, 1.00, "ok")
        elif depth_xd <= 4.0: return (0.95, 0.95, "caution")
        elif depth_xd <= 6.0: return (0.90, 0.90, "caution")
        else:                  return (0.82, 0.85, "warning")
    else:
        if depth_xd <= 2.0:   return (1.00, 1.00, "ok")
        elif depth_xd <= 4.0: return (0.90, 0.90, "caution")
        elif depth_xd <= 6.0: return (0.82, 0.82, "warning")
        else:                  return (0.70, 0.75, "warning")