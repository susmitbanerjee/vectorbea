"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, GitCompare, Loader2, Play, Plus, Wand2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AiCapability,
  CapabilityVersion,
  RegressionCase,
  RegressionSuite,
  RegressionSuiteType,
  ReliabilityRiskLevel,
  WorkflowRegressionRun,
  WorkflowTrace,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const SUITE_LABELS: Record<RegressionSuiteType, string> = {
  deterministic_workflow: "Deterministic workflow",
  tool_trajectory: "Tool trajectory",
  business_outcome: "Business outcome",
  mixed: "Mixed",
};

const RISK_STYLE: Record<ReliabilityRiskLevel, string> = {
  low: "bg-[#ECFDF5] text-[#065F46]",
  medium: "bg-[#FFFBEB] text-[#92400E]",
  high: "bg-[#FFF7ED] text-[#C2410C]",
  critical: "bg-[#FEF2F2] text-[#991B1B]",
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function RegressionSuitesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capability, setCapability] = useState<AiCapability | null>(null);
  const [versions, setVersions] = useState<CapabilityVersion[]>([]);
  const [suites, setSuites] = useState<RegressionSuite[]>([]);
  const [traces, setTraces] = useState<WorkflowTrace[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>("");
  const [cases, setCases] = useState<RegressionCase[]>([]);
  const [runs, setRuns] = useState<WorkflowRegressionRun[]>([]);
  const [templates, setTemplates] = useState<Record<string, unknown>>({});
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState("");
  const [creatingSuite, setCreatingSuite] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [running, setRunning] = useState(false);

  const [suiteForm, setSuiteForm] = useState({
    name: "",
    description: "",
    suiteType: "mixed" as RegressionSuiteType,
  });
  const [caseForm, setCaseForm] = useState({
    name: "",
    description: "",
    inputPayload: "",
    expectedToolSequence: "",
    requiredTools: "",
    forbiddenTools: "",
    expectedOutcome: "",
    expectedFinalAction: "",
    tags: "",
    riskLevel: "medium" as ReliabilityRiskLevel,
  });

  const loadBase = useCallback(async () => {
    if (!activeWorkspaceId || !id) return;
    setLoading(true);
    setError(null);
    try {
      const [capRes, versionRes, suiteRes, traceRes, templateRes] = await Promise.all([
        fetch(`/api/reliability/capabilities/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        fetch(`/api/reliability/capabilities/${encodeURIComponent(id)}/versions?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        fetch(`/api/reliability/capabilities/${encodeURIComponent(id)}/regression-suites?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        fetch(`/api/reliability/traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}&capabilityId=${encodeURIComponent(id)}&limit=50`, { cache: "no-store" }),
        fetch(`/api/reliability/templates?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
      ]);
      const [capJson, versionJson, suiteJson, traceJson, templateJson] = await Promise.all([
        capRes.json(), versionRes.json(), suiteRes.json(), traceRes.json(), templateRes.json(),
      ]);
      if (!capRes.ok) throw new Error(capJson.error ?? "Failed to load capability");
      setCapability(capJson as AiCapability);
      setVersions(Array.isArray(versionJson) ? versionJson as CapabilityVersion[] : []);
      const nextSuites = Array.isArray(suiteJson) ? suiteJson as RegressionSuite[] : [];
      setSuites(nextSuites);
      setTraces(Array.isArray(traceJson) ? traceJson as WorkflowTrace[] : []);
      setTemplates((templateJson && typeof templateJson === "object") ? templateJson as Record<string, unknown> : {});
      setSelectedSuiteId((current) => current || nextSuites[0]?.id || "");
      setSelectedVersionId((current) => current || (Array.isArray(versionJson) ? (versionJson as CapabilityVersion[])[0]?.id ?? "" : ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load regression suites");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, id]);

  const loadSuiteDetail = useCallback(async (suiteId: string) => {
    if (!activeWorkspaceId || !suiteId) {
      setCases([]);
      setRuns([]);
      return;
    }
    const [caseRes, runRes] = await Promise.all([
      fetch(`/api/reliability/regression-suites/${encodeURIComponent(suiteId)}/cases?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
      fetch(`/api/reliability/regression-runs?workspaceId=${encodeURIComponent(activeWorkspaceId)}&suiteId=${encodeURIComponent(suiteId)}`, { cache: "no-store" }),
    ]);
    const [caseJson, runJson] = await Promise.all([caseRes.json(), runRes.json()]);
    setCases(Array.isArray(caseJson) ? caseJson as RegressionCase[] : []);
    setRuns(Array.isArray(runJson) ? runJson as WorkflowRegressionRun[] : []);
  }, [activeWorkspaceId]);

  useEffect(() => { void loadBase(); }, [loadBase]);
  useEffect(() => { void loadSuiteDetail(selectedSuiteId); }, [selectedSuiteId, loadSuiteDetail]);

  const activeVersion = useMemo(
    () => versions.find((version) => version.status === "active") ?? versions[0] ?? null,
    [versions],
  );

  async function handleCreateSuite() {
    if (!activeWorkspaceId || !suiteForm.name.trim()) return;
    setCreatingSuite(true);
    try {
      const res = await fetch(`/api/reliability/capabilities/${encodeURIComponent(id)}/regression-suites?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suiteForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create suite");
      setSuiteForm({ name: "", description: "", suiteType: "mixed" });
      await loadBase();
      setSelectedSuiteId((json as RegressionSuite).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create suite");
    } finally {
      setCreatingSuite(false);
    }
  }

  async function handleCreateCase() {
    if (!activeWorkspaceId || !selectedSuiteId || !caseForm.name.trim()) return;
    setCreatingCase(true);
    try {
      const inputPayload = caseForm.inputPayload.trim() ? JSON.parse(caseForm.inputPayload) as Record<string, unknown> : {};
      const res = await fetch(`/api/reliability/regression-suites/${encodeURIComponent(selectedSuiteId)}/cases?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...caseForm,
          inputPayload,
          expectedToolSequence: caseForm.expectedToolSequence.split(",").map((item) => item.trim()).filter(Boolean),
          requiredTools: caseForm.requiredTools.split(",").map((item) => item.trim()).filter(Boolean),
          forbiddenTools: caseForm.forbiddenTools.split(",").map((item) => item.trim()).filter(Boolean),
          tags: caseForm.tags.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create case");
      setCaseForm({
        name: "",
        description: "",
        inputPayload: "",
        expectedToolSequence: "",
        requiredTools: "",
        forbiddenTools: "",
        expectedOutcome: "",
        expectedFinalAction: "",
        tags: "",
        riskLevel: "medium",
      });
      await loadSuiteDetail(selectedSuiteId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create case");
    } finally {
      setCreatingCase(false);
    }
  }

  async function handleImportTrace() {
    if (!activeWorkspaceId || !selectedSuiteId || !selectedTraceId) return;
    try {
      const res = await fetch(`/api/reliability/regression-suites/${encodeURIComponent(selectedSuiteId)}/import-trace?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceId: selectedTraceId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to import trace");
      await loadSuiteDetail(selectedSuiteId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import trace");
    }
  }

  async function handleRunSuite() {
    if (!activeWorkspaceId || !selectedSuiteId || !selectedVersionId) return;
    setRunning(true);
    try {
      const res = await fetch(`/api/reliability/regression-suites/${encodeURIComponent(selectedSuiteId)}/run?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityVersionId: selectedVersionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to start regression run");
      router.push(`/reliability/regression-runs/${(json as WorkflowRegressionRun).id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start regression run");
    } finally {
      setRunning(false);
    }
  }

  function applyTemplate(key: string) {
    const template = templates[key] as { name?: string; suiteType?: RegressionSuiteType; cases?: Array<Record<string, unknown>> } | undefined;
    if (!template) return;
    setSuiteForm({
      name: template.name ?? suiteForm.name,
      description: `Starter suite from ${key.replaceAll("_", " ")}`,
      suiteType: template.suiteType ?? "mixed",
    });
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading regression suites…</div>;
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Workflow Regression Suites" subtitle={capability ? `${capability.name} · deterministic workflow validation` : "Deterministic workflow validation"} />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <Link href={`/reliability/capabilities/${id}`} className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" />Back to capability
        </Link>

        {error && (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
            {error}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[320px,minmax(0,1fr)]">
          <div className="space-y-5">
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#111111]">Create suite</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <input className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]" placeholder="Retail refund workflow" value={suiteForm.name} onChange={(e) => setSuiteForm((prev) => ({ ...prev, name: e.target.value }))} />
                <textarea className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] resize-none" rows={3} placeholder="Deterministic suite for safe tool order and business outcomes" value={suiteForm.description} onChange={(e) => setSuiteForm((prev) => ({ ...prev, description: e.target.value }))} />
                <Select value={suiteForm.suiteType} onChange={(e) => setSuiteForm((prev) => ({ ...prev, suiteType: e.target.value as RegressionSuiteType }))}>
                  {Object.entries(SUITE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[#6B7280]">Sector templates</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(templates).map((key) => (
                      <button key={key} type="button" onClick={() => applyTemplate(key)} className="rounded-full border border-[#E7DED1] bg-[#FBFAF7] px-2.5 py-1 text-[11px] text-[#374151] hover:bg-[#F1ECE3]">
                        {key.replaceAll("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" disabled={!suiteForm.name.trim() || creatingSuite} onClick={() => void handleCreateSuite()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
                  {creatingSuite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create suite
                </button>
              </CardContent>
            </Card>

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#111111]">Suites</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {suites.length === 0 && <p className="text-sm text-[#6B7280]">No regression suites yet</p>}
                {suites.map((suite) => (
                  <button
                    key={suite.id}
                    type="button"
                    onClick={() => setSelectedSuiteId(suite.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${selectedSuiteId === suite.id ? "border-[#2563EB] bg-[#EFF6FF]" : "border-[#E7DED1] bg-[#FBFAF7] hover:bg-[#F1ECE3]"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[#111111]">{suite.name}</span>
                      <Badge className="bg-[#F3F4F6] text-[#374151]">{SUITE_LABELS[suite.suiteType]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-[#6B7280]">{suite.caseCount ?? 0} cases · {suite.enabled ? "enabled" : "disabled"}</p>
                    {suite.latestRun && <p className="mt-1 text-xs text-[#6B7280]">Latest run {suite.latestRun.status} · {fmtDate(suite.latestRun.createdAt)}</p>}
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#111111]">Run suite</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr),minmax(0,1fr),auto]">
                <Select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}>
                  <option value="">Select capability version</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.versionNumber} · {version.name ?? version.status}
                    </option>
                  ))}
                </Select>
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#374151]">
                  {activeVersion ? `Active version v${activeVersion.versionNumber}` : "No active version yet"}
                </div>
                <button type="button" disabled={!selectedSuiteId || !selectedVersionId || running} onClick={() => void handleRunSuite()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run suite
                </button>
              </CardContent>
            </Card>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-[#111111]">Regression cases</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!selectedSuiteId && <p className="text-sm text-[#6B7280]">Select a suite to manage cases</p>}
                  {selectedSuiteId && (
                    <>
                      <div className="rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4 space-y-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <input className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Case name" value={caseForm.name} onChange={(e) => setCaseForm((prev) => ({ ...prev, name: e.target.value }))} />
                          <Select value={caseForm.riskLevel} onChange={(e) => setCaseForm((prev) => ({ ...prev, riskLevel: e.target.value as ReliabilityRiskLevel }))}>
                            {(["low", "medium", "high", "critical"] as ReliabilityRiskLevel[]).map((risk) => <option key={risk} value={risk}>{risk}</option>)}
                          </Select>
                        </div>
                        <textarea className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] resize-none" rows={2} placeholder="Case description" value={caseForm.description} onChange={(e) => setCaseForm((prev) => ({ ...prev, description: e.target.value }))} />
                        <textarea className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 font-mono text-xs text-[#111111] resize-none" rows={3} placeholder='Input payload JSON, for example {"user_input":"Refund my order"}' value={caseForm.inputPayload} onChange={(e) => setCaseForm((prev) => ({ ...prev, inputPayload: e.target.value }))} />
                        <div className="grid gap-3 md:grid-cols-2">
                          <input className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Expected tool sequence, comma separated" value={caseForm.expectedToolSequence} onChange={(e) => setCaseForm((prev) => ({ ...prev, expectedToolSequence: e.target.value }))} />
                          <input className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Required tools, comma separated" value={caseForm.requiredTools} onChange={(e) => setCaseForm((prev) => ({ ...prev, requiredTools: e.target.value }))} />
                          <input className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Forbidden tools, comma separated" value={caseForm.forbiddenTools} onChange={(e) => setCaseForm((prev) => ({ ...prev, forbiddenTools: e.target.value }))} />
                          <input className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Expected outcome" value={caseForm.expectedOutcome} onChange={(e) => setCaseForm((prev) => ({ ...prev, expectedOutcome: e.target.value }))} />
                          <input className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Expected final action" value={caseForm.expectedFinalAction} onChange={(e) => setCaseForm((prev) => ({ ...prev, expectedFinalAction: e.target.value }))} />
                          <input className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Tags, comma separated" value={caseForm.tags} onChange={(e) => setCaseForm((prev) => ({ ...prev, tags: e.target.value }))} />
                        </div>
                        <button type="button" disabled={!caseForm.name.trim() || creatingCase} onClick={() => void handleCreateCase()} className="inline-flex items-center gap-2 rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-50">
                          {creatingCase ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add case
                        </button>
                      </div>

                      <div className="space-y-2">
                        {cases.length === 0 && <p className="text-sm text-[#6B7280]">No regression cases yet</p>}
                        {cases.map((item) => (
                          <div key={item.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="font-medium text-[#111111]">{item.name}</p>
                                <p className="text-xs text-[#6B7280]">{item.expectedToolSequence.join(" → ") || "No explicit tool sequence"}</p>
                              </div>
                              <Badge className={RISK_STYLE[item.riskLevel]}>{item.riskLevel}</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#6B7280]">
                              {item.requiredTools.length > 0 && <span>Required: {item.requiredTools.join(", ")}</span>}
                              {item.forbiddenTools.length > 0 && <span>Forbidden: {item.forbiddenTools.join(", ")}</span>}
                              {item.expectedOutcome && <span>Outcome: {item.expectedOutcome}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-5">
                <Card className="border-[#E7DED1] bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-[#111111]">Import from production trace</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Select value={selectedTraceId} onChange={(e) => setSelectedTraceId(e.target.value)}>
                      <option value="">Select workflow trace</option>
                      {traces.map((trace) => (
                        <option key={trace.id} value={trace.id}>
                          {trace.userInput?.slice(0, 60) || trace.id} · {fmtDate(trace.createdAt)}
                        </option>
                      ))}
                    </Select>
                    <button type="button" disabled={!selectedSuiteId || !selectedTraceId} onClick={() => void handleImportTrace()} className="inline-flex items-center gap-2 rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-50">
                      <Wand2 className="h-4 w-4" />Add from production trace
                    </button>
                    <p className="text-xs text-[#6B7280]">If the trace includes tool steps, VectorBea prefills the expected sequence and argument checks.</p>
                  </CardContent>
                </Card>

                <Card className="border-[#E7DED1] bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-[#111111]">Run history</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {runs.length === 0 && <p className="text-sm text-[#6B7280]">No runs yet</p>}
                    {runs.map((run) => (
                      <Link key={run.id} href={`/reliability/regression-runs/${run.id}`} className="block rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3 hover:bg-[#F1ECE3]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-[#111111]">{run.status.replaceAll("_", " ")}</span>
                          <span className="text-xs text-[#6B7280]">{fmtDate(run.createdAt)}</span>
                        </div>
                        <p className="mt-1 text-xs text-[#6B7280]">Score {run.overallScore ?? "—"} · Passed {run.passedCasesCount} · Failed {run.failedCasesCount}</p>
                      </Link>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-[#E7DED1] bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-[#111111]">What this protects</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-[#6B7280]">
                    <div className="flex items-start gap-2"><GitCompare className="mt-0.5 h-4 w-4 text-[#2563EB]" /><span>Detects skipped required tools, forbidden actions, and changed trajectories across versions</span></div>
                    <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-[#B45309]" /><span>Blocks risky rollouts when a critical workflow case regresses or misses the expected business outcome</span></div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
