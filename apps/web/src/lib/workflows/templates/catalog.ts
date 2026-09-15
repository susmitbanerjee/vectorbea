import type { BuilderGraph, BuilderEdge, GraphNode } from "../builder-graph";

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

   · NOTHING BEHIND A RUNTIME FLAG. This one was learned the expensive way.
     Three templates here — supervisor, router and review loop — were built on
     the `agent_team` node, which `AgentTeamNodeExecutor` refuses unless
     AGENT_TEAMS_ENABLED is true, and that defaults to false in the worker and in
     the web build. So the gallery's three most interesting cards were permanently
     disabled, each under a paragraph naming an environment variable that means
     nothing to the person reading it. A catalogue where half the shelf is
     labelled "not available here" does not read as a product with an unreleased
     feature; it reads as a product that does not work, which is the first
     impression templates exist to prevent.

     They are gone rather than hidden behind a flag check, because a card nobody
     can click is worth less than the space it occupies, and the pattern they
     demonstrated is still here: `pipeline` chains several agents without the
     team primitive. Bring them back WITH the feature, not before it.

   ── PATTERNS, NOT SCENARIOS ─────────────────────────────────────────────────
   Each template is one ORCHESTRATION PATTERN with a plausible job attached, not
   a vertical solution. Somebody adopting "agent pipeline" is going to replace
   the job; what they are keeping is the shape, the guards and the budget. So the
   documentation leads with the shape.
══════════════════════════════════════════════════════════════════════════════ */

export type TemplatePattern =
  | "single-agent" | "approval" | "batch"
  /**
   * Several agents, wired in sequence, each with its own instructions and its
   * own grants.
   *
   * ── THIS IS THE MULTI-AGENT PATTERN THE CATALOGUE SHIPS ─────────────────
   * `agent` nodes chained by ordinary edges are several agents doing several
   * jobs — the thing people actually mean by multi-agent — with no team
   * primitive, no delegation, no plan feature and no flag.
   *
   * A supervisor is for when the SPLIT is a runtime decision. When the split is
   * known in advance, which is most of the time, a pipeline is cheaper, easier
   * to debug, and — unlike a team — runnable in a default deployment today.
   */
  | "pipeline";

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
  /**
   * Runtime flags that must be on. Mirrors the worker's env switches.
   *
   * Empty on every shipped template, and kept anyway. The gallery still checks
   * it and still disables a card whose flag is off, which is the guard that
   * makes re-adding a flagged template a visible decision rather than a silent
   * one — see the note at the top of this file about what happened last time.
   */
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

