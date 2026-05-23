"use client";

/**
 * /runs/[id] — canonical run detail page.
 * Tries the repository first (seeded runs); falls back to live API for real runs.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { RunHeaderV2 } from "@/components/agent-runs/v2/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/v2/RunSummaryCards";
import { RunDetailTabsV2 } from "@/components/agent-runs/v2/RunDetailTabsV2";
import { getRun, getRunEvents } from "@/lib/repository";
import { mapRunToUiModel } from "@/lib/repository/run-to-ui-mapper";
import { mapApiRunToUiModel, type ApiAgentRun } from "@/lib/api-run-to-ui-model";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [model, setModel] = useState<AgentRunUiModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [forcePausedPending, setForcePausedPending] = useState(false);
  const [retryWarnings, setRetryWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Try repository (seeded / in-memory) first
      const [seedRun, seedEvents] = await Promise.all([getRun(id), getRunEvents(id)]);
      if (seedRun) {
        setModel(mapRunToUiModel(seedRun, seedEvents));
        return;
      }
      // 2. Fall back to live API
      const res = await fetch(`/api/agent-runs/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = (await res.json()) as { run: ApiAgentRun };
      setModel(mapApiRunToUiModel(data.run));
    } catch {
      toast.error("Failed to load run details.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh while live
  useEffect(() => {
    if (!model) return;
    const live = ["RUNNING", "QUEUED", "WAITING_FOR_APPROVAL"].includes(model.run.status);
    if (!live) return;
    const interval = setInterval(() => void load(), 6000);
    return () => clearInterval(interval);
  }, [model, load]);

  async function handleRetry(forcePaused = false) {
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
        if (b.code === "JOB_PAUSED") { setForcePausedPending(true); toast.warning("Workflow is paused. Confirm retry."); return; }
        throw new Error(b.error ?? "Failed to retry");
      }
      const data = (await res.json()) as { run: { id: string }; warnings?: string[] };
      if (data.warnings?.length) setRetryWarnings(data.warnings);
      toast.success("Retry queued.");
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
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error);
      toast.success("Run cancelled.");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel.");
    } finally {
      setActing(false);
    }
  }

  if (loading && !model) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium text-muted-foreground">Run not found</p>
        <Link href={"/runs" as never} className="flex items-center gap-1 text-[12px] text-primary hover:underline">
          <ArrowLeft className="h-3 w-3" />
          Back to Runs
        </Link>
      </div>
    );
  }

  const displayModel: AgentRunUiModel = forcePausedPending
    ? { ...model, run: { ...model.run, errorMessage: (model.run.errorMessage ? model.run.errorMessage + " · " : "") + "Workflow paused — confirm retry to proceed" } }
    : model;

  return (
    <div className="min-h-full p-6 pb-16 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Breadcrumb */}
        <Link href={"/runs" as never} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Runs
        </Link>

        {retryWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300 space-y-1">
            {retryWarnings.map((w, i) => <p key={i}><span className="font-semibold">Warning:</span> {w}</p>)}
          </div>
        )}

        {forcePausedPending && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm text-amber-300">The workflow is paused. Retry anyway?</p>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => setForcePausedPending(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-muted">Cancel</button>
              <button type="button" disabled={acting} onClick={() => void handleRetry(true)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {acting ? "Retrying…" : "Retry anyway"}
              </button>
            </div>
          </div>
        )}

        <RunHeaderV2
          model={displayModel}
          onRetry={!forcePausedPending ? () => void handleRetry(false) : undefined}
          onCancel={handleCancel}
        />
        <RunSummaryCards model={model} />
        <RunDetailTabsV2 model={model} />
      </div>
    </div>
  );
}
