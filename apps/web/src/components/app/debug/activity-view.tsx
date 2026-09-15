"use client";

import * as React from "react";
import {
  ArrowClockwise, Butterfly, CaretDown, CaretRight, Prohibit, Scissors, TrendUp,
} from "@phosphor-icons/react/dist/ssr";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatDuration } from "~/lib/format";
import type { ActivationDetail, Iteration, TraceApi } from "~/lib/api/trace";
import {
  buildActivity, defaultActivation, significanceOf, stepHealth,
  type ActivityGroup, type ActivityRow, type ActivityStep,
} from "./activity";
import {
  BudgetGauges, IterationDetail, IterationsView, ReplayBanner,
} from "./iterations-view";
import { TONE } from "./status-vocabulary";

/**
 * What the agent did, in order, in words.
 *
 * ── WHY THIS IS THE DEFAULT AND THE INSPECTOR IS NOT ────────────────────────
 * The inspector answers "what was in iteration 4's prompt". That is the right
 * question about twice a week, and it was the first thing everybody saw. The
 * question people actually arrive with — "what did this agent do, and where did
 * it go wrong" — had no view at all, and the data to answer it was already being
 * collected and discarded: `reasoningSummary` is the agent's own account of each
 * step, and the UI rendered `CALL_TOOL` instead.
 *
 * ── NOTHING IS REMOVED, ONLY DEFAULTED AWAY ─────────────────────────────────
 * The expert toggle renders the previous view, unchanged, from the same request.
 * Every field it ever showed is still one click away, and the choice is
 * remembered — a runtime engineer sets it once, an operations lead never has to.
 *
 * ── COLLAPSING IS A CLAIM, SO IT IS A CAREFUL ONE ───────────────────────────
 * A folded group says "nothing here needed you". [significanceOf] decides that,
 * and it is deliberately generous about what counts as needing attention: a
 * repaired action, a truncated context and an unsuccessful observation all keep
 * their own row. A view that hides a failure to look tidy is worse than the
 * counter it replaced.
 */
export function ActivityView({
  api,
  runId,
  selectedNodeId,
  selectedSpanId,
  onSelectSpan,
}: {
  api: TraceApi;
  runId: string;
  /**
   * The node selected elsewhere in the Debug tab.
   *
   * This is what makes Activity the view for an agent or team STEP rather than
   * for a run: a reader who picked a node on the map and came here gets that
   * agent's story, not the first one in the run. An activation's `stepId` is the
   * workflow node id, so the match is direct and a node with no activation
   * simply falls through to the default.
   */
  selectedNodeId: string | null;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
}) {
  const [data, setData] = React.useState<ActivationDetail[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeStep, setActiveStep] = React.useState<string | null>(null);
  const [expert, setExpert] = useExpertMode();
  /*
   * The step whose detail is open on the right.
   *
   * Held here rather than inside the rail because the detail pane and the rail
   * are siblings, and because it seeds the expert view's opening selection —
   * switching to iteration detail must land on the step you were reading, not
   * back at the first one.
   */
  const [focus, setFocus] = React.useState<{ stepId: string; iteration: number } | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    api.iterations(runId, ac.signal)
      .then((r) => setData(r.activations))
      .catch((e: unknown) => { if (!isAborted(e)) setError(messageOf(e)); });
    return () => ac.abort();
  }, [api, runId]);

  const activation =
    data?.find((a) => a.stepId === activeStep)
    ?? data?.find((a) => a.stepId === selectedNodeId)
    ?? (data ? defaultActivation(data) : null);

  /*
   * What the detail pane shows.
   *
   * Falls back to the first step the reader would care about rather than to
   * step 1: opening a failed run on "the agent thought about what to do" wastes
   * the one glance most people give this screen.
   */
  const selected = React.useMemo(() => {
    if (!activation) return null;
    if (focus && focus.stepId === activation.stepId) {
      const hit = activation.iterations.find((i) => i.number === focus.iteration);
      if (hit) return hit;
    }
    return activation.iterations.find((i) => significanceOf(i) === "failure")
      ?? activation.iterations[0]
      ?? null;
  }, [activation, focus]);

  if (error) {
    return (
      <div className="rounded-md border-2 border-status-failed-border bg-status-failed-subtle p-4">
        <Text variant="body" className="text-status-failed">{error}</Text>
      </div>
    );
  }
  if (!data) return <ActivitySkeleton />;
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-subtle bg-surface-raised p-6">
        <Text variant="body" className="text-fg-secondary">
          This run had no agent step, so there is no activity to show. Only a
          workflow with an agent or a team produces one.
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {data.length > 1 ? (
          <label className="block">
            <span className="text-xs text-fg-muted">Agent</span>
            <select
              value={activation?.stepId ?? ""}
              onChange={(e) => setActiveStep(e.target.value)}
              className={cn(
                "mt-0.5 block w-64 rounded-sm border border-subtle bg-surface-raised px-2 py-1",
                "text-xs text-fg-primary",
                "focus-visible:focus-ring",
              )}
            >
              {data.map((a) => (
                <option key={a.stepId} value={a.stepId}>
                  {a.agentName ?? a.stepId} · {a.iterations.length} steps
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Text variant="body" className="font-medium text-fg-primary">
            {activation?.agentName ?? activation?.stepId ?? "Agent"}
          </Text>
        )}

        <ExpertToggle value={expert} onChange={setExpert} />
      </div>

      {activation && <StepCount activation={activation} />}

      {expert ? (
        <IterationsView
          api={api}
          runId={runId}
          focus={focus}
          selectedSpanId={selectedSpanId}
          onSelectSpan={onSelectSpan}
        />
      ) : activation ? (
        /*
         * ── TWO PANES, NOT A LIST ────────────────────────────────────────
         *
         * The first version of this view was a flat list of sentences, and the
         * feedback was immediate: the old inspector was better, because you
         * could click a step and read what actually happened in it without
         * leaving the page. It was only its LABELS that nobody could read —
         * "Iteration 4 · CALL_TOOL · 2.4s".
         *
         * So the layout is the inspector's and the words are the narrative's.
         * The rail says what the agent did; the pane on the right is the same
         * detail the inspector always showed, unchanged.
         */
        <div className="flex gap-4">
          <div className="w-80 shrink-0 space-y-3">
            {activation.replayedFrom && <ReplayBanner note={activation.replayedFrom} />}

            <Narrative
              activation={activation}
              selected={selected?.number ?? null}
              onOpen={(iteration) => {
                setFocus({ stepId: activation.stepId, iteration: iteration.number });
                /* Selecting a step selects its span everywhere else in the tab,
                   so the waterfall and the map follow the story. */
                const span = iteration.llmCall?.spanId ?? iteration.toolCall?.spanId;
                if (span) onSelectSpan(span);
              }}
            />

            <BudgetGauges
              budgets={activation.budgets}
              stopReason={activation.stopReason}
              toolCalls={activation.iterations.filter((i) => i.actionType === "CALL_TOOL").length}
            />
          </div>

          <div className="min-w-0 flex-1">
            {selected ? (
              <IterationDetail
                api={api}
                runId={runId}
                iteration={selected}
                diffAgainst={null}
                selectedSpanId={selectedSpanId}
              />
            ) : (
              <Text variant="body" className="text-fg-secondary">
                Select a step to see what it sent and what came back.
              </Text>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── The step count, against what this agent usually takes ────────────────── */

/**
 * "14 steps — typical for this agent is 3."
 *
 * Rendered on successful runs too, which is the only reason it is worth
 * building: a run that took four times as many steps as it should have is green
 * on every other screen in the product, and nothing else will ever mention it.
 *
 * Silent when there is no baseline. An agent with no successful history has no
 * typical, and a signal that fires on new agents is one people learn to ignore.
 */
function StepCount({ activation }: { activation: ActivationDetail }) {
  const health = stepHealth(activation.iterations.length, activation.baseline);
  if (!health.text) return null;

  const high = health.level === "high";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-sm border px-3 py-2",
        high
          ? "border-status-waiting-border bg-status-waiting-subtle"
          : "border-subtle bg-surface-raised",
      )}
    >
      <Icon
        icon={TrendUp}
        size="sm"
        decorative
        className={cn("mt-0.5 shrink-0", high ? "text-status-waiting" : "text-fg-muted")}
      />
      <div className="min-w-0">
        <Text
          variant="body"
          className={cn("tabular-nums", high ? "text-status-waiting" : "text-fg-secondary")}
        >
          {health.text}
        </Text>
        <Text variant="caption" className="mt-0.5 block text-fg-muted">
          {high
            ? "More steps than usual. The run may still have succeeded — look for a "
              + "step that was repeated, or a tool that answered but not with what was asked for."
            : "In line with previous runs."}
          {" "}
          Measured over {activation.baseline?.sampleRuns} recent successful{" "}
          {activation.baseline?.sampleRuns === 1 ? "run" : "runs"} of this agent.
        </Text>
      </div>
    </div>
  );
}

/* ── The narrative rail ───────────────────────────────────────────────────── */

function Narrative({
  activation, selected, onOpen,
}: {
  activation: ActivationDetail;
  /** The step number whose detail is open, so the rail can mark it. */
  selected: number | null;
  onOpen: (iteration: Iteration) => void;
}) {
  const rows = React.useMemo(() => buildActivity(activation.iterations), [activation]);

  return (
    <ol className="space-y-1" aria-label="What the agent did">
      {rows.map((row, i) => (
        <li key={rowKey(row, i)}>
          {row.kind === "group" ? (
            <GroupRow group={row} selected={selected} onOpen={onOpen} />
          ) : (
            <StepRow step={row} selected={selected === row.iteration.number} onOpen={onOpen} />
          )}
        </li>
      ))}
    </ol>
  );
}

function rowKey(row: ActivityRow, i: number): string {
  return row.kind === "group" ? `g-${row.steps[0].iteration.id}` : row.iteration.id || `r-${i}`;
}

/**
 * One step, as a sentence you can open.
 *
 * ── WHY THE WHOLE ROW IS ONE CONTROL ────────────────────────────────────────
 * It used to be two: the sentence selected a span, and a separate "Step 8
 * details" link switched views. Two targets for one intention, and the second
 * one existed only because the detail lived somewhere else. With the detail
 * pane beside the rail there is a single thing to do here — read this step —
 * and a single control that does it.
 *
 * The step NUMBER is shown, quietly, in the corner. It is the one piece of the
 * old vocabulary worth keeping: it is how people refer to a step out loud, and
 * it is what the expert view is indexed by. What is gone is `CALL_TOOL` as the
 * headline.
 */
function StepRow({
  step, selected, onOpen, dense,
}: {
  step: ActivityStep;
  selected: boolean;
  onOpen: (iteration: Iteration) => void;
  dense?: boolean;
}) {
  const it = step.iteration;
  const failed = step.significance === "failure";

  /*
   * A milestone is LOUDER than a routine step but is not a status.
   *
   * `FINAL`, `DELEGATE` and `ASK_APPROVAL` are the turns in the story, so they
   * carry the foreground colour rather than the muted one — and deliberately not
   * the success hue: an agent asking for approval has not succeeded, and giving
   * it green would inflate every count that reads colour as outcome.
   */
  const glyph = failed
    ? { icon: TONE.failed.icon, tone: "text-status-failed" }
    : step.significance === "milestone"
      ? { icon: TONE.success.icon, tone: "text-fg-primary" }
      : { icon: TONE.success.icon, tone: "text-fg-muted" };

  return (
    <button
      type="button"
      onClick={() => onOpen(it)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-2 rounded-sm border px-2 py-1.5 text-left",
        "transition-colors motion-reduce:transition-none",
        failed
          ? "border-2 border-status-failed-border bg-status-failed-subtle"
          : "border-subtle bg-surface-raised hover:border-strong",
        selected && !failed && "border-strong bg-surface-selected",
        selected && failed && "bg-status-failed-subtle",
        dense && "border-transparent bg-transparent",
        "focus-visible:focus-ring-inset",
      )}
    >
      <Icon icon={glyph.icon} size="xs" decorative className={cn("mt-1 shrink-0", glyph.tone)} />

      <span className="min-w-0 flex-1">
        <Text
          as="span"
          variant="body-sm"
          className={cn(
            "block",
            failed ? "text-status-failed" : "text-fg-primary",
            /* A generated sentence is quieter than the agent's own words, so a
               reader can tell which is a summary the agent wrote and which is
               one we assembled from what it did. */
            step.generated && !failed && "text-fg-secondary",
          )}
        >
          {step.headline}
        </Text>

        {step.outcome && (
          <Text variant="caption" className="mt-0.5 block text-fg-secondary">
            {step.outcome}
          </Text>
        )}

        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {it.toolName && (
            <span className="max-w-full truncate rounded-xs bg-surface-sunken px-1 py-0.5 text-xs text-fg-secondary">
              {it.toolName}
            </span>
          )}
          {it.durationMs != null && (
            <Text variant="caption" className="tabular-nums text-fg-muted">
              {formatDuration(it.durationMs)}
            </Text>
          )}
          <Markers iteration={it} />
        </span>
      </span>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
        {it.number}
      </span>
    </button>
  );
}

/**
 * A stretch where nothing needed the reader.
 *
 * Closed by default and expandable in place — not a link to somewhere else,
 * because the value of the summary is that the sequence stays in its position in
 * the story. Opens automatically when the step being read is inside it, so
 * arriving from a link never lands on a fold with nothing visible.
 */
function GroupRow({
  group, selected, onOpen,
}: {
  group: ActivityGroup;
  selected: number | null;
  onOpen: (iteration: Iteration) => void;
}) {
  const holdsSelection =
    selected != null && group.steps.some((s) => s.iteration.number === selected);
  const [open, setOpen] = React.useState(false);
  const expanded = open || holdsSelection;

  return (
    <div className="rounded-sm border border-dashed border-subtle bg-surface-sunken">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-start gap-2 px-2 py-1.5 text-left",
          "focus-visible:focus-ring-inset",
        )}
      >
        <Icon
          icon={expanded ? CaretDown : CaretRight}
          size="xs"
          decorative
          className="mt-1 shrink-0 text-fg-muted"
        />
        <span className="min-w-0 flex-1">
          <Text as="span" variant="body-sm" className="block text-fg-secondary">
            <span className="tabular-nums text-fg-muted">
              {group.range[0] === group.range[1]
                ? `Step ${group.range[0]}`
                : `Steps ${group.range[0]}\u2013${group.range[1]}`}
            </span>
            {" \u00b7 "}
            {group.headline}
          </Text>
          {(group.tools.length > 0 || group.recalled) && (
            <Text variant="caption" className="mt-0.5 block text-fg-muted">
              {group.recalled && "Restored from the transcript on resume. "}
              {group.tools.length > 0 && `Used ${listOf(group.tools)}.`}
            </Text>
          )}
        </span>
      </button>

      {expanded && (
        <div className="space-y-0.5 border-t border-subtle px-1 py-1">
          {group.steps.map((st) => (
            <StepRow
              key={st.iteration.id}
              step={st}
              selected={selected === st.iteration.number}
              onOpen={onOpen}
              dense
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** "a, b and c" — a list in prose, not a comma-separated dump. */
function listOf(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, 3).join(", ");
  return items.length > 3 ? `${head} and ${items.length - 3} more` : head;
}

/**
 * The things the runtime did that the agent did not.
 *
 * Same vocabulary as the inspector, deliberately — a reader who learns what the
 * scissors mean in one view must not have to learn it again in the other.
 */
function Markers({ iteration: it }: { iteration: Iteration }) {
  const marks: Array<{ icon: React.ComponentProps<typeof Icon>["icon"]; label: string; tone: string }> = [];
  if (it.recalled) {
    marks.push({
      icon: ArrowClockwise, tone: "text-fg-muted",
      label: "Restored from the transcript on resume — not run again",
    });
  }
  if (it.actionRepaired === true) {
    marks.push({
      icon: Butterfly, tone: "text-status-waiting",
      label: "The model's response could not be read, so the runtime turned it into a thinking step",
    });
  }
  if (it.toolResultCached === true) {
    marks.push({
      icon: Prohibit, tone: "text-status-waiting",
      label: "Reused an earlier identical call instead of running the tool again",
    });
  }
  if (it.context?.truncated) {
    marks.push({
      icon: Scissors, tone: "text-status-waiting",
      label: `The agent was not shown all of its context — dropped ${it.context.droppedSections.join(", ")}`,
    });
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

/* ── The expert toggle ────────────────────────────────────────────────────── */

const EXPERT_KEY = "vectorbea-debug-expert";

/**
 * Remembered per person, in local storage, like every other preference here.
 *
 * NOT in the URL. A shared debug link must open on the view the recipient reads
 * runs in, not the one the sender happened to have open — and a runtime engineer
 * who sets this once should never see the narrative again unless they ask for it.
 *
 * Read after mount and never during render: reading storage in the initialiser
 * makes the server and the first client render disagree, which Next renders as a
 * full-page crash overlay in development.
 */
function useExpertMode(): [boolean, (v: boolean) => void] {
  const [expert, setExpert] = React.useState(false);

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(EXPERT_KEY) === "true") setExpert(true);
    } catch {
      /* Storage denied. The default is a working view, so there is nothing to
         recover from and nothing worth telling the reader. */
    }
  }, []);

  const set = React.useCallback((v: boolean) => {
    setExpert(v);
    try {
      window.localStorage.setItem(EXPERT_KEY, String(v));
    } catch { /* As above. */ }
  }, []);

  return [expert, set];
}

function ExpertToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent size-3.5 shrink-0 rounded-xs outline-none focus-visible:focus-ring"
      />
      {/* The detail pane is always on screen now, so this no longer offers
          "detail" — it offers the RAW list: iteration numbers, action types and
          the prompt diff between any two of them. Named for what it adds. */}
      <span className="text-xs text-fg-secondary">Raw iteration list</span>
    </label>
  );
}

/* ── States ───────────────────────────────────────────────────────────────── */

function ActivitySkeleton() {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Loading what the agent did">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-sm bg-surface-sunken motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

function isAborted(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true;
  return typeof e === "object" && e !== null && (e as { kind?: string }).kind === "aborted";
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Could not load what the agent did.";
}
