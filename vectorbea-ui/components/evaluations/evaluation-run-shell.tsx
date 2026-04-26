"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  GitBranch,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
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
import type { TraceEvaluationCheckView, TraceSetEvaluationRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

// ─── helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 0.78) return "text-emerald-400";
  if (score >= 0.5) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number | null) {
  if (score === null) return "bg-muted/40";
  if (score >= 0.78) return "bg-emerald-500/10 border-emerald-500/30";
  if (score >= 0.5) return "bg-amber-500/10 border-amber-500/30";
  return "bg-red-500/10 border-red-500/30";
}

function recommendationStyle(r: string) {
  if (r === "ready_for_rollout") return { bg: "bg-emerald-500/15 border-emerald-500/40", text: "text-emerald-400", icon: <CheckCircle2 className="h-4 w-4" /> };
  if (r === "regression_detected" || r === "blocked") return { bg: "bg-red-500/15 border-red-500/40", text: "text-red-400", icon: <XCircle className="h-4 w-4" /> };
  return { bg: "bg-amber-500/15 border-amber-500/40", text: "text-amber-400", icon: <AlertTriangle className="h-4 w-4" /> };
}

function pct(v: number | null) {
  return v === null ? null : Math.round(v * 100);
}

function previewText(value?: string | null, fallback = "Unavailable") {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}

function EvidenceBlock({
  title,
  value,
  mono = false,
}: {
  title: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/25 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <pre className={`max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 ${mono ? "font-mono" : "font-sans"}`}>
        {previewText(value)}
      </pre>
    </div>
  );
}

// Animated radial score ring
function ScoreRing({ score, size = 80 }: { score: number | null; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const filled = score === null ? 0 : score * circ;
  const color = score === null ? "#6b7280" : score >= 0.78 ? "#34d399" : score >= 0.5 ? "#fbbf24" : "#f87171";
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={5} className="text-border" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text
        x={size / 2} y={size / 2 + 6}
        textAnchor="middle"
        fill={color}
        fontSize={size < 70 ? 11 : 14}
        fontWeight="700"
        style={{ transform: `rotate(90deg)`, transformOrigin: `${size / 2}px ${size / 2}px` }}
      >
        {score === null ? "—" : `${Math.round(score * 100)}%`}
      </text>
    </svg>
  );
}

