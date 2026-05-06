import React from "react";
import { Link, useLocation } from "wouter";

type ToolboxItem = {
  id: number;
  type: string;
  title: string;
  data: any;
  notes: string;
  job_no: string;
  part_name: string;
  created_at: string;
};

type SpecialItem = {
  id: number;
  cc_number: string;
  description: string;
  notes: string;
  job_number: string;
  job_description: string;
  tool_dia: number | null;
  flutes: number | null;
  loc: number | null;
  oal: number | null;
  point_angle: number | null;
  step_diameters: number[] | null;
  step_lengths: number[] | null;
  created_at: string;
};

type FavoriteItem = {
  id: number;
  edp: string;
  data: any;
};

type UserMachine = {
  id: number;
  nickname: string;
  shop_machine_no: string | null;
  serial_number: string | null;
  brand: string | null;
  model: string | null;
  max_rpm: number | null;
  spindle_hp: number | null;
  taper: string | null;
  drive_type: string | null;
  dual_contact: boolean;
  machine_type: string | null;
  control: string | null;
  notes: string | null;
  machine_status: string;
  status_note: string | null;
  job_tags: { job_no: string; type: "assigned" | "excluded" }[];
  created_at: string;
};

// ── Shared section header ─────────────────────────────────────────────────────
function SectionHeader({
  icon, title, count, open, onToggle, action, accentColor, titleColor, bgColor, borderColor,
}: {
  icon: string;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  accentColor: string;   // left bar: e.g. "bg-indigo-500"
  titleColor: string;    // title text: e.g. "text-indigo-300"
  bgColor: string;       // header bg: e.g. "bg-indigo-950/40"
  borderColor: string;   // border: e.g. "border-indigo-800/50"
}) {
  return (
    <div className={`flex items-center gap-0 rounded-xl overflow-hidden border ${borderColor} ${bgColor}`}>
      <div className={`w-1.5 self-stretch flex-shrink-0 ${accentColor}`} />
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2.5 flex-1 text-left px-4 py-3 group"
      >
        <span className="text-base leading-none">{icon}</span>
        <span className={`text-sm font-bold tracking-wide ${titleColor}`}>{title}</span>
        {count != null && (
          <span className="text-[11px] text-zinc-500 font-normal">
            ({count})
          </span>
        )}
        <span className="text-zinc-600 text-[10px] ml-1 group-hover:text-zinc-400 transition-colors">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {action && <div className="pr-3">{action}</div>}
    </div>
  );
}

