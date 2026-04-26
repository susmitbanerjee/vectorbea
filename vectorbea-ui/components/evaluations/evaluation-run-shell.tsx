"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
  XCircle,
  Zap,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EvidenceDialog } from "@/components/evaluations/evidence-dialog";
import { CategoryBreakdown, FailureExplorer } from "@/components/evaluations/failure-explorer";
import type { TraceSetEvaluationRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

// ─── constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

const EVAL_STEPS = [
  { key: "load_dataset",         label: "Load dataset",           detail: "Fetching dataset items" },
  { key: "prepare_version",      label: "Prepare version",        detail: "Loading candidate template" },
  { key: "render_prompts",       label: "Render prompts",         detail: "Substituting variables" },
  { key: "call_provider",        label: "Call provider",          detail: "Sending to LLM" },
  { key: "capture_output",       label: "Capture output",         detail: "Receiving model response" },
  { key: "compare_expected",     label: "Compare expected",       detail: "Matching against reference" },
  { key: "calculate_similarity", label: "Similarity",             detail: "Computing field similarity" },
  { key: "calculate_confidence", label: "Confidence",             detail: "Scoring reliability" },
  { key: "aggregate_score",      label: "Aggregate score",        detail: "Rolling up per-item scores" },
  { key: "produce_verdict",      label: "Verdict",                detail: "Writing recommendation" },
];
// ─── helpers ──────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined) {
  return v == null ? null : Math.round(v * 100);
}

function fmtPct(v: number | null | undefined, fallback = "—") {
  const p = pct(v);
  return p == null ? fallback : `${p}%`;
}

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 0.78) return "text-emerald-400";
  if (score >= 0.5) return "text-amber-400";
  return "text-red-400";
}

