import React from "react";
import { Link } from "wouter";

type User = {
  email: string;
  joined: string;
  save_count: string;
  last_active: string | null;
  blocked: boolean;
};

type ActivityItem = {
  id: number;
  email: string;
  title: string;
  type: string;
  created_at: string;
};

type OperationCount = {
  operation: string;
  count: string;
};

type Stats = {
  users: User[];
  activity: ActivityItem[];
  operations: OperationCount[];
  totals: { users: number; saves: number };
};

type AllowedEmail = { email: string; notes: string; added_at: string };
type BlockedDomain = { domain: string; reason: string; added_at: string };
type BlockedUser = { email: string; created_at: string };

type AccessData = {
  allowed_emails: AllowedEmail[];
  blocked_domains: BlockedDomain[];
  blocked_users: BlockedUser[];
};

export default function Admin() {
  const [authed, setAuthed] = React.useState(() => sessionStorage.getItem("admin_token") === "corecutter1");
  const [password, setPassword] = React.useState("");
  const [authError, setAuthError] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);
  const [tab, setTab] = React.useState<"users" | "activity" | "usage" | "access">("users");
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [access, setAccess] = React.useState<AccessData | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Access form state
  const [newEmail, setNewEmail] = React.useState("");
  const [newEmailNotes, setNewEmailNotes] = React.useState("");
  const [newDomain, setNewDomain] = React.useState("");
  const [newDomainReason, setNewDomainReason] = React.useState("");
  const [accessSaving, setAccessSaving] = React.useState(false);
  const [accessMsg, setAccessMsg] = React.useState("");

  React.useEffect(() => {
    if (authed) { loadStats(); loadAccess(); }
  }, [authed]);

  const token = () => sessionStorage.getItem("admin_token") || "";

  async function login() {
    setAuthError("");
    setAuthLoading(true);
    try {
      const r = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        sessionStorage.setItem("admin_token", password);
        setAuthed(true);
      } else {
        setAuthError("Incorrect password");
      }
    } catch {
      setAuthError("Network error");
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadStats() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/stats?token=${encodeURIComponent(token())}`);
      if (r.status === 401) { sessionStorage.removeItem("admin_token"); setAuthed(false); return; }
      setStats(await r.json());
    } finally {
      setLoading(false);
    }
  }

  async function loadAccess() {
    const r = await fetch(`/api/admin/access?token=${encodeURIComponent(token())}`);
    if (r.ok) setAccess(await r.json());
  }

  async function addEmail() {
    if (!newEmail.trim()) return;
    setAccessSaving(true);
    const r = await fetch("/api/admin/allowed-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token() },
      body: JSON.stringify({ email: newEmail.trim(), notes: newEmailNotes.trim() }),
    });
    if (r.ok) {
      setNewEmail(""); setNewEmailNotes("");
      flash("Email added to allowlist.");
      loadAccess();
    }
    setAccessSaving(false);
  }

  async function removeEmail(email: string) {
    await fetch(`/api/admin/allowed-emails/${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { "x-admin-token": token() },
    });
    flash("Removed from allowlist.");
    loadAccess();
  }

  async function addDomain() {
    if (!newDomain.trim()) return;
    setAccessSaving(true);
    const r = await fetch("/api/admin/blocked-domains", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token() },
      body: JSON.stringify({ domain: newDomain.trim(), reason: newDomainReason.trim() }),
    });
    if (r.ok) {
      setNewDomain(""); setNewDomainReason("");
      flash("Domain blocked.");
      loadAccess();
    }
    setAccessSaving(false);
  }

  async function removeDomain(domain: string) {
    await fetch(`/api/admin/blocked-domains/${encodeURIComponent(domain)}`, {
      method: "DELETE",
      headers: { "x-admin-token": token() },
    });
    flash("Domain unblocked.");
    loadAccess();
  }

  async function toggleBlock(email: string, currentlyBlocked: boolean) {
    await fetch(currentlyBlocked ? "/api/admin/unblock-user" : "/api/admin/block-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token() },
      body: JSON.stringify({ email }),
    });
    flash(currentlyBlocked ? `${email} unblocked.` : `${email} blocked.`);
    loadStats(); loadAccess();
  }

  function flash(msg: string) {
    setAccessMsg(msg);
    setTimeout(() => setAccessMsg(""), 3000);
  }

  function fmt(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtTime(s: string) {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 w-80 shadow-2xl">
          <h1 className="text-lg font-bold mb-1">Admin Dashboard</h1>
          <p className="text-xs text-zinc-400 mb-5">Core Cutter internal use only.</p>
          <input
            type="password"
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 mb-2"
            placeholder="Admin password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") login(); }}
            autoFocus
          />
          {authError && <p className="text-xs text-red-400 mb-2">{authError}</p>}
          <button
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
            onClick={login}
            disabled={authLoading || !password}
          >
            {authLoading ? "Checking…" : "Sign In"}
          </button>
          <div className="mt-4 text-center">
            <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← Back to Calculator</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Calculator</Link>
        <div className="flex items-center gap-2">
          <img src="/CCLogo-long-blackback.png" alt="Core Cutter" className="h-6 w-auto" />
          <span className="text-sm font-bold tracking-widest text-orange-500">CoreCutCNC</span>
          <span className="text-sm font-semibold text-muted-foreground">/ Admin</span>
        </div>
        <button
          onClick={() => { sessionStorage.removeItem("admin_token"); setAuthed(false); }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Summary cards */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-900 border border-border rounded-xl px-4 py-3">
              <div className="text-xs text-muted-foreground">Toolbox Users</div>
              <div className="text-3xl font-bold text-indigo-400 mt-1">{stats.totals.users}</div>
            </div>
            <div className="bg-zinc-900 border border-border rounded-xl px-4 py-3">
              <div className="text-xs text-muted-foreground">Total Saved Results</div>
              <div className="text-3xl font-bold text-indigo-400 mt-1">{stats.totals.saves}</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 border border-border">
          {(["users", "activity", "usage", "access"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 rounded-md py-1.5 text-xs font-semibold transition-all capitalize"
              style={{
                backgroundColor: tab === t ? (t === "access" ? "#7c3aed" : "#6366f1") : "transparent",
                color: tab === t ? "#fff" : "#a1a1aa",
              }}
            >
              {t === "users" ? "Users" : t === "activity" ? "Recent Activity" : t === "usage" ? "Usage" : "Access Control"}
            </button>
          ))}
        </div>

        {/* Flash message */}
        {accessMsg && (
          <div className="bg-green-900/40 border border-green-600/40 text-green-300 text-xs rounded-lg px-3 py-2">
            {accessMsg}
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}

        {/* Users tab */}
        {!loading && tab === "users" && stats && (
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Joined</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Saves</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Last Active</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.users.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted-foreground px-4 py-8">No users yet.</td></tr>
                )}
                {stats.users.map((u, i) => (
                  <tr key={u.email} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: u.blocked ? "#f87171" : "#fff" }}>
                      {u.email}
                      {u.blocked && <span className="ml-2 text-[10px] bg-red-900/50 text-red-400 rounded px-1">BLOCKED</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmt(u.joined)}</td>
                    <td className="px-4 py-2.5">
                      <span className="bg-indigo-600/20 text-indigo-300 rounded px-1.5 py-0.5">{u.save_count}</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmt(u.last_active)}</td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => toggleBlock(u.email, u.blocked)}
                        className={`text-[10px] font-semibold rounded px-2 py-1 transition-colors ${
                          u.blocked
                            ? "bg-green-900/40 text-green-400 hover:bg-green-800/60"
                            : "bg-red-900/30 text-red-400 hover:bg-red-800/50"
                        }`}
                      >
                        {u.blocked ? "Unblock" : "Block"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Activity tab */}
        {!loading && tab === "activity" && stats && (
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Title</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.activity.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-muted-foreground px-4 py-8">No activity yet.</td></tr>
                )}
                {stats.activity.map((a, i) => (
                  <tr key={a.id} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                    <td className="px-4 py-2.5 font-medium text-white">{a.title}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtTime(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Usage tab */}
        {!loading && tab === "usage" && stats && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Saved results by operation type</p>
            {stats.operations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No data yet.</p>
            )}
            {stats.operations.map(op => {
              const total = stats.operations.reduce((s, o) => s + Number(o.count), 0);
              const pct = total > 0 ? Math.round((Number(op.count) / total) * 100) : 0;
              return (
                <div key={op.operation} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium capitalize">{op.operation || "unknown"}</span>
                    <span className="text-muted-foreground">{op.count} saves ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Access Control tab */}
        {tab === "access" && (
          <div className="space-y-8">
            {/* How it works */}
            <div className="bg-zinc-900 border border-violet-700/30 rounded-xl px-4 py-3 text-xs text-zinc-400 space-y-1">
              <p className="text-violet-300 font-semibold mb-1">How access control works</p>
              <p><span className="text-white">1. Domain blocklist</span> — any email from a blocked domain is rejected instantly.</p>
              <p><span className="text-white">2. User block</span> — a specific email is suspended (block button on Users tab).</p>
              <p><span className="text-white">3. Allowlist</span> — when this list has <em>any</em> entries, only listed emails can log in. Leave it empty to allow everyone (open access).</p>
            </div>

            {/* Allowed Emails */}
            <div>
              <h2 className="text-sm font-bold text-white mb-3">Allowed Emails <span className="text-xs font-normal text-zinc-400">(invitation-only — leave empty for open access)</span></h2>
              <div className="flex gap-2 mb-3">
                <input
                  type="email"
                  placeholder="user@company.com"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
                />
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={newEmailNotes}
                  onChange={e => setNewEmailNotes(e.target.value)}
                  className="w-40 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={addEmail}
                  disabled={accessSaving || !newEmail.trim()}
                  className="bg-violet-700 hover:bg-violet-600 text-white rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40 transition-colors"
                >
                  Add
                </button>
              </div>
              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Email</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Notes</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Added</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {(!access || access.allowed_emails.length === 0) && (
                      <tr><td colSpan={4} className="text-center text-muted-foreground px-4 py-6">No emails on allowlist — access is open to everyone.</td></tr>
                    )}
                    {access?.allowed_emails.map((e, i) => (
                      <tr key={e.email} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                        <td className="px-4 py-2.5 font-medium text-white">{e.email}</td>
                        <td className="px-4 py-2.5 text-zinc-400">{e.notes || "—"}</td>
                        <td className="px-4 py-2.5 text-zinc-400">{fmt(e.added_at)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => removeEmail(e.email)}
                            className="text-[10px] text-red-400 hover:text-red-300 font-semibold"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Blocked Domains */}
            <div>
              <h2 className="text-sm font-bold text-white mb-3">Blocked Domains</h2>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="competitor.com"
                  value={newDomain}
                  onChange={e => setNewDomain(e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
                />
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={newDomainReason}
                  onChange={e => setNewDomainReason(e.target.value)}
                  className="w-44 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
                />
                <button
                  onClick={addDomain}
                  disabled={accessSaving || !newDomain.trim()}
                  className="bg-red-800 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40 transition-colors"
                >
                  Block
                </button>
              </div>
              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Domain</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Reason</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Blocked</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {(!access || access.blocked_domains.length === 0) && (
                      <tr><td colSpan={4} className="text-center text-muted-foreground px-4 py-6">No domains blocked.</td></tr>
                    )}
                    {access?.blocked_domains.map((d, i) => (
                      <tr key={d.domain} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                        <td className="px-4 py-2.5 font-medium text-red-300">@{d.domain}</td>
                        <td className="px-4 py-2.5 text-zinc-400">{d.reason || "—"}</td>
                        <td className="px-4 py-2.5 text-zinc-400">{fmt(d.added_at)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => removeDomain(d.domain)}
                            className="text-[10px] text-green-400 hover:text-green-300 font-semibold"
                          >
                            Unblock
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Currently blocked users */}
            {access && access.blocked_users.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-white mb-3">Currently Blocked Users</h2>
                <div className="border border-red-800/30 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-900 border-b border-border">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Email</th>
                        <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Joined</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {access.blocked_users.map((u, i) => (
                        <tr key={u.email} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                          <td className="px-4 py-2.5 font-medium text-red-300">{u.email}</td>
                          <td className="px-4 py-2.5 text-zinc-400">{fmt(u.created_at)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => toggleBlock(u.email, true)}
                              className="text-[10px] bg-green-900/40 text-green-400 hover:bg-green-800/60 rounded px-2 py-1 font-semibold"
                            >
                              Unblock
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-center pt-2">
          <button onClick={() => { loadStats(); loadAccess(); }} className="text-xs text-indigo-400 hover:text-indigo-300">Refresh data</button>
        </div>
      </div>
    </div>
  );
}
