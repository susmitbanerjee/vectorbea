"use client";

import * as React from "react";
import { isTypingTarget } from "~/lib/keyboard";
import { NODE_SIZE, downstreamOf, connectedTo, type BuilderAction, type BuilderState } from "./store";
import type { BuilderEdge, BuilderNode } from "~/mocks/builder";

/* ══════════════════════════════════════════════════════════════════════════════
   FULL KEYBOARD GRAPH EDITING

   Neither n8n nor Zapier is keyboard-operable. This is the differentiator, and
   it only counts if the WHOLE loop works without a pointer: traverse, select,
   inspect, add, connect, delete.

     Tab / Shift-Tab   next / previous node in graph order
     Arrow keys        move the selection ALONG EDGES, not by position
     Enter             open the inspector on the selected node
     ⌘/Ctrl-Enter      add a connected node downstream
     Delete            remove the selection, repairing the edges through it
     ⌘/Ctrl-D          duplicate
     ⌘/Ctrl-A          select all
     Escape            clear the selection

   ARROWS FOLLOW EDGES, NOT GEOMETRY. Right-arrow means "the next step", which is
   a graph question, not a spatial one. Moving by nearest-neighbour-to-the-right
   would jump across an unrelated branch whenever two lanes overlap — and on a
   fanned graph they always do. Up and down move BETWEEN sibling lanes at the
   same rank, which is the only place a spatial reading is the right one.

   TAB ORDER IS TOPOLOGICAL. Walking the graph from the trigger is how a person
   reads it; walking it in insertion order means the order changes every time
   somebody adds a node in the middle.
══════════════════════════════════════════════════════════════════════════════ */

export interface KeyboardGraphOptions {
  state: BuilderState;
  dispatch: React.Dispatch<BuilderAction>;
  /** Bring a node into view — the canvas owns the viewport. */
  reveal: (nodeId: string) => void;
  onOpenNode: (nodeId: string) => void;
  onAddDownstream: (sourceId: string) => void;
  enabled: boolean;
}

/** Topological order from the triggers, falling back to insertion order. */
export function graphOrder(nodes: BuilderNode[], edges: BuilderEdge[]): string[] {
  const ids = nodes.map((n) => n.node.id);
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    if (indegree.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  // Roots first, ordered by position so two triggers read top-to-bottom.
  const byId = new Map(nodes.map((n) => [n.node.id, n]));
  const queue = ids
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort((a, b) => (byId.get(a)!.y - byId.get(b)!.y) || (byId.get(a)!.x - byId.get(b)!.x));

  const out: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);

    const next = edges
      .filter((e) => e.source === id)
      .map((e) => e.target)
      .filter((t) => !seen.has(t))
      .sort((a, b) => (byId.get(a)?.y ?? 0) - (byId.get(b)?.y ?? 0));

    for (const t of next) {
      indegree.set(t, (indegree.get(t) ?? 1) - 1);
      // Only enqueue once every inbound edge has been walked, or a merge node
      // is visited before the branches that feed it.
      if ((indegree.get(t) ?? 0) <= 0) queue.push(t);
    }
  }

  // A cycle leaves nodes unvisited. They still need to be reachable by Tab —
  // an invalid graph is exactly when you most need to get to the broken node.
  for (const id of ids) if (!seen.has(id)) out.push(id);
  return out;
}

function step(
  current: string,
  direction: "up" | "down" | "left" | "right",
  nodes: BuilderNode[],
  edges: BuilderEdge[],
): string | null {
  const byId = new Map(nodes.map((n) => [n.node.id, n]));
  const here = byId.get(current);
  if (!here) return null;

  if (direction === "right" || direction === "left") {
    const along = direction === "right"
      ? edges.filter((e) => e.source === current).map((e) => e.target)
      : edges.filter((e) => e.target === current).map((e) => e.source);
    if (along.length === 0) return null;
    // Several arms: take the one closest to this node's own lane, so repeated
    // right-arrows walk a straight path rather than zig-zagging between lanes.
    return along.sort((a, b) =>
      Math.abs((byId.get(a)?.y ?? 0) - here.y) - Math.abs((byId.get(b)?.y ?? 0) - here.y),
    )[0];
  }

  /* Up and down move between siblings at the same rank — the lanes of a fan.
     Siblings are nodes sharing a parent, which is what "the other branch" means. */
  const parents = edges.filter((e) => e.target === current).map((e) => e.source);
  const siblings = [...new Set(
    edges.filter((e) => parents.includes(e.source)).map((e) => e.target),
  )]
    .filter((id) => id !== current)
    .map((id) => byId.get(id))
    .filter((n): n is BuilderNode => Boolean(n));

  const candidates = siblings.filter((n) => (direction === "up" ? n.y < here.y : n.y > here.y));
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => Math.abs(a.y - here.y) - Math.abs(b.y - here.y))[0].node.id;
}

