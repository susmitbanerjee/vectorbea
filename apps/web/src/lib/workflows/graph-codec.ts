import type { NodeKind } from "~/lib/architect/blueprint";
import type { BuilderEdge, BuilderGraph, BuilderNode, EdgeKind } from "./builder-graph";

/* ══════════════════════════════════════════════════════════════════════════════
   THE GRAPH CODEC — stored graph ⇄ canvas graph

   THE BUG THIS EXISTS TO FIX: the builder never read a stored position. It ran
   `seedGraph`, which called `layoutGraph` on the node list and returned whatever
   dagre produced — so every workflow opened as the same straight line, and
   dragging a node changed nothing that outlived the tab. Positions were not
   "lost on save"; they were never in the payload, and the save was a
   `setTimeout` that talked to nobody.

   THERE ARE TWO GRAPH DIALECTS IN THIS REPO AND BOTH ARE REAL:

   · The CANVAS dialect, which the Architect compiles
     (`WorkflowArchitectService.compilePlanToGraphJson`) and the legacy builder
     wrote: `{ id, type, position: {x,y}, data: { label, nodeType, … } }`.
   · The EXECUTION dialect, which `worker-kotlin` deserialises
     (`runtime/graph/WorkflowGraph.kt`): a FLAT `{ id, type, label, config, … }`.
     It reads `label` and `config` at the top level and knows nothing about
     `data` or `position`.

   Writing only one dialect breaks the other half of the product: canvas-only and
   the worker runs a graph of unlabelled, unconfigured nodes; execution-only and
   every position is dropped again on the next open. Both node models carry
   `@JsonIgnoreProperties(ignoreUnknown = true)`, so the safe encoding is the
   SUPERSET — flat fields for the worker, `position` and `data` for the canvas —
   and that is what `toStoredGraph` writes.

   Decoding accepts either dialect, because graphs written by three generations
   of this builder are already in the database.
══════════════════════════════════════════════════════════════════════════════ */

