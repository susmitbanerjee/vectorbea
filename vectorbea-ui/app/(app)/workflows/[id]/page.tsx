"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { WorkflowMapView } from "@/components/workflows/workflow-map-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiscoveredWorkflow } from "@/lib/api";
import { buildWorkflowMap } from "@/lib/workflow-graphs";
import { useWorkspace } from "@/lib/workspace-context";

export default function WorkflowDetailPage() {
  const { activeWorkspaceId } = useWorkspace();
  const params = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<DiscoveredWorkflow | null>(null);
  const workflowId = typeof params?.id === "string" ? params.id : "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workflowMap = workflow ? buildWorkflowMap(workflow) : null;

  useEffect(() => {
    if (!activeWorkspaceId || !workflowId) return;
    let cancelled = false;
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load workflow");
        setWorkflow(json as DiscoveredWorkflow);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, workflowId]);

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Workflow Map" subtitle="Review the discovered workflow blueprint before confirming capabilities, tools, and rules" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading ? <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading workflow graph…</div> : null}
        {error ? <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div> : null}

        {workflow ? (
          <>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                <CardTitle className="text-sm text-[#111111]">{workflow.name}</CardTitle>
                    <p className="mt-1 text-xs text-[#6B7280]">{workflow.capabilityName ?? "Discovered workflow"} · shape {workflow.workflowShapeHash.slice(0, 12)}…</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-[#F8F5EF] text-[#6B7280]">{workflow.sourceBadge}</Badge>
                    <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{workflow.status}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {workflow.traceId ? (
                  <Link href={`/traces/${workflow.traceId}/graph`} className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF]">
                    Open execution graph
                  </Link>
                ) : null}
                <Link href="/onboarding/workflow-discovery" className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                  Review in discovery wizard
                </Link>
              </CardContent>
            </Card>

            <WorkflowMapView
              nodes={workflowMap?.nodes ?? []}
              edges={workflowMap?.edges ?? []}
              sourceBadge={workflow.sourceBadge}
              discoveredBanner="This workflow map was discovered from production traces and shows the recurring structural path."
            />

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-[#111111]"><Sparkles className="h-4 w-4 text-[#2563EB]" />Suggested deterministic rules</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {workflow.suggestedRules.map((rule) => (
                  <div key={rule.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                    <p className="font-medium text-[#111111]">{rule.summary}</p>
                    <p className="mt-2 text-sm text-[#6B7280]">{rule.whySuggested}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{rule.ruleType.replaceAll("_", " ")}</Badge>
                      <Badge className="bg-[#FFF7ED] text-[#C2410C]">{rule.severitySuggestion}</Badge>
                    </div>
                  </div>
                ))}
                {workflow.suggestedRules.length === 0 ? (
                  <p className="text-sm text-[#6B7280]">No suggested rules generated from this workflow yet.</p>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
