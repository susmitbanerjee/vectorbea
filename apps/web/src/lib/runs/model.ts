/** Presentation model for the real Runs API. */
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
  durationMs: number | null;
  tokens: number | null;
  costUsd: number | null;
  at: string | null;
  error?: { message: string; toolCall?: string; connection?: string };
  attempt?: number;
}

export interface Run {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  environment: "production" | "staging" | "development" | "unknown";
  trigger: "schedule" | "webhook" | "manual" | "api";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number;
  tokens: number;
  nodes: RunNode[];
  incidentId?: string;
}
