import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Mentor from "@/pages/Mentor";
import Catalog from "@/pages/Catalog";
import Toolbox from "@/pages/Toolbox";
import Admin from "@/pages/Admin";
import NotFound from "@/pages/not-found";
import CaptureMode from "@/components/CaptureMode";
import React from "react";

function AddToHomeScreenBanner() {
  const [visible, setVisible] = React.useState(() => {
    // Don't show if already dismissed
    if (localStorage.getItem("a2hs_dismissed")) return false;
    // Don't show if already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return false;
    // Only show on mobile
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  });

  if (!visible) return null;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-orange-500/40 px-4 py-3 flex items-start gap-3 shadow-2xl">
      <span className="text-xl mt-0.5">📱</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white">Use CoreCutCNC like an app</p>
        {isIOS ? (
          <p className="text-[11px] text-zinc-400 mt-0.5">Tap the <span className="text-white">Share</span> button at the bottom of Safari, then <span className="text-white">"Add to Home Screen"</span> — free, instant, no App Store needed.</p>
        ) : (
          <p className="text-[11px] text-zinc-400 mt-0.5">Tap the <span className="text-white">⋮ menu</span> in Chrome, then <span className="text-white">"Add to Home Screen"</span> — free, instant, no App Store needed.</p>
        )}
      </div>
      <button
        onClick={() => { localStorage.setItem("a2hs_dismissed", "1"); setVisible(false); }}
        className="text-zinc-500 hover:text-white text-lg leading-none mt-0.5 flex-shrink-0"
        aria-label="Dismiss"
      >✕</button>
    </div>
  );
}

