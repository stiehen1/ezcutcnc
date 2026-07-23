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
    elif mode == "surfacing":
        woc = 10.0   # overridden by surfacing preprocessing (stepover/D_eff)
        doc = 0.10   # overridden by surfacing preprocessing (ap)
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

# ============================================================
# MICRO-TOOL FEED LIMITER
# Replaces crude absolute-IPM caps with a physics-grounded,
# multi-factor limiter that respects material, operation,
# spindle speed, L:D, setup quality, and tool geometry.
# Based on miniature-tool guidance (Harvey, Sandvik) and the
# principle that runout/deflection/vibration — not chip-load
# math — are the governing limits for D < 1/8".
# ============================================================

# Diameter bands (inches)
def _micro_band(dia: float) -> str:
    """A=≤1/32, B=≤1/16, C=≤3/32, D=≤1/8. Returns None if > 1/8."""
    if dia <= 0.03125:  return "A"
    if dia <= 0.0625:   return "B"
    if dia <= 0.09375:  return "C"
    if dia <= 0.125:    return "D"
    return None  # > 1/8" — caller decides whether to apply

# Map ISO material group name → simplified bucket
_MICRO_ISO_BUCKET = {
    # N — nonferrous
    "Aluminum": "N", "Non-Ferrous": "N", "Plastics": "N",
    # P — steels
    "Steel": "P",
    # K — cast iron / abrasive non-ferrous (same chip-load discipline)
    "Cast Iron": "K", "Abrasive Non-Ferrous": "K",
    # M — stainless
    "Stainless": "M",
    # S — titanium / HRSA
    "Titanium": "S", "Inconel": "S",
}

# Material practicality factor by ISO bucket
_MICRO_MAT_FACTOR = {"N": 1.00, "P": 0.82, "M": 0.72, "S": 0.62, "K": 0.75}

# Operation bucket → factor
# hem_rough: most freedom; finish_wall: most restrictive (taper > survival)
_MICRO_OP_FACTOR = {
    "hem_rough":    1.00,
    "traditional":  0.90,
    "profile":      0.82,
    "floor_finish": 0.72,
    "slot":         0.62,
    "finish_wall":  0.58,
}

# Max chip-thinning multiplier by (band, op_bucket)
# Caps the 1/sin(arccos(...)) boost to prevent absurd feed jumps on tiny tools.
_MICRO_MAX_CTF = {
    # band: {op_bucket: max_ctf}
    # CTF cap = max allowed chip-thinning multiplier (chip_factor × HEM_mult).
    # HEM at low WOC (5–15%) generates real chip thinning that must be honoured.
    # Caps prevent absurd CT boosts from micro-vibration amplification at high RPM.
    # At low RPM (machine-limited), the rpm_ratio < 0.25 path bypasses most of the
    # practicality stack so only this CTF cap matters — keep it honest.
    "A": {"hem_rough": 1.30, "traditional": 1.10, "profile": 1.10, "floor_finish": 1.05, "slot": 0.95, "finish_wall": 1.00},
    "B": {"hem_rough": 1.55, "traditional": 1.22, "profile": 1.22, "floor_finish": 1.12, "slot": 1.02, "finish_wall": 1.10},
    "C": {"hem_rough": 1.80, "traditional": 1.38, "profile": 1.32, "floor_finish": 1.22, "slot": 1.10, "finish_wall": 1.18},
    "D": {"hem_rough": 2.10, "traditional": 1.55, "profile": 1.48, "floor_finish": 1.32, "slot": 1.18, "finish_wall": 1.26},
}

# RPM ratio factor — penalises when machine can't reach target SFM RPM
# KEY: when RPM is genuinely machine-limited (ratio < 0.25), the low SFM already
# gives the tool more thermal margin — don't stack an additional runout/vibration
# penalty. The resonance risk model only applies in the 0.25–0.90 range where
# the spindle is spinning fast enough for vibration to matter but not fast enough
# for correct chip formation.
def _micro_rpm_factor(rpm_ratio: float, iso_bucket: str) -> float:
    if rpm_ratio >= 0.90:
        f = 1.00
    elif rpm_ratio >= 0.70:
        f = 0.95
    elif rpm_ratio >= 0.50:
        f = 0.88
    elif rpm_ratio >= 0.25:
        f = 0.82
    else:
        # Machine-limited (lathe live tool, low-RPM spindle) — SFM is already
        # conservative; no additional RPM penalty. Feed is correct for actual RPM.
        f = 1.00
    # Tighter materials are less forgiving at low RPM (only in the penalised range)
    if iso_bucket in ("M", "S") and 0.25 <= rpm_ratio < 0.70:
        f *= 0.92
    return f

# Setup/runout quality factor
_MICRO_SETUP_FACTOR = {
    "excellent": 1.00,  # shrink-fit / hydraulic / very low runout
    "good":      0.90,
    "unknown":   0.78,
    "poor":      0.62,
}

