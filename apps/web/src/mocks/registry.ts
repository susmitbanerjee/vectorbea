import { AGENTS, TOOLS, CONNECTIONS, WORKFLOWS, RUNS } from "./fixtures";
import { currentVersion } from "./workflow-versions";
import type { Environment, RiskLevel } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   THE REGISTRIES — agents and tools as records rather than cards.

   §1 diagnosis #2: six pages, one card-grid layout, so the IA is invisible.
   A registry is a comparison surface — you come here to find the agent that
   costs too much or the tool that fails most — and comparison is what a table
   does and a grid of cards cannot.

   TWO SURFACES HERE DO REAL GOVERNANCE WORK, and both were a bare number
   before:

   · TOOL GRANTS on an agent. "5 tool grants" tells you nothing about whether
     this agent can issue refunds in production. The matrix does.
   · RISK POLICY on a tool. Risk levels existed as a coloured word and enforced
     nothing. Here each level carries what it actually requires, and a
     high-risk tool that can run without an approval gate is stated as the
     governance defect it is.
══════════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-11T14:20:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

/** Deterministic PRNG, seeded per record so the same numbers come back. */
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

/* ── Reverse index ────────────────────────────────────────────────────────── */

export interface Reference {
  workflowId: string;
  workflowName: string;
  environment: Environment;
  nodeId: string;
  nodeName: string;
}

/**
 * Which workflow steps reference a given tool or agent.
 *
 * Built once over every workflow's live version. This is the answer to "what
 * breaks if I change this", and it is the reason the detail panel can warn
 * about a breaking schema change instead of leaving the user to grep.
 */
function buildIndex(): { tools: Map<string, Reference[]>; agents: Map<string, Reference[]> } {
  const tools = new Map<string, Reference[]>();
  const agents = new Map<string, Reference[]>();

  for (const workflow of WORKFLOWS) {
    for (const node of currentVersion(workflow.id)?.nodes ?? []) {
      const reference: Reference = {
        workflowId: workflow.id,
        workflowName: workflow.name,
        environment: workflow.environment,
        nodeId: node.id,
        nodeName: node.name,
      };

      const tool = node.config.tool;
      if (typeof tool === "string" && tool) {
        tools.set(tool, [...(tools.get(tool) ?? []), reference]);
      }
      if (node.kind === "agent") {
        const model = String(node.config.model ?? "");
        agents.set(model, [...(agents.get(model) ?? []), reference]);
      }
    }
  }

  return { tools, agents };
}

const INDEX = buildIndex();

/* ── Agents ───────────────────────────────────────────────────────────────── */

export type AgentType = "task" | "router" | "reviewer" | "researcher";
export type RegistryStatus = "active" | "paused" | "draft";

export interface ToolGrant {
  tool: string;
  risk: RiskLevel;
  /** Where the grant applies. An empty list means the grant is inert. */
  environments: Environment[];
  /** Whether calling it from this agent forces an approval gate. */
  requiresApproval: boolean;
}

export interface PromptVersion {
  version: number;
  at: string;
  author: string;
  summary: string;
  text: string;
}

export interface Guardrails {
  maxIterations: number;
  costCeilingUsd: number;
  timeoutMs: number;
  contentFilters: string[];
  forbiddenActions: string[];
}

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  model: string;
  provider: string;
  type: AgentType;
  status: RegistryStatus;
  grants: ToolGrant[];
  runs30d: number;
  successRate: number;
  avgTokens: number;
  avgCostUsd: number;
  p95DurationMs: number;
  lastUsedAt: string;
  version: number;
  owner: string;

  byokConnection: string | null;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  outputSchema: "strict" | "lenient" | "none";
  guardrails: Guardrails;
  promptVersions: PromptVersion[];

  /** Success rate per day over 30 days, oldest first. */
  successTrend: number[];
  costTrend: number[];
  /** Token counts bucketed for a distribution chart. */
  tokenBuckets: { upper: number; count: number }[];
  failureReasons: { reason: string; count: number }[];
  usedBy: Reference[];
}

