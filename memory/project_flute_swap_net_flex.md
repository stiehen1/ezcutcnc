---
name: project_flute_swap_net_flex
description: Flute-count stability suggestion must net engaged-tooth force against core-stiffness gain; higher flute count can RAISE flex
metadata:
  type: project
---

The "Use N-flute tool (same diameter)" stability suggestion (legacy_engine.py ~7196+) originally claimed "~X% stiffer core — deflection drops" using ONLY the core-stiffness gain `(_new_cr/_cur_cr)**4` from `_flute_core_map` (7fl=0.82, 9fl=0.86). That over-promised.

**Why it was wrong:** deflection = force / stiffness, and BOTH scale with flute count. More flutes → more teeth in the cut (`teeth = arc/2π × flutes` at [legacy_engine.py:1638], `total_force = force/tooth × teeth` at [1705]) → radial force rises ~proportionally to flute count. For 7→9fl: core stiffness +21% but engaged-tooth force +29% → **net flex RISES ~6%**. This is why Scott saw the score DROP (Tool Flex 62→56, headline 85→84) after following the recommendation.

**Fix (2026-07-23):** compute `_fl_force_ratio = _nf/_cur_flutes`, `_fl_net_defl_mult = force_ratio/stiff_gain`. `_fl_helps_flex = _fl_net_defl_mult < 0.97`. **If not `_fl_helps_flex`: `continue`** — never offer a flute swap as a flex fix when it makes flex worse. Detail copy now states the netted flex improvement. The added-flute feed/MRR/finish upside belongs in speeds/feeds output, NOT the "lower your tool flex" list.

**Governing principle (Scott):** a stability recommendation must never make the score go DOWN — following any suggestion should move the score up (even if only a little), not sidegrade it.

Diameter step-up (D⁴) is NOT affected — force scales ~linearly with width while stiffness scales D⁴, so bigger dia wins on net. Only the flute-count case had force and stiffness moving at similar magnitude. See [[project_setup_score_holder_rigidity.md]], [[project_engine_architecture.md]].
