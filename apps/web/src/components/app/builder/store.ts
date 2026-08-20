"use client";

import * as React from "react";
import { makeNode, cloneNodes, type BuilderEdge, type BuilderGraph, type BuilderNode, type EdgeKind } from "~/mocks/builder";
import type { VersionNode } from "~/mocks/workflow-nodes";
import type { NodeKind } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   BUILDER STATE — one reducer, with an undoable history stack.

   HISTORY IS A LIST OF LABELLED SNAPSHOTS, not a list of inverse operations.
   Inverse operations are smaller and are the wrong trade here: every action
   would need a hand-written undo, and the first one written slightly wrong
   corrupts the graph in a way that only shows up several steps later. Snapshots
   of a graph this size are cheap, and they make the visible history stack —
   which the prompt asks for — a direct render of the data rather than a
   reconstruction.

   TRANSIENT ACTIONS DO NOT PUSH HISTORY. Selecting a node, or the intermediate
   frames of a drag, would otherwise bury the last real edit under forty
   entries, and an undo stack you have to hammer to reach anything is one nobody
   uses.
══════════════════════════════════════════════════════════════════════════════ */

export interface Comment {
  id: string;
  body: string;
  author: string;
  at: string;
  /** Anchored to a node, or to a point on the canvas. */
  nodeId: string | null;
  x: number;
  y: number;
  resolved: boolean;
}

export interface BuilderState {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  comments: Comment[];
  /** Node ids. Multi-select is the normal case, not the exception. */
  selection: string[];
  selectedEdgeId: string | null;
  /** Nodes the user has explicitly disabled — kept in the graph, skipped at run. */
  disabled: string[];
  /** Set once the graph diverges from the last saved version. */
  dirty: boolean;
}

export interface HistoryEntry {
  label: string;
  at: number;
}

export interface BuilderStore {
  state: BuilderState;
  history: HistoryEntry[];
  /** Index into `history` of the state currently shown. */
  cursor: number;
  canUndo: boolean;
  canRedo: boolean;
}

export type BuilderAction =
  | { type: "select"; ids: string[]; additive?: boolean }
  | { type: "selectEdge"; id: string | null }
  | { type: "move"; positions: Record<string, { x: number; y: number }>; commit: boolean }
  | { type: "addNode"; kind: NodeKind; x: number; y: number; connectFrom?: string; name?: string }
  | { type: "insertOnEdge"; edgeId: string; kind: NodeKind }
  | { type: "deleteSelection" }
  | { type: "duplicateSelection" }
  | { type: "paste"; nodes: VersionNode[]; edges: BuilderEdge[]; at: { x: number; y: number } }
  | { type: "connect"; source: string; target: string; kind?: EdgeKind }
  | { type: "deleteEdge"; id: string }
  | { type: "setDisabled"; ids: string[]; disabled: boolean }
  | { type: "replaceGraph"; graph: BuilderGraph; label: string }
  | { type: "addComment"; comment: Comment }
  | { type: "resolveComment"; id: string }
  | { type: "markSaved" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "jumpTo"; cursor: number };

const NODE_W = 200;
const NODE_H = 76;

/** Actions that only change what is looked at, never what exists. */
const TRANSIENT = new Set(["select", "selectEdge", "undo", "redo", "jumpTo", "markSaved"]);

export function initialStore(graph: BuilderGraph): BuilderStore {
  return {
    state: {
      nodes: graph.nodes,
      edges: graph.edges,
      comments: [],
      selection: [],
      selectedEdgeId: null,
      disabled: [],
      dirty: false,
    },
    history: [{ label: "Opened", at: Date.now() }],
    cursor: 0,
    canUndo: false,
    canRedo: false,
  };
}

/* ── The graph reducer ────────────────────────────────────────────────────── */

