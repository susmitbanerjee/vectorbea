import type { GraphEdge, GraphNode } from "~/lib/api/trace";
import { DOMINANCE_FACTOR, scaleWidth } from "./primitives";

/**
 * Where each node sits, and how wide it is.
 *
 * ── STRUCTURE AND TIME IN ONE PICTURE ───────────────────────────────────────
 * The Overview used to be a wrapped grid of equal cards. That answers neither
 * question people bring here: it does not show what connects to what, and it
 * does not show where the time went. Two encodings fix both without adding a
 * second view — POSITION carries structure (left to right, edges drawn) and
 * WIDTH carries duration.
 *
 * Pure, and separate from the component, because layout is where this kind of
 * view goes wrong in ways that are invisible in a screenshot of the one run you
 * happened to open: a back-edge that renders as a forward one, a node that
 * overlaps its neighbour only when a label is long, a 1ms node clamped to
 * nothing and unclickable.
 */

/** Wide enough for a label, a status and a duration. Below this, unclickable. */
export const MIN_NODE_W = 112;
/**
 * Above this one slow node crushes the rest.
 *
 * A 10-minute model call in a run of millisecond transforms would otherwise take
 * the entire viewport and push everything else off-screen — the encoding
 * defeating itself.
 */
export const MAX_NODE_W = 320;
export const NODE_H = 76;
/** Room for an inline expansion of an agent's activations. */
export const EXPANDED_EXTRA_H = 24;
export const COL_GAP = 40;
export const ROW_GAP = 20;
export const PAD = 16;

export interface PlacedNode {
  node: GraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * This node dominates the run by more than its width can show.
   *
   * The square root that keeps fast nodes separable also compresses the top of
   * the range, so a node that took 40× longer than the next is drawn about 3×
   * wider. When that gap is large the geometry understates it, and the reader
   * has to be told to read the number instead.
   */
  clamped: boolean;
  column: number;
}

export interface PlacedEdge {
  edge: GraphEdge;
  /** Right edge of the source. */
  x1: number;
  y1: number;
  /** Left edge of the target. */
  x2: number;
  y2: number;
  /** Neither endpoint ran: dashed and dimmed, never hidden. */
  dimmed: boolean;
}

export interface FlowLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  /** The slowest node, which the width scale is relative to. */
  slowestMs: number;
}

/**
 * Assign each node a column: the LONGEST path from any source to it.
 *
 * Longest rather than shortest so an edge always points forward. With shortest
 * paths, a node reachable in one hop and also at the end of a five-hop chain
 * lands in column 1, and that five-hop edge then renders right-to-left — which
 * reads as a loop the workflow does not have.
 *
 * Cycle-safe by construction: a node is only ever pushed to a HIGHER column, and
 * the recursion refuses to re-enter a node already on the current path, so a
 * genuine cycle settles instead of running forever.
 */
export function assignColumns(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const list = incoming.get(e.target);
    if (list) list.push(e.source);
    else incoming.set(e.target, [e.source]);
  }

  const col = new Map<string, number>();
  const onPath = new Set<string>();

  const depth = (id: string): number => {
    const cached = col.get(id);
    if (cached !== undefined) return cached;
    if (onPath.has(id)) return 0;            // a cycle: stop, do not recurse
    onPath.add(id);
    const parents = incoming.get(id) ?? [];
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => depth(p) + 1));
    onPath.delete(id);
    col.set(id, d);
    return d;
  };

  nodes.forEach((n) => depth(n.id));
  return col;
}

/**
 * Place every node, and route every edge between the boxes it connects.
 *
 * Node ORDER within a column is the order the graph listed them, which is the
 * order the builder drew them in. Sorting by status or duration would put the
 * failing node first — helpful once, and wrong every time somebody is trying to
 * match this against the canvas they built.
 */
export function layoutFlow(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedIds: ReadonlySet<string> = new Set(),
): FlowLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0, slowestMs: 0 };
  }

  const col = assignColumns(nodes, edges);
  const byColumn = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const c = col.get(n.id) ?? 0;
    const list = byColumn.get(c);
    if (list) list.push(n);
    else byColumn.set(c, [n]);
  }

  /*
   * The scale is relative to THIS run, not to an absolute axis no run matches.
   * Unreached nodes are excluded from the maximum: they have no duration, and
   * including a null as a zero would not change it — but a node that was
   * skipped after a partial execution could otherwise set a misleading ceiling.
   */
  const slowestMs = Math.max(0, ...nodes.filter((n) => n.reached).map((n) => n.totalMs ?? 0));

  const columns = [...byColumn.keys()].sort((a, b) => a - b);

  /* Column widths first: every node in a column shares its left edge, so the
     column is as wide as its widest member and the next column starts after it.
     Without this a wide node overlaps the column to its right. */
  /*
   * Which nodes the width understates. Needs every node, which is why it is here
   * and not in `scaleWidth`: a node is only dominant relative to the rest.
   */
  const runtimes = nodes
    .filter((n) => n.reached && (n.totalMs ?? 0) > 0)
    .map((n) => n.totalMs!)
    .sort((a, b) => b - a);
  const runnerUp = runtimes[1] ?? 0;
  const dominates = (ms: number | null) =>
    ms != null && ms >= slowestMs && runnerUp > 0 && ms >= runnerUp * DOMINANCE_FACTOR;

  const colWidth = new Map<number, number>();
  const sized = new Map<string, { w: number; clamped: boolean }>();
  for (const c of columns) {
    let widest = MIN_NODE_W;
    for (const n of byColumn.get(c)!) {
      /* A node that never ran has no duration to encode. It gets the floor —
         present, clickable, and visibly not making a claim about time. */
      const w = n.reached
        ? scaleWidth(n.totalMs, slowestMs, MIN_NODE_W, MAX_NODE_W)
        : MIN_NODE_W;
      sized.set(n.id, { w, clamped: n.reached && dominates(n.totalMs) });
      widest = Math.max(widest, w);
    }
    colWidth.set(c, widest);
  }

  const colX = new Map<number, number>();
  let x = PAD;
  for (const c of columns) {
    colX.set(c, x);
    x += colWidth.get(c)! + COL_GAP;
  }
  const width = x - COL_GAP + PAD;

  const placed: PlacedNode[] = [];
  let tallest = 0;
  for (const c of columns) {
    let y = PAD;
    for (const n of byColumn.get(c)!) {
      const s = sized.get(n.id)!;
      const h = NODE_H + (expandedIds.has(n.id) ? EXPANDED_EXTRA_H * expansionRows(n) : 0);
      placed.push({ node: n, x: colX.get(c)!, y, w: s.w, h, clamped: s.clamped, column: c });
      y += h + ROW_GAP;
    }
    tallest = Math.max(tallest, y);
  }
  const height = tallest - ROW_GAP + PAD;

  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const routed: PlacedEdge[] = [];
  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;                   // an edge to a node we do not have
    routed.push({
      edge: e,
      x1: a.x + a.w,
      y1: a.y + NODE_H / 2,
      x2: b.x,
      y2: b.y + NODE_H / 2,
      dimmed: !a.node.reached || !b.node.reached,
    });
  }

  return { nodes: placed, edges: routed, width, height, slowestMs };
}

/** How many rows an expanded agent node needs. */
function expansionRows(n: GraphNode): number {
  return Math.max(1, n.summary?.members.length ?? 1);
}

/**
 * An S-curve between two boxes.
 *
 * A straight line between column centres passes THROUGH the nodes in between
 * when a column has several rows. The horizontal tangents at both ends also make
 * direction readable without an arrowhead at small sizes, which matters because
 * the arrowhead is the first thing to disappear in the minimap.
 */
export function edgePath(e: PlacedEdge): string {
  const dx = Math.max(16, (e.x2 - e.x1) / 2);
  return `M ${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - dx} ${e.y2}, ${e.x2} ${e.y2}`;
}

/**
 * Which nodes to actually render, given where the reader is scrolled.
 *
 * ── WHY A WINDOW AND NOT SHRINK-TO-FIT ──────────────────────────────────────
 * A 200-node workflow scaled to fit is 200 unreadable specks, which is not a
 * view of anything. Legible beats complete: the graph keeps its real size, the
 * container scrolls, and the minimap carries the overview.
 *
 * The overscan is a full viewport on each side, so scrolling never reveals a
 * blank strip before React catches up — and below the threshold nothing is
 * windowed at all, because the bookkeeping costs more than it saves.
 */
export const VIRTUALISE_ABOVE = 50;

export function visibleNodes(
  nodes: PlacedNode[],
  scrollLeft: number,
  viewportW: number,
): PlacedNode[] {
  if (nodes.length <= VIRTUALISE_ABOVE || viewportW <= 0) return nodes;
  const from = scrollLeft - viewportW;
  const to = scrollLeft + viewportW * 2;
  return nodes.filter((n) => n.x + n.w >= from && n.x <= to);
}
