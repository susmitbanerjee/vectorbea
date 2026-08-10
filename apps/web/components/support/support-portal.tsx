"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, LifeBuoy, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";

/**
 * Admin support portal (/support). Compact two-column view: ticket list on the
 * left, ticket detail + resolve/reopen on the right. Cross-tenant — every read
 * and write goes through the admin API, which independently verifies the
 * support-admin email server-side.
 */

interface Ticket {
  id: string;
  ticket_number: string;
  tenant_id: string | null;
  tenant_name: string | null;
  user_id: string | null;
  user_email: string;
  user_name: string | null;
  subject: string;
  message: string;
  status: "OPEN" | "RESOLVED";
  priority: "LOW" | "NORMAL" | "HIGH";
  category: string | null;
  admin_note: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

type Filter = "all" | "open" | "resolved";

const STATUS_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  OPEN:     { bg: "#FFFBEB", fg: "#92400E", bd: "#FDE68A" },
  RESOLVED: { bg: "#E6F4EF", fg: "#006B45", bd: "#9CCFBB" },
};
const PRIORITY_FG: Record<string, string> = { LOW: "#6B7280", NORMAL: "#0F766E", HIGH: "#DC2626" };

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function ago(dt: string): string {
  const diff = Date.now() - new Date(dt).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function SupportPortal({ adminEmail, initialTicket }: { adminEmail: string; initialTicket?: string | null }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  const [selected, setSelected] = useState<string | null>(initialTicket ?? null);
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounce the search box so we query on pause, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const loadList = useCallback(async () => {
    setListError(null);
    setTickets(null);
    try {
      const qs = new URLSearchParams({ filter });
      if (debounced) qs.set("q", debounced);
      const res = await fetch(`/api/support/admin/tickets?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tickets: Ticket[]; openCount: number };
      setTickets(data.tickets);
      setOpenCount(data.openCount ?? 0);
    } catch {
      setTickets([]);
      setListError("Could not load tickets. Check your connection and retry.");
    }
  }, [filter, debounced]);

  useEffect(() => { void loadList(); }, [loadList]);

  const loadDetail = useCallback(async (ticketNumber: string, seed?: Ticket) => {
    setSelected(ticketNumber);
    setNote("");
    setActionError(null);
    if (seed) setDetail(seed); else setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    // Reflect the selection in the URL so the view is deep-linkable/shareable.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("ticket", ticketNumber);
      window.history.replaceState(null, "", url.toString());
    } catch { /* noop */ }
    try {
      const res = await fetch(`/api/support/admin/tickets/${encodeURIComponent(ticketNumber)}`, { cache: "no-store" });
      if (res.status === 404) { setDetailError("This ticket no longer exists."); setDetail(null); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ticket: Ticket };
      setDetail(data.ticket);
    } catch {
      if (!seed) setDetailError("Could not load this ticket.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Auto-open the deep-linked ticket once the list is available.
  useEffect(() => {
    if (initialTicket && !detail && !detailLoading) void loadDetail(initialTicket);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicket]);

  async function act(action: "resolve" | "reopen") {
    if (!detail) return;
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/support/admin/tickets/${encodeURIComponent(detail.ticket_number)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, adminNote: note.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { ticket?: Ticket; error?: string };
      if (!res.ok || !data.ticket) { setActionError(data.error ?? "Could not update the ticket."); return; }
      setDetail(data.ticket);
      setNote("");
      // Keep the list in sync without a full refetch.
      setTickets((prev) => prev?.map((t) => (t.ticket_number === data.ticket!.ticket_number ? data.ticket! : t)) ?? null);
      setOpenCount((c) => (action === "resolve" ? Math.max(0, c - 1) : c + 1));
    } catch {
      setActionError("Network error — try again.");
    } finally {
      setActing(false);
    }
  }

  const list = tickets ?? [];

  return (
    <div className="min-h-screen bg-[#F7F8F9]">
      {/* Header */}
      <header className="flex h-[60px] items-center justify-between border-b border-[#E0E3E6] bg-white px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[#0B0D0F]">
            <LifeBuoy className="h-4 w-4 text-white" />
          </span>
          <span className="text-[15px] font-bold tracking-[-0.02em] text-[#0B0D0F]">Support</span>
          <span className="rounded-full border border-[#9CCFBB] bg-[#E6F4EF] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#006B45]">Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[11px] text-[#9CA3AF] sm:inline">{adminEmail}</span>
          <span className="rounded-full bg-[#0B0D0F] px-2.5 py-1 text-[11px] font-semibold text-white">Open: {openCount}</span>
          <button type="button" onClick={() => void loadList()} title="Refresh" className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[12px] font-medium text-[#4B5563] hover:bg-[#F7F8F9]">
            <RefreshCw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-3 py-5 sm:px-6 lg:grid-cols-[360px_1fr]">
        {/* ── Left: list ─────────────────────────────────────────────────── */}
        <section className={`${selected ? "hidden lg:block" : "block"}`}>
          {/* Filters */}
          <div className="mb-3 flex items-center gap-1 rounded-[9px] border border-[#E0E3E6] bg-white p-1">
            {(["all", "open", "resolved"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`flex-1 rounded-[6px] px-2.5 py-1 text-[12px] font-medium capitalize transition-colors ${
                  filter === f ? "bg-[#0B0D0F] text-white" : "text-[#4B5563] hover:bg-[#F3F4F5]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#B6BCC2]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticket #, email, subject…"
              className="h-9 w-full rounded-[8px] border border-[#E0E3E6] bg-white pl-8 pr-2.5 text-[12.5px] text-[#0B0D0F] placeholder:text-[#B6BCC2] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
            />
          </div>

          {/* List body */}
          {tickets === null ? (
            <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-[#C9CED4]" /></div>
          ) : listError ? (
            <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-[12.5px] text-[#B91C1C]">
              <AlertCircle className="mb-1 h-4 w-4" />
              {listError}
              <button type="button" onClick={() => void loadList()} className="ml-1 font-semibold underline">Retry</button>
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[#D7DBE0] bg-white px-4 py-14 text-center">
              <p className="text-[14px] font-semibold text-[#0B0D0F]">No support requests</p>
              <p className="mx-auto mt-1.5 max-w-[240px] text-[12.5px] leading-[1.6] text-[#9CA3AF]">
                New support requests submitted through Vectorbea will appear here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {list.map((t) => {
                const st = STATUS_STYLE[t.status] ?? STATUS_STYLE.OPEN!;
                const active = selected === t.ticket_number;
                return (
                  <li key={t.ticket_number}>
                    <button
                      type="button"
                      onClick={() => void loadDetail(t.ticket_number, t)}
                      className={`w-full rounded-[11px] border bg-white p-3 text-left transition-colors ${
                        active ? "border-[#0B0D0F] ring-2 ring-[#0B0D0F]/10" : "border-[#E0E3E6] hover:border-[#C9CED4]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-semibold text-[#4B5563]">{t.ticket_number}</span>
                        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ background: st.bg, color: st.fg, borderColor: st.bd }}>
                          {t.status === "OPEN" ? "OPEN" : "RESOLVED"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[13px] font-semibold text-[#0B0D0F]">{t.subject}</p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-[#9CA3AF]">
                        {t.user_email}{t.tenant_name ? ` · ${t.tenant_name}` : ""} · {ago(t.created_at)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Right: detail ──────────────────────────────────────────────── */}
        <section className={`${selected ? "block" : "hidden lg:block"}`}>
          {!selected ? (
            <div className="flex h-full min-h-[320px] items-center justify-center rounded-[12px] border border-dashed border-[#D7DBE0] bg-white">
              <p className="text-[13px] text-[#9CA3AF]">Select a ticket to view its details.</p>
            </div>
          ) : detailLoading && !detail ? (
            <div className="flex min-h-[320px] items-center justify-center rounded-[12px] border border-[#E0E3E6] bg-white">
              <Loader2 className="h-6 w-6 animate-spin text-[#C9CED4]" />
            </div>
          ) : detailError && !detail ? (
            <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] p-6 text-[13px] text-[#B91C1C]">
              <AlertCircle className="mb-1 h-4 w-4" /> {detailError}
              <button type="button" onClick={() => { setSelected(null); setDetailError(null); }} className="ml-1 font-semibold underline">Back to list</button>
            </div>
          ) : detail ? (
            <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-5 sm:p-6">
              {/* Mobile back */}
              <button type="button" onClick={() => setSelected(null)} className="mb-3 flex items-center gap-1 text-[12px] font-medium text-[#6B7280] lg:hidden">
                <ArrowLeft className="h-3.5 w-3.5" /> All tickets
              </button>

              {/* Top row: number + status + priority */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] font-bold text-[#0B0D0F]">{detail.ticket_number}</span>
                {(() => { const st = STATUS_STYLE[detail.status] ?? STATUS_STYLE.OPEN!; return (
                  <span className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: st.bg, color: st.fg, borderColor: st.bd }}>
                    {detail.status}
                  </span>
                ); })()}
                <span className="font-mono text-[11px] font-bold uppercase" style={{ color: PRIORITY_FG[detail.priority] ?? "#6B7280" }}>{detail.priority}</span>
                {detail.category && <span className="rounded-full bg-[#F3F4F5] px-2 py-0.5 text-[10.5px] font-medium text-[#6B7280]">{detail.category.replace(/_/g, " ")}</span>}
                {detailLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#C9CED4]" />}
              </div>

              <h1 className="mt-2.5 text-[19px] font-bold tracking-[-0.02em] text-[#0B0D0F]">{detail.subject}</h1>

              {/* Meta grid */}
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 border-y border-[#F1F2F4] py-4 sm:grid-cols-2">
                <Meta label="User" value={detail.user_name ?? "—"} />
                <Meta label="User email" value={detail.user_email} mono />
                <Meta label="Workspace / tenant" value={detail.tenant_name ?? "—"} />
                <Meta label="Created" value={fmt(detail.created_at)} />
                {detail.status === "RESOLVED" && <Meta label="Resolved by" value={detail.resolved_by ?? "—"} mono />}
                {detail.status === "RESOLVED" && <Meta label="Resolved at" value={fmt(detail.resolved_at)} />}
              </dl>

              {/* Message */}
              <p className="mb-1.5 mt-4 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">Message</p>
              <p className="whitespace-pre-wrap rounded-[10px] border border-[#ECEEEF] bg-[#FAFBFB] px-3.5 py-3 text-[13.5px] leading-[1.7] text-[#374151]">
                {detail.message}
              </p>

              {/* Existing admin note */}
              {detail.admin_note && (
                <div className="mt-3 rounded-[10px] bg-[#F7F8F9] px-3.5 py-3 text-[12.5px] leading-[1.6] text-[#4B5563]">
                  <span className="font-semibold text-[#0B0D0F]">Admin note:</span> {detail.admin_note}
                </div>
              )}

              {/* Actions */}
              <div className="mt-5 border-t border-[#F1F2F4] pt-4">
                <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">
                  {detail.status === "OPEN" ? "Resolution note (optional)" : "Note (optional)"}
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={10000}
                  placeholder="Restarted the workflow after correcting the provider connection."
                  className="w-full resize-none rounded-[8px] border border-[#E0E3E6] bg-white px-2.5 py-2 text-[12.5px] leading-[1.55] text-[#0B0D0F] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
                />
                {actionError && (
                  <p className="mt-2 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] font-medium text-[#B91C1C]">{actionError}</p>
                )}
                <div className="mt-3 flex items-center justify-end gap-2">
                  {detail.status === "OPEN" ? (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void act("resolve")}
                      className="flex h-9 items-center gap-2 rounded-[8px] bg-[#007F4E] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#006B45] disabled:opacity-50"
                    >
                      {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Resolve ticket
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void act("reopen")}
                      className="flex h-9 items-center gap-2 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[13px] font-semibold text-[#374151] transition-colors hover:bg-[#F7F8F9] disabled:opacity-50"
                    >
                      {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Reopen ticket
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">{label}</dt>
      <dd className={`mt-0.5 text-[13px] text-[#0B0D0F] ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}
