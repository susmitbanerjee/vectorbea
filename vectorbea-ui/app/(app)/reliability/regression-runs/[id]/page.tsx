"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft, ExternalLink, Loader2, Shield } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkflowRegressionRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function MetricCard({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "success" | "danger" | "warning" }) {
  const toneClass = tone === "success" ? "text-[#065F46]" : tone === "danger" ? "text-[#991B1B]" : tone === "warning" ? "text-[#92400E]" : "text-[#111111]";
  return (
    <Card className="border-[#E7DED1] bg-white">
      <CardContent className="pt-4">
        <p className="text-xs font-medium text-[#6B7280]">{label}</p>
        <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function WorkflowRegressionRunPage() {
  const { id } = useParams<{ id: string }>();
  const { activeWorkspaceId } = useWorkspace();
  const [run, setRun] = useState<WorkflowRegressionRunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !id) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/reliability/regression-runs/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load regression run");
        if (!cancelled) {
          setRun(json as WorkflowRegressionRunView);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load regression run");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (run?.status === "queued" || run?.status === "running") void load();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspaceId, id, run?.status]);

  const summary = useMemo(() => run?.summary ?? {}, [run]);

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading regression run…</div>;
  if (error || !run) return <div className="px-4 py-8"><div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error ?? "Regression run not found"}</div></div>;

  const safetyDecision = run.safetyGate?.decision ?? "needs_review";
  const safetyTone = safetyDecision === "safe_to_rollout" ? "success" : safetyDecision === "blocked" ? "danger" : "warning";

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Workflow Regression Run" subtitle={`${run.capability?.name ?? "Capability"} · ${run.suite?.name ?? "Regression suite"}`} />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <Link href={`/reliability/capabilities/${run.capabilityId}/regression-suites`} className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" />Back to regression suites
        </Link>

        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{run.status.replaceAll("_", " ")}</Badge>
                  <Badge className={safetyDecision === "safe_to_rollout" ? "bg-[#ECFDF5] text-[#065F46]" : safetyDecision === "blocked" ? "bg-[#FEF2F2] text-[#991B1B]" : "bg-[#FFFBEB] text-[#92400E]"}>
                    {safetyDecision.replaceAll("_", " ")}
                  </Badge>
                  {run.capabilityVersion && <Badge className="bg-[#F3F4F6] text-[#374151]">v{run.capabilityVersion.versionNumber}</Badge>}
                </div>
                <p className="text-sm text-[#6B7280]">Started {fmtDate(run.startedAt || run.createdAt)} · Completed {fmtDate(run.completedAt)}</p>
              </div>
              <div className="text-sm text-[#6B7280]">
                <div>Trigger {run.triggerSource.replaceAll("_", " ")}</div>
                <div>Started by {run.startedBy.slice(0, 8)}…</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Skill correctness score" value={run.skillCorrectnessScore?.score ?? run.overallScore ?? "—"} tone={safetyTone} />
          <MetricCard label="Passed cases" value={run.passedCasesCount} tone="success" />
          <MetricCard label="Failed cases" value={run.failedCasesCount} tone={run.failedCasesCount > 0 ? "danger" : "neutral"} />
          <MetricCard label="Critical failures" value={run.criticalFailuresCount} tone={run.criticalFailuresCount > 0 ? "danger" : "neutral"} />
          <MetricCard label="Workflow success rate" value={run.skillCorrectnessScore ? `${run.skillCorrectnessScore.workflowSuccessRate}%` : "—"} />
          <MetricCard label="Outcome success rate" value={run.skillCorrectnessScore ? `${run.skillCorrectnessScore.outcomeSuccessRate}%` : "—"} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Case results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                      <th className="py-2 text-left font-semibold">Case</th>
                      <th className="py-2 text-left font-semibold">Status</th>
                      <th className="py-2 text-right font-semibold">Score</th>
                      <th className="py-2 text-left font-semibold">Outcome</th>
                      <th className="py-2 text-left font-semibold">Trace</th>
                      <th className="py-2 text-left font-semibold">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.cases.map((item) => {
                      const diffId = String(item.toolSequenceResult?.trajectory_diff_id ?? "");
                      return (
                        <tr key={item.id} className="border-b border-[#F1ECE3] last:border-0 align-top">
                          <td className="py-2.5">
                            <div className="font-medium text-[#111111]">{item.regressionCase?.name ?? item.regressionCaseId}</div>
                            <div className="mt-1 text-xs text-[#6B7280]">{item.failureReasons[0] ?? "All deterministic checks passed"}</div>
                          </td>
                          <td className="py-2.5">
                            <Badge className={item.passed ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-[#991B1B]"}>{item.passed ? "passed" : "failed"}</Badge>
                          </td>
                          <td className="py-2.5 text-right font-medium text-[#111111]">{item.score ?? "—"}</td>
                          <td className="py-2.5 text-xs text-[#374151]">{String(item.outcomeResult?.expectedOutcome ?? item.regressionCase?.expectedOutcome ?? "—")}</td>
                          <td className="py-2.5 text-xs">
                            {item.workflowTraceId ? (
                              <Link href={`/reliability/capabilities/${run.capabilityId}`} className="inline-flex items-center gap-1 text-[#2563EB] hover:text-[#1D4ED8]">
                                View trace context <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : "—"}
                          </td>
                          <td className="py-2.5 text-xs">
                            {diffId ? (
                              <Link href={`/reliability/trajectory-diff/${diffId}`} className="inline-flex items-center gap-1 text-[#2563EB] hover:text-[#1D4ED8]">
                                Diff <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#111111]">Safety gate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className={`rounded-2xl border p-4 ${safetyDecision === "safe_to_rollout" ? "border-[#A7F3D0] bg-[#ECFDF5]" : safetyDecision === "blocked" ? "border-[#FECACA] bg-[#FEF2F2]" : "border-[#FDE68A] bg-[#FFFBEB]"}`}>
                  <div className="flex items-center gap-2">
                    {safetyDecision === "safe_to_rollout" ? <CheckCircle2 className="h-4 w-4 text-[#065F46]" /> : safetyDecision === "blocked" ? <AlertTriangle className="h-4 w-4 text-[#991B1B]" /> : <Shield className="h-4 w-4 text-[#92400E]" />}
                    <p className="font-semibold text-[#111111]">{safetyDecision.replaceAll("_", " ")}</p>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-[#374151]">
                    {(run.safetyGate?.reasons ?? []).map((reason, index) => <p key={index}>{reason}</p>)}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#111111]">Skill correctness breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {run.skillCorrectnessScore ? (
                  <>
                    <div className="flex justify-between"><span className="text-[#6B7280]">Workflow success rate</span><span className="font-medium text-[#111111]">{run.skillCorrectnessScore.workflowSuccessRate}%</span></div>
                    <div className="flex justify-between"><span className="text-[#6B7280]">Tool path compliance</span><span className="font-medium text-[#111111]">{run.skillCorrectnessScore.toolPathCompliance}%</span></div>
                    <div className="flex justify-between"><span className="text-[#6B7280]">Outcome success rate</span><span className="font-medium text-[#111111]">{run.skillCorrectnessScore.outcomeSuccessRate}%</span></div>
                    <div className="flex justify-between"><span className="text-[#6B7280]">Argument validity</span><span className="font-medium text-[#111111]">{run.skillCorrectnessScore.argumentValidity}%</span></div>
                    <div className="flex justify-between"><span className="text-[#6B7280]">Cost compliance</span><span className="font-medium text-[#111111]">{run.skillCorrectnessScore.costCompliance}%</span></div>
                    <div className="flex justify-between"><span className="text-[#6B7280]">Latency compliance</span><span className="font-medium text-[#111111]">{run.skillCorrectnessScore.latencyCompliance}%</span></div>
                    <div className="flex justify-between"><span className="text-[#6B7280]">Safety compliance</span><span className="font-medium text-[#111111]">{run.skillCorrectnessScore.safetyCompliance}%</span></div>
                  </>
                ) : (
                  <p className="text-[#6B7280]">Score will appear after the run finishes.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#111111]">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-[#374151]">
                <p>Capability {run.capability?.name ?? "—"}</p>
                <p>Version {run.capabilityVersion ? `v${run.capabilityVersion.versionNumber}` : "—"}</p>
                <p>Suite {run.suite?.name ?? "—"}</p>
                <p>{String(summary.error ?? "Deterministic workflow regression completed without LLM judgement")}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
