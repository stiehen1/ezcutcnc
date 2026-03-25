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
      { heading: "1. Select Tool Type", body: "Under Operation / Process, select Endmill or Chamfer Mill — this sets the correct geometry model for your calculation." },
      { heading: "2. Select Your Process", body: "Then choose your operation — Milling, Drilling, Reaming, Thread Milling, Keyseat, or Dovetail. This sets the correct calculation model for your job." },
      { heading: "3. Select Your Material", body: "Choose the ISO category and specific material you're cutting. The engine uses calibrated SFM and chip load values validated for each material. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "4. Enter Tool Info", body: "Enter your Core Cutter EDP # to auto-fill all tool geometry and unlock the calculator — or use Tool Finder to browse and hit Use Tool to transfer automatically. EDP # is required to run a calculation. Once entered, a STP file download for that exact tool is also available for direct use in your CAM system. This section also accommodates special endmill prints from Core Cutter — upload your print to auto-fill dimensions and unlock the calculator for your custom tool." },
      { heading: "5. Cut Engagement", body: "Set your WOC, DOC, and tool stickout. Use the Low/Med/High presets as a starting point for WOC and DOC. The app calculates a recommended default stickout for your tool — use it as your starting point and adjust only if your setup requires more reach. Stickout directly affects chatter risk — keep it as short as your setup allows." },
      { heading: "6. Set Your Machine", body: "Search from over 429 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations. Also set your Max RPM Use — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "7. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc. If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "8. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "9. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "10. Calculate Your Results", body: "Hit Calculate to get RPM, feed, chip load, HP draw, and a full stability audit with chatter risk analysis and ranked improvement suggestions." },
      { heading: "Exports", body: "Export results as a formatted PDF report or a CAM setup sheet for notepad/CNC use. Your email is required for all exports." },
    ],
  },
  feedmilling: {
    title: "Chamfer Mill Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose the material you're chamfering. SFM and chip load are calibrated per material for chamfer mill geometry. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "2. Enter Tool Info", body: "Enter your Core Cutter EDP # to auto-fill all tool geometry and unlock the calculator — or use Tool Finder to browse and hit Use Tool to transfer automatically. EDP # is required to run a calculation. Once entered, a STP file download for that exact tool is also available for direct use in your CAM system. This section also accommodates special chamfer mill prints from Core Cutter — upload your print to auto-fill dimensions and unlock the calculator for your custom tool." },
      { heading: "3. Chamfer Depth", body: "Enter your required chamfer depth — this is a required user input. The engine uses it to calculate the effective cutting diameter at depth and adjust RPM and feed accordingly. The app displays the safe chamfer saddle range for your tool so you can confirm your depth stays within the working envelope." },
      { heading: "4. Entry Type (Default: Helical)", body: "Default to helical interpolation on all chamfer mill applications — it distributes the entry load smoothly and produces the cleanest edge. Only deviate when part geometry doesn't allow it: on straight edges use a ramp-in or sweep-in arc instead. Straight plunge is our least preferred — it drives the full cutting load at entry and can leave a witness mark. Program your entry type in CAM accordingly." },
      { heading: "5. Set Your Machine", body: "Search from over 429 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations. Also set your Max RPM Use — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "6. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc. If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "7. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "8. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "9. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, and chip load tailored to your chamfer geometry." },
    ],
  },
  drilling: {
    title: "Drilling Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose the ISO category and specific material you're cutting. The engine uses calibrated SFM and chip load values validated for each material. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "2. Hole Details", body: "Input your hole depth and hole type — through hole, blind, or counterbore. These drive cycle time, peck strategy, and chip evacuation recommendations." },
      { heading: "3. Enter Tool Info", body: "Upload your Core Cutter special drill print — the app reads the drawing and auto-fills all tool geometry for you. No manual entry required." },
      { heading: "4. Set Your Machine", body: "Search from over 429 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations. Also set your Max RPM Use — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "5. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc. If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "6. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "7. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "8. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, cycle time, and HP draw for your drill operation." },
    ],
  },
  reaming: {
    title: "Reaming Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — reaming SFM is significantly lower than drilling for the same material. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "2. Enter Tool Info", body: "Upload your Core Cutter special reamer print — the app reads the drawing and auto-fills all tool geometry for you. No manual entry required." },
      { heading: "3. Hole Details", body: "Enter your finished hole diameter, hole depth, and hole type (through or blind) — all three are required to generate your cutting parameters." },
      { heading: "4. Set Your Machine", body: "Search from over 429 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations. Also set your Max RPM Use — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "5. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc. If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "6. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "7. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "8. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, and chip load optimized for your reaming operation." },
    ],
  },
  threadmilling: {
    title: "Thread Mill Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — thread milling SFM and chip load are calibrated per material. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "2. Thread Details", body: "Enter the thread you need to cut — final major diameter, pitch diameter, thread depth, thread hand (RH or LH), and your G-code dialect (Fanuc/Haas or Siemens 840D). These drive the helical interpolation path geometry and the ready-to-use G-code output. Cut direction is automatically selected based on your material and hole type — top-down for most applications, bottom-up for tough materials (Inconel, titanium) and blind holes. You can override it if your specific setup requires." },
      { heading: "3. Tool Geometry", body: "Upload your Core Cutter special thread mill print (CC-XXXXX) — the app reads the drawing and auto-fills all tool geometry for you. No manual entry required. Review the extracted fields and correct any misreads before running." },
      { heading: "4. Set Your Machine", body: "Search from over 429 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations. Also set your Max RPM Use — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "5. Tool Holder", body: "Select the correct toolholder type for your setup — shrink fit, hydraulic, ER collet, etc. If you're using an extension or extended-reach holder, enable that option and enter the gage length and toolholder nose diameter. These inputs allow the stability engine to model the full stickout stack and flag any additional chatter risk introduced by the extension." },
      { heading: "6. Coolant", body: "Review the default coolant setting and confirm it matches your actual setup. Coolant selection affects SFM and tool life recommendations — flood, mist, through-spindle, and dry all behave differently depending on material and tool coating." },
      { heading: "7. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent — vise, pallet, chuck, tombstone, etc. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "8. Calculate Your Results", body: "Hit Calculate to get RPM, feed, and a ready-to-use G-code helical interpolation block for your thread." },
    ],
  },
  keyseat: {
    title: "Keyseat Cutter Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — keyseat cutters run at reduced SFM due to their side-cutting geometry and full-width engagement. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "Machining Strategy", body: "Keyseat cutters are force-dominated tools — your control knobs are chip thickness, tool deflection, and chip evacuation. NOT max RPM or SFM chasing.\n\n• Full slot engagement (180°) is fixed by tool geometry — no chip thinning benefit, high radial load\n• Never treat like an endmill — chip load must be derated 30–50% vs standard slotting IPT\n• Depth strategy: small tools (<3/8\") step down in multiple passes; medium tools can often go full depth with reduced feed; large tools (>3/4\") use a 2-pass approach — 60–70% depth first, then finish pass at full depth with lighter feed\n• Always climb mill — reduces rubbing, improves tool life, better chip evacuation direction\n• Entry: never straight plunge into full width — pre-drill or pre-mill relief if possible, otherwise arc/roll in\n• If it chatters: reduce stickout first, then reduce depth, then reduce feed — in that order" },
      { heading: "2. Enter Tool Info", body: "Upload your Core Cutter special keyseat print (CC-XXXXX) — the app reads the drawing and auto-fills Cut Dia, Flutes, LOC, Arbor/Neck Dia, and Reach/TSC for you. Review those fields and correct any misreads, then fill in the two fields the print won't have:\n\n• Cut Pass Depth — axial depth per pass; the engine suggests a safe starting depth based on tool size, neck strength, and material\n• **Final Slot Depth** — total required slot depth for your part; the engine calculates how many passes are needed and flags survivability concerns" },
      { heading: "3. Set Your Machine", body: "Search from over 429 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations. Also set your Max RPM Use — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "4. Tool Holder", body: "Shrink fit is the top choice for keyseat work — these tools behave like thin discs on a stick and need maximum grip rigidity. Hydraulic is also good; high-quality ER collet is acceptable. Avoid worn collets and long gauge lengths. Keep stickout as short as possible — stickout is the single biggest driver of deflection and breakage on keyseat cutters." },
      { heading: "5. Coolant", body: "Through-spindle coolant is ideal for keyseat work — chips have nowhere to go in a full-slot engagement and recutting chips is the #1 cause of breakage. High-pressure flood aimed directly into the cut is the next best option. Air blast assist is very effective. Avoid light mist only — it won't evacuate chips reliably in a closed slot." },
      { heading: "6. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "7. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, chip load per tooth, HP draw, deflection, and a pass-by-pass depth strategy. Watch for deflection warnings — keyseat tools are force-dominated and deflection is the primary failure predictor, not HP." },
    ],
  },
  dovetail: {
    title: "Dovetail Cutter Advisor",
    sections: [
      { heading: "1. Select Your Material", body: "Choose your material — dovetail cutters run at reduced SFM due to their angled side-cutting geometry and interrupted engagement. Also check and confirm your actual hardness — select HRC or HRB and enter your value. The engine applies a default if left blank, but entering your actual hardness gives you more accurate results." },
      { heading: "Machining Strategy", body: "Dovetail cutters are finishing tools — not roughing tools. Zero forgiveness due to their necked geometry, small effective cutting diameter, and long moment arm.\n\n• Pre-machine the slot first with a square or bull nose endmill — leave 0.005\"–0.015\" radial stock per side and open the full axial depth\n• Enter laterally only — never plunge\n• Run the dovetail per side, climb cutting each wall separately\n• Radial engagement: 0.003\"–0.010\" per side maximum\n• Axial DOC: full depth is fine once the slot is roughed\n• Chip load: start at 30–50% of your standard endmill IPT — effective diameter is small and too much chip load causes instant failure\n• If it sounds wrong, it is wrong — dovetails don't forgive" },
      { heading: "2. Enter Tool Info", body: "Upload your Core Cutter special dovetail print (CC-XXXXX) — the app reads the drawing and auto-fills all tool geometry for you. No manual entry required. Review the extracted fields and correct any misreads, then fill in the two fields the print won't have:\n\n• Radial Pass Depth — how far the cutter steps into the dovetail wall per pass. Dovetail cutters always enter laterally from outside the part or a pre-slotted pocket — never plunge. The neck is narrower than the cutting head so keep passes conservative.\n• **Final Wall Depth** — total radial depth from the pre-slotted pocket edge to full dovetail form. The engine calculates how many lateral passes are needed and flags survivability concerns." },
      { heading: "3. Set Your Machine", body: "Search from over 429 machines in our database or build your own if your machine isn't listed. Selecting a machine pre-fills spindle HP, max RPM, taper, drive type, and coolant options — all of which drive the HP and stability calculations. Also set your Max RPM Use — this caps how much of your spindle's max RPM the engine will target. Use 95% for standard work; drop to 90% or lower for older spindles, high runout, or long-reach setups where vibration is a concern." },
      { heading: "4. Tool Holder", body: "Hydraulic or shrink-fit holders are strongly preferred for dovetail work — dovetail tools behave like thin cantilever beams with an offset load and require maximum grip rigidity. Dual contact (where available) adds further stability. Keep stickout as short as your setup allows — every extra inch of stickout multiplies deflection force significantly. If you're using an extension holder, enter the gage length and nose diameter so the engine can model the full stickout stack." },
      { heading: "5. Coolant", body: "Air blast is the preferred coolant method for dovetail cutters — the goal is chip evacuation, not cooling. Mist is also good. Flood is acceptable but watch for chip packing in the slot. Through-spindle coolant is rarely applicable. Select the method that best clears chips from the engaged wall." },
      { heading: "6. Workholding", body: "Check the workholding selection and confirm it matches your exact setup. If your fixture isn't listed, select the closest equivalent. Workholding rigidity directly influences the stability calculation and chatter risk assessment." },
      { heading: "7. Calculate Your Results", body: "Hit Calculate to get RPM, feed rate, chip load per tooth, HP draw, effective cutting diameter (adjusted for dovetail angle), deflection, and a pass-by-pass lateral strategy for reaching your final wall depth safely. If chatter occurs after running — reduce stickout first, then reduce radial pass depth, then reduce chip load." },
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
      { heading: "Tool Type", body: "Select Endmill or Chamfer Mill to narrow results to the correct tool family before applying further filters." },
      { heading: "Filters", body: "Drill-down fields allow you to select specific tool geometry — diameter, flutes, coating, corner condition and more — to filter out tools you don't need and zero in on exactly the right cutter." },
      { heading: "Part Feature Match", body: "Three powerful optional fields that match the tool directly to your part geometry — and can further restrict your filtered results:\n\n• **Final Axial Cut Depth** — ensures the LOC covers your required depth.\n• **Min. Part Radius (Wall to Wall)** — matches the corner radius to your inside wall.\n• **Max. Part Floor Radius (Floor to Wall)** — ensures the corner radius clears your floor blend.\n\nEnter your part dimensions and the finder returns only tools that fit — eliminating guesswork." },
      { heading: "Use Tool", body: "Found the right cutter? Hit Use Tool on any result to instantly transfer all tool geometry to the Milling & Chamfer Advisor — no typing required." },
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
      { heading: "Speed & Feed", body: "RPM ↔ SFM, Feed Rate, Chip Thinning, Feed from SFM, Engagement Angle, Min Chip Thickness. Use these to validate or fine-tune values from the advisor." },
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
  const [open, setOpen] = React.useState(false);
  const [overviewOpen, setOverviewOpen] = React.useState(false);
  const [location] = useLocation();

  // On the main advisor page, use operation-specific tips
  let pageHelp = PAGE_HELP[location] ?? null;
  if (location === "/") {
    const op = localStorage.getItem("cc_operation") || "milling";
    if (op === "toolfinder") {
      pageHelp = PAGE_HELP["/catalog"] ?? null;
    } else if (op === "feedmilling") {
      pageHelp = PAGE_HELP["/calculators"] ?? null;
    } else if (op === "toolbox") {
      pageHelp = PAGE_HELP["/toolbox"] ?? null;
    } else if (op === "milling") {
      const toolType = localStorage.getItem("cc_tool_type") || "endmill";
      pageHelp = toolType === "chamfer_mill" ? OPERATION_HELP["feedmilling"] : OPERATION_HELP["milling"];
    } else {
      pageHelp = OPERATION_HELP[op] ?? OPERATION_HELP["milling"];
    }
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
                      {s.body.includes('\n•') ? (
                        <div className="text-[11px] text-zinc-400 leading-relaxed">
                          {s.body.split('\n').map((line, i) => {
                            const renderBold = (text: string) => {
                              const parts = text.split(/\*\*(.+?)\*\*/g);
                              return parts.map((p, j) => j % 2 === 1 ? <strong key={j} className="text-white">{p}</strong> : p);
                            };
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