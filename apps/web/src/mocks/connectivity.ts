import { CONNECTIONS, RUNS, WORKFLOWS, TOOLS } from "./fixtures";
import { currentVersion } from "./workflow-versions";
import { AGENT_RECORDS } from "./registry";
import type { ProviderId } from "~/components/ui/provider-logo";
import type { Environment, TriggerKind } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   CONNECTIVITY — the catalogue, the operational view, and the schedule.

   Three surfaces because they answer three different questions, and the current
   product collapses them: Integrations is "what can I connect to", Connections
   is "what is broken right now", Triggers is "what is about to run". Webhooks
   had nowhere to live at all despite being a shipped feature.

   BLAST RADIUS IS THE POINT OF THE CONNECTIONS PAGE. The production failure in
   the logs — node n1001 dying because ‘Postgres Answers’ was unusable — was
   knowable before it broke anything, and the only reason it was not is that no
   screen ever said what a connection blocks. "3 workflows, 7 tools, 22 queued
   runs" is that screen.
══════════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-11T14:20:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Integrations ─────────────────────────────────────────────────────────── */

export type IntegrationCategory =
  | "ai" | "database" | "messaging" | "crm" | "productivity" | "developer" | "generic";

export const INTEGRATION_CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  ai: "AI models",
  database: "Databases",
  messaging: "Messaging",
  crm: "CRM and sales",
  productivity: "Productivity",
  developer: "Developer",
  generic: "Generic",
};

export type AuthMethod = "oauth" | "api-key" | "connection-string" | "none";

export const AUTH_LABEL: Record<AuthMethod, string> = {
  oauth: "OAuth 2.0",
  "api-key": "API key",
  "connection-string": "Connection string",
  none: "No credentials",
};

export interface IntegrationRecord {
  id: ProviderId;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** Tool names this integration supplies. */
  tools: string[];
  authMethods: AuthMethod[];
  scopes: { name: string; description: string; required: boolean }[];
  setup: string[];
  /** Existing connections in this workspace. */
  connectionNames: string[];
}

