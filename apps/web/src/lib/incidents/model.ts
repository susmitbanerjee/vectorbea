import type { Run } from "~/lib/runs/model";

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "open" | "acknowledged" | "resolved" | "muted";
export interface IncidentActivity { at: number; actor: string; action: string; note?: string }
export interface IncidentWorkflow { id: string; name: string }
export interface IncidentView {
  id: string; sourceIds: string[]; signature: string; firstSeen: string; lastSeen: string;
  occurrences: number; affectedWorkflows: string[]; affectedRuns: number; status: IncidentStatus;
  assignee: string | null; remediation: string; sparkline: number[]; severity: IncidentSeverity;
  classification: string; failingComponent: string; componentHref: string;
  blastRadius: { workflows: number; tools: number; connections: number; runs: number; costOfFailureUsd: number };
  activity: IncidentActivity[]; mutedUntil: number | null; autoResolveAfterMs: number;
  autoResolveAvailable: boolean; externalTracker: string | null;
  runRecords: Run[]; workflowRecords: IncidentWorkflow[];
  /** "Agent ran out of token budget". Absent on older fixtures, which fall back to the signature. */
  title?: string;
  /** The failure reason as recorded, without step prefixes. */
  reason?: string | null;
}
