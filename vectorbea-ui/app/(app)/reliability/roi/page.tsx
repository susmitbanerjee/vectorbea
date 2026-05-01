"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, DollarSign, Loader2, Shield, TrendingDown, TrendingUp } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoiDashboardData, RoiReport } from "@/lib/api";
import { canUseAdvancedRoiReports, canUseRoiDashboard } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

function fmtMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

function MetricCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const toneClass = tone === "success" ? "text-[#065F46]" : tone === "warning" ? "text-[#92400E]" : tone === "danger" ? "text-[#991B1B]" : "text-[#111111]";
  return (
    <Card className="border-[#E7DED1] bg-white">
      <CardContent className="pt-4">
        <p className="text-xs font-medium text-[#6B7280]">{label}</p>
        <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function LockedBanner() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Agent ROI" subtitle="Cost control and automation value" />
      <div className="mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-14 text-center">
        <div className="rounded-full bg-[#EFF6FF] p-5"><DollarSign className="h-10 w-10 text-[#2563EB]" /></div>
        <div>
          <h2 className="mb-3 text-2xl font-bold text-[#111111]">ROI analytics are available on Pro</h2>
          <p className="text-sm leading-relaxed text-[#6B7280]">
            Measure automation success, cost per workflow, handoff waste, provider ROI, and workflow savings with executive-ready reporting.
          </p>
        </div>
        <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}

