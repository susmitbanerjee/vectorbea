"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/choice";
import { formatCost, formatDuration } from "~/lib/format";
import { nodeInputs } from "./node-inputs";
import { useBuilderRegistry } from "../use-builder-registry";
import type { VersionNode } from "~/mocks/workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   ADVANCED

   Two things here did not exist anywhere in the product and both matter more
   than their placement on a fifth tab suggests.

   THE RETRY TIMELINE. A retry policy is four numbers whose consequence is a
   sequence of times, and nobody computes exponential backoff in their head
   correctly. "attempts at 0s, 2s, 6s, 14s — gives up after 30s" is the same
   policy stated as what will happen, and it is checkable at a glance against
   the timeout above it.

   THE IDEMPOTENCY KEY. In a durable-execution product a retried side effect
   that is not idempotent sends the email twice. The key is what makes a retry
   safe, it was absent from the UI entirely, and the default — keying on the run
   id — is the one that looks right and silently is not: it deduplicates retries
   of the SAME run while letting a re-run of the same input fire again.
══════════════════════════════════════════════════════════════════════════════ */

export interface AdvancedConfig {
  retry: { attempts: number; backoff: BackoffStrategy; baseDelayMs: number; maxDelayMs: number; jitter: boolean };
  timeoutMs: number;
  idempotencyKey: string;
  errorPolicy: ErrorPolicy;
  fallbackNodeId: string | null;
  checkpoint: boolean;
  maxConcurrency: number;
  rateLimitPerMinute: number | null;
  skipIf: string;
  costCeilingUsd: number | null;
}

export type BackoffStrategy = "fixed" | "linear" | "exponential" | "exponential-jitter";
export type ErrorPolicy = "fail-run" | "continue" | "error-path" | "fallback";

const BACKOFF_LABEL: Record<BackoffStrategy, string> = {
  fixed: "Fixed",
  linear: "Linear",
  exponential: "Exponential",
  "exponential-jitter": "Exponential with jitter",
};

const ERROR_POLICY_LABEL: Record<ErrorPolicy, string> = {
  "fail-run": "Fail the run",
  continue: "Continue to the next step",
  "error-path": "Route to the error path",
  fallback: "Run a fallback step",
};

const ERROR_POLICY_HELP: Record<ErrorPolicy, string> = {
  "fail-run": "The run stops and is marked failed. Everything committed before this stays committed, so a retry resumes here rather than from the start.",
  continue: "The failure is recorded and the run carries on with a null result. Only correct when the rest of the work is genuinely independent of this step.",
  "error-path": "The run follows this node's error edge. Use it to notify, compensate, or clean up before stopping.",
  fallback: "A named step runs instead. Use it for a cheaper or more reliable alternative to the same work.",
};

/** The times each attempt fires, given a policy. */
export function attemptSchedule(retry: AdvancedConfig["retry"]): number[] {
  const times = [0];
  let delay = retry.baseDelayMs;

  for (let attempt = 1; attempt < retry.attempts; attempt += 1) {
    times.push(times[times.length - 1] + Math.min(delay, retry.maxDelayMs));
    switch (retry.backoff) {
      case "fixed": break;
      case "linear": delay += retry.baseDelayMs; break;
      case "exponential":
      case "exponential-jitter": delay *= 2; break;
    }
  }

  return times;
}

