"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoiDashboardData } from "@/lib/api";
import { canUseRoiDashboard } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

function fmtMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

export default function FailureCostsPage() {
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
        if (!ok) throw new Error(json.error ?? "Failed to load failure cost attribution");
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
        <AppHeader title="Failure Cost Attribution" subtitle="Wasted spend from failed workflows and handoffs" />
        <div className="mx-auto max-w-xl px-4 py-14 text-center">
          <h2 className="text-2xl font-bold text-[#111111]">Failure Cost Attribution is available on Pro</h2>
          <p className="mt-3 text-sm text-[#6B7280]">Understand which workflow failures waste money and which fixes will recover the most value.</p>
          <Link href="/settings/billing" className="mt-6 inline-flex rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">Upgrade to Pro</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Failure Cost Attribution" subtitle="Top failure reasons by wasted workflow cost" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading failure cost attribution…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}
        {data && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Top cost leaks</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.topCostLeaks.length ? data.topCostLeaks.map((item) => (
                <div key={`${item.outcomeReason}-${item.capabilityId ?? "none"}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full bg-[#FEF2F2] p-2"><AlertTriangle className="h-4 w-4 text-[#991B1B]" /></div>
                      <div>
                        <p className="font-medium text-[#111111]">{item.outcomeReason.replaceAll("_", " ")}</p>
                        <p className="text-xs text-[#6B7280]">{item.capabilityName ?? "Unassigned capability"} · {item.runs} affected runs</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-[#991B1B]">{fmtMoney(item.totalCost)}</p>
                      <p className="text-xs text-[#6B7280]">Avg {fmtMoney(item.averageCostPerFailedRun)}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-[#374151]">{item.recommendedFix}</p>
                </div>
              )) : (
                <div className="rounded-xl border border-dashed border-[#D8CFC2] bg-[#FBFAF7] px-5 py-8 text-center">
                  <p className="text-sm font-medium text-[#374151]">No failure cost data yet</p>
                  <p className="mt-1 text-xs text-[#6B7280]">Once failed workflows accumulate, VectorBea will group them by wasted spend and recommended fix.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
