"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GitCompare, Loader2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoiDashboardData } from "@/lib/api";
import { canUseRoiDashboard } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

function fmtMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

export default function ProviderComparisonPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [data, setData] = useState<RoiDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !canUseRoiDashboard(planTier)) return;
    let cancelled = false;
    fetch(`/api/reliability/roi?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load provider comparison");
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

  if (!canUseRoiDashboard(planTier)) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="Provider Cost Comparison" subtitle="Cost and workflow ROI by provider and model" />
        <div className="mx-auto max-w-xl px-4 py-14 text-center">
          <h2 className="text-2xl font-bold text-[#111111]">Provider Cost Comparison is available on Pro</h2>
          <p className="mt-3 text-sm text-[#6B7280]">Compare workflow cost, cost per success, latency, failure rate, and ROI signals across providers.</p>
          <Link href="/settings/billing" className="mt-6 inline-flex rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">Upgrade to Pro</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Provider Cost Comparison" subtitle="Cost, success, latency, and workflow ROI by provider" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading provider ROI comparison…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}
        {data && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Provider ROI comparison</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.providerComparison.length ? data.providerComparison.map((item) => (
                <div key={`${item.provider}-${item.model}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full bg-[#EFF6FF] p-2"><GitCompare className="h-4 w-4 text-[#1D4ED8]" /></div>
                      <div>
                        <p className="font-medium text-[#111111]">{item.provider} · {item.model}</p>
                        <p className="text-xs text-[#6B7280]">{item.runs} runs · avg cost {fmtMoney(item.averageWorkflowCost)} · p95 latency {item.p95LatencyMs ?? 0}ms</p>
                      </div>
                    </div>
                    <Badge className={item.successRate >= 70 ? "bg-[#ECFDF5] text-[#065F46]" : item.successRate >= 50 ? "bg-[#FFFBEB] text-[#92400E]" : "bg-[#FEF2F2] text-[#991B1B]"}>
                      {item.successRate}% success
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-4 text-sm">
                    <div><p className="text-xs text-[#6B7280]">Cost per success</p><p className="mt-1 font-semibold text-[#111111]">{fmtMoney(item.costPerSuccessfulWorkflow)}</p></div>
                    <div><p className="text-xs text-[#6B7280]">Failure rate</p><p className="mt-1 font-semibold text-[#991B1B]">{item.failureRate}%</p></div>
                    <div><p className="text-xs text-[#6B7280]">Human handoff</p><p className="mt-1 font-semibold text-[#92400E]">{item.humanHandoffRate}%</p></div>
                    <div><p className="text-xs text-[#6B7280]">Estimated net savings</p><p className="mt-1 font-semibold text-[#065F46]">{fmtMoney(item.estimatedNetSavings)}</p></div>
                  </div>
                  {item.recommendation && <p className="mt-3 text-sm text-[#374151]">{item.recommendation}</p>}
                </div>
              )) : (
                <div className="rounded-xl border border-dashed border-[#D8CFC2] bg-[#FBFAF7] px-5 py-8 text-center">
                  <p className="text-sm font-medium text-[#374151]">No provider comparison data yet</p>
                  <p className="mt-1 text-xs text-[#6B7280]">Once this workspace has workflow traces across providers, VectorBea will compare cost and reliability tradeoffs here.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