function recMeta(rec: string) {
  if (rec === "ready_for_rollout") return { label: "Ready for rollout", Icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", badgeVariant: "success" as const };
  if (rec === "regression_detected" || rec === "blocked") return { label: rec === "blocked" ? "Blocked" : "Regression detected", Icon: XCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", badgeVariant: "destructive" as const };
  return { label: "Needs review", Icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", badgeVariant: "warning" as const };
}

type ResultFilter = "all" | "passed" | "failed" | "needs_review" | "low_confidence" | "no_output";

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "green" | "red" | "amber" }) {
  const cls = accent === "green" ? "text-emerald-400" : accent === "red" ? "text-red-400" : accent === "amber" ? "text-amber-400" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─── Progress bar util ────────────────────────────────────────────────────────

function MiniBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

// ─── Running panel (driven by real server data) ───────────────────────────────

function RunningPanel({ run }: { run: TraceSetEvaluationRunView | null }) {
  const total = run?.aggregate.total ?? 0;
  const done = (run?.aggregate.succeeded ?? 0) + (run?.aggregate.failed ?? 0);
  const progressPct = total > 0 ? Math.round((done / total) * 100) : null;

  // Derive phase from real server signals — no fake timers
  // Phase: setup (0-2) → calling (3) → post-process (4-7) → verdict (8-9)
  const setupDone = total > 0;
  const callingActive = setupDone && done < total;
  const callingDone = setupDone && done >= total;

  // Which phase are we in? 0=setup, 1=calling, 2=postprocess
  const phase = !setupDone ? 0 : !callingDone ? 1 : 2;

  function stepState(i: number): "done" | "active" | "pending" {
    if (phase === 0) return i === 0 ? "active" : "pending";
    if (phase === 1) {
      if (i < 3) return "done";
      if (i === 3) return "active";
      return "pending";
    }
    // phase 2: post-processing — steps 4-9 run sequentially; show only first as active
    if (i < 4) return "done";
    // Estimate post-process progress: we don't have fine-grained step data from server,
    // so show step 4 as active until run reaches completed state
    if (i === 4) return "active";
    return "pending";
  }

  return (
    <Card className="border-border/60">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold">Evaluation in progress</span>
              {progressPct != null && (
                <span className="text-xs tabular-nums text-muted-foreground">{progressPct}%</span>
              )}
            </div>
            {progressPct != null ? (
              <MiniBar value={progressPct} />
            ) : (
              <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-primary/40 animate-pulse" />
              </div>
            )}
            {total > 0 && (
              <div className="mt-1 text-[11px] text-muted-foreground">{done} of {total} items evaluated</div>
            )}
          </div>
        </div>

        <div className="grid gap-1 sm:grid-cols-5">
          {EVAL_STEPS.map((step, i) => {
            const state = stepState(i);
            return (
              <div
                key={step.key}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] transition-colors ${
                  state === "done"
                    ? "border-emerald-500/25 bg-emerald-500/8"
                    : state === "active"
                    ? "border-primary/30 bg-primary/8"
                    : "border-border/30 bg-muted/5 opacity-40"
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                  state === "done" ? "border-emerald-500/40 text-emerald-400"
                  : state === "active" ? "border-primary/40 text-primary"
                  : "border-border text-muted-foreground"
                }`}>
                  {state === "done" ? <CheckCircle2 className="h-2.5 w-2.5" /> : state === "active" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : i + 1}
                </span>
                <span className={`truncate font-medium ${
                  state === "done" ? "text-emerald-400"
                  : state === "active" ? "text-foreground"
                  : "text-muted-foreground"
                }`}>{step.label}</span>
              </div>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-muted-foreground">Refreshing automatically — no action needed.</p>
      </CardContent>
    </Card>
  );
}

// ─── Per-item results table ───────────────────────────────────────────────────

function ResultsTable({
  results,
  isDatasetRun,
  workspaceId,
}: {
  results: TraceSetEvaluationRunView["results"];
  isDatasetRun: boolean;
  workspaceId: string;
}) {
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [evidenceIdx, setEvidenceIdx] = useState<number | null>(null);

  const filtered = results.filter((r, i) => {
    if (filter === "passed" && !(r.label === "pass" || r.status === "success")) return false;
    if (filter === "failed" && !(r.label !== "pass" && r.status !== "success")) return false;
    if (filter === "needs_review" && r.recommendation !== "needs_review") return false;
    if (filter === "low_confidence" && (r.confidence ?? 1) >= 0.5) return false;
    if (filter === "no_output" && r.actualOutput?.trim()) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [r.inputText, r.sourceTraceId, r.provider, r.model, r.actualOutput].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Map filtered item back to original index for evidence dialog
  const originalIndex = (filteredIdx: number) => {
    const item = visible[filteredIdx];
    return results.indexOf(item);
  };

  const resetPage = () => setPage(0);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-7 text-sm"
            placeholder="Search items…"
            value={search}
            onChange={e => { setSearch(e.target.value); resetPage(); }}
          />
          {search && (
            <button type="button" onClick={() => { setSearch(""); resetPage(); }} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium hover:bg-accent/40">
              <span>{{ all: "All items", passed: "Passed", failed: "Failed", needs_review: "Needs review", low_confidence: "Low confidence", no_output: "No output" }[filter]}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPanel>
            <DropdownMenuRadioGroup value={filter} onValueChange={(v) => { setFilter(v as ResultFilter); resetPage(); }}>
              <DropdownMenuPanelRadioItem value="all">All items</DropdownMenuPanelRadioItem>
              <DropdownMenuPanelRadioItem value="passed">Passed</DropdownMenuPanelRadioItem>
              <DropdownMenuPanelRadioItem value="failed">Failed</DropdownMenuPanelRadioItem>
              <DropdownMenuPanelRadioItem value="needs_review">Needs review</DropdownMenuPanelRadioItem>
              <DropdownMenuPanelRadioItem value="low_confidence">Low confidence</DropdownMenuPanelRadioItem>
              <DropdownMenuPanelRadioItem value="no_output">No output</DropdownMenuPanelRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuPanel>
        </DropdownMenu>
        <span className="text-xs text-muted-foreground tabular-nums">{filtered.length} items</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="py-2.5 pl-4 pr-2 text-left font-semibold text-muted-foreground w-8">#</th>
              <th className="py-2.5 px-2 text-left font-semibold text-muted-foreground">
                {isDatasetRun ? "Input preview" : "Source trace"}
              </th>
              <th className="py-2.5 px-2 text-left font-semibold text-muted-foreground">Verdict</th>
              <th className="py-2.5 px-2 text-right font-semibold text-muted-foreground">Score</th>
              <th className="hidden md:table-cell py-2.5 px-2 text-right font-semibold text-muted-foreground">Similarity</th>
              <th className="hidden lg:table-cell py-2.5 px-2 text-right font-semibold text-muted-foreground">Confidence</th>
              <th className="hidden xl:table-cell py-2.5 px-2 text-left font-semibold text-muted-foreground">Provider / model</th>
              <th className="py-2.5 pl-2 pr-4 text-right font-semibold text-muted-foreground">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No items match the current filter.
                </td>
              </tr>
            ) : visible.map((result, rowIdx) => {
              const origIdx = originalIndex(rowIdx);
              const pass = result.label === "pass" || result.status === "success";
              const rec = result.recommendation ?? "needs_review";
              const bv = rec === "ready_for_rollout" ? "success" : (rec === "blocked" || rec === "regression_detected") ? "destructive" : "warning";
              const hasOutput = Boolean(result.actualOutput?.trim());
              return (
                <tr key={`${result.sourceTraceId}-${origIdx}`} className="border-b border-border/40 hover:bg-muted/20 transition-colors last:border-0">
                  <td className="py-2.5 pl-4 pr-2 text-muted-foreground tabular-nums">{origIdx + 1}</td>
                  <td className="py-2.5 px-2 max-w-[200px]">
                    {isDatasetRun ? (
                      <span className="truncate block text-foreground/80">
                        {result.inputText ? result.inputText.slice(0, 60) + (result.inputText.length > 60 ? "…" : "") : <span className="italic text-muted-foreground">No input</span>}
                      </span>
                    ) : (
                      <Link
                        href={`/traces/${encodeURIComponent(result.sourceTraceId)}?org=${encodeURIComponent(workspaceId)}`}
                        className="font-mono text-primary hover:underline"
                      >
                        {result.sourceTraceId.slice(0, 16)}…
                      </Link>
                    )}
                    {!hasOutput && (
                      <span className="mt-0.5 block text-[10px] text-amber-400">Output unavailable</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2">
                    <div className="flex items-center gap-1.5">
                      {pass ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                      <Badge variant={bv} className="text-[10px]">{rec.replaceAll("_", " ")}</Badge>
                    </div>
                  </td>
                  <td className={`py-2.5 px-2 text-right font-bold tabular-nums ${scoreColor(result.score)}`}>
                    {fmtPct(result.score)}
                  </td>
                  <td className="hidden md:table-cell py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                    {result.similarityScore != null ? `${pct(result.similarityScore)}%` : "—"}
                  </td>
                  <td className="hidden lg:table-cell py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                    {result.confidence != null ? `${pct(result.confidence)}%` : "—"}
                  </td>
                  <td className="hidden xl:table-cell py-2.5 px-2 text-muted-foreground">
                    {result.provider ? `${result.provider}/${result.model ?? "?"}` : "—"}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right">
                    <button
                      type="button"
                      onClick={() => setEvidenceIdx(origIdx)}
                      className="rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    >
                      View evidence
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page + 1} of {pageCount}</span>
          <div className="flex gap-1">
            <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted/40">←</button>
            <button type="button" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted/40">→</button>
          </div>
        </div>
      )}

      {/* Evidence dialog */}
      {evidenceIdx !== null && (
        <EvidenceDialog
          open={evidenceIdx !== null}
          onClose={() => setEvidenceIdx(null)}
          result={results[evidenceIdx]!}
          index={evidenceIdx}
        />
      )}
    </div>
  );
}

// ─── Review panel ─────────────────────────────────────────────────────────────

function ReviewPanel({
  run,
  onReview,
  onApprove,
  onRerun,
  reviewing,
  approving,
  rerunning,
}: {
  run: TraceSetEvaluationRunView;
  onReview: (status: TraceSetEvaluationRunView["review"]["status"], decision: TraceSetEvaluationRunView["review"]["decision"], note: string) => void;
  onApprove: () => void;
  onRerun: () => void;
  reviewing: boolean;
  approving: boolean;
  rerunning: boolean;
}) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState("");
  const { activeWorkspaceId } = useWorkspace();
  const rec = run.aggregate.recommendation;

  const actionMap: Record<string, TraceSetEvaluationRunView["review"]["decision"]> = {
    in_review: "start_review",
    needs_changes: "request_changes",
    rejected: "reject",
    approved: "approve",
  };
  const labelMap: Record<string, string> = {
    in_review: "Mark in review",
    needs_changes: "Request changes",
    rejected: "Reject",
    approved: "Approve",
  };

  return (
    <div className="space-y-3">
      {/* Review status */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Review status</span>
        <span className="font-semibold capitalize">{run.review.status.replaceAll("_", " ")}</span>
      </div>

      <textarea
        className="min-h-[60px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
        placeholder="Reviewer rationale (optional)"
        value={note}
        onChange={e => setNote(e.target.value)}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 text-sm font-medium hover:bg-accent/40">
            <span className="truncate text-left">
              {pending ? labelMap[pending] ?? pending : <span className="text-muted-foreground">Select decision…</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={pending} onValueChange={setPending}>
            <DropdownMenuPanelRadioItem value="in_review">Mark in review</DropdownMenuPanelRadioItem>
            <DropdownMenuPanelRadioItem value="needs_changes">Request changes</DropdownMenuPanelRadioItem>
            <DropdownMenuPanelRadioItem value="rejected">Reject</DropdownMenuPanelRadioItem>
            <DropdownMenuPanelRadioItem value="approved">Approve</DropdownMenuPanelRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuPanel>
      </DropdownMenu>

      <Button
        className="w-full gap-2"
        variant="outline"
        disabled={reviewing || !pending}
        onClick={() => {
          if (pending && actionMap[pending]) {
            onReview(pending as TraceSetEvaluationRunView["review"]["status"], actionMap[pending]!, note);
            setPending("");
          }
        }}
      >
        {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Submit review
      </Button>

      <div className="pt-1 space-y-2">
        <Button
          className="w-full gap-2"
          onClick={onApprove}
          disabled={approving || run.status === "approved" || !run.promotion.allowed}
        >
          {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {run.status === "approved" ? "Version promoted ✓" : "Promote to rollout"}
        </Button>

        {!run.promotion.allowed && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-1">
            <div className="font-semibold">Promotion blocked:</div>
            {run.promotion.reasons.map((r, i) => (
              <div key={i} className="flex gap-1.5"><span className="shrink-0">·</span>{r}</div>
            ))}
          </div>
        )}

        {run.status === "approved" && (
          <Link
            href={`/prompts?org=${encodeURIComponent(activeWorkspaceId ?? "")}` as any}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition"
          >
            <GitBranch className="h-3.5 w-3.5" />
            Open prompts to complete rollout →
          </Link>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          disabled={rerunning}
          onClick={() => {
            if (confirm("This will create a new evaluation run using the same dataset and candidate version. The current run will not be modified. Continue?")) {
              onRerun();
            }
          }}
        >
          {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Re-run evaluation
        </Button>
      </div>
    </div>
  );
}

// ─── Main shell ───────────────────────────────────────────────────────────────

export function EvaluationRunShell({ runId }: { runId: string }) {
  const { activeWorkspaceId } = useWorkspace();
  const [run, setRun] = useState<TraceSetEvaluationRunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function loadRun() {
      if (!activeWorkspaceId || !runId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/evaluations/trace-sets/${encodeURIComponent(runId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Failed to load evaluation run");
        if (!cancelled) setRun(payload as TraceSetEvaluationRunView);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadRun();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, runId]);

  // Auto-refresh while running
  useEffect(() => {
    if (!run || (run.status !== "running" && run.status !== "queued")) return;
    const iv = setInterval(async () => {
      if (!activeWorkspaceId) return;
      const res = await fetch(`/api/evaluations/trace-sets/${encodeURIComponent(runId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      if (res.ok) {
        const payload = await res.json();
        setRun(payload as TraceSetEvaluationRunView);
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [run, runId, activeWorkspaceId]);

  const approveRun = async () => {
    if (!activeWorkspaceId || !run || approving) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/evaluations/trace-sets/${encodeURIComponent(run.id)}/approve?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to approve");
      setRun(payload as TraceSetEvaluationRunView);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setApproving(false); }
  };

  const submitReview = async (
    status: TraceSetEvaluationRunView["review"]["status"],
    decision: TraceSetEvaluationRunView["review"]["decision"],
    note: string,
  ) => {
    if (!activeWorkspaceId || !run || reviewing) return;
    setReviewing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/evaluations/trace-sets/${encodeURIComponent(run.id)}/review?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, decision, note }) },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to update review");
      setRun(payload as TraceSetEvaluationRunView);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setReviewing(false); }
  };

  const rerunEvaluation = async () => {
    if (!activeWorkspaceId || !run || rerunning) return;
    setRerunning(true);
    setError(null);
    try {
      const body = run.datasetId
        ? { datasetId: run.datasetId, candidatePromptVersionId: run.candidatePromptVersionId }
        : { sourceTraceIds: run.sourceTraceIds, candidatePromptVersionId: run.candidatePromptVersionId };
      const res = await fetch(
        `/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to re-run");
      window.location.href = `/evaluations/${payload.id}?org=${encodeURIComponent(activeWorkspaceId)}`;
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setRerunning(false); }
  };

  const isRunning = run?.status === "running" || run?.status === "queued";
  const isDatasetRun = Boolean(run?.datasetId);
  const rec = run?.aggregate.recommendation ?? "needs_review";
  const rm = recMeta(rec);

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Evaluation run"
        subtitle={run ? `${run.promptName} @ ${run.candidateVersionTag}${run.datasetName ? ` · ${run.datasetName}` : ""}` : runId}
      />

      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {(loading && !run) ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Loading evaluation run…
          </div>
        ) : isRunning ? (
          <RunningPanel run={run} />
        ) : !run ? null : (
          <>
            {/* ── Header info strip ── */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Badge variant={rm.badgeVariant} className="text-xs px-2.5 py-1 gap-1.5">
                <rm.Icon className="h-3.5 w-3.5" />
                {rm.label}
              </Badge>
              <span>{run.promptName} <span className="text-muted-foreground/60">@</span> {run.candidateVersionTag}</span>
              {run.datasetName && <span className="flex items-center gap-1"><Database className="h-3 w-3" />{run.datasetName}</span>}
              <span className="text-muted-foreground/60">·</span>
              <span>{new Date(run.createdAt).toLocaleString()}</span>
            </div>

            {/* ── Verdict alert (only when blocked/regression) ── */}
            {(rec === "blocked" || rec === "regression_detected") && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <div className="text-sm space-y-1">
                  <div className="font-semibold text-red-300">{rm.label}</div>
                  {run.aggregate.reasons.length > 0 && (
                    <div className="text-xs text-red-200/80">{run.aggregate.reasons[0]}</div>
                  )}
                </div>
              </div>
            )}

            {/* ── Main two-column layout ── */}
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">

              {/* LEFT: executive summary + KPIs + results */}
              <div className="space-y-5">

                {/* Executive summary */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Evaluation summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* KPI grid */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      <KpiCard label="Total items" value={String(run.aggregate.total)} />
                      <KpiCard label="Passed" value={String(run.aggregate.succeeded)} accent="green" />
                      <KpiCard label="Failed" value={String(run.aggregate.failed)} accent={run.aggregate.failed > 0 ? "red" : undefined} />
                      <KpiCard label="Avg score" value={fmtPct(run.aggregate.score)} accent={run.aggregate.score == null ? undefined : run.aggregate.score >= 0.78 ? "green" : run.aggregate.score >= 0.5 ? "amber" : "red"} />
                      <KpiCard label="Confidence" value={fmtPct(run.aggregate.confidence)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <KpiCard label="Critical fails" value={String(run.aggregate.criticalFailures)} accent={run.aggregate.criticalFailures > 0 ? "red" : undefined} />
                      <KpiCard label="Observability" value={run.aggregate.observabilityLevel} />
                      {run.aggregate.averageLatencyDeltaMs !== null && (
                        <KpiCard label="Avg latency Δ" value={`${Math.round(run.aggregate.averageLatencyDeltaMs)}ms`} accent={run.aggregate.averageLatencyDeltaMs > 500 ? "red" : run.aggregate.averageLatencyDeltaMs < 0 ? "green" : undefined} />
                      )}
                      {run.aggregate.averageTokenDelta !== null && (
                        <KpiCard label="Avg token Δ" value={String(Math.round(run.aggregate.averageTokenDelta))} />
                      )}
                    </div>

                    {/* Score/pass distribution */}
                    {run.aggregate.total > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>Pass rate</span>
                          <span>{Math.round((run.aggregate.succeeded / run.aggregate.total) * 100)}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden flex">
                          <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${(run.aggregate.succeeded / run.aggregate.total) * 100}%` }} />
                          <div className="h-full bg-red-500/70 transition-all duration-700" style={{ width: `${(run.aggregate.failed / run.aggregate.total) * 100}%` }} />
                        </div>
                        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />{run.aggregate.succeeded} passed</span>
                          {run.aggregate.failed > 0 && <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500/70" />{run.aggregate.failed} failed</span>}
                        </div>
                      </div>
                    )}

                    {/* Category breakdown */}
                    {run.results.length > 0 && (
                      <CategoryBreakdown results={run.results} />
                    )}

                    {/* Recommendation reasons */}
                    {run.aggregate.reasons.length > 0 && (
                      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1 text-xs text-muted-foreground">
                        {run.aggregate.reasons.map((r, i) => (
                          <div key={i} className="flex gap-1.5"><span className="shrink-0 mt-0.5">·</span><span>{r}</span></div>
                        ))}
                      </div>
                    )}

                    {/* Unresolved flags */}
                    {(run.aggregate.unresolvedFlagCount ?? 0) > 0 && (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {run.aggregate.unresolvedFlagCount} source trace(s) with unresolved flags. Resolve before promoting.
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Failure explorer — shown whenever there are failures */}
                {run.aggregate.failed > 0 && (
                  <FailureExplorer
                    results={run.results}
                    onSelectItem={(idx) => {
                      // Scroll to results table and open evidence for that item
                      document.getElementById(`result-row-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  />
                )}

                {/* Per-item results */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <Zap className="h-4 w-4" />
                      Evaluation results
                      <span className="ml-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground tabular-nums normal-case tracking-normal">{run.results.length}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResultsTable
                      results={run.results}
                      isDatasetRun={isDatasetRun}
                      workspaceId={activeWorkspaceId ?? ""}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* RIGHT: review + promotion */}
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Review &amp; decision
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ReviewPanel
                      run={run}
                      onReview={submitReview}
                      onApprove={approveRun}
                      onRerun={rerunEvaluation}
                      reviewing={reviewing}
                      approving={approving}
                      rerunning={rerunning}
                    />
                  </CardContent>
                </Card>

                {/* Dataset summary */}
                {isDatasetRun && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground font-semibold uppercase tracking-[0.14em]">
                        <Database className="h-4 w-4" />
                        Dataset coverage
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Dataset</span><span className="font-medium">{run.datasetName ?? "—"}</span></div>
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Total items</span><span className="font-medium tabular-nums">{run.aggregate.total}</span></div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Expected output</span>
                        <span className="font-medium tabular-nums">
                          {run.results.filter(r => r.expectedOutput?.trim()).length} / {run.aggregate.total}
                        </span>
                      </div>
                      {run.aggregate.total > 0 && (
                        <MiniBar
                          value={(run.results.filter(r => r.expectedOutput?.trim()).length / run.aggregate.total) * 100}
                          color="bg-primary"
                        />
                      )}
                      <p className="text-muted-foreground/60 text-[10px]">Items without expected output skip the similarity check (max score 40%).</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