const AGENT_TYPES: AgentType[] = ["task", "router", "reviewer", "researcher"];

const DESCRIPTIONS: Record<string, string> = {
  "Triage agent": "Reads an inbound ticket, decides its urgency and routes it to the right rota.",
  "Summariser": "Condenses a batch of records into the two or three sentences a human needs.",
  "Renewal classifier": "Sorts upcoming renewals by how much attention each one needs.",
  "Refund reviewer": "Checks a refund request against policy and assembles the evidence for the approver.",
  "Churn scorer": "Scores an account's usage decay and explains which signal moved the number.",
  "Invoice matcher": "Matches payouts to ledger entries and files anything that will not reconcile.",
  "Support router": "Picks the queue and the priority for an inbound support conversation.",
  "Contract reader": "Extracts terms, dates and amounts from a signed contract.",
  "Usage analyst": "Aggregates metered usage and reports what changed against last period.",
  "Escalation writer": "Drafts the escalation message, with the account history attached.",
  "Sentiment tagger": "Tags a conversation with sentiment and the reason for it.",
  "Dunning composer": "Writes the next dunning touch, escalating tone by attempt.",
  "Onboarding guide": "Walks a new workspace through provisioning and books the kickoff.",
  "NPS reader": "Reads free-text survey responses and pulls out the actionable ones.",
  "Trial nudger": "Decides which trials are worth a nudge and what to say.",
  "Report writer": "Assembles the periodic report from the numbers the run collected.",
  "QA checker": "Reviews another agent's output against the task it was given.",
};

function buildPromptVersions(name: string, rng: () => number, count: number): PromptVersion[] {
  const authors = ["priya.raman", "d.okafor", "m.lindqvist", "s.aggarwal"];
  const changes = [
    "Told it to cite the field it based each decision on.",
    "Tightened the output schema — it was returning prose alongside the JSON.",
    "Added the policy cap so it stops proposing discounts it cannot grant.",
    "Removed the few-shot examples; they were biasing towards the first case.",
    "Made it refuse rather than guess when the account is missing.",
  ];

  return Array.from({ length: count }, (_, i) => ({
    version: i + 1,
    at: iso(NOW - (count - i) * Math.round(3 + rng() * 9) * 86_400_000),
    author: authors[Math.floor(rng() * authors.length)],
    summary: i === 0 ? "Created." : changes[(i - 1) % changes.length],
    text: i === 0
      ? `You are ${name}. ${DESCRIPTIONS[name] ?? ""}\n\nWork from the data supplied. Do not invent facts.`
      : `You are ${name}. ${DESCRIPTIONS[name] ?? ""}\n\nWork from the data supplied. Do not invent facts.\nCite the source field for every value you report.\nIf a required value is missing, say so and stop.`,
  }));
}

