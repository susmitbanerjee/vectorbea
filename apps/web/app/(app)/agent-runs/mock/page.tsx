"use client";

/**
 * /agent-runs/mock
 *
 * Demo page — loads seeded runs from the repository layer.
 * No direct mock imports. Data flows: seed → repository → mapRunToUiModel → UI.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunHeaderV2 } from "@/components/agent-runs/v2/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/v2/RunSummaryCards";
import { RunDetailTabsV2 } from "@/components/agent-runs/v2/RunDetailTabsV2";
import { getRun, getRunEvents } from "@/lib/repository";
import { mapRunToUiModel } from "@/lib/repository/run-to-ui-mapper";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

type DemoScenario = "success" | "failed" | "waiting";

const SCENARIO_RUN_IDS: Record<DemoScenario, string> = {
  success: "run-a-succeeded",
  failed:  "run-b-failed",
  waiting: "run-c-waiting",
};

export default function MockAgentRunPage() {
  const [scenario, setScenario] = useState<DemoScenario>("success");
  const [model, setModel] = useState<AgentRunUiModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const runId = SCENARIO_RUN_IDS[scenario];
        const [run, events] = await Promise.all([getRun(runId), getRunEvents(runId)]);
        if (!run) throw new Error("Run not found");
        setModel(mapRunToUiModel(run, events));
      } catch {
        toast.error("Failed to load demo run.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [scenario]);

  function handleRetry() {
    toast.info("Retry is mocked — no real API call made.", {
      description: "Connect to POST /api/agent-runs/:id/retry to enable.",
    });
  }

  const defaultTab = scenario === "waiting" ? "approvals" : "timeline";

  return (
    <div className="min-h-full">
      {/* Scenario picker */}
      <div
        className="px-6 py-3 lg:px-8"
        style={{ borderBottom: "1px solid rgba(148,163,184,0.09)", background: "var(--surface-1)" }}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Demo · Seed data
            </p>
            <p className="text-xs text-muted-foreground">
              Repository-loaded seeded runs — toggle to preview all execution states.
            </p>
          </div>
          <Tabs value={scenario} onValueChange={(v) => setScenario(v as DemoScenario)}>
            <TabsList className="h-8">
              <TabsTrigger value="success" className="gap-1.5 text-xs px-3">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Succeeded
              </TabsTrigger>
              <TabsTrigger value="failed" className="gap-1.5 text-xs px-3">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                Failed
              </TabsTrigger>
              <TabsTrigger value="waiting" className="gap-1.5 text-xs px-3">
                <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
                Waiting Approval
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Main content */}
      <div className="px-6 pb-12 pt-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {loading || !model ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <RunHeaderV2 model={model} isMock onRetry={scenario !== "waiting" ? handleRetry : undefined} />
              <RunSummaryCards model={model} />
              <RunDetailTabsV2 key={scenario} model={model} defaultTab={defaultTab} />
            </>
          )}

          <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Developer note
            </p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Data via{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">lib/repository</code>
              {" "}seeded from{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">lib/seed/platform-seed.ts</code>
              {" · mapped by "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">mapRunToUiModel()</code>.
              Connect real data via{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">GET /api/agent-runs/:id</code>.
              Direct links:{" "}
              <Link href="/agent-runs/mock-failed" className="text-primary hover:underline">mock-failed</Link>
              {" · "}
              <Link href="/agent-runs/mock-waiting-approval" className="text-primary hover:underline">mock-waiting-approval</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
