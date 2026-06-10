import React from "react";
import { Link } from "wouter";
import Catalog from "@/pages/Catalog";

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

type Registration = {
  id: number;
  name: string | null;
  email: string;
  city: string | null;
  region: string | null;
  country: string | null;
  postal: string | null;
  created_at: string;
  notified_at: string | null;
};

type Stats = {
  users: User[];
  activity: ActivityItem[];
  operations: OperationCount[];
  registrations: Registration[];
  totals: { users: number; registrations: number; saves: number };
};

type BlockedEmail = { email: string; reason: string; added_at: string };
type BlockedDomain = { domain: string; reason: string; added_at: string };
type BlockedUser = { email: string; created_at: string };

type AccessData = {
  blocked_emails: BlockedEmail[];
  blocked_domains: BlockedDomain[];
  blocked_users: BlockedUser[];
};

type TeamMember = {
  email: string;
  team_email: string;
  created_at: string;
};

type Announcement = {
  id: number;
  version: string;
  headline: string;
  subheadline: string;
  bullets: string[];
  active: boolean;
  published_at: string | null;
  created_at: string;
};

export default function Admin() {
  const [authed, setAuthed] = React.useState(() => sessionStorage.getItem("admin_token") === "corecutter1");
  const [password, setPassword] = React.useState("");
  const [authError, setAuthError] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [tab, setTab] = React.useState<"registrations" | "users" | "activity" | "usage" | "access" | "teams" | "announcements" | "skus">("registrations");
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [access, setAccess] = React.useState<AccessData | null>(null);
  const [teams, setTeams] = React.useState<TeamMember[] | null>(null);
  const [teamMsg, setTeamMsg] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [announcements, setAnnouncements] = React.useState<Announcement[]>([]);
  const [annHeadline, setAnnHeadline] = React.useState("");
  const [annSubheadline, setAnnSubheadline] = React.useState("");
  const [annVersion, setAnnVersion] = React.useState("");
  const [annBullets, setAnnBullets] = React.useState<string[]>(["", "", ""]);
  const [annSaving, setAnnSaving] = React.useState(false);
  const [annMsg, setAnnMsg] = React.useState("");
  const [previewMode, setPreviewMode] = React.useState(false);
  const [annChecking, setAnnChecking] = React.useState(false);
  type AnnSuggestion = { id: string; label: string; original: string; corrected: string; changed: boolean };
  const [annSuggestions, setAnnSuggestions] = React.useState<AnnSuggestion[] | null>(null);
  // True once the user has been shown fixes for the current text, so Publish lets them override.
  const [annReviewed, setAnnReviewed] = React.useState(false);

  // Access form state
  const [newEmail, setNewEmail] = React.useState("");
  const [newEmailReason, setNewEmailReason] = React.useState("");
  const [newDomain, setNewDomain] = React.useState("");
  const [newDomainReason, setNewDomainReason] = React.useState("");
  const [accessSaving, setAccessSaving] = React.useState(false);
  const [accessMsg, setAccessMsg] = React.useState("");

  React.useEffect(() => {
    if (authed) { loadStats(); loadAccess(); loadTeams(); loadAnnouncements(); }
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

  async function loadTeams() {
    const r = await fetch(`/api/admin/teams?token=${encodeURIComponent(token())}`);
    if (r.ok) setTeams(await r.json());
  }

  async function loadAnnouncements() {
    const r = await fetch(`/api/admin/announcements?token=${encodeURIComponent(token())}`);
    if (r.ok) setAnnouncements(await r.json());
  }

  // Calls the check endpoint. Returns the suggestions, or null if the check itself errored.
  async function runCheck(): Promise<AnnSuggestion[] | null> {
    const r = await fetch(`/api/admin/announcements/check?token=${encodeURIComponent(token())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headline: annHeadline, subheadline: annSubheadline, bullets: annBullets }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.fields || []) as AnnSuggestion[];
  }

  async function checkAnnouncement() {
    if (!annHeadline.trim() && !annBullets.some(b => b.trim())) { setAnnMsg("Add some text to check first."); return; }
    setAnnChecking(true);
    setAnnSuggestions(null);
    try {
      const sugg = await runCheck();
      if (sugg) {
        setAnnSuggestions(sugg);
        setAnnReviewed(true);
        if (!sugg.some(s => s.changed)) { setAnnMsg("No spelling or grammar issues found. ✓"); setTimeout(() => setAnnMsg(""), 4000); }
      } else {
        setAnnMsg("Check failed.");
      }
    } finally {
      setAnnChecking(false);
    }
  }

  function applySuggestion(s: AnnSuggestion) {
    if (s.id === "headline") setAnnHeadline(s.corrected);
    else if (s.id === "subheadline") setAnnSubheadline(s.corrected);
    else if (s.id.startsWith("bullet:")) {
      const idx = parseInt(s.id.split(":")[1], 10);
      setAnnBullets(prev => prev.map((b, i) => (i === idx ? s.corrected : b)));
    }
    setAnnSuggestions(prev => (prev ? prev.filter(x => x.id !== s.id) : prev));
  }

  function applyAllSuggestions() {
    (annSuggestions || []).filter(s => s.changed).forEach(applySuggestion);
    setAnnSuggestions(null);
  }

  async function publishAnnouncement() {
    if (!annVersion.trim() || !annHeadline.trim()) { setAnnMsg("Version and headline are required."); return; }

    // Auto-check before publishing — unless the user already reviewed fixes for this text
    // and chose to publish anyway. If the check API errors, we don't block publishing.
    if (!annReviewed) {
      setAnnChecking(true);
      const sugg = await runCheck();
      setAnnChecking(false);
      if (sugg && sugg.some(s => s.changed)) {
        setAnnSuggestions(sugg);
        setAnnReviewed(true);
        setAnnMsg("Found possible fixes — review below, then click Publish again to publish anyway.");
        return;
      }
      // No issues (or check unavailable) → fall through and publish
      setAnnReviewed(true);
    }

    const bullets = annBullets.filter(b => b.trim());
    setAnnSaving(true);
    const r = await fetch(`/api/admin/announcements?token=${encodeURIComponent(token())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: annVersion.trim(), headline: annHeadline.trim(), subheadline: annSubheadline.trim(), bullets }),
    });
    setAnnSaving(false);
    if (r.ok) {
      setAnnMsg("Published! Users will see this on their next visit.");
      setAnnSuggestions(null);
      setAnnReviewed(false);
      setTimeout(() => setAnnMsg(""), 4000);
      loadAnnouncements();
    } else {
      const d = await r.json();
      setAnnMsg(d.error || "Failed to publish.");
    }
  }

  async function disconnectTeamMember(email: string) {
    const r = await fetch(`/api/admin/teams/disconnect?token=${encodeURIComponent(token())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (r.ok) {
      setTeamMsg(`Disconnected ${email}`);
      setTimeout(() => setTeamMsg(""), 3000);
      loadTeams();
    }
  }

  async function addEmail() {
    if (!newEmail.trim()) return;
    setAccessSaving(true);
    const r = await fetch("/api/admin/blocked-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token() },
      body: JSON.stringify({ email: newEmail.trim(), reason: newEmailReason.trim() }),
    });
    if (r.ok) {
      setNewEmail(""); setNewEmailReason("");
      flash("Email blocked.");
      loadAccess();
    }
    setAccessSaving(false);
  }

  async function removeEmail(email: string) {
    await fetch(`/api/admin/blocked-emails/${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { "x-admin-token": token() },
    });
    flash("Email unblocked.");
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
          <div className="relative mb-2">
            <input
              type={showPassword ? "text" : "password"}
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
              placeholder="Admin password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") login(); }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 transition-colors"
              tabIndex={-1}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>
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
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-900 border border-border rounded-xl px-4 py-3">
              <div className="text-xs text-muted-foreground">Registrations</div>
              <div className="text-3xl font-bold text-emerald-400 mt-1">{stats.totals.registrations}</div>
              {stats.registrations.filter(r => !r.notified_at).length > 0 && (
                <div className="text-[10px] text-amber-400 mt-1">
                  {stats.registrations.filter(r => !r.notified_at).length} not yet emailed
                </div>
              )}
            </div>
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
          {(["registrations", "users", "activity", "usage", "access", "teams", "announcements", "skus"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 rounded-md py-1.5 text-xs font-semibold transition-all capitalize"
              style={{
                backgroundColor: tab === t
                  ? t === "access" ? "#7c3aed"
                  : t === "registrations" ? "#059669"
                  : t === "teams" ? "#0369a1"
                  : t === "announcements" ? "#be185d"
                  : t === "skus" ? "#ea580c"
                  : "#6366f1"
                  : "transparent",
                color: tab === t ? "#fff" : "#a1a1aa",
              }}
            >
              {t === "registrations" ? "Registrations"
                : t === "users" ? "Toolbox Users"
                : t === "activity" ? "Activity"
                : t === "usage" ? "Usage"
                : t === "teams" ? "Teams"
                : t === "announcements" ? "Announcements"
                : t === "skus" ? "SKU Catalog"
                : "Access"}
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

        {/* Registrations tab */}
        {!loading && tab === "registrations" && stats && (
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Location</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Registered</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Notified</th>
                </tr>
              </thead>
              <tbody>
                {stats.registrations.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted-foreground px-4 py-8">No registrations yet.</td></tr>
                )}
                {stats.registrations.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                    <td className="px-4 py-2.5 font-medium text-white">{r.name || "—"}</td>
                    <td className="px-4 py-2.5 text-zinc-300">{r.email}</td>
                    <td className="px-4 py-2.5 text-zinc-400">
                      {[r.city, r.region, r.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">{fmtTime(r.created_at)}</td>
                    <td className="px-4 py-2.5">
                      {r.notified_at
                        ? <span className="text-emerald-400">{fmt(r.notified_at)}</span>
                        : <span className="text-amber-400 font-semibold">Not sent</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
              <p>The app is <span className="text-white">open access</span> — anyone can register and log in. The lists below are <em>deny-lists</em>: use them to cut off bad access.</p>
              <p><span className="text-white">1. Blocked email addresses</span> — a specific email is rejected at login. Blocking someone who already registered ends their access on their next visit.</p>
              <p><span className="text-white">2. Blocked domains</span> — any email from a blocked domain is rejected instantly.</p>
              <p><span className="text-white">3. User block</span> — suspend an existing registered user (block button on Users tab).</p>
            </div>

            {/* Blocked Email Addresses */}
            <div>
              <h2 className="text-sm font-bold text-white mb-3">Blocked Email Addresses <span className="text-xs font-normal text-zinc-400">(reject a specific email at login)</span></h2>
              <div className="flex gap-2 mb-3">
                <input
                  type="email"
                  placeholder="user@company.com"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
                />
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={newEmailReason}
                  onChange={e => setNewEmailReason(e.target.value)}
                  className="w-44 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
                />
                <button
                  onClick={addEmail}
                  disabled={accessSaving || !newEmail.trim()}
                  className="bg-red-800 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40 transition-colors"
                >
                  Block
                </button>
              </div>
              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Email</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Reason</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Blocked</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {(!access || access.blocked_emails.length === 0) && (
                      <tr><td colSpan={4} className="text-center text-muted-foreground px-4 py-6">No emails blocked.</td></tr>
                    )}
                    {access?.blocked_emails.map((e, i) => (
                      <tr key={e.email} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                        <td className="px-4 py-2.5 font-medium text-red-300">{e.email}</td>
                        <td className="px-4 py-2.5 text-zinc-400">{e.reason || "—"}</td>
                        <td className="px-4 py-2.5 text-zinc-400">{fmt(e.added_at)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => removeEmail(e.email)}
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

        {/* Teams tab */}
        {tab === "teams" && (
          <div className="space-y-4">
            <div className="bg-zinc-900 border border-sky-700/30 rounded-xl px-4 py-3 text-xs text-zinc-400 space-y-1">
              <p className="text-sky-300 font-semibold mb-1">Programming Team Connect</p>
              <p>Users who have connected their account to a shared team email. They share saved machines and Toolbox setups with everyone on the same team.</p>
              <p>Use <span className="text-white">Disconnect</span> to remove a member (e.g. if they've left the company). They can reconnect anytime.</p>
            </div>
            {teamMsg && (
              <div className="bg-sky-900/30 border border-sky-700/40 text-sky-300 text-xs rounded-lg px-3 py-2">{teamMsg}</div>
            )}
            {(!teams || teams.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-8">No team connections yet.</p>
            ) : (
              (() => {
                // Group by team_email
                const grouped: Record<string, TeamMember[]> = {};
                for (const m of teams) {
                  if (!grouped[m.team_email]) grouped[m.team_email] = [];
                  grouped[m.team_email].push(m);
                }
                return Object.entries(grouped).map(([teamEmail, members]) => (
                  <div key={teamEmail} className="border border-border rounded-xl overflow-hidden">
                    <div className="bg-sky-950/40 border-b border-border px-4 py-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-sky-300">{teamEmail}</span>
                      <span className="text-[10px] text-zinc-500">{members.length} member{members.length !== 1 ? "s" : ""}</span>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-900 border-b border-border">
                        <tr>
                          <th className="text-left px-4 py-2 text-muted-foreground font-medium">Member Email</th>
                          <th className="text-left px-4 py-2 text-muted-foreground font-medium">Connected</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((m, i) => (
                          <tr key={m.email} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                            <td className="px-4 py-2.5 font-medium text-white">{m.email}</td>
                            <td className="px-4 py-2.5 text-zinc-400">{fmt(m.created_at)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => disconnectTeamMember(m.email)}
                                className="text-[10px] bg-red-900/30 text-red-400 hover:bg-red-800/50 rounded px-2 py-1 font-semibold"
                              >Disconnect</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ));
              })()
            )}
          </div>
        )}

        {/* Announcements tab */}
        {tab === "announcements" && (
          <div className="space-y-8">
            {/* Draft & Publish form */}
            <div className="bg-zinc-900 border border-rose-700/30 rounded-xl px-5 py-5 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-white mb-1">Publish a What's New Announcement</h2>
                <p className="text-xs text-zinc-400">When published, every user sees this modal once on their next visit. Update the version string to re-show to all users.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Version (unique ID — change this each time)</label>
                  <input
                    type="text"
                    placeholder="e.g. 2026-04-16-team-connect"
                    value={annVersion}
                    onChange={e => setAnnVersion(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Headline</label>
                  <input
                    type="text"
                    spellCheck
                    placeholder="e.g. Team Connect is here!"
                    value={annHeadline}
                    onChange={e => { setAnnHeadline(e.target.value); setAnnReviewed(false); }}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Subheadline</label>
                  <input
                    type="text"
                    spellCheck
                    placeholder="Optional subtitle shown below headline"
                    value={annSubheadline}
                    onChange={e => { setAnnSubheadline(e.target.value); setAnnReviewed(false); }}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-2">Bullet points</label>
                  <div className="space-y-2">
                    {annBullets.map((b, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          spellCheck
                          placeholder="Feature bullet point…"
                          value={b}
                          onChange={e => {
                            const next = [...annBullets];
                            next[idx] = e.target.value;
                            setAnnBullets(next);
                            setAnnReviewed(false);
                          }}
                          className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                        />
                        {annBullets.length > 1 && (
                          <button
                            onClick={() => setAnnBullets(annBullets.filter((_, i) => i !== idx))}
                            className="text-zinc-500 hover:text-red-400 text-sm font-bold transition-colors"
                            title="Remove bullet"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setAnnBullets([...annBullets, ""])}
                    className="mt-2 text-xs text-rose-400 hover:text-rose-300 font-semibold"
                  >
                    + Add bullet
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPreviewMode(p => !p)}
                  className="text-xs text-zinc-300 hover:text-white border border-zinc-600 rounded-lg px-3 py-1.5 transition-colors"
                >
                  {previewMode ? "Hide preview" : "Preview modal →"}
                </button>
                <button
                  onClick={checkAnnouncement}
                  disabled={annChecking}
                  className="text-xs text-amber-300 hover:text-amber-200 border border-amber-600/50 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
                >
                  {annChecking ? "Checking…" : "Check spelling & grammar"}
                </button>
                <button
                  onClick={publishAnnouncement}
                  disabled={annSaving || annChecking}
                  className="bg-rose-700 hover:bg-rose-600 text-white rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-40 transition-colors"
                >
                  {annSaving ? "Publishing…"
                    : annChecking ? "Checking…"
                    : annReviewed && annSuggestions && annSuggestions.some(s => s.changed) ? "Publish anyway"
                    : "Publish Announcement"}
                </button>
              </div>

              {/* Spelling & grammar suggestions */}
              {annSuggestions && annSuggestions.some(s => s.changed) && (
                <div className="border border-amber-600/40 rounded-xl bg-amber-950/20 px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-amber-300">Suggested fixes</div>
                    <button
                      onClick={applyAllSuggestions}
                      className="text-[11px] font-semibold text-amber-200 hover:text-white border border-amber-500/50 rounded-md px-2 py-1 transition-colors"
                    >
                      Apply all
                    </button>
                  </div>
                  {annSuggestions.filter(s => s.changed).map(s => (
                    <div key={s.id} className="text-xs space-y-1 border-t border-amber-700/20 pt-2 first:border-t-0 first:pt-0">
                      <div className="text-[10px] uppercase tracking-wide text-amber-500/80 font-bold">{s.label}</div>
                      <div className="text-zinc-500 line-through">{s.original}</div>
                      <div className="flex items-start gap-2">
                        <span className="text-green-300 flex-1">{s.corrected}</span>
                        <button
                          onClick={() => applySuggestion(s)}
                          className="shrink-0 text-[11px] text-amber-200 hover:text-white border border-amber-500/40 rounded px-2 py-0.5 transition-colors"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {annMsg && (
                <div className={`text-xs rounded-lg px-3 py-2 ${annMsg.startsWith("Published") ? "bg-green-900/40 border border-green-600/40 text-green-300" : "bg-red-900/40 border border-red-600/40 text-red-300"}`}>
                  {annMsg}
                </div>
              )}

              {/* Inline modal preview */}
              {previewMode && (
                <div className="border border-orange-500/30 rounded-xl bg-zinc-950 px-6 py-5 space-y-3">
                  <div className="text-[10px] font-bold tracking-widest text-orange-500 uppercase">What's New</div>
                  <div className="text-base font-bold text-white">{annHeadline || <span className="text-zinc-600 italic">Headline will appear here</span>}</div>
                  {annSubheadline && <div className="text-xs text-zinc-400">{annSubheadline}</div>}
                  {annBullets.some(b => b.trim()) && (
                    <ul className="space-y-1.5 mt-2">
                      {annBullets.filter(b => b.trim()).map((b, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                          <span className="text-orange-500 mt-0.5">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!annBullets.some(b => b.trim()) && <p className="text-xs text-zinc-600 italic">Bullet points will appear here</p>}
                </div>
              )}
            </div>

            {/* Announcement history */}
            <div>
              <h2 className="text-sm font-bold text-white mb-3">Announcement History</h2>
              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Version</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Headline</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Published</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {announcements.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-muted-foreground px-4 py-8">No announcements yet.</td></tr>
                    )}
                    {announcements.map((a, i) => (
                      <tr key={a.id} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                        <td className="px-4 py-2.5 font-mono text-zinc-300">{a.version}</td>
                        <td className="px-4 py-2.5 text-white">{a.headline}</td>
                        <td className="px-4 py-2.5">
                          {a.active
                            ? <span className="bg-emerald-900/40 text-emerald-400 rounded px-1.5 py-0.5 text-[10px] font-semibold">Active</span>
                            : <span className="bg-zinc-800 text-zinc-500 rounded px-1.5 py-0.5 text-[10px] font-semibold">Inactive</span>
                          }
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400">{fmt(a.published_at)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-2">
                            {a.active && (
                              <button
                                onClick={async () => {
                                  await fetch(`/api/admin/announcements/${a.id}/deactivate?token=${encodeURIComponent(token())}`, { method: "POST" });
                                  loadAnnouncements();
                                }}
                                className="text-[10px] bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded px-2 py-1 font-semibold transition-colors"
                              >
                                Deactivate
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                await fetch(`/api/admin/announcements/${a.id}?token=${encodeURIComponent(token())}`, { method: "DELETE" });
                                loadAnnouncements();
                              }}
                              className="text-[10px] bg-red-900/30 text-red-400 hover:bg-red-800/50 rounded px-2 py-1 font-semibold transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SKU Catalog tab */}
        {tab === "skus" && (
          <Catalog embedded />
        )}

        <div className="text-center pt-2">
          <button onClick={() => { loadStats(); loadAccess(); loadTeams(); loadAnnouncements(); }} className="text-xs text-indigo-400 hover:text-indigo-300">Refresh data</button>
        </div>
      </div>
    </div>
  );
}
