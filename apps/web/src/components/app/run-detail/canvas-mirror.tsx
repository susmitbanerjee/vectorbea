"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { cellPath } from "~/components/app/ribbon/geometry";
import { buildGraph } from "~/mocks/run-detail";
import { useReplay, statesAt } from "./replay";
import { PaneHeader } from "./step-timeline";
import type { CellState } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   CENTRE PANE · CANVAS MIRROR

   Read-only. This is not the builder with editing disabled — it is a different
   thing that happens to share a shape: the graph with run state painted on.

   Three motions from §7.2, and no others:
   · #2 EDGE FLOW — a gradient travels edges into the executing node during a
     live run, and stops INSTANTLY when the run is not running. The abruptness
     is the information, so it is a conditional render rather than a fade.
   · #6 FAILURE JOLT — the failed node shakes 2px once on arrival. Once. Keyed
     on the node so re-selecting it does not re-fire, because a shake that
     repeats every time you click reads as a broken UI rather than an event.
   · #7 REPLAY SCRUB — states come from statesAt(), so dragging the ribbon
     rewinds the graph rather than moving a highlight around a finished picture.
══════════════════════════════════════════════════════════════════════════════ */

const NODE_W = 128;
const NODE_H = 40;

const STATE_FILL: Record<CellState, { fill: string; stroke: string; text: string }> = {
  committed: { fill: "var(--status-success-subtle)", stroke: "var(--status-success-border)", text: "var(--status-success)" },
  recovered: { fill: "var(--status-success-subtle)", stroke: "var(--status-success-border)", text: "var(--status-success)" },
  executing: { fill: "var(--status-live-subtle)", stroke: "var(--status-live-border)", text: "var(--status-live)" },
  gated: { fill: "var(--status-waiting-subtle)", stroke: "var(--status-waiting-border)", text: "var(--status-waiting)" },
  failed: { fill: "var(--status-failed-subtle)", stroke: "var(--status-failed-border)", text: "var(--status-failed)" },
  pending: { fill: "transparent", stroke: "var(--border-subtle)", text: "var(--fg-disabled)" },
  skipped: { fill: "transparent", stroke: "var(--border-subtle)", text: "var(--fg-disabled)" },
};

export function CanvasMirror({ className }: { className?: string }) {
  const { run, focusIndex, selectedIndex, scrubbing, select } = useReplay();
  const graph = React.useMemo(() => buildGraph(run), [run]);
  const states = React.useMemo(
    () => statesAt(run.nodes, focusIndex, scrubbing),
    [run.nodes, focusIndex, scrubbing],
  );

  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const minY = Math.min(...graph.nodes.map((n) => n.y));
  const viewBox = `${-24} ${minY - NODE_H} ${graph.width + 48} ${graph.height + NODE_H}`;

  /**
   * The SVG is rendered at its natural size and the container scrolls.
   *
   * Fitting a 12-node graph (2,000+ px wide) into an 880px pane by scaling makes
   * every node about 55px wide, which renders the labels as illegible smudges —
   * a graph you cannot read is not a mirror of anything. Natural size plus
   * horizontal pan keeps nodes at a readable 128px and makes the pane behave
   * like the canvas it is mirroring.
   */
  const naturalWidth = graph.width + 48;
  const naturalHeight = graph.height + NODE_H;

  const fit = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    // Fit the HEIGHT, never below a legible floor, and let width overflow.
    const next = Math.max(0.55, Math.min(1.4, (el.clientHeight - 24) / naturalHeight));
    setZoom(next);
    setPan({ x: 0, y: 0 });
  }, [naturalHeight]);

  // Centre the focused node on selection, so clicking a step in the timeline
  // brings its node into view rather than leaving you to hunt for it.
  React.useEffect(() => {
    const el = wrapRef.current;
    const gn = graph.nodes[focusIndex];
    if (!el || !gn) return;
    const target = -(gn.x * zoom) + el.clientWidth / 2 - (NODE_W * zoom) / 2;
    setPan((p) => (Math.abs(p.x - target) < 4 ? p : { x: target, y: p.y }));
  }, [focusIndex, graph.nodes, zoom]);

  /* The jolt fires once per arrival at a failed node, keyed on the node id so
     re-selecting the same node does not re-shake it. */
  const [jolted, setJolted] = React.useState<string | null>(null);
  const failedIndex = run.nodes.findIndex((n) => n.state === "failed");
  React.useEffect(() => {
    if (failedIndex === -1) return;
    const id = run.nodes[failedIndex].id;
    if (jolted === id) return;
    const timer = window.setTimeout(() => setJolted(id), 240);
    return () => window.clearTimeout(timer);
  }, [failedIndex, run.nodes, jolted]);

  const live = run.status === "running" && !scrubbing;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
      <PaneHeader title="Canvas">
        <Text variant="caption" tone="muted">read-only</Text>
        <div className="flex items-center gap-0.5">
          <ZoomButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>−</ZoomButton>
          <button
            onClick={fit}
            className="font-ui text-caption text-fg-muted hover:text-fg-primary rounded-xs px-1.5 py-0.5 outline-none transition-colors duration-fast focus-visible:focus-ring"
          >
            Fit
          </button>
          <ZoomButton label="Zoom in" onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))}>+</ZoomButton>
        </div>
      </PaneHeader>

      <div
        ref={wrapRef}
        className="bg-surface-base relative min-h-0 flex-1 overflow-hidden"
        onPointerDown={(e) => {
          const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
          const move = (ev: PointerEvent) => setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <svg
          viewBox={viewBox}
          width={naturalWidth}
          height={naturalHeight}
          role="img"
          aria-label={`Workflow graph for ${run.workflowName} with run state painted on`}
          className="absolute left-0 top-1/2 cursor-grab active:cursor-grabbing"
          style={{
            transform: `translate(${pan.x}px, calc(-50% + ${pan.y}px)) scale(${zoom})`,
            transformOrigin: "0 50%",
          }}
        >
          <defs>
            <linearGradient id="edge-flow" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--status-live)" stopOpacity="0" />
              <stop offset="50%" stopColor="var(--status-live)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--status-live)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* ── Edges ────────────────────────────────────────────────────── */}
          {graph.edges.map((edge) => {
            const a = graph.nodes[edge.from];
            const b = graph.nodes[edge.to];
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            const d = `M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
            const traversed = edge.to <= focusIndex;
            const flowing = live && edge.to === focusIndex;

            return (
              <g key={`${edge.from}-${edge.to}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={traversed ? "var(--border-strong)" : "var(--border-subtle)"}
                  strokeWidth={1.4}
                />
                {/* §7.2 #2. Conditional, not faded — it must stop instantly. */}
                {flowing ? (
                  <path
                    d={d}
                    fill="none"
                    stroke="url(#edge-flow)"
                    strokeWidth={4}
                    strokeDasharray="24 120"
                    data-motion="decorative"
                    className="motion-safe:animate-[ink-reveal_1.4s_linear_infinite]"
                  />
                ) : null}
              </g>
            );
          })}

          {/* ── Nodes ────────────────────────────────────────────────────── */}
          {graph.nodes.map((gn) => {
            const state = states[gn.index];
            const style = STATE_FILL[state];
            const isFocus = gn.index === focusIndex;
            const isSelected = gn.index === selectedIndex;
            const joltNow = state === "failed" && jolted !== run.nodes[gn.index].id;

            return (
              <g
                key={gn.node.id}
                transform={`translate(${gn.x} ${gn.y})`}
                onClick={(e) => { e.stopPropagation(); select(gn.index); }}
                className="cursor-pointer"
                data-motion={joltNow ? "decorative" : undefined}
              >
                <g className={joltNow ? "motion-safe:animate-[ink-cell-breathe_120ms_ease-in-out_1]" : undefined}>
                  <path
                    d={cellPath(NODE_W, NODE_H)}
                    fill={style.fill}
                    stroke={isSelected ? "var(--border-focus)" : style.stroke}
                    strokeWidth={isSelected ? 2 : 1.2}
                  />
                  {isFocus && !isSelected ? (
                    <path
                      d={cellPath(NODE_W + 6, NODE_H + 6)}
                      transform="translate(-3 -3)"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={1.4}
                      opacity={0.7}
                    />
                  ) : null}
                  {state === "gated" ? (
                    <path
                      d={cellPath(NODE_W + 8, NODE_H + 8)}
                      transform="translate(-4 -4)"
                      fill="none"
                      stroke="var(--status-waiting)"
                      strokeWidth={2}
                      opacity={0.18}
                      data-motion="decorative"
                      className="motion-safe:animate-[ink-gate-breathe_2.6s_ease-in-out_infinite]"
                    />
                  ) : null}

                  <text
                    x={10} y={17}
                    className="font-code"
                    fontSize={8}
                    fill={style.text}
                  >
                    {gn.node.id}
                  </text>
                  <text
                    x={10} y={30}
                    className="font-ui"
                    fontSize={10}
                    fill={state === "pending" || state === "skipped" ? "var(--fg-disabled)" : "var(--fg-primary)"}
                  >
                    {truncate(gn.node.name, 17)}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* ── Minimap ──────────────────────────────────────────────────────── */}
        <div className="border-subtle bg-surface-overlay/90 absolute bottom-2 right-2 rounded-sm border p-1.5">
          <svg viewBox={viewBox} width={104} height={40} aria-hidden="true">
            {graph.nodes.map((gn) => (
              <rect
                key={gn.node.id}
                x={gn.x} y={gn.y} width={NODE_W} height={NODE_H} rx={4}
                fill={STATE_FILL[states[gn.index]].stroke}
                opacity={gn.index === focusIndex ? 1 : 0.5}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "font-code text-fg-muted hover:text-fg-primary grid size-5 place-items-center rounded-xs text-[12px]",
        "transition-colors duration-fast outline-none focus-visible:focus-ring",
      )}
    >
      {children}
    </button>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
