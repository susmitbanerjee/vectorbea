import {
  resolveTool, resolveConnection, type BuilderRegistry,
} from "./use-builder-registry";
import { downstreamOf } from "./store";
import { validateTeams } from "./team-validation";
import type { Entitlements } from "~/lib/entitlements/use-entitlements";
import type { BuilderEdge, BuilderNode } from "~/mocks/builder";

/* ══════════════════════════════════════════════════════════════════════════════
   CONTINUOUS VALIDATION — non-blocking, always running.

   Runs on every graph change and lists what it finds in the inspector. It never
   stops an edit: a workflow mid-construction is invalid by definition, and a
   builder that objects while you are still building it gets its warnings
   dismissed permanently within a day.

   FOUR CATEGORIES, and the fourth is the point:

     structural  a cycle, an orphan, a node nothing can reach
     binding     a required input nothing is mapped into
     resource    a connection or credential that does not exist
     policy      a HIGH-RISK TOOL WITH NO APPROVAL GATE UPSTREAM

   The policy category is where the risk levels on the Tools registry stop being
   decoration. `stripe.refund` is marked critical in the tool registry; until
   now nothing in the product ever consulted that. Here it produces an error
   that says a human has to stand between the model and the money.
══════════════════════════════════════════════════════════════════════════════ */

export type IssueCategory = "structural" | "binding" | "resource" | "policy";
export type IssueSeverity = "error" | "warning";

export interface Issue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  /** The node to select when the issue is clicked. Null for whole-graph issues. */
  nodeId: string | null;
  title: string;
  detail: string;
  /** What to do about it. Never "check your configuration". */
  fix: string;
}

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  structural: "Structure",
  binding: "Bindings",
  resource: "Resources",
  policy: "Policy",
};

/** Risk tiers that may not run unattended in production. */
const GATED_RISK = new Set(["high", "critical"]);

/**
 * Below this, a node's configured timeout is worth flagging.
 *
 * Mirrors `WorkflowRuntime.defaultTimeoutFor` — the budget the worker uses when
 * a node declares none. Anything below its own class default is a deliberate
 * tightening, and the canvas says so rather than letting it be discovered as an
 * intermittent failure.
 */
const TIMEOUT_FLOOR_MS: Partial<Record<string, number>> = {
  agent: 120_000,
  llm: 90_000,
};

/** True when a node claims a tool at all, under any of the binding keys. */
function bindsTool(config: Record<string, unknown>): boolean {
  return Boolean(
    (typeof config.toolId === "string" && config.toolId)
    || (typeof config.tool === "string" && config.tool)
    || (typeof config.toolName === "string" && config.toolName),
  );
}

