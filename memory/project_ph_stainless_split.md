---
name: project_ph_stainless_split
description: PH stainless split into three keys (15-5 / 17-4 / 13-8) — calibration values and why
metadata:
  type: project
---

PH stainless was one lumped key `stainless_ph` (17-4/15-5/13-8MO). Shop feedback (2026-06-08): 13-8 machines very differently. Split into THREE keys; 17-4 keeps the `stainless_ph` key (existing calibration untouched).

**Difficulty ranking: 15-5 (easiest) → 17-4 (benchmark) → 13-8 (hardest).** 15-5 is delta-ferrite-free, lowest forces, +5–15% over 17-4, great HEM candidate. 13-8 (XM-13) is ~30% stronger (H950 = 44–46 HRC, ~200 ksi UTS), 10–25% higher cutting forces, notch/chip/thermal-crack risk → run conservative.

Anchored to reference table (not yet shop-measured for 13-8 — estimate, tune later), centered on existing 17-4 = 235 SFM / 0.0035 IPT:

| key | grade | BASE_SFM | IPT_FRAC | HEM_mult | Kc (physics.py) | unit-power mult |
|---|---|---|---|---|---|---|
| stainless_15_5 | 15-5 (XM-12) | 260 | 0.0037 | 2.0 | 108000 | 1.12 |
| stainless_ph | 17-4 (630) | 235 | 0.0035 | 1.8 | 112500 | 1.15 |
| stainless_13_8 | 13-8 Mo (XM-13) | 214 | 0.0033 | 1.6 | 130000 | 1.30 |

**13-8 retuned 2026-06-08 per shop call:** anchor OFF 17-4, SFM −9% (8–10% band) → 235×0.91=214 (was 200, too aggressive); FPT −5% (4–6%) → 0.0035×0.95=0.0033 (unchanged). Drill/ream/chamfer 13-8 values also moved to track this gentler delta: drill SFM 59, drill IPR 0.0042, ream SFM 118 & 218, chamfer mult 1.66, physics ream SFM 68.

**WOC −12% is REACTIVE, not a baseline.** User wants WOC cut "if spindle load becomes excessive" on **traditional roughing** (not HEM). Decision: NO hardcoded WOC change. The higher 13-8 Kc (130000) already makes the stability advisor's "Reduce WOC (>15%)" suggestion fire earlier on 13-8 than 17-4. WOC presets live in `getDynamicPresets` (Mentor.tsx) per ISO/flute only — NOT per material key; a baseline per-material WOC would need threading material key through that fn (not done — intentionally).

Higher Kc on 13-8 also makes the stability/deflection advisor correctly more conservative (more force → earlier chatter warnings → "reduce radial engagement / avoid full slotting").

**All touch points edited** (add new key everywhere `stainless_ph` lived):
- `legacy_engine.py`: BASE_SFM, unit-power mult dict (~329), thermal dict (~468), CHAMFER_IPT_MULT (~680), IPT_FRAC (~876), HEM_IPT_MULT (~942), material→group map (~1019, all → "Stainless"), drill SFM/IPR (~1705/1736), ream SFM dicts (~2906/2978), BOTH hardness-exclusion tuples (~1791 chamfer + ~4323 milling — PH SFM already reflects hardness, don't double-penalize)
- `engine/physics.py`: Kc (~498), ream SFM (~1182), ream non-CF mult (~1200)
- `server/routes.ts`: three ISO maps (~1776, ~2212, ~2319) all → iso_m / "M"
- `shared/materials.ts`: ISO_SUBCATEGORIES split into 3 entries, MATERIAL_NOTES (3 notes), hardness ranges (3), ALIASES remapped — 15-5/xm-12/s15500 → stainless_15_5; 13-8/13-8mo/xm-13/s13800/1.4534 → stainless_13_8; 17-4/630/s17400/1.4542/17-7 stay on stainless_ph
- `README.md` material table (also fixed stale 190 → 235 SFM)

See [[project_chamfer_calibration.md]] (CHAMFER_IPT_MULT anchor was 17-4) and material system notes in MEMORY.md. 13-8 SFM is an ESTIMATE — replace with shop data when available.

Pre-existing unrelated tsc errors at server/routes.ts:6276/6349 (function-in-block) — not from this change.

**COMMITTED 2026-06-08** as `178d885` — engine + materials only (legacy_engine.py PH dicts, engine/physics.py, shared/materials.ts, README). The two `server/routes.ts` ISO-map edits (EDP-enrichment + peer-suggestion maps, lines ~1773/2319) were NOT in this commit — they're interleaved at the line level with the uncommitted slot_strategy backend, so they intentionally ride with the slotting commit later. Material split is fully functional without them (those maps only affect which EDPs get suggested for display, fall back to "P"/null gracefully — core speeds/feeds live in legacy_engine.py). Slotting expansion (Mentor.tsx +548, slot backend) left uncommitted for separate review — see [[project_slot_hem_strategy.md]].
