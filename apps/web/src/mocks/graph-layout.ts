import type { NodeKind } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   GRAPH LAYOUT — shared by the run-detail canvas mirror and the version diff.

   Extracted from run-detail's buildGraph because the version diff has to lay out
   graphs that are NOT runs: a draft version has nodes and edges but no execution
   state at all. Two layout functions would be two answers to "where does node 4
   sit", and the diff's whole job is to overlay one graph on another — a node
   that moves 12px between versions because a second implementation rounded
   differently would read as a change the author did not make.

   Deterministic and derived from node kinds: `parallel` opens a fan, `merge`
   closes it. A real layout engine (dagre, elk) is P15's problem.
══════════════════════════════════════════════════════════════════════════════ */

export const GRAPH_COL_W = 168;
export const GRAPH_ROW_H = 88;

export interface LaidOutNode<T> {
  node: T;
  index: number;
  x: number;
  y: number;
}

export interface GraphEdge {
  from: number;
  to: number;
}

export interface LaidOutGraph<T> {
  nodes: LaidOutNode<T>[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export function layoutGraph<T extends { kind: NodeKind }>(items: T[]): LaidOutGraph<T> {
  const nodes: LaidOutNode<T>[] = [];
  const edges: GraphEdge[] = [];

  let column = 0;
  let branchRow = 0;
  let fanOpen = false;

  items.forEach((node, index) => {
    if (node.kind === "parallel") {
      nodes.push({ node, index, x: column * GRAPH_COL_W, y: 0 });
      column += 1;
      fanOpen = true;
      branchRow = 0;
    } else if (node.kind === "merge") {
      fanOpen = false;
      nodes.push({ node, index, x: column * GRAPH_COL_W, y: 0 });
      column += 1;
      branchRow = 0;
    } else if (fanOpen) {
      // Two lanes is enough to read as a fan without making the graph tall.
      const row = branchRow % 2 === 0 ? -1 : 1;
      nodes.push({ node, index, x: column * GRAPH_COL_W, y: row * (GRAPH_ROW_H / 2) });
      branchRow += 1;
      if (branchRow % 2 === 0) column += 1;
    } else {
      nodes.push({ node, index, x: column * GRAPH_COL_W, y: 0 });
      column += 1;
    }

    if (index > 0) edges.push({ from: index - 1, to: index });
  });

  // Math.max of an empty spread is -Infinity, which propagates into a viewBox
  // and blanks the whole canvas. An empty graph is a legitimate draft state.
  if (nodes.length === 0) return { nodes, edges, width: GRAPH_COL_W, height: GRAPH_ROW_H };

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return {
    nodes,
    edges,
    width: Math.max(...xs) + GRAPH_COL_W,
    height: Math.max(...ys) - Math.min(...ys) + GRAPH_ROW_H * 1.6,
  };
}
