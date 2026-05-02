"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { ExecutionGraphView } from "@/components/workflows/execution-graph-view";
import { Card, CardContent } from "@/components/ui/card";
import type { DiscoveredWorkflow, WorkflowTrace } from "@/lib/api";
import { buildExecutionGraph, compareExecutionToWorkflowMap } from "@/lib/workflow-graphs";
import { useWorkspace } from "@/lib/workspace-context";

export default function TraceGraphPage() {
  const { activeWorkspaceId } = useWorkspace();
  const params = useParams<{ id: string }>();
  const traceId = typeof params?.id === "string" ? params.id : "";
  const [trace, setTrace] = useState<WorkflowTrace | null>(null);
  const [workflow, setWorkflow] = useState<DiscoveredWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const executionGraph = trace ? buildExecutionGraph(trace) : null;
  const comparisonMessages = trace ? compareExecutionToWorkflowMap(trace, workflow) : [];

  useEffect(() => {
    if (!activeWorkspaceId || !traceId) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/reliability/traces/${encodeURIComponent(traceId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
        .then((res) => res.json().then((json) => ({ ok: res.ok, json }))),
      fetch(`/api/workflows/by-trace/${encodeURIComponent(traceId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
        .then((res) => res.json().then((json) => ({ ok: res.ok, json }))),
    ])
      .then(([traceResponse, workflowResponse]) => {
        if (cancelled) return;
        if (!traceResponse.ok) throw new Error(traceResponse.json.error ?? "Failed to load trace");
        setTrace(traceResponse.json as WorkflowTrace);

        if (!workflowResponse.ok) {
          if (workflowResponse.json.error === "Workflow not found") {
            setWorkflow(null);
            return;
          }
          throw new Error(workflowResponse.json.error ?? "Failed to load trace workflow");
        }
        setWorkflow(workflowResponse.json as DiscoveredWorkflow);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, traceId]);

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Execution Graph" subtitle="Inspect one actual run of this workflow, including step-level latency, cost, and outcomes" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading ? <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading execution graph…</div> : null}
        {error ? <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div> : null}
        {!loading && !trace ? (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-12 text-center">
              <p className="text-sm font-semibold text-[#111111]">No execution steps found for this trace.</p>
              <p className="mt-2 text-sm text-[#6B7280]">Check SDK, sidecar, or OpenTelemetry instrumentation to make sure workflow steps are being captured.</p>
            </CardContent>
          </Card>
        ) : null}

        {trace ? (
          <>
            <div className="flex flex-wrap gap-3">
              {workflow ? (
                <Link href={`/workflows/${workflow.id}`} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                  Compare with workflow map
                </Link>
              ) : null}
              <Link href="/onboarding/workflow-discovery" className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF]">
                Review in discovery wizard
              </Link>
            </div>
            <ExecutionGraphView
              nodes={executionGraph?.nodes ?? []}
              edges={executionGraph?.edges ?? []}
              sourceBadge={String(trace.metadata?.ingestSource ?? workflow?.sourceBadge ?? "direct_api")}
              comparisonMessages={comparisonMessages}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