const INTEGRATION_SEEDS: {
  id: ProviderId;
  name: string;
  category: IntegrationCategory;
  description: string;
  auth: AuthMethod[];
  scopes: { name: string; description: string; required: boolean }[];
  setup: string[];
}[] = [
  {
    id: "postgres", name: "Postgres", category: "database",
    description: "Read and write against a Postgres database, with parameters bound rather than interpolated.",
    auth: ["connection-string"],
    scopes: [
      { name: "read", description: "SELECT against the tables you grant.", required: true },
      { name: "write", description: "INSERT and UPDATE. Leave off for a read-only connection.", required: false },
    ],
    setup: [
      "Create a role for Vectorbea rather than reusing an application role.",
      "Grant it only the tables the workflows need.",
      "Allow the Vectorbea egress range, or use a private runner if the database is not reachable from the internet.",
      "Paste the connection string. It is encrypted at rest and never shown again.",
    ],
  },
  {
    id: "slack", name: "Slack", category: "messaging",
    description: "Post messages, reply in threads and look up users in a Slack workspace.",
    auth: ["oauth"],
    scopes: [
      { name: "chat:write", description: "Post messages as the app.", required: true },
      { name: "channels:read", description: "Resolve channel names to ids.", required: true },
      { name: "users:read", description: "Look up a user by email.", required: false },
    ],
    setup: [
      "Authorise the Vectorbea app in your Slack workspace.",
      "Choose the channels it may post to — the grant is per channel, not workspace-wide.",
      "Send a test message before saving.",
    ],
  },
  {
    id: "hubspot", name: "HubSpot", category: "crm",
    description: "Read contacts, companies and deals, and write back deal stages.",
    auth: ["oauth", "api-key"],
    scopes: [
      { name: "crm.objects.contacts.read", description: "Read contacts and their companies.", required: true },
      { name: "crm.objects.deals.write", description: "Update deal stages and properties.", required: false },
    ],
    setup: [
      "Authorise through HubSpot's OAuth flow, or paste a private app token.",
      "Select the object types the workflows need.",
      "Test against a known contact id.",
    ],
  },
  {
    id: "gmail", name: "Gmail", category: "productivity",
    description: "Send mail from a workspace mailbox and search existing threads.",
    auth: ["oauth"],
    scopes: [
      { name: "gmail.send", description: "Send mail as the connected mailbox.", required: true },
      { name: "gmail.readonly", description: "Search and read threads.", required: false },
    ],
    setup: [
      "Authorise a shared mailbox rather than a personal one — a personal account leaves with the person.",
      "Grant send, and read only if a workflow needs to search.",
      "Send a test message to yourself before saving.",
    ],
  },
  {
    id: "github", name: "GitHub", category: "developer",
    description: "Open issues, read pull requests and comment on both.",
    auth: ["oauth", "api-key"],
    scopes: [
      { name: "repo", description: "Read and write issues and pull requests.", required: true },
      { name: "read:org", description: "Resolve team names.", required: false },
    ],
    setup: [
      "Install the Vectorbea GitHub app on the organisation.",
      "Choose the repositories it may act on.",
      "Test by reading a pull request.",
    ],
  },
  {
    id: "notion", name: "Notion", category: "productivity",
    description: "Create pages and query databases in a Notion workspace.",
    auth: ["oauth", "api-key"],
    scopes: [
      { name: "content.read", description: "Query databases and read pages.", required: true },
      { name: "content.write", description: "Create and update pages.", required: false },
    ],
    setup: [
      "Create an internal integration in Notion.",
      "Share the specific databases with it — Notion grants access per page, not per workspace.",
      "Paste the integration token.",
    ],
  },
  {
    id: "airtable", name: "Airtable", category: "productivity",
    description: "Read and upsert records in an Airtable base.",
    auth: ["api-key"],
    scopes: [
      { name: "data.records:read", description: "Read records.", required: true },
      { name: "data.records:write", description: "Create and update records.", required: false },
    ],
    setup: ["Create a personal access token scoped to one base.", "Paste it and pick the base."],
  },
  {
    id: "openai", name: "OpenAI", category: "ai",
    description: "Bring your own OpenAI key so model spend is billed to you rather than the workspace.",
    auth: ["api-key"],
    scopes: [{ name: "models", description: "Invoke chat and embedding models.", required: true }],
    setup: [
      "Create a key scoped to a project rather than an organisation.",
      "Set a spend limit on the key — Vectorbea's cost ceilings are a second line, not the first.",
      "Paste it and run a test completion.",
    ],
  },
  {
    id: "anthropic", name: "Anthropic", category: "ai",
    description: "Bring your own Anthropic key for Claude models.",
    auth: ["api-key"],
    scopes: [{ name: "models", description: "Invoke Claude models.", required: true }],
    setup: ["Create a key in the Anthropic console.", "Set a spend limit.", "Paste it and run a test completion."],
  },
  {
    id: "gemini", name: "Google Gemini", category: "ai",
    description: "Bring your own Google AI key for Gemini models.",
    auth: ["api-key"],
    scopes: [{ name: "models", description: "Invoke Gemini models.", required: true }],
    setup: ["Create a key in Google AI Studio.", "Paste it and run a test completion."],
  },
  {
    id: "mistral", name: "Mistral", category: "ai",
    description: "Bring your own Mistral key.",
    auth: ["api-key"],
    scopes: [{ name: "models", description: "Invoke Mistral models.", required: true }],
    setup: ["Create a key in the Mistral console.", "Paste it and run a test completion."],
  },
  {
    id: "mysql", name: "MySQL", category: "database",
    description: "Read and write against a MySQL database.",
    auth: ["connection-string"],
    scopes: [
      { name: "read", description: "SELECT against granted tables.", required: true },
      { name: "write", description: "INSERT and UPDATE.", required: false },
    ],
    setup: ["Create a dedicated role.", "Grant only the needed tables.", "Paste the connection string."],
  },
  {
    id: "jira", name: "Jira", category: "developer",
    description: "Create tickets and move them through a workflow.",
    auth: ["oauth", "api-key"],
    scopes: [
      { name: "write:jira-work", description: "Create and transition issues.", required: true },
      { name: "read:jira-work", description: "Read issues and projects.", required: true },
    ],
    setup: ["Authorise the Atlassian app.", "Pick the projects it may write to.", "Test by reading a project."],
  },
  {
    id: "google-sheets", name: "Google Sheets", category: "productivity",
    description: "Read ranges and append rows to a spreadsheet.",
    auth: ["oauth"],
    scopes: [
      { name: "spreadsheets", description: "Read and write the sheets you share with it.", required: true },
    ],
    setup: ["Authorise with Google.", "Share the specific spreadsheets with the service account.", "Test a read."],
  },
  {
    id: "webhook", name: "Outbound webhook", category: "generic",
    description: "Send a signed POST to any HTTPS endpoint you control.",
    auth: ["none", "api-key"],
    scopes: [],
    setup: [
      "Give the destination URL. It must be HTTPS.",
      "Copy the signing secret and verify the signature at your end — an unverified webhook endpoint is an open door.",
    ],
  },
  {
    id: "http", name: "Generic HTTP", category: "generic",
    description: "Call any HTTP API with headers and a body you define.",
    auth: ["none", "api-key"],
    scopes: [],
    setup: [
      "Define the base URL and any static headers.",
      "Store the credential as a workspace secret rather than inlining it in the header.",
    ],
  },
];

