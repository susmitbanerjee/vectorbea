import type { CellState, RunNode } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   RIBBON GEOMETRY — design §5.

   "Cells are hexagon-derived (a soft-cornered rectangle with clipped top-left
   and bottom-right corners) — the hive geometry, abstracted to the point where
   it just reads as 'precise'."

   Drawn as SVG paths rather than CSS clip-path so the shape stays exact at 3px
   and at 60px, and so the crack, notch and bloom ring can share the same
   coordinate space as the cell they belong to.
══════════════════════════════════════════════════════════════════════════════ */

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * The cell: clipped top-left and bottom-right, softly rounded top-right and
 * bottom-left. Both proportions scale with the cell so a 3px cell reads as the
 * same shape as a 40px one rather than as a blob or a rectangle.
 */
export function cellPath(w: number, h: number): string {
  const min = Math.min(w, h);
  const clip = clamp(min * 0.34, 0.7, 6);
  const r = clamp(min * 0.16, 0.3, 2.5);

  return [
    `M${clip} 0`,
    `H${(w - r).toFixed(2)}`,
    `Q${w} 0 ${w} ${r.toFixed(2)}`,
    `V${(h - clip).toFixed(2)}`,
    `L${(w - clip).toFixed(2)} ${h}`,
    `H${r.toFixed(2)}`,
    `Q0 ${h} 0 ${(h - r).toFixed(2)}`,
    `V${clip.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/**
 * The fracture drawn across a failed cell.
 *
 * A seam, not a cross or a bang: the cell is BROKEN, and the two halves have
 * separated. Rendered in the surrounding surface colour so it reads as an
 * absence of material rather than as an added mark.
 */
export function crackPath(w: number, h: number): string {
  const x = w / 2;
  return [
    `M${(x + w * 0.22).toFixed(2)} 0`,
    `L${(x - w * 0.18).toFixed(2)} ${(h * 0.42).toFixed(2)}`,
    `L${(x + w * 0.2).toFixed(2)} ${(h * 0.58).toFixed(2)}`,
    `L${(x - w * 0.16).toFixed(2)} ${h}`,
  ].join(" ");
}

/**
 * The notch marking a recovered cell — committed, but not on the first attempt.
 *
 * A wedge taken out of the top-right corner in ember, the colour of human and
 * remedial involvement. Deliberately small: a recovered node DID commit, so it
 * must read as success first and history second.
 */
export function notchPath(w: number, h: number): string {
  const s = Math.min(w, h) * 0.42;
  return `M${(w - s).toFixed(2)} 0 H${w} V${s.toFixed(2)} Z`;
}

/* ── Size scale ───────────────────────────────────────────────────────────── */

export type RibbonSize = "xs" | "sm" | "md" | "lg";

export interface SizeSpec {
  /** Cell width. `null` on lg — cells divide the measured container width. */
  cell: number | null;
  height: number;
  gap: number;
  /** Below this width a cell is a tick; the crack and notch are dropped. */
  detail: boolean;
}

export const SIZES: Record<RibbonSize, SizeSpec> = {
  xs: { cell: 3, height: 12, gap: 1, detail: false },
  sm: { cell: 8, height: 18, gap: 2, detail: true },
  md: { cell: 20, height: 28, gap: 3, detail: true },
  lg: { cell: null, height: 44, gap: 4, detail: true },
};

/* ── Collapse ─────────────────────────────────────────────────────────────── */

/**
 * Priority when several nodes fold into one segment.
 *
 * Failure outranks everything. §5 requires that a failure never collapses away:
 * a 200-node run whose one red cell vanished into an average would defeat the
 * entire purpose of showing the run's shape in a table cell.
 */
const PRIORITY: Record<CellState, number> = {
  failed: 6,
  gated: 5,
  executing: 4,
  recovered: 3,
  committed: 2,
  skipped: 1,
  pending: 0,
};

export interface Segment {
  state: CellState;
  /** Nodes folded into this segment. 1 when uncollapsed. */
  count: number;
  /** Index of the node this segment reports — the worst one it contains. */
  representativeIndex: number;
  firstIndex: number;
  lastIndex: number;
}

/**
 * Fold `nodes` down to at most `maxCells` proportional segments.
 *
 * Position is preserved because bucketing is positional: a failure at node 137
 * of 200 lands in the bucket covering that region, so the red cell stays about
 * two-thirds along. Only the resolution is lost, never the location.
 */
export function collapseNodes(nodes: RunNode[], maxCells: number): Segment[] {
  if (nodes.length <= maxCells) {
    return nodes.map((n, i) => ({
      state: n.state,
      count: 1,
      representativeIndex: i,
      firstIndex: i,
      lastIndex: i,
    }));
  }

  const segments: Segment[] = [];
  const per = nodes.length / maxCells;

  for (let s = 0; s < maxCells; s += 1) {
    const first = Math.floor(s * per);
    const last = Math.min(nodes.length - 1, Math.floor((s + 1) * per) - 1);

    let worst = first;
    for (let i = first; i <= last; i += 1) {
      if (PRIORITY[nodes[i].state] > PRIORITY[nodes[worst].state]) worst = i;
    }

    segments.push({
      state: nodes[worst].state,
      count: last - first + 1,
      representativeIndex: worst,
      firstIndex: first,
      lastIndex: last,
    });
  }

  return segments;
}

/* ── Accessible summary ───────────────────────────────────────────────────── */

const STATE_NOUN: Record<CellState, string> = {
  committed: "committed",
  executing: "executing",
  gated: "awaiting approval",
  failed: "failed",
  pending: "pending",
  skipped: "skipped",
  recovered: "recovered after retry",
};

/**
 * One sentence describing the run's shape, for screen readers and tooltips.
 *
 * Leads with the durability fact — how much survives — because that is the
 * question the Ribbon exists to answer.
 */
export function ribbonSummary(nodes: RunNode[]): string {
  const total = nodes.length;
  const committed = nodes.filter((n) => n.state === "committed" || n.state === "recovered").length;
  const failedIndex = nodes.findIndex((n) => n.state === "failed");
  const gatedIndex = nodes.findIndex((n) => n.state === "gated");
  const executingIndex = nodes.findIndex((n) => n.state === "executing");

  const parts = [`${committed} of ${total} nodes committed`];

  if (failedIndex >= 0) {
    parts.push(`failed at node ${failedIndex + 1}, ${nodes[failedIndex].name}`);
    const remaining = total - committed;
    parts.push(`a retry costs ${remaining} node${remaining === 1 ? "" : "s"}`);
  } else if (gatedIndex >= 0) {
    parts.push(`awaiting approval at node ${gatedIndex + 1}`);
  } else if (executingIndex >= 0) {
    parts.push(`executing node ${executingIndex + 1}`);
  } else if (committed === total) {
    parts.push("complete");
  }

  return `${parts.join(", ")}.`;
}

export function stateLabel(state: CellState): string {
  return STATE_NOUN[state];
}
