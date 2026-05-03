"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  Filter,
  Loader2,
  Search,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuditEvent } from "@/lib/api";
import { canUseGovernanceDashboard } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function eventTypeLabel(t: string) {
  return t.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const EVENT_TYPE_COLOR: Record<string, string> = {
  version_activated:       "bg-[#ECFDF5] text-[#065F46]",
  approval_approved:       "bg-[#ECFDF5] text-[#065F46]",
  approval_rejected:       "bg-[#FEF2F2] text-[#991B1B]",
  release_blocked:         "bg-[#FEF2F2] text-[#991B1B]",
  evidence_run_failed:     "bg-[#FEF2F2] text-[#991B1B]",
  evidence_run_completed:  "bg-[#ECFDF5] text-[#065F46]",
  evidence_run_started:    "bg-[#EFF6FF] text-[#1D4ED8]",
  release_gate_evaluated:  "bg-[#EFF6FF] text-[#1D4ED8]",
  approval_requested:      "bg-[#FFFBEB] text-[#92400E]",
};

function eventBadgeCls(eventType: string) {
  return EVENT_TYPE_COLOR[eventType] ?? "bg-[#F3F4F6] text-[#374151]";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch]         = useState("");
  const [filterEvent, setFilterEvent] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterFrom, setFilterFrom]   = useState("");
  const [filterTo, setFilterTo]       = useState("");

  useEffect(() => {
    if (!activeWorkspaceId || !canUseGovernanceDashboard(planTier)) { setLoading(false); return; }
    setLoading(true);
    let url = `/api/governance/audit?workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
    if (filterEvent)  url += `&eventType=${encodeURIComponent(filterEvent)}`;
    if (filterEntity) url += `&entityType=${encodeURIComponent(filterEntity)}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: unknown) => {
        if (Array.isArray(json)) setEvents(json as AuditEvent[]);
        else setError((json as { error?: string }).error ?? "Failed to load");
      })
      .catch(() => setError("Failed to load audit events"))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, planTier, filterEvent, filterEntity]);

  // Unique options derived from loaded data
  const eventTypes  = useMemo(() => [...new Set(events.map((e) => e.eventType))].sort(),  [events]);
  const entityTypes = useMemo(() => [...new Set(events.map((e) => e.entityType))].sort(), [events]);

  // Client-side filters for search + date range
  const visible = useMemo(() => {
    return events.filter((e) => {
      if (search) {
        const q = search.toLowerCase();
        if (!e.eventType.includes(q) && !(e.entityName ?? "").toLowerCase().includes(q) && !e.entityId.includes(q) && !(e.actorUserId ?? "").toLowerCase().includes(q)) {
          return false;
        }
      }
      if (filterFrom && new Date(e.createdAt) < new Date(filterFrom)) return false;
      if (filterTo   && new Date(e.createdAt) > new Date(filterTo + "T23:59:59")) return false;
      return true;
    });
  }, [events, search, filterFrom, filterTo]);

  function exportCsv() {
    const header = "timestamp,event_type,entity_type,entity_id,entity_name,actor\n";
    const rows = visible.map((e) =>
      [e.createdAt, e.eventType, e.entityType, e.entityId, e.entityName ?? "", e.actorUserId ?? ""].map((v) => `"${v}"`).join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-trail.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasFilters = search || filterEvent || filterEntity || filterFrom || filterTo;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Audit Trail"
        subtitle="Immutable log of all governance actions"
        actions={
          <button
            type="button"
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF] disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="Search actor, event, entity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-xl border border-[#D8CFC2] bg-white pl-8 pr-3 py-1.5 text-xs text-[#111111] focus:border-[#2563EB] focus:outline-none w-52"
            />
          </div>
          <select
            value={filterEvent}
            onChange={(e) => setFilterEvent(e.target.value)}
            className="rounded-xl border border-[#D8CFC2] bg-white px-2 py-1.5 text-xs text-[#374151] focus:outline-none"
          >
            <option value="">All event types</option>
            {eventTypes.map((t) => <option key={t} value={t}>{eventTypeLabel(t)}</option>)}
          </select>
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            className="rounded-xl border border-[#D8CFC2] bg-white px-2 py-1.5 text-xs text-[#374151] focus:outline-none"
          >
            <option value="">All entity types</option>
            {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="rounded-xl border border-[#D8CFC2] bg-white px-2 py-1.5 text-xs text-[#374151] focus:outline-none"
            title="From date"
          />
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="rounded-xl border border-[#D8CFC2] bg-white px-2 py-1.5 text-xs text-[#374151] focus:outline-none"
            title="To date"
          />
          {hasFilters && (
            <button
              type="button"
              onClick={() => { setSearch(""); setFilterEvent(""); setFilterEntity(""); setFilterFrom(""); setFilterTo(""); }}
              className="text-xs text-[#6B7280] hover:text-[#374151] underline"
            >
              Clear
            </button>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-[#6B7280]" />}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {!canUseGovernanceDashboard(planTier) && (
          <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-4 text-sm text-[#6B7280]">
            Audit trail is available on Pro and Enterprise plans.
          </div>
        )}

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-[#111111] flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-[#6B7280]" />
              Audit history
              {!loading && <span className="ml-1 text-[#9CA3AF] font-normal">({visible.length})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Table header */}
            <div className="grid grid-cols-[140px_110px_1fr_160px_120px] gap-3 border-b border-[#F1ECE3] bg-[#FBFAF7] px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
              <span>Event</span>
              <span>Entity type</span>
              <span>Entity</span>
              <span className="hidden md:block">Actor</span>
              <span className="hidden sm:block">Timestamp</span>
            </div>

            {!loading && !error && visible.length === 0 && (
              <p className="py-12 text-center text-sm text-[#6B7280]">No audit events match your filters.</p>
            )}

            <div className="divide-y divide-[#F1ECE3]">
              {visible.map((event) => (
                <div
                  key={event.id}
                  className="grid grid-cols-[140px_110px_1fr_160px_120px] gap-3 px-4 py-2.5 items-center hover:bg-[#FBFAF7]"
                >
                  <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${eventBadgeCls(event.eventType)}`}>
                    {eventTypeLabel(event.eventType)}
                  </span>
                  <span className="text-xs text-[#374151]">{event.entityType}</span>
                  <span className="text-xs text-[#6B7280] truncate" title={event.entityId}>
                    {event.entityName ?? event.entityId.slice(0, 12)}
                  </span>
                  <span className="hidden md:block text-[10px] text-[#9CA3AF] truncate" title={event.actorUserId ?? ""}>
                    {event.actorUserId ? event.actorUserId.slice(0, 12) + "…" : "system"}
                  </span>
                  <span className="hidden sm:block text-[10px] text-[#9CA3AF] whitespace-nowrap">{fmtDate(event.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
