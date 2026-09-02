"use client";

import * as React from "react";
import { CaretDown, CaretRight, ArrowsOutLineHorizontal } from "@phosphor-icons/react/dist/ssr";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatDuration } from "~/lib/format";
import type { GraphNode, TraceGraph } from "~/lib/api/trace";
import { TONE, toneForNodeStatus } from "./status-vocabulary";
import { DurationBar, NodeLabel, RunBar, StatusPill, WarningMarkers } from "./primitives";
import { EmptyTrace, GraphUnavailableNote, SuccessWithWarnings } from "./states";
import {
  MIN_NODE_W, NODE_H, VIRTUALISE_ABOVE,
  edgePath, layoutFlow, visibleNodes, type PlacedNode,
} from "./flow-layout";

/**
 * The Flow view: structure and time in one picture.
 *
 * ── WHAT THIS REPLACED, AND WHY EACH PART FAILED ────────────────────────────
 * A wrapped grid of same-sized cards labelled by node TYPE, with no edges, each
 * step rendered twice, under a banner asserting a condition it could not detect.
 * Four faults, and they are not independent:
 *
 *   - EQUAL CARDS. Duration was available only by reading a monospace number on
 *     each card. That is a table wearing the costume of a diagram, and it makes
 *     the most common question — where did the time go — the slowest to answer.
 *   - NO EDGES. The reader could not see what connects to what, which is the
 *     entire reason for drawing a graph rather than listing rows.
 *   - WRAPPED. A wrapped grid asserts an order that is an artefact of the
 *     viewport width. Resize the window and the workflow appears to change.
 *   - TWICE. Cards came from SPANS. A span is one execution, and a node that
 *     yields, retries or resumes has several.
 *
 * Now: position carries structure, width carries duration, one card per graph
 * NODE, and the server resolves the graph so the client never parses
 * `graph_json`.
 */
export function FlowView({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: TraceGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string, spanId: string | null) => void;
}) {
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = React.useState({ left: 0, width: 0 });

  const layout = React.useMemo(
    () => layoutFlow(graph.nodes, graph.edges, expanded),
    [graph.nodes, graph.edges, expanded],
  );

  /* Measured rather than assumed: the window is what makes a 200-node graph
     affordable, and a wrong viewport width would either blank the screen or
     defeat the point. */
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const sync = () => setScroll({ left: el.scrollLeft, width: el.clientWidth });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * One state update per frame, not one per scroll event.
   *
   * Every update re-renders the whole canvas, and a scroll fires far more often
   * than the screen refreshes. Unthrottled, the reflow starved the browser's own
   * smooth-scroll animation: a jump from the minimap stopped roughly two thirds
   * of the way and left the node the reader asked for off-screen. Found by
   * clicking one and measuring where it ended up.
   */
  const frame = React.useRef(0);
  const onScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    /* Read synchronously. React nulls `currentTarget` once the handler returns,
       and anything deferred would see null. */
    const left = e.currentTarget.scrollLeft;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setScroll((s) => (s.left === left ? s : { ...s, left }));
    });
  }, []);
  React.useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  /**
   * Jump to a node, respecting the reader's motion preference.
   *
   * Rule 10: every animation honours `prefers-reduced-motion`, and a smooth
   * scroll is an animation — it was the one that had been missed.
   */
  const scrollTo = React.useCallback((left: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const reduced = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
  }, []);

  const shown = React.useMemo(
    () => visibleNodes(layout.nodes, scroll.left, scroll.width),
    [layout.nodes, scroll.left, scroll.width],
  );

  const warningCount = graph.nodes.reduce((n, x) => n + x.warnings.length, 0);
  const warnedNodes = graph.nodes.filter((n) => n.warnings.length > 0);
  const succeeded = graph.nodes.every((n) => n.status !== "error");

  if (graph.nodes.length === 0) return <EmptyTrace />;

  return (
    <div className="space-y-4">
      {/*
        THE RUN BAR — the single most common misreading of an agent run.
        "4 minutes" is heard as four minutes of work. Usually it is 68 seconds of
        work and 2m38s parked on an approval, and those are opposite problems.
      */}
      <RunBar totalMs={graph.runBar.totalMs} segments={graph.runBar.segments} />

      {graph.graphUnavailable && <GraphUnavailableNote />}

      {/* The state that is always forgotten: it worked, AND there is something
          to say. Only when nothing failed — on a failed run the root cause
          banner above is the headline and this would compete with it. */}
      {succeeded && (
        <SuccessWithWarnings
          warningCount={warningCount}
          nodeCount={warnedNodes.length}
          kinds={[...new Set(warnedNodes.flatMap((n) => n.warnings.map((w) => w.detail)))].slice(0, 3)}
        />
      )}

      {/*
        HORIZONTAL SCROLL, NOT SHRINK-TO-FIT.
        A 200-node workflow scaled to fit the viewport is 200 unreadable specks,
        which is a view of nothing. Legible beats complete: real size, scroll,
        and a minimap for the overview.
      */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className={cn(
          "relative overflow-x-auto overflow-y-hidden rounded-md border border-subtle bg-surface-base",
          "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2",
          "focus-visible:outline-border-focus",
        )}
        /* Focusable so the graph can be scrolled from the keyboard without
           tabbing through every node inside it. */
        tabIndex={0}
        role="group"
        aria-label="Run flow. Scroll horizontally to see the whole workflow."
      >
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <Edges layout={layout} />
          {shown.map((p) => (
            <NodeCard
              key={p.node.id}
              placed={p}
              selected={selectedNodeId === p.node.id}
              expanded={expanded.has(p.node.id)}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(p.node.id)) next.add(p.node.id);
                  return next;
                })
              }
              onSelect={() =>
                onSelectNode(p.node.id, p.node.spanIds[p.node.spanIds.length - 1] ?? null)
              }
            />
          ))}
        </div>
      </div>

      <Minimap
        layout={layout}
        scrollLeft={scroll.left}
        viewportW={scroll.width}
        selectedNodeId={selectedNodeId}
        onScrollTo={scrollTo}
      />

      <Legend virtualised={layout.nodes.length > VIRTUALISE_ABOVE} count={layout.nodes.length} />
    </div>
  );
}

