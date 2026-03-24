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
    if (localStorage.getItem("nudge_dismissed")) return;
    const check = (e?: Event) => {
      const count = parseInt(localStorage.getItem("calc_count") || "0");
      if (count >= 3) setVisible(true);
    };
    check();
    window.addEventListener("calc_count_updated", check);
    return () => window.removeEventListener("calc_count_updated", check);
  }, []);

  const dismiss = () => {
    localStorage.setItem("nudge_dismissed", "1");
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
                type="email"
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
    body: "Browse and search Core Cutter's complete standard tool catalog with a quick finder for swift results. Use this to find the right EDP number for your application before heading to the advisor. Each tool includes a downloadable STP file for direct use in your CAM system.",
  },
  {
    title: "Calculators",
    icon: "🧮",
    body: "Standalone reference calculators — chip thinning, minimum chip thickness, arc entry, no-post bore sizing, and more. Static reference tools.",
  },
  {
    title: "Milling & Chamfer Advisor",
    icon: "⚙️",
    body: "Speeds, feeds, and full stability analysis for standard Core Cutter end mills and chamfer mills. Enter your material, tool, machine, and cut parameters — the engine delivers RPM, feed, chip load, HP draw, and a complete stability audit including chatter risk analysis. Results can be exported as a formatted PDF report or a CAM setup sheet for notepad/CNC use — your email is required for all exports.",
  },
  {
    title: "Specials Advisor (Dovetail, Keyseat, Thread Mill & more)",
    icon: "📐",
    body: "Each section is driven by Core Cutter special tool prints uploaded for your job. Your Core Cutter special print gets loaded into the correct section and the advisor uses it for calculations. For stepped tools, upload the print as usual — the engine uses the smallest and largest diameters automatically. PDF and CAM setup sheet exports are available here too — email required.",
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

function WelcomeModal() {
  const [open, setOpen] = React.useState(() => !localStorage.getItem("welcome_seen"));
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 pt-6 pb-3 border-b border-zinc-800">
          <p className="text-base font-bold text-white">Welcome to CoreCutCNC</p>
          <p className="text-[11px] text-zinc-400 mt-0.5">Your physics-based advisor where our engine integrates Core Cutter tool geometry, coating behavior, and cutting data directly into the model — so every recommendation is tailored to the exact cutter you're running.</p>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-4">
          {HELP_SECTIONS.map(s => (
            <div key={s.title}>
              <p className="text-xs font-semibold text-white mb-0.5">{s.icon} {s.title}</p>
              <p className="text-[11px] text-zinc-400 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-zinc-800">
          <button
            onClick={() => { localStorage.setItem("welcome_seen", "1"); setOpen(false); }}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg"
          >
            Got it, let's go →
          </button>
          <p className="text-[10px] text-zinc-600 text-center mt-2">Tap the Pro Tips tab anytime to review this guide.</p>
        </div>
      </div>
    </div>
  );
}

const OPERATION_HELP: Record<string, { title: string; sections: { heading: string; body: string }[] }> = {
  milling: {
    title: "End Mill Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose the ISO category and specific material you're cutting. The engine uses calibrated SFM and chip load values validated for each material." },
      { heading: "2. Enter Tool Info", body: "Enter diameter, flute count, and LOC. Enter an EDP number to auto-fill geometry from the Core Cutter catalog." },
      { heading: "3. Set Your Machine", body: "Search for your machine or enter spindle HP, max RPM, taper, and toolholder. These drive the HP and stability calculations." },
      { heading: "4. Cut Engagement", body: "Select a cut mode (HEM, Traditional, Finish, Face, Slot, Circ Interp) and set WOC and DOC. Use Low/Med/High presets as a starting point." },
      { heading: "5. Calculate", body: "Hit Calculate to get RPM, feed, chip load, HP draw, and a full stability audit with chatter risk analysis and ranked improvement suggestions." },
      { heading: "Exports", body: "Export results as a formatted PDF report or a CAM setup sheet for notepad/CNC use. Your email is required for all exports." },
    ],
  },
  feedmilling: {
    title: "Chamfer Mill Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose the material you're chamfering. SFM and chip load are calibrated per material for chamfer mill geometry." },
      { heading: "2. Enter Tool Info", body: "Enter the chamfer mill diameter, included angle, and edge length. Enter an EDP number to auto-fill from the Core Cutter catalog." },
      { heading: "3. Set Your Machine", body: "Enter spindle HP, max RPM, and toolholder. The engine checks HP draw against your available spindle power." },
      { heading: "4. Cut Parameters", body: "Set your chamfer depth and contact length. The engine calculates the effective cutting diameter at depth and adjusts RPM accordingly." },
      { heading: "5. Calculate", body: "Hit Calculate to get RPM, feed rate, and chip load tailored to your chamfer geometry." },
    ],
  },
  drilling: {
    title: "Drilling Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — the engine uses drill-specific SFM and feed per rev values for each." },
      { heading: "2. Enter Tool Info", body: "Enter drill diameter, flute length, and point angle. Enter an EDP number to auto-fill from the Core Cutter drill catalog." },
      { heading: "3. Set Your Machine", body: "Enter spindle HP, max RPM, and toolholder. Drilling torque and thrust are checked against your machine." },
      { heading: "4. Hole Parameters", body: "Enter hole depth and select a peck cycle if needed. The engine accounts for full-depth vs. peck chip evacuation." },
      { heading: "5. Calculate", body: "Hit Calculate to get RPM, feed rate, cycle time, and HP draw for your drill operation." },
    ],
  },
  reaming: {
    title: "Reaming Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — reaming SFM is significantly lower than drilling for the same material." },
      { heading: "2. Enter Tool Info", body: "Enter reamer diameter and flute count. The engine uses reamer-specific chip load values." },
      { heading: "3. Tolerance Class", body: "Select H6, H7, or H8 tolerance class. The engine calculates the correct finished bore diameter and required stock removal." },
      { heading: "4. Pre-Drill Diameter", body: "Enter your pre-drilled hole diameter. The engine verifies the stock removal is within reaming range." },
      { heading: "5. Calculate", body: "Hit Calculate to get RPM, feed rate, and chip load optimized for your reaming operation." },
    ],
  },
  threadmilling: {
    title: "Thread Mill Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — thread milling SFM and chip load are calibrated per material." },
      { heading: "2. Enter Tool Info", body: "Enter thread mill diameter and enter your EDP number to auto-fill Core Cutter thread mill geometry." },
      { heading: "3. Thread Specification", body: "Enter the major diameter and TPI (inch) or pitch (metric). The engine calculates the correct helical path geometry." },
      { heading: "4. Thread Engagement", body: "Set your thread engagement depth. The engine calculates the cutting forces and HP draw for the full thread profile." },
      { heading: "5. G-Code Output", body: "Hit Calculate to get RPM, feed, and a ready-to-use G-code helical interpolation block for your thread." },
    ],
  },
  keyseat: {
    title: "Keyseat Cutter Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — keyseat cutters operate at lower SFM due to their side-cutting geometry." },
      { heading: "2. Enter Tool Info", body: "Enter the keyseat cutter diameter, width, and arbor diameter. Enter an EDP number to auto-fill from the Core Cutter catalog." },
      { heading: "3. Slot Dimensions", body: "Enter the keyway width and depth. The engine calculates WOC and DOC based on your keyway geometry." },
      { heading: "4. Calculate", body: "Hit Calculate to get RPM, feed rate, and chip load for your keyseat operation." },
    ],
  },
  dovetail: {
    title: "Dovetail Cutter Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — dovetail cutters use side-cutting geometry with specific force characteristics." },
      { heading: "2. Enter Tool Info", body: "Enter the dovetail cutter diameter and included angle. Enter an EDP number to auto-fill from the Core Cutter catalog." },
      { heading: "3. Dovetail Geometry", body: "Enter the slot depth and width. The engine calculates the effective cutting diameter and adjusts speeds accordingly." },
      { heading: "4. Calculate", body: "Hit Calculate to get RPM, feed rate, and chip load for your dovetail operation." },
    ],
  },
};