export const INTEGRATIONS: IntegrationRecord[] = INTEGRATION_SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  category: seed.category,
  description: seed.description,
  tools: TOOLS.filter((t) => t.provider === seed.id).map((t) => t.name),
  authMethods: seed.auth,
  scopes: seed.scopes,
  setup: seed.setup,
  connectionNames: CONNECTIONS.filter((c) => c.provider === seed.id).map((c) => c.name),
}));

export const integrationById = (id: string) => INTEGRATIONS.find((i) => i.id === id);

/* ── Connections ──────────────────────────────────────────────────────────── */

export type ConnectionType = "oauth" | "api-key" | "connection-string";

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
}

export interface ConnectionRecord {
  id: string;
  name: string;
  provider: string;
  type: ConnectionType;
  status: "healthy" | "degraded" | "failing";
  latencyMs: number | null;
  /** Latency per hour over the last 24, for the trend sparkline. */
  latencyTrend: number[];
  lastCheckedAt: string;
  createdAt: string;
  lastUsedAt: string;
  /** OAuth tokens expire. Null for keys and connection strings. */
  expiresAt: string | null;
  /** Governance: restricted to reads only. */
  readOnly: boolean;
  scopes: string[];
  healthHistory: ("healthy" | "degraded" | "failing")[];
  recentErrors: { runId: string; at: string; message: string }[];
  audit: AuditEntry[];
  /** True when the connection reaches a system not on the public internet. */
  needsPrivateRunner: boolean;
}

