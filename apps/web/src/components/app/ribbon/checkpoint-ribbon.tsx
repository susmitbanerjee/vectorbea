"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "~/lib/cn";
import { formatDuration, formatCost, formatTokens, EMPTY } from "~/lib/format";
import type { CellState, RunNode } from "~/mocks/domain";
import {
  SIZES, cellPath, crackPath, notchPath, collapseNodes, ribbonSummary, stateLabel,
  type RibbonSize, type Segment,
} from "./geometry";
import { cellRingPath } from "./geometry-ring";
import { claimAnimation, useAnimationClaimant, BLOOM_DURATION_MS } from "./animation-coordinator";

/* ══════════════════════════════════════════════════════════════════════════════
   ⭐ THE CHECKPOINT RIBBON — design §5.

   "This is the one thing Vectorbea is remembered for."

   A run is a sequence of durable commits. The Ribbon renders that sequence as a
   row of cells where the FILL encodes commit state, which answers the question
   no competitor's UI answers: how much committed work survives a failure.

   Looking at a failed run in the old UI told you nothing. The Ribbon tells you
   8 of 12 nodes committed before it died — so a retry costs 4 nodes, not 12.
   That is the product thesis, rendered.

   One component, four scales: 3px inline in a table row, 8px on a card, 20px in
   a run header, full-width and interactive in run detail.
══════════════════════════════════════════════════════════════════════════════ */

/** Fill and stroke per state. Every value is a semantic token. */
const STATE_STYLE: Record<CellState, { fill?: string; stroke?: string; dashed?: boolean }> = {
  committed: { fill: "var(--status-success)" },
  executing: { fill: "var(--status-live)" },
  gated: { fill: "var(--status-waiting)" },
  failed: { fill: "var(--status-failed)" },
  recovered: { fill: "var(--status-success)" },
  pending: { stroke: "var(--border-subtle)" },
  skipped: { stroke: "var(--border-subtle)", dashed: true },
};

export interface CheckpointRibbonProps {
  nodes: RunNode[];
  size?: RibbonSize;
  /** Identity for the single-animation rule. Use the run id. */
  runId: string;
  /** Fold beyond this many cells. §5 specifies ~40. */
  maxCells?: number;
  /** Enables scrubbing and per-cell keyboard focus. */
  interactive?: boolean;
  /** Node index under the pointer while scrubbing, or null on release. */
  onScrub?: (index: number | null) => void;
  onCellClick?: (node: RunNode, index: number) => void;
  /** lg only: node names beneath the cells. */
  showLabels?: boolean;
  className?: string;
}

export function CheckpointRibbon({
  nodes, size = "sm", runId, maxCells = 40, interactive = false,
  onScrub, onCellClick, showLabels = false, className,
}: CheckpointRibbonProps) {
  const spec = SIZES[size];
  const segments = React.useMemo(() => collapseNodes(nodes, maxCells), [nodes, maxCells]);
  const collapsed = segments.length < nodes.length;

  /* ── lg divides the measured container width between its cells ─────────── */
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = React.useState(0);

  React.useLayoutEffect(() => {
    if (spec.cell !== null) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setMeasured(entry.contentRect.width));
    observer.observe(el);
    setMeasured(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [spec.cell]);

  /**
   * lg divides the container between its cells — but CAPPED.
   *
   * Without a cap, a 3-node run at 1400px produces 460px-wide cells and the
   * Ribbon stops reading as a row of cells at all: the clipped corners become
   * invisible at that aspect ratio and it turns into a segmented progress bar,
   * which is precisely the generic thing §5 exists to avoid. Cells stay at most
   * a little wider than tall, and a short run simply occupies less width.
   */
  const fluidWidth = Math.max(
    2,
    (measured - spec.gap * Math.max(0, segments.length - 1)) / Math.max(1, segments.length),
  );
  const cellWidth = spec.cell ?? Math.min(fluidWidth, spec.height * 1.6);
  const pitch = cellWidth + spec.gap;
  const totalWidth = segments.length * pitch - spec.gap;

  /* ── Bloom: which cells just became committed ──────────────────────────── */
  const previous = React.useRef<CellState[]>(segments.map((s) => s.state));
  const [blooming, setBlooming] = React.useState<Set<number>>(new Set());
  const claimant = useAnimationClaimant();
  const reduceMotion = usePrefersReducedMotion();

  React.useEffect(() => {
    const before = previous.current;
    const now = segments.map((s) => s.state);
    previous.current = now;

    if (reduceMotion) return;

    const newlyCommitted = now.reduce<number[]>((acc, state, i) => {
      const wasNot = before[i] !== "committed" && before[i] !== "recovered";
      const isNow = state === "committed" || state === "recovered";
      if (wasNot && isNow && before[i] !== undefined) acc.push(i);
      return acc;
    }, []);

    if (newlyCommitted.length === 0) return;
    // Only the claimant animates — see animation-coordinator.
    if (!claimAnimation(runId)) return;

    setBlooming(new Set(newlyCommitted));
    const timer = setTimeout(() => setBlooming(new Set()), BLOOM_DURATION_MS);
    return () => clearTimeout(timer);
  }, [segments, runId, reduceMotion]);

  const mayAnimate = claimant === runId;

  /* ── Hover, tooltip, scrub ─────────────────────────────────────────────── */
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null);
  const scrubbing = React.useRef(false);

  const setHover = (segmentIndex: number | null, rect?: DOMRect) => {
    setHovered(segmentIndex);
    setAnchor(rect ?? null);
    if (scrubbing.current) {
      onScrub?.(segmentIndex === null ? null : segments[segmentIndex].representativeIndex);
    }
  };

  React.useEffect(() => {
    if (!interactive) return;
    const release = () => {
      if (!scrubbing.current) return;
      scrubbing.current = false;
      onScrub?.(null);
    };
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  }, [interactive, onScrub]);

  const hoveredNode = hovered === null ? null : nodes[segments[hovered].representativeIndex];
  const summary = React.useMemo(() => ribbonSummary(nodes), [nodes]);

  /* ── Keyboard traversal, interactive only ──────────────────────────────── */
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = Math.max(0, Math.min(segments.length - 1, index + (e.key === "ArrowRight" ? 1 : -1)));
      const el = containerRef.current?.querySelector<SVGGElement>(`[data-cell="${next}"]`);
      el?.focus();
      setHovered(next);
      setAnchor(el?.getBoundingClientRect() ?? null);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const node = nodes[segments[index].representativeIndex];
      onCellClick?.(node, segments[index].representativeIndex);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", spec.cell === null && "w-full", className)}>
      <svg
        width={spec.cell === null ? "100%" : totalWidth}
        height={spec.height}
        viewBox={`0 0 ${Math.max(1, totalWidth)} ${spec.height}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={summary}
        className={cn("block overflow-visible", interactive && "cursor-crosshair touch-none")}
        onPointerDown={interactive ? () => { scrubbing.current = true; } : undefined}
        onPointerLeave={() => setHover(null)}
      >
        {segments.map((segment, i) => (
          <Cell
            key={i}
            index={i}
            segment={segment}
            node={nodes[segment.representativeIndex]}
            x={i * pitch}
            width={cellWidth}
            height={spec.height}
            detail={spec.detail && cellWidth >= 6}
            blooming={mayAnimate && blooming.has(i)}
            reduceMotion={reduceMotion}
            interactive={interactive}
            onHover={setHover}
            onSelect={() => onCellClick?.(nodes[segment.representativeIndex], segment.representativeIndex)}
            onKeyDown={onKeyDown}
          />
        ))}
      </svg>

      {/* Labels only when there is genuinely room. Rotated or clipped labels
          under a dense ribbon are noise: below ~44px per cell the node index is
          the only thing that fits, and the tooltip carries the name. */}
      {showLabels && cellWidth >= 44 ? (
        <div className="mt-1.5 flex" style={{ gap: spec.gap }}>
          {segments.map((segment, i) => (
            <span
              key={i}
              style={{ width: cellWidth }}
              className="font-code text-[10px] text-fg-muted block truncate text-center"
              title={nodes[segment.representativeIndex].name}
            >
              {nodes[segment.representativeIndex].name}
            </span>
          ))}
        </div>
      ) : showLabels ? (
        <div className="mt-1.5 flex" style={{ gap: spec.gap }}>
          {segments.map((segment, i) => (
            <span
              key={i}
              style={{ width: cellWidth }}
              className="font-code tabular text-[10px] text-fg-muted block text-center"
            >
              {segment.representativeIndex + 1}
            </span>
          ))}
        </div>
      ) : null}

      {collapsed ? (
        <span className="sr-only">
          Showing {segments.length} proportional segments for {nodes.length} nodes.
        </span>
      ) : null}

      {hoveredNode && anchor ? <CellTooltip node={hoveredNode} anchor={anchor} segment={segments[hovered!]} /> : null}
    </div>
  );
}

/* ── One cell ─────────────────────────────────────────────────────────────── */

function Cell({
  index, segment, node, x, width, height, detail, blooming, reduceMotion,
  interactive, onHover, onSelect, onKeyDown,
}: {
  index: number;
  segment: Segment;
  node: RunNode;
  x: number;
  width: number;
  height: number;
  detail: boolean;
  blooming: boolean;
  reduceMotion: boolean;
  interactive: boolean;
  onHover: (index: number | null, rect?: DOMRect) => void;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent, index: number) => void;
}) {
  const style = STATE_STYLE[segment.state];
  const d = cellPath(width, height);
  const strokeWidth = Math.max(0.75, Math.min(1.25, width * 0.14));

  return (
    <g
      transform={`translate(${x} 0)`}
      data-cell={index}
      data-state={segment.state}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
      aria-label={
        interactive
          ? `Node ${segment.representativeIndex + 1}, ${node.name}, ${stateLabel(segment.state)}`
          : undefined
      }
      className={cn(interactive && "outline-none focus-visible:[&>path]:stroke-accent")}
      onPointerEnter={(e) => onHover(index, (e.currentTarget as SVGGElement).getBoundingClientRect())}
      onPointerMove={(e) => onHover(index, (e.currentTarget as SVGGElement).getBoundingClientRect())}
      onClick={onSelect}
      onKeyDown={(e) => onKeyDown(e, index)}
    >
      {/* Gated halo — ember at 8→14%, barely perceptible (§7.2 #5).
          Expanded by a FIXED 2px on each side, not by a ratio: a proportional
          halo is invisible on a 20px cell and spills over the neighbour on a
          70px one, which reads as the wrong cell being gated. */}
      {segment.state === "gated" && detail ? (
        <path
          d={cellRingPath(width, height, 2)}
          fill="var(--status-waiting)"
          className={reduceMotion ? "opacity-10" : "animate-[ink-gate-breathe_2600ms_ease-in-out_infinite]"}
        />
      ) : null}

      <path
        d={d}
        fill={style.fill ?? "none"}
        stroke={style.stroke}
        strokeWidth={style.stroke ? strokeWidth : undefined}
        strokeDasharray={style.dashed ? `${Math.max(1.5, width * 0.3)} ${Math.max(1.2, width * 0.24)}` : undefined}
        className={cn(
          // Every state change crossfades; reduced motion collapses this to 90ms
          // via the token layer, which is exactly the required behaviour.
          "transition-[fill,stroke,opacity] duration-base ease-standard",
          segment.state === "executing" && !reduceMotion &&
            "animate-[ink-cell-breathe_1400ms_ease-in-out_infinite]",
          blooming && !reduceMotion && "animate-[ink-bloom_480ms_var(--ease-entrance)_both]",
        )}
        style={{ transformOrigin: "center" }}
      />

      {/* The fracture. Painted in the surface colour so it reads as a break in
          the material rather than as an added glyph. */}
      {segment.state === "failed" && detail ? (
        <path
          d={crackPath(width, height)}
          fill="none"
          stroke="var(--bg-raised)"
          strokeWidth={Math.max(0.8, width * 0.16)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}

      {/* Recovered: committed, but not first time. */}
      {segment.state === "recovered" && detail ? (
        <path d={notchPath(width, height)} fill="var(--status-waiting)" />
      ) : null}

      {/* Checkpoint bloom ring — one hex ring expanding outward and dissolving
          over 480ms (§7.2 #1). Fires once per commit, never loops. */}
      {blooming && !reduceMotion ? (
        <path
          d={d}
          fill="none"
          stroke="var(--status-success)"
          strokeWidth={strokeWidth}
          className="animate-[ink-bloom-ring_480ms_var(--ease-exit)_both] pointer-events-none"
          style={{ transformOrigin: "center" }}
        />
      ) : null}

      {/* A segment that folded several nodes carries a count for screen readers. */}
      {segment.count > 1 ? (
        <title>{`${segment.count} nodes, worst state ${stateLabel(segment.state)}`}</title>
      ) : null}
    </g>
  );
}

/* ── Tooltip ───────────────────────────────────────────────────────────────
   One shared, portalled tooltip driven by the hovered index, rather than a
   Radix Tooltip per cell. A 200-node ribbon would otherwise mount 200 popper
   instances, which is exactly the cost the collapse behaviour exists to avoid. */

function CellTooltip({ node, anchor, segment }: { node: RunNode; anchor: DOMRect; segment: Segment }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const rows: [string, string][] = [
    ["Status", stateLabel(segment.state)],
    ["Duration", node.durationMs === null ? EMPTY : formatDuration(node.durationMs)],
    ["Tokens", formatTokens(node.tokens)],
    ["Cost", formatCost(node.costUsd)],
    ["At", node.at ? new Date(node.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : EMPTY],
  ];

  return createPortal(
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none fixed z-tooltip",
        "bg-surface-overlay border-subtle shadow-2 rounded-sm border px-2.5 py-2",
        "min-w-52",
      )}
      style={{
        left: Math.min(window.innerWidth - 232, Math.max(8, anchor.left + anchor.width / 2 - 104)),
        top: anchor.top - 8,
        transform: "translateY(-100%)",
      }}
    >
      <p className="font-ui text-body-sm text-fg-primary mb-0.5 truncate">{node.name}</p>
      <p className="font-code text-mono-sm text-fg-muted mb-1.5">
        node {segment.representativeIndex + 1}
        {segment.count > 1 ? ` · ${segment.count} folded` : ""}
        {node.attempt ? ` · attempt ${node.attempt}` : ""}
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="font-ui text-caption text-fg-muted">{label}</dt>
            <dd className="font-code text-mono-sm tabular text-fg-secondary text-right">{value}</dd>
          </React.Fragment>
        ))}
      </dl>

      {node.error ? (
        <p className="text-status-failed font-ui text-caption border-subtle mt-1.5 border-t pt-1.5">
          {node.error.message}
          {node.error.connection ? ` Connection: ${node.error.connection}.` : ""}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}

/* ── Reduced motion ───────────────────────────────────────────────────────── */

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(query.matches);
    const onChange = () => setReduce(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduce;
}