# L:D factor — penalises long stickout for deflection/chatter risk
# Floor raised from 0.45 → 0.55: at very high L:D the stability advisor already
# flags deflection and suggests shorter stickout. Crushing feed to 45% on top
# of all other penalties is double-counting the same risk.
def _micro_ld_factor(ld: float) -> float:
    if ld <= 2.5:  return 1.00
    if ld <= 4.0:  return 0.90
    if ld <= 6.0:  return 0.78
    if ld <= 8.0:  return 0.65
    return 0.55

# Series/geometry bonus
def _micro_series_factor(tool_series: str, variable_pitch: bool, variable_helix: bool) -> float:
    s = (tool_series or "").upper()
    if s.startswith("QTR3"):
        return 1.06  # 3-fl variable pitch+helix, larger shank — more stable than generic micro
    if variable_pitch and variable_helix:
        return 1.04
    if variable_pitch:
        return 1.00
    return 0.95  # generic non-stability micro

def micro_tool_feed_limit(
    feed_physics: float,
    base_ipt: float,
    chip_thinning_factor_raw: float,
    rpm_actual: float,
    flutes: int,
    diameter: float,
    material_group: str,
    mode: str,
    rpm_target: float,
    ld_ratio: float,
    toolholder: str,
    tool_series: str,
    variable_pitch: bool,
    variable_helix: bool,
) -> tuple:
    """
    Multi-factor micro-tool feed limiter.
    Returns (feed_limited, reason_str_or_None).
    reason_str is None when no cap was applied.

    For D >= 1/8" and not in finish_wall / profile / slot, returns feed_physics unchanged.
    """
    band = _micro_band(diameter)
    # Map operation to bucket
    if mode in ("hem", "trochoidal"):
        op_bucket = "hem_rough"
    elif mode == "traditional":
        op_bucket = "traditional"
    elif mode == "finish":
        op_bucket = "finish_wall"
    elif mode == "profile":
        op_bucket = "profile"
    elif mode == "slot":
        op_bucket = "slot"
    else:
        op_bucket = "profile"

    # Only apply to D < 1/8" (or 1/8" finish/profile/slot)
    if band is None:
        if op_bucket not in ("finish_wall", "profile", "slot"):
            return feed_physics, None
        band = "D"  # treat 1/8" < D ≤ 3/16" finish passes as band D

    iso = _MICRO_ISO_BUCKET.get(material_group, "P")

    # 1. Cap chip-thinning multiplier
    # feed_ctf_cap = what feed_physics WOULD be if CTF were capped at max_ctf.
    # Use feed_physics / chip_thinning_factor_raw to recover the pre-CT base,
    # then re-apply the capped CTF. This correctly handles machine-limited RPM
    # (where feed_physics is already low) without re-deriving from base_ipt×RPM.
    max_ctf = _MICRO_MAX_CTF.get(band, _MICRO_MAX_CTF["D"]).get(op_bucket, 1.40)
    ctf_raw = max(chip_thinning_factor_raw, 1e-6)
    if ctf_raw > max_ctf:
        feed_ctf_cap = feed_physics * (max_ctf / ctf_raw)
    else:
        feed_ctf_cap = feed_physics  # CT is already within limits; no CTF cap needed

    # 2. Build practicality multiplier
    rpm_ratio = (rpm_actual / rpm_target) if rpm_target > 1e-6 else 1.0
    setup_quality = {
        "shrink_fit": "excellent", "press_fit": "excellent", "capto": "excellent",
        "hydraulic": "good", "milling_chuck": "good", "hp_collet": "good",
        "er_collet": "unknown", "weldon": "unknown",
    }.get(toolholder, "unknown")

    practicality = (
        _MICRO_MAT_FACTOR.get(iso, 0.82)
        * _MICRO_OP_FACTOR.get(op_bucket, 0.82)
        * _micro_rpm_factor(rpm_ratio, iso)
        * _MICRO_SETUP_FACTOR.get(setup_quality, 0.78)
        * _micro_ld_factor(ld_ratio)
        * _micro_series_factor(tool_series, variable_pitch, variable_helix)
    )
    # When the machine is genuinely RPM-limited (live-tool lathe, low-speed spindle),
    # feed_physics is already correct for the actual RPM — the CTF cap above is the
    # right control. Don't further reduce with practicality multiplier stacking.
    # Threshold: rpm_ratio < 0.25 means spindle is running at <25% of target SFM.
    if rpm_ratio < 0.25:
        practicality = max(practicality, 0.85)
    else:
        # Normal case: combined floor prevents extreme penalty stacking
        practicality = max(practicality, 0.42)

    feed_practical = feed_ctf_cap * practicality

    # 3. Never go below a minimum that ensures cutting (not rubbing)
    min_feed = rpm_actual * flutes * base_ipt * 0.50  # floor at 50% of base no-CT feed
    feed_final = max(min_feed, min(feed_physics, feed_practical))

    if feed_final >= feed_physics * 0.995:
        return feed_physics, None  # no meaningful cap — don't bother noting it

    reason = (
        f"Micro-tool practical feed cap applied (ø{diameter:.4f}\" band-{band}, "
        f"{material_group} {op_bucket}): physics {feed_physics:.1f} IPM → "
        f"{feed_final:.1f} IPM  [CTF ratio ×{(feed_ctf_cap/feed_physics if feed_physics > 1e-9 else 1.0):.2f}, practicality ×{practicality:.2f}]"
    )
    return feed_final, reason

