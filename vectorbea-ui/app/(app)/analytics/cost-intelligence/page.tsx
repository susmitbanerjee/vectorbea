"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign, Loader2, Shield } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoiDashboardData } from "@/lib/api";
import { canUseRoiDashboard } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

function fmtMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

function LockedState() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Cost Intelligence" subtitle="Workflow cost control and failure waste" />
      <div className="mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-14 text-center">
        <div className="rounded-full bg-[#EFF6FF] p-5"><CircleDollarSign className="h-10 w-10 text-[#2563EB]" /></div>
        <div>
          <h2 className="mb-3 text-2xl font-bold text-[#111111]">Cost Intelligence is available on Pro</h2>
          <p className="text-sm leading-relaxed text-[#6B7280]">
            Track cost per workflow, failed run waste, provider ROI, and automation savings from one executive-ready workspace view.
          </p>
        </div>
        <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}

export default function CostIntelligencePage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [data, setData] = useState<RoiDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const totalAgentCost = useMemo(() => {
    if (!data) return null;
    return data.metrics.averageCostPerRun * data.metrics.totalRuns;
  }, [data]);

  useEffect(() => {
    if (!activeWorkspaceId || !canUseRoiDashboard(planTier)) return;
    let cancelled = false;
    fetch(`/api/reliability/roi?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load cost intelligence");
        setData(json as RoiDashboardData);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, planTier]);

  if (!canUseRoiDashboard(planTier)) return <LockedState />;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Cost Intelligence" subtitle="Workflow cost, failed run waste, and ROI signals" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading cost intelligence…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}

        {data && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Total agent cost</p><p className="mt-2 text-2xl font-semibold text-[#111111]">{fmtMoney(totalAgentCost)}</p></CardContent></Card>
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Cost per successful workflow</p><p className="mt-2 text-2xl font-semibold text-[#065F46]">{fmtMoney(data.metrics.costPerSuccessfulWorkflow)}</p></CardContent></Card>
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Cost per failed workflow</p><p className="mt-2 text-2xl font-semibold text-[#991B1B]">{fmtMoney(data.metrics.costPerFailedWorkflow)}</p></CardContent></Card>
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Average latency</p><p className="mt-2 text-2xl font-semibold text-[#111111]">{data.metrics.averageLatencyMs ?? 0}ms</p></CardContent></Card>
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Human handoff rate</p><p className="mt-2 text-2xl font-semibold text-[#92400E]">{data.metrics.humanHandoffRate}%</p></CardContent></Card>
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Estimated net savings</p><p className={`mt-2 text-2xl font-semibold ${data.metrics.netSavings >= 0 ? "text-[#065F46]" : "text-[#991B1B]"}`}>{fmtMoney(data.metrics.netSavings)}</p></CardContent></Card>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Top cost leaks</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.topCostLeaks.length ? data.topCostLeaks.slice(0, 5).map((item) => (
                    <div key={`${item.outcomeReason}-${item.capabilityId ?? "none"}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[#111111]">{item.outcomeReason.replaceAll("_", " ")}</p>
                          <p className="text-xs text-[#6B7280]">{item.capabilityName ?? "Unassigned capability"} · {item.runs} runs</p>
                        </div>
                        <p className="font-semibold text-[#991B1B]">{fmtMoney(item.totalCost)}</p>
                      </div>
                      <p className="mt-2 text-sm text-[#374151]">{item.recommendedFix}</p>
                    </div>
                  )) : <p className="text-sm text-[#6B7280]">No cost leaks detected yet. Start sending workflow traces with cost and outcome metadata.</p>}
                </CardContent>
              </Card>

              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Most expensive capabilities</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.topCapabilities.length ? data.topCapabilities.slice(0, 5).map((item) => (
                    <div key={item.capabilityId ?? item.capabilityName ?? "cap"} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[#111111]">{item.capabilityName ?? "Unassigned capability"}</p>
                          <p className="text-xs text-[#6B7280]">{item.runs} runs · {item.successRate}% success</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-[#111111]">{fmtMoney(item.totalCost)}</p>
                          <p className="text-xs text-[#991B1B]">Failure cost {fmtMoney(item.failureCost)}</p>
                        </div>
                      </div>
                    </div>
                  )) : <p className="text-sm text-[#6B7280]">No capability cost data yet.</p>}
                </CardContent>
              </Card>
            </div>

            <div className="rounded-2xl border border-[#E7DED1] bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#111111]">
                <Shield className="h-4 w-4 text-[#2563EB]" />
                Cost intelligence depends on workflow trace cost and outcome data
              </div>
              <p className="mt-2 text-sm text-[#6B7280]">
                If this workspace looks empty, start sending workflow traces with provider, model, token, latency, and outcome metadata.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/settings/sdk" className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF]">View SDK setup</Link>
                <a href="/docs/sdk-and-ingestion" target="_blank" rel="noopener noreferrer" className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">Read ingestion docs</a>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
