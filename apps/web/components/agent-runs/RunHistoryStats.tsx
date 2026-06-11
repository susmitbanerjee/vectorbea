"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BarChart3, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { Route } from "next";

interface HistoryStats {
  runId: string;
  eventCount: number;
  sizeBytes: number;
  warningIssued: boolean;
  continueAsNewRecommended: boolean;
  continueAsNewRequired: boolean;
  continuedFromRunId: string | null;
  continuedToRunId: string | null;
  continuationSequence: number;
}

interface Continuation {
  id: string;
  oldRunId: string;
  newRunId: string;
  continuationSequence: number;
  reason: string;
  newRunStatus: string;
  createdAt: string;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1_048_576).toFixed(1)} MB`;
}

interface Props {
  runId: string;
  workflowId?: string;
}

export function RunHistoryStats({ runId, workflowId }: Props) {
  const [stats, setStats]       = useState<HistoryStats | null>(null);
  const [chain, setChain]       = useState<Continuation[]>([]);
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    void apiFetch<HistoryStats>(`/api/runs/${runId}/history-stats`).then(setStats).catch(() => {});
    void apiFetch<Continuation[]>(`/api/runs/${runId}/continuations`).then(setChain).catch(() => {});
  }, [runId]);

  if (!stats) return null;

  const warningColor = stats.continueAsNewRequired
    ? { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C" }
    : stats.warningIssued
    ? { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309" }
    : null;

  async function triggerContinueAsNew() {
    setContinuing(true);
    try {
      const res = await apiFetch<{ newRunId: string }>(`/api/runs/${runId}/continue-as-new`, {
        method: "POST", json: { reason: "manual", carryState: true },
      });
      window.location.href = `/runs/${res.newRunId}`;
    } catch { setContinuing(false); }
  }

  return (
    <div className="space-y-3">
      {/* Continuation chain banner */}
      {(stats.continuedFromRunId || stats.continuedToRunId) && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
        >
          <BarChart3 className="h-4 w-4 shrink-0" style={{ color: "#2563EB" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1D4ED8" }}>
            Continuation chain — sequence {stats.continuationSequence}
          </span>
          {stats.continuedFromRunId && (
            <Link
              href={`/runs/${stats.continuedFromRunId}` as Route}
              className="text-[12px] font-medium hover:underline"
              style={{ color: "#2563EB" }}
            >
              ← Previous run
            </Link>
          )}
          {stats.continuedToRunId && (
            <Link
              href={`/runs/${stats.continuedToRunId}` as Route}
              className="inline-flex items-center gap-1 text-[12px] font-medium hover:underline"
              style={{ color: "#2563EB" }}
            >
              Next run <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          <span className="ml-auto text-[11px]" style={{ color: "#64748B" }}>
            This run continued to keep execution history compact.
          </span>
        </div>
      )}

      {/* History limit warning */}
      {warningColor && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{ background: warningColor.bg, border: `1px solid ${warningColor.border}` }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: warningColor.text }} />
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: warningColor.text }}>
                {stats.continueAsNewRequired ? "History limit reached — continue-as-new required" : "History limit approaching"}
              </span>
              <p style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                {stats.eventCount.toLocaleString()} events · {fmtBytes(stats.sizeBytes)}
                {stats.continueAsNewRequired && " — further events blocked until continued"}
              </p>
            </div>
          </div>
          {!stats.continuedToRunId && (
            <button
              type="button"
              onClick={() => void triggerContinueAsNew()}
              disabled={continuing}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold disabled:opacity-50"
              style={{ background: "#FFFFFF", border: `1px solid ${warningColor.border}`, color: warningColor.text }}
            >
              {continuing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              Continue as new
            </button>
          )}
        </div>
      )}

      {/* Compact stats row — always visible */}
      <div className="flex flex-wrap items-center gap-4 px-1" style={{ fontSize: 12, color: "#64748B" }}>
        <span>{stats.eventCount.toLocaleString()} events</span>
        <span>·</span>
        <span>{fmtBytes(stats.sizeBytes)} history</span>
        {stats.continuationSequence > 0 && (
          <>
            <span>·</span>
            <span>continuation #{stats.continuationSequence}</span>
          </>
        )}
      </div>
    </div>
  );
}
