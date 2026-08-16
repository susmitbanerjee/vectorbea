"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { cellPath } from "~/components/app/ribbon/geometry";
import { layoutGraph } from "~/mocks/graph-layout";
import { NODE_MARKS } from "~/components/icons/nodes";
import type { Blueprint, BlueprintNode } from "~/mocks/architect";

/* ══════════════════════════════════════════════════════════════════════════════
   THE BLUEPRINT MATERIALISING — the moment the product is remembered for.

   A plan that appears all at once reads as a canned response. One that
   assembles reads as work, and — more usefully — it lets somebody follow the
   reasoning in the order it was made.

   THE ORDER IS THE ARGUMENT: nodes land first, in execution order, each with
   the checkpoint bloom from §7.2; then the edges draw between them; then the
   gates land last, because a gate is a decision ABOUT the plan rather than a
   step in it, and landing it last is what makes it noticeable.

   ANIMATION IS TRANSFORM AND OPACITY ONLY (rule 9), and every part of it is
   inside `motion-safe` — with reduced motion the whole plan is simply present,
   which is the correct reduced-motion behaviour for a reveal.
══════════════════════════════════════════════════════════════════════════════ */

const NODE_W = 132;
const NODE_H = 44;

export type StreamPhase = "idle" | "nodes" | "edges" | "gates" | "done";

/**
 * Drives the reveal.
 *
 * Returns how many nodes have landed and which phase is running, so the canvas
 * stays a pure function of that state — which is also what makes the whole
 * thing skippable: jump the counters to the end and the finished plan is there.
 */
export function useBlueprintStream(blueprint: Blueprint | null, running: boolean) {
  const [landed, setLanded] = React.useState(0);
  const [phase, setPhase] = React.useState<StreamPhase>("idle");

  const nonGates = React.useMemo(
    () => (blueprint?.nodes ?? []).filter((n) => n.kind !== "approval"),
    [blueprint],
  );
  const gates = React.useMemo(
    () => (blueprint?.nodes ?? []).filter((n) => n.kind === "approval"),
    [blueprint],
  );

  React.useEffect(() => {
    if (!running || !blueprint) return;
    setLanded(0);
    setPhase("nodes");

    const timers: number[] = [];
    // 260ms per node: slow enough to read the label as it lands, fast enough
    // that a seven-node plan is complete in under two seconds.
    nonGates.forEach((_, i) => {
      timers.push(window.setTimeout(() => setLanded(i + 1), 260 * (i + 1)));
    });

    const afterNodes = 260 * (nonGates.length + 1);
    timers.push(window.setTimeout(() => setPhase("edges"), afterNodes));
    timers.push(window.setTimeout(() => setPhase("gates"), afterNodes + 520));

    gates.forEach((_, i) => {
      timers.push(window.setTimeout(
        () => setLanded(nonGates.length + i + 1),
        afterNodes + 520 + 300 * (i + 1),
      ));
    });

    timers.push(window.setTimeout(
      () => setPhase("done"),
      afterNodes + 520 + 300 * (gates.length + 1),
    ));

    return () => { for (const t of timers) window.clearTimeout(t); };
  }, [running, blueprint, nonGates, gates]);

  const skip = React.useCallback(() => {
    setLanded((blueprint?.nodes ?? []).length);
    setPhase("done");
  }, [blueprint]);

  return { landed, phase, skip, total: (blueprint?.nodes ?? []).length };
}

/* ── Canvas ───────────────────────────────────────────────────────────────── */

