import { Switch, Route } from "wouter";
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
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-semibold px-2 py-3 rounded-l-lg shadow-lg writing-mode-vertical"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "translateY(-50%) rotate(180deg)" }}
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
        <FeedbackButton />
        <BrevoNudge />
        <AddToHomeScreenBanner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;