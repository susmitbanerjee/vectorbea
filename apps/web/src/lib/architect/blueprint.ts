import type { ArchitectPlan, PlanStep } from "./types";

/* ══════════════════════════════════════════════════════════════════════════════
   PLAN → BLUEPRINT

   The Architect API returns a PLAN: named steps with temp ids, plus separate
   lists of the tools, agents and connections those steps refer to. The canvas
   in `blueprint-stream.tsx` draws a BLUEPRINT: nodes with a `kind` the layout
   and the node marks understand, each carrying the sentence that explains why
   it is there.

   Translating between them lives here rather than in the view for one reason
   worth stating: EVERY FIELD BELOW IS MODEL-AUTHORED AND MAY BE MISSING. A plan
   with no `edges`, a step with no `rationale`, a `nodeType` the prompt invented
   this week — all of those are things the API will happily return, and a view
   that indexes into them directly breaks on the response instead of drawing it.
   The rules for what to do about each one belong in one place.

   THE BLUEPRINT TYPES ARE DECLARED HERE rather than imported from
   `~/mocks/architect`, even though the fixture blueprint uses them too.
   `~/mocks/**` is fabricated data that ships to production, and ESLint bans
   importing it from live code — correctly, because a type import is one edit
   away from becoming a value import. The fixture depends on this file, not the
   other way round.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * The engine's node vocabulary.
 *
 * Structurally identical to `NodeKind` in `~/mocks/domain`, and restated rather
 * than shared on purpose: this is the LIVE contract and that one is the
 * fixture's. TypeScript is structural, so the canvas accepts either.
 */
export type NodeKind =
  | "trigger" | "agent" | "llm" | "tool" | "branch" | "parallel"
  | "merge" | "wait" | "approval" | "checkpoint" | "output" | "end";

/** One node on the blueprint canvas. */
export interface BlueprintNode {
  /** Stable across revisions — node identity is what makes a diff meaningful. */
  id: string;
  name: string;
  kind: NodeKind;
  config: Record<string, unknown>;
  /** Why the Architect put this step here. The thing that earns trust. */
  rationale: string;
  /** Rendered in the manifest as a resource the build will create. */
  creates: "agent" | "tool" | "connection" | "gate" | null;
}

export interface BlueprintEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Blueprint {
  name: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

const KNOWN_KINDS: NodeKind[] = [
  "trigger", "agent", "llm", "tool", "branch", "parallel",
  "merge", "wait", "approval", "checkpoint", "output", "end",
];

/**
 * The engine's node types, and the aliases models reach for.
 *
 * Unmapped values fall through to `tool`, which is the right default for one
 * specific reason: an unrecognised step is almost always an action against an
 * external system, and drawing it as a tool keeps it visible and editable
 * rather than dropping it out of the plan the user is being asked to approve.
 */
const KIND_ALIASES: Record<string, NodeKind> = {
  start: "trigger",
  schedule: "trigger",
  cron: "trigger",
  webhook: "trigger",
  http: "tool",
  http_tool: "tool",
  api: "tool",
  action: "tool",
  db_read: "tool",
  db_write: "tool",
  database_read: "tool",
  database_write: "tool",
  transform: "tool",
  iterative_agent: "agent",
  model: "llm",
  generate: "llm",
  condition: "branch",
  decision: "branch",
  if: "branch",
  switch: "branch",
  fan_out: "parallel",
  join: "merge",
  delay: "wait",
  sleep: "wait",
  human_approval: "approval",
  gate: "approval",
  commit: "checkpoint",
  result: "output",
  finish: "end",
};

export function toNodeKind(raw: string | undefined | null): NodeKind {
  const value = (raw ?? "").trim().toLowerCase();
  if ((KNOWN_KINDS as string[]).includes(value)) return value as NodeKind;
  return KIND_ALIASES[value] ?? "tool";
}

/** What a step will cause to be created, for the resource manifest. */
function createsFor(step: PlanStep, kind: NodeKind): BlueprintNode["creates"] {
  if (kind === "approval") return "gate";
  if (kind === "agent" || kind === "llm") return step.agentTempId ? "agent" : null;
  if (kind === "tool") return step.toolTempId ? "tool" : null;
  return null;
}

/**
 * Build the canvas blueprint from a plan.
 *
 * Returns null when the plan has no steps at all — a canvas of nothing is worse
 * than the empty state the caller can render instead.
 */
export function planToBlueprint(plan: ArchitectPlan | null | undefined): Blueprint | null {
  if (!plan) return null;

  const steps = plan.workflowSteps ?? [];
  if (steps.length === 0) return null;

  const toolsByTempId = new Map((plan.tools ?? []).map((t) => [t.tempToolId, t]));
  const agentsByTempId = new Map((plan.agents ?? []).map((a) => [a.tempAgentId, a]));

  const nodes: BlueprintNode[] = steps.map((step, index) => {
    const kind = toNodeKind(step.nodeType);
    const tool = step.toolTempId ? toolsByTempId.get(step.toolTempId) : undefined;
    const agent = step.agentTempId ? agentsByTempId.get(step.agentTempId) : undefined;

    return {
      id: step.tempStepId || `step_${index}`,
      name: step.name || `Step ${index + 1}`,
      kind,
      config: {
        ...(step.config ?? {}),
        ...(tool ? { tool: tool.name, toolType: tool.type } : {}),
        ...(agent ? { agent: agent.name, role: agent.role } : {}),
      },
      // The plan does not always carry a rationale per step, and an empty one
      // renders as a node the user cannot check. Falling back to the tool or
      // agent it binds is at least a true statement about the step.
      rationale:
        step.rationale?.trim() ||
        tool?.description?.trim() ||
        agent?.role?.trim() ||
        `${kindLabel(kind)} step in the generated plan.`,
      creates: createsFor(step, kind),
    };
  });

  const ids = new Set(nodes.map((n) => n.id));
  const declared = (plan.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to));