export function validateGraph(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  disabled: string[] = [],
  /**
   * The workspace's real agents, tools and connections.
   *
   * These rules used to check the graph against `~/mocks/fixtures`, which made
   * the two that matter most say the wrong thing: "Connection X does not exist"
   * fired for every real connection (none of them are in the fixtures), and the
   * approval-gate rule read its risk tier from a fictional tool of the same
   * name — so a genuinely critical tool went ungated whenever the fixtures
   * happened not to contain it.
   *
   * Optional so the reducer's own tests can validate a graph without a
   * registry; resource rules are then skipped rather than answered wrongly.
   */
  registry?: BuilderRegistry,
  /**
   * What the WORKSPACE's plan allows.
   *
   * Optional for the same reason [registry] is: "your plan does not include
   * this" is a claim about the workspace, and answering it from an unresolved
   * fetch would condemn a correctly-sized team while the request was in flight.
   */
  plan?: Entitlements,
): Issue[] {
  const issues: Issue[] = [];
  const off = new Set(disabled);
  const live = nodes.filter((n) => !off.has(n.node.id));
  if (live.length === 0) return issues;

  const byId = new Map(live.map((n) => [n.node.id, n]));
  const liveEdges = edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  /* ── Structural ─────────────────────────────────────────────────────────── */

  const triggers = live.filter((n) => n.node.kind === "trigger");
  if (triggers.length === 0) {
    issues.push({
      id: "no-trigger", category: "structural", severity: "error", nodeId: null,
      title: "No trigger",
      detail: "Nothing starts this workflow, so it can never run on its own.",
      fix: "Add a trigger from the Start group.",
    });
  } else if (triggers.length > 1) {
    for (const extra of triggers.slice(1)) {
      issues.push({
        id: `multi-trigger-${extra.node.id}`, category: "structural", severity: "error",
        nodeId: extra.node.id,
        title: "A second trigger",
        detail: `‘${extra.node.name}’ is a second entry point. A workflow has exactly one.`,
        fix: "Delete it, or split this branch into its own workflow.",
      });
    }
  }

  // Reachability from the trigger. Anything the run can never arrive at is dead
  // configuration that will still be published and still confuse the next reader.
  const roots = triggers.map((n) => n.node.id);
  const reachable = new Set(roots.length > 0 ? downstreamOf(roots, liveEdges) : []);
  for (const n of live) {
    if (roots.length === 0) break;
    if (reachable.has(n.node.id)) continue;
    const hasInbound = liveEdges.some((e) => e.target === n.node.id);
    issues.push({
      id: `unreachable-${n.node.id}`, category: "structural", severity: hasInbound ? "error" : "warning",
      nodeId: n.node.id,
      title: hasInbound ? `‘${n.node.name}’ is unreachable` : `‘${n.node.name}’ is not connected`,
      detail: hasInbound
        ? "It has an input, but nothing on the path from the trigger ever reaches it."
        : "Nothing connects to this node, so it never runs.",
      fix: hasInbound
        ? "Connect it to a node the trigger can reach, or delete it."
        : "Drag an edge into it from an upstream step.",
    });
  }

  // Cycles. Detected with a colour-marked DFS rather than by counting edges,
  // because a fan-out and a cycle have the same edge count and only one of them
  // never terminates.
  const cycleNodes = findCycle(live.map((n) => n.node.id), liveEdges);
  if (cycleNodes) {
    issues.push({
      id: "cycle", category: "structural", severity: "error", nodeId: cycleNodes[0],
      title: "The graph contains a cycle",
      detail: `${cycleNodes.map((id) => byId.get(id)?.node.name ?? id).join(" → ")} → …loops back. A run entering it never finishes.`,
      fix: "Remove one of the edges in the loop, or replace it with a branch that can exit.",
    });
  }

  // A fan with no join leaves the branches hanging.
  const fans = live.filter((n) => n.node.kind === "parallel").length;
  const merges = live.filter((n) => n.node.kind === "merge").length;
  if (fans > merges) {
    const fan = live.find((n) => n.node.kind === "parallel")!;
    issues.push({
      id: "unmerged-fan", category: "structural", severity: "error", nodeId: fan.node.id,
      title: "A fan-out is never merged",
      detail: `‘${fan.node.name}’ opens concurrent branches and nothing joins them, so the run has no single point of completion.`,
      fix: "Add a merge node after the branches.",
    });
  }

  /* ── Per-node binding, resource and policy ──────────────────────────────── */

  for (const n of live) {
    const { config, kind, name, id } = n.node;

    /* Binding. */
    if (kind === "tool" && !config.tool) {
      issues.push({
        id: `unbound-tool-${id}`, category: "binding", severity: "error", nodeId: id,
        title: `‘${name}’ has no tool selected`,
        detail: "The step is a tool call with nothing to call.",
        fix: "Pick a tool on the node's Configure tab.",
      });
    }
    if (kind === "branch" && !config.condition) {
      issues.push({
        id: `unbound-condition-${id}`, category: "binding", severity: "error", nodeId: id,
        title: `‘${name}’ has no condition`,
        detail: "A branch with no predicate cannot choose an arm, so the run stops here.",
        fix: "Write the condition, e.g. tier == 'enterprise'.",
      });
    }
    if (kind === "parallel" && !config.over) {
      issues.push({
        id: `unbound-over-${id}`, category: "binding", severity: "error", nodeId: id,
        title: `‘${name}’ has nothing to fan out over`,
        detail: "A fan-out needs a collection from an upstream step.",
        fix: "Bind it to an upstream output, e.g. the accounts list.",
      });
    }
    if (kind === "approval" && !config.approverGroup) {
      issues.push({
        id: `unbound-approver-${id}`, category: "binding", severity: "error", nodeId: id,
        title: `‘${name}’ has no approver group`,
        detail: "Nobody would be asked, so the gate would hold the run indefinitely.",
        fix: "Choose an approver group, and set the SLA and timeout behaviour.",
      });
    }
    /*
     * A budget too small for the work the node does.
     *
     * The inspector used to default every node's `timeoutMs` to 30s and write it
     * back on every save, so agent nodes quietly ran on a quarter of the 120s
     * the worker gives them by default. A first agent call pays DNS, the TLS
     * handshake and the model's own latency; a tool-calling agent pays that
     * several times over. Thirty seconds is often not enough for the first
     * attempt and comfortably enough for the retry — which reads as a flaky
     * platform rather than as a budget that was set too low.
     *
     * A warning, not an error: a short budget is a legitimate choice for a fast
     * model on a hot path, and the canvas must not refuse it. It just has to be
     * a choice rather than a default nobody saw.
     */
    const declaredTimeoutMs = typeof config.timeoutMs === "number" ? config.timeoutMs : null;
    const floorMs = TIMEOUT_FLOOR_MS[kind];
    if (declaredTimeoutMs !== null && floorMs !== undefined && declaredTimeoutMs < floorMs) {
      issues.push({
        id: `tight-timeout-${id}`, category: "policy", severity: "warning", nodeId: id,
        title: `‘${name}’ has ${Math.round(declaredTimeoutMs / 1000)}s to finish`,
        detail:
          `A first call pays connection setup and a cold provider on top of the work itself, ` +
          `so ${Math.round(declaredTimeoutMs / 1000)}s frequently fails once and then succeeds on retry. ` +
          `The worker allows ${Math.round(floorMs / 1000)}s for this kind of step by default.`,
        fix: `Raise the timeout on the node's Advanced tab to at least ${Math.round(floorMs / 1000)}s, or lower the retry count if the short budget is deliberate.`,
      });
    }

    if (kind === "output" && !config.destination) {
      issues.push({
        id: `unbound-destination-${id}`, category: "binding", severity: "warning", nodeId: id,
        title: `‘${name}’ has no destination`,
        detail: "The result is produced and then goes nowhere.",
        fix: "Set a destination, or delete the node if the run's own output is enough.",
      });
    }

    /* Resource.
       Skipped entirely without a registry: "this connection does not exist" is
       a claim about the workspace, and answering it from an empty list would
       condemn every correctly-bound node while the lists were still loading. */
    const boundTool = registry ? resolveTool(config, registry) : null;
    const boundConnection = registry ? resolveConnection(config, registry) : null;
    const namesConnection =
      (typeof config.connectionId === "string" && config.connectionId)
      || (typeof config.connection === "string" && config.connection);

    if (registry && !registry.loading && namesConnection && !boundConnection) {
      const label = typeof config.connection === "string" && config.connection
        ? config.connection
        : String(config.connectionId);
      issues.push({
        id: `missing-conn-${id}`, category: "resource", severity: "error", nodeId: id,
        title: `Connection ‘${label}’ does not exist`,
        detail: `‘${name}’ binds credentials this workspace does not have.`,
        fix: `Create it under Connections, or bind a different one.`,
      });
    } else if (registry && boundConnection && boundConnection.status !== "active") {
      issues.push({
        id: `unhealthy-conn-${id}`, category: "resource", severity: "warning", nodeId: id,
        title: `Connection ‘${boundConnection.name}’ is ${boundConnection.status}`,
        detail: `‘${name}’ will fail here until it recovers. This is an operational condition, not a defect in the graph.`,
        fix: `Fix or rotate ‘${boundConnection.name}’ — or publish anyway if this change is what fixes it.`,
      });
    } else if (kind === "tool" && bindsTool(config) && !namesConnection && !boundTool?.connectionId) {
      issues.push({
        id: `no-conn-${id}`, category: "resource", severity: "warning", nodeId: id,
        title: `‘${name}’ has no connection bound`,
        detail: "It will run against the workspace default, which may not be the account you mean.",
        fix: "Bind a connection explicitly.",
      });
    }

    /* A tool node naming a tool the workspace does not have cannot run at all,
       and the engine reports it only once the run reaches the node. */
    if (registry && !registry.loading && kind === "tool" && bindsTool(config) && !boundTool) {
      const label = typeof config.toolName === "string" && config.toolName
        ? config.toolName
        : typeof config.tool === "string" ? config.tool : String(config.toolId);
      issues.push({
        id: `missing-tool-${id}`, category: "resource", severity: "error", nodeId: id,
        title: `Tool ‘${label}’ is not registered`,
        detail: `‘${name}’ calls a tool this workspace does not have, so the run fails when it reaches this step.`,
        fix: "Register the tool, or bind one that exists.",
      });
    }

    /* Policy — the risk tiers doing real work. */
    if (kind === "tool" && bindsTool(config)) {
      const tool = boundTool;
      if (tool && GATED_RISK.has(tool.riskLevel)) {
        const upstream = upstreamOf(id, liveEdges);
        const gated = [...upstream].some((up) => byId.get(up)?.node.kind === "approval");
        if (!gated) {
          issues.push({
            id: `ungated-${id}`,
            category: "policy",
            // Critical is an error; high is a warning. A refund issued without
            // review is a different class of problem from a Slack message sent
            // without review, and flattening them makes the whole category noise.
            severity: tool.riskLevel === "critical" ? "error" : "warning",
            nodeId: id,
            title: `‘${tool.name}’ is ${tool.riskLevel} risk with no approval upstream`,
            detail: `Nothing between the trigger and ‘${name}’ stops for a person, so this ${tool.riskLevel}-risk call runs unattended.`,
            fix: "Add an approval gate upstream, or bind a lower-risk tool.",
          });
        }
      }
    }
  }

  /* Teams are validated in their own module: the rules are about a graph INSIDE
     a node — a roster and the delegation relation over it — and folding twenty
     of them into this loop would bury the ten that are about the canvas graph.
     They produce the same `Issue` shape and land in the same sorted list. */
  issues.push(...validateTeams(live, disabled, registry, plan));

  // Errors first, then by category, so the list is read top-down as a work queue.
  const order: Record<IssueCategory, number> = { structural: 0, binding: 1, resource: 2, policy: 3 };
  return issues.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)
    || order[a.category] - order[b.category],
  );
}

