"use client";

/**
 * /agent-runs/mock
 *
 * ⚠️  MOCK PAGE — uses static demo data from @/mocks/agent-run.mock.ts
 *
 * This page exists to demo the full Agent Run detail experience without
 * a live database or running worker. It shows two scenarios:
 *
 *   Tab 1 — "Successful + Approval"
 *     CRM Enrichment Agent: trigger → analyze → prepare payload →
 *     pause for approval → approved → update CRM → succeed
 *
 *   Tab 2 — "Failed run"
 *     Same job: trigger → analyze → call CRM API → HTTP 429 rate limit → fail
 *
 * TODO: When real API is ready, replace `successRunMock` / `failedRunMock`
 * with a fetch to GET /api/agent-runs/:id and remove the mock badge from RunHeader.
 * See apps/web/app/api/agent-runs/[id]/route.ts for the response shape.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunHeader } from "@/components/agent-runs/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/RunSummaryCards";
import { RunTimeline } from "@/components/agent-runs/RunTimeline";
import { JsonViewer } from "@/components/agent-runs/JsonViewer";
import { ApprovalDetailsCard } from "@/components/agent-runs/ApprovalDetailsCard";
import { AuditTrailTable } from "@/components/agent-runs/AuditTrailTable";
import { successRunMock, failedRunMock } from "@/mocks/agent-run.mock";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MockAgentRunPage() {
  const [scenario, setScenario] = useState<"success" | "failed">("success");

  const run = scenario === "success" ? successRunMock : failedRunMock;

  function handleRetry() {
    toast.info("Retry is mocked — no real API call made.", {
      description: "Connect to POST /api/agent-runs/:id/retry to enable this.",
    });
  }

  return (
    <div className="min-h-full p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* ── Scenario toggle ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Mock scenario
            </p>
            <p className="text-xs text-muted-foreground">
              Showing static demo data. Toggle to preview both states.
            </p>
          </div>
          <Tabs value={scenario} onValueChange={(v) => setScenario(v as typeof scenario)}>
            <TabsList>
              <TabsTrigger value="success" className="gap-1.5 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Succeeded + Approval
              </TabsTrigger>
              <TabsTrigger value="failed" className="gap-1.5 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                Failed run
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* ── Run header ───────────────────────────────────────────────────── */}
        <RunHeader run={run} onRetry={handleRetry} isMock />

        {/* ── Summary cards ────────────────────────────────────────────────── */}
        <RunSummaryCards run={run} />

        {/* ── Timeline ─────────────────────────────────────────────────────── */}
        <RunTimeline steps={run.steps} />

        {/* ── Run output ───────────────────────────────────────────────────── */}
        {run.outputJson ? (
          <Card>
            <CardHeader>
              <CardTitle>Run output</CardTitle>
            </CardHeader>
            <CardContent>
              <JsonViewer
                label="Output JSON"
                value={run.outputJson}
                defaultOpen
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Run output</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span>No output available — run ended before completion.</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Approval details ─────────────────────────────────────────────── */}
        {run.approvals.length > 0 && (
          <ApprovalDetailsCard approvals={run.approvals} />
        )}

        {/* ── Audit trail ──────────────────────────────────────────────────── */}
        <AuditTrailTable entries={run.auditTrail} />

        {/* ── Dev note ─────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Developer note
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            This page uses static mock data from{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">apps/web/mocks/agent-run.mock.ts</code>.
            To connect to the real API, fetch from{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">GET /api/agent-runs/:id</code>{" "}
            (see{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
              apps/web/app/(app)/agent-runs/[id]/page.tsx
            </code>
            {" "}for the live implementation). The{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">MockRun</code> type mirrors the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">AgentRun</code> API shape.
          </p>
        </div>

      </div>
    </div>
  );
}