const PAGE_HELP: Record<string, { title: string; sections: { heading: string; body: string }[] }> = {
  "/": {
    title: "Milling & Chamfer Advisor",
    sections: [],  // replaced dynamically by operation
  },
  "/catalog": {
    title: "Tool Finder",
    sections: [
      { heading: "Quick Search", body: "Type a diameter, series name, flute count, or coating into the search bar. Results update instantly as you type." },
      { heading: "EDP Numbers", body: "Each tool has a unique EDP number. Copy it into the Milling Advisor's EDP field to auto-fill tool geometry for your calculation." },
      { heading: "Filters", body: "Use the ISO category, coating, and corner condition filters to narrow results to exactly what you need." },
      { heading: "STP File Downloads", body: "Every EDP has a downloadable STP file for direct use in your CAM system — find the tool and grab the file in one step." },
      { heading: "Not finding what you need?", body: "Use the 'Contact us' link at the bottom of the page — Core Cutter can quote a special to your print." },
    ],
  },
  "/toolbox": {
    title: "Toolbox",
    sections: [
      { heading: "Sign In", body: "Enter your email address to receive a one-time code. No password needed — the code signs you in and keeps you logged in on this device." },
      { heading: "Save a Setup", body: "After running a calculation in the Milling Advisor, click Save Setup. Give it a name or use the default. It saves your full input set." },
      { heading: "Re-run a Setup", body: "Click Re-run this setup on any saved item to restore all inputs back into the Milling Advisor — ready to calculate or adjust." },
      { heading: "Save Your Machines", body: "Save your shop machines with spindle HP, taper, RPM, and toolholder info for quick recall on any future job." },
    ],
  },
  "/calculators": {
    title: "Calculators",
    sections: [
      { heading: "Speed & Feed", body: "Chip thinning, minimum chip thickness, and feed rate converters. Use these to validate or adjust values from the advisor." },
      { heading: "Arcs & Contours", body: "Arc entry feed adjustment, helical entry sizing, and no-post bore calculator. Essential for circ interp and helical toolpaths." },
      { heading: "How to Use", body: "All calculators are standalone — just enter your values and results update instantly. No connection to the engine required." },
    ],
  },
};

