import { CONNECTIONS } from "./fixtures";
import { toolNode, llmNode, agentNode, type VersionNode } from "./workflow-nodes";
import { simulateVersion } from "./workflow-versions";
import type { NodeKind } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   TEMPLATES

   The existing information design is sound — category, difficulty, runtime,
   integrations — so it is kept. What was missing is the thing that decides
   whether a template is usable: WHAT YOU DO NOT HAVE YET.

   "Needs HubSpot, Slack, Postgres" is a list. "You have Slack and Postgres
   connected; this also needs HubSpot" is the actual cost of adopting it, and it
   is knowable before the click rather than three screens into a wizard.
══════════════════════════════════════════════════════════════════════════════ */

export type TemplateCategory =
  | "billing" | "support" | "growth" | "data" | "engineering" | "operations";

export type Difficulty = "starter" | "intermediate" | "advanced";

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  billing: "Billing",
  support: "Support",
  growth: "Growth",
  data: "Data",
  engineering: "Engineering",
  operations: "Operations",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  starter: "Starter",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export const DIFFICULTY_HELP: Record<Difficulty, string> = {
  starter: "One trigger, a handful of steps, no branching. Runs as soon as its connections exist.",
  intermediate: "Branching or a fan-out, and usually one approval gate to configure.",
  advanced: "Multiple branches, gates and a retry policy worth reading before you publish.",
};

export interface TemplateNode extends VersionNode {
  /** Why this step is in the template. Shown per node in the preview. */
  purpose: string;
}

export interface Template {
  id: string;
  name: string;
  summary: string;
  category: TemplateCategory;
  difficulty: Difficulty;
  /** Typical wall-clock for one run. */
  runtimeMs: number;
  /** Provider ids the template binds — resolved against the workspace's connections. */
  integrations: string[];
  nodes: TemplateNode[];
  /** Community templates carry an author; first-party ones do not. */
  author: string | null;
  usageCount: number;
  updatedAt: string;
}