// ── Edges ───────────────────────────────────────────────────────────────────

/**
 * The connections, drawn behind the cards.
 *
 * ── THE ROAD NOT TAKEN IS DRAWN TOO ─────────────────────────────────────────
 * An edge into a node that never ran is DASHED and dimmed, never omitted. A run
 * that failed at step two and a run that was never going to reach step four look
 * identical if the page only draws what executed, and "why did nothing get
 * notified" is one of the two questions this view exists to answer.
 *
 * `traversed === null` means the derivation could not tell — a join reached from
 * two branches that both ran. It renders as an ordinary edge, claiming nothing,
 * rather than as taken or as not taken.
 */
function Edges({ layout }: { layout: ReturnType<typeof layoutFlow> }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={layout.width}
      height={layout.height}
      aria-hidden="true"
    >
      <defs>
        <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 7 4 L 0 7 z" className="fill-fg-disabled" />
        </marker>
      </defs>
      {layout.edges.map((e) => (
        <path
          key={e.edge.id}
          d={edgePath(e)}
          fill="none"
          markerEnd="url(#flow-arrow)"
          className={cn(
            "stroke-border-strong",
            e.dimmed && "stroke-border-subtle opacity-60",
          )}
          strokeWidth={e.edge.traversed === true ? 2 : 1}
          /* Dashed carries "this did not happen" without relying on the dimming,
             which is the encoding that survives a low-contrast display. */
          strokeDasharray={e.dimmed ? "4 4" : undefined}
        />
      ))}
    </svg>
  );
}

// ── Node ────────────────────────────────────────────────────────────────────

