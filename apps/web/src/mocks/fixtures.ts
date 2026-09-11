import type {
  Agent, Approval, CellState, Connection, Environment, Incident, Run, RunNode,
  RunStatus, Tool, TriggerKind, Workflow, WorkflowStatus, WorkflowTrigger,
  NodeKind, RiskLevel,
} from "./domain";
import {
  blueprintFor, versionNodeSets, connectionsOf, toolsOf, countKind,
} from "./workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   FIXTURES — the real shape of the workspace in the screenshots.

   163 runs at 58 succeeded / 83 failed / 22 queued. That 51% failure rate is not
   a placeholder: it is what the product actually looks like right now, and it is
   the reason the Ribbon exists. Building against three tidy green rows produces
   layouts that collapse the moment real data arrives.

   DETERMINISTIC. A seeded PRNG, not Math.random, so the same fixture set comes
   back every run — otherwise every screenshot diff is noise and visual
   regression testing is impossible.
══════════════════════════════════════════════════════════════════════════════ */

/** mulberry32 — small, fast, good enough distribution for fixtures. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(0x5ecdb0a7);

const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const between = (min: number, max: number) => min + rng() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));

/** Deterministic v4-shaped UUID. */
function uuid(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.floor(rng() * 4) | 8)];
    else out += hex[Math.floor(rng() * 16)];
  }
  return out;
}

