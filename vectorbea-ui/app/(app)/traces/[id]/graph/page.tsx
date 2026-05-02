"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { WorkflowGraphView } from "@/components/workflows/workflow-graph-view";
import { Card, CardContent } from "@/components/ui/card";
import type { DiscoveredWorkflow } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export default function TraceGraphPage() {
  const { activeWorkspaceId } = useWorkspace();
  const params = useParams<{ id: string }>();
  const traceId = typeof params?.id === "string" ? params.id : "";
  const [workflow, setWorkflow] = useState<DiscoveredWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !traceId) return;
    let cancelled = false;
    fetch(`/api/workflows/by-trace/${encodeURIComponent(traceId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) {
          if (json.error === "Workflow not found") {
            setWorkflow(null);
            return;
          }
          throw new Error(json.error ?? "Failed to load trace workflow");
        }
        setWorkflow(json as DiscoveredWorkflow);
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
      <AppHeader title="Trace graph" subtitle="Graphical workflow view for this trace" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading ? <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading trace graph…</div> : null}
        {error ? <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div> : null}
        {!loading && !workflow ? (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-12 text-center">
              <p className="text-sm font-semibold text-[#111111]">No workflow graph is available for this trace yet.</p>
              <p className="mt-2 text-sm text-[#6B7280]">Send the trace through the workflow trace ingestion path with steps, or wait for discovery to process it.</p>
            </CardContent>
          </Card>
        ) : null}

        {workflow ? (
          <>
            <div className="flex flex-wrap gap-3">
              <Link href={`/workflows/${workflow.id}`} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                Open workflow space
              </Link>
              <Link href="/onboarding/workflow-discovery" className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF]">
                Review in discovery wizard
              </Link>
            </div>
            <WorkflowGraphView nodes={workflow.graphNodes} edges={workflow.graphEdges} sourceBadge={workflow.sourceBadge} />
          </>
        ) : null}
      </div>
    </div>
  );
}