function BrevoNudge() {
  const [visible, setVisible] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    const MILESTONES = [10, 25, 50];
    const check = () => {
      const count = parseInt(localStorage.getItem("calc_count") || "0");
      const shown = parseInt(localStorage.getItem("nudge_shown_count") || "0");
      if (shown >= MILESTONES.length) return;
      if (count >= MILESTONES[shown]) setVisible(true);
    };
    check();
    window.addEventListener("calc_count_updated", check);
    return () => window.removeEventListener("calc_count_updated", check);
  }, []);

  const dismiss = () => {
    const shown = parseInt(localStorage.getItem("nudge_shown_count") || "0");
    localStorage.setItem("nudge_shown_count", String(shown + 1));
    setVisible(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    try {
      await fetch("/api/newsletter-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSent(true);
      setTimeout(dismiss, 2500);
    } catch { dismiss(); }
    setSending(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-sm bg-zinc-900 border border-orange-500/40 rounded-xl shadow-2xl px-4 py-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-white">Enjoying CoreCutCNC?</p>
          <button onClick={dismiss} className="text-zinc-500 hover:text-white text-sm leading-none flex-shrink-0">✕</button>
        </div>
        {sent ? (
          <p className="text-xs text-green-400">You're in! We'll keep you posted.</p>
        ) : (
          <>
            <p className="text-[11px] text-zinc-400 mb-2">Drop your email for updates &amp; tips from the Core Cutter team.</p>
            <form onSubmit={submit} className="flex gap-2">
              <input
                type="text" inputMode="email" autoCapitalize="none" autoCorrect="off"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white placeholder-zinc-500 outline-none focus:border-orange-500"
                required
              />
              <button
                type="submit"
                disabled={sending}
                className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-3 py-1 rounded disabled:opacity-50"
              >
                {sending ? "…" : "Send"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const HELP_SECTIONS = [
  {
    title: "Tool Finder",
    icon: "🔍",
    body: "Browse and search Core Cutter's complete standard tool catalog with a quick finder for swift results. Use this to find the right EDP number for your application before heading to the calculator. Each tool includes a downloadable STP file — an exact replica of the tool as a solid model for direct use in your CAM system.",
  },
  {
    title: "Calculators",
    icon: "🧮",
    body: "Standalone reference calculators — chip thinning, minimum chip thickness, arc entry, no-post bore sizing, and more. Static reference tools.",
  },
  {
    title: "Milling & Chamfer Tips",
    icon: "⚙️",
    body: "Speeds, feeds, and full stability analysis for standard Core Cutter end mills and chamfer mills. Enter your material, tool, machine, and cut parameters — the engine delivers RPM, feed, chip load, HP draw, and a complete stability audit including chatter risk analysis. Results export three ways — a formatted PDF report, a copy-to-clipboard setup sheet for notepad/CNC use, or emailed to your inbox (with optional CC) — all open to all registered users. Every EDP also has a downloadable STP file: an exact replica of the tool as a solid model for your CAM system.",
  },
  {
    title: "Specials Tips (Dovetail, Keyseat, Thread Mill & more)",
    icon: "📐",
    body: "Each section is driven by Core Cutter special tool prints uploaded for your job. Your Core Cutter special print gets loaded into the correct section and the calculator uses it for calculations. For stepped tools, upload the print as usual — the engine uses the smallest and largest diameters automatically. All three exports work here too — PDF report, copy-to-clipboard setup sheet, and email — open to all registered users. A .stp file can also be requested for every custom tool upload; just let us know you need it.",
  },
  {
    title: "Toolbox",
    icon: "🗂️",
    body: "Save your machines and machine info per your shop for quick reference. Sign in with your email, save a setup, and click Re-run this setup anytime to restore all inputs — no re-entering parameters.",
  },
  {
    title: "Use CoreCutCNC as a Mobile App",
    icon: "📱",
    body: "No app store needed — save CoreCutCNC directly to your home screen for instant access. On iPhone/iPad: tap the Share button in Safari, then \"Add to Home Screen\". On Android: tap the ⋮ menu in Chrome, then \"Add to Home Screen\". It launches full screen just like a native app.",
  },
];

const WALKTHROUGH_STEPS = [
  {
    icon: "👋",
    title: "Welcome to CoreCutCNC",
    subtitle: "Physics-based speeds & feeds tailored to the exact Core Cutter tool you're running.",
    body: "The app walks you through three paths depending on where you're starting. Use the arrows to pick the one that fits your situation — you can always revisit this guide from the How to Use button.",
    cta: "Show me how →",
  },
  {
    icon: "🔍",
    title: "Path 1 — Find Your Tool First (Tool Finder Section)",
    subtitle: "Not sure which Core Cutter tool to use?",
    steps: [
      { n: "1", text: "Go to the Tool Finder section at the top of the page" },
      { n: "2", text: "Start with Quick Pick for guided suggestions, or filter by diameter, material, operation, flute count — use as many filters as you like" },
      { n: "3", text: "Select Endmill or Chamfer Mill mode button to narrow results to that tool type" },
      { n: "4", text: "Hit the Search button at the bottom to see results below" },
      { n: "5", text: "Download the associated .STP file for your CAM system if needed" },
      { n: "6", text: "Tap Use Tool → to transfer the EDP into the calculator, fill in your setup and cut parameters — the engine does the rest" },
    ],
  },
  {
    icon: "⚙️",
    title: "Path 2 — Know Your Tool Already?",
    subtitle: "Have an EDP# for a standard Core Cutter endmill or chamfer mill?",
    steps: [
      { n: "1", text: "Go to Milling or Chamfer Mill in the Operation section" },
      { n: "2", text: "Select your material, machine type, and toolholder" },
      { n: "3", text: "Enter your Core Cutter EDP# — all tool geometry auto-fills" },
      { n: "4", text: "Enter your WOC, DOC, and stickout — hit Calculate for RPM, feed, chip load, HP, and a full stability analysis" },
    ],
    note: "Results export three ways — PDF report, copy-to-clipboard setup sheet, or emailed to your inbox. No email entry required to export.",
  },
  {
    icon: "📐",
    title: "Path 3 — Running a Special Tool?",
    subtitle: "Core Cutter custom endmill, keyseat, dovetail, thread mill, or other special?",
    steps: [
      { n: "1", text: "Select the matching operation — Keyseat, Dovetail, Thread Milling, etc." },
      { n: "2", text: "Upload your Core Cutter special tool print (PDF or photo from your phone)" },
      { n: "3", text: "The engine reads the print dimensions and auto-fills the tool geometry" },
      { n: "4", text: "Enter your setup and run — same full output as standard tools" },
    ],
    note: "Uploading a photo from a mobile device works just as well as a PDF scan.",
  },
  {
    icon: "🧮",
    title: "Calculators — Quick Reference Tools",
    subtitle: "Standalone shop-floor calculators — no EDP or setup required.",
    body: "Access them from the Misc. Calculators selector. Includes: chip thinning, arc entry load spike, helix & ramp angle, cusp height, bolt circle G-code, tap drill sizes, feed correction for arcs, MRR & HP estimate, and more. Each has a How to fix it section when something looks off. Great for quick sanity checks at the machine.",
    cta: "Let's get started →",
    last: true,
  },
];

const walkThruOpenRef = { open: false, setOpen: (_: boolean) => {} };

// Shared close-others bus
// Use a getter/setter pair per tab so the registry holds live references.
// The registry is keyed by a stable symbol created at hook call site so
// hot-reload re-registrations replace rather than accumulate.
const _sideTabRegistry = new Map<symbol, () => void>();

function useSideTab(persistKey?: string) {
  // persistKey opts a tab into surviving remounts/navigation, so it stays
  // open (and pinned) while the user works through the form.
  const [open, setOpen] = React.useState(() =>
    persistKey ? localStorage.getItem(persistKey) === "1" : false);
  const keyRef = React.useRef<symbol | null>(null);
  if (!keyRef.current) keyRef.current = Symbol();

  // Keep the registry entry pointing at the latest setOpen
  const setOpenRef = React.useRef(setOpen);
  setOpenRef.current = setOpen;

  const pkRef = React.useRef(persistKey);
  pkRef.current = persistKey;

  React.useEffect(() => {
    const key = keyRef.current!;
    _sideTabRegistry.set(key, () => {
      setOpenRef.current(false);
      if (pkRef.current) localStorage.removeItem(pkRef.current);
    });
    return () => { _sideTabRegistry.delete(key); };
  }, []);

  const openTab = React.useCallback(() => {
    _sideTabRegistry.forEach(close => close());
    setOpen(true);
    if (persistKey) localStorage.setItem(persistKey, "1");
  }, [persistKey]);

  const closeTab = React.useCallback(() => {
    setOpen(false);
    if (persistKey) localStorage.removeItem(persistKey);
  }, [persistKey]);

  return { open, openTab, closeTab };
}

function WelcomeModal({ forceOpen, onClose }: { forceOpen?: boolean; onClose?: () => void } = {}) {
  const [open, setOpen] = React.useState(() => forceOpen ?? !localStorage.getItem("welcome_seen"));
  const [step, setStep] = React.useState(0);
  React.useEffect(() => { walkThruOpenRef.open = open; walkThruOpenRef.setOpen = setOpen; }, [open]);
  React.useEffect(() => { if (forceOpen) { setOpen(true); setStep(0); } }, [forceOpen]);
  if (!open) return null;
  const s = WALKTHROUGH_STEPS[step];
  const isLast = !!(s as any).last;
  const isFirst = step === 0;
  const total = WALKTHROUGH_STEPS.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xl">{s.icon}</span>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-zinc-600 font-mono">{step + 1} / {total}</span>
              <button onClick={() => { localStorage.setItem("welcome_seen", "1"); setOpen(false); onClose?.(); }} className="text-zinc-500 hover:text-white text-lg leading-none">✕</button>
            </div>
          </div>
          <p className="text-sm font-bold text-white leading-snug">{s.title}</p>
          {(s as any).subtitle && <p className="text-[11px] text-orange-400 mt-0.5">{(s as any).subtitle}</p>}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {(s as any).body && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">{(s as any).body}</p>
          )}
          {(s as any).steps && (
            <div className="space-y-2.5 mt-1">
              {((s as any).steps as { n: string; text: string }[]).map(item => (
                <div key={item.n} className="flex gap-3 items-start">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-400 text-[10px] font-bold flex items-center justify-center mt-0.5">{item.n}</span>
                  <p className="text-[11px] text-zinc-300 leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          )}
          {(s as any).note && (
            <p className="text-[10px] text-zinc-500 mt-3 border-t border-zinc-800 pt-3 leading-relaxed">💡 {(s as any).note}</p>
          )}
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 py-2">
          {WALKTHROUGH_STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? "bg-orange-500" : "bg-zinc-700 hover:bg-zinc-500"}`} />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-2">
          {!isFirst && (
            <button onClick={() => setStep(p => p - 1)}
              className="flex-1 border border-zinc-700 text-zinc-400 hover:text-white text-xs font-semibold py-2 rounded-lg transition-colors">
              ← Back
            </button>
          )}
          {isLast ? (
            <button onClick={() => { localStorage.setItem("welcome_seen", "1"); setOpen(false); onClose?.(); }}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
              {(s as any).cta ?? "Let's go →"}
            </button>
          ) : (
            <button onClick={() => { if (isFirst && (s as any).cta) setStep(1); else setStep(p => p + 1); }}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
              {(s as any).cta ?? "Next →"}
            </button>
          )}
        </div>
        <p className="text-[10px] text-zinc-600 text-center pb-3 -mt-2">Tap How to Use anytime to review this guide.</p>
      </div>
    </div>
  );
}

const OPERATION_HELP: Record<string, { title: string; sections: { heading: string; body: string }[] }> = {
  milling: {
    title: "Steps to Navigate the Endmill Calculator",
    sections: [
      { heading: "1. Select Operation & Tool Type", body: "Under Operation / Tool / Process, pick your operation first — Milling, Drilling, Reaming, Thread Milling, Keyseat, Dovetail, or Feed Mill. Milling covers both standard catalog tools and specials; the rest are special-print only. Then under Milling — Tool Type, choose Endmill or Chamfer Mill to set the correct geometry model." },
      { heading: "2. Select Your Process", body: "Use the Select Process dropdown to tell the engine what kind of cut you're making. This is the single biggest driver of your numbers — it sets the WOC/DOC strategy, the chip-thinning model, and which stability rules apply. Eight processes:\n\n• **Roughing — HEM** (incl. Trochoidal / Dynamic / Adaptive) — light radial, deep axial, chip-thinned feeds. !!Requires a true adaptive toolpath; you'll be asked before we can produce any cutting parameters.!!\n• **Roughing — Traditional** — conventional heavier WOC, shallower DOC.\n• **Finishing** — light engagement for surface finish and final size.\n• **Facing (Planar Milling)** — flat, open surfaces; stepover-driven.\n• **Slotting** — full-width cuts; splits into traditional vs. HEM/trochoidal slotting.\n• **Circular Interpolation** — bore enlargement and orbital moves, with per-pass tool-in-bore physics.\n• **3D Surface Contouring** — ball / bull nose / torus, driven by effective diameter at the contact point.\n• **Pocketing Strategy** — multi-tool pocket sequencing, pre-drill and entry planning, plus the Thin Wall option." },
      { heading: "3. Select Your Material", body: "Two ways to get there — search your material in our extensive database, or find it by ISO category:\n\n• **Search by grade name** — type your grade (e.g. \"4140\", \"17-4 PH\", \"Inconel 718\") and hit **Match** or press Enter. It sets the ISO category, Grade, and a typical hardness for you. This does not search as you type — you have to press Match.\n• **Browse by ISO category** — pick a chip (N1, N2, P, M, K, S, H, O), then narrow with the **Grade** dropdown.\n\nThe engine uses calibrated SFM and chip load values validated for each material. Then work down the rest of the section — these are not optional details, they move your numbers:\n\n• **Stock Condition** — how the material arrives. Billet is the default; Hot Rolled, Forged, Sand Cast, Inv. Cast, Case Hard, Flame/Plasma Cut, Nitrided, Cold-Worked, and Weldment all carry a hard or abrasive skin, and the engine derates your first pass accordingly (Nitrided and Case Hard the hardest). Choosing Case Hard adds a **This cut** row — tell it whether you **stay in the case** or **cut to core**.\n• **Material Modifier — Powder Metal (PM / Sintered)** — tick this if you're cutting PM. Enter as-sintered **Density** if you know it (low density is porous and abrasive; high density cuts closer to wrought), and flag **Sinter-hardened** grades. !!Don't assume PM is softer or easier — sinter-hardened grades cut like prehard alloy steel.!!\n• **Hardness** — pick **HRC** or **HRB** and enter your actual value. A typical value is filled in when you choose the material, but that's a starting assumption — !!confirm your real hardness, it drives SFM, cutting force, and torque.!!\n• **Heat-treat condition** — on 17-4 PH, 15-5 PH, 13-8 Mo PH, and D2 you'll also get quick chips (Condition A, H900, H1025, Annealed, Hardened 58, etc.). Tap one to fill the typical HRC — still editable if you know your exact number.\n\nWatch for amber warnings under the hardness row — they flag a wrong scale or a value outside the normal range for that grade, and often offer a one-click switch to a better-matching material." },
      { heading: "4. Set Your Machine", body: "Search from over 800 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations.\n\n• !!The saved machines carry their spindle power and torque curves — so the app knows what your spindle actually delivers at the recommended RPM, not just its nameplate HP.!! That's what powers the torque check in your results: available vs. required torque, a green/yellow/red zone, and a flag when you're running below the peak-torque RPM where a geared spindle still has pulling power.\n• This is the main reason to pick your real machine instead of a generic one — a 30 HP spindle at 800 RPM and the same spindle at 8,000 RPM are not the same machine.\n• Also set your **Max RPM Use** — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "5. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc.\n\n• !!If you're running Big-Plus dual contact holders, hit the red Dual Contact button — this makes a BIG difference in your running parameters.!! It sits just under the spindle taper. Dual contact adds simultaneous taper AND face contact between spindle and holder, which raises rigidity, cuts deflection and micro-vibration, and lets the engine push your numbers accordingly. If you have it and don't select it, you're leaving performance on the table. (HSK and CAPTO are inherently dual contact, so the button doesn't appear for them.)\n• If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "6. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "7. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "8. Enter Tool Info (Specials & Standards)", body: "Enter your Core Cutter EDP # to auto-fill all tool geometry and unlock the calculator — or use Tool Finder to browse and hit Use Tool to transfer automatically. EDP # is required to run a calculation. Once entered, a STP file download for that exact tool is also available for direct use in your CAM system. This section also accommodates special endmill prints from Core Cutter — upload your print to auto-fill dimensions and unlock the calculator for your custom tool." },
      { heading: "9. Cut Engagement", body: "Set your WOC, DOC, and tool stickout.\n\n• Start with the Optimal presets — hit Optimal for WOC and DOC first. WOC and DOC are not always pre-filled for you; in some cases the app seeds a default and in many cases the fields start blank, so Optimal is the right starting point every time.\n• DOC accepts three input styles — a preset button, a manually typed decimal (e.g. 0.375), or a percentage of tool diameter typed directly as XX% (e.g. 150%). The percentage form is handy for scaling depth to the cutter without doing the math yourself.\n• Stickout — the app calculates a recommended default for your tool. Use it as your starting point and adjust only if your setup requires more reach. Stickout directly affects chatter risk — keep it as short as your setup allows.\n• If you go back and change the process (step 2), check these fields again — switching process re-seeds WOC and DOC to that strategy's starting values." },
      { heading: "10. Tool Entry", body: "Pick how the tool gets into the cut. In most cases you can select MORE THAN ONE — the checkboxes are multi-select, and every strategy you check is calculated and shown side by side so you can compare entry feeds and load before you commit in CAM.\n\n• A ★ marks the recommended entry for your current setup — Sweep / Roll-in for most open-edge and HEM work, Helical for closed pockets and chamfer mills.\n• Hover any chip for the full rules on that entry — ramp angles, entry feed percentages, and center-cutting or open-edge requirements.\n• Straight Plunge is our least preferred and is there mostly for reference — it drives the full load at first contact." },
      { heading: "11. Calculate Your Results", body: "Hit Calculate to get RPM, feed, chip load, HP draw, and a full stability audit with chatter risk analysis and ranked improvement suggestions.\n\n• !!Anytime you change an input field, you must re-run the calculator.!! Results are a snapshot of the inputs at the moment you hit Calculate — they do not update on their own. Edit anything (material, tool, WOC, DOC, stickout, machine, holder) and the numbers on screen are stale until you hit Calculate again." },
      { heading: "Exports — four ways to get your work out", body: "Three result exports plus the tool model itself. All open to all registered users — no email entry required to export.\n\n• **Copy Setup Sheet** — copies a plain-text setup sheet to your clipboard, ready to paste into a notepad, traveler, or straight into your CNC control. Best for the guy at the machine.\n• **Print / Save PDF** — a formatted report with the full recommendation and stability audit. Use your browser's print dialog to print it or save it as a PDF. Tick **Incl. Opt EDP** to keep the Optimized EDP Match block in the report, or clear it to leave that tool out (handy when the optimized tool is out of stock).\n• **Email me these results** — sends a copy to any inbox, and **+ CC someone** puts a second address on it (your lead, programmer, or customer). The email body is the same setup sheet the Copy button produces — that's why the two look alike; same content, different delivery.\n• **STP file** — an exact replica of the tool as a .stp solid model, for use in your CAM system. Download it from the Tool Info section once an EDP is entered, or from any Tool Finder result. Real geometry, so your toolpath simulation and gouge/collision checks run against the actual cutter instead of a generic stick.\n• **Custom and special tools:** a .stp file can be requested for every custom tool upload — just let us know you need it and we'll get it to you. Use the 'Contact us' link at the bottom of the page.\n\nPDF is the one to send a customer or file with the job. Setup sheet and email are the same text for the floor. The STP goes to whoever programs it." },
    ],
  },
  feedmilling: {
    title: "Steps to Navigate the Chamfer Mill Calculator",
    sections: [
      { heading: "1. Select Your Material", body: "Choose the material you're chamfering. SFM and chip load are calibrated per material for chamfer mill geometry. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "2. Enter Tool Info (Specials & Standards)", body: "Enter your Core Cutter EDP # to auto-fill all tool geometry and unlock the calculator — or use Tool Finder to browse and hit Use Tool to transfer automatically. EDP # is required to run a calculation. Once entered, a STP file download for that exact tool is also available for direct use in your CAM system. This section also accommodates special chamfer mill prints from Core Cutter — upload your print to auto-fill dimensions and unlock the calculator for your custom tool." },
      { heading: "3. Chamfer Depth", body: "Enter your required chamfer depth — this is a required user input. The engine uses it to calculate the effective cutting diameter at depth and adjust RPM and feed accordingly. The app displays the safe chamfer saddle range for your tool so you can confirm your depth stays within the working envelope." },
      { heading: "4. Entry Type (Default: Helical)", body: "Default to helical interpolation on all chamfer mill applications — it distributes the entry load smoothly and produces the cleanest edge. Only deviate when part geometry doesn't allow it: on straight edges use a ramp-in or sweep-in arc instead. Straight plunge is our least preferred — it drives the full cutting load at entry and can leave a witness mark. Program your entry type in CAM accordingly." },
      { heading: "5. Set Your Machine", body: "Search from over 800 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations.\n\n• !!The saved machines carry their spindle power and torque curves — so the app knows what your spindle actually delivers at the recommended RPM, not just its nameplate HP.!! That's what powers the torque check in your results: available vs. required torque, a green/yellow/red zone, and a flag when you're running below the peak-torque RPM where a geared spindle still has pulling power.\n• This is the main reason to pick your real machine instead of a generic one — a 30 HP spindle at 800 RPM and the same spindle at 8,000 RPM are not the same machine.\n• Also set your **Max RPM Use** — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "6. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc.\n\n• !!If you're running Big-Plus dual contact holders, hit the red Dual Contact button — this makes a BIG difference in your running parameters.!! It sits just under the spindle taper. Dual contact adds simultaneous taper AND face contact between spindle and holder, which raises rigidity, cuts deflection and micro-vibration, and lets the engine push your numbers accordingly. If you have it and don't select it, you're leaving performance on the table. (HSK and CAPTO are inherently dual contact, so the button doesn't appear for them.)\n• If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "7. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "8. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "9. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, and chip load tailored to your chamfer geometry." },
    ],
  },
  drilling: {
    title: "Steps to Navigate the Drilling Calculator",
    sections: [
      { heading: "1. Select Your Material", body: "Choose the ISO category and specific material you're cutting. The engine uses calibrated SFM and chip load values validated for each material. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "2. Hole Details", body: "Input your hole depth and hole type — through hole, blind, or counterbore. These drive cycle time, peck strategy, and chip evacuation recommendations." },
      { heading: "3. Enter Tool Info (Specials Only)", body: "Upload your Core Cutter special drill print — the app reads the drawing and auto-fills all tool geometry for you. No manual entry required." },
      { heading: "4. Set Your Machine", body: "Search from over 800 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations.\n\n• !!The saved machines carry their spindle power and torque curves — so the app knows what your spindle actually delivers at the recommended RPM, not just its nameplate HP.!! That's what powers the torque check in your results: available vs. required torque, a green/yellow/red zone, and a flag when you're running below the peak-torque RPM where a geared spindle still has pulling power.\n• This is the main reason to pick your real machine instead of a generic one — a 30 HP spindle at 800 RPM and the same spindle at 8,000 RPM are not the same machine.\n• Also set your **Max RPM Use** — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "5. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc.\n\n• !!If you're running Big-Plus dual contact holders, hit the red Dual Contact button — this makes a BIG difference in your running parameters.!! It sits just under the spindle taper. Dual contact adds simultaneous taper AND face contact between spindle and holder, which raises rigidity, cuts deflection and micro-vibration, and lets the engine push your numbers accordingly. If you have it and don't select it, you're leaving performance on the table. (HSK and CAPTO are inherently dual contact, so the button doesn't appear for them.)\n• If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "6. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "7. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "8. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, cycle time, and HP draw for your drill operation." },
    ],
  },
  reaming: {
    title: "Steps to Navigate the Reaming Calculator",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — reaming SFM is significantly lower than drilling for the same material. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "2. Enter Tool Info (Specials Only)", body: "Upload your Core Cutter special reamer print — the app reads the drawing and auto-fills all tool geometry for you. No manual entry required." },
      { heading: "3. Hole Details", body: "Enter your finished hole diameter, hole depth, and hole type (through or blind) — all three are required to generate your cutting parameters." },
      { heading: "4. Set Your Machine", body: "Search from over 800 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations.\n\n• !!The saved machines carry their spindle power and torque curves — so the app knows what your spindle actually delivers at the recommended RPM, not just its nameplate HP.!! That's what powers the torque check in your results: available vs. required torque, a green/yellow/red zone, and a flag when you're running below the peak-torque RPM where a geared spindle still has pulling power.\n• This is the main reason to pick your real machine instead of a generic one — a 30 HP spindle at 800 RPM and the same spindle at 8,000 RPM are not the same machine.\n• Also set your **Max RPM Use** — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "5. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc.\n\n• !!If you're running Big-Plus dual contact holders, hit the red Dual Contact button — this makes a BIG difference in your running parameters.!! It sits just under the spindle taper. Dual contact adds simultaneous taper AND face contact between spindle and holder, which raises rigidity, cuts deflection and micro-vibration, and lets the engine push your numbers accordingly. If you have it and don't select it, you're leaving performance on the table. (HSK and CAPTO are inherently dual contact, so the button doesn't appear for them.)\n• If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "6. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "7. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "8. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, and chip load optimized for your reaming operation." },
    ],
  },
  threadmilling: {
    title: "Steps to Navigate the Thread Milling Calculator",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — thread milling SFM and chip load are calibrated per material. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "2. Thread Details", body: "Enter the thread you need to cut — final major diameter, pitch diameter, thread depth, thread hand (RH or LH), and your G-code dialect (Fanuc/Haas or Siemens 840D). These drive the helical interpolation path geometry and the ready-to-use G-code output. Cut direction is automatically selected based on your material and hole type — top-down for most applications, bottom-up for tough materials (Inconel, titanium) and blind holes. You can override it if your specific setup requires." },
      { heading: "3. Tool Geometry (Specials Only)", body: "Upload your Core Cutter special thread mill print (CC-XXXXX) — the app reads the drawing and auto-fills all tool geometry for you. No manual entry required. Review the extracted fields and correct any misreads before running." },
      { heading: "4. Set Your Machine", body: "Search from over 800 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations.\n\n• !!The saved machines carry their spindle power and torque curves — so the app knows what your spindle actually delivers at the recommended RPM, not just its nameplate HP.!! That's what powers the torque check in your results: available vs. required torque, a green/yellow/red zone, and a flag when you're running below the peak-torque RPM where a geared spindle still has pulling power.\n• This is the main reason to pick your real machine instead of a generic one — a 30 HP spindle at 800 RPM and the same spindle at 8,000 RPM are not the same machine.\n• Also set your **Max RPM Use** — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "5. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc.\n\n• !!If you're running Big-Plus dual contact holders, hit the red Dual Contact button — this makes a BIG difference in your running parameters.!! It sits just under the spindle taper. Dual contact adds simultaneous taper AND face contact between spindle and holder, which raises rigidity, cuts deflection and micro-vibration, and lets the engine push your numbers accordingly. If you have it and don't select it, you're leaving performance on the table. (HSK and CAPTO are inherently dual contact, so the button doesn't appear for them.)\n• If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "6. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "7. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "8. Calculate Your Results", body: "Hit Calculate to get RPM, feed, and a ready-to-use G-code helical interpolation block for your thread." },
    ],
  },
  keyseat: {
    title: "Steps to Navigate the Keyseat Calculator",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — keyseat cutters run at reduced SFM due to their side-cutting geometry and full-width engagement. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "Machining Strategy", body: "Keyseat cutters are force-dominated tools — your control knobs are chip thickness, tool deflection, and chip evacuation. NOT max RPM or SFM chasing.\n\n• Full slot engagement (180°) is fixed by tool geometry — no chip thinning benefit, high radial load\n• Never treat like an endmill — chip load must be derated 30–50% vs standard slotting IPT\n• Depth strategy: small tools (<3/8\") step down in multiple passes; medium tools can often go full depth with reduced feed; large tools (>3/4\") use a 2-pass approach — 60–70% depth first, then finish pass at full depth with lighter feed\n• Always climb mill — reduces rubbing, improves tool life, better chip evacuation direction\n• Entry: never straight plunge into full width — pre-drill or pre-mill relief if possible, otherwise arc/roll in\n• If it chatters: reduce stickout first, then reduce depth, then reduce feed — in that order" },
      { heading: "2. Enter Tool Info (Specials Only)", body: "Upload your Core Cutter special keyseat print (CC-XXXXX) — the app reads the drawing and auto-fills Cut Dia, Flutes, LOC, Arbor/Neck Dia, and Reach/TSC for you. Review those fields and correct any misreads, then fill in the two fields the print won't have:\n\n• Cut Pass Depth — axial depth per pass; the engine suggests a safe starting depth based on tool size, neck strength, and material\n• **Final Slot Depth** — total required slot depth for your part; the engine calculates how many passes are needed and flags survivability concerns" },
      { heading: "3. Set Your Machine", body: "Search from over 800 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations.\n\n• !!The saved machines carry their spindle power and torque curves — so the app knows what your spindle actually delivers at the recommended RPM, not just its nameplate HP.!! That's what powers the torque check in your results: available vs. required torque, a green/yellow/red zone, and a flag when you're running below the peak-torque RPM where a geared spindle still has pulling power.\n• This is the main reason to pick your real machine instead of a generic one — a 30 HP spindle at 800 RPM and the same spindle at 8,000 RPM are not the same machine.\n• Also set your **Max RPM Use** — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "4. Tool Holder", body: "Shrink fit is the top choice for keyseat work — these tools behave like thin discs on a stick and need maximum grip rigidity. Hydraulic is also good; high-quality ER collet is acceptable. Avoid worn collets and long gauge lengths. Keep stickout as short as possible — stickout is the single biggest driver of deflection and breakage on keyseat cutters." },
      { heading: "5. Coolant", body: "Through-spindle coolant is ideal for keyseat work — chips have nowhere to go in a full-slot engagement and recutting chips is the #1 cause of breakage. High-pressure flood aimed directly into the cut is the next best option. Air blast assist is very effective. Avoid light mist only — it won't evacuate chips reliably in a closed slot." },
      { heading: "6. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "7. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, chip load per tooth, HP draw, deflection, and a pass-by-pass depth strategy. Watch for deflection warnings — keyseat tools are force-dominated and deflection is the primary failure predictor, not HP." },
    ],
  },
  surfacing: {
    title: "Steps to Navigate the 3D Surface Contouring Calculator",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — surfacing SFM is based on the effective cutting diameter at the contact point, not the tool OD. Soft materials like aluminum allow very high SFM even at small D_eff; tough materials like stainless and titanium need conservative SFM to avoid edge burn at the contact zone. Also confirm your hardness if known — it adjusts SFM automatically." },
      { heading: "2. Tool Setup — Corner Condition", body: "Select Ball Nose or Bull Nose (corner radius) — square-corner endmills are not available in surfacing mode. For bull nose tools, enter the corner radius accurately — D_eff calculation depends on it when step-down (ap) is shallower than the CR." },
      { heading: "2a. Torus / Bull Nose vs. Ball — pick for the job", body: "A torus (bull nose) contacts on its corner-radius arc, so the corner radius — not the tool OD — drives the scallop. That lets you hold a fine finish at a much larger stepover than a ball of the same diameter, on a stiffer, flat-cored body. Great for shallow, open 5-axis surfaces where a big effective radius plus rigidity wins. A ball nose conforms to tighter 3D curvature but has the dead-zone-at-tip limitation (see Tool Tilt below). Rule of thumb: torus for big open forms and productivity, ball for tight curvature and detail." },
      { heading: "2b. Tapered Ballnose — reach + rigidity", body: "A tapered ballnose is a ball tip on a conical body that flares to a larger shank. The tip cuts exactly like a straight ball of that tip diameter (same SFM, feed, and scallop) — the taper only adds stiffness. That stiffness is the point: at long reach into deep cores, walls, or blades, a straight ball chatters, while the cone keeps deflection low. Check the 'Tapered ballnose' box and enter the taper's INCLUDED angle and tapered length; the app derives the base diameter and models the stiffer cantilever. Note: Core Cutter prints call the taper PER SIDE — a '4°' callout means 8° included (the app's PDF upload doubles it for you automatically)." },
      { heading: "3. Surfacing Input Mode", body: "Choose how you want to drive the calculation:\n\n• Drive by Scallop Height — enter your target cusp height (the ridges left between passes) and the app calculates the required stepover automatically. 0.001\" ≈ rough, 0.0005\" ≈ medium, 0.0001\" ≈ fine finish.\n• Drive by Stepover — enter your stepover directly and the app shows the resulting scallop height. Use this if your CAM system drives stepover directly." },
      { heading: "4. Step-Down (ap)", body: "Enter your axial depth per pass — how far the tool steps down in Z between contouring passes. Typical finishing range: 0.010\"–0.050\". Smaller ap follows the surface more accurately and produces smaller D_eff (slower effective cutting velocity). Larger ap increases D_eff and productivity but reduces surface conformance on curved surfaces." },
      { heading: "5. Tool Tilt (Ball Nose Only)", body: "Ball nose tools have a dead zone at the very tip — cutting velocity is zero at center and only builds as D_eff increases. Adding tool tilt shifts the contact point away from the tip:\n\n• 0° = tip cutting — lowest D_eff, lowest surface velocity, poorest finish\n• 10–15° = recommended for most finishing — significantly higher D_eff and cutting velocity\n• The live preview panel shows exactly how much tilt raises D_eff vs. 0°\n\nUse 0° only when your CAM or machine axis configuration doesn't allow tilt." },
      { heading: "6. Live Preview Panel", body: "Before you run the calculation, the preview panel shows your current D_eff, stepover, and scallop height in real time as you adjust inputs. Use it to dial in your parameters before hitting Calculate. A green note confirms when tilt has meaningfully raised D_eff; an amber warning flags when D_eff is still very low and tilt or larger ap is recommended." },
      { heading: "7. Enter Tool Info", body: "Enter your Core Cutter EDP # to auto-fill all tool geometry — or upload your CC print PDF. Ball nose and bull nose tools are both supported. Stickout is required for the stability audit — enter the distance from the toolholder face to the tool tip." },
      { heading: "8. Set Your Machine", body: "Search from over 800 machines in our database or build your own. Selecting a machine pre-fills spindle HP, max RPM, taper, and drive type. For 5-axis surfacing setups, max RPM is particularly important — tilt moves can drive the spindle higher than expected at small D_eff values." },
      { heading: "9. Tool Holder & Coolant", body: "Shrink fit or hydraulic is strongly preferred for surfacing — tool runout directly translates to surface waviness. Keep stickout as short as possible; deflection at the contact zone causes chatter that shows as periodic surface scallop distortion. Flood or mist coolant is recommended — light engagement at low WOC causes chip re-cutting without coolant." },
      { heading: "10. Calculate Your Results", body: "Hit Calculate to get RPM and SFM at D_eff (actual contact velocity, not OD velocity), feed rate, chip load, and HP draw. The results panel shows D_eff, the computed scallop height, and the actual stepover ae. The stability audit checks for chatter risk at your stickout." },
    ],
  },
  feedmill: {
    title: "Steps to Navigate the High-Feed Milling Calculator",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — high-feed mills are optimized for light DOC and high feed. They work across steel, stainless, titanium, Inconel, cast iron, and aluminum. Hardness limit is 52 HRC — above that expect rapid corner wear. Enter your actual hardness for the most accurate SFM derate." },
      { heading: "What Makes HFM Different", body: "This is a chip thinning machine, not a conventional rougher.\n\n• Chip thinning is geometric — programmed IPT is 2–3× the actual chip thickness. On lead-angle insert mills it comes from the lead angle (e.g. 20°); on radius-form solid-carbide cutters it comes from the corner radius at a shallow DOC (a deeper DOC into the radius means LESS thinning)\n• Forces are redirected axially (into the spindle), not radially — this is why HFM works on long-reach setups\n• WOC is your #1 control knob — target 6–12% of diameter. Sweet spot: 8–10%\n• DOC is typically 0.5–1.5×D (some setups 2×D) — the opposite of conventional logic\n• Low WOC + high feed + moderate DOC + constant-engagement path = maximum MRR with low chatter risk\n\nIf it sounds smooth and light — you're rubbing. If it feels aggressive — you're in the right zone. Never reduce feed as your first move. Adjust WOC first." },
      { heading: "2. Enter Tool Info (Specials Only)", body: "Upload your Core Cutter special feed mill print (CC-XXXXX) — the app reads the drawing and auto-fills all tool geometry. Review the extracted fields and correct any misreads, then confirm:\n\n• Corner Radius — the dual-radius geometry limits max DOC. The engine enforces min(1.5×CR, 0.15×D) as the max DOC and flags if you exceed it.\n• Lead Angle — only used for lead-angle insert feed mills (standard CC insert mills are 20°). Radius-form solid-carbide cutters have NO lead angle — set the corner radius instead and the engine derives chip thinning from the radius + DOC. Either way the chip thinning factor (CTF) is shown live so you see how programmed IPT relates to actual chip load.\n• Stickout — enter your actual gage length. L/D >4 triggers a 20% DOC derate and 10% IPT derate; L/D >6 triggers 35%/20%." },
      { heading: "3. Set Your Machine", body: "Search from over 800 machines in our database or build your own. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant — all of which drive the HP and stability calculations. HFM is spindle-HP-friendly due to low radial forces, so most machines run well under HP limit. Max RPM and stiffness matter more than raw power." },
      { heading: "4. Tool Holder", body: "Shrink-fit is the top choice for HFM work — maximum grip rigidity matters when running high feed rates. Hydraulic is excellent. ER collet is acceptable for short reach. Keep stickout short. HFM redirects forces axially so chatter is less common than with endmills, but long gage lengths still derate your parameters — the engine applies L/D factors automatically." },
      { heading: "5. Coolant", body: "Through-spindle coolant is a game changer for HFM — especially in stainless, titanium, Inconel, and deep pockets. Strong flood is the minimum. High-pressure TSC dramatically improves chip evacuation and extends tool life at high feed rates. If you have it, use it. Air blast is acceptable for aluminum and dry-cut cast iron." },
      { heading: "6. Workholding & Entry Strategy", body: "Workholding rigidity affects chatter risk — confirm your setup matches what's selected.\n\nEntry is non-negotiable: never straight-plunge unless the tool is specifically rated for it. Use helical ramp (2–3° angle), ramp entry, or a pre-drilled hole for deep pockets. Bad entry = instant corner wear on the first pass.\n\nRadial engagement in corners can spike from 8% to 30–60% — that's where tools fail. Use adaptive/constant-engagement toolpaths, add corner smoothing, and avoid sharp direction changes." },
      { heading: "7. Calculate Your Results", body: "Hit Calculate to get RPM, SFM, programmed FPT, actual chip thickness, WOC, DOC, HP draw, max ramp angle, and L/D derate status.\n\nKey outputs to watch:\n• Programmed FPT — this is what you enter in your CAM system (always higher than actual chip due to CTF)\n• Actual Chip — the real chip load at the cutting edge; this is what to compare against tool manufacturer limits\n• Max DOC — the geometric limit set by corner radius; do not exceed\n• L/D Derate badge — shows if stickout is triggering parameter reduction\n\nIf the HFM tip callout in results says to adjust WOC — do that first before changing anything else." },
    ],
  },
  dovetail: {
    title: "Steps to Navigate the Dovetail Calculator",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — dovetail cutters run at reduced SFM due to their angled side-cutting geometry and interrupted engagement. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "Machining Strategy", body: "Dovetail cutters are finishing tools — not roughing tools. Zero forgiveness due to their necked geometry, small effective cutting diameter, and long moment arm.\n\n• Pre-machine the slot first with a square or bull nose endmill — leave 0.005\"–0.015\" radial stock per side and open the full axial depth\n• Enter laterally only — never plunge\n• Run the dovetail per side, climb cutting each wall separately\n• Radial engagement: 0.003\"–0.010\" per side maximum\n• Axial DOC: full depth is fine once the slot is roughed\n• Chip load: start at 30–50% of your standard endmill IPT — effective diameter is small and too much chip load causes instant failure\n• If it sounds wrong, it is wrong — dovetails don't forgive" },
      { heading: "2. Enter Tool Info (Specials Only)", body: "Upload your Core Cutter special dovetail print (CC-XXXXX) — the app reads the drawing and auto-fills all tool geometry for you. No manual entry required. Review the extracted fields and correct any misreads, then fill in the two fields the print won't have:\n\n• Radial Pass Depth — how far the cutter steps into the dovetail wall per pass. Dovetail cutters always enter laterally from outside the part or a pre-slotted pocket — never plunge. The neck is narrower than the cutting head so keep passes conservative.\n• **Final Wall Depth** — total radial depth from the pre-slotted pocket edge to full dovetail form. The engine calculates how many lateral passes are needed and flags survivability concerns." },
      { heading: "3. Set Your Machine", body: "Search from over 800 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations.\n\n• !!The saved machines carry their spindle power and torque curves — so the app knows what your spindle actually delivers at the recommended RPM, not just its nameplate HP.!! That's what powers the torque check in your results: available vs. required torque, a green/yellow/red zone, and a flag when you're running below the peak-torque RPM where a geared spindle still has pulling power.\n• This is the main reason to pick your real machine instead of a generic one — a 30 HP spindle at 800 RPM and the same spindle at 8,000 RPM are not the same machine.\n• Also set your **Max RPM Use** — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "4. Tool Holder", body: "Hydraulic or shrink-fit holders are strongly preferred for dovetail work — dovetail tools behave like thin cantilever beams with an offset load and require maximum grip rigidity. Dual contact (where available) adds further stability. Keep stickout as short as your setup allows — every extra inch of stickout multiplies deflection force significantly. If you're using an extension holder, enter the gage length and nose diameter so the engine can model the full stickout stack." },
      { heading: "5. Coolant", body: "Air blast is the preferred coolant method for dovetail cutters — the goal is chip evacuation, not cooling. Mist is also good. Flood is acceptable but watch for chip packing in the slot. Through-spindle coolant is rarely applicable. Select the method that best clears chips from the engaged wall." },
      { heading: "6. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "7. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, chip load per tooth, HP draw, effective cutting diameter (adjusted for dovetail angle), deflection, and a pass-by-pass lateral strategy for reaching your final wall depth safely. If chatter occurs after running — reduce stickout first, then reduce radial pass depth, then reduce chip load." },
    ],
  },
  deep_pocket: {
    title: "Steps to Navigate the Deep Pocket / Thin Wall Calculator",
    sections: [
      { heading: "1. Select Your Material & Setup", body: "Material, machine, toolholder, and workholding must all be filled in before running the sequence — the engine uses these to calculate speeds/feeds per tool. Hard materials (Inconel, Ti, hardened) automatically tighten the corner engagement factor to 65% (vs 75% standard) to protect tools in the corner zone." },
      { heading: "2. Target Depth & Corner Radius", body: "Enter your finished pocket depth and the inside corner radius. The 75% engagement rule is applied automatically — tool diameter is set to ≤75% of the corner diameter to prevent full-corner engagement spikes. Corner finish tool uses 60% rule (tighter, for light finishing passes)." },
      { heading: "3. HEM vs Traditional", body: "HEM (Adaptive/Trochoidal) is strongly recommended for deep pockets and thin walls — light WOC keeps radial forces low, which is critical at high L/D. Traditional is available when your CAM system doesn't support adaptive paths, but expect heavier forces and more chatter risk at depth.\n\n• HEM: L/D up to 4× before stub tool added\n• Traditional: L/D up to 3× before stub tool added" },
      { heading: "4. Understanding the Sequence", body: "The app selects the fewest tools to reach full depth — typically 2, max 3. Each tool covers a depth band:\n\n• Stub/short tool: upper band — best rigidity, runs fast\n• Standard LOC tool: mid band — balances reach and stiffness\n• RN (reduced-neck) tool: full depth — shorter LOC per pass, but full reach via the neck\n\nFor RN tools: DOC per pass = LOC (not LBS). The neck reaches depth but only the fluted zone cuts. Program multiple passes stepping down LOC at a time." },
      { heading: "5. Corner Finish Tool", body: "A separate corner finish tool is always recommended to machine corners to true radius at full depth. The bulk tools leave 0.008–0.015\" stock on corner walls. The corner finish tool then makes a light, controlled pass to final dimension.\n\n• Corner dia ≥ 0.250\": square-end RN endmill, full depth in one sequence\n• Corner dia < 0.250\": ball nose RN — matches corner radius exactly, step-over controls scallop" },
      { heading: "6. Thin Wall Strategy", body: "When Thin Wall is toggled on, a WOC taper schedule is shown on each bulk tool card:\n\n• HEM: >0.100\" from wall → 10% WOC / 0.030–0.100\" → 5% / Final pass → 3%\n• Traditional: Open zone → 50% / Mid → 30% / <0.100\" → 10% / Final → 5%\n\nLeave bilateral stock on both wall faces until the final passes — this keeps the wall supported and prevents flexing during roughing." },
      { heading: "7. Feed Mill Option", body: "In P/K materials (steel, cast iron) an optional axial feed mill advisory may appear. Feed mills dramatically reduce cycle time in open-zone bulk removal but are currently special-order only. Use the quote button to request one pre-filled with your job details." },
    ],
  },
};

const PAGE_HELP: Record<string, { title: string; sections: { heading: string; body: string }[] }> = {
  "/": {
    title: "Steps to Navigate the Milling & Chamfer Calculator",
    sections: [],  // replaced dynamically by operation
  },
  "/catalog": {
    title: "Steps to Navigate the Tool Finder",
    sections: [
      { heading: "Two ways in — pick one", body: "You don't have to do both.\n\n• **Not sure what you need?** Start with **Step 1 — Quick Pick**. Answer a few questions and it sets the filters for you.\n• **Already know the tool configuration specs you need?** Skip Quick Pick and go straight to **Step 2 — Filters**.\n\nQuick Pick just pre-fills the filters below it, so you can always start there and fine-tune afterward." },
      { heading: "Step 1 — Quick Pick (optional)", body: "The yellow card at the top. Hit **Help me choose →** and answer the questions — the breadcrumb across the top tracks where you are:\n\n• **Material** — what you're cutting.\n• **Operation** — roughing (HEM or traditional), finishing, facing, slotting, circular interpolation, 3D contouring, or chamfering.\n• **Diameter** — small, medium, or large ballpark.\n• **Depth of Cut** — endmills only; this is your axial DOC, not the tool's LOC.\n\nWhen it's done the button reads **✓ Applied** and the filters below are set for you. Use **← Back** to change an answer, or **✕ Close** to start over." },
      { heading: "Step 2 — Filters", body: "The card below Quick Pick. **Product Category is required** — pick **Endmill** or **Chamfer Mill** first or the rest stays locked (you'll see '⚠ Select one to activate filters').\n\nFrom there narrow with any combination of:\n\n• **Endmills** — Cut Material, Tool Series, Cut Diameter, Flute Count, Length of Cut (LOC), Length Below Shank (LBS), Corner Condition, Coating, Center Cutting, Flute Geometry.\n• **Chamfer mills** — Chamfer Angle, Tip Diameter, Flute Style, Part Chamfer Length.\n\n!!Not all filters have to be selected — select the ones that mean the most to your search.!!" },
      { heading: "Step 3 — Part Feature Match (optional)", body: "The indigo sub-panel at the bottom of the filters, endmills only. Three optional fields that match the tool to your part geometry instead of to a spec:\n\n• **Final Axial Cut Depth (in)** — ensures the LOC covers your required depth.\n• **Min. Part Radius — Wall to Wall (in)** — matches the corner radius to your inside wall.\n• **Max. Part Floor Radius — Floor to Wall (in)** — ensures the corner radius clears your floor blend.\n\nEnter your part dimensions and the finder returns only tools that fit — eliminating guesswork." },
      { heading: "Step 4 — Search Tools", body: "Hit **🔍 Search Tools** to run it.\n\n• !!Results do not update as you change filters — you have to press the button each time.!!\n• If the button reads 'Select Filters to Search', you still need to pick a Product Category.\n• **Clear All** resets everything and starts you over." },
      { heading: "Step 5 — Read your results", body: "Above the table you'll see the tool count, a **Filters:** row, and a **Part Match:** row — each chip has an ✕ if you want to drop that filter without going back up.\n\nIn the table:\n\n• **Close Match** — a near-fit worth a look.\n• **CB** / **VXR** — chipbreaker and truncated-rougher geometry.\n• Tap ☆ in the **Favorite** column to save a tool for later.\n• Only the first 200 results show — narrow your filters if you hit that cap." },
      { heading: "Step 6 — Use Tool →", body: "Found the right cutter?\n\n• Hit **Use Tool →** in the **Insert into Speed & Feed** column, far right of any row.\n• That transfers all tool geometry into the Milling & Chamfer Calculator — no typing required." },
      { heading: "STP File Downloads", body: "Every EDP has a downloadable STP file — an exact replica of that tool as a solid model, for direct use in your CAM system. Find the tool and grab the file in one step. Because it's the real geometry, your toolpath simulation and collision checks run against the actual cutter instead of a generic stick.\n\n• **Specials:** not in the catalog, but a .stp file can be requested for every custom tool upload — just let us know you need it." },
      { heading: "Not finding what you need?", body: "Use the 'Contact us' link at the bottom of the page — Core Cutter can quote a special to your print." },
    ],
  },
  "/toolbox": {
    title: "Steps to Navigate the Toolbox",
    sections: [
      { heading: "Sign In", body: "Enter your email address to receive a one-time code. No password needed — the code signs you in and keeps you logged in on this device." },
      { heading: "Save a Setup", body: "After running a calculation in the Milling Calculator, click Save Setup. Give it a name or use the default. It saves your full input set." },
      { heading: "Re-run a Setup", body: "Click Re-run this setup on any saved item to restore all inputs back into the Milling Calculator — ready to calculate or adjust." },
      { heading: "Save Your Machines", body: "Save your shop machines with spindle HP, taper, RPM, and toolholder info for quick recall on any future job." },
    ],
  },
  "/calculators": {
    title: "Steps to Navigate the Misc Calculators",
    sections: [
      { heading: "Speed & Feed", body: "RPM ↔ SFM, Feed Rate, Chip Thinning, Feed from SFM, Engagement Angle, Min Chip Thickness. Use these to validate or fine-tune values from the calculator." },
      { heading: "Surface Finish", body: "Cusp Height (ball end), Effective Diameter (ball end), Surface Finish from step-over, Ball Nose Velocity Adjustment. Useful for finishing pass planning." },
      { heading: "Arcs & Contours", body: "Feed Correction for Arc moves, Helix Entry sizing, No Middle Post bore calculator, Bolt Circle, Chord/Sagitta, Bore Enlargement, Corner Clearance, Entry Angle & Load Spike, Chamfer Mill geometry." },
      { heading: "Hole Making", body: "Tap Drill Size (inch & metric), Drill Point Length, Drilling Torque. Quick reference for any hole-making operation." },
      { heading: "Power & MRR", body: "MRR & HP Estimate — calculates material removal rate and estimated spindle HP draw from WOC, DOC, and feed rate." },
      { heading: "Materials", body: "Hardness ↔ Tensile Strength conversion, Material Condition → Hardness lookup. Handy when spec sheets give you one value and you need the other." },
      { heading: "Conversions", body: "Unit Converter — inches, mm, and common machining unit conversions in one place." },
    ],
  },
};

function HelpButton() {
  // Persisted: How to Use stays pinned open across form edits and page changes
  // until the user explicitly dismisses it with ✕.
  const { open, openTab, closeTab } = useSideTab("cc_protips_open");
  const [overviewOpen, setOverviewOpen] = React.useState(false);
  const [location] = useLocation();

  // Mentor owns the active operation but renders in a sibling subtree, so its
  // state changes can't reach us. Mirror the localStorage values it writes and
  // refresh them on the event it fires (see Mentor.tsx syncHelpContext).
  const readHelpContext = () => ({
    op: localStorage.getItem("cc_operation") || "milling",
    toolType: localStorage.getItem("cc_tool_type") || "endmill",
    mode: localStorage.getItem("cc_mode") || "",
  });
  const [helpCtx, setHelpCtx] = React.useState(readHelpContext);
  React.useEffect(() => {
    const refresh = () => setHelpCtx(prev => {
      const next = readHelpContext();
      // Unrelated form edits fire this too — don't re-render a pinned panel for them.
      return (next.op === prev.op && next.toolType === prev.toolType && next.mode === prev.mode)
        ? prev : next;
    });
    refresh();
    window.addEventListener("cc_help_context_changed", refresh);
    return () => window.removeEventListener("cc_help_context_changed", refresh);
  }, []);

  // On the main mentor page, use operation-specific tips
  let pageHelp = PAGE_HELP[location] ?? null;
  if (location === "/") {
    const op = helpCtx.op;
    if (op === "toolfinder") {
      pageHelp = PAGE_HELP["/catalog"] ?? null;
    } else if (op === "feedmilling") {
      pageHelp = PAGE_HELP["/calculators"] ?? null;
    } else if (op === "toolbox") {
      pageHelp = PAGE_HELP["/toolbox"] ?? null;
    } else if (op === "milling") {
      const toolType = helpCtx.toolType;
      const mode = helpCtx.mode;
      if (toolType === "chamfer_mill") {
        pageHelp = OPERATION_HELP["feedmilling"];
      } else if (mode === "surfacing") {
        pageHelp = OPERATION_HELP["surfacing"];
      } else if (mode === "deep_pocket") {
        pageHelp = OPERATION_HELP["deep_pocket"];
      } else {
        pageHelp = OPERATION_HELP["milling"];
      }
    } else {
      pageHelp = OPERATION_HELP[op] ?? OPERATION_HELP["milling"];
    }
  }

  return (
    <>
      <button
        onClick={openTab}
        className="fixed right-0 z-[60] text-white text-[11px] font-semibold px-2 rounded-l-lg shadow-lg transition-colors flex items-center justify-center"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", top: "calc(50% - 148px)", height: 86, background: "linear-gradient(180deg,#6366f1,#4f46e5)" }}
        aria-label="How to Use"
      >
        How to Use
      </button>
      {open && (
        // No backdrop: the panel is pinned alongside the form so the user can
        // keep filling in fields while reading the tips. Closes only via ✕.
        <div className="fixed inset-y-0 right-0 z-50 flex justify-end pointer-events-none">
          <div className="w-screen max-w-xs bg-zinc-900 border-l border-zinc-700 h-full shadow-2xl flex flex-col pointer-events-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div>
                <p className="text-sm font-semibold text-white">Welcome to CoreCutCNC</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Stays open while you work — ✕ to close.</p>
              </div>
              <button onClick={closeTab} className="text-zinc-500 hover:text-white text-lg leading-none flex-shrink-0">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-5">
              {/* Page-specific help */}
              {pageHelp && (
                <div className="mb-1">
                  <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-3">{pageHelp.title}</p>
                  {pageHelp.sections.map(s => (
                    <div key={s.heading} className="mb-3">
                      <p className="text-xs font-semibold text-white mb-0.5">{s.heading}</p>
                      {s.body.includes('\n•') ? (
                        <div className="text-[11px] text-zinc-400 leading-relaxed">
                          {s.body.split('\n').map((line, i) => {
                            // **bold** = white emphasis (field names).
                            // !!warning!! = bold yellow (must-do callouts).
                            const renderBold = (text: string) =>
                              text.split(/(\*\*.+?\*\*|!!.+?!!)/g).map((tok, j) => {
                                if (tok.startsWith("**") && tok.endsWith("**"))
                                  return <strong key={j} className="text-white">{tok.slice(2, -2)}</strong>;
                                if (tok.startsWith("!!") && tok.endsWith("!!"))
                                  return <strong key={j} className="text-yellow-400">{tok.slice(2, -2)}</strong>;
                                return tok;
                              });
                            return line.startsWith('•') ? (
                              <p key={i} className="pl-3">{renderBold(line)}</p>
                            ) : line.trim() ? <p key={i}>{renderBold(line)}</p> : <div key={i} className="h-1" />;
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-zinc-400 leading-relaxed">{s.body}</p>
                      )}
                    </div>
                  ))}
                  <div className="border-t border-zinc-800 my-4" />
                  <button
                    onClick={() => setOverviewOpen(o => !o)}
                    className="flex items-center justify-between w-full text-left"
                  >
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">App Overview</p>
                    <span className="text-zinc-500 text-xs">{overviewOpen ? "▲ Hide" : "▼ Show"}</span>
                  </button>
                </div>
              )}
              {/* General overview — collapsible */}
              {(!pageHelp || overviewOpen) && HELP_SECTIONS.map(s => (
                <div key={s.title}>
                  <p className="text-xs font-semibold text-white mb-1">{s.icon} {s.title}</p>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Training video config — add YouTube URL when video is ready ──────────────
// youtubeId: the part after ?v= or youtu.be/  (leave empty string = Coming Soon)
const TRAINING_VIDEOS = [
  { id: "overview",      title: "Getting Started / Overview",         desc: "App layout, registration, and your first calculation.",                       youtubeId: "" },
  { id: "tool_finder",   title: "Tool Finder",                        desc: "Search the catalog, filter by material and operation, load into calculator.",  youtubeId: "" },
  { id: "milling",       title: "Milling — Standard Endmill",         desc: "HEM, conventional, finish, slot — speeds, feeds, stability analysis.",          youtubeId: "" },
  { id: "chamfer",       title: "Chamfer Mill",                       desc: "CMS/CMH series, effective diameter, multi-pass strategy.",                    youtubeId: "" },
  { id: "specials",      title: "Special Tools — PDF Upload",         desc: "Upload a Core Cutter special print and auto-fill tool geometry.",             youtubeId: "" },
  { id: "drilling",      title: "Drilling & Reaming",                 desc: "Carbide drill, peck cycles, reamer stock, surface finish risk.",              youtubeId: "" },
  { id: "threadmill",    title: "Thread Milling",                     desc: "UN/Metric/NPT, radial passes, G-code output.",                               youtubeId: "" },
  { id: "feedmill",      title: "Feed Milling (High-Feed Mill)",      desc: "Lead angle chip thinning, WOC/DOC limits, ramp angle.",                      youtubeId: "" },
  { id: "stability",     title: "Stability Analysis",                 desc: "Reading the chatter risk score, acting on suggestions.",                     youtubeId: "" },
  { id: "toolbox",       title: "Toolbox & Saved Setups",             desc: "Save machines, re-run setups, team sharing.",                                youtubeId: "" },
  { id: "roi",           title: "ROI Calculator",                     desc: "Build a cost-per-part comparison for a customer presentation.",              youtubeId: "" },
];

function TrainingVideosTab() {
  const { open, openTab, closeTab } = useSideTab();
  const [expandedVideo, setExpandedVideo] = React.useState<string | null>(null);
  const [quickStartOpen, setQuickStartOpen] = React.useState(false);
  const [quickStartStep, setQuickStartStep] = React.useState(0);

  return (
    <>
      <button
        onClick={openTab}
        className="fixed right-0 z-[60] text-white text-[11px] font-semibold px-2 rounded-l-lg shadow-lg transition-colors flex items-center justify-center"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", top: "calc(50% - 74px)", height: 74, background: "linear-gradient(180deg,#fbbf24,#d97706)" }}
        aria-label="Training Videos"
      >
        Training
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closeTab}>
          <div
            className="w-full max-w-xs bg-zinc-900 border-l border-zinc-700 h-full shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-zinc-900 border-b border-zinc-700 px-4 py-3 flex items-center justify-between z-10">
              <div>
                <p className="text-sm font-bold text-amber-400 uppercase tracking-widest">Training Videos</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">CoreCutCNC — section-by-section guides</p>
              </div>
              <button onClick={closeTab} className="text-zinc-500 hover:text-white text-lg leading-none ml-3">✕</button>
            </div>

            {/* Video list */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              {TRAINING_VIDEOS.map(v => {
                const hasVideo = !!v.youtubeId;
                const isExpanded = expandedVideo === v.id;
                return (
                  <div key={v.id} className="rounded-lg border border-zinc-700/60 bg-zinc-800/50 overflow-hidden">
                    {/* Card header — always visible */}
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2.5 flex items-start gap-2.5"
                      onClick={() => setExpandedVideo(isExpanded ? null : v.id)}
                    >
                      <span className="mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: hasVideo ? "#d97706" : "#3f3f46", color: hasVideo ? "#fff" : "#71717a" }}>
                        {hasVideo ? "▶ Play" : "Coming Soon"}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white leading-snug">{v.title}</p>
                        <p className="text-[10px] text-zinc-400 mt-0.5 leading-snug">{v.desc}</p>
                      </div>
                    </button>

                    {/* Expanded — YouTube embed or coming soon */}
                    {isExpanded && (
                      <div className="px-3 pb-3">
                        {hasVideo ? (
                          <div className="relative w-full rounded overflow-hidden bg-black" style={{ paddingBottom: "56.25%" }}>
                            <iframe
                              className="absolute inset-0 w-full h-full"
                              src={`https://www.youtube.com/embed/${v.youtubeId}?rel=0&modestbranding=1`}
                              title={v.title}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                          </div>
                        ) : (
                          <div className="rounded bg-zinc-700/40 border border-zinc-600/40 px-3 py-4 text-center">
                            <p className="text-2xl mb-1">🎬</p>
                            <p className="text-xs font-semibold text-zinc-300">Coming Soon</p>
                            <p className="text-[10px] text-zinc-500 mt-1">This training video is in production.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Quick Start accordion */}
              <div className="mt-3 rounded-lg border border-zinc-700/60 bg-zinc-800/50 overflow-hidden">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 flex items-center justify-between"
                  onClick={() => setQuickStartOpen(o => !o)}
                >
                  <span className="text-xs font-semibold text-zinc-300">📋 Quick Start Guide</span>
                  <span className="text-zinc-500 text-xs">{quickStartOpen ? "▲" : "▼"}</span>
                </button>
                {quickStartOpen && (
                  <div className="px-3 pb-3 space-y-3">
                    {WALKTHROUGH_STEPS.map((s, i) => (
                      <div
                        key={i}
                        className={`rounded-lg p-3 border cursor-pointer transition-colors ${quickStartStep === i ? "border-amber-500/60 bg-amber-900/20" : "border-zinc-700/40 bg-zinc-800/30 hover:border-zinc-600"}`}
                        onClick={() => setQuickStartStep(i)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base">{s.icon}</span>
                          <p className="text-xs font-semibold text-white leading-snug">{s.title}</p>
                        </div>
                        {quickStartStep === i && (
                          <div className="mt-1.5 text-[11px] text-zinc-400 leading-relaxed space-y-1.5">
                            {"subtitle" in s && s.subtitle && <p className="text-zinc-300 font-medium">{s.subtitle}</p>}
                            {"body" in s && s.body && <p>{s.body}</p>}
                            {"steps" in s && s.steps && (
                              <ul className="space-y-1">
                                {s.steps.map((st: any) => (
                                  <li key={st.n} className="flex gap-2">
                                    <span className="shrink-0 w-4 h-4 rounded-full bg-amber-600 text-white text-[9px] font-bold flex items-center justify-center">{st.n}</span>
                                    <span>{st.text}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {"note" in s && s.note && <p className="text-amber-400/80 italic">{s.note}</p>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FeedbackButton() {
  const { open, openTab, closeTab } = useSideTab();
  const [type, setType] = React.useState("Bug");
  const [message, setMessage] = React.useState("");
  const [machineBrand, setMachineBrand] = React.useState("");
  const [machineModel, setMachineModel] = React.useState("");
  const [email, setEmail] = React.useState(() => localStorage.getItem("er_email") || "");
  const [screenshot, setScreenshot] = React.useState<string | null>(null);
  const [screenshotName, setScreenshotName] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [sizeError, setSizeError] = React.useState("");
  const [listening, setListening] = React.useState(false);
  const recognitionRef = React.useRef<any>(null);

  const toggleMic = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition is not supported in this browser. Try Chrome or Edge."); return; }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results).slice(e.resultIndex).map((r: any) => r[0].transcript).join(" ");
      setMessage(prev => (prev ? prev + " " + transcript : transcript).trim());
    };
    rec.onerror = () => { setListening(false); };
    rec.onend = () => { setListening(false); };
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setSizeError("Image must be under 3 MB"); return; }
    setSizeError("");
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshot(reader.result as string);
      setScreenshotName(file.name);
    };
    reader.readAsDataURL(file);
  };

  // Grab a region of the app directly, so reporting a visual bug doesn't require
  // leaving the page for a separate screenshot tool. The panel closes during the
  // drag (it would otherwise cover the thing being reported) and reopens after.
  const grabFromScreen = async () => {
    setSizeError("");
    closeTab();
    // Let the panel finish closing before the picker overlay goes up.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    let dataUrl: string | null = null;
    try {
      const { pickScreenRegion } = await import("@/lib/capture");
      dataUrl = await pickScreenRegion();
    } catch {
      dataUrl = null;
    }
    openTab();
    if (!dataUrl) return;                       // cancelled or too small
    // Same 3 MB ceiling the file path enforces; base64 is ~4/3 of the bytes.
    if (dataUrl.length * 0.75 > 3 * 1024 * 1024) {
      setSizeError("That area is too large — try selecting a smaller region.");
      return;
    }
    setScreenshot(dataUrl);
    // Timestamped so two captures in one report are distinguishable in the email.
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    setScreenshotName(
      `screen-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
      `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`,
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    if (type === "Add a Missing CNC Machine" && (!machineBrand.trim() || !machineModel.trim())) return;
    setSending(true);
    const fullMessage = type === "Add a Missing CNC Machine"
      ? `Brand: ${machineBrand.trim()}\nModel: ${machineModel.trim()}\n\n${message.trim()}`
      : message.trim();
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message: fullMessage, email, screenshot, screenshotName }),
      });
      setSent(true);
      setTimeout(() => { closeTab(); setSent(false); setMessage(""); setEmail(""); setType("Bug"); setScreenshot(null); setScreenshotName(""); setMachineBrand(""); setMachineModel(""); }, 2500);
    } catch { closeTab(); }
    setSending(false);
  };

  return (
    <>
      {/* Floating tab */}
      <button
        onClick={openTab}
        className="fixed right-0 z-[60] text-white text-[11px] font-semibold px-2 rounded-l-lg shadow-lg transition-colors flex items-center justify-center"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", top: "calc(50% + 0px)", height: 74, background: "linear-gradient(180deg,#10b981,#059669)" }}
        aria-label="Send feedback"
      >
        Feedback
      </button>

      {/* Slide-in panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closeTab}>
          <div
            className="w-full max-w-xs bg-zinc-900 border-l border-zinc-700 h-full shadow-2xl flex flex-col p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-white">Send Feedback</p>
              <button onClick={closeTab} className="text-zinc-500 hover:text-white text-lg leading-none">✕</button>
            </div>
            {sent ? (
              <p className="text-sm text-green-400 mt-4">Thanks! We got your feedback.</p>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-3 flex-1">
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">Type</label>
                  <select
                    value={type}
                    onChange={e => setType(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-orange-500"
                  >
                    <option>Bug</option>
                    <option>Wrong Speeds/Feeds</option>
                    <option>Missing Material</option>
                    <option>Missing Tool Type</option>
                    <option>Add a Missing CNC Machine</option>
                    <option>Suggestion</option>
                    <option>Compliment</option>
                    <option>Other</option>
                  </select>
                </div>
                {type === "Add a Missing CNC Machine" && (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[11px] text-zinc-400 mb-1 block">Brand <span className="text-red-400">*</span></label>
                      <input
                        type="text"
                        placeholder="e.g. Haas"
                        value={machineBrand}
                        onChange={e => setMachineBrand(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[11px] text-zinc-400 mb-1 block">Model <span className="text-red-400">*</span></label>
                      <input
                        type="text"
                        placeholder="e.g. VF-2"
                        value={machineModel}
                        onChange={e => setMachineModel(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-zinc-400">Message <span className="text-red-400">*</span></label>
                    <button type="button" onClick={toggleMic} title={listening ? "Stop recording" : "Speak your message"}
                      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${listening ? "bg-red-500/20 text-red-400 animate-pulse" : "text-zinc-500 hover:text-zinc-300"}`}>
                      {listening ? "⏹ stop" : "🎤 speak"}
                    </button>
                  </div>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={4}
                    placeholder={type === "Add a Missing CNC Machine" ? "Any spindle specs you know (HP, RPM, taper, etc.) — we'll look up the rest." : "Tell us what's on your mind..."}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-orange-500 resize-none"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">Screenshot <span className="text-zinc-600">(optional)</span></label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={grabFromScreen}
                      className="bg-zinc-800 border border-zinc-700 hover:border-orange-500 rounded px-2 py-1.5 text-xs text-zinc-300 whitespace-nowrap"
                    >
                      Grab from screen
                    </button>
                    <label className="cursor-pointer">
                      <span className="bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1.5 text-xs text-zinc-300 whitespace-nowrap">
                        {screenshotName ? "Change image" : "Attach image"}
                      </span>
                      <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
                    </label>
                  </div>
                  {screenshotName && <p className="text-[10px] text-zinc-400 truncate mt-1">{screenshotName}</p>}
                  {sizeError && <p className="text-[10px] text-red-400 mt-1">{sizeError}</p>}
                  {screenshot && (
                    <div className="mt-1.5 relative">
                      <img src={screenshot} alt="preview" className="w-full rounded border border-zinc-700 max-h-24 object-cover"/>
                      <button type="button" onClick={() => { setScreenshot(null); setScreenshotName(""); }} className="absolute top-1 right-1 bg-zinc-900/80 text-zinc-400 hover:text-white rounded text-[10px] px-1">✕</button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">Your email <span className="text-zinc-600">(optional)</span></label>
                  <input
                    type="text" inputMode="email" autoCapitalize="none" autoCorrect="off"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="so we can follow up"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-orange-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={sending}
                  className="mt-auto bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold py-2 rounded disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send Feedback"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function RegrindingTab() {
  const { open, openTab, closeTab } = useSideTab();
  const [contactOpen, setContactOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [zip, setZip] = React.useState("");
  const [zipStatus, setZipStatus] = React.useState<"idle"|"loading"|"found"|"error">("idle");

  const lookupZip = React.useCallback(async (z: string) => {
    if (z.length !== 5 || !/^\d{5}$/.test(z)) return;
    setZipStatus("loading");
    try {
      const r = await fetch(`https://api.zippopotam.us/us/${z}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const place = data.places?.[0];
      if (place) { setCity(place["place name"] ?? ""); setState(place["state abbreviation"] ?? ""); setZipStatus("found"); }
      else setZipStatus("error");
    } catch { setCity(""); setState(""); setZipStatus("error"); }
  }, []);

  return (
    <>
      {/* Floating tab */}
      <button
        onClick={openTab}
        className="fixed right-0 z-[60] text-white text-[11px] font-semibold px-2 rounded-l-lg shadow-lg transition-colors flex items-center justify-center"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", top: "calc(50% + 74px)", height: 74, background: "linear-gradient(180deg,#f97316,#ea580c)" }}
        aria-label="Tool Regrinding Program"
      >
        Regrinding
      </button>

      {/* Slide-in panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closeTab}>
          <div
            className="w-full max-w-sm bg-zinc-900 border-l border-zinc-700 h-full shadow-2xl flex flex-col overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-zinc-900 border-b border-zinc-700 px-5 py-4 flex items-center justify-between z-10">
              <div>
                <p className="text-sm font-bold text-orange-400 uppercase tracking-widest">Tool Reconditioning</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">Core Cutter LLC · Gardiner, ME</p>
              </div>
              <button onClick={closeTab} className="text-zinc-500 hover:text-white text-lg leading-none">✕</button>
            </div>

            <div className="p-5 space-y-5">

              {/* Hero stat */}
              <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-4 text-center">
                <p className="text-3xl font-black text-orange-400">~50%</p>
                <p className="text-sm text-zinc-200 font-semibold mt-1">of new tool cost</p>
                <p className="text-[11px] text-zinc-400 mt-1">Reconditioned tools typically cost half the price of new — a properly reground tool from us has been known to even exceed new tool performance.</p>
              </div>

              {/* Customer feedback stat */}
              <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-4 text-center">
                <p className="text-3xl font-black text-green-400">90–125%</p>
                <p className="text-sm text-zinc-200 font-semibold mt-1">of new tool performance</p>
                <p className="text-[11px] text-zinc-400 mt-1">Customer feedback consistently shows reconditioned Core Cutter tools meet or exceed new tool performance.</p>
              </div>

              {/* What we recondition */}
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-1">Any Brand — Standard Geometry</p>
                  <p className="text-[11px] text-zinc-500 mb-2">No print required — we regrind to our engineered spec.</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {["End Mills","Chamfer Mills"].map(t => (
                      <p key={t} className="text-[11px] text-zinc-300 flex items-center gap-1.5">
                        <span className="text-orange-400">›</span>{t}
                      </p>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-1">Any Brand — Special / Form Geometry</p>
                  <p className="text-[11px] text-zinc-500 mb-2">Original build print required for competitor brands.</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {["Drills","Reamers","Corner Rounders","Radius Cutters","Tapered Endmills","Feed Mills","Form Tools","Key Seat Cutters","Lollipop Cutters","Dovetail Cutters","Step Drills"].map(t => (
                      <p key={t} className="text-[11px] text-zinc-300 flex items-center gap-1.5">
                        <span className="text-orange-400">›</span>{t}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              {/* How it works */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">How It Works</p>
                <div className="space-y-3">
                  {[
                    { n: "1", title: "Collect & Send", body: "Contact your distributor with your tool list and any special requirements (min LOC, end-only, min dia reduction, etc.). Tube or wax-dip all tools for best recovery." },
                    { n: "2", title: "Evaluate & Quote", body: "We inspect and quote based on 'similar tool' quantity batching — more of the same EDP = better price. Non-reconditionable tools returned as 'no work done'." },
                    { n: "3", title: "Recondition & Return", body: "Fresh geometry + original coating restored. Tools ship on the confirmed delivery date." },
                  ].map(s => (
                    <div key={s.n} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[10px] font-black text-white">{s.n}</span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">{s.title}</p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">{s.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Minimum quantities */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Minimum Quantities</p>
                <div className="rounded-lg border border-zinc-700 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-800">
                        <th className="text-left px-3 py-2 text-zinc-400 font-semibold">Diameter</th>
                        <th className="text-right px-3 py-2 text-zinc-400 font-semibold">Min Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[["1/4\"","16 pcs"],["3/8\"","12 pcs"],["1/2\"","6 pcs"],["5/8\"","4 pcs"],["3/4\"","4 pcs"],["1.0\"","3 pcs"]].map(([dia, qty], i) => (
                        <tr key={dia} className={i % 2 === 0 ? "bg-zinc-900" : "bg-zinc-800/50"}>
                          <td className="px-3 py-1.5 text-zinc-200 font-medium">{dia}</td>
                          <td className="px-3 py-1.5 text-orange-400 font-bold text-right">{qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Key notes */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Good to Know</p>
                {[
                  "Solid carbide only — no carbide-tipped, HSS, or cobalt",
                  "1/4\" diameter minimum",
                  "Any brand accepted",
                  "Serrated roughers & chipbreakers: we clean rake face and add edge prep — cannot replace missing serrations",
                  "Shipping to/from Core Cutter is customer's responsibility",
                  "Tools reconditioned to our engineered grind spec — no guarantee on output performance, but customers love the results",
                ].map((note, i) => (
                  <p key={i} className="text-[11px] text-zinc-400 flex gap-2">
                    <span className="text-orange-400 shrink-0">·</span>{note}
                  </p>
                ))}
              </div>

              {/* Brochure download */}
              <a
                href="/Reconditioning Brochure (260214).pdf"
                download
                className="flex items-center justify-center gap-2 w-full text-center border border-orange-500/50 text-orange-400 hover:text-orange-300 hover:border-orange-400 font-semibold text-sm rounded-xl py-2.5 transition-colors"
              >
                ⬇ Download Reconditioning Brochure (PDF)
              </a>

              {/* Ship to address */}
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-4 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Ship Tools To</p>
                <p className="text-xs text-zinc-200 font-semibold">Core Cutter LLC</p>
                <p className="text-[11px] text-zinc-400">120 Technology Dr · Gardiner, ME 04345</p>
              </div>

              {/* CTA */}
              <button
                onClick={() => setContactOpen(true)}
                className="block w-full text-center bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm rounded-xl py-3 transition-colors"
              >
                Email Us for More Information →
              </button>
              <p className="text-[10px] text-zinc-500 text-center">sales@corecutterusa.com · 207.588.7519 · Gardiner, ME</p>

            </div>
          </div>
        </div>
      )}

      {/* Contact modal */}
      {contactOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setContactOpen(false)}>
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 space-y-4"
            onClick={e => e.stopPropagation()}>
            <button onClick={() => setContactOpen(false)}
              className="absolute top-3 right-4 text-zinc-500 hover:text-white text-lg leading-none">✕</button>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-0.5">Reconditioning Inquiry</p>
              <p className="text-sm text-zinc-300">We'll follow up with pricing and a reconditioning form.</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-400 uppercase tracking-widest">Your Email</label>
                <input type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" placeholder="you@company.com"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-400"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>

              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] text-zinc-400 uppercase tracking-widest">City</label>
                  <input type="text"
                    placeholder={zipStatus === "loading" ? "Looking up…" : zipStatus === "error" ? "Not found" : ""}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-400"
                    value={city} onChange={e => setCity(e.target.value)} />
                </div>
                <div className="w-20 space-y-1">
                  <label className="text-[10px] text-zinc-400 uppercase tracking-widest">State</label>
                  <input type="text" maxLength={2}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-400"
                    value={state} onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))} />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-zinc-400 uppercase tracking-widest">ZIP Code</label>
                <input type="text" inputMode="numeric" maxLength={5} placeholder="e.g. 90210"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-400"
                  value={zip}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                    setZip(v);
                    setZipStatus("idle");
                    if (v.length === 5) lookupZip(v);
                  }} />
              </div>
            </div>

            <a
              href={email ? `mailto:sales@corecutterusa.com?subject=${encodeURIComponent("Tool Reconditioning Inquiry")}&body=${encodeURIComponent(
                `Hello,\n\nI'm interested in your tool reconditioning program.\n\nPlease send me pricing and a reconditioning form.` +
                (city ? `\n\nLocation: ${city}, ${state} ${zip}` : "") +
                `\nReply to: ${email}\n\nThank you`
              )}` : "#"}
              onClick={() => { if (email) setContactOpen(false); }}
              className={`block w-full text-center rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                email ? "bg-orange-500 hover:bg-orange-400 text-white cursor-pointer" : "bg-zinc-700 text-zinc-400 cursor-default"
              }`}
            >
              {email ? "Send Inquiry →" : "Enter your email to continue"}
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function TeamsTab() {
  const { open, openTab, closeTab } = useSideTab();
  const [showConnect, setShowConnect] = React.useState(false);
  const [teamInput, setTeamInput] = React.useState("");
  const [teamError, setTeamError] = React.useState("");
  const [teamBusy, setTeamBusy] = React.useState(false);
  const [teamEmail, setTeamEmail] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    const e = localStorage.getItem("tb_email") || localStorage.getItem("er_email");
    const t = localStorage.getItem("tb_token");
    if (!e || !t) return;
    fetch("/api/team/info", { headers: { "x-tb-email": e, "x-tb-token": t } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.team_email) { setTeamEmail(d.team_email); setConnected(true); } })
      .catch(() => {});
  }, [open]);

  async function connect() {
    const e = localStorage.getItem("tb_email") || localStorage.getItem("er_email");
    const t = localStorage.getItem("tb_token");
    if (!e || !t) { setTeamError("Sign in to your Toolbox first."); return; }
    if (!teamInput.trim()) return;
    setTeamBusy(true); setTeamError("");
    try {
      const r = await fetch("/api/team/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tb-email": e, "x-tb-token": t },
        body: JSON.stringify({ team_email: teamInput.trim().toLowerCase() }),
      });
      const d = await r.json();
      if (!r.ok) { setTeamError(d.error || "Could not connect."); return; }
      setTeamEmail(teamInput.trim().toLowerCase());
      setConnected(true);
      setShowConnect(false);
      setTeamInput("");
    } catch { setTeamError("Network error — try again."); }
    finally { setTeamBusy(false); }
  }

  async function leave() {
    const e = localStorage.getItem("tb_email") || localStorage.getItem("er_email");
    const t = localStorage.getItem("tb_token");
    if (!e || !t) return;
    await fetch("/api/team/leave", { method: "POST", headers: { "x-tb-email": e, "x-tb-token": t } });
    setTeamEmail(null); setConnected(false);
  }

  return (
    <>
      {/* Floating tab */}
      <button
        onClick={openTab}
        className="fixed right-0 z-[60] text-white text-[11px] font-semibold px-2 rounded-l-lg shadow-lg transition-colors flex items-center justify-center"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", top: "calc(50% + 148px)", height: 74, background: "linear-gradient(180deg,#0891b2,#0e7490)" }}
        aria-label="Programming Teams"
      >
        Teams
      </button>

      {/* Slide-in panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closeTab}>
          <div
            className="w-full max-w-xs bg-zinc-900 border-l border-zinc-700 h-full shadow-2xl flex flex-col overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0" style={{ background: "linear-gradient(135deg,#0891b2,#0e7490)" }}>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-100">Programming Teams</p>
                <p className="text-[11px] text-cyan-200 mt-0.5">Share machines & setups across your whole shop</p>
              </div>
              <button onClick={closeTab} className="text-cyan-200 hover:text-white text-lg leading-none ml-3">✕</button>
            </div>

            <div className="p-4 space-y-5 flex-1">

              {/* Status banner */}
              {connected && teamEmail ? (
                <div className="rounded-lg bg-cyan-950/60 border border-cyan-700/50 px-3 py-2.5 flex items-start gap-2">
                  <span className="text-cyan-400 text-base mt-0.5">🔗</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-cyan-200">Connected to team</p>
                    <p className="text-[11px] text-cyan-400 truncate">{teamEmail}</p>
                  </div>
                  <button onClick={leave} className="text-[10px] text-zinc-500 hover:text-red-400 underline underline-offset-2 shrink-0 mt-0.5">Leave</button>
                </div>
              ) : (
                <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 px-3 py-2.5 flex items-center gap-2">
                  <span className="text-zinc-500 text-base">🔗</span>
                  <p className="text-[11px] text-zinc-400">Not connected to a team yet.</p>
                </div>
              )}

              {/* What it does */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">What Team Connect Does</p>
                <div className="space-y-2.5">
                  {[
                    { icon: "🖥️", title: "Shared Machines", body: "Every programmer on the team sees the same saved machines — no more re-entering the VF-2 specs on every PC." },
                    { icon: "🧰", title: "Shared Toolbox", body: "Saved cutting setups are visible to the whole team. One programmer builds it, everyone uses it." },
                    { icon: "📱", title: "Any Device", body: "Works on phone, tablet, and desktop — sign in with your personal email and connect to the team email." },
                    { icon: "🔒", title: "Your Account Stays Yours", body: "Connecting to a team doesn't change your personal email or login. Leave the team anytime." },
                  ].map(s => (
                    <div key={s.title} className="flex gap-3">
                      <span className="text-lg shrink-0 mt-0.5">{s.icon}</span>
                      <div>
                        <p className="text-xs font-semibold text-white">{s.title}</p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">{s.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* How to set it up */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">How to Set It Up</p>
                <div className="space-y-3">
                  {[
                    { n: "1", title: "Manager registers", body: "Your programming manager opens CoreCutCNC and registers with a shared department email — e.g. programming@acmemachine.com." },
                    { n: "2", title: "Each programmer connects", body: 'Every programmer clicks the Teams tab (or "connect to a team →" in the app header) and enters that shared email.' },
                    { n: "3", title: "Done — everything syncs", body: "From that point, saved machines and Toolbox setups are shared. Add a machine from any PC and the whole team sees it." },
                  ].map(s => (
                    <div key={s.n} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-cyan-600 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[10px] font-black text-white">{s.n}</span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">{s.title}</p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">{s.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Connect form or button */}
              {!connected && (
                showConnect ? (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-300 font-semibold">Enter your team email</p>
                    <input
                      type="text"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      placeholder="programming@yourshop.com"
                      value={teamInput}
                      onChange={e => { setTeamInput(e.target.value); setTeamError(""); }}
                      onKeyDown={e => { if (e.key === "Enter") connect(); }}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500"
                      autoFocus
                    />
                    {teamError && <p className="text-xs text-red-400">{teamError}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => { setShowConnect(false); setTeamInput(""); setTeamError(""); }}
                        className="flex-1 rounded-lg border border-zinc-700 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
                      <button onClick={connect} disabled={teamBusy || !teamInput.trim()}
                        className="flex-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 py-2 text-sm font-semibold text-white">
                        {teamBusy ? "Connecting…" : "Connect"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowConnect(true)}
                    className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm py-3 transition-colors"
                  >
                    Connect to a Team →
                  </button>
                )
              )}

              {connected && (
                <p className="text-[11px] text-zinc-500 text-center">Leave the team above to disconnect and remove shared access.</p>
              )}

            </div>
          </div>
        </div>
      )}
    </>
  );
}

type Announcement = {
  id: number;
  version: string;
  headline: string;
  subheadline: string;
  bullets: string[];
  published_at: string;
};

function WhatsNewModal() {
  const [announcement, setAnnouncement] = React.useState<Announcement | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/announcement")
      .then(r => r.ok ? r.json() : null)
      .then((data: Announcement | null) => {
        if (!data || !data.version) return;
        const seen = localStorage.getItem("seen_announcement");
        if (seen === data.version) return;
        setAnnouncement(data);
        setVisible(true);
      })
      .catch(() => {});
  }, []);

  if (!visible || !announcement) return null;

  const dismiss = () => {
    localStorage.setItem("seen_announcement", announcement.version);
    setVisible(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        {/* Badge */}
        <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-orange-400 mb-2">
          What's New
        </span>
        {/* Headline */}
        <p className="text-lg font-bold text-white leading-snug">{announcement.headline}</p>
        {/* Subheadline */}
        {announcement.subheadline && (
          <p className="text-sm text-zinc-400 mt-1">{announcement.subheadline}</p>
        )}
        {/* Bullets */}
        {announcement.bullets && announcement.bullets.length > 0 && (
          <ul className="mt-4 space-y-2">
            {announcement.bullets.map((bullet, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className="text-orange-400 shrink-0 leading-5">·</span>
                <span className="text-sm text-zinc-300">{bullet}</span>
              </li>
            ))}
          </ul>
        )}
        {/* Dismiss button */}
        <button
          onClick={dismiss}
          className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-2.5 rounded-lg mt-5 text-sm transition-colors"
        >
          Got it →
        </button>
        <p className="text-[10px] text-zinc-600 text-center mt-2">You won't see this again on this device.</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Mentor} />
      <Route path="/catalog">{() => <Catalog />}</Route>
      <Route path="/toolbox">{() => <Toolbox />}</Route>
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
        <WelcomeModal />
        <TrainingVideosTab />
        <FeedbackButton />
        <RegrindingTab />
        <TeamsTab />
        <HelpButton />
        <BrevoNudge />
        <WhatsNewModal />
        <AddToHomeScreenBanner />
        <CaptureMode />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;