"use client";

/**
 * /agent-runs/mock-failed
 *
 * Static demo — Payment Recovery Agent run that FAILED after retries exhausted.
 * No API calls. Switch to scenarioBMock to swap data.
 */

import Link from "next/link";
import { toast } from "sonner";

import { RunHeaderV2 } from "@/components/agent-runs/v2/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/v2/RunSummaryCards";
import { RunDetailTabsV2 } from "@/components/agent-runs/v2/RunDetailTabsV2";
import { scenarioBMock } from "@/mocks/preproduction-agent-run.mock";

export default function MockFailedRunPage() {
  function handleRetry() {
    toast.info("Retry is mocked — no real API call.", {
      description: "Connect to POST /api/agent-runs/:id/retry to enable.",
    });
  }

  return (
    <div className="min-h-full">
      {/* Banner */}
      <div className="border-b border-border/50 bg-red-500/[0.04] px-6 py-3 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-red-600/70 dark:text-red-400/70">
              Demo scenario · Failed run
            </p>
            <p className="text-xs text-muted-foreground">
              Payment Recovery Agent — retries exhausted after HTTP 429.
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
          <RunHeaderV2 model={scenarioBMock} isMock onRetry={handleRetry} />
          <RunSummaryCards model={scenarioBMock} />
          <RunDetailTabsV2 model={scenarioBMock} defaultTab="timeline" />

          <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Developer note</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Static mock from{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">mocks/preproduction-agent-run.mock.ts</code>
              {" "}· scenario B (scenarioBMock). Connect real data via{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">GET /api/agent-runs/:id</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
