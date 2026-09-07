import type { NodeConfig } from "./builder-graph";

/* ══════════════════════════════════════════════════════════════════════════════
   THE agent_team NODE'S CONFIGURATION — the canvas half of it.

   ── THIS FILE MIRRORS A KOTLIN PARSER, DELIBERATELY ─────────────────────────
   `worker-kotlin`'s `agents/orchestration/TeamConfig.kt` is what actually reads
   this config at run time. Everything here — the key names, the alias→id
   resolution, the entry-agent fallback chain, the coercion ranges — is written
   to produce exactly what that parser expects and to READ a config the same way
   it does.

   The alternative was to let the inspector write whatever shape felt natural and
   discover the mismatch on the first run. That failure is uniquely bad here: the
   parser degrades rather than throwing (every field has a default), so a config
   the canvas got subtly wrong does not fail — it RUNS, as a different team than
   the one on the screen. A roster whose `canDelegateTo` used ids where the
   parser wanted aliases would silently resolve to an empty grant set, and an
   empty grant set is a team where nobody may delegate to anybody. That team
   completes. It just never delegates.

   So the rule for this file: when in doubt, do what TeamConfig.kt does.

   ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
   Enforcement. Every check in `validateTeam` is a design-time convenience; the
   runtime keeps its own ceilings (`TeamLimits`, `AgentSafetyGuard`) and the API
   keeps `GraphPlanCheck`. A graph can be saved under one plan and run under
   another, so nothing here is allowed to be the only thing standing between a
   roster and the runtime.
══════════════════════════════════════════════════════════════════════════════ */

/** The five §6 policies. Wire values, matching `OrchestrationPolicy.wire`. */
export type TeamPolicy = "supervisor" | "router" | "pipeline" | "review" | "blackboard";

export const TEAM_POLICIES: TeamPolicy[] = [
  "supervisor", "router", "pipeline", "review", "blackboard",
];

export interface PolicyDescriptor {
  policy: TeamPolicy;
  label: string;
  /** One sentence. What shape of work this is. */
  summary: string;
  /** How the team ends, in the builder's words rather than the enum's. */
  terminates: string;
  /**
   * Whether the MODEL picks the next member, or the runtime does.
   *
   * The single most load-bearing fact about a policy, and the one that decides
   * whether `canDelegateTo` means anything: in a pipeline the roster order is
   * the routing, so a grant list there is decoration.
   */
  routing: "model" | "runtime";
  /** The role the entry member conventionally has. Mirrors `leadRole`. */
  leadRole: string;
}

export const POLICY_INFO: Record<TeamPolicy, PolicyDescriptor> = {
  supervisor: {
    policy: "supervisor",
    label: "Supervisor and workers",
    summary: "One member owns the task and hands pieces of it to the others.",
    terminates: "When the supervisor returns a final answer.",
    routing: "model",
    leadRole: "supervisor",
  },
  router: {
    policy: "router",
    label: "Router and specialists",
    summary: "One member reads the request and hands it to exactly one specialist.",
    terminates: "When the specialist it transferred to returns a final answer.",
    routing: "model",
    leadRole: "router",
  },
  pipeline: {
    policy: "pipeline",
    label: "Pipeline",
    summary: "An ordered list. Each member's output is the next member's input.",
    terminates: "When the last stage returns.",
    routing: "runtime",
    leadRole: "worker",
  },
  review: {
    policy: "review",
    label: "Draft and review",
    summary: "One member drafts, another reviews, for a bounded number of rounds.",
    terminates: "When the reviewer approves, or the rounds run out.",
    routing: "model",
    leadRole: "worker",
  },
  blackboard: {
    policy: "blackboard",
    label: "Peers on a blackboard",
    summary: "Members with no hierarchy, sharing one working context.",
    terminates: "When a peer returns a final answer, or the join quorum is met.",
    routing: "model",
    leadRole: "worker",
  },
};

/** Handoff kinds each policy permits. Mirrors `OrchestrationPolicy.permittedKinds`. */
export const PERMITTED_KINDS: Record<TeamPolicy, string[]> = {
  supervisor: ["delegate", "broadcast", "escalate"],
  router: ["transfer"],
  pipeline: ["transfer"],
  review: ["delegate"],
  blackboard: ["broadcast", "delegate"],
};

/** Join policies, as `JoinPolicy.parse` accepts them. */
export type JoinPolicy =
  | { kind: "wait_all" }
  | { kind: "wait_any" }
  | { kind: "quorum"; k: number };

export type OnChildFailure = "continue" | "fail_parent";

export interface TeamMember {
  /**
   * The agent's id, or "" when the row exists but nothing is chosen yet.
   *
   * Empty rather than absent because a half-filled roster row is the normal
   * state of a roster being built, and dropping it on every keystroke would
   * make the editor delete the row you are filling in.
   */
  agentId: string;
  /** The builder's local name for this member — what the arrows are drawn between. */
  alias: string;
  /** Free text; `supervisor`, `router` and `worker` are the ones policies read. */
  role: string;
  /** Aliases of the peers this member may hand work to. */
  canDelegateTo: string[];
}

export interface TeamLimits {
  maxDepth: number;
  maxActivations: number;
  maxHandoffsPerPair: number;
  maxTeamDurationMs: number;
  maxContextChars: number | null;
  /** Only meaningful for `review`. Resolves onto `maxHandoffsPerPair`. */
  maxRounds: number;
  /** Per-member iteration ceiling. Lives under `limits` in the wire shape. */
  maxIterations: number;
  maxToolCalls: number;
}

export interface TeamBudget {
  maxTotalTokens: number;
  maxCostCents: number;
}

export interface TeamConfig {
  policy: TeamPolicy;
  roster: TeamMember[];
  /** The alias of the entry member, or "" to let the policy's lead role decide. */
  entryAlias: string;
  joinPolicy: JoinPolicy;
  onChildFailure: OnChildFailure;
  limits: TeamLimits;
  budget: TeamBudget;
  /** The team's own instruction, handed to the entry member as its objective. */
  objective: string;
}

/* ── Runtime defaults ──────────────────────────────────────────────────────────
   Mirrors `TeamLimits.Companion`. These are the values an operator can tighten
   with env vars, so the canvas shows them as the DEFAULT and not as a promise:
   a node that declares nothing runs under whatever the fleet is configured for,
   which may be lower. Declaring a limit explicitly is what makes it yours. */
export const TEAM_DEFAULTS: TeamLimits = {
  maxDepth: 3,
  maxActivations: 12,
  maxHandoffsPerPair: 2,
  maxTeamDurationMs: 600_000,
  maxContextChars: null,
  maxRounds: 4,
  maxIterations: 0,
  maxToolCalls: 0,
};

export const TEAM_BUDGET_DEFAULTS: TeamBudget = { maxTotalTokens: 0, maxCostCents: 0 };

/* ── Reading a stored config ──────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asInt(value: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  let out = Math.round(n);
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

/** `"quorum(2)"`, `{quorum: 2}`, `"wait_any"` — every form the parser accepts. */
export function parseJoinPolicy(raw: unknown): JoinPolicy {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const k = (raw as Record<string, unknown>).quorum;
    if (typeof k === "number" && Number.isFinite(k)) {
      return { kind: "quorum", k: Math.max(1, Math.round(k)) };
    }
  }
  const s = asString(raw).trim().toLowerCase();
  const quorum = /^quorum\s*\(\s*(\d+)\s*\)$/.exec(s);
  if (quorum) return { kind: "quorum", k: Math.max(1, Number(quorum[1])) };
  if (s === "wait_any" || s === "any" || s === "first") return { kind: "wait_any" };
  return { kind: "wait_all" };
}

export function joinPolicyWire(join: JoinPolicy): string {
  return join.kind === "quorum" ? `quorum(${join.k})` : join.kind;
}

export function joinPolicyLabel(join: JoinPolicy): string {
  switch (join.kind) {
    case "wait_any": return "First success wins";
    case "quorum": return `${join.k} must succeed`;
    default: return "All must succeed";
  }
}

/**
 * The team config on a node, filled in with the runtime's own defaults.
 *
 * Total: a node with no config at all yields an empty roster and a supervisor
 * policy, which is what a freshly dropped team node is. Nothing here throws,
 * because this runs on every render of a graph the user is mid-way through
 * typing into.
 */
export function readTeamConfig(config: NodeConfig | undefined): TeamConfig {
  const c = asRecord(config);
  const rawRoster = Array.isArray(c.roster) ? c.roster : [];
  const limits = asRecord(c.limits);
  const budget = asRecord(c.budget);

  const roster: TeamMember[] = rawRoster.map((raw, i) => {
    const m = asRecord(raw);
    return {
      agentId: asString(m.agentId),
      alias: asString(m.alias) || `member${i + 1}`,
      role: asString(m.role) || "worker",
      canDelegateTo: (Array.isArray(m.canDelegateTo) ? m.canDelegateTo : [])
        .map((v) => asString(v))
        .filter((v) => v !== ""),
    };
  });

  const policyRaw = asString(c.policy).trim().toLowerCase();
  const policy = (TEAM_POLICIES as string[]).includes(policyRaw)
    ? (policyRaw as TeamPolicy)
    : "supervisor";

  return {
    policy,
    roster,
    entryAlias: asString(c.entryAgentId),
    joinPolicy: parseJoinPolicy(c.joinPolicy),
    onChildFailure: asString(c.onChildFailure) === "fail_parent" ? "fail_parent" : "continue",
    objective: asString(c.objective),
    limits: {
      maxDepth: asInt(limits.maxDepth, TEAM_DEFAULTS.maxDepth, 1, 10),
      maxActivations: asInt(limits.maxActivations, TEAM_DEFAULTS.maxActivations, 1, 200),
      maxHandoffsPerPair: asInt(limits.maxHandoffsPerPair, TEAM_DEFAULTS.maxHandoffsPerPair, 1, 50),
      maxTeamDurationMs: asInt(limits.maxTeamDurationMs, TEAM_DEFAULTS.maxTeamDurationMs, 1_000),
      maxContextChars: limits.maxContextChars === undefined || limits.maxContextChars === null
        ? null
        : asInt(limits.maxContextChars, 1_000, 1_000),
      maxRounds: asInt(limits.maxRounds, TEAM_DEFAULTS.maxRounds, 1, 20),
      maxIterations: asInt(limits.maxIterations, TEAM_DEFAULTS.maxIterations, 0),
      maxToolCalls: asInt(limits.maxToolCalls, TEAM_DEFAULTS.maxToolCalls, 0),
    },
    budget: {
      maxTotalTokens: asInt(budget.maxTotalTokens, TEAM_BUDGET_DEFAULTS.maxTotalTokens, 0),
      maxCostCents: asInt(budget.maxCostCents, TEAM_BUDGET_DEFAULTS.maxCostCents, 0),
    },
  };
}

/**
 * Write a team config back onto a node, in the shape `TeamConfig.parse` reads.
 *
 * ── WHY THE KEYS ARE SPREAD ACROSS THREE PLACES ─────────────────────────────
 * `maxIterations` and `maxToolCalls` live under `limits` but are read into the
 * BUDGET vector; `maxTotalTokens` and `maxCostCents` live under `budget`. That
 * split is not a design, it is where the Kotlin parser looks, and matching it
 * exactly is the entire job of this function. Moving `maxIterations` under
 * `budget` because it reads better would produce a team with an iteration
 * budget of zero, which means unbounded.
 *
 * Zero-valued budget entries are still written. In `BudgetVector` a zero
 * dimension means "no ceiling on this one", so omitting it and writing it as
 * zero are the same thing to the runtime — but only one of them survives a
 * round trip through the inspector without the field appearing to reset.
 */
export function writeTeamConfig(team: TeamConfig): NodeConfig {
  return {
    policy: team.policy,
    entryAgentId: team.entryAlias,
    objective: team.objective,
    joinPolicy: joinPolicyWire(team.joinPolicy),
    onChildFailure: team.onChildFailure,
    roster: team.roster.map((m) => ({
      agentId: m.agentId,
      alias: m.alias,
      role: m.role,
      canDelegateTo: m.canDelegateTo,
    })),
    limits: {
      maxDepth: team.limits.maxDepth,
      maxActivations: team.limits.maxActivations,
      maxHandoffsPerPair: team.limits.maxHandoffsPerPair,
      maxTeamDurationMs: team.limits.maxTeamDurationMs,
      ...(team.limits.maxContextChars === null ? {} : { maxContextChars: team.limits.maxContextChars }),
      maxRounds: team.limits.maxRounds,
      maxIterations: team.limits.maxIterations,
      maxToolCalls: team.limits.maxToolCalls,
    },
    budget: {
      maxTotalTokens: team.budget.maxTotalTokens,
      maxCostCents: team.budget.maxCostCents,
    },
  };
}

/* ── The delegation graph ─────────────────────────────────────────────────── */

/**
 * The entry member, resolved the way the runtime resolves it.
 *
 * Named explicitly → the member whose role is the policy's lead → the first.
 * Reproduced rather than simplified because "which member starts" is the thing
 * every reachability answer on this page depends on, and a canvas that guessed
 * differently from the runtime would draw a correct-looking team that runs
 * from the wrong place.
 */
export function entryMember(team: TeamConfig): TeamMember | null {
  if (team.roster.length === 0) return null;
  const named = team.roster.find((m) => m.alias === team.entryAlias || m.agentId === team.entryAlias);
  if (named) return named;
  const lead = POLICY_INFO[team.policy].leadRole;
  return team.roster.find((m) => m.role.toLowerCase() === lead) ?? team.roster[0];
}

/**
 * The delegation edges, as alias pairs.
 *
 * For a PIPELINE the edges are the roster ORDER, not the grant lists: the
 * runtime walks `roster.drop(1)` in sequence and never consults a grant, so
 * drawing the grants there would draw arrows the run does not follow. Every
 * other policy has a model choosing, and the grants are exactly the choices it
 * is allowed to make.
 */
export function delegationEdges(team: TeamConfig): { from: string; to: string }[] {
  if (team.policy === "pipeline") {
    const entry = entryMember(team);
    if (!entry) return [];
    const ordered = [entry, ...team.roster.filter((m) => m.alias !== entry.alias)];
    return ordered.slice(0, -1).map((m, i) => ({ from: m.alias, to: ordered[i + 1].alias }));
  }

  const aliases = new Set(team.roster.map((m) => m.alias));
  const out: { from: string; to: string }[] = [];
  for (const m of team.roster) {
    for (const target of m.canDelegateTo) {
      // A grant naming nobody is dropped by the runtime's `resolve`, so it is
      // dropped here too rather than drawn as an arrow into empty space.
      if (target !== m.alias && aliases.has(target)) out.push({ from: m.alias, to: target });
    }
  }
  return out;
}

/** Aliases reachable from the entry by following delegation edges. */
export function reachableAliases(team: TeamConfig): Set<string> {
  const entry = entryMember(team);
  if (!entry) return new Set();
  const adjacency = new Map<string, string[]>();
  for (const e of delegationEdges(team)) {
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
  }
  const seen = new Set([entry.alias]);
  const queue = [entry.alias];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

/**
 * The first delegation cycle, as the aliases around it. Null when acyclic.
 *
 * Same colour-marked DFS the canvas uses on the graph itself — a back-edge to a
 * node on the current path is a cycle; an edge to a finished node is a peer
 * that two members happen to share, which is legal in every policy.
 */
export function findDelegationCycle(team: TeamConfig): string[] | null {
  const edges = delegationEdges(team);
  const adjacency = new Map<string, string[]>();
  for (const e of edges) adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);

  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map(team.roster.map((m) => [m.alias, WHITE]));
  const stack: string[] = [];

  function visit(alias: string): string[] | null {
    colour.set(alias, GREY);
    stack.push(alias);
    for (const next of adjacency.get(alias) ?? []) {
      if (colour.get(next) === GREY) return stack.slice(stack.indexOf(next));
      if (colour.get(next) === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    colour.set(alias, BLACK);
    return null;
  }

  for (const m of team.roster) {
    if (colour.get(m.alias) === WHITE) {
      const found = visit(m.alias);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The longest delegation chain from the entry, in hops.
 *
 * The number the depth limit is compared against. Only meaningful on an acyclic
 * graph — on a cyclic one it is unbounded, which is why every caller checks for
 * a cycle first and this returns the roster size as a ceiling rather than
 * looping forever if one slips through.
 */
export function longestChain(team: TeamConfig): { hops: number; path: string[] } {
  const entry = entryMember(team);
  if (!entry) return { hops: 0, path: [] };
  const adjacency = new Map<string, string[]>();
  for (const e of delegationEdges(team)) {
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
  }

  let best: string[] = [entry.alias];
  const limit = team.roster.length;

  const walk = (alias: string, path: string[]) => {
    if (path.length > best.length) best = path;
    if (path.length > limit) return;
    for (const next of adjacency.get(alias) ?? []) {
      if (path.includes(next)) continue;
      walk(next, [...path, next]);
    }
  };
  walk(entry.alias, [entry.alias]);

  return { hops: best.length - 1, path: best };
}

/**
 * A TRANSFER does not grow the depth, so a pipeline and a router are flat.
 *
 * Straight from `OrchestrationLoop.runPipeline`: "a transfer, not a delegation,
 * because a stage does not wait for the next one … which is also why the depth
 * guard does not grow down a pipeline". A five-stage pipeline is depth 0, and
 * telling somebody their five-stage pipeline breaches a depth limit of 3 would
 * be a confidently wrong refusal of a graph that runs perfectly.
 */
export function depthCounts(policy: TeamPolicy): boolean {
  return policy !== "pipeline" && policy !== "router";
}