export const AGENT_RECORDS: AgentRecord[] = AGENTS.map((agent, i) => {
  const rng = seeded(agent.id);
  const promptCount = 1 + Math.floor(rng() * 5);
  const promptVersions = buildPromptVersions(agent.name, rng, promptCount);
  const runs = Math.round(4 + rng() * 180);
  const successRate = Math.round(52 + rng() * 46);

  const grantedTools = TOOLS.filter((_, ti) => (ti * 7 + i * 3) % 11 < agent.toolGrants);

  return {
    id: agent.id,
    name: agent.name,
    description: DESCRIPTIONS[agent.name] ?? "No description yet.",
    model: agent.model,
    provider: agent.provider,
    type: AGENT_TYPES[i % AGENT_TYPES.length],
    status: i % 9 === 0 ? "paused" : i % 7 === 0 ? "draft" : "active",
    grants: grantedTools.map((tool, gi) => ({
      tool: tool.name,
      risk: tool.risk,
      /* A grant that is scoped to staging only is a real and common state, and
         it is invisible in a count. Critical tools are scoped narrowly here so
         the matrix has something worth reading. */
      environments: tool.risk === "critical"
        ? ["staging"]
        : tool.risk === "high" && gi % 2 === 0
          ? ["production", "staging"]
          : ["production", "staging", "development"],
      // The defect the matrix exists to surface: a high-risk grant with no gate.
      requiresApproval: tool.risk === "critical" || (tool.risk === "high" && gi % 3 !== 0),
    })),
    runs30d: runs,
    successRate,
    avgTokens: Math.round(600 + rng() * 8000),
    avgCostUsd: agent.costPerRunUsd,
    p95DurationMs: Math.round(1800 + rng() * 26000),
    lastUsedAt: iso(NOW - Math.round(rng() * 72) * 3600_000),
    version: promptCount,
    owner: ["platform-ops", "billing", "growth", "support-eng"][i % 4],

    byokConnection: i % 3 === 0 ? null : `${agent.provider} — workspace key`,
    systemPrompt: promptVersions[promptVersions.length - 1].text,
    temperature: Number((rng() * 0.7).toFixed(1)),
    maxTokens: [1024, 2048, 4096][i % 3],
    outputSchema: i % 4 === 0 ? "lenient" : "strict",
    guardrails: {
      maxIterations: 4 + Math.floor(rng() * 8),
      costCeilingUsd: Number((0.02 + rng() * 0.18).toFixed(3)),
      timeoutMs: [30_000, 60_000, 120_000][i % 3],
      contentFilters: ["no-pii-egress", ...(i % 2 === 0 ? ["no-credentials-in-output"] : [])],
      forbiddenActions: i % 3 === 0 ? ["delete", "refund"] : ["delete"],
    },
    promptVersions,

    successTrend: Array.from({ length: 30 }, () => Math.round(successRate + (rng() - 0.5) * 22)),
    costTrend: Array.from({ length: 30 }, () => Number((agent.costPerRunUsd * (0.6 + rng())).toFixed(4))),
    tokenBuckets: [500, 1500, 3000, 6000, 12000].map((upper) => ({
      upper,
      count: Math.round(rng() * runs),
    })),
    failureReasons: [
      { reason: "Output did not match the declared schema", count: Math.round(rng() * 14) },
      { reason: "Exceeded max iterations without concluding", count: Math.round(rng() * 9) },
      { reason: "Tool call failed and no fallback was set", count: Math.round(rng() * 7) },
      { reason: "Hit the cost ceiling mid-run", count: Math.round(rng() * 4) },
    ].filter((f) => f.count > 0).sort((a, b) => b.count - a.count),
    usedBy: INDEX.agents.get(agent.model) ?? [],
  };
});

/* ── Tools ────────────────────────────────────────────────────────────────── */

export type ToolType = "http" | "db-read" | "db-write" | "builtin" | "mcp";

export const TOOL_TYPE_LABEL: Record<ToolType, string> = {
  http: "HTTP",
  "db-read": "Database read",
  "db-write": "Database write",
  builtin: "Built-in",
  mcp: "MCP",
};

export interface SchemaParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  validation?: string;
}

export interface RiskPolicy {
  requiresApprovalGate: boolean;
  allowedEnvironments: Environment[];
  /** Empty means every agent may call it. */
  allowedAgents: string[];
  rateLimitPerMinute: number | null;
  auditAlways: boolean;
}

export interface SchemaVersion {
  version: number;
  at: string;
  author: string;
  summary: string;
  breaking: boolean;
  /** Fields removed or retyped — what makes it breaking. */
  breakingFields: string[];
}

export interface ToolRecord {
  id: string;
  name: string;
  description: string;
  type: ToolType;
  risk: RiskLevel;
  status: RegistryStatus;
  connection: string | null;
  calls30d: number;
  successRate: number;
  p95LatencyMs: number;
  timeoutMs: number;
  lastError: string | null;
  owner: string;

  endpoint: string;
  authMethod: string;
  parameters: SchemaParameter[];
  outputFields: SchemaParameter[];
  policy: RiskPolicy;

  latencyBuckets: { upperMs: number; count: number }[];
  errorBreakdown: { klass: string; count: number; share: number }[];
  recentFailures: { runId: string; at: string; message: string }[];
  versions: SchemaVersion[];
  usedBy: Reference[];
  usedByAgents: string[];
}

function toolType(name: string): ToolType {
  if (name.startsWith("postgres.") || name.startsWith("mysql.")) {
    return name.includes("insert") || name.includes("update") ? "db-write" : "db-read";
  }
  if (name.startsWith("http.") || name.startsWith("webhook.")) return "http";
  if (name.startsWith("contracts.")) return "mcp";
  return "http";
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  "postgres.query": "Runs a parameterised read against the bound Postgres connection.",
  "contracts.getUpcomingRenewals": "Lists contracts renewing inside a window, with amounts and tiers.",
  "stripe.refund": "Issues a refund against a charge. Irreversible.",
  "stripe.getInvoice": "Reads a single invoice by id.",
  "slack.postMessage": "Posts a message to a channel or thread.",
  "gmail.send": "Sends mail from the bound mailbox.",
  "github.createIssue": "Opens an issue on a repository.",
  "hubspot.getContact": "Reads a CRM contact and its associated company.",
};

/** Default policy for a risk tier. What the levels are supposed to mean. */
export function policyForRisk(risk: RiskLevel): RiskPolicy {
  switch (risk) {
    case "critical":
      return { requiresApprovalGate: true, allowedEnvironments: ["staging"], allowedAgents: [], rateLimitPerMinute: 5, auditAlways: true };
    case "high":
      return { requiresApprovalGate: true, allowedEnvironments: ["production", "staging"], allowedAgents: [], rateLimitPerMinute: 30, auditAlways: true };
    case "medium":
      return { requiresApprovalGate: false, allowedEnvironments: ["production", "staging", "development"], allowedAgents: [], rateLimitPerMinute: 120, auditAlways: false };
    default:
      return { requiresApprovalGate: false, allowedEnvironments: ["production", "staging", "development"], allowedAgents: [], rateLimitPerMinute: null, auditAlways: false };
  }
}

function parametersFor(name: string): SchemaParameter[] {
  const table: Record<string, SchemaParameter[]> = {
    "postgres.query": [
      { name: "sql", type: "string", required: true, description: "The statement to execute.", validation: "Must be a single statement. Multiple statements are rejected." },
      { name: "params", type: "array<any>", required: false, description: "Positional parameters, bound rather than interpolated.", defaultValue: "[]" },
      { name: "timeoutMs", type: "integer", required: false, description: "Statement timeout.", defaultValue: "30000", validation: "1000–120000" },
    ],
    "contracts.getUpcomingRenewals": [
      { name: "withinDays", type: "integer", required: true, description: "How far ahead to look.", defaultValue: "30", validation: "1–365" },
      { name: "accountIds", type: "array<string>", required: false, description: "Restrict to specific accounts." },
      { name: "includeCancelled", type: "boolean", required: false, description: "Include contracts already marked for cancellation.", defaultValue: "false" },
    ],
    "slack.postMessage": [
      { name: "channel", type: "string", required: true, description: "Channel id or name, including the hash.", validation: "Must start with # or C" },
      { name: "text", type: "string", required: true, description: "Message body, Slack markdown.", validation: "Max 40,000 characters" },
      { name: "threadTs", type: "string", required: false, description: "Reply into an existing thread." },
    ],
    "stripe.refund": [
      { name: "chargeId", type: "string", required: true, description: "The charge to refund.", validation: "Must start with ch_" },
      { name: "amount", type: "integer", required: false, description: "Minor units. Omit to refund in full." },
      { name: "reason", type: "string", required: false, description: "One of duplicate, fraudulent, requested_by_customer." },
    ],
  };

  return table[name] ?? [
    { name: "input", type: "object", required: true, description: "Arguments for the call, per the tool's own schema." },
  ];
}

function outputsFor(name: string): SchemaParameter[] {
  const table: Record<string, SchemaParameter[]> = {
    "postgres.query": [
      { name: "rows", type: "array<object>", required: true, description: "Result rows in declaration order." },
      { name: "rowCount", type: "integer", required: true, description: "Number of rows returned." },
    ],
    "contracts.getUpcomingRenewals": [
      { name: "renewals", type: "array<Renewal>", required: true, description: "Matching contracts, soonest first." },
      { name: "count", type: "integer", required: true, description: "Length of renewals." },
      { name: "queriedAt", type: "string<date-time>", required: true, description: "When the query ran." },
    ],
    "slack.postMessage": [
      { name: "ts", type: "string", required: true, description: "Message timestamp, usable as a thread id." },
      { name: "channel", type: "string", required: true, description: "Resolved channel id." },
    ],
  };
  return table[name] ?? [{ name: "result", type: "any", required: true, description: "Whatever the tool returned." }];
}

export const TOOL_RECORDS: ToolRecord[] = TOOLS.map((tool, i) => {
  const rng = seeded(tool.id);
  const calls = Math.round(10 + rng() * 2400);
  const successRate = tool.lastError ? Math.round(28 + rng() * 46) : Math.round(88 + rng() * 12);
  const type = toolType(tool.name);
  const basePolicy = policyForRisk(tool.risk);
  const connection = CONNECTIONS.find((c) => c.provider === tool.provider)?.name ?? null;

  return {
    id: tool.id,
    name: tool.name,
    description: TOOL_DESCRIPTIONS[tool.name] ?? `Calls ${tool.name} on ${tool.provider}.`,
    type,
    risk: tool.risk,
    status: i % 11 === 0 ? "paused" : "active",
    connection,
    calls30d: calls,
    successRate,
    p95LatencyMs: Math.round(120 + rng() * 4200),
    timeoutMs: tool.timeoutMs,
    lastError: tool.lastError,
    owner: ["platform-ops", "billing", "growth", "support-eng"][i % 4],

    endpoint: type === "db-read" || type === "db-write"
      ? `SELECT … FROM ${tool.name.split(".")[1] ?? "table"}`
      : `POST https://api.${tool.provider}.com/v1/${tool.name.split(".")[1] ?? "call"}`,
    authMethod: connection ? "Connection credentials (OAuth)" : "Workspace service account",
    parameters: parametersFor(tool.name),
    outputFields: outputsFor(tool.name),

    /* Policy DIVERGES from the tier default on a couple of tools, deliberately.
       A registry where policy always equals the default cannot show a drift,
       and drift is the only thing anybody opens this panel to find. */
    policy: i % 6 === 2
      ? { ...basePolicy, requiresApprovalGate: false }
      : i % 6 === 4
        ? { ...basePolicy, allowedEnvironments: ["production", "staging", "development"] }
        : basePolicy,

    latencyBuckets: [100, 250, 500, 1000, 2500, 5000].map((upperMs) => ({
      upperMs,
      count: Math.round(rng() * calls * 0.4),
    })),
    errorBreakdown: (() => {
      const classes = [
        { klass: "Connection refused", count: Math.round(rng() * 40) },
        { klass: "Timeout", count: Math.round(rng() * 24) },
        { klass: "Rate limited (429)", count: Math.round(rng() * 16) },
        { klass: "Unauthorised (401)", count: Math.round(rng() * 8) },
        { klass: "Schema mismatch", count: Math.round(rng() * 6) },
      ].filter((e) => e.count > 0);
      const total = classes.reduce((s, c) => s + c.count, 0) || 1;
      return classes
        .map((c) => ({ ...c, share: Math.round((c.count / total) * 100) }))
        .sort((a, b) => b.count - a.count);
    })(),
    recentFailures: RUNS.filter((r) => r.status === "failed")
      .slice(i % 5, (i % 5) + 3)
      .map((r) => ({
        runId: r.id,
        at: r.startedAt,
        message: r.nodes.find((n) => n.state === "failed")?.error?.message ?? "Failed without a structured error.",
      })),
    versions: ((versionCount: number) => Array.from({ length: versionCount }, (_, v) => ({
      version: v + 1,
      at: iso(NOW - (versionCount - v) * Math.round(8 + rng() * 40) * 86_400_000),
      author: ["priya.raman", "d.okafor", "m.lindqvist"][v % 3],
      summary: v === 0
        ? "Registered."
        : v === 1
          ? "Added the optional filter parameter."
          : "Renamed a response field and tightened a type.",
      breaking: v === 2,
      breakingFields: v === 2 ? ["result.total → result.count", "amount: string → integer"] : [],
    })))(1 + Math.floor(rng() * 3)),
    usedBy: INDEX.tools.get(tool.name) ?? [],
    usedByAgents: AGENT_RECORDS
      .filter((a) => a.grants.some((g) => g.tool === tool.name))
      .map((a) => a.name),
  };
});

/* ── Governance checks ────────────────────────────────────────────────────── */

export interface PolicyFinding {
  severity: "error" | "warning";
  title: string;
  detail: string;
  fix: string;
}

/**
 * Where a tool's policy contradicts its risk tier.
 *
 * This is the point of having risk levels at all. A "high" tool that can be
 * called without an approval gate is not a styling choice — it is a control
 * somebody turned off, and the registry is where that should be visible.
 */
export function policyFindings(tool: ToolRecord): PolicyFinding[] {
  const expected = policyForRisk(tool.risk);
  const findings: PolicyFinding[] = [];

  if (expected.requiresApprovalGate && !tool.policy.requiresApprovalGate) {
    findings.push({
      severity: "error",
      title: `A ${tool.risk}-risk tool can run without an approval gate`,
      detail: `${tool.name} is classified ${tool.risk}, which requires a human decision before it executes. That requirement is currently switched off, so any workflow can call it unattended.`,
      fix: "Turn the approval requirement back on, or reclassify the tool if the risk assessment was wrong.",
    });
  }

  const extra = tool.policy.allowedEnvironments.filter((e) => !expected.allowedEnvironments.includes(e));
  if (extra.length > 0) {
    findings.push({
      severity: "warning",
      title: `Allowed in ${extra.join(" and ")} beyond its tier`,
      detail: `The ${tool.risk} tier limits this tool to ${expected.allowedEnvironments.join(", ")}. It has been widened to ${tool.policy.allowedEnvironments.join(", ")}.`,
      fix: "Narrow the environments, or record why the exception is justified.",
    });
  }

  if (expected.auditAlways && !tool.policy.auditAlways) {
    findings.push({
      severity: "warning",
      title: "Audit logging is not forced",
      detail: `A ${tool.risk}-risk call should always leave an audit record, whatever the workspace default is.`,
      fix: "Enable always-audit for this tool.",
    });
  }

  return findings;
}

/** The same idea for an agent: grants that outrun the gate they need. */
export function grantFindings(agent: AgentRecord): PolicyFinding[] {
  return agent.grants
    .filter((g) => (g.risk === "critical" || g.risk === "high") && !g.requiresApproval)
    .map((g) => ({
      severity: g.risk === "critical" ? "error" as const : "warning" as const,
      title: `${g.tool} is granted at ${g.risk} risk with no approval gate`,
      detail: `${agent.name} may call ${g.tool} in ${g.environments.join(", ")} without a human decision.`,
      fix: "Require approval on this grant, or remove the grant if the agent does not need it.",
    }));
}

/* ── Lookup ───────────────────────────────────────────────────────────────── */

export const agentById = (id: string) => AGENT_RECORDS.find((a) => a.id === id);
export const toolById = (id: string) => TOOL_RECORDS.find((t) => t.id === id);