// Single check pill
function CheckPill({ check, delay }: { check: TraceEvaluationCheckView; delay: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const pass = check.status === "pass";
  const warn = check.status === "warning";
  return (
    <div
      className={`transition-all duration-500 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"} flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
        pass ? "border-emerald-500/30 bg-emerald-500/8" : warn ? "border-amber-500/30 bg-amber-500/8" : "border-red-500/30 bg-red-500/8"
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${pass ? "text-emerald-400" : warn ? "text-amber-400" : "text-red-400"}`}>
        {pass ? <CheckCircle2 className="h-3.5 w-3.5" /> : warn ? <AlertTriangle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold capitalize">{check.name.replaceAll("_", " ")}</span>
          {check.critical && <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400">critical</span>}
          {check.weight && check.weight > 1 && <span className="text-[9px] text-muted-foreground">×{check.weight} weight</span>}
        </div>
        <div className={`mt-0.5 ${pass ? "text-emerald-300/80" : warn ? "text-amber-300/80" : "text-red-300/80"}`}>{check.reason}</div>
      </div>
      <span className={`ml-auto shrink-0 font-bold tabular-nums ${pass ? "text-emerald-400" : warn ? "text-amber-400" : "text-red-400"}`}>
        {check.score === null ? "—" : `${Math.round(check.score * 100)}%`}
      </span>
    </div>
  );
}

// One result item card with animated reveal
function ResultCard({
  result,
  index,
  workspaceId,
  isDatasetRun,
}: {
  result: TraceSetEvaluationRunView["results"][number];
  index: number;
  workspaceId: string;
  isDatasetRun: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [entered, setEntered] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const [progressWidth, setProgressWidth] = useState(0);

  useEffect(() => {
    // Stagger card entrance
    const t1 = setTimeout(() => setEntered(true), index * 120 + 80);
    // Start score bar after card is visible
    const t2 = setTimeout(() => {
      setProgressWidth(result.score === null ? 0 : Math.round(result.score * 100));
    }, index * 120 + 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [index, result.score]);

  const pass = result.label === "pass" || result.status === "success";
  const scoreVal = pct(result.score);
  const rec = result.recommendation ?? "needs_review";

  return (
    <div
      className={`transition-all duration-500 ease-out ${entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
    >
      <div className={`rounded-xl border ${scoreBg(result.score)} overflow-hidden`}>
        {/* Header row */}
        <button
          type="button"
          onClick={() => {
            setExpanded(e => !e);
            if (!showChecks) setTimeout(() => setShowChecks(true), 100);
          }}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
        >
          {/* Step number */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-xs font-bold">
            {index + 1}
          </span>

          {/* Status icon */}
          <span className={pass ? "text-emerald-400" : "text-red-400"}>
            {pass ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          </span>

          {/* ID / label */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground truncate max-w-[240px]">
                {isDatasetRun
                  ? (result.inputText ? result.inputText.slice(0, 60) + (result.inputText.length > 60 ? "…" : "") : `item ${index + 1}`)
                  : <span className="font-mono">{result.sourceTraceId.slice(0, 16)}…</span>}
              </span>
              <Badge variant={rec === "ready_for_rollout" ? "success" : rec === "blocked" || rec === "regression_detected" ? "destructive" : "warning"}>
                {rec.replaceAll("_", " ")}
              </Badge>
            </div>
            {/* Score bar */}
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-muted/60 overflow-hidden max-w-[180px]">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-out ${
                    (result.score ?? 0) >= 0.78 ? "bg-emerald-400" : (result.score ?? 0) >= 0.5 ? "bg-amber-400" : "bg-red-400"
                  }`}
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
              <span className={`text-sm font-bold tabular-nums ${scoreColor(result.score)}`}>
                {scoreVal === null ? "—" : `${scoreVal}%`}
              </span>
            </div>
          </div>

          {/* Latency delta (trace runs only) */}
          {result.latencyDeltaMs !== null && (
            <div className="hidden shrink-0 text-right text-xs text-muted-foreground md:block">
              <div className={result.latencyDeltaMs < 0 ? "text-emerald-400" : result.latencyDeltaMs > 0 ? "text-red-400" : ""}>
                {result.latencyDeltaMs > 0 ? "+" : ""}{Math.round(result.latencyDeltaMs)}ms
              </div>
              <div>latency delta</div>
            </div>
          )}

          {/* Expand chevron */}
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t border-border/40 px-4 py-4 space-y-4">
            {isDatasetRun && (
              <div className="grid gap-3 xl:grid-cols-2">
                <EvidenceBlock title="Dataset input" value={result.inputText} />
                <EvidenceBlock title="Rendered prompt" value={result.renderedPrompt} mono />
                <EvidenceBlock title="Actual LLM output" value={result.actualOutput} />
                <EvidenceBlock title={result.referenceOutput ? "Reference output" : "Expected output"} value={result.referenceOutput ?? result.expectedOutput} />
              </div>
            )}

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <div className="text-muted-foreground">Mode</div>
                <div className="mt-1 font-semibold capitalize">{(result.evaluationMode ?? (isDatasetRun ? "no_reference" : "trace_replay")).replaceAll("_", " ")}</div>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <div className="text-muted-foreground">Provider / model</div>
                <div className="mt-1 font-semibold">{result.provider ?? "unknown"} / {result.model ?? "unknown"}</div>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <div className="text-muted-foreground">Similarity</div>
                <div className="mt-1 font-semibold">
                  {result.similarityScore === null || result.similarityScore === undefined
                    ? "Unavailable"
                    : `${Math.round(result.similarityScore * 100)}% (${result.similarityLabel})`}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <div className="text-muted-foreground">Confidence</div>
                <div className="mt-1 font-semibold">
                  {result.confidence === null || result.confidence === undefined
                    ? "Unavailable"
                    : `${Math.round(result.confidence * 100)}% (${result.confidenceLabel ?? "unknown"})`}
                </div>
              </div>
            </div>

            {(result.similarityReason || (result.confidenceReasons && result.confidenceReasons.length > 0)) && (
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                  <div className="mb-1 font-semibold text-foreground">Similarity explanation</div>
                  {result.similarityReason ?? "Similarity was unavailable because no expected/reference output was captured."}
                </div>
                <div className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                  <div className="mb-1 font-semibold text-foreground">Confidence explanation</div>
                  {(result.confidenceReasons ?? []).length > 0
                    ? result.confidenceReasons?.join(" ")
                    : "Confidence was not calculated for this legacy result."}
                </div>
              </div>
            )}

            {result.executionSteps && result.executionSteps.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                  Execution steps
                </div>
                <div className="space-y-2">
                  {result.executionSteps.map((step, stepIndex) => (
                    <div key={`${step.name}-${stepIndex}`} className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs md:grid-cols-[28px_180px_1fr_90px]">
                      <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                        step.status === "success" ? "border-emerald-500/40 text-emerald-400" :
                        step.status === "warning" || step.status === "skipped" ? "border-amber-500/40 text-amber-400" :
                        step.status === "error" ? "border-red-500/40 text-red-400" :
                        "border-border text-muted-foreground"
                      }`}>
                        {stepIndex + 1}
                      </span>
                      <div>
                        <div className="font-semibold text-foreground">{step.label}</div>
                        <div className="text-muted-foreground">{step.status}</div>
                      </div>
                      <div className="text-muted-foreground">{step.summary}</div>
                      <div className="text-right font-mono text-muted-foreground">{step.durationMs === null || step.durationMs === undefined ? "-" : `${Math.round(step.durationMs)}ms`}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.modelResults && result.modelResults.length > 1 && (
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Model comparison</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 text-left">Provider/model</th>
                        <th className="py-2 text-left">Score</th>
                        <th className="py-2 text-left">Similarity</th>
                        <th className="py-2 text-left">Latency</th>
                        <th className="py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.modelResults.map((modelResult, modelIndex) => (
                        <tr key={`${modelResult.provider}-${modelResult.model}-${modelIndex}`} className="border-b border-border/50">
                          <td className="py-2">{modelResult.provider} / {modelResult.model}</td>
                          <td className="py-2">{modelResult.score === null ? "Unavailable" : `${Math.round(modelResult.score * 100)}%`}</td>
                          <td className="py-2">{modelResult.similarityScore === null ? "Unavailable" : `${Math.round(modelResult.similarityScore * 100)}%`}</td>
                          <td className="py-2">{modelResult.latencyMs === null ? "Unavailable" : `${Math.round(modelResult.latencyMs)}ms`}</td>
                          <td className="py-2">{modelResult.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Flow: Input → Prompt → Output */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
              {/* Source / input */}
              <div className="flex-1 rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                  <CircleDot className="h-3 w-3" /> {isDatasetRun ? "Dataset Input" : "Source Trace"}
                </div>
                {isDatasetRun ? (
                  <div className="text-foreground/90 break-words whitespace-pre-wrap">{result.inputText ?? `item #${index + 1}`}</div>
                ) : (
                  <Link
                    href={`/traces/${encodeURIComponent(result.sourceTraceId)}?org=${encodeURIComponent(workspaceId)}`}
                    className="font-mono text-primary hover:underline break-all"
                  >
                    {result.sourceTraceId}
                  </Link>
                )}
              </div>

              <div className="flex items-center justify-center sm:mt-6">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>

              {/* Execution / replay */}
              <div className="flex-1 rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                  <Zap className="h-3 w-3" /> {isDatasetRun ? "Executed via OpenAI" : "Replay Trace"}
                </div>
                {result.replayTraceId ? (
                  <Link
                    href={
                      isDatasetRun
                        ? `/traces/${encodeURIComponent(result.replayTraceId)}?org=${encodeURIComponent(workspaceId)}`
                        : `/traces/compare?left=${encodeURIComponent(result.sourceTraceId)}&right=${encodeURIComponent(result.replayTraceId)}&org=${encodeURIComponent(workspaceId)}`
                    }
                    className="font-mono text-primary hover:underline break-all"
                  >
                    {result.replayTraceId.slice(0, 20)}… {!isDatasetRun && <span className="text-muted-foreground">(compare →)</span>}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No execution trace</span>
                )}
                <div className="text-muted-foreground capitalize">
                  {result.replayMode === "live" ? "🟢 Live execution" : result.replayMode === "simulated" ? "🟡 Simulated" : ""}
                </div>
              </div>

              <div className="flex items-center justify-center sm:mt-6">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>

              {/* Score summary */}
              <div className={`shrink-0 rounded-lg border p-3 flex flex-col items-center justify-center gap-1 ${scoreBg(result.score)}`}>
                <ScoreRing score={result.score} size={72} />
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${scoreColor(result.score)}`}>
                  {result.label ?? "unknown"}
                </div>
              </div>
            </div>

            {/* Error message if any */}
            {result.error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <span className="font-semibold">Error: </span>{result.error}
              </div>
            )}

            {/* Checks */}
            {showChecks && result.checks && result.checks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3.5 w-3.5" /> Evaluation checks
                  <span className="ml-auto normal-case font-normal">
                    {result.checks.filter(c => c.status === "pass").length}/{result.checks.length} passed
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {result.checks.map((check, ci) => (
                    <CheckPill key={`${check.name}-${ci}`} check={check} delay={ci * 80} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Evaluation progress timeline ────────────────────────────────────────────

const EVAL_STEPS = [
  { key: "load_dataset",        label: "Load dataset",            detail: "Fetching dataset items and expected outputs" },
  { key: "prepare_version",     label: "Prepare prompt version",  detail: "Loading candidate template and parameters" },
  { key: "render_prompts",      label: "Render prompts",          detail: "Substituting dataset variables into template" },
  { key: "call_provider",       label: "Call provider",           detail: "Sending rendered prompt + input to OpenAI" },
  { key: "capture_output",      label: "Capture LLM output",      detail: "Receiving and validating model response" },
  { key: "compare_expected",    label: "Compare vs expected",     detail: "Matching actual output against reference" },
  { key: "calculate_similarity",label: "Calculate similarity",    detail: "Computing field-level and string similarity" },
  { key: "calculate_confidence",label: "Calculate confidence",    detail: "Estimating evaluation reliability score" },
  { key: "aggregate_score",     label: "Aggregate score",         detail: "Combining per-item scores into run score" },
  { key: "produce_verdict",     label: "Produce verdict",         detail: "Applying thresholds and writing recommendation" },
];

// Durations per step in ms (realistic pacing)
const STEP_DURATIONS = [300, 200, 250, 3500, 400, 300, 250, 200, 200, 300];

function EvaluationLoadingSkeleton({ itemCount = 0 }: { itemCount?: number }) {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [itemsDone, setItemsDone] = useState(0);

  useEffect(() => {
    let step = 0;
    let cancelled = false;

    function advance() {
      if (cancelled || step >= EVAL_STEPS.length) return;
      setActiveStep(step);
      const dur = STEP_DURATIONS[step] ?? 400;
      setTimeout(() => {
        if (cancelled) return;
        setCompletedSteps(prev => new Set([...prev, step]));
        // Simulate item progress during "call_provider" step
        if (EVAL_STEPS[step].key === "call_provider" && itemCount > 1) {
          let done = 0;
          const itemInterval = setInterval(() => {
            done += 1;
            setItemsDone(Math.min(done, itemCount));
            if (done >= itemCount) clearInterval(itemInterval);
          }, dur / itemCount);
        }
        step += 1;
        advance();
      }, dur);
    }

    advance();
    return () => { cancelled = true; };
  }, [itemCount]);

  const progressPct = Math.round((completedSteps.size / EVAL_STEPS.length) * 100);

  return (
    <Card className="border-border/60">
      <CardContent className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Evaluation in progress</span>
              <span className="text-xs tabular-nums text-muted-foreground">{progressPct}%</span>
            </div>
            <div className="mt-1.5 h-1 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {itemCount > 1 && activeStep >= 3 && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {itemsDone} of {itemCount} inputs evaluated
              </div>
            )}
          </div>
        </div>

        {/* Step list */}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {EVAL_STEPS.map((step, i) => {
            const isDone = completedSteps.has(i);
            const isActive = activeStep === i && !isDone;
            const isPending = i > activeStep;
            return (
              <div
                key={step.key}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-all duration-300 ${
                  isDone  ? "border-emerald-500/25 bg-emerald-500/8 opacity-100" :
                  isActive ? "border-primary/30 bg-primary/8 opacity-100" :
                  "border-border/40 bg-muted/10 opacity-40"
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  isDone  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400" :
                  isActive ? "border-primary/50 bg-primary/15 text-primary" :
                  "border-border text-muted-foreground"
                }`}>
                  {isDone
                    ? <CheckCircle2 className="h-3 w-3" />
                    : isActive
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : i + 1}
                </span>
                <div className="min-w-0">
                  <div className={`font-medium truncate ${isDone ? "text-emerald-400" : isActive ? "text-foreground" : "text-muted-foreground"}`}>
                    {step.label}
                  </div>
                  {(isDone || isActive) && (
                    <div className="text-[10px] text-muted-foreground truncate">{step.detail}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          This page will refresh automatically when the run completes.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Aggregate score banner ────────────────────────────────────────────────────

function AggregateBanner({ run }: { run: TraceSetEvaluationRunView }) {
  const rec = run.aggregate.recommendation;
  const style = recommendationStyle(rec);
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 200); return () => clearTimeout(t); }, []);

  return (
    <div className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"} rounded-xl border ${style.bg} px-5 py-4 flex items-center gap-4 flex-wrap`}>
      <span className={style.text}>{style.icon}</span>
      <div className="flex-1 min-w-0">
        <div className={`text-lg font-bold ${style.text} capitalize`}>{rec.replaceAll("_", " ")}</div>
        {run.aggregate.reasons.length > 0 && (
          <div className="mt-0.5 text-xs text-muted-foreground">{run.aggregate.reasons[0]}</div>
        )}
      </div>
      <div className="flex items-center gap-6 flex-wrap">
        <StatPill label="Total" value={String(run.aggregate.total)} />
        <StatPill label="Succeeded" value={String(run.aggregate.succeeded)} color="emerald" />
        {run.aggregate.failed > 0 && <StatPill label="Failed" value={String(run.aggregate.failed)} color="red" />}
        {run.aggregate.score !== null && (
          <div className="flex flex-col items-center">
            <ScoreRing score={run.aggregate.score} size={64} />
            <span className="text-[10px] text-muted-foreground mt-0.5">Avg score</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color?: "emerald" | "red" }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-xl font-bold tabular-nums ${color === "emerald" ? "text-emerald-400" : color === "red" ? "text-red-400" : "text-foreground"}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ─── How scoring works explainer ──────────────────────────────────────────────

function ScoringExplainer({ isDatasetRun }: { isDatasetRun: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Info className="h-4 w-4 text-primary" />
          How is this scored?
        </div>
        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border/40 px-4 py-4 text-sm space-y-3 text-muted-foreground">
          {isDatasetRun ? (
            <>
              <p>For <strong className="text-foreground">manual / imported dataset items</strong>, each item is sent live to your configured OpenAI API. Three checks are run:</p>
              <div className="space-y-2">
                {[
                  { name: "execution_completed", weight: "×1", critical: true, desc: "Did the OpenAI API call succeed without error? If this fails the item is blocked regardless of other checks." },
                  { name: "output_non_empty", weight: "×1", critical: false, desc: "Did the model return a non-empty response?" },
                  { name: "output_matches_expected", weight: "×3", critical: false, desc: "If you provided an expected output, the actual LLM output is compared using normalized edit-distance similarity. For pipe-delimited extraction outputs (e.g. 'susmit | deployed | ai proxy | success') it also compares field-by-field. Score ≥70% = pass." },
                ].map(c => (
                  <div key={c.name} className="rounded-lg border border-border bg-card px-3 py-2 text-xs space-y-0.5">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      {c.name.replaceAll("_", " ")}
                      <span className="text-muted-foreground font-normal">{c.weight} weight</span>
                      {c.critical && <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase bg-red-500/20 text-red-400">critical</span>}
                    </div>
                    <div>{c.desc}</div>
                  </div>
                ))}
              </div>
              <p>Final score = weighted average of all checks. Total weight = 1+1+3 = 5. <strong className="text-foreground">≥78% → ready for rollout</strong>. 46–77% → needs review. &lt;46% → regression.</p>
              <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-blue-200 text-xs">
                <strong>Tip — fill in expected output:</strong> For your extraction prompt the expected output is the pipe-delimited line e.g. <code className="font-mono">susmit | deployed | ai proxy | success</code>. The system splits it into 4 fields and compares each field individually. If all 4 match you get 100% on the similarity check (weight ×3) → overall score ≈ 100%. Without expected output the similarity check is skipped and max score is 40%.
              </p>
            </>
          ) : (
            <>
              <p>For <strong className="text-foreground">runtime trace replays</strong>, the candidate prompt is re-executed with the same inputs and the output is compared against the original trace. Scoring is based on output diff, latency delta, and token delta.</p>
              <p>Avg latency delta and token delta are unavailable when there is no baseline trace to compare against.</p>
            </>
          )}
        </div>
      )}
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
  const [reviewNote, setReviewNote] = useState("");
  const [pendingReviewStatus, setPendingReviewStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadRun() {
      if (!activeWorkspaceId || !runId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/evaluations/trace-sets/${encodeURIComponent(runId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to load evaluation run");
        if (!cancelled) setRun(payload as TraceSetEvaluationRunView);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load evaluation run");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadRun();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, runId]);

  const approveRun = async () => {
    if (!activeWorkspaceId || !run || approving) return;
    setApproving(true);
    setError(null);
    try {
      const response = await fetch(`/api/evaluations/trace-sets/${encodeURIComponent(run.id)}/approve?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to approve candidate version");
      setRun(payload as TraceSetEvaluationRunView);
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Failed to approve candidate version");
    } finally {
      setApproving(false);
    }
  };

  const submitReview = async (
    status: TraceSetEvaluationRunView["review"]["status"],
    decision: TraceSetEvaluationRunView["review"]["decision"],
  ) => {
    if (!activeWorkspaceId || !run || reviewing) return;
    setReviewing(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/evaluations/trace-sets/${encodeURIComponent(run.id)}/review?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, decision, note: reviewNote }) },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to update review state");
      setRun(payload as TraceSetEvaluationRunView);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to update review state");
    } finally {
      setReviewing(false);
    }
  };

  const rerunEvaluation = async () => {
    if (!activeWorkspaceId || !run || rerunning) return;
    setRerunning(true);
    setError(null);
    try {
      const body = run.datasetId
        ? { datasetId: run.datasetId, candidatePromptVersionId: run.candidatePromptVersionId }
        : { sourceTraceIds: run.sourceTraceIds, candidatePromptVersionId: run.candidatePromptVersionId };
      const response = await fetch(
        `/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create re-run");
      window.location.href = `/evaluations/${payload.id}?org=${encodeURIComponent(activeWorkspaceId)}`;
    } catch (rerunError) {
      setError(rerunError instanceof Error ? rerunError.message : "Failed to re-run evaluation");
    } finally {
      setRerunning(false);
    }
  };

  const isDatasetRun = Boolean(run?.datasetId);
  const rec = run?.aggregate.recommendation ?? "needs_review";
  const recStyle = recommendationStyle(rec);

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Evaluation run"
        subtitle={
          run
            ? `${run.promptName} @ ${run.candidateVersionTag}${run.datasetName ? ` · ${run.datasetName}` : ""}`
            : runId
        }
      />
      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {loading || !run ? (
          <EvaluationLoadingSkeleton itemCount={run?.aggregate.total ?? 0} />
        ) : (
          <>
            {/* ── Aggregate banner ── */}
            <AggregateBanner run={run} />

            {/* ── Scoring explainer ── */}
            <ScoringExplainer isDatasetRun={isDatasetRun} />

            {/* ── Main grid ── */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">

              {/* ── Per-item results ── */}
              <div className="space-y-3" ref={resultsRef}>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">
                    {isDatasetRun ? "Dataset item results" : "Per-trace results"}
                    <span className="ml-2 text-muted-foreground font-normal">({run.results.length} items)</span>
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400" />{run.aggregate.succeeded} passed</span>
                    {run.aggregate.failed > 0 && <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-red-400" />{run.aggregate.failed} failed</span>}
                  </div>
                </div>

                {run.results.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    No results recorded for this run.
                  </div>
                ) : (
                  run.results.map((result, i) => (
                    <ResultCard
                      key={`${result.sourceTraceId}-${i}`}
                      result={result}
                      index={i}
                      workspaceId={activeWorkspaceId ?? ""}
                      isDatasetRun={isDatasetRun}
                    />
                  ))
                )}
              </div>

              {/* ── Sidebar: review + actions ── */}
              <div className="space-y-4">
                {/* Recommendation card */}
                <Card className={`border ${recStyle.bg}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className={recStyle.text}>{recStyle.icon}</span>
                      <span className={`capitalize ${recStyle.text}`}>{rec.replaceAll("_", " ")}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    {run.aggregate.reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0">·</span>{r}
                      </div>
                    ))}
                    {(run.aggregate.unresolvedFlagCount ?? 0) > 0 && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-amber-200">
                        ⚑ {run.aggregate.unresolvedFlagCount} source trace(s) have unresolved flags. Resolve before promoting.
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Stats mini grid */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Score", value: run.aggregate.score === null ? "—" : `${Math.round(run.aggregate.score * 100)}%` },
                    { label: "Confidence", value: run.aggregate.confidence === null ? "—" : `${Math.round(run.aggregate.confidence * 100)}%` },
                    { label: "Critical fails", value: String(run.aggregate.criticalFailures) },
                    { label: "Observability", value: run.aggregate.observabilityLevel },
                    ...(run.aggregate.averageLatencyDeltaMs !== null ? [{ label: "Avg latency Δ", value: `${Math.round(run.aggregate.averageLatencyDeltaMs)}ms` }] : []),
                    ...(run.aggregate.averageTokenDelta !== null ? [{ label: "Avg token Δ", value: `${Math.round(run.aggregate.averageTokenDelta)}` }] : []),
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg border border-border bg-card px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                      <div className="mt-0.5 text-sm font-semibold">{value}</div>
                    </div>
                  ))}
                </div>

                {/* Review panel */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Human review</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Current status</span>
                      <span className="font-semibold capitalize">{run.review.status.replaceAll("_", " ")}</span>
                    </div>
                    <textarea
                      className="min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                      placeholder="Reviewer rationale (optional)"
                      value={reviewNote}
                      onChange={e => setReviewNote(e.target.value)}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60">
                          <span className="truncate text-left">
                            {pendingReviewStatus
                              ? ({ in_review: "Mark in review", needs_changes: "Request changes", rejected: "Reject", approved: "Approve" } as Record<string, string>)[pendingReviewStatus] ?? pendingReviewStatus
                              : <span className="text-muted-foreground">Select action…</span>}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuRadioGroup value={pendingReviewStatus} onValueChange={v => setPendingReviewStatus(v)}>
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
                      disabled={reviewing || !pendingReviewStatus}
                      onClick={() => {
                        const actionMap: Record<string, TraceSetEvaluationRunView["review"]["decision"]> = {
                          in_review: "start_review",
                          needs_changes: "request_changes",
                          rejected: "reject",
                          approved: "approve",
                        };
                        if (pendingReviewStatus && actionMap[pendingReviewStatus]) {
                          void submitReview(pendingReviewStatus as TraceSetEvaluationRunView["review"]["status"], actionMap[pendingReviewStatus]!);
                          setPendingReviewStatus("");
                        }
                      }}
                    >
                      {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Submit review
                    </Button>
                  </CardContent>
                </Card>

                {/* Promote + re-run */}
                <div className="space-y-2">
                  <Button
                    className="w-full gap-2"
                    onClick={approveRun}
                    disabled={approving || run.status === "approved" || !run.promotion.allowed}
                  >
                    {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {run.status === "approved" ? "Version promoted ✓" : "Promote to rollout"}
                  </Button>

                  {!run.promotion.allowed && (
                    <div className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <div className="font-semibold mb-1">Blocked because:</div>
                      {run.promotion.reasons.map((r, i) => (
                        <div key={i} className="flex items-start gap-1.5"><span className="shrink-0">·</span>{r}</div>
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

                  <Button variant="outline" size="sm" className="w-full gap-2" onClick={rerunEvaluation} disabled={rerunning}>
                    {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Re-run evaluation
                  </Button>

                  {(run.review.status === "rejected" || rec === "blocked" || rec === "regression_detected") && (
                    <p className="text-center text-xs text-muted-foreground">Fix the prompt, then re-run to clear the block.</p>
                  )}
                  {run.review.status === "pending_review" && (
                    <p className="text-center text-xs text-muted-foreground">Complete the review above before promoting.</p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
