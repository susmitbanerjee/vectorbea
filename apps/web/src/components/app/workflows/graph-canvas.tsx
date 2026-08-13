"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { cellPath } from "~/components/app/ribbon/geometry";
import { layoutGraph } from "~/mocks/graph-layout";
import type { VersionNode } from "~/mocks/workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   <VersionGraph> — a workflow definition drawn as a graph.

   One component behind four jobs: the static preview on the overview, both
   panes of the side-by-side diff, the overlay diff, and the execution path a
   simulation took. They are the same picture with different paint, and building
   them separately would guarantee that a node sits 12px differently on the
   overview than in the diff — which reads as a change the author did not make.

   PAINT IS A FUNCTION OF NODE ID, not a prop per node, so a caller can derive it
   from a diff, a validation result or a simulation without this component
   knowing about any of them.

   Node geometry is the Ribbon's `cellPath` at 128×40, matching the run-detail
   canvas mirror: a node is a durable unit of work wherever it is drawn.
══════════════════════════════════════════════════════════════════════════════ */

const NODE_W = 128;
const NODE_H = 40;

export type NodePaint =
  | "default"
  /** Diff states — §10 Workflows: added verdant, removed signal, modified ember. */
  | "added" | "removed" | "modified" | "unchanged"
  /** Simulation and validation. */
  | "path" | "skipped" | "gate" | "invalid";

interface PaintStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  dash?: string;
  opacity?: number;
  /**
   * A shape in the corner carrying the same meaning as the colour.
   *
   * Verdant/signal/ember is a red-green pairing, which is the exact pairing
   * deuteranopia collapses — a diff legible only in colour is a diff a
   * meaningful fraction of operators cannot read. The glyph makes added,
   * removed and modified distinguishable in greyscale and on a printout.
   */
  mark?: "plus" | "minus" | "tilde";
}

const PAINT: Record<NodePaint, PaintStyle> = {
  default: { fill: "var(--bg-raised)", stroke: "var(--border-default)", strokeWidth: 1.2, text: "var(--fg-secondary)" },
  // Added: outline rather than fill, so a new node reads as drawn ON the graph
  // rather than as a node that has already succeeded.
  added: { fill: "var(--status-success-subtle)", stroke: "var(--status-success)", strokeWidth: 2, text: "var(--status-success)", mark: "plus" },
  removed: { fill: "var(--status-failed-subtle)", stroke: "var(--status-failed)", strokeWidth: 1.6, text: "var(--status-failed)", dash: "4 3", mark: "minus" },
  modified: { fill: "var(--status-waiting-subtle)", stroke: "var(--status-waiting)", strokeWidth: 2, text: "var(--status-waiting)", mark: "tilde" },
  // Dimmed, not hidden. The unchanged nodes are the context that makes the
  // changed ones legible as a position in a sequence.
  unchanged: { fill: "transparent", stroke: "var(--border-subtle)", strokeWidth: 1, text: "var(--fg-disabled)", opacity: 0.55 },
  path: { fill: "var(--accent-subtle)", stroke: "var(--accent-border)", strokeWidth: 1.4, text: "var(--accent)" },
  skipped: { fill: "transparent", stroke: "var(--border-subtle)", strokeWidth: 1, text: "var(--fg-disabled)", dash: "3 3", opacity: 0.5 },
  gate: { fill: "var(--status-waiting-subtle)", stroke: "var(--status-waiting-border)", strokeWidth: 1.6, text: "var(--status-waiting)" },
  invalid: { fill: "var(--status-failed-subtle)", stroke: "var(--status-failed)", strokeWidth: 2, text: "var(--status-failed)" },
};

export const PAINT_LABEL: Record<NodePaint, string> = {
  default: "unchanged",
  added: "added",
  removed: "removed",
  modified: "modified",
  unchanged: "unchanged",
  path: "on the execution path",
  skipped: "skipped",
  gate: "waits on a person",
  invalid: "has a validation error",
};

export interface VersionGraphProps {
  nodes: VersionNode[];
  paint?: (node: VersionNode, index: number) => NodePaint;
  /** Highlighted with the focus ring — the node a list selection points at. */
  selectedId?: string | null;
  onSelect?: (node: VersionNode) => void;
  height?: number;
  /** Rendered above the graph as its accessible name. */
  label: string;
  className?: string;
}

