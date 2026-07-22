# CoreCutCNC — Machining Mentor by Core Cutter LLC

A full-stack Machining Mentor for CNC shops and sales engineers. Calculates speeds, feeds, depths of cut, cutting forces, deflection, stability, and tooling recommendations across milling, drilling, reaming, feed milling, threadmilling, keyseat, and dovetail operations. Deployed at [corecutcnc.com](https://corecutcnc.com).

Each operation includes a **Pro Tips panel** (how to use the app) and a collapsible **Machining Tips & Tricks accordion** (shop-floor best practices per operation type).

---

## Recent Updates (July 2026)

### Feed Mill — extract the large FORM radius (not the edge-prep R) + force-aware rec DOC
- **Multi-radius form cutters were reading the wrong radius.** A high-feed form cutter (e.g. CC-14556) prints several R callouts — a large bottom form radius (R.630, ≈ the full tool Ø, the signature high-feed arc that does the chip thinning), a mid radius (R.315 ≈ Ø/2, the end/OD profile), and a tiny edge-prep blend (R.039). The extractor was grabbing the tiny R.039 as `corner_radius`, so the engine thought the tool could barely chip-thin and reported a feed no better than a conventional endmill (7.2 IPM, CTF 1.02×). Fix: the extraction prompt now takes the **largest** R on a feed-mill cutting end as the chip-thinning form radius and treats a tiny R (< ~10% of Ø) as edge-prep only; a server guard logs a warning if a suspiciously small radius slips through.
- **Force/HP-aware recommended DOC.** With the correct large form radius, chip thinning is no longer the limit — cutting force is. The rec DOC now takes the shallower of the CTF-target depth (dominates on small-radius insert cutters) and a **force ceiling** derived from the tool's own deflection budget (dominates on large-radius forms), floored so it never recommends a chip thin enough to rub/burnish (critical in PH stainless). Same tool now recommends a shallow high-feed DOC → CTF up to 4× → **~28 IPM** at ~208 lbf, stable — vs 7.2 IPM / 695 lbf / chatter before. Client rec-DOC preview prefers the engine's returned value.

### Feed Mill — WOC control + chip-thinning-aware DOC recommendation
- **Added a WOC (% of Ø) field to the Feed Mill dashboard.** It previously had only a DOC input, so radial engagement was stuck at the engine's 8% default — even though the advisor's own guidance says "WOC is your control knob." You can now set it (6/8/10/12/15% presets + custom); MRR scales directly with it. Engine clamps a caller value to 1–25% (rather than silently discarding an out-of-range entry).
- **Fixed the recommended DOC on radius-form (corner-radius) cutters.** The old rec was `0.8×corner_radius`, a corner-*strength* heuristic borrowed from big round-insert face mills. On a small solid-carbide corner that lands at exactly the depth where chip-thinning collapses (CTF ≈ 1.0×) — so the tool ran no faster than a conventional endmill. Example: CC-14556 (R0.039") recommended DOC 0.031" → CTF 1.02× → 7.2 IPM. The rec now inverts the CTF model to target ~2× thinning (`DOC = R·(1−√(1−1/CTF²))`), capped at 0.8×R for corner strength and floored to stay machinable. Same tool now recommends DOC ~0.006" → CTF ~1.84× → **~12.9 IPM** (+80%), and cutting force drops from ~695 to ~307 lbf (the earlier chatter flag was the too-deep DOC). Client-side rec/CTF previews mirror the engine formula.

### PDF upload — high-feed mill now routes to the feed-mill engine
- Uploading a **high-feed mill** print sometimes ran it through the *generic milling* physics instead of the feed-mill path — giving a conventional SFM, no radius-form chip-thinning (CTF), and an inflated cutting-force/deflection reading that throttled the feed. Root cause: the client operation-switch matched the extractor's `tool_type` by exact string (`"feedmill"`), so a descriptive variant (`"high-feed mill"`, `"high_feed_mill"`, `"hfm"`) or an `"endmill"` fallback slipped through.
- Fix: the server extractor now **normalizes** any feed-mill-shaped `tool_type` (and an endmill carrying a ≤30° lead-angle callout) to the exact `"feedmill"` enum before returning, and the client switch matches feed-mill variants defensively as well. High-feed prints now correctly select the Feed Mill operation on upload — proper SFM, radius-form CTF, and decoupled force.

### Speed Card — Manual RPM entry + Speed/Feed layout
- **Set an exact RPM.** Alongside "Set SFM", the Speed card now has a **Set RPM** box. Enter a spindle speed and the engine (`rpm_override`) runs at exactly that RPM — clamped to the machine's max — and **derives the SFM back from it** so feed and tool-life stay consistent. SFM and RPM entry are **mutually exclusive**: typing one clears the other, and clicking any speed preset clears both.
- If a manual RPM exceeds the machine ceiling it's clamped, and a ⚠ line shows the requested vs. capped value (mirrors the manual-SFM clamp note).
- **Layout:** SFM and RPM each show their value with a **Set …** box to the right, RPM styled to match SFM directly beneath it. Speed-preset labels were shortened (Longest / Longer / Balanced / Faster / Fastest) so all five fit one line without wrapping.
- **No card jump.** Clicking a speed or feed control no longer makes the whole results column jump: the optimal-tool card is kept mounted (with its prior content) during a re-run instead of blanking and remounting, and the collapsing helper notes now reserve their line height.

### Feed Levels — Mild / Moderate / Full (break a tool in, work up)
- Not every shop wants to run a fresh tool straight at full HEM feed. Added a **Feed Level** control (**Mild / Moderate / Full**) so you can come out cooler and progressively work your way up as you gain confidence in a tool/material combo.
- **HEM** (`hem_feed`): throttles only the feed *boost above conventional* — Mild = 75% of the boost, Moderate = 90%, **Full = 100% (default, unchanged)**. Because it scales the excess over the conventional feed floor, you never drop below a safe conventional chip load. HEM force/deflection stay **honest** at every level (the force path divides out exactly the boost applied); MRR and HP reflect the gentler feed you actually programmed.
- **Chip-load modes** (`rough_feed`) — roughing, **facing**, **traditional slotting**, and **finishing**: a straight chip-load derate at the same 75 / 90 / 100% (there's no boost to scale — the conventional feed *is* the baseline). MRR drops proportionally, which is the point (come out cooler, work up).
  - Roughing / facing / slotting are **floored at 50% of nominal** so a derate can never push the edge into rubbing (which runs hotter and kills tools).
  - **Finishing** is floored at the material's **minimum chip thickness** instead: the engine already feeds a finish pass up to keep the actual chip above `h_min`, so on a light-WOC pass Mild/Moderate may barely change — dropping below that floor would rub and *worsen* the finish. The control lightens the feed only as far as it safely can.
- **UI: Speed and Feed are now clearly separated** (see the Speed Card note above). The **Speed** card holds SFM + RPM + the speed presets; a matching **Feed** card below holds the programmed feed + the Mild/Moderate/Full selector, which appears in every mode where it applies (HEM/trochoidal, roughing, facing, slotting, finishing) and is labelled per mode.
- Both default to **Full**, so existing results are byte-for-byte unchanged unless you opt down.

### Stability — clickable-WOC recommendation fixes
- Applying a suggested WOC reduction from the stability panel now also updates the WOC **inches field** and clears the highlighted WOC **quick-button** — previously the last-clicked preset (e.g. "Low 7%") stayed lit after applying a 4.2% suggestion, which was confusing.
- The suggestion **label now matches the value applied**: labels formatted the target with zero decimals (showing "4%") while the applied value was rounded to one decimal (4.2%). Switched the WOC suggestion labels to `:g` so a whole number still reads "4%" but a fractional target reads "4.2%".

### Stability — Rigidity-Awareness Steps for Weak Holder / Workholding
- The "Steps to help lower your tool flex" panel only ever fired when the *tool* itself was over-flexing. So a setup with **Fair** Holder Rigidity or Workholding sub-scores — the two things actually dragging the Setup Score down — got *no* step about them, and the panel instead nudged marginal tool-flex tweaks (bigger diameter, more flutes) even while admitting "flex is already within range."
- Added optional, non-prescriptive steps that appear **only when Holder Rigidity or Workholding scores Fair or below (< 65)**: *"Possibly look toward a higher-precision, more rigid tool holder"* and *"Possibly use more secure workholding, if the part allows it."*
- **Mitigation-first framing** — many shops can't swap a holder or re-fixture a part on demand, so the copy leads with what costs nothing (back off feed/DOC/WOC, reduce overhang, add tailstock/steady support) and lists the hardware upgrade as the optional next lever, not a mandate.
- When only these rigidity steps are present (tool flex is fine), the panel header reads **"Steps to strengthen this setup"** rather than claiming they lower tool flex. The suggestion cap was already 6 (not 3) — the list simply had nothing to fill it with before.
- **Vise guidance**: for any vise-type hold, the Workholding note (the per-button hover, the field-label tooltip, and the sub-score result line) now reminds you to (1) ensure the jaws make **solid, secure contact across the full width of the part** — partial contact lets it rock and chatter regardless of clamp force — and (2) watch for **harmonics on a part bridged between widely-spread jaws**, which is supported only at its ends; on a large span, add a center support or consider vibration damping before pushing feed. Same note (condensed) added to the **5th-Axis Vise** hover.
- **Workholding order corrected**: the VMC / HMC / 5-axis Workholding **button rows** (and their tooltips) were ordered out of sync with the actual rigidity scoring, which mirrors the engine's `WORKHOLDING_COMPLIANCE` table. A locked **4th-Axis Trunnion (0.91)** is stiffer than a standard **Vise (1.00)**, so Vise now correctly lists *after* Trunnion. Also fixed 4-Jaw-vs-Dovetail (4-Jaw is stiffer) and 5th-Axis-Vise-vs-Dovetail order. Scores were already right — only the displayed left-to-right order was out of sync.

### Stability — Workpiece (Part) Deflection Model
- The Stability Index only ever modeled *tool* stickout — it assumed the workpiece was rigidly held. A part sticking out of a chuck on a 4th-axis trunnion could break a tool while the score still read *"89 Excellent."* Added a real **Workpiece Rigidity** dimension.
- Models the **part as a cantilever** off the jaws/trunnion face (`δ = F·L³/3EI`, `I = π·d⁴/64`) in series with a **fixture-loop compliance** term (a 3-jaw-on-rotary is far softer than a bolted fixture — captured even at zero overhang). Material-aware modulus: an aluminum part flexes ~3× a steel one for the same geometry. Far-end support (tailstock / between-centers / steady rest) converts the beam to simply-supported.
- **Overhung-mass effect**: a heavy part slung off the jaws isn't just a static bending problem — its mass lowers the part's natural frequency and turns it into a pendulum that rings under the cut. The model estimates the overhung mass (from the part diameter, overhang, and material) and amplifies the workpiece deflection accordingly, so a solid **steel** part scores worse than the **same shape in aluminum**, and a long slung-out part scores worse than a compact stub. A supported free end (tailstock / steady rest) removes the penalty.
- New **Part Diameter at Overhang** input (appears once a Part Overhang is entered) — a cantilever needs both length and cross-section. Blank falls back to a conservative estimate and says so.
- Added a **"3-Jaw on Rotary"** workholding option (VMC/HMC) for the common "chuck mounted on a 4th-axis" setup that the single-select buttons couldn't express — it stacks the 3-jaw grip on the rotary bearing/brake loop (softest of the milling options). Pick this instead of plain "3-Jaw Chuck" when the chuck is on a rotary.
- The new **Workpiece Rigidity** sub-score **hard-caps** the overall index — a flexible part can no longer earn "Excellent" no matter how good the tool, holder, and machine are. No-overhang cuts score exactly as before (the workpiece axis only participates when the part actually sticks out).
- Fixture-compliance and mass-amplification constants are documented starting estimates, to be shop-calibrated.

### Machine Catalog — Mazak VTC Series & Search Limit Fix
- Added the full **Mazak VTC (Vertical Traveling Column)** family — 14 machines: the US C-series (200C, 300C) and 250D/50, the EU/global C-series (530C, 760C, 820/20, 820/30), the CAT-50 heavy-duty **800/20HD & 800/30HD**, the value-line **VTC-Ez 25 & 30** (SmoothEz), the JP/Asia compact **530/20**, and the 5-axis swivel-head **800/20 SR & 800/30 SR**. Standard 3-axis models are categorized `vmc`; the SR machines are `5axis`.
- **Fixed a truncation bug in machine search**: the `/api/machines/search` catalog query capped results at 50 rows. With 70+ Mazak machines, a plain "mazak" search alphabetically pushed the VTCs past row 50 — so most of them (and the tail of any large brand) silently vanished from results. Raised the limit to 200 so a single brand no longer overflows the window.

### Materials — Medium-Carbon Steel Sub-Category
- Split plain-carbon 10xx steels (1040, 1045, 1055, 1070–1095) out of the Alloy Steel bucket into their own **Medium-Carbon Steel** sub-category under P Steel. Previously typing "1045" into Match resolved to *"Alloy Steel (4130…)"*, which was metallurgically wrong and understated the tool life / overstated the abrasion.
- It runs as its own calibrated tier — SFM/feed/HP/tool-life sit **between** mild and alloy steel across milling, drilling, keyseat, dovetail, feed mill, ream and chamfer paths (no Cr/Mo carbides to abrade the edge, so a touch faster than alloy; feed stays flatter than SFM across the tiers). Anchored to the low end of the published SFM band +10%, interpolated between the shop-validated `steel_mild` and `steel_alloy` anchors.

### ROI Exports — Reconditioning, Additional Savings & "Higher-Priced Tool" Note
- The emailed report now shows the **Reconditioning Program** callout (+$/yr, regrind count & price) and an itemized **Additional Value** section (recurring + one-time savings). These were computed and folded into the totals but never displayed in the email — the itemized extras weren't even sent to the server.
- Added a friendly green note across the on-screen panel, PDF, and email: when the Core Cutter tool costs more than the competitor **but still nets savings**, it reads *"You're saving money even with a higher-priced tool … what matters is total cost per part, not just the sticker price of the tool!"*

### ROI Report — Cost %, MRR Δ Column & UI/Export Parity
- **Fixed the cost-reduction %**: it divided total savings (tooling + machine time) by tooling-only cost, producing impossible figures (e.g. 1632%). Machine time is now counted on both sides, so the % is bounded and correct.
- **MRR machine-time cost** is now a real per-part line (was silently excluded while driving most of the savings); Tool + Machine = Total now reconciles everywhere.
- **Per-KPI Δ column** on every comparison row — ▲/▼ with % change, green when good for the customer (higher MRR/parts, lower cost), red when worse.
- **Rows adapt to the ROI life mode** (parts / cut-time / linear-inch) and empty rows are hidden instead of showing blank dashes.
- **One source of truth**: the client sends its computed cost breakdown and both the on-screen panel and the emailed/printed report render from a shared row builder — they can no longer drift.
- **Email report**: added a **Company** row before Part Name; the blue callout is retitled **"Machine Time Savings (i.e. throughput)"** with the MRR % shown after the annual dollar figure.

### ROI Rerun — Legacy Row Restore
- ROI Rerun on **legacy rows** (saved before the full-snapshot feature) now restores the **ISO category** from the stored material key so the Material section reflects the grade.
- These older rows never captured the milling **process**, so Rerun now leaves it unselected (prompting the user) rather than silently defaulting — a Traditional/Slot ROI must not come back as HEM. ROIs saved with a full snapshot continue to restore the exact process.

### Machine Catalog — Makino & Fadal
- Added **Makino** legacy A-series horizontals (a40/a61/a71/a81/A99/A100E) and a-series 5-axis variants; fixed the a51nx torque note.
- Added **Fadal** current (relaunched) lineup plus the legacy VMC catalog (TRM–6535, incl. 50-taper) with verified specs for 3320 / 4022 / 8032 / VM5ax320.

### Setup Score
- Added a **Workholding** sub-score and a **Holder Rigidity** sub-score (so a better holder raises the score rather than lowering it), recalibrated the load curve, and decluttered the layout.

### Surfacing
- **Tapered ballnose / bull-nose (Torus) support**; guardrail that detects and warns on barrel/tangent tools.
- **Tool-aware, always-on tilt recommendation** for ball tools; defaults to the Finish preset on entering surfacing mode; auto-tilt tracks `ap` both ways; fixed blank `ap` on upload and stale "auto" tilt jumps.
- Upload gating: results gate on unresolved material mismatch; print upload no longer clobbers a chosen material.

### Feed Mill
- Calibrated mild-steel SFM + IPT boost to shop/Swiss reality; **radius-form chip thinning**; fixed Base/Adj FPT inversion, Corner Radius / Stickout / DOC input locking (type-freely + blur).

### Slotting / HEM Tiles
- HEM slot shortcut tiles: show all four flute+geometry choices per Ø (5/6-fl CB + 5/6-fl std), ordered by fewest Z-passes; qualify necked tools that reach depth via LBS; widened the diameter window (0.70× → 0.80×); dia-keyed flute caps, slot-aware step-up, 0.85× sizing.
- CB/VXR tile WOC-floor warning reworded to advisory ("prefers ≥N%") and checks the WOC that actually runs.

### Other
- **Tap drill calculator**: standard drill (wire/letter/fraction) + drill-type oversize, metric pre-drill callouts.
- **HEM safety gate** + conservative-feed lock; export email gate removed.
- Stability advisor suppresses catalog-swap suggestions for special/uploaded tools.
- Deploy: added `script/deploy.sh` to force-sync Replit to GitHub (ends the fork); fixed the port-5000 EADDRINUSE race in the Run workflow.

### ROI Report — Branding & Layout
- **Emailed ROI report converted to a light/white theme.** The prior dark HTML rendered badly in Outlook (Word engine) and inconsistently in Gmail. Rebuilt with a table-based layout, `bgcolor` attributes, and no flexbox/border-radius so it renders reliably across clients.
- **Header** now shows the main Core Cutter logo (`CCLogo-long-whiteback TRANSPARENT.png`) on the left with "ROI Summary" + subtitle on the right, on a white bar with an orange accent stripe.
- **Footer** carries Core Cutter USA contact info (phone / sales email / web) plus the distributor "Generated by" block when present.

### ROI Form — Distributor "Generated by" Block
- Opt-in **"Add distributor info to report"** toggle. When on, collects Company Name, Generated By (name), Address, and City / State / Zip.
- Fields **persist on the device** (localStorage) so a rep needn't re-type them each ROI.
- Renders a tidy **"Generated by:"** block on both the emailed and printed/PDF exports — only when toggled on and a company name is present.
- **ZIP → city/state auto-fill** via the free Zippopotam.us API on blur (5-digit US); all fields stay editable. Address row ordered City · State · Zip.

### ROI Form — Part Identity & Auto Naming
- New **Part Name** + **Part Number** fields (side by side) before the ROI Measurements selector; saved to the DB and shown on both exports.
- **ROI Name auto-builds** as `Company - Part Name - Part Number ROI Report` until the user edits it; a ↺ auto button rebuilds it from the source fields.
- **Competitor Brand** is now a datalist dropdown of known brands with free-add (type any brand not listed).
- **End User Contact Email** field removed; Company + Contact names share one horizontal row to save vertical space.
- **Tool Price** fields lifted out of the orange Tool Life box into their own row (price is not a tool-life metric).

### ROI Save / Rerun — Same-Name Overwrite + Full Snapshot
- **Same `(user_email, roi_name)` now overwrites** the previous version instead of duplicating. Server reuses an existing row's `roi_session_id` when a name match exists, backed by a partial `UNIQUE` index on `(lower(user_email), lower(roi_name))`; a startup migration dedupes any pre-existing duplicates first. Different reps can still reuse a name.
- **A saved ROI is now a full saved application + cost info.** New `roi_form_snapshot` JSONB column stores the complete calculator input set (`{ inputs, operation, isoCategory, edpText, skuDescription, toolNumber, machine }`) with each ROI.
- **Toolbox "Rerun"** repopulates the full calculator via that snapshot (exact restore of geometry, machine, coating), falling back to a column subset (dia / material / flutes / LOC / WOC / DOC / hardness / operation / EDP) for older rows. Rerun uses a hard navigation so the calculator remounts and reads the restored state; the user clicks Run and the ROI panel appears pre-filled.

### ROI Panel Visibility
- The ROI panel is **only available after a calculator run** (`mentor.data` present). A stale in-progress draft no longer auto-opens the panel under an unrun calculator; the draft is restored only on an explicit Resume/Rerun.

---

## Recent Updates (June 2026)

*(Backfilled from git history — summarized by theme.)*

### Materials
- **PH stainless split** into distinct machining keys: 15-5, 17-4, 13-8.
- Added **A128 Hadfield manganese steel** (austenitic, ISO M).
- **Powder Metal (PM) modifier** for milling — density-driven SFM/IPT/tool-life derate, presented as a "Material Modifier" overlay.
- **Hardened steel**: HRC-driven SFM with tamed HEM and a bucket-switch UX.
- **Case-hardened** fixes: corrected SFM double-derate, geometry-aware notes, in-case KPI hierarchy; suppressed out-of-range HRC warning and material-switch nudge.
- **Hardness converter**: added 15N/30N/45N superficial scales with a case-ceiling guard; PH condition picker fills a typical HRC.

### Slotting / HEM
- **Traditional vs HEM slotting strategy** with a Slotting Stats section and non-binding tool suggestions.
- Slot chip pickers: cap to the largest diameters that fit the width, drop tools that can't reach depth in ≤2 Z-steps, HEM 2-EDP-variants per Ø with correct light WOC + deep DOC on load.
- **Block 6+ flute traditional slotting** (scoped to traditional only).
- HEM auto-lightens WOC when DOC is pushed past the capped ×D.

### Stability & Setup Score
- **Click-to-apply** stability suggestions with per-EDP dimensions and a slot-width fix.
- Chatter now actually derates the recommended feed (not just suggests it).
- **4-tier Setup Score** color scale (excellent / good / fair / needs attention); flute count + diameter-load caveat on EDP chips.

### Necked / Center-Neck Tools
- Center-neck extraction, neck-diameter deflection wiring, and a stickout-advisor floor; necked-tool stickout reconciled to `lbs + 0.5×D` with redundant shorten-step suppression and chipbreaker detection from the print.

### Finishing / Ra
- **Ra finish** split into wall (side-mill) vs floor (face); corner radius governs floors only. Min-chip floor respected with an honest "target not reachable" warning. Hard-finishing min-chip floor feed-up + HRC-aware tool life.

### Access, Export & Mobile
- **Open access**: dropped the ROI sales-rep gate, added a per-email blocklist, fixed stale run-block.
- Export prints the EDP# (or special CC#) on all export docs (PDF setup, optimized-match table, filename); LBS row added to the SETUP table.
- **PDF upload** hardening: structure-based auth check (rejects app parameter sheets), byte-sniff file type, clearer rejection toast.
- Mobile: tap-to-toggle info-dot tooltips and inline hints (fixes tooltips not opening on mobile).
- Engine: set `PYTHONDONTWRITEBYTECODE` to prevent stale `.pyc` files.

---

## Recent Updates (May 2026)

### Pocketing Strategy — Entry Type Restructure
- **Sweep / Roll-in** is now hidden for any closed pocket (with or without a pre-drilled hole). A pre-drilled hole is an interior cavity, not an open edge to swing in from. Helical is the recommended fallback for closed pockets with no pre-drill.
- **Tool Entry section regrouped** when pre-drill is on:
  - **Z-entry through remaining gap** group (Helical / Straight Ramp) — only shown when the pre-drill is shallower than pocket depth. Sub-header shows the exact remaining depth, e.g. *"Z-entry through remaining 0.170″ below pre-drill"*.
  - **XY-entry from pre-drilled hole to pocket wall** group (Sweep / Roll-in ★ recommended + Straight Radial alt). Always shown when pre-drill is on.
- **Straight Plunge** hidden whenever pre-drill is on (defeats the purpose of pre-drilling).
- **New entry type `xy_radial`** — "Straight Radial" XY breakout move from inside the pre-drilled hole. Treated as slotting feed (50% of side-mill feed) until the tool clears enough material to begin side-milling.
- **Auto-select effect** updated to seed sensible defaults when pre-drill toggles: Sweep for XY, Helical for Z if gap exists, Straight Plunge stripped.
- When pre-drill reaches the full pocket depth, a one-line info note appears in place of the Z-entry group: *"Pre-drill reaches the pocket floor — tool drops straight in, no Z-entry move needed."*

### Pocketing Strategy — Recommended-Tool Card Cleanup
- **Helical ramp parameters sub-block** (per tool card) reformatted from a dense run of inline text into a 3-column grid (Entry Feed / Ramp Angle / Z per rev / Z Feed / Ramp Depth / Time to Depth) inside a bordered card. Matches the visual rhythm of the RPM/Feed/IPT params row below.
- **Progressive Reach Sequence header** rewritten:
  - *Pocket Info* line: pocket L × W (closed pockets only), depth, wall corner R, floor corner R.
  - *Tool Progression* line: each rougher Ø in sequence, then `Ø<dia>" Finisher` or `Custom Finisher (quote required)` if the sequencer can't find one in catalog. Replaces the previous Bulk Ø / Corner Ø summary.

### Pocketing Strategy — Sequencer Rougher Diameter Cap
- **Largest bulk rougher** capped at `corner_radius × 3.0` (was `× 4.0`). Old cap left too much corner stock for the finisher to remove — full-radial spike loads at every wall corner. Shop-validated: R0.236″ wall corner → 0.708″ cap → picks 0.750″ stocked diameter.
- HEM's separate 0.625″ hard cap still applies; final cap = `min(pocket-fit, HEM cap, corner cap)`.

### Pocketing Strategy — Thin Wall WOC
- **Thin Wall toggle** now scales bulk-rougher WOC down by **0.50×** on every per-tool calc (floored at the rubbing limit: 5% HEM / 10% Traditional). Previously the toggle only affected the advisory taper schedule display — actual per-tool WOC% numbers didn't change.
- The taper schedule (50% → 30% → 10% → 5% Trad; 10% → 5% → 3% HEM) remains below each tool card as the finisher's wall-approach guide.
- Conservative default — doesn't try to encode bilateral-stock-vs-tree-buttress strategy differences. A dedicated "Thin Wall Milling" process is planned for that.

### Stale-Results Notification — Fix
- "Inputs changed" floating pill now correctly hides after a successful Re-run in **Pocketing Strategy** mode. The deep-pocket sequence run path previously never snapshotted the form or cleared `formDirty`, so the toast stayed visible even when nothing had changed since the last run.
- Toast visibility gate updated to recognize per-mode result signals: shows when `customer` (standard milling) OR `dpResult` (pocketing) is present, hides while `mentor.isPending` OR `dpLoading` is true.
- Special-tool sub-path (PDF-uploaded tool in pocketing mode) now also snapshots via per-call `onSuccess` callback.

### Export Sync (Pocketing Entry Model)
- **Plain-text pocketing-section export**: replaced one-liner "Pocket Type: Closed (pre-drill entry)" with a structured entry plan. Closed pockets with pre-drill show pre-drill spec, `Entry — Z move: Helical through remaining 0.170″`, and `Entry — XY move: Sweep / Roll-in`. Pre-drill reaching the floor reads `Pre-drill reaches floor — drop-in to depth, then Sweep / Roll-in`. Auto pre-drill depth now annotated `~3.230″ (auto, 95% of pocket depth)`.
- **HTML email entry section**: new `xy_radial` row block (orange-themed, mirrors slot_straight). Pre-drill banner injected above the entry table summarizing Z + XY plan when applicable.
- **Plain-text entry section**: labelMap now includes `slot_straight` (pre-existing bug — was missing) and `xy_radial`. Pre-drilled deep pockets emit `Z-Entry Move` + `XY-Entry Move` lines instead of generic "Entry Type". Section also renders when only `xy_radial` is selected (no longer requires `em` from engine).

### Memory Notes (Persistence)
The following project memories were added to support future sessions:
- `feedback_sweep_closed_pocket.md` — Sweep is open-edge only; closed pockets cannot use Sweep entry regardless of pre-drill state.
- `project_pocket_rougher_cap.md` — Rougher diameter cap is `corner_radius × 3.0` (shop-validated calibration).
- `project_thin_wall_woc.md` — Thin Wall scales bulk rougher WOC by 0.50× (conservative default).
- `project_thin_wall_milling.md` — Planned dedicated Thin Wall Milling process with bilateral-stock / tree-buttress / conservative strategy selector.

---

## Recent Updates (April 2026)

### PDF Upload — Step Drill & LOC Extraction (late April 2026)
- **Bold lines = cutting surfaces** added as Rule 0 in extraction prompt — universal convention on all CC prints; thin/dashed lines = shank/body/relief
- **Step drill diameter assignment** (Rule 2b): `tool_dia` = smallest cutting dia (tip/entry, feed basis); `drill_step_diameters` = larger cutting dias only (SFM basis); shank OD goes to `shank_dia` — never in any cutting dia field. CC-14371 worked example embedded in prompt: `tool_dia=0.103, shank_dia=0.1875, drill_step_diameters=[0.141]`
- **LOC = cut depth** established as the single authoritative field for drills and reamers. CLEAR and "flute length" labels on CC prints are ambiguous relief dimensions and must not be used for calculations. Engine now reads `loc` directly (`drill_flute_length` kept as fallback only)
- `drill_flute_length` and `ream_flute_length` deprecated — set to 0 in extraction; engine uses `loc`
- Tool number extraction reinforced: character-for-character from the TOOL # field (fixes CC-14371 not appearing in banner)
- mm conversion blocks added for `ream_step_diameters` and `ream_step_lengths`

### Drilling UI (late April 2026)
- **Point angle default** changed from 135 to `0` (unset) — no pre-selection before PDF upload or manual click; engine defaults to 135 when 0 is sent
- Point angle buttons show a hint when unset ("Select point angle")
- **WOC/DOC/stickout fields** guarded with `operation === "milling"` — previously bled into drilling/reaming UI when switching operations
- **Editable dimension fields** added: LOC (cut depth), OAL, Entry Ø (feed basis), Largest Ø (SFM basis), Step Length from Tip — all pre-filled from PDF upload, all user-editable
- Step diameter panel auto-opens when PDF detects multiple cutting diameters (`isStepDrill = drill_step_diameters?.length > 0`)
- **Flute depth warning** fixed: `usable = fl − sfm_dia × 0.3` — point clearance based on largest cutting diameter (was incorrectly using tiny entry tip dia, making warning far too aggressive)
- Quotes card: "Flute Length" label changed to "LOC"; value now reads from `form.loc`

### Reaming UI (late April 2026)
- Same editable dimension fields as drilling (LOC, OAL, step dia, step length), pre-filled from PDF
- Same WOC/DOC/stickout guard applied

### Thread Milling Star Fix (late April 2026)
- Recommended cut direction ★ now always visible in amber (`#f59e0b`) on the recommended button regardless of whether the button is also the active selection (was invisible when button was both recommended and active)
- G-code dialects added: Okuma OSP, Heidenhain

### Training Videos (late April 2026)
- Badge changed from "Soon" to "Coming Soon"

### Email / Saved Output
- **Teeth in Cut** and **Engagement Angle** added to Speeds & Feeds section of email/text output. Engine computes exact arc degrees (`acos(1 − 2×WOC%)`) for all conventional/HEM endmill operations; 180° for full-slot, 90° for face mill.
- **Entry Moves section** now only prints the sections matching the user's selected entry type checkboxes (Sweep/Roll-in, Helical, Ramp, Straight Plunge, Slot Straight). Previously all entry types were printed regardless of selection.
- **Entry Type label** in saved output now reflects the actual user selection, not a hardcoded "Helical / Ramp" fallback.

### Tailstock / Live Center Support
- **Tailstock checkbox** added to workholding section, visible when setup uses trunnion, chuck (3/4/6-jaw, collet, hydraulic, power), face plate, or between-centers.
- When active: applies **3.5× deflection limit boost** (simply-supported beam model vs. cantilever). Stickout reduction suggestions are suppressed and replaced with an informational note. A soft advisory fires if stickout exceeds 4×D even with tailstock.
- `tailstock: boolean` added to Zod schema (`shared/routes.ts`) and engine payload.

### PDF Tool Upload Fixes (Reduced-Shank / QTR3-Style Tools)
- **Cutting diameter extraction** fixed — EXTRACTION_PROMPT now correctly identifies the cutting tip diameter vs. the larger shank OD for reduced-shank tools. Previously extracted 0.250" shank as cutting dia for a 0.059" tip.
- **Variable pitch/helix auto-detection** — PDF extraction now outputs `variable_pitch`, `variable_helix`, and `tool_series` fields; series inferred from geometry (3-fl + reduced shank + var pitch + var helix → QTR3).
- **Flute wash estimate suppressed** for reduced-shank tools (shank > 1.05× cut dia). The 20% LOC estimate is irrelevant for tapered-neck tools.
- **Flute wash field hidden** in the form when a reduced-shank tool is loaded.
- **Default stickout** for reduced-shank QTR3 tools: DB lookup against closest standard QTR3-RN SKU first, then QTR3, then fallback to taper geometry formula (`LBS + taper_length + 0.52 × shank_dia`). Taper length computed from 30° included / 15° half-angle geometry. Prevents collet from landing inside the taper zone.

### DOC Defaults — Conservative Starting Points
- **Slot mode** always defaults to `low` DOC preset. User adjusts up from there.
- **Tools ≤ 0.125" diameter** always default to `low` DOC across all modes. Small tools break, not bend.
- **HEM DOC cap by flute count**: 3-flute = 1.5×D, 4-flute = 2.0×D, 5+ flute = 3.0×D. Previous flat 3×D cap was wrong for small-diameter 3-flute tools.
- **Slot DOC preset buttons** now use `getDynamicPresets()` output instead of hardcoded flat values — buttons and displayed value now match.

### Multi-Axis Machine Save Fix
- Multi-axis spindle fields (`sub_spindle_rpm`, `live_tool_rpm`, `live_tool_hp`, `live_tool_taper`, `mill_spindle_rpm`, `mill_spindle_hp`, `mill_spindle_taper`, `live_connection`, `live_drive`) were lost on quick-save due to missing DB columns and incomplete payload. Fixed: migrations add all 9 columns; `saveMachine()` sends all 25 fields.

### Toolbox — Team Sharing Note
- Added team sharing info note below the Toolbox header with a "connect your team →" link that opens the Teams tab.
- "Connect to a team" link color updated to cyan so it's visible against the dark header.

### PDF Clear Button
- **All Clear buttons** (inline banner clear + Reset All at bottom) now fully reset special tool state AND all form fields that were auto-populated from the PDF (tool dia, LOC, LBS, shank dia, flutes, corner condition, corner radius, coating, variable pitch, variable helix, helix angle). Previously the inline Clear only dismissed the banner without clearing fields.

### Torque Zone Card
- **Spindle HP/torque database audit** — corrected ~80+ machines where peak/S6 ratings were stored as continuous (S1). Affected machines: all 51 Haas mills (21 HP → 30 HP corrected), Fanuc Robodrill MiB5 series, Brother Speedio, Yasda, Grob G750, Heller MCH 350/400, B+W MCX, DMG Mori NTX mill-turn series, and all 218.8 ft-lb placeholder values on machining centers.
- **Two-segment torque model** — flat constant-torque zone below `peak_torque_rpm`, hyperbolic falloff above. `base_torque_ftlb` sanity-checked against expected value at rated RPM.
- **`machine_max_rpm` and `machine_peak_torque_rpm`** added to response schema and passed through to UI.
- **Torque curve confidence footnote** — shown only for `high` and `medium` confidence; hidden for `low`.

### Low-RPM Machine Fit Warning (Torque Card)
Fires when the recommended RPM is < 20% of the machine's max RPM, tool ≤ 1.5", and material is not aluminum.

- **Case A** (targetDia ≥ 3/8"): suggests a specific smaller standard tool size with RPM and utilization % at that size.
- **Case B** (targetDia < 3/8", SFM ceiling constraint): shows both 3/8" and 1/4" RPM and utilization % so the user can see the trade-off. Explains the machine's sweet spot is higher-SFM materials.
- Aluminum suppressed — high-RPM machines (Makino MAG, etc.) running 3/4"–1" 2-flute aluminum tools are intentional.
- Tools > 1.5" suppressed — large inserted/shell mills are always intentional.
- **Stability advisor diameter suggestion suppressed** when Case A low-RPM warning is active, to avoid conflicting advice ("downsize" vs "increase diameter").

### High-RPM Balance Advisory (Torque Card)
- Fires at **≥ 10,000 RPM** — shown in blue (informational).
- Standard language (10k–17,999 RPM): G2.5 balanced toolholders required, confirm assembled tool+holder meets G2.5 at this RPM.
- Escalated language (≥ 18,000 RPM): both holder and tool must be balanced together after final assembly.
- Notes Weldon flat holders are asymmetric by design and should be avoided above 10,000 RPM.

### Stale Results Notification
- **Floating yellow pill** (fixed bottom-center, z-50) appears when form inputs change after a calculation. Shows "Inputs changed" with a Re-run button. Disappears while a calculation is pending.

### Reconditioning / ROI Tab
- Regrind messaging updated: "~50% of new tool price — a properly reground edge can **exceed** new tool performance" (not just match).
- **Download Brochure** link added inline — serves `Reconditioning Brochure (260214).pdf` from `client/public/`.
- **Shipping address** shown below the reconditioning section: Core Cutter LLC · 120 Technology Dr · Gardiner, ME 04345.

### Mill-Turn / Multi-Axis Machine Support
- **A/B/C-axis spindle selector** — active spindle axis drives workholding list, spindle specs (HP, RPM, taper), and engine payload.
- **B-axis milling spindle** — `mill_spindle_rpm`, `mill_spindle_hp`, `mill_spindle_taper` columns added; B-axis workholding list scoped to turning-center chuck options.
- **Sub-spindle toggle** — `sub_spindle_rpm` column; sub-spindle workholding list (collet chuck, hydraulic chuck, power chuck, 3-jaw).
- **Live tool spindle** — `live_tool_rpm`, `live_tool_hp`, `live_tool_taper`, `live_connection`, `live_drive` columns.
- **19 mill-turn machines** added to catalog with A/B/C-axis spindle data.
- **Workholding lists** tiered by suitability per axis: A-axis (full turning center list), B-axis (chuck options only), C-axis (milling suitability tier).
- **iJAW / autoCHUCK** workholding options added for DMG Mori mill-turn machines.
- **Zero-Point / RockLock and Pyramid Fixture** added for 5-axis trunnion setups.

### Speeder (Speed Increaser) Support
- Speeder input: ratio (e.g. 4×), max input RPM, max output RPM, and max torque.
- Engine uses lower of HP-derate or torque limit. Taper fallback validation — invalid CAT40 fallback for A2-x spindle nose fixed.

### Materials System
- **N1 / N2 ISO split** — N2 = abrasive non-ferrous (manganese bronze, silicon bronze, copper beryllium, dark green #558B2F). Engine routes N2 through P-Max/steel tool chain.
- Added `manganese_bronze`, `silicon_bronze`, `copper_beryllium` as N2 abrasive non-ferrous materials.

### Micro-Tool Feed Limiter
- Replaced crude IPM caps on small tools (≤ 0.125") with a multi-factor feed limiter. Machine-limited RPM setups no longer over-penalized.

### Machine Management
- Machine management (add/edit/delete) moved to Toolbox. Mentor page is read-only picker.

### What's New Announcement System
- Floating "What's New" announcement panel with per-release notes and seen-state tracking.

### Job # and Part Name Tagging
- Saved applications in Toolbox support Job # and Part Name tags for easy retrieval.

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
| `tailstock` | boolean | Tailstock/live center in use — applies 3.5× deflection limit boost (simply-supported beam) |

### Response Structure (`MentorResponse`)

- **`customer`** — RPM, SFM, feed IPM, MRR, HP utilization, FPT, status notes
- **`engineering`** — cutting force (lbf), deflection, chip thickness, chatter index, teeth_in_cut, engagement_angle_deg, tool life estimate
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
| `stainless_15_5` | 15-5 PH (XM-12) | 260 | 0.0037 |
| `stainless_ph` | 17-4 PH (630) | 235 | 0.0035 |
| `stainless_13_8` | 13-8 Mo PH (XM-13) | 214 | 0.0033 |
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

### Tailstock Rigidity Boost

When **Tailstock / Live Center** is checked, the deflection limit is multiplied by **3.5×** (simply-supported beam model). Stickout reduction suggestions are suppressed. Visible for trunnion, chuck, face plate, and between-centers workholding setups.

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