# Radial rake force factor — positive rake reduces Kc (easier cutting).
# Normalized to 7° (standard steel/stainless tools = 1.00 baseline).
# VXR series at 0° (neutral rake) generates ~5% more force than standard.
# AL series at 10° (aggressive aluminum rake) generates ~5% less force.
RAKE_FORCE_FACTOR = {0: 1.05, 7: 1.00, 8: 0.98, 10: 0.95}
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
    # Full entry-to-exit arc (radians): 2 × acos(1 - 2·ae/D).
    # WOC=D/2 (half-slot) → π (180°); WOC=D (full slot) → 2π but is special-cased upstream.
    # Time-avg teeth = (arc / 2π) × flutes, so half-slot → flutes/2. ✓
    return 2.0 * math.acos(max(-1.0, min(1.0, 1 - (2 * woc / diameter))))

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


def cutting_force_per_tooth(material_group, h_eff, helix, hardness_hrc=0, radial_rake=7):
    # Kc values halved 2026-05-27 to pair with the corrected engagement_angle()
    # (which now returns the full entry-to-exit arc, doubling time-avg teeth).
    # total_force = force_per_tooth × teeth is numerically unchanged from the
    # prior (half-arc Kc × doubled-Kc) calibration — shop-validated force/HP/
    # deflection/stability values are preserved. Only displayed teeth_in_cut
    # and engagement_angle_deg now reflect correct geometry.
    K = {
        # Legacy group keys
        "Steel": 90000,
        "Stainless": 100000,
        "Cast Iron": 80000,
        "Inconel": 120000,
        "Titanium": 110000,
        "Aluminum": 30000,
        "Non-Ferrous": 35000,
        "Plastics": 15000,
        # ISO subcategory keys
        "aluminum_wrought": 27500,
        "aluminum_cast": 32500,
        "non_ferrous": 35000,
        "steel_free": 75000,
        "steel_medium_carbon": 82500,
        "steel_alloy": 90000,
        "steel_tool": 105000,
        "stainless_martensitic": 97500,
        "stainless_fm":          92500,
        "stainless_austenitic":  107500,
        "stainless_15_5":        108000,
        "stainless_ph":          112500,
        "stainless_13_8":        130000,
        "cast_iron_gray":        70000,
        "cast_iron_ductile":     80000,
        "cast_iron_malleable":   75000,
        "titanium_cp":           95000,
        "titanium_64":           110000,
        "titanium":              110000,
        "hiTemp_fe":             117500,
        "hiTemp_co":             125000,
        "inconel_625":           120000,
        "inconel_718":           132500,
        "inconel":               125000,
        "hardened_lt55":         125000,
        "hardened_gt55":         150000,
    }.get(material_group, 90000)
    K *= _hardness_kc_mult(hardness_hrc)
    # Interpolate rake factor for non-table values
    _rake_ff = RAKE_FORCE_FACTOR.get(radial_rake)
    if _rake_ff is None:
        _rake_keys = sorted(RAKE_FORCE_FACTOR.keys())
        _lo = max((k for k in _rake_keys if k <= radial_rake), default=_rake_keys[0])
        _hi = min((k for k in _rake_keys if k >= radial_rake), default=_rake_keys[-1])
        if _lo == _hi:
            _rake_ff = RAKE_FORCE_FACTOR[_lo]
        else:
            _t = (radial_rake - _lo) / (_hi - _lo)
            _rake_ff = RAKE_FORCE_FACTOR[_lo] + _t * (RAKE_FORCE_FACTOR[_hi] - RAKE_FORCE_FACTOR[_lo])
    return K * h_eff * HELIX_FORCE_FACTOR.get(helix, 1.0) * _rake_ff


def _tapered_cantilever_delta(force, L, d_tip, d_base, E):
    """Tip deflection of an end-loaded cantilever whose diameter varies linearly
    from d_tip (free end) to d_base (fixed end) over length L.

    δ = (F/3E)·∫₀ᴸ (L−x)²/I(x) dx,  I(x)=π·d(x)⁴/64,  d(x)=d_tip+(d_base−d_tip)·x/L

    Substituting u = d(x) gives a closed form (no numerical integration). Reduces
    exactly to the straight-beam result δ = F·L³/(3E·I) when d_tip == d_base.
    Used for tapered ballnose / tapered-neck tools in 3D surfacing.
    """
    import math
    L = float(L); d_tip = float(d_tip); d_base = float(d_base)
    if L <= 0 or d_tip <= 0 or d_base <= 0:
        return 0.0
    k = 64.0 / math.pi
    # Straight beam (equal diameters): avoid divide-by-zero in the taper form.
    if abs(d_base - d_tip) < 1e-9:
        I = (math.pi * d_tip**4) / 64.0
        return (force * L**3) / (3.0 * E * I)
    m = (d_base - d_tip) / L          # slope of diameter vs. x
    # (L−x) = (d_base − d(x))/m ; change variable to u=d(x), du=m·dx.
    # δ = (F·k)/(3E·m³) · ∫_{d_tip}^{d_base} (d_base − u)² / u⁴ du
    # ∫ (d_base−u)²/u⁴ du = -d_base²/(3u³) + d_base/u² - 1/u   (antiderivative)
    def _F(u):
        return -(d_base**2) / (3.0 * u**3) + d_base / (u**2) - 1.0 / u
    integral = _F(d_base) - _F(d_tip)
    return (force * k) / (3.0 * E * m**3) * integral


