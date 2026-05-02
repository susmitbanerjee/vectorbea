"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BotMessageSquare, GitBranch, Loader2, Sparkles } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiscoveredWorkflow, DiscoverySession } from "@/lib/api";
import { canUseWorkflowReliability } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

type WorkflowListItem = DiscoveredWorkflow & {
  session: DiscoverySession;
};

export default function WorkflowsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [items, setItems] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !canUseWorkflowReliability(planTier)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/workflows?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load workflows");
        setItems(Array.isArray(json.items) ? json.items as WorkflowListItem[] : []);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, planTier]);

  if (!canUseWorkflowReliability(planTier)) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="Workflows" subtitle="Auto-discovered workflow space" />
        <div className="mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-16 text-center">
          <div className="rounded-full bg-[#EFF6FF] p-5"><Sparkles className="h-10 w-10 text-[#2563EB]" /></div>
          <div>
            <h2 className="text-2xl font-bold text-[#111111]">Workflow discovery is available on Pro</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#6B7280]">
              Install the SDK, run one real workflow, and let VectorBea discover capabilities, tools, MCP calls, graph shape, and suggested rules automatically.
            </p>
          </div>
          <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
            Upgrade to Pro
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Workflows" subtitle="Auto-discovered workflow maps and execution-ready trace review" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <div className="flex flex-wrap gap-3">
          <Link href="/onboarding/workflow-discovery" className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
            Open discovery wizard
          </Link>
          <Link href="/settings/sdk" className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF]">
            View SDK setup
          </Link>
        </div>

        {loading ? <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading workflow space…</div> : null}
        {error ? <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div> : null}

        {!loading && !error && items.length === 0 ? (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-14 text-center">
              <BotMessageSquare className="mx-auto h-10 w-10 text-[#D8CFC2]" />
              <p className="mt-4 text-sm font-semibold text-[#111111]">No workflow traces discovered yet</p>
              <p className="mt-2 text-sm text-[#6B7280]">
                Send one real agent workflow through SDK, sidecar, OpenTelemetry, proxy, or the direct trace API to start building the workflow space automatically.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-2">
          {items.map((workflow) => (
            <Card key={workflow.id} className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm text-[#111111]">{workflow.name}</CardTitle>
                    <p className="mt-1 text-xs text-[#6B7280]">
                      {workflow.capabilityName ?? "Unassigned capability"} · {workflow.graphNodes.length} nodes
                    </p>
                  </div>
                  <Badge className="bg-[#F8F5EF] text-[#6B7280]">{workflow.sourceBadge}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{workflow.status}</Badge>
                  <Badge className="bg-[#ECFDF5] text-[#166534]">{workflow.latencyMs != null ? `${workflow.latencyMs} ms` : "No latency"}</Badge>
                  <Badge className="bg-[#FFF7ED] text-[#C2410C]">{workflow.costEstimate != null ? `$${workflow.costEstimate.toFixed(4)}` : "No cost"}</Badge>
                </div>
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#8A7F72]">
                    <GitBranch className="h-3.5 w-3.5" />
                    Suggested rules
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-[#374151]">
                    {workflow.suggestedRules.slice(0, 3).map((rule) => (
                      <li key={rule.id}>• {rule.summary}</li>
                    ))}
                    {workflow.suggestedRules.length === 0 ? <li>No rule suggestions yet.</li> : null}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href={`/workflows/${workflow.id}`} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                    Open workflow map
                  </Link>
                  {workflow.traceId ? (
                    <Link href={`/traces/${workflow.traceId}/graph`} className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF]">
                      Open execution graph
                    </Link>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