export function AdvancedTab({
  node, config, onChange, workflowBudgetMs, nodeNames,
}: {
  node: VersionNode;
  config: AdvancedConfig;
  onChange: (next: Partial<AdvancedConfig>) => void;
  workflowBudgetMs: number;
  nodeNames: { id: string; name: string }[];
}) {
  const registry = useBuilderRegistry();
  const schedule = React.useMemo(() => attemptSchedule(config.retry), [config.retry]);
  const totalMs = schedule[schedule.length - 1] + config.timeoutMs;
  const overBudget = totalMs > workflowBudgetMs;
  const inputs = React.useMemo(() => nodeInputs(node, registry), [node, registry]);

  const idempotencyIsRunScoped = config.idempotencyKey.includes("{{run.id}}");
  const hasSideEffects = node.kind === "tool" || node.kind === "output";

  return (
    <div className="grid gap-4 p-3">
      {/* ── Retry ────────────────────────────────────────────────────────── */}
      <Section title="Retry policy" help="What happens when this step throws. Committed work upstream is never replayed — a retry resumes here.">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Max attempts" help="Including the first. 1 means no retry.">
            <Input
              type="number" min={1} max={10}
              value={config.retry.attempts}
              onChange={(e) => onChange({ retry: { ...config.retry, attempts: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } })}
              className="h-7 text-body-sm"
            />
          </Field>
          <Field label="Backoff" help="How the wait grows between attempts.">
            <Select
              options={(Object.keys(BACKOFF_LABEL) as BackoffStrategy[]).map((b) => ({ value: b, label: BACKOFF_LABEL[b] }))}
              value={config.retry.backoff}
              onValueChange={(v) => onChange({ retry: { ...config.retry, backoff: v as BackoffStrategy } })}
              aria-label="Backoff strategy"
            />
          </Field>
          <Field label="Base delay" help="The first wait, in seconds.">
            <Input
              type="number" min={0} step={0.5}
              value={config.retry.baseDelayMs / 1000}
              onChange={(e) => onChange({ retry: { ...config.retry, baseDelayMs: Math.max(0, Number(e.target.value) * 1000) } })}
              className="h-7 text-body-sm"
            />
          </Field>
          <Field label="Max delay" help="Ceiling on any single wait, in seconds.">
            <Input
              type="number" min={1}
              value={config.retry.maxDelayMs / 1000}
              onChange={(e) => onChange({ retry: { ...config.retry, maxDelayMs: Math.max(1000, Number(e.target.value) * 1000) } })}
              className="h-7 text-body-sm"
            />
          </Field>
        </div>

        <label className="mt-2 flex items-start gap-2">
          <Switch
            checked={config.retry.jitter}
            onCheckedChange={(v) => onChange({ retry: { ...config.retry, jitter: v } })}
          />
          <span className="min-w-0">
            <Text variant="body-sm" tone="primary" className="block">Add jitter</Text>
            <Text variant="caption" tone="muted" className="block leading-snug">
              Randomises each wait by up to ±25%. Without it, a hundred runs failing on the same
              dependency retry in lockstep and hit it again simultaneously.
            </Text>
          </span>
        </label>

        <RetryTimeline schedule={schedule} timeoutMs={config.timeoutMs} jitter={config.retry.jitter} />
      </Section>

      {/* ── Timeout ──────────────────────────────────────────────────────── */}
      <Section title="Timeout" help="How long one attempt may run before it is abandoned.">
        <Field label="Timeout" help="Seconds. Applies per attempt, not to the step as a whole.">
          <Input
            type="number" min={1}
            value={config.timeoutMs / 1000}
            onChange={(e) => onChange({ timeoutMs: Math.max(1000, Number(e.target.value) * 1000) })}
            className="h-7 text-body-sm"
          />
        </Field>
        <Text
          variant="caption"
          tone={overBudget ? "inherit" : "muted"}
          className={cn("mt-1 block leading-snug", overBudget && "text-status-waiting")}
        >
          {overBudget
            ? `Worst case ${formatDuration(totalMs)} across ${config.retry.attempts} attempts, past the ${formatDuration(workflowBudgetMs)} workflow budget. The run would be cut off mid-retry.`
            : `Worst case ${formatDuration(totalMs)} across ${config.retry.attempts} attempts, inside the ${formatDuration(workflowBudgetMs)} workflow budget.`}
        </Text>
      </Section>

      {/* ── Idempotency ──────────────────────────────────────────────────── */}
      <Section
        title="Idempotency key"
        help="What makes a retry safe. Two executions carrying the same key are treated as one — the second is deduplicated rather than performed again."
      >
        <Field label="Key expression" help="Bind it to whatever identifies the work, not the attempt.">
          <Input
            value={config.idempotencyKey}
            onChange={(e) => onChange({ idempotencyKey: e.target.value })}
            placeholder="{{ input.accountId }}"
            spellCheck={false}
            className="h-7 font-code text-mono-sm"
          />
        </Field>

        {inputs.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Text variant="caption" tone="muted" className="mr-1">Bind to:</Text>
            {inputs.slice(0, 4).map((input) => (
              <button
                key={input.id}
                type="button"
                onClick={() => onChange({ idempotencyKey: `{{ input.${input.id} }}` })}
                className={cn(
                  "font-code text-mono-sm border-subtle text-fg-secondary rounded-xs border px-1 py-px",
                  "hover:border-accent-border hover:text-accent transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring",
                )}
              >
                {input.id}
              </button>
            ))}
          </div>
        ) : null}

        {hasSideEffects && idempotencyIsRunScoped ? (
          <div className="border-status-waiting-border bg-status-waiting-subtle mt-2 rounded-sm border px-2 py-1.5">
            <Text variant="caption" tone="inherit" className="text-status-waiting block">
              Keyed on the run, which is narrower than it looks
            </Text>
            <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
              A retry of <em>this</em> run is deduplicated. A re-run over the same input is not — so
              re-processing yesterday&apos;s batch would {node.kind === "tool" ? "call the tool" : "emit"} a
              second time. Key on the thing being acted on, such as an account or invoice id.
            </Text>
          </div>
        ) : null}
      </Section>

      {/* ── Error handling ───────────────────────────────────────────────── */}
      <Section title="Error handling" help="What the run does once the retries are exhausted.">
        <Select
          options={(Object.keys(ERROR_POLICY_LABEL) as ErrorPolicy[]).map((p) => ({ value: p, label: ERROR_POLICY_LABEL[p] }))}
          value={config.errorPolicy}
          onValueChange={(v) => onChange({ errorPolicy: v as ErrorPolicy })}
          aria-label="Error policy"
        />
        <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
          {ERROR_POLICY_HELP[config.errorPolicy]}
        </Text>

        {config.errorPolicy === "fallback" ? (
          <div className="mt-2">
            <Field label="Fallback step" help="Runs in place of this one when it fails.">
              <Select
                options={nodeNames.filter((n) => n.id !== node.id).map((n) => ({ value: n.id, label: n.name }))}
                value={config.fallbackNodeId ?? ""}
                onValueChange={(v) => onChange({ fallbackNodeId: v })}
                placeholder="Choose a step"
                aria-label="Fallback step"
              />
            </Field>
          </div>
        ) : null}
      </Section>

      {/* ── Checkpoint ───────────────────────────────────────────────────── */}
      <Section title="Checkpoint" help="Whether the run commits after this step.">
        <label className="flex items-start gap-2">
          <Switch checked={config.checkpoint} onCheckedChange={(v) => onChange({ checkpoint: v })} />
          <span className="min-w-0">
            <Text variant="body-sm" tone="primary" className="block">Commit after this step</Text>
            <Text variant="caption" tone="muted" className="block leading-snug">
              On by default. A commit costs one durable write — a few milliseconds — and buys the
              guarantee that a crash after this point resumes here instead of replaying the work.
              Turn it off only for steps that are cheap to repeat and have no side effects.
            </Text>
          </span>
        </label>
      </Section>

      {/* ── Concurrency, conditional, cost ───────────────────────────────── */}
      <Section
        title="Limits"
        help="Bounds on how hard this step may run. Skip if is enforced by the runtime; the other three are recorded and not yet applied."
      >
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Max concurrency"
            help="Simultaneous executions of this step across the workspace. Recorded, not yet enforced — the run pool bounds concurrency workspace-wide today, not per step."
          >
            <Input
              type="number" min={1}
              value={config.maxConcurrency}
              onChange={(e) => onChange({ maxConcurrency: Math.max(1, Number(e.target.value) || 1) })}
              className="h-7 text-body-sm"
            />
          </Field>
          <Field
            label="Rate limit"
            help="Executions per minute. Blank for none. Recorded, not yet enforced — provider rate limits are handled by backoff at the call site."
          >
            <Input
              type="number" min={0}
              value={config.rateLimitPerMinute ?? ""}
              onChange={(e) => onChange({ rateLimitPerMinute: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="None"
              className="h-7 text-body-sm"
            />
          </Field>
        </div>

        <div className="mt-2">
          <Field
            label="Cost ceiling"
            help="USD per execution. Recorded, not yet enforced — the run-level budget ceiling is what currently halts spend."
          >
            <Input
              type="number" min={0} step={0.001}
              value={config.costCeilingUsd ?? ""}
              onChange={(e) => onChange({ costCeilingUsd: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="None"
              className="h-7 text-body-sm"
            />
          </Field>
          {config.costCeilingUsd ? (
            <Text variant="caption" tone="muted" className="mt-1 block">
              Recorded as {formatCost(config.costCeilingUsd)}. Per-step ceilings are not enforced yet —
              the run-level budget in workspace settings is what stops a run today.
            </Text>
          ) : null}
        </div>

        <div className="mt-2">
          <Field
            label="Skip if"
            help={
              "An expression evaluated against this step's resolved inputs. When it is true the " +
              "step is skipped and the run continues down its normal edges. Comparisons only — " +
              "input.amount < 100, or output.status == 'open' — and anything the engine cannot " +
              "parse runs the step rather than silently omitting it."
            }
          >
            <Input
              value={config.skipIf}
              onChange={(e) => onChange({ skipIf: e.target.value })}
              placeholder="{{ input.amount }} < 100"
              spellCheck={false}
              className="h-7 font-code text-mono-sm"
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}

/* ── The retry timeline ───────────────────────────────────────────────────── */

/**
 * The policy rendered as when things happen.
 *
 * Ticks are placed on a SQUARE-ROOT scale, not a linear one. Exponential
 * backoff puts the first three attempts inside the first few seconds and the
 * last one minutes later; linearly, the early attempts collapse into a single
 * smudge at the left edge — which is precisely the part a person is trying to
 * read.
 */
function RetryTimeline({
  schedule, timeoutMs, jitter,
}: {
  schedule: number[];
  timeoutMs: number;
  jitter: boolean;
}) {
  const total = schedule[schedule.length - 1] + timeoutMs;
  const scale = (ms: number) => (total === 0 ? 0 : Math.sqrt(ms / total) * 100);

  return (
    <div className="border-subtle bg-surface-sunken mt-3 rounded-md border p-2.5">
      <Text variant="caption" tone="muted" className="block">
        {schedule.length === 1
          ? "One attempt, no retry."
          : `${schedule.length} attempts at ${schedule.map((t) => `${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}s`).join(", ")}`}
      </Text>

      <div className="relative mt-3 h-8">
        <span className="bg-border-subtle absolute inset-x-0 top-3 h-px" aria-hidden="true" />

        {schedule.map((t, i) => (
          <span
            key={i}
            className="absolute top-0 -translate-x-1/2"
            style={{ left: `${Math.min(97, Math.max(3, scale(t)))}%` }}
          >
            <span
              className={cn(
                "block size-2 rounded-full",
                i === 0 ? "bg-accent" : "bg-status-waiting",
              )}
              style={{ marginTop: 8 }}
              aria-hidden="true"
            />
            <span className="font-code text-fg-muted absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap text-[9px] tabular">
              {t === 0 ? "0s" : `${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}s`}
            </span>
          </span>
        ))}

        <span
          className="absolute top-0 -translate-x-1/2"
          style={{ left: "100%" }}
        >
          <span className="bg-status-failed block size-2 rounded-full" style={{ marginTop: 8 }} aria-hidden="true" />
          <span className="font-code text-status-failed absolute right-0 top-5 whitespace-nowrap text-[9px] tabular">
            gives up {formatDuration(total)}
          </span>
        </span>
      </div>

      <Text variant="caption" tone="muted" className="mt-4 block leading-snug">
        {jitter
          ? "Each wait is randomised by up to ±25%, so the marks above are the centre of a spread rather than exact times."
          : "Exact times. Every run failing on the same dependency will retry at these instants together."}
      </Text>
      <span className="sr-only">
        Attempts fire at {schedule.map((t) => `${(t / 1000).toFixed(1)} seconds`).join(", ")}. The step
        gives up after {formatDuration(total)}.
      </span>
    </div>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function Section({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
      <Text variant="label" tone="primary" className="block">{title}</Text>
      <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">{help}</Text>
      {children}
    </section>
  );
}

function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1">
      <Text variant="caption" tone="secondary">{label}</Text>
      {children}
      <Text variant="caption" tone="muted" className="leading-snug">{help}</Text>
    </label>
  );
}
