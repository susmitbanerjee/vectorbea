import { CONNECTIONS } from "./fixtures";
import { toolNode, llmNode, agentNode, type VersionNode } from "./workflow-nodes";
import { simulateVersion } from "./workflow-versions";
import type { NodeKind } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   AI WORKFLOW ARCHITECT

   The pipeline rail — Describe → Analyze → Blueprint → Connect → Review → Build
   → Ready — already existed and did nothing. This is the data that makes it
   real.

   TWO THINGS DECIDE WHETHER A GENERATED PLAN IS TRUSTED, and both are modelled
   here rather than in the view:

   · RATIONALE PER DECISION. "Added an approval gate before Send email because
     it is a high-risk external action" is the difference between a plan a user
     edits and a plan a user abandons. Every node carries why it is there.
   · PROGRESSIVE MATERIALISATION. A plan that appears all at once reads as a
     canned response. One that assembles — nodes, then edges, then gates —
     reads as work, and it lets a user follow the reasoning as it lands.

   The stream is SCRIPTED, not random. A demo that produces a different plan for
   the same prompt each time is not a demo of a product.
══════════════════════════════════════════════════════════════════════════════ */

/* ── Stages ───────────────────────────────────────────────────────────────── */

export type StageId =
  | "describe" | "analyze" | "blueprint" | "connect" | "review" | "build" | "ready";

export const STAGES: { id: StageId; label: string; blurb: string }[] = [
  { id: "describe", label: "Describe", blurb: "What the workflow should do" },
  { id: "analyze", label: "Analyze", blurb: "Reading the description" },
  { id: "blueprint", label: "Blueprint", blurb: "The plan, editable" },
  { id: "connect", label: "Connect", blurb: "Credentials it needs" },
  { id: "review", label: "Review", blurb: "What will be created" },
  { id: "build", label: "Build", blurb: "Creating the resources" },
  { id: "ready", label: "Ready", blurb: "Where it lives" },
];

/* ── Quota ────────────────────────────────────────────────────────────────── */

export interface Quota {
  used: number;
  limit: number;
  /** ISO. When the rolling window frees the next build. */
  resetsAt: string;
  plan: string;
}

const NOW = new Date("2026-08-11T14:20:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * One build per rolling 30 days on the free plan.
 *
 * Shown BEFORE the prompt box, not after the user has written three paragraphs
 * and pressed Generate. A quota discovered at submission is a quota that wasted
 * somebody's effort.
 */
export const QUOTA: Quota = {
  used: 0,
  limit: 1,
  resetsAt: iso(NOW + 26 * 86_400_000),
  plan: "Free",
};

export const EXHAUSTED_QUOTA: Quota = { ...QUOTA, used: 1 };

/* ── Describe ─────────────────────────────────────────────────────────────── */

export interface ExamplePrompt {
  id: string;
  label: string;
  text: string;
}

/** Chips that POPULATE the box rather than navigating away from it. */
export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    id: "renewals",
    label: "Renewal outreach",
    text: "Every morning, find contracts renewing in the next 30 days, draft outreach for each account, and post the batch to #billing-ops for a human to approve before anything is sent.",
  },
  {
    id: "refunds",
    label: "Refund approvals",
    text: "When a refund over £500 is requested, pull the invoice and the account history, then ask billing to approve it before issuing the refund.",
  },
  {
    id: "triage",
    label: "Ticket triage",
    text: "Classify every inbound support ticket by urgency and route anything urgent to the on-call rota in Slack.",
  },
  {
    id: "digest",
    label: "Failure digest",
    text: "At the end of each day, collect failed runs, group them by root cause, and post the top three to the engineering channel.",
  },
];

export interface StructuredHints {
  trigger: "schedule" | "webhook" | "manual" | "api" | "unspecified";
  systems: string[];
  approval: "required" | "none" | "unspecified";
  schedule: string;
}

export const EMPTY_HINTS: StructuredHints = {
  trigger: "unspecified",
  systems: [],
  approval: "unspecified",
  schedule: "",
};

/* ── Analyze ──────────────────────────────────────────────────────────────── */

export interface AnalysisFinding {
  id: string;
  /** The sub-step the rail advances through. */
  kind: "trigger" | "systems" | "decisions" | "checkpoints";
  label: string;
  value: string;
  detail: string;
}

/**
 * What the model understood, revealed one finding at a time.
 *
 * Ordered as a person would read it: what starts it, what it touches, where it
 * branches, where it stops for a human. The last one is the most important and
 * arrives last, which is also the order that makes the wait feel purposeful.
 */
