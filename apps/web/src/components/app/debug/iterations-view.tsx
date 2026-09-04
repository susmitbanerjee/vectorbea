"use client";

import * as React from "react";
import {
  ArrowClockwise, Butterfly, Prohibit, Scissors, Wrench,
} from "@phosphor-icons/react/dist/ssr";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatCostCents, formatDuration, formatTokens } from "~/lib/format";
import type {
  ActivationDetail, Iteration, IterationBudget, PayloadRef, TraceApi,
} from "~/lib/api/trace";
import { TONE, toneForNodeStatus } from "./status-vocabulary";
import { StatusPill } from "./primitives";

/**
 * The inspector: one activation's iterations down the left, the detail on the
 * right. Layout follows §5.5.
 *
 * ── THE FOUR DECISIONS THAT MAKE OR BREAK THIS VIEW ─────────────────────────
 *
 * 1. PROMPT AND RESPONSE COLLAPSED, AND NOT LOADED. Expanded they drown the
 *    page; absent the tab is useless to the one person who can fix the run. So
 *    the panel renders from metadata — size, truncation, redactions — and the
 *    bytes are fetched on the click that reveals them. A 40-iteration
 *    activation costs one request and no prompt content.
 *
 * 2. THE TRUNCATION WARNING SITS ON THE PROMPT, naming the sections that were
 *    dropped. An agent that "ignored" an instruction it was never shown is the
 *    hardest agent failure to diagnose, and a warning in a separate panel is a
 *    warning nobody reads.
 *
 * 3. A REPAIRED ACTION SAYS SO. An unparseable response is turned into a THINK
 *    so the loop can continue; unmarked, the trace shows deliberation where
 *    there was a parse failure and sends the reader to the prompt when the
 *    problem is the response format.
 *
 * 4. A CACHED TOOL RESULT SAYS SO. The guard replays a previous identical call,
 *    so the observation the model read is the OLD result. A reader shown it
 *    unmarked concludes an external system is serving stale data.
 */
export function IterationsView({
  api,
  runId,
  focus,
  selectedSpanId,
  onSelectSpan,
}: {
  api: TraceApi;
  runId: string;
  /**
   * Open on this step, rather than on the first one.
   *
   * The Activity view's rows each offer "Step N details", and landing on
   * iteration 1 of activation 1 after clicking one would make that control a lie.
   * Only the INITIAL selection: once the reader picks something here, their
   * choice wins, which is why this is read as a fallback and not as state.
   */
  focus?: { stepId: string; iteration: number } | null;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
}) {
  const [data, setData] = React.useState<ActivationDetail[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeStep, setActiveStep] = React.useState<string | null>(null);
  const [activeIteration, setActiveIteration] = React.useState<number | null>(null);
  const [diffWith, setDiffWith] = React.useState<number | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    api.iterations(runId, ac.signal)
      .then((r) => setData(r.activations))
      .catch((e: unknown) => { if (!isAborted(e)) setError(messageOf(e)); });
    return () => ac.abort();
  }, [api, runId]);

  const activation =
    data?.find((a) => a.stepId === activeStep)
    ?? data?.find((a) => a.stepId === focus?.stepId)
    ?? data?.[0]
    ?? null;
  const iteration =
    activation?.iterations.find((i) => i.number === activeIteration)
    ?? (focus && activation?.stepId === focus.stepId
      ? activation.iterations.find((i) => i.number === focus.iteration)
      : undefined)
    ?? activation?.iterations[0]
    ?? null;

  if (error) return <Panel tone="failed">{error}</Panel>;
  if (!data) return <LoadingRail />;
  if (data.length === 0) {
    return (
      <Panel tone="neutral">
        No agent iterations were recorded for this run. Only a run with an agent
        step produces them.
      </Panel>
    );
  }

  return (
    <div className="flex gap-4">
      {/* ── Left rail ─────────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 space-y-3">
        {data.length > 1 && (
          <label className="block">
            <span className="text-xs text-fg-muted">Agent</span>
            <select
              value={activation?.stepId ?? ""}
              onChange={(e) => { setActiveStep(e.target.value); setActiveIteration(null); }}
              className={selectClass}
            >
              {data.map((a) => (
                <option key={a.stepId} value={a.stepId}>
                  {a.agentName ?? a.stepId} · {a.iterations.length} iterations
                </option>
              ))}
            </select>
          </label>
        )}

        {activation?.replayedFrom && <ReplayBanner note={activation.replayedFrom} />}

        <ol className="space-y-0.5" aria-label="Iterations">
          {activation?.iterations.map((it) => (
            <li key={it.id}>
              <IterationRow
                iteration={it}
                selected={it.number === iteration?.number}
                onSelect={() => {
                  setActiveIteration(it.number);
                  /* Selecting an iteration selects its model call in every other
                     view, so the waterfall and the map follow along. */
                  const span = it.llmCall?.spanId ?? it.toolCall?.spanId;
                  if (span) onSelectSpan(span);
                }}
              />
            </li>
          ))}
        </ol>

        {activation && <BudgetGauges budgets={activation.budgets} stopReason={activation.stopReason} />}

        {/* The prompt diff — usually the fastest route to "the model never got
            the data it needed". */}
        {activation && activation.iterations.length > 1 && (
          <div className="space-y-1 border-t border-subtle pt-3">
            <label className="block text-xs text-fg-muted" htmlFor="diff-with">
              Compare prompt with
            </label>
            <select
              id="diff-with"
              value={diffWith ?? ""}
              onChange={(e) => setDiffWith(e.target.value ? Number(e.target.value) : null)}
              className={selectClass}
            >
              <option value="">None</option>
              {activation.iterations
                .filter((i) => i.number !== iteration?.number && i.llmCall?.hasInput)
                .map((i) => (
                  <option key={i.id} value={i.number}>Iteration {i.number}</option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* ── Right pane ────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        {iteration && activation ? (
          <IterationDetail
            api={api}
            runId={runId}
            iteration={iteration}
            diffAgainst={activation.iterations.find((i) => i.number === diffWith) ?? null}
            selectedSpanId={selectedSpanId}
          />
        ) : (
          <Text variant="body" className="text-fg-secondary">Select an iteration.</Text>
        )}
      </div>
    </div>
  );
}

const selectClass = cn(
  "mt-1 w-full rounded-sm border border-default bg-surface-raised px-2 py-1.5 text-xs",
  "focus-visible:focus-ring",
);

// ── The rail ────────────────────────────────────────────────────────────────

/**
 * One iteration in the list: number, action, duration, status — plus the three
 * markers that say the runtime did something the agent did not.
 */
function IterationRow({
  iteration: it, selected, onSelect,
}: {
  iteration: Iteration;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = TONE[toneForNodeStatus(statusOf(it))];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
        "transition-opacity hover:opacity-90 motion-reduce:transition-none",
        "focus-visible:focus-ring-inset",
        selected && "bg-surface-selected",
        /* Recalled iterations are dimmed: they are real history, but they did
           not happen on this attempt. */
        it.recalled && "opacity-70",
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone.solid)} />
      <span className="w-4 shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
        {it.number}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-fg-primary">
        {it.actionType ?? "—"}
      </span>

      <Markers iteration={it} />

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
        {formatDuration(it.durationMs)}
      </span>
      <span className="sr-only">
        . {TONE[toneForNodeStatus(statusOf(it))].label}.
        {it.recalled && " Recalled from a previous attempt, not run again."}
      </span>
    </button>
  );
}

/**
 * The three things the runtime did that the agent did not.
 *
 * Each is a fact the reader will otherwise get wrong in a specific way, so each
 * gets a glyph AND a title AND a screen-reader sentence.
 */
function Markers({ iteration: it }: { iteration: Iteration }) {
  const marks: Array<{ icon: React.ComponentProps<typeof Icon>["icon"]; label: string; tone: string }> = [];
  if (it.recalled) {
    marks.push({ icon: ArrowClockwise, tone: "text-fg-muted",
      label: "Recalled from the transcript on resume — not run again" });
  }
  if (it.actionRepaired === true) {
    marks.push({ icon: Butterfly, tone: "text-status-waiting",
      label: "The model's response could not be parsed; the runtime repaired it into a THINK" });
  }
  if (it.toolResultCached === true) {
    marks.push({ icon: Prohibit, tone: "text-status-waiting",
      label: "Cached: the guard replayed an earlier identical call instead of executing" });
  }
  if (it.context?.truncated) {
    marks.push({ icon: Scissors, tone: "text-status-waiting",
      label: `Context truncated — dropped ${it.context.droppedSections.join(", ")}` });
  }
  if (marks.length === 0) return null;

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {marks.map((m, i) => (
        <span key={i} title={m.label}>
          <Icon icon={m.icon} size="xs" decorative className={m.tone} />
          <span className="sr-only">. {m.label}.</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Reconstruction fell back to replay.
 *
 * A reader seeing iteration 3 twice deserves to know the second is a replay and
 * why the first could not be reused.
 */
function ReplayBanner({ note }: { note: { reason: string; detail: string | null } }) {
  return (
    <div className="rounded-sm border border-status-waiting-border bg-status-waiting-subtle px-2 py-1.5">
      <Text variant="caption" className="block text-status-waiting">
        Replayed from iteration 1
      </Text>
      <Text variant="caption" className="mt-0.5 block text-fg-secondary">
        The previous transcript could not be reused
        ({note.reason.toLowerCase().replace(/_/g, " ")}
        {note.detail ? `: ${note.detail}` : ""}), so the loop ran again from the
        start. Earlier iterations you may have seen came from that attempt.
      </Text>
    </div>
  );
}

// ── Budget ──────────────────────────────────────────────────────────────────

/**
 * Used against granted, per activation.
 *
 * "It ran out of iterations" should be a full bar, not an inference from a stop
 * reason. A dimension with no granted ceiling renders as a number with no bar
 * rather than a bar against a guess — an invented denominator is worse than an
 * absent one.
 */
function BudgetGauges({
  budgets, stopReason,
}: {
  budgets: IterationBudget[];
  stopReason: string | null;
}) {
  if (budgets.length === 0) {
    return (
      <div className="border-t border-subtle pt-3">
        <span className="text-xs text-fg-muted">Budget</span>
        <Text variant="caption" className="mt-1 block text-fg-muted">
          No budget was granted to this activation, so there are no ceilings to
          show.
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-subtle pt-3">
      <span className="text-xs text-fg-muted">Budget</span>
      {budgets.map((b) => <Gauge key={b.dimension} budget={b} />)}
      {stopReason && (
        <Text variant="caption" className="block text-fg-secondary">
          Stopped: {stopReason.toLowerCase().replace(/_/g, " ")}
        </Text>
      )}
    </div>
  );
}

/**
 * The budget dimensions arrive as the worker names them — `costCents`,
 * `toolCalls`, `max_iterations` — so both shapes are split rather than one.
 * "CostCents" as a label is a field name leaking onto the screen.
 */
export function budgetLabel(dimension: string): string {
  const words = dimension
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One formatter for BOTH halves of the ratio.
 *
 * "$0.21 / 40" was two different units on one line, which reads as a cost
 * against a count. Whatever unit the used value is shown in, the ceiling is
 * shown in the same one.
 */
export function budgetFormat(dimension: string): (n: number) => string {
  const d = dimension.toLowerCase();
  if (d.includes("cost")) return formatCostCents;
  if (d.includes("token")) return formatTokens;
  if (d.includes("ms") || d.includes("time") || d.includes("duration")) return formatDuration;
  return (n) => Math.round(n).toLocaleString();
}

function Gauge({ budget: b }: { budget: IterationBudget }) {
  const pct = b.limit && b.limit > 0 ? Math.min(1, b.used / b.limit) : null;
  const fmt = budgetFormat(b.dimension);

  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-fg-secondary">{budgetLabel(b.dimension)}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-primary">
          {fmt(b.used)}{b.limit != null && ` / ${fmt(b.limit)}`}
        </span>
      </div>
      {pct != null ? (
        <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
          <div
            aria-hidden="true"
            className={cn("h-full rounded-full",
              pct >= 1 ? "bg-status-failed" : pct > 0.9 ? "bg-status-waiting" : "bg-status-live")}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      ) : (
        /* No ceiling: say so once, rather than drawing a bar against nothing. */
        <span className="text-[10px] text-fg-muted">no ceiling granted</span>
      )}
    </div>
  );
}

// ── The detail ──────────────────────────────────────────────────────────────

function IterationDetail({
  api, runId, iteration: it, diffAgainst, selectedSpanId,
}: {
  api: TraceApi;
  runId: string;
  iteration: Iteration;
  diffAgainst: Iteration | null;
  selectedSpanId: string | null;
}) {
  const tone = TONE[toneForNodeStatus(statusOf(it))];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Text variant="body" className="font-medium text-fg-max">
          Iteration {it.number}
        </Text>
        <span className={cn("text-xs", tone.text)}>{it.actionType ?? "—"}</span>
        <StatusPill status={statusOf(it)} />
        <span className="font-mono text-xs tabular-nums text-fg-muted">
          {formatDuration(it.durationMs)}
        </span>
        {it.tokensDelta != null && it.tokensDelta > 0 && (
          <span className="font-mono text-xs tabular-nums text-fg-muted">
            {formatTokens(it.tokensDelta)} tokens
          </span>
        )}
        {it.costDeltaCents != null && it.costDeltaCents > 0 && (
          <span className="font-mono text-xs tabular-nums text-fg-muted">
            {formatCostCents(it.costDeltaCents)}
          </span>
        )}
        {it.recalled && (
          <span className="inline-flex items-center gap-1 rounded-xs border border-subtle px-1.5 py-0.5">
            <Icon icon={ArrowClockwise} size="xs" decorative className="text-fg-muted" />
            <span className="text-[10px] text-fg-secondary">Recalled, not re-run</span>
          </span>
        )}
      </header>

      {/* PROMPT — collapsed, unloaded, and carrying its own truncation warning. */}
      <PayloadPanel
        api={api} runId={runId}
        title="Prompt"
        spanId={it.llmCall?.spanId ?? null}
        side="input"
        present={it.llmCall?.hasInput ?? false}
        bytes={it.llmCall?.inputBytes ?? null}
        context={it.context}
      />

      {/* MODEL RESPONSE beside PARSED ACTION. */}
      <PayloadPanel
        api={api} runId={runId}
        title="Model response"
        spanId={it.llmCall?.spanId ?? null}
        side="output"
        present={it.llmCall?.hasOutput ?? false}
        bytes={it.llmCall?.outputBytes ?? null}
        beside={<ParsedAction iteration={it} />}
      />

      {(it.toolCall || it.actionType === "CALL_TOOL") && <ToolCall iteration={it} />}

      <Observation iteration={it} />

      {diffAgainst && (
        <PromptDiff api={api} runId={runId} a={diffAgainst} b={it} />
      )}

      {selectedSpanId && it.llmCall?.spanId === selectedSpanId && (
        <span className="sr-only">This iteration is selected in the other views.</span>
      )}
    </div>
  );
}

/**
 * The action AS PARSED, beside the raw response it came from.
 *
 * When the model emitted something unparseable and the runtime repaired it into
 * a THINK, that repair is visible AS a repair. Without the marker the trace
 * shows deliberation where there was a parse failure — and the reader goes
 * looking at the prompt when the problem is the response format.
 */
function ParsedAction({ iteration: it }: { iteration: Iteration }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] uppercase tracking-wide text-fg-muted">Parsed action</span>

      {it.actionRepaired === true && (
        <div className="rounded-sm border border-status-waiting-border bg-status-waiting-subtle px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Icon icon={Butterfly} size="xs" decorative className="text-status-waiting" />
            <Text variant="caption" className="text-status-waiting">
              This action was repaired, not chosen
            </Text>
          </div>
          <Text variant="caption" className="mt-0.5 block text-fg-secondary">
            The response could not be parsed, so the runtime substituted a THINK to
            let the loop continue. The model did not decide to think — look at the
            response format, not at the prompt.
          </Text>
        </div>
      )}

      {it.actionJson ? (
        <pre className="overflow-x-auto rounded-sm bg-surface-sunken p-2 font-mono text-[11px] text-fg-primary">
          {prettyJson(it.actionJson)}
        </pre>
      ) : (
        <Text variant="caption" className="block text-fg-muted">
          Not recorded — this iteration did not complete.
        </Text>
      )}
    </div>
  );
}

/**
 * The tool call: what went in, what came back, and WHETHER IT RAN.
 *
 * The guard outcome is the part with no other home. A replayed call returns the
 * previous result, so a reader shown it without a marker believes the tool ran
 * now — and concludes the external system is serving stale data.
 */
function ToolCall({ iteration: it }: { iteration: Iteration }) {
  const call = it.toolCall;
  const cached = it.toolResultCached === true;
  const args = extractField(it.actionJson, "toolInput");

  return (
    <Section
      title="Tool call"
      right={
        <span className="flex items-center gap-2">
          {cached ? (
            <span className="inline-flex items-center gap-1 rounded-xs border border-status-waiting-border px-1.5 py-0.5">
              <Icon icon={Prohibit} size="xs" decorative className="text-status-waiting" />
              <span className="text-[10px] font-medium text-status-waiting">
                Cached — not executed
              </span>
            </span>
          ) : it.toolResultCached === false ? (
            <span className="inline-flex items-center gap-1 rounded-xs border border-subtle px-1.5 py-0.5">
              <Icon icon={Wrench} size="xs" decorative className="text-fg-muted" />
              <span className="text-[10px] text-fg-secondary">Executed</span>
            </span>
          ) : null}
          {call?.durationMs != null && (
            <span className="font-mono text-[11px] tabular-nums text-fg-muted">
              {formatDuration(call.durationMs)}
            </span>
          )}
          {call && <StatusPill status={call.status} size="dot" />}
        </span>
      }
    >
      {cached && (
        <div className="mb-2 rounded-sm border border-status-waiting-border bg-status-waiting-subtle px-2 py-1.5">
          <Text variant="caption" className="text-status-waiting">
            The step guard found an identical earlier call and replayed its result.
            The tool was not contacted on this attempt, so what the model read
            below is the OLDER result — the external system may since have changed.
          </Text>
        </div>
      )}

      <Field label="Tool">
        {call?.name ?? it.selectedToolId ?? "—"}
      </Field>
      <Field label="Arguments">
        {args ? (
          <pre className="overflow-x-auto rounded-sm bg-surface-sunken p-2 font-mono text-[11px] text-fg-primary">
            {prettyJson(args)}
          </pre>
        ) : "—"}
      </Field>
      <Field label="Result">
        {it.observation ?? "—"}
        {it.observationSuccess === false && (
          <span className="ml-2 text-status-failed">failed</span>
        )}
      </Field>

      {/* The tool result is a payload, not a string. Named so the reader knows
          the full thing exists rather than assuming the summary is all of it. */}
      {it.toolCall?.hasOutput && (
        <Text variant="caption" className="mt-1 block text-fg-muted">
          The full result is stored separately — open it from the waterfall row
          for this call.
        </Text>
      )}
    </Section>
  );
}

/** Observation recorded, and memory written. Both shown, both by name. */
function Observation({ iteration: it }: { iteration: Iteration }) {
  return (
    <Section title="Observation and memory">
      <Field label="Observation">
        {it.observation ?? <span className="text-fg-muted">Nothing was recorded.</span>}
      </Field>
      <Field label="Memory written">
        {/*
          A THINK writes `thought_<n>` into the loop's memory; other actions do
          not. Stated from the action type rather than guessed, and "(none)" is
          rendered rather than omitted — an absent row reads as "we did not
          check".
        */}
        {it.actionType === "THINK" && it.thought
          ? <span className="font-mono text-[11px]">thought_{it.number}</span>
          : <span className="text-fg-muted">(none)</span>}
      </Field>
      {it.thought && (
        <Field label="Reasoning">
          <span className="text-fg-secondary">{it.thought}</span>
        </Field>
      )}
    </Section>
  );
}

// ── Payload panels ──────────────────────────────────────────────────────────

/**
 * A payload: collapsed, and NOT FETCHED until it is opened.
 *
 * The metadata — size, truncation, redactions — arrives with the iteration list,
 * so the collapsed panel is honest about what is there without moving any of it.
 * The bytes are a second request, made on the click that reveals them.
 */
function PayloadPanel({
  api, runId, title, spanId, side, present, bytes, context, beside,
}: {
  api: TraceApi;
  runId: string;
  title: string;
  spanId: string | null;
  side: "input" | "output";
  present: boolean;
  bytes: number | null;
  context?: ContextFitProp;
  beside?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<PayloadRef | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!spanId || payload) return;
    setLoading(true);
    api.span(runId, spanId, { content: true })
      .then((d) => setPayload(side === "input" ? d.input : d.output))
      .catch((e: unknown) => { if (!isAborted(e)) setError(messageOf(e)); })
      .finally(() => setLoading(false));
  }, [api, runId, spanId, side, payload]);

  return (
    <Section
      title={title}
      right={bytes != null && (
        <span className="font-mono text-[11px] tabular-nums text-fg-muted">
          {bytes.toLocaleString()} bytes
        </span>
      )}
    >
      {/*
        THE TRUNCATION WARNING LIVES HERE, ON THE PROMPT, because this is where
        the missing information is — and it NAMES the sections that went. "The
        context was truncated" says something is missing but not what, and the
        entire diagnostic value is in which sections were dropped.
      */}
      {context?.truncated && (
        <div className="mb-2 rounded-sm border border-status-waiting-border bg-status-waiting-subtle px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Icon icon={Scissors} size="xs" decorative className="text-status-waiting" />
            <Text variant="caption" className="text-status-waiting">
              The model never saw all of this
            </Text>
          </div>
          <Text variant="caption" className="mt-0.5 block text-fg-secondary">
            Context was trimmed to fit
            {context.charBudget != null && ` ${context.charBudget.toLocaleString()} characters`}
            . Dropped: {context.droppedSections.length > 0
              ? context.droppedSections.join(", ")
              : "sections the assembler did not name"}.
          </Text>
        </div>
      )}
      {context?.overBudget && !context.truncated && (
        <div className="mb-2 rounded-sm border border-status-failed-border bg-status-failed-subtle px-2 py-1.5">
          <Text variant="caption" className="text-status-failed">
            The task and its inputs alone are over the context budget
            {context.charsUsed != null && context.charBudget != null &&
              ` (${context.charsUsed.toLocaleString()} of ${context.charBudget.toLocaleString()} characters)`}
            . Nothing was dropped, so the provider saw all of it.
          </Text>
        </div>
      )}

      {beside}

      {!present ? (
        <Text variant="caption" className="block text-fg-muted">
          Not recorded for this iteration.
        </Text>
      ) : (
        <>
          <button
            type="button"
            onClick={() => { setOpen((v) => !v); if (!open) load(); }}
            aria-expanded={open}
            className={cn(
              "mt-2 rounded-xs px-1 text-xs text-fg-link",
              "transition-opacity hover:opacity-80 motion-reduce:transition-none",
              "focus-visible:focus-ring",
            )}
          >
            {open ? "Hide" : "Show"} {title.toLowerCase()}
          </button>

          {open && (
            <div className="mt-2">
              {loading ? (
                <div className="h-16 animate-pulse rounded-sm bg-surface-sunken motion-reduce:animate-none" />
              ) : error ? (
                <Text variant="caption" className="text-status-failed">{error}</Text>
              ) : (
                <PayloadBody payload={payload} />
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

type ContextFitProp = {
  truncated: boolean;
  droppedSections: string[];
  charsUsed: number | null;
  charBudget: number | null;
  overBudget: boolean;
} | null;

/**
 * The content, with redactions rendered as redactions.
 *
 * A masked value is shown as `[redacted: reason]` in place, never as a gap: a
 * gap reads as a bug in the debugger and sends the reader looking for the
 * missing text, where a named redaction is a deliberate act with a reason.
 */
function PayloadBody({ payload }: { payload: PayloadRef | null }) {
  if (!payload) {
    return (
      <Text variant="caption" className="block text-fg-muted">
        Content is no longer available — it may have passed its retention window.
      </Text>
    );
  }

  const redactions = parseRedactions(payload.redactions);

  return (
    <>
      {payload.truncated && (
        <Text variant="caption" className="mb-1 block text-fg-muted">
          Shortened before storage: what the model saw may be longer than this.
        </Text>
      )}
      {redactions.length > 0 && (
        <Text variant="caption" className="mb-1 block text-fg-secondary">
          {redactions.length} value{redactions.length === 1 ? "" : "s"} masked below.
          Each appears in place as [redacted: reason] — the text is not missing,
          it was removed on purpose before it was stored.
        </Text>
      )}
      {payload.value ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-sunken p-2 font-mono text-[11px] text-fg-primary">
          {payload.value}
        </pre>
      ) : payload.url ? (
        <Text variant="caption" className="block text-fg-muted">
          Stored outside the database.{" "}
          <a href={payload.url} className="text-fg-link underline" rel="noreferrer">
            Open the full content
          </a>
        </Text>
      ) : (
        <Text variant="caption" className="block text-fg-muted">
          Content is no longer available — it may have passed its retention window.
        </Text>
      )}
    </>
  );
}

// ── Diff ────────────────────────────────────────────────────────────────────

/**
 * What changed between two prompts.
 *
 * Usually the fastest route to "the model never got the data it needed": the
 * interesting answer is almost always one observation that is present in the
 * later prompt and absent from the earlier one, or the reverse.
 *
 * Both prompts are fetched HERE rather than requiring the reader to expand them
 * first — asking for a diff is asking for the content, and making them open two
 * panels to get it is a step that exists only because of how this is built.
 */
function PromptDiff({
  api, runId, a, b,
}: {
  api: TraceApi;
  runId: string;
  a: Iteration;
  b: Iteration;
}) {
  const [texts, setTexts] = React.useState<{ a: string | null; b: string | null } | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const aSpan = a.llmCall?.spanId;
    const bSpan = b.llmCall?.spanId;
    if (!aSpan || !bSpan) { setTexts(null); return; }
    const ac = new AbortController();
    setLoading(true);
    Promise.all([
      api.span(runId, aSpan, { content: true }, ac.signal),
      api.span(runId, bSpan, { content: true }, ac.signal),
    ])
      .then(([x, y]) => setTexts({ a: x.input?.value ?? null, b: y.input?.value ?? null }))
      .catch(() => { /* the panel says so below */ })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [api, runId, a, b]);

  return (
    <Section title={`Prompt diff — iteration ${a.number} to ${b.number}`}>
      {loading ? (
        <div className="h-16 animate-pulse rounded-sm bg-surface-sunken motion-reduce:animate-none" />
      ) : !texts?.a || !texts?.b ? (
        <Text variant="caption" className="text-fg-muted">
          One of these iterations has no stored prompt, so there is nothing to
          compare.
        </Text>
      ) : (
        <DiffBody a={texts.a} b={texts.b} />
      )}
    </Section>
  );
}

/**
 * A line diff, summarised first.
 *
 * The summary is the point: on a 12,000-character prompt the reader wants "one
 * observation was added", not 400 unchanged lines to scroll past. Unchanged
 * lines are collapsed to a count.
 */
export function diffLines(a: string, b: string): {
  added: string[];
  removed: string[];
  unchanged: number;
} {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const aCount = new Map<string, number>();
  aLines.forEach((l) => aCount.set(l, (aCount.get(l) ?? 0) + 1));

  const added: string[] = [];
  let unchanged = 0;
  for (const line of bLines) {
    const n = aCount.get(line) ?? 0;
    if (n > 0) { aCount.set(line, n - 1); unchanged += 1; }
    else added.push(line);
  }
  const removed: string[] = [];
  aCount.forEach((n, line) => { for (let i = 0; i < n; i += 1) removed.push(line); });

  return { added, removed, unchanged };
}

function DiffBody({ a, b }: { a: string; b: string }) {
  const { added, removed, unchanged } = React.useMemo(() => diffLines(a, b), [a, b]);

  if (added.length === 0 && removed.length === 0) {
    return (
      <Text variant="caption" className="text-fg-muted">
        The two prompts are identical — {unchanged} lines, nothing added or removed.
      </Text>
    );
  }

  return (
    <>
      <Text variant="caption" className="mb-2 block text-fg-secondary">
        {added.length} line{added.length === 1 ? "" : "s"} added,{" "}
        {removed.length} removed, {unchanged} unchanged.
      </Text>
      <pre className="max-h-64 overflow-auto rounded-sm bg-surface-sunken p-2 font-mono text-[11px]">
        {removed.map((line, i) => (
          <div key={`r${i}`} className="text-status-failed">- {line}</div>
        ))}
        {added.map((line, i) => (
          <div key={`a${i}`} className="text-status-success">+ {line}</div>
        ))}
      </pre>
    </>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────

function Section({ title, right, children }: {
  title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-subtle bg-surface-raised p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 last:mb-0">
      <span className="text-[11px] text-fg-muted">{label}</span>
      <div className="text-xs text-fg-primary">{children}</div>
    </div>
  );
}

function Panel({ tone, children }: { tone: "neutral" | "failed"; children: React.ReactNode }) {
  const failed = tone === "failed";
  return (
    <div className={cn(
      "flex h-48 items-center justify-center rounded-md border p-4 text-center",
      failed ? "border-status-failed-border bg-status-failed-subtle" : "border-subtle bg-surface-raised",
    )}>
      <Text variant="body" className={failed ? "text-status-failed" : "text-fg-secondary"}>
        {children}
      </Text>
    </div>
  );
}

function LoadingRail() {
  return (
    <div className="flex gap-4" aria-busy="true" aria-label="Loading iterations">
      <div className="w-72 shrink-0 space-y-1">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-7 animate-pulse rounded-sm bg-surface-sunken motion-reduce:animate-none" />
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {[64, 96, 80].map((h) => (
          <div key={h} style={{ height: h }}
               className="animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The iteration's own status, mapped onto the shared span vocabulary. */
function statusOf(it: Iteration): string {
  switch (it.status) {
    case "completed": return "ok";
    case "failed": return "error";
    case "running": return "running";
    case "skipped": return "skipped";
    default: return it.status;
  }
}

function isAborted(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true;
  return typeof e === "object" && e !== null && (e as { kind?: string }).kind === "aborted";
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Could not load the iterations.";
}

function parseRedactions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ label: string; count: number }>;
    return parsed.map((r) => `${r.label} (${r.count})`);
  } catch { return []; }
}

function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

/** One field out of a small stored JSON object, as JSON text. */
function extractField(raw: string | null, key: string): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed[key];
    return v == null ? null : JSON.stringify(v);
  } catch { return null; }
}
