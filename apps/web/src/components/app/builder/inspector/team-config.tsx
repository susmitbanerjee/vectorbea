"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/choice";
import { Section, Field } from "./fields";
import { useBuilderRegistry } from "../use-builder-registry";
import { useEntitlements, ENTITLEMENT } from "~/lib/entitlements/use-entitlements";
import { gateForDelegation } from "../gates";
import { TeamDiagram } from "../team-diagram";
import {
  readTeamConfig, writeTeamConfig, entryMember, delegationEdges,
  findDelegationCycle, longestChain, depthCounts, reachableAliases,
  joinPolicyWire, parseJoinPolicy,
  TEAM_POLICIES, POLICY_INFO, TEAM_DEFAULTS,
  type TeamConfig, type TeamMember, type TeamPolicy,
} from "~/lib/workflows/team";
import type { GraphNode } from "~/lib/workflows/builder-graph";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ROSTER EDITOR.

   ── THE PICTURE IS IN HERE TOO, AND THAT IS NOT A DUPLICATE ─────────────────
   The canvas node draws the delegation graph so it can be READ at a glance. This
   panel draws the same graph so it can be read WHILE IT IS BEING EDITED —
   ticking a "can delegate to" box and watching an arrow appear is the difference
   between understanding the grant model and guessing at it. Both render
   `<TeamDiagram>`; neither re-derives anything.

   ── EVERY CONTROL WRITES THE WHOLE CONFIG ───────────────────────────────────
   The team config is a tree with cross-references — a member's alias is what
   every grant names, so renaming one member has to rewrite other members' rows.
   Patching individual keys would leave a grant pointing at an alias that no
   longer exists, which the runtime resolves to nobody and silently drops. So
   every edit goes through `writeTeamConfig(next)` on a fully-formed `TeamConfig`.

   ── THE PLAN GATE DISABLES, IT DOES NOT HIDE ────────────────────────────────
   A workspace whose plan has no delegation still sees the grants column, still
   sees what it would do, and is told which plan includes it. Removing the column
   would leave somebody unable to tell whether the product has the feature.
══════════════════════════════════════════════════════════════════════════════ */

