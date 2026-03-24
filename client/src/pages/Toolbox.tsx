import React from "react";
import { Link } from "wouter";

type ToolboxItem = {
  id: number;
  type: string;
  title: string;
  data: any;
  notes: string;
  created_at: string;
};

export default function Toolbox() {
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
          <img src="/COREcutCNC_HORZ.png" alt="CoreCutCNC" className="h-8 w-auto" style={{ mixBlendMode: "screen" }} />
          <span className="text-sm font-semibold text-muted-foreground">/ Toolbox</span>
        </div>
        {step === "items" && (
          <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">Sign out</button>
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
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                      onClick={e => { e.stopPropagation(); deleteItem(item.id); }}
                    >
                      Delete
                    </button>
                    <span className="text-muted-foreground text-sm">{expanded === item.id ? "▲" : "▼"}</span>
                  </div>
                </div>

                {expanded === item.id && item.data && (
                  <div className="border-t border-border px-4 py-3 bg-zinc-950/50">
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
                          localStorage.setItem("cc_restore_form", JSON.stringify(item.data.inputs));
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
          </div>
        )}
      </div>
    </div>
  );
}
