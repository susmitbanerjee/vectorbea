import { layoutGraph } from "./graph-layout";
import { currentVersion } from "./workflow-versions";
import { flattenConfig, type VersionNode } from "./workflow-nodes";
import { CONNECTIONS, TOOLS, AGENTS } from "./fixtures";
import type { NodeKind } from "./domain";
import type { ProviderId } from "~/components/ui/provider-logo";

/* ══════════════════════════════════════════════════════════════════════════════
   THE BUILDER'S GRAPH MODEL

   A builder node IS a `VersionNode` with a position. Not a parallel type that
   happens to look like one — the same object the version diff compares and the
   publish flow validates. The alternative is two shapes for one concept, and the
   first thing that breaks is the diff: a node edited in the builder and a node
   read from a version would differ by whatever field the two types disagreed on.

   EDGES ARE EXPLICIT, unlike the derived index→index+1 chain the read-only
   canvas mirror uses. A builder needs to know that the edge out of a branch is
   conditional and carries its predicate, that an error path is a different kind
   of arrow, and that a fan-out has several. None of that survives "node n
   connects to node n+1".
══════════════════════════════════════════════════════════════════════════════ */

export type EdgeKind = "standard" | "conditional" | "error" | "parallel";

export interface BuilderEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** Rendered on the edge. Set for conditional and error edges. */
  label?: string;
}

export interface BuilderNode {
  node: VersionNode;
  x: number;
  y: number;
}