  // A plan with steps but no usable edges is common enough to handle rather
  // than to render as a row of disconnected boxes: chain them in the order the
  // model listed them, which is the order it intends them to run.
  const edges = declared.length > 0
    ? declared.map((e) => ({ from: e.from, to: e.to, label: e.label }))
    : nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id }));

  return { name: plan.workflowName || "Generated workflow", nodes, edges };
}

function kindLabel(kind: NodeKind): string {
  if (kind === "llm") return "Generation";
  if (kind === "approval") return "Approval";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/* ── Manifest ─────────────────────────────────────────────────────────────── */

export interface ManifestEntry {
  kind: "agent" | "tool" | "connection" | "gate";
  name: string;
  detail: string;
  /**
   * True when the resource already exists in the workspace, so the build binds
   * to it rather than creating it. Only connections can be existing — tools and
   * agents are generated per plan.
   */
  existing: boolean;
  /** Set on connections that still need a person before anything can run. */
  blocking?: boolean;
}

export interface Manifest {
  entries: ManifestEntry[];
  agents: number;
  tools: number;
  connections: number;
  gates: number;
}

/**
 * Exactly what the build will touch, derived from the PLAN rather than guessed.
 *
 * No cost or duration estimate: the plan carries neither, and a number invented
 * here would be indistinguishable from a measurement on the screen that shows
 * it. The one place a figure appears is after a run, where it is real.
 */
export function manifestForPlan(
  plan: ArchitectPlan | null | undefined,
  boundConnections: ReadonlySet<string> = new Set(),
): Manifest {
  const entries: ManifestEntry[] = [];
  if (!plan) return { entries, agents: 0, tools: 0, connections: 0, gates: 0 };

  for (const agent of plan.agents ?? []) {
    entries.push({
      kind: "agent",
      name: agent.name,
      detail: agent.role?.trim() || `${agent.type} agent`,
      existing: false,
    });
  }

  for (const tool of plan.tools ?? []) {
    entries.push({
      kind: "tool",
      name: tool.name,
      detail: [tool.type, tool.requiresApproval ? "requires approval" : null]
        .filter(Boolean)
        .join(" · "),
      existing: false,
    });
  }

  for (const step of plan.workflowSteps ?? []) {
    if (toNodeKind(step.nodeType) !== "approval") continue;
    entries.push({
      kind: "gate",
      name: step.name || "Approval gate",
      detail: "Nothing past this point runs until a person decides",
      existing: false,
    });
  }

  for (const connection of plan.requiredConnections ?? []) {
    const bound = boundConnections.has(connection.tempConnectionId);
    entries.push({
      kind: "connection",
      name: connection.name,
      detail: bound
        ? "Bound to a connection in this workspace"
        : connection.requiredForSimulation
          ? "Needed before this can even be simulated"
          : "Needed before a real run",
      existing: bound,
      blocking: !bound && connection.requiredForSimulation,
    });
  }

  return {
    entries,
    agents: entries.filter((e) => e.kind === "agent").length,
    tools: entries.filter((e) => e.kind === "tool").length,
    connections: entries.filter((e) => e.kind === "connection").length,
    gates: entries.filter((e) => e.kind === "gate").length,
  };
}
