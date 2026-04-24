"use client";

import { useEffect, useState } from "react";
import { Calendar, PlusCircle, Trash2, Loader2, Play, ToggleLeft, ToggleRight, Info } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RegressionSchedule, BaselineDataset } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export default function ScheduledRegressionsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [schedules, setSchedules] = useState<RegressionSchedule[]>([]);
  const [datasets, setDatasets] = useState<BaselineDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
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
        const [schedulesRes, datasetsRes] = await Promise.all([
          fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/evaluations/baseline-datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        ]);
        const [schedulesJson, datasetsJson] = await Promise.all([schedulesRes.json(), datasetsRes.json()]);
        if (!schedulesRes.ok) throw new Error(schedulesJson.error ?? "Failed to load schedules");
        if (!cancelled) {
          setSchedules(schedulesJson as RegressionSchedule[]);
          setDatasets(Array.isArray(datasetsJson) ? datasetsJson as BaselineDataset[] : []);
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
    if (!form.name.trim() || !form.baselineDatasetId) { setError("Name and baseline dataset are required."); return; }
    setCreating(true); setError(null);
    try {
      const res = await fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          baselineDatasetId: form.baselineDatasetId,
          candidatePromptVersionStrategy: form.candidatePromptVersionStrategy,
          candidatePromptVersionId: form.candidatePromptVersionId.trim() || null,
          promptName: form.promptName.trim() || null,
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
      // Refresh schedule to get updated lastRunAt
      const refreshRes = await fetch(`/api/evaluations/regression-schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json();
        setSchedules(refreshed as RegressionSchedule[]);
      }
    } catch (e) {
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

  const getDatasetName = (id: string) => datasets.find(d => d.id === id)?.name ?? id;

  return (
    <div className="min-h-screen">
      <AppHeader title="Scheduled Regressions" subtitle="Automatically run evaluation runs against baselines on a schedule." />
      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {/* CI callout */}
        <Card className="border-blue-500/30 bg-blue-500/10">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-400" />
            <p className="text-sm text-blue-100">
              No built-in cron runner — call <code className="rounded bg-blue-900/40 px-1 py-0.5 font-mono text-xs">POST /api/evaluations/regression-schedules/[id]/run</code> from your CI or external scheduler to execute due schedules.
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
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Baseline dataset *</label>
                  <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.baselineDatasetId} onChange={e => setForm(f => ({ ...f, baselineDatasetId: e.target.value }))}>
                    <option value="">Select a dataset…</option>
                    {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Candidate version strategy</label>
                  <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.candidatePromptVersionStrategy} onChange={e => setForm(f => ({ ...f, candidatePromptVersionStrategy: e.target.value }))}>
                    <option value="latest_published">Latest published</option>
                    <option value="specific_version">Specific version</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Prompt name</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.promptName} onChange={e => setForm(f => ({ ...f, promptName: e.target.value }))} placeholder="Optional" />
                </div>
                {form.candidatePromptVersionStrategy === "specific_version" && (
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Candidate prompt version ID</label>
                    <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={form.candidatePromptVersionId} onChange={e => setForm(f => ({ ...f, candidatePromptVersionId: e.target.value }))} placeholder="version UUID" />
                  </div>
                )}
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Cron expression</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={form.cronExpression} onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))} placeholder="e.g. 0 2 * * * (for reference only — not executed here)" />
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
                      <p className="mt-0.5 text-xs text-muted-foreground font-mono">cron: {schedule.cronExpression}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      {schedule.lastRunAt && <span>Last run: {new Date(schedule.lastRunAt).toLocaleString()}</span>}
                      {schedule.lastRunRecommendation && <span>Recommendation: {schedule.lastRunRecommendation}</span>}
                    </div>
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
                          ? <ToggleRight className="h-4 w-4 text-green-500" />
                          : <ToggleLeft className="h-4 w-4" />
                      }
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
