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
  /*
   * Parked on something outside the run — an async tool still working, a
   * signal that has not arrived, a timer. Not `queued`, which claims the run
   * has not started; not `awaiting-approval`, which claims a person must act.
   * The distinction is what stops a healthy six-minute render from reading as
   * a backed-up queue. See docs/WAITS-AND-SIGNALS.md.
   */
  | "waiting"
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
  /** Mirrors `contracts.TriggerType` — the door this run came in by. */
  trigger: "schedule" | "webhook" | "manual" | "api" | "event" | "mcp";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number;
  tokens: number;
  nodes: RunNode[];
  incidentId?: string;
}
