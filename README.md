# CoreCutCNC — Machining Mentor by Core Cutter LLC

A full-stack Machining Mentor for CNC shops and sales engineers. Calculates speeds, feeds, depths of cut, cutting forces, deflection, stability, and tooling recommendations across milling, drilling, reaming, feed milling, threadmilling, keyseat, and dovetail operations. Deployed at [corecutcnc.com](https://corecutcnc.com).

Each operation includes a **How to Use panel** (step-by-step navigation for the app) and a collapsible **Machining Tips & Tricks accordion** (shop-floor best practices per operation type).

---

## Recent Updates (August 2026)

### Part overhang fields now say what to measure — the d⁴ trap made explicit
`Part Overhang Past Jaws` and `Part Diameter at Overhang` asked for two numbers and explained neither, and real parts are stepped shafts, plates and weldments rather than simple rods. The intuitive pick for the diameter — the big chucked-up end — is the **dangerous** one: `I = π·d⁴/64`, so entering 2.000" on a part that necks to 1.000" tells the model there is **16× less flex** than there is, and that is the whole safety margin.
- **New collapsed "Part isn't a simple rod? What exactly to measure" note** under the diameter field, following the existing cut-off-OAL disclosure pattern (`▸/▾`, amber, collapsed by default since simple rounds don't need it). Covers the five cases that actually come up: stepped shaft (thinnest section between jaws and cut, wherever the neck sits), cutting *before* the step (thin section beyond the cut isn't carrying bending), plate/web (thickness in the direction the tool pushes — a 4"×0.5" web resists sideways like a 0.5" member, not a 4" one), tube (model assumes solid, so entering OD reads softer than reality — safe direction), and casting/weldment (thinnest load-carrying section, ignoring bosses and ribs that don't span the bending path).
- **Overhang sub-label corrected** to state it's measured to the **cut location**, not the end of the part — as a cut walks toward the free end the effective overhang grows, so the deepest point of the pass is the right input.
- **Diameter tooltip rewritten** to lead with "thinnest section between the jaws and the cut, not the chucked-up end" instead of the old solid-round-only "smallest diameter along the overhang".
- **Two honest limitations stated in the note** rather than left for the user to discover: the diameter also sizes overhung *mass* assuming a solid cylinder, so a heavy flange on a thin neck reads slightly optimistic on chatter even when entered correctly; and "when unsure, go smaller" is called out as the direction that errs toward a safer feed.

### Weldment stock condition now moves the numbers instead of just annotating them
Selecting **Weldment** derated nothing you'd notice. The condition's ×0.55 SFM / ×0.70 IPT rendered only as a "first pass" footnote under the headline, because the whole stock-condition feature is client-side presentation (`stock_condition` is absent from `shared/routes.ts` and from `legacy_engine.py`, so the engine returns identical numbers for Billet and Weldment). That framing is also wrong for a weldment: weld hardness is **spatially localized** (bead + ~0.25" HAZ), not a skin you break through and leave behind, so "first pass then steady-state" doesn't describe the cut at all.
- **New "This cut" sub-row for Weldment**, mirroring the Case Hard skin/through pattern: **Crosses** / **Near HAZ** / **Clear**. Crossing the joint or running alongside it promotes the derated SFM/IPM/RPM to the **headline**, with steady-state demoted to subtext — the reverse of the old presentation.
- **Near-HAZ gets a partial derate, not a binary.** Hardness tapers with distance from the fusion line, so metal near a bead is elevated but short of weld-metal hardness. `WELD_NEAR_DERATE_FRAC = 0.5` interpolates the tabulated multipliers toward 1.0, landing at **SFM ×0.78 / IPT ×0.85** — inside the 75–85% band the Calculators weldment guide already quotes for the HAZ, while Crosses stays at ×0.55 inside its 50–60% across-bead band. No second multiplier table.
- **Defaults to Crosses**, and re-seeds to Crosses on every Weldment selection, so a stale `Clear` from an earlier part can't silently suppress the derate.
- **Nine duplicated `case_hard && case_strategy === "skin"` conjunctions collapsed** into shared `derateIsHeadline()` / `derateWording()` / `effectiveSkinIptMult()` helpers, so the live KPIs, chip-thickness card, advisory box, PDF, setup sheet, and email text all follow one rule. Fixed along the way: the PDF's Stock Condition row hardcoded "first pass" and printed the **raw** table multipliers rather than the effective ones, and the text export's "If into core" / "First Pass" labels read as case-hard framing on a weldment.
- **Two gaps surfaced rather than silently papered over.** The advisory now states that force, deflection, and tool life are still computed off **parent-metal hardness** — a self-quenched 45+ HRC HAZ won't reach `hardness_life_mult` or the HRC≥55 hard-milling flag unless you enter that hardness — and the input panel now carries the **distortion** warning (rough, let it relax, then finish; confirm PWHT), which previously existed only in the Calculators guide and never reached the person running the calc.

### "Pro Tips" is now "How to Use" — and it stops going stale when you switch tabs
The panel is a step-by-step walkthrough, not a collection of cutting wisdom, and its name was working against it. Renamed, retitled, and fixed a staleness bug that made it show the wrong page's instructions:
- **The pinned panel no longer shows stale content.** With the panel open, switching Tool Finder → Toolbox swapped the page but left the old instructions on screen — you had to close and reopen it. Root cause was a non-reactive data source, not a stale initializer: `HelpButton` derived its content by reading `localStorage.getItem("cc_operation")` *during render*, and it mounts as a **sibling of `<Router />`**, so `setOperation` inside `Mentor` re-rendered only Mentor's subtree. Reading localStorage doesn't subscribe, so the panel never re-ran — and since it's conditionally rendered (`{open && …}`), close→reopen was the only thing that re-read it. Fixed by mirroring the existing `calc_count_updated` pattern: `Mentor` now dispatches **`cc_help_context_changed`** from the same effects that write `cc_operation` / `cc_tool_type` / `cc_mode`, and `HelpButton` holds that context in state behind a listener. The setter bails when all three values are unchanged so unrelated form edits don't re-render a pinned panel. This also fixes Endmill ↔ Chamfer Mill and surfacing / deep-pocket mode switches, which had the same bug.
- **Tab renamed `Pro Tips` → `How to Use`**, with the vertical rail height bumped 74 → 86 to fit, plus the two walkthrough strings that pointed at "the Tips button".
- **All 14 panel headers now read "Steps to Navigate the X Calculator"** (Endmill, Chamfer Mill, Drilling, Reaming, Thread Milling, Keyseat, 3D Surface Contouring, High-Feed Milling, Dovetail, Deep Pocket / Thin Wall, plus Tool Finder / Toolbox / Misc Calculators). The hardcoded `— Tips` suffix in the header JSX is gone.
- **"Mentor" removed from user-facing copy** — 9 strings across the help sections, walkthrough, and Tool Finder's "← Back to Calculator" link. Internal identifiers (`Mentor.tsx`, `useMentor`, `/api/mentor`) are untouched.

### Tool Finder instructions rewritten against the actual UI
The Tool Finder guide described a page that doesn't exist. Step 1 was "Quick Search — type into the search bar, results update instantly as you type"; there is no free-text search on that page at all, and results never update live. Rewritten as 6 numbered steps matching the real controls:
- **The two paths are now stated up front.** A "Two ways in — pick one" section: unsure what you need → **Step 1 Quick Pick** (the guided Material › Operation › Diameter › Depth of Cut wizard); already know your configuration specs → skip to **Step 2 Filters**. Quick Pick only pre-fills the filters below it, so either entry point works.
- **Real labels throughout** — `Product Category` is required before anything else unlocks, and the Part Feature Match fields use em dashes and `(in)`: `Min. Part Radius — Wall to Wall (in)`, not `Min. Part Radius (Wall to Wall)`. `Use Tool →` lives in the `Insert into Speed & Feed` column; the STP button is `⬇ .STP` under `3D Model`.
- **"You must press Search Tools"** is called out in yellow — results do not refresh as filters change, which the old copy implied.
- Added the results-reading step: `Filters:` / `Part Match:` chips, the `Close Match` and `CB` / `VXR` badges, ☆ favorites, and the 200-result cap.

### Material, machine, and holder steps say what actually moves the numbers
Three operation-guide steps were thin enough to be misleading, and the fixes apply across all operations that share the copy:
- **Step 3 Select Your Material** now documents both entry paths (search a grade then hit **Match**, or browse the ISO chips then **Grade**) and walks the rest of the section in screen order: **Stock Condition** (including the Case Hard → "This cut" sub-row), the **Powder Metal (PM / Sintered)** modifier with Density and Sinter-hardened, **Hardness** HRC/HRB, and the **Heat-treat condition** quick chips that appear only on 17-4, 15-5, 13-8 Mo, and D2. Note the control is labeled **Stock Condition**, not "Material Condition", and grade search does not filter as you type.
- **Step 4 Set Your Machine** now says the saved machines carry their **spindle power and torque curves** — the reason to pick your real machine over a generic one. Verified against `server/routes.ts`, which pulls per-machine `base_torque_ftlb` / `peak_torque_rpm` / `curve_confidence` and runs a two-segment model (flat torque below peak RPM, HP×5252/RPM above) to produce the available-vs-required torque zone. Coverage is **744 of 834 machines**, so the copy says "the saved machines carry" rather than "all".
- **Step 5 Tool Holder** leads with **Dual Contact** in yellow — if you run Big-Plus holders and don't hit that button, you're leaving performance on the table. Notes it sits under the spindle taper and doesn't appear for HSK/CAPTO, which are inherently dual contact.

---

## Recent Updates (July 2026)

### Export copy corrected — and the last live email gate removed from Tool Finder
The tips still said "your email is required for all exports," which stopped being true when exports opened to all registered users. Correcting the copy turned up a real gate still in the code:
- **Four stale strings fixed** — the Exports tip, the Milling and Specials section blurbs, and a walkthrough step note. All now say exports are open to all registered users.
- **Tool Finder was still email-gating STP downloads.** The Mentor's gate had been reduced to a pass-through (`requireEmail` → `runGatedAction`), but `tfRequireStp()` in Tool Finder still checked `localStorage.er_email` and popped an "Enter your email to download" modal when it was empty — so the same STP file was free in one place and gated in another. `tfRequireStp()` now opens the file directly; the modal and its four state hooks are deleted.

### Pro Tips — real calculator order, a pinned panel, and the two sections that were missing
The Pro Tips guide is numbered 1-N as a walkthrough, but the numbers no longer matched the form they describe. Fixed, plus the panel now stays put:
- **Steps now follow the actual fill-in order.** Set Your Machine had drifted *after* Cut Engagement; the real flow puts machine, holder, coolant and workholding first, then tool, then engagement. New order: Tool Type → Process → Material → **Set Your Machine → Tool Holder → Coolant → Workholding → Enter Tool Info → Cut Engagement → Tool Entry** → Calculate.
- **Tool Entry was never documented at all** — the last major section of the form had no tip. Added, and it leads with the thing that isn't obvious: **the entry chips are multi-select**, and every strategy you check gets calculated and shown side by side for comparison. Also covers the ★ recommended marker and why Straight Plunge is reference-only.
- **Cut Engagement now says to hit Optimal first.** The old text claimed the app sets default WOC and DOC — only sometimes true, and many times the fields start blank, which made the tip actively misleading. It now points at the Optimal presets as the starting point, and documents that **DOC takes three input styles: a preset, a typed decimal (0.375), or a percentage of tool diameter typed as `XX%` (150%)** — the `%` form was undocumented.
- **The panel stays illuminated while you work.** It was a full-screen overlay that closed on any outside click and reset on navigation, so reading tip 9 while filling field 9 meant reopening it every time. It's now a pinned side panel with no backdrop (`pointer-events-none` shell, `pointer-events-auto` panel) — the form stays clickable underneath — and open state persists in `localStorage` (`cc_protips_open`) across remounts and page changes. Closes only via ✕, or when another side tab takes over.
- **Machine count corrected to 800+** across all 9 operation guides (was 429).

### Tapered ballnose prints — taper angle read both ways, truncated ball tip Ø, and a geometry backstop
A CC-14877 tapered ballnose upload (Ø0.0993 tip, 24.0° cone, .649 LOC, Ø.375 shank, SS 13-8MO at 42-45 HRC) came back with the tip diameter 26% oversize and the cone angle doubled. Three extraction rules were wrong, and the fix puts geometry — not prompt wording — in charge:
- **The taper angle is called out BOTH ways, so nothing may assume one.** The rule said Core Cutter prints give the angle *per side* and to "DOUBLE almost every taper angle", with only a soft "reconsider" escape. But this print dimensions `24.0°` **across both flanks** (vertex ahead of the tip, witness lines on the two opposite profile lines) — already the included angle. Doubling produced 48°. The prompt now branches on where the dimension is anchored: centerline-to-one-flank is per-side, across-both-flanks is included, plus the explicit `PER SIDE` / `INCLUDED` text cases.
- **A geometry backstop now overrides the model either way.** The taper body sits below the shank, so `base_dia = tip + 2·tan(included/2)·length` **must** be ≤ shank Ø. At 48° this print gives base 0.677" on a 0.375" shank — physically impossible; at 24° it gives 0.3752", a 0.0002" match. The server halves the angle only when it overshoots by >5% **and** halving lands materially closer, so a legitimately-doubled per-side angle is left alone. Converges on 24° from either direction and logs when it corrects.
- **An explicit tip Ø beats 2×R.** The rule said `tool_dia = 2 × tip ball radius`, so `R.0625 BALLNOSE` → 0.1250". On a tapered ballnose the ball is **truncated** where it blends into the cone, so the real cutting tip Ø is *smaller* — this print states it directly as `Ø0.0993 TSC`. The 26% overstatement inflated RPM and chip load. Tip Ø now wins when present; 2×R is the fallback, and R still goes to `corner_radius`.
- **"TSC" is two different dimensions, told apart by the Ø symbol.** `Ø0.0993 TSC` is the tip **diameter**; `1.00+.06/-.00 TSC` is the reach **length** → `lbs`. Only the length form had ever been taught, which is why LBS came back empty here (correctly — this print has no length TSC).
- **`taper_length_in` may be the LOC.** The old rule demanded the longer dimension "NOT the LOC", which fought a print whose cone spans the full fluted length. When the taper *is* the flute length, `.649 LOC` is the answer; inventing a longer dimension that isn't drawn is not.
- **Shop-validated result:** 149 SFM / 9,500 RPM on 13-8 PH at 42-45 HRC, confirmed correct — the first real validation of the 13-8 curve, which had shipped as an estimate. (The run still trips the min-chip-thickness warning: a Ø0.0993 tip at 0.10×D axial gives 0.00033" FPT, which is rubbing territory — advisory, not a calculation error.)

### Tapered-tool UI — print-driven, no checkbox, and no more truncated dimensions
- **The "Tapered ballnose / tapered-neck tool" checkbox is gone.** Core Cutter makes no standard tapered SKUs, so it was never a user choice — there is no catalog tool to check it for. The block now only renders when an uploaded print actually says tapered, arriving with the angle and length already filled and badged **CUSTOM — FROM PRINT**. Fields stay editable to correct a misread print.
- **Stale taper state can no longer leak onto a straight tool.** `clearPdf()` reset tool dia, LOC, LBS and corner radius but never `is_tapered`, and EDP selection scrubbed other per-print flags while leaving taper behind — so clearing a print, or typing a standard EDP after one, kept applying the stiffer cantilever model and **under-reported deflection**. Both paths now reset the flag, the angle, and the length. This matters more now that visibility *is* the flag.
- **Tool-dimension fields no longer truncate.** The row used `flex: 1 1 3.5rem`, so columns shrank to fit and clipped mid-number — `3.250"` rendered as `3.` in the LBS box. Replaced with an auto-fit grid (`minmax(4.75rem, 1fr)`), wide enough for a 6-character value like `0.0993`; the row wraps to a second line before anything clips. LBS had also been the only column with no flex-basis at all, which is why it lost every distribution round.
- **Cut Dia and Shank Dia now show four decimals everywhere** — catalog autofill, PDF extraction, and saved-run restore all formatted shank Ø to three places, so a row read `0.5000` next to `0.500`. Display only; stored precision is unchanged.
- **Removed a duplicate OAL column** — a legacy read-only `pdfOal` field rendered beside the editable `oal_in` the extractor already fills, showing OAL twice on every print upload.

### Spindle-taper diameter cap applied app-wide, and wide slots stop returning zero tools
A 1.5" × 2.0" slot on a 40-taper machine offered **no traditional picks at all** and a 1" tool under HEM. Two separate causes, plus a ranking bug the fix exposed:
- **The taper cap only covered two of six recommenders.** `TAPER_MAX_ENDMILL_DIA` was enforced in the stability step-up and the pocket sequencer, but the table had been copy-pasted per call site and four other places that recommend a diameter had no cap at all: the slot diameter chips (client *and* server), `/api/optimal-tool`'s "next diameter up", the engine's "Switch to HEM / trochoidal" picker, and the dovetail pre-rough. Now **one shared helper** — `taperMaxEndmillDia()` in `server/routes.ts`, `taper_max_endmill_dia()` in `legacy_engine.py`, plus a client mirror — used by every recommender. A CV40 caps at 3/4"; the HEM picker that said 1.2500" now says 0.7500".
- **The cap has to be applied *before* "largest that fits", not after.** The traditional branch took the last two rungs of the diameter ladder ≤ slot width, which for a 1.5" slot is 1.25" and 1.5" — sizes the spindle can't hold *and* the catalog doesn't stock (it tops out at 1.0"). Both EDP queries came back empty and the panel rendered nothing. Capping first yields 5/8" + 3/4", where 139 tools are stocked.
- **Catalog-aware fallback.** The cap alone doesn't cover a 50-taper (cap 2.0", catalog 1.0"), so when no ladder rung has stock the server now asks the DB for the largest diameters actually stocked under the ceiling. Self-correcting if 1.25" tooling is ever added.
- **`spindle_taper` was missing from the fetch effect's dependency array**, so switching machines left the panel holding EDPs keyed to diameters it no longer offered — keys didn't match, every chip looked unstocked, and the list went empty.
- **HEM now ranks the smaller tool first.** The Z-step tie-break was `largest diameter first`, which is right for traditional (fewer plow passes) but backwards for trochoidal: MRR there is radial WOC × DOC × feed, not diameter, so once two tools clear the slot in one Z-level the **cheaper** one does the same work — which is exactly why shops reach for a smaller tool in HEM. Stiffness demoted to the last sort key.
- **Truncation no longer collapses to one diameter.** `slice(0,3)` on a diameter-ordered list always cut the runner-up Ø, so a 1.5" slot showed three 3/4" cards and no 5/8". The top 2 now come from the leading Ø and the 3rd from the next, so the size choice stays visible alongside the variant choice.
- **Scope note, per shop feedback:** the cap is about the **solid shank the spindle grips**, so it applies to endmills only — *not* keyseat/slotting cutters, dovetails, T-slot or woodruff, where a 1" head rides a 1/2" arbor and the taper never sees the 1". Those run through `run_keyseat()`/`run_dovetail()`, which don't consult the table; the constraint is documented in all three copies so a future recommender gates on arbor Ø, not cutting Ø.

### Slotting suggestions — three ranked picks with a why-this-tool card, not a wall of chips
The slotting panel offered up to **seven** tool chips in a wrapping grid, laddering down through diameters nobody would pick (a 0.438" slot listed 3/8", 5/16" *and* 1/4" variants). It now presents **three numbered picks** in a vertical stack, and hovering one explains why you'd choose it:
- **One diameter, its real variants.** Traditional full-width slotting has a single right diameter — the largest that fits — so the ladder is gone. The choice that matters is the *variant* at that diameter, and the dedupe key changed from `flutes+geometry` to `geometry+necked` to expose it. At one diameter every traditional candidate is a 4-flute, so the old key collapsed to two classes and the plain endmill was **structurally unable to appear** — it shared a signature with the reduced-neck and lost on the shorter-LOC tie-break. A 0.438" slot in 13-8 now returns exactly `403321C` (chipbreaker), `403321` (standard), `403621N` (reduced-neck).
- **Full spec on every row.** `EDP 403321C · VST4-M-0375-R030-CB` over `4fl CB · Ø0.375 · SH 0.375 · LOC 1.25 · OAL 3 · R.030 · A-Max`, so a pick can be judged without cross-referencing the catalog. The one-per-line layout is what makes the numbering read as a ranking — a wrapping grid reflowed #1/#2/#3 into arbitrary rows.
- **Hover card explains the trade-off instead of repeating the specs.** Each card leads with a *reach for this when…* line, then ✓ advantages and ⚠ trade-offs derived from geometry, reach, and material — "segments the chip, a deep slot packs on one long ribbon", "necked body reaches 1.625″ — depth a full-shank tool this length can't", "thin neck is the weak point". Bullets are **sibling-gated**: a feature every pick shares decides nothing and is suppressed, so the prose stays about choosing. Capped at 4 pros / 3 cons, most-decisive first.
- **Feature chips state what the tool *has*, unconditionally.** Sibling-gating the prose meant a feature all three picks shared (variable pitch across three VST4s) was never named anywhere — product knowledge, not a tiebreaker. A chip row now always lists `Var pitch` / `Var pitch + helix`, `Chipbreaker`, `Reduced neck`, oversized shank, corner and coating, each with a tooltip explaining the mechanism. **Fixed pitch is spelled out** rather than left blank (the column has zero NULLs across 3,931 SKUs, so absence really means false, and silence read as missing data — the whole AL2/AL3 family plus FEM5 is fixed-pitch).
- **Center cutting surfaced for the first time.** The `center_cutting` column existed but reached neither the query, the payload, nor the UI. `NOT center cutting` now shows as an amber chip plus a prose bullet — *"can't plunge or ramp in; needs a pre-drilled entry or an open slot end"* — and is **exempt from the con cap**, since a tool that physically can't enter a closed slot shouldn't have that truncated by a display limit. Affects the CMH chamfer mills and VMF11.

### Slotting — QTR3 leads at ≤1/4", and HEM fills gaps by stock, not by diameter
Two ranking rules that were wrong in opposite directions:
- **QTR3 now outranks the 4-flutes at 1/4" and below** (was tied, which left the VST4s on top by score and hid the stiffer tool behind them). On a small tool the shank is what fails, not the flute count: a QTR3 carries a full **0.250" shank at every diameter down to 1/16"**, so against a matched-shank 0.125" VST4 its section above the flutes is `(0.250/0.125)⁴ = 16×` stiffer. Three flutes also leave a *larger* core than four at the same cutter Ø. The VST4 stays as #2/#3 for its chipbreaker option and extra tooth. QTR3 is keyed as its own variant class so promoting it doesn't evict the plain VST4.
- **HEM's QTR3 exemption is no longer a diameter threshold.** It was `≤0.125"`, which was wrong both ways: it injected a 3-flute at 0.125" where **29 five-flutes are stocked**, and left 0.15625" and 0.21875" with no HEM pick at all. The gaps aren't small diameters — they're the *odd* sizes. A correlated `NOT EXISTS` probe now admits the QTR3 only where **no 5-flute exists at that Ø**, so it fills 0.0625"–0.1094", 0.15625" and 0.21875" automatically and never competes with a VST5. Self-correcting as the catalog changes.
- **The tool-choice note follows the picks instead of contradicting them.** It hardcoded "run a 4-flute with a corner radius" for all ferrous with the QTR3 as a trailing footnote, so a 0.124" slot opened with advice for a tool that wasn't offered and wasn't on screen. The note now reads the rendered picks and leads with the QTR3 whenever it's #1, naming the VST4 as the alternate when one exists at that size. Material-aware throughout — in 13-8 it explains the corner radius as abrasion resistance and pitches the chipbreaker for chip control, lower torque and part pressure.

### Slotting — LOC/LBS +0.060"/-0.000" grind tolerance credited against cut depth
A nominal **1.25" LOC in a 1.250" slot** was treated as unable to reach, so the panel warned *"⚠ Tool LOC can't reach the 1.250" slot depth in one pass — plan ~2 axial Z-steps… or load a longer-LOC tool"* on precisely the tool that's correct for the job, and the ranking demoted it in favour of a longer, floppier one.

Both LOC and LBS are ground **+0.060"/-0.000"**, so nominal is the guaranteed *minimum* — actual lengths run 0.000–0.060" longer, never shorter. A tool at (or up to 0.060" under) the cut depth therefore clears it in one pass. Applied at all seven comparison sites — `reachRank`, `locRank`, `zStepsFor`, `reachesDepth`, `overhang` on the server; the Z-step badge, RN-reach badge and loaded-tool reach warning on the client — via a single `LOC_PLUS_TOL` constant on each side. One-sided on purpose: never credit more than the tolerance guarantees. Verified across the boundary: 1.240"–1.310" keeps the 1.25" LOC tool, 1.350" correctly steps up to the 1.50".

Also: the LOC tie-break was `ASC`, which preferred the *stubbiest* tool at every tie and ordered the reduced-necks arbitrarily. It's now **shortest LOC that clears the depth** (flute length past the floor is stickout bought for nothing) and **shortest neck that still reaches**.

### Fixes — slot-width input, stale picks across strategy, dropped payload columns
- **Typing a new slot width no longer makes the panel thrash.** A state-clear added to the fetch effect fired on every committed width change, blanking the three pick rows and refetching — so they vanished and reappeared while the number was still being edited, shifting row heights under the cursor and making the field feel like it was rejecting input. The clear now keys on **strategy only**, which is the case it was written for.
- **Slot width and depth commit on Enter, not just blur.** The value only reached `form.slot_width_in` on blur, so typing a width and going straight to Run left the picks and the note describing the *old* width.
- **Flipping Traditional → HEM no longer leaves 4-flute cards under the HEM heading** for the debounce window, which read as the engine recommending a 4-flute for HEM (it never would — the ferrous HEM filter is ≥5 flutes).
- **The client rebuilt each chip field-by-field**, silently dropping every column added server-side (`description1`, shank, OAL, corner condition, variable pitch/helix, center cutting) — the spec line and hover card would have rendered blank with no error anywhere. Same whitelist trap as the SKU upload's `coerceRow()`; it now spreads the server row.
- **Catalog sizes like 0.28125 and 0.09375 displayed as 0.2813 / 0.0938** — a rounded number beside the tidy 0.375 and 0.25 on neighbouring cards, which reads like a data error. Dimension formatting widened to 5 decimals before trimming zeros.

### Pocketing sequencer — sharp-floor pockets crashed the lookup
The Progressive Reach Sequence card returned **"Sequence lookup failed"** on every pocket run with **Floor Radius blank or 0** — the common case, and precisely the sharp-floor path the square-finisher work below was written to enable.

Splitting the corner-coverage query into square-end and filleted branches left the square-end branch with **no `$1`/`$2` placeholders**, while the `pool.query()` call underneath still bound two values (`corner_radius`, `floor_radius`). Postgres rejects a bind supplying more parameters than the statement declares:

```
bind message supplies 2 parameters, but prepared statement "" requires 0
```

The throw hit the endpoint's catch-all, which returns a generic error string — so the real cause never reached the UI. The square-end branch now references both parameters in an always-true guard, keeping the placeholder count matched in either branch. Filleted-floor pockets were never affected.

### Traditional slotting — QTR3 buried by the flute sort, not filtered out
QTR3 chips appeared for full-width ferrous slotting at 0.21875", 0.15625", 0.109", 0.0937", 0.078" and 0.0625" but **never** at 0.250", 0.1875" or 0.125". The flute filter wasn't the cause — traditional ferrous is `flutes <= 4`, which a 3-flute passes. The **ordering** was:

`ORDER BY ... ABS(s.flutes - 4) ASC, score DESC ... LIMIT 12`

Distance-from-4 puts every 4-flute at rank 0 and QTR3 at rank 1. The catalog stocks **18 four-flute tools at 0.125", 21 at 0.1875" and 59 at 0.250"** (ISO P), so `LIMIT 12` was consumed entirely by 4-flutes and no QTR3 row was ever fetched. The odd sizes worked only because **zero** 4-flute tools exist there, leaving QTR3 as the sole candidate.

Three changes: QTR3 ≤0.250" now **ties with the 4-flutes at rank 0** (rather than being exempted from the ordering, so score and reach still choose which QTR3 EDP wins); the fetch limit went **12 → 40**; and the 2-per-Ø signature dedupe — which filled both slots with 4fl CB + 4fl standard — now **reserves QTR3 an extra chip** instead of replacing either, so the 4-flute pair is still shown alongside it. Verified against the live catalog on a 0.375" ISO P slot:

| Ø | chips |
|---|---|
| 0.250" | 401021C 4fl CB · 401611 4fl std · **Q2502R QTR3 3fl** |
| 0.1875" | 400111C 4fl CB · 400911 4fl std · **Q1872R QTR3 3fl** |
| 0.125" | 410211C 4fl CB · 410811 4fl std · **Q1253R QTR3 3fl** |

Nothing above 1/4" changes, and the aluminum (`flutes IN (2,3)`) and HEM paths are untouched.

### Pocketing — square finishers for square corners, and the QTR3 line unlocked
Two independent tool-selection bugs in the pocketing sequencer.

**The corner finisher could never be a square end mill.** The end condition was chosen by diameter (`dia < 0.250` → ball) and the fallback branch banned `square` outright, so a pocket with a **sharp floor-to-wall corner** was handed a ball nose — which leaves a radius you then have to clean out. The end condition now follows the part geometry: **Floor Radius blank or 0 → sharp floor → square end**; Floor Radius set → corner-radius tool closest to that value, ball only as a fallback when no CR is stocked at that diameter.

**The entire QTR3 line was invisible to ferrous pocketing.** The roughing filter was a flat `flutes >= 4`, and QTR3 is 3-flute — so every QTR3 was excluded at every diameter. Being P-Max, it was also blocked by the aluminum D-Max/A-Max coating filter on ISO N. QTR3 is now exempt from **both** filters below 0.250" on any material. This mattered more than it sounds: at 0.0625", 0.078", 0.0937", 0.109", 0.15625" and 0.21875" **QTR3 is the only ferrous end mill stocked** — those diameters previously returned nothing at all, so the sequencer had no small-tool option whatsoever. Below 1/4" you can't fit 4+ flutes with usable chip gullets; the 3-flute variable pitch/helix design is the answer there, not a compromise.

Variable pitch **and** variable helix is now a ranking preference in both finisher branches — the irregular tooth spacing disrupts regenerative chatter, which is the real limiter on a finish wall pass at reach. A sharp-floor 0.125" pocket in steel now picks **Q1252S** (QTR3-0125-2XD-SQ); with a 0.015" floor radius it picks **Q1252R**.

### QTR3 available for slotting in every material
QTR3 is built for all materials — all 102 QTR3 / QTR3-RN SKUs are flagged for every ISO category (N/P/M/K/S/H) in the catalog — but the **HEM ferrous/titanium** slot filter required 5+ flutes, so the 3-flute series was excluded. HEM aluminum was already fine. Traditional slotting *passed* QTR3 through its filters (upper bounds: `<= 4` / `<= 5` / `IN (2,3)`) but still didn't surface it at the three diameters where 4-flute tools exist — see the flute-sort fix above, which was a separate bug in the ordering rather than the filter.

QTR3 under 0.250" is now exempt from the HEM ferrous/Ti flute floor in **both** slotting paths — the diameter chips the user taps and the optimal-tool scorer that ranks them, so the two agree. This mattered most where the catalog has no alternative: at **0.0625", 0.078", 0.0937", 0.109", 0.15625" and 0.21875" there is no 5+ flute tool stocked at all**, so HEM ferrous slotting returned an empty list at those sizes. Diameters that already had 5-flute options keep them and simply gain QTR3 alongside (0.250": 156 + 11, 0.1875": 56 + 14, 0.125": 29 + 11) — nothing was displaced.

Unchanged: the 5+ flute rule for HEM ferrous/Ti generally, 3-flute for HEM aluminum, and the engine's `slot_doc_ceiling` limit of 0.5×D for a 5-flute in a full slot (0.4×D titanium).

### D2 tool steel — defaults to ANNEALED, with an HRC-driven SFM curve
D2 defaulted to **58 HRC**, but most shops mill D2 in the **annealed** state (~20–25 HRC), leave a finishing allowance, and heat treat to 58–62 HRC afterward. The default is now **22 HRC** and the plausible range widened from 58–64 to **18–64 HRC**.

The bigger fix is underneath: `tool_steel_d2` sits in `_NO_HRC_PENALTY`, so its flat `BASE_SFM` of 180 was served **regardless of the hardness entered** — and 180 SFM is an *annealed* number (the 140–220 band). Anyone actually hard-milling D2 was handed roughly 2× the correct speed. New `d2_sfm_absolute(hrc)` curve, mirroring `hardened_sfm_absolute`:

| HRC | SFM | Note |
|---|---|---|
| ≤30 (annealed) | 180 | unchanged from before — the default path |
| 45 | 135 | partially hardened / under-tempered |
| 55 | 105 | |
| 58–62 (hardened) | 96 → 85 | normal hardened service band |
| >62 | → 60 floor | past spec; CBN/grinding territory |

D2 sits **below** plain hardened steel of equal HRC across the range because the limiter is chromium-carbide abrasion, not just matrix hardness. Wired into all six SFM surfaces — milling, chamfer, drilling, keyseat, dovetail, feedmill — largely via one branch inside `apply_sfm_hardness` (`apply_d2_hardness` scales each per-op table off its own annealed anchor, so no per-op curves to maintain). Two related corrections:
- **HEM boost** now tames to 1.3× only above 45 HRC; annealed D2 is genuinely chip-limited and keeps the full 2×.
- **Tool-life SFM ratio** compares against the curve, not the flat table — otherwise hardened D2 (96 actual vs 180 table) read as "running slow" and reported *longer* life.

UI: D2 joins the `PH_CONDITION_HARDNESS` condition-chip row (Annealed / Hardened 58 / 60 / 62) — one tap fills the HRC and the active state is always visible, so the label can't contradict the field. Annealed output is byte-identical to before (180 SFM / 1375 RPM / 17.7 IPM @ Ø0.5" 4fl). **The 45–62 HRC anchors are estimates** in the same spirit as the existing hardened curves, not bench-validated.

### Chamfer feed — tip-starvation derate for a point cutting in material
Chip load on a chamfer mill is scaled to **body** diameter, because that's where manufacturers rate it, and `D_eff` deliberately drives only RPM. But that full body-scaled chip is then applied at *every* point along the engaged edge — including points whose local diameter, and therefore local surface speed, is near zero. A CMS point cut at the tip has the bottom of its cut at Ø0.000": it can't cut at 0 SFM, it plows, and handing it a full chip load is how the point snaps off.

The trigger is **not** saddle-vs-tip and **not** CMS-vs-CMH — it's how small the smallest cutting diameter in the cut actually is. If it falls below `TIP_STARVE_FLOOR_FRAC` (15%) of body diameter, feed is derated toward `TIP_STARVE_MIN_MULT` (0.35) on a softened sqrt ramp. On 17-4 PH:

| Case | RPM | Feed | Derate |
|---|---|---|---|
| CMS Ø0.375 at tip | 3709 | 10.96 IPM | **×0.35** |
| CMS Ø0.375 saddled | 2910 | 24.57 IPM | full |
| CMH Ø0.500 saddled | 2346 | 40.64 IPM | full |
| CMH Ø0.500 at tip | 2717 | 47.06 IPM | full |

That last row is why the diameter framing matters rather than a series rule: a CMH cutting on its tip *flat* has real diameter to cut with (Ø0.080 = 16% of body), so it needs no special-casing and keeps full feed. Saddled cases — the ones that genuinely need good feed — are untouched. Only a true point in the dead zone is penalised, and it says so in the notes rather than derating silently. Swept 108 geometry combinations to confirm no case trips both this and the existing `CMH_MIN_CHIP_FRAC` "too light, tip flat will rub" warning, which would be contradictory advice.

**Both constants are UNCALIBRATED** — reasoned from SFM-at-radius, not bench-validated, and labelled as such in the source.

### Chamfer geometry card — vertical true-angle diagram + tip-clearance question
The chamfer card's geometry diagram was drawn on its side, with the tool horizontal and the part represented by a bare line. It's now a vertical section: tool plunging down, cutting a chamfer on the top corner of a hatched part block, laid out with the drawing on the left and a colour-coded dimension list on the right (each swatch matches the element it labels). The part's chamfer face is built from the same endpoints as the engaged span of the cutting edge, so its width tracks the Chamfer Length input instead of being fixed.

**The drawn included angle was wrong at 120°.** The drawing is isotropic, so the angle only renders true if the axial run is `radial_reach / tan(half_angle)` with neither axis independently clamped — and the axial run *was* clamped to a pixel range. At 120° the floor bit and drew 118.1°; with a tip flat it drew **102.7°**, off by 17°. Inverted the construction: fix the axial budget, then solve for the OD half-width. Verified exact across 60/82/90/100/120° × three tip-flat fractions. The included angle is now called out on the drawing, with both flanks extended to their virtual apex on the centerline (below the tip flat on CMH) and an arc swept between them — a real measurement, not decoration.

Two geometry corrections fell out of the rebuild: a CMS point runs axially **longer** than a CMH that stops at a tip flat (both were drawn at one length), and an `H`-prefixed EDP is a CMH tool by definition, so the tip flat now draws from the EDP even when `tip_diameter` is missing from the record.

**Tip clearance now drives D_eff, and therefore RPM.** Saddling — centering the cut on the edge for tool life and finish — assumes the tip can hang below the finished chamfer. On a shallow boss, a chamfer sitting on a floor, or with an obstruction underneath, it can't. A new `chamfer_edge_position` field (`saddle` | `tip`) asks about the *part* ("Is there room for the tool to hang below the chamfer?", explicit Yes/No — a bare checkbox left it ambiguous which way meant which) rather than asking the user to pick a machining strategy.

This is not cosmetic. A chamfer mill's diameter varies continuously along the cutting edge, so where the cut sits sets the effective cutting diameter. `run_chamfer_mill` previously measured `d_eff` straight up from the tip in all cases — correct only for the no-clearance case. On 17-4 PH, Ø0.500", 90°, 0.150" chamfer: **2346 RPM saddled vs 2717 RPM at the tip**, same 270 SFM. The engine's "saddle the tool / shift Z up" tip is now conditional, since telling someone to shift Z up right after they've said there's no room for it is wrong advice.

### Catalog screenshot capture — 300 DPI print exports (admin only)
An internal tool for pulling app screenshots into the printed catalog. Toggle it from the **Capture** tab on the right edge (or `Ctrl+Shift+S`), then either click sections or drag a region. Output is a bordered PNG at a genuine 300 DPI — 3pt `#f36f21` on black, matching the catalog page — named `corecut-<date>_<HHMMSS>.png` so same-day exports don't collide.

Two selection modes, because catalog figures rarely line up with one element. **Sections** resolves the card under the cursor by visual boundedness (a border or non-transparent background at a usable size) rather than a class allowlist — this app has no single card-container convention, and the chamfer geometry card in particular is inline JSX with no component boundary to hang a button on. Shift-click accumulates, and the export spans the union of everything selected, so a geometry card + its input + the note below it come out as one continuous image. **Rectangle** captures exactly the dragged region, for figures that don't follow element edges. `Hide values` blanks computed numbers for a blank-form figure.

Gated on the same `sessionStorage.admin_token` the Admin page uses, across all three entry points — the tab, the keyboard shortcut, and a force-disarm if the token disappears mid-session. This is UI gating, not a security boundary: the tool only reads already-rendered DOM and writes a local PNG, so there's no privileged data behind it.

Users get a separate, much smaller path: a **Grab from screen** button in the feedback panel, next to the existing *Attach image*. The feedback form already accepted base64 screenshots with a 3 MB cap, so this only had to fill the same state — it drags a region, renders at screen scale (not 300 DPI; print scale would be ~17× larger for no benefit in an email), and reopens the panel with the shot attached.

Implementation notes, all of which produced silently wrong output first:
- **Browsers write no physical-size metadata**, so a 4.17×-scaled PNG lands in InDesign as 72 DPI at 4.17× the intended size. `setPngDpi` injects a `pHYs` chunk after IHDR declaring 11811 px/m. The insert offset must be read from IHDR's declared length — a hardcoded guess produced a byte-length-plausible but corrupt file that passed an eyeball check and failed on placement.
- **Capture renders the VIEWPORT, not a containing ancestor.** Rendering an ancestor and cropping the region out of it is the obvious approach and it does not work here: the mentor's form container is ~3300px tall, which at 4.17× is a ~14000px canvas, and the crop consistently landed in the wrong place — content shifted sideways, edge text sliced mid-glyph. Rendering `document.body` clipped to the viewport (with a `translate` cancelling the scroll offset) keeps the canvas ~viewport-sized and makes the mapping trivial, since the selection is already in viewport coordinates. Trade-off: a selection can't extend past the visible window, which the drag UI already prevents.
- **`width`/`height` are not a windowing mechanism.** `applyStyle` sets them on the clone's own style, so they *resize and reflow* the element rather than cropping it — they only work as a canvas size when the element already matches that box.
- **`html-to-image` renders via an SVG `foreignObject`, which preserves CSS positioning.** An offscreen staging frame at `position:fixed; left:-10000px` draws its content outside the viewBox, yielding a correctly-sized rectangle of pure background.
- **The library copies *computed* styles onto its clone**, so no stylesheet rule can hide a value — the inlined style always wins. `Hide values` forces `fill`/`color` inline on the live nodes and restores them in a `finally`. SVG dimension callouts need a `data-capture-value` tag to be found; the chamfer card's `d=` and `L=` labels are tagged, and other SVG callouts will need the same one-attribute addition.
- **`skipFonts: true`** — the Google Fonts stylesheet is cross-origin, so reading its `cssRules` throws a `SecurityError` mid-render. Fonts render correctly from computed styles anyway.
- **Timestamps are local, not `toISOString()`.** The UTC form mislabeled any capture after ~7pm ET with the next day's date.

Verification is browser-driven (`playwright`, devDependency) and differential: each export is compared against a Playwright screenshot of the same region, with `sharp` asserting dimensions, non-blank content, and `density=300`. That comparison is what finally located the crop bug — several plausible diagnoses (canvas size cap, border overlap, stale bundle) were each disproved by measurement rather than inspection, and a synthetic test page without stylesheets produces empty renders that look like a library failure but aren't.

### STEP file catalog converted to inch units
All **3,595** downloadable tool models are now inch-unit STEP files, replacing the millimeter exports that had been live since April. Opening one in CAD no longer lands a 0.500" endmill as a 0.500 mm one.

The files are Cloudflare R2 objects served from `cdn.ezcutcnc.app`, not database rows — `ToolFinder` builds the URL from the EDP at request time (`Core_Cutter_<EDP> v1.step`), so identical filenames meant the swap needed no schema, code, or deploy change. R2 sends no `Cache-Control` on these objects and the edge reports `cf-cache-status: DYNAMIC`, so the overwrite went live immediately without a cache purge.

New `scripts/r2-step-upload.mjs` does the bulk replace — the R2 dashboard caps uploads at 100 files, so 3,595 needs the S3 API. Dependency-free Node with hand-rolled SigV4; credentials come from `$env:R2_ACCOUNT` / `R2_KEY` / `R2_SECRET` and are never written to disk. It issues only `ListObjectsV2` and `PutObject` — there is deliberately **no delete path**, because the same bucket holds ~750 MB of `.dwg`/`.dxf` companions that a mirroring `sync` would silently erase. Run `plan` before `upload`: it diffs local against live and names any live key your export doesn't cover, which would otherwise sit in the old units indefinitely. `verify` then re-reads a sample through the public CDN.

One verification note worth recording: an inch STEP file still contains an `SI_UNIT(.MILLI.,.METRE.)` entity, because inch is defined as a *conversion* from the SI base unit. The presence of `CONVERSION_BASED_UNIT('INCH',...)` is the signal — absence of `MILLI` is not. That entity also sits at a byte offset that varies per file, so a unit check has to read the whole file; a first-pass verifier that scanned only the leading 20 KB reported 15 correctly-converted files as metric.

### Tool Setup in Holder — reordered around the field people actually fill
The section opened with Cut-off OAL and Holder bore depth, which are the exception: most tools run at catalog length in a collet with no stop. Reordered top to bottom:
- **Actual Stickout leads**, with the available-shank line directly beneath it — the number that drives deflection is now the first thing in the section instead of the fourth.
- **Preferred / Minimum** follows as read-only reference for aiming that value.
- **Cut-off OAL + holder bore depth move last**, folded behind a collapsed *"Has this tool's shank been cut back to shorten stickout?"* toggle. It auto-opens whenever either value is already set, so a loaded setup never hides numbers that are in play. The seated-to-stop checkbox stays with bore depth (it means nothing without it) and still writes the stickout field above — a positive stop *determines* stickout rather than suggesting it.
- **The prompt names the real motive.** An earlier draft asked whether the shank was cut "to fit in holder," which had it backwards — a tool that physically won't fit is rare. Shops cut the shank on a **shrink fit** so the tool bottoms shallower and runs less stickout, which is exactly what the engine's own seated-on-a-stop step recommends (*"Cut 0.28″ off the shank end — 38% stiffer"*). The Cut-off OAL tooltip carried the same fitment framing and was rewritten to match.
- **"Shank in holder" → "Available shank length"** across the endmill, chamfer, and deep-pocket tool-card blocks. In a plain ER collet with no stop, only part of that length is actually clamped; the old wording claimed all of it was gripped.
- Actual Stickout now says **"Showing the preferred stickout — change it if your setup measures different"**, shown only while the field is still sitting on the pre-filled value. Nothing on screen previously disclosed that the number was a recommendation rather than a measurement.

### Fix — uploaded Preferred Stickout ignored by "Restore default" and the engine payload
Per-EDP stickout overrides are now authoritative everywhere. With the full catalog re-uploaded (3,597 of 3,931 rows carrying both columns; the 334 blanks are exactly the `-BLK` unground blanks), the *field* showed the uploaded preferred but three other consumers still recomputed it from the formula:
- **"Restore default" offered a number that disagreed with the field.** `resolveStickoutDefault()` takes the uploaded preferred as its 6th argument, but both main-form hint call sites passed only 5. With `prefOverride` undefined the early return was skipped and it fell through to the `minimum + 0.20×D` branch — so a Ø.375 tool with an uploaded preferred of **1.169"** offered to "restore" **1.120"** (1.045 + 0.075). The field was right because it reads `default_stickout_in` directly at SKU-select; the hint recomputes on every render, so the two numbers came from different sources. The uploaded preferred is now carried on the form as `pref_stickout_override` and passed at both sites.
- **The engine payload had the same omission — quieter and worse.** The `stickoutForPayload()` fallback (fires when `form.stickout` is 0) also dropped the argument, so deflection, stability, and the setup score would compute against the *formula* stickout while the UI displayed the uploaded one. No visible mismatch, wrong physics.
- **Stale per-tool overrides leaked onto specials.** The special/scanned-print path set `stickout_is_estimate` but never cleared `min_stickout_override` / `pref_stickout_override`, so picking a catalog tool and then loading a print quoted the *catalog tool's* shop-measured numbers as the special's. Both now reset to 0.

The formula remains the fallback for blank cells only: a filled cell always wins, and a cell that fails to parse stores as `NULL` (indistinguishable from blank downstream) — which is why the upload panel's parse warnings on the two stickout columns are worth reading every time.

### SKU catalog: snapshot/revert safety net, fraction parsing, unground-blank exclusion
- **Snapshots + one-click revert — the catalog had no working undo.** `sku_uploads` looked like version history but wasn't: the upsert sets `upload_id=EXCLUDED.upload_id` on every existing EDP, so rows are *reassigned* to the newest upload rather than copied. Live proof — the current upload owned 3,931 rows and **every prior upload owned 0**, meaning "Set Current" on an older one would have emptied the catalog. New `sku_snapshots` table stores the full row set as JSONB (~4 MB at 3.9k rows); a snapshot is taken **automatically before every upload**, and the upload result confirms its ID (or warns loudly if it failed, so there's never a silent gap). The admin panel gets a prominent **⟲ Revert last upload** button that finds the newest snapshot itself — no ID to look up when something's on fire — plus a quiet **↧ Take snapshot** for marking a known-good state and per-snapshot Restore for going further back. Restore runs in one transaction (a mid-restore failure can't leave a half-empty catalog) and snapshots the current state first, so reverting is itself undoable. Verified against live data by corrupting a row, reverting, and confirming it came back.
- **Fraction text in numeric columns was silently dropped.** Tool dimensions get typed the way the shop says them — `2 1/2`, `1-5/8`, `3/4` — and Excel stores those as *text*. `Number("2 1/2")` is `NaN`, so the cell landed as NULL. That's how 12 AL3-RN tools (303800/303801/303810/303811/303820/303821/303830/303831/303835/303836/303840/303841) lost a **2.500" LBS** and were then treated as standard tools with a stickout floor an inch shorter than their real reach. The parser now accepts mixed numbers, bare fractions, stray inch marks, and currency/comma formatting; re-uploading recovers those rows automatically.
- **Unreadable cells are now reported at upload time.** A filled cell that fails to parse reads downstream as "not supplied" rather than "we couldn't read it." The upload panel now lists every numeric column with unparseable values, a row count, and sample values, across 14 audited columns — so the next format surprise is caught before it goes live instead of months later.
- **Unground reduced-neck blanks excluded from recommendations.** `-RN` tools are ~90% finished with the **neck ground at time of order**, so until then there's no LBS/reach — 334 `-BLK` rows are in this state. Without LBS the app treated them as standard tools (e.g. `207830-BLK`: floor of LOC 1.125 + wash 0.759 = 1.884" against a real 3.000" reach) and they couldn't satisfy reach filters, so they'd be offered for jobs they can't do. They're now filtered out of Tool Finder options/search, slot sizing, and optimal-tool suggestions at 21 query sites. The gate keys on the **data condition** (`-RN` series with no LBS), not the `-BLK` suffix, so a tool becomes available the moment LBS is populated — no code change. Direct EDP lookup deliberately still finds them, so typing the EDP explains why rather than saying "not found".

