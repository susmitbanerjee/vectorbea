"use client";

import * as React from "react";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import type { TraceSpan } from "~/lib/api/trace";
import {
  KIND_LABEL, TONE_CLASSES, TONE_FOR_STATUS, TONE_LABEL, formatDuration,
} from "./span-status";

/**
 * The run map: the workflow as the builder drew it, with what actually happened
 * painted onto it.
 *
 * Familiarity is the whole point. Somebody who has seen this workflow in the
 * builder should recognise it here without being told they are looking at the
 * same thing, which is why this is a left-to-right chain of node cards rather
 * than a waterfall or a table — the second view of the same object should look
 * like the first.
 *
 * ── ONE CARD PER GRAPH NODE, NOT PER SPAN ───────────────────────────────────
 * A `step` span is one EXECUTION of a node, and a node executes more than once
 * routinely: a cooperative yield ends the tick and the node resumes on the next
 * one, a retry re-runs it, an approval parks it and the resume runs it again.
 * Rendering the span array directly gave one card per execution, so a node that
 * yielded twice appeared three times in a row with the same name — which reads
 * as a workflow that loops rather than a node that was interrupted, and it made
 * the map longer than the workflow it is supposed to mirror.
 *
 * So spans are grouped by `stepId`, which is the graph node's own id and is
 * already on the wire. Repeats become an attempts badge on one card.
 *
 * ── WHAT DID NOT HAPPEN IS THE POINT ────────────────────────────────────────
 * Unreached nodes are DIMMED, never hidden. A run that failed at step two and a
 * run that was never going to reach step four look identical if you only render
 * what executed, and "why did nothing get notified" is the question that brings
 * people here second-most often.
 */
export function OverviewView({
  spans,
  rootCauseSpanId,
  selectedSpanId,
  onSelectSpan,
}: {
  spans: TraceSpan[];
  rootCauseSpanId: string | null;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
}) {
  /*
   * Nodes are the workflow's own nodes; ticks and the run wrapper are runtime
   * mechanics the builder never drew, so they are flattened away here and kept
   * for the timeline where they matter.
   */
  const nodes = React.useMemo(() => collectNodes(spans), [spans]);

  /* The widest card is scaled against the slowest node, so the encoding is
     relative to THIS run rather than to an absolute scale no run matches. */
  const slowestMs = React.useMemo(
    () => Math.max(0, ...nodes.map((n) => n.totalMs ?? 0)),
    [nodes],
  );

  /*
   * The failing path: the root cause and everything that contained it. Bolded so
   * the eye lands on the chain that broke rather than on the longest bar.
   */
  const failingPath = React.useMemo(
    () => new Set(pathToRootCause(spans, rootCauseSpanId)),
    [spans, rootCauseSpanId],
  );

  if (nodes.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-subtle bg-surface-raised">
        <Text variant="body" className="text-fg-secondary">
          No steps were recorded for this run.
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-stretch gap-x-1 gap-y-4"
        role="list"
        aria-label="Run map"
      >
        {nodes.map((node, i) => (
          <React.Fragment key={node.nodeKey}>
            {i > 0 && <Connector dimmed={node.unreached} />}
            <NodeCard
              node={node}
              widthPx={widthFor(node.totalMs, node.unreached, slowestMs)}
              onFailingPath={node.spanIds.some((id) => failingPath.has(id))}
              isRootCause={rootCauseSpanId != null && node.spanIds.includes(rootCauseSpanId)}
              selected={selectedSpanId != null && node.spanIds.includes(selectedSpanId)}
              onSelect={() => onSelectSpan(node.span.spanId)}
            />
          </React.Fragment>
        ))}
      </div>

      <Text variant="caption" className="text-fg-muted">
        Card width shows how long each step took. Dimmed steps were never reached.
        Click any step to open it in the timeline and inspector.
      </Text>
    </div>
  );
}

/**
 * Card width from duration.
 *
 * ── WHY SQUARE ROOT, AND WHY CLAMPED ────────────────────────────────────────
 * A linear map against the slowest node makes one 10-minute LLM step swallow the
 * scale: every other node collapses onto the minimum and they are all the same
 * size again, which is the thing this encoding exists to prevent. The square
 * root compresses the top of the range and keeps the bottom separable, so a 3ms
 * transform and a 400ms HTTP call are still visibly different next to a step
 * that took a minute.
 *
 * Clamped at both ends. The floor keeps a card wide enough to hold a readable
 * label and a click target — an honest 0.2px bar would be unusable, and this is
 * a card, not a waterfall bar; the TIMELINE is where strict proportionality
 * lives. The ceiling stops one slow node forcing a horizontal scroll on a map
 * whose whole job is to fit on one screen.
 *
 * Both bounds sit on the 4px lattice, and so does the result.
 */
export function widthFor(totalMs: number | null, unreached: boolean, slowestMs: number): number {
  const MIN = 96;    // w-24 — the narrowest card that still holds a label
  const MAX = 288;   // w-72
  if (unreached || totalMs == null || totalMs <= 0 || slowestMs <= 0) return MIN;
  const ratio = Math.sqrt(Math.min(totalMs, slowestMs) / slowestMs);
  const raw = MIN + ratio * (MAX - MIN);
  return Math.round(raw / 4) * 4;
}

interface RunNode {
  /** The graph node id when we have one, else the span id. Never collapses two nodes. */
  nodeKey: string;
  /** The representative execution: the LAST one, whose outcome is the one that stands. */
  span: TraceSpan;
  /** Every span in the group, so selection and root-cause matching cover all attempts. */
  spanIds: string[];
  /** How many times this node executed. 1 for the ordinary case. */
  attempts: number;
  /** Summed across attempts — the time this node actually cost the run. */
  totalMs: number | null;
  /** Model and tool calls beneath this node, across every attempt. */
  children: TraceSpan[];
  unreached: boolean;
  /** True when an earlier attempt failed but the node ended up succeeding. */
  recovered: boolean;
  /** What to call this node. See [labelFor]. */
  label: string;
}

/**
 * The node's name, in the order a reader can actually use.
 *
 * ── label, THEN AGENT NAME, THEN type - id ──────────────────────────────────
 * The worker names a step span `node.label`, falling back to `type:id8` when the
 * builder never named the node (`WorkflowRuntime.nodeLabel`). For an agent node
 * that fallback reads `agent:1a2b3c4d`, which tells nobody WHICH agent — and an
 * unnamed agent node is the common case, because the builder auto-creates them.
 *
 * The agent's name is already on the wire: `AgentHarness` opens the `activation`
 * span with `req.agentName`, so it hangs under this very step. No new field, no
 * worker change, no graph_json.
 *
 * The fallback is detected exactly rather than sniffed with a regex: the worker
 * builds it as `type + ":" + id.take(8)` and `stepId` IS that id, so a suffix
 * match on the node's own id prefix cannot produce a false positive on a real
 * label that merely contains a colon.
 */
export function labelFor(span: TraceSpan, children: TraceSpan[]): string {
  const stepId = span.stepId;
  const name = span.name;
  if (!stepId) return name;

  const looksGenerated = name.endsWith(`:${stepId.slice(0, 8)}`);
  if (!looksGenerated) return name;

  const agent = children.find((c) => c.kind === "activation")?.name;
  if (agent) return agent;

  /* Last resort, and formatted as the rule asks rather than as the worker
     happened to concatenate it: a type alone ("Agent") is never enough, so the
     id stays attached and the separator makes it read as two facts. */
  const type = name.slice(0, name.length - stepId.slice(0, 8).length - 1);
  return `${KIND_LABEL[type] ?? type} · ${stepId.slice(0, 8)}`;
}

