import { toCanvas } from "html-to-image";

// ---- Catalog print spec ----------------------------------------------------
// The catalog background is black, so the border is Main Orange (#f36f21).
// Change BORDER_COLOR here if the catalog background ever changes.
export const CAPTURE_SPEC = {
  DPI: 300,
  BORDER_COLOR: "#f36f21",
  BORDER_PT: 3,          // 3pt @ 300dpi = 12.5px in the exported file
  PAD_PT: 9,             // breathing room between border and content
  BACKGROUND: "#000000", // matches catalog page
};

/** CSS px per point at a given DPI. A point is 1/72". */
const pxPerPt = (dpi: number) => dpi / 72;

/**
 * Browsers write PNGs with no physical-size metadata, so print software reads
 * them as 72 DPI — a 4.17x-scaled capture lands in InDesign at 4.17x the
 * intended size and someone has to rescale it by hand. This injects a pHYs
 * chunk declaring the real density so the file reports 300 DPI on placement.
 */
export function setPngDpi(pngBytes: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254); // pixels per metre
  const SIG = 8;                        // PNG signature length

  // Build the pHYs chunk: length(4) + "pHYs"(4) + data(9) + CRC(4)
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);                 // data length
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);               // x axis ppu
  view.setUint32(12, ppm);              // y axis ppu
  chunk[16] = 1;                        // unit specifier: metres
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Drop any pHYs the encoder already wrote, then insert ours right after IHDR.
  // IHDR is always the first chunk; read its declared length rather than
  // assuming 13, so the insert point is correct for any encoder.
  const stripped = removeChunk(pngBytes, "pHYs");
  const strippedView = new DataView(stripped.buffer, stripped.byteOffset, stripped.byteLength);
  const ihdrLen = strippedView.getUint32(SIG);
  const ihdrEnd = SIG + 12 + ihdrLen; // sig + (len 4 + type 4 + data + crc 4)
  const out = new Uint8Array(stripped.length + chunk.length);
  out.set(stripped.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(stripped.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** Walk the chunk list and drop every chunk of the given type. */
function removeChunk(bytes: Uint8Array, type: string): Uint8Array {
  const target = type.split("").map(c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keep: Array<[number, number]> = []; // [start, length] byte ranges to retain
  let pos = 8;
  keep.push([0, 8]); // signature
  while (pos < bytes.length) {
    const len = view.getUint32(pos);
    const total = 12 + len; // len + type + data + crc
    const isTarget =
      bytes[pos + 4] === target[0] && bytes[pos + 5] === target[1] &&
      bytes[pos + 6] === target[2] && bytes[pos + 7] === target[3];
    if (!isTarget) keep.push([pos, total]);
    pos += total;
  }
  const size = keep.reduce((n, [, l]) => n + l, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const [start, len] of keep) { out.set(bytes.subarray(start, start + len), o); o += len; }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Class applied to the clone while capturing, so CSS can hide computed values. */
export const HIDE_DATA_CLASS = "cc-capture-hide-data";

export type CaptureOptions = {
  /** Blank out calculated values (approximate — keys off value styling). */
  hideData?: boolean;
  /** Filename stem; ".png" is appended. */
  filename?: string;
};

/** Smallest rect enclosing all of `rects`, in viewport coordinates. */
export function unionRect(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map(r => r.left));
  const top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Nearest common ancestor of a set of elements. */
export function commonAncestor(els: HTMLElement[]): HTMLElement {
  if (els.length === 1) return els[0];
  let cur: HTMLElement = els[0];
  for (const el of els.slice(1)) {
    while (!cur.contains(el) && cur.parentElement) cur = cur.parentElement;
  }
  return cur;
}

/**
 * Render a viewport-space region to a bordered 300-DPI PNG and download it.
 *
 * Rather than relocating nodes into a frame (which fights React and breaks for
 * multi-element selections), this renders an ancestor that already contains
 * everything, then crops to `region` and draws the border on the output canvas.
 * Nothing in the live DOM is moved or restyled.
 */
async function captureRegion(
  source: HTMLElement,
  region: DOMRect,
  opts: CaptureOptions = {},
): Promise<{ width: number; height: number }> {
  const { DPI, BORDER_COLOR, BORDER_PT, PAD_PT, BACKGROUND } = CAPTURE_SPEC;
  const scale = pxPerPt(DPI);              // 4.1667 at 300dpi
  const borderPx = BORDER_PT * scale;      // true 3pt in the exported file
  const padPx = PAD_PT * scale;

  // Hide computed values, if asked. html-to-image copies COMPUTED styles onto
  // its clone, which beats any stylesheet rule we add — so the colour has to be
  // forced inline on the live nodes and restored afterwards. The class is still
  // applied for plain-HTML values where a stylesheet rule is sufficient.
  //
  // Scoped to `source` (the selection's container) rather than the whole page, so
  // values outside the captured region are left alone.
  const hid = opts.hideData;
  const restore: Array<() => void> = [];
  if (hid) {
    source.classList.add(HIDE_DATA_CLASS);
    restore.push(() => source.classList.remove(HIDE_DATA_CLASS));
    const marked = source.querySelectorAll<HTMLElement | SVGElement>(
      "[data-capture-value], .font-mono.font-semibold",
    );
    marked.forEach(node => {
      const prev = node.getAttribute("style");
      // SVG text paints with `fill`; HTML text with `color`. Set both.
      node.style.setProperty("fill", "transparent", "important");
      node.style.setProperty("color", "transparent", "important");
      restore.push(() => {
        if (prev === null) node.removeAttribute("style");
        else node.setAttribute("style", prev);
      });
    });
  }

  // VIEWPORT CAPTURE.
  //
  // Earlier versions rendered a containing ancestor and cropped the region out of
  // it. On this app that ancestor is the ~3300px form container, producing a
  // ~14000px canvas, and the crop consistently landed in the wrong place —
  // content shifted and edge text sliced. Rendering the page clipped to the
  // VIEWPORT instead keeps the canvas ~viewport-sized (about 5000x3750 at 300
  // DPI) and makes the coordinate mapping trivial: the selection is already in
  // viewport coordinates, so crop offsets are just region.left/top × scale.
  //
  // Trade-off: a selection cannot extend past the visible window. Capture mode
  // constrains the drag to the viewport, so that is not reachable in the UI.
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // Clip the clone to the viewport box. The body is shifted by the scroll offset
  // so the visible content lands at the canvas origin.
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  let full: HTMLCanvasElement;
  try {
    full = await toCanvas(document.body, {
      pixelRatio: scale,
      backgroundColor: BACKGROUND,
      width: vw,
      height: vh,
      style: {
        // Counteract the page scroll so the viewport's top-left is at 0,0.
        transform: `translate(${-scrollX}px, ${-scrollY}px)`,
        transformOrigin: "top left",
        margin: "0",
        // Body may be narrower/wider than the viewport; pin it so the clone's
        // layout matches what is on screen.
        width: `${document.body.scrollWidth}px`,
      },
      // Skip our own overlay chrome so outlines/toolbar never land in the shot.
      filter: (node) =>
        !(node instanceof HTMLElement && node.hasAttribute("data-capture-ui")),
      // The Google Fonts stylesheet is cross-origin, so reading its cssRules
      // throws a SecurityError mid-render. Fonts are already loaded in the page
      // and render correctly from computed styles, so skip the embed step.
      skipFonts: true,
    });
  } finally {
    // Always restore, even if rendering threw.
    restore.forEach(fn => fn());
  }

  // The canvas IS the viewport, so viewport coords map directly.
  const actualScale = full.width / vw;
  const cropX = region.left * actualScale;
  const cropY = region.top * actualScale;
  const cropW = region.width * actualScale;
  const cropH = region.height * actualScale;

  const outW = region.width * scale;
  const outH = region.height * scale;

  const out = document.createElement("canvas");
  out.width = Math.round(outW + (borderPx + padPx) * 2);
  out.height = Math.round(outH + (borderPx + padPx) * 2);
  const ctx = out.getContext("2d")!;

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = "high";
  // Source rect is in the render's scale; destination is at full 300-DPI size.
  ctx.drawImage(
    full,
    Math.round(cropX), Math.round(cropY), Math.round(cropW), Math.round(cropH),
    Math.round(borderPx + padPx), Math.round(borderPx + padPx),
    Math.round(outW), Math.round(outH),
  );
  // Border drawn on the output so it's exact, not subject to CSS rounding.
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = borderPx;
  ctx.strokeRect(borderPx / 2, borderPx / 2, out.width - borderPx, out.height - borderPx);

  const dataUrl = out.toDataURL("image/png");
  const raw = new Uint8Array(
    atob(dataUrl.split(",")[1]).split("").map(c => c.charCodeAt(0)),
  );
  const withDpi = setPngDpi(raw, DPI);

  const blob = new Blob([withDpi], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${opts.filename || "corecut-capture"}.png`;
  a.click();
  URL.revokeObjectURL(url);

  // Report the real exported size, read straight from the PNG's IHDR.
  const ihdr = new DataView(withDpi.buffer, withDpi.byteOffset, withDpi.byteLength);
  return { width: ihdr.getUint32(16), height: ihdr.getUint32(20) };
}

/**
 * Capture one or more selected elements as a single image. The exported region
 * is the union of their bounding boxes, so a stack of sibling cards comes out
 * as one continuous shot rather than several files to reassemble.
 */
export async function captureElements(
  els: HTMLElement[],
  opts: CaptureOptions = {},
): Promise<{ width: number; height: number }> {
  if (!els.length) throw new Error("Nothing selected");
  const region = unionRect(els.map(e => e.getBoundingClientRect()));
  // Render from an ancestor containing every selection, then crop to the union.
  const source = commonAncestor(els);
  return captureRegion(source, region, opts);
}

/**
 * Let the user drag a region and return it as a plain PNG data URL.
 *
 * This is the user-facing path (attaching a screenshot to feedback), NOT the
 * catalog path: no border, no 300-DPI framing, and rendered at screen scale so
 * the payload stays small enough for the 3 MB feedback limit. Resolves null if
 * the user cancels with Escape.
 */
export function pickScreenRegion(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-capture-ui", "");
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483000",
      "cursor:crosshair", "background:rgba(0,0,0,0.25)",
    ].join(";");

    const hint = document.createElement("div");
    hint.setAttribute("data-capture-ui", "");
    hint.style.cssText = [
      "position:fixed", "top:16px", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483001", "background:#18181b", "color:#fff",
      "border:1px solid #3f3f46", "border-radius:8px",
      "padding:8px 14px", "font:12px system-ui", "pointer-events:none",
      "box-shadow:0 8px 24px rgba(0,0,0,0.5)",
    ].join(";");
    hint.textContent = "Drag to select the area — Esc to cancel";

    const box = document.createElement("div");
    box.setAttribute("data-capture-ui", "");
    box.style.cssText = [
      "position:fixed", "z-index:2147483001", "display:none",
      "border:2px solid #f36f21", "background:rgba(243,111,33,0.12)",
      "pointer-events:none",
    ].join(";");

    document.body.append(overlay, hint, box);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    let anchor: { x: number; y: number } | null = null;

    const cleanup = () => {
      overlay.remove(); hint.remove(); box.remove();
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("keydown", onKey, true);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); cleanup(); resolve(null); }
    };
    window.addEventListener("keydown", onKey, true);

    overlay.addEventListener("mousedown", (e) => {
      anchor = { x: e.clientX, y: e.clientY };
      box.style.display = "block";
    });

    overlay.addEventListener("mousemove", (e) => {
      if (!anchor) return;
      const x = Math.min(anchor.x, e.clientX), y = Math.min(anchor.y, e.clientY);
      box.style.left = `${x}px`; box.style.top = `${y}px`;
      box.style.width = `${Math.abs(e.clientX - anchor.x)}px`;
      box.style.height = `${Math.abs(e.clientY - anchor.y)}px`;
    });

    overlay.addEventListener("mouseup", async (e) => {
      const a = anchor;
      if (!a) return;
      anchor = null;
      const x = Math.min(a.x, e.clientX), y = Math.min(a.y, e.clientY);
      const w = Math.abs(e.clientX - a.x), h = Math.abs(e.clientY - a.y);
      // Hide our own chrome before rendering so it can't land in the shot.
      cleanup();
      if (w < 8 || h < 8) { resolve(null); return; }
      try {
        resolve(await renderRegionToDataUrl(new DOMRect(x, y, w, h)));
      } catch {
        resolve(null);
      }
    });
  });
}

/** Render a viewport region at screen scale to a PNG data URL (no framing). */
async function renderRegionToDataUrl(region: DOMRect): Promise<string> {
  const scale = 1; // screen scale — keeps the feedback payload small

  // Same viewport-clipped render as the catalog path (see captureRegion): the
  // selection is in viewport coordinates, so the crop is a direct mapping.
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const full = await toCanvas(document.body, {
    pixelRatio: scale,
    width: vw,
    height: vh,
    style: {
      transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
      transformOrigin: "top left",
      margin: "0",
      width: `${document.body.scrollWidth}px`,
    },
    filter: (node) =>
      !(node instanceof HTMLElement && node.hasAttribute("data-capture-ui")),
    skipFonts: true,   // cross-origin Google Fonts sheet throws on cssRules read
  });

  const actualScale = full.width / vw;
  const out = document.createElement("canvas");
  out.width = Math.round(region.width * scale);
  out.height = Math.round(region.height * scale);
  const ctx = out.getContext("2d")!;
  ctx.drawImage(
    full,
    Math.round(region.left * actualScale),
    Math.round(region.top * actualScale),
    Math.round(region.width * actualScale),
    Math.round(region.height * actualScale),
    0, 0, out.width, out.height,
  );
  return out.toDataURL("image/png");
}


/**
 * Capture an arbitrary viewport rectangle — for regions that don't line up with
 * element boundaries. Renders from the deepest element wholly containing the
 * rect so the crop stays sharp.
 */
export async function captureRect(
  region: DOMRect,
  opts: CaptureOptions = {},
): Promise<{ width: number; height: number }> {
  const cx = region.left + region.width / 2;
  const cy = region.top + region.height / 2;
  let source = (document.elementFromPoint(cx, cy) as HTMLElement) || document.body;
  // Climb until the candidate fully contains the requested region.
  while (source !== document.body) {
    const r = source.getBoundingClientRect();
    if (r.left <= region.left && r.top <= region.top &&
        r.right >= region.right && r.bottom >= region.bottom) break;
    source = source.parentElement || document.body;
  }
  return captureRegion(source, region, opts);
}

/**
 * Find the nearest sensible capture boundary walking up from `start`.
 * The app has no single card-container convention, so this keys off visual
 * boundedness (a border or non-transparent background) at a usable size
 * rather than a class allowlist.
 */
export function findCaptureTarget(start: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = start;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    const bg = cs.backgroundColor;
    const hasBg = bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
    const bigEnough = r.width >= 80 && r.height >= 40;
    if ((hasBorder || hasBg) && bigEnough) return el;
    el = el.parentElement;
  }
  return null;
}