export function TeamConfigPanel({
  node, onChange,
}: {
  node: GraphNode;
  onChange: (patch: { name?: string; config?: Record<string, unknown> }) => void;
}) {
  const registry = useBuilderRegistry();
  const plan = useEntitlements();
  const team = React.useMemo(() => readTeamConfig(node.config), [node.config]);

  const commit = React.useCallback(
    (next: TeamConfig) => onChange({ config: { ...node.config, ...writeTeamConfig(next) } }),
    [node.config, onChange],
  );

  const delegationGate = gateForDelegation(plan);
  const maxTeamSize = plan.unknown ? null : plan.limit(ENTITLEMENT.MAX_TEAM_SIZE);
  const maxPlanDepth = plan.unknown ? null : plan.limit(ENTITLEMENT.MAX_DELEGATION_DEPTH);

  const entry = entryMember(team);
  const reachable = React.useMemo(() => reachableAliases(team), [team]);
  const cycle = React.useMemo(() => findDelegationCycle(team), [team]);
  const chain = React.useMemo(
    () => (depthCounts(team.policy) ? longestChain(team) : { hops: 0, path: [] }),
    [team],
  );
  const unbound = React.useMemo(
    () => new Set(team.roster.filter((m) => !m.agentId).map((m) => m.alias)),
    [team.roster],
  );

  const info = POLICY_INFO[team.policy];
  const atSizeLimit = maxTeamSize !== null && team.roster.length >= maxTeamSize;

  /* ── Roster mutations ───────────────────────────────────────────────────── */

  const updateMember = (index: number, patch: Partial<TeamMember>) => {
    const previous = team.roster[index];
    const nextMember = { ...previous, ...patch };
    const roster = team.roster.map((m, i) => (i === index ? nextMember : m));

    /* A RENAME REWRITES EVERY GRANT THAT NAMED THE OLD ALIAS.
       The alias is the reference; leaving the old one in place would produce a
       grant the runtime resolves to nobody and drops without saying so, which
       looks exactly like a member that decided not to delegate. */
    const renamed = patch.alias !== undefined && patch.alias !== previous.alias;
    const rewritten = renamed
      ? roster.map((m) => ({
        ...m,
        canDelegateTo: m.canDelegateTo.map((t) => (t === previous.alias ? nextMember.alias : t)),
      }))
      : roster;

    commit({
      ...team,
      roster: rewritten,
      entryAlias: renamed && team.entryAlias === previous.alias ? nextMember.alias : team.entryAlias,
    });
  };

  const addMember = () => {
    // A unique alias on the first try: colliding aliases make two members
    // resolve to one, which is an error the canvas would then have to report
    // about a row the person just clicked to create.
    const taken = new Set(team.roster.map((m) => m.alias));
    let n = team.roster.length + 1;
    while (taken.has(`member${n}`)) n += 1;
    commit({
      ...team,
      roster: [...team.roster, { agentId: "", alias: `member${n}`, role: "worker", canDelegateTo: [] }],
    });
  };

  const removeMember = (index: number) => {
    const removed = team.roster[index];
    const roster = team.roster
      .filter((_, i) => i !== index)
      // Every grant naming the removed member goes with it. Left behind, the
      // runtime drops it silently and the canvas would draw an arrow to nothing.
      .map((m) => ({ ...m, canDelegateTo: m.canDelegateTo.filter((t) => t !== removed.alias) }));
    commit({
      ...team,
      roster,
      entryAlias: team.entryAlias === removed.alias ? "" : team.entryAlias,
    });
  };

  const toggleGrant = (index: number, targetAlias: string, granted: boolean) => {
    const member = team.roster[index];
    const canDelegateTo = granted
      ? [...new Set([...member.canDelegateTo, targetAlias])]
      : member.canDelegateTo.filter((t) => t !== targetAlias);
    commit({
      ...team,
      roster: team.roster.map((m, i) => (i === index ? { ...m, canDelegateTo } : m)),
    });
  };

  return (
    <>
      {/* ── Policy ─────────────────────────────────────────────────────────── */}
      <Section
        title="Policy"
        help="How the team works together and when it is done."
      >
        <Select
          options={TEAM_POLICIES.map((p) => ({
            value: p,
            label: POLICY_INFO[p].label,
            description: POLICY_INFO[p].summary,
          }))}
          value={team.policy}
          onValueChange={(v) => commit({ ...team, policy: v as TeamPolicy })}
          aria-label="Orchestration policy"
        />
        <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
          {info.terminates}{" "}
          {info.routing === "runtime"
            ? "The runtime picks the next member from the roster order — grants are not consulted."
            : "The model picks the next member, from the grants below and nowhere else."}
        </Text>
      </Section>

      {/* ── The delegation graph, live ─────────────────────────────────────── */}
      <Section
        title="Delegation"
        help="Who each member can hand work to."
      >
        <div className="border-subtle bg-surface-base overflow-x-auto rounded-sm border p-2">
          <TeamDiagram team={team} width={280} height={team.roster.length > 3 ? 150 : 90} unbound={unbound} />
        </div>

        {cycle ? (
          <div className="border-status-failed-border bg-status-failed-subtle mt-2 rounded-sm border px-2 py-1">
            <Text variant="caption" tone="inherit" className="text-status-failed">
              {cycle.join(" → ")} → {cycle[0]}
            </Text>
            <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
              {team.policy === "blackboard"
                ? "Peers delegating both ways is what a blackboard is — but nothing in the design ends it, so the run stops at a limit rather than at an answer."
                : "This loop is refused at save. Nothing in the roster ends it; the run would stop only when the depth limit was reached."}
            </Text>
          </div>
        ) : depthCounts(team.policy) ? (
          <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
            Deepest chain: {chain.hops === 0 ? "no delegation yet" : chain.path.join(" → ")} —{" "}
            {chain.hops} of {team.limits.maxDepth} allowed.
          </Text>
        ) : (
          <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
            A {team.policy} transfers rather than delegates. A transfer is a tail call: control does
            not come back, so the chain does not grow the delegation depth.
          </Text>
        )}
      </Section>

      {/* ── Roster ─────────────────────────────────────────────────────────── */}
      <Section
        title="Roster"
        help="The members and who each can hand work to."
      >
        {registry.loading ? (
          <Text variant="caption" tone="muted" className="block">Loading the registry…</Text>
        ) : registry.agents.length === 0 ? (
          <Text variant="caption" tone="muted" className="block leading-snug">
            No agents are registered in this workspace yet. Register one under Build, then Agents,
            and it appears here. A team is a roster of registered agents — it does not define agents
            of its own.
          </Text>
        ) : null}

        <ul className="grid gap-2">
          {team.roster.map((member, index) => {
            const isEntry = entry?.alias === member.alias;
            const stranded = !reachable.has(member.alias);
            const peers = team.roster.filter((m) => m.alias !== member.alias);
            return (
              <li
                key={index}
                className={cn(
                  "rounded-sm border p-2",
                  stranded
                    ? "border-status-failed-border bg-status-failed-subtle"
                    : "border-subtle bg-surface-base",
                )}
              >
                <div className="flex items-start gap-1.5">
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <Field label="Name on the canvas" help="What the arrows are drawn between, and what grants refer to.">
                        <Input
                          value={member.alias}
                          onChange={(e) => updateMember(index, { alias: e.target.value })}
                          className="h-7 text-body-sm"
                        />
                      </Field>
                      <Field label="Role" help="supervisor, router or worker are read by the policy. Anything else is a label.">
                        <Input
                          value={member.role}
                          onChange={(e) => updateMember(index, { role: e.target.value })}
                          className="h-7 text-body-sm"
                        />
                      </Field>
                    </div>

                    <Field label="Agent" help="A registered agent in this workspace. Lookups are workspace-scoped and fail closed.">
                      <Select
                        options={registry.agents.map((a) => ({
                          value: a.id,
                          label: a.name,
                          description: a.modelName ?? a.type,
                        }))}
                        value={member.agentId}
                        onValueChange={(v) => updateMember(index, { agentId: v })}
                        aria-label={`Agent for ${member.alias}`}
                      />
                    </Field>

                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <Text variant="caption" tone="secondary">Can delegate to</Text>
                        {isEntry ? (
                          <Text variant="caption" tone="muted">entry member</Text>
                        ) : null}
                      </div>
                      {info.routing === "runtime" ? (
                        <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
                          A {team.policy} routes by roster order, so nothing reads these. Reorder the
                          roster to change the sequence.
                        </Text>
                      ) : peers.length === 0 ? (
                        <Text variant="caption" tone="muted" className="mt-0.5 block">
                          No other members yet.
                        </Text>
                      ) : (
                        <div className="mt-1 grid gap-1">
                          {peers.map((peer) => (
                            <Checkbox
                              key={peer.alias}
                              checked={member.canDelegateTo.includes(peer.alias)}
                              disabled={!delegationGate.available}
                              onCheckedChange={(v) => toggleGrant(index, peer.alias, v === true)}
                            >
                              <span className="font-ui text-caption">{peer.alias}</span>
                            </Checkbox>
                          ))}
                        </div>
                      )}
                      {!delegationGate.available ? (
                        <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
                          {delegationGate.message} {delegationGate.action}
                        </Text>
                      ) : null}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => removeMember(index)}
                    aria-label={`Remove ${member.alias} from the roster`}
                    title={`Remove ${member.alias}`}
                  >
                    Remove
                  </Button>
                </div>

                {stranded ? (
                  <Text variant="caption" tone="secondary" className="mt-1.5 block leading-snug">
                    Nothing reaches {member.alias}. The grant is a whitelist, so a member nobody may
                    delegate to is never activated.
                  </Text>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={addMember} disabled={atSizeLimit}>
            Add member
          </Button>
          {maxTeamSize !== null ? (
            <Text variant="caption" tone={atSizeLimit ? "secondary" : "muted"}>
              {team.roster.length} of {maxTeamSize} on{" "}
              {plan.planName ?? "this plan"}
              {atSizeLimit && plan.upgradeTo ? ` · ${plan.upgradeTo.name} allows more` : ""}
            </Text>
          ) : null}
        </div>
      </Section>

      {/* ── Entry ──────────────────────────────────────────────────────────── */}
      <Section
        title="Entry member"
        help="The member the team starts with."
      >
        <Select
          options={[
            { value: "", label: "Decide from roles", description: `The first member whose role is ${info.leadRole}` },
            ...team.roster.map((m) => ({
              value: m.alias,
              label: m.alias,
              description: m.role,
            })),
          ]}
          value={team.entryAlias}
          onValueChange={(v) => commit({ ...team, entryAlias: v })}
          aria-label="Entry member"
        />
        {entry ? (
          <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
            Starts at {entry.alias}
            {team.entryAlias ? "" : ` — chosen by role, because no entry is named`}.
          </Text>
        ) : null}
      </Section>

      {/* ── Objective ──────────────────────────────────────────────────────── */}
      <Section
        title="Task instruction"
        help="Handed to the entry member as its objective. Leave empty to use the agent's own registered task."
      >
        <Input
          value={team.objective}
          onChange={(e) => commit({ ...team, objective: e.target.value })}
          placeholder="Uses the entry agent's default task"
          className="h-7 text-body-sm"
        />
      </Section>

      {/* ── Fan-out ────────────────────────────────────────────────────────── */}
      <Section
        title="Fan-out"
        help="What finishes a delegation to several members at once, and what a failed child does to its parent."
      >
        <div className="grid gap-2">
          <Field
            label="Join"
            help="“First success” stops the others once one finishes."
          >
            <Select
              options={[
                { value: "wait_all", label: "All must succeed", description: "The only total one" },
                { value: "wait_any", label: "First success wins", description: "The rest are cancelled" },
                { value: "quorum(2)", label: "2 must succeed", description: "A quorum" },
                { value: "quorum(3)", label: "3 must succeed", description: "A quorum" },
              ]}
              value={joinPolicyWire(team.joinPolicy)}
              onValueChange={(v) => commit({ ...team, joinPolicy: parseJoinPolicy(v) })}
              aria-label="Join policy"
            />
          </Field>
          <Field
            label="If a child fails"
            help="By default the team carries on when a member fails."
          >
            <Select
              options={[
                { value: "continue", label: "Carry on", description: "A failed delegation is a failed observation" },
                { value: "fail_parent", label: "Fail the parent", description: "For a join that cannot proceed without it" },
              ]}
              value={team.onChildFailure}
              onValueChange={(v) => commit({ ...team, onChildFailure: v === "fail_parent" ? "fail_parent" : "continue" })}
              aria-label="On child failure"
            />
          </Field>
        </div>
      </Section>

      {/* ── Limits ─────────────────────────────────────────────────────────── */}
      <Section
        title="Limits"
        help="Limits that stop the team from running forever."
      >
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Max depth"
            help={maxPlanDepth !== null
              ? `How many handoffs deep a chain may go. ${plan.planName ?? "This plan"} allows ${maxPlanDepth}.`
              : "How many handoffs deep a chain may go. A root activation is depth 0."}
          >
            <Input
              type="number" min={1} max={10}
              value={team.limits.maxDepth}
              onChange={(e) => commit({
                ...team,
                limits: { ...team.limits, maxDepth: clamp(e.target.value, 1, 10, TEAM_DEFAULTS.maxDepth) },
              })}
              className="h-7 text-body-sm tabular"
            />
          </Field>
          <Field label="Max activations" help="Across the whole tree, not per member. A fan-out multiplies.">
            <Input
              type="number" min={1} max={200}
              value={team.limits.maxActivations}
              onChange={(e) => commit({
                ...team,
                limits: { ...team.limits, maxActivations: clamp(e.target.value, 1, 200, TEAM_DEFAULTS.maxActivations) },
              })}
              className="h-7 text-body-sm tabular"
            />
          </Field>
          <Field
            label={team.policy === "review" ? "Max rounds" : "Repeats per pair"}
            help={team.policy === "review"
              ? "A round is the worker sending the same draft back to the same reviewer. It resolves onto the repeated-handoff guard rather than adding a second counter."
              : "How many times one (from, to, task) triple may repeat. If the same request has come back the same twice, spending the budget reproving it helps nobody."}
          >
            <Input
              type="number" min={1} max={team.policy === "review" ? 20 : 50}
              value={team.policy === "review" ? team.limits.maxRounds : team.limits.maxHandoffsPerPair}
              onChange={(e) => commit({
                ...team,
                limits: team.policy === "review"
                  ? { ...team.limits, maxRounds: clamp(e.target.value, 1, 20, TEAM_DEFAULTS.maxRounds) }
                  : { ...team.limits, maxHandoffsPerPair: clamp(e.target.value, 1, 50, TEAM_DEFAULTS.maxHandoffsPerPair) },
              })}
              className="h-7 text-body-sm tabular"
            />
          </Field>
          <Field
            label="Wall clock (min)"
            help="Time waiting for approval does not count."
          >
            <Input
              type="number" min={1} max={720}
              value={Math.round(team.limits.maxTeamDurationMs / 60_000)}
              onChange={(e) => commit({
                ...team,
                limits: {
                  ...team.limits,
                  maxTeamDurationMs: clamp(e.target.value, 1, 720, 10) * 60_000,
                },
              })}
              className="h-7 text-body-sm tabular"
            />
          </Field>
        </div>
      </Section>

      {/* ── Budget ─────────────────────────────────────────────────────────── */}
      <Section
        title="Budget"
        help="Zero means no limit."
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="Max cost (cents)" help="Across the whole team, children included. 0 for no ceiling.">
            <Input
              type="number" min={0}
              value={team.budget.maxCostCents}
              onChange={(e) => commit({
                ...team,
                budget: { ...team.budget, maxCostCents: clamp(e.target.value, 0, 10_000_000, 0) },
              })}
              className="h-7 text-body-sm tabular"
            />
          </Field>
          <Field label="Max tokens" help="Across the whole team. 0 for no ceiling.">
            <Input
              type="number" min={0}
              value={team.budget.maxTotalTokens}
              onChange={(e) => commit({
                ...team,
                budget: { ...team.budget, maxTotalTokens: clamp(e.target.value, 0, 100_000_000, 0) },
              })}
              className="h-7 text-body-sm tabular"
            />
          </Field>
        </div>
        {team.budget.maxCostCents === 0 && team.budget.maxTotalTokens === 0 ? (
          <div className="border-status-waiting-border bg-status-waiting-subtle mt-2 rounded-sm border px-2 py-1">
            <Text variant="caption" tone="inherit" className="text-status-waiting">
              No cost ceiling
            </Text>
            <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
              This team is bounded only by {team.limits.maxActivations} activations and{" "}
              {Math.round(team.limits.maxTeamDurationMs / 60_000)} minutes. Neither of those is a
              number of dollars. A child is never allocated more than its parent&apos;s remaining
              budget, so one ceiling at the top bounds the whole tree.
            </Text>
          </div>
        ) : null}
      </Section>

      {/* ── What the runtime will refuse ───────────────────────────────────── */}
      <Section
        title="Handoffs this policy permits"
        help="Enforced on every handoff."
      >
        <Text variant="body-sm" tone="secondary" className="block">
          {PERMITTED_LABEL[team.policy]}
        </Text>
        <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
          {delegationEdges(team).length} grant{delegationEdges(team).length === 1 ? "" : "s"} across{" "}
          {team.roster.length} member{team.roster.length === 1 ? "" : "s"}.
        </Text>
      </Section>
    </>
  );
}

/** One sentence per policy about what its members may do. */
const PERMITTED_LABEL: Record<TeamPolicy, string> = {
  supervisor: "Delegate, broadcast and escalate. The supervisor waits for what it delegated and aggregates the answers.",
  router: "Transfer only. A transfer is a tail call — control does not come back, so the specialist's answer is the team's answer.",
  pipeline: "Transfer only, in roster order. The runtime chooses the next stage; no model does.",
  review: "Delegate only, between the worker and the reviewer, for the configured number of rounds.",
  blackboard: "Broadcast and delegate, between peers with no hierarchy, sharing one working context.",
};

/** Numeric input that never writes NaN into the config. */
function clamp(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
