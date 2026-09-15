export type Environment = "production" | "staging" | "development" | "unknown";
/** `waiting` is parked on something outside the run — see docs/WAITS-AND-SIGNALS.md. */
export type RunStatus =
  | "succeeded" | "failed" | "running" | "queued"
  | "awaiting-approval" | "waiting" | "cancelled";
export type TriggerKind = "schedule" | "webhook" | "manual" | "api";
export type WorkflowStatus = "active" | "draft" | "paused" | "archived";

export interface WorkflowTrigger {
  id: string;
  kind: TriggerKind;
  summary: string;
  detail: string;
  enabled: boolean;
  nextFireAt: string | null;
  timezone: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  stepCount: number;
  agentCount: number;
  toolCount: number;
  environment: Environment;
  owner: string;
  version: number;
  versionKnown?: boolean;
  draftVersion: number | null;
  trigger: TriggerKind;
  triggers: WorkflowTrigger[];
  tags: string[];
  last30: RunStatus[];
  last30RunIds: (string | null)[];
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  successRate30d: number;
  avgDurationMs: number | null;
  spend30dUsd: number;
  connectionNames: string[];
  toolNames: string[];
  hasRunData?: boolean;
}