def tool_deflection(force, stickout, diameter, flutes, loc=None, lbs=None, neck_dia=None,
                    holder_gage_len=None, holder_nose_dia=None, series_core_ratio=None,
                    taper_base_dia=None, taper_length=None):
    import math

    # Carbide modulus
    E_carbide = 90_000_000  # psi
    E_steel   = 30_000_000  # psi (holder body)

    # Estimate core diameter ratio based on flute count.
    # More flutes → less flute valley depth → larger core → I scales as D_core^4.
    # Stiffness vs 4-fl ref: 5fl=1.31×, 6fl=1.71×, 7fl=1.89×, 9fl=2.31×, 11fl=2.55×
    # Series-specific core ratio takes priority over flute-count estimate.
    # Provided by SERIES_CORE_RATIO in legacy_engine.py when tool_series is known.
    if series_core_ratio is not None:
        core_ratio = float(series_core_ratio)
    else:
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
    if taper_base_dia and taper_length and float(taper_base_dia) > diameter and float(taper_length) > 0:
        # Tapered ballnose / tapered-neck tool: the conical body (tip dia → base dia
        # over taper_length) is far stiffer than a straight column at tip dia. Model
        # the tapered segment exactly, then any remaining stickout as a stiff straight
        # segment at the base dia. Ball tip dia == cutting `diameter` (tip = tool_dia).
        L_taper = min(float(taper_length), L_t)
        delta_tool = _tapered_cantilever_delta(force, L_taper, diameter, float(taper_base_dia), E_carbide)
        L_rem = L_t - L_taper
        if L_rem > 1e-6:
            # Straight base-dia segment beyond the taper: cantilever + rigid-body rotation
            # of the taper tip carried out to full stickout (parallel-axis via Mohr).
            I_base = (math.pi * float(taper_base_dia)**4) / 64.0
            delta_tool += (force / (3.0 * E_carbide * I_base)) * (L_t**3 - L_taper**3)
    elif lbs and loc and float(lbs) > float(loc) and float(lbs) <= L_t:
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


# Workpiece (part) elastic modulus by ISO material group, psi.
# The PART flexes too — on a soft aluminum part it flexes ~3× more than steel for the
# same geometry. Used by workpiece_deflection to model the part as its own cantilever.
WORKPIECE_MODULUS = {
    "P": 30_000_000,   # steel / carbon / alloy
    "M": 28_000_000,   # stainless
    "K": 20_000_000,   # cast iron
    "N": 10_000_000,   # aluminum / non-ferrous
    "S": 16_500_000,   # titanium / superalloy (Ti ~16.5, Inconel ~31 — use Ti as conservative-flex default)
    "H": 30_000_000,   # hardened steel
}

# Fixture-loop compliance, in·lbf⁻¹ of *rotational/base give* at the clamp itself,
# BEFORE the part cantilever is added. This captures the fact that a 3-jaw chuck on a
# 4th-axis rotary is not a rigid clamp — the jaws, chuck body, and rotary bearing/brake
# all deflect under radial load even at zero overhang. Expressed as a linear compliance
# (in/lbf) at the jaw face; added in series with the part-cantilever compliance.
# Values are documented starting estimates (softest → stiffest), to be shop-calibrated.
FIXTURE_COMPLIANCE = {
    # rotary / trunnion loops — softest (bearing + brake + chuck stack-up)
    "3_jaw_on_rotary": 2.6e-6,  # 3-jaw grip give stacked on top of the rotary bearing/brake loop — softest setup
    "trunnion_4th":    2.2e-6,
    "face_plate":      1.8e-6,
    # standalone chucks
    "3_jaw_chuck":     1.6e-6,
    "6_jaw_chuck":     1.3e-6,
    "4_jaw_chuck":     1.2e-6,
    "collet_chuck":    0.9e-6,
    "hydraulic_chuck": 0.9e-6,
    "power_chuck":     0.9e-6,
    "expanding_mandrel": 1.1e-6,
    # vises
    "soft_jaws":       1.4e-6,
    "vise":            0.8e-6,
    "5th_axis_vise":   0.7e-6,
    "toe_clamps":      1.5e-6,
    # bolted / doweled — stiffest
    "dovetail":        0.6e-6,
    "rigid_fixture":   0.4e-6,
    "tombstone":       0.4e-6,
    # bar-support setups — part is held along its length, minimal base give
    "between_centers": 0.3e-6,
    "steady_rest":     0.5e-6,
    "guide_bushing":   0.3e-6,
    "gang_tooling":    0.6e-6,
}
FIXTURE_COMPLIANCE_DEFAULT = 1.0e-6  # unknown workholding → vise-ish

