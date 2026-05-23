"use client";

/**
 * /agent-runs/mock-failed
 *
 * Demo — failed run. Loads seed run "run-b-failed" from the repository.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { RunHeaderV2 } from "@/components/agent-runs/v2/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/v2/RunSummaryCards";
import { RunDetailTabsV2 } from "@/components/agent-runs/v2/RunDetailTabsV2";
import { getRun, getRunEvents } from "@/lib/repository";
import { mapRunToUiModel } from "@/lib/repository/run-to-ui-mapper";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

export default function MockFailedRunPage() {
  const [model, setModel] = useState<AgentRunUiModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [run, events] = await Promise.all([getRun("run-b-failed"), getRunEvents("run-b-failed")]);
        if (!run) throw new Error("not found");
        setModel(mapRunToUiModel(run, events));
      } catch {
        toast.error("Failed to load demo run.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function handleRetry() {
    toast.info("Retry is mocked — no real API call.", {
      description: "Connect to POST /api/agent-runs/:id/retry to enable.",
    });
  }

  return (
    <div className="min-h-full">
      <div className="border-b border-border/50 bg-red-500/[0.04] px-6 py-3 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-red-600/70 dark:text-red-400/70">
              Demo scenario · Failed run
            </p>
            <p className="text-xs text-muted-foreground">
              Customer Renewal Intelligence — retries exhausted after HTTP 429.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/agent-runs/mock" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              ← View success scenario
            </Link>
            <Link href="/agent-runs/mock-waiting-approval" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              View approval scenario →
            </Link>
          </div>
        </div>
      </div>

      <div className="px-6 pb-16 pt-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {loading || !model ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <RunHeaderV2 model={model} isMock onRetry={handleRetry} />
              <RunSummaryCards model={model} />
              <RunDetailTabsV2 model={model} defaultTab="timeline" />
            </>
          )}

          <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Developer note</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Data via{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">lib/repository</code>
              {" "}seed run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">run-b-failed</code>
              {" · "}
              <Link href="/agent-runs/mock" className="text-primary hover:underline">View all scenarios</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
