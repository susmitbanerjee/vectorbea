"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { RunHeaderV2 } from "@/components/agent-runs/v2/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/v2/RunSummaryCards";
import { RunDetailTabsV2 } from "@/components/agent-runs/v2/RunDetailTabsV2";
import { mapApiRunToUiModel, type ApiAgentRun } from "@/lib/api-run-to-ui-model";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AgentRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [model, setModel] = useState<AgentRunUiModel | null>(null);
  const [rawRun, setRawRun] = useState<ApiAgentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [forcePausedPending, setForcePausedPending] = useState(false);
  const [retryWarnings, setRetryWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent-runs/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = (await res.json()) as { run: ApiAgentRun };
      setRawRun(data.run);
      setModel(mapApiRunToUiModel(data.run));
    } catch {
      toast.error("Failed to load run details.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh while run is live
  useEffect(() => {
    if (!model) return;
    const live = ["RUNNING", "QUEUED", "WAITING_FOR_APPROVAL"].includes(model.run.status);
    if (!live) return;
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [model, load]);

  async function handleRetry(forcePaused = false) {
    if (!rawRun) return;
    setActing(true);
    setRetryWarnings([]);
    setForcePausedPending(false);
    try {
      const res = await fetch(`/api/agent-runs/${id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forcePaused }),
      });
      if (!res.ok) {
        const b = (await res.json()) as { error?: string; code?: string };
        if (b.code === "JOB_PAUSED") {
          setForcePausedPending(true);
          toast.warning("Job is paused. Confirm retry to proceed.", { duration: 8000 });
          return;
        }
        throw new Error(b.error ?? "Failed to retry");
      }
      const data = (await res.json()) as { run: { id: string }; warnings?: string[] };
      if (data.warnings?.length) setRetryWarnings(data.warnings);
      toast.success(`Retry queued (attempt #${(rawRun.attemptNumber ?? 0) + 1}).`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to retry.");
    } finally {
      setActing(false);
    }
  }

  async function handleCancel() {
    setActing(true);
    try {
      const res = await fetch(`/api/agent-runs/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const b = (await res.json()) as { error?: string };
        throw new Error(b.error);
      }
      toast.success("Run cancelled.");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel.");
    } finally {
      setActing(false);
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading && !model) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Loading run…</p>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-sm font-medium">Run not found</p>
        <p className="text-xs">It may have been deleted, or the ID is incorrect.</p>
      </div>
    );
  }

  // Build an augmented model for force-paused state
  const displayModel: AgentRunUiModel = forcePausedPending
    ? {
        ...model,
        run: {
          ...model.run,
          errorMessage:
            (model.run.errorMessage ? model.run.errorMessage + " · " : "") +
            "Job is paused — confirm retry to proceed",
        },
      }
    : model;

  return (
    <div className="min-h-full p-6 pb-16 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* ── Retry warnings ──────────────────────────────────────────────── */}
        {retryWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 space-y-1">
            {retryWarnings.map((w, i) => (
              <p key={i}><span className="font-semibold">Warning:</span> {w}</p>
            ))}
          </div>
        )}

        {/* ── Force-paused retry confirmation ─────────────────────────────── */}
        {forcePausedPending && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              The parent job is paused. Retry anyway?
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setForcePausedPending(false)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => void handleRetry(true)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {acting ? "Retrying…" : "Retry anyway"}
              </button>
            </div>
          </div>
        )}

        {/* ── Header: breadcrumb, title, status, actions, metadata strip ─── */}
        <RunHeaderV2
          model={displayModel}
          onRetry={!forcePausedPending ? () => void handleRetry(false) : undefined}
          onCancel={handleCancel}
        />

        {/* ── Summary stat cards ──────────────────────────────────────────── */}
        <RunSummaryCards model={model} />

        {/* ── Main tabbed detail view ─────────────────────────────────────── */}
        <RunDetailTabsV2 model={model} />

      </div>
    </div>
  );
}