function reduceState(state: BuilderState, action: BuilderAction): { next: BuilderState; label: string } | null {
  switch (action.type) {
    /**
     * SELECTING WHAT IS ALREADY SELECTED IS NOT A STATE CHANGE.
     *
     * This returned a fresh state unconditionally, so a redundant select — of
     * which there are many — produced a new `state.selection` array, which
     * invalidated the canvas's `nodes` memo, which handed React Flow a new
     * `nodes` prop, whose `StoreUpdater` layout effect called `setNodes`, which
     * re-rendered us. React Flow answered by firing `onSelectionChange` with
     * what it had, we dispatched it back, and the two sides ping-ponged:
     * measured at 53 selection dispatches across 104 renders before React gave
     * up with "Maximum update depth exceeded" and unmounted the canvas.
     *
     * That is the blink. During a drag the same loop runs at pointer rate and
     * the graph flickers instead of dying, which is why it read as a rendering
     * glitch rather than as the crash it is one node away from being.
     *
     * The reducer already has a "nothing changed" contract — `null`, which
     * `builderReducer` turns into the identical store object. Using it here is
     * the whole fix.
     */
    case "select": {
      const ids = action.additive
        ? [...new Set([...state.selection, ...action.ids])]
        : action.ids;

      const unchanged =
        ids.length === state.selection.length
        && ids.every((id, i) => id === state.selection[i])
        && state.selectedEdgeId === null;
      if (unchanged) return null;

      return { next: { ...state, selection: ids, selectedEdgeId: null }, label: "Select" };
    }

    case "selectEdge": {
      if (action.id === state.selectedEdgeId && state.selection.length === 0) return null;
      return { next: { ...state, selectedEdgeId: action.id, selection: [] }, label: "Select edge" };
    }

    case "move": {
      const nodes = state.nodes.map((n) => {
        const at = action.positions[n.node.id];
        return at ? { ...n, x: at.x, y: at.y } : n;
      });
      // Only the pointer-up commits; the frames in between would each be an
      // undo step.
      return action.commit
        ? { next: { ...state, nodes, dirty: true }, label: `Move ${Object.keys(action.positions).length} node${Object.keys(action.positions).length === 1 ? "" : "s"}` }
        : { next: { ...state, nodes }, label: "" };
    }

    case "addNode": {
      const node = makeNode(action.kind, action.name);
      const edges = action.connectFrom
        ? [...state.edges, {
          id: `e-${action.connectFrom}-${node.id}`,
          source: action.connectFrom,
          target: node.id,
          kind: "standard" as EdgeKind,
        }]
        : state.edges;
      return {
        next: {
          ...state,
          nodes: [...state.nodes, { node, x: action.x, y: action.y }],
          edges,
          selection: [node.id],
          dirty: true,
        },
        label: `Add ${node.name}`,
      };
    }

    case "insertOnEdge": {
      const edge = state.edges.find((e) => e.id === action.edgeId);
      if (!edge) return null;
      const source = state.nodes.find((n) => n.node.id === edge.source);
      const target = state.nodes.find((n) => n.node.id === edge.target);
      if (!source || !target) return null;

      const node = makeNode(action.kind);
      // Dropped at the midpoint, which is where the pointer was.
      const x = (source.x + target.x) / 2;
      const y = (source.y + target.y) / 2;

      return {
        next: {
          ...state,
          nodes: [...state.nodes, { node, x, y }],
          edges: [
            ...state.edges.filter((e) => e.id !== action.edgeId),
            { id: `e-${edge.source}-${node.id}`, source: edge.source, target: node.id, kind: edge.kind, label: edge.label },
            { id: `e-${node.id}-${edge.target}`, source: node.id, target: edge.target, kind: "standard" },
          ],
          selection: [node.id],
          selectedEdgeId: null,
          dirty: true,
        },
        label: `Insert ${node.name} on edge`,
      };
    }

    case "deleteSelection": {
      if (state.selection.length === 0) return null;
      const removing = new Set(state.selection);
      const kept = state.nodes.filter((n) => !removing.has(n.node.id));

      /* EDGE REPAIR. Deleting a node mid-chain would otherwise sever the graph
         into two halves, which is never what the person meant — they meant
         "take this step out". Each removed node's inbound sources are rewired
         to its outbound targets. */
      const repaired: BuilderEdge[] = state.edges.filter(
        (e) => !removing.has(e.source) && !removing.has(e.target),
      );
      for (const id of removing) {
        const inbound = state.edges.filter((e) => e.target === id && !removing.has(e.source));
        const outbound = state.edges.filter((e) => e.source === id && !removing.has(e.target));
        for (const from of inbound) {
          for (const to of outbound) {
            const exists = repaired.some((e) => e.source === from.source && e.target === to.target);
            if (!exists) {
              repaired.push({
                id: `e-${from.source}-${to.target}`,
                source: from.source,
                target: to.target,
                // The repaired edge keeps the INBOUND edge's kind: a conditional
                // arm that loses its next step is still a conditional arm.
                kind: from.kind,
                label: from.label,
              });
            }
          }
        }
      }

      return {
        next: {
          ...state,
          nodes: kept,
          edges: repaired,
          comments: state.comments.filter((c) => !c.nodeId || !removing.has(c.nodeId)),
          selection: [],
          disabled: state.disabled.filter((id) => !removing.has(id)),
          dirty: true,
        },
        label: `Delete ${removing.size} node${removing.size === 1 ? "" : "s"}`,
      };
    }

    case "duplicateSelection": {
      if (state.selection.length === 0) return null;
      const picked = state.nodes.filter((n) => state.selection.includes(n.node.id));
      const { nodes: copies, idMap } = cloneNodes(picked.map((n) => n.node));

      const placed = copies.map((node, i) => ({
        node,
        x: picked[i].x + 40,
        y: picked[i].y + 40,
      }));

      // Edges wholly inside the selection are copied too, so duplicating a
      // sub-graph gives you a sub-graph rather than a pile of loose nodes.
      const internal = state.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e,
          id: `e-copy-${idMap.get(e.source)}-${idMap.get(e.target)}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
        }));

      return {
        next: {
          ...state,
          nodes: [...state.nodes, ...placed],
          edges: [...state.edges, ...internal],
          selection: copies.map((n) => n.id),
          dirty: true,
        },
        label: `Duplicate ${copies.length} node${copies.length === 1 ? "" : "s"}`,
      };
    }

    case "paste": {
      const { nodes: copies, idMap } = cloneNodes(action.nodes);
      const originX = Math.min(...action.nodes.map((_, i) => i === 0 ? 0 : 0));
      const placed = copies.map((node, i) => ({ node, x: action.at.x + i * 24 + originX, y: action.at.y + i * 24 }));
      const internal = action.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e,
          id: `e-paste-${idMap.get(e.source)}-${idMap.get(e.target)}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
        }));
      return {
        next: {
          ...state,
          nodes: [...state.nodes, ...placed],
          edges: [...state.edges, ...internal],
          selection: copies.map((n) => n.id),
          dirty: true,
        },
        label: `Paste ${copies.length} node${copies.length === 1 ? "" : "s"}`,
      };
    }

    case "connect": {
      if (action.source === action.target) return null;
      const exists = state.edges.some((e) => e.source === action.source && e.target === action.target);
      if (exists) return null;
      const source = state.nodes.find((n) => n.node.id === action.source);
      const kind: EdgeKind = action.kind
        ?? (source?.node.kind === "branch" ? "conditional"
          : source?.node.kind === "parallel" ? "parallel" : "standard");
      return {
        next: {
          ...state,
          edges: [...state.edges, {
            id: `e-${action.source}-${action.target}`,
            source: action.source,
            target: action.target,
            kind,
            label: kind === "conditional" ? String(source?.node.config.condition ?? "true") : undefined,
          }],
          dirty: true,
        },
        label: "Connect",
      };
    }

    case "deleteEdge":
      return {
        next: {
          ...state,
          edges: state.edges.filter((e) => e.id !== action.id),
          selectedEdgeId: null,
          dirty: true,
        },
        label: "Delete edge",
      };

    case "setDisabled": {
      const set = new Set(state.disabled);
      for (const id of action.ids) {
        if (action.disabled) set.add(id);
        else set.delete(id);
      }
      return {
        next: { ...state, disabled: [...set], dirty: true },
        label: action.disabled ? `Disable ${action.ids.length}` : `Enable ${action.ids.length}`,
      };
    }

    case "replaceGraph":
      return {
        next: { ...state, nodes: action.graph.nodes, edges: action.graph.edges, dirty: true },
        label: action.label,
      };

    case "addComment":
      return {
        next: { ...state, comments: [...state.comments, action.comment], dirty: true },
        label: "Add comment",
      };

    case "resolveComment":
      return {
        next: {
          ...state,
          comments: state.comments.map((c) => (c.id === action.id ? { ...c, resolved: true } : c)),
          dirty: true,
        },
        label: "Resolve comment",
      };

    case "markSaved":
      return { next: { ...state, dirty: false }, label: "Saved" };

    default:
      return null;
  }
}