function NodeCard({
  placed, selected, expanded, onToggle, onSelect,
}: {
  placed: PlacedNode;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const n = placed.node;
  const tone = toneForNodeStatus(n.status);
  const t = TONE[tone];
  const expandable = (n.summary?.activations ?? 0) > 0;
  /* Members are scaled against each other, not against the whole run: the
     question inside one team node is which MEMBER took the time. */
  const slowestMemberMs = Math.max(0, ...(n.summary?.members ?? []).map((m) => m.totalMs ?? 0));

  /*
   * The accessible name carries what the GEOMETRY encodes. A screen reader gets
   * no card width, so duration, attempts and status all have to be in words —
   * otherwise the entire time encoding is sighted-only.
   */
  const a11y =
    `${n.label}. ${t.label}` +
    (n.reached ? `, took ${formatDuration(n.totalMs)}` : "") +
    (n.attempts > 1 ? `, ${n.attempts} attempts` : "") +
    (placed.clamped ? ", the widest step in this run" : "") +
    (n.isRootCause ? ". This is the root cause." : "");

  return (
    <div
      className="absolute"
      style={{ left: placed.x, top: placed.y, width: placed.w }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={a11y}
        style={{ height: NODE_H }}
        className={cn(
          "flex w-full flex-col justify-between rounded-md px-2.5 py-2 text-left",
          "transition-opacity hover:opacity-90 active:opacity-80 motion-reduce:transition-none",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-border-focus",
          t.fill, t.border, t.borderWidth,
          t.borderStyle === "dashed" ? "border-dashed" : "border-solid",
          /* Dimmed, never hidden. What did not happen is information. */
          !n.reached && "opacity-45",
          selected && "ring-2 ring-inset ring-border-focus",
        )}
      >
        <div className="flex items-start justify-between gap-1">
          <NodeLabel label={n.label} muted={!n.reached} emphasis={n.isRootCause} />
          <Icon icon={t.icon} size="xs" decorative className={cn("mt-0.5 shrink-0", t.text)} />
        </div>

        <div className="flex items-center justify-between gap-1">
          {/* The root cause outranks the status word: on a failed run "Failed"
              is true of several nodes and only one of them is the answer. */}
          {n.isRootCause ? (
            <span aria-hidden="true" className={cn("truncate text-[10px] font-semibold", t.text)}>
              Root cause
            </span>
          ) : (
            <StatusPill status={n.status} size="sm" aria-hidden />
          )}
          <span aria-hidden="true"
                className="shrink-0 font-mono text-[10px] tabular-nums text-fg-muted">
            {n.reached ? formatDuration(n.totalMs) : "—"}
            {/* A node pinned to the maximum width understates its share by
                construction. Say so, so the reader trusts the number. */}
            {placed.clamped && (
              <Icon icon={ArrowsOutLineHorizontal} size="xs" decorative
                    className="ml-0.5 inline text-fg-muted" />
            )}
          </span>
        </div>

        {(n.warnings.length > 0 || n.attempts > 1) && (
          <div className="flex items-center gap-1 overflow-hidden">
            <WarningMarkers warnings={n.warnings} />
          </div>
        )}
      </button>

      {/*
        AGENT AND TEAM NODES CARRY A SUMMARY LINE.
        "3 agents, researcher failed" answers the question without a second
        click; the expansion is for when the answer is not enough.
      */}
      {expandable && (
        <>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={cn(
              "mt-0.5 flex w-full items-center gap-1 rounded-xs px-1 text-left",
              "transition-opacity hover:opacity-80 motion-reduce:transition-none",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-border-focus",
            )}
          >
            <Icon icon={expanded ? CaretDown : CaretRight} size="xs" decorative
                  className="shrink-0 text-fg-muted" />
            <span className="truncate text-[10px] text-fg-secondary">
              {n.summary!.activations} agent{n.summary!.activations === 1 ? "" : "s"}
              {n.summary!.failingMember ? (
                <>
                  {" · "}
                  <span className="text-status-failed">{n.summary!.failingMember} failed</span>
                </>
              ) : null}
            </span>
          </button>

          {expanded && (
            <ul className="ml-2 border-l border-subtle pl-2">
              {/* Each member carries its own status and time. A list of names
                  would answer neither question this expansion is opened for. */}
              {n.summary!.members.map((m) => (
                <li key={m.name} className="py-0.5">
                  <div className="flex items-center gap-1.5">
                    <StatusPill status={m.status} size="dot" />
                    <span className="truncate text-[10px] text-fg-secondary">{m.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-fg-muted">
                      {m.totalMs == null ? "—" : formatDuration(m.totalMs)}
                    </span>
                  </div>
                  <DurationBar
                    ms={m.totalMs}
                    slowestMs={slowestMemberMs}
                    tone={toneForNodeStatus(m.status)}
                    className="mt-0.5"
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ── Minimap ─────────────────────────────────────────────────────────────────

/**
 * The whole graph at a glance, with the viewport marked.
 *
 * This is what makes horizontal scrolling honest. Without it a wide graph hides
 * the fact that there IS more, and a reader who never scrolls concludes the
 * workflow is five nodes long. Status colour is kept here — at this size it is
 * the only channel left, and finding the red speck is exactly what it is for.
 */
function Minimap({
  layout, scrollLeft, viewportW, selectedNodeId, onScrollTo,
}: {
  layout: ReturnType<typeof layoutFlow>;
  scrollLeft: number;
  viewportW: number;
  selectedNodeId: string | null;
  onScrollTo: (left: number) => void;
}) {
  /* Nothing to overview when it already fits. */
  if (layout.width <= viewportW || viewportW <= 0) return null;

  const H = 28;
  const scale = 1 / layout.width;
  /* Centre the requested node in the viewport, clamped to the real range so a
     node near either end still lands somewhere the reader can see it. */
  const centreOn = (x: number, w: number) =>
    onScrollTo(Math.max(0, Math.min(layout.width - viewportW, x + w / 2 - viewportW / 2)));

  return (
    <div
      className="relative h-7 w-full overflow-hidden rounded-xs border border-subtle bg-surface-sunken"
      role="group"
      aria-label="Overview of the whole run. Select a step to scroll to it."
    >
      {layout.nodes.map((p) => {
        const t = TONE[toneForNodeStatus(p.node.status)];
        return (
          /*
            THE BUTTON IS FULL HEIGHT; THE MARK INSIDE IT IS NOT.

            The first version sized the button to the 6px mark, which is a 6px
            target inside a 28px control — findable only by accident, and the
            first click in testing missed it. The hit area is the whole column;
            the mark is what is drawn.
          */
          <button
            key={p.node.id}
            type="button"
            title={`${p.node.label} — ${p.node.reached ? formatDuration(p.node.totalMs) : "not reached"}`}
            aria-label={`Scroll to ${p.node.label}`}
            onClick={() => centreOn(p.x, p.w)}
            style={{
              left: `${p.x * scale * 100}%`,
              width: `${Math.max(0.4, p.w * scale * 100)}%`,
            }}
            className={cn(
              "absolute inset-y-0 flex items-center justify-stretch px-px",
              "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1",
              "focus-visible:outline-border-focus",
            )}
          >
            <span
              aria-hidden="true"
              style={{ marginTop: (p.y / Math.max(1, layout.height)) * H }}
              className={cn(
                "h-1.5 w-full rounded-[1px]",
                t.solid,
                !p.node.reached && "opacity-40",
                selectedNodeId === p.node.id && "ring-1 ring-border-focus",
              )}
            />
          </button>
        );
      })}

      {/* The viewport. Pointer-events off so the node buttons underneath stay
          clickable — the indicator is a readout, not a control. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 rounded-xs border border-fg-secondary bg-fg-primary/5"
        style={{
          left: `${Math.max(0, scrollLeft) * scale * 100}%`,
          width: `${Math.min(100, viewportW * scale * 100)}%`,
        }}
      />
    </div>
  );
}

// ── Legend ──────────────────────────────────────────────────────────────────

function Legend({ virtualised, count }: { virtualised: boolean; count: number }) {
  return (
    <Text variant="caption" className="block text-fg-muted">
      Width shows how long each step took, relative to the slowest in this run.
      Dashed and dimmed steps were never reached. Select a step to open it in the
      timeline and inspector.
      {virtualised && ` Showing ${count} steps; the graph loads as you scroll.`}
    </Text>
  );
}

/** Exported for tests: the narrowest a node is ever drawn. */
export { MIN_NODE_W };
export type { GraphNode };
