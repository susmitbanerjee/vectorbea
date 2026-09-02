import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { AgentsView } from "./agents-view";
import type {
  Constellation, ConstellationEdge, ConstellationNode,
} from "./constellation-layout";

/**
 * The handoff constellation.
 *
 * Four things it has to get right, none of which shows in a screenshot of a
 * healthy two-agent run: depth reads left to right, `handed_off` is neither
 * green nor red, a blocked branch says WHY it never started, and a repeated
 * handoff is one counted loop rather than N overlapping edges.
 */

function node(p: Partial<ConstellationNode> & { id: string; depth: number }): ConstellationNode {
  return {
    id: p.id,
    parentId: p.parentId ?? null,
    depth: p.depth,
    status: p.status ?? "succeeded",
    role: p.role ?? "worker",
    agentName: p.agentName ?? p.id,
    stopReason: p.stopReason ?? null,
    tokens: p.tokens ?? 2_000,
    costCents: p.costCents ?? 3,
    iterations: p.iterations ?? 4,
    blockedReason: p.blockedReason ?? null,
    startedAt: null,
    endedAt: null,
    isRootCause: p.isRootCause ?? false,
    onRootCausePath: p.onRootCausePath ?? false,
  };
}

function edge(p: Partial<ConstellationEdge> & { id: string; to: string }): ConstellationEdge {
  return {
    id: p.id,
    from: p.from ?? null,
    to: p.to,
    kind: p.kind ?? "DELEGATE",
    reason: p.reason ?? null,
    contractHash: p.contractHash ?? "h1",
    joinGroupId: p.joinGroupId ?? null,
    createdAt: null,
    contract: p.contract ?? null,
    output: p.output ?? null,
  };
}

function Frame({ title, note, constellation }: {
  title: string; note: string; constellation: Constellation;
}) {
  const [sel, setSel] = React.useState<string | null>(null);
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      <Text variant="caption" tone="secondary" className="mb-3 mt-1 block max-w-[80ch]">{note}</Text>
      <AgentsView
        constellation={constellation}
        selectedActivationId={sel}
        onSelectActivation={setSel}
      />
    </section>
  );
}

const GUARD = {
  name: "HANDOFF_LOOP",
  rule: "the same (from agent, to agent, contract) triple repeated",
  enforced: false,
};

const meta: Meta = { title: "App/Debug/Agents", parameters: { layout: "padded" } };
export default meta;

/** ACCEPTANCE: a 12-activation tree with a cycle, no manual layout. */
export const TwelveWithCycle: StoryObj = {
  name: "Twelve activations with a cycle",
  render: () => {
    const nodes: ConstellationNode[] = [
      node({ id: "sup", depth: 0, agentName: "supervisor", role: "supervisor", tokens: 4_200 }),
      node({ id: "res", depth: 1, parentId: "sup", agentName: "researcher", tokens: 18_000,
             status: "failed", isRootCause: true, onRootCausePath: true }),
      node({ id: "wri", depth: 1, parentId: "sup", agentName: "writer", tokens: 6_100 }),
      node({ id: "rev", depth: 1, parentId: "sup", agentName: "reviewer", tokens: 3_400 }),
      ...Array.from({ length: 4 }, (_, i) =>
        node({ id: `crm${i}`, depth: 2, parentId: "res", agentName: `crm-${i}`, tokens: 900 + i * 300 })),
      ...Array.from({ length: 4 }, (_, i) =>
        node({ id: `doc${i}`, depth: 2, parentId: "wri", agentName: `doc-${i}`, tokens: 400 + i * 120 })),
    ];
    nodes.find((n) => n.id === "sup")!.onRootCausePath = true;

    const edges: ConstellationEdge[] = [
      edge({ id: "e1", from: "sup", to: "res", reason: "gather account history" }),
      edge({ id: "e2", from: "sup", to: "wri", reason: "draft the reply" }),
      edge({ id: "e3", from: "sup", to: "rev", reason: "check tone and policy" }),
      ...Array.from({ length: 4 }, (_, i) =>
        edge({ id: `c${i}`, from: "res", to: `crm${i}`, reason: "look up one account" })),
      ...Array.from({ length: 4 }, (_, i) =>
        edge({ id: `d${i}`, from: "wri", to: `doc${i}`, reason: "fetch a template" })),
      /* The cycle: the researcher asked the supervisor the same thing twice. */
      edge({ id: "cy1", from: "res", to: "sup", kind: "RETURN", contractHash: "loop",
             reason: "needs a credential I do not have" }),
      edge({ id: "cy2", from: "res", to: "sup", kind: "RETURN", contractHash: "loop",
             reason: "needs a credential I do not have" }),
    ];

    return (
      <Frame
        title="A twelve-activation tree with a cycle"
        note="Auto-laid out, depth left to right, no manual positioning. Node area scales with
              tokens, so the researcher at 18k dwarfs its siblings without opening the cost
              view. The repeated RETURN is one counted loop, and the panel says plainly that
              nothing stopped it."
        constellation={{ runId: "r", nodes, edges, cycles: [{
          fromAgent: "researcher", toAgent: "supervisor", contractHash: "loop",
          hits: 2, edgeIds: ["cy1", "cy2"], kind: "RETURN",
        }], loopGuard: GUARD }}
      />
    );
  },
};

