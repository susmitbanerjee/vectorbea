"use client";

/**
 * /agent-runs/mock
 *
 * Pre-production Agent Run Detail demo.
 * Uses fully-detailed static mock data — NO live API calls.
 *
 * Scenario A: Customer Renewal Intelligence (SUCCEEDED, multi-agent, approval gate)
 * Scenario B: Payment Recovery Agent (FAILED, retries exhausted)
 *
 * To connect to real data: replace getMockScenario() with a fetch to
 * GET /api/agent-runs/:id, then map the response to AgentRunUiModel.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunHeaderV2 } from "@/components/agent-runs/v2/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/v2/RunSummaryCards";
import { RunDetailTabsV2 } from "@/components/agent-runs/v2/RunDetailTabsV2";
import { getMockScenario, type MockScenario } from "@/mocks/preproduction-agent-run.mock";

export default function MockAgentRunPage() {
  const [scenario, setScenario] = useState<MockScenario>("success");
  const model = getMockScenario(scenario);

  function handleRetry() {
    toast.info("Retry is mocked — no real API call made.", {
      description: "Connect to POST /api/agent-runs/:id/retry to enable.",
    });
  }

  return (
    <div className="min-h-full">
      {/* Scenario picker */}
      <div className="border-b border-border/50 bg-muted/20 px-6 py-3 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Mock scenario
            </p>
            <p className="text-xs text-muted-foreground">
              Static demo data. Toggle to preview both execution states.
            </p>
          </div>
          <Tabs value={scenario} onValueChange={v => setScenario(v as MockScenario)}>
            <TabsList className="h-8">
              <TabsTrigger value="success" className="gap-1.5 text-xs px-3">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Succeeded (multi-agent + approval)
              </TabsTrigger>
              <TabsTrigger value="failed" className="gap-1.5 text-xs px-3">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                Failed (retries exhausted)
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Main content */}
      <div className="px-6 pb-12 pt-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <RunHeaderV2 model={model} isMock onRetry={handleRetry} />
          <RunSummaryCards model={model} />
          <RunDetailTabsV2 model={model} />

          <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Developer note
            </p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Static mock data from{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                apps/web/mocks/preproduction-agent-run.mock.ts
              </code>
              . Connect real data via{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">GET /api/agent-runs/:id</code>{" "}
              → map to{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">AgentRunUiModel</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
