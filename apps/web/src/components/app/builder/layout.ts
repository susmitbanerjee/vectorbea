import dagre from "@dagrejs/dagre";
import type { BuilderEdge, BuilderGraph, BuilderNode } from "~/mocks/builder";
import { NODE_SIZE, nodeSize } from "./store";

/* ══════════════════════════════════════════════════════════════════════════════
   AUTO-LAYOUT AND ALIGNMENT

   Dagre, left-to-right, because a workflow is read as a sequence and a
   top-to-bottom layout makes a twelve-node graph a scroll rather than a glance.

   THE LATTICE IS THE GRID. Every position dagre returns is snapped to the 4px
   lattice from §8 before it lands, so an auto-layout and a hand-drag produce
   coordinates from the same set. Without that, auto-layout leaves nodes half a
   pixel off the grid and the alignment guides never fire again.
══════════════════════════════════════════════════════════════════════════════ */

/** §8: 4px base. Node positions snap to a 4× multiple so drags and layouts agree. */
export const LATTICE = 16;

export const snap = (value: number) => Math.round(value / LATTICE) * LATTICE;

export function autoLayout(nodes: BuilderNode[], edges: BuilderEdge[]): BuilderGraph {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  /* ── SEPARATIONS ARE CHOSEN SO THE PITCH LANDS ON THE LATTICE ─────────────
     Every position dagre returns is snapped to LATTICE below. That snap is only
     harmless when the distance BETWEEN consecutive nodes is already a multiple
     of it — otherwise successive nodes round in opposite directions and the row
     develops a sawtooth.

     It did. With ranksep 96 the horizontal pitch was 200 + 96 = 296, and 296 is
     not a multiple of 16, so a ten-node workflow laid out at gaps of
     288, 304, 288, 304 … — alternating by a whole 16px, plainly visible as
     uneven spacing on a canvas whose entire promise is that things line up.
     Vertically it was worse: 76 + 48 = 124 leaves a remainder of 12, so
     parallel branches drifted a different amount at every rank.

     So the pitch, not the gap, is what is picked:
       horizontal  NODE_W 200 + 104 = 304 = 19 x 16
       vertical    NODE_H  76 +  52 = 128 =  8 x 16
     Both stay at least as generous as the values they replace, which is what
     the edge labels on conditional arms needed the room for.

     Changing NODE_W, NODE_H or LATTICE means re-deriving these. The test in
     __tests__/builder-layout.test.ts fails if they stop dividing. */
  g.setGraph({
    rankdir: "LR",
    nodesep: LATTICE * 8 - NODE_SIZE.height,
    ranksep: LATTICE * 19 - NODE_SIZE.width,
    // Multiples of the lattice for the same reason.
    marginx: LATTICE * 2,
    marginy: LATTICE * 2,
  });

  for (const n of nodes) {
    // Per node, not the constant: a team node is taller, and telling dagre
    // otherwise packs the rank below it into the space the team occupies.
    const size = nodeSize(n.node);
    g.setNode(n.node.id, { width: size.width, height: size.height });
  }
  for (const e of edges) {
    // Dagre cannot rank a cycle. Skipping the back-edge lays the rest out
    // correctly rather than throwing, and a cycle is a validation error the
    // inspector already reports.
    if (e.source === e.target) continue;
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }

  try {
    dagre.layout(g);
  } catch {
    // A graph dagre refuses is a graph we leave where it is. Throwing away the
    // user's positions because a layout failed is the worse outcome.
    return { nodes, edges };
  }

  return {
    nodes: nodes.map((n) => {
      const laid = g.node(n.node.id);
      if (!laid) return n;
      const size = nodeSize(n.node);
      return {
        ...n,
        // Dagre centres nodes; the canvas positions by top-left corner.
        x: snap(laid.x - size.width / 2),
        y: snap(laid.y - size.height / 2),
      };
    }),
    edges,
  };
}

/* ── Align and distribute ─────────────────────────────────────────────────── */

export type AlignAxis = "left" | "centre-x" | "right" | "top" | "centre-y" | "bottom";

/**
 * Align the selection on one axis.
 *
 * Aligns to the EXTREME of the selection, not to its average — "align left"
 * means "line them up on the leftmost one", which is what every design tool
 * does and what the person means. Averaging moves every node including the one
 * they were aligning to.
 */
export function align(nodes: BuilderNode[], ids: string[], axis: AlignAxis): BuilderNode[] {
  const picked = nodes.filter((n) => ids.includes(n.node.id));
  if (picked.length < 2) return nodes;

  const lefts = picked.map((n) => n.x);
  const tops = picked.map((n) => n.y);
  const rights = picked.map((n) => n.x + nodeSize(n.node).width);
  const bottoms = picked.map((n) => n.y + nodeSize(n.node).height);

  const target = {
    left: Math.min(...lefts),
    right: Math.max(...rights),
    top: Math.min(...tops),
    bottom: Math.max(...bottoms),
    centreX: (Math.min(...lefts) + Math.max(...rights)) / 2,
    centreY: (Math.min(...tops) + Math.max(...bottoms)) / 2,
  };

  return nodes.map((n) => {
    if (!ids.includes(n.node.id)) return n;
    // Each node's OWN size, so aligning a team's right edge to a row of
    // ordinary nodes puts its right edge on the line rather than a point
    // 96px past it.
    const size = nodeSize(n.node);
    switch (axis) {
      case "left": return { ...n, x: snap(target.left) };
      case "right": return { ...n, x: snap(target.right - size.width) };
      case "centre-x": return { ...n, x: snap(target.centreX - size.width / 2) };
      case "top": return { ...n, y: snap(target.top) };
      case "bottom": return { ...n, y: snap(target.bottom - size.height) };
      case "centre-y": return { ...n, y: snap(target.centreY - size.height / 2) };
    }
  });
}

/** Even gaps between the outermost two, along the axis with the greater spread. */
export function distribute(nodes: BuilderNode[], ids: string[], axis: "x" | "y"): BuilderNode[] {
  const picked = nodes.filter((n) => ids.includes(n.node.id));
  if (picked.length < 3) return nodes;

  const sorted = [...picked].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = axis === "x" ? last.x - first.x : last.y - first.y;
  const step = span / (sorted.length - 1);

  const positions = new Map<string, number>();
  sorted.forEach((n, i) => {
    positions.set(n.node.id, (axis === "x" ? first.x : first.y) + step * i);
  });

  return nodes.map((n) => {
    const at = positions.get(n.node.id);
    if (at === undefined) return n;
    return axis === "x" ? { ...n, x: snap(at) } : { ...n, y: snap(at) };
  });
}

/* ── Alignment guides ─────────────────────────────────────────────────────── */

export interface Guide {
  axis: "x" | "y";
  /** Canvas coordinate the guide sits on. */
  at: number;
  /** Extent of the guide, so it spans only the nodes it relates. */
  from: number;
  to: number;
}

/** How close two edges must be, in canvas units, before a guide appears. */
const GUIDE_TOLERANCE = 6;

/**
 * Guides for a node being dragged, against every other node.
 *
 * Compares left/centre/right and top/middle/bottom — six alignments per pair,
 * because a node aligned on its centre with another's left edge is not aligned,
 * and a guide that claims otherwise teaches people to distrust the guides.
 */
export function guidesFor(
  moving: BuilderNode,
  others: BuilderNode[],
): Guide[] {
  const guides: Guide[] = [];

  const ms = nodeSize(moving.node);
  const mx = [moving.x, moving.x + ms.width / 2, moving.x + ms.width];
  const my = [moving.y, moving.y + ms.height / 2, moving.y + ms.height];

  for (const other of others) {
    if (other.node.id === moving.node.id) continue;
    const os = nodeSize(other.node);
    const ox = [other.x, other.x + os.width / 2, other.x + os.width];
    const oy = [other.y, other.y + os.height / 2, other.y + os.height];

    for (const a of mx) {
      for (const b of ox) {
        if (Math.abs(a - b) <= GUIDE_TOLERANCE) {
          guides.push({
            axis: "x",
            at: b,
            from: Math.min(moving.y, other.y) - 16,
            to: Math.max(moving.y + ms.height, other.y + os.height) + 16,
          });
        }
      }
    }

    for (const a of my) {
      for (const b of oy) {
        if (Math.abs(a - b) <= GUIDE_TOLERANCE) {
          guides.push({
            axis: "y",
            at: b,
            from: Math.min(moving.x, other.x) - 16,
            to: Math.max(moving.x + ms.width, other.x + os.width) + 16,
          });
        }
      }
    }
  }

  // One guide per coordinate: three nodes sharing a left edge would otherwise
  // stack three identical lines and read as a thicker, brighter one.
  const unique = new Map<string, Guide>();
  for (const guide of guides) {
    const key = `${guide.axis}:${guide.at}`;
    const existing = unique.get(key);
    if (existing) {
      existing.from = Math.min(existing.from, guide.from);
      existing.to = Math.max(existing.to, guide.to);
    } else {
      unique.set(key, { ...guide });
    }
  }

  return [...unique.values()];
}
