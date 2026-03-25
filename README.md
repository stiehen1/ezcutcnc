# CoreCutCNC — Machining Advisor by Core Cutter LLC

A full-stack machining advisor for CNC shops. Calculates speeds, feeds, depths of cut, deflection, stability, and tooling recommendations across milling, drilling, reaming, feed milling, and threadmilling. Deployed at [corecutcnc.com](https://corecutcnc.com).

Two access modes: **Customer mode** (requires an EDP# or Core Cutter print PDF) and **Engineering mode** (password-gated, unrestricted parameter input).

Each operation includes a **Pro Tips panel** (how to use the app) and a collapsible **Machining Tips & Tricks accordion** (shop-floor best practices per operation type).

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Pages](#pages)
3. [File Structure](#file-structure)
4. [Data Flow](#data-flow)
5. [Operations Supported](#operations-supported)
6. [API Schema](#api-schema)
7. [Material System](#material-system)
8. [Key Physics Constants](#key-physics-constants)
9. [Chamfer Mill Physics](#chamfer-mill-physics)
10. [Stability Advisor](#stability-advisor)
11. [Toolholder Rigidity Hierarchy](#toolholder-rigidity-hierarchy)
12. [Workholding Options](#workholding-options)
13. [EDP Catalog Enrichment](#edp-catalog-enrichment)
14. [Helix Angle Resolution](#helix-angle-resolution)
15. [WOC/DOC Optimal Button](#wocdoc-optimal-button)
16. [Access Control](#access-control)
17. [Environment Variables](#environment-variables)
18. [Development](#development)
19. [Deployment](#deployment)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, Radix UI |
| State / Data Fetching | TanStack React Query v5, Wouter routing |
| Validation | Zod (`shared/routes.ts`) — shared between frontend and backend |
| Backend | Node.js / Express 5 (TypeScript) |
| Physics Engine | Python — `legacy_engine.py` + `engine/physics.py` |
| Python Bridge | `mentor_bridge.py` — JSON stdin/stdout subprocess bridge |
| Database | PostgreSQL (Neon serverless) via Drizzle ORM |

---

## Pages

| Route | Page | Description |
|---|---|---|
| `/` | Mentor | Main machining advisor. Milling (endmill + chamfer mill), drilling, reaming, feed milling, threadmilling, keyseat, dovetail, 3D surface contouring |
| `/toolbox` | Toolbox | SKU catalog browser, EDP lookup, tool specifications with STEP file download |
| `/calculators` | Calculators | Standalone shop calculators: Speeds & Feeds, Bolt Circle (with G-code output), Chamfer Mill, Entry Load Spike, and others |
| `/admin` | Admin | Password-protected admin panel — allowlist management and domain blocklist for access control |

---

## File Structure

```
corecuttertoolapp/
├── client/src/
│   ├── pages/
│   │   ├── Mentor.tsx          # Main advisor UI (~5000+ lines)
│   │   ├── Toolbox.tsx         # SKU catalog browser
│   │   ├── Calculators.tsx     # Standalone calculators
│   │   └── Admin.tsx           # Admin access control panel
│   ├── hooks/
│   │   └── use-mentor.ts       # React Query mutation hook
│   └── components/             # Shared UI components (Radix/shadcn)
├── server/
│   ├── index.ts                # Express server + session middleware
│   └── routes.ts               # API routes, EDP catalog enrichment, OTP auth
├── shared/
│   ├── routes.ts               # Zod schemas: MentorInput, MentorResponse
│   ├── materials.ts            # Material system: ISO categories, notes, aliases, hardness ranges
│   ├── coatings.ts             # Coating definitions and compatibility rules
│   └── schema.ts               # Drizzle DB schema (skus, toolbox_sessions, toolbox_items)
├── legacy_engine.py            # Main Python calculation engine (~3500+ lines)
├── engine/physics.py           # Physics functions: deflection, force, chip thickness, thread geometry
├── mentor_bridge.py            # Python stdin/stdout JSON bridge
└── main.py                     # Python entry point
```

---

## Data Flow

```
Browser (React)
    |
    |  POST /api/mentor  { JSON payload }
    v
server/routes.ts (Express)
    |
    |  spawn python mentor_bridge.py
    |  write JSON payload to stdin
    |  env: PYTHONIOENCODING=utf-8
    v
mentor_bridge.py  -->  legacy_engine.py + engine/physics.py
    |
    |  JSON result to stdout
    v
server/routes.ts
    |  EDP catalog enrichment (PostgreSQL query)
    |  Zod response validation
    v
React Query  -->  Mentor.tsx (KPI cards, stability panel, advisory notes)
```

**Note:** `PYTHONIOENCODING=utf-8` must be set in the spawn environment. On Windows, the default `cp1252` encoding causes crashes on Unicode characters in output. `mentor_bridge.py` also reconfigures its own stdout/stderr to UTF-8 at startup.

---

## Operations Supported

### 1. Milling (Endmill)
Modes: `hem`, `trochoidal`, `traditional`, `finish`, `face`, `slot`, `circ_interp`, `surfacing`.

- HEM SFM = 2× conventional for all materials
- Chip thinning compensation applied automatically
- Variable pitch/helix multipliers applied to deflection limit
- Chipbreaker and truncated rougher geometry support with engagement-dependent force reduction
- **Machining Tips & Tricks accordion** — collapsible panel of shop-floor best practices, dynamically keyed to the active mode (different tips for HEM, Traditional, Finishing, Facing, Slotting, Circular Interpolation, and 3D Surfacing)
- `surfacing` mode drives D_eff-based RPM, scallop↔stepover conversion, and tilt angle — see [3D Surface Contouring](#9-3d-surface-contouring-ball-nose--bull-nose)

### 2. Milling (Chamfer Mill)
Series CMS (2/4 flute) and CMH (3/5 flute, 30° shear angle).

- Multi-pass strategy with rough/finish pass separation
- Saddling tip positioning guidance
- See [Chamfer Mill Physics](#chamfer-mill-physics) for full detail

### 3. Drilling
- Carbide drill with configurable point angle (default 135°)
- Peck cycle advisory (standard peck, chip-breaking peck, continuous)
- Chip thinning for drill geometry at drill point
- Step drill support (up to 3 steps)
- Drill stability output: feed status, chip evacuation status, depth-to-diameter status

### 4. Reaming
- Stock removal check (min/max/ideal stock per side)
- Pre-drill sizing advisory
- Surface finish risk assessment
- Straightness/hole quality risk
- Helix angle and coating recommendations by material
- Depth-to-diameter rating (ok / caution / warning)

### 5. Feed Milling (High-Feed Mill)
Solid carbide high-feed mill physics for Core Cutter specials. Lead angle 20°, dual-radius geometry, 4 and 5 flute, ≤52 HRC rated.

- **Lead angle chip thinning (CTF):** `programmed_FPT = actual_chip / sin(lead_angle)`. At 20°: CTF = 2.924×. Programmed FPT is always shown alongside actual chip thickness so the machinist knows what's really happening at the edge.
- **WOC default:** 8% of diameter (sweet spot 6–12%). Engine rejects user WOC > 25% — silently floors to 8%.
- **Dual-radius DOC constraint:** `max_doc = min(CR × 1.5, D × 0.15)`. Both the corner radius geometric limit and axial depth limit are enforced.
- **L/D derating:** L/D > 4 → DOC −20% / IPT −10%; L/D > 6 → DOC −35% / IPT −20%. Derate badge shown in results.
- **Axial-dominant force model:** `radial_frac = 0.15` (vs 0.30 for standard milling) — lead angle redirects force into the spindle.
- **Ramp angle limit:** `arctan(max_doc / (π × D))` — shown in results for CAM setup.
- **Coating pairing:** T-Max for ferrous (steel, stainless, HRSA); D-Max (DLC) for aluminum and non-ferrous.
- **Pro Tips panel:** Full "High-Feed Mill Advisor" — 7 sections covering chip thinning philosophy, WOC control, entry strategy, corner engagement, L/D behavior, and how to read results.
- **Machining Tips & Tricks accordion:** 11 shop-floor tips + starting parameters table by material (Steel, Stainless, Titanium, Inconel, Cast Iron, Aluminum).

### 6. Threadmilling
- UN (UNC/UNF/UNEF), Metric, NPT, NPTF thread standards
- Internal and external thread support
- Radial pass count calculation
- Spring pass recommendation
- G-code output (Fanuc and Siemens dialects)
- Deflection check at thread mill tool
- Auto cut direction (top-down/bottom-up) based on material and hole type — user can override
- Thread Details section shown before Tool Geometry (define thread requirement first)

### 7. Keyseat Milling
- Arbor/neck diameter input for two-segment deflection model
- Multi-pass axial depth strategy (pass-by-pass plan to Final Slot Depth)
- Full-slot force model (no chip thinning, 180° engagement)
- Cut Pass Depth + Final Slot Depth — required user inputs, pulse yellow when empty

### 8. Dovetail Milling
- Dovetail angle input — effective cutting diameter adjusted for angled engagement
- Lateral-entry-only model (no plunge; neck narrower than cutting head)
- Radial Pass Depth + Final Wall Depth — correct terminology for lateral engagement
- Multi-pass radial wall strategy

### 9. 3D Surface Contouring (Ball Nose / Bull Nose)
For finishing complex 3D surfaces and contoured profiles with ball nose or bull nose endmills.

- **Surface Finish Goal presets** — primary entry point: Rough (63–125 µin Ra), Semi-Finish (32–63 µin), Fine (8–32 µin), Mirror (<8 µin), Custom. Selecting a preset auto-fills the scallop height. Custom reveals the scallop/stepover toggle directly.
- **Live Ra preview** — both scallop and stepover fields show a real-time theoretical Ra estimate as you type, so machinists can relate the input to a print callout without running the full calc.
- **Input mode (secondary):** Drive by scallop height (enter target cusp height, stepover computed automatically) or drive by stepover (enter stepover directly, scallop height shown). Accessible via small toggle in the field header.
- **D_eff at contact point** — RPM and SFM are calculated at the effective cutting diameter, not the tool OD:
  - Ball nose: `D_eff = 2√(2R·ap − ap²)`
  - Bull nose (ap ≤ CR): `D_eff = (D − 2·CR) + 2√(2·CR·ap − ap²)`
- **Tool tilt angle** (ball nose only, 0–30°) — shifts the contact point away from the dead center of the ball tip, raising D_eff and effective cutting velocity. Formula: `D_eff = 2√(R² − (R·cos(θ) − ap)²)`. Live preview shows velocity gain vs. 0° baseline.
- **Scallop ↔ stepover conversion:** `ae = √(8·R·h)` / `h = ae² / (8·R)` where R is the corner radius (bull nose uses CR when ap ≤ CR)
- Chip thinning based on stepover/D_eff ratio (not WOC/OD)
- WOC/DOC inputs hidden; replaced by ap + stepover/scallop inputs
- Results display: D_eff (% of OD), scallop height (color-coded green ≤0.0005", amber >0.002"), stepover ae, step-down ap
- Print export: surfacing setup notes panel with tilt, climb milling, and semi-finish pass recommendations

---

## API Schema

Defined in `shared/routes.ts` using Zod. The full `MentorInput` and `MentorResponse` types are exported for use in both server and client code.

### Key Input Fields (`MentorInput`)

| Field | Type | Description |
|---|---|---|
| `operation` | enum | `milling`, `drilling`, `reaming`, `threadmilling`, `keyseat`, `dovetail`, `feedmill` |
| `mode` | enum | `hem`, `traditional`, `finish`, `face`, `slot`, `trochoidal`, `circ_interp`, `surfacing` |
| `lead_angle` | number | Feed mill lead angle in degrees (default 20°). Drives chip thinning factor (CTF). |
| `feedmill_doc_in` | number | Feed mill axial DOC per pass in inches (0 = auto from dual-radius constraint) |
| `surfacing_input_mode` | enum | `scallop`, `stepover` — secondary control; Surface Finish Goal presets are the primary UI |
| `surfacing_scallop_in` | number | Target scallop (cusp) height in inches — stepover computed automatically |
| `surfacing_stepover_in` | number | Lateral stepover between passes in inches |
| `surfacing_ap_in` | number | Axial step-down (ap) per pass in inches |
| `surfacing_tilt_deg` | number | Tool tilt angle in degrees (0–30°), ball nose only — raises D_eff at contact point |
| `material` | string | Material key (see material system) |
| `tool_dia` | number | Cutting diameter (inches) |
| `flutes` | number | Flute count |
| `tool_type` | enum | `endmill`, `ballnose`, `corner_radius`, `chamfer_mill` |
| `geometry` | enum | `standard`, `chipbreaker`, `truncated_rougher` |
| `variable_pitch` | boolean | Variable tooth spacing — raises chatter deflection limit ×1.50 |
| `variable_helix` | boolean | Variable helix angle — raises chatter deflection limit ×1.25 (×1.75 if both) |
| `helix_angle` | number | Helix angle in degrees (0 = use SERIES_HELIX or default 35°) |
| `shank_dia` | number | Shank/body OD — activates two-segment cantilever deflection model when > cutting dia |
| `spindle_taper` | enum | CAT30/40/50, BT30/40/50, HSK63/100, VDI30/40/50, BMT45/55/65, CAPTO C6/C8 |
| `spindle_drive` | enum | `direct`, `belt`, `gear` — drives efficiency derating |
| `toolholder` | enum | `shrink_fit`, `hydraulic`, `hp_collet`, `er_collet`, `milling_chuck`, `weldon`, `press_fit`, `capto` |
| `dual_contact` | boolean | Dual-contact spindle engagement |
| `workholding` | enum | See [Workholding Options](#workholding-options) |
| `coolant` | enum | `dry`, `mist`, `flood`, `tsc_low`, `tsc_high` |
| `woc_pct` | number | Width of cut as % of diameter |
| `doc_xd` | number | Depth of cut as multiple of diameter |
| `loc` | number | Length of cut (inches) |
| `stickout` | number | Tool stickout from holder nose (inches) |
| `machine_hp` | number | Machine nameplate horsepower |
| `max_rpm` | number | Spindle maximum RPM |
| `hardness_value` | number | Workpiece hardness (used for SFM derating) |
| `hardness_scale` | enum | `hrb`, `hrc` |

### Response Structure (`MentorResponse`)

The response is split into logical sections:

- **`customer`** — RPM, SFM, feed IPM, MRR, HP utilization, FPT, status notes
- **`engineering`** — cutting force (lbf), deflection, chip thickness, chatter index, tool life estimate
- **`stability`** — stickout, L/D ratio, deflection vs. limit (%), ordered suggestion list
- **`drilling`** — drill-specific: thrust, torque, peck schedule, stability sub-object
- **`reaming`** — reaming-specific: stock check, surface finish risk, tool life range
- **`chamfer`** — effective diameter, tip dia, depth
- **`thread_mill`** — pitch, passes, G-code, deflection check
- **`keyseat`** — DOC, multi-pass plan, tips
- **`dovetail`** — angle, DOC, multi-pass plan, lead CTF
- **`feedmill`** — lead_angle_deg, lead_ctf, programmed_fpt_in, actual_chip_in, doc_in, rec_doc_in, max_doc_in, woc_pct, woc_in, ramp_angle_max_deg, ld_ratio, ld_derated, tips[]
- **`entry_moves`** — ramp/helix entry parameters, sweep arc, straight entry IPM

---

## Material System

Defined in `shared/materials.ts` (UI) and `legacy_engine.py` (physics constants). ISO category colors match industry convention.

### ISO Categories

| ISO | Category | Color |
|---|---|---|
| N | Non-Ferrous | Green |
| P | Steel | Blue |
| M | Stainless | Yellow |
| K | Cast Iron | Red |
| S | Superalloys | Orange |
| H | Hardened Steel / Armor Plate | Grey |
| O | Plastics & Composites | Cyan |

### P — Steel

| Key | Grades | Conv. SFM | IPT_FRAC |
|---|---|---|---|
| `steel_mild` | A36, 1018, 1020, 10xx | 400 | 0.0060 |
| `steel_free` | 12L14, 1215, 1117 | 425 | 0.0070 |
| `steel_alloy` | 4130, 4140, 4340, 8620, 9310 | 350 | 0.0055 |
| `tool_steel_p20` | P20 (~30 HRC) | 300 | 0.0050 |
| `tool_steel_a2` | A2 | 240 | 0.0044 |
| `tool_steel_h13` | H13 | 220 | 0.0040 |
| `tool_steel_s7` | S7 | 240 | 0.0044 |
| `tool_steel_d2` | D2 | 180 | 0.0032 |
| `cpm_10v` | CPM 10V / A11 | 85 | — |

### M — Stainless Steel

| Key | Grades | Conv. SFM | IPT_FRAC |
|---|---|---|---|
| `stainless_fm` | 303, 416 | 290 | — |
| `stainless_ferritic` | 409, 430, 441 | 230 | — |
| `stainless_410` | 410 | 215 | — |
| `stainless_420` | 420 | 180 | — |
| `stainless_440c` | 440C | 200 | — |
| `stainless_304` | 304, 304L, 321 | 180 | 0.0035 |
| `stainless_316` | 316, 316L (Mo) | 160 | 0.0030 |
| `stainless_ph` | 17-4PH, 15-5PH, 13-8MO | 190 | 0.0035 |
| `stainless_duplex` | 2205 | 145 | — |
| `stainless_superduplex` | 2507 | 120 | — |

### K — Cast Iron

| Key | Grades | Conv. SFM |
|---|---|---|
| `cast_iron_gray` | Class 30/40, GG20/25 | 375 |
| `cast_iron_ductile` | 65-45-12, GGG-40/50 | 325 |
| `cast_iron_cgi` | GJV-300/400 | 260 |
| `cast_iron_malleable` | GTW/GTB | 275 |

### N — Non-Ferrous / Aluminum

| Key | Grades | Conv. SFM | IPT_FRAC |
|---|---|---|---|
| `aluminum_wrought` | 6061, 6082, 5052, 6xxx/5xxx | 1400 | 0.0125 |
| `aluminum_wrought_hs` | 7075, 2024, 7xxx/2xxx | 1100 | — |
| `aluminum_cast` | A356, A380, A390 | 650 | — |
| `non_ferrous` | Copper, brass, bronze | 550 | — |

### S — Superalloys / Titanium

| Key | Grades | Conv. SFM | IPT_FRAC |
|---|---|---|---|
| `titanium_cp` | Grade 1–4 | 250 | — |
| `titanium_64` | Ti-6Al-4V Grade 5 | 180 | — |
| `hiTemp_fe` | A-286, Incoloy 800 | 95 | 0.0034 |
| `hiTemp_co` | Stellite | 135 | — |
| `monel_k500` | Monel K-500 | 115 | 0.0041 |
| `inconel_625` | 625, Hastelloy C-276 | 110 | 0.0036 |
| `inconel_718` | 718, 718 Plus | 110 | 0.0032 |
| `hastelloy_x` | Hastelloy X, X-750, Nimonic C-263 | 82 | 0.0029 |
| `inconel_617` | 617, Haynes 230 | 78 | — |
| `waspaloy` | Waspaloy, René 41/77/80, Nimonic 80A/90 | 68 | 0.0024 |
| `mp35n` | MP35N, Udimet 720, René 95 | 60 | 0.0022 |

HEM SFM = 2× conventional for all superalloys. All Ni superalloy keys map to group "Inconel" and are excluded from `hardness_sfm_mult`.

### H — Hardened Steel / Armor Plate

| Key | Description | Conv. SFM |
|---|---|---|
| `hardened_lt55` | Hardened steel 35–54 HRC | 240 |
| `hardened_gt55` | Hardened steel ≥55 HRC | 100 |
| `armor_milspec` | MIL-A-12560 / MIL-A-46100 (~260–300 HB) | 240 |
| `armor_ar400` | AR400 / AR450 (~360–480 HB) | 175 |
| `armor_ar500` | AR500 / Armox 500T (~470–540 HB) | 130 |
| `armor_ar600` | AR550 / AR600 / Armox 600T (~570–640 HB) | 75 |

### O — Plastics & Composites

| Key | Description | Conv. SFM |
|---|---|---|
| `plastic_unfilled` | PEEK, POM, PA, PC, PPS, PEI | 450 |
| `plastic_filled` | GF/CF fiber-reinforced thermoplastics | 350 |
| `composite_tpc` | Continuous-fiber TPC laminates (CF-PEEK, GF-PP) | 400 |

### Material Aliases

`shared/materials.ts` exports `MATERIAL_ALIASES` — a lookup table mapping common grade names, trade names, UNS numbers, and DIN designations to material keys (e.g., `"6061-t6"` → `"aluminum_wrought"`, `"4140"` → `"steel_alloy"`). Used for instant material matching from user text input.

### Hardness Ranges

`MATERIAL_HARDNESS_RANGE` in `shared/materials.ts` defines physically plausible hardness min/max per material (with scale). The UI warns the user when an entered hardness falls outside the valid range for the selected material.

---

## Key Physics Constants

All shop-validated.

### IPT Architecture

`IPT_FRAC` stores chip load as a **fraction of diameter** (e.g., 0.0055 = 0.55%×D). Calculation: `ipt = IPT_FRAC[material] × diameter`. This ensures chip load scales correctly across all tool diameters without manual adjustment.

`HEM_IPT_MULT` applies an additional boost for HEM/trochoidal (2.0× most materials, 2.4× Inconel 718).

### Deflection Model

```
I = pi × core_dia^4 / 64          (second moment of area)
deflection = F × L^3 / (3 × E × I)

Carbide E = 90,000,000 psi
core_dia = tool_dia × core_ratio[flutes]
```

Core ratio by flute count:

| Flutes | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Core ratio | 0.58 | 0.62 | 0.66 | 0.70 | 0.74 | 0.76 | 0.78 | 0.80 | 0.82 | 0.83 | 0.84 |

When `shank_dia > cutting_dia`, a two-segment cantilever deflection model is used.

### Chip Thinning

```
factor = sin(arccos(1 - 2 × woc_pct / 100))
```

Minimum chip thinning factor: 0.25 (floor enforced by WOC Optimal button).

### Radial Force Fraction

WOC-scaled radial force fraction:
```
radial_frac = max(0.15, min(0.35, 0.15 + 0.40 × woc_pct / 100))
```

### Teeth in Cut

```
teeth = max(0.1, arc_fraction × flutes)
```

The `max(0.1, ...)` floor (not `max(1, ...)`) is intentional — the original `max(1, ...)` over-predicted force 2.8× at HEM WOC levels.

### Spindle Drive Efficiency

Applied to all three calc paths (milling, drilling, reaming):

| Drive type | Efficiency |
|---|---|
| `direct` | 0.96 |
| `belt` | 0.92 |
| `gear` | 0.88 |

KPI label shows "Avail HP" (derated available cutting HP, not nameplate).

### Helix Force Factor

| Helix angle | Force factor |
|---|---|
| 35° | 1.00 |
| 38° | 0.95 |
| 45° | 0.90 |

### Geometry Kc Factor

| Geometry | Kc factor |
|---|---|
| `standard` | 1.00 |
| `chipbreaker` | 0.80 |
| `truncated_rougher` | 0.83 |

### Holder Runout Factor

Applied to IPT (lower runout = better chip load consistency):

| Holder | Runout factor |
|---|---|
| `shrink_fit` | 1.00 |
| `capto` | 1.00 |
| `press_fit` | 0.99 |
| `hydraulic` | 0.97 |
| `hp_collet` | 0.97 |
| `milling_chuck` | 0.95 |
| `shell_mill_arbor` | 0.95 |
| `weldon` | 0.92 |
| `er_collet` | 0.90 |

---

## Chamfer Mill Physics

```
D_eff = tip_dia + 2 × depth × tan(half_angle)
cutting_edge_length = radial_reach / sin(half_angle)
max_chamfer_depth = radial_reach / tan(half_angle)
chip_thinning_factor = sin(half_angle)   -- programmed FPT ÷ sin(half_angle)
actual_woc = depth × tan(half_angle)     -- WOC grows with depth
MRR = feed × depth × woc × 0.5          -- triangular cross-section
```

**CMH series (30° shear angle):**
- SFM ×1.15 vs. CMS/baseline
- Force factor = 0.933
- Minimum chip floor: 30% of base IPT_FRAC × body_dia

**Multi-pass strategy:**
- Max rough depth per pass = body_dia × 15% × chip_room_mult (10% for hard materials)
- Chip room multiplier by flute count: {2fl: 1.35, 3fl: 1.15, 4fl: 1.00, 5fl: 0.85}

**Saddling sweet spot:**
- CMH: middle 80% of cutting edge
- CMS: middle 60% of cutting edge

---

## Stability Advisor

The stability section is split into two cards displayed below the main results:

### Setup Score card
Composite score (0–100) with four sub-scores. **Deflection overrides the label** — if deflection is ≥ 100% of the safe limit, the top label always reflects that regardless of the composite score (prevents "Moderate" showing alongside "High Chatter Risk").

| Sub-score label | What it measures |
|---|---|
| **Tool Flex** | How much the tool tip flexes under cutting force (was "Defl Score") |
| **Spindle Load** | Power draw vs. available HP (was "Mach Load") |
| **Chip Health** | Whether the tool is cutting or rubbing — chip thickness vs. minimum (was "Chip Quality") |
| **Reach** | Stickout relative to tool diameter — shorter is always stiffer (was "L/D Ratio") |

Score label priority: deflection ≥ 175% → **High Chatter Risk** (red); ≥ 100% → **Chatter Risk** (amber); otherwise composite-driven (Excellent / Good / Moderate / Caution / High Risk).

### Chatter & Vibration Check card (was "Rigidity & Chatter Audit")
Plain-language verdict + "What You Can Do" suggestions. Uses machinist-facing language throughout:

- "260% of safe limit" → **"flexing 2.6× the safe limit"**
- "L/D 3.1 (length-to-diameter ratio)" → **"Reach: 3.1× tool diameter"**
- "Setup Looks Stable" → **"Setup Looks Good"**
- "Possible Improvements" → **"What You Can Do"**

**Suggestion order when deflection > limit:**

1. **Shorten stickout** — minimum = LOC + flute_wash + 15% dia
2. **Upgrade toolholder** — next step up in rigidity hierarchy
3. **Dual contact FYI** — info note (dimmed); fires only for CAT/BT tapers when dual_contact=False
4. **Reduced-neck tool** — composite beam deflection model
5. **Reduce DOC**
6. **Reduce WOC** — only fires when WOC > 15%
7. **Shorter extension holder** — only fires when holder_gage_length is set
8. **Increase flute count** — next 1–2 steps; skipped when gain < 6%
9. **Increase tool diameter**

**Chatter thresholds:**

| Deflection | Status | Color |
|---|---|---|
| < 100% of limit | Setup Looks Good | Green |
| 100–175% of limit | Chatter Risk | Amber |
| ≥ 175% of limit | High Chatter Risk | Red |

All messages are advisory — no "do not run" language.

**Roughing geometry engagement rules:**

- **Chipbreaker**: requires ≥ 8% WOC and ≥ 1×D DOC. Below either threshold: amber warning, Low WOC button floors at 8%, chipbreaker EDPs excluded from stability suggestions.
- **Truncated Rougher (VRX)**: requires ≥ 10% WOC and ≥ 1×D DOC. Same enforcement, floors at 10%.

---

## Toolholder Rigidity Hierarchy

Rigidity factor divides tool deflection in `calc_state()`:

| Holder | Rigidity factor |
|---|---|
| `er_collet` | 1.00 (baseline) |
| `hp_collet` | 1.05 |
| `weldon` | 1.08 |
| `milling_chuck` | 1.12 |
| `hydraulic` | 1.14 |
| `press_fit` | 1.17 |
| `shrink_fit` | 1.18 |
| `capto` | 1.20 |

---

## Workholding Options

Workholding compliance multiplies chatter index. Rigidity order from most to least rigid:

`between_centers` (0.75) → `rigid_fixture` (0.80) → `tombstone` (0.82) → `collet_chuck` (0.85) → `4_jaw_chuck` (0.88) → `5th_axis_vise` (0.88) → `dovetail` (0.90) → `trunnion_4th` (0.91) → `face_plate` (0.93) → `vise` (1.00, baseline) → `3_jaw_chuck` (1.05) → `toe_clamps` (1.08) → `soft_jaws` (1.20)

| Key | Factor | Context |
|---|---|---|
| `between_centers` | 0.75 | Shaft between centers — most rigid setup possible |
| `rigid_fixture` | 0.80 | Bolted/doweled fixture plate |
| `tombstone` | 0.82 | HMC pallet tombstone |
| `collet_chuck` | 0.85 | Bar stock collet chuck |
| `4_jaw_chuck` | 0.88 | Independent 4-jaw — rigid when dialed in; mill rotary/4th-axis use |
| `5th_axis_vise` | 0.88 | Precision 5-axis vise (Mate, Schunk, etc.) |
| `dovetail` | 0.90 | Mechanical pull-out lock |
| `trunnion_4th` | 0.91 | 4th-axis trunnion with axis locked via brake |
| `face_plate` | 0.93 | Face plate with clamps |
| `vise` | 1.00 | Standard Kurt-style vise — baseline |
| `3_jaw_chuck` | 1.05 | Self-centering 3-jaw; mill rotary table / 4th-axis indexer use |
| `toe_clamps` | 1.08 | Direct clamping, some flex under radial load |
| `soft_jaws` | 1.20 | Custom soft jaws — most compliant |

**Mill context for chucks:** `3_jaw_chuck` and `4_jaw_chuck` are available on VMC/HMC machine types for rotary table, 4th-axis, and indexer setups. `trunnion_4th` covers dedicated trunnion tables where the axis locks rigid for cutting.

---

## EDP Catalog Enrichment

After the Python engine runs and before Zod validation, the Express server queries the PostgreSQL `skus` table to enrich stability suggestions with real EDP numbers.

**For flute-change suggestions (`type=tool`):**
- Query: `ILIKE derivedBase%` — matches all coating variants of the same base EDP
- Returns all EDPs at the suggested diameter, LOC, and flute count

**For diameter suggestions (`type=diameter`):**
- Full query: flutes + diameter + corner condition + closest LOC (subquery)
- Returns all EDPs at the closest available LOC

**Returns:**
- `suggested_edps[]` — full array, displayed comma-separated in the UI (yellow)
- `suggested_edp` — first item (legacy compatibility)

**Geometry exclusion rules applied to EDP queries:**
- Chipbreaker excluded when `woc_pct < 8` OR `doc_xd < 1.0`
- Truncated rougher excluded when `woc_pct < 10` OR `doc_xd < 1.0`

---

## Helix Angle Resolution

Priority chain:

1. `payload.helix_angle` (from SKU upload column — takes precedence)
2. `SERIES_HELIX[tool_series]` lookup table
3. Default: 35°

**SERIES_HELIX table:**

| Series | Helix |
|---|---|
| AL2 | 45° |
| AL3 | 37° |
| FEM5 | 45° |
| QTR3 | 41° (variable 40/41/42°; use 41 avg; `variable_helix=true` captures stability benefit) |
| VST4 | 38° |
| VST5 | 39° |
| VST6 | 37° |
| VMF7 / VMF9 / VMF11 | 38° |
| VXR4 | 42° |
| VXR5 | 39° |

---

## WOC/DOC Optimal Button

Physics-based optimal engagement calculation — not a MRR-balance formula.

- Uses ISO-category + flute-count aware WOC/DOC target
- Validates chip thinning floor: `sin(arccos(1 - 2 × WOC/100)) >= 0.25`
- Live display below WOC field (always visible when WOC + flutes are set):
  - Engagement angle (degrees)
  - Chip thinning % (green < 55%, amber 30–55%, red < 30%)
  - Teeth in cut

---

## Access Control

The Toolbox and Customer mode require authentication via OTP email.

- **Allowlist**: approved emails receive OTP codes via email
- **Domain blocklist**: entire domains can be blocked at the OTP delivery step
- **Active sessions view**: admin can see active sessions and force-logout any user
- **Admin panel**: password-protected via `ADMIN_PASSWORD` environment variable

Database tables: `toolbox_sessions` (email, token, OTP), `toolbox_items` (saved results per user).

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `ADMIN_PASSWORD` | Admin panel access password |
| `ENG_PASSWORD` | Engineering mode password |
| `ANTHROPIC_API_KEY` | Claude Vision API key for CC print PDF extraction |
| `PYTHONIOENCODING` | Set to `utf-8` — required for Windows cp1252 compatibility |
| SMTP credentials | For OTP email delivery (nodemailer) |

---

## Development

```bash
npm install
npm run dev      # starts Express + Vite concurrently (via concurrently)
```

The Python engine runs as a subprocess of Express — no separate Python server process is needed. Each API request spawns a new `mentor_bridge.py` process, writes the payload to stdin, and reads JSON from stdout.

**Python dependency:** stdlib only (`math`, `sys`, `json`). No pip install required.

---

## Deployment

Production at [corecutcnc.com](https://corecutcnc.com) — hosted on Replit Autoscale Deployments.

**Deploy steps:**
1. Push changes from VS Code: `git push origin main`
2. In Replit shell: `git fetch origin && git reset --hard origin/main`
3. Click **Republish** in the Replit Deployments tab

The Express server serves the compiled React frontend as static files in production. Replit Deployments runs the build (`npm run build`) and starts the server (`node dist/index.cjs`) automatically on republish.