export function BlueprintCanvas({
  blueprint, landed, phase, selectedId, onSelect, height = 420,
}: {
  blueprint: Blueprint;
  landed: number;
  phase: StreamPhase;
  selectedId: string | null;
  onSelect: (id: string) => void;
  height?: number;
}) {
  /* Ordered so gates sit last in the reveal sequence while keeping their real
     position in the graph — the layout is execution order, the reveal is not. */
  const revealOrder = React.useMemo(() => {
    const nonGates = blueprint.nodes.filter((n) => n.kind !== "approval");
    const gates = blueprint.nodes.filter((n) => n.kind === "approval");
    return [...nonGates, ...gates].map((n) => n.id);
  }, [blueprint.nodes]);

  const graph = React.useMemo(() => layoutGraph(blueprint.nodes), [blueprint.nodes]);
  const visible = React.useCallback(
    (id: string) => revealOrder.indexOf(id) < landed,
    [revealOrder, landed],
  );

  const minY = Math.min(...graph.nodes.map((n) => n.y));
  const maxY = Math.max(...graph.nodes.map((n) => n.y)) + NODE_H;
  const viewBox = `-20 ${minY - 20} ${graph.width + 40} ${maxY - minY + 40}`;

  const edgesVisible = phase === "edges" || phase === "gates" || phase === "done";

  return (
    <div
      className="bg-surface-sunken border-subtle overflow-x-auto rounded-md border"
      style={{ height }}
    >
      <svg
        viewBox={viewBox}
        role="img"
        aria-label={`Blueprint: ${blueprint.nodes.length} steps. ${blueprint.nodes.map((n) => n.name).join(", ")}.`}
        className="block h-full"
        style={{ width: graph.width + 40, minWidth: "100%" }}
        preserveAspectRatio="xMinYMid meet"
      >
        {/* ── Edges ────────────────────────────────────────────────────── */}
        {graph.edges.map((edge) => {
          const a = graph.nodes[edge.from];
          const b = graph.nodes[edge.to];
          if (!a || !b) return null;
          if (!edgesVisible || !visible(a.node.id) || !visible(b.node.id)) return null;

          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          const declared = blueprint.edges.find(
            (e) => e.from === a.node.id && e.to === b.node.id,
          );

          return (
            <g key={`${edge.from}-${edge.to}`} data-motion="decorative">
              <path
                d={`M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--border-default)"
                strokeWidth={1.4}
                // The draw-in: a dash the length of the path, offset to hide it,
                // animated back to zero. Opacity-and-transform safe.
                className="motion-safe:animate-[ink-reveal_420ms_var(--ease-standard)_both]"
                strokeDasharray="400"
              />
              {declared?.label ? (
                <text
                  x={mid} y={(y1 + y2) / 2 - 5}
                  textAnchor="middle"
                  className="font-ui"
                  fontSize={9}
                  fill="var(--fg-muted)"
                >
                  {declared.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* ── Nodes ────────────────────────────────────────────────────── */}
        {graph.nodes.map((laid) => {
          const n = laid.node as BlueprintNode;
          if (!visible(n.id)) return null;
          const isGate = n.kind === "approval";
          const selected = selectedId === n.id;

          return (
            <g
              key={n.id}
              transform={`translate(${laid.x} ${laid.y})`}
              data-motion="decorative"
              className={cn(
                // §7.2 checkpoint bloom on arrival. Once, on landing.
                "motion-safe:animate-[ink-cell-commit_360ms_var(--ease-standard)_both]",
              )}
            >
              <path
                d={cellPath(NODE_W, NODE_H)}
                fill={isGate ? "var(--status-waiting-subtle)" : "var(--bg-raised)"}
                stroke={selected ? "var(--border-focus)" : isGate ? "var(--status-waiting-border)" : "var(--border-default)"}
                strokeWidth={selected ? 2.4 : isGate ? 1.8 : 1.2}
              />
              {/* The bloom ring, on gates only — they are the steps a person
                  needs to notice, and they land last precisely so it registers. */}
              {isGate ? (
                <path
                  d={cellPath(NODE_W + 10, NODE_H + 10)}
                  transform="translate(-5 -5)"
                  fill="none"
                  stroke="var(--status-waiting)"
                  strokeWidth={2}
                  opacity={0.22}
                  data-motion="decorative"
                  className="motion-safe:animate-[ink-gate-breathe_2.6s_ease-in-out_infinite]"
                />
              ) : null}

              <text x={11} y={17} className="font-code" fontSize={7.5}
                fill={isGate ? "var(--status-waiting)" : "var(--fg-muted)"}>
                {n.kind}
              </text>
              <text x={11} y={31} className="font-ui" fontSize={10} fill="var(--fg-primary)">
                {n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name}
              </text>

              <foreignObject x={0} y={0} width={NODE_W} height={NODE_H}>
                <button
                  type="button"
                  onClick={() => onSelect(n.id)}
                  aria-label={`${n.name} — ${n.kind}. ${n.rationale}`}
                  className="size-full rounded-sm outline-none focus-visible:focus-ring"
                />
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Rationale list ───────────────────────────────────────────────────────── */

/**
 * Why each step is there, landing in step with the canvas.
 *
 * This is the half of the blueprint that earns trust. A generated graph is a
 * claim; a generated graph where every node says which phrase of your
 * description produced it is something you can check.
 */
export function RationaleList({
  blueprint, landed, selectedId, onSelect,
}: {
  blueprint: Blueprint;
  landed: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const revealOrder = React.useMemo(() => {
    const nonGates = blueprint.nodes.filter((n) => n.kind !== "approval");
    const gates = blueprint.nodes.filter((n) => n.kind === "approval");
    return [...nonGates, ...gates];
  }, [blueprint.nodes]);

  return (
    <ol className="grid gap-1.5">
      {revealOrder.slice(0, landed).map((n) => {
        const entry = NODE_MARKS.find((m) => m.type === n.kind);
        const Icon = entry?.Icon;
        const selected = selectedId === n.id;

        return (
          <li key={n.id} data-motion="decorative" className="motion-safe:animate-[ink-fade-in_260ms_var(--ease-standard)_both]">
            <button
              type="button"
              onClick={() => onSelect(n.id)}
              aria-pressed={selected}
              className={cn(
                "flex w-full gap-2 rounded-md border p-2 text-left",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
                selected ? "border-accent-border bg-surface-selected" : "border-subtle hover:bg-surface-hover",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-xs border",
                  n.kind === "approval"
                    ? "border-status-waiting-border bg-status-waiting-subtle text-status-waiting"
                    : "border-subtle bg-surface-hover text-fg-secondary",
                )}
              >
                {Icon ? <Icon size={11} aria-hidden="true" /> : null}
              </span>
              <span className="min-w-0">
                <Text variant="body-sm" tone="primary" className="block">{n.name}</Text>
                <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
                  {n.rationale}
                </Text>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