/* ── History ──────────────────────────────────────────────────────────────── */

interface Internal extends BuilderStore {
  /** Snapshot per history entry, parallel to `history`. */
  snapshots: BuilderState[];
}

export function builderReducer(store: Internal, action: BuilderAction): Internal {
  if (action.type === "undo") {
    if (store.cursor === 0) return store;
    const cursor = store.cursor - 1;
    return { ...store, cursor, state: store.snapshots[cursor], canUndo: cursor > 0, canRedo: true };
  }

  if (action.type === "redo") {
    if (store.cursor >= store.history.length - 1) return store;
    const cursor = store.cursor + 1;
    return {
      ...store, cursor, state: store.snapshots[cursor],
      canUndo: true, canRedo: cursor < store.history.length - 1,
    };
  }

  if (action.type === "jumpTo") {
    const cursor = Math.max(0, Math.min(store.history.length - 1, action.cursor));
    return {
      ...store, cursor, state: store.snapshots[cursor],
      canUndo: cursor > 0, canRedo: cursor < store.history.length - 1,
    };
  }

  const result = reduceState(store.state, action);
  if (!result) return store;

  if (TRANSIENT.has(action.type) || result.label === "") {
    // Rewrite the snapshot in place: the history entry stays, the state it
    // points at catches up. Without this, undoing past a selection would
    // restore a stale selection over a newer graph.
    const snapshots = [...store.snapshots];
    snapshots[store.cursor] = result.next;
    return { ...store, state: result.next, snapshots };
  }

  /* A new edit truncates the redo branch. Keeping it would mean "redo" replays
     a future that no longer follows from the present, which is the one thing an
     undo stack must never do. */
  const history = [...store.history.slice(0, store.cursor + 1), { label: result.label, at: Date.now() }];
  const snapshots = [...store.snapshots.slice(0, store.cursor + 1), result.next];

  // 100 entries is well past what anyone scrolls back through, and it bounds
  // memory on a 200-node graph.
  const overflow = Math.max(0, history.length - 100);

  return {
    ...store,
    state: result.next,
    history: history.slice(overflow),
    snapshots: snapshots.slice(overflow),
    cursor: history.length - 1 - overflow,
    canUndo: true,
    canRedo: false,
  };
}