export const ANALYSIS: AnalysisFinding[] = [
  {
    id: "a1", kind: "trigger", label: "Trigger",
    value: "Schedule — daily at 06:00 UTC",
    detail: "“Every morning” names a schedule rather than an event, so this starts on a cron rather than a webhook.",
  },
  {
    id: "a2", kind: "systems", label: "Systems",
    value: "Postgres, Slack",
    detail: "“Contracts renewing” is a database read; “post to #billing-ops” is Slack. No CRM is implied by the description.",
  },
  {
    id: "a3", kind: "decisions", label: "Decision points",
    value: "One — batch is empty",
    detail: "A run that finds nothing should stop rather than post an empty batch, so the plan branches on the result count.",
  },
  {
    id: "a4", kind: "checkpoints", label: "Human checkpoints",
    value: "One — before anything is sent",
    detail: "“for a human to approve before anything is sent” is an explicit gate. It is placed before the Slack post, which is the first step with an external effect.",
  },
];

/* ── Blueprint ────────────────────────────────────────────────────────────── */

export interface BlueprintNode extends VersionNode {
  /** Why the Architect put this step here. The thing that earns trust. */
  rationale: string;
  /** Rendered in the manifest as a resource that will be created. */
  creates: "agent" | "tool" | "connection" | "gate" | null;
}