# Workpiece material density by ISO group, lb/in³ — used to estimate the OVERHUNG MASS
# of the part (ρ·V of the overhang cylinder). Mass drives the dynamic amplification below.
WORKPIECE_DENSITY = {
    "P": 0.283,   # steel
    "M": 0.286,   # stainless
    "K": 0.260,   # cast iron
    "N": 0.098,   # aluminum / non-ferrous (Al ~0.098; brass is denser but N is Al-dominant)
    "S": 0.160,   # titanium (Ti ~0.16; Inconel ~0.30 — Ti as the common S-group part)
    "H": 0.283,   # hardened steel
}

# Dynamic amplification tuning. A cantilever's natural frequency fn ∝ √(k/m): the heavier
# the overhung mass, the lower fn, and the closer tooth-passing excitation sits to
# resonance — so the SAME cutting force produces a larger vibratory response. We don't run
# a full stability-lobe/RPM model here; instead we scale the static workpiece deflection by
# a bounded factor that grows with overhung mass relative to a diameter-scaled reference.
# A short/light stub → ~1.0× (no penalty); a heavy slung-out part → up to the cap.
# Constants are DOCUMENTED ESTIMATES, to be shop-calibrated (like FIXTURE_COMPLIANCE).
_DYN_AMP_K   = 0.9    # strength of the mass penalty
_DYN_AMP_P   = 0.6    # sub-linear growth (diminishing but unbounded-ish)
_DYN_AMP_CAP = 2.5    # never amplify more than 2.5× on mass alone
# Reference mass ∝ dia³ — a "compact stub" of the same diameter (L≈dia). Comparing the
# actual overhung mass to this makes the penalty a mass-AND-slenderness signal, not just
# absolute weight: a stubby heavy part barely amplifies, a long slung-out one does.
_DYN_AMP_REF_DENSITY = 0.283  # steel reference


def workpiece_deflection(force, overhang, part_dia, iso_group="P",
                         fixture_key=None, supported=False):
    """Deflect the PART as a cantilever off the chuck jaws / trunnion face, in series
    with the fixture-loop compliance, then amplify for the overhung mass (dynamic response).

    force     — radial cutting force at the tool tip (lbf); we treat the part tip load
                as the same radial force the tool sees (Newton's third law).
    overhang  — part_stickout: length the part sticks out past the jaws (in).
    part_dia  — solid-round cross-section diameter at the overhang (in). Conservative;
                a tube is stiffer, a thin web is softer.
    iso_group — material ISO letter → WORKPIECE_MODULUS / WORKPIECE_DENSITY.
    fixture_key — workholding enum key → FIXTURE_COMPLIANCE base give.
    supported — True when a tailstock / live center / steady rest constrains the far end,
                converting the cantilever to a (much stiffer) simply-supported beam.

    Returns (delta_total, delta_cantilever, delta_fixture, dyn_amp, overhung_mass_lb).
    """
    import math
    if overhang <= 0 or part_dia <= 0 or force <= 0:
        return (0.0, 0.0, 0.0, 1.0, 0.0)

    E = WORKPIECE_MODULUS.get(str(iso_group), 30_000_000)
    I_part = (math.pi * float(part_dia) ** 4) / 64.0
    L = float(overhang)

    # Cantilever tip deflection under an end load: δ = F·L³ / (3·E·I).
    delta_cant = (force * L ** 3) / (3.0 * E * I_part)
    if supported:
        # Simply-supported (both ends held) deflects ~3.5× less at the load point than a
        # cantilever of the same span — mirrors the tailstock treatment already used for
        # the tool-side deflection limit.
        delta_cant /= 3.5

    # Fixture base give: linear compliance × force, added in series with the cantilever.
    c_fix = FIXTURE_COMPLIANCE.get(str(fixture_key), FIXTURE_COMPLIANCE_DEFAULT)
    delta_fix = c_fix * force

    delta_static = delta_cant + delta_fix

    # ── Dynamic mass amplification ───────────────────────────────────────────
    # Overhung mass as a solid cylinder: m = ρ · π·(d/2)²·L.
    rho = WORKPIECE_DENSITY.get(str(iso_group), 0.283)
    overhung_mass = rho * math.pi * (float(part_dia) / 2.0) ** 2 * L
    # Reference "compact stub" mass at this diameter (L ≈ dia, steel): heavier/longer than
    # this ratio amplifies; a small stub sits near 1.0. A supported far end kills the
    # pendulum action, so no mass penalty when supported.
    m_ref = _DYN_AMP_REF_DENSITY * math.pi * (float(part_dia) / 2.0) ** 2 * float(part_dia)
    if supported or m_ref <= 0:
        dyn_amp = 1.0
    else:
        # Penalty grows with mass BEYOND the compact-stub reference. Anchored on
        # (ratio − 1) so it starts at exactly 1.0× when the part is no heavier than a
        # same-dia stub and grows smoothly from there — no cliff at the boundary.
        ratio = overhung_mass / m_ref
        excess = max(0.0, ratio - 1.0)
        dyn_amp = min(_DYN_AMP_CAP, 1.0 + _DYN_AMP_K * (excess ** _DYN_AMP_P))

    return (delta_static * dyn_amp, delta_cant, delta_fix, dyn_amp, overhung_mass)

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


