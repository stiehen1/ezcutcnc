import React from "react";
import { Link } from "wouter";

type User = {
  email: string;
  joined: string;
  save_count: string;
  last_active: string | null;
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

export default function Admin() {
  const [authed, setAuthed] = React.useState(() => sessionStorage.getItem("admin_token") === "corecutter1");
  const [password, setPassword] = React.useState("");
  const [authError, setAuthError] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);
  const [tab, setTab] = React.useState<"users" | "activity" | "usage">("users");
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (authed) loadStats();
  }, [authed]);

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
      const token = sessionStorage.getItem("admin_token") || "";
      const r = await fetch(`/api/admin/stats?token=${encodeURIComponent(token)}`);
      if (r.status === 401) { sessionStorage.removeItem("admin_token"); setAuthed(false); return; }
      setStats(await r.json());
    } finally {
      setLoading(false);
    }
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
          <span className="text-sm font-bold tracking-widest text-orange-500">EZCutCNC</span>
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
          {(["users", "activity", "usage"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 rounded-md py-1.5 text-xs font-semibold transition-all capitalize"
              style={{
                backgroundColor: tab === t ? "#6366f1" : "transparent",
                color: tab === t ? "#fff" : "#a1a1aa",
              }}
            >
              {t === "users" ? "Users" : t === "activity" ? "Recent Activity" : "Usage"}
            </button>
          ))}
        </div>

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
                </tr>
              </thead>
              <tbody>
                {stats.users.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted-foreground px-4 py-8">No users yet.</td></tr>
                )}
                {stats.users.map((u, i) => (
                  <tr key={u.email} className={i % 2 === 0 ? "bg-zinc-950/30" : ""}>
                    <td className="px-4 py-2.5 font-medium text-white">{u.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmt(u.joined)}</td>
                    <td className="px-4 py-2.5">
                      <span className="bg-indigo-600/20 text-indigo-300 rounded px-1.5 py-0.5">{u.save_count}</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmt(u.last_active)}</td>
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

        <div className="text-center pt-2">
          <button onClick={loadStats} className="text-xs text-indigo-400 hover:text-indigo-300">Refresh data</button>
        </div>
      </div>
    </div>
  );
}
