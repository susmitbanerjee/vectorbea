"use client";

import { useEffect, useState } from "react";
import { Star, StarOff, PlusCircle, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GoldenTrace } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export default function GoldenTracesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [traces, setTraces] = useState<GoldenTrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ traceId: "", promptName: "", label: "", notes: "" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeWorkspaceId) return;
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/evaluations/golden-traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed");
        if (!cancelled) setTraces(json as GoldenTrace[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  const markTrace = async () => {
    if (!activeWorkspaceId || marking || !form.traceId.trim()) return;
    setMarking(true); setError(null);
    try {
      const res = await fetch(`/api/evaluations/golden-traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceId: form.traceId.trim(), promptName: form.promptName.trim() || null, label: form.label.trim() || null, notes: form.notes.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setTraces(prev => {
        const exists = prev.find(t => t.traceId === (json as GoldenTrace).traceId);
        return exists ? prev.map(t => t.traceId === (json as GoldenTrace).traceId ? json as GoldenTrace : t) : [json as GoldenTrace, ...prev];
      });
      setForm({ traceId: "", promptName: "", label: "", notes: "" });
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark trace");
    } finally {
      setMarking(false);
    }
  };

  const unmarkTrace = async (traceId: string) => {
    if (!activeWorkspaceId || removingId) return;
    setRemovingId(traceId);
    setConfirmRemoveId(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/evaluations/golden-traces/${encodeURIComponent(traceId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? "Failed to remove golden trace");
      }
      setTraces(prev => prev.filter(t => t.traceId !== traceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove golden trace");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader title="Golden Traces" subtitle="High-value production traces protected against regression." />
      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {error && <Card className="border-red-500/30 bg-red-500/10"><CardContent className="p-4 text-sm text-red-100">{error}</CardContent></Card>}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{traces.length} golden trace{traces.length !== 1 ? "s" : ""}</p>
          <Button size="sm" onClick={() => setShowForm(v => !v)} className="gap-2">
            <PlusCircle className="h-4 w-4" />{showForm ? "Cancel" : "Mark trace as golden"}
          </Button>
        </div>

        {showForm && (
          <Card>
            <CardHeader><CardTitle>Mark trace as golden</CardTitle><CardDescription>Golden traces are used in evaluation runs and regression checks.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Trace ID *</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={form.traceId} onChange={e => setForm(f => ({ ...f, traceId: e.target.value }))} placeholder="trace UUID" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Label</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. critical-path" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Prompt name</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.promptName} onChange={e => setForm(f => ({ ...f, promptName: e.target.value }))} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Notes</label>
                  <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Why is this trace important?" />
                </div>
              </div>
              <Button onClick={markTrace} disabled={marking || !form.traceId.trim()} className="gap-2">
                {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}Mark as golden
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading golden traces...</div>
          ) : traces.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No golden traces yet. Mark production-like traces to protect them against regressions.</CardContent></Card>
          ) : (
            traces.map(trace => (
              <Card key={trace.id}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Star className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                      <span className="font-mono text-sm font-medium">{trace.traceId}</span>
                      {trace.label && <Badge variant="outline">{trace.label}</Badge>}
                      {trace.promptName && <Badge variant="secondary">{trace.promptName}</Badge>}
                    </div>
                    {trace.notes && <p className="mt-1 text-sm text-muted-foreground">{trace.notes}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(trace.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {confirmRemoveId === trace.traceId ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Remove golden?</span>
                        <button
                          type="button"
                          onClick={() => void unmarkTrace(trace.traceId)}
                          disabled={removingId === trace.traceId}
                          className="rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                        >
                          {removingId === trace.traceId ? "Removing…" : "Yes, remove"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(trace.traceId)}
                        title="Remove from golden traces"
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        <StarOff className="h-4 w-4" />
                      </button>
                    )}
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