export function useBuilderStore(graph: BuilderGraph) {
  const [store, dispatch] = React.useReducer(
    builderReducer,
    graph,
    (seed): Internal => {
      const base = initialStore(seed);
      return { ...base, snapshots: [base.state], canUndo: false, canRedo: false };
    },
  );

  return [store, dispatch] as const;
}

/* ── Derivations ──────────────────────────────────────────────────────────── */

export const NODE_SIZE = { width: NODE_W, height: NODE_H };

/** Every node reachable downstream of the given ids, including them. */
export function downstreamOf(ids: string[], edges: BuilderEdge[]): string[] {
  const seen = new Set(ids);
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === id && !seen.has(edge.target)) {
        seen.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return [...seen];
}

/** Everything connected to the given ids in either direction. */
export function connectedTo(ids: string[], edges: BuilderEdge[]): string[] {
  const seen = new Set(ids);
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === id && !seen.has(edge.target)) { seen.add(edge.target); queue.push(edge.target); }
      if (edge.target === id && !seen.has(edge.source)) { seen.add(edge.source); queue.push(edge.source); }
    }
  }
  return [...seen];
}

/** The full path through a node, both directions — what an edge hover lights up. */
export function pathThrough(id: string, edges: BuilderEdge[]): Set<string> {
  const up = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.target === current && !up.has(edge.source)) { up.add(edge.source); queue.push(edge.source); }
    }
  }
  const down = new Set(downstreamOf([id], edges));
  return new Set([...up, ...down]);
}
