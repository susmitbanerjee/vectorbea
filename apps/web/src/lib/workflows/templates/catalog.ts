import type { BuilderGraph, BuilderEdge, GraphNode } from "../builder-graph";
import { writeTeamConfig, type TeamConfig } from "../team";

/* ══════════════════════════════════════════════════════════════════════════════
   THE STARTER TEMPLATES.

   ── THE BAR: RUNNABLE AFTER ONE CONNECTION ──────────────────────────────────
   A template that needs an hour of configuration before it does anything is not
   a template, it is a tutorial with extra steps. Every template here runs end to
   end in a clean workspace once ONE LLM connection exists, and every one ships
   with sample input so the first run produces something to look at.

   That constraint is what shapes the whole catalogue, and it is worth writing
   down why each restriction exists rather than leaving them to be rediscovered:

   · NO HTTP OR DATABASE TOOLS IN THE REQUIRED PATH. `toolRequiresConnection`
     makes both need a connection of their own, which would make the promise
     "runnable after TWO connections". Where a template is better with one, it is
     declared in `optionalTools` — installed if the workspace already has a
     compatible connection, and left out with a sentence if not.

   · SENDING IS A BUILT-IN EMAIL NODE, NOT A REGISTERED TOOL. `ToolNodeExecutor`
     checks `config.toolType == "builtin_email"` BEFORE it validates `toolId`, so
     that node needs neither a tool row nor a connection. It is the only
     side-effecting step available to a workspace with nothing connected but a
     model, and it is metered per workspace per month.

   · TOOL TYPES ARE THE WORKER'S, NOT THE API'S. The API accepts `builtin`,
     `code`, `custom` and `llm_generate`; `ToolNodeExecutor`'s dispatch has no
     branch for any of them and ends at "Tool type X is not yet supported by the
     worker". A template that created one would install cleanly and fail on its
     first run, which is the worst possible outcome for a starter template —
     it teaches the person that the product is broken, on their first minute.

   ── PATTERNS, NOT SCENARIOS ─────────────────────────────────────────────────
   Each template is one ORCHESTRATION PATTERN with a plausible job attached, not
   a vertical solution. Somebody adopting "supervisor and workers" is going to
   replace the job; what they are keeping is the shape, the guards and the
   budget. So the documentation leads with the shape.
══════════════════════════════════════════════════════════════════════════════ */

export type TemplatePattern =
  | "single-agent" | "supervisor" | "router" | "review" | "approval" | "batch";

export type TemplateCategory =
  | "support" | "growth" | "data" | "engineering" | "operations" | "billing";

export type Difficulty = "starter" | "intermediate" | "advanced";

/** A connection kind, as `CONNECTION_TYPES` in the API spells it. */
export type ConnectionKind = "llm" | "http" | "database";

/** An agent the install creates, referenced from the graph by [ref]. */
export interface TemplateAgentSpec {
  ref: string;
  name: string;
  /** One of `AGENT_TYPES`. */
  type: string;
  role: string;
  instructions: string;
  maxIterations: number;
}

/** A registry tool the install creates only if its connection exists. */
export interface TemplateToolSpec {
  ref: string;
  name: string;
  /** `http` only — see the note on tool types at the top of this file. */
  type: "http";
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  connectionKind: ConnectionKind;
  config: Record<string, unknown>;
  /** What the template does WITHOUT it. Shown before the install. */
  withoutIt: string;
}

/**
 * The documentation a template carries with it.
 *
 * ── FOUR QUESTIONS, IN THE ORDER THEY ARE ASKED ─────────────────────────────
 * What does it do · what does it need · what does a run cost · what do I change
 * first. A template that answers the first and leaves the other three to be
 * discovered is the reason people abandon template galleries: the adoption cost
 * is invisible until it has already been paid.
 *
 * `costPerRun` is a RANGE with its drivers named, not a number. A single number
 * would be a measurement nobody took, and would be wrong the first time somebody
 * pointed the template at a longer document.
 */