/* There is deliberately no `teamNode` helper here any more. An `agent_team`
   node cannot run in a default deployment (AGENT_TEAMS_ENABLED defaults false),
   so a helper that makes one easy to add is a trap: the next template built on
   it would install cleanly and be permanently disabled in the gallery, which is
   exactly the state this file was just dug out of. Multi-agent templates use
   the `pipeline` pattern. */

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

  /* ───────────────────────────────────────────── 2. human in the loop */
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

  /* ────────────────────────────────────────────────────── 3. scheduled batch */
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

  /* ═══════════════════════════════════════════════════════════════════════════
     AGENT PIPELINES — multi-agent, and installable in a default deployment.

     Each of these is three or four agents with DIFFERENT instructions and
     different grants, wired in sequence. No team node, so no `agentTeams`, no
     `agentDelegation`, no plan feature: one model connection and they run.

     They are named after the problem rather than the shape, because the
     question somebody brings to this page is "does this solve mine", not "what
     can this build". The pattern note still says what the shape is for, since
     the shape is what they keep after replacing the job.
     ═══════════════════════════════════════════════════════════════════════ */

  /* ──────────────────────────────────────── 4. incident first response */
  {
    id: "incident-first-response",
    name: "Incident first response",
    summary:
      "A page fires at 03:00 and the first person awake spends twenty minutes working out what changed. Three agents do that first and hand them a written hypothesis to approve.",
    pattern: "pipeline",
    category: "operations",
    difficulty: "intermediate",
    requiresConnection: "llm",
    requiresFeatures: [],
    requiresFlags: [],
    agents: [
      {
        ref: "gatherer",
        name: "Signal gatherer",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You are given an alert payload. Extract and organise every fact it contains: which "
          + "service, which metric, the threshold crossed, when it started, and anything the "
          + "payload says about recent changes.\n\n"
          + "Report ONLY what the payload supports. If it does not say when the problem started, "
          + "say that. An invented timeline at 03:00 costs more than a missing one.",
        maxIterations: 4,
      },
      {
        ref: "analyst",
        name: "Cause analyst",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You are given organised facts about a live incident. Produce exactly four things:\n"
          + "1. The single most likely cause, stated plainly.\n"
          + "2. The evidence that supports it.\n"
          + "3. The evidence that contradicts it, if any.\n"
          + "4. The first thing an engineer should check to confirm or rule it out.\n\n"
          + "If the facts do not support a hypothesis, say so and stop. A confident wrong answer "
          + "sends the on-call engineer down the wrong path, which is worse than no answer.",
        maxIterations: 4,
      },
      {
        ref: "writer",
        name: "Response writer",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "Write the incident channel's first-response message from the hypothesis you are given. "
          + "Lead with impact, then the hypothesis, then what is being checked. Under 200 words. "
          + "No apologies, no filler, no severity emoji. Do not add facts the analyst did not give you.",
        maxIterations: 3,
      },
    ],
    optionalTools: [],
    sampleInput: {
      alert: "checkout-api p99 latency 4200ms, threshold 800ms, firing 6 minutes",
      service: "checkout-api",
      recentDeploys: "checkout-api v412 deployed 18 minutes ago",
    },
    doc: {
      whatItDoes:
        "Three agents in sequence, each with one job: one organises the alert into facts, one "
        + "forms a single hypothesis from those facts and nothing else, and one writes the message "
        + "that gets posted. A person approves before it reaches the channel. The split is the "
        + "point — the analyst cannot go looking for more data at 03:00 because it has no tools, "
        + "and the writer cannot change the hypothesis because it is a separate step.",
      whatItNeeds: [
        "One LLM connection. Nothing else.",
        "An email address on the notification step.",
        "A webhook trigger pointed at your alerting, once the output looks right.",
      ],
      costPerRun: {
        range: "about 4–9¢",
        drivers: [
          "Three agents, so three sets of context",
          "The size of the alert payload",
          "How much the gatherer finds to organise",
        ],
        ceiling: "25¢ and 60k tokens per agent.",
      },
      changeFirst: [
        { where: "The analyst's instructions", why: "The four outputs are the shape of YOUR incident review. If your team wants a blast-radius estimate, this is where it goes." },
        { where: "The approval gate's SLA", why: "Ten minutes is right for a page. For a lower severity it is wrong, and a gate that times out during an incident is worse than no gate." },
        { where: "The trigger", why: "It ships manual so the first run is under your control. Point it at your alerting webhook once you trust the output." },
      ],
      patternNote:
        "A pipeline is for work that decomposes into a KNOWN sequence of judgements, each needing "
        + "different context. Gather, then reason, then write — the order is fixed, so it does not "
        + "need a supervisor deciding it at runtime. Reach for the supervisor pattern only when "
        + "which steps run is itself a decision.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Alert received", { triggerType: "manual", type: "manual" });
      const gather = node("agent", "Organise the alert", {
        agentId: refs.agents.gatherer,
        agentName: "Signal gatherer",
        taskOverride: "Organise this alert payload into the facts it supports.",
        maxSteps: 4, timeoutMs: 120_000, toolGrants: [], budget: STARTER_BUDGET,
      });
      /* Committed before the reasoning, so a failure later never re-does the
         gathering — the cheap step protecting the expensive one. */
      const commit = node("checkpoint", "Commit the evidence", { scope: "run" });
      const analyse = node("agent", "Form a hypothesis", {
        agentId: refs.agents.analyst,
        agentName: "Cause analyst",
        taskOverride: "Form one hypothesis from these facts. No tools — reason over what you were given.",
        maxSteps: 4, timeoutMs: 120_000, toolGrants: [], budget: STARTER_BUDGET,
      });
      const write = node("agent", "Write the response", {
        agentId: refs.agents.writer,
        agentName: "Response writer",
        taskOverride: "Write the incident channel's first-response message.",
        maxSteps: 3, timeoutMs: 90_000, toolGrants: [], budget: STARTER_BUDGET,
      });
      const gate = node("approval", "On-call approves", {
        approverGroup: "on-call", slaMinutes: 10,
        prompt: "An agent's hypothesis is about to be posted to the incident channel. Read it first.",
      });
      const email = emailNode(
        "Send the first response",
        refs.notifyEmail,
        "Incident: {{input.service}}",
        "<p>{{steps.Write the response.output}}</p>",
      );
      const out = node("output", "Incident summary", { format: "json", destination: "run" });
      const end = node("end", "Done");
      return chain([trigger, gather, commit, analyse, write, gate, email, out, end]);
    },
  },

  /* ──────────────────────────────────────── 5. draft, check, approve */
  {
    id: "reply-draft-and-check",
    name: "Customer reply, drafted and checked",
    summary:
      "First replies go out wrong because whoever picked up the ticket did not have the history. One agent assembles it, one drafts, one checks the draft against it — then a person sends.",
    pattern: "pipeline",
    category: "support",
    difficulty: "intermediate",
    requiresConnection: "llm",
    requiresFeatures: [],
    requiresFlags: [],
    agents: [
      {
        ref: "context",
        name: "Context assembler",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You are given a support ticket and whatever account information came with it. Assemble "
          + "the facts a support engineer would want before replying: what the customer asked, what "
          + "their account is, and anything in the history that bears on the question.\n\n"
          + "Report only what you were given. Do not interpret and do not draft — that is the next "
          + "agent's job.",
        maxIterations: 4,
      },
      {
        ref: "drafter",
        name: "Reply drafter",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "Draft a first reply from the assembled context. Answer the question if it is answerable "
          + "from what you have. If it is not, say what you need and why — never guess at a "
          + "technical detail or a date.\n\n"
          + "Match the customer's register. No 'I hope this finds you well', no 'circling back'.",
        maxIterations: 4,
      },
      {
        ref: "reviewer",
        name: "Reply reviewer",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "Review the draft against the assembled context. REJECT it if any of these is true: it "
          + "states a fact the context does not support, it promises a timeline, it contradicts "
          + "something in the history, or it answers a different question than the one asked.\n\n"
          + "Return JSON with the keys verdict ('approved' or 'rejected'), reason, and — when "
          + "rejected — the exact line at fault. A reviewer that never rejects is a rubber stamp; "
          + "say no when one of the four applies.",
        maxIterations: 3,
      },
    ],
    optionalTools: [{
      ref: "account-lookup",
      name: "Account lookup",
      type: "http",
      riskLevel: "low",
      requiresApproval: false,
      connectionKind: "http",
      config: { url: "https://example.invalid/accounts/{{input.accountId}}", method: "GET" },
      withoutIt: "The context assembler works from the ticket alone, without the account's history.",
    }],
    sampleInput: {
      ticket: "We were charged twice for March and the second charge has not been refunded.",
      accountId: "acct_demo_1",
    },
    doc: {
      whatItDoes:
        "Three agents and a gate. The first assembles context, the second drafts a reply from it, "
        + "and the third checks the draft against the same context with explicit grounds for "
        + "refusing. Then a person sends it.\n\n"
        + "The drafter and the reviewer are separate agents on purpose. An agent asked to write "
        + "and then critique its own writing agrees with itself; a second agent given the original "
        + "context and four specific reasons to reject does not.",
      whatItNeeds: [
        "One LLM connection.",
        "An email address on the send step.",
        "Optionally an HTTP connection, which turns on the account-lookup tool.",
      ],
      costPerRun: {
        range: "about 5–12¢",
        drivers: [
          "Three agents over the same context",
          "Ticket length",
          "Whether the reviewer rejects and the draft is rewritten",
        ],
        ceiling: "25¢ and 60k tokens per agent.",
      },
      changeFirst: [
        { where: "The reviewer's four rejection grounds", why: "They are the actual quality bar. Generic ones produce a reviewer that approves everything, which is the failure mode this pattern exists to avoid." },
        { where: "The drafter's register instruction", why: "'Match the customer's register' is a starting point. Your support voice is a real thing and this is where it goes." },
        { where: "The approval gate", why: "Leave it on until you have watched twenty of these. Two agents agreeing is not the same as being right, and the recipient is a real customer." },
      ],
      patternNote:
        "Draft-then-check is the shape for anything a customer will read. The value is in the "
        + "reviewer having the SOURCE rather than only the draft — a reviewer given just the output "
        + "can check it for tone and nothing else.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Ticket received", { triggerType: "manual", type: "manual" });
      const context = node("agent", "Assemble the context", {
        agentId: refs.agents.context,
        agentName: "Context assembler",
        taskOverride: "Assemble the facts needed to reply to this ticket.",
        maxSteps: 4, timeoutMs: 120_000,
        toolGrants: refs.tools["account-lookup"] ? [refs.tools["account-lookup"]] : [],
        budget: STARTER_BUDGET,
      });
      const commit = node("checkpoint", "Commit the context", { scope: "run" });
      const draft = node("agent", "Draft the reply", {
        agentId: refs.agents.drafter,
        agentName: "Reply drafter",
        taskOverride: "Draft the first reply from this context.",
        maxSteps: 4, timeoutMs: 120_000, toolGrants: [], budget: STARTER_BUDGET,
      });
      const review = node("agent", "Check the draft", {
        agentId: refs.agents.reviewer,
        agentName: "Reply reviewer",
        taskOverride: "Check this draft against the context. Return verdict, reason and the line at fault.",
        maxSteps: 3, timeoutMs: 90_000, toolGrants: [], budget: STARTER_BUDGET,
      });
      const gate = node("approval", "Support sends", {
        approverGroup: "support", slaMinutes: 120,
        prompt: "Two agents have drafted and checked this reply. Read it before it reaches the customer.",
      });
      const email = emailNode(
        "Send the reply",
        refs.notifyEmail,
        "Re: your ticket",
        "<p>{{steps.Draft the reply.output}}</p>",
      );
      const out = node("output", "Reply and verdict", { format: "json", destination: "run" });
      const end = node("end", "Done");
      return chain([trigger, context, commit, draft, review, gate, email, out, end]);
    },
  },

  /* ──────────────────────────────────────── 6. weekly competitive brief */
  {
    id: "competitive-brief",
    name: "Weekly competitor brief",
    summary:
      "Sales finds out a competitor shipped something when a prospect mentions it on a call. Three agents read the week's changes, work out what they mean, and write the objection handling.",
    pattern: "pipeline",
    category: "growth",
    difficulty: "intermediate",
    requiresConnection: "llm",
    requiresFeatures: [],
    requiresFlags: [],
    agents: [
      {
        ref: "reader",
        name: "Change reader",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "You are given this week's competitor material and last week's. Report ONLY what "
          + "changed: pricing, packaging, a shipped capability, or a positioning shift.\n\n"
          + "'No change' is a complete and useful answer. Never infer a change from wording you "
          + "are unsure about — a brief built on an imagined change is worse than a short one.",
        maxIterations: 5,
      },
      {
        ref: "analyst",
        name: "Positioning analyst",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "For each change, say whether it closes a gap the competitor had, opens one for us, or "
          + "is noise. Be willing to say a change is bad for us — a brief that never concedes "
          + "anything is not read twice, and the sales team will already know.",
        maxIterations: 4,
      },
      {
        ref: "objections",
        name: "Objection writer",
        type: "iterative_agent",
        role: "worker",
        instructions:
          "For each change a prospect might raise, write the objection in the words they would "
          + "use, and the honest response.\n\n"
          + "Where the honest response is 'they are better at that', write exactly that and then "
          + "what we lead with instead. A rep who repeats a claim that does not survive the next "
          + "question has been made worse off, not better.",
        maxIterations: 4,
      },
    ],
    optionalTools: [{
      ref: "fetch-page",
      name: "Public page fetch",
      type: "http",
      riskLevel: "low",
      requiresApproval: false,
      connectionKind: "http",
      config: { url: "{{input.url}}", method: "GET" },
      withoutIt: "The reader works from material you paste into the run input instead of fetching it.",
    }],
    sampleInput: {
      competitor: "Example Corp",
      thisWeek: "Pricing page now lists a Team tier at $49/seat with SSO included.",
      lastWeek: "Pricing page listed Starter and Enterprise only. SSO was Enterprise-only.",
    },
    doc: {
      whatItDoes:
        "Three agents in sequence: one reports what changed, one says what it means for your "
        + "positioning, one writes what a rep says on a call. Runs weekly and posts the brief.\n\n"
        + "The split matters because the three are different skills. A single agent asked to do "
        + "all three reliably blurs 'what changed' into 'what I think about what changed', and "
        + "the brief stops being checkable.",
      whatItNeeds: [
        "One LLM connection.",
        "An email address for the brief.",
        "Optionally an HTTP connection, which lets the reader fetch public pages instead of being given them.",
      ],
      costPerRun: {
        range: "about 6–15¢",
        drivers: ["How many competitors you track", "How much changed", "Page length when fetching"],
        ceiling: "25¢ and 60k tokens per agent.",
      },
      changeFirst: [
        { where: "The run input", why: "It ships with one example competitor. The list of who you track is the template's real configuration." },
        { where: "The trigger", why: "Manual to start. A Friday-afternoon cron is the cadence this is designed for — weekly, so it is read before Monday's calls." },
        { where: "The objection writer's instructions", why: "Its honesty rule is the thing that makes the brief trusted. Softening it produces a document sales stops opening." },
      ],
      patternNote:
        "Observe, interpret, act — three agents because the three are checkable separately. When "
        + "the brief is wrong you can see WHICH step was wrong, which is the practical argument "
        + "for a pipeline over one agent with a long prompt.",
    },
    build: (refs) => {
      const trigger = node("trigger", "Manual start", { triggerType: "manual", type: "manual" });
      const read = node("agent", "Find what changed", {
        agentId: refs.agents.reader,
        agentName: "Change reader",
        taskOverride: "Report only what changed between this week's material and last week's.",
        maxSteps: 5, timeoutMs: 150_000,
        toolGrants: refs.tools["fetch-page"] ? [refs.tools["fetch-page"]] : [],
        budget: STARTER_BUDGET,
      });
      const commit = node("checkpoint", "Commit the change list", { scope: "run" });
      const analyse = node("agent", "Read the implications", {
        agentId: refs.agents.analyst,
        agentName: "Positioning analyst",
        taskOverride: "Say what each change means for our positioning.",
        maxSteps: 4, timeoutMs: 120_000, toolGrants: [], budget: STARTER_BUDGET,
      });
      const objections = node("agent", "Write the objection handling", {
        agentId: refs.agents.objections,
        agentName: "Objection writer",
        taskOverride: "Write each likely objection and the honest response.",
        maxSteps: 4, timeoutMs: 120_000, toolGrants: [], budget: STARTER_BUDGET,
      });
      const email = emailNode(
        "Send the brief",
        refs.notifyEmail,
        "Competitor brief: {{input.competitor}}",
        "<p>{{steps.Read the implications.output}}</p><hr/>"
        + "<p>{{steps.Write the objection handling.output}}</p>",
      );
      const out = node("output", "Weekly brief", { format: "json", destination: "run" });
      const end = node("end", "Done");
      return chain([trigger, read, commit, analyse, objections, email, out, end]);
    },
  },
];

export function templateById(id: string): WorkflowTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

export const PATTERN_LABEL: Record<TemplatePattern, string> = {
  "single-agent": "Single agent",
  pipeline: "Agent pipeline",
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
