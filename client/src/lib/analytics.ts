declare function gtag(...args: any[]): void;

function ga(name: string, params?: Record<string, string | number | boolean>) {
  if (typeof window !== "undefined" && typeof gtag !== "undefined") {
    gtag("event", name, params);
  }
}

/** Call after a successful calculation run. Also bumps the calc count used for the feedback nudge. */
export function trackCalculation(material: string, mode: string, toolDia: number) {
  const count = parseInt(localStorage.getItem("calc_count") || "0") + 1;
  localStorage.setItem("calc_count", String(count));
  window.dispatchEvent(new CustomEvent("calc_count_updated", { detail: count }));
  ga("calculation_run", { material, mode, tool_dia: toolDia });
}

export function trackPdfExport(mode: string) {
  ga("pdf_export", { mode });
}

export function trackEdpLookup(edp: string) {
  ga("edp_lookup", { edp });
}

export function trackToolboxSubmit() {
  ga("toolbox_submit");
}
