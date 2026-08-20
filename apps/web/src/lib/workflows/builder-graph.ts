import type { NodeKind } from "~/lib/architect/blueprint";

/* ══════════════════════════════════════════════════════════════════════════════
   THE CANVAS GRAPH CONTRACT

   Declared here rather than in `~/mocks/builder` because the builder now loads
   REAL graphs from `/api/workflows/:id/versions`, and live code cannot import
   fixtures — ESLint enforces that, correctly, since a type import is one edit
   away from becoming a value import. `~/mocks/builder` re-exports these so the
   seeded fixture graph and the live one stay one shape rather than two that
   drift.
══════════════════════════════════════════════════════════════════════════════ */

/** A JSON-ish config tree. Diffed by flattened dotted path. */
export type NodeConfig = Record<string, unknown>;

/**
 * A node as a workflow VERSION holds it — identity, name, kind, config.
 *
 * Structurally identical to `VersionNode` in `~/mocks/workflow-nodes`, and
 * restated for the same reason `NodeKind` is: this is the live contract, that
 * one is the fixture's, and TypeScript is structural so both satisfy each other.
 */
export interface GraphNode {
  /** Stable across versions. Node identity is what makes a diff meaningful. */
  id: string;
  name: string;
  kind: NodeKind;
  config: NodeConfig;
}

export type EdgeKind = "standard" | "conditional" | "error" | "parallel";

export interface BuilderEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** Rendered on the edge. Set for conditional and error edges. */
  label?: string;
}

/** A node with a PLACE. The `x`/`y` are the thing that has to survive a save. */
export interface BuilderNode {
  node: GraphNode;
  x: number;
  y: number;
}

export interface BuilderGraph {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}