def runout_life_factor(tir_in):
    """Tool life multiplier from measured TIR at the tool tip in the spindle.
    Below 0.0005" — no penalty (excellent holders).
    0.0005"-0.001" — gradual: 0% → 25% reduction.
    0.001"-0.002"  — steep:    25% → 60% reduction.
    Above 0.002"   — capped at 60% reduction (one-tooth-cutting territory).
    Returns 1.0 if tir_in <= 0 (not measured — no override applied)."""
    try:
        t = float(tir_in or 0)
    except (TypeError, ValueError):
        return 1.0
    if t <= 0:
        return 1.0
    if t <= 0.0005:
        return 1.0
    if t <= 0.001:
        # 0.0005→0.001 maps to 1.0→0.75 (linear)
        return 1.0 - 0.25 * ((t - 0.0005) / 0.0005)
    if t <= 0.002:
        # 0.001→0.002 maps to 0.75→0.40 (linear)
        return 0.75 - 0.35 * ((t - 0.001) / 0.001)
    return 0.40


def runout_ipt_factor(tir_in, fallback=0.92):
    """User-measured TIR override for HOLDER_RUNOUT_FACTOR (chip load multiplier).
    At very low TIR the chip load is even across teeth — no derate.
    At higher TIR one tooth carries more load, so we back off the rated IPT.
    fallback is used when TIR is not measured (caller falls back to holder-type table)."""
    try:
        t = float(tir_in or 0)
    except (TypeError, ValueError):
        return None
    if t <= 0:
        return None  # signals "not measured" — caller uses HOLDER_RUNOUT_FACTOR
    if t <= 0.0003:
        return 1.00
    if t <= 0.0005:
        return 0.99
    if t <= 0.001:
        return 0.95
    if t <= 0.0015:
        return 0.90
    if t <= 0.002:
        return 0.85
    return 0.78

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

def drill_micro_sfm_bonus(D: float) -> float:
    """Micro-drill SFM multiplier.

    Carbide drill manufacturer charts (Tru-Edge, RedLine, etc.) show micro-drills running
    at higher SFM than the engine's base table predicts. The base SFM values are calibrated
    for typical drill sizes (~Ø.250) where heat dissipation, flute volume, and chip evac
    set the limit. Micro-drills (<0.100") have less chip volume to remove and can run hotter
    surface speed without thermal failure.

    Curve dialed in alongside the DRILL_SFM sweep (project_drill_sfm_sweep.md) — base values
    are now higher, so the bonus is correspondingly smaller to avoid double-counting.
    Anchors: D≥0.100"→1.00, D=0.040"→1.30, D=0.020"→1.45. Linear interp between.
    """
    if D >= 0.100: return 1.00
    if D <= 0.020: return 1.45
    if D >= 0.040:
        # 0.040→1.30, 0.100→1.00: linear over 0.060 span
        return 1.30 - (D - 0.040) * (0.30 / 0.060)
    # 0.020→1.45, 0.040→1.30: linear over 0.020 span
    return 1.45 - (D - 0.020) * (0.15 / 0.020)


# Coolant-fed SFM bonus class — how much benefit through-coolant gives at the cutting edge.
# Derived from MZE (external coolant) vs MZS (internal coolant) manufacturer comparison.
# Bigger drills get bigger bonus because chip evacuation is the dominant limit; small drills
# already evacuate chips fine. Superalloys are thermally limited and get no bonus regardless
# of drill size — coolant helps with heat but the SFM ceiling is set by edge temperature.
#
#   "chip_limited" — Steel, stainless, cast iron, free-machining alloys. Full diameter curve.
#   "moderate"     — Aluminum, non-ferrous. Chip evac matters but heat isn't an issue;
#                    bonus saturates lower than chip-limited materials.
#   "heat_limited" — Inconel, Ti beta, hardened steel ≥50HRC. No SFM bonus.
#                    (Coolant still helps tool life, but engine doesn't model that here.)
_COOLANT_FED_CLASS = {
    # Heat-limited — flat at 1.00 across all sizes
    "Inconel":     "heat_limited",
    "hiTemp_fe":   "heat_limited",
    "hiTemp_co":   "heat_limited",
    # NOTE: hardened_lt55/gt55 are handled in _COOLANT_FED_CLASS_MATERIAL (keyed by material-key).
    # This table is keyed by mat_group; both keys map to group "Steel", so entries here would be
    # dead. Kept out deliberately — see the material-override table above.
    # Moderate — aluminum / non-ferrous, modest bonus at large dia only
    "Aluminum":    "moderate",
    "Non-Ferrous": "moderate",
    "Abrasive Non-Ferrous": "moderate",  # BeCu, Mn bronze, Si bronze — chip-limited but free-cutting
    "Plastics":    "moderate",
    # Chip-limited — biggest bonus; SFM curve climbs fastest with diameter
    "Steel":       "chip_limited",
    "Stainless":   "chip_limited",
    "Cast Iron":   "chip_limited",
    "Titanium":    "chip_limited",  # Ti CP / Ti-6-4 — chip evac IS the limit; beta-Ti drops to heat_limited (see material override)
}

# Per-material override (when group-level class is wrong for a specific alloy)
_COOLANT_FED_CLASS_MATERIAL = {
    "titanium_beta": "heat_limited",  # beta titanium: thermally limited
    # Hardened steels — group is "Steel" (chip_limited), but ≥40 HRC is heat-limited: coolant
    # keeps the tool alive, it does NOT let you drill faster. The _COOLANT_FED_CLASS entries for
    # these keys (below) were DEAD — that table is looked up by mat_group, never material-key —
    # so hardened steel wrongly got the full chip bonus (delivered 102/135 SFM). Fixed 2026-07-23
    # by moving them into this material-override table, which IS keyed by material-key.
    "hardened_lt55": "heat_limited",
    "hardened_gt55": "heat_limited",
    # Hardened tool steels — already in heat_limited via group fallback but explicit for clarity
    "tool_steel_d2": "chip_limited",  # annealed D2 is still chip-limited
    "tool_steel_h13": "chip_limited",
    "tool_steel_a2": "chip_limited",
    "tool_steel_p20": "chip_limited",
    "tool_steel_s7": "chip_limited",
}


def drill_coolant_fed_sfm_bonus(D: float, mat: str, mat_group: str, coolant: str = "tsc_high") -> float:
    """Coolant-fed (through-the-drill) SFM bonus, diameter- and material-aware.

    Replaces the previous flat 1.15× multiplier. Calibrated against MZE/MZS
    manufacturer cutting condition tables (external vs internal coolant).

    Diameter curve (chip-limited materials):
      D ≤ 0.10"   → 1.10× (minimal — micro drills already evacuate chips fine)
      D = 0.25"   → 1.45×
      D = 0.50"   → 1.80×
      D ≥ 0.75"   → 2.00× (chip evac dominant; matches MZE/MZS ~2× at large dia)

    Moderate materials (aluminum, non-ferrous): curve saturates lower (max 1.50× at large dia).
    Heat-limited materials (Inconel, hardened, Ti beta): flat 1.00× — no SFM bonus.

    PRESSURE SCALING — the MZE/MZS curve represents HIGH-PRESSURE internal coolant
    (~1000 psi class). A through-coolant drill on a lower-pressure pump evacuates
    chips less aggressively, so the bonus ABOVE 1.0 is scaled by delivery pressure:
      tsc_high (~1000 psi) → 1.00 of the bonus (full MZE/MZS credit)
      tsc_low  (~300 psi)  → 0.70 of the bonus (shop-set 2026-07-23; 300 psi evacuates
                             well but not to the 1000-psi ceiling)
      anything else        → 0.70 (treated as low-pressure; coolant-fed tools are gated
                             in the UI to TSC300/TSC1000 so this is a safety fallback)
    The 1.0 baseline is never scaled — only the earned bonus is derated.
    """
    # Resolve coolant-fed class — material-specific override wins, then group fallback
    cls = _COOLANT_FED_CLASS_MATERIAL.get(mat)
    if cls is None:
        cls = _COOLANT_FED_CLASS.get(mat_group, "chip_limited")

    if cls == "heat_limited":
        return 1.00

    # Diameter curve — same shape for chip_limited and moderate, scaled to different caps
    if cls == "moderate":
        cap = 1.50
    else:  # chip_limited
        cap = 2.00

    # Piecewise linear in D, anchored at:
    #   D ≤ 0.10 → 1.10
    #   D = 0.25 → 1.10 + (cap-1.10) × 0.45
    #   D = 0.50 → 1.10 + (cap-1.10) × 0.78
    #   D ≥ 0.75 → cap
    if D <= 0.10:
        raw = 1.10
    elif D >= 0.75:
        raw = cap
    else:
        # Linear in two segments: (0.10, 1.10) → (0.50, mid) → (0.75, cap)
        mid_at_050 = 1.10 + (cap - 1.10) * 0.78
        if D <= 0.50:
            # 0.10 → 1.10, 0.50 → mid_at_050
            frac = (D - 0.10) / (0.50 - 0.10)
            raw = 1.10 + (mid_at_050 - 1.10) * frac
        else:
            # 0.50 → mid_at_050, 0.75 → cap
            frac = (D - 0.50) / (0.75 - 0.50)
            raw = mid_at_050 + (cap - mid_at_050) * frac

    # Scale the earned bonus (raw − 1.0) by delivery pressure. tsc_high = full credit;
    # tsc_low keeps 70%. Baseline 1.0 is never touched — only the bonus is derated.
    pressure_scale = 1.00 if str(coolant).lower() == "tsc_high" else 0.70
    return 1.0 + (raw - 1.0) * pressure_scale