/** ULID-ish run id, matching what the product actually emits. */
function runId(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "run_";
  for (let i = 0; i < 26; i += 1) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

/**
 * Timestamps cluster the way real traffic does: dense in the last few hours,
 * thinning out across the week. A uniform spread makes every "last 24h" filter
 * look wrong.
 */
const NOW = new Date("2026-08-11T14:20:00Z").getTime();
function clusteredTimestamp(): number {
  const r = rng();
  if (r < 0.45) return NOW - between(0, 6 * 3600_000);       // last 6 hours
  if (r < 0.75) return NOW - between(6, 24) * 3600_000;      // rest of today
  if (r < 0.93) return NOW - between(1, 3) * 86_400_000;     // last three days
  return NOW - between(3, 7) * 86_400_000;                   // rest of the week
}

const iso = (ms: number) => new Date(ms).toISOString();

/* ── Workflows ────────────────────────────────────────────────────────────── */

const WORKFLOW_SEEDS: {
  name: string;
  steps: number;
  status: WorkflowStatus;
  /** How many versions exist. The last one is a draft when `draft` is set. */
  versions: number;
  draft?: boolean;
  trigger: TriggerKind;
}[] = [
  { name: "renewals-daily", steps: 12, status: "active", versions: 7, draft: true, trigger: "schedule" },
  { name: "dunning-escalation", steps: 8, status: "active", versions: 5, trigger: "schedule" },
  { name: "customer-onboarding", steps: 13, status: "active", versions: 9, trigger: "webhook" },
  { name: "refund-approvals", steps: 9, status: "active", versions: 4, draft: true, trigger: "api" },
  { name: "invoice-reconciliation", steps: 11, status: "active", versions: 6, trigger: "schedule" },
  { name: "support-triage", steps: 7, status: "paused", versions: 3, trigger: "webhook" },
  { name: "usage-rollup", steps: 5, status: "active", versions: 12, trigger: "schedule" },
  { name: "churn-signals", steps: 10, status: "paused", versions: 5, trigger: "schedule" },
  { name: "contract-sync", steps: 6, status: "draft", versions: 2, draft: true, trigger: "webhook" },
  { name: "nps-followup", steps: 5, status: "draft", versions: 1, draft: true, trigger: "manual" },
  { name: "trial-conversion", steps: 9, status: "archived", versions: 4, trigger: "schedule" },
];

const OWNERS = ["platform-ops", "billing", "growth", "support-eng"];

/**
 * Outcome mix per workflow, cycled by index.
 *
 * Spread deliberately across the health bands the list filters on (≥90 healthy,
 * ≥60 degraded, below that failing) so each band holds something. The fleet
 * still skews unhealthy overall, because that is what the workspace in the
 * screenshots actually looks like — but not uniformly, because no real fleet is.
 */
const HEALTH_PROFILES: { success: number; failure: number }[] = [
  { success: 0.97, failure: 0.03 }, // clean
  { success: 0.93, failure: 0.05 },
  { success: 0.72, failure: 0.24 }, // wobbling
  { success: 0.64, failure: 0.31 },
  { success: 0.41, failure: 0.55 }, // on fire
  { success: 0.28, failure: 0.66 },
];

/** Cron per workflow, so the trigger column says something real. */
const SCHEDULES: Record<string, { cron: string; summary: string; timezone: string }> = {
  "renewals-daily": { cron: "0 6 * * *", summary: "Daily 06:00 UTC", timezone: "UTC" },
  "dunning-escalation": { cron: "0 */4 * * *", summary: "Every 4 hours", timezone: "UTC" },
  "invoice-reconciliation": { cron: "30 2 * * *", summary: "Daily 02:30 UTC", timezone: "UTC" },
  "usage-rollup": { cron: "0 0 * * *", summary: "Daily 00:00 UTC", timezone: "UTC" },
  "churn-signals": { cron: "0 9 * * 1", summary: "Mondays 09:00 UTC", timezone: "UTC" },
  "trial-conversion": { cron: "0 9 * * *", summary: "Daily 09:00 Europe/London", timezone: "Europe/London" },
};

function buildTriggers(name: string, id: string, kind: TriggerKind, enabled: boolean): WorkflowTrigger[] {
  if (kind === "schedule") {
    const s = SCHEDULES[name] ?? { cron: "0 9 * * *", summary: "Daily 09:00 UTC", timezone: "UTC" };
    return [{
      id: `trg_${id.slice(3, 11)}`,
      kind: "schedule",
      summary: s.summary,
      detail: s.cron,
      enabled,
      // Deterministic: the next midnight-anchored slot after NOW.
      nextFireAt: iso(NOW + (6 - (new Date(NOW).getUTCHours() % 6)) * 3600_000),
      timezone: s.timezone,
    }];
  }
  if (kind === "webhook") {
    return [{
      id: `trg_${id.slice(3, 11)}`,
      kind: "webhook",
      summary: `POST /hooks/${name}`,
      detail: `https://api.vectorbea.com/hooks/${name}`,
      enabled,
      nextFireAt: null,
      timezone: null,
    }];
  }
  if (kind === "api") {
    return [{
      id: `trg_${id.slice(3, 11)}`,
      kind: "api",
      summary: "Runs API",
      detail: `POST /v1/workflows/${name}/runs`,
      enabled,
      nextFireAt: null,
      timezone: null,
    }];
  }
  return [{
    id: `trg_${id.slice(3, 11)}`,
    kind: "manual",
    summary: "Manual only",
    detail: "Started from the console or the CLI.",
    enabled,
    nextFireAt: null,
    timezone: null,
  }];
}

/* ── Node vocabulary ──────────────────────────────────────────────────────── */

const NODE_TEMPLATES: { name: string; kind: NodeKind }[] = [
  { name: "Schedule trigger", kind: "trigger" },
  { name: "Load account batch", kind: "tool" },
  { name: "contracts.getUpcomingRenewals", kind: "tool" },
  { name: "Triage agent", kind: "agent" },
  { name: "Classify intent", kind: "llm" },
  { name: "Branch on tier", kind: "branch" },
  { name: "Fan out per account", kind: "parallel" },
  { name: "postgres.query", kind: "tool" },
  { name: "Summarise findings", kind: "llm" },
  { name: "Await approval", kind: "approval" },
  { name: "slack.postMessage", kind: "tool" },
  { name: "Merge results", kind: "merge" },
  { name: "Commit checkpoint", kind: "checkpoint" },
  { name: "Emit report", kind: "output" },
];

/**
 * Realistic failure causes, weighted.
 *
 * A failed node in production always carries a structured error — that is what
 * the Recovery Engine clusters on. Without it here, failure clustering degrades
 * to bucketing by node kind, which produces nine clusters of noise instead of
 * three root causes, and every quick-peek reads "failed without a structured
 * error". Weighted so one cause dominates, because that is what an incident
 * actually looks like.
 */
const FAILURE_CAUSES: { weight: number; message: string; toolCall?: string; connection?: string }[] = [
  {
    weight: 0.52,
    message: "Connection refused after 3 attempts (30s timeout each).",
    toolCall: "contracts.getUpcomingRenewals",
    connection: "Postgres Answers",
  },
  {
    weight: 0.21,
    message: "Tool call exceeded its 30s timeout.",
    toolCall: "fetch-jobs-linkedin",
  },
  {
    weight: 0.13,
    message: "Model returned output that did not match the declared schema.",
  },
  {
    weight: 0.08,
    message: "Provider returned 429 and the retry budget was exhausted.",
    toolCall: "openai.chat",
  },
  {
    weight: 0.06,
    message: "Credentials rejected (401). The connection may need rotating.",
    toolCall: "stripe.getInvoice",
    connection: "Stripe — Live",
  },
];

function pickFailureCause() {
  const r = rng();
  let acc = 0;
  for (const cause of FAILURE_CAUSES) {
    acc += cause.weight;
    if (r <= acc) return cause;
  }
  return FAILURE_CAUSES[FAILURE_CAUSES.length - 1];
}

/**
 * Build the node list for a run.
 *
 * `failAt` is the index that dies; everything before it committed and everything
 * after stays pending. That asymmetry is the entire point of the Ribbon — it is
 * what tells an operator a retry costs 4 nodes rather than 12.
 */
function buildNodes(
  count: number,
  opts: {
    failAt?: number;
    gateAt?: number;
    executingAt?: number;
    recoveredAt?: number[];
    skipped?: number[];
    allPending?: boolean;
  } = {},
): RunNode[] {
  const { failAt, gateAt, executingAt, recoveredAt = [], skipped = [], allPending } = opts;
  const base = clusteredTimestamp();

  return Array.from({ length: count }, (_, i) => {
    const template = NODE_TEMPLATES[i % NODE_TEMPLATES.length];
    let state: CellState = "committed";

    if (allPending) state = "pending";
    else if (failAt !== undefined && i === failAt) state = "failed";
    else if (failAt !== undefined && i > failAt) state = "pending";
    else if (gateAt !== undefined && i === gateAt) state = "gated";
    else if (gateAt !== undefined && i > gateAt) state = "pending";
    else if (executingAt !== undefined && i === executingAt) state = "executing";
    else if (executingAt !== undefined && i > executingAt) state = "pending";
    else if (recoveredAt.includes(i)) state = "recovered";
    else if (skipped.includes(i)) state = "skipped";

    const reached = state !== "pending" && state !== "skipped";
    const durationMs = reached ? Math.round(between(120, 9_400)) : null;
    const tokens = reached && (template.kind === "llm" || template.kind === "agent")
      ? intBetween(320, 9_800)
      : null;

    return {
      id: `n${1000 + i}`,
      name: template.name,
      kind: template.kind,
      state,
      durationMs,
      tokens,
      // Real per-node costs sit in the fractions-of-a-cent range; §4.2 forbids
      // rendering these as $0.00.
      costUsd: tokens ? Number((tokens * 0.0000032).toFixed(4)) : reached ? Number(between(0.0004, 0.004).toFixed(4)) : null,
      at: reached ? iso(base + i * intBetween(400, 4_000)) : null,
      attempt: state === "recovered" ? intBetween(2, 3) : undefined,
      error: state === "failed" ? pickFailureCause() : undefined,
    };
  });
}

export const WORKFLOWS: Workflow[] = WORKFLOW_SEEDS.map((seed, i) => {
  const id = `wf_${uuid().slice(0, 8)}`;
  const environment: Environment = i < 8 ? "production" : "staging";
  const blueprint = blueprintFor(seed.name, seed.steps, seed.versions, i, environment, Boolean(seed.draft));
  const sets = versionNodeSets(blueprint);
  // The LIVE version, which is the last PUBLISHED one — not the last that
  // exists. A draft's node counts must not be reported as what production runs.
  // -1 means nothing has ever been published, which is the honest state of a
  // workflow whose only version is still a draft.
  const publishedIndex = seed.draft ? sets.length - 2 : sets.length - 1;
  // Counts and search still describe the newest version when there is no
  // published one — the alternative is a draft workflow reporting zero steps.
  const shown = sets[publishedIndex] ?? sets[sets.length - 1];

  /* Health VARIES across the fleet, and that is the point of the column.
     Sampling every workflow from the same 36/51/13 distribution the runs use
     put all eleven under 60% — so the health band read "failing" eleven times,
     the healthy and degraded filters returned nothing, and a column built to
     make anomalies pre-attentive had no anomaly to show. A real fleet has a
     handful working, a handful wobbling and one on fire. */
  const profile = HEALTH_PROFILES[i % HEALTH_PROFILES.length];

  const last30 = seed.name === "renewals-daily"
    /* Authored, not sampled. This workflow's v6 raised a timeout and cut the
       retry budget on `contracts.getUpcomingRenewals`, and its signature run
       dies on exactly that node against the failing ‘Postgres Answers’
       connection. A random strip would have let the version comparison report
       that the regression IMPROVED reliability — three screens telling three
       stories about one change. The healthy head is v5 and earlier; the red
       tail is v6, and it is the same 41-run window the Postgres incident
       already claims. */
    ? [...Array.from({ length: 16 }, (_, i) => (i % 7 === 3 ? "failed" : "succeeded") as RunStatus),
      ...Array.from({ length: 14 }, (_, i) => (i % 5 === 2 ? "succeeded" : "failed") as RunStatus)]
    : Array.from({ length: 30 }, () => {
      const r = rng();
      if (r < profile.success) return "succeeded" as RunStatus;
      if (r < profile.success + profile.failure) return "failed" as RunStatus;
      return "queued" as RunStatus;
    });
  const succeeded = last30.filter((s) => s === "succeeded").length;

  return {
    id,
    name: seed.name,
    description: blueprint.description,
    status: seed.status,
    stepCount: shown.length,
    agentCount: countKind(shown, "agent"),
    toolCount: countKind(shown, "tool"),
    environment,
    owner: pick(OWNERS),
    version: publishedIndex + 1,
    draftVersion: seed.draft ? sets.length : null,
    trigger: seed.trigger,
    // An archived or paused workflow's triggers are suspended, not deleted —
    // which is exactly why pausing is reversible and archiving is not delete.
    triggers: buildTriggers(seed.name, id, seed.trigger, seed.status === "active"),
    tags: blueprint.tags,
    last30,
    last30RunIds: [],
    lastRunAt: null,
    lastRunStatus: last30[last30.length - 1] ?? null,
    successRate30d: Math.round((succeeded / last30.length) * 100),
    avgDurationMs: null,
    spend30dUsd: 0,
    connectionNames: connectionsOf(shown),
    toolNames: toolsOf(shown),
  };
});

/* ── The production failure ───────────────────────────────────────────────────
   Node n1001 dies on tool call contracts.getUpcomingRenewals because the
   connection "Postgres Answers" is unusable. Named explicitly because it is the
   failure the whole demo narrative runs through: Runs → Run detail → Recovery
   Engine → Connections → fix. Every screen that shows it must show the same
   facts, so it is a fixture rather than something each story invents. */

export const POSTGRES_INCIDENT_ID = "inc_7c2f18ab90de";

function buildSignatureFailure(): Run {
  const workflow = WORKFLOWS[0]; // renewals-daily
  /* Fails at index 8, not 1. The failure position IS the demo: "8 of 12 steps
     survived — retry costs 4" is the product thesis stated in one line on the
     Recovery card, and a run that dies at step 2 says "1 of 12 survived", which
     demonstrates nothing. Late-but-not-last is also the realistic shape — a
     connection that has been serving fine all run and then drops. */
  const nodes = buildNodes(12, { failAt: 8 });
  nodes[8] = {
    ...nodes[8],
    name: "contracts.getUpcomingRenewals",
    kind: "tool",
    error: {
      message: "Connection refused after 3 attempts (30s timeout each).",
      toolCall: "contracts.getUpcomingRenewals",
      connection: "Postgres Answers",
    },
  };
  const started = NOW - 42 * 60_000;
  return {
    id: "run_01JBQZ8XK4T9V2M7N3P6R8S1W5",
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: "failed",
    environment: "production",
    trigger: "schedule",
    startedAt: iso(started),
    finishedAt: iso(started + 94_000),
    durationMs: 94_000,
    costUsd: 0.0031,
    tokens: 1_204,
    nodes,
    incidentId: POSTGRES_INCIDENT_ID,
  };
}

export const SIGNATURE_RUN = buildSignatureFailure();

/* ── Runs: 163 at 58 / 83 / 22 ─────────────────────────────────────────────── */

function buildRun(status: RunStatus): Run {
  const workflow = pick(WORKFLOWS);
  const count = workflow.stepCount;

  let nodes: RunNode[];
  if (status === "succeeded") {
    // A quarter of successes needed a retry somewhere — that is what makes
    // `recovered` worth a distinct cell state.
    const recovered = rng() < 0.25 ? [intBetween(1, count - 2)] : [];
    nodes = buildNodes(count, { recoveredAt: recovered });
  } else if (status === "failed") {
    nodes = buildNodes(count, { failAt: intBetween(1, count - 1) });
  } else if (status === "running") {
    nodes = buildNodes(count, { executingAt: intBetween(1, count - 2) });
  } else if (status === "awaiting-approval") {
    nodes = buildNodes(count, { gateAt: intBetween(2, count - 2) });
  } else {
    nodes = buildNodes(count, { allPending: true });
  }

  const started = clusteredTimestamp();
  const committed = nodes.filter((n) => n.durationMs !== null);
  const durationMs = status === "queued" ? null : committed.reduce((sum, n) => sum + (n.durationMs ?? 0), 0);
  const tokens = committed.reduce((sum, n) => sum + (n.tokens ?? 0), 0);
  const costUsd = Number(committed.reduce((sum, n) => sum + (n.costUsd ?? 0), 0).toFixed(4));

  return {
    id: runId(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    status,
    environment: workflow.environment,
    trigger: workflow.trigger,
    startedAt: iso(started),
    finishedAt: durationMs === null ? null : iso(started + durationMs),
    durationMs,
    costUsd,
    tokens,
    nodes,
  };
}

/** 163 runs at exactly the real split, newest first. */
export const RUNS: Run[] = (() => {
  const list: Run[] = [
    SIGNATURE_RUN,
    ...Array.from({ length: 57 }, () => buildRun("succeeded")),
    ...Array.from({ length: 78 }, () => buildRun("failed")),
    ...Array.from({ length: 22 }, () => buildRun("queued")),
    ...Array.from({ length: 3 }, () => buildRun("running")),
    ...Array.from({ length: 2 }, () => buildRun("awaiting-approval")),
  ];
  return list.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
})();

export const RUN_COUNTS = {
  total: RUNS.length,
  succeeded: RUNS.filter((r) => r.status === "succeeded").length,
  failed: RUNS.filter((r) => r.status === "failed").length,
  queued: RUNS.filter((r) => r.status === "queued").length,
};

/* ── Second pass: the run-derived fields on each workflow ──────────────────────
   Deliberately after RUNS rather than inside the WORKFLOWS map, because RUNS is
   built FROM WORKFLOWS — a workflow cannot know its own spend until the runs
   that spent it exist. Filling these in downstream (in each view) instead was
   the alternative, and it produced a list and an overview that disagreed about
   the same workflow's average duration. One computation, one answer. */
WORKFLOWS.forEach((workflow, i) => {
  const runs = RUNS.filter((r) => r.workflowId === workflow.id);
  const timed = runs.filter((r) => r.durationMs !== null);

  workflow.last30RunIds = workflow.last30.map((_, index) => runs[index]?.id ?? null);
  // Where no run in RUNS belongs to this workflow the heatstrip still has 30
  // historical outcomes, so the timestamp is a deterministic spread rather than
  // null — an empty "last run" cell beside a full heatstrip reads as a bug.
  workflow.lastRunAt = runs[0]?.startedAt ?? iso(NOW - (i * 37 + 4) * 60_000);
  workflow.lastRunStatus = runs[0]?.status ?? workflow.lastRunStatus;
  workflow.spend30dUsd = Number(runs.reduce((sum, r) => sum + r.costUsd, 0).toFixed(4));
  workflow.avgDurationMs = timed.length === 0
    ? null
    : Math.round(timed.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / timed.length);
});

/* ── Tools, agents, connections ───────────────────────────────────────────── */

const TOOL_NAMES = [
  "postgres.query", "postgres.insert", "contracts.getUpcomingRenewals",
  "stripe.refund", "stripe.getInvoice", "slack.postMessage", "slack.lookupUser",
  "gmail.send", "gmail.search", "sheets.appendRow", "sheets.readRange",
  "notion.createPage", "notion.query", "airtable.upsert", "hubspot.getContact",
  "hubspot.updateDeal", "github.createIssue", "github.getPr", "jira.createTicket",
  "jira.transition", "http.get", "http.post", "webhook.emit", "mysql.query",
  "s3.putObject", "s3.getObject", "sendgrid.send", "twilio.sms",
  "salesforce.query", "zendesk.createTicket", "intercom.tag", "segment.track",
];

export const TOOLS: Tool[] = TOOL_NAMES.map((name) => {
  const risk: RiskLevel =
    name.includes("refund") || name.includes("delete") ? "critical"
      : name.includes("insert") || name.includes("update") || name.includes("send") || name.includes("post") ? "high"
        : name.includes("create") || name.includes("upsert") || name.includes("emit") ? "medium"
          : "low";
  return {
    id: `tool_${uuid().slice(0, 8)}`,
    name,
    provider: name.split(".")[0],
    risk,
    timeoutMs: pick([5_000, 10_000, 30_000, 60_000]),
    usedByCount: intBetween(0, 9),
    lastError: name === "contracts.getUpcomingRenewals"
      ? "Connection refused after 3 attempts (30s timeout each)."
      : rng() < 0.15 ? "Upstream returned 429 (rate limited)." : null,
  };
});

const MODELS = [
  { model: "claude-sonnet-4", provider: "anthropic" },
  { model: "claude-haiku-4", provider: "anthropic" },
  { model: "gpt-4o", provider: "openai" },
  { model: "gpt-4o-mini", provider: "openai" },
  { model: "gemini-2.0-flash", provider: "gemini" },
  { model: "mistral-large", provider: "mistral" },
];

export const AGENTS: Agent[] = Array.from({ length: 17 }, (_, i) => {
  const m = pick(MODELS);
  return {
    id: `agt_${uuid().slice(0, 8)}`,
    name: [
      "Triage agent", "Summariser", "Renewal classifier", "Refund reviewer",
      "Churn scorer", "Invoice matcher", "Support router", "Contract reader",
      "Usage analyst", "Escalation writer", "Sentiment tagger", "Dunning composer",
      "Onboarding guide", "NPS reader", "Trial nudger", "Report writer", "QA checker",
    ][i],
    model: m.model,
    provider: m.provider,
    costPerRunUsd: Number(between(0.0008, 0.042).toFixed(4)),
    toolGrants: intBetween(1, 7),
    promptVersion: intBetween(1, 9),
  };
});

export const CONNECTIONS: Connection[] = [
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "Postgres Answers", provider: "postgres",
    status: "failing", latencyMs: null,
    blastRadius: { workflows: 3, tools: 7 },
    lastCheckedAt: iso(NOW - 90_000),
  },
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "Stripe — Live", provider: "stripe",
    status: "failing", latencyMs: null,
    blastRadius: { workflows: 2, tools: 3 },
    lastCheckedAt: iso(NOW - 240_000),
  },
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "HubSpot CRM", provider: "hubspot",
    status: "failing", latencyMs: null,
    blastRadius: { workflows: 1, tools: 2 },
    lastCheckedAt: iso(NOW - 600_000),
  },
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "Slack — Acme", provider: "slack",
    status: "healthy", latencyMs: 142,
    blastRadius: { workflows: 6, tools: 2 },
    lastCheckedAt: iso(NOW - 45_000),
  },
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "Gmail — ops@", provider: "gmail",
    status: "healthy", latencyMs: 318,
    blastRadius: { workflows: 4, tools: 2 },
    lastCheckedAt: iso(NOW - 61_000),
  },
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "GitHub — acme", provider: "github",
    status: "degraded", latencyMs: 1_840,
    blastRadius: { workflows: 2, tools: 2 },
    lastCheckedAt: iso(NOW - 30_000),
  },
  /* The two model providers the AGENTS fixture actually runs on.
     Without them this workspace has agents on claude-sonnet-5 and gpt-4o-mini
     and no LLM connection for either to bill to — which is not a workspace that
     could exist, and it makes the agent registration flow undemoable: its model
     step correctly refuses to continue when there is nothing to bind to. */
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "Anthropic — Production", provider: "anthropic",
    status: "healthy", latencyMs: 412,
    blastRadius: { workflows: 5, tools: 1 },
    lastCheckedAt: iso(NOW - 52_000),
  },
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "OpenAI — Platform", provider: "openai",
    status: "healthy", latencyMs: 664,
    blastRadius: { workflows: 3, tools: 2 },
    lastCheckedAt: iso(NOW - 78_000),
  },
  /* An MCP server, so the connection sheet's Tools tab has somewhere to appear.
     Without one this workspace cannot reach that surface at all in mock mode,
     and a screen nobody can open is a screen nobody reviews. */
  {
    id: `conn_${uuid().slice(0, 8)}`, name: "Acme Internal — MCP", provider: "mcp",
    status: "healthy", latencyMs: 208,
    blastRadius: { workflows: 2, tools: 4 },
    lastCheckedAt: iso(NOW - 39_000),
  },
];

