---
name: project_diameter_stepup_taper_cost
description: Diameter step-up suggestion capped by spindle taper (CV40→3/4" max) and suppressed when flex isn't the limiter (cost)
metadata:
  type: project
---

The "Increase Tool Diameter" stability suggestion (legacy_engine.py, non-slot `elif _next_d` block ~7381 + slot-fit block) got two guards on 2026-07-23 per Scott:

**1. Taper diameter cap.** New `TAPER_MAX_ENDMILL_DIA` table + `taper_max_endmill_dia(taper)` helper (near SPINDLE_TORQUE_CAPACITY ~line 583). Caps the diameters the step-up may recommend: 30-class (CAT30/BT30/HSK32/HSK50/VDI30) → 0.500"; 40-class incl **CV40** (CAT40/BT40/HSK63/CAPTO C6/VDI40) → **0.750"**; 50-class + big HSK (CAT50/BT50/HSK100/HSK125/KM80/CAPTO C8) → 2.0". Unlisted HSK interpolates by trailing number (HSK80→1.0"). Default/unknown → 0.750" (40-class, conservative). Applied by filtering `_common` before `_next_d`/`_slot_next_d`. **"CV40" is colloquial — the enum stores CAT40/BT40**, which hit 0.750 correctly. Helper is case-insensitive.

**2. Cost/need gate.** Non-slot step-up now only fires when `_defl > _dlim * 0.90` (flex actually is/near the limiter). Higher tool prices mean customers won't buy up on diameter when flex is comfortably in range — recommending it then just costs money + burns spindle HP for no gain. Removed the now-dead `_defl <= _dlim` "flex already within range" load-note branch.

Ties to the governing rule in [[project_flute_swap_net_flex.md]]: a stability recommendation must be genuinely worth acting on (and buildable on the actual machine). See [[project_machine_catalog_db.md]] for taper enum source (shared/routes.ts:72 — includes CAPTO C6/C8).