export interface BuilderGraph {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

/* ── Seeding ──────────────────────────────────────────────────────────────── */

/**
 * Explicit edges from a version's node sequence.
 *
 * The sequence encodes structure by node kind — `parallel` opens lanes, `merge`
 * closes them, `branch` diverges — and this turns that back into the edges the
 * canvas draws. It mirrors `layoutGraph`'s lane logic so the arrows land where
 * the positions say they should.
 */
function deriveEdges(nodes: VersionNode[]): BuilderEdge[] {
  const edges: BuilderEdge[] = [];
  let fanSource: string | null = null;
  let laneTails: string[] = [];

  nodes.forEach((node, i) => {
    const previous = nodes[i - 1];
    if (!previous) return;

    if (node.kind === "merge") {
      // Everything still open in a lane converges here.
      const sources = laneTails.length > 0 ? laneTails : [previous.id];
      for (const source of sources) {
        edges.push({ id: `e-${source}-${node.id}`, source, target: node.id, kind: "parallel" });
      }
      laneTails = [];
      fanSource = null;
      return;
    }

    if (previous.kind === "parallel") {
      fanSource = previous.id;
      laneTails = [];
    }

    // A merge already returned above, so anything still here inside an open fan
    // belongs to a lane.
    if (fanSource) {
      // Lanes alternate, matching layoutGraph's two-row fan.
      const lane = laneTails.length % 2;
      const source = laneTails[lane] ?? fanSource;
      edges.push({ id: `e-${source}-${node.id}`, source, target: node.id, kind: "parallel" });
      laneTails[lane] = node.id;
      return;
    }

    if (previous.kind === "branch") {
      edges.push({
        id: `e-${previous.id}-${node.id}`,
        source: previous.id,
        target: node.id,
        kind: "conditional",
        label: String(previous.config.condition ?? "true"),
      });
      return;
    }

    edges.push({ id: `e-${previous.id}-${node.id}`, source: previous.id, target: node.id, kind: "standard" });
  });

  /* One error path, from the riskiest tool call to the nearest downstream
     approval or output. A builder with no error edge in it never shows what an
     error edge looks like, and this graph has a node that genuinely fails. */
  const risky = nodes.find((n) => n.kind === "tool" && typeof n.config.connection === "string");
  const handler = nodes.find((n) => n.kind === "approval") ?? nodes.find((n) => n.kind === "output");
  if (risky && handler && risky.id !== handler.id) {
    edges.push({
      id: `e-err-${risky.id}`,
      source: risky.id,
      target: handler.id,
      kind: "error",
      label: "on error",
    });
  }

  return edges;
}

/** The graph a workflow opens with, positioned by the shared layout. */
export function seedGraph(workflowId: string): BuilderGraph {
  const version = currentVersion(workflowId);
  const nodes = version?.nodes ?? [];
  const laid = layoutGraph(nodes);

  return {
    nodes: laid.nodes.map((n) => ({ node: n.node, x: n.x, y: n.y })),
    edges: deriveEdges(nodes),
  };
}

/* ── Resource binding ─────────────────────────────────────────────────────── */

export interface BoundResource {
  label: string;
  provider: ProviderId | null;
  /** Full-colour logo only when the connection behind it is healthy. */
  connected: boolean;
  detail: string | null;
}

const PROVIDER_BY_PREFIX: Record<string, ProviderId> = {
  postgres: "postgres", mysql: "mysql", slack: "slack", gmail: "gmail",
  github: "github", jira: "jira", hubspot: "hubspot", notion: "notion",
  airtable: "airtable", http: "http", webhook: "webhook", openai: "openai",
  anthropic: "anthropic", gemini: "gemini", mistral: "mistral",
};

/**
 * What a node is bound to — the tool it calls or the model it runs.
 *
 * `connected` drives §6.3: monochrome-on-tint by default, full colour only when
 * connected. On a canvas that makes an unbound or broken node visible without
 * reading a word, which is the same job the health column does on the list.
 */
export function boundResource(node: VersionNode): BoundResource | null {
  const tool = node.config.tool;
  if (typeof tool === "string" && tool) {
    const prefix = tool.split(".")[0];
    const connectionName = node.config.connection;
    const connection = typeof connectionName === "string"
      ? CONNECTIONS.find((c) => c.name === connectionName)
      : undefined;
    const record = TOOLS.find((t) => t.name === tool);
    return {
      label: tool,
      provider: PROVIDER_BY_PREFIX[prefix] ?? null,
      connected: connection?.status === "healthy",
      detail: connection?.name ?? (record ? `${record.risk} risk` : null),
    };
  }

  const model = node.config.model;
  if (typeof model === "string" && model) {
    const provider = node.config.provider;
    const agent = AGENTS.find((a) => a.model === model);
    return {
      label: model,
      provider: typeof provider === "string" ? (PROVIDER_BY_PREFIX[provider] ?? null) : null,
      connected: true,
      detail: agent ? `${agent.toolGrants} tool grants` : null,
    };
  }

  return null;
}

/* ── Node chrome ──────────────────────────────────────────────────────────── */

export interface NodeChrome {
  /** Present only when the policy differs from the workspace default. */
  retry: string | null;
  timeout: string | null;
  /** This node feeds an approval, so work stops here until a person acts. */
  precedesGate: boolean;
  /** This node commits a checkpoint. */
  commits: boolean;
}

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The chrome badges on a node.
 *
 * Only NON-DEFAULT policies are shown. A canvas that labels every node "3
 * retries, 30s timeout" has labelled nothing — the badge exists to say "this one
 * is different", and it can only do that if the ordinary case is silent.
 */
export function nodeChrome(node: VersionNode, edges: BuilderEdge[], nodes: VersionNode[]): NodeChrome {
  const retry = node.config.retry as { attempts?: number; backoff?: string } | undefined;
  const timeout = node.config.timeoutMs;

  const downstream = edges.filter((e) => e.source === node.id).map((e) => e.target);
  const precedesGate = downstream.some(
    (id) => nodes.find((n) => n.id === id)?.kind === "approval",
  );

  return {
    retry: retry && typeof retry.attempts === "number" && retry.attempts !== DEFAULT_RETRY_ATTEMPTS
      ? `${retry.attempts}×`
      : null,
    timeout: typeof timeout === "number" && timeout !== DEFAULT_TIMEOUT_MS
      ? `${Math.round(timeout / 1000)}s`
      : null,
    precedesGate,
    commits: node.kind === "checkpoint",
  };
}

/* ── New nodes ────────────────────────────────────────────────────────────── */

let counter = 0;

/** A fresh node of a kind, with the workspace-default config for that kind. */
export function makeNode(kind: NodeKind, name?: string): VersionNode {
  counter += 1;
  const id = `n-new-${kind}-${counter}`;
  const label = name ?? DEFAULT_LABEL[kind];

  const config: Record<string, unknown> =
    kind === "tool" ? { tool: "", connection: null, timeoutMs: 30_000, retry: { attempts: 3, backoff: "exponential", maxDelayMs: 8_000 } }
      : kind === "llm" ? { model: "claude-haiku-4", provider: "anthropic", temperature: 0, maxTokens: 2_048 }
        : kind === "agent" ? { model: "claude-sonnet-4", provider: "anthropic", maxSteps: 8, toolGrants: [] }
          : kind === "trigger" ? { cron: "0 9 * * *", timezone: "UTC", overlapPolicy: "skip" }
            : kind === "branch" ? { condition: "", otherwise: "skip" }
              : kind === "parallel" ? { over: "", maxConcurrency: 8 }
                : kind === "merge" ? { strategy: "concat" }
                  : kind === "wait" ? { forMs: 60_000 }
                    : kind === "approval" ? { approverGroup: "", slaMinutes: 240, onTimeout: "escalate" }
                      : kind === "checkpoint" ? { scope: "run" }
                        : kind === "output" ? { format: "json", destination: "" }
                          : {};

  return { id, name: label, kind, config };
}

const DEFAULT_LABEL: Record<NodeKind, string> = {
  trigger: "Trigger",
  agent: "Agent",
  llm: "Model call",
  tool: "Tool call",
  branch: "Branch",
  parallel: "Fan out",
  merge: "Merge",
  wait: "Wait",
  approval: "Approval gate",
  checkpoint: "Checkpoint",
  output: "Output",
  end: "End",
};

/** Deep copy with fresh ids — what paste and duplicate produce. */
export function cloneNodes(nodes: VersionNode[]): { nodes: VersionNode[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const copies = nodes.map((node) => {
    counter += 1;
    const id = `${node.id}-copy-${counter}`;
    idMap.set(node.id, id);
    // Structured copy of the config, so an edit to the copy cannot reach back
    // into the original — the bug that makes "duplicate" quietly destructive.
    return { ...node, id, config: JSON.parse(JSON.stringify(node.config)) as Record<string, unknown> };
  });
  return { nodes: copies, idMap };
}

/** Everything a node search needs to match against, lowercased. */
export function nodeSearchText(node: VersionNode): string {
  const parts = [node.name, node.kind];
  for (const value of Object.values(flattenConfig(node.config))) {
    if (typeof value === "string" || typeof value === "number") parts.push(String(value));
  }
  return parts.join(" ").toLowerCase();
}