/* ── Incidents ────────────────────────────────────────────────────────────── */

export const INCIDENTS: Incident[] = [
  {
    id: POSTGRES_INCIDENT_ID,
    signature: "tool_call_failed · contracts.getUpcomingRenewals · ECONNREFUSED",
    firstSeen: iso(NOW - 3.5 * 3600_000),
    lastSeen: iso(NOW - 42 * 60_000),
    occurrences: 41,
    affectedWorkflows: ["renewals-daily", "invoice-reconciliation", "contract-sync"],
    affectedRuns: 41,
    status: "open",
    assignee: null,
    remediation: "Connection ‘Postgres Answers’ is refusing connections. Check credentials and network access, then retry the 41 affected runs from their last checkpoint.",
    sparkline: [0, 0, 0, 1, 3, 6, 9, 7, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: "inc_2ab41f09cc31",
    signature: "llm_timeout · Summariser · 60s",
    firstSeen: iso(NOW - 26 * 3600_000),
    lastSeen: iso(NOW - 5 * 3600_000),
    occurrences: 23,
    affectedWorkflows: ["support-triage", "churn-signals"],
    affectedRuns: 23,
    status: "acknowledged",
    assignee: "platform-ops",
    remediation: "Provider latency exceeded the node timeout. Raise the timeout to 90s or switch this node to claude-haiku-4.",
    sparkline: [2, 3, 1, 0, 0, 1, 4, 5, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: "inc_9de77b204a15",
    signature: "approval_expired · Refund over £500",
    firstSeen: iso(NOW - 52 * 3600_000),
    lastSeen: iso(NOW - 19 * 3600_000),
    occurrences: 6,
    affectedWorkflows: ["refund-approvals"],
    affectedRuns: 6,
    status: "open",
    assignee: "billing",
    remediation: "Six approvals breached their 4-hour SLA with no reviewer online. Add a second approver group or extend the SLA.",
    sparkline: [0, 1, 0, 0, 2, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
];

/* ── Approvals — with RESOLVED values, never template chips ───────────────── */

export const APPROVALS: Approval[] = [
  {
    id: `apr_${uuid().slice(0, 8)}`,
    runId: RUNS.find((r) => r.status === "awaiting-approval")?.id ?? runId(),
    workflowName: "refund-approvals",
    nodeName: "Await approval",
    requestedAt: iso(NOW - 34 * 60_000),
    slaRemainingMs: 26 * 60_000,
    requester: "dunning-escalation",
    context: [
      { label: "Customer", value: "Northwind Trading Ltd", source: "hubspot.getContact → company.name" },
      { label: "Refund amount", value: "£842.00", source: "stripe.getInvoice → amount_due" },
      { label: "Original invoice", value: "INV-2026-04182", source: "stripe.getInvoice → number" },
      { label: "Reason given", value: "Duplicate charge after failed retry", source: "Classify intent → reason" },
      { label: "Account age", value: "3 years, 2 months", source: "hubspot.getContact → createdate" },
      { label: "Lifetime value", value: "£48,210", source: "postgres.query → ltv_gbp" },
    ],
  },
  {
    id: `apr_${uuid().slice(0, 8)}`,
    runId: runId(),
    workflowName: "customer-onboarding",
    nodeName: "Await approval",
    requestedAt: iso(NOW - 3.2 * 3600_000),
    slaRemainingMs: -12 * 60_000, // already breached
    requester: "trial-conversion",
    context: [
      { label: "Customer", value: "Kestrel Analytics GmbH", source: "hubspot.getContact → company.name" },
      { label: "Requested seats", value: "240", source: "sheets.readRange → B14" },
      { label: "Discount asked", value: "22% (policy cap 15%)", source: "Classify intent → discount_pct" },
      { label: "Contract term", value: "24 months", source: "contracts.getUpcomingRenewals → term_months" },
      { label: "Approver group", value: "billing", source: "Policy: discount > 15%" },
    ],
  },
];

/* ── Ready-made run shapes for the Ribbon gallery ─────────────────────────── */

export const RIBBON_SHAPES: { label: string; description: string; run: Run }[] = [
  {
    label: "Clean success",
    description: "12 of 12 committed. Nothing to do.",
    run: { ...RUNS[0], status: "succeeded", nodes: buildNodes(12) },
  },
  {
    label: "Mid-run failure",
    description: "Died at node 2 of 12 — a retry costs 10 nodes.",
    run: SIGNATURE_RUN,
  },
  {
    label: "Failure after many commits",
    description: "8 of 12 committed before it died. A retry costs 4 nodes, not 12. This is the thesis.",
    run: { ...SIGNATURE_RUN, id: runId(), nodes: buildNodes(12, { failAt: 8 }) },
  },
  {
    label: "Gated and waiting",
    description: "Blocked on a person at node 5. Ember, breathing.",
    run: { ...SIGNATURE_RUN, id: runId(), status: "awaiting-approval", nodes: buildNodes(9, { gateAt: 5 }) },
  },
  {
    label: "Executing now",
    description: "Node 6 in flight. Pulse, breathing.",
    run: { ...SIGNATURE_RUN, id: runId(), status: "running", nodes: buildNodes(11, { executingAt: 6 }) },
  },
  {
    label: "Recovered after retry",
    description: "Nodes 3 and 7 failed once, then committed. Verdant with an ember notch.",
    run: { ...SIGNATURE_RUN, id: runId(), status: "succeeded", nodes: buildNodes(13, { recoveredAt: [3, 7], skipped: [10] }) },
  },
  {
    label: "200 nodes, collapsed",
    description: "Beyond 40 cells it collapses to proportional segments — and the failure at 137 survives the collapse.",
    run: { ...SIGNATURE_RUN, id: runId(), nodes: buildNodes(200, { failAt: 137 }) },
  },
  {
    label: "Single node",
    description: "One cell still has to read as a Ribbon, not as a dot.",
    run: { ...SIGNATURE_RUN, id: runId(), status: "succeeded", nodes: buildNodes(1) },
  },
  {
    label: "All pending",
    description: "Queued. Accepted, not started — nothing committed yet.",
    run: { ...SIGNATURE_RUN, id: runId(), status: "queued", nodes: buildNodes(10, { allPending: true }) },
  },
];