/** The stored shape. Deliberately loose — this is what came off the wire. */
export interface StoredNode {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  name?: unknown;
  position?: unknown;
  config?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

export interface StoredEdge {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  from?: unknown;
  to?: unknown;
  type?: unknown;
  label?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

export interface StoredGraph {
  nodes?: unknown;
  edges?: unknown;
  [key: string]: unknown;
}

const KNOWN_KINDS = new Set<NodeKind>([
  "trigger", "agent", "llm", "tool", "branch", "parallel",
  "merge", "wait", "approval", "checkpoint", "output", "end",
]);

/**
 * Execution node types → canvas kinds.
 *
 * The worker's vocabulary (`NodeType`) is not the canvas's: it has `http`,
 * `db_query`, `transform` and `join` where the canvas has `tool` and `merge`.
 * An unmapped type becomes `tool`, which keeps an unrecognised node VISIBLE and
 * editable rather than dropping it — a node the canvas silently discards is a
 * node the next save deletes from the workflow.
 */
const KIND_ALIASES: Record<string, NodeKind> = {
  start: "trigger", schedule: "trigger", cron: "trigger", webhook: "trigger",
  http: "tool", http_tool: "tool", https: "tool", api: "tool", rest: "tool",
  db_query: "tool", db_read: "tool", db_write: "tool", database: "tool",
  database_read: "tool", database_write: "tool", graphql_tool: "tool",
  mcp_tool: "tool", grpc_tool: "tool", slack: "tool", builtin_email: "tool",
  email: "tool", crm: "tool", action: "tool", transform: "tool",
  iterative_agent: "agent", model: "llm", generate: "llm",
  condition: "branch", decision: "branch", if: "branch", switch: "branch",
  fan_out: "parallel", split: "parallel",
  join: "merge", fan_in: "merge",
  delay: "wait", sleep: "wait", timer: "wait",
  human_approval: "approval", gate: "approval", review: "approval",
  commit: "checkpoint", savepoint: "checkpoint",
  result: "output", finish: "end", stop: "end", terminate: "end",
};

export function toNodeKind(raw: unknown): NodeKind {
  const value = String(raw ?? "").trim().toLowerCase();
  if (KNOWN_KINDS.has(value as NodeKind)) return value as NodeKind;
  return KIND_ALIASES[value] ?? "tool";
}

const EDGE_KINDS = new Set<EdgeKind>(["standard", "conditional", "error", "parallel"]);

function toEdgeKind(raw: unknown): EdgeKind {
  const value = String(raw ?? "").trim().toLowerCase();
  if (EDGE_KINDS.has(value as EdgeKind)) return value as EdgeKind;
  if (value === "error" || value === "failure" || value === "on_error") return "error";
  if (value === "conditional" || value === "condition" || value === "branch" || value === "true" || value === "false") {
    return "conditional";
  }
  if (value === "parallel" || value === "fan_out") return "parallel";
  return "standard";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * A node's stored position, or null when it has never been placed.
 *
 * Null is meaningfully different from `{x: 0, y: 0}`: it is what tells the
 * caller to lay this graph out rather than stack every node on the origin.
 */
function readPosition(node: StoredNode): { x: number; y: number } | null {
  const position = asRecord(node.position);
  const x = asFiniteNumber(position.x);
  const y = asFiniteNumber(position.y);
  if (x !== null && y !== null) return { x, y };

  // Some older graphs stored x/y flat on the node rather than under `position`.
  const flatX = asFiniteNumber(node.x);
  const flatY = asFiniteNumber(node.y);
  if (flatX !== null && flatY !== null) return { x: flatX, y: flatY };

  return null;
}

export interface DecodedGraph {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  /**
   * True when at least one node arrived WITHOUT a stored position.
   *
   * The caller lays the graph out in that case. Reported rather than handled
   * here because auto-layout is a canvas concern and doing it silently is how
   * "positions do not persist" hides: a graph that is re-laid-out on every open
   * looks identical to one whose positions were never saved.
   */
  needsLayout: boolean;
}

/** Decode a stored graph. Never throws — a malformed graph yields an empty one. */
export function fromStoredGraph(graph: StoredGraph | null | undefined): DecodedGraph {
  const rawNodes = Array.isArray(graph?.nodes) ? (graph.nodes as StoredNode[]) : [];
  const rawEdges = Array.isArray(graph?.edges) ? (graph.edges as StoredEdge[]) : [];

  let needsLayout = false;
  const seen = new Set<string>();
  const nodes: BuilderNode[] = [];

  for (const [index, raw] of rawNodes.entries()) {
    const node = asRecord(raw) as StoredNode;
    const data = asRecord(node.data);

    const id = String(node.id ?? `node_${index}`);
    // A duplicate id would give two nodes the same identity, and every edge
    // touching it would bind to whichever won. Dropping the later one keeps the
    // graph coherent.
    if (seen.has(id)) continue;
    seen.add(id);

    // `data.nodeType` is the canvas dialect's answer and `type` the worker's.
    // Prefer the canvas one: a node stored as `http` at the top level and
    // `tool` in data is a tool that binds an HTTP tool, and the canvas draws it
    // as a tool.
    const kind = toNodeKind(data.nodeType ?? node.type);

    const label = [data.label, node.label, node.name, data.name]
      .find((value) => typeof value === "string" && value.trim() !== "");

    const config = { ...asRecord(data.config), ...asRecord(node.config) };
    // The trigger's schedule lives under `data.triggerConfig` in every graph
    // this app has written, and the inspector reads it off `config`.
    const triggerConfig = asRecord(data.triggerConfig);
    if (Object.keys(triggerConfig).length > 0) Object.assign(config, triggerConfig);

    const position = readPosition(node);
    if (!position) needsLayout = true;

    nodes.push({
      node: {
        id,
        name: (label as string | undefined) ?? `Step ${index + 1}`,
        kind,
        config,
      },
      x: position?.x ?? 0,
      y: position?.y ?? 0,
    });
  }

  const ids = new Set(nodes.map((n) => n.node.id));
  const edgeIds = new Set<string>();
  const edges: BuilderEdge[] = [];

  for (const [index, raw] of rawEdges.entries()) {
    const edge = asRecord(raw) as StoredEdge;
    const source = String(edge.source ?? edge.from ?? "");
    const target = String(edge.target ?? edge.to ?? "");

    // An edge to a node that is not in the graph is one React Flow drops
    // silently, so drop it here where the reason is visible.
    if (!ids.has(source) || !ids.has(target)) continue;

    const id = String(edge.id ?? `e-${source}-${target}-${index}`);
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);

    const data = asRecord(edge.data);
    const label = [edge.label, data.label].find((v) => typeof v === "string" && v !== "");

    edges.push({
      id,
      source,
      target,
      kind: toEdgeKind(data.edgeType ?? edge.type),
      ...(label ? { label: label as string } : {}),
    });
  }

  return { nodes, edges, needsLayout };
}

/**
 * Encode for storage, in BOTH dialects.
 *
 * `position` is the whole point of the exercise, but writing it alone would be
 * a regression: the worker reads `label` and `config` at the top level, so a
 * canvas-only encoding would round-trip the picture and lose the behaviour.
 */
export function toStoredGraph(graph: BuilderGraph): { nodes: unknown[]; edges: unknown[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.node.id,
      // Top level for `worker-kotlin`'s WorkflowNode…
      type: n.node.kind,
      label: n.node.name,
      config: n.node.config,
      // …and the canvas dialect alongside it.
      position: { x: Math.round(n.x), y: Math.round(n.y) },
      data: {
        label: n.node.name,
        nodeType: n.node.kind,
        config: n.node.config,
      },
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.kind === "standard" ? "default" : e.kind,
      ...(e.label ? { label: e.label } : {}),
      data: { edgeType: e.kind },
    })),
  };
}

/**
 * The trigger config to persist on the version.
 *
 * `WorkflowRoutes.syncSchedule` reads this to create, update or delete the
 * workflow's `schedules` row, so a cron typed on the canvas that is not lifted
 * out here is a schedule that never fires — the failure the legacy
 * `extractTriggerConfig` was written to stop, kept here for the same reason.
 */
export function triggerConfigFrom(graph: BuilderGraph): Record<string, unknown> {
  const trigger = graph.nodes.find((n) => n.node.kind === "trigger");
  if (!trigger) return {};

  const config = trigger.node.config;
  const cron = typeof config.cron === "string" ? config.cron
    : typeof config.cronExpression === "string" ? config.cronExpression
      : null;
  const timezone = typeof config.timezone === "string" ? config.timezone : "UTC";
  const declared = typeof config.triggerType === "string" ? config.triggerType
    : typeof config.type === "string" ? config.type
      : null;

  // A trigger node carrying a cron IS a cron trigger, whatever the node's
  // `triggerType` says — the two disagree whenever somebody types a schedule
  // onto a manual trigger, and the schedule is the more recent intent.
  const kind = cron && cron.trim() !== "" ? "cron" : (declared ?? "manual");

  if (kind !== "cron") return { triggerType: kind, type: kind };

  return {
    triggerType: "cron",
    type: "cron",
    cronExpression: cron?.trim() ?? "",
    cron: cron?.trim() ?? "",
    timezone,
  };
}