export interface BlueprintEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Blueprint {
  name: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

const plain = (kind: NodeKind, id: string, name: string, config: Record<string, unknown> = {}): VersionNode =>
  ({ id, name, kind, config });

const node = (base: VersionNode, rationale: string, creates: BlueprintNode["creates"]): BlueprintNode =>
  ({ ...base, rationale, creates });

/**
 * The generated plan for the renewals prompt.
 *
 * Scripted so the same description produces the same plan every time. The
 * rationales are the point: each one names the phrase in the description it
 * came from, so a user can check the plan against what they asked for.
 */
export const BLUEPRINT: Blueprint = {
  name: "renewal-outreach",
  nodes: [
    node(
      plain("trigger", "b1", "Daily at 06:00 UTC", { cron: "0 6 * * *", timezone: "UTC", overlapPolicy: "skip" }),
      "“Every morning” is a schedule, not an event. 06:00 UTC puts the batch in place before the working day, and overlap is set to skip so a slow run never doubles up.",
      null,
    ),
    node(
      toolNode("b2", "Fetch upcoming renewals", "contracts.getUpcomingRenewals", "Postgres Answers"),
      "“Contracts renewing in the next 30 days” maps to a contracts read. The 30-day window becomes a parameter rather than a hard-coded value.",
      "tool",
    ),
    node(
      plain("checkpoint", "b3", "Commit checkpoint"),
      "Committed after the read so a failure further down resumes here instead of re-querying the database. This is free durability at one write.",
      null,
    ),
    node(
      plain("branch", "b4", "Any renewals?", { condition: "count > 0", trueLabel: "Has renewals", falseLabel: "Nothing due" }),
      "A run that finds nothing should stop rather than post an empty batch. Nothing in the description said this — it is added because an empty notification trains people to ignore the channel.",
      null,
    ),
    node(
      llmNode("b5", "Draft outreach per account", { model: "claude-sonnet-4", maxTokens: 4096 }),
      "“Draft outreach for each account” needs generation rather than a template, because the amount, the term and the tier differ per account. Sonnet rather than Haiku: the output is customer-facing.",
      "agent",
    ),
    node(
      plain("approval", "b6", "Billing approves the batch", { approverGroup: "billing", slaMinutes: 240, onTimeout: "escalate" }),
      "“for a human to approve before anything is sent” is an explicit gate. It is placed before the Slack post because that is the first step with an effect outside the workspace.",
      "gate",
    ),
    node(
      toolNode("b7", "Post to #billing-ops", "slack.postMessage", "Slack — Acme"),
      "“post the batch to #billing-ops” maps to a Slack message. Its idempotency key is bound to the batch date so a retry cannot post twice.",
      "tool",
    ),
  ],
  edges: [
    { from: "b1", to: "b2" },
    { from: "b2", to: "b3" },
    { from: "b3", to: "b4" },
    { from: "b4", to: "b5", label: "Has renewals" },
    { from: "b5", to: "b6" },
    { from: "b6", to: "b7" },
  ],
};

/* ── Manifest ─────────────────────────────────────────────────────────────── */

export interface ManifestEntry {
  kind: "agent" | "tool" | "connection" | "gate";
  name: string;
  detail: string;
  /** Already exists in the workspace, so nothing will be created. */
  existing: boolean;
}

export interface Manifest {
  entries: ManifestEntry[];
  agents: number;
  tools: number;
  connections: number;
  gates: number;
  costPerRunUsd: number;
  durationMs: number;
}

/** Exactly what the build will create, derived from the blueprint. */
export function manifestFor(blueprint: Blueprint): Manifest {
  const entries: ManifestEntry[] = [];

  for (const n of blueprint.nodes) {
    if (n.creates === "agent") {
      entries.push({ kind: "agent", name: n.name, detail: `${String(n.config.model ?? "model")} · new registered agent`, existing: false });
    }
    if (n.creates === "tool") {
      const tool = String(n.config.tool ?? n.name);
      entries.push({ kind: "tool", name: tool, detail: "Bound to an existing registered tool", existing: true });
    }
    if (n.creates === "gate") {
      entries.push({ kind: "gate", name: n.name, detail: `${String(n.config.approverGroup ?? "a group")} · ${String(n.config.slaMinutes ?? 240)} minute SLA`, existing: false });
    }
  }

  // Connections are required rather than created — they carry credentials only
  // a person can supply.
  for (const provider of requiredProviders(blueprint)) {
    const connection = CONNECTIONS.find((c) => c.provider === provider);
    entries.push({
      kind: "connection",
      name: connection?.name ?? `${provider} connection`,
      detail: connection
        ? connection.status === "healthy" ? "Connected and healthy" : `Connected but ${connection.status}`
        : "Not connected — you will be asked for credentials",
      existing: Boolean(connection),
    });
  }

  const simulation = simulateVersion(blueprint.nodes);

  return {
    entries,
    agents: entries.filter((e) => e.kind === "agent").length,
    tools: entries.filter((e) => e.kind === "tool").length,
    connections: entries.filter((e) => e.kind === "connection").length,
    gates: entries.filter((e) => e.kind === "gate").length,
    costPerRunUsd: simulation.estimatedCostUsd,
    durationMs: simulation.estimatedDurationMs,
  };
}

export function requiredProviders(blueprint: Blueprint): string[] {
  const out = new Set<string>();
  for (const n of blueprint.nodes) {
    const tool = n.config.tool;
    if (typeof tool === "string" && tool.includes(".")) out.add(tool.split(".")[0]);
  }
  // The contracts tool runs through Postgres.
  if (out.has("contracts")) { out.delete("contracts"); out.add("postgres"); }
  return [...out];
}

/* ── Build ────────────────────────────────────────────────────────────────── */

export interface BuildStep {
  id: string;
  label: string;
  detail: string;
}

export function buildStepsFor(blueprint: Blueprint, manifest: Manifest): BuildStep[] {
  return [
    { id: "workflow", label: "Create the workflow", detail: `${blueprint.name} as a draft` },
    ...manifest.entries
      .filter((e) => !e.existing)
      .map((e, i) => ({
        id: `res-${i}`,
        label: `Create ${e.kind} — ${e.name}`,
        detail: e.detail,
      })),
    { id: "graph", label: "Write the graph", detail: `${blueprint.nodes.length} nodes, ${blueprint.edges.length} edges` },
    { id: "validate", label: "Validate", detail: "Structure, bindings and credentials" },
    { id: "version", label: "Record version 1", detail: "Immutable, unpublished" },
  ];
}

/* ── Errors ───────────────────────────────────────────────────────────────── */

export interface ArchitectError {
  title: string;
  detail: string;
  fix: string;
  /** Which stage to return the user to. */
  stage: StageId;
}

/**
 * Specific, actionable failures — never "generation failed".
 *
 * Each one names what went wrong, what it means for the work already done, and
 * the single next action.
 */
export const ERRORS: Record<string, ArchitectError> = {
  vague: {
    title: "The description does not say what starts the workflow",
    detail: "A workflow needs a trigger: a schedule, an incoming webhook, or somebody pressing run. The description names actions but nothing that begins them.",
    fix: "Add when it should run — “every morning”, “when a payment fails”, or “when I run it”.",
    stage: "describe",
  },
  unsupported: {
    title: "One of the systems named has no integration yet",
    detail: "The description mentions a system this workspace cannot reach. The rest of the plan is sound and has been kept.",
    fix: "Remove that step, or connect the system first and generate again.",
    stage: "describe",
  },
  buildFailed: {
    title: "Creating the approval gate failed",
    detail: "The workflow and its agent were created, then the gate was rejected because the approver group no longer exists. Everything created so far has been rolled back — there is no half-built workflow left behind.",
    fix: "Pick an approver group that exists, then build again.",
    stage: "review",
  },
};