/** ACCEPTANCE: a wait_all fan-out with one failure and its blocked siblings. */
export const BlockedSiblings: StoryObj = {
  name: "A fan-out with one failure",
  render: () => (
    <Frame
      title="One child failed, and its siblings never started"
      note="'Why is nothing happening' is the hardest question to answer from a log, because
            the evidence is an ABSENCE — no spans, no events, no output. Only the child's
            status and the parent's stop reason together explain it, so the reason leads."
      constellation={{
        runId: "r",
        nodes: [
          node({ id: "sup", depth: 0, agentName: "supervisor", role: "supervisor",
                 tokens: 3_100, status: "failed", stopReason: "CHILD_FAILED",
                 onRootCausePath: true }),
          node({ id: "a", depth: 1, parentId: "sup", agentName: "researcher", tokens: 12_400,
                 status: "failed", isRootCause: true, onRootCausePath: true }),
          node({ id: "b", depth: 1, parentId: "sup", agentName: "writer", tokens: 0,
                 status: "cancelled", iterations: 0,
                 blockedReason: "Never started — a sibling failed and the join could not proceed without it." }),
          node({ id: "c", depth: 1, parentId: "sup", agentName: "reviewer", tokens: 0,
                 status: "cancelled", iterations: 0,
                 blockedReason: "Never started — a sibling failed and the join could not proceed without it." }),
        ],
        edges: [
          edge({ id: "e1", from: "sup", to: "a", kind: "BROADCAST", joinGroupId: "g1",
                 reason: "find the account owner",
                 contract: '{"task":"find the account owner","accountId":"A-8891"}',
                 output: '{"error":"HTTP 403 token expired"}' }),
          edge({ id: "e2", from: "sup", to: "b", kind: "BROADCAST", joinGroupId: "g1",
                 reason: "draft the reply" }),
          edge({ id: "e3", from: "sup", to: "c", kind: "BROADCAST", joinGroupId: "g1",
                 reason: "check tone and policy" }),
        ],
        cycles: [],
        loopGuard: GUARD,
      }}
    />
  ),
};

/** ACCEPTANCE: a router shows as handed_off — neither success nor failure. */
export const Router: StoryObj = {
  name: "A router that handed off",
  render: () => (
    <Frame
      title="A router that transferred correctly"
      note="handed_off is its own state. Given the success hue it would inflate a success
            rate; given the failure hue it would send somebody debugging a working router.
            It gets the brand ramp, which carries no verdict — the point is that there is
            none."
      constellation={{
        runId: "r",
        nodes: [
          node({ id: "rt", depth: 0, agentName: "router", role: "router", tokens: 800,
                 status: "handed_off", iterations: 1,
                 blockedReason: "Transferred control to another agent — neither succeeded nor failed." }),
          node({ id: "sp", depth: 1, parentId: "rt", agentName: "billing-specialist",
                 role: "specialist", tokens: 9_600 }),
        ],
        edges: [
          edge({ id: "e1", from: "rt", to: "sp", kind: "TRANSFER",
                 reason: "this is a billing question, not support",
                 contract: '{"task":"answer the billing question","threadId":"T-42"}',
                 output: '{"answer":"Refunded invoice INV-9912."}' }),
        ],
        cycles: [],
        loopGuard: GUARD,
      }}
    />
  ),
};

/** ACCEPTANCE: a single-agent run is one node, not an empty state. */
export const SingleAgent: StoryObj = {
  name: "A single-agent run",
  render: () => (
    <Frame
      title="One agent, one node"
      note="P6 routed the existing single-agent path through the activation, so a
            single-agent run has exactly one. The model is uniform: this is a constellation
            of one, not an error and not an empty state."
      constellation={{
        runId: "r",
        nodes: [node({ id: "solo", depth: 0, agentName: "triage", tokens: 5_200, iterations: 6 })],
        edges: [],
        cycles: [],
        loopGuard: GUARD,
      }}
    />
  ),
};
