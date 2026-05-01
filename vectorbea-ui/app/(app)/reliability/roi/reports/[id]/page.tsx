"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Download, Loader2, Share2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoiReport } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

function fmtMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

export default function RoiReportPage() {
  const { id } = useParams<{ id: string }>();
  const { activeWorkspaceId } = useWorkspace();
  const [report, setReport] = useState<RoiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !id) return;
    const workspaceId = activeWorkspaceId;
    async function load() {
      try {
        const res = await fetch(`/api/reliability/roi/reports/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load ROI report");
        setReport(json as RoiReport);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load ROI report");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [activeWorkspaceId, id]);

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading ROI report…</div>;
  if (error || !report) return <div className="px-4 py-8"><div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error ?? "ROI report not found"}</div></div>;

  const summary = report.summary;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="ROI Report" subtitle={`Generated ${new Date(report.createdAt).toLocaleString()}`} />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <Link href="/reliability/roi" className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" />Back to ROI dashboard
        </Link>

        <div className="flex flex-wrap gap-3">
          <button type="button" disabled className="inline-flex items-center gap-2 rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#6B7280]">
            <Download className="h-4 w-4" />Export PDF coming soon
          </button>
          <button type="button" disabled className="inline-flex items-center gap-2 rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#6B7280]">
            <Share2 className="h-4 w-4" />Share report coming soon
          </button>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Executive summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-[#374151]">
              <p>Total runs {summary.metrics.totalRuns}</p>
              <p>Automation success rate {summary.metrics.automationSuccessRate}%</p>
              <p>Cost per successful workflow {fmtMoney(summary.metrics.costPerSuccessfulWorkflow)}</p>
              <p>Human handoff rate {summary.metrics.humanHandoffRate}%</p>
              <p>Estimated labor savings {fmtMoney(summary.metrics.estimatedLaborSavings)}</p>
              <p>Estimated net savings {fmtMoney(summary.metrics.netSavings)}</p>
            </CardContent>
          </Card>

          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Optimization recommendations</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {summary.recommendations.map((item) => (
                <div key={item.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <p className="font-medium text-[#111111]">{item.summary}</p>
                  <p className="mt-1 text-xs text-[#6B7280]">Confidence {Math.round((item.confidence ?? 0) * 100)}% · Estimated savings {fmtMoney(item.estimatedSavings)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Top failure cost drivers</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {summary.topCostLeaks.map((item) => (
                <div key={`${item.outcomeReason}-${item.capabilityId ?? "none"}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-[#111111]">{item.outcomeReason.replaceAll("_", " ")}</p>
                    <p className="font-semibold text-[#991B1B]">{fmtMoney(item.totalCost)}</p>
                  </div>
                  <p className="mt-1 text-xs text-[#6B7280]">{item.recommendedFix}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Provider ROI</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {summary.providerComparison.slice(0, 5).map((item) => (
                <div key={`${item.provider}-${item.model}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <p className="font-medium text-[#111111]">{item.provider} {item.model}</p>
                  <p className="mt-1 text-xs text-[#6B7280]">{item.successRate}% success · {fmtMoney(item.averageWorkflowCost)} avg cost · {fmtMoney(item.costPerSuccessfulWorkflow)} per success</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
