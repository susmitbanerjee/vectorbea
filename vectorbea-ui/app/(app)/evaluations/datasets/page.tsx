"use client";

import { useEffect, useState } from "react";
import { Database, PlusCircle, Trash2, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BaselineDataset } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export default function BaselineDatasetsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [datasets, setDatasets] = useState<BaselineDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", promptName: "", traceIds: "", sourceType: "trace_set" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeWorkspaceId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/evaluations/baseline-datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        if (!cancelled) setDatasets(json as BaselineDataset[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load datasets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  const createDataset = async () => {
    if (!activeWorkspaceId || creating) return;
    const traceIds = form.traceIds.split(",").map(s => s.trim()).filter(Boolean);
    if (!form.name.trim() || traceIds.length === 0) { setError("Name and at least one trace ID are required."); return; }
    setCreating(true); setError(null);
    try {
      const res = await fetch(`/api/evaluations/baseline-datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || null, sourceType: form.sourceType, traceIds, promptName: form.promptName.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      setDatasets(prev => [json as BaselineDataset, ...prev]);
      setForm({ name: "", description: "", promptName: "", traceIds: "", sourceType: "trace_set" });
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create dataset");
    } finally {
      setCreating(false);
    }
  };

  const deleteDataset = async (id: string) => {
    if (!activeWorkspaceId) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/evaluations/baseline-datasets/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? "Failed to delete dataset");
      }
      setDatasets(prev => prev.filter(d => d.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete dataset");
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader title="Baseline Datasets" subtitle="Known important trace sets for repeatable evaluation runs." />
      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {error && <Card className="border-red-500/30 bg-red-500/10"><CardContent className="p-4 text-sm text-red-100">{error}</CardContent></Card>}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{datasets.length} dataset{datasets.length !== 1 ? "s" : ""}</p>
          <Button size="sm" onClick={() => setShowForm(v => !v)} className="gap-2">
            <PlusCircle className="h-4 w-4" />{showForm ? "Cancel" : "Create dataset"}
          </Button>
        </div>

        {showForm && (
          <Card>
            <CardHeader><CardTitle>New baseline dataset</CardTitle><CardDescription>Collect runtime traces into a named dataset for repeatable evaluation.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Name *</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Q2 production sample" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Prompt name</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.promptName} onChange={e => setForm(f => ({ ...f, promptName: e.target.value }))} placeholder="Optional — filter by prompt" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Description</label>
                <textarea rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What makes these traces important?" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Source type</label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.sourceType} onChange={e => setForm(f => ({ ...f, sourceType: e.target.value }))}>
                  <option value="trace_set">Trace set</option>
                  <option value="golden_traces">Golden traces</option>
                  <option value="manual">Manual cases</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Trace IDs * (comma-separated)</label>
                <textarea rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono resize-none" value={form.traceIds} onChange={e => setForm(f => ({ ...f, traceIds: e.target.value }))} placeholder="uuid1, uuid2, uuid3" />
              </div>
              <Button onClick={createDataset} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Create dataset
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading datasets...</div>
          ) : datasets.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No baseline datasets yet. Create one from a set of runtime traces.</CardContent></Card>
          ) : (
            datasets.map(dataset => (
              <Card key={dataset.id}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{dataset.name}</span>
                      <Badge variant="secondary">{dataset.sourceType.replace("_", " ")}</Badge>
                      {dataset.promptName && <Badge variant="outline">{dataset.promptName}</Badge>}
                    </div>
                    {dataset.description && <p className="mt-1 text-sm text-muted-foreground">{dataset.description}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{dataset.traceIds.length} trace{dataset.traceIds.length !== 1 ? "s" : ""} · {new Date(dataset.createdAt).toLocaleDateString()}</p>
                  </div>
                  <button type="button" onClick={() => void deleteDataset(dataset.id)} className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
