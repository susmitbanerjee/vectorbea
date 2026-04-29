"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Calendar, ChevronDown, ExternalLink, PlusCircle, Trash2, Loader2, Play, ToggleLeft, ToggleRight, Info, Clock, Pencil } from "lucide-react";
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
import type { RegressionSchedule, BaselineDataset, EvaluationDataset, PromptListItem } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { cronToHumanText, validateCron } from "@/lib/cron-humanizer";

type AnyDataset = { id: string; name: string; kind: "baseline" | "evaluation"; itemCount?: number; datasetType?: string; promptId?: string | null };


export default function ScheduledRegressionsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [schedules, setSchedules] = useState<RegressionSchedule[]>([]);
  const [datasets, setDatasets] = useState<AnyDataset[]>([]);
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", baselineDatasetId: "", candidatePromptVersionStrategy: "latest_published", candidatePromptVersionId: "", promptName: "", cronExpression: "" });
  const [form, setForm] = useState({
    name: "",
    baselineDatasetId: "",
    candidatePromptVersionStrategy: "latest_published",
    candidatePromptVersionId: "",
    promptName: "",
    cronExpression: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeWorkspaceId) return;
      setLoading(true); setError(null);
      try {
        const [schedulesRes, baselineRes, evalRes, promptsRes] = await Promise.all([
          fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/evaluations/baseline-datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/evaluations/datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/prompts?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        ]);
        const [schedulesJson, baselineJson, evalJson, promptsJson] = await Promise.all([schedulesRes.json(), baselineRes.json(), evalRes.json(), promptsRes.json()]);
        if (!schedulesRes.ok) throw new Error(schedulesJson.error ?? "Failed to load schedules");
        if (!cancelled) {
          setSchedules(schedulesJson as RegressionSchedule[]);
          const baselineDs: AnyDataset[] = (Array.isArray(baselineJson) ? baselineJson as BaselineDataset[] : [])
            .map(d => ({ id: d.id, name: d.name, kind: "baseline" as const, itemCount: d.traceIds?.length }));
          const evalDs: AnyDataset[] = (Array.isArray(evalJson) ? evalJson as EvaluationDataset[] : [])
            .map(d => ({ id: d.id, name: d.name, kind: "evaluation" as const, itemCount: d.itemCount, datasetType: d.datasetType, promptId: d.promptId ?? null }));
          setDatasets([...evalDs, ...baselineDs]);
          setPrompts(Array.isArray(promptsJson) ? promptsJson as PromptListItem[] : []);
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

  const createSchedule = async () => {
    if (!activeWorkspaceId || creating) return;
    if (!form.name.trim() || !form.baselineDatasetId) { setError("Name and dataset are required."); return; }
    if (!form.promptName.trim()) { setError("Prompt is required."); return; }
    setCreating(true); setError(null);
    const selectedDs = datasets.find(d => d.id === form.baselineDatasetId);
    try {
      const res = await fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          // Send to correct field based on dataset kind
          ...(selectedDs?.kind === "evaluation"
            ? { datasetId: form.baselineDatasetId }
            : { baselineDatasetId: form.baselineDatasetId }),
          candidatePromptVersionStrategy: form.candidatePromptVersionStrategy,
          candidatePromptVersionId: form.candidatePromptVersionId.trim() || null,
          promptName: form.promptName.trim(),
          cronExpression: form.cronExpression.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      setSchedules(prev => [json as RegressionSchedule, ...prev]);
      setForm({ name: "", baselineDatasetId: "", candidatePromptVersionStrategy: "latest_published", candidatePromptVersionId: "", promptName: "", cronExpression: "" });
      setShowForm(false);
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
      // Refresh schedule to get updated lastRunAt and run logs
      const refreshRes = await fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json();
        setSchedules(refreshed as RegressionSchedule[]);
        // Show meaningful feedback
        const updated = (refreshed as RegressionSchedule[]).find(s => s.id === id);
        const rec = updated?.lastRunRecommendation;
        if (rec === "ready_for_rollout") {
          toast.success("Run completed — ready for rollout ✓");
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
    // Filter: show datasets that are either unscoped or scoped to the selected prompt
    const compatible = promptId
      ? datasets.filter(d => !d.promptId || d.promptId === promptId)
      : datasets;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40"
          >
            <span className="truncate text-left">
              {selected
                ? <span className="flex items-center gap-2">
                    {selected.name}
                    <span className="text-[10px] text-muted-foreground font-normal">
                      {selected.kind === "evaluation" ? selected.datasetType ?? "dataset" : "baseline"} · {selected.itemCount ?? 0} items
                    </span>
                  </span>
                : <span className="text-muted-foreground">Select a dataset…</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {compatible.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {promptId ? "No datasets scoped to this prompt." : "No datasets found."}
              </div>
            )}
            {compatible.map(d => (
              <DropdownMenuPanelRadioItem key={d.id} value={d.id}>
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
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

  function StrategyDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const labels: Record<string, string> = { latest_published: "Latest published", specific_version: "Specific version" };
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40"
          >
            <span className="truncate text-left">{labels[value] ?? value}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
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
            className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40"
          >
            <span className="truncate text-left">
              {selected ? selected.name : <span className="text-muted-foreground">Select a prompt…</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {prompts.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">No prompts found.</div>
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

  return (
    <div className="min-h-screen">
      <AppHeader title="Scheduled Regressions" subtitle="Automatically run evaluation runs against baselines on a schedule." />
      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {/* CI callout */}
        <Card className="border-[#6EE7B7]/50 bg-[#ECFDF5]">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-[#065F46]" />
            <p className="text-sm text-[#047857]">
              The built-in scheduler checks enabled schedules and runs them when <span className="font-mono text-xs bg-[#D1FAE5] px-1 rounded text-[#065F46]">next_run_at</span> is due. Use <span className="font-medium">Run now</span> for an immediate execution with the same persisted run logs.
            </p>
          </CardContent>
        </Card>

        {error && <Card className="border-red-500/30 bg-red-500/10"><CardContent className="p-4 text-sm text-red-100">{error}</CardContent></Card>}

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? "s" : ""}</p>
          <Button size="sm" onClick={() => setShowForm(v => !v)} className="gap-2">
            <PlusCircle className="h-4 w-4" />{showForm ? "Cancel" : "New schedule"}
          </Button>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>New regression schedule</CardTitle>
              <CardDescription>Define which baseline dataset and prompt version strategy to use for scheduled evaluation runs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Name *</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Nightly regression" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Prompt *</label>
                  <PromptDropdown value={form.promptName} onChange={v => setForm(f => ({ ...f, promptName: v, baselineDatasetId: "" }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Dataset *</label>
                  <DatasetDropdown
                    value={form.baselineDatasetId}
                    onChange={v => setForm(f => ({ ...f, baselineDatasetId: v }))}
                    promptId={prompts.find(p => p.name === form.promptName)?.id}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Candidate version strategy</label>
                  <StrategyDropdown value={form.candidatePromptVersionStrategy} onChange={v => setForm(f => ({ ...f, candidatePromptVersionStrategy: v }))} />
                </div>
                {form.candidatePromptVersionStrategy === "specific_version" && (
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Candidate prompt version ID</label>
                    <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={form.candidatePromptVersionId} onChange={e => setForm(f => ({ ...f, candidatePromptVersionId: e.target.value }))} placeholder="version UUID" />
                  </div>
                )}
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Cron expression</label>
                  <input
                    className={`w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono ${
                      form.cronExpression.trim() && validateCron(form.cronExpression)
                        ? "border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                        : "border-border"
                    }`}
                    value={form.cronExpression}
                    onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))}
                    placeholder="e.g. 0 2 * * *"
                  />
                  {form.cronExpression.trim() && (() => {
                    const err = validateCron(form.cronExpression);
                    const preview = !err ? cronToHumanText(form.cronExpression) : null;
                    return err
                      ? <p className="text-xs text-red-400 mt-1">{err}</p>
                      : <p className="flex items-center gap-1 text-xs text-[#047857] mt-1"><Clock className="h-3 w-3" />{preview}</p>;
                  })()}
                </div>
              </div>
              <Button onClick={createSchedule} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                Create schedule
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading schedules...</div>
          ) : schedules.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No regression schedules yet. Create one to define an automated evaluation run.</CardContent></Card>
          ) : (
            schedules.map(schedule => (
              <Card key={schedule.id}>
                {editingId === schedule.id && (
                  <div className="border-b border-border bg-muted/20 px-4 py-3 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Edit schedule</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Name</label>
                        <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Dataset</label>
                        <DatasetDropdown
                          value={editForm.baselineDatasetId}
                          onChange={v => setEditForm(f => ({ ...f, baselineDatasetId: v }))}
                          promptId={prompts.find(p => p.name === editForm.promptName)?.id}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Strategy</label>
                        <StrategyDropdown value={editForm.candidatePromptVersionStrategy} onChange={v => setEditForm(f => ({ ...f, candidatePromptVersionStrategy: v }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Prompt</label>
                        <PromptDropdown value={editForm.promptName} onChange={v => setEditForm(f => ({ ...f, promptName: v }))} />
                      </div>
                      {editForm.candidatePromptVersionStrategy === "specific_version" && (
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Candidate prompt version ID</label>
                          <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={editForm.candidatePromptVersionId} onChange={e => setEditForm(f => ({ ...f, candidatePromptVersionId: e.target.value }))} placeholder="version UUID" />
                        </div>
                      )}
                      <div className="space-y-1 sm:col-span-2">
                        <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Cron expression</label>
                        <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={editForm.cronExpression} onChange={e => setEditForm(f => ({ ...f, cronExpression: e.target.value }))} placeholder="e.g. 0 2 * * *" />
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
                      <span className="font-medium">{schedule.name}</span>
                      <Badge variant={schedule.enabled ? "default" : "secondary"}>
                        {schedule.enabled ? "enabled" : "disabled"}
                      </Badge>
                      {schedule.promptName && <Badge variant="outline">{schedule.promptName}</Badge>}
                      <Badge variant="secondary">{schedule.candidatePromptVersionStrategy.replace("_", " ")}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">Dataset: {getDatasetName(schedule.baselineDatasetId)}</p>
                    {schedule.cronExpression && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span title={schedule.cronExpression}>{cronToHumanText(schedule.cronExpression)}</span>
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      {schedule.lastRunAt && <span>Last run: {new Date(schedule.lastRunAt).toLocaleString()}</span>}
                      {schedule.nextRunAt && <span>Next run: {new Date(schedule.nextRunAt).toLocaleString()}</span>}
                      {schedule.lastRunRecommendation && <span>Recommendation: {schedule.lastRunRecommendation}</span>}
                    </div>
                    {schedule.lastRunLog ? (
                      <details className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-3">
                        <summary className="cursor-pointer text-xs font-medium text-foreground flex items-center gap-2">
                          <span>Last run</span>
                          <Badge
                            variant={schedule.lastRunLog.status === "completed" ? "success" : schedule.lastRunLog.status === "failed" ? "destructive" : "secondary"}
                            className="text-[10px]"
                          >
                            {schedule.lastRunLog.status}
                          </Badge>
                          {schedule.lastRunRecommendation && (
                            <Badge
                              variant={schedule.lastRunRecommendation === "ready_for_rollout" ? "success" : schedule.lastRunRecommendation === "regression_detected" || schedule.lastRunRecommendation === "blocked" ? "destructive" : "warning"}
                              className="text-[10px]"
                            >
                              {schedule.lastRunRecommendation.replaceAll("_", " ")}
                            </Badge>
                          )}
                        </summary>
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                          <span>Dataset: <span className="text-foreground font-medium">{schedule.lastRunLog.baselineDatasetName ?? getDatasetName(schedule.lastRunLog.baselineDatasetId ?? "") ?? "—"}</span></span>
                          <span>Items run: <span className="text-foreground font-medium tabular-nums">{schedule.lastRunLog.replayCount}</span></span>
                          <span>Started: {new Date(schedule.lastRunLog.startedAt).toLocaleString()}</span>
                          <span>Completed: {schedule.lastRunLog.completedAt ? new Date(schedule.lastRunLog.completedAt).toLocaleString() : <span className="text-amber-700 font-medium">Still running…</span>}</span>
                          {schedule.lastRunLog.evaluationRunId && (
                            <span className="sm:col-span-2">
                              Evaluation run:{" "}
                              <a
                                href={`/evaluations/${encodeURIComponent(schedule.lastRunLog.evaluationRunId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                                className="inline-flex items-center gap-1 text-primary underline hover:text-primary/80"
                              >
                                {schedule.lastRunLog.evaluationRunId.slice(0, 20)}…
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            </span>
                          )}
                          {schedule.lastRunLog.failedTraceIds.length > 0 && (
                            <span className="sm:col-span-2 text-amber-700">{schedule.lastRunLog.failedTraceIds.length} item(s) failed execution.</span>
                          )}
                          {schedule.lastRunLog.errorReason && (
                            <span className="sm:col-span-2 text-red-700">Error: {schedule.lastRunLog.errorReason}</span>
                          )}
                        </div>
                      </details>
                    ) : null}
                    {schedule.runHistory.length > 1 ? (
                      <details className="mt-2 rounded-lg border border-border/50 bg-background/40 p-3">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                          Run history ({schedule.runHistory.length})
                        </summary>
                        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto vb-scrollbar">
                          {schedule.runHistory.slice(1).map((run) => (
                            <div key={run.runId} className="rounded-md border border-border/50 bg-muted/20 p-2 text-xs text-muted-foreground">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={run.status === "completed" ? "success" : "destructive"}>{run.status}</Badge>
                                <span>{new Date(run.startedAt).toLocaleString()}</span>
                                <span>{run.replayCount} items</span>
                                {run.evaluationRunId && (
                                  <a
                                    href={`/evaluations/${encodeURIComponent(run.evaluationRunId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                  >
                                    View run <ArrowRight className="h-2.5 w-2.5" />
                                  </a>
                                )}
                              </div>
                              {run.errorReason && <p className="mt-1 text-red-700">{run.errorReason}</p>}
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
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {runningId === schedule.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleSchedule(schedule.id, schedule.enabled)}
                      disabled={togglingId === schedule.id}
                      title={schedule.enabled ? "Disable" : "Enable"}
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
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
                      onClick={() => { setEditingId(schedule.id); setEditForm({ name: schedule.name, baselineDatasetId: schedule.baselineDatasetId, candidatePromptVersionStrategy: schedule.candidatePromptVersionStrategy, candidatePromptVersionId: schedule.candidatePromptVersionId ?? "", promptName: schedule.promptName ?? "", cronExpression: schedule.cronExpression ?? "" }); }}
                      title="Edit"
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSchedule(schedule.id)}
                      title="Delete"
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
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

