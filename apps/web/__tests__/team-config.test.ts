import { describe, expect, it } from "vitest";
import {
  readTeamConfig, writeTeamConfig, entryMember, delegationEdges,
  reachableAliases, findDelegationCycle, longestChain, depthCounts,
  parseJoinPolicy, joinPolicyWire, TEAM_DEFAULTS,
  type TeamConfig,
} from "~/lib/workflows/team";

/* ══════════════════════════════════════════════════════════════════════════════
   THE CANVAS AND THE RUNTIME MUST AGREE ABOUT A ROSTER.

   `worker-kotlin`'s `TeamConfig.parse` DEGRADES rather than throwing — every
   field has a default and an unresolvable grant is dropped. That is correct for
   a runtime reading untrusted config, and it is exactly what makes a canvas bug
   here invisible: a config the builder got subtly wrong does not fail, it RUNS,
   as a different team than the one on the screen.

   These tests pin the places where "subtly wrong" is possible.
══════════════════════════════════════════════════════════════════════════════ */

const team = (over: Partial<TeamConfig> = {}): TeamConfig => ({
  policy: "supervisor",
  roster: [
    { agentId: "a1", alias: "boss", role: "supervisor", canDelegateTo: ["worker"] },
    { agentId: "a2", alias: "worker", role: "worker", canDelegateTo: [] },
  ],
  entryAlias: "",
  joinPolicy: { kind: "wait_all" },
  onChildFailure: "continue",
  limits: { ...TEAM_DEFAULTS },
  budget: { maxTotalTokens: 0, maxCostCents: 0 },
  objective: "",
  ...over,
});

describe("the wire shape matches the runtime parser", () => {
  it("round-trips without losing a field", () => {
    const original = team({
      policy: "review",
      entryAlias: "boss",
      objective: "ship it",
      joinPolicy: { kind: "quorum", k: 2 },
      onChildFailure: "fail_parent",
      limits: { ...TEAM_DEFAULTS, maxDepth: 5, maxRounds: 7, maxIterations: 3, maxToolCalls: 9 },
      budget: { maxTotalTokens: 1234, maxCostCents: 56 },
    });
    expect(readTeamConfig(writeTeamConfig(original))).toEqual(original);
  });

  it("puts maxIterations and maxToolCalls under limits, where BudgetVector reads them", () => {
    /* This is the split that is easy to 'tidy'. `TeamConfig.parse` builds its
       BudgetVector from `limitsCfg["maxIterations"]` and `limitsCfg["maxToolCalls"]`
       but `budgetCfg["maxTotalTokens"]` and `budgetCfg["maxCostCents"]`. Moving
       the first two under `budget` because it reads better produces a team with
       an iteration budget of zero, and zero means UNBOUNDED. */
    const wire = writeTeamConfig(team({
      limits: { ...TEAM_DEFAULTS, maxIterations: 6, maxToolCalls: 4 },
      budget: { maxTotalTokens: 100, maxCostCents: 20 },
    })) as Record<string, Record<string, unknown>>;

    expect(wire.limits.maxIterations).toBe(6);
    expect(wire.limits.maxToolCalls).toBe(4);
    expect(wire.budget.maxTotalTokens).toBe(100);
    expect(wire.budget.maxCostCents).toBe(20);
    expect(wire.budget.maxIterations).toBeUndefined();
  });

  it("names members by alias in canDelegateTo, because that is what resolve() looks up first", () => {
    const wire = writeTeamConfig(team()) as { roster: { canDelegateTo: string[] }[] };
    expect(wire.roster[0].canDelegateTo).toEqual(["worker"]);
  });

  it("reads every join-policy spelling the runtime accepts", () => {
    expect(parseJoinPolicy("wait_any")).toEqual({ kind: "wait_any" });
    expect(parseJoinPolicy("first")).toEqual({ kind: "wait_any" });
    expect(parseJoinPolicy("quorum(3)")).toEqual({ kind: "quorum", k: 3 });
    expect(parseJoinPolicy({ quorum: 2 })).toEqual({ kind: "quorum", k: 2 });
    // Anything unrecognised is wait_all — the only total one, and the parser's
    // own fallback.
    expect(parseJoinPolicy("nonsense")).toEqual({ kind: "wait_all" });
    expect(joinPolicyWire({ kind: "quorum", k: 4 })).toBe("quorum(4)");
  });

  it("degrades an unparseable config the way the runtime does, rather than throwing", () => {
    const parsed = readTeamConfig({ policy: 42, roster: "not a list", limits: null });
    expect(parsed.policy).toBe("supervisor");
    expect(parsed.roster).toEqual([]);
    expect(parsed.limits.maxDepth).toBe(TEAM_DEFAULTS.maxDepth);
  });
});

describe("the entry member is resolved the way the runtime resolves it", () => {
  it("prefers the named entry", () => {
    expect(entryMember(team({ entryAlias: "worker" }))?.alias).toBe("worker");
  });

  it("falls back to the member whose role leads the policy", () => {
    const shuffled = team({
      roster: [
        { agentId: "a2", alias: "worker", role: "worker", canDelegateTo: [] },
        { agentId: "a1", alias: "boss", role: "supervisor", canDelegateTo: ["worker"] },
      ],
    });
    // NOT the first member: a supervisor policy starts at the supervisor, and a
    // canvas that guessed 'first' would draw a correct-looking team that runs
    // from the wrong place.
    expect(entryMember(shuffled)?.alias).toBe("boss");
  });

  it("falls back to the first member when no role matches", () => {
    const noLead = team({
      roster: [
        { agentId: "a1", alias: "one", role: "worker", canDelegateTo: [] },
        { agentId: "a2", alias: "two", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(entryMember(noLead)?.alias).toBe("one");
  });
});

describe("the delegation graph", () => {
  it("drops a grant naming nobody, exactly as resolve() drops it", () => {
    const ghosts = team({
      roster: [
        { agentId: "a1", alias: "boss", role: "supervisor", canDelegateTo: ["worker", "nobody"] },
        { agentId: "a2", alias: "worker", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(delegationEdges(ghosts)).toEqual([{ from: "boss", to: "worker" }]);
  });

  it("drops self-delegation, which is a one-node loop", () => {
    const selfish = team({
      roster: [{ agentId: "a1", alias: "solo", role: "worker", canDelegateTo: ["solo"] }],
    });
    expect(delegationEdges(selfish)).toEqual([]);
  });

  it("uses roster ORDER for a pipeline, because the runtime never reads a grant there", () => {
    /* `OrchestrationLoop.runPipeline` walks `roster.drop(1)` and transfers to
       each in turn. Drawing the grants for a pipeline would draw arrows the run
       does not follow. */
    const pipeline = team({
      policy: "pipeline",
      entryAlias: "one",
      roster: [
        { agentId: "a1", alias: "one", role: "worker", canDelegateTo: [] },
        { agentId: "a2", alias: "two", role: "worker", canDelegateTo: [] },
        { agentId: "a3", alias: "three", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(delegationEdges(pipeline)).toEqual([
      { from: "one", to: "two" },
      { from: "two", to: "three" },
    ]);
    expect(reachableAliases(pipeline).size).toBe(3);
  });

  it("finds a member nothing reaches", () => {
    const stranded = team({
      roster: [
        { agentId: "a1", alias: "boss", role: "supervisor", canDelegateTo: ["worker"] },
        { agentId: "a2", alias: "worker", role: "worker", canDelegateTo: [] },
        { agentId: "a3", alias: "orphan", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(reachableAliases(stranded).has("orphan")).toBe(false);
  });

  it("finds a cycle and names the members in it", () => {
    const looped = team({
      roster: [
        { agentId: "a1", alias: "boss", role: "supervisor", canDelegateTo: ["worker"] },
        { agentId: "a2", alias: "worker", role: "worker", canDelegateTo: ["boss"] },
      ],
    });
    expect(findDelegationCycle(looped)).toEqual(["boss", "worker"]);
  });

  it("does not call a shared peer a cycle", () => {
    // Two members both delegating to a third is a cross-edge, not a back-edge.
    const shared = team({
      roster: [
        { agentId: "a1", alias: "boss", role: "supervisor", canDelegateTo: ["one", "two"] },
        { agentId: "a2", alias: "one", role: "worker", canDelegateTo: ["shared"] },
        { agentId: "a3", alias: "two", role: "worker", canDelegateTo: ["shared"] },
        { agentId: "a4", alias: "shared", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(findDelegationCycle(shared)).toBeNull();
  });

  it("measures the longest chain from the entry", () => {
    const deep = team({
      roster: [
        { agentId: "a1", alias: "boss", role: "supervisor", canDelegateTo: ["mid"] },
        { agentId: "a2", alias: "mid", role: "worker", canDelegateTo: ["leaf"] },
        { agentId: "a3", alias: "leaf", role: "worker", canDelegateTo: [] },
      ],
    });
    expect(longestChain(deep)).toEqual({ hops: 2, path: ["boss", "mid", "leaf"] });
  });

  it("terminates on a cyclic roster rather than recursing forever", () => {
    const looped = team({
      roster: [
        { agentId: "a1", alias: "boss", role: "supervisor", canDelegateTo: ["worker"] },
        { agentId: "a2", alias: "worker", role: "worker", canDelegateTo: ["boss"] },
      ],
    });
    expect(longestChain(looped).hops).toBeLessThanOrEqual(2);
  });
});

describe("depth only counts where a handoff is a delegation", () => {
  it("is flat for the two policies that transfer", () => {
    /* Straight from `OrchestrationLoop.runPipeline`: a transfer is a tail call
       and the depth guard does not grow down one. Telling somebody their
       five-stage pipeline breaches a depth limit of 3 would be a confidently
       wrong refusal of a graph that runs perfectly. */
    expect(depthCounts("pipeline")).toBe(false);
    expect(depthCounts("router")).toBe(false);
    expect(depthCounts("supervisor")).toBe(true);
    expect(depthCounts("review")).toBe(true);
    expect(depthCounts("blackboard")).toBe(true);
  });
});
