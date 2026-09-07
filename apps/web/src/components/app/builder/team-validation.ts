import {
  readTeamConfig, entryMember, delegationEdges, reachableAliases,
  findDelegationCycle, longestChain, depthCounts, POLICY_INFO, PERMITTED_KINDS,
  type TeamConfig,
} from "~/lib/workflows/team";
import { ENTITLEMENT, type Entitlements } from "~/lib/entitlements/use-entitlements";
import type { BuilderRegistry } from "./use-builder-registry";
import type { Issue } from "./validation";
import type { BuilderNode } from "~/lib/workflows/builder-graph";

/* ══════════════════════════════════════════════════════════════════════════════
   TEAM VALIDATION — every §9 guard that can be answered without running.

   ── WHY DESIGN TIME IS WORTH THE DUPLICATION ────────────────────────────────
   Every rule here has a runtime counterpart that stays: `TeamLimits.maxDepth`,
   `AgentSafetyGuard`'s roster check, the repeated-handoff stop, `GraphPlanCheck`
   at the save boundary. None of them is being replaced. What they cannot do is
   answer while the author is still in the room.

   The difference is the sentence somebody reads. At run time, a cycle in a
   roster surfaces as "depth limit exceeded" — a true statement about the
   runtime, delivered at 3am, in a workflow that has been green for a week, to
   somebody who did not write it. On the canvas the same fact is "the researcher
   delegates to the writer, which delegates back to the researcher", with both
   nodes lit up. The second sentence is about the DESIGN, and it is free.

   ── WHAT IS DELIBERATELY NOT CHECKED ────────────────────────────────────────
   Anything that depends on what a model decides. Whether the supervisor will
   actually use the researcher, whether the budget is enough for the work, and
   whether the reviewer will ever approve are all run-time facts. Guessing at
   them here would produce warnings that are wrong often enough to be dismissed
   permanently within a day, which would take the true ones with them.

   ── PLAN CHECKS MIRROR GraphPlanCheck, ON PURPOSE ───────────────────────────
   `max_team_size` is compared with `>` and not `>=`, because the roster size IS
   the configured number and a plan allowing 8 must accept a team of exactly 8.
   That off-by-one is the one that either locks a customer out one short of what
   they bought, or quietly sells them one extra. It is written the same way in
   both places so the canvas and the save boundary cannot disagree about which.
══════════════════════════════════════════════════════════════════════════════ */

/** Fields the canvas needs from a team node to validate it. */
interface TeamNode {
  id: string;
  name: string;
  team: TeamConfig;
}

export function teamNodesOf(nodes: BuilderNode[]): TeamNode[] {
  return nodes
    .filter((n) => n.node.kind === "agent_team")
    .map((n) => ({ id: n.node.id, name: n.node.name, team: readTeamConfig(n.node.config) }));
}

/**
 * Validate every team node on the canvas.
 *
 * [plan] is optional for the same reason [registry] is on `validateGraph`:
 * "your plan does not allow this" is a claim about the workspace, and answering
 * it from an unresolved fetch would condemn a correctly-sized roster while the
 * request was still in flight.
 */