const NOW = new Date("2026-08-11T14:20:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

/** Attach a purpose to a node. Templates explain themselves step by step. */
const withPurpose = (node: VersionNode, purpose: string): TemplateNode => ({ ...node, purpose });

const plain = (kind: NodeKind, id: string, name: string, config: Record<string, unknown> = {}): VersionNode =>
  ({ id, name, kind, config });

/* ── First-party catalogue ────────────────────────────────────────────────── */

export const TEMPLATES: Template[] = [
  {
    id: "tpl-renewal-outreach",
    name: "Renewal outreach",
    summary: "Finds contracts renewing soon, drafts the outreach, and posts the batch for a human to send.",
    category: "billing",
    difficulty: "intermediate",
    runtimeMs: 48_000,
    integrations: ["postgres", "slack"],
    author: null,
    usageCount: 1_284,
    updatedAt: iso(NOW - 9 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Daily at 06:00", { cron: "0 6 * * *", timezone: "UTC" }), "Runs before the working day so the batch is waiting when billing arrives."),
      withPurpose(toolNode("t2", "Fetch upcoming renewals", "contracts.getUpcomingRenewals", "Postgres Answers"), "Reads the contracts renewing inside the window. The window is a parameter you set."),
      withPurpose(plain("checkpoint", "t3", "Commit checkpoint"), "Commits after the read, so a failure later never re-queries the database."),
      withPurpose(llmNode("t4", "Draft the outreach"), "Writes one message per account from the contract facts, rather than a template with holes in it."),
      withPurpose(plain("approval", "t5", "Billing approves the batch", { approverGroup: "billing", slaMinutes: 240 }), "A person reads the drafts before anything reaches a customer. This is the gate that makes the template safe to run unattended."),
      withPurpose(toolNode("t6", "Post to #billing-ops", "slack.postMessage", "Slack — Acme"), "Posts the approved batch where the team already works."),
    ],
  },
  {
    id: "tpl-ticket-triage",
    name: "Support ticket triage",
    summary: "Classifies inbound tickets, tags them, and routes anything urgent to the on-call rota.",
    category: "support",
    difficulty: "starter",
    runtimeMs: 9_000,
    integrations: ["slack"],
    author: null,
    usageCount: 2_940,
    updatedAt: iso(NOW - 3 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Webhook from the helpdesk", { }), "Fires the moment a ticket is created, so triage happens before a human reads it."),
      withPurpose(llmNode("t2", "Classify intent and urgency"), "Reads the ticket and returns a structured classification rather than prose."),
      withPurpose(plain("branch", "t3", "Urgent?", { condition: "urgency == 'high'" }), "Splits the path. Urgent tickets page the rota; the rest are only tagged."),
      withPurpose(toolNode("t4", "Page the on-call rota", "slack.postMessage", "Slack — Acme"), "Posts into the on-call channel with the ticket summary attached."),
    ],
  },
  {
    id: "tpl-dunning",
    name: "Dunning escalation",
    summary: "Chases a failed payment through three escalating touches, then hands the account to a human.",
    category: "billing",
    difficulty: "advanced",
    runtimeMs: 120_000,
    integrations: ["stripe", "gmail", "hubspot"],
    author: null,
    usageCount: 612,
    updatedAt: iso(NOW - 21 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Payment failed webhook"), "Starts on the failure event rather than polling for it."),
      withPurpose(toolNode("t2", "Read the invoice", "stripe.getInvoice", "Stripe — Live"), "Fetches the amount and the customer so the message can be specific."),
      withPurpose(toolNode("t3", "Read the account", "hubspot.getContact", "HubSpot CRM"), "Adds account age and lifetime value, which decide how hard to chase."),
      withPurpose(plain("branch", "t4", "High value?", { condition: "ltv_gbp > 10000" }), "High-value accounts skip the automated sequence and go straight to a person."),
      withPurpose(toolNode("t5", "Send the first notice", "gmail.send", "Gmail — ops@"), "The first touch. Polite, with a payment link."),
      withPurpose(plain("wait", "t6", "Wait three days", { forMs: 259_200_000 }), "A durable wait — a crash during it resumes the wait rather than restarting the sequence."),
      withPurpose(plain("approval", "t7", "Collections approves escalation", { approverGroup: "billing", slaMinutes: 1440 }), "Escalating past the second notice is a commercial decision, so a person makes it."),
      withPurpose(plain("output", "t8", "Record the outcome"), "Writes the result back so the next run knows where this account got to."),
    ],
  },
  {
    id: "tpl-usage-rollup",
    name: "Daily usage rollup",
    summary: "Aggregates metered usage per account and writes the daily rollup to the warehouse.",
    category: "data",
    difficulty: "starter",
    runtimeMs: 32_000,
    integrations: ["postgres"],
    author: null,
    usageCount: 1_806,
    updatedAt: iso(NOW - 14 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Daily at midnight", { cron: "0 0 * * *", timezone: "UTC" }), "Runs after the day closes so the numbers are final."),
      withPurpose(toolNode("t2", "Read metered events", "postgres.query", "Postgres Answers"), "Pulls the raw events for the period."),
      withPurpose(plain("parallel", "t3", "Fan out per account", { maxConcurrency: 12 }), "One branch per account, so a slow account does not hold up the rest."),
      withPurpose(plain("merge", "t4", "Merge the rollups"), "Joins the per-account results back into one batch."),
      withPurpose(toolNode("t5", "Write the rollup", "postgres.insert", "Postgres Answers"), "One write for the whole batch rather than one per account."),
    ],
  },
  {
    id: "tpl-churn-signal",
    name: "Churn signal watch",
    summary: "Scores accounts on usage decay and opens a play for anything trending to churn.",
    category: "growth",
    difficulty: "intermediate",
    runtimeMs: 56_000,
    integrations: ["postgres", "hubspot", "slack"],
    author: null,
    usageCount: 447,
    updatedAt: iso(NOW - 30 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Weekly on Monday", { cron: "0 9 * * 1", timezone: "UTC" }), "Weekly is the right cadence — churn signals are noise at daily resolution."),
      withPurpose(toolNode("t2", "Read usage history", "postgres.query", "Postgres Answers"), "Twelve weeks of usage per account, which is what a decay score needs."),
      withPurpose(agentNode("t3", "Score and explain"), "Scores each account AND says which signal moved the number, so the play is actionable."),
      withPurpose(toolNode("t4", "Create the play", "hubspot.updateDeal", "HubSpot CRM"), "Opens the play against the account in the CRM."),
      withPurpose(toolNode("t5", "Notify the owner", "slack.postMessage", "Slack — Acme"), "Tells the account owner directly rather than filing it silently."),
    ],
  },
  {
    id: "tpl-incident-digest",
    name: "Incident digest",
    summary: "Collects the day's failures, clusters them by cause, and posts a digest with the top three.",
    category: "engineering",
    difficulty: "starter",
    runtimeMs: 14_000,
    integrations: ["slack"],
    author: null,
    usageCount: 891,
    updatedAt: iso(NOW - 6 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Daily at 17:00", { cron: "0 17 * * *", timezone: "UTC" }), "End of day, so the digest covers a whole working day."),
      withPurpose(toolNode("t2", "Read failed runs", "postgres.query", "Postgres Answers"), "Reads today's failures with their structured errors."),
      withPurpose(llmNode("t3", "Cluster by root cause"), "Turns forty failures into three causes, which is the only form anybody acts on."),
      withPurpose(toolNode("t4", "Post the digest", "slack.postMessage", "Slack — Acme"), "Posts the top three with counts and links."),
    ],
  },
];

/* ── Community ────────────────────────────────────────────────────────────── */

export const COMMUNITY_TEMPLATES: Template[] = [
  {
    id: "tpl-c-nps",
    name: "NPS follow-up",
    summary: "Reads free-text survey responses and opens a follow-up for every detractor.",
    category: "growth",
    difficulty: "starter",
    runtimeMs: 18_000,
    integrations: ["gmail", "hubspot"],
    author: "m.lindqvist",
    usageCount: 214,
    updatedAt: iso(NOW - 11 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Survey webhook"), "Fires on each response rather than batching, so follow-ups are same-day."),
      withPurpose(llmNode("t2", "Read the free text"), "Pulls the actionable complaint out of the prose."),
      withPurpose(plain("branch", "t3", "Detractor?", { condition: "score <= 6" }), "Only detractors get a follow-up; promoters get a thank-you."),
      withPurpose(toolNode("t4", "Open a follow-up", "hubspot.getContact", "HubSpot CRM"), "Files the follow-up against the contact who responded."),
    ],
  },
  {
    id: "tpl-c-contract-sync",
    name: "Contract sync",
    summary: "Mirrors signed contracts from the CLM into the billing ledger.",
    category: "operations",
    difficulty: "intermediate",
    runtimeMs: 26_000,
    integrations: ["postgres", "stripe"],
    author: "d.okafor",
    usageCount: 96,
    updatedAt: iso(NOW - 40 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Contract signed webhook"), "Starts on signature so billing is never behind the paperwork."),
      withPurpose(toolNode("t2", "Read the contract", "postgres.query", "Postgres Answers"), "Reads the terms that billing needs."),
      withPurpose(plain("checkpoint", "t3", "Commit checkpoint"), "Commits before the write, so a retry never double-bills."),
      withPurpose(toolNode("t4", "Create the subscription", "stripe.getInvoice", "Stripe — Live"), "Creates the billing record from the contract terms."),
    ],
  },
  {
    id: "tpl-c-standup",
    name: "Engineering stand-up digest",
    summary: "Summarises yesterday's merged pull requests and posts them before stand-up.",
    category: "engineering",
    difficulty: "starter",
    runtimeMs: 11_000,
    integrations: ["github", "slack"],
    author: "s.aggarwal",
    usageCount: 338,
    updatedAt: iso(NOW - 2 * 86_400_000),
    nodes: [
      withPurpose(plain("trigger", "t1", "Weekdays at 09:00"), "Lands ten minutes before stand-up."),
      withPurpose(toolNode("t2", "Read merged PRs", "github.getPr", "GitHub — acme"), "Yesterday's merges, with authors."),
      withPurpose(llmNode("t3", "Summarise by theme"), "Groups by area rather than listing twenty titles."),
      withPurpose(toolNode("t4", "Post to #eng", "slack.postMessage", "Slack — Acme"), "Posts the digest."),
    ],
  },
];

export const ALL_TEMPLATES = [...TEMPLATES, ...COMMUNITY_TEMPLATES];

/* ── Integration readiness ────────────────────────────────────────────────── */

export interface IntegrationRequirement {
  provider: string;
  /** The workspace connection satisfying it, if there is one. */
  connectionName: string | null;
  status: "connected" | "unhealthy" | "missing";
  detail: string;
}

/**
 * What a template needs against what the workspace has.
 *
 * The distinction between MISSING and UNHEALTHY matters: a missing connection is
 * a setup step, an unhealthy one is an incident. Collapsing both into "not
 * ready" sends somebody to create a connection that already exists.
 */
export function requirementsFor(template: Template): IntegrationRequirement[] {
  return template.integrations.map((provider) => {
    const connection = CONNECTIONS.find((c) => c.provider === provider);
    if (!connection) {
      return {
        provider,
        connectionName: null,
        status: "missing" as const,
        detail: "Not connected in this workspace.",
      };
    }
    if (connection.status !== "healthy") {
      return {
        provider,
        connectionName: connection.name,
        status: "unhealthy" as const,
        detail: `${connection.name} is ${connection.status}. The template will install but its first run will fail here.`,
      };
    }
    return {
      provider,
      connectionName: connection.name,
      status: "connected" as const,
      detail: `${connection.name}, responding in ${connection.latencyMs}ms.`,
    };
  });
}

export interface Readiness {
  requirements: IntegrationRequirement[];
  connected: number;
  missing: string[];
  unhealthy: string[];
  ready: boolean;
  /** The one-line summary shown on the card. */
  sentence: string;
}

export function readiness(template: Template): Readiness {
  const requirements = requirementsFor(template);
  const connected = requirements.filter((r) => r.status === "connected");
  const missing = requirements.filter((r) => r.status === "missing").map((r) => r.provider);
  const unhealthy = requirements.filter((r) => r.status === "unhealthy").map((r) => r.provider);

  /* Three distinct sentences, because the three states need different actions:
     ready is nothing to do, missing is a setup step, unhealthy is an incident.
     The unhealthy branch must not claim you have "nothing connected" — an
     unhealthy connection IS connected, and telling somebody to create one they
     already have is the exact confusion this sentence exists to prevent. */
  const healthy = connected.map((r) => displayName(r.provider));

  const sentence = missing.length === 0 && unhealthy.length === 0
    ? `You have everything this needs — ${list(healthy)}.`
    : missing.length > 0
      ? `${healthy.length > 0 ? `You have ${list(healthy)} connected; this` : "This"} also needs ${list(missing.map(displayName))}.`
      : healthy.length > 0
        ? `You have ${list(healthy)} connected, but ${list(unhealthy.map(displayName))} ${unhealthy.length === 1 ? "is" : "are"} not healthy.`
        : `${list(unhealthy.map(displayName))} ${unhealthy.length === 1 ? "is connected but not healthy" : "are connected but not healthy"}.`;

  return {
    requirements,
    connected: connected.length,
    missing,
    unhealthy,
    ready: missing.length === 0 && unhealthy.length === 0,
    sentence,
  };
}

function list(items: string[]): string {
  if (items.length === 0) return "nothing";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Provider ids to the name the vendor actually uses.
 *
 * Naive title-casing turns `hubspot` into "Hubspot" and `github` into "Github",
 * which reads as carelessness on a page whose whole job is to look trustworthy
 * enough to adopt from.
 */
const DISPLAY_NAME: Record<string, string> = {
  postgres: "Postgres",
  slack: "Slack",
  stripe: "Stripe",
  hubspot: "HubSpot",
  gmail: "Gmail",
  github: "GitHub",
  notion: "Notion",
  airtable: "Airtable",
  sendgrid: "SendGrid",
  openai: "OpenAI",
};

function displayName(provider: string): string {
  return DISPLAY_NAME[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/* ── Estimates ────────────────────────────────────────────────────────────── */

export interface TemplateEstimate {
  costPerRunUsd: number;
  durationMs: number;
  gates: string[];
  agentCount: number;
  toolCount: number;
}

/** Cost and shape from the same simulator the publish flow uses. */
export function estimate(template: Template): TemplateEstimate {
  const simulation = simulateVersion(template.nodes);
  return {
    costPerRunUsd: simulation.estimatedCostUsd,
    durationMs: simulation.estimatedDurationMs,
    gates: simulation.gates.map((g) => g.name),
    agentCount: template.nodes.filter((n) => n.kind === "agent").length,
    toolCount: template.nodes.filter((n) => n.kind === "tool").length,
  };
}

export const templateById = (id: string) => ALL_TEMPLATES.find((t) => t.id === id);