export function VersionGraph({
  nodes, paint, selectedId, onSelect, height = 260, label, className,
}: VersionGraphProps) {
  const graph = React.useMemo(() => layoutGraph(nodes), [nodes]);

  if (nodes.length === 0) {
    return (
      <div
        className={cn("border-subtle grid place-items-center rounded-md border border-dashed", className)}
        style={{ height }}
      >
        <span className="font-ui text-caption text-fg-muted">No nodes in this version.</span>
      </div>
    );
  }

  const minY = Math.min(...graph.nodes.map((n) => n.y));
  const viewBox = `-24 ${minY - NODE_H} ${graph.width + 48} ${graph.height + NODE_H}`;

  return (
    <div
      className={cn("bg-surface-sunken border-subtle overflow-x-auto rounded-md border", className)}
      style={{ height }}
    >
      <svg
        viewBox={viewBox}
        role="img"
        aria-label={`${label}. ${describe(nodes, paint)}`}
        // Natural width with the container scrolling, never scaled to fit: a
        // 12-node graph squeezed into an 880px pane renders every label as an
        // illegible smudge, and a graph you cannot read is not a preview.
        className="block h-full"
        style={{ width: graph.width + 48, minWidth: "100%" }}
        preserveAspectRatio="xMinYMid meet"
      >
        {graph.edges.map((edge) => {
          const a = graph.nodes[edge.from];
          const b = graph.nodes[edge.to];
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          const state = paint?.(b.node, b.index) ?? "default";
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={`M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={state === "unchanged" || state === "skipped" ? "var(--border-subtle)" : "var(--border-default)"}
              strokeWidth={1.3}
              strokeDasharray={state === "removed" ? "4 3" : undefined}
              opacity={state === "unchanged" ? 0.5 : 1}
            />
          );
        })}

        {graph.nodes.map((laid) => {
          const state = paint?.(laid.node, laid.index) ?? "default";
          const style = PAINT[state];
          const selected = selectedId === laid.node.id;

          return (
            <g
              key={laid.node.id}
              transform={`translate(${laid.x} ${laid.y})`}
              opacity={style.opacity ?? 1}
            >
              <path
                d={cellPath(NODE_W, NODE_H)}
                fill={style.fill}
                stroke={selected ? "var(--border-focus)" : style.stroke}
                strokeWidth={selected ? 2.4 : style.strokeWidth}
                strokeDasharray={style.dash}
              />
              {style.mark ? <DiffMark mark={style.mark} colour={style.text} x={NODE_W - 14} y={6} /> : null}

              <text x={10} y={16} className="font-code" fontSize={7.5} fill={style.text}>
                {laid.node.kind}
              </text>
              <text
                x={10} y={29}
                className="font-ui"
                fontSize={10}
                fill={state === "unchanged" || state === "skipped" ? "var(--fg-disabled)" : "var(--fg-primary)"}
              >
                {truncate(laid.node.name, 17)}
              </text>

              {onSelect ? (
                // A real <button> over the cell rather than a click handler on
                // the <g>: SVG groups are not focusable, and a graph you cannot
                // tab through is a graph a keyboard user cannot read.
                <foreignObject x={0} y={0} width={NODE_W} height={NODE_H}>
                  <button
                    type="button"
                    onClick={() => onSelect(laid.node)}
                    aria-label={`${laid.node.name} — ${PAINT_LABEL[state]}`}
                    className="size-full rounded-sm outline-none focus-visible:focus-ring"
                  />
                </foreignObject>
              ) : (
                <title>{`${laid.node.name} — ${PAINT_LABEL[state]}`}</title>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * The graph as a sentence, for the accessible name.
 *
 * A screen reader on an unlabelled <svg role="img"> gets "image". This is the
 * only version of the diff a non-sighted reviewer has, so it states the counts
 * rather than the shape.
 */
function describe(nodes: VersionNode[], paint?: (node: VersionNode, index: number) => NodePaint): string {
  if (!paint) return `${nodes.length} nodes: ${nodes.map((n) => n.name).join(", ")}.`;
  const counts = new Map<NodePaint, number>();
  nodes.forEach((node, i) => {
    const state = paint(node, i);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([state, n]) => `${n} ${PAINT_LABEL[state]}`)
    .join(", ") + ".";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** The colour-independent half of the diff encoding. */
function DiffMark({
  mark, colour, x, y,
}: {
  mark: NonNullable<PaintStyle["mark"]>;
  colour: string;
  x: number;
  y: number;
}) {
  const d = mark === "plus" ? "M4 0.6v6.8M0.6 4h6.8"
    : mark === "minus" ? "M0.6 4h6.8"
      : "M0.6 4.6c1-2 2.4-2 3.4 0s2.4 2 3.4 0";
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <path d={d} fill="none" stroke={colour} strokeWidth={1.5} strokeLinecap="round" />
    </g>
  );
}

/* ── Legend ───────────────────────────────────────────────────────────────── */

export function GraphLegend({ states, className }: { states: NodePaint[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {states.map((state) => {
        const style = PAINT[state];
        return (
          <li key={state} className="flex items-center gap-1.5">
            <svg viewBox="0 0 14 10" aria-hidden="true" className="h-2.5 w-3.5 shrink-0">
              <path
                d={cellPath(14, 10)}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={1.2}
                strokeDasharray={style.dash}
                opacity={style.opacity ?? 1}
              />
              {style.mark ? <DiffMark mark={style.mark} colour={style.text} x={3.2} y={1} /> : null}
            </svg>
            <span className="font-ui text-caption text-fg-muted capitalize">{PAINT_LABEL[state]}</span>
          </li>
        );
      })}
    </ul>
  );
}