function HelpButton() {
  const [open, setOpen] = React.useState(false);
  const [location] = useLocation();

  // On the main advisor page, use operation-specific tips
  let pageHelp = PAGE_HELP[location] ?? null;
  if (location === "/") {
    const op = localStorage.getItem("cc_operation") || "milling";
    pageHelp = OPERATION_HELP[op] ?? OPERATION_HELP["milling"];
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 z-50 bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-semibold px-2 py-3 rounded-l-lg shadow-lg"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", top: "calc(50% + 36px)" }}
        aria-label="Pro Tips"
      >
        Pro Tips
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-xs bg-zinc-900 border-l border-zinc-700 h-full shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <p className="text-sm font-semibold text-white">Welcome to CoreCutCNC</p>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-5">
              {/* Page-specific help */}
              {pageHelp && (
                <div className="mb-1">
                  <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-3">{pageHelp.title} — Tips</p>
                  {pageHelp.sections.map(s => (
                    <div key={s.heading} className="mb-3">
                      <p className="text-xs font-semibold text-white mb-0.5">{s.heading}</p>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">{s.body}</p>
                    </div>
                  ))}
                  <div className="border-t border-zinc-800 my-4" />
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-3">App Overview</p>
                </div>
              )}
              {/* General overview */}
              {HELP_SECTIONS.map(s => (
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

function FeedbackButton() {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState("Bug");
  const [message, setMessage] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message, email }),
      });
      setSent(true);
      setTimeout(() => { setOpen(false); setSent(false); setMessage(""); setEmail(""); setType("Bug"); }, 2500);
    } catch { setOpen(false); }
    setSending(false);
  };

  return (
    <>
      {/* Floating tab */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 z-50 bg-zinc-700 hover:bg-zinc-600 text-white text-[11px] font-semibold px-2 py-3 rounded-l-lg shadow-lg"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", top: "calc(50% - 36px)" }}
        aria-label="Send feedback"
      >
        Feedback
      </button>

      {/* Slide-in panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-xs bg-zinc-900 border-l border-zinc-700 h-full shadow-2xl flex flex-col p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-white">Send Feedback</p>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white text-lg leading-none">✕</button>
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
                    <option>Suggestion</option>
                    <option>Compliment</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">Message <span className="text-red-400">*</span></label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={5}
                    placeholder="Tell us what's on your mind..."
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-orange-500 resize-none"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">Your email <span className="text-zinc-600">(optional)</span></label>
                  <input
                    type="email"
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Mentor} />
      <Route path="/catalog" component={Catalog} />
      <Route path="/toolbox" component={Toolbox} />
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
        <FeedbackButton />
        <HelpButton />
        <BrevoNudge />
        <AddToHomeScreenBanner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;