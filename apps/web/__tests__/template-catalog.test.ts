import { describe, expect, it } from "vitest";
import { TEMPLATES, type WorkflowTemplate } from "~/lib/workflows/templates/catalog";
import { validateGraph, blockingIssues } from "~/components/app/builder/validation";
import { toStoredGraph, fromStoredGraph, triggerConfigFrom } from "~/lib/workflows/graph-codec";
import { readTeamConfig, findDelegationCycle, reachableAliases } from "~/lib/workflows/team";

/* ══════════════════════════════════════════════════════════════════════════════
   "EVERY TEMPLATE RUNS END TO END AFTER ONE CONNECTION, FROM A CLEAN WORKSPACE."

   That acceptance criterion cannot be fully proved without a live stack. What
   CAN be proved is every property whose absence makes it false — and each of the
   failures below is one that installs cleanly and then fails on the first run,
   which is the worst possible experience for a starter template because it
   teaches somebody that the product is broken in their first minute.

     · An agent node with no `agentId` — `AgentNodeExecutor` fails the node
       outright, having resolved it as a UUID and found nothing.
     · A tool node whose type the WORKER does not dispatch. The API accepts
       `builtin`, `code`, `custom` and `llm_generate`; `ToolNodeExecutor` has no
       branch for any of them and ends at "not yet supported by the worker".
     · A required tool that needs its own connection, which would silently make
       the promise "runnable after TWO connections".
     · A cycle, or a roster nobody can reach.
     · No cost ceiling, on a template handed to somebody who has not yet learned
       where the ceilings are.
══════════════════════════════════════════════════════════════════════════════ */

/** Built as the installer builds it, with plausible ids for everything created. */
function built(template: WorkflowTemplate) {
  const agents = Object.fromEntries(
    template.agents.map((a, i) => [a.ref, `0000000${i}-0000-4000-8000-000000000000`]),
  );
  const tools = Object.fromEntries(
    template.optionalTools.map((t, i) => [t.ref, `1000000${i}-0000-4000-8000-000000000000`]),
  );
  return template.build({
    agents,
    tools,
    llmConnectionId: "20000000-0000-4000-8000-000000000000",
    notifyEmail: "ops@example.com",
  });
}

/** Built the way a run with NO optional tools would be — the one-connection case. */
function builtMinimal(template: WorkflowTemplate) {
  const agents = Object.fromEntries(
    template.agents.map((a, i) => [a.ref, `0000000${i}-0000-4000-8000-000000000000`]),
  );
  return template.build({
    agents, tools: {},
    llmConnectionId: "20000000-0000-4000-8000-000000000000",
    notifyEmail: "ops@example.com",
  });
}

/** Tool types `ToolNodeExecutor` actually dispatches. Anything else fails at run. */
const WORKER_TOOL_TYPES = new Set([
  "http", "http_api", "rest_api", "api", "rest",
  "database", "database_read", "database_write",
  "mcp", "mcp_server", "builtin_email", "slack", "email", "crm",
]);

describe("the catalogue covers the patterns it claims to", () => {
  it("has one template per orchestration pattern", () => {
    expect([...new Set(TEMPLATES.map((t) => t.pattern))].sort()).toEqual([
      "approval", "batch", "review", "router", "single-agent", "supervisor",
    ]);
  });

  it("gives every template a unique id", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });
});

