"use client";

import { useCallback, useEffect, useState } from "react";
import { LifeBuoy, Loader2, RefreshCw } from "lucide-react";

/** Admin-side incident table: view, change status, leave a note, close. */

interface Incident {
  id: string; reporter_email: string; category: string; severity: string;
  subject: string; description: string; page_path: string | null;
  status: string; admin_note: string | null; created_at: string; updated_at: string;
}

const STATUS_OPTIONS = ["open", "in_progress", "resolved", "closed"] as const;

const STATUS_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  open:        { bg: "#FFFBEB", fg: "#92400E", bd: "#FDE68A" },
  in_progress: { bg: "#F0FDFA", fg: "#0F766E", bd: "#99F6E4" },
  resolved:    { bg: "#E6F4EF", fg: "#006B45", bd: "#9CCFBB" },
  closed:      { bg: "#F3F4F5", fg: "#6B7280", bd: "#E0E3E6" },
};
const SEVERITY_FG: Record<string, string> = {
  low: "#6B7280", medium: "#CA8A04", high: "#EA580C", critical: "#DC2626",
};

export function SupportPortal({ adminEmail }: { adminEmail: string }) {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [filter, setFilter] = useState<string>("active");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setIncidents(null);
    try {
      const res = await fetch("/api/support/incidents", { cache: "no-store" });
      const data = (await res.json()) as { incidents?: Incident[] };
      setIncidents(data.incidents ?? []);
    } catch {
      setIncidents([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(id: string, status: string) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/support/incidents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNote: notes[id]?.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { incident?: Incident };
      if (res.ok && data.incident) {
        setIncidents((prev) => prev?.map((i) => (i.id === id ? data.incident! : i)) ?? null);
        setNotes((n) => ({ ...n, [id]: "" }));
      }
    } finally {
      setSavingId(null);
    }
  }

  const visible = (incidents ?? []).filter((i) =>
    filter === "all" ? true :
    filter === "active" ? i.status === "open" || i.status === "in_progress" :
    i.status === filter,
  );
  const openCount = (incidents ?? []).filter((i) => i.status === "open").length;

  return (
    <div className="min-h-screen bg-[#F7F8F9]">
      {/* Header */}
      <header className="flex h-[60px] items-center justify-between border-b border-[#E0E3E6] bg-white px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[#0B0D0F]">
            <LifeBuoy className="h-4 w-4 text-white" />
          </span>
          <span className="text-[15px] font-bold tracking-[-0.02em] text-[#0B0D0F]">Vectorbea Support</span>
          <span className="rounded-full border border-[#9CCFBB] bg-[#E6F4EF] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#006B45]">Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-[#9CA3AF]">{adminEmail}</span>
          <button type="button" onClick={() => void load()} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[12px] font-medium text-[#4B5563] hover:bg-[#F7F8F9]">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Filter + count */}
        <div className="mb-4 flex items-center justify-between">
          <div className="inline-flex items-center gap-1 rounded-[9px] border border-[#E0E3E6] bg-white p-1">
            {["active", "open", "in_progress", "resolved", "closed", "all"].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-[6px] px-2.5 py-1 text-[12px] font-medium capitalize transition-colors ${
                  filter === f ? "bg-[#0B0D0F] text-white" : "text-[#4B5563] hover:bg-[#F3F4F5]"
                }`}
              >
                {f.replace("_", " ")}
              </button>
            ))}
          </div>
          <span className="font-mono text-[12px] text-[#9CA3AF]">{openCount} open</span>
        </div>

        {incidents === null ? (
          <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-[#C9CED4]" /></div>
        ) : visible.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[#D7DBE0] bg-white py-16 text-center text-[13px] text-[#9CA3AF]">
            No incidents in this view.
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((i) => {
              const st = STATUS_STYLE[i.status] ?? STATUS_STYLE.open!;
              return (
                <div key={i.id} className="rounded-[12px] border border-[#E0E3E6] bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold capitalize" style={{ background: st.bg, color: st.fg, borderColor: st.bd }}>
                      {i.status.replace("_", " ")}
                    </span>
                    <span className="font-mono text-[11px] font-bold uppercase" style={{ color: SEVERITY_FG[i.severity] ?? "#6B7280" }}>{i.severity}</span>
                    <h3 className="text-[14px] font-semibold text-[#0B0D0F]">{i.subject}</h3>
                    <span className="ml-auto font-mono text-[11px] text-[#9CA3AF]">
                      {new Date(i.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[#9CA3AF]">
                    {i.reporter_email} · {i.category.replace("_", " ")} {i.page_path ? `· ${i.page_path}` : ""} · {i.id.slice(0, 8)}
                  </p>
                  <p className="mt-2.5 whitespace-pre-wrap rounded-[8px] border border-[#ECEEEF] bg-[#FAFBFB] px-3 py-2 text-[13px] leading-[1.6] text-[#374151]">
                    {i.description}
                  </p>
                  {i.admin_note && (
                    <p className="mt-2 text-[12px] text-[#6B7280]"><span className="font-semibold text-[#0B0D0F]">Last note:</span> {i.admin_note}</p>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F1F2F4] pt-3">
                    <input
                      value={notes[i.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))}
                      placeholder="Note to reporter (optional, saved with status change)"
                      className="h-8 min-w-[220px] flex-1 rounded-[7px] border border-[#E0E3E6] bg-white px-2.5 text-[12px] text-[#0B0D0F] placeholder:text-[#B6BCC2] focus:border-[#007F4E] focus:outline-none"
                    />
                    {STATUS_OPTIONS.filter((s) => s !== i.status).map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={savingId === i.id}
                        onClick={() => void setStatus(i.id, s)}
                        className={`h-8 rounded-[7px] border px-2.5 text-[11.5px] font-semibold capitalize transition-colors disabled:opacity-50 ${
                          s === "closed"
                            ? "border-[#E0E3E6] bg-white text-[#6B7280] hover:bg-[#F3F4F5]"
                            : s === "resolved"
                            ? "border-[#9CCFBB] bg-[#E6F4EF] text-[#006B45] hover:bg-[#D7EDE2]"
                            : "border-[#E0E3E6] bg-white text-[#374151] hover:bg-[#F7F8F9]"
                        }`}
                      >
                        {savingId === i.id ? "…" : `→ ${s.replace("_", " ")}`}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
