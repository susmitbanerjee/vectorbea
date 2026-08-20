"use client";

import * as React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { cn } from "~/lib/cn";
import type { EdgeKind } from "~/mocks/builder";

/* ══════════════════════════════════════════════════════════════════════════════
   THE EDGE — four kinds, drawn by us.

   standard     graphite, solid            work flows on
   conditional  graphite, solid + label    the arm taken when the predicate holds
   error        signal, dashed             where a failure goes
   parallel     graphite, solid + fork cap one of several concurrent arms

   ROUTING IS LATTICE-AWARE. A plain bezier between two ports sails straight
   through whatever node sits between them, and on a fanned graph that is most
   of them. The curve is bowed off-axis by an amount derived from the vertical
   offset it has to cover, which keeps it clear of the rank it is crossing
   without the cost of a real orthogonal router.

   THE LABEL IS THE CONDITION, not "true". A conditional edge labelled `true` is
   a diagram of a graph; one labelled `tier == 'enterprise'` is a description of
   the workflow, and it is the thing a reviewer actually needs to read.
══════════════════════════════════════════════════════════════════════════════ */

export interface WorkflowEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  label?: string;
  /** A run is in flight along this edge — §7.2 #2. */
  flowing: boolean;
  dimmed: boolean;
  emphasised: boolean;
  onInsert?: (edgeId: string) => void;
  onDelete?: (edgeId: string) => void;
}

interface KindStyle {
  stroke: string;
  width: number;
  dash?: string;
}

const KIND: Record<EdgeKind, KindStyle> = {
  standard: { stroke: "var(--border-default)", width: 1.5 },
  conditional: { stroke: "var(--border-default)", width: 1.5 },
  error: { stroke: "var(--status-failed)", width: 1.4, dash: "5 4" },
  parallel: { stroke: "var(--border-default)", width: 1.5 },
};

/**
 * Bow the curve away from the nodes it passes.
 *
 * React Flow's bezier curvature is a constant, which produces a curve that
 * hugs the straight line for long horizontal spans — exactly the spans that
 * cross other ranks. Scaling curvature with the vertical offset pushes those
 * curves out around the intervening nodes and leaves short, level edges alone.
 */
function curvatureFor(sourceY: number, targetY: number, sourceX: number, targetX: number): number {
  const dy = Math.abs(targetY - sourceY);
  const dx = Math.abs(targetX - sourceX);
  if (dy < 8) return 0.25;
  return Math.min(0.85, 0.25 + (dy / Math.max(dx, 1)) * 0.5);
}

function WorkflowEdgeImpl({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  data, selected, markerEnd,
}: EdgeProps) {
  const d = (data ?? {}) as WorkflowEdgeData;
  const kind = d.kind ?? "standard";
  const style = KIND[kind];
  const [hovered, setHovered] = React.useState(false);

  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    curvature: curvatureFor(sourceY, targetY, sourceX, targetX),
  });

  const active = selected || hovered || d.emphasised;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={28}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          stroke: active ? "var(--accent)" : style.stroke,
          strokeWidth: active ? style.width + 0.8 : style.width,
          strokeDasharray: style.dash,
          opacity: d.dimmed ? 0.25 : 1,
          transition: "opacity 140ms var(--ease-standard)",
        }}
      />

      {/* §7.2 #2 — a gradient travelling the edge during a live run. Conditional
          render, not an opacity fade: it must stop the instant the run stops,
          because the abruptness is the information. */}
      {d.flowing ? (
        <path
          d={path}
          fill="none"
          stroke="var(--status-live)"
          strokeWidth={3.5}
          strokeDasharray="18 90"
          opacity={0.5}
          data-motion="decorative"
          className="motion-safe:animate-[ink-reveal_1.4s_linear_infinite] pointer-events-none"
        />
      ) : null}

      {(d.label || active) ? (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              "pointer-events-auto absolute flex items-center gap-1",
              d.dimmed && "opacity-30",
            )}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {d.label ? (
              <span
                className={cn(
                  "font-code text-[10px] rounded-xs border px-1 py-px",
                  "max-w-[14rem] truncate",
                  kind === "error"
                    ? "border-status-failed-border bg-status-failed-subtle text-status-failed"
                    : "border-subtle bg-surface-raised text-fg-muted",
                )}
                title={d.label}
              >
                {d.label}
              </span>
            ) : null}

            {/* Insert-on-edge, revealed on hover. A workflow is edited by adding
                a step between two others far more often than by adding one
                loose and wiring it up twice. */}
            {active && d.onInsert ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); d.onInsert?.(id); }}
                aria-label="Insert a node on this edge"
                className={cn(
                  "border-default bg-surface-raised text-fg-secondary grid size-4 place-items-center rounded-full border",
                  "hover:border-accent hover:text-accent transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring",
                )}
              >
                <svg viewBox="0 0 10 10" className="size-2" aria-hidden="true">
                  <path d="M5 1.4v7.2M1.4 5h7.2" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
                </svg>
              </button>
            ) : null}

            {active && d.onDelete ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); d.onDelete?.(id); }}
                aria-label="Delete this edge"
                className={cn(
                  "border-default bg-surface-raised text-fg-secondary grid size-4 place-items-center rounded-full border",
                  "hover:border-status-failed hover:text-status-failed transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring",
                )}
              >
                <svg viewBox="0 0 10 10" className="size-2" aria-hidden="true">
                  <path d="M2.2 3h5.6M4 3V2h2v1M3.1 3.2l.4 4.5h3l.4-4.5" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

/**
 * Same fix as `WorkflowNode` (see canvas.tsx), applied here: React Flow
 * rebuilds every edge's `data` object whenever ANYTHING in the graph
 * changes — including a node-only hover, which touches `dimmed`/
 * `emphasised` on every edge's memo dependency even for edges nowhere near
 * the hovered node. The default `React.memo` shallow-compares `data` by
 * reference, so a brand-new (but often value-identical) object fails that
 * check and re-renders every edge on every hover. Comparing the fields that
 * actually affect rendering keeps a hover to only the edges whose drawn
 * state really changed.
 */
export const WorkflowEdge = React.memo(WorkflowEdgeImpl, (a, b) => {
  const x = (a.data ?? {}) as WorkflowEdgeData;
  const y = (b.data ?? {}) as WorkflowEdgeData;
  return (
    a.selected === b.selected
    && a.sourceX === b.sourceX && a.sourceY === b.sourceY
    && a.targetX === b.targetX && a.targetY === b.targetY
    && a.sourcePosition === b.sourcePosition && a.targetPosition === b.targetPosition
    && x.kind === y.kind
    && x.label === y.label
    && x.flowing === y.flowing
    && x.dimmed === y.dimmed
    && x.emphasised === y.emphasised
    // onInsert is a fresh closure every time the edges memo in canvas.tsx
    // reruns (it wraps the stable `dispatch`, not memoized itself) — comparing
    // it by reference would defeat this comparator on every recompute even
    // when nothing the edge actually draws has changed.
  );
});