export const CONNECTION_RECORDS: ConnectionRecord[] = CONNECTIONS.map((connection, i) => {
  const rng = seeded(connection.id);
  const type: ConnectionType = connection.provider === "postgres" || connection.provider === "mysql"
    ? "connection-string"
    : ["slack", "gmail", "github"].includes(connection.provider) ? "oauth" : "api-key";

  const base = connection.latencyMs ?? 900;

  return {
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    type,
    status: connection.status,
    latencyMs: connection.latencyMs,
    latencyTrend: Array.from({ length: 24 }, (_, h) =>
      Math.max(20, Math.round(base * (0.7 + rng() * 0.8) * (connection.status === "failing" && h > 18 ? 2.4 : 1)))),
    lastCheckedAt: connection.lastCheckedAt,
    createdAt: iso(NOW - Math.round(40 + rng() * 300) * 86_400_000),
    lastUsedAt: iso(NOW - Math.round(rng() * 300) * 60_000),
    // Only OAuth expires. A key that "expires" would be a lie about how it works.
    expiresAt: type === "oauth" ? iso(NOW + Math.round((i === 3 ? 5 : 40 + rng() * 120)) * 86_400_000) : null,
    readOnly: connection.provider === "postgres" && i > 0,
    scopes: INTEGRATIONS.find((x) => x.id === connection.provider)?.scopes.map((s) => s.name) ?? [],
    healthHistory: Array.from({ length: 30 }, (_, d) => {
      if (connection.status === "failing") return d > 25 ? "failing" : rng() < 0.1 ? "degraded" : "healthy";
      if (connection.status === "degraded") return rng() < 0.3 ? "degraded" : "healthy";
      return rng() < 0.05 ? "degraded" : "healthy";
    }),
    recentErrors: connection.status === "healthy" ? [] : RUNS
      .filter((r) => r.status === "failed")
      .slice(i, i + 3)
      .map((r) => ({
        runId: r.id,
        at: r.startedAt,
        message: r.nodes.find((n) => n.state === "failed")?.error?.message ?? "Failed without a structured error.",
      })),
    audit: [
      { at: iso(NOW - Math.round(2 + rng() * 40) * 86_400_000), actor: "priya.raman", action: "Created the connection" },
      ...(rng() < 0.5 ? [{ at: iso(NOW - Math.round(1 + rng() * 20) * 86_400_000), actor: "d.okafor", action: "Rotated credentials" }] : []),
      ...(connection.status !== "healthy" ? [{ at: connection.lastCheckedAt, actor: "system", action: `Health check failed — marked ${connection.status}` }] : []),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    needsPrivateRunner: connection.provider === "postgres" || connection.provider === "mysql",
  };
});

export const connectionById = (id: string) => CONNECTION_RECORDS.find((c) => c.id === id);

/* ── Blast radius ─────────────────────────────────────────────────────────── */

export interface BlastRadius {
  workflows: { id: string; name: string; environment: Environment; nodeName: string }[];
  tools: string[];
  agents: string[];
  queuedRuns: number;
  /** Run ids, so callers can union across connections without double-counting. */
  queuedRunIds: string[];
  /** The one-line summary. */
  sentence: string;
}

/**
 * Exactly what a connection blocks.
 *
 * Resolved from the live graphs rather than stored, so it cannot go stale the
 * first time somebody rewires a workflow. This is the number that would have
 * made the Postgres failure visible before it took out 41 runs.
 */
export function blastRadius(connection: ConnectionRecord): BlastRadius {
  const workflows: BlastRadius["workflows"] = [];
  const tools = new Set<string>();

  for (const workflow of WORKFLOWS) {
    for (const node of currentVersion(workflow.id)?.nodes ?? []) {
      if (node.config.connection !== connection.name) continue;
      workflows.push({
        id: workflow.id,
        name: workflow.name,
        environment: workflow.environment,
        nodeName: node.name,
      });
      const tool = node.config.tool;
      if (typeof tool === "string") tools.add(tool);
    }
  }

  // Tools registered against the same provider are blocked even where no
  // workflow binds them yet — they cannot be called while this is down.
  for (const tool of TOOLS.filter((t) => t.provider === connection.provider)) tools.add(tool.name);

  const agents = AGENT_RECORDS
    .filter((a) => a.grants.some((g) => tools.has(g.tool)))
    .map((a) => a.name);

  const workflowIds = new Set(workflows.map((w) => w.id));
  const queued = RUNS.filter(
    (r) => workflowIds.has(r.workflowId) && (r.status === "queued" || r.status === "awaiting-approval"),
  );
  const queuedRuns = queued.length;

  const parts: string[] = [];
  if (workflows.length > 0) parts.push(`${workflows.length} ${workflows.length === 1 ? "workflow" : "workflows"}`);
  if (tools.size > 0) parts.push(`${tools.size} ${tools.size === 1 ? "tool" : "tools"}`);
  if (queuedRuns > 0) parts.push(`${queuedRuns} queued ${queuedRuns === 1 ? "run" : "runs"}`);

  return {
    workflows,
    tools: [...tools],
    agents,
    queuedRuns,
    queuedRunIds: queued.map((r) => r.id),
    sentence: parts.length === 0
      ? "Nothing depends on this connection yet."
      : `Blocks ${parts.join(", ")}.`,
  };
}

/** Connections whose OAuth token expires inside the window. */
export function expiringSoon(days = 14): ConnectionRecord[] {
  const floor = NOW + days * 86_400_000;
  return CONNECTION_RECORDS.filter((c) => c.expiresAt !== null && Date.parse(c.expiresAt) <= floor);
}

export interface HealthSummary {
  connected: number;
  degraded: number;
  failing: number;
  expiring: number;
}

export function healthSummary(): HealthSummary {
  return {
    connected: CONNECTION_RECORDS.filter((c) => c.status === "healthy").length,
    degraded: CONNECTION_RECORDS.filter((c) => c.status === "degraded").length,
    failing: CONNECTION_RECORDS.filter((c) => c.status === "failing").length,
    expiring: expiringSoon().length,
  };
}

/* ── Triggers ─────────────────────────────────────────────────────────────── */

export type OverlapPolicy = "skip" | "queue" | "concurrent";

export const OVERLAP_LABEL: Record<OverlapPolicy, string> = {
  skip: "Skip the firing",
  queue: "Queue it behind",
  concurrent: "Run concurrently",
};

export const OVERLAP_HELP: Record<OverlapPolicy, string> = {
  skip: "The firing is dropped. Correct when a run covers a window — a skipped 06:00 is picked up by the 07:00.",
  queue: "The firing waits for the running one. Correct when every window must be processed exactly once, in order.",
  concurrent: "Both run. Only correct when the work is genuinely independent per firing.",
};

export interface Delivery {
  id: string;
  at: string;
  status: number;
  durationMs: number;
  ok: boolean;
}

export interface TriggerRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  environment: Environment;
  type: TriggerKind;
  enabled: boolean;
  /** Human summary for the list. */
  summary: string;

  // Schedule
  cron: string | null;
  timezone: string | null;
  jitterSeconds: number;
  overlap: OverlapPolicy;
  catchUp: boolean;
  startsAt: string | null;
  endsAt: string | null;
  nextFires: string[];

  // Webhook
  url: string | null;
  secretLast4: string | null;
  signatureHeader: string | null;
  rateLimitPerMinute: number | null;
  deliveries: Delivery[];

  // Manual / API
  endpoint: string | null;

  lastFireAt: string | null;
  lastFireOk: boolean | null;
  successRate: number;
}

