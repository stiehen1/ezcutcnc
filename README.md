# EZCutCNC — Machining Advisor by Core Cutter LLC

A full-stack machining advisor for CNC shops. Calculates speeds, feeds, depths of cut, deflection, stability, and tooling recommendations across milling, drilling, reaming, feed milling, and threadmilling. Deployed at [corecuttertool.com](https://corecuttertool.com).

Two access modes: **Customer mode** (requires an EDP# or Core Cutter print PDF) and **Engineering mode** (unrestricted parameter input).

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
| `/` | Mentor | Main machining advisor. Milling (endmill + chamfer mill), drilling, reaming, feed milling, threadmilling |
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
Modes: HEM/trochoidal, traditional, finish, face, slot, circular interpolation.

- HEM SFM = 2x conventional for all materials
- Chip thinning compensation applied automatically
- Variable pitch/helix multipliers applied to deflection limit
- Chipbreaker and truncated rougher geometry support with engagement-dependent force reduction

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

### 5. Feed Milling
High-feed mill specific physics (chip thinning from lead angle, axial force component).

### 6. Threadmilling
- UN (UNC/UNF/UNEF), Metric, NPT, NPTF thread standards
- Internal and external thread support
- Radial pass count calculation
- Spring pass recommendation
- G-code output (Fanuc and Siemens dialects)
- Deflection check at thread mill tool

### 7. Keyseat Milling
- Arbor diameter input
- Multi-pass DOC strategy
- Chip room / engagement guidance

### 8. Dovetail Milling
- Dovetail angle input
- Lead cutting force factor (CTF)
- Multi-pass DOC strategy

---

## API Schema

Defined in `shared/routes.ts` using Zod. The full `MentorInput` and `MentorResponse` types are exported for use in both server and client code.

### Key Input Fields (`MentorInput`)

| Field | Type | Description |
|---|---|---|
| `operation` | enum | `milling`, `drilling`, `reaming`, `threadmilling`, `keyseat`, `dovetail` |
| `mode` | enum | `hem`, `traditional`, `finish`, `face`, `slot`, `trochoidal`, `circ_interp` |
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

When `deflection > limit`, suggestions are presented in this order:

1. **Reduce stickout** — minimum = LOC + flute_wash + 15% dia
2. **Upgrade toolholder** — next step up in rigidity hierarchy
3. **Dual contact FYI** — info note (dimmed); fires only for CAT/BT tapers when dual_contact=False
4. **Reduced-neck tool** — composite beam deflection model
5. **Reduce DOC**
6. **Reduce WOC** — only fires when WOC > 15%
7. **Shorter extension holder** — only fires when holder_gage_length is set
8. **Increase flute count** — next 1–2 steps; skipped when gain < 6%
9. **Increase tool diameter**

**Chatter thresholds (Mentor.tsx):**

| Deflection % | Status |
|---|---|
| < 100% | Setup Looks Stable (green) |
| 100–175% | Chatter Risk (amber) |
| ≥ 175% | High Chatter Risk (red) |

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

`between_centers` (0.75) → `rigid_fixture` (0.80) → `tombstone` (0.82) → `collet_chuck` (0.85) → `4_jaw_chuck` (0.88) → `5th_axis_vise` (0.88) → `dovetail` (0.90) → `face_plate` (0.93) → `vise` (1.00, baseline) → `3_jaw_chuck` (1.05) → `soft_jaws` (1.20)

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

Production at [corecuttertool.com](https://corecuttertool.com).

```bash
git pull
npm run build    # compile React frontend to dist/
# restart server: pm2 restart / npm start
```

The Express server serves the compiled React frontend as static files in production.