# Minimum IPR by material group — below this the cutting edge rubs instead of shearing.
# Critical chip thickness ≈ 20–35% of edge radius; practical floor scales with drill diameter.
# Rule of thumb: min_ipr = max(material_floor, 0.002 × D)
_DRILL_MIN_IPR = {
    "Aluminum":    0.002,
    "Non-Ferrous": 0.002,
    "Abrasive Non-Ferrous": 0.003,  # BeCu work-hardens if drill rubs — Materion: "never let it rub, maintain positive feed"
    "Plastics":    0.001,
    "Steel":       0.003,
    "Stainless":   0.004,   # work-hardens rapidly if rubbing — most critical
    "Cast Iron":   0.003,
    "Titanium":    0.004,
    "Inconel":     0.005,
}

# Minimum chip thickness as fraction of diameter — governs small-drill floors.
# Validated: 17-4 SS .103" drill → 0.0009–0.0012 IPR = ~1.0–1.2% D.
# Material floor is capped at 1.5%×D so small drills never get over-floored.
_DRILL_MIN_IPR_PCT_D = {
    "Aluminum":    0.008,   # 0.8%×D
    "Non-Ferrous": 0.008,
    "Abrasive Non-Ferrous": 0.025,  # 2.5%×D — BeCu min positive feed; Ø.040 → 0.001 IPR floor
    "Plastics":    0.005,
    "Steel":       0.010,   # 1.0%×D
    "Stainless":   0.010,   # 1.0%×D (shop-validated: .103" → ~0.001 IPR)
    "Cast Iron":   0.010,
    "Titanium":    0.010,
    "Inconel":     0.012,   # 1.2%×D
}

def drill_min_ipr(D: float, material_group: str) -> float:
    """Minimum feed per rev to maintain cutting (not rubbing). Scales with drill diameter.
    Uses the smaller of: fixed material floor OR diameter-scaled floor, so small drills
    are never forced into feeds that would snap the web."""
    fixed_floor = _DRILL_MIN_IPR.get(material_group, 0.003)
    pct_floor   = _DRILL_MIN_IPR_PCT_D.get(material_group, 0.010) * D
    return min(fixed_floor, max(pct_floor, 0.0005))

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
    coolant_fed: bool = False, drill_geometry: str = "standard",
    step_count: int = 0
) -> tuple:
    """Returns (cycle, note, peck, r_plane, peck_schedule).

    step_count = number of additional cutting diameters above the tip (0 for single-dia drills,
    len(drill_step_diameters) for step drills). Multiple steps cut simultaneously and share one
    flute for chip evacuation — chip column severity scales with step count.
    """
    depth_to_dia = depth / D if D > 0 else 0
    stringy = mat_group in ("Stainless", "Titanium", "Inconel")
    hard    = hrc >= 40
    tsc     = coolant in ("tsc_low", "tsc_high")

    # Chip-breaking score: sharper points (lower angle) produce longer chips → score 0
    # 120° straight-flute step drills behave like 118° for chip formation
    pa_key = int(point_angle) if int(point_angle) > 0 else 135
    chip_score = {118: 0, 120: 0, 130: 1, 135: 1, 140: 2, 145: 2}.get(pa_key, 1)

    # Flute capacity bonus by drill geometry
    # standard: up to 5×D, med_helix: 5–7×D, high_helix: 7–9×D (neutral baseline)
    flute_bonus = {"standard": 0.0, "med_helix": 2.0, "high_helix": 4.0}.get(drill_geometry, 0.0)

    # Step-drill chip-evacuation penalty — N steps above the tip all cut simultaneously,
    # feeding chips into the same tip-sized flute bottleneck. Each added step roughly
    # halves the effective chip-evac window before pecking is needed.
    step_penalty = 0.4 * max(0, step_count)

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
    g81_limit -= step_penalty                   # step drills peck sooner

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
    g73_limit -= step_penalty                   # step drills cross into G83 sooner

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
    "aluminum_wrought": 700, "aluminum_wrought_hs": 560, "aluminum_cast": 550, "non_ferrous": 300,
    "plastic_unfilled": 300, "plastic_filled": 220, "composite_tpc": 200,
    "steel_mild": 250, "steel_free": 275, "steel_medium_carbon": 225, "steel_alloy": 175, "steel_tool": 75,
    "armor_milspec": 80, "armor_ar400": 50, "armor_ar500": 35, "armor_ar600": 18,
    "stainless_martensitic": 85, "stainless_fm": 90,
    "stainless_austenitic": 185, "stainless_15_5": 82, "stainless_ph": 75, "stainless_13_8": 68,
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
    "aluminum_wrought": 0.96, "aluminum_wrought_hs": 0.96, "aluminum_cast": 0.95, "non_ferrous": 0.97,
    "plastic_unfilled": 0.97, "plastic_filled": 0.96, "composite_tpc": 0.96,
    "steel_free": 0.95, "steel_medium_carbon": 0.94, "steel_alloy": 0.93, "steel_tool": 0.93,
    "stainless_martensitic": 0.92, "stainless_fm": 0.93,
    "stainless_austenitic": 0.92, "stainless_15_5": 0.92, "stainless_ph": 0.92, "stainless_13_8": 0.90,
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