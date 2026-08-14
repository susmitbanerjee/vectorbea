import dagre from "@dagrejs/dagre";
import type { BuilderEdge, BuilderGraph, BuilderNode } from "~/mocks/builder";
import { NODE_SIZE } from "./store";

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
  g.setGraph({
    rankdir: "LR",
    // Generous separations: nodes are 200px wide and the edge labels on
    // conditional arms need room, or they overlap the node they point at.
    nodesep: 48,
    ranksep: 96,
    marginx: 24,
    marginy: 24,
  });

  for (const n of nodes) {
    g.setNode(n.node.id, { width: NODE_SIZE.width, height: NODE_SIZE.height });
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
      return {
        ...n,
        // Dagre centres nodes; the canvas positions by top-left corner.
        x: snap(laid.x - NODE_SIZE.width / 2),
        y: snap(laid.y - NODE_SIZE.height / 2),
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
  const rights = picked.map((n) => n.x + NODE_SIZE.width);
  const bottoms = picked.map((n) => n.y + NODE_SIZE.height);

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
    switch (axis) {
      case "left": return { ...n, x: snap(target.left) };
      case "right": return { ...n, x: snap(target.right - NODE_SIZE.width) };
      case "centre-x": return { ...n, x: snap(target.centreX - NODE_SIZE.width / 2) };
      case "top": return { ...n, y: snap(target.top) };
      case "bottom": return { ...n, y: snap(target.bottom - NODE_SIZE.height) };
      case "centre-y": return { ...n, y: snap(target.centreY - NODE_SIZE.height / 2) };
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

  const mx = [moving.x, moving.x + NODE_SIZE.width / 2, moving.x + NODE_SIZE.width];
  const my = [moving.y, moving.y + NODE_SIZE.height / 2, moving.y + NODE_SIZE.height];

  for (const other of others) {
    if (other.node.id === moving.node.id) continue;
    const ox = [other.x, other.x + NODE_SIZE.width / 2, other.x + NODE_SIZE.width];
    const oy = [other.y, other.y + NODE_SIZE.height / 2, other.y + NODE_SIZE.height];

    for (const a of mx) {
      for (const b of ox) {
        if (Math.abs(a - b) <= GUIDE_TOLERANCE) {
          guides.push({
            axis: "x",
            at: b,
            from: Math.min(moving.y, other.y) - 16,
            to: Math.max(moving.y, other.y) + NODE_SIZE.height + 16,
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
            to: Math.max(moving.x, other.x) + NODE_SIZE.width + 16,
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