function NodeCard({
  node, widthPx, onFailingPath, isRootCause, selected, onSelect,
}: {
  node: RunNode;
  widthPx: number;
  onFailingPath: boolean;
  isRootCause: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = React.useState(isRootCause);
  const tone = TONE_FOR_STATUS[node.span.status];
  const t = TONE_CLASSES[tone];
  const expandable = node.children.length > 0;

  /* The accessible name carries what the width encodes. A screen reader gets no
     card width, so the duration and the attempt count have to be in the label
     rather than only in the geometry. */
  const label =
    `${node.label}: ${TONE_LABEL[tone]}` +
    (node.unreached ? "" : `, took ${formatDuration(node.totalMs)}`) +
    (node.attempts > 1 ? `, ${node.attempts} attempts` : "");

  return (
    <div role="listitem" className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={label}
        /* Width is the duration encoding, so it is the one thing here that
           cannot be a utility class — it is computed per run. */
        style={{ width: `${widthPx}px` }}
        className={cn(
          "rounded-md border px-3 py-2 text-left",
          "transition-opacity hover:opacity-90 active:opacity-80 motion-reduce:transition-none",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-border-focus",
          t.border, t.fill,
          // Unreached is dimmed, not hidden: what did not happen is information.
          node.unreached && "opacity-45",
          selected && "ring-2 ring-inset ring-border-focus",
          isRootCause && "ring-2 ring-inset ring-status-failed",
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <span className={cn("truncate text-xs font-medium", onFailingPath ? "font-semibold text-fg-max" : "text-fg-primary")}>
            {node.label}
          </span>
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />
        </div>

        <div className="mt-1 flex items-center justify-between gap-1">
          <span aria-hidden="true" className={cn("text-[11px]", t.text)}>{TONE_LABEL[tone]}</span>
          <span aria-hidden="true" className="font-mono text-[11px] tabular-nums text-fg-muted">
            {node.unreached ? "—" : formatDuration(node.totalMs)}
          </span>
        </div>

        {/*
          THE ATTEMPTS BADGE.

          A node that ran three times is one node, and the interesting fact is
          the three — not three identical cards. Worded, not just counted, and
          it distinguishes "tried again and recovered" from "tried again and
          still failed", because those send the reader to different places.
        */}
        {node.attempts > 1 && (
          <div
            aria-hidden="true"
            className={cn(
              "mt-1.5 inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5",
              node.recovered
                ? "border-status-waiting-border text-status-waiting"
                : "border-subtle text-fg-secondary",
            )}
          >
            <span className="text-[10px] font-medium tabular-nums">
              {node.attempts} attempts
            </span>
            {node.recovered && (
              <span className="text-[10px]">· recovered</span>
            )}
          </div>
        )}

        {isRootCause && (
          <div className="mt-1.5 rounded-xs bg-status-failed-subtle px-1.5 py-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-status-failed">
              Root cause
            </span>
          </div>
        )}
      </button>

      {expandable && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cn(
            "self-start rounded-xs px-1 text-[11px] text-fg-link",
            "transition-opacity hover:opacity-80 motion-reduce:transition-none",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
            "focus-visible:outline-border-focus",
          )}
        >
          <span aria-hidden="true">{expanded ? "▾ " : "▸ "}</span>
          {node.children.length} call{node.children.length === 1 ? "" : "s"}
        </button>
      )}

      {/* Agent work expands INLINE rather than navigating away — the point of the
          map is that one screen shows the shape of the run. */}
      {expanded && (
        <ul
          className="ml-2 space-y-0.5 border-l border-subtle pl-2"
          style={{ width: `${widthPx}px` }}
        >
          {node.children.map((c) => {
            const ct = TONE_CLASSES[TONE_FOR_STATUS[c.status]];
            return (
              <li key={c.spanId} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("size-1 shrink-0 rounded-full", ct.dot)} />
                <span className="truncate text-[11px] text-fg-secondary">{c.name}</span>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-fg-muted">
                  {formatDuration(c.durationMs)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Connector({ dimmed }: { dimmed: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn("mt-6 h-px w-4 shrink-0 self-start bg-border-default", dimmed && "opacity-45")}
    />
  );
}

// ── Shaping ─────────────────────────────────────────────────────────────────

/**
 * Graph nodes in execution order, each with every execution of it folded in.
 *
 * Grouped on `stepId` — the graph node's own id, which `run_spans.step_id`
 * carries and the trace API already returns. A step span with a null `stepId`
 * falls back to its own span id rather than sharing a bucket: two unrelated
 * nodes merging into one card is a worse failure than an ungrouped duplicate,
 * because the duplicate is visible and the merge is not.
 */
export function collectNodes(spans: TraceSpan[]): RunNode[] {
  const groups = new Map<string, TraceSpan[]>();
  const order: string[] = [];

  const walk = (list: TraceSpan[]) =>
    list.forEach((s) => {
      if (s.kind === "step") {
        const key = s.stepId ?? s.spanId;
        const existing = groups.get(key);
        if (existing) existing.push(s);
        else {
          groups.set(key, [s]);
          order.push(key);
        }
      }
      walk(s.children);
    });
  walk(spans);

  return order.map((key) => {
    /* Chronological, so "the last attempt" is a fact about time rather than
       about the order the tree happened to be walked in. */
    const attempts = groups
      .get(key)!
      .slice()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const last = attempts[attempts.length - 1]!;

    /* Every attempt skipped or cancelled means the run never got here. If ANY
       attempt ran, the node was reached — a node that ran once and was skipped
       on a later pass is not an unreached node. */
    const unreached = attempts.every(
      (s) => s.status === "skipped" || s.status === "cancelled",
    );

    /* Summed, not taken from the last attempt: a node that burned nine seconds
       failing and then succeeded in one cost the run ten, and the map is where
       somebody looks to find where the time went. Null only when nothing
       recorded a duration at all, which is different from zero. */
    const durations = attempts
      .map((s) => s.durationMs)
      .filter((d): d is number => d != null);
    const totalMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null;

    return {
      nodeKey: key,
      span: last,
      spanIds: attempts.map((s) => s.spanId),
      attempts: attempts.length,
      totalMs,
      children: attempts.flatMap((s) =>
        s.children.filter((c) => c.kind === "llm_call" || c.kind === "tool_call"),
      ),
      /* Resolved against EVERY attempt's children: the activation may only exist
         under the attempt that actually reached the agent. */
      label: labelFor(last, attempts.flatMap((s) => s.children)),
      unreached,
      recovered:
        attempts.length > 1 &&
        last.status === "ok" &&
        attempts.some((s) => s.status === "error"),
    };
  });
}

/** Root cause and every ancestor, so the chain that broke can be bolded. */
function pathToRootCause(spans: TraceSpan[], rootCauseSpanId: string | null): string[] {
  if (!rootCauseSpanId) return [];
  const parent = new Map<string, string | null>();
  const walk = (list: TraceSpan[], p: string | null) =>
    list.forEach((s) => {
      parent.set(s.spanId, p);
      walk(s.children, s.spanId);
    });
  walk(spans, null);

  const chain: string[] = [];
  let cur: string | null | undefined = rootCauseSpanId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = parent.get(cur);
  }
  return chain;
}

export { KIND_LABEL };
