"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FlaskConical,
  Loader2,
  Lock,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Types ────────────────────────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  { id: "gpt-4o",              label: "GPT-4o",               provider: "OpenAI",    color: "bg-green-500/10 text-green-600 dark:text-green-400"  },
  { id: "gpt-4o-mini",         label: "GPT-4o Mini",          provider: "OpenAI",    color: "bg-green-500/10 text-green-600 dark:text-green-400"  },
  { id: "claude-3-5-sonnet",   label: "Claude 3.5 Sonnet",    provider: "Anthropic", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { id: "claude-3-haiku",      label: "Claude 3 Haiku",       provider: "Anthropic", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { id: "gemini-1.5-pro",      label: "Gemini 1.5 Pro",       provider: "Google",    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400"     },
  { id: "gemini-1.5-flash",    label: "Gemini 1.5 Flash",     provider: "Google",    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400"     },
] as const;

type ModelId = typeof AVAILABLE_MODELS[number]["id"];

interface EvalResult {
  modelId: ModelId;
  output: string;
  latencyMs: number;
  estimatedCostUsd: number;
  score: number | null;
  scoreReasoning: string | null;
  error: string | null;
}

// ─── Paywall ──────────────────────────────────────────────────────────────────

function EvaluationsPaywall() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-24">
      <div className="mx-auto w-full max-w-lg text-center space-y-8">
        {/* Icon */}
        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          <div className="absolute inset-0 rounded-3xl bg-primary/10 blur-xl" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-primary/20 bg-card shadow-xl">
            <FlaskConical className="h-10 w-10 text-primary" />
            <div className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/10">
              <Lock className="h-3.5 w-3.5 text-amber-500" />
            </div>
          </div>
        </div>

        {/* Copy */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary">
            <Sparkles className="h-3 w-3" />
            Team Plan Feature
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Unlock Prompt Evaluations
          </h2>
          <p className="text-base leading-7 text-muted-foreground">
            Test your prompts against multiple models simultaneously and get
            automated quality scoring. Upgrade to the Team plan to access
            advanced AI engineering tools.
          </p>
        </div>

        {/* Feature bullets */}
        <div className="grid gap-3 text-left">
          {[
            { icon: Zap,          text: "Fan-out execution across 6 models in parallel"          },
            { icon: Trophy,       text: "Auto-graded quality scores with AI judge reasoning"     },
            { icon: CheckCircle2, text: "Side-by-side latency and cost comparison"               },
            { icon: Sparkles,     text: "Winner recommendation based on quality/speed tradeoff"  },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <Button asChild size="lg" className="h-12 w-full gap-2 text-sm font-semibold">
          <Link href="/settings/billing">
            <CreditCard className="h-4 w-4" />
            Upgrade to Team ($19.99/mo)
          </Link>
        </Button>

        <p className="text-xs text-muted-foreground">
          No lock-in. Cancel or downgrade anytime from billing settings.
        </p>
      </div>
    </div>
  );
}

// ─── Model selector ───────────────────────────────────────────────────────────

function ModelSelector({
  selected,
  onChange,
}: {
  selected: ModelId[];
  onChange: (ids: ModelId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (id: ModelId) => {
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-xl border border-input bg-background px-3 py-2.5 text-sm transition-colors hover:bg-accent/30"
      >
        <span className="text-muted-foreground">
          {selected.length === 0
            ? "Select models…"
            : `${selected.length} model${selected.length !== 1 ? "s" : ""} selected`}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          {AVAILABLE_MODELS.map((model) => {
            const checked = selected.includes(model.id);
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => toggle(model.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/40 ${checked ? "bg-primary/5" : ""}`}
              >
                <div
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                >
                  {checked && <CheckCircle2 className="h-3 w-3" />}
                </div>
                <div className="flex-1">
                  <span className="font-medium">{model.label}</span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${model.color}`}>
                  {model.provider}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const m = AVAILABLE_MODELS.find((x) => x.id === id)!;
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${m.color} border border-current/20 transition-opacity hover:opacity-70`}
              >
                {m.label} ×
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({
  result,
  isWinner,
}: {
  result: EvalResult;
  isWinner: boolean;
}) {
  const model = AVAILABLE_MODELS.find((m) => m.id === result.modelId);

  const scoreColor =
    result.score === null
      ? "text-muted-foreground"
      : result.score >= 8
      ? "text-emerald-600 dark:text-emerald-400"
      : result.score >= 5
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  return (
    <Card className={`relative overflow-hidden transition-all ${isWinner ? "ring-2 ring-primary shadow-lg" : ""}`}>
      {isWinner && (
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
          <Trophy className="h-3 w-3" />
          Best
        </div>
      )}
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 pr-16">
          <div>
            <CardTitle className="text-base">{model?.label ?? result.modelId}</CardTitle>
            <CardDescription>
              <span className={`text-xs font-semibold ${model?.color}`}>{model?.provider}</span>
            </CardDescription>
          </div>
        </div>

        {/* Metrics row */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Latency</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {result.error ? "—" : `${result.latencyMs} ms`}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Cost</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {result.error ? "—" : `$${result.estimatedCostUsd.toFixed(4)}`}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Quality</p>
            <p className={`mt-0.5 text-sm font-semibold tabular-nums ${scoreColor}`}>
              {result.score !== null ? `${result.score}/10` : "—"}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {result.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {result.error}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
              {result.output}
            </p>
          </div>
        )}

        {result.scoreReasoning && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              View judge reasoning
            </summary>
            <p className="mt-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
              {result.scoreReasoning}
            </p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main evaluation UI ───────────────────────────────────────────────────────

function EvaluationRuntime() {
  const { activeWorkspaceId } = useWorkspace();

  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful and concise assistant. Answer accurately and briefly.",
  );
  const [userMessage, setUserMessage] = useState(
    "Explain the difference between a transformer and an RNN in two sentences.",
  );
  const [selectedModels, setSelectedModels] = useState<ModelId[]>(["gpt-4o", "claude-3-5-sonnet"]);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [running, setRunning] = useState(false);
  const [grading, setGrading] = useState(false);
  const [winnerId, setWinnerId] = useState<ModelId | null>(null);

  const canRun = selectedModels.length > 0 && systemPrompt.trim() && userMessage.trim() && !running;

  async function runEvaluation() {
    if (!canRun || !activeWorkspaceId) return;
    setRunning(true);
    setResults([]);
    setWinnerId(null);

    try {
      const res = await fetch(
        `/api/eval/run?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemPrompt, userMessage, models: selectedModels }),
        },
      );
      const data = (await res.json()) as { results?: EvalResult[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Evaluation failed");

      const rawResults = data.results ?? [];
      setResults(rawResults);

      // Auto-grade successful results
      const successfulResults = rawResults.filter((r) => !r.error);
      if (successfulResults.length > 0) {
        setGrading(true);
        const gradeRes = await fetch(
          `/api/eval/grade?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemPrompt,
              userMessage,
              results: successfulResults.map((r) => ({
                modelId: r.modelId,
                output: r.output,
              })),
            }),
          },
        );
        const gradeData = (await gradeRes.json()) as {
          grades?: Array<{ modelId: ModelId; score: number; reasoning: string }>;
          error?: string;
        };

        if (gradeRes.ok && gradeData.grades) {
          const gradeMap = new Map(gradeData.grades.map((g) => [g.modelId, g]));
          setResults((prev) =>
            prev.map((r) => {
              const grade = gradeMap.get(r.modelId);
              return grade
                ? { ...r, score: grade.score, scoreReasoning: grade.reasoning }
                : r;
            }),
          );

          // Pick winner: highest score, tie-break by lowest latency
          const graded = rawResults
            .map((r) => ({ ...r, ...gradeMap.get(r.modelId) }))
            .filter((r) => !r.error && r.score != null);
          graded.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.latencyMs - b.latencyMs);
          if (graded[0]) setWinnerId(graded[0].modelId as ModelId);
        }
        setGrading(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setRunning(false);
      setGrading(false);
    }
  }

  const winner = results.find((r) => r.modelId === winnerId);
  const winnerModel = AVAILABLE_MODELS.find((m) => m.id === winnerId);

  return (
    <div className="space-y-6">
      {/* Input zone */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: prompts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prompt Configuration</CardTitle>
            <CardDescription>
              Define the system context and the test input to evaluate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                System Prompt
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={5}
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm leading-6 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="You are a helpful assistant…"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                User Test Case
              </label>
              <textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm leading-6 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="The user message to test against all selected models…"
              />
            </div>
          </CardContent>
        </Card>

        {/* Right: model selection + run */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Target Models</CardTitle>
            <CardDescription>
              Select which models to run this evaluation against simultaneously.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Models
              </label>
              <ModelSelector selected={selectedModels} onChange={setSelectedModels} />
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                What happens next
              </p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex items-center gap-2"><Zap className="h-3 w-3 text-primary" /> All models execute in parallel</li>
                <li className="flex items-center gap-2"><FlaskConical className="h-3 w-3 text-primary" /> GPT-4o Mini grades each output</li>
                <li className="flex items-center gap-2"><Trophy className="h-3 w-3 text-primary" /> Winner is recommended by score + speed</li>
              </ul>
            </div>

            <Button
              onClick={() => void runEvaluation()}
              disabled={!canRun}
              className="h-11 w-full gap-2 font-semibold"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {grading ? "Grading outputs…" : "Running evaluations…"}
                </>
              ) : (
                <>
                  <FlaskConical className="h-4 w-4" />
                  Run Evaluation ({selectedModels.length} model{selectedModels.length !== 1 ? "s" : ""})
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Winner banner */}
      {winner && winnerModel && (
        <div className="flex items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 px-6 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Trophy className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              Recommended: <span className="text-primary">{winnerModel.label}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Scored {winner.score}/10 quality · {winner.latencyMs} ms latency ·{" "}
              ${winner.estimatedCostUsd.toFixed(4)} per call
            </p>
          </div>
          <Badge variant="default" className="shrink-0">
            Score {winner.score}/10
          </Badge>
        </div>
      )}

      {/* Results arena */}
      {results.length > 0 && (
        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Results Arena
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {results.map((result) => (
              <ResultCard
                key={result.modelId}
                result={result}
                isWinner={result.modelId === winnerId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {running && results.length === 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {selectedModels.map((id) => (
            <Card key={id} className="animate-pulse">
              <CardHeader>
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="mt-2 h-3 w-20 rounded bg-muted" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-12 rounded-lg bg-muted" />
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-24 rounded-lg bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EvaluationsPage() {
  const { planTier } = useWorkspace();
  const isPaid = planTier === "team" || planTier === "pro" || planTier === "enterprise";

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Prompt Evaluations"
        subtitle="Run your prompts against multiple models simultaneously and get automated quality scoring."
        actions={
          isPaid ? (
            <Badge variant="default" className="gap-1">
              <Sparkles className="h-3 w-3" />
              Team
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-amber-400/30 text-amber-600 dark:text-amber-400">
              <Lock className="h-3 w-3" />
              Team Plan
            </Badge>
          )
        }
      />

      {isPaid ? (
        <div className="px-4 py-6 md:px-6 xl:px-8">
          <EvaluationRuntime />
        </div>
      ) : (
        <EvaluationsPaywall />
      )}
    </div>
  );
}