export interface TemplateDoc {
  whatItDoes: string;
  /** Prerequisites, in the order they block. First item is the one connection. */
  whatItNeeds: string[];
  costPerRun: {
    /** e.g. "about 3–8¢". A range, because the input length decides. */
    range: string;
    /** What actually moves it. */
    drivers: string[];
    /** The ceiling the template ships with, so the worst case is bounded. */
    ceiling: string;
  };
  /** The first two or three edits somebody should make. Ordered. */
  changeFirst: { where: string; why: string }[];
  /** What this pattern is for, beyond the example job. */
  patternNote: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  summary: string;
  pattern: TemplatePattern;
  category: TemplateCategory;
  difficulty: Difficulty;
  /** The one connection kind that makes it runnable. */
  requiresConnection: ConnectionKind;
  /** Entitlement keys the workspace's plan must grant. Empty for most. */
  requiresFeatures: string[];
  /** Runtime flags that must be on. Mirrors the worker's env switches. */
  requiresFlags: ("agentTeams" | "agentDelegation")[];
  agents: TemplateAgentSpec[];
  optionalTools: TemplateToolSpec[];
  /** Seeded into the first run, so the first run produces something. */
  sampleInput: Record<string, unknown>;
  doc: TemplateDoc;
  /** Builds the graph once the install knows the real ids. */
  build: (refs: TemplateRefs) => BuilderGraph;
}

/** Real ids, keyed by the spec `ref` that asked for them. */
export interface TemplateRefs {
  agents: Record<string, string>;
  tools: Record<string, string>;
  /** The LLM connection the install bound the agents to. */
  llmConnectionId: string | null;
  /** Where a template's email step sends. Empty until the person fills it in. */
  notifyEmail: string;
}

/* ── Graph construction helpers ───────────────────────────────────────────── */

let seq = 0;
const id = (prefix: string) => `${prefix}_${(seq += 1).toString(36)}`;

function node(kind: GraphNode["kind"], name: string, config: Record<string, unknown> = {}): GraphNode {
  return { id: id(kind), name, kind, config };
}

/**
 * A chain of nodes, wired in order.
 *
 * Positions are left at the origin: `fromStoredGraph` reports `needsLayout` when
 * a node arrives without one and the builder lays the graph out on first open.
 * Hand-placing them here would be a second layout algorithm that disagrees with
 * dagre the moment a template gains a node.
 */
function chain(nodes: GraphNode[], edges: BuilderEdge[] = []): BuilderGraph {
  const linear: BuilderEdge[] = nodes.slice(0, -1).map((n, i) => ({
    id: `e-${n.id}-${nodes[i + 1].id}`,
    source: n.id,
    target: nodes[i + 1].id,
    kind: "standard",
  }));
  return {
    nodes: nodes.map((n) => ({ node: n, x: 0, y: 0 })),
    edges: [...linear, ...edges],
  };
}

/** A built-in email step. Needs no tool row and no connection. */
function emailNode(name: string, to: string, subject: string, body: string): GraphNode {
  return node("tool", name, {
    // Read by `ToolNodeExecutor` BEFORE toolId validation, which is what makes
    // this the one side-effecting step a workspace with no connections can run.
    toolType: "builtin_email",
    emailTo: to,
    emailSubject: subject,
    emailBody: body,
    timeoutMs: 30_000,
    retry: { attempts: 2, backoff: "exponential", maxDelayMs: 8_000 },
  });
}

/** A team node, written in the shape `TeamConfig.parse` reads. */
function teamNode(name: string, team: TeamConfig): GraphNode {
  return node("agent_team", name, writeTeamConfig(team));
}

/* Every template ships with a cost ceiling. A zero budget means NO ceiling in
   `BudgetVector`, and a starter template that can spend without bound is the
   one thing a starter template must never be — the person running it has by
   definition not yet learned where the ceilings live. */
const STARTER_BUDGET = { maxTotalTokens: 60_000, maxCostCents: 25 };

/* ── The catalogue ────────────────────────────────────────────────────────── */

