import "server-only";

import { appCount, appQueryOne } from "@/lib/server/app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT THIS WORKSPACE IS ALLOWED, AND WHAT IT HAS USED

   READ FROM THE TABLES THAT ACTUALLY ENFORCE THE LIMIT.

   The Usage & limits screen used to read a Supabase `vectorbea` schema —
   `organizations.plan_tier`, `workspace_usage_monthly` — that this product does
   not provision and nothing writes to. So the screen reported "not provisioned"
   in every environment, including the ones where the limits are live and
   blocking runs.

   Every number here comes from the row the runtime consults before it refuses:

     workspace_usage_policies   the caps. `max_runs_per_day` is checked in
                                RunRoutes.trigger before a run is accepted;
                                `max_concurrent_runs` gates the worker's claim
                                loop; the rest bound a single run.
     daily_workspace_usage      the counters, incremented by the API on every
                                trigger (BetaAccessRepository.incrementDailyRuns).
     workspace_beta_controls    whether this workspace may execute for real at
                                all, which on a private beta is the limit that
                                actually surprises people.
     workspace_members          seats, counted where members are written.
     audit_log                  the governance trail.

   A WORKSPACE MAY HAVE NO POLICY ROW. V015 backfilled every workspace that
   existed then, and the API inserts one on demand, but web sign-up
   (`lib/auth/neon-auth.createUser`) creates a workspace without one. The
   defaults below are the column DEFAULTs from the migrations, so an unrowed
   workspace shows the limits it will actually be held to rather than an error —
   and `provisioned` says which of the two you are looking at.
══════════════════════════════════════════════════════════════════════════════ */

export interface WorkspacePolicy {
  /** False when no row exists and these are the platform defaults. */
  provisioned: boolean;
  maxWorkflows: number;
  maxRunsPerDay: number;
  maxConcurrentRuns: number;
  maxStepsPerWorkflow: number;
  maxParallelBranches: number;
  maxRunDurationSeconds: number;
  maxEventsPerRun: number;
  logRetentionDays: number;
  artifactRetentionDays: number;
  maxLlmProviders: number;
  maxTeamMembers: number;
  allowSchedules: boolean;
  allowWebhooks: boolean;
  allowPrivateWorkers: boolean;
  allowSelfCorrection: boolean;
  allowRealDbWrites: boolean;
  allowIterativeAgents: boolean;
  allowAiArchitect: boolean;
}

/** The column DEFAULTs from V015 and V021 — what an unrowed workspace gets. */
const POLICY_DEFAULTS = {
  maxWorkflows: 3,
  maxRunsPerDay: 20,
  maxConcurrentRuns: 2,
  maxStepsPerWorkflow: 5,
  maxParallelBranches: 1,
  maxRunDurationSeconds: 300,
  maxEventsPerRun: 1000,
  logRetentionDays: 7,
  artifactRetentionDays: 7,
  maxLlmProviders: 1,
  maxTeamMembers: 1,
} as const;

interface PolicyRow {
  provisioned: boolean;
  max_workflows: number | null;
  max_runs_per_day: number | null;
  max_concurrent_runs: number | null;
  max_steps_per_workflow: number | null;
  max_parallel_branches: number | null;
  max_run_duration_seconds: number | null;
  max_events_per_run: number | null;
  log_retention_days: number | null;
  artifact_retention_days: number | null;
  max_llm_providers: number | null;
  max_team_members: number | null;
  allow_schedules: boolean | null;
  allow_webhooks: boolean | null;
  allow_private_workers: boolean | null;
  allow_self_correction: boolean | null;
  allow_real_db_writes: boolean | null;
  allow_iterative_agents: boolean | null;
  allow_ai_architect: boolean | null;
}