/** Next N fire times for a cron. Deliberately simple — hourly/daily/weekly only. */
function nextFires(cron: string, count: number): string[] {
  const out: string[] = [];
  const parts = cron.split(" ");
  const minute = Number(parts[0]) || 0;
  const hour = parts[1];

  if (hour === "*/4" || parts[1]?.startsWith("*/")) {
    const step = Number(parts[1].slice(2)) || 4;
    let t = NOW;
    for (let i = 0; i < count; i += 1) {
      const d = new Date(t);
      d.setUTCMinutes(minute, 0, 0);
      d.setUTCHours(Math.ceil((d.getUTCHours() + 1) / step) * step);
      if (d.getTime() <= t) d.setUTCHours(d.getUTCHours() + step);
      out.push(iso(d.getTime()));
      t = d.getTime();
    }
    return out;
  }

  const h = Number(hour) || 0;
  const weekday = parts[4] && parts[4] !== "*" ? Number(parts[4]) : null;
  const d = new Date(NOW);
  d.setUTCHours(h, minute, 0, 0);
  if (d.getTime() <= NOW) d.setUTCDate(d.getUTCDate() + 1);

  while (out.length < count) {
    if (weekday === null || d.getUTCDay() === weekday) out.push(iso(d.getTime()));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const SCHEDULE_SUMMARY: Record<string, string> = {
  "0 6 * * *": "Daily at 06:00",
  "0 */4 * * *": "Every 4 hours",
  "30 2 * * *": "Daily at 02:30",
  "0 0 * * *": "Daily at midnight",
  "0 9 * * 1": "Mondays at 09:00",
  "0 9 * * *": "Daily at 09:00",
};

/** `0 6 * * *` → "Daily at 06:00". The preview beside the cron field. */
export function describeCron(cron: string): string {
  return SCHEDULE_SUMMARY[cron] ?? `Cron: ${cron}`;
}

/**
 * True when the timezone observes DST, so a fixed local time shifts in UTC.
 *
 * Worth a warning rather than silence: a workflow set to 09:00 Europe/London
 * fires an hour earlier in UTC for half the year, and anything correlating its
 * output with a UTC system will drift twice a year without explanation.
 */
export function observesDst(timezone: string | null): boolean {
  return timezone !== null && timezone !== "UTC";
}

export const TRIGGER_RECORDS: TriggerRecord[] = WORKFLOWS.flatMap((workflow) =>
  workflow.triggers.map((trigger) => {
    const rng = seeded(trigger.id);
    const cron = trigger.kind === "schedule" ? trigger.detail : null;
    const runs = RUNS.filter((r) => r.workflowId === workflow.id);
    const last = runs[0] ?? null;

    return {
      id: trigger.id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      environment: workflow.environment,
      type: trigger.kind,
      enabled: trigger.enabled,
      summary: trigger.summary,

      cron,
      timezone: trigger.timezone,
      jitterSeconds: trigger.kind === "schedule" ? Math.round(rng() * 60) : 0,
      overlap: (["skip", "queue", "concurrent"] as OverlapPolicy[])[Math.floor(rng() * 3)],
      catchUp: rng() < 0.4,
      startsAt: null,
      endsAt: null,
      nextFires: cron && trigger.enabled ? nextFires(cron, 5) : [],

      url: trigger.kind === "webhook" ? trigger.detail : null,
      secretLast4: trigger.kind === "webhook" ? String(Math.floor(rng() * 9000) + 1000) : null,
      signatureHeader: trigger.kind === "webhook" ? "X-Vectorbea-Signature" : null,
      rateLimitPerMinute: trigger.kind === "webhook" ? 60 : null,
      deliveries: trigger.kind === "webhook"
        ? Array.from({ length: 6 }, (_, i) => {
          const ok = rng() > 0.25;
          return {
            id: `dlv_${trigger.id}_${i}`,
            at: iso(NOW - (i + 1) * Math.round(18 + rng() * 90) * 60_000),
            status: ok ? 200 : rng() > 0.5 ? 500 : 429,
            durationMs: Math.round(60 + rng() * 900),
            ok,
          };
        })
        : [],

      endpoint: trigger.kind === "api" || trigger.kind === "manual"
        ? `POST https://api.vectorbea.com/v1/workflows/${workflow.name}/runs`
        : null,

      lastFireAt: last?.startedAt ?? null,
      lastFireOk: last ? last.status === "succeeded" : null,
      successRate: workflow.successRate30d,
    };
  }),
);

export const triggerById = (id: string) => TRIGGER_RECORDS.find((t) => t.id === id);

/* ── Calendar ─────────────────────────────────────────────────────────────── */

export interface CalendarFire {
  at: string;
  triggerId: string;
  workflowName: string;
  environment: Environment;
}

export interface CalendarSlot {
  /** Hour bucket, ISO. */
  at: string;
  fires: CalendarFire[];
}

/**
 * Upcoming fires across every schedule, bucketed by hour.
 *
 * Bucketing is what makes collisions visible: three workflows all set to 06:00
 * look like three separate rows on three separate pages, and like one crowded
 * hour here. Quiet periods are the same information inverted.
 */
export function calendar(hours = 48): CalendarSlot[] {
  const start = new Date(NOW);
  start.setUTCMinutes(0, 0, 0);

  const slots: CalendarSlot[] = Array.from({ length: hours }, (_, h) => ({
    at: iso(start.getTime() + h * 3600_000),
    fires: [],
  }));

  for (const trigger of TRIGGER_RECORDS) {
    for (const at of trigger.nextFires) {
      const index = Math.floor((Date.parse(at) - start.getTime()) / 3600_000);
      if (index < 0 || index >= slots.length) continue;
      slots[index].fires.push({
        at,
        triggerId: trigger.id,
        workflowName: trigger.workflowName,
        environment: trigger.environment,
      });
    }
  }

  return slots;
}

/* ── Backfill ─────────────────────────────────────────────────────────────── */

export interface BackfillEstimate {
  runs: number;
  costUsd: number;
  durationMs: number;
}

/**
 * What running a schedule over a past range would cost.
 *
 * Stated before the confirmation, because a backfill over three months of an
 * hourly schedule is two thousand runs and people reach for it casually.
 */
export function backfillEstimate(trigger: TriggerRecord, fromMs: number, toMs: number): BackfillEstimate {
  if (!trigger.cron) return { runs: 0, costUsd: 0, durationMs: 0 };

  const perDay = trigger.cron.includes("*/")
    ? 24 / (Number(trigger.cron.split(" ")[1].slice(2)) || 4)
    : trigger.cron.split(" ")[4] !== "*" ? 1 / 7 : 1;

  const days = Math.max(0, (toMs - fromMs) / 86_400_000);
  const runs = Math.round(days * perDay);
  const workflow = WORKFLOWS.find((w) => w.id === trigger.workflowId);
  const perRun = workflow && workflow.spend30dUsd > 0 ? workflow.spend30dUsd / 30 : 0.003;

  return {
    runs,
    costUsd: Number((runs * perRun).toFixed(4)),
    durationMs: runs * (workflow?.avgDurationMs ?? 40_000),
  };
}