export function useKeyboardGraph({
  state, dispatch, reveal, onOpenNode, onAddDownstream, enabled,
}: KeyboardGraphOptions) {
  const order = React.useMemo(
    () => graphOrder(state.nodes, state.edges),
    [state.nodes, state.edges],
  );

  React.useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a key from a field. The palette search and every inspector
      // input live on this screen.
      if (isTypingTarget(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;
      const current = state.selection[state.selection.length - 1] ?? null;

      /* ── Traversal ──────────────────────────────────────────────────────── */
      if (event.key === "Tab") {
        if (order.length === 0) return;
        event.preventDefault();
        const index = current ? order.indexOf(current) : -1;
        const next = event.shiftKey
          ? order[(index <= 0 ? order.length : index) - 1]
          : order[(index + 1) % order.length];
        dispatch({ type: "select", ids: [next] });
        reveal(next);
        return;
      }

      if (event.key.startsWith("Arrow")) {
        if (!current) {
          if (order.length === 0) return;
          event.preventDefault();
          dispatch({ type: "select", ids: [order[0]] });
          reveal(order[0]);
          return;
        }
        const direction = ({
          ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down",
        } as const)[event.key as "ArrowRight" | "ArrowLeft" | "ArrowUp" | "ArrowDown"];
        if (!direction) return;
        event.preventDefault();
        const next = step(current, direction, state.nodes, state.edges);
        if (!next) return;
        // Shift extends the selection along the path, so a keyboard user can
        // build a multi-selection without a marquee.
        dispatch({ type: "select", ids: event.shiftKey ? [...state.selection, next] : [next] });
        reveal(next);
        return;
      }

      /* ── Editing ────────────────────────────────────────────────────────── */
      if (event.key === "Enter") {
        if (!current) return;
        event.preventDefault();
        if (mod) onAddDownstream(current);
        else onOpenNode(current);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (state.selectedEdgeId) {
          event.preventDefault();
          dispatch({ type: "deleteEdge", id: state.selectedEdgeId });
          return;
        }
        if (state.selection.length === 0) return;
        event.preventDefault();
        dispatch({ type: "deleteSelection" });
        return;
      }

      if (mod && event.key.toLowerCase() === "d") {
        if (state.selection.length === 0) return;
        event.preventDefault();
        dispatch({ type: "duplicateSelection" });
        return;
      }

      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        dispatch({ type: "select", ids: state.nodes.map((n) => n.node.id) });
        return;
      }

      /* Select-connected and select-downstream. Both are one keystroke because
         both answer questions people ask constantly of a graph: "what is this
         part of" and "what does this affect". */
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        if (state.selection.length === 0) return;
        event.preventDefault();
        dispatch({ type: "select", ids: connectedTo(state.selection, state.edges) });
        return;
      }

      if (mod && event.shiftKey && event.key.toLowerCase() === "s") {
        if (state.selection.length === 0) return;
        event.preventDefault();
        dispatch({ type: "select", ids: downstreamOf(state.selection, state.edges) });
        return;
      }

      if (event.key === "Escape") {
        dispatch({ type: "select", ids: [] });
        return;
      }

      /* ── Nudge, for fine positioning without a pointer ───────────────────── */
      if (mod && ["[", "]"].includes(event.key)) {
        if (state.selection.length === 0) return;
        event.preventDefault();
        const delta = event.key === "]" ? NODE_SIZE.width / 4 : -NODE_SIZE.width / 4;
        const positions: Record<string, { x: number; y: number }> = {};
        for (const id of state.selection) {
          const node = state.nodes.find((n) => n.node.id === id);
          if (node) positions[id] = { x: node.x + delta, y: node.y };
        }
        dispatch({ type: "move", positions, commit: true });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, order, state, dispatch, reveal, onOpenNode, onAddDownstream]);

  return order;
}