describe.each(TEMPLATES.map((t) => [t.id, t] as const))("%s", (_id, template) => {
  it("needs exactly one connection, and it is a model connection", () => {
    expect(template.requiresConnection).toBe("llm");
    // Anything that would need a second connection is OPTIONAL and carries a
    // sentence saying what the template does without it.
    for (const tool of template.optionalTools) {
      expect(tool.withoutIt.length).toBeGreaterThan(20);
    }
  });

  it("binds every agent node to a real agent id", () => {
    const graph = builtMinimal(template);
    for (const { node } of graph.nodes) {
      if (node.kind !== "agent") continue;
      expect(typeof node.config.agentId, `${node.name} has no agentId`).toBe("string");
      expect(String(node.config.agentId).length).toBeGreaterThan(0);
    }
  });

  it("uses only tool types the worker dispatches", () => {
    const graph = built(template);
    for (const { node } of graph.nodes) {
      if (node.kind !== "tool") continue;
      const type = String(node.config.toolType ?? "");
      // Either a built-in the worker handles without a tool row, or a bound
      // registry tool — never a type that installs and then cannot execute.
      if (type) {
        expect(WORKER_TOOL_TYPES.has(type), `${node.name} uses toolType "${type}"`).toBe(true);
      } else {
        expect(typeof node.config.toolId, `${node.name} binds no tool`).toBe("string");
      }
    }
  });

  it("still builds a complete graph with no optional tools installed", () => {
    // The one-connection case. A template that only works with its optionals is
    // a template whose promise is wrong.
    const graph = builtMinimal(template);
    expect(graph.nodes.length).toBeGreaterThan(2);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it("has exactly one trigger and reaches every node from it", () => {
    const graph = builtMinimal(template);
    const triggers = graph.nodes.filter((n) => n.node.kind === "trigger");
    expect(triggers).toHaveLength(1);

    const issues = validateGraph(graph.nodes, graph.edges);
    const unreachable = issues.filter((i) => i.id.startsWith("unreachable-"));
    expect(unreachable.map((i) => i.title)).toEqual([]);
  });

  it("is free of anything that would refuse its own save", () => {
    const graph = builtMinimal(template);
    expect(blockingIssues(validateGraph(graph.nodes, graph.edges))).toEqual([]);
  });

  it("commits a checkpoint, so a failure resumes rather than restarts", () => {
    const graph = builtMinimal(template);
    expect(graph.nodes.some((n) => n.node.kind === "checkpoint")).toBe(true);
  });

  it("declares a cost ceiling", () => {
    /* A zero budget means NO ceiling in `BudgetVector`, and a starter template
       that can spend without bound is the one thing a starter template must
       never be. */
    const graph = builtMinimal(template);
    const spenders = graph.nodes.filter((n) => n.node.kind === "agent" || n.node.kind === "agent_team");
    expect(spenders.length).toBeGreaterThan(0);
    for (const { node } of spenders) {
      const budget = node.kind === "agent_team"
        ? readTeamConfig(node.config).budget
        : (node.config.budget as { maxCostCents?: number; maxTotalTokens?: number } | undefined) ?? {};
      expect(
        (budget.maxCostCents ?? 0) > 0 || (budget.maxTotalTokens ?? 0) > 0,
        `${node.name} has no ceiling`,
      ).toBe(true);
    }
  });

  it("survives the round trip through storage without losing its config", () => {
    /* The graph is written by `toStoredGraph` and read back by
       `fromStoredGraph` on the next builder open. A node kind the codec does not
       know falls through to `tool`, and the NEXT save then writes it as one —
       an unrecognised team is a destroyed team, not a mislabelled one. */
    const graph = builtMinimal(template);
    const decoded = fromStoredGraph(toStoredGraph(graph));
    expect(decoded.nodes.map((n) => n.node.kind)).toEqual(graph.nodes.map((n) => n.node.kind));
    expect(decoded.edges).toHaveLength(graph.edges.length);
  });

  it("lifts a cron onto the version's trigger config, or declares itself manual", () => {
    // `WorkflowRoutes.syncSchedule` reads this to create the schedules row. A
    // scheduled template whose cron is not lifted here never fires.
    const graph = builtMinimal(template);
    const trigger = triggerConfigFrom(graph);
    expect(["cron", "manual", "webhook"]).toContain(trigger.triggerType);
    if (trigger.triggerType === "cron") {
      expect(String(trigger.cronExpression).length).toBeGreaterThan(0);
      expect(trigger.timezone).toBeTruthy();
    }
  });

  it("has a roster with no cycle and nothing stranded, where it has a team", () => {
    const graph = builtMinimal(template);
    for (const { node } of graph.nodes) {
      if (node.kind !== "agent_team") continue;
      const team = readTeamConfig(node.config);
      expect(findDelegationCycle(team), `${node.name} loops`).toBeNull();
      const reachable = reachableAliases(team);
      for (const member of team.roster) {
        expect(reachable.has(member.alias), `${member.alias} is unreachable`).toBe(true);
      }
      for (const member of team.roster) {
        expect(member.agentId, `${member.alias} has no agent`).toBeTruthy();
      }
    }
  });

  it("declares the flags and features its shape actually needs", () => {
    const graph = builtMinimal(template);
    const hasTeam = graph.nodes.some((n) => n.node.kind === "agent_team");
    if (hasTeam) {
      expect(template.requiresFeatures).toContain("teams");
      expect(template.requiresFlags).toContain("agentTeams");
    } else {
      // A template with no team must not demand a team plan — that would gate
      // a shape that runs perfectly on Free.
      expect(template.requiresFeatures).toEqual([]);
      expect(template.requiresFlags).toEqual([]);
    }

    const delegates = graph.nodes.some((n) => {
      if (n.node.kind !== "agent_team") return false;
      const team = readTeamConfig(n.node.config);
      // A pipeline and a router route without a grant being read, so a grant
      // there is not a use of the delegation feature.
      if (team.policy === "pipeline" || team.policy === "router") return false;
      return team.roster.some((m) => m.canDelegateTo.length > 0);
    });
    if (delegates) {
      expect(template.requiresFeatures).toContain("delegation");
      expect(template.requiresFlags).toContain("agentDelegation");
    }
  });

  it("documents what it does, needs, costs and what to change first", () => {
    expect(template.doc.whatItDoes.length).toBeGreaterThan(80);
    expect(template.doc.whatItNeeds.length).toBeGreaterThan(0);
    // The first prerequisite is the one connection — that is the promise.
    expect(template.doc.whatItNeeds[0].toLowerCase()).toContain("connection");
    expect(template.doc.costPerRun.range).toMatch(/\d/);
    expect(template.doc.costPerRun.drivers.length).toBeGreaterThan(0);
    expect(template.doc.costPerRun.ceiling.length).toBeGreaterThan(10);
    expect(template.doc.changeFirst.length).toBeGreaterThanOrEqual(2);
    for (const change of template.doc.changeFirst) {
      expect(change.where.length).toBeGreaterThan(3);
      expect(change.why.length).toBeGreaterThan(20);
    }
    expect(template.doc.patternNote.length).toBeGreaterThan(60);
  });

  it("ships sample input, so the first run produces output rather than a validation error", () => {
    expect(Object.keys(template.sampleInput).length).toBeGreaterThan(0);
  });
});
