import { describe, expect, it } from "vitest";
import { validateGraph, blockingIssues } from "~/components/app/builder/validation";
import { writeTeamConfig, TEAM_DEFAULTS, type TeamConfig } from "~/lib/workflows/team";
import type { BuilderGraph, BuilderNode } from "~/lib/workflows/builder-graph";
import type { Entitlements } from "~/lib/entitlements/use-entitlements";

/* ══════════════════════════════════════════════════════════════════════════════
   DESIGN-TIME GUARDS.

   Every rule here has a runtime counterpart that stays. What is asserted is that
   the canvas answers the same questions BEFORE the run, in sentences about the
   design rather than about the runtime — and, for cycles, that it refuses the
   save rather than writing a version the engine will accept and then discover
   is unbounded.
══════════════════════════════════════════════════════════════════════════════ */

const teamConfig = (over: Partial<TeamConfig> = {}): TeamConfig => ({
  policy: "supervisor",
  roster: [
    { agentId: "11111111-1111-1111-1111-111111111111", alias: "boss", role: "supervisor", canDelegateTo: ["worker"] },
    { agentId: "22222222-2222-2222-2222-222222222222", alias: "worker", role: "worker", canDelegateTo: [] },
  ],
  entryAlias: "boss",
  joinPolicy: { kind: "wait_all" },
  onChildFailure: "continue",
  limits: { ...TEAM_DEFAULTS },
  budget: { maxTotalTokens: 1000, maxCostCents: 25 },
  objective: "",
  ...over,
});

/** A trigger and one team node, wired. The smallest graph the rules apply to. */
function graphWithTeam(team: TeamConfig): BuilderGraph {
  const nodes: BuilderNode[] = [
    { node: { id: "t", name: "Start", kind: "trigger", config: {} }, x: 0, y: 0 },
    { node: { id: "team", name: "The team", kind: "agent_team", config: writeTeamConfig(team) }, x: 300, y: 0 },
  ];
  return { nodes, edges: [{ id: "e", source: "t", target: "team", kind: "standard" }] };
}

const ids = (graph: BuilderGraph, plan?: Entitlements) =>
  validateGraph(graph.nodes, graph.edges, [], undefined, plan).map((i) => i.id);

/** A resolved plan. `unknown: false` is what makes the plan rules apply at all. */
function planWith(
  features: Record<string, boolean>,
  limits: Record<string, number | null> = {},
): Entitlements {
  return {
    loading: false,
    unknown: false,
    planCode: "free",
    planName: "Free",
    upgradeTo: {
      code: "pro", name: "Pro", description: null, priceCents: 4900, currency: "usd",
      billingInterval: "month", priceModel: "seat", upgradeTo: null,
      upgradeUrl: "/settings/billing", sortOrder: 1, entitlements: [],
    },
    upgradeUrl: "/settings/billing",
    has: (key) => features[key] ?? false,
    limit: (key) => limits[key] ?? null,
    label: (key) => key.replace(/_/g, " "),
    planGranting: () => null,
    raw: [],
    plans: [],
  };
}

const ALLOWED = planWith({ teams: true, delegation: true });

describe("a roster that cannot run is refused at design time", () => {
  it("reports an empty roster", () => {
    expect(ids(graphWithTeam(teamConfig({ roster: [] })))).toContain("team-empty-team");
  });

  it("reports a member with no agent selected", () => {
    const team = teamConfig({
      roster: [
        { agentId: "", alias: "boss", role: "supervisor", canDelegateTo: ["worker"] },
        { agentId: "22222222-2222-2222-2222-222222222222", alias: "worker", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(ids(graphWithTeam(team))).toContain("team-unbound-member-team-0");
  });

  it("reports a member the entry can never reach", () => {
    const team = teamConfig({
      roster: [
        ...teamConfig().roster,
        { agentId: "33333333-3333-3333-3333-333333333333", alias: "orphan", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(ids(graphWithTeam(team))).toContain("team-unreachable-team");
  });

  it("reports two members sharing an alias", () => {
    const team = teamConfig({
      roster: [
        { agentId: "11111111-1111-1111-1111-111111111111", alias: "boss", role: "supervisor", canDelegateTo: [] },
        { agentId: "22222222-2222-2222-2222-222222222222", alias: "boss", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(ids(graphWithTeam(team))).toContain("team-dup-alias-team-boss");
  });

  it("reports a chain deeper than the declared depth limit", () => {
    const team = teamConfig({
      limits: { ...TEAM_DEFAULTS, maxDepth: 1 },
      roster: [
        { agentId: "11111111-1111-1111-1111-111111111111", alias: "boss", role: "supervisor", canDelegateTo: ["mid"] },
        { agentId: "22222222-2222-2222-2222-222222222222", alias: "mid", role: "worker", canDelegateTo: ["leaf"] },
        { agentId: "33333333-3333-3333-3333-333333333333", alias: "leaf", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(ids(graphWithTeam(team))).toContain("team-too-deep-team");
  });

  it("does NOT report depth on a pipeline, where a transfer does not grow it", () => {
    const team = teamConfig({
      policy: "pipeline",
      entryAlias: "one",
      limits: { ...TEAM_DEFAULTS, maxDepth: 1 },
      roster: [
        { agentId: "11111111-1111-1111-1111-111111111111", alias: "one", role: "worker", canDelegateTo: [] },
        { agentId: "22222222-2222-2222-2222-222222222222", alias: "two", role: "worker", canDelegateTo: [] },
        { agentId: "33333333-3333-3333-3333-333333333333", alias: "three", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(ids(graphWithTeam(team))).not.toContain("team-too-deep-team");
  });

  it("warns rather than errors on a blackboard cycle, which is the policy", () => {
    const team = teamConfig({
      policy: "blackboard",
      roster: [
        { agentId: "11111111-1111-1111-1111-111111111111", alias: "one", role: "worker", canDelegateTo: ["two"] },
        { agentId: "22222222-2222-2222-2222-222222222222", alias: "two", role: "worker", canDelegateTo: ["one"] },
      ],
    });
    const issues = validateGraph(graphWithTeam(team).nodes, graphWithTeam(team).edges);
    expect(issues.find((i) => i.id === "team-cycle-team")?.severity).toBe("warning");
  });
});

describe("a cycle is refused at save, and named", () => {
  it("blocks on a delegation loop under a hierarchical policy", () => {
    const team = teamConfig({
      roster: [
        { agentId: "11111111-1111-1111-1111-111111111111", alias: "boss", role: "supervisor", canDelegateTo: ["worker"] },
        { agentId: "22222222-2222-2222-2222-222222222222", alias: "worker", role: "worker", canDelegateTo: ["boss"] },
      ],
    });
    const graph = graphWithTeam(team);
    const blocked = blockingIssues(validateGraph(graph.nodes, graph.edges));
    expect(blocked).toHaveLength(1);
    // The reason names the loop, not the runtime limit that would have caught it.
    expect(blocked[0].title).toContain("boss → worker → boss");
  });

  it("blocks on a cycle drawn between canvas nodes", () => {
    const graph: BuilderGraph = {
      nodes: [
        { node: { id: "t", name: "Start", kind: "trigger", config: {} }, x: 0, y: 0 },
        { node: { id: "a", name: "A", kind: "tool", config: { tool: "x" } }, x: 200, y: 0 },
        { node: { id: "b", name: "B", kind: "tool", config: { tool: "y" } }, x: 400, y: 0 },
      ],
      edges: [
        { id: "e1", source: "t", target: "a", kind: "standard" },
        { id: "e2", source: "a", target: "b", kind: "standard" },
        { id: "e3", source: "b", target: "a", kind: "standard" },
      ],
    };
    const blocked = blockingIssues(validateGraph(graph.nodes, graph.edges));
    expect(blocked.map((i) => i.id)).toEqual(["cycle"]);
  });

  it("does NOT block on an ordinary incomplete graph", () => {
    /* A workflow mid-construction is invalid by definition. Refusing to save it
       is how a builder gets worked around — usually by keeping a second tab open
       with the last version that saved. */
    const graph: BuilderGraph = {
      nodes: [
        { node: { id: "t", name: "Start", kind: "trigger", config: {} }, x: 0, y: 0 },
        { node: { id: "a", name: "A", kind: "tool", config: {} }, x: 200, y: 0 },
      ],
      edges: [{ id: "e1", source: "t", target: "a", kind: "standard" }],
    };
    const issues = validateGraph(graph.nodes, graph.edges);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
    expect(blockingIssues(issues)).toHaveLength(0);
  });
});

describe("plan limits are checked where the author can still act on them", () => {
  it("refuses a team on a plan without the feature, and names the plan", () => {
    const issues = validateGraph(
      graphWithTeam(teamConfig()).nodes,
      graphWithTeam(teamConfig()).edges,
      [], undefined,
      planWith({ teams: false, delegation: false }),
    );
    const refusal = issues.find((i) => i.id === "team-plan-teams-team");
    expect(refusal?.severity).toBe("error");
    expect(refusal?.title).toContain("Free");
    expect(refusal?.fix).toContain("Pro");
  });

  it("accepts a roster of EXACTLY the plan's maximum", () => {
    /* `>` and not `>=`. This off-by-one either locks a customer out one short of
       what they bought, or quietly sells them one extra — and it is written the
       same way in `GraphPlanCheck` so the two cannot disagree about which. */
    const plan = planWith({ teams: true, delegation: true }, { max_team_size: 2 });
    expect(ids(graphWithTeam(teamConfig()), plan)).not.toContain("team-plan-size-team");
  });

  it("refuses one member past the plan's maximum", () => {
    const plan = planWith({ teams: true, delegation: true }, { max_team_size: 1 });
    expect(ids(graphWithTeam(teamConfig()), plan)).toContain("team-plan-size-team");
  });

  it("treats delegation as a feature before it is a depth", () => {
    const plan = planWith({ teams: true, delegation: false });
    expect(ids(graphWithTeam(teamConfig()), plan)).toContain("team-plan-delegation-team");
  });

  it("says nothing about the plan while the answer is still unknown", () => {
    // Unresolved is permissive: gating on an answer we do not have condemns a
    // correctly-sized roster while the request is still in flight.
    expect(ids(graphWithTeam(teamConfig()))).not.toContain("team-plan-teams-team");
  });
});

describe("policy coherence", () => {
  it("warns that a pipeline ignores delegation grants", () => {
    const team = teamConfig({
      policy: "pipeline",
      entryAlias: "one",
      roster: [
        { agentId: "11111111-1111-1111-1111-111111111111", alias: "one", role: "worker", canDelegateTo: ["two"] },
        { agentId: "22222222-2222-2222-2222-222222222222", alias: "two", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(ids(graphWithTeam(team), ALLOWED)).toContain("team-pipeline-grants-team");
  });

  it("warns when a team has no cost ceiling at all", () => {
    const team = teamConfig({ budget: { maxTotalTokens: 0, maxCostCents: 0 } });
    expect(ids(graphWithTeam(team), ALLOWED)).toContain("team-no-budget-team");
  });

  it("refuses a review team with nobody to review", () => {
    const team = teamConfig({
      policy: "review",
      entryAlias: "solo",
      roster: [{ agentId: "11111111-1111-1111-1111-111111111111", alias: "solo", role: "worker", canDelegateTo: [] }],
    });
    expect(ids(graphWithTeam(team), ALLOWED)).toContain("team-review-solo-team");
  });
});
