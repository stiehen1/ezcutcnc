# Core Cutter Tool App — Machining Mentor

A full-stack application that calculates optimal cutting speeds, feeds, and depths of cut for CNC milling operations. The system combines a React/TypeScript frontend with a Python physics engine to deliver physics-based recommendations across multiple machining strategies.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [File Structure](#file-structure)
3. [Data Flow](#data-flow)
4. [User Inputs & Outputs](#user-inputs--outputs)
5. [Machining Modes](#machining-modes)
6. [Calculation Reference](#calculation-reference)
   - [Surface Speed (SFM) & RPM](#1-surface-speed-sfm--rpm)
   - [Chipload (IPT)](#2-chipload-ipt)
   - [Chip Thinning Adjustment](#3-chip-thinning-adjustment)
   - [Feed Rate (IPM)](#4-feed-rate-ipm)
   - [Material Removal Rate (MRR)](#5-material-removal-rate-mrr)
   - [Cutting Force](#6-cutting-force)
   - [Tool Deflection](#7-tool-deflection)
   - [Horsepower & Spindle Load](#8-horsepower--spindle-load)
   - [Minimum Chip Thickness / Rub Check](#9-minimum-chip-thickness--rub-check)
   - [Tool Life Estimate](#10-tool-life-estimate)
7. [HEM Optimizer](#hem-optimizer)
8. [Material Constants Reference](#material-constants-reference)
9. [Advisories & Warnings](#advisories--warnings)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, Radix UI |
| State / Data Fetching | TanStack React Query v5, Zod validation |
| Routing | Wouter |
| Backend | Express.js 5 (TypeScript) |
| Calculation Engine | Python (stdlib only — `math` module) |
| Database | PostgreSQL via Drizzle ORM |

---

## File Structure

```
corecuttertoolapp/
├── client/
│   └── src/
│       ├── pages/
│       │   └── Mentor.tsx          # Main UI: input form + output cards
│       └── hooks/
│           └── use-mentor.ts       # React Query mutation for API calls
│
├── server/
│   ├── index.ts                    # Express server setup
│   └── routes.ts                   # POST /api/mentor endpoint (spawns Python)
│
├── shared/
│   ├── routes.ts                   # Zod schemas for API request/response
│   └── schema.ts                   # Drizzle DB schema (snippets table)
│
├── engine/
│   └── physics.py                  # Physics calculations: force, deflection,
│                                   #   chip thickness, mode defaults
│
├── legacy_engine.py                # Main calculation orchestrator (~2000 lines)
│                                   #   Includes HEM optimizer grid search
├── mentor_bridge.py                # JSON stdin/stdout bridge (Node ↔ Python)
├── main.py                         # Python entry point
└── inspect_excel.py                # Utility: reads Excel tool registry
```

**`attached_assets/`** — Excel spreadsheet containing the tool catalog:
- Columns: `Core_Cutter_EDP`, `CORE_CUTTER_SERIES`, `CUT_DIA`, `FLUTE_COUNT`, `LOC`, `COATING`

---

## Data Flow

```
Browser (React)
    │
    │  POST /api/mentor  { JSON payload }
    ▼
Express.js (server/routes.ts)
    │
    │  spawn("python mentor_bridge.py")
    │  write JSON to stdin
    ▼
mentor_bridge.py
    │
    │  legacy_engine.run(payload)
    ▼
legacy_engine.py + engine/physics.py
    │  (all calculations performed here)
    │
    │  returns JSON to stdout
    ▼
Express.js
    │  validates with Zod, computes HP utilization
    │
    │  JSON response
    ▼
React Query → Mentor.tsx (KPI cards, charts, advisories)
```

---

## User Inputs & Outputs

### Inputs (sent to `/api/mentor`)

| Parameter | Type | Description |
|---|---|---|
| `mode` | `"hem" \| "finish" \| "slot"` | Machining strategy |
| `material` | string | Work material (see constants table) |
| `tool_dia` | number | Tool diameter (inches) |
| `flutes` | number | Flute count (2–7) |
| `toolholder` | string | `standard`, `hydraulic`, `shrink`, `shell` |
| `dual_contact` | boolean | Dual-contact toolholder |
| `max_rpm` | number | Spindle maximum RPM |
| `rpm_util_pct` | number | RPM utilization factor (0.0–1.0) |
| `woc_pct` | number | Width of cut as % of diameter |
| `doc_xd` | number | Depth of cut as multiple of diameter |
| `machine_hp` | number | Available machine horsepower |
| `stickout` | number | Tool projection / gauge length (inches) |
| `coolant` | `"flood" \| "air" \| "dry"` | Coolant strategy |
| `deflection_limit` | number | Maximum allowable deflection (inches) |
| `hem_rub_min` | number | Minimum rub-ratio threshold |

### Outputs

**Customer-facing:**

| Field | Description |
|---|---|
| `rpm` | Calculated spindle speed |
| `sfm` / `sfm_target` | Actual and target surface feet per minute |
| `feed_ipm` | Feed rate in inches per minute |
| `doc_in` | Depth of cut (inches) |
| `woc_in` | Width of cut (inches) |
| `mrr_in3_min` | Material removal rate (in³/min) |
| `spindle_load_pct` | HP used / machine HP (0.0–1.0) |
| `hp_required` | Power draw (HP) |
| `hp_margin_hp` | Remaining HP headroom |

**Engineering detail:**

| Field | Description |
|---|---|
| `force_lbf` | Tangential cutting force (lbf) |
| `deflection_in` | Tool tip deflection (inches) |
| `chip_thickness_in` | Effective chip thickness (inches) |
| `chatter_index` | Relative chatter risk indicator |
| `tool_life_min` | Estimated tool life (minutes) |

---

## Machining Modes

The mode sets default WOC and DOC starting points. These are further adjusted per material.

| Mode | WOC (% dia) | DOC (× dia) | Intent |
|---|---|---|---|
| `hem` | 10–14% | 1.5–2.0× | High Efficiency Milling — high axial, low radial |
| `finish` | 3% | 0.25× | Light pass for dimensional accuracy |
| `slot` | 100% | 0.5× | Full radial engagement (slotting) |
| `profile` | 6% | 1.0× | Side milling / profiling |
| `face` | 60% | 0.10× | Face milling |

**Material-specific HEM defaults:**

| Material | WOC | DOC |
|---|---|---|
| Aluminum | 14% | 2.0× dia |
| Steel | 10% | 1.5× dia |
| Stainless | 8% | 1.25× dia |
| Titanium | 6% | 1.0× dia |
| Inconel / HRSA | 5% | 0.75× dia |

---

## Calculation Reference

### 1. Surface Speed (SFM) & RPM

**Base SFM** is looked up from material constants, then boosted for HEM:

```
SFM_target = BASE_SFM[material]

if mode == "hem":
    SFM_target × 1.5

target_rpm = (SFM_target × 3.82) / tool_diameter

rpm = min(target_rpm,  max_rpm × rpm_util_pct)

sfm_actual = (rpm × tool_diameter) / 3.82
```

> The constant `3.82 = 12 / π`, converting between feet/min and rev/min for diameter in inches.

---

### 2. Chipload (IPT)

Base chipload (inches per tooth) is looked up from material constants:

```
ipt = IPT_BASE[material]
```

Then adjusted for chip thinning (see below).

---

### 3. Chip Thinning Adjustment

When radial engagement (WOC) is less than 50% of tool diameter, the effective chip thickness is reduced. A chip thinning factor compensates so the actual chip thickness target is maintained:

```
if woc < 0.5 × diameter:
    chip_factor = sqrt(diameter / woc)
else:
    chip_factor = 1.0

ipt_adjusted = IPT_BASE[material] × chip_factor
```

**Ball-nose tools** use effective cutting diameter at the programmed depth:

```
R = diameter / 2
D_eff  = 2 × sqrt(2×R×doc − doc²)
cos_φ  = 1 − doc / R
chip_factor = sin(acos(cos_φ))
h_eff  = ipt × chip_factor
```

---

### 4. Feed Rate (IPM)

```
feed_ipm = rpm × flutes × ipt_adjusted
```

---

### 5. Material Removal Rate (MRR)

```
mrr = feed_ipm × doc × woc          (in³/min)
```

---

### 6. Cutting Force

**Effective chip thickness** accounts for radial engagement geometry:

```
h_eff = ipt_adjusted × sqrt(woc / diameter)   (for woc < 0.5 × dia)
```

**Tangential force per tooth:**

```
force_per_tooth = K[material] × h_eff × HELIX_FACTOR[helix_angle]
```

| Helix angle | Force factor |
|---|---|
| 35° | 1.00 |
| 38° | 0.95 |
| 45° | 0.90 |

**Total cutting force** (using teeth engaged):

```
total_force = force_per_tooth × doc × teeth_engaged
radial_force = total_force × 0.30        (component driving deflection)
```

---

### 7. Tool Deflection

Models the tool as a cantilevered beam. Carbide modulus of elasticity: **90,000,000 psi**.

```
core_ratio = { 2F: 0.60, 3F: 0.65, 4F: 0.70, 5F: 0.75, 6F: 0.80, 7F: 0.82 }
core_dia   = tool_diameter × core_ratio[flutes]

I = π × core_dia⁴ / 64                 (second moment of area, in⁴)

deflection = (radial_force × stickout³) / (3 × E × I)
```

> Deflection scales with **stickout³** — halving stickout reduces deflection by **8×**.

---

### 8. Horsepower & Spindle Load

```
hp_required   = mrr × HP_PER_CUIN[material]
spindle_load  = hp_required / machine_hp       (0.0 – 1.0)
hp_margin     = machine_hp − hp_required
hp_util_pct   = hp_required / machine_hp × 100
```

---

### 9. Minimum Chip Thickness / Rub Check

Each material has a minimum chip thickness below which rubbing (not cutting) occurs:

| Material | h_min (inches) |
|---|---|
| Inconel | 0.0003 |
| Titanium | 0.00025 |
| Stainless / Steel | 0.0002 |
| All others | 0.00015 |

```
rub_ratio = chip_thickness / h_min
```

**Warning threshold:** `rub_ratio < 1.20` → rubbing risk flagged.

---

### 10. Tool Life Estimate

```
base_life = 45 min   (steel/stainless)
           120 min   (all other materials)

coating_factor  = 1.20
coolant_factor  = { flood: 1.25,  air: 1.10,  dry: 0.85 }
load_factor     = max(0.40,  1.20 − spindle_load)

tool_life = base_life × coating_factor × coolant_factor × load_factor
```

---

## HEM Optimizer

For `mode = "hem"`, the engine runs a **grid search** over discrete DOC and WOC combinations to find the combination that maximises MRR while satisfying all hard constraints.

**Grid definition:**

```
doc_grid = diameter × [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5]
woc_grid = diameter × [0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.075, 0.10, 0.12, 0.15]
ipt_grid = ipt_base × [0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 1.0]
```

**Constraint filters applied in order:**

1. `deflection ≤ deflection_limit` — hard limit, always enforced
2. Force limit check (if enabled)
3. `rub_ratio ≥ hem_rub_min` (default 1.20) — chip thickness floor
4. **Objective: maximise MRR** — highest-passing candidate is selected

The optimizer returns the best `(doc, woc, feed)` triplet found in the grid.

---

## Material Constants Reference

| Material | Base SFM | IPT Base | K (psi) | HP/in³/min |
|---|---|---|---|---|
| Aluminum | 900 | 0.0035 | 60,000 | 0.30 |
| Non-Ferrous | 800 | 0.003 | 70,000 | 0.35 |
| Plastics | 600 | 0.0025 | 30,000 | 0.20 |
| Steel | 300 | 0.002 | 180,000 | 1.00 |
| Stainless | 220 | 0.0018 | 200,000 | 1.20 |
| Cast Iron | 250 | 0.0022 | 160,000 | 0.90 |
| Inconel | 180 | 0.0012 | 240,000 | 1.50 |
| Titanium | 160 | 0.0015 | 220,000 | 1.40 |

---

## Advisories & Warnings

The engine generates contextual advisories based on the calculated results:

| Advisory | Trigger Condition |
|---|---|
| **Rigidity limited** | Stickout is primary bottleneck — recommends reduction |
| **Deflection over limit** | `deflection > deflection_limit` |
| **Rubbing risk** | `rub_ratio < 1.20` — chipload too low |
| **HEM not feasible** | Stiffness too low for productive HEM engagement |
| **Ball-nose tilt** | Low effective SFM at tip — suggests tool tilt angle |
| **Corner radius** | Recommends ideal CR for the engagement geometry |
| **Entry move** | Ramp angle or helix boring strategy guidance |
| **Force / power limited** | Identifies which constraint is the active bottleneck |

---

## Example Calculation

**Setup:** 0.5" tool, Titanium, HEM, 6 flutes, 12,000 RPM available, 10 HP machine, 1.5" stickout

| Step | Calculation | Result |
|---|---|---|
| Base SFM | 160 × 1.5 (HEM) | 240 SFM |
| Target RPM | (240 × 3.82) / 0.5 | 1,833 RPM |
| Capped RPM | min(1,833, 12,000 × 0.95) | 1,833 RPM |
| IPT base | Titanium: 0.0015" | — |
| Chip thinning | sqrt(0.5 / (0.5 × 0.10)) | factor = 3.16 |
| IPT adjusted | 0.0015 × 3.16 | 0.00474" |
| Feed rate | 1,833 × 6 × 0.00474 | 52.1 IPM |
| DOC (1.5×dia) | 1.5 × 0.5 | 0.75" |
| WOC (6% dia) | 0.06 × 0.5 | 0.030" |
| MRR | 52.1 × 0.75 × 0.030 | 1.17 in³/min |
| HP required | 1.17 × 1.40 | 1.64 HP |
| Spindle load | 1.64 / 10 | 16.4% |