### SKU upload: Excel (.xlsx) support, template download, per-tool stickout columns
The catalog upload now takes real Excel workbooks, and stickout can be specified per tool instead of always coming from the formula:
- **Upload accepts .xlsx / .xlsm as well as .csv.** Excel's *Save As CSV* writes the **displayed** value, not the stored one — a column formatted to 2 decimals silently turns `0.1094` into `0.11`, a plausible-but-wrong number nothing downstream can flag. The .xlsx path reads the numeric cell at full precision, so what's in the sheet is what lands in the database. Legacy `.xls` gets a clear "open it in Excel and Save As .xlsx" message instead of a silent failure. Uses `exceljs` (not SheetJS/`xlsx`, whose last npm release has unfixed advisories in its own parsing code).
- **Download-template buttons on the admin upload panel.** `↓ Template (.xlsx)` (recommended) and `↓ .csv` emit the full canonical column layout plus two worked example rows — one with the stickout overrides filled, one leaving them blank to show the formula fallback. The .xlsx version pre-formats the decimal columns wide (`0.0000` on diameter, `0.000` on lengths) so Excel can't re-round them on the way back out. Column **order doesn't matter** — rows are matched by header name and unknown columns are ignored.
- **Parsed-value echo before you commit to an upload.** After reading a file the panel lists EDP / Cut Dia / LOC / Flute Wash / Preferred SO / Minimum SO for the first few rows, with empty cells labeled `blank → formula`. Truncated decimals are visible immediately rather than a month later.
- **Field label and hint reworded around Preferred/Minimum.** The field is now **Preferred Tool Projection / Stickout**, and the line under it reads `Minimum stickout is 2.011"` — the minimum always shows because it's the operating limit, while the preferred value only appears once you've moved the field off it, as a clickable **`| Restore default 2.111"`**. Previously the hint said `Default 2.111" (shortest allowed 2.011")`, which repeated the number already in the box on every fresh tool pick. Same wording now on both stickout fields and the deep-pocket per-tool cards (whose restore clears that tool's override).
- **Special / scanned-print tools always get a preferred stickout, and never a fabricated minimum.** The extraction path was gated on both LOC *and* diameter being parsed, so a print that yielded a diameter but no LOC set **no stickout at all** and silently fell back to a payload default. It now needs only a diameter: reduced-shank tools use a QTR3 lookup then taper geometry, necked tools use `LBS + 0.20×D`, and a diameter-only print falls back to a conservative 3×D estimate. Because those values are *estimates* — `flute_wash` is itself estimated on a scanned print — there's no trustworthy hard floor, so the minimum is suppressed rather than invented: the hint reads "estimated from print dimensions; verify against the actual tool", the min clamp is disabled so a guessed floor can't block a value you know is right, and the engine adds a *"Stickout is estimated from the print"* note instead of a limit. A shop-measured `Minimum Stickout` override still wins. Fixes a case where a necked special would print `Minimum stickout = 0.000" (LBS — shank to neck)`.
- **Per-tool `Preferred Stickout` / `Minimum Stickout` columns.** Preferred pre-fills the stickout field; Minimum is the hard floor the type-in clamps to and the value the stability advisor targets when it says "shorten stickout". Blank cells fall back to the app-wide rule (preferred = minimum + 0.20×D), so the sheet can be filled in a series at a time. Shop-measured values win over the formula on purpose: on a stepped-shank tool (a small cutter on a bigger shank) the **shank shoulder can bottom on the collet before the flutes do**, so the geometric floor can read *shorter* than the tool physically allows — the direction that breaks tools. Wired through the hint line, both min-clamps, the engine payload, and `legacy_engine.py`'s `_min_so`.
- **Uploads now actually write the stickout columns.** `default_stickout_in` was never in the upload's INSERT or its `ON CONFLICT DO UPDATE` — previously-seeded values survived by accident rather than by design. Both stickout columns are now written and refreshed on re-upload, with blank cells stored as `NULL` (never `0`, which would read as "no minimum"). Also fixed: the client's `coerceRow()` is an explicit whitelist, so columns added server-side were silently dropped *before* the request was sent.
- **No `tool_type` column needed.** It's auto-derived (`chamfer_angle` > 0 → chamfer mill, else endmill), which covers the entire live catalog. Ballnose / corner-radius geometry is `corner_condition` (`square`, `ball`, or the CR as a number), not `tool_type`.

### Pocketing Strategy: pre-drill sizing, style-aware entry, per-tool stickout, multi-tool export
A batch of fixes to the multi-tool pocketing (deep-pocket) sequencer so the recommendation is internally consistent and the output is unambiguous:
- **Pre-drill diameter now clears the first endmill.** The recommended pre-drill used to snap *down* to a drill just under the pocket ceiling — which could be **smaller than the roughing endmill that has to drop into it** (e.g. a 0.6094" drill for a 0.625" tool, physically impossible). It now floors at `first-rougher dia × 1.05` and snaps *up* to the **next clean shop size — 1/16" for inch shops, next whole mm for metric** (driven by the app's unit toggle), so a 0.625" tool gets 0.6875" (11/16") or 17mm. Capped at the pocket ceiling, with a fallback to the tightest standard drill if a clean size won't fit. The Dia field auto-fills the recommendation as a placeholder, and the export prints a clear `≥Ø0.6875"` recommended-drill line.
- **HEM steps the bulk tool down one size on purpose.** HEM's light radial WOC lets a *smaller* tool clear the same pocket nearly as fast — and smaller carbide is cheaper, more available, and stiffer. For HEM the sequencer now picks **one stocked diameter below the largest that fits** (e.g. 0.625" → 0.500"), but only when a tool at that size still reaches its band at a sensible L/D (reduced-neck preferred — stiff thin neck, short LOC per band). If stepping down wouldn't reach, it keeps the larger size. Traditional is unchanged (heavier WOC wants the bigger, stiffer tool). A sequence note explains the smaller pick so it doesn't read as a bug.
- **Spindle-taper diameter cap.** The pocket sequencer is now taper-aware: **no 1" tool in a 40-taper.** `maxBulkDia` and the extended reach pool are bounded by what the spindle can hold (CAT40/BT40/HSK63 → 3/4"; CAT30/BT30 → 1/2"; CAT50/BT50/big HSK/Capto C8 → 2"), mirroring the stability engine's `TAPER_MAX_ENDMILL_DIA` table. The machine's taper is passed from the client with the sequence request.
- **No more false "607% chatter" on deep bands.** Deflection was modeled at the *full band depth* in one axial pass (e.g. 2.5" = 3.3×D) — a cut nobody runs, which produced a scary chatter flag that contradicted the card's own "step down by LOC per pass" note. Now the **per-pass axial DOC** is modeled realistically: HEM keeps the full flute depth (its light WOC keeps it stable — that's the whole point of HEM); **Traditional** in a closed pocket is really *slot-to-open then side-mill-to-widen*, so it branches on the pre-drill — with a pre-drill (no slot phase) it uses a side-mill per-pass ceiling (~2× the full-slot ceiling), without one it uses the shallower full-slot ceiling. The DOC cell now reads "DOC/pass X (N× to Y band)". MRR and total material removed are unchanged — only the modeled per-pass cut changed.
- **Per-tool and total cycle-time estimates.** Each tool card now shows an **Est. Time**, and a **Total Pocket Time** line sums the sequence. Roughers are volume-limited — `(footprint × unique depth slice) ÷ effective MRR`, with overlapping depth bands deduped so the pocket volume is counted once (no double-count). The finisher is a *finish pass*, which is feed-rate-limited, not MRR-limited — modeled as cutting **path length ÷ feed** (perimeter walls × axial passes + floor raster at finish stepover), assuming both wall and floor finish. All estimates add ~35% for non-cutting moves.
- **Chatter-risk mitigation tips.** When a pocket tool flags Chatter Risk (≥100% of the deflection limit), the card now shows a short, **actionable** list of ways to steady that specific tool, cheapest/most-effective first. The tips are toolpath-aware: on an **HEM** path WOC is presented as the primary lever ("leave the DOC alone — that's where HEM's MRR comes from") and reducing DOC is never suggested; on a **Traditional** path both WOC *and* DOC are offered as adjustable. The stickout tip only appears when the tool is above its minimum (it disappears once the tool is already as short as it can hold), and the box is suppressed entirely when every lever is already maxed. Amber for Chatter Risk, red with a "reduce before running" header at ≥175%.

### Stickout: one consistent default/minimum, app-wide (client + engine)
Standardized how tool stickout (gage length) is derived everywhere — the same rule in the React client and the Python engine, so the field default, the physics, and the "minimum stickout" advisor all agree:
- **Default (the practical working value the field/physics use):** `floor + 0.20×D` — a flat 0.20×diameter clearance buffer for both standard and reduced-neck tools.
- **Minimum (the hard floor you can't go below):** the bare floor with the buffer removed — `LBS` for reduced-neck tools (bury the shank right to the neck), `LOC + flute_wash` for standard tools (shank right up to where the flutes end).
- Replaces the old inconsistent mix (0.15×D vs 0.33×D flute-wash split, reduced-neck 0.5×D grip allowance) that differed between the field default and the minimum. New `stickoutFloor()` / `stickoutDefault()` helpers are the single source of truth on the client; `legacy_engine.py` `_default_so` and `_min_so` mirror them. Special tools with odd geometry (tapered reduced-shank, scanned prints) still estimate stickout from their scanned dimensions rather than this floor model.
- **Fixed: catalog tools dropped their flute wash, so the stated minimum was too short.** Picking a SKU auto-filled the stickout field correctly (it folded in `flute_wash`), but never wrote `flute_wash` onto the form — so the hint under the field, the type-in clamp, and the engine payload all computed the floor with wash = 0. On a Ø0.500" / LOC 1.250" / wash 0.139" tool (EDP 505221) the field read 1.490" while the hint claimed a 1.250" minimum, and the advisor's headline step said *"Shorten stickout to 1.25" — 69% stiffer"* — a length that buries 0.139" of flute wash in the collet. The true floor is **1.389"** (~22% stiffer), and the hint now agrees with the field: `Default 1.490" (shortest allowed 1.389")`. Affected every catalog tool with a non-zero wash and no `default_stickout_in` override (605221/605221C carry 0.153"). The deep-pocket cards read `tool.flute_wash` straight off the SKU and were never wrong.
- **The floor note now names the physical constraint, not the formula.** The advisor's minimum-stickout note read "(min — LOC+wash clearance floor)". It now states the actual limit the operator is up against: `(min — no flutes in the collet: LOC 1.250" + 0.139" flute wash)` for standard tools, `(min — shank to the neck, LBS 2.500")` for reduced-neck.
- **Pre-drill is its own "Step 0" box, above the tools.** The pre-drill instruction was buried at the bottom of the Sequence Notes. It's now a dedicated numbered box before the roughing cards — with the too-small-drill warning surfaced inline.
- **Entry preferences are now style-aware.** For an **HEM** pre-drilled pocket the XY-entry is Sweep / Roll-in only — the tool rolls tangentially out of the hole into trochoidal moves; Straight Radial (a full-width slotting breakout) is no longer offered because it defeats HEM. For a **Traditional** pre-drilled pocket the reverse: no Sweep (there's no open edge and it isn't trochoidal) — the tool steps radially out to the wall. The Z-entry note also clarifies it's just the roughers reaching the last ~5% of floor stock the drill left behind.
- **Per-tool stickout on each card.** Each tool in the kit has its own reach, so a single global stickout can't be right for all of them. Every tool card now shows its own reach-based default stickout and lets you override it per tool; editing it re-runs just that tool's physics.
- **Export now shows every tool's speeds & feeds.** The emailed/printed summary listed the full tool kit but only one tool's speeds & feeds. It now emits a per-tool Speeds & Feeds block (RPM/SFM/feed/WOC/DOC/MRR/HP/stability/stickout) for each tool, with the stability-trimmed feed folded in the way the on-screen cards show it.
- **"Enter an EDP to run" banner hidden in Standard-Tool pocketing.** In Standard mode the sequencer picks the kit from pocket geometry, so the "enter a Core Cutter EDP# / upload a PDF" prompt no longer shows (it still applies to Special-Tool mode).

### Stability suggestions: sensible, reasonable, and low-cost
Every "step to increase stability" should make sense, be reasonable for the setup, and not push unnecessary cost onto the shop. A batch of fixes toward that:
- **Flute-count swap now nets force against stiffness.** The "Use N-flute tool (same diameter)" step used to promise "~21% stiffer core → deflection drops" from core geometry alone. But deflection is *force ÷ stiffness*, and both rise with flute count: more flutes put more teeth in the cut, so radial force climbs ~proportionally. Going 7→9 flute is ~+21% stiffer core but ~+29% more engaged-tooth force — a **net ~6% *increase* in flex**. That's why a bumped flute count could drop the score instead of raising it. The suggestion now computes the net (force ÷ stiffness) and is **suppressed entirely when it doesn't actually reduce flex** (its feed/MRR upside still shows in speeds & feeds). Governing rule: a stability recommendation must never make the score go down.
- **Diameter step-up is taper-capped and need-gated.** The step-up now respects the machine's spindle taper — a **CV40 / 40-taper keeps 3/4" as its max recommended diameter** (never a 1" tool); 30-class caps at 1/2", 50-taper / big HSK / Capto C8 carry up to 2". It's also only offered when tool flex is actually the limiter (within 10% of the deflection limit or over) — no more pushing a bigger, pricier cutter when flex is already fine.
- **Reduced-neck step now names a real tool.** When a long, straight-body tool is flexing, the reduced-neck step now looks up an actual catalog EDP with enough reach and the **matching corner radius** (e.g. 407711N for a 0.03" CR job, not the square-corner 407701N), and sizes the short flute to the depth you actually intend to cut.
- **One holder recommendation, cheapest that solves it.** Instead of nudging you one holder up the list at a time — and separately listing a soft "consider a rigid holder" note and a Capto note — there's now a single holder step: the **most affordable, drop-in holder that brings flex within limit** (ER/HP collet, weldon, milling chuck, hydraulic, press-fit). Shrink-fit and Capto (which need a $10–20k shrinker + holder investment) are never the headline — they're mentioned as an "if you ever invest" aside so the option is visible without pushing a small shop to buy one.
- **"Feed already reduced for chatter" moved off the steps list.** It isn't an action — it's a confirmation that the shown feed is already trimmed. It now appears as a small note **on the Feed (IPM) tile** where the number lives, so the numbered steps are only things you can actually do.
- **Hover a step or a suggested tool to preview it; click to run it.** Each stability step now shows a Current-vs-Optimized chart on hover (Tool Flex / Force / MRR / Feed), with the dimension that changes colored — green when it improves, amber when it gets worse. Hovering a specific recommended EDP previews that exact tool; clicking it loads the tool and re-runs. Step previews come straight from the engine physics, so the preview matches the result.
- **Removed the separate "worth looking at too" tool banner.** It could recommend a longer or higher-flute tool while the stability panel said to shorten the LOC — a contradiction. The stability steps are now the single source of tool recommendations. (The printed-quote "Optimized" column is unchanged.)
- **Shorter-LOC step fixed — and knows when a reduced-neck is the real answer.** A shorter tool only needs enough flute to cover the depth of cut (LOC ≥ DOC), so it no longer over-specs LOC or offers a tool too short to reach the cut. It also checks grip: a shorter tool must still leave **≥ 1.5× the cutting diameter of shank in the holder** to hold onto — if no stock shorter tool can be gripped, it points you to the reduced-neck tool instead (full shank to grip, thin neck for reach, short flute for stiffness).
- **Reduced-neck tool chips now show LBS (reach).** The reach below the shank is the defining spec of a necked tool, so it's shown alongside dia / flutes / LOC on each suggested EDP.

### Drill SFM — full two-table recalibration + three bug fixes
Validated the drilling speeds against **two** shop references — one for **external/flood** coolant and one for **through-coolant** — which map cleanly onto the engine's two-parameter model: the per-material **base SFM is the external anchor**, and the **coolant-fed bonus** adds the through-coolant lift on top. Now the base matches the external reference *and* base×bonus matches the through-coolant reference, across P/M/K/N/S/H.
- **Bases re-anchored to the external-coolant reference low-end** (starting values; users push up via presets): e.g. 304/316 →100, 17-4 PH →90, duplex →70, mild steel →220, alloy →165, annealed tool steels →110, gray iron →250, ductile →200, bronzes →250, Ti-6-4 →70, Inconel 718 →40, hardened 45-52 HRC →80 / 52-60 HRC →50.
- **Coolant-fed bonus reshaped per material class.** Stainless & titanium now use a steeper `chip_limited_high` curve (≈1.50× at Ø.25 vs the old 1.36×) because coolant helps gummy/work-hardening chips even at small diameters — the through-coolant reference demanded that lift. **Heat-limited alloys (Inconel, hardened steel) no longer sit at a flat 1.0×** — the reference showed through-coolant genuinely raises their SFM band (Inconel 40→60-100 external→through), so they now get a modest climbing bonus (cap 1.5×), still pressure-scaled (full at TSC1000, 70% at TSC300).
- **Bug: hardened steel's `heat_limited` class was dead code.** The class entries for `hardened_lt55`/`gt55` were keyed by material-name but looked up by **group** (`Steel`), so hardened steel silently fell through to the full chip bonus. Moved to the material-keyed override table so the intended heat-limited curve actually applies.
- **Bug: `_NO_HRC_PENALTY` divergence in the drill path** (same class as the June feedmill/reaming fix). The drill path kept a narrower hardness-exclusion list missing `cpm_10v`, `stainless_440c/15_5/ph/13_8`, `duplex/superduplex`, `armor_*` — so those double-derated on hardness (CPM-10V delivered **12 SFM**, 440C **25 SFM**). Routed through the central `_NO_HRC_PENALTY` frozenset so it can't drift again.
- **Bug: 304 delivered only ~107 SFM** at Ø.236 (the case that kicked this off) — the base was an under-set external anchor. Now delivers ~147 @ Ø.25 / ~175 @ Ø.50, in the through-coolant band.

### Step-drill extraction fixes + pressure-aware coolant-through
- **Top-chamfer step drills now extract correctly.** Core Cutter makes a common family where the small tip Ø plunges a pilot hole and the *larger shank Ø* cuts a chamfer at the top of the hole — so the shank OD is the **largest cutting diameter** (governs SFM). On CC-13410 the extractor (a) mistook a bold **length** callout (`.3149`, no Ø) for the largest diameter, and (b) missed that the Ø.2362 shank is the largest cutting dia. Fixes: a new prompt rule requires a **Ø symbol** for anything to be treated as a diameter (a bare toleranced number near the cutting end is a length — step length, LOC, margin land — never a diameter), plus a worked step-drill example for the top-chamfer family.
- **Coolant-through now detected from geometry, not just notes.** A print with coolant-hole callouts, a bolt circle, or a coolant slot is now flagged coolant-fed even when the notes text is unclear.
- **TSC pressure now drives drilling speeds & feeds.** The through-coolant SFM bonus was calibrated on high-pressure (~1000 psi) internal coolant and silently assumed that pressure for every coolant-fed drill — so toggling TSC on the machine picker changed nothing. Now the bonus is **pressure-aware**: **TSC 1000psi** earns the full bonus (up to ~2× on large chip-limited drills), **TSC 300psi** keeps ~70% of the earned bonus, and heat-limited alloys (Inconel, hardened, Ti-beta) stay at 1.0× (coolant helps tool life, not speed). For a coolant-fed drill the coolant picker now shows **only TSC 300psi / TSC 1000psi** and the run is **blocked until you pick one** — the engine can't size feeds honestly without knowing the machine's pressure.

### Email results — verified sender, personalized "via Core Cutter", lead capture fix
- **Results emails weren't reaching some recipients** (notably corporate domains). Root cause: the `FROM_EMAIL` was `noreply@corecutterusa.com`, which was **not** a Brevo-verified sender — under the domain's `p=quarantine` DMARC policy, strict corporate mail gateways quarantined it. Domain authentication (SPF/DKIM/DMARC) was already correct; the From address was the problem. Now every outbound email sends from the verified sender (`scott@corecutterusa.com`), and three internal-notification paths that were sending from the raw Brevo SMTP login were switched to the verified address too.
- **Personalized sender.** When a registered user emails results, the message shows as **"[User] via Core Cutter"** (e.g. "Scott Tiehen via Core Cutter") with **Reply-To** set to that user, so it reads as coming from them. The identity is the registered user of the browser (`cc_user_name` + `er_email`, a matched pair), so it personalizes even when sharing a result to a colleague — not only when emailing your own address. The actual From address stays the authenticated sender (display-name only), so deliverability is unchanged. (Putting the user's own address in From would fail SPF/DKIM/DMARC — never done.) Falls back to the generic app sender on a fresh/unregistered browser. Display name is sanitized against header injection. Note: on a shared terminal the send is stamped with whoever registered that browser.
- **Lead-capture fix.** `/api/results/email` did a plain INSERT into `leads`, but `leads.email` is UNIQUE, so results-email activity for any previously-registered recipient silently failed to record. Switched to an upsert (`ON CONFLICT (email) DO UPDATE`).

### Fix — SFM hardness double-derate on feedmill / reaming / keyseat / dovetail
- The main milling, endmill and drilling paths skip the HRC-based SFM derate for alloys whose baseline SFM already reflects their hardened/aged condition (PH stainless, Inconel, Ti-6Al-4V, tool steels, hardened/armor steels) — otherwise the derate double-counts hardness. **Feed milling, reaming, keyseat, and dovetail were missing that exclusion**, so those ops ran those materials ~35–50% too slow (e.g. 13-8 PH @43 HRC feed-milled at 140 SFM instead of its 218 baseline). Centralized the exclusion into `apply_sfm_hardness()` / `_NO_HRC_PENALTY` and routed all four ops through it so it can't drift again.
- Also fixed a pre-existing crash in `run_dovetail` where `hrc` was read before assignment (UnboundLocalError for any part ≥35 HRC).

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
| `tool_steel_d2` | D2 (annealed ~20–25 HRC default; HRC-driven curve) | 180 | 0.0032 |

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