export const TEMPLATES: WorkflowTemplate[] = [
  /* ────────────────────────────────────────────────────────── 1. single agent */
  {
    id: "single-agent-triage",
    name: "Agent that triages and reports",
    summary: "One agent reads an inbound message, classifies it, and emails the summary.",
    pattern: "single-agent",
    category: "support",
    difficulty: "starter",
    requiresConnection: "llm",
    requiresFeatures: [],
    requiresFlags: [],
    agents: [{
      ref: "triage",
      name: "Triage agent",
      type: "iterative_agent",
      role: "worker",
      instructions:
        "You triage inbound support messages. For each message decide a category "
        + "(billing, bug, feature request, or other), a severity from 1 to 4, and write "
        + "a two-sentence summary. Return JSON with the keys category, severity and summary. "
        + "If the message is ambiguous, say so in the summary rather than guessing a category.",
      maxIterations: 4,
    }],
    optionalTools: [{
      ref: "crm-lookup",
      name: "Customer lookup",
      type: "http",
      riskLevel: "low",
      requiresApproval: false,
      connectionKind: "http",
      config: { url: "https://example.invalid/customers/{{input.customerId}}", method: "GET" },
      withoutIt: "The agent triages from the message alone, without the customer's history.",
    }],
    sampleInput: {
      message: "Our invoice for March charged us twice and the second charge has not been refunded.",
      customerId: "cus_demo_1",
    },
    doc: {
      whatItDoes:
        "Takes one inbound message, has an agent classify it and write a short summary, "
        + "commits a checkpoint, and emails the result. It is the smallest shape that "
        + "still exercises the whole runtime: an agent, a durable commit, and a side effect.",
      whatItNeeds: [
        "One LLM connection. Nothing else.",
        "An email address for the notification step — set it on the email node before the first run.",
        "Optionally an HTTP connection, which turns on the customer-lookup tool.",
      ],
      costPerRun: {
        range: "about 1–3¢",
        drivers: ["The length of the inbound message", "How many iterations the agent takes before it settles"],
        ceiling: "25¢ and 60k tokens, on the agent node's budget.",
      },
      changeFirst: [
        { where: "The email node's To field", why: "It ships empty, and the node fails with a message saying so rather than sending nowhere." },
        { where: "The agent's instructions", why: "The four categories are a guess about your product. They are the thing that makes the output useful." },
        { where: "The trigger", why: "It is manual so the first run is under your control. Point it at a webhook once the output looks right." },
      ],
      patternNote:
        "One agent, one job, bounded. Reach for this when the work is a judgement call that "
        + "one model can make in a few steps — and not when it is several judgements that "
        + "need different context, which is what the supervisor pattern is for.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Manual start", { triggerType: "manual", type: "manual" });
      const agent = node("agent", "Triage the message", {
        agentId: refs.agents.triage,
        agentName: "Triage agent",
        taskOverride: "Triage this message and return category, severity and summary as JSON.",
        maxSteps: 4,
        timeoutMs: 120_000,
        toolGrants: refs.tools["crm-lookup"] ? [refs.tools["crm-lookup"]] : [],
        budget: STARTER_BUDGET,
      });
      const commit = node("checkpoint", "Commit the triage", { scope: "run" });
      const email = emailNode(
        "Email the summary",
        refs.notifyEmail,
        "Triage: {{steps.Triage the message.output.category}}",
        "<p>{{steps.Triage the message.output.summary}}</p>"
        + "<p>Severity {{steps.Triage the message.output.severity}}</p>",
      );
      const end = node("end", "Done");
      return chain([trigger, agent, commit, email, end]);
    },
  },

  /* ─────────────────────────────────────────────────────── 2. supervisor team */
  {
    id: "supervisor-and-workers",
    name: "Supervisor and workers",
    summary: "One agent owns the brief and hands pieces of it to two specialists.",
    pattern: "supervisor",
    category: "growth",
    difficulty: "intermediate",
    requiresConnection: "llm",
    requiresFeatures: ["teams", "delegation"],
    requiresFlags: ["agentTeams", "agentDelegation"],
    agents: [
      {
        ref: "lead",
        name: "Brief supervisor",
        type: "supervisor",
        role: "supervisor",
        instructions:
          "You own a research brief. Break it into research and writing, delegate each to the "
          + "member whose role fits, and assemble their answers into one document. Delegate at "
          + "most once per member unless the answer you get back is unusable — say why when it is.",
        maxIterations: 6,
      },
      {
        ref: "researcher",
        name: "Researcher",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You gather and organise facts on a narrow question. Return a bulleted list of findings "
          + "with a confidence note on each. Say plainly when you do not know something.",
        maxIterations: 4,
      },
      {
        ref: "writer",
        name: "Writer",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You turn findings into prose. Keep the structure the findings came in. Do not add "
          + "facts that were not given to you.",
        maxIterations: 4,
      },
    ],
    optionalTools: [],
    sampleInput: {
      brief: "Summarise how durable execution differs from a retry loop, for an engineering audience.",
    },
    doc: {
      whatItDoes:
        "A supervisor receives a brief, delegates the research to one member and the writing to "
        + "another, and assembles what comes back. The delegation graph is on the canvas: the "
        + "supervisor has grants to both workers and neither worker has a grant at all, which is "
        + "what makes the shape a supervisor rather than a committee.",
      whatItNeeds: [
        "One LLM connection.",
        "A plan that includes agent teams and delegation.",
        "AGENT_TEAMS_ENABLED and AGENT_ACTIVATIONS_ENABLED on in the deployment.",
      ],
      costPerRun: {
        range: "about 8–20¢",
        drivers: [
          "Three agents, so three sets of context",
          "How many times the supervisor re-delegates",
          "The length of the brief",
        ],
        ceiling: "25¢ and 60k tokens for the whole team, children included.",
      },
      changeFirst: [
        { where: "The two workers' instructions", why: "‘Researcher’ and ‘writer’ are placeholders for the two halves of YOUR job. The split is the design decision." },
        { where: "Max activations, on the team node", why: "12 is generous for three members. Lowering it is the cheapest way to bound a supervisor that re-delegates too eagerly." },
        { where: "The cost ceiling", why: "A team spends more than one agent and the ceiling is what turns a runaway into a CeilingExceeded rather than an invoice." },
      ],
      patternNote:
        "Supervisor and workers is for work that decomposes into pieces needing DIFFERENT context. "
        + "If every piece needs the same context, one agent doing it in several iterations is "
        + "cheaper and easier to debug.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Manual start", { triggerType: "manual", type: "manual" });
      const team = teamNode("Research and write", {
        policy: "supervisor",
        entryAlias: "supervisor",
        objective: "Produce the brief the input asks for.",
        joinPolicy: { kind: "wait_all" },
        onChildFailure: "continue",
        roster: [
          { agentId: refs.agents.lead, alias: "supervisor", role: "supervisor", canDelegateTo: ["researcher", "writer"] },
          { agentId: refs.agents.researcher, alias: "researcher", role: "worker", canDelegateTo: [] },
          { agentId: refs.agents.writer, alias: "writer", role: "worker", canDelegateTo: [] },
        ],
        limits: {
          maxDepth: 2, maxActivations: 8, maxHandoffsPerPair: 2,
          maxTeamDurationMs: 600_000, maxContextChars: null,
          maxRounds: 4, maxIterations: 6, maxToolCalls: 0,
        },
        budget: STARTER_BUDGET,
      });
      const commit = node("checkpoint", "Commit the draft", { scope: "run" });
      const out = node("output", "Emit the document", { format: "json", destination: "run" });
      const end = node("end", "Done");
      return chain([trigger, team, commit, out, end]);
    },
  },

  /* ────────────────────────────────────────────────────── 3. router + experts */
  {
    id: "router-and-specialists",
    name: "Router and specialists",
    summary: "One agent reads the request and hands it to exactly one specialist.",
    pattern: "router",
    category: "support",
    difficulty: "intermediate",
    requiresConnection: "llm",
    requiresFeatures: ["teams"],
    requiresFlags: ["agentTeams"],
    agents: [
      {
        ref: "router",
        name: "Request router",
        type: "router_agent",
        role: "router",
        instructions:
          "You read one inbound request and transfer it to exactly one specialist: billing for "
          + "anything about money, technical for anything about the product not working. Transfer "
          + "once. Do not attempt to answer the request yourself.",
        maxIterations: 2,
      },
      {
        ref: "billing",
        name: "Billing specialist",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You answer billing questions: invoices, charges, refunds, plan changes. State what you "
          + "would need to look up rather than inventing an amount.",
        maxIterations: 4,
      },
      {
        ref: "technical",
        name: "Technical specialist",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You answer questions about the product not working. Ask for the one piece of "
          + "information that would most narrow the cause, rather than listing everything it could be.",
        maxIterations: 4,
      },
    ],
    optionalTools: [],
    sampleInput: {
      request: "I was charged twice for March and the second charge has not been refunded.",
    },
    doc: {
      whatItDoes:
        "A router classifies one request and TRANSFERS it — a tail call, so control does not come "
        + "back and the specialist's answer is the team's answer. The router's own activation ends "
        + "`handed_off`, which is terminal and graded as neither success nor failure.",
      whatItNeeds: [
        "One LLM connection.",
        "A plan that includes agent teams. Delegation is NOT required — a router transfers.",
        "AGENT_TEAMS_ENABLED on in the deployment.",
      ],
      costPerRun: {
        range: "about 4–10¢",
        drivers: [
          "Two agents run per request, not three — the router and whichever specialist it picked",
          "The specialist's iteration count",
        ],
        ceiling: "25¢ and 60k tokens for the team.",
      },
      changeFirst: [
        { where: "The router's instructions", why: "The two categories are the routing table. Adding a third means adding a specialist and a grant, in that order." },
        { where: "The specialists' instructions", why: "A router is only as good as the difference between where it can send things." },
        { where: "Nothing about depth", why: "A transfer does not grow the delegation depth, so the depth limit has no effect on this shape. Do not spend time tuning it." },
      ],
      patternNote:
        "Reach for a router when the request decides WHO should handle it and one handler is "
        + "enough. If the answer needs two specialists to contribute, that is a supervisor.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Manual start", { triggerType: "manual", type: "manual" });
      const team = teamNode("Route the request", {
        policy: "router",
        entryAlias: "router",
        objective: "Route this request to the right specialist and return their answer.",
        joinPolicy: { kind: "wait_all" },
        onChildFailure: "continue",
        roster: [
          { agentId: refs.agents.router, alias: "router", role: "router", canDelegateTo: ["billing", "technical"] },
          { agentId: refs.agents.billing, alias: "billing", role: "worker", canDelegateTo: [] },
          { agentId: refs.agents.technical, alias: "technical", role: "worker", canDelegateTo: [] },
        ],
        limits: {
          maxDepth: 1, maxActivations: 4, maxHandoffsPerPair: 1,
          maxTeamDurationMs: 300_000, maxContextChars: null,
          maxRounds: 4, maxIterations: 4, maxToolCalls: 0,
        },
        budget: STARTER_BUDGET,
      });
      const commit = node("checkpoint", "Commit the answer", { scope: "run" });
      const out = node("output", "Emit the answer", { format: "json", destination: "run" });
      const end = node("end", "Done");
      return chain([trigger, team, commit, out, end]);
    },
  },

  /* ──────────────────────────────────────────────────────── 4. review loop */
  {
    id: "draft-and-review",
    name: "Draft and review",
    summary: "One agent drafts, another reviews, for a bounded number of rounds.",
    pattern: "review",
    category: "growth",
    difficulty: "intermediate",
    requiresConnection: "llm",
    requiresFeatures: ["teams", "delegation"],
    requiresFlags: ["agentTeams", "agentDelegation"],
    agents: [
      {
        ref: "drafter",
        name: "Drafter",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You write a first draft from a brief, then revise it against the reviewer's notes. "
          + "Change only what the notes ask for; a rewrite makes the next review useless.",
        maxIterations: 5,
      },
      {
        ref: "reviewer",
        name: "Reviewer",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You review a draft against the brief. Either approve it, or give at most three specific "
          + "changes. Say APPROVED as the first word when it is good enough — a review that never "
          + "approves is a loop that only the round limit ends.",
        maxIterations: 4,
      },
    ],
    optionalTools: [],
    sampleInput: {
      brief: "A 150-word release note for durable resume across approvals, for existing customers.",
    },
    doc: {
      whatItDoes:
        "The drafter writes, delegates to the reviewer, and revises — for at most the configured "
        + "number of rounds. A ‘round’ here is not a second counter: it resolves onto the "
        + "repeated-handoff guard, which counts how many times the same (from, to, task) triple "
        + "may repeat. One bound, not two that can disagree.",
      whatItNeeds: [
        "One LLM connection.",
        "A plan that includes agent teams and delegation.",
        "AGENT_TEAMS_ENABLED and AGENT_ACTIVATIONS_ENABLED on in the deployment.",
      ],
      costPerRun: {
        range: "about 6–25¢",
        drivers: [
          "The number of rounds actually used — a reviewer that never approves uses all of them",
          "Draft length, which both agents pay for on every round",
        ],
        ceiling: "25¢ and 60k tokens for the team; 3 rounds.",
      },
      changeFirst: [
        { where: "The reviewer's approval condition", why: "‘APPROVED as the first word’ is the exit. Vague approval criteria are why review loops run to the round limit every time." },
        { where: "Max rounds", why: "3 is a starting point. Watch the first ten runs: if they all use 3, the exit condition is wrong, not the limit." },
        { where: "The brief in the sample input", why: "It is a release note. Yours is not." },
      ],
      patternNote:
        "A review loop is worth its cost when a wrong answer is expensive and a second read "
        + "reliably catches it. It is not a general quality improvement — two agents agreeing is "
        + "not evidence, and you pay for both every round.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Manual start", { triggerType: "manual", type: "manual" });
      const team = teamNode("Draft and review", {
        policy: "review",
        entryAlias: "drafter",
        objective: "Produce a draft that the reviewer approves.",
        joinPolicy: { kind: "wait_all" },
        onChildFailure: "fail_parent",
        roster: [
          { agentId: refs.agents.drafter, alias: "drafter", role: "worker", canDelegateTo: ["reviewer"] },
          { agentId: refs.agents.reviewer, alias: "reviewer", role: "reviewer", canDelegateTo: [] },
        ],
        limits: {
          maxDepth: 2, maxActivations: 8, maxHandoffsPerPair: 3,
          maxTeamDurationMs: 600_000, maxContextChars: null,
          maxRounds: 3, maxIterations: 5, maxToolCalls: 0,
        },
        budget: STARTER_BUDGET,
      });
      const commit = node("checkpoint", "Commit the approved draft", { scope: "run" });
      const out = node("output", "Emit the draft", { format: "json", destination: "run" });
      const end = node("end", "Done");
      return chain([trigger, team, commit, out, end]);
    },
  },

  /* ───────────────────────────────────────────── 5. human in the loop */
  {
    id: "human-approval-before-send",
    name: "Draft, approve, then send",
    summary: "An agent drafts a reply, a person approves it, and only then does it go out.",
    pattern: "approval",
    category: "operations",
    difficulty: "starter",
    requiresConnection: "llm",
    requiresFeatures: [],
    requiresFlags: [],
    agents: [{
      ref: "responder",
      name: "Reply drafter",
      type: "iterative_agent",
      role: "worker",
      instructions:
        "You draft a reply to an inbound customer message. Keep it under 120 words, answer the "
        + "question that was asked, and never promise a refund, a date or a discount — flag those "
        + "for a human instead of committing to them.",
      maxIterations: 4,
    }],
    optionalTools: [],
    sampleInput: {
      message: "You charged me twice for March. Can you sort this out today?",
      customerEmail: "customer@example.com",
    },
    doc: {
      whatItDoes:
        "The agent drafts, the run PARKS at an approval gate, and the send happens only after a "
        + "person decides. The park is durable: the run is not holding a worker while it waits, "
        + "and it resumes from the checkpoint rather than from the beginning — which is why an "
        + "approval that takes three days costs nothing but the wait.",
      whatItNeeds: [
        "One LLM connection.",
        "An approver group on the gate, and an email address on the send step.",
      ],
      costPerRun: {
        range: "about 1–3¢, plus however long a person takes",
        drivers: ["Draft length", "Nothing about the wait — parked time is not charged as agent time"],
        ceiling: "25¢ and 60k tokens on the agent; the gate has an SLA, not a budget.",
      },
      changeFirst: [
        { where: "The gate's approver group", why: "It ships empty, which would hold the run indefinitely because nobody is asked." },
        { where: "The gate's SLA and timeout behaviour", why: "Decide now what happens to a reply nobody approved in four hours. Escalating and cancelling are both defensible; silence is not." },
        { where: "The email node's To field", why: "It ships empty and fails with a message saying so." },
      ],
      patternNote:
        "Put the gate BEFORE the side effect, never after. The point is that nothing irreversible "
        + "happens without a decision — a gate after the send is an audit trail, not a control.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Manual start", { triggerType: "manual", type: "manual" });
      const draft = node("agent", "Draft the reply", {
        agentId: refs.agents.responder,
        agentName: "Reply drafter",
        maxSteps: 4,
        timeoutMs: 120_000,
        toolGrants: [],
        budget: STARTER_BUDGET,
      });
      const commit = node("checkpoint", "Commit the draft", { scope: "run" });
      const gate = node("approval", "A person approves the reply", {
        approverGroup: "",
        slaMinutes: 240,
        onTimeout: "escalate",
        summary: "{{steps.Draft the reply.output.text}}",
      });
      const send = emailNode(
        "Send the reply",
        refs.notifyEmail,
        "Re: your message",
        "<p>{{steps.Draft the reply.output.text}}</p>",
      );
      const end = node("end", "Done");
      return chain([trigger, draft, commit, gate, send, end]);
    },
  },

  /* ────────────────────────────────────────────────────── 6. scheduled batch */
  {
    id: "scheduled-batch-digest",
    name: "Scheduled batch digest",
    summary: "Every weekday morning, summarise a list of items and email one digest.",
    pattern: "batch",
    category: "operations",
    difficulty: "starter",
    requiresConnection: "llm",
    requiresFeatures: [],
    requiresFlags: [],
    agents: [{
      ref: "summariser",
      name: "Digest writer",
      type: "iterative_agent",
      role: "worker",
      instructions:
        "You summarise one item in a single sentence that says what happened and why it matters. "
        + "No preamble, no restating the input.",
      maxIterations: 2,
    }],
    optionalTools: [],
    sampleInput: {
      items: [
        { id: "1", title: "Payment retry succeeded", detail: "cus_demo_1, third attempt" },
        { id: "2", title: "Connection expired", detail: "Postgres prod, credential rotated" },
      ],
    },
    doc: {
      whatItDoes:
        "Fans out over a list, summarises each item concurrently, merges the summaries and emails "
        + "one digest. It runs on a cron with `overlapPolicy: skip`, so a slow run does not stack "
        + "up behind itself.",
      whatItNeeds: [
        "One LLM connection.",
        "An email address on the digest step.",
        "A source for `items` — the sample input is two rows so the first run works with none.",
      ],
      costPerRun: {
        range: "about 1¢ per item",
        drivers: [
          "The number of items — this is the one template whose cost scales with input SIZE",
          "Concurrency does not change the cost, only the wall clock",
        ],
        ceiling: "25¢ and 60k tokens per run, so roughly 25 items before the ceiling stops it.",
      },
      changeFirst: [
        { where: "Where `items` comes from", why: "The sample list is two hard-coded rows. Until you replace it, the digest is a demo." },
        { where: "The cron and timezone", why: "It ships at 09:00 UTC on weekdays, which is the middle of the night for about half the world." },
        { where: "Max concurrency on the fan-out", why: "8 is fine for a model connection with normal rate limits and too many for a tight one. A 429 storm looks like a broken workflow." },
      ],
      patternNote:
        "A fan-out with a merge is the shape for per-item work whose results are independent. "
        + "If item two needs item one's answer, this is a pipeline and the fan-out is wrong.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Weekday mornings", {
        triggerType: "cron",
        type: "cron",
        cron: "0 9 * * 1-5",
        cronExpression: "0 9 * * 1-5",
        timezone: "UTC",
        // A slow run must not stack up behind itself: two digests for one
        // morning is worse than one late digest.
        overlapPolicy: "skip",
      });
      const fan = node("parallel", "One per item", { over: "{{input.items}}", maxConcurrency: 8 });
      const summarise = node("agent", "Summarise the item", {
        agentId: refs.agents.summariser,
        agentName: "Digest writer",
        maxSteps: 2,
        timeoutMs: 120_000,
        toolGrants: [],
        budget: STARTER_BUDGET,
      });
      const merge = node("merge", "Collect the summaries", { strategy: "concat" });
      const commit = node("checkpoint", "Commit the digest", { scope: "run" });
      const email = emailNode(
        "Email the digest",
        refs.notifyEmail,
        "Daily digest",
        "<p>{{steps.Collect the summaries.output.text}}</p>",
      );
      const end = node("end", "Done");
      return chain([trigger, fan, summarise, merge, commit, email, end]);
    },
  },
];

export function templateById(id: string): WorkflowTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

export const PATTERN_LABEL: Record<TemplatePattern, string> = {
  "single-agent": "Single agent",
  supervisor: "Supervisor and workers",
  router: "Router and specialists",
  review: "Review loop",
  approval: "Human in the loop",
  batch: "Scheduled batch",
};

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  support: "Support",
  growth: "Growth",
  data: "Data",
  engineering: "Engineering",
  operations: "Operations",
  billing: "Billing",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  starter: "Starter",
  intermediate: "Intermediate",
  advanced: "Advanced",
};
