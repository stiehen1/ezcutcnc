# CoreCutCNC — Machining Mentor by Core Cutter LLC

A full-stack Machining Mentor for CNC shops and sales engineers. Calculates speeds, feeds, depths of cut, cutting forces, deflection, stability, and tooling recommendations across milling, drilling, reaming, feed milling, threadmilling, keyseat, and dovetail operations. Deployed at [corecutcnc.com](https://corecutcnc.com).

Each operation includes a **Pro Tips panel** (how to use the app) and a collapsible **Machining Tips & Tricks accordion** (shop-floor best practices per operation type).

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Pages](#pages)
3. [File Structure](#file-structure)
4. [Data Flow](#data-flow)
5. [Operations Supported](#operations-supported)
6. [ROI Calculator](#roi-calculator)
7. [API Schema](#api-schema)
8. [Material System](#material-system)
9. [Key Physics Constants](#key-physics-constants)
10. [Chamfer Mill Physics](#chamfer-mill-physics)
11. [Stability Mentor](#stability-mentor)
12. [Toolholder Rigidity Hierarchy](#toolholder-rigidity-hierarchy)
13. [Workholding Options](#workholding-options)
14. [EDP Catalog Enrichment](#edp-catalog-enrichment)
15. [Helix Angle Resolution](#helix-angle-resolution)
16. [WOC/DOC Optimal Button](#wocdoc-optimal-button)
17. [Access Control](#access-control)
18. [Environment Variables](#environment-variables)
19. [Development](#development)
20. [Deployment](#deployment)

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
| Database | PostgreSQL (Neon serverless) via `pg` pool |

---

## Pages

| Route | Page | Description |
|---|---|---|
| `/` | Mentor | Main Machining Mentor. Milling (endmill + chamfer mill), drilling, reaming, feed milling, threadmilling, keyseat, dovetail, 3D surface contouring. Also contains the ROI Calculator panel. |
| `/toolbox` | Toolbox | SKU catalog browser, EDP lookup, tool specifications, saved ROI comparisons with Load-back support |
| `/calculators` | Calculators | Standalone shop calculators: Speeds & Feeds, Bolt Circle (with G-code output), Chamfer Mill, Entry Load Spike, and others |
| `/admin` | Admin | Password-protected admin panel — allowlist management and domain blocklist for access control |

---

## File Structure

```
corecuttertoolapp/
├── client/src/
│   ├── pages/
│   │   ├── Mentor.tsx          # Main mentor UI (~10,000+ lines)
│   │   ├── Toolbox.tsx         # SKU catalog browser + saved ROI list
│   │   ├── Calculators.tsx     # Standalone calculators
│   │   └── Admin.tsx           # Admin access control panel
│   ├── hooks/
│   │   └── use-mentor.ts       # React Query mutation hook
│   └── components/             # Shared UI components (Radix/shadcn)
├── server/
│   ├── index.ts                # Express server + session middleware
│   └── routes.ts               # API routes, EDP catalog enrichment, OTP auth, ROI upsert
├── shared/
│   ├── routes.ts               # Zod schemas: MentorInput, MentorResponse
│   ├── materials.ts            # Material system: ISO categories, notes, aliases, hardness ranges
│   ├── coatings.ts             # Coating definitions and compatibility rules
│   └── schema.ts               # Drizzle DB schema
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
- Variable pitch/helix multipliers applied to deflection limit (×1.50 / ×1.25 / ×1.75 combined)
- Chipbreaker and truncated rougher geometry support with engagement-dependent force reduction
- Roughing geometry engagement rules: chipbreaker requires ≥8% WOC + ≥1×D DOC; truncated rougher requires ≥10% WOC + ≥1×D DOC — warnings shown and EDPs excluded from stability suggestions below these thresholds
- **Machining Tips & Tricks accordion** — collapsible panel of shop-floor best practices, dynamically keyed to the active mode

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

- **Lead angle chip thinning (CTF):** `programmed_FPT = actual_chip / sin(lead_angle)`. At 20°: CTF = 2.924×
- **WOC default:** 8% of diameter (sweet spot 6–12%). Engine rejects user WOC > 25% — silently floors to 8%
- **Dual-radius DOC constraint:** `max_doc = min(CR × 1.5, D × 0.15)`
- **L/D derating:** L/D > 4 → DOC −20% / IPT −10%; L/D > 6 → DOC −35% / IPT −20%
- **Axial-dominant force model:** `radial_frac = 0.15` (vs 0.30 for standard milling)
- **Ramp angle limit:** `arctan(max_doc / (π × D))` — shown in results for CAM setup
- **Coating pairing:** T-Max for ferrous; D-Max (DLC) for aluminum and non-ferrous

### 6. Threadmilling
- UN (UNC/UNF/UNEF), Metric, NPT, NPTF thread standards
- Internal and external thread support
- Radial pass count calculation
- Spring pass recommendation
- G-code output (Fanuc and Siemens dialects)
- Deflection check at thread mill tool
- Auto cut direction (top-down/bottom-up) based on material and hole type

### 7. Keyseat Milling
- Arbor/neck diameter input for two-segment deflection model
- Multi-pass axial depth strategy (pass-by-pass plan to Final Slot Depth)
- Full-slot force model (no chip thinning, 180° engagement)

### 8. Dovetail Milling
- Dovetail angle input — effective cutting diameter adjusted for angled engagement
- Lateral-entry-only model (no plunge)
- Multi-pass radial wall strategy

### 9. 3D Surface Contouring (Ball Nose / Bull Nose)
For finishing complex 3D surfaces and contoured profiles.

- **Surface Finish Goal presets** — Rough (63–125 µin Ra), Semi-Finish (32–63 µin), Fine (8–32 µin), Mirror (<8 µin), Custom
- **Live Ra preview** — scallop and stepover fields show real-time theoretical Ra estimate as you type
- **D_eff at contact point** — RPM and SFM calculated at effective cutting diameter, not tool OD
  - Ball nose: `D_eff = 2√(2R·ap − ap²)`
  - Bull nose (ap ≤ CR): `D_eff = (D − 2·CR) + 2√(2·CR·ap − ap²)`
- **Tool tilt angle** (ball nose only, 0–30°) — raises D_eff and effective cutting velocity
- **Scallop ↔ stepover conversion:** `ae = √(8·R·h)` / `h = ae² / (8·R)`

---

## ROI Calculator

Built into the Mentor page as a collapsible panel. Designed for sales engineers to quickly build a cost-per-unit comparison between Core Cutter tooling and an incumbent competitor.

### Measurement Modes

Three self-contained modes — pick whichever metric the customer tracks:

| Mode | Entry | Annual Volume Field |
|---|---|---|
| Parts per Tool | Number of parts per tool life | Parts/year |
| Cut Time per Tool | Minutes of cut time per tool life | Cutting hours/year |
| Linear Inches per Tool | Linear inches per tool life | Linear inches/year |

Each mode computes cost per native unit ($/part, $/min, $/inch) without time-per-part conversion. Annual savings = (comp total cost − CC total cost) × annual units.

### Cost Components

- **Tool cost per unit** — price ÷ tool life units (with reconditioning lifecycle compounding if enabled)
- **Changeover cost per unit** — `(1/N) × change_time_min × shop_rate/60` (applied to both sides — more tool life = fewer changeovers)
- **Additional Savings** — itemized recurring or one-time savings (scrap reduction, downtime elimination, tool consolidation, etc.)

### Reconditioning Program Option

When enabled: configurable grind count (up to 5) and retention % per regrind. Lifecycle cost compounds across all grinds. Reconditioning savings per unit shown separately in results.

### Saved ROIs (Toolbox)

- Every Calculate click upserts the ROI to the database (one row per email + CC EDP + material)
- **ROI Name field** — label each comparison (e.g. "Acme Corp – 4140 Roughing") for easy retrieval
- Toolbox page shows all saved ROIs by name with annual savings, material, and date
- **Load button** on each saved ROI restores incumbent fields and navigates back to the Mentor page

### DB Columns (`roi_comparisons`)

`user_email`, `user_name`, `material`, `operation`, `tool_dia`, `feed_ipm`, `cc_edp`, `cc_tool_price`, `cc_parts_per_tool`, `cc_time_in_cut`, `cc_mrr`, `comp_edp`, `comp_brand`, `comp_price`, `comp_parts_per_tool`, `comp_time_in_cut`, `comp_mrr`, `shop_rate`, `annual_volume`, `monthly_volume`, `savings_per_part`, `monthly_savings`, `annual_savings`, `savings_pct`, `mrr_gain_pct`, `recon_grinds`, `recon_savings_per_part`, `one_time_savings`, `roi_name`, `city`, `region`, `country`, `ip`, `updated_at`, `emailed_at`

---

## API Schema

Defined in `shared/routes.ts` using Zod. The full `MentorInput` and `MentorResponse` types are exported for use in both server and client code.

### Key Input Fields (`MentorInput`)

| Field | Type | Description |
|---|---|---|
| `operation` | enum | `milling`, `drilling`, `reaming`, `threadmilling`, `keyseat`, `dovetail`, `feedmill` |
| `mode` | enum | `hem`, `traditional`, `finish`, `face`, `slot`, `trochoidal`, `circ_interp`, `surfacing` |
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
| `spindle_drive` | enum | `direct`, `belt`, `gear` — drives efficiency derating (0.96/0.92/0.88) |
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

- **`customer`** — RPM, SFM, feed IPM, MRR, HP utilization, FPT, status notes
- **`engineering`** — cutting force (lbf), deflection, chip thickness, chatter index, tool life estimate
- **`stability`** — stickout, L/D ratio, deflection vs. limit (%), ordered suggestion list
- **`drilling`** — thrust, torque, peck schedule, stability sub-object
- **`reaming`** — stock check, surface finish risk, tool life range
- **`chamfer`** — effective diameter, tip dia, depth
- **`thread_mill`** — pitch, passes, G-code, deflection check
- **`keyseat`** — DOC, multi-pass plan, tips
- **`dovetail`** — angle, DOC, multi-pass plan, lead CTF
- **`feedmill`** — lead_angle_deg, lead_ctf, programmed_fpt_in, actual_chip_in, doc_in, woc_pct, ramp_angle_max_deg, ld_ratio, ld_derated, tips[]
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
| H | Hardened Steel | Grey |
| O | Plastics & Composites | Cyan |

### P — Steel

| Key | Grades | Conv. SFM | IPT_FRAC |
|---|---|---|---|
| `steel_mild` | A36, 1018, 1020 | 400 | 0.0060 |
| `steel_free` | 12L14, 1215, 1117 | 425 | 0.0070 |
| `steel_alloy` | 4130, 4140, 4340 | 350 | 0.0055 |
| `tool_steel_p20` | P20 (~30 HRC) | 300 | 0.0050 |
| `tool_steel_a2` | A2 | 240 | 0.0044 |
| `tool_steel_h13` | H13 | 220 | 0.0040 |
| `tool_steel_s7` | S7 | 240 | 0.0044 |
| `tool_steel_d2` | D2 | 180 | 0.0032 |

### M — Stainless Steel

| Key | Grades | Conv. SFM | IPT_FRAC |
|---|---|---|---|
| `stainless_fm` | 303, 416 (free machining) | 290 | 0.0042 |
| `stainless_ferritic` | 409, 430, 441 | 230 | 0.0038 |
| `stainless_410` | 410 | 215 | 0.0036 |
| `stainless_420` | 420 | 200 | 0.0034 |
| `stainless_440c` | 440C | 170 | 0.0030 |
| `stainless_304` | 304, 304L | 180 | 0.0035 |
| `stainless_316` | 316, 316L | 160 | 0.0030 |
| `stainless_ph` | 17-4 PH, 15-5 PH | 190 | 0.0035 |
| `stainless_duplex` | 2205 | 140 | 0.0028 |
| `stainless_superduplex` | 2507 | 110 | 0.0024 |

### S — Superalloys (Ni/Co)

| Key | Grades | Conv. SFM | IPT_FRAC |
|---|---|---|---|
| `inconel_718` | Inconel 718 | 110 | 0.0032 |
| `inconel_625` | Inconel 625 | 110 | 0.0036 |
| `hastelloy_x` | Hastelloy X | 82 | 0.0029 |
| `waspaloy` | Waspaloy | 68 | 0.0024 |
| `mp35n` | MP35N | 60 | 0.0022 |
| `monel_k500` | Monel K-500 | 115 | 0.0041 |
| `hiTemp_fe` | A-286 (Fe-based) | 95 | 0.0034 |
| `hiTemp_co` | Stellite (Co-based) | 135 | — |

HEM SFM = 2× conventional for all superalloys. All Ni-based keys are excluded from `hardness_sfm_mult`.

### H — Hardened Steel

| Key | Description | Conv. SFM | IPT_FRAC |
|---|---|---|---|
| `hardened_lt55` | Generic hardened, < 55 HRC | 240 | 0.0045 |
| `hardened_gt55` | Generic hardened, ≥ 55 HRC | 100 | 0.0012 |

---

## Key Physics Constants

### IPT Architecture

`IPT_FRAC` dict stores chip load as **fraction of diameter** (e.g., `0.0055` = 0.55%×D).

```python
ipt = IPT_FRAC[mat] * diameter
```

Scales correctly across all tool sizes. `HEM_IPT_MULT` applies an additional HEM boost (2.0× most materials, 1.8× Inconel).

### HEM SFM
HEM SFM = **2× conventional** for all materials.

### Spindle Drive Efficiency

| Drive | Efficiency |
|---|---|
| Direct | 0.96 |
| Belt | 0.92 |
| Gear | 0.88 |

Applied to all three calc paths (milling, drilling, reaming). KPI label: "Avail HP" (derated available cutting HP).

### Stability Force Model

- `teeth = max(0.1, arc_fraction × flutes)` — WOC-proportional tooth engagement, no wrong clamping at HEM WOC
- `radial_frac = max(0.15, min(0.35, 0.15 + 0.40 × woc_pct/100))` — WOC-scaled radial force fraction
- `HELIX_FORCE_FACTOR`: {35°: 1.00, 38°: 0.95, 45°: 0.90}

### Geometry Force Multipliers (Kc)

| Geometry | Kc multiplier |
|---|---|
| Standard | 1.00 |
| Chipbreaker | ~0.80 (−20%) |
| Truncated Rougher | ~0.83 (−17%) |

---

## Chamfer Mill Physics

Series CMS (2/4 flute, 0° shear) and CMH (3/5 flute, 30° shear angle).

- Effective cutting diameter computed from chamfer angle and contact depth
- Multi-pass rough/finish separation
- Tip diameter and saddling guidance
- SFM calculated at effective diameter (not shank OD)

---

## Stability Mentor

### Thresholds (Mentor.tsx)

| Deflection % | Status |
|---|---|
| < 100% | "Setup Looks Stable" (green) |
| 100–175% | "Chatter Risk" (yellow) |
| ≥ 175% | "High Chatter Risk" (red) |

Messages are advisory only — no "do not run" language.

### Suggestion Order

1. Reduce stickout (floor = LOC + flute_wash + 15%×dia)
2. Upgrade toolholder
3. Dual contact FYI note (info type, dimmed) — only fires when deflection > limit AND dual_contact=False AND taper is CAT/BT
4. Reduced-neck tool (composite beam model)
5. Reduce DOC
6. Reduce WOC (>15% only)
7. Shorter extension holder (if holder_gage_length set)
7b. Increase flute count (next 1–2 steps, skipped if gain <6%)
8. Increase tool diameter

### Variable Pitch/Helix Multipliers

| Configuration | Deflection limit multiplier |
|---|---|
| Variable pitch only | ×1.50 |
| Variable helix only | ×1.25 |
| Both | ×1.75 |

---

## Toolholder Rigidity Hierarchy

| Holder | Rigidity Factor |
|---|---|
| ER Collet | 1.00 |
| HP Collet | 1.05 |
| Weldon | 1.08 |
| Milling Chuck | 1.12 |
| Hydraulic | 1.14 |
| Press Fit | 1.17 |
| Shrink Fit | 1.18 |
| Capto | 1.20 |

Rigidity factor divides deflection in `calc_state()`.

---

## Workholding Options

Vise, 3-jaw chuck, collet fixture, angle plate, magnetic chuck, tombstone, pallet fixture, and custom. Rigidity multiplier applied to deflection limit based on workholding type.

---

## EDP Catalog Enrichment

Runs in `server/routes.ts` after the Python engine returns results and before Zod validation. Queries the SKU catalog to surface relevant tool suggestions in the Stability Mentor.

- **Flute change suggestions** (`type=tool`): ILIKE match on `derivedBase%` (first-digit replacement, all coating variants)
- **Diameter change suggestions** (`type=diameter`): full query — flutes + dia + corner + closest LOC subquery; returns all EDPs at that LOC
- Returns `suggested_edps[]` array + `suggested_edp` (first); UI displays all comma-separated in yellow
- **Roughing geometry exclusion:** when `woc_pct < 8` OR `doc_xd < 1.0`, chipbreaker excluded; when `woc_pct < 10` OR `doc_xd < 1.0`, truncated_rougher also excluded
- `lookup_loc` present on both flute and diameter suggestions

---

## Helix Angle Resolution

Priority chain in `legacy_engine.py`:

1. `payload["helix_angle"]` (from SKU column)
2. `SERIES_HELIX[tool_series]` lookup
3. Default: 35°

### SERIES_HELIX Table

| Series | Helix |
|---|---|
| AL2 | 45° |
| AL3 | 37° |
| FEM5 | 45° |
| QTR3 | 41° (avg of 40/41/42) |
| VST4 | 38° |
| VST5 | 39° |
| VST6 | 37° |
| VMF7/9/11 | 38° |
| VXR4 | 42° |
| VXR5 | 39° |

---

## WOC/DOC Optimal Button

Appears in HEM and Traditional modes. Sets WOC and DOC to physics-optimal values for the selected material and tool geometry. HEM defaults to ~3% WOC for superalloys, 8–15% for steel/stainless.

---

## Access Control

Two-tier system:

1. **Allowlist** — specific emails granted access (managed in `/admin`)
2. **Domain blocklist** — blocks entire email domains (e.g., competitor domains)

OTP email verification via SMTP (Brevo) for Toolbox login.

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `SMTP_USER` | SMTP username (Brevo) |
| `SMTP_PASS` | SMTP password |
| `SMTP_HOST` | SMTP host (default: `smtp-relay.brevo.com`) |
| `SMTP_FROM` | From address for OTP emails |
| `ROI_EMAIL_TO` | Recipient for ROI email submissions |
| `ADMIN_PASSWORD` | Admin panel password |
| `PYTHONIOENCODING` | Must be `utf-8` (set automatically in spawn env) |

---

## Development

```bash
npm install
npm run dev       # starts Express + Vite dev server on port 5000
```

The `dev` script uses `tsx` with hot reload — no build step needed during development.

Python dependencies: none beyond stdlib. The physics engine runs as a subprocess.

---

## Deployment (Replit)

```bash
git pull
npm run build     # compiles Vite frontend + bundles server to dist/index.cjs
npm run start     # NODE_ENV=production node dist/index.cjs
```

If port 5000 is already in use (previous process still running):

```bash
fuser -k 5000/tcp && npm run start
```

DB migrations run automatically on server startup via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