/* ── Graph helpers ────────────────────────────────────────────────────────── */

function upstreamOf(id: string, edges: BuilderEdge[]): Set<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.target === current && !seen.has(edge.source)) {
        seen.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return seen;
}

/** The first cycle found, as the node ids around it. Null when the graph is acyclic. */
function findCycle(ids: string[], edges: BuilderEdge[]): string[] | null {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
  }

  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map(ids.map((id) => [id, WHITE]));
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    colour.set(id, GREY);
    stack.push(id);
    for (const next of out.get(id) ?? []) {
      const c = colour.get(next);
      // Grey means "on the current path" — a back-edge, which is a cycle. Black
      // means "already finished", which is a cross-edge and perfectly legal in
      // a graph that fans out and merges.
      if (c === GREY) return stack.slice(stack.indexOf(next));
      if (c === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    colour.set(id, BLACK);
    return null;
  }

  for (const id of ids) {
    if (colour.get(id) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

/* ── Summary ──────────────────────────────────────────────────────────────── */

export interface ValiditySummary {
  errors: number;
  warnings: number;
  /** Publishable: no errors. Warnings never block. */
  valid: boolean;
}

/**
 * Issues that REFUSE A SAVE, as opposed to the ones that only warn.
 *
 * ── WHY ALMOST NOTHING BLOCKS ───────────────────────────────────────────────
 * Continuous validation is deliberately non-blocking: a workflow mid-
 * construction is invalid by definition, and a builder that refuses to save
 * while you are still building gets worked around within a day — usually by
 * somebody keeping a second tab open with the last version that saved.
 *
 * A CYCLE IS THE EXCEPTION, and it is the only one. Every other error describes
 * a graph that is incomplete: an unbound tool, a missing approver, a node
 * nothing reaches. Save those and the run fails at that node with a clear
 * message, which is a normal working loop. A cycle is different in kind — it
 * describes a graph that does not TERMINATE, and the version that gets written
 * is one the engine will accept, schedule, and then spend a budget discovering
 * is unbounded. The cost of the mistake is not a failed node, it is a run that
 * burns its ceiling and a bill nobody authorised.
 *
 * So: cycles are refused with the loop named. Everything else saves, and says
 * so in the issue list.
 */
export function blockingIssues(issues: Issue[]): Issue[] {
  return issues.filter(
    (i) => i.severity === "error"
      && (i.id === "cycle" || i.id.startsWith("team-cycle-")),
  );
}

export function summarise(issues: Issue[]): ValiditySummary {
  const errors = issues.filter((i) => i.severity === "error").length;
  return { errors, warnings: issues.length - errors, valid: errors === 0 };
}
