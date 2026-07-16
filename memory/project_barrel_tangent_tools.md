---
name: project_barrel_tangent_tools
description: Barrel/tangent/oval-form surfacing tools — detection guardrail shipped, full physics deferred
metadata:
  type: project
---

Barrel / tangent / oval-form (also lens, conical-barrel, parabolic) tools are 5-axis high-efficiency **semi-finish/finish** surfacing tools that contact on a LARGE convex flank arc, not a small tip radius. As of 2026-07-11 they are **detected but NOT modeled** — a **guardrail only** ships, full physics deferred (no barrel tools in current quotes; forward-looking).

**USER INTENT (2026-07-11): Scott explicitly wants to BUILD the full barrel/tangent surfacing section at some point** — this is a planned feature, not just an acknowledged gap. Revisit and scope the full build (see below) when he raises it or a barrel quote/print lands. Proactively surface it as a candidate next feature.

**Why they can't reuse the ball/torus surfacing path** ([[project_feedmill]] scope was similar size): the current surfacing D_eff/scallop model (`legacy_engine.py` ~line 4458) assumes the scallop-controlling radius == the contact radius AND is ≤ tool OD/2 (capped by `min(_surf_D)`). Barrel tools break all three: flank profile radius is DECOUPLED from OD and is 10–30× the tool dia; contact point walks the flank as a function of TILT (tilt is mandatory, not optional like ball/torus); scallop = ae²/(8·R_profile) using the big radius, and must NOT clamp to `_surf_D*0.5`. Shoehorning into corner_condition would produce plausible-but-wrong scallop/D_eff — worse than no support.

**Guardrail shipped (2026-07-11):**
- Extraction rule 8 (`server/routes.ts`): sets `barrel_form` (bool) + `barrel_profile_radius_in` when print notes/profile show BARREL/TANGENT/OVAL/LENS/CONICAL BARREL/PARABOLIC or a large side-profile R.
- Client (`Mentor.tsx`): `barrelFormTool` state → destructive toast on upload + persistent amber banner atop the surfacing engagement panel ("approximate results, contact Core Cutter"). Cleared on new upload + clearPdf().

**Full build (WHEN a real barrel quote/print lands — validate against it + a CAM reference, don't build blind):** new `corner_condition="barrel"` class (sub-forms standard/tangent/lens); `barrel_profile_radius_in` input decoupled from OD; scallop math on the large radius (no OD clamp); tilt-dependent contact/effective-dia model (solve optimal tilt centering contact on flank); semi-finish WOC/DOC bands; UI inputs + extraction already have the flag/radius fields as a head start. ~Similar effort to the tapered-ballnose feature but trickier physics (tilt-walk contact vs. taper's closed-form integral).

Related: tapered ballnose/torus surfacing shipped 2026-07-11 (commit after `ec0ef42`) — rigidity-only taper model, see MEMORY index.
