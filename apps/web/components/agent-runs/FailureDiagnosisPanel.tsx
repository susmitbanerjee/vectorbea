"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, ExternalLink, RefreshCw,
  Shield, Wrench, XCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";
import type { Route } from "next";

interface FailureIncident {
  id: string;
  runId: string;
  workflowId: string;
  failedNodeId: string | null;
  failedConnectionId: string | null;
  category: string;
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  summary: string;
  technicalSummary: string | null;
  recommendedAction: string | null;
  retryable: boolean;
  autoReplaySafe: boolean;
  requiresHumanApproval: boolean;
  resolutionStatus: "open" | "resolved";
  detectedAt: string;
}

const SEVERITY_STYLE: Record<string, { bg: string; border: string; text: string; icon: typeof AlertTriangle }> = {
  LOW:      { bg: "#F0FDF4", border: "#BBF7D0", text: "#15803D", icon: CheckCircle2 },
  MEDIUM:   { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309", icon: AlertTriangle },
  HIGH:     { bg: "#FFF7ED", border: "#FED7AA", text: "#C2410C", icon: AlertTriangle },
  CRITICAL: { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C", icon: XCircle },
};

const CATEGORY_LABEL: Record<string, string> = {
  CONNECTION_FAILURE: "Connection", AUTH_FAILURE: "Auth", NETWORK_FAILURE: "Network",
  RATE_LIMIT: "Rate Limit", TIMEOUT: "Timeout", MAPPING_FAILURE: "Mapping",
  LLM_OUTPUT_INVALID: "LLM Output", SCHEMA_VALIDATION_FAILURE: "Schema",
  DB_QUERY_FAILURE: "Database", DB_WRITE_BLOCKED: "Database Write",
  APPROVAL_REJECTED: "Approval", APPROVAL_TIMEOUT: "Approval Timeout",
  WORKER_CRASHED: "Worker", UNKNOWN: "Unknown",
};

interface Props {
  runId: string;
  workflowId: string;
}

export function FailureDiagnosisPanel({ runId, workflowId }: Props) {
  const [incident, setIncident] = useState<FailureIncident | null>(null);
  const [loading, setLoading]   = useState(true);
  const [resolving, setResolving] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  useEffect(() => {
    apiFetch<FailureIncident | null>(`/api/runs/${runId}/failure-incident`)
      .then(setIncident)
      .catch(() => setIncident(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !incident || incident.resolutionStatus === "resolved") return null;

  const sev = SEVERITY_STYLE[incident.severity] ?? SEVERITY_STYLE.MEDIUM;
  const SevIcon = sev.icon;

  async function markResolved() {
    setResolving(true);
    try {
      await apiFetch(`/api/failure-incidents/${incident!.id}/mark-resolved`, { method: "POST" });
      setIncident(null);
    } catch { /* ignore */ }
    finally { setResolving(false); }
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: sev.bg, border: `1px solid ${sev.border}`, boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="flex items-start gap-3 min-w-0">
          <SevIcon className="h-5 w-5 shrink-0 mt-0.5" style={{ color: sev.text }} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span style={{ fontSize: 14, fontWeight: 700, color: sev.text }}>Failure Diagnosed</span>
              <span
                className="rounded-full border px-2 py-0.5"
                style={{ fontSize: 11, fontWeight: 600, background: "#FFFFFF", color: sev.text, borderColor: sev.border }}
              >
                {CATEGORY_LABEL[incident.category] ?? incident.category} · {incident.code}
              </span>
              <span
                className="rounded-full border px-2 py-0.5"
                style={{ fontSize: 11, fontWeight: 600, background: "#FFFFFF", borderColor: sev.border, color: "#64748B" }}
              >
                {incident.severity}
              </span>
            </div>
            <p style={{ fontSize: 13.5, color: "#334155", lineHeight: 1.5 }}>{incident.summary}</p>
            {incident.technicalSummary && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() => setShowTechnical(!showTechnical)}
                  className="flex items-center gap-1 text-[12px] font-medium"
                  style={{ color: "#64748B" }}
                >
                  {showTechnical ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {showTechnical ? "Hide" : "Show"} technical details
                </button>
                {showTechnical && (
                  <p className="mt-1 font-mono" style={{ fontSize: 11.5, color: "#475569", background: "rgba(255,255,255,0.6)", padding: "6px 10px", borderRadius: 8 }}>
                    {incident.technicalSummary}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recommendation + metadata */}
      {incident.recommendedAction && (
        <div className="px-5 pb-3" style={{ borderTop: `1px solid ${sev.border}`, paddingTop: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748B", marginBottom: 4 }}>
            Recommended action
          </p>
          <p style={{ fontSize: 13, color: "#334155" }}>{incident.recommendedAction}</p>
        </div>
      )}

      {/* Status chips */}
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        {[
          { label: "Retryable",             value: incident.retryable },
          { label: "Replay safe",           value: incident.autoReplaySafe },
          { label: "Requires approval",     value: incident.requiresHumanApproval },
        ].map(({ label, value }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1"
            style={{
              fontSize: 11.5, fontWeight: 600,
              background: "#FFFFFF", borderColor: sev.border,
              color: value ? "#059669" : "#64748B",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: value ? "#22C55E" : "#CBD5E1" }}
            />
            {label}: {value ? "Yes" : "No"}
          </span>
        ))}
      </div>

      {/* Action buttons */}
      <div
        className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-2"
        style={{ borderTop: `1px solid ${sev.border}` }}
      >
        {incident.failedNodeId && (
          <Link
            href={`/workflows/${workflowId}/builder` as Route}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors hover:bg-white"
            style={{ borderColor: sev.border, color: "#334155", background: "rgba(255,255,255,0.6)" }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Builder
          </Link>
        )}
        {incident.failedConnectionId && (
          <Link
            href={`/connections/${incident.failedConnectionId}` as Route}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors hover:bg-white"
            style={{ borderColor: sev.border, color: "#334155", background: "rgba(255,255,255,0.6)" }}
          >
            <Wrench className="h-3.5 w-3.5" />
            Open Connection
          </Link>
        )}
        <button
          type="button"
          onClick={() => void markResolved()}
          disabled={resolving}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors hover:bg-white disabled:opacity-50"
          style={{ borderColor: sev.border, color: "#334155", background: "rgba(255,255,255,0.6)" }}
        >
          {resolving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
          Mark resolved
        </button>
      </div>
    </div>
  );
}
