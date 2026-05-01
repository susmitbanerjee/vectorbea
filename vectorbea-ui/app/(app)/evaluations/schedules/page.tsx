"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight, Calendar, ChevronDown, ExternalLink, PlusCircle,
  Trash2, Loader2, Play, ToggleLeft, ToggleRight, Info, Clock,
  Pencil, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  RegressionSchedule,
  BaselineDataset,
  EvaluationDataset,
  PromptListItem,
  BehavioralDataset,
  EvaluationRubric,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { cronToHumanText, validateCron } from "@/lib/cron-humanizer";

type AnyDataset = {
  id: string;
  name: string;
  kind: "baseline" | "evaluation";
  itemCount?: number;
  datasetType?: string;
  promptId?: string | null;
};

const statusColors = {
  completed: "bg-[#ECFDF5] border-[#A7F3D0] text-[#064E3B]",
  failed: "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]",
  running: "bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]",
  warning: "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]",
};

function ScorePill({ label, value }: { label: string; value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const color =
    value >= 80 ? statusColors.completed :
    value >= 60 ? statusColors.warning :
    statusColors.failed;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      {label}: {value}%
    </span>
  );
}

export default function ScheduledRegressionsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [schedules, setSchedules] = useState<RegressionSchedule[]>([]);
  const [datasets, setDatasets] = useState<AnyDataset[]>([]);
  const [behavioralDatasets, setBehavioralDatasets] = useState<BehavioralDataset[]>([]);
  const [rubrics, setRubrics] = useState<EvaluationRubric[]>([]);
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    baselineDatasetId: "",
    candidatePromptVersionStrategy: "latest_published",
    candidatePromptVersionId: "",
    promptName: "",
    cronExpression: "",
  });
  const [form, setForm] = useState({
    name: "",
    baselineDatasetId: "",
    behavioralDatasetId: "",
    rubricId: "",
    candidatePromptVersionStrategy: "latest_published",
    candidatePromptVersionId: "",
    promptName: "",
    cronExpression: "",
  });

  const behavioralLocked = planTier === "free" || planTier === "plus";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeWorkspaceId) return;
      setLoading(true); setError(null);
      try {
        const [schedulesRes, baselineRes, evalRes, promptsRes, behavioralRes] = await Promise.all([
          fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/evaluations/baseline-datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/evaluations/datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/prompts?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/evaluations/behavioral?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        ]);
        const [schedulesJson, baselineJson, evalJson, promptsJson, behavioralJson] = await Promise.all([
          schedulesRes.json(), baselineRes.json(), evalRes.json(), promptsRes.json(), behavioralRes.json(),
        ]);
        if (!schedulesRes.ok) throw new Error(schedulesJson.error ?? "Failed to load schedules");
        if (!cancelled) {
          setSchedules(schedulesJson as RegressionSchedule[]);
          const baselineDs: AnyDataset[] = (Array.isArray(baselineJson) ? baselineJson as BaselineDataset[] : [])
            .map(d => ({ id: d.id, name: d.name, kind: "baseline" as const, itemCount: d.traceIds?.length }));
          const evalDs: AnyDataset[] = (Array.isArray(evalJson) ? evalJson as EvaluationDataset[] : [])
            .map(d => ({ id: d.id, name: d.name, kind: "evaluation" as const, itemCount: d.itemCount, datasetType: d.datasetType, promptId: d.promptId ?? null }));
          setDatasets([...evalDs, ...baselineDs]);
          setPrompts(Array.isArray(promptsJson) ? promptsJson as PromptListItem[] : []);
          setBehavioralDatasets(
            Array.isArray(behavioralJson)
              ? (behavioralJson as BehavioralDataset[]).filter(d => !d.isArchived)
              : []
          );
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  // Load rubrics when a behavioral dataset is selected in form
  useEffect(() => {
    if (!form.behavioralDatasetId || !activeWorkspaceId) { setRubrics([]); return; }
    void fetch(`/api/evaluations/rubrics?workspaceId=${encodeURIComponent(activeWorkspaceId)}&datasetId=${encodeURIComponent(form.behavioralDatasetId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => setRubrics(Array.isArray(data) ? data as EvaluationRubric[] : []));
  }, [form.behavioralDatasetId, activeWorkspaceId]);

  const createSchedule = async () => {
    if (!activeWorkspaceId || creating) return;
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!form.baselineDatasetId && !form.behavioralDatasetId) {
      setError("At least one dataset (baseline or behavioral) is required."); return;
    }
    if (form.behavioralDatasetId && !form.rubricId) { setError("Rubric is required when a behavioral dataset is selected."); return; }
    if (!form.promptName.trim()) { setError("Prompt is required."); return; }
    setCreating(true); setError(null);
    const selectedDs = datasets.find(d => d.id === form.baselineDatasetId);
    try {
      const res = await fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          ...(selectedDs?.kind === "evaluation"
            ? { datasetId: form.baselineDatasetId || undefined }
            : { baselineDatasetId: form.baselineDatasetId || undefined }),
          behavioralDatasetId: form.behavioralDatasetId || null,
          rubricId: form.rubricId || null,
          candidatePromptVersionStrategy: form.candidatePromptVersionStrategy,
          candidatePromptVersionId: form.candidatePromptVersionId.trim() || null,
          promptName: form.promptName.trim(),
          cronExpression: form.cronExpression.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      setSchedules(prev => [json as RegressionSchedule, ...prev]);
      setForm({ name: "", baselineDatasetId: "", behavioralDatasetId: "", rubricId: "", candidatePromptVersionStrategy: "latest_published", candidatePromptVersionId: "", promptName: "", cronExpression: "" });
      setShowForm(false);
      toast.success("Schedule created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create schedule");
    } finally {
      setCreating(false);
    }
  };

  const toggleSchedule = async (id: string, currentEnabled: boolean) => {
    if (!activeWorkspaceId || togglingId) return;
    setTogglingId(id);
    try {
      const res = await fetch(`/api/evaluations/regression-schedules/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to toggle");
      setSchedules(prev => prev.map(s => s.id === id ? json as RegressionSchedule : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle schedule");
    } finally {
      setTogglingId(null);
    }
  };

  const runSchedule = async (id: string) => {
    if (!activeWorkspaceId || runningId) return;
    setRunningId(id);
    try {
      const res = await fetch(`/api/evaluations/regression-schedules/${encodeURIComponent(id)}/run?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to run");
      const refreshRes = await fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json();
        setSchedules(refreshed as RegressionSchedule[]);
        const updated = (refreshed as RegressionSchedule[]).find(s => s.id === id);
        const rec = updated?.lastRunRecommendation;
        if (rec === "ready_for_rollout") {
          toast.success("Run completed — ready for rollout");
        } else if (rec === "regression_detected" || rec === "blocked") {
          toast.error(`Run completed — ${rec.replaceAll("_", " ")}`);
        } else if (updated?.lastRunLog?.status === "completed") {
          toast.success("Run completed. Check the log for details.");
        } else if (updated?.lastRunLog?.status === "failed") {
          toast.error(`Run failed: ${updated.lastRunLog.errorReason ?? "Unknown error"}`);
        } else {
          toast.success("Run triggered. Refreshing results...");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to run schedule");
      setError(e instanceof Error ? e.message : "Failed to run schedule");
    } finally {
      setRunningId(null);
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!activeWorkspaceId) return;
    try {
      await fetch(`/api/evaluations/regression-schedules/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { method: "DELETE" });
      setSchedules(prev => prev.filter(s => s.id !== id));
    } catch { /* silent */ }
  };

  const updateSchedule = async () => {
    if (!activeWorkspaceId || !editingId) return;
    try {
      const res = await fetch(`/api/evaluations/regression-schedules/${encodeURIComponent(editingId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim() || undefined,
          baselineDatasetId: editForm.baselineDatasetId || undefined,
          candidatePromptVersionStrategy: editForm.candidatePromptVersionStrategy || undefined,
          candidatePromptVersionId: editForm.candidatePromptVersionId.trim() || null,
          promptName: editForm.promptName.trim() || null,
          cronExpression: editForm.cronExpression.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      setSchedules(prev => prev.map(s => s.id === editingId ? json as RegressionSchedule : s));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update schedule");
    }
  };

  const getDataset = (id: string) => datasets.find(d => d.id === id);
  const getDatasetName = (id: string) => getDataset(id)?.name ?? id;

  function DatasetDropdown({ value, onChange, promptId }: { value: string; onChange: (v: string) => void; promptId?: string | null }) {
    const selected = getDataset(value);
    const compatible = promptId
      ? datasets.filter(d => !d.promptId || d.promptId === promptId)
      : datasets;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm font-medium text-[#111111] shadow-sm transition-colors hover:bg-[#F8F5EF]"
          >
            <span className="truncate text-left">
              {selected
                ? <span className="flex items-center gap-2">
                    {selected.name}
                    <span className="text-[10px] text-[#6B7280] font-normal">
                      {selected.kind === "evaluation" ? selected.datasetType ?? "dataset" : "baseline"} · {selected.itemCount ?? 0} items
                    </span>
                  </span>
                : <span className="text-[#6B7280]">Select a dataset…</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7280]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {compatible.length === 0 && (
              <div className="px-3 py-2 text-xs text-[#6B7280]">
                {promptId ? "No datasets scoped to this prompt." : "No datasets found."}
              </div>
            )}
            {compatible.map(d => (
              <DropdownMenuPanelRadioItem key={d.id} value={d.id}>
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 text-[10px] text-[#6B7280] tabular-nums">
                    {d.kind === "evaluation" ? d.datasetType ?? "eval" : "baseline"} · {d.itemCount ?? 0}
                  </span>
                </span>
              </DropdownMenuPanelRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuPanel>
      </DropdownMenu>
    );
  }

  function BehavioralDatasetDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const selected = behavioralDatasets.find(d => d.id === value);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm font-medium text-[#111111] shadow-sm transition-colors hover:bg-[#F8F5EF] disabled:opacity-50"
          >
            <span className="truncate text-left">
              {selected
                ? selected.name
                : <span className="text-[#6B7280]">Select behavioral dataset…</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7280]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            <DropdownMenuPanelRadioItem value="">
              <span className="text-[#6B7280]">None</span>
            </DropdownMenuPanelRadioItem>
            {behavioralDatasets.length === 0 && (
              <div className="px-3 py-2 text-xs text-[#6B7280]">No behavioral datasets found.</div>
            )}
            {behavioralDatasets.map(d => (
              <DropdownMenuPanelRadioItem key={d.id} value={d.id}>
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 text-[10px] text-[#6B7280] tabular-nums">{d.itemCount} items</span>
                </span>
              </DropdownMenuPanelRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuPanel>
      </DropdownMenu>
    );
  }

  function RubricDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const selected = rubrics.find(r => r.id === value);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm font-medium text-[#111111] shadow-sm transition-colors hover:bg-[#F8F5EF]"
          >
            <span className="truncate text-left">
              {selected ? selected.name : <span className="text-[#6B7280]">Select rubric…</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7280]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {rubrics.length === 0 && (
              <div className="px-3 py-2 text-xs text-[#6B7280]">No rubrics for this dataset.</div>
            )}
            {rubrics.map(r => (
              <DropdownMenuPanelRadioItem key={r.id} value={r.id}>
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{r.name}</span>
                  <span className="shrink-0 text-[10px] text-[#6B7280]">pass &ge;{r.passThreshold}%</span>
                </span>
              </DropdownMenuPanelRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuPanel>
      </DropdownMenu>
    );
  }

  function StrategyDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const labels: Record<string, string> = { latest_published: "Latest published", specific_version: "Specific version" };
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm font-medium text-[#111111] shadow-sm transition-colors hover:bg-[#F8F5EF]"
          >
            <span className="truncate text-left">{labels[value] ?? value}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7280]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            <DropdownMenuPanelRadioItem value="latest_published">Latest published</DropdownMenuPanelRadioItem>
            <DropdownMenuPanelRadioItem value="specific_version">Specific version</DropdownMenuPanelRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuPanel>
      </DropdownMenu>
    );
  }

  function PromptDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const selected = prompts.find(p => p.name === value);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm font-medium text-[#111111] shadow-sm transition-colors hover:bg-[#F8F5EF]"
          >
            <span className="truncate text-left">
              {selected ? selected.name : <span className="text-[#6B7280]">Select a prompt…</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7280]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {prompts.length === 0 && (
              <div className="px-3 py-2 text-xs text-[#6B7280]">No prompts found.</div>
            )}
            {prompts.map(p => (
              <DropdownMenuPanelRadioItem key={p.id} value={p.name}>
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  {p.isPublished && <span className="shrink-0 text-[10px] text-[#065F46] font-medium">published</span>}
                </span>
              </DropdownMenuPanelRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuPanel>
      </DropdownMenu>
    );
  }

  function RunLogDetail({ schedule }: { schedule: RegressionSchedule }) {
    const log = schedule.lastRunLog;
    if (!log) return null;
    const statusColor =
      log.status === "completed" ? statusColors.completed :
      log.status === "failed" ? statusColors.failed :
      statusColors.running;
    return (
      <details className="mt-3 rounded-xl border border-[#E7DED1] bg-white p-3">
        <summary className="cursor-pointer text-xs font-medium text-[#374151] flex items-center gap-2 flex-wrap">
          <span>Last run</span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusColor}`}>
            {log.status}
          </span>
          {schedule.lastRunRecommendation && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              schedule.lastRunRecommendation === "ready_for_rollout" ? statusColors.completed :
              schedule.lastRunRecommendation === "regression_detected" || schedule.lastRunRecommendation === "blocked" ? statusColors.failed :
              statusColors.warning
            }`}>
              {schedule.lastRunRecommendation.replaceAll("_", " ")}
            </span>
          )}
          {/* Score pills */}
          <ScorePill label="Combined" value={log.combinedScore} />
          <ScorePill label="Baseline" value={log.baselineScore} />
          <ScorePill label="Behavioral" value={log.behavioralScore} />
        </summary>
        <div className="mt-3 grid gap-2 text-xs text-[#6B7280] sm:grid-cols-2">
          {log.baselineDatasetName && (
            <span>Dataset: <span className="text-[#111111] font-medium">{log.baselineDatasetName}</span></span>
          )}
          {log.replayCount > 0 && (
            <span>Items run: <span className="text-[#111111] font-medium tabular-nums">{log.replayCount}</span></span>
          )}
          <span>Started: {new Date(log.startedAt).toLocaleString()}</span>
          <span>
            Completed:{" "}
            {log.completedAt
              ? new Date(log.completedAt).toLocaleString()
              : <span className="text-[#92400E] font-medium">Still running…</span>}
          </span>
          {log.failedCasesCount > 0 && (
            <span className={`sm:col-span-2 ${statusColors.failed} rounded px-1.5 py-0.5`}>
              {log.failedCasesCount} failed case(s)
              {log.hardFailuresCount > 0 && ` · ${log.hardFailuresCount} hard failure(s)`}
              {log.needsReviewCount > 0 && ` · ${log.needsReviewCount} need(s) review`}
            </span>
          )}
          {log.evaluationRunId && (
            <span className="sm:col-span-2">
              Evaluation run:{" "}
              <a
                href={`/evaluations/${encodeURIComponent(log.evaluationRunId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                className="inline-flex items-center gap-1 text-[#2563EB] underline hover:text-[#1D4ED8]"
              >
                {log.evaluationRunId.slice(0, 20)}…
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </span>
          )}
          {log.behavioralRunId && (
            <span className="sm:col-span-2">
              Behavioral run:{" "}
              <a
                href={`/evaluations/behavioral-runs/${encodeURIComponent(log.behavioralRunId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                className="inline-flex items-center gap-1 text-[#2563EB] underline hover:text-[#1D4ED8]"
              >
                {log.behavioralRunId.slice(0, 20)}…
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </span>
          )}
          {log.failedTraceIds.length > 0 && (
            <span className="sm:col-span-2 text-[#92400E]">{log.failedTraceIds.length} trace(s) failed execution.</span>
          )}
          {log.errorReason && (
            <span className="sm:col-span-2 text-[#991B1B]">Error: {log.errorReason}</span>
          )}
        </div>
      </details>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Scheduled Regressions" subtitle="Automatically run evaluation runs against baselines on a schedule." />
      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {/* CI callout */}
        <Card className="border-[#A7F3D0] bg-[#ECFDF5]">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-[#065F46]" />
            <p className="text-sm text-[#047857]">
              The built-in scheduler checks enabled schedules and runs them when{" "}
              <span className="font-mono text-xs bg-[#D1FAE5] px-1 rounded text-[#065F46]">next_run_at</span>{" "}
              is due. Use <span className="font-medium">Run now</span> for an immediate execution with the same persisted run logs.
              Supports baseline, evaluation, and behavioral datasets — or combine both in one schedule.
            </p>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-[#FECACA] bg-[#FEF2F2]">
            <CardContent className="p-4 text-sm text-[#991B1B]">{error}</CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-[#6B7280]">{schedules.length} schedule{schedules.length !== 1 ? "s" : ""}</p>
          <Button size="sm" onClick={() => setShowForm(v => !v)} className="gap-2">
            <PlusCircle className="h-4 w-4" />{showForm ? "Cancel" : "New schedule"}
          </Button>
        </div>

        {showForm && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader>
              <CardTitle className="text-[#111111]">New regression schedule</CardTitle>
              <CardDescription className="text-[#6B7280]">
                Define which datasets and prompt version strategy to use for scheduled evaluation runs. At least one dataset is required.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Name *</label>
                  <input
                    className="w-full rounded-lg border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Nightly regression"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Prompt *</label>
                  <PromptDropdown value={form.promptName} onChange={v => setForm(f => ({ ...f, promptName: v, baselineDatasetId: "" }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Baseline / Evaluation Dataset</label>
                  <DatasetDropdown
                    value={form.baselineDatasetId}
                    onChange={v => setForm(f => ({ ...f, baselineDatasetId: v }))}
                    promptId={prompts.find(p => p.name === form.promptName)?.id}
                  />
                </div>
                <div className="space-y-1">
                  {behavioralLocked ? (
                    <>
                      <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280] flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Behavioral Dataset
                      </label>
                      <div className="rounded-xl border border-[#E7DED1] bg-[#F8F5EF] px-3 py-2.5 text-xs text-[#6B7280] flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5 shrink-0 text-[#92400E]" />
                        Behavioral evaluations require a Pro or Enterprise plan.
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Behavioral Dataset</label>
                      <BehavioralDatasetDropdown
                        value={form.behavioralDatasetId}
                        onChange={v => setForm(f => ({ ...f, behavioralDatasetId: v, rubricId: "" }))}
                      />
                    </>
                  )}
                </div>
                {!behavioralLocked && form.behavioralDatasetId && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Rubric *</label>
                    <RubricDropdown value={form.rubricId} onChange={v => setForm(f => ({ ...f, rubricId: v }))} />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Candidate version strategy</label>
                  <StrategyDropdown value={form.candidatePromptVersionStrategy} onChange={v => setForm(f => ({ ...f, candidatePromptVersionStrategy: v }))} />
                </div>
                {form.candidatePromptVersionStrategy === "specific_version" && (
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Candidate prompt version ID</label>
                    <input
                      className="w-full rounded-lg border border-[#E7DED1] bg-white px-3 py-2 text-sm font-mono text-[#111111]"
                      value={form.candidatePromptVersionId}
                      onChange={e => setForm(f => ({ ...f, candidatePromptVersionId: e.target.value }))}
                      placeholder="version UUID"
                    />
                  </div>
                )}
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Cron expression</label>
                  <input
                    className={`w-full rounded-lg border bg-white px-3 py-2 text-sm font-mono text-[#111111] ${
                      form.cronExpression.trim() && validateCron(form.cronExpression)
                        ? "border-[#FECACA] focus:outline-none focus:ring-1 focus:ring-[#F87171]"
                        : "border-[#E7DED1]"
                    }`}
                    value={form.cronExpression}
                    onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))}
                    placeholder="e.g. 0 2 * * *"
                  />
                  {form.cronExpression.trim() && (() => {
                    const err = validateCron(form.cronExpression);
                    const preview = !err ? cronToHumanText(form.cronExpression) : null;
                    return err
                      ? <p className="text-xs text-[#991B1B] mt-1">{err}</p>
                      : <p className="flex items-center gap-1 text-xs text-[#047857] mt-1"><Clock className="h-3 w-3" />{preview}</p>;
                  })()}
                </div>
              </div>
              <Button onClick={() => void createSchedule()} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                Create schedule
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-[#6B7280]">
              <Loader2 className="h-4 w-4 animate-spin" />Loading schedules...
            </div>
          ) : schedules.length === 0 ? (
            <Card className="border-[#E7DED1] bg-white">
              <CardContent className="p-8 text-center text-sm text-[#6B7280]">
                No regression schedules yet. Create one to define an automated evaluation run.
              </CardContent>
            </Card>
          ) : (
            schedules.map(schedule => (
              <Card key={schedule.id} className="border-[#E7DED1] bg-white">
                {editingId === schedule.id && (
                  <div className="border-b border-[#E7DED1] bg-[#F8F5EF] px-4 py-3 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#6B7280]">Edit schedule</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Name</label>
                        <input className="w-full rounded-lg border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111]" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Dataset</label>
                        <DatasetDropdown
                          value={editForm.baselineDatasetId}
                          onChange={v => setEditForm(f => ({ ...f, baselineDatasetId: v }))}
                          promptId={prompts.find(p => p.name === editForm.promptName)?.id}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Strategy</label>
                        <StrategyDropdown value={editForm.candidatePromptVersionStrategy} onChange={v => setEditForm(f => ({ ...f, candidatePromptVersionStrategy: v }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Prompt</label>
                        <PromptDropdown value={editForm.promptName} onChange={v => setEditForm(f => ({ ...f, promptName: v }))} />
                      </div>
                      {editForm.candidatePromptVersionStrategy === "specific_version" && (
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Candidate prompt version ID</label>
                          <input className="w-full rounded-lg border border-[#E7DED1] bg-white px-3 py-2 text-sm font-mono text-[#111111]" value={editForm.candidatePromptVersionId} onChange={e => setEditForm(f => ({ ...f, candidatePromptVersionId: e.target.value }))} placeholder="version UUID" />
                        </div>
                      )}
                      <div className="space-y-1 sm:col-span-2">
                        <label className="text-xs font-medium uppercase tracking-widest text-[#6B7280]">Cron expression</label>
                        <input className="w-full rounded-lg border border-[#E7DED1] bg-white px-3 py-2 text-sm font-mono text-[#111111]" value={editForm.cronExpression} onChange={e => setEditForm(f => ({ ...f, cronExpression: e.target.value }))} placeholder="e.g. 0 2 * * *" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void updateSchedule()} className="gap-2">Save changes</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[#111111]">{schedule.name}</span>
                      <Badge variant={schedule.enabled ? "default" : "secondary"}>
                        {schedule.enabled ? "enabled" : "disabled"}
                      </Badge>
                      {schedule.promptName && <Badge variant="outline">{schedule.promptName}</Badge>}
                      <Badge variant="secondary">{schedule.candidatePromptVersionStrategy.replace("_", " ")}</Badge>
                      {schedule.behavioralDatasetId && (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusColors.running}`}>
                          behavioral
                        </span>
                      )}
                    </div>
                    {schedule.baselineDatasetId && (
                      <p className="mt-1 text-sm text-[#6B7280]">Baseline: {getDatasetName(schedule.baselineDatasetId)}</p>
                    )}
                    {schedule.behavioralDatasetName && (
                      <p className="mt-0.5 text-sm text-[#6B7280]">Behavioral: {schedule.behavioralDatasetName}{schedule.rubricName ? ` · ${schedule.rubricName}` : ""}</p>
                    )}
                    {schedule.cronExpression && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-[#6B7280]">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span title={schedule.cronExpression}>{cronToHumanText(schedule.cronExpression)}</span>
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[#6B7280]">
                      {schedule.lastRunAt && <span>Last run: {new Date(schedule.lastRunAt).toLocaleString()}</span>}
                      {schedule.nextRunAt && <span>Next run: {new Date(schedule.nextRunAt).toLocaleString()}</span>}
                      {schedule.lastRunRecommendation && <span>Recommendation: {schedule.lastRunRecommendation}</span>}
                    </div>

                    <RunLogDetail schedule={schedule} />

                    {schedule.runHistory.length > 1 ? (
                      <details className="mt-2 rounded-xl border border-[#E7DED1] bg-[#F8F5EF] p-3">
                        <summary className="cursor-pointer text-xs font-medium text-[#6B7280]">
                          Run history ({schedule.runHistory.length})
                        </summary>
                        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto vb-scrollbar">
                          {schedule.runHistory.slice(1).map((run) => (
                            <div key={run.runId} className="rounded-lg border border-[#E7DED1] bg-white p-2 text-xs text-[#6B7280]">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${run.status === "completed" ? statusColors.completed : statusColors.failed}`}>
                                  {run.status}
                                </span>
                                <span>{new Date(run.startedAt).toLocaleString()}</span>
                                {run.replayCount > 0 && <span>{run.replayCount} items</span>}
                                {run.combinedScore !== null && run.combinedScore !== undefined && (
                                  <ScorePill label="Score" value={run.combinedScore} />
                                )}
                                {run.evaluationRunId && (
                                  <a
                                    href={`/evaluations/${encodeURIComponent(run.evaluationRunId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                                    className="inline-flex items-center gap-0.5 text-[#2563EB] hover:underline"
                                  >
                                    View run <ArrowRight className="h-2.5 w-2.5" />
                                  </a>
                                )}
                              </div>
                              {run.errorReason && <p className="mt-1 text-[#991B1B]">{run.errorReason}</p>}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void runSchedule(schedule.id)}
                      disabled={runningId === schedule.id}
                      title="Run now"
                      className="rounded p-1.5 text-[#6B7280] hover:bg-[#EFF6FF] hover:text-[#2563EB] transition-colors disabled:opacity-50"
                    >
                      {runningId === schedule.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleSchedule(schedule.id, schedule.enabled)}
                      disabled={togglingId === schedule.id}
                      title={schedule.enabled ? "Disable" : "Enable"}
                      className="rounded p-1.5 text-[#6B7280] hover:bg-[#F8F5EF] hover:text-[#111111] transition-colors disabled:opacity-50"
                    >
                      {togglingId === schedule.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : schedule.enabled
                          ? <ToggleRight className="h-4 w-4 text-[#059669]" />
                          : <ToggleLeft className="h-4 w-4" />
                      }
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(schedule.id);
                        setEditForm({ name: schedule.name, baselineDatasetId: schedule.baselineDatasetId, candidatePromptVersionStrategy: schedule.candidatePromptVersionStrategy, candidatePromptVersionId: schedule.candidatePromptVersionId ?? "", promptName: schedule.promptName ?? "", cronExpression: schedule.cronExpression ?? "" });
                      }}
                      title="Edit"
                      className="rounded p-1.5 text-[#6B7280] hover:bg-[#F8F5EF] hover:text-[#111111] transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSchedule(schedule.id)}
                      title="Delete"
                      className="rounded p-1.5 text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#991B1B] transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
