"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Siren,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { AiIncident, IncidentSeverity, IncidentSourceType, IncidentStatus } from "@/lib/api";
import { canUseIncidents } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_STYLE: Record<IncidentSeverity, string> = {
  low:      "bg-[#ECFDF5] text-[#065F46]",
  medium:   "bg-[#FFFBEB] text-[#92400E]",
  high:     "bg-[#FFF7ED] text-[#C2410C]",
  critical: "bg-[#FEF2F2] text-[#991B1B]",
};

const STATUS_STYLE: Record<IncidentStatus, string> = {
  open:                 "bg-[#FEF2F2] text-[#991B1B]",
  investigating:        "bg-[#FFF7ED] text-[#C2410C]",
  fix_in_progress:      "bg-[#FFFBEB] text-[#92400E]",
  verification_pending: "bg-[#EFF6FF] text-[#1D4ED8]",
  resolved:             "bg-[#ECFDF5] text-[#065F46]",
  dismissed:            "bg-[#F3F4F6] text-[#9CA3AF]",
};

const ALL_SEVERITIES: IncidentSeverity[] = ["low", "medium", "high", "critical"];
const ALL_STATUSES: IncidentStatus[] = ["open", "investigating", "fix_in_progress", "verification_pending", "resolved", "dismissed"];
const ALL_SOURCE_TYPES: IncidentSourceType[] = ["alert", "trace", "workflow_regression", "safety_gate", "manual", "notification"];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateModal({
  onClose,
  onDone,
  workspaceId,
}: {
  onClose: () => void;
  onDone: (i: AiIncident) => void;
  workspaceId: string;
}) {
  const [title, setTitle]           = useState("");
  const [description, setDesc]      = useState("");
  const [severity, setSeverity]     = useState<IncidentSeverity>("medium");
  const [sourceType, setSourceType] = useState<IncidentSourceType>("manual");
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) { setErr("Title is required."); return; }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/incidents?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), description: description.trim() || null, severity, sourceType }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed to create incident");
      onDone(json as AiIncident);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create incident");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#E7DED1] bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-[#111111]">Report incident</h2>
        <p className="mt-1 text-sm text-[#6B7280]">Manually report a governance or safety incident.</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">Title <span className="text-[#991B1B]">*</span></label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Policy violation in production"
              className="w-full rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What happened and what was the impact?"
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#374151] mb-1">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                className="w-full rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-2 py-2 text-sm text-[#111111]"
              >
                {ALL_SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#374151] mb-1">Source</label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as IncidentSourceType)}
                className="w-full rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-2 py-2 text-sm text-[#111111]"
              >
                {ALL_SOURCE_TYPES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
              </select>
            </div>
          </div>
        </div>
        {err && <p className="mt-2 text-xs text-[#991B1B]">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F8F5EF]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IncidentsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [items, setItems]   = useState<AiIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Filters
  const [statusF, setStatusF]   = useState<IncidentStatus | "all">("all");
  const [severityF, setSeverityF] = useState<IncidentSeverity | "all">("all");

  useEffect(() => {
    if (!activeWorkspaceId || !canUseIncidents(planTier)) { setLoading(false); return; }
    setLoading(true);
    let url = `/api/incidents?workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
    if (statusF !== "all")   url += `&status=${encodeURIComponent(statusF)}`;
    if (severityF !== "all") url += `&severity=${encodeURIComponent(severityF)}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: unknown) => {
        if (Array.isArray(json)) setItems(json as AiIncident[]);
        else setError((json as { error?: string }).error ?? "Failed to load");
      })
      .catch(() => setError("Failed to load incidents"))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, planTier, statusF, severityF]);

  const counts = {
    open:      items.filter((i) => i.status === "open").length,
    critical:  items.filter((i) => i.severity === "critical").length,
    resolved:  items.filter((i) => i.status === "resolved").length,
  };

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      {creating && activeWorkspaceId && (
        <CreateModal
          workspaceId={activeWorkspaceId}
          onClose={() => setCreating(false)}
          onDone={(created) => {
            setItems((prev) => [created, ...prev]);
            setCreating(false);
          }}
        />
      )}

      <AppHeader
        title="Incidents"
        subtitle="Governance issue tracking — policy violations, evidence failures, and release blocks"
        actions={
          canUseIncidents(planTier) ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
            >
              <Plus className="h-3.5 w-3.5" /> Report incident
            </button>
          ) : undefined
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">
        {!canUseIncidents(planTier) && (
          <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-4 text-sm text-[#6B7280]">
            Incidents are available on Pro and Enterprise plans.
          </div>
        )}

        {canUseIncidents(planTier) && (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Open",     value: counts.open,     color: "text-[#991B1B]" },
                { label: "Critical", value: counts.critical,  color: "text-[#C2410C]" },
                { label: "Resolved", value: counts.resolved,  color: "text-[#065F46]" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-[#E7DED1] bg-white px-4 py-3">
                  <p className={`text-2xl font-bold ${s.color}`}>{loading ? "—" : s.value}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <Select value={statusF} onChange={(e) => setStatusF(e.target.value as IncidentStatus | "all")} className="text-xs w-36">
                <option value="all">All statuses</option>
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
                ))}
              </Select>
              <Select value={severityF} onChange={(e) => setSeverityF(e.target.value as IncidentSeverity | "all")} className="text-xs w-32">
                <option value="all">All severities</option>
                {ALL_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </Select>
              {(statusF !== "all" || severityF !== "all") && (
                <button
                  type="button"
                  onClick={() => { setStatusF("all"); setSeverityF("all"); }}
                  className="text-xs text-[#6B7280] hover:text-[#374151] underline"
                >
                  Clear
                </button>
              )}
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-[#6B7280]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading incidents…
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            {!loading && !error && (
              <div className="rounded-xl border border-[#E7DED1] bg-white overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_80px_140px_120px_110px_100px] gap-3 px-4 py-2 border-b border-[#F1ECE3] bg-[#FBFAF7] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">
                  <span>Title</span>
                  <span>Severity</span>
                  <span className="hidden sm:block">AI System</span>
                  <span>Status</span>
                  <span className="hidden md:block">Source</span>
                  <span className="hidden sm:block">Created</span>
                </div>

                {items.length === 0 ? (
                  <div className="flex flex-col items-center gap-4 py-16 text-center">
                    <div className="rounded-full bg-[#FFFBEB] p-4">
                      <Siren className="h-8 w-8 text-[#92400E]" />
                    </div>
                    <div>
                      <p className="font-semibold text-[#111111]">No incidents</p>
                      <p className="text-sm text-[#6B7280] mt-1">
                        Incidents are automatically created when evidence checks fail or releases are blocked.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCreating(true)}
                      className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
                    >
                      Report manually
                    </button>
                  </div>
                ) : (
                  items.map((incident) => (
                    <div
                      key={incident.id}
                      className="grid grid-cols-[1fr_80px_140px_120px_110px_100px] gap-3 px-4 py-3 border-b border-[#F1ECE3] last:border-0 items-center hover:bg-[#FBFAF7]"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/incidents/${incident.id}` as Route}
                          className="text-sm font-medium text-[#111111] hover:text-[#2563EB] truncate block"
                        >
                          {incident.title}
                        </Link>
                      </div>
                      <Badge className={`${SEVERITY_STYLE[incident.severity]} text-[10px] font-normal w-fit`}>
                        {incident.severity}
                      </Badge>
                      <span className="hidden sm:block text-xs text-[#374151] truncate">
                        {incident.capabilityName ?? "—"}
                      </span>
                      <Badge className={`${STATUS_STYLE[incident.status]} text-[10px] font-normal w-fit`}>
                        {incident.status.replaceAll("_", " ")}
                      </Badge>
                      <span className="hidden md:block text-xs text-[#6B7280]">
                        {incident.sourceType.replaceAll("_", " ")}
                      </span>
                      <span className="hidden sm:block text-[10px] text-[#9CA3AF]">{fmtDate(incident.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
