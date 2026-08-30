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
 * WHAT DID NOT HAPPEN IS THE POINT.
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
   * Steps are the workflow's own nodes; ticks and the run wrapper are runtime
   * mechanics the builder never drew, so they are flattened away here and kept
   * for the timeline where they matter.
   */
  const steps = React.useMemo(() => collectSteps(spans), [spans]);

  /*
   * The failing path: the root cause and everything that contained it. Bolded so
   * the eye lands on the chain that broke rather than on the longest bar.
   */
  const failingPath = React.useMemo(
    () => new Set(pathToRootCause(spans, rootCauseSpanId)),
    [spans, rootCauseSpanId],
  );

  if (steps.length === 0) {
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
        {steps.map((step, i) => (
          <React.Fragment key={step.span.spanId}>
            {i > 0 && <Connector dimmed={step.unreached} />}
            <StepNode
              node={step}
              onFailingPath={failingPath.has(step.span.spanId)}
              isRootCause={step.span.spanId === rootCauseSpanId}
              selected={selectedSpanId === step.span.spanId}
              onSelect={() => onSelectSpan(step.span.spanId)}
            />
          </React.Fragment>
        ))}
      </div>

      <Text variant="caption" className="text-fg-muted">
        Dimmed steps were never reached. Click any step to open it in the timeline
        and inspector.
      </Text>
    </div>
  );
}

interface StepNode {
  span: TraceSpan;
  /** Model and tool calls beneath this step, shown when expanded. */
  children: TraceSpan[];
  unreached: boolean;
}

function StepNode({
  node, onFailingPath, isRootCause, selected, onSelect,
}: {
  node: StepNode;
  onFailingPath: boolean;
  isRootCause: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = React.useState(isRootCause);
  const tone = TONE_FOR_STATUS[node.span.status];
  const t = TONE_CLASSES[tone];
  const expandable = node.children.length > 0;

  return (
    <div role="listitem" className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "w-44 rounded-md border px-3 py-2 text-left",
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
            {node.span.name}
          </span>
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />
        </div>

        <div className="mt-1 flex items-center justify-between">
          <span className={cn("text-[11px]", t.text)}>{TONE_LABEL[tone]}</span>
          <span className="font-mono text-[11px] tabular-nums text-fg-muted">
            {node.unreached ? "—" : formatDuration(node.span.durationMs)}
          </span>
        </div>

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
        <ul className="ml-2 w-44 space-y-0.5 border-l border-subtle pl-2">
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

/** Steps in execution order, each with the calls that happened inside it. */
function collectSteps(spans: TraceSpan[]): StepNode[] {
  const out: StepNode[] = [];
  const walk = (list: TraceSpan[]) =>
    list.forEach((s) => {
      if (s.kind === "step") {
        out.push({
          span: s,
          children: s.children.filter((c) => c.kind === "llm_call" || c.kind === "tool_call"),
          /* "skipped" and "cancelled" both mean the run never got here. A step
             with no duration and no status is the same thing recorded thinly. */
          unreached: s.status === "skipped" || s.status === "cancelled",
        });
      }
      walk(s.children);
    });
  walk(spans);
  return out;
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