export default function Toolbox({ onBack }: { onBack?: () => void } = {}) {
  const [, navigate] = useLocation();
  const [email, setEmail] = React.useState(() => localStorage.getItem("tb_email") || "");
  const [token, setToken] = React.useState(() => localStorage.getItem("tb_token") || "");
  const [step, setStep] = React.useState<"email" | "items">(
    localStorage.getItem("tb_email") && localStorage.getItem("tb_token") ? "items" : "email"
  );
  const [inputEmail, setInputEmail] = React.useState(
    () => localStorage.getItem("er_email") || localStorage.getItem("tb_email") || ""
  );
  const [items, setItems] = React.useState<ToolboxItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [renamingId, setRenamingId] = React.useState<number | null>(null);
  const [renameText, setRenameText] = React.useState("");
  const [jobFilter, setJobFilter] = React.useState("");
  const [partFilter, setPartFilter] = React.useState("");
  const [editingTagId, setEditingTagId] = React.useState<number | null>(null);
  const [editJobNo, setEditJobNo] = React.useState("");
  const [editPartName, setEditPartName] = React.useState("");
  const [roiItems, setRoiItems] = React.useState<any[]>([]);
  const [roiDraft, setRoiDraft] = React.useState<any>(null);
  const [roiExpanded, setRoiExpanded] = React.useState<number | null>(null);

  // Section open/close
  const [savedOpen, setSavedOpen] = React.useState(true);
  const [favOpen, setFavOpen] = React.useState(true);
  const [specialsOpen, setSpecialsOpen] = React.useState(true);
  const [roiOpen, setRoiOpen] = React.useState(true);
  const [machinesOpen, setMachinesOpen] = React.useState(true);

  // ── Machines ──────────────────────────────────────────────────────────────
  const [machines, setMachines] = React.useState<UserMachine[]>([]);
  const [machineFilter, setMachineFilter] = React.useState("");
  const [editingMachineId, setEditingMachineId] = React.useState<number | null>(null);
  const [addingMachine, setAddingMachine] = React.useState(false);
  // Add form state
  const [mNickname, setMNickname] = React.useState("");
  const [mShopNo, setMShopNo] = React.useState("");
  const [mSerial, setMSerial] = React.useState("");
  const [mBrand, setMBrand] = React.useState("");
  const [mModel, setMModel] = React.useState("");
  const [mRpm, setMRpm] = React.useState("");
  const [mHp, setMHp] = React.useState("");
  const [mTaper, setMTaper] = React.useState("CAT40");
  const [mDrive, setMDrive] = React.useState("direct");
  const [mType, setMType] = React.useState("vmc");
  const [mControl, setMControl] = React.useState("");
  const [mNotes, setMNotes] = React.useState("");
  const [mSaving, setMSaving] = React.useState(false);
  const [mError, setMError] = React.useState("");
  // Edit state
  const [editM, setEditM] = React.useState<Partial<UserMachine> & { job_tags?: any[] }>({});
  const [editMStatus, setEditMStatus] = React.useState("operational");
  const [editMStatusNote, setEditMStatusNote] = React.useState("");
  const [editMJobInput, setEditMJobInput] = React.useState("");
  const [editMJobType, setEditMJobType] = React.useState<"assigned"|"excluded">("assigned");
  const [mPatchSaving, setMPatchSaving] = React.useState(false);

  // ── Favorites ─────────────────────────────────────────────────────────────
  const [favorites, setFavorites] = React.useState<FavoriteItem[]>([]);

  // ── Specials ──────────────────────────────────────────────────────────────
  const [specials, setSpecials] = React.useState<SpecialItem[]>([]);
  const [addingSpecial, setAddingSpecial] = React.useState(false);
  const [spCcNumber, setSpCcNumber] = React.useState("");
  const [spDescription, setSpDescription] = React.useState("");
  const [spNotes, setSpNotes] = React.useState("");
  const [spJobNumber, setSpJobNumber] = React.useState("");
  const [spJobDesc, setSpJobDesc] = React.useState("");
  const [spSaving, setSpSaving] = React.useState(false);
  const [spError, setSpError] = React.useState("");
  const [editingSpecialId, setEditingSpecialId] = React.useState<number | null>(null);
  const [editSpDesc, setEditSpDesc] = React.useState("");
  const [editSpNotes, setEditSpNotes] = React.useState("");
  const [editSpJobNumber, setEditSpJobNumber] = React.useState("");
  const [editSpJobDesc, setEditSpJobDesc] = React.useState("");

  React.useEffect(() => {
    if (step === "items") loadItems();
  }, [step]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  async function signIn() {
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/toolbox/auto-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inputEmail.trim().toLowerCase() }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Unable to sign in — contact sales@corecutterusa.com"); return; }
      const e = inputEmail.trim().toLowerCase();
      localStorage.setItem("tb_email", e);
      localStorage.setItem("tb_token", d.token);
      localStorage.setItem("er_email", e);
      setEmail(e);
      setToken(d.token);
      setStep("items");
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  function signOut() {
    localStorage.removeItem("tb_email");
    localStorage.removeItem("tb_token");
    setEmail(""); setToken(""); setStep("email");
    setItems([]); setFavorites([]); setSpecials([]);
    setRoiItems([]); setRoiDraft(null); setMachines([]);
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  async function loadItems() {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    if (!e || !t) return;
    setLoading(true);
    try {
      const [itemsRes, favsRes, specialsRes, machinesRes] = await Promise.all([
        fetch(`/api/toolbox/items?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`),
        fetch(`/api/toolbox/favorites?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`),
        fetch(`/api/specials?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`),
        fetch(`/api/user-machines?email=${encodeURIComponent(e)}&token=${encodeURIComponent(t)}`),
      ]);
      if (itemsRes.status === 401) { signOut(); return; }
      setItems(await itemsRes.json());
      if (favsRes.ok) {
        const rows = await favsRes.json();
        setFavorites(rows.map((r: any) => ({ id: r.id, edp: r.edp, data: r.data })));
      }
      if (specialsRes.ok) setSpecials(await specialsRes.json());
      if (machinesRes.ok) setMachines(await machinesRes.json());
      const userEmail = localStorage.getItem("er_email") || e;
      try {
        const rr = await fetch(`/api/roi?email=${encodeURIComponent(userEmail)}`);
        if (rr.ok) setRoiItems(await rr.json());
      } catch { /* skip */ }
      const draft = localStorage.getItem("roi_draft");
      if (draft) { try { setRoiDraft(JSON.parse(draft)); } catch { /* skip */ } }
    } catch { setError("Failed to load toolbox"); }
    finally { setLoading(false); }
  }

  // ── Saved applications ────────────────────────────────────────────────────
  async function deleteItem(id: number) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    await fetch(`/api/toolbox/items/${id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t }),
    });
    setItems(prev => prev.filter(i => i.id !== id));
  }

  async function renameItem(id: number, title: string) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    const r = await fetch(`/api/toolbox/items/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t, title }),
    });
    if (r.ok) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, title } : i));
      setRenamingId(null); setRenameText("");
    }
  }

  async function saveItemTags(id: number, job_no: string, part_name: string) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    const r = await fetch(`/api/toolbox/items/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t, job_no, part_name }),
    });
    if (r.ok) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, job_no, part_name } : i));
      setEditingTagId(null);
    }
  }

  // ── Machines ──────────────────────────────────────────────────────────────
  async function addMachine() {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    if (!e || !t) return;
    if (!mNickname.trim()) { setMError("Nickname is required."); return; }
    setMSaving(true); setMError("");
    try {
      const r = await fetch("/api/user-machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: e, token: t,
          nickname: mNickname.trim(),
          shop_machine_no: mShopNo.trim() || null,
          serial_number: mSerial.trim() || null,
          brand: mBrand.trim() || null,
          model: mModel.trim() || null,
          max_rpm: mRpm ? parseInt(mRpm) : null,
          spindle_hp: mHp ? parseFloat(mHp) : null,
          taper: mTaper || null,
          drive_type: mDrive || null,
          machine_type: mType || null,
          control: mControl.trim() || null,
          notes: mNotes.trim() || null,
        }),
      });
      if (!r.ok) { const d = await r.json(); setMError(d.error || "Failed to save"); return; }
      const saved = await r.json();
      setMachines(prev => [{ ...saved, job_tags: [], machine_status: "operational" }, ...prev]);
      setAddingMachine(false);
      setMNickname(""); setMShopNo(""); setMSerial(""); setMBrand(""); setMModel("");
      setMRpm(""); setMHp(""); setMTaper("CAT40"); setMDrive("direct"); setMType("vmc");
      setMControl(""); setMNotes("");
    } catch { setMError("Network error"); }
    finally { setMSaving(false); }
  }

  async function deleteMachine(id: number) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    if (!confirm("Delete this machine? This cannot be undone.")) return;
    await fetch(`/api/user-machines/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t }),
    });
    setMachines(prev => prev.filter(m => m.id !== id));
  }

  async function patchMachine(id: number, patch: Record<string, any>) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    setMPatchSaving(true);
    try {
      const r = await fetch(`/api/user-machines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e, token: t, ...patch }),
      });
      if (r.ok) {
        const updated = await r.json();
        setMachines(prev => prev.map(m => m.id === id ? { ...m, ...updated } : m));
        setEditingMachineId(null);
      }
    } finally { setMPatchSaving(false); }
  }

  async function addMachineJobTag(machineId: number, job_no: string, type: "assigned"|"excluded") {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    const r = await fetch(`/api/user-machines/${machineId}/job-tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t, job_no, type }),
    });
    if (r.ok) {
      const updated = await r.json();
      setMachines(prev => prev.map(m => m.id === machineId ? { ...m, job_tags: updated.job_tags } : m));
    }
  }

  async function removeMachineJobTag(machineId: number, job_no: string) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    const r = await fetch(`/api/user-machines/${machineId}/job-tags/${encodeURIComponent(job_no)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t }),
    });
    if (r.ok) {
      setMachines(prev => prev.map(m => m.id === machineId
        ? { ...m, job_tags: (m.job_tags || []).filter((jt: any) => jt.job_no !== job_no) }
        : m));
    }
  }

  // ── Favorites ─────────────────────────────────────────────────────────────
  async function removeFavorite(id: number, edp: string) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    await fetch("/api/toolbox/favorites", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t, edp }),
    });
    setFavorites(prev => prev.filter(f => f.id !== id));
  }

  // ── Specials ──────────────────────────────────────────────────────────────
  async function addSpecial() {
    if (!spCcNumber.trim()) { setSpError("CC# is required"); return; }
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    setSpSaving(true); setSpError("");
    try {
      const r = await fetch("/api/specials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e, token: t, cc_number: spCcNumber, description: spDescription, notes: spNotes, job_number: spJobNumber, job_description: spJobDesc }),
      });
      const d = await r.json();
      if (!r.ok) { setSpError(d.error || "Failed to save"); return; }
      if (!d._duplicate) setSpecials(prev => [d, ...prev]);
      setSpCcNumber(""); setSpDescription(""); setSpNotes(""); setSpJobNumber(""); setSpJobDesc(""); setAddingSpecial(false);
    } catch { setSpError("Network error"); }
    finally { setSpSaving(false); }
  }

  async function deleteSpecial(id: number) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    await fetch(`/api/specials/${id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t }),
    });
    setSpecials(prev => prev.filter(s => s.id !== id));
  }

  async function saveSpecialEdit(id: number) {
    const e = localStorage.getItem("tb_email");
    const t = localStorage.getItem("tb_token");
    const r = await fetch(`/api/specials/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, token: t, description: editSpDesc, notes: editSpNotes, job_number: editSpJobNumber, job_description: editSpJobDesc }),
    });
    if (r.ok) {
      const d = await r.json();
      setSpecials(prev => prev.map(s => s.id === id ? d : s));
      setEditingSpecialId(null);
    }
  }

  function formatDate(s: string) {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // ── Saved application card ─────────────────────────────────────────────────
  function SavedAppCard({ item }: { item: ToolboxItem }) {
    const isExpanded = expanded === item.id;
    const d = item.data;
    return (
      <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30 hover:border-zinc-700 transition-colors">
        {renamingId === item.id ? (
          <div className="flex items-center gap-2 px-4 py-3 bg-zinc-900/80">
            <input
              autoFocus type="text" value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && renameText.trim()) renameItem(item.id, renameText);
                if (e.key === "Escape") { setRenamingId(null); setRenameText(""); }
              }}
              className="flex-1 bg-zinc-800 border border-indigo-500 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
              placeholder="Enter a title…"
            />
            <button className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold px-2"
              onClick={() => { if (renameText.trim()) renameItem(item.id, renameText); }}>Save</button>
            <button className="text-xs text-zinc-500 hover:text-white px-2"
              onClick={() => { setRenamingId(null); setRenameText(""); }}>Cancel</button>
          </div>
        ) : (
          <>
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer"
              onClick={() => setExpanded(isExpanded ? null : item.id)}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Key stats pill */}
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-900/40 border border-indigo-700/40 flex items-center justify-center">
                  <span className="text-indigo-400 text-lg leading-none">⚡</span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{item.title}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {item.job_no && (
                      <span className="text-[10px] font-semibold text-amber-300 bg-amber-900/30 border border-amber-700/40 rounded px-1.5 py-0.5">Job #{item.job_no}</span>
                    )}
                    {item.part_name && (
                      <span className="text-[10px] text-cyan-300 bg-cyan-900/20 border border-cyan-700/30 rounded px-1.5 py-0.5">{item.part_name}</span>
                    )}
                    {d?.inputs?.material && (
                      <span className="text-[10px] text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">{d.inputs.material}</span>
                    )}
                    {d?.inputs?.tool_dia && (
                      <span className="text-[10px] text-zinc-400">Ø{d.inputs.tool_dia}"</span>
                    )}
                    {d?.customer?.rpm && (
                      <span className="text-[10px] text-zinc-500">{Math.round(d.customer.rpm).toLocaleString()} RPM</span>
                    )}
                    {d?.customer?.feed_ipm && (
                      <span className="text-[10px] text-zinc-500">{d.customer.feed_ipm.toFixed(1)} IPM</span>
                    )}
                    <span className="text-[10px] text-zinc-600">{formatDate(item.created_at)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                <button
                  className="text-[11px] text-zinc-500 hover:text-amber-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                  onClick={e => { e.stopPropagation(); setEditingTagId(editingTagId === item.id ? null : item.id); setEditJobNo(item.job_no || ""); setEditPartName(item.part_name || ""); setExpanded(item.id); }}
                >Tag</button>
                <button
                  className="text-[11px] text-zinc-500 hover:text-indigo-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                  onClick={e => { e.stopPropagation(); setRenamingId(item.id); setRenameText(item.title); }}
                >Rename</button>
                <button
                  className="text-[11px] text-red-500/70 hover:text-red-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                  onClick={e => { e.stopPropagation(); deleteItem(item.id); }}
                >Delete</button>
                <span className="text-zinc-600 text-xs px-1">{isExpanded ? "▲" : "▼"}</span>
              </div>
            </div>

            {isExpanded && editingTagId === item.id && (
              <div className="border-t border-zinc-800 px-4 py-3 bg-amber-950/20">
                <p className="text-[10px] font-semibold text-amber-300 uppercase tracking-widest mb-2">Job / Part Tags</p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Job #"
                    value={editJobNo}
                    onChange={e => setEditJobNo(e.target.value)}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                  />
                  <input
                    type="text"
                    placeholder="Part name"
                    value={editPartName}
                    onChange={e => setEditPartName(e.target.value)}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => saveItemTags(item.id, editJobNo, editPartName)}
                    className="flex-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold py-1.5">Save Tags</button>
                  <button onClick={() => setEditingTagId(null)}
                    className="flex-1 rounded border border-zinc-700 text-zinc-400 hover:text-white text-xs py-1.5">Cancel</button>
                </div>
              </div>
            )}

            {isExpanded && d && (
              <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-950/60">
                {(d.tool_number || d.inputs?.edp) && (
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{d.tool_number ? "CC#" : "EDP#"}</span>
                    <span className="text-sm font-bold font-mono text-orange-400">{d.tool_number || d.inputs?.edp}</span>
                  </div>
                )}
                {d.customer && (
                  <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs mb-3">
                    {([
                      ["Material", d.inputs?.material],
                      ["Cutting Dia", d.inputs?.tool_dia ? `${d.inputs.tool_dia}"` : null],
                      ["Flutes", d.inputs?.flutes],
                      ["RPM", d.customer?.rpm ? Math.round(d.customer.rpm).toLocaleString() : null],
                      ["Feed (IPM)", d.customer?.feed_ipm ? d.customer.feed_ipm.toFixed(1) : null],
                      ["SFM", d.customer?.sfm ? Math.round(d.customer.sfm) : null],
                      ["DOC", d.customer?.doc_in ? `${d.customer.doc_in.toFixed(3)}"` : null],
                      ["WOC", d.customer?.woc_in ? `${d.customer.woc_in.toFixed(3)}"` : null],
                      ["HP Required", d.customer?.hp_required ? d.customer.hp_required.toFixed(2) : null],
                    ] as [string, any][]).filter(([, v]) => v != null).map(([label, val]) => (
                      <div key={label}>
                        <div className="text-zinc-500 text-[10px] uppercase tracking-wide mb-0.5">{label}</div>
                        <div className="font-semibold text-white">{String(val)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {item.notes && (
                  <p className="text-xs text-zinc-400 border-t border-zinc-800 pt-2 mb-2">{item.notes}</p>
                )}
                <button
                  className="text-[11px] px-2 py-1 rounded-md bg-indigo-800/50 hover:bg-indigo-700/60 text-indigo-300 font-semibold transition-colors"
                  onClick={() => {
                    if (d?.inputs) localStorage.setItem("cc_restore_form", JSON.stringify(d));
                    window.location.href = "/";
                  }}
                >Re-run this setup →</button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const savedApps = items.filter(i => i.type !== "favorite");
  const filteredApps = savedApps.filter(i => {
    const jf = jobFilter.trim().toLowerCase();
    const pf = partFilter.trim().toLowerCase();
    if (jf && !(i.job_no || "").toLowerCase().includes(jf)) return false;
    if (pf && !(i.part_name || "").toLowerCase().includes(pf)) return false;
    return true;
  });
  const hasContent = savedApps.length > 0 || favorites.length > 0 || specials.length > 0 || roiItems.length > 0 || !!roiDraft;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack
            ? <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm">← Back to Calculator</button>
            : <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">← Back to Calculator</Link>
          }
        </div>
        <div className="flex items-center gap-2">
          <img src="/COREcutCNC_long_dark_logo.png" alt="CoreCutCNC" className="h-12 w-auto" style={{ mixBlendMode: "screen" }} />
          <span className="text-sm font-semibold text-muted-foreground">/ Toolbox</span>
        </div>
        {step === "items" ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 hidden sm:block">{email}</span>
            <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">Sign out</button>
          </div>
        ) : <div className="w-16" />}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* ── Sign-in ─────────────────────────────────────────────────── */}
        {step === "email" && (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <div className="text-4xl mb-3">🧰</div>
              <h2 className="text-xl font-bold mb-1">Access Your Toolbox</h2>
              <p className="text-sm text-muted-foreground">Enter your email to access your saved setups, favorited tools, and special tools.</p>
            </div>
            <div className="w-full max-w-sm space-y-3">
              <input
                type="text" inputMode="email" autoCapitalize="none" autoCorrect="off"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
                placeholder="your@email.com"
                value={inputEmail}
                onChange={e => setInputEmail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") signIn(); }}
                autoFocus
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
                onClick={signIn} disabled={loading || !inputEmail}
              >{loading ? "Signing in…" : "Open Toolbox"}</button>
            </div>
          </div>
        )}

        {/* ── Items view ──────────────────────────────────────────────── */}
        {step === "items" && (
          <div>
            {/* Top bar */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-zinc-500">{email}</p>
              <button onClick={loadItems} className="text-xs text-indigo-400 hover:text-indigo-300">↻ Refresh</button>
            </div>

            {/* Team note */}
            <div className="mb-5 text-xs text-cyan-400/80">
              Team toolbox sharing is available — <a href="#" onClick={e => { e.preventDefault(); (window as any).__openTeamsTab?.(); }} className="underline hover:text-cyan-300">connect your team →</a>
            </div>

            {loading && <p className="text-sm text-muted-foreground text-center py-12">Loading…</p>}

            {!loading && !hasContent && (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-sm text-muted-foreground font-semibold">Your toolbox is empty.</p>
                <p className="text-xs text-muted-foreground mt-1">Run a Speed &amp; Feed calculation and hit "Save to Toolbox" to get started.</p>
                <Link href="/" className="mt-5 inline-block text-sm text-indigo-400 hover:text-indigo-300">Go to Calculator →</Link>
              </div>
            )}

            {!loading && (
              <div className="space-y-8">

                {/* ════════════════════════════════════════════════════════
                    SECTION 1 — Previously Saved Applications
                ════════════════════════════════════════════════════════ */}
                <div className="rounded-2xl border border-indigo-900/40 bg-indigo-950/20 overflow-hidden">
                  <SectionHeader
                    icon="⚡"
                    title="Previously Saved Applications"
                    count={savedApps.length}
                    open={savedOpen}
                    onToggle={() => setSavedOpen(v => !v)}
                    accentColor="bg-indigo-500"
                    titleColor="text-indigo-300"
                    bgColor="bg-indigo-950/50"
                    borderColor="border-indigo-800/50"
                  />
                  {savedOpen && (
                    <div className="p-3 space-y-2">
                      {savedApps.length === 0 ? (
                        <div className="text-center py-6 border border-dashed border-indigo-900/50 rounded-xl">
                          <p className="text-xs text-zinc-600">No saved applications yet.</p>
                          <p className="text-[11px] text-zinc-700 mt-1">Run a calculation and hit "Save to Toolbox".</p>
                          <Link href="/" className="mt-3 inline-block text-xs text-indigo-400 hover:text-indigo-300">Go to Calculator →</Link>
                        </div>
                      ) : (
                        <>
                          {/* Filter bar */}
                          <div className="flex gap-2 mb-1">
                            <div className="relative flex-1">
                              <input
                                type="text"
                                placeholder="Filter by job #…"
                                value={jobFilter}
                                onChange={e => setJobFilter(e.target.value)}
                                className="w-full rounded-lg border border-indigo-800/40 bg-zinc-800/60 px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                              />
                              {jobFilter && <button onClick={() => setJobFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-[10px]">✕</button>}
                            </div>
                            <div className="relative flex-1">
                              <input
                                type="text"
                                placeholder="Filter by part name…"
                                value={partFilter}
                                onChange={e => setPartFilter(e.target.value)}
                                className="w-full rounded-lg border border-indigo-800/40 bg-zinc-800/60 px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                              />
                              {partFilter && <button onClick={() => setPartFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-[10px]">✕</button>}
                            </div>
                          </div>
                          {filteredApps.length === 0 && (jobFilter || partFilter) && (
                            <p className="text-xs text-zinc-600 text-center py-4">No results match your filter.</p>
                          )}
                          {filteredApps.map(item => <SavedAppCard key={item.id} item={item} />)}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* ════════════════════════════════════════════════════════
                    SECTION 2 — Saved Favorited Standard Tools
                ════════════════════════════════════════════════════════ */}
                <div className="rounded-2xl border border-amber-900/40 bg-amber-950/10 overflow-hidden">
                  <SectionHeader
                    icon="★"
                    title="Favorited Standard Tools"
                    count={favorites.length}
                    open={favOpen}
                    onToggle={() => setFavOpen(v => !v)}
                    accentColor="bg-amber-500"
                    titleColor="text-amber-300"
                    bgColor="bg-amber-950/40"
                    borderColor="border-amber-800/50"
                  />
                  {favOpen && (
                    <div className="p-3 space-y-2">
                      {favorites.length === 0 ? (
                        <div className="text-center py-6 border border-dashed border-zinc-800 rounded-xl">
                          <p className="text-xs text-zinc-600">No favorited tools yet.</p>
                          <p className="text-[11px] text-zinc-700 mt-1">Star any tool in the Tool Finder to save it here.</p>
                          <Link href="/" className="mt-3 inline-block text-xs text-amber-400 hover:text-amber-300">Go to Tool Finder →</Link>
                        </div>
                      ) : (
                        favorites.map(fav => (
                          <div key={fav.id} className="border border-amber-800/30 rounded-xl overflow-hidden bg-amber-950/10 hover:border-amber-700/40 transition-colors">
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-900/30 border border-amber-700/30 flex items-center justify-center">
                                  <span className="text-amber-400 text-lg">★</span>
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-mono font-bold text-indigo-400"><span className="text-zinc-500 font-normal text-xs">EDP# </span>{fav.edp}</div>
                                  <div className="text-[11px] text-zinc-400 truncate">
                                    {[fav.data?.series, fav.data?.description1, fav.data?.description2].filter(Boolean).join(" · ") || "—"}
                                  </div>
                                  {fav.data?.cutting_diameter_in != null && (
                                    <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-2 flex-wrap">
                                      <span>Ø{Number(fav.data.cutting_diameter_in).toFixed(4)}"</span>
                                      {fav.data?.flutes ? <span>{fav.data.flutes} FL</span> : null}
                                      {fav.data?.loc_in ? <span>LOC {Number(fav.data.loc_in).toFixed(4)}"</span> : null}
                                      {fav.data?.coating ? <span className="text-zinc-400">{fav.data.coating}</span> : null}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const d = fav.data ?? {};
                                    // Saved calc setup — has inputs/operation sub-keys
                                    if (d.inputs) {
                                      localStorage.setItem("cc_restore_form", JSON.stringify({
                                        inputs: { edp: fav.edp, ...d.inputs },
                                        operation: d.operation,
                                        isoCategory: d.isoCategory,
                                        edpText: fav.edp,
                                        skuDescription: d.skuDescription,
                                        activeMachineId: d.activeMachineId,
                                        activeMachineName: d.activeMachineName,
                                      }));
                                    } else {
                                      // Raw SKU favorite — map SKU fields to form fields
                                      localStorage.setItem("cc_restore_form", JSON.stringify({
                                        inputs: {
                                          edp: fav.edp,
                                          tool_dia: d.cutting_diameter_in ?? 0,
                                          flutes: d.flutes ?? 0,
                                          loc: d.loc_in ?? 0,
                                          lbs: d.lbs_in ?? 0,
                                          corner_radius: d.corner_radius_in ?? 0,
                                          shank_dia: d.shank_dia_in ?? 0,
                                          variable_pitch: d.variable_pitch ?? false,
                                          variable_helix: d.variable_helix ?? false,
                                        },
                                        operation: "milling",
                                        edpText: fav.edp,
                                        skuDescription: [d.series, d.description1, d.description2].filter(Boolean).join(" · "),
                                      }));
                                    }
                                    window.location.href = "/";
                                  }}
                                  className="text-[11px] px-2 py-1 rounded-md bg-indigo-800/50 hover:bg-indigo-700/60 text-indigo-300 font-semibold transition-colors"
                                >Use Tool →</button>
                                <button
                                  type="button"
                                  onClick={() => removeFavorite(fav.id, fav.edp)}
                                  className="text-[11px] px-2 py-1 rounded-md bg-red-900/30 hover:bg-red-800/50 text-red-400 font-medium transition-colors"
                                >Remove</button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* ════════════════════════════════════════════════════════
                    SECTION 3 — Saved Uploaded Special Tools
                ════════════════════════════════════════════════════════ */}
                <div className="rounded-2xl border border-orange-900/40 bg-orange-950/10 overflow-hidden">
                  <SectionHeader
                    icon="🔩"
                    title="Saved Uploaded Special Tools"
                    count={specials.length}
                    open={specialsOpen}
                    onToggle={() => setSpecialsOpen(v => !v)}
                    accentColor="bg-orange-500"
                    titleColor="text-orange-300"
                    bgColor="bg-orange-950/40"
                    borderColor="border-orange-800/50"
                    action={
                      <button
                        type="button"
                        onClick={() => { setAddingSpecial(v => !v); setSpError(""); }}
                        className="text-[11px] px-3 py-1 rounded-md bg-orange-800/40 hover:bg-orange-700/50 text-orange-300 font-semibold border border-orange-700/40 transition-colors flex-shrink-0"
                      >+ Add Tool</button>
                    }
                  />
                  {specialsOpen && (
                    <div className="p-3 space-y-2">
                      {/* Add form */}
                      {addingSpecial && (
                        <div className="border border-orange-700/50 rounded-xl p-4 bg-orange-950/15 space-y-3 mb-3">
                          <p className="text-xs text-orange-300 font-semibold">Add a Special Tool</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-zinc-400 mb-1 block uppercase tracking-wide">CC# <span className="text-red-400">*</span></label>
                              <input
                                type="text" placeholder="e.g. CC-12345"
                                value={spCcNumber} onChange={e => setSpCcNumber(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                                autoFocus
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 mb-1 block uppercase tracking-wide">Job #</label>
                              <input
                                type="text" placeholder="e.g. 4412"
                                value={spJobNumber} onChange={e => setSpJobNumber(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-400 mb-1 block uppercase tracking-wide">Description</label>
                            <input
                              type="text" placeholder="e.g. 3/8 5FL .750 LOC P-Max"
                              value={spDescription} onChange={e => setSpDescription(e.target.value)}
                              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-zinc-400 mb-1 block uppercase tracking-wide">Job Description</label>
                              <input
                                type="text" placeholder="e.g. Titanium bracket, customer XYZ"
                                value={spJobDesc} onChange={e => setSpJobDesc(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 mb-1 block uppercase tracking-wide">Notes <span className="text-zinc-600 font-normal normal-case">(optional)</span></label>
                              <input
                                type="text" placeholder="e.g. Blind pocket, 316SS"
                                value={spNotes} onChange={e => setSpNotes(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") addSpecial(); }}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                              />
                            </div>
                          </div>
                          {spError && <p className="text-xs text-red-400">{spError}</p>}
                          <div className="flex gap-2">
                            <button
                              type="button" onClick={addSpecial} disabled={spSaving || !spCcNumber.trim()}
                              className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-semibold"
                            >{spSaving ? "Saving…" : "Save Special Tool"}</button>
                            <button
                              type="button"
                              onClick={() => { setAddingSpecial(false); setSpCcNumber(""); setSpDescription(""); setSpNotes(""); setSpJobNumber(""); setSpJobDesc(""); setSpError(""); }}
                              className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm"
                            >Cancel</button>
                          </div>
                        </div>
                      )}

                      {specials.length === 0 && !addingSpecial && (
                        <div className="text-center py-6 border border-dashed border-zinc-800 rounded-xl">
                          <p className="text-xs text-zinc-600">No special tools saved yet.</p>
                          <p className="text-[11px] text-zinc-700 mt-1">Use "+ Add Tool" to record a custom CC# special.</p>
                        </div>
                      )}

                      {specials.map(sp => (
                        <div key={sp.id} className="border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors">
                          {editingSpecialId === sp.id ? (
                            <div className="px-4 py-3 bg-zinc-900/80 space-y-2">
                              <p className="text-[10px] text-orange-400 font-semibold uppercase tracking-wide">Editing {sp.cc_number}</p>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="text" placeholder="Tool Description"
                                  value={editSpDesc} onChange={e => setEditSpDesc(e.target.value)}
                                  className="w-full bg-zinc-800 border border-orange-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                                  autoFocus
                                />
                                <input
                                  type="text" placeholder="Job #"
                                  value={editSpJobNumber} onChange={e => setEditSpJobNumber(e.target.value)}
                                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none"
                                />
                              </div>
                              <input
                                type="text" placeholder="Job Description (e.g. Titanium bracket, customer XYZ)"
                                value={editSpJobDesc} onChange={e => setEditSpJobDesc(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                              />
                              <input
                                type="text" placeholder="Notes"
                                value={editSpNotes} onChange={e => setEditSpNotes(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") saveSpecialEdit(sp.id); }}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                              />
                              <div className="flex gap-2">
                                <button className="text-xs text-orange-400 hover:text-orange-300 font-semibold px-3 py-1 rounded bg-orange-900/30"
                                  onClick={() => saveSpecialEdit(sp.id)}>Save Changes</button>
                                <button className="text-xs text-zinc-500 hover:text-white px-3 py-1 rounded bg-zinc-800"
                                  onClick={() => setEditingSpecialId(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-orange-950/40 border border-orange-800/30 flex items-center justify-center">
                                  <span className="text-orange-400 text-base">🔩</span>
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-mono font-bold text-orange-400">{sp.cc_number}</span>
                                    {sp.job_number && <span className="text-[11px] font-mono bg-zinc-700/60 text-zinc-300 px-1.5 py-0.5 rounded">Job #{sp.job_number}</span>}
                                  </div>
                                  {sp.description && <div className="text-xs text-zinc-300 mt-0.5 truncate">{sp.description}</div>}
                                  {sp.job_description && <div className="text-[11px] text-zinc-400 mt-0.5 truncate">{sp.job_description}</div>}
                                  {sp.notes && <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{sp.notes}</div>}
                                  <div className="text-[10px] text-zinc-700 mt-0.5">{formatDate(sp.created_at)}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const desc = (sp.description ?? "").toLowerCase();
                                    let op = "milling";
                                    const isStepDrill = desc.includes("step drill") || desc.includes("step_drill");
                                    const isStepReam = desc.includes("step reamer") || desc.includes("step_reamer");
                                    if (isStepDrill) op = "drilling";
                                    else if (desc.includes("drill")) op = "drilling";
                                    else if (isStepReam || desc.includes("reamer") || desc.includes("ream")) op = "reaming";
                                    else if (desc.includes("feedmill") || desc.includes("feed mill")) op = "feedmill";
                                    else if (desc.includes("threadmill") || desc.includes("thread mill")) op = "threadmilling";
                                    else if (desc.includes("keyseat")) op = "keyseat";
                                    else if (desc.includes("dovetail")) op = "dovetail";
                                    const extraInputs: Record<string, any> = {};
                                    if (sp.tool_dia)    extraInputs.tool_dia          = sp.tool_dia;
                                    if (sp.flutes)      extraInputs.flutes            = sp.flutes;
                                    if (sp.loc)         extraInputs.loc               = sp.loc;
                                    if (sp.oal)         extraInputs.oal               = sp.oal;
                                    if (sp.point_angle) extraInputs.drill_point_angle = sp.point_angle;
                                    if (isStepDrill) {
                                      extraInputs.drill_steps = 1;
                                      if (sp.step_diameters?.length) extraInputs.drill_step_diameters = sp.step_diameters;
                                      if (sp.step_lengths?.length)   extraInputs.drill_step_lengths   = sp.step_lengths;
                                    }
                                    if (isStepReam) {
                                      extraInputs.ream_steps = 1;
                                      if (sp.step_diameters?.length) extraInputs.ream_step_diameters = sp.step_diameters;
                                    }
                                    localStorage.setItem("cc_restore_form", JSON.stringify({
                                      inputs: { edp: sp.cc_number, ...extraInputs },
                                      operation: op,
                                      tool_number: sp.cc_number,
                                    }));
                                    window.location.href = "/";
                                  }}
                                  className="text-[11px] px-2 py-1 rounded-md bg-indigo-800/50 hover:bg-indigo-700/60 text-indigo-300 font-semibold transition-colors"
                                >Use in Calc →</button>
                                <button
                                  type="button"
                                  onClick={() => { setEditingSpecialId(sp.id); setEditSpDesc(sp.description); setEditSpNotes(sp.notes); setEditSpJobNumber(sp.job_number); setEditSpJobDesc(sp.job_description); }}
                                  className="text-[11px] px-2 py-1 rounded-md bg-zinc-700/50 hover:bg-zinc-600 text-zinc-300 font-medium transition-colors"
                                >Edit</button>
                                <button
                                  type="button"
                                  onClick={() => { if (confirm(`Delete ${sp.cc_number}?`)) deleteSpecial(sp.id); }}
                                  className="text-[11px] px-2 py-1 rounded-md bg-red-900/30 hover:bg-red-800/50 text-red-400 font-medium transition-colors"
                                >Delete</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ════════════════════════════════════════════════════════
                    SECTION 4 — Saved Machines
                ════════════════════════════════════════════════════════ */}
                <div className="rounded-2xl border border-sky-900/40 bg-sky-950/10 overflow-hidden">
                  <SectionHeader
                    icon="🖥️"
                    title="My Machines"
                    count={machines.length}
                    open={machinesOpen}
                    onToggle={() => setMachinesOpen(v => !v)}
                    accentColor="bg-sky-500"
                    titleColor="text-sky-300"
                    bgColor="bg-sky-950/50"
                    borderColor="border-sky-800/50"
                    action={
                      <button
                        type="button"
                        onClick={() => { setAddingMachine(v => !v); setMError(""); }}
                        className="text-[11px] font-semibold text-sky-400 hover:text-white border border-sky-700/50 rounded-md px-2 py-1 hover:bg-sky-800/40 transition-colors"
                      >{addingMachine ? "Cancel" : "+ Add Machine"}</button>
                    }
                  />
                  {machinesOpen && (
                    <div className="p-3 space-y-3">

                      {/* Add machine form */}
                      {addingMachine && (
                        <div className="rounded-xl border border-sky-700/40 bg-sky-950/30 p-4 space-y-3">
                          <p className="text-xs font-semibold text-sky-300">Add a Machine</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="col-span-2">
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Nickname <span className="text-red-400">*</span></label>
                              <input type="text" placeholder="e.g. Shop Floor VF-2" value={mNickname} onChange={e => setMNickname(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Shop Machine #</label>
                              <input type="text" placeholder="e.g. M-12" value={mShopNo} onChange={e => setMShopNo(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Serial Number</label>
                              <input type="text" placeholder="From nameplate" value={mSerial} onChange={e => setMSerial(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Brand</label>
                              <input type="text" placeholder="e.g. Haas, Mazak" value={mBrand} onChange={e => setMBrand(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Model</label>
                              <input type="text" placeholder="e.g. VF-2" value={mModel} onChange={e => setMModel(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Machine Type</label>
                              <select value={mType} onChange={e => setMType(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500">
                                <option value="vmc">VMC</option>
                                <option value="hmc">HMC</option>
                                <option value="hbm">HBM (Horizontal Boring Mill)</option>
                                <option value="5axis">5-Axis</option>
                                <option value="lathe">Lathe</option>
                                <option value="mill_turn">Mill-Turn</option>
                                <option value="swiss">Swiss</option>
                                <option value="double_column">Double Column</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Spindle Taper</label>
                              <select value={mTaper} onChange={e => setMTaper(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500">
                                {["CAT30","CAT40","CAT50","BT30","BT40","BT50","HSK32","HSK50","HSK63","HSK100","HSK125","CAPTO C6","CAPTO C8"].map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Drive Type</label>
                              <select value={mDrive} onChange={e => setMDrive(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500">
                                <option value="direct">Direct</option>
                                <option value="belt">Belt</option>
                                <option value="gear">Gear</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Max RPM</label>
                              <input type="number" placeholder="e.g. 12000" value={mRpm} onChange={e => setMRpm(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Spindle HP</label>
                              <input type="number" placeholder="e.g. 30" value={mHp} onChange={e => setMHp(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Control</label>
                              <input type="text" placeholder="e.g. Fanuc 31i, Mazatrol" value={mControl} onChange={e => setMControl(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1 block">Notes</label>
                              <input type="text" placeholder="Optional notes" value={mNotes} onChange={e => setMNotes(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                            </div>
                          </div>
                          {mError && <p className="text-xs text-red-400">{mError}</p>}
                          <button onClick={addMachine} disabled={mSaving || !mNickname.trim()}
                            className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-semibold">
                            {mSaving ? "Saving…" : "Save Machine"}
                          </button>
                        </div>
                      )}

                      {/* Filter */}
                      {machines.length > 3 && (
                        <div className="relative">
                          <input type="text" placeholder="Filter machines…" value={machineFilter} onChange={e => setMachineFilter(e.target.value)}
                            className="w-full rounded-lg border border-sky-800/40 bg-zinc-800/60 px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                          {machineFilter && <button onClick={() => setMachineFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-[10px]">✕</button>}
                        </div>
                      )}

                      {machines.length === 0 && !addingMachine && (
                        <div className="text-center py-6 border border-dashed border-sky-900/50 rounded-xl">
                          <p className="text-xs text-zinc-600">No saved machines yet.</p>
                          <p className="text-[11px] text-zinc-700 mt-1">Add a machine above or save one from the calculator.</p>
                        </div>
                      )}

                      {/* Machine cards */}
                      {machines
                        .filter(m => !machineFilter || [m.nickname, m.brand, m.model, m.shop_machine_no].some(v => v?.toLowerCase().includes(machineFilter.toLowerCase())))
                        .map(m => {
                          const isEditing = editingMachineId === m.id;
                          const statusIcon = m.machine_status === "operational" ? "✅" : m.machine_status === "issue" ? "⚠️" : m.machine_status === "down" ? "🔴" : "🔧";
                          const tags: {job_no: string; type: "assigned"|"excluded"}[] = Array.isArray(m.job_tags) ? m.job_tags : [];
                          return (
                            <div key={m.id} className="rounded-xl border border-sky-800/30 bg-zinc-900/60 overflow-hidden">
                              {/* Header row */}
                              <div className="flex items-start justify-between px-3 py-2.5 gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span>{statusIcon}</span>
                                    <span className="text-sm font-semibold text-white">{m.nickname}</span>
                                    {m.shop_machine_no && <span className="text-[10px] text-zinc-500">#{m.shop_machine_no}</span>}
                                    {m.machine_status !== "operational" && (
                                      <span className="text-[10px] text-amber-400 bg-amber-900/30 rounded px-1.5 py-0.5 capitalize">{m.machine_status}</span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                    {(m.brand || m.model) && <span className="text-[11px] text-zinc-400">{[m.brand, m.model].filter(Boolean).join(" ")}</span>}
                                    {m.max_rpm && <span className="text-[11px] text-zinc-500">{m.max_rpm.toLocaleString()} RPM</span>}
                                    {m.spindle_hp && <span className="text-[11px] text-zinc-500">{m.spindle_hp} HP</span>}
                                    {m.taper && <span className="text-[11px] text-zinc-500">{m.taper}</span>}
                                    {m.machine_type && <span className="text-[11px] text-zinc-600 uppercase">{m.machine_type}</span>}
                                  </div>
                                  {m.status_note && <p className="text-[10px] text-amber-300 mt-0.5">{m.status_note}</p>}
                                  {tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {tags.map(jt => (
                                        <span key={jt.job_no} className={`text-[10px] rounded px-1.5 py-0.5 ${jt.type === "assigned" ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40" : "bg-red-900/30 text-red-300 border border-red-700/30"}`}>
                                          {jt.type === "excluded" ? "✗ " : ""}Job #{jt.job_no}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <button onClick={() => { setEditingMachineId(isEditing ? null : m.id); setEditM({...m}); setEditMStatus(m.machine_status || "operational"); setEditMStatusNote(m.status_note || ""); setEditMJobInput(""); }}
                                    className="text-[11px] text-zinc-500 hover:text-sky-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors">{isEditing ? "Done" : "Edit"}</button>
                                  <button onClick={() => deleteMachine(m.id)}
                                    className="text-[11px] text-red-500/70 hover:text-red-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors">Delete</button>
                                </div>
                              </div>

                              {/* Edit panel */}
                              {isEditing && (
                                <div className="border-t border-sky-800/20 bg-zinc-950/60 px-3 py-3 space-y-3">
                                  {/* Basic fields */}
                                  <div className="grid grid-cols-2 gap-2">
                                    {[
                                      { label: "Nickname", val: editM.nickname ?? "", key: "nickname" },
                                      { label: "Shop #", val: editM.shop_machine_no ?? "", key: "shop_machine_no" },
                                      { label: "Serial #", val: editM.serial_number ?? "", key: "serial_number" },
                                      { label: "Brand", val: editM.brand ?? "", key: "brand" },
                                      { label: "Model", val: editM.model ?? "", key: "model" },
                                      { label: "Max RPM", val: String(editM.max_rpm ?? ""), key: "max_rpm" },
                                      { label: "Spindle HP", val: String(editM.spindle_hp ?? ""), key: "spindle_hp" },
                                      { label: "Control", val: editM.control ?? "", key: "control" },
                                    ].map(f => (
                                      <div key={f.key} className={f.key === "nickname" || f.key === "control" ? "col-span-2" : ""}>
                                        <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5 block">{f.label}</label>
                                        <input type="text" value={f.val}
                                          onChange={e => setEditM(prev => ({ ...prev, [f.key]: e.target.value }))}
                                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500" />
                                      </div>
                                    ))}
                                  </div>

                                  {/* Status */}
                                  <div>
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1.5">Machine Status</p>
                                    <div className="flex gap-1.5 flex-wrap">
                                      {(["operational","issue","down","maintenance"] as const).map(s => (
                                        <button key={s} type="button" onClick={() => setEditMStatus(s)}
                                          className={`text-[11px] px-2.5 py-1 rounded-md border font-semibold capitalize transition-all ${editMStatus === s ? "bg-sky-600 border-sky-500 text-white" : "bg-transparent border-zinc-600 text-zinc-400 hover:border-sky-500 hover:text-sky-300"}`}>
                                          {s === "operational" ? "✅ OK" : s === "issue" ? "⚠️ Issue" : s === "down" ? "🔴 Down" : "🔧 Maint."}
                                        </button>
                                      ))}
                                    </div>
                                    {editMStatus !== "operational" && (
                                      <input type="text" placeholder="Status note (optional)" value={editMStatusNote} onChange={e => setEditMStatusNote(e.target.value)}
                                        className="w-full mt-2 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                                    )}
                                  </div>

                                  {/* Job tags */}
                                  <div>
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1.5">Job Assignments</p>
                                    {tags.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mb-2">
                                        {tags.map(jt => (
                                          <span key={jt.job_no} className={`text-[10px] flex items-center gap-1 rounded px-1.5 py-0.5 ${jt.type === "assigned" ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40" : "bg-red-900/30 text-red-300 border border-red-700/30"}`}>
                                            Job #{jt.job_no}
                                            <button onClick={() => removeMachineJobTag(m.id, jt.job_no)} className="hover:text-white leading-none">✕</button>
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex gap-1.5">
                                      <select value={editMJobType} onChange={e => setEditMJobType(e.target.value as any)}
                                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500">
                                        <option value="assigned">Assigned</option>
                                        <option value="excluded">Excluded</option>
                                      </select>
                                      <input type="text" placeholder="Job #" value={editMJobInput} onChange={e => setEditMJobInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === "Enter" && editMJobInput.trim()) { addMachineJobTag(m.id, editMJobInput.trim(), editMJobType); setEditMJobInput(""); }}}
                                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500" />
                                      <button onClick={() => { if (editMJobInput.trim()) { addMachineJobTag(m.id, editMJobInput.trim(), editMJobType); setEditMJobInput(""); }}}
                                        className="bg-sky-700 hover:bg-sky-600 text-white rounded px-2.5 py-1.5 text-xs font-semibold">Add</button>
                                    </div>
                                  </div>

                                  <button onClick={() => patchMachine(m.id, {
                                    nickname: editM.nickname, shop_machine_no: editM.shop_machine_no, serial_number: editM.serial_number,
                                    brand: editM.brand, model: editM.model,
                                    max_rpm: editM.max_rpm ? Number(editM.max_rpm) : null,
                                    spindle_hp: editM.spindle_hp ? Number(editM.spindle_hp) : null,
                                    control: editM.control,
                                    machine_status: editMStatus, status_note: editMStatusNote,
                                  })} disabled={mPatchSaving}
                                    className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-semibold">
                                    {mPatchSaving ? "Saving…" : "Save Changes"}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* ════════════════════════════════════════════════════════
                    SECTION 5 — ROI Comparisons
                ════════════════════════════════════════════════════════ */}
                {(roiDraft || roiItems.length > 0) && (
                  <div className="rounded-2xl border border-green-900/40 bg-green-950/10 overflow-hidden">
                    <SectionHeader
                      icon="📊"
                      title="ROI Comparisons"
                      count={roiItems.length + (roiDraft ? 1 : 0)}
                      open={roiOpen}
                      onToggle={() => setRoiOpen(v => !v)}
                      accentColor="bg-green-500"
                      titleColor="text-green-300"
                      bgColor="bg-green-950/40"
                      borderColor="border-green-800/50"
                    />
                    {roiOpen && (
                      <div className="p-3 space-y-2">
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
                                onClick={() => { localStorage.setItem("roi_resume", "1"); window.location.href = "/"; }}
                              >Resume →</button>
                            </div>
                          </div>
                        )}
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
                              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                <button type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    const draft: Record<string, unknown> = {
                                      roiName: roi.roi_name || "", roiSessionId: roi.roi_session_id || undefined,
                                      lifeMode: roi.life_mode || "parts",
                                      ccPrice: String(roi.cc_tool_price ?? ""), ccParts: String(roi.cc_parts_per_tool ?? ""),
                                      ccCutTime: String(roi.cc_time_in_cut ?? ""), ccMrr: String(roi.cc_mrr ?? ""),
                                      reconEnabled: !!roi.recon_enabled, reconGrinds: String(roi.recon_grinds ?? ""),
                                      reconRetention: String(roi.recon_retention ?? ""),
                                      compBrand: roi.comp_brand || "", compEdp: roi.comp_edp || "",
                                      compPrice: String(roi.comp_price ?? ""), compParts: String(roi.comp_parts_per_tool ?? ""),
                                      compTime: String(roi.comp_time_in_cut ?? ""), compMrr: String(roi.comp_mrr ?? ""),
                                      compCutTime: String(roi.comp_time_in_cut ?? ""),
                                      shopRate: String(roi.shop_rate ?? ""), annualVol: String(roi.annual_volume ?? ""),
                                      matVolPerPart: String(roi.mat_vol_per_part ?? ""),
                                      userType: roi.user_type || "", distributorName: roi.distributor_name || "",
                                      distributorCode: roi.distributor_code || "", endUserName: roi.end_user_name || "",
                                      endUserEmail: roi.end_user_email || "", endUserCompany: roi.end_user_company || "",
                                      _roiLoadedId: roi.id,
                                    };
                                    localStorage.setItem("roi_draft", JSON.stringify(draft));
                                    localStorage.setItem("roi_resume", "1");
                                    navigate("/");
                                  }}
                                  className="text-[11px] px-2 py-1 rounded-md bg-green-800/50 hover:bg-green-700/60 text-green-300 font-semibold transition-colors"
                                >Rerun →</button>
                                <button type="button"
                                  onClick={async e => {
                                    e.stopPropagation();
                                    if (!confirm("Delete this ROI? This cannot be undone.")) return;
                                    const userEmail = localStorage.getItem("er_email") || "";
                                    await fetch(`/api/roi/${roi.id}?email=${encodeURIComponent(userEmail)}`, { method: "DELETE" });
                                    setRoiItems(prev => prev.filter((r: any) => r.id !== roi.id));
                                  }}
                                  className="text-[11px] px-2 py-1 rounded-md bg-red-900/30 hover:bg-red-800/50 text-red-400 font-medium transition-colors"
                                >Delete</button>
                                <span className="text-zinc-600 text-xs px-1">{roiExpanded === roi.id ? "▲" : "▼"}</span>
                              </div>
                            </div>
                            {roiExpanded === roi.id && (
                              <div className="border-t border-green-700/20 px-4 py-3 bg-green-950/20">
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  {([
                                    ["Savings/Part", `$${Number(roi.savings_per_part).toFixed(2)}`],
                                    ["Monthly Savings", `$${Number(roi.monthly_savings).toFixed(2)}`],
                                    ["Annual Savings", `$${Number(roi.annual_savings).toFixed(2)}`],
                                    ["% Reduction", `${Number(roi.savings_pct).toFixed(1)}%`],
                                    ["CC Tool Price", `$${Number(roi.cc_tool_price).toFixed(2)}`],
                                    [roi.comp_brand ? `${roi.comp_brand} Price` : "Comp Price", `$${Number(roi.comp_price).toFixed(2)}`],
                                    ["CC Parts/Tool", String(roi.cc_parts_per_tool)],
                                    ["Comp Parts/Tool", String(roi.comp_parts_per_tool)],
                                    ...(roi.shop_rate ? [["Shop Rate", `$${Number(roi.shop_rate).toFixed(0)}/hr`] as [string,string]] : []),
                                    ...(roi.annual_volume ? [["Annual Volume", String(roi.annual_volume)] as [string,string]] : []),
                                  ] as [string, string][]).map(([label, val]) => (
                                    <div key={label}>
                                      <div className="text-zinc-500">{label}</div>
                                      <div className="font-semibold text-white">{val}</div>
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