export default function RoiDashboardPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [data, setData] = useState<(RoiDashboardData & { reports?: RoiReport[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);
  const [settings, setSettings] = useState({ minutes: "15", cost: "20", currency: "USD" });

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reliability/roi?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load ROI dashboard");
      const next = json as RoiDashboardData & { reports?: RoiReport[] };
      setData(next);
      setSettings({
        minutes: String(next.assumptions.averageManualResolutionMinutes),
        cost: String(next.assumptions.averageAgentOperatorHourlyCost),
        currency: next.assumptions.currency,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ROI dashboard");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => { void load(); }, [load]);

  const metrics = data?.metrics;
  const topProvider = useMemo(() => data?.providerComparison[0] ?? null, [data]);

  async function saveAssumptions() {
    if (!activeWorkspaceId) return;
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/reliability/roi?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          averageManualResolutionMinutes: Number(settings.minutes),
          averageAgentOperatorHourlyCost: Number(settings.cost),
          currency: settings.currency,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update assumptions");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update ROI assumptions");
    } finally {
      setSavingSettings(false);
    }
  }

  async function generateReport() {
    if (!activeWorkspaceId) return;
    setCreatingReport(true);
    try {
      const res = await fetch(`/api/reliability/roi/reports?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to generate report");
      window.location.assign(`/reliability/roi/reports/${(json as RoiReport).id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create ROI report");
    } finally {
      setCreatingReport(false);
    }
  }

  if (!canUseRoiDashboard(planTier)) return <LockedBanner />;
  if (loading) return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading ROI analytics…</div>;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Agent ROI" subtitle="Cost control, automation success, and workflow value" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Total agent runs" value={String(metrics?.totalRuns ?? 0)} />
          <MetricCard label="Automation success rate" value={`${metrics?.automationSuccessRate ?? 0}%`} tone="success" />
          <MetricCard label="Cost per successful workflow" value={fmtMoney(metrics?.costPerSuccessfulWorkflow)} tone="neutral" />
          <MetricCard label="Human handoff rate" value={`${metrics?.humanHandoffRate ?? 0}%`} tone="warning" />
          <MetricCard label="Estimated net savings" value={fmtMoney(metrics?.netSavings)} tone={(metrics?.netSavings ?? 0) >= 0 ? "success" : "danger"} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Executive summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                  <p className="text-xs font-medium text-[#6B7280]">Average cost per run</p>
                  <p className="mt-2 text-xl font-semibold text-[#111111]">{fmtMoney(metrics?.averageCostPerRun)}</p>
                </div>
                <div className="rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                  <p className="text-xs font-medium text-[#6B7280]">Cost per failed workflow</p>
                  <p className="mt-2 text-xl font-semibold text-[#991B1B]">{fmtMoney(metrics?.costPerFailedWorkflow)}</p>
                </div>
                <div className="rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                  <p className="text-xs font-medium text-[#6B7280]">Estimated manual hours saved</p>
                  <p className="mt-2 text-xl font-semibold text-[#111111]">{metrics?.manualHoursSaved ?? 0}h</p>
                </div>
                <div className="rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                  <p className="text-xs font-medium text-[#6B7280]">Estimated labor savings</p>
                  <p className="mt-2 text-xl font-semibold text-[#065F46]">{fmtMoney(metrics?.estimatedLaborSavings)}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-[#6B7280]">Provider ROI leader</p>
                    <p className="mt-1 text-base font-semibold text-[#111111]">
                      {topProvider ? `${topProvider.provider} ${topProvider.model}` : "No provider data yet"}
                    </p>
                  </div>
                  {topProvider && (
                    <Badge className="bg-[#ECFDF5] text-[#065F46]">
                      {topProvider.successRate}% success
                    </Badge>
                  )}
                </div>
                {topProvider && (
                  <p className="mt-3 text-sm text-[#374151]">
                    {topProvider.recommendation ?? `${topProvider.provider} is currently the best ROI candidate under observed workflow reliability.`}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#111111]">ROI assumptions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <input className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]" value={settings.minutes} onChange={(e) => setSettings((prev) => ({ ...prev, minutes: e.target.value }))} placeholder="Manual resolution minutes" />
                <input className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]" value={settings.cost} onChange={(e) => setSettings((prev) => ({ ...prev, cost: e.target.value }))} placeholder="Operator hourly cost" />
                <input className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]" value={settings.currency} onChange={(e) => setSettings((prev) => ({ ...prev, currency: e.target.value }))} placeholder="Currency" />
                {canUseAdvancedRoiReports(planTier) ? (
                  <button type="button" disabled={savingSettings} onClick={() => void saveAssumptions()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-50">
                    {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}Save assumptions
                  </button>
                ) : (
                  <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-3 text-xs text-[#6B7280]">
                    Custom ROI assumptions are available on Enterprise
                  </div>
                )}
                <p className="text-xs text-[#6B7280]">Estimate based on workspace ROI assumptions, not a financial guarantee.</p>
              </CardContent>
            </Card>

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#111111]">Reports</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <button type="button" disabled={!canUseAdvancedRoiReports(planTier) || creatingReport} onClick={() => void generateReport()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
                  {creatingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}Generate ROI report
                </button>
                {!canUseAdvancedRoiReports(planTier) && <p className="text-xs text-[#6B7280]">Shareable ROI reports are available on Enterprise</p>}
                <div className="space-y-2">
                  {(data?.reports ?? []).slice(0, 5).map((report) => (
                    <Link key={report.id} href={`/reliability/roi/reports/${report.id}`} className="block rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 hover:bg-[#F1ECE3]">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-[#111111]">ROI report</span>
                        <span className="text-xs text-[#6B7280]">{new Date(report.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Top cost leaks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data?.topCostLeaks.length ? data.topCostLeaks.map((item) => (
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
              )) : <p className="text-sm text-[#6B7280]">No workflow cost leaks detected yet.</p>}
            </CardContent>
          </Card>

          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Provider ROI comparison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data?.providerComparison ?? []).slice(0, 6).map((item) => (
                <div key={`${item.provider}-${item.model}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-[#111111]">{item.provider} · {item.model}</p>
                      <p className="text-xs text-[#6B7280]">{item.runs} runs · {fmtMoney(item.averageWorkflowCost)} avg cost</p>
                    </div>
                    <Badge className={item.successRate >= 70 ? "bg-[#ECFDF5] text-[#065F46]" : item.successRate >= 50 ? "bg-[#FFFBEB] text-[#92400E]" : "bg-[#FEF2F2] text-[#991B1B]"}>
                      {item.successRate}% success
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#374151]">
                    <span>Handoffs {item.humanHandoffRate}%</span>
                    <span>Failures {item.failureRate}%</span>
                    <span>Cost per success {fmtMoney(item.costPerSuccessfulWorkflow)}</span>
                  </div>
                  {item.recommendation && <p className="mt-2 text-sm text-[#374151]">{item.recommendation}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Optimization recommendations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data?.recommendations ?? []).length ? data!.recommendations.map((item) => (
                <div key={item.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-[#111111]">{item.summary}</p>
                    <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{Math.round((item.confidence ?? 0) * 100)}%</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-[#6B7280]">
                    {item.capabilityName && <span>{item.capabilityName}</span>}
                    {item.estimatedSavings != null && <span>Estimated savings {fmtMoney(item.estimatedSavings)}</span>}
                  </div>
                </div>
              )) : <p className="text-sm text-[#6B7280]">No recommendations yet. More workflow volume will improve ROI suggestions.</p>}
            </CardContent>
          </Card>

          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Top expensive capabilities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data?.topCapabilities ?? []).map((item) => (
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
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