export function validateTeams(
  nodes: BuilderNode[],
  disabled: string[] = [],
  registry?: BuilderRegistry,
  plan?: Entitlements,
): Issue[] {
  const issues: Issue[] = [];
  const off = new Set(disabled);
  const teams = teamNodesOf(nodes).filter((t) => !off.has(t.id));
  if (teams.length === 0) return issues;

  /* Plan gates, answered once for the whole graph. `unknown` is the
     not-yet-resolved state and is treated as permissive — see the note on
     `useEntitlements`; the save boundary still refuses. */
  const planKnown = Boolean(plan) && !plan!.unknown;
  const teamsAllowed = !planKnown || plan!.has(ENTITLEMENT.TEAMS);
  const delegationAllowed = !planKnown || plan!.has(ENTITLEMENT.DELEGATION);
  const maxTeamSize = planKnown ? plan!.limit(ENTITLEMENT.MAX_TEAM_SIZE) : null;
  const maxDepth = planKnown ? plan!.limit(ENTITLEMENT.MAX_DELEGATION_DEPTH) : null;
  const planName = plan?.planName ?? "this plan";
  const upgradeName = plan?.upgradeTo?.name ?? null;
  const upgradeSentence = upgradeName
    ? `Upgrade to ${upgradeName}, or remove the team node.`
    : "Remove the team node, or contact us about a plan that includes it.";

  for (const { id, name, team } of teams) {
    const { policy, roster, limits, budget } = team;
    const info = POLICY_INFO[policy];
    const entry = entryMember(team);

    /* ── The two the runtime refuses outright ─────────────────────────────── */

    if (roster.length === 0) {
      issues.push({
        id: `team-empty-${id}`, category: "binding", severity: "error", nodeId: id,
        title: `‘${name}’ has an empty roster`,
        detail: "A team with no members has nothing to run. The engine refuses the node rather than treating it as a no-op.",
        fix: "Add at least one agent to the roster on the node's Configure tab.",
      });
      // Nothing below this says anything useful about an empty roster.
      continue;
    }

    for (const [i, member] of roster.entries()) {
      if (!member.agentId) {
        issues.push({
          id: `team-unbound-member-${id}-${i}`, category: "binding", severity: "error", nodeId: id,
          title: `‘${member.alias}’ has no agent selected`,
          detail: "The roster row exists but names no agent, so the engine drops it while parsing and the member silently does not exist.",
          fix: `Pick an agent for ‘${member.alias}’, or delete the row.`,
        });
      } else if (registry && !registry.loading && !registry.byAgentId.has(member.agentId)) {
        issues.push({
          id: `team-missing-agent-${id}-${i}`, category: "resource", severity: "error", nodeId: id,
          title: `‘${member.alias}’ names an agent this workspace does not have`,
          detail: "The agent was deleted or belongs to another workspace. Agent lookups are workspace-scoped and fail closed, so the member cannot be activated.",
          fix: `Bind ‘${member.alias}’ to an existing agent, or remove it from the roster.`,
        });
      }
    }

    /* Two members sharing an alias is not a naming inconvenience: the parser
       builds `alias → id` as a map, so the second write wins and every
       `canDelegateTo` naming that alias silently points at ONE of them. */
    const aliasCounts = new Map<string, number>();
    for (const m of roster) aliasCounts.set(m.alias, (aliasCounts.get(m.alias) ?? 0) + 1);
    for (const [alias, count] of aliasCounts) {
      if (count > 1) {
        issues.push({
          id: `team-dup-alias-${id}-${alias}`, category: "binding", severity: "error", nodeId: id,
          title: `Two members are both called ‘${alias}’`,
          detail: "Members are named by alias in every delegation grant, so both rows resolve to whichever was read last and one of them can never be reached.",
          fix: `Rename one of them — the alias is the name the arrows are drawn between.`,
        });
      }
    }

    const duplicateAgents = new Map<string, string[]>();
    for (const m of roster) {
      if (!m.agentId) continue;
      duplicateAgents.set(m.agentId, [...(duplicateAgents.get(m.agentId) ?? []), m.alias]);
    }
    for (const [agentId, aliases] of duplicateAgents) {
      if (aliases.length > 1) {
        const agentName = registry?.byAgentId.get(agentId)?.name ?? "the same agent";
        issues.push({
          id: `team-dup-agent-${id}-${agentId}`, category: "structural", severity: "warning", nodeId: id,
          title: `${aliases.join(" and ")} are the same agent`,
          detail: `Both rows point at ${agentName}. The runtime looks a member up BY AGENT ID, so the first row's grants are the ones that apply and the second row's are ignored.`,
          fix: "Give the two roles different agents, or collapse them into one member.",
        });
      }
    }

    /* ── Reachability from the entry ──────────────────────────────────────── */

    const reachable = reachableAliases(team);
    const stranded = roster.filter((m) => !reachable.has(m.alias));
    if (stranded.length > 0 && entry) {
      issues.push({
        id: `team-unreachable-${id}`, category: "structural", severity: "error", nodeId: id,
        title: stranded.length === 1
          ? `‘${stranded[0].alias}’ can never be reached`
          : `${stranded.length} members can never be reached`,
        detail: info.routing === "runtime"
          ? `A ${policy} runs its roster in order from ‘${entry.alias}’, and ${stranded.map((m) => `‘${m.alias}’`).join(", ")} ${stranded.length === 1 ? "is" : "are"} not on that path.`
          : `Nothing on the delegation path from ‘${entry.alias}’ reaches ${stranded.map((m) => `‘${m.alias}’`).join(", ")}. The roster grant is a whitelist, so an agent nobody may delegate to is never activated — it is configuration that is published and then does nothing.`,
        fix: `Add ${stranded.map((m) => `‘${m.alias}’`).join(", ")} to another member's “can delegate to”, or remove ${stranded.length === 1 ? "it" : "them"} from the roster.`,
      });
    }

    /* ── Cycles ───────────────────────────────────────────────────────────── */

    const cycle = findDelegationCycle(team);
    if (cycle) {
      /* Peers on a blackboard are MEANT to talk both ways — that is the policy.
         Everywhere else a cycle is a hierarchy that eats itself, and the only
         thing that ends it is the depth limit. */
      const peerPolicy = policy === "blackboard";
      issues.push({
        id: `team-cycle-${id}`,
        category: "structural",
        severity: peerPolicy ? "warning" : "error",
        nodeId: id,
        title: `Delegation loops: ${cycle.join(" → ")} → ${cycle[0]}`,
        detail: peerPolicy
          ? `Peers delegating both ways is what a blackboard is, so this is legal — but nothing in the design ends it. The run stops when the depth limit of ${limits.maxDepth} is reached, ${limits.maxActivations} activations are spent, or ${Math.round(limits.maxTeamDurationMs / 60_000)} minutes elapse, whichever comes first.`
          : `Each member may hand work back to one that already handed it work. Nothing in the roster ends the loop — the run would stop only when it hit the depth limit of ${limits.maxDepth}, which is a sentence about the runtime rather than about this team.`,
        fix: `Remove ‘${cycle[cycle.length - 1]}’ from ‘${cycle[0]}’'s “can delegate to”, or give the loop an exit the team can reach.`,
      });
    } else if (depthCounts(policy)) {
      /* Only meaningful on an acyclic graph, and only for the policies where a
         handoff is a DELEGATION. A transfer is a tail call and does not grow
         depth, which is why a five-stage pipeline is depth 0 and telling
         somebody it breaches a depth limit of 3 would be a confidently wrong
         refusal of a graph that runs perfectly. */
      const { hops, path } = longestChain(team);
      const declared = limits.maxDepth;
      if (hops > declared) {
        issues.push({
          id: `team-too-deep-${id}`, category: "structural", severity: "error", nodeId: id,
          title: `The delegation chain is ${hops} deep, and the limit is ${declared}`,
          detail: `${path.join(" → ")} is ${hops} handoffs from the entry. The depth guard refuses the activation at level ${declared + 1}, so ‘${path[declared + 1] ?? path[path.length - 1]}’ and everything past it never run — the team completes, with part of its roster never having been asked.`,
          fix: `Raise the depth limit to ${hops} on the node's Configure tab, or flatten the chain so no member is more than ${declared} handoffs from the entry.`,
        });
      }
    }

    /* ── Policy coherence ─────────────────────────────────────────────────── */

    if (policy === "pipeline") {
      const declaredGrants = roster.filter((m) => m.canDelegateTo.length > 0);
      if (declaredGrants.length > 0) {
        issues.push({
          id: `team-pipeline-grants-${id}`, category: "policy", severity: "warning", nodeId: id,
          title: "A pipeline ignores delegation grants",
          detail: `In a pipeline the ORDER is the routing: the runtime transfers to each member in roster order and never consults a grant list. ${declaredGrants.map((m) => `‘${m.alias}’`).join(", ")} declare${declaredGrants.length === 1 ? "s" : ""} grants that nothing reads, so the arrows on the node are not the path the run takes.`,
          fix: "Clear the grants, or switch the policy to supervisor if the routing really should be a model's choice.",
        });
      }
    }

    if (policy === "review" && roster.length < 2) {
      issues.push({
        id: `team-review-solo-${id}`, category: "policy", severity: "error", nodeId: id,
        title: "A review team needs somebody to review",
        detail: "The policy ends when the reviewer approves or the rounds run out. With one member there is no reviewer, so the only exit is the round limit.",
        fix: "Add a second member and give the first one a grant to it.",
      });
    }

    if ((policy === "supervisor" || policy === "router") && entry) {
      const expected = info.leadRole;
      if (entry.role.toLowerCase() !== expected) {
        issues.push({
          id: `team-lead-role-${id}`, category: "policy", severity: "warning", nodeId: id,
          title: `The entry member is not marked ‘${expected}’`,
          detail: `‘${entry.alias}’ starts this team because it is named as the entry or is first in the roster, but its role says “${entry.role}”. When no entry is named the runtime picks the member whose role matches the policy — so removing the explicit entry would silently start the team somewhere else.`,
          fix: `Set ‘${entry.alias}’'s role to ${expected}, so the explicit and implicit answers agree.`,
        });
      }
    }

    if (policy === "router") {
      const fanOut = roster.filter((m) => m.canDelegateTo.length > 0 && m.alias !== entry?.alias);
      if (fanOut.length > 0) {
        issues.push({
          id: `team-router-chain-${id}`, category: "policy", severity: "warning", nodeId: id,
          title: "Specialists that route onwards",
          detail: `A router permits ${PERMITTED_KINDS.router.join(", ")} only, and a transfer is a tail call — control does not come back. ${fanOut.map((m) => `‘${m.alias}’`).join(", ")} can transfer onwards, which makes this a chain of routers rather than one router and its specialists.`,
          fix: "Clear the specialists' grants if the router should be the only thing that routes.",
        });
      }
    }

    /* ── Budget and bounds ────────────────────────────────────────────────── */

    if (budget.maxTotalTokens === 0 && budget.maxCostCents === 0) {
      issues.push({
        id: `team-no-budget-${id}`, category: "policy", severity: "warning", nodeId: id,
        title: `‘${name}’ has no cost ceiling`,
        detail: `A zero in the budget means NO ceiling on that dimension, not a ceiling of zero. This team is bounded only by ${limits.maxActivations} activations and ${Math.round(limits.maxTeamDurationMs / 60_000)} minutes — neither of which is a number of dollars.`,
        fix: "Set a token or cost ceiling on the node's Configure tab. A team that breaches one ends in CeilingExceeded, which names the limit it hit.",
      });
    }

    /* The one bound where the DEFAULT is the risk: activations are counted
       across the whole tree, and a fan-out multiplies. */
    const edges = delegationEdges(team);
    if (edges.length > limits.maxActivations) {
      issues.push({
        id: `team-activations-${id}`, category: "policy", severity: "warning", nodeId: id,
        title: `${edges.length} possible handoffs against a ceiling of ${limits.maxActivations} activations`,
        detail: "Activations are counted across the whole delegation tree, not per member. A roster with more edges than the ceiling can exhaust it before every member has been asked once.",
        fix: `Raise the activation limit, or narrow the grants so the tree is smaller.`,
      });
    }

    /* ── Plan ─────────────────────────────────────────────────────────────── */

    if (!teamsAllowed) {
      issues.push({
        id: `team-plan-teams-${id}`, category: "policy", severity: "error", nodeId: id,
        title: `${planName} does not include agent teams`,
        detail: `This node is refused at save. Plans resolve from the workspace's billing account, so this is the workspace's plan and not your own — the same answer every enforcement point gives.`,
        fix: upgradeSentence,
      });
    } else if (maxTeamSize !== null && roster.length > maxTeamSize) {
      // `>` and not `>=`: a plan allowing 8 accepts a team of exactly 8.
      issues.push({
        id: `team-plan-size-${id}`, category: "policy", severity: "error", nodeId: id,
        title: `${roster.length} members, and ${planName} allows ${maxTeamSize}`,
        detail: "The save boundary checks the same number and refuses the version, so this is not a hint — the graph cannot be published as it stands.",
        fix: upgradeName
          ? `Remove ${roster.length - maxTeamSize} member${roster.length - maxTeamSize === 1 ? "" : "s"}, or upgrade to ${upgradeName}.`
          : `Remove ${roster.length - maxTeamSize} member${roster.length - maxTeamSize === 1 ? "" : "s"}.`,
      });
    }

    const usesDelegation = roster.some((m) => m.canDelegateTo.length > 0);
    if (teamsAllowed && usesDelegation && !delegationAllowed) {
      issues.push({
        id: `team-plan-delegation-${id}`, category: "policy", severity: "error", nodeId: id,
        title: `${planName} does not include delegation`,
        detail: "Delegation is a feature before it is a depth: a roster where anybody may hand work to anybody else uses it, whatever depth the node declares.",
        fix: upgradeName
          ? `Clear every “can delegate to”, or upgrade to ${upgradeName}.`
          : "Clear every “can delegate to”.",
      });
    }

    if (teamsAllowed && maxDepth !== null && limits.maxDepth > maxDepth) {
      issues.push({
        id: `team-plan-depth-${id}`, category: "policy", severity: "error", nodeId: id,
        title: `Depth ${limits.maxDepth} declared, and ${planName} allows ${maxDepth}`,
        detail: "The declared depth is checked against the plan at save, whether or not the roster is deep enough to use it.",
        fix: upgradeName
          ? `Lower the depth limit to ${maxDepth}, or upgrade to ${upgradeName}.`
          : `Lower the depth limit to ${maxDepth}.`,
      });
    }
  }

  return issues;
}
