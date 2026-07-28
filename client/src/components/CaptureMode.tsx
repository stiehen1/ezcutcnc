import React from "react";
import {
  captureElements, captureRect, findCaptureTarget, unionRect, HIDE_DATA_CLASS,
} from "@/lib/capture";

type Mode = "pick" | "drag";

/**
 * Catalog screenshot tool (admin only). Two ways to grab a shot:
 *
 *  - Pick mode: click a section; shift-click more to add them, and everything
 *    selected exports as ONE image spanning the whole group.
 *  - Drag mode: drag a rectangle for regions that don't follow element edges.
 *
 * Generic rather than per-card on purpose — the sections worth capturing aren't
 * known up front, and most are inline JSX with no component boundary.
 */
export default function CaptureMode() {
  // Admin-only: internal catalog-production tool, not a user feature. Same
  // signal the Admin page uses — sessionStorage token set after the server
  // validated it against ADMIN_PASSWORD.
  const [isAdmin, setIsAdmin] = React.useState(
    () => !!sessionStorage.getItem("admin_token"),
  );

  // Sign-in happens on /admin, possibly in another tab, so re-check on focus
  // and storage events rather than latching at mount.
  React.useEffect(() => {
    const check = () => setIsAdmin(!!sessionStorage.getItem("admin_token"));
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
    };
  }, []);

  const [armed, setArmed] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("pick");
  const [hideData, setHideData] = React.useState(false);
  // Rectangle mode captures EXACTLY the dragged region. An earlier version
  // adjusted the edges outward to element boundaries; it repeatedly moved edges
  // the user had placed deliberately — pulling in neighbouring cards and cutting
  // off content inside the rectangle — so the region is now used verbatim.
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  // Hover preview + accumulated selection (pick mode)
  const [hover, setHover] = React.useState<DOMRect | null>(null);
  const [picked, setPicked] = React.useState<HTMLElement[]>([]);
  const [pickedRects, setPickedRects] = React.useState<DOMRect[]>([]);

  // Drag rectangle (drag mode)
  const [drag, setDrag] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const hoverElRef = React.useRef<HTMLElement | null>(null);
  const depthRef = React.useRef(0);
  // Drag anchor + a busy mirror, both kept out of state so the drag listeners
  // never need re-registering mid-gesture.
  const anchorRef = React.useRef<{ x: number; y: number } | null>(null);
  const busyRef = React.useRef(false);

  const refreshRects = React.useCallback((els: HTMLElement[]) => {
    setPickedRects(els.map(e => e.getBoundingClientRect()));
  }, []);

  const clearSelection = React.useCallback(() => {
    setPicked([]); setPickedRects([]); setHover(null); depthRef.current = 0;
  }, []);

  // Ctrl+Shift+S toggles. Gated on admin so the shortcut isn't a back door.
  React.useEffect(() => {
    if (!isAdmin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setArmed(a => !a);
      }
      if (e.key === "Escape") { setArmed(false); clearSelection(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAdmin, clearSelection]);

  React.useEffect(() => { if (!isAdmin) setArmed(false); }, [isAdmin]);
  React.useEffect(() => { clearSelection(); setDrag(null); }, [armed, mode, clearSelection]);

  // Keep outlines glued to their elements while the page scrolls or reflows.
  React.useEffect(() => {
    if (!armed || !picked.length) return;
    const sync = () => refreshRects(picked);
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [armed, picked, refreshRects]);

  const runCapture = React.useCallback(async (fn: () => Promise<{ width: number; height: number }>) => {
    setBusy(true);
    busyRef.current = true;
    setNote("Rendering…");
    try {
      const { width, height } = await fn();
      setNote(`Exported ${width}×${height}px @ 300 DPI`);
      clearSelection();
    } catch (err) {
      setNote(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      busyRef.current = false;
      setTimeout(() => setNote(null), 4000);
    }
  }, [clearSelection]);

  // Local date + time, so successive exports on the same day don't collide in the
  // downloads folder. Deliberately not toISOString(): that reports UTC, which
  // would read as the wrong time on a shop-floor file.
  const filename = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `corecut-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
           `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  const exportPicked = React.useCallback(() => {
    if (!picked.length || busy) return;
    runCapture(() => captureElements(picked, { hideData, filename: filename() }));
  }, [picked, busy, hideData, runCapture]);

  // ---- Pick mode ----------------------------------------------------------
  React.useEffect(() => {
    if (!armed || mode !== "pick") return;

    const resolve = (e: MouseEvent): HTMLElement | null => {
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!under || under.closest("[data-capture-ui]")) return null;
      let t = findCaptureTarget(under);
      for (let i = 0; i < depthRef.current && t?.parentElement; i++) {
        t = findCaptureTarget(t.parentElement);
      }
      return t;
    };

    const onMove = (e: MouseEvent) => {
      const t = resolve(e);
      hoverElRef.current = t;
      setHover(t ? t.getBoundingClientRect() : null);
    };

    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest("[data-capture-ui]")) return;
      e.preventDefault();
      e.stopPropagation();
      const t = hoverElRef.current;
      if (!t || busy) return;

      // Shift accumulates; plain click replaces the selection.
      setPicked(prev => {
        const next = e.shiftKey
          ? (prev.includes(t) ? prev.filter(p => p !== t) : [...prev, t])
          : [t];
        refreshRects(next);
        return next;
      });
    };

    const onAlt = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      e.preventDefault();
      depthRef.current = e.shiftKey
        ? Math.max(0, depthRef.current - 1)
        : depthRef.current + 1;
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onAlt, true);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onAlt, true);
    };
  }, [armed, mode, busy, refreshRects]);

  // Enter exports the current pick selection.
  React.useEffect(() => {
    if (!armed || mode !== "pick" || !picked.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); exportPicked(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, mode, picked, exportPicked]);

  // ---- Drag mode ----------------------------------------------------------
  // The drag anchor lives in a ref, NOT in state: `drag` state changes on every
  // mousemove, and if the effect depended on it the listeners would be torn down
  // and re-registered mid-drag — resetting the in-progress flag and collapsing
  // the rectangle to a dot.
  React.useEffect(() => {
    if (!armed || mode !== "drag") return;
    document.body.classList.add("cc-capture-dragging");

    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest("[data-capture-ui]")) return;
      e.preventDefault(); e.stopPropagation();
      anchorRef.current = { x: e.clientX, y: e.clientY };
      setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    };
    const onMove = (e: MouseEvent) => {
      const a = anchorRef.current;
      if (!a) return;
      e.preventDefault();
      setDrag({ x0: a.x, y0: a.y, x1: e.clientX, y1: e.clientY });
    };
    const onUp = (e: MouseEvent) => {
      const a = anchorRef.current;
      if (!a) return;
      anchorRef.current = null;
      const x0 = Math.min(a.x, e.clientX);
      const y0 = Math.min(a.y, e.clientY);
      const w = Math.abs(e.clientX - a.x);
      const h = Math.abs(e.clientY - a.y);
      setDrag(null);
      if (w < 8 || h < 8 || busyRef.current) return;   // ignore stray clicks
      const region = new DOMRect(x0, y0, w, h);
      runCapture(() => captureRect(region, { hideData, filename: filename() }));
    };

    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      anchorRef.current = null;
      document.body.classList.remove("cc-capture-dragging");
    };
  }, [armed, mode, hideData, runCapture]);

  // Render nothing for non-admins. After all hooks so hook order stays stable.
  if (!isAdmin) return null;

  const selectionUnion = pickedRects.length ? unionRect(pickedRects) : null;
  const dragRect = drag
    ? new DOMRect(
        Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1),
        Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0),
      )
    : null;

  return (
    <>
      {/* Hide-calculated-data rules, applied only while rendering. */}
      <style>{`
        /* While dragging a region, stop the browser from text-selecting the
           page underneath — highlight-blue would otherwise land in the shot. */
        body.cc-capture-dragging, body.cc-capture-dragging * {
          user-select: none !important;
          cursor: crosshair !important;
        }
        .${HIDE_DATA_CLASS} .font-mono.font-semibold,
        .${HIDE_DATA_CLASS} [data-capture-value] {
          color: transparent !important;
        }
        /* SVG dimension callouts. Targeted by element rather than by
           font-family attribute: html-to-image inlines computed styles onto
           the clone, so attribute selectors stop matching mid-render. */
        .${HIDE_DATA_CLASS} svg text[data-capture-value],
        .${HIDE_DATA_CLASS} svg text.cc-value {
          fill: transparent !important;
        }
      `}</style>

      {/* Launcher — matches the existing right-edge vertical tab pattern. */}
      <button
        data-capture-ui
        onClick={() => setArmed(a => !a)}
        className="fixed right-0 z-[60] text-white text-[11px] font-semibold px-2 rounded-l-lg shadow-lg transition-colors flex items-center justify-center"
        style={{
          writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)",
          top: "calc(50% - 232px)", height: 74,
          background: armed
            ? "linear-gradient(180deg,#f36f21,#c2540f)"
            : "linear-gradient(180deg,#3f3f46,#27272a)",
        }}
        aria-label="Catalog capture"
      >
        {armed ? "Capturing" : "Capture"}
      </button>

      {armed && (
        <>
          {/* Dim everything except the live selection/hover. */}
          <div className="fixed inset-0 z-[65] pointer-events-none" style={{ background: "rgba(0,0,0,0.25)" }} />

          {/* Already-picked sections */}
          {pickedRects.map((r, i) => (
            <div
              key={i}
              className="fixed pointer-events-none z-[70]"
              style={{
                left: r.left - 2, top: r.top - 2, width: r.width + 4, height: r.height + 4,
                border: "2px solid #f36f21", background: "rgba(243,111,33,0.10)",
              }}
            />
          ))}

          {/* Union outline showing exactly what the exported frame will cover */}
          {selectionUnion && picked.length > 1 && (
            <div
              className="fixed pointer-events-none z-[69]"
              style={{
                left: selectionUnion.left - 8, top: selectionUnion.top - 8,
                width: selectionUnion.width + 16, height: selectionUnion.height + 16,
                border: "1px dashed rgba(243,111,33,0.75)",
              }}
            />
          )}

          {/* Hover preview (pick mode) */}
          {mode === "pick" && hover && (
            <div
              className="fixed pointer-events-none z-[71]"
              style={{
                left: hover.left - 2, top: hover.top - 2,
                width: hover.width + 4, height: hover.height + 4,
                border: "2px dashed #fbbf24",
              }}
            />
          )}

          {/* Live drag rectangle — this outline IS the exported region. */}
          {dragRect && (
            <div
              className="fixed pointer-events-none z-[71]"
              style={{
                left: dragRect.left, top: dragRect.top,
                width: dragRect.width, height: dragRect.height,
                border: "2px solid #f36f21", background: "rgba(243,111,33,0.12)",
              }}
            />
          )}

          {/* Control strip */}
          <div
            data-capture-ui
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] bg-zinc-900 border border-orange-500/50 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-4"
          >
            <div className="text-[11px] leading-tight">
              <p className="font-semibold text-white">Catalog capture</p>
              <p className="text-zinc-400">
                {mode === "pick" ? (
                  <>Click a section · <span className="text-zinc-300">Shift</span>+click adds more · <span className="text-zinc-300">Alt</span> widens</>
                ) : (
                  <>Drag a rectangle — captures exactly what you outline</>
                )}
              </p>
            </div>

            {/* Mode switch */}
            <div className="flex rounded-lg overflow-hidden border border-zinc-700">
              {(["pick", "drag"] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-[11px] font-semibold px-2.5 py-1 transition-colors ${
                    mode === m ? "bg-orange-500 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                >
                  {m === "pick" ? "Sections" : "Rectangle"}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={hideData}
                onChange={e => setHideData(e.target.checked)}
                className="accent-orange-500"
              />
              Hide values
            </label>

            {mode === "pick" && (
              <button
                onClick={exportPicked}
                disabled={!picked.length || busy}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:hover:bg-orange-500 text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                {busy ? "…" : picked.length > 1 ? `Export ${picked.length} as one` : "Export"}
              </button>
            )}

            {picked.length > 0 && (
              <button onClick={clearSelection} className="text-[11px] text-zinc-500 hover:text-white">
                Clear
              </button>
            )}

            <button
              onClick={() => { setArmed(false); clearSelection(); }}
              className="text-zinc-500 hover:text-white text-sm leading-none"
              aria-label="Exit capture mode"
            >✕</button>
          </div>

          {note && (
            <div
              data-capture-ui
              className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-[11px] text-orange-400 shadow-xl"
            >
              {note}
            </div>
          )}
        </>
      )}
    </>
  );
}
