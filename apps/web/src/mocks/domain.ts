/**
 * Domain types the presentation layer renders.
 *
 * These describe SHAPES, not the API. They deliberately mirror what the screens
 * need rather than what the database stores, so a component never has to know
 * about pagination envelopes or snake_case columns. P12 maps the real API onto
 * these; until then src/mocks/fixtures.ts supplies them.
 */

/** Durable commit state of a single node within a run — design §5. */
export type CellState =
  | "committed"
  | "executing"
  | "gated"
  | "failed"
  | "pending"
  | "skipped"
  | "recovered";

export type RunStatus =
  | "succeeded"
  | "failed"
  | "running"
  | "queued"
  | "awaiting-approval"
  | "cancelled";

export type NodeKind =
  | "trigger" | "agent" | "llm" | "tool" | "branch" | "parallel"
  | "merge" | "wait" | "approval" | "checkpoint" | "output" | "end";

export interface RunNode {
  id: string;
  name: string;
  kind: NodeKind;
  state: CellState;
  /** Milliseconds. Null while pending or skipped. */
  durationMs: number | null;
  tokens: number | null;
  costUsd: number | null;
  /** ISO timestamp of the commit, or of the failure. Null when never reached. */
  at: string | null;
  /** Populated on failure — what actually went wrong. */
  error?: { message: string; toolCall?: string; connection?: string };
  /** Set on `recovered`: which attempt finally committed. */
  attempt?: number;
}

export interface Run {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  environment: "production" | "staging" | "development";
  trigger: "schedule" | "webhook" | "manual" | "api";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number;
  tokens: number;
  nodes: RunNode[];
  /** Set when the Recovery Engine clustered this failure. */
  incidentId?: string;
}

export type Environment = "production" | "staging" | "development";

export type TriggerKind = "schedule" | "webhook" | "manual" | "api";

/**
 * `paused` and `archived` are distinct from `draft` and from each other.
 *
 * draft    — never published; has no live triggers to pause.
 * active   — published and firing.
 * paused   — published, triggers suspended. Resumable in one click, so it is the
 *            safe thing to do to a misbehaving workflow at 3am.
 * archived — retired. Kept because its runs and versions are still evidence.
 */
export type WorkflowStatus = "active" | "draft" | "paused" | "archived";

/** One live entry point into a workflow. What a delete confirmation must name. */
export interface WorkflowTrigger {
  id: string;
  kind: TriggerKind;
  /** Human summary for a table cell — "Daily 09:00 UTC", "POST /hooks/…". */
  summary: string;
  /** The literal cron, URL or note behind the summary. */
  detail: string;
  enabled: boolean;
  /** ISO. Null for webhook, manual and api triggers, which have no schedule. */
  nextFireAt: string | null;
  timezone: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  /** One line, shown under the name in the list and on the overview. */
  description: string;
  status: WorkflowStatus;
  stepCount: number;
  /** Of the steps, how many are agents and how many are tool calls. */
  agentCount: number;
  toolCount: number;
  environment: Environment;
  owner: string;
  /** The published version number. 0 when nothing has ever been published. */
  version: number;
  /** Set when a draft version exists past the published one. */
  draftVersion: number | null;
  trigger: TriggerKind;
  triggers: WorkflowTrigger[];
  tags: string[];
  /** Outcomes of the last 30 runs, newest last. Powers the fleet heatstrip. */
  last30: RunStatus[];
  /** Parallel to `last30`. Null where the run is historical and not linkable. */
  last30RunIds: (string | null)[];
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  /** Percentage, 0–100, over `last30`. */
  successRate30d: number;
  avgDurationMs: number | null;
  spend30dUsd: number;
  /** Connection names the nodes bind to — the blast radius of a broken one. */
  connectionNames: string[];
  /** Tool names the nodes call. */
  toolNames: string[];
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface Tool {
  id: string;
  name: string;
  provider: string;
  risk: RiskLevel;
  timeoutMs: number;
  usedByCount: number;
  lastError: string | null;
}

export interface Agent {
  id: string;
  name: string;
  model: string;
  provider: string;
  costPerRunUsd: number;
  toolGrants: number;
  promptVersion: number;
}

export interface Connection {
  id: string;
  name: string;
  provider: string;
  status: "healthy" | "degraded" | "failing";
  latencyMs: number | null;
  /** What breaks if this stays down — design §10, Connections. */
  blastRadius: { workflows: number; tools: number };
  lastCheckedAt: string;
}

export interface Incident {
  id: string;
  signature: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  affectedWorkflows: string[];
  affectedRuns: number;
  status: "open" | "acknowledged" | "resolved";
  assignee: string | null;
  remediation: string;
  /** Occurrences per hour over the last 24, for the sparkline. */
  sparkline: number[];
}

export interface ApprovalContext {
  label: string;
  /** The RESOLVED value, never a template chip — design §10, Approvals. */
  value: string;
  /** Where the value came from, so the decision is auditable. */
  source: string;
}

export interface Approval {
  id: string;
  runId: string;
  workflowName: string;
  nodeName: string;
  requestedAt: string;
  /** Milliseconds until the SLA breaches. Negative when already breached. */
  slaRemainingMs: number;
  requester: string;
  context: ApprovalContext[];
}
