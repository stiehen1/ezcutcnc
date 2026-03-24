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
        <AddToHomeScreenBanner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;