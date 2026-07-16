---
name: project_upload_material_guard
description: How print-upload handles material vs. a user's selection, and why warn-and-switch (not clobber, not force) is the deliberate choice
metadata:
  type: project
---

Print uploads extract `cutting_material` from the print's stated material (e.g. "ALUMINUM GEOMETRY"). That material is what the tool was **DESIGNED for** — which may or may not be the material being **quoted**.

**Two legitimate tool classes, opposite correct behaviors:**
- **Material-specific tool** (e.g. CC-14584: uncoated, 3-flute, 37° helix, "ALUMINUM GEOMETRY") — belongs ONLY in its design material. 800 SFM on CC-14584 is CORRECT because it IS an aluminum tool; running it in 13-8 is the operator error, not a bad default.
- **General-purpose tool** (plain ball / torus, no material lock) — same geometry cuts any material; the print's material is incidental. Clobbering a deliberate user selection here would be WRONG.

**Shipped behavior (commit 60f33f8, 2026-07-11) = warn-and-switch, applied uniformly:**
- Apply-extracted sets `next.material` from the print ONLY when `!p.material` (user hasn't chosen). Guard added because it previously clobbered unconditionally — selecting 13-8 then uploading CC-14584 silently swapped to aluminum, and since material then MATCHED the print the mismatch banner never fired → aluminum 800 SFM with no warning.
- If the user already picked a material, KEEP it; the amber mismatch banner (`Mentor.tsx` ~line 6750: `pdfExtracted && pdfMaterial && form.material && pdfMaterial !== form.material`) surfaces the difference with a one-click "Switch to {print material}".
- New sky-blue confirm nudge when material CAME from the print and is unchanged (`pdfMaterial === form.material`): reminds it's the DESIGN material, confirm it matches the JOB.

**DECISION (2026-07-11): keep warn-and-switch; do NOT add "material-locked tool" detection or a forced/auto-revert.** Considered escalating to a hard red warning for clearly material-specific tools (uncoated + aluminum geometry, or coating that binds a material) but rejected — the heuristic could misfire, and the banner + one-click switch already catches the error for both tool classes. Revisit only if a real bad quote slips through. The nuance (material-specific vs general-purpose) is real if we ever quote both kinds heavily.

Related: extraction defaults uncoated + no-material → aluminum_wrought (N1) — see [[project_pdf_upload]].