export async function getWorkspacePolicy(workspaceId: string): Promise<WorkspacePolicy> {
  // LEFT JOIN against a one-row scalar so the query always returns exactly one
  // row: "no policy row" is an answer about this workspace, not an empty result
  // the caller has to guess at.
  const row = await appQueryOne<PolicyRow>(
    `SELECT (p.workspace_id IS NOT NULL) AS provisioned,
            p.max_workflows, p.max_runs_per_day, p.max_concurrent_runs,
            p.max_steps_per_workflow, p.max_parallel_branches,
            p.max_run_duration_seconds, p.max_events_per_run,
            p.log_retention_days, p.artifact_retention_days,
            p.max_llm_providers, p.max_team_members,
            p.allow_schedules, p.allow_webhooks, p.allow_private_workers,
            p.allow_self_correction, p.allow_real_db_writes,
            p.allow_iterative_agents, p.allow_ai_architect
       FROM (SELECT $1::uuid AS workspace_id) AS target
       LEFT JOIN workspace_usage_policies p ON p.workspace_id = target.workspace_id`,
    [workspaceId],
  );

  const int = (value: number | null | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const flag = (value: boolean | null | undefined, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;

  return {
    provisioned: Boolean(row?.provisioned),
    maxWorkflows: int(row?.max_workflows, POLICY_DEFAULTS.maxWorkflows),
    maxRunsPerDay: int(row?.max_runs_per_day, POLICY_DEFAULTS.maxRunsPerDay),
    maxConcurrentRuns: int(row?.max_concurrent_runs, POLICY_DEFAULTS.maxConcurrentRuns),
    maxStepsPerWorkflow: int(row?.max_steps_per_workflow, POLICY_DEFAULTS.maxStepsPerWorkflow),
    maxParallelBranches: int(row?.max_parallel_branches, POLICY_DEFAULTS.maxParallelBranches),
    maxRunDurationSeconds: int(row?.max_run_duration_seconds, POLICY_DEFAULTS.maxRunDurationSeconds),
    maxEventsPerRun: int(row?.max_events_per_run, POLICY_DEFAULTS.maxEventsPerRun),
    logRetentionDays: int(row?.log_retention_days, POLICY_DEFAULTS.logRetentionDays),
    artifactRetentionDays: int(row?.artifact_retention_days, POLICY_DEFAULTS.artifactRetentionDays),
    maxLlmProviders: int(row?.max_llm_providers, POLICY_DEFAULTS.maxLlmProviders),
    maxTeamMembers: int(row?.max_team_members, POLICY_DEFAULTS.maxTeamMembers),
    allowSchedules: flag(row?.allow_schedules, false),
    allowWebhooks: flag(row?.allow_webhooks, false),
    allowPrivateWorkers: flag(row?.allow_private_workers, false),
    allowSelfCorrection: flag(row?.allow_self_correction, false),
    allowRealDbWrites: flag(row?.allow_real_db_writes, false),
    allowIterativeAgents: flag(row?.allow_iterative_agents, false),
    allowAiArchitect: flag(row?.allow_ai_architect, true),
  };
}

/* ── Counters ─────────────────────────────────────────────────────────────── */

export interface UsageCounters {
  workflowRuns: number;
  simulationRuns: number;
  realRuns: number;
  aiArchitectRequests: number;
  aiArchitectRevisions: number;
  llmCalls: number;
  toolCalls: number;
  eventsStored: number;
}

export interface WorkspaceUsageCounters {
  today: UsageCounters;
  month: UsageCounters;
  /** First day of the current month. */
  monthStart: string;
  /** Midnight tonight — when the daily run allowance resets. */
  dayResetAt: string;
  /** First day of next month — when the monthly view rolls over. */
  monthResetAt: string;
}

export async function getWorkspaceUsageCounters(
  workspaceId: string,
): Promise<WorkspaceUsageCounters> {
  // One pass over the month's rows. FILTER isolates today from the same scan
  // rather than issuing a second query for a value the first one already has.
  const row = await appQueryOne<Record<string, string | number | Date | null>>(
    `SELECT
       date_trunc('month', CURRENT_DATE)::date                        AS month_start,
       (CURRENT_DATE + 1)                                             AS day_reset,
       (date_trunc('month', CURRENT_DATE) + interval '1 month')::date AS month_reset,
       COALESCE(SUM(u.workflow_runs), 0)          AS month_workflow_runs,
       COALESCE(SUM(u.simulation_runs), 0)        AS month_simulation_runs,
       COALESCE(SUM(u.real_runs), 0)              AS month_real_runs,
       COALESCE(SUM(u.ai_architect_requests), 0)  AS month_architect_requests,
       COALESCE(SUM(u.ai_architect_revisions), 0) AS month_architect_revisions,
       COALESCE(SUM(u.llm_calls), 0)              AS month_llm_calls,
       COALESCE(SUM(u.tool_calls), 0)             AS month_tool_calls,
       COALESCE(SUM(u.events_stored), 0)          AS month_events_stored,
       COALESCE(SUM(u.workflow_runs)          FILTER (WHERE u.usage_date = CURRENT_DATE), 0) AS today_workflow_runs,
       COALESCE(SUM(u.simulation_runs)        FILTER (WHERE u.usage_date = CURRENT_DATE), 0) AS today_simulation_runs,
       COALESCE(SUM(u.real_runs)              FILTER (WHERE u.usage_date = CURRENT_DATE), 0) AS today_real_runs,
       COALESCE(SUM(u.ai_architect_requests)  FILTER (WHERE u.usage_date = CURRENT_DATE), 0) AS today_architect_requests,
       COALESCE(SUM(u.ai_architect_revisions) FILTER (WHERE u.usage_date = CURRENT_DATE), 0) AS today_architect_revisions,
       COALESCE(SUM(u.llm_calls)              FILTER (WHERE u.usage_date = CURRENT_DATE), 0) AS today_llm_calls,
       COALESCE(SUM(u.tool_calls)             FILTER (WHERE u.usage_date = CURRENT_DATE), 0) AS today_tool_calls,
       COALESCE(SUM(u.events_stored)          FILTER (WHERE u.usage_date = CURRENT_DATE), 0) AS today_events_stored
     FROM daily_workspace_usage u
     WHERE u.workspace_id = $1::uuid
       AND u.usage_date >= date_trunc('month', CURRENT_DATE)::date`,
    [workspaceId],
  );

  const n = (key: string) => {
    const value = Number(row?.[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  const iso = (key: string, fallback: Date) => {
    const value = row?.[key];
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" && value) return new Date(value).toISOString();
    return fallback.toISOString();
  };

  const now = new Date();
  const monthStartFallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthResetFallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const dayResetFallback = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

  return {
    monthStart: iso("month_start", monthStartFallback),
    dayResetAt: iso("day_reset", dayResetFallback),
    monthResetAt: iso("month_reset", monthResetFallback),
    today: {
      workflowRuns: n("today_workflow_runs"),
      simulationRuns: n("today_simulation_runs"),
      realRuns: n("today_real_runs"),
      aiArchitectRequests: n("today_architect_requests"),
      aiArchitectRevisions: n("today_architect_revisions"),
      llmCalls: n("today_llm_calls"),
      toolCalls: n("today_tool_calls"),
      eventsStored: n("today_events_stored"),
    },
    month: {
      workflowRuns: n("month_workflow_runs"),
      simulationRuns: n("month_simulation_runs"),
      realRuns: n("month_real_runs"),
      aiArchitectRequests: n("month_architect_requests"),
      aiArchitectRevisions: n("month_architect_revisions"),
      llmCalls: n("month_llm_calls"),
      toolCalls: n("month_tool_calls"),
      eventsStored: n("month_events_stored"),
    },
  };
}

/* ── What the caps are measured against ───────────────────────────────────── */

export interface WorkspaceCapacity {
  seats: number;
  workflows: number;
  llmConnections: number;
}

export async function getWorkspaceCapacity(workspaceId: string): Promise<WorkspaceCapacity> {
  // Three counts, one round trip. Each subquery is covered by an existing
  // (workspace_id, status) index, so this stays cheap on a busy workspace.
  const row = await appQueryOne<{ seats: string; workflows: string; llm_connections: string }>(
    `SELECT
       (SELECT count(*) FROM workspace_members m
         WHERE m.workspace_id = $1::uuid AND m.status = 'active')    AS seats,
       (SELECT count(*) FROM workflows w
         WHERE w.workspace_id = $1::uuid AND w.status <> 'archived') AS workflows,
       (SELECT count(*) FROM connections c
         WHERE c.workspace_id = $1::uuid AND c.type = 'llm')         AS llm_connections`,
    [workspaceId],
  );
  const n = (value: string | undefined) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    seats: n(row?.seats),
    workflows: n(row?.workflows),
    llmConnections: n(row?.llm_connections),
  };
}

/* ── Execution access ─────────────────────────────────────────────────────── */

export interface WorkspaceExecutionAccess {
  /** False when no controls row exists — the API then applies its own defaults. */
  provisioned: boolean;
  accessStatus: "pending" | "approved" | "rejected" | "disabled";
  executionMode: "simulation_only" | "real_execution_enabled" | "disabled";
  realExecutionEnabled: boolean;
  simulationEnabled: boolean;
  disabledReason: string | null;
}

export async function getWorkspaceExecutionAccess(
  workspaceId: string,
): Promise<WorkspaceExecutionAccess> {
  const row = await appQueryOne<{
    access_status: string | null;
    execution_mode: string | null;
    real_execution_enabled: boolean | null;
    simulation_enabled: boolean | null;
    disabled_reason: string | null;
  }>(
    `SELECT access_status, execution_mode, real_execution_enabled,
            simulation_enabled, disabled_reason
       FROM workspace_beta_controls
      WHERE workspace_id = $1::uuid`,
    [workspaceId],
  );

  if (!row) {
    // Matches RunRoutes: with no controls row, simulation is allowed and real
    // execution is not. Stating the effective answer beats stating "unknown".
    return {
      provisioned: false,
      accessStatus: "pending",
      executionMode: "simulation_only",
      realExecutionEnabled: false,
      simulationEnabled: true,
      disabledReason: null,
    };
  }

  return {
    provisioned: true,
    accessStatus: (row.access_status as WorkspaceExecutionAccess["accessStatus"]) ?? "pending",
    executionMode:
      (row.execution_mode as WorkspaceExecutionAccess["executionMode"]) ?? "simulation_only",
    realExecutionEnabled: Boolean(row.real_execution_enabled),
    simulationEnabled: row.simulation_enabled ?? true,
    disabledReason: row.disabled_reason,
  };
}

/* ── Audit volume ─────────────────────────────────────────────────────────── */

export interface WorkspaceAuditVolume {
  today: number;
  month: number;
}

export async function getWorkspaceAuditVolume(
  workspaceId: string,
): Promise<WorkspaceAuditVolume> {
  const row = await appQueryOne<{ today: string; month: string }>(
    `SELECT
       count(*) FILTER (WHERE created_at >= date_trunc('day', now()))   AS today,
       count(*) FILTER (WHERE created_at >= date_trunc('month', now())) AS month
     FROM audit_log
     WHERE workspace_id = $1::uuid
       AND created_at >= date_trunc('month', now())`,
    [workspaceId],
  );
  return { today: Number(row?.today ?? 0), month: Number(row?.month ?? 0) };
}

/** Seats in use, counted where members are written. */
export async function getWorkspaceSeatCount(workspaceId: string): Promise<number> {
  return appCount(
    `SELECT count(*) AS count FROM workspace_members
      WHERE workspace_id = $1::uuid AND status = 'active'`,
    [workspaceId],
  );
}
