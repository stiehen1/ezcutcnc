import React from "react";
import { Link, useLocation } from "wouter";

type ToolboxItem = {
  id: number;
  type: string;
  title: string;
  data: any;
  notes: string;
  created_at: string;
};

export default function Toolbox() {
  const [, navigate] = useLocation();
  const [email, setEmail] = React.useState(() => localStorage.getItem("tb_email") || "");
  const [token, setToken] = React.useState(() => localStorage.getItem("tb_token") || "");
  const [step, setStep] = React.useState<"email" | "code" | "items">(
    localStorage.getItem("tb_email") && localStorage.getItem("tb_token") ? "items" : "email"
  );
  const [inputEmail, setInputEmail] = React.useState("");
  const [inputCode, setInputCode] = React.useState("");
  const [items, setItems] = React.useState<ToolboxItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [renamingId, setRenamingId] = React.useState<number | null>(null);
  const [renameText, setRenameText] = React.useState("");
  const [roiItems, setRoiItems] = React.useState<any[]>([]);
  const [roiDraft, setRoiDraft] = React.useState<any>(null);
  const [roiExpanded, setRoiExpanded] = React.useState<number | null>(null);

  // Load items on mount if already authed
  React.useEffect(() => {
    if (step === "items") loadItems();
  }, [step]);

  async function sendCode() {
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/toolbox/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inputEmail }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Failed to send code"); return; }
      setStep("code");
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  async function verifyCode() {
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/toolbox/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inputEmail, code: inputCode }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Invalid code"); return; }
      localStorage.setItem("tb_email", inputEmail.toLowerCase());
      localStorage.setItem("tb_token", d.token);
      setEmail(inputEmail.toLowerCase());
      setToken(d.token);
      setStep("items");
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  async function loadItems() {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    if (!e || !t) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/toolbox/items?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`);
      if (r.status === 401) { signOut(); return; }
      const d = await r.json();
      setItems(d);
      // Load completed ROIs from DB
      const userEmail = localStorage.getItem("er_email") || e;
      try {
        const rr = await fetch(`/api/roi?email=${encodeURIComponent(userEmail)}`);
        if (rr.ok) setRoiItems(await rr.json());
      } catch { /* silently skip */ }
      // Load draft from localStorage
      const draft = localStorage.getItem("roi_draft");
      if (draft) {
        try { setRoiDraft(JSON.parse(draft)); } catch { /* skip */ }
      }
    } catch { setError("Failed to load toolbox"); }
    finally { setLoading(false); }
  }

  async function deleteItem(id: number) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    await fetch(`/api/toolbox/items/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t }),
    });
    setItems(prev => prev.filter(i => i.id !== id));
  }

  async function renameItem(id: number, title: string) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    const r = await fetch(`/api/toolbox/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t, title }),
    });
    if (r.ok) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, title } : i));
      setRenamingId(null);
      setRenameText("");
    }
  }

  function signOut() {
    localStorage.removeItem("tb_email");
    localStorage.removeItem("tb_token");
    setEmail(""); setToken(""); setStep("email"); setItems([]);
  }

  function formatDate(s: string) {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">← Back to Calculator</Link>
        </div>
        <div className="flex items-center gap-2">
          <img src="/COREcutCNC_long_dark_logo.png" alt="CoreCutCNC" className="h-12 w-auto" style={{ mixBlendMode: "screen" }} />
          <span className="text-sm font-semibold text-muted-foreground">/ Toolbox</span>
        </div>
        {step === "items" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 hidden sm:block">{email}</span>
            <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">Sign out</button>
          </div>
        )}
        {step !== "items" && <div className="w-16" />}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Email step */}
        {step === "email" && (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <div className="text-4xl mb-3">🧰</div>
              <h2 className="text-xl font-bold mb-1">Access Your Toolbox</h2>
              <p className="text-sm text-muted-foreground">Enter your email to save and retrieve your Speed &amp; Feed results.</p>
            </div>
            <div className="w-full max-w-sm space-y-3">
              <input
                type="email"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
                placeholder="your@email.com"
                value={inputEmail}
                onChange={e => setInputEmail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendCode(); }}
                autoFocus
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
                onClick={sendCode}
                disabled={loading || !inputEmail}
              >
                {loading ? "Sending…" : "Send Verification Code"}
              </button>
            </div>
          </div>
        )}

        {/* Code step */}
        {step === "code" && (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <div className="text-4xl mb-3">📬</div>
              <h2 className="text-xl font-bold mb-1">Check Your Email</h2>
              <p className="text-sm text-muted-foreground">We sent a 6-digit code to <span className="text-white">{inputEmail}</span></p>
            </div>
            <div className="w-full max-w-sm space-y-3">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-center tracking-widest text-lg focus:outline-none focus:border-indigo-500"
                placeholder="000000"
                value={inputCode}
                onChange={e => setInputCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={e => { if (e.key === "Enter") verifyCode(); }}
                autoFocus
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
                onClick={verifyCode}
                disabled={loading || inputCode.length !== 6}
              >
                {loading ? "Verifying…" : "Open Toolbox"}
              </button>
              <button className="w-full text-xs text-muted-foreground hover:text-foreground" onClick={() => { setStep("email"); setError(""); setInputCode(""); }}>
                ← Use a different email
              </button>
            </div>
          </div>
        )}

        {/* Items view */}
        {step === "items" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{email}</p>
              <button onClick={loadItems} className="text-xs text-indigo-400 hover:text-indigo-300">Refresh</button>
            </div>

            {loading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}

            {!loading && items.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-sm text-muted-foreground">No saved results yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Run a Speed &amp; Feed calculation and hit "Save to Toolbox".</p>
                <Link href="/" className="mt-4 inline-block text-sm text-indigo-400 hover:text-indigo-300">Go to Calculator →</Link>
              </div>
            )}

            {items.map(item => (
              <div key={item.id} className="border border-border rounded-xl overflow-hidden">
                {renamingId === item.id ? (
                  <div className="flex items-center gap-2 px-4 py-3 bg-zinc-900/80" onClick={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      type="text"
                      value={renameText}
                      onChange={e => setRenameText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && renameText.trim()) renameItem(item.id, renameText); if (e.key === "Escape") { setRenamingId(null); setRenameText(""); } }}
                      className="flex-1 bg-zinc-800 border border-indigo-500 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
                      placeholder="Enter a title…"
                    />
                    <button className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold px-2" onClick={() => { if (renameText.trim()) renameItem(item.id, renameText); }}>Save</button>
                    <button className="text-xs text-zinc-500 hover:text-white px-2" onClick={() => { setRenamingId(null); setRenameText(""); }}>Cancel</button>
                  </div>
                ) : (
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-900/50"
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{item.type === "result" ? "⚡" : item.type === "print" ? "📄" : "🔩"}</span>
                    <div>
                      <div className="text-sm font-semibold">{item.title}</div>
                      <div className="text-[11px] text-muted-foreground">{formatDate(item.created_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-xs text-zinc-500 hover:text-indigo-400 px-2 py-1"
                      onClick={e => { e.stopPropagation(); setRenamingId(item.id); setRenameText(item.title); }}
                    >
                      Rename
                    </button>
                    <button
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                      onClick={e => { e.stopPropagation(); deleteItem(item.id); }}
                    >
                      Delete
                    </button>
                    <span className="text-muted-foreground text-sm">{expanded === item.id ? "▲" : "▼"}</span>
                  </div>
                </div>
                )}

                {expanded === item.id && item.data && (
                  <div className="border-t border-border px-4 py-3 bg-zinc-950/50">
                    {(item.data.tool_number || item.data.inputs?.edp) && (
                      <div className="mb-2 pb-2 border-b border-border">
                        <span className="text-[11px] text-zinc-500">{item.data.tool_number ? "CC#" : "EDP#"}  </span>
                        <span className="text-sm font-bold text-orange-400">{item.data.tool_number || item.data.inputs?.edp}</span>
                      </div>
                    )}
                    {item.data.customer && (
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        {[
                          ["Material", item.data.inputs?.material],
                          ["Diameter", item.data.inputs?.tool_dia ? `${item.data.inputs.tool_dia}"` : null],
                          ["Flutes", item.data.inputs?.flutes],
                          ["RPM", item.data.customer?.rpm ? Math.round(item.data.customer.rpm).toLocaleString() : null],
                          ["Feed (IPM)", item.data.customer?.feed_ipm ? item.data.customer.feed_ipm.toFixed(1) : null],
                          ["SFM", item.data.customer?.sfm ? Math.round(item.data.customer.sfm) : null],
                          ["DOC", item.data.customer?.doc_in ? `${item.data.customer.doc_in.toFixed(3)}"` : null],
                          ["WOC", item.data.customer?.woc_in ? `${item.data.customer.woc_in.toFixed(3)}"` : null],
                          ["HP Required", item.data.customer?.hp_required ? item.data.customer.hp_required.toFixed(2) : null],
                        ].filter(([, v]) => v != null).map(([label, val]) => (
                          <div key={label as string}>
                            <div className="text-muted-foreground">{label}</div>
                            <div className="font-semibold text-white">{String(val)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {item.notes && (
                      <p className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">{item.notes}</p>
                    )}
                    <button
                      className="mt-3 text-xs text-indigo-400 hover:text-indigo-300"
                      onClick={() => {
                        if (item.data?.inputs) {
                          localStorage.setItem("cc_restore_form", JSON.stringify(item.data));
                        }
                        window.location.href = "/";
                      }}
                    >
                      Re-run this setup →
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* ROI Section */}
            {(roiDraft || roiItems.length > 0) && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-green-300">📊 ROI Comparisons</span>
                  <span className="text-xs text-zinc-500">{roiItems.length} completed{roiDraft ? " · 1 in progress" : ""}</span>
                </div>

                {/* In Progress Draft */}
                {roiDraft && (
                  <div className="border border-amber-600/40 rounded-xl overflow-hidden bg-amber-950/20">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">⏳</span>
                        <div>
                          <div className="text-sm font-semibold text-amber-300">In Progress</div>
                          <div className="text-[11px] text-zinc-500">
                            {roiDraft.compEdp ? `vs ${roiDraft.compEdp} · ` : ""}
                            {roiDraft.result ? `$${Number(roiDraft.result.savingsPerPart).toFixed(2)}/part estimated` : "Not yet calculated"}
                          </div>
                        </div>
                      </div>
                      <button
                        className="text-xs bg-green-700/30 hover:bg-green-700/50 text-green-300 border border-green-700/40 rounded px-3 py-1.5 font-semibold"
                        onClick={() => {
                          localStorage.setItem("roi_resume", "1");
                          window.location.href = "/";
                        }}
                      >
                        Resume →
                      </button>
                    </div>
                  </div>
                )}

                {/* Completed ROIs */}
                {roiItems.map((roi: any) => (
                  <div key={roi.id} className="border border-green-700/30 rounded-xl overflow-hidden bg-green-950/10">
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-green-950/20"
                      onClick={() => setRoiExpanded(roiExpanded === roi.id ? null : roi.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-lg flex-shrink-0">✅</span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-green-300 truncate">
                            {roi.roi_name || `${roi.cc_edp || "CC"} vs ${roi.comp_brand || roi.comp_edp || "Incumbent"}`}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            ${Number(roi.annual_savings).toFixed(0)}/yr · {roi.material} · {formatDate(roi.updated_at || roi.created_at)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            // Build a full draft object from DB row so Mentor.tsx restores everything
                            const draft: Record<string, unknown> = {
                              roiName: roi.roi_name || "",
                              roiSessionId: roi.roi_session_id || undefined,
                              lifeMode: roi.life_mode || "parts",
                              // CC tool
                              ccPrice: String(roi.cc_tool_price ?? ""),
                              ccParts: String(roi.cc_parts_per_tool ?? ""),
                              ccCutTime: String(roi.cc_time_in_cut ?? ""),
                              ccMrr: String(roi.cc_mrr ?? ""),
                              // Reco (recon)
                              reconEnabled: !!roi.recon_enabled,
                              reconGrinds: String(roi.recon_grinds ?? ""),
                              reconRetention: String(roi.recon_retention ?? ""),
                              // Comp tool
                              compBrand: roi.comp_brand || "",
                              compEdp: roi.comp_edp || "",
                              compPrice: String(roi.comp_price ?? ""),
                              compParts: String(roi.comp_parts_per_tool ?? ""),
                              compTime: String(roi.comp_time_in_cut ?? ""),
                              compMrr: String(roi.comp_mrr ?? ""),
                              compCutTime: String(roi.comp_time_in_cut ?? ""),
                              // Context
                              shopRate: String(roi.shop_rate ?? ""),
                              annualVol: String(roi.annual_volume ?? ""),
                              matVolPerPart: String(roi.mat_vol_per_part ?? ""),
                              // Customer info
                              userType: roi.user_type || "",
                              distributorName: roi.distributor_name || "",
                              distributorCode: roi.distributor_code || "",
                              endUserName: roi.end_user_name || "",
                              endUserEmail: roi.end_user_email || "",
                              endUserCompany: roi.end_user_company || "",
                              _roiLoadedId: roi.id,
                            };
                            localStorage.setItem("roi_draft", JSON.stringify(draft));
                            localStorage.setItem("roi_resume", "1");
                            navigate("/");
                          }}
                          className="text-[11px] px-2 py-1 rounded-md bg-green-800/50 hover:bg-green-700/60 text-green-300 font-medium transition-colors"
                        >
                          Rerun →
                        </button>
                        <button
                          type="button"
                          onClick={async e => {
                            e.stopPropagation();
                            if (!confirm("Delete this ROI? This cannot be undone.")) return;
                            const userEmail = localStorage.getItem("er_email") || "";
                            await fetch(`/api/roi/${roi.id}?email=${encodeURIComponent(userEmail)}`, { method: "DELETE" });
                            setRoiItems(prev => prev.filter((r: any) => r.id !== roi.id));
                          }}
                          className="text-[11px] px-2 py-1 rounded-md bg-red-900/40 hover:bg-red-800/60 text-red-400 font-medium transition-colors"
                        >
                          Delete
                        </button>
                        <span className="text-muted-foreground text-sm">{roiExpanded === roi.id ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {roiExpanded === roi.id && (
                      <div className="border-t border-green-700/20 px-4 py-3 bg-green-950/20">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {[
                            ["Savings/Part", `$${Number(roi.savings_per_part).toFixed(2)}`],
                            ["Monthly Savings", `$${Number(roi.monthly_savings).toFixed(2)}`],
                            ["Annual Savings", `$${Number(roi.annual_savings).toFixed(2)}`],
                            ["% Reduction", `${Number(roi.savings_pct).toFixed(1)}%`],
                            ["CC Tool Price", `$${Number(roi.cc_tool_price).toFixed(2)}`],
                            [roi.comp_brand ? `${roi.comp_brand} Price` : "Comp Tool Price", `$${Number(roi.comp_price).toFixed(2)}`],
                            ["CC Parts/Tool", roi.cc_parts_per_tool],
                            ["Comp Parts/Tool", roi.comp_parts_per_tool],
                            ...(roi.shop_rate ? [["Shop Rate", `$${Number(roi.shop_rate).toFixed(0)}/hr`]] : []),
                            ...(roi.annual_volume ? [["Annual Volume", String(roi.annual_volume)]] : []),
                          ].map(([label, val]) => (
                            <div key={label as string}>
                              <div className="text-zinc-500">{label}</div>
                              <div className="font-semibold text-white">{String(val)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
