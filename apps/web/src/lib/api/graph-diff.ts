/**
 * Version diff, computed client-side from two `graph_json` payloads.
 *
 * THE ASSUMPTION, VERIFIED: `GET /api/workflows/:id/versions` returns each
 * version's full `graph` (`WorkflowVersion.toResponse()` parses `graphJson` and
 * emits it whole), alongside `inputSchema`, `outputSchema`, `triggerConfig`,
 * `retryPolicy`, `timeoutPolicy` and `budgetPolicy`. Two versions therefore
 * contain everything a diff needs, and **no API work is required** — the
 * assumption in the brief is correct.
 *
 * The one caveat is size, not capability: the endpoint returns every version
 * with its full graph, so a workflow with 200 versions ships 200 graphs in
 * order to diff two of them. That is a pagination problem for later, not a
 * blocker now.
 */

export interface GraphNode {
  id: string;
  type?: string;
  label?: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  id?: string;
  source?: string;
  target?: string;
  [key: string]: unknown;
}

export interface WorkflowGraph {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  [key: string]: unknown;
}

export type ChangeKind = "added" | "removed" | "modified" | "unchanged";

export interface NodeChange {
  kind: ChangeKind;
  id: string;
  label: string;
  type: string | null;
  /** Field-level changes, present only when `kind` is "modified". */
  fields: FieldChange[];
}

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface EdgeChange {
  kind: Extract<ChangeKind, "added" | "removed">;
  source: string;
  target: string;
}

export interface GraphDiff {
  nodes: NodeChange[];
  edges: EdgeChange[];
  summary: { added: number; removed: number; modified: number; unchanged: number };
  /** True when the two graphs are identical. */
  identical: boolean;
}

/** Stable identity for an edge, since `id` is optional in the payload. */
function edgeKey(edge: GraphEdge): string {
  return edge.id ?? `${edge.source ?? "?"}->${edge.target ?? "?"}`;
}

function displayLabel(node: GraphNode | undefined, id: string): string {
  return (node?.label as string) ?? (node?.name as string) ?? id;
}

/**
 * Deep field comparison, flattened to dotted paths.
 *
 * Flattened rather than nested because the UI renders a list of changed fields,
 * and "config.retry.maxAttempts: 3 → 5" is one readable line where a nested
 * object diff would be three levels of disclosure to reach the same number.
 *
 * `position` is excluded by default: moving a node on the canvas is not a change
 * to what the workflow DOES, and a diff that flags every drag is a diff nobody
 * reads.
 */
function flattenChanges(
  before: unknown,
  after: unknown,
  path: string,
  out: FieldChange[],
  ignore: ReadonlySet<string>,
): void {
  if (ignore.has(path)) return;

  const bothObjects =
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after);

  if (bothObjects) {
    const keys = new Set([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ]);
    for (const key of keys) {
      flattenChanges(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        out,
        ignore,
      );
    }
    return;
  }

  // Arrays and scalars compare by value. Arrays are not diffed element-wise:
  // reordering a list of tool ids is a real change, and pretending otherwise
  // would hide it.
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({ path, before, after });
  }
}

export interface DiffOptions {
  /**
   * Node fields to ignore. Defaults to canvas geometry, which changes on every
   * drag and never changes behaviour.
   */
  ignoreFields?: string[];
}

export function diffGraphs(
  before: WorkflowGraph | null | undefined,
  after: WorkflowGraph | null | undefined,
  options: DiffOptions = {},
): GraphDiff {
  const ignore = new Set(options.ignoreFields ?? ["position", "x", "y", "width", "height"]);

  const beforeNodes = new Map((before?.nodes ?? []).map((n) => [n.id, n]));
  const afterNodes = new Map((after?.nodes ?? []).map((n) => [n.id, n]));

  const nodes: NodeChange[] = [];
  const allIds = new Set([...beforeNodes.keys(), ...afterNodes.keys()]);

  for (const id of allIds) {
    const b = beforeNodes.get(id);
    const a = afterNodes.get(id);

    if (!b && a) {
      nodes.push({ kind: "added", id, label: displayLabel(a, id), type: (a.type as string) ?? null, fields: [] });
      continue;
    }
    if (b && !a) {
      nodes.push({ kind: "removed", id, label: displayLabel(b, id), type: (b.type as string) ?? null, fields: [] });
      continue;
    }
    if (!b || !a) continue;

    const fields: FieldChange[] = [];
    flattenChanges(b, a, "", fields, ignore);

    nodes.push({
      kind: fields.length > 0 ? "modified" : "unchanged",
      id,
      label: displayLabel(a, id),
      type: (a.type as string) ?? null,
      fields,
    });
  }

  // Deterministic order: changes first, then alphabetical. A diff whose row
  // order shifts between renders is unreadable.
  const rank: Record<ChangeKind, number> = { removed: 0, added: 1, modified: 2, unchanged: 3 };
  nodes.sort((x, y) => rank[x.kind] - rank[y.kind] || x.label.localeCompare(y.label));

  const beforeEdges = new Map((before?.edges ?? []).map((e) => [edgeKey(e), e]));
  const afterEdges = new Map((after?.edges ?? []).map((e) => [edgeKey(e), e]));

  const edges: EdgeChange[] = [];
  for (const [key, edge] of afterEdges) {
    if (!beforeEdges.has(key)) {
      edges.push({ kind: "added", source: edge.source ?? "?", target: edge.target ?? "?" });
    }
  }
  for (const [key, edge] of beforeEdges) {
    if (!afterEdges.has(key)) {
      edges.push({ kind: "removed", source: edge.source ?? "?", target: edge.target ?? "?" });
    }
  }

  const summary = {
    added: nodes.filter((n) => n.kind === "added").length,
    removed: nodes.filter((n) => n.kind === "removed").length,
    modified: nodes.filter((n) => n.kind === "modified").length,
    unchanged: nodes.filter((n) => n.kind === "unchanged").length,
  };

  return {
    nodes,
    edges,
    summary,
    identical: summary.added === 0 && summary.removed === 0 && summary.modified === 0 && edges.length === 0,
  };
}

/** One line for a version-history row. */
export function describeDiff(diff: GraphDiff): string {
  if (diff.identical) return "No changes to the graph.";
  const parts: string[] = [];
  if (diff.summary.added) parts.push(`${diff.summary.added} added`);
  if (diff.summary.removed) parts.push(`${diff.summary.removed} removed`);
  if (diff.summary.modified) parts.push(`${diff.summary.modified} changed`);
  if (diff.edges.length) parts.push(`${diff.edges.length} connection${diff.edges.length === 1 ? "" : "s"}`);
  return parts.join(", ");
}
