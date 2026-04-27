import "server-only";

import { randomUUID } from "crypto";
import type { RegressionSchedule, RegressionScheduleRunLog } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { createTraceSetEvaluationRun, createDatasetEvaluationRun } from "@/lib/server/evaluation-runs";
import { getBaselineDataset } from "@/lib/server/baseline-datasets";
import { getEvaluationDataset } from "@/lib/server/evaluation-datasets";

type RegressionScheduleRow = {
  id: string;
  workspace_id: string;
  name: string;
  baseline_dataset_id: string | null;
  evaluation_dataset_id: string | null;
  baseline_dataset_name: string | null;
  candidate_prompt_version_strategy: string;
  candidate_prompt_version_id: string | null;
  prompt_name: string | null;
  cron_expression: string | null;
  enabled: boolean;
  status: string;
  last_run_at: string | null;
  last_run_evaluation_run_id: string | null;
  last_run_recommendation: string | null;
  next_run_at: string | null;
  last_run_log: Record<string, unknown> | null;
  run_history: unknown[] | null;
  created_by: string;
  created_at: string;
};

function asRunLog(value: unknown): RegressionScheduleRunLog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.runId !== "string" && typeof record.run_id !== "string") return null;
  return {
    runId: String(record.runId ?? record.run_id),
    status: (record.status === "completed" || record.status === "failed" || record.status === "running" ? record.status : "failed") as RegressionScheduleRunLog["status"],
    scheduleId: String(record.scheduleId ?? record.schedule_id ?? ""),
    baselineDatasetId: typeof record.baselineDatasetId === "string" ? record.baselineDatasetId : typeof record.baseline_dataset_id === "string" ? record.baseline_dataset_id : null,
    baselineDatasetName: typeof record.baselineDatasetName === "string" ? record.baselineDatasetName : typeof record.baseline_dataset_name === "string" ? record.baseline_dataset_name : null,
    promptVersionId: typeof record.promptVersionId === "string" ? record.promptVersionId : typeof record.prompt_version_id === "string" ? record.prompt_version_id : null,
    evaluationRunId: typeof record.evaluationRunId === "string" ? record.evaluationRunId : typeof record.evaluation_run_id === "string" ? record.evaluation_run_id : null,
    replayCount: typeof record.replayCount === "number" ? record.replayCount : typeof record.replay_count === "number" ? record.replay_count : 0,
    failedTraceIds: Array.isArray(record.failedTraceIds)
      ? record.failedTraceIds.map(String)
      : Array.isArray(record.failed_trace_ids)
        ? record.failed_trace_ids.map(String)
        : [],
    errorReason: typeof record.errorReason === "string" ? record.errorReason : typeof record.error_reason === "string" ? record.error_reason : null,
    startedAt: typeof record.startedAt === "string" ? record.startedAt : typeof record.started_at === "string" ? record.started_at : new Date().toISOString(),
    completedAt: typeof record.completedAt === "string" ? record.completedAt : typeof record.completed_at === "string" ? record.completed_at : null,
  };
}

function asRunHistory(value: unknown): RegressionScheduleRunLog[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRunLog).filter((entry): entry is RegressionScheduleRunLog => Boolean(entry));
}

function toStoredRunLog(log: RegressionScheduleRunLog) {
  return {
    runId: log.runId,
    status: log.status,
    scheduleId: log.scheduleId,
    baselineDatasetId: log.baselineDatasetId,
    baselineDatasetName: log.baselineDatasetName,
    promptVersionId: log.promptVersionId,
    evaluationRunId: log.evaluationRunId,
    replayCount: log.replayCount,
    failedTraceIds: log.failedTraceIds,
    errorReason: log.errorReason,
    startedAt: log.startedAt,
    completedAt: log.completedAt,
  };
}

function computeNextRunAt(cronExpression?: string | null, from = new Date()): string | null {
  if (!cronExpression?.trim()) return null;
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour] = parts;
  const next = new Date(from.getTime());
  next.setSeconds(0, 0);
  const minuteValue = minute === "*" ? null : Number(minute);
  const hourValue = hour === "*" ? null : Number(hour);
  if (minuteValue !== null && (!Number.isInteger(minuteValue) || minuteValue < 0 || minuteValue > 59)) return null;
  if (hourValue !== null && (!Number.isInteger(hourValue) || hourValue < 0 || hourValue > 23)) return null;

  for (let i = 0; i < 24 * 60 * 8; i += 1) {
    next.setMinutes(next.getMinutes() + 1);
    const minuteMatches = minuteValue === null || next.getMinutes() === minuteValue;
    const hourMatches = hourValue === null || next.getHours() === hourValue;
    if (minuteMatches && hourMatches) return next.toISOString();
  }
  return null;
}

function toView(row: RegressionScheduleRow): RegressionSchedule {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    baselineDatasetId: row.evaluation_dataset_id ?? row.baseline_dataset_id ?? "",
    baselineDatasetName: row.baseline_dataset_name,
    candidatePromptVersionStrategy: row.candidate_prompt_version_strategy as RegressionSchedule["candidatePromptVersionStrategy"],
    candidatePromptVersionId: row.candidate_prompt_version_id,
    promptName: row.prompt_name,
    cronExpression: row.cron_expression,
    enabled: row.enabled,
    status: row.status as RegressionSchedule["status"],
    lastRunAt: row.last_run_at,
    lastRunEvaluationRunId: row.last_run_evaluation_run_id,
    lastRunRecommendation: row.last_run_recommendation,
    nextRunAt: row.next_run_at,
    lastRunLog: asRunLog(row.last_run_log),
    runHistory: asRunHistory(row.run_history),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listRegressionSchedules(workspaceId: string): Promise<RegressionSchedule[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("regression_schedules")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toView);
}

export async function createRegressionSchedule(args: {
  workspaceId: string;
  name: string;
  /** ID of a baseline_dataset OR evaluation_dataset — we try both tables */
  baselineDatasetId: string;
  candidatePromptVersionStrategy: RegressionSchedule["candidatePromptVersionStrategy"];
  candidatePromptVersionId?: string | null;
  promptName?: string | null;
  cronExpression?: string | null;
  createdBy: string;
}): Promise<RegressionSchedule> {
  const supabase = createVectorBeaAdminClient();
  // Determine if this is a baseline dataset or an evaluation dataset
  const baselineDs = await getBaselineDataset(args.workspaceId, args.baselineDatasetId);
  const evalDs = !baselineDs ? await getEvaluationDataset(args.workspaceId, args.baselineDatasetId) : null;
  if (!baselineDs && !evalDs) throw new Error("Dataset not found. Select a valid dataset.");
  const dataset = baselineDs ?? { id: evalDs!.id, name: evalDs!.name, promptName: evalDs!.promptName ?? null };
  const now = new Date().toISOString();
  const nextRunAt = computeNextRunAt(args.cronExpression, new Date(now));
  const { data, error } = await supabase
    .from("regression_schedules")
    .insert({
      id: randomUUID(),
      workspace_id: args.workspaceId,
      name: args.name.trim(),
      // Write to the correct FK column depending on dataset type
      baseline_dataset_id: baselineDs ? args.baselineDatasetId : null,
      evaluation_dataset_id: evalDs ? args.baselineDatasetId : null,
      baseline_dataset_name: dataset.name,
      candidate_prompt_version_strategy: args.candidatePromptVersionStrategy,
      candidate_prompt_version_id: args.candidatePromptVersionId ?? null,
      prompt_name: args.promptName ?? dataset.promptName ?? null,
      cron_expression: args.cronExpression ?? null,
      enabled: true,
      status: "idle",
      last_run_at: null,
      last_run_evaluation_run_id: null,
      last_run_recommendation: null,
      next_run_at: nextRunAt,
      last_run_log: {},
      run_history: [],
      created_by: args.createdBy,
      created_at: now,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toView(data as RegressionScheduleRow);
}

export async function toggleRegressionSchedule(workspaceId: string, id: string, enabled: boolean): Promise<RegressionSchedule> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("regression_schedules")
    .update({ enabled, status: enabled ? "idle" : "disabled" })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toView(data as RegressionScheduleRow);
}

export async function deleteRegressionSchedule(workspaceId: string, id: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("regression_schedules")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Resolve the candidate prompt version ID for a schedule.
 * Strategy "latest_published" fetches the currently published version for the prompt.
 * Strategy "specific_version" uses the pinned candidatePromptVersionId.
 */
async function resolveCandidateVersionId(schedule: RegressionSchedule, workspaceId: string, datasetPromptName?: string | null): Promise<string> {
  const supabase = createVectorBeaAdminClient();
  if (schedule.candidatePromptVersionStrategy === "specific_version") {
    if (!schedule.candidatePromptVersionId) {
      throw new Error("Schedule strategy is specific_version but no candidatePromptVersionId is set.");
    }
    return schedule.candidatePromptVersionId;
  }
  // latest_published — find the most recently published version for this prompt
  const resolvedPromptName = schedule.promptName ?? datasetPromptName;
  if (!resolvedPromptName) throw new Error("No prompt name available. Set a prompt name on the schedule or ensure the dataset is linked to a prompt.");
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("id, prompts!inner(name, workspace_id)")
    .eq("prompts.workspace_id", workspaceId)
    .eq("prompts.name", resolvedPromptName)
    .eq("is_published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new Error(`No published version found for prompt '${resolvedPromptName}'.`);
  return data.id;
}

export async function runRegressionSchedule(args: {
  workspaceId: string;
  scheduleId: string;
  triggeredBy: string;
}): Promise<{ evaluationRunId: string; runLog: RegressionScheduleRunLog }> {
  const supabase = createVectorBeaAdminClient();
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const { data: scheduleData, error: fetchError } = await supabase
    .from("regression_schedules")
    .update({
      status: "running",
      last_run_log: toStoredRunLog({
        runId,
        status: "running",
        scheduleId: args.scheduleId,
        baselineDatasetId: null,
        baselineDatasetName: null,
        promptVersionId: null,
        evaluationRunId: null,
        replayCount: 0,
        failedTraceIds: [],
        errorReason: null,
        startedAt,
        completedAt: null,
      }),
    })
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.scheduleId)
    .select("*")
    .single();
  if (fetchError) throw new Error(fetchError.message);
  const schedule = toView(scheduleData as RegressionScheduleRow);
  if (!schedule.enabled) {
    await supabase
      .from("regression_schedules")
      .update({ status: "disabled" })
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.scheduleId);
    throw new Error("Schedule is disabled.");
  }

  try {
    // Try baseline dataset first; if not found, try evaluation dataset
    const baselineDataset = await getBaselineDataset(args.workspaceId, schedule.baselineDatasetId);
    const evalDataset = !baselineDataset
      ? await getEvaluationDataset(args.workspaceId, schedule.baselineDatasetId)
      : null;

    if (!baselineDataset && !evalDataset) throw new Error("Dataset not found.");

    const datasetName = baselineDataset?.name ?? evalDataset?.name ?? "unknown";
    const datasetPromptName = baselineDataset?.promptName ?? evalDataset?.promptName ?? null;

    const candidateVersionId = await resolveCandidateVersionId(
      schedule, args.workspaceId,
      datasetPromptName,
    );

    let run: Awaited<ReturnType<typeof createTraceSetEvaluationRun>>;
    if (evalDataset) {
      // New evaluation dataset — use dataset-based evaluation (calls LLM fresh)
      run = await createDatasetEvaluationRun({
        workspaceId: args.workspaceId,
        datasetId: evalDataset.id,
        candidatePromptVersionId: candidateVersionId,
        triggeredBy: args.triggeredBy,
      });
    } else {
      // Legacy baseline dataset — trace replay
      if (!baselineDataset || baselineDataset.traceIds.length === 0)
        throw new Error("Baseline dataset has no traces.");
      run = await createTraceSetEvaluationRun({
        workspaceId: args.workspaceId,
        sourceTraceIds: baselineDataset.traceIds,
        candidatePromptVersionId: candidateVersionId,
        triggeredBy: args.triggeredBy,
      });
    }

    const now = new Date().toISOString();
    const failedTraceIds = run.results
      .filter((result) => result.status === "error" || result.error)
      .map((result) => result.sourceTraceId);
    const runLog: RegressionScheduleRunLog = {
      runId,
      status: failedTraceIds.length > 0 ? "failed" : "completed",
      scheduleId: args.scheduleId,
      baselineDatasetId: baselineDataset?.id ?? evalDataset?.id ?? schedule.baselineDatasetId,
      baselineDatasetName: datasetName,
      promptVersionId: candidateVersionId,
      evaluationRunId: run.id,
      replayCount: run.results.length,
      failedTraceIds,
      errorReason: failedTraceIds.length > 0 ? "One or more baseline traces failed replay or evaluation." : null,
      startedAt,
      completedAt: now,
    };
    const history = [runLog, ...schedule.runHistory].slice(0, 20).map(toStoredRunLog);
    await supabase
      .from("regression_schedules")
      .update({
        status: runLog.status === "failed" ? "failed" : "idle",
        last_run_at: now,
        last_run_evaluation_run_id: run.id,
        last_run_recommendation: run.aggregate.recommendation,
        next_run_at: computeNextRunAt(schedule.cronExpression, new Date(now)),
        last_run_log: toStoredRunLog(runLog),
        run_history: history,
      })
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.scheduleId);

    return { evaluationRunId: run.id, runLog };
  } catch (error) {
    const now = new Date().toISOString();
    const errorReason = error instanceof Error ? error.message : "Regression schedule failed.";
    const runLog: RegressionScheduleRunLog = {
      runId,
      status: "failed",
      scheduleId: args.scheduleId,
      baselineDatasetId: schedule?.baselineDatasetId ?? null,
      baselineDatasetName: schedule?.baselineDatasetName ?? null,
      promptVersionId: null,
      evaluationRunId: null,
      replayCount: 0,
      failedTraceIds: [],
      errorReason,
      startedAt,
      completedAt: now,
    };
    const history = [runLog, ...(schedule?.runHistory ?? [])].slice(0, 20).map(toStoredRunLog);
    await supabase
      .from("regression_schedules")
      .update({
        status: "failed",
        last_run_at: now,
        next_run_at: schedule ? computeNextRunAt(schedule.cronExpression, new Date(now)) : null,
        last_run_log: toStoredRunLog(runLog),
        run_history: history,
      })
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.scheduleId);

    // Await so notification completes before the serverless function exits
    try {
      const { notifyRegressionFailed } = await import("@/lib/server/notifications");
      await notifyRegressionFailed({
        workspaceId: args.workspaceId,
        scheduleName: schedule?.name ?? args.scheduleId,
        promptName: schedule?.promptName ?? null,
        reason: errorReason,
        runId: null,
      });
    } catch { /* notification errors must never fail the main flow */ }

    throw error;
  }
}

export async function listDueRegressionSchedules(now = new Date()): Promise<RegressionSchedule[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("regression_schedules")
    .select("*")
    .eq("enabled", true)
    .neq("status", "running")
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(25);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toView);
}

export async function runDueRegressionSchedules(triggeredBy = "system-scheduler") {
  const due = await listDueRegressionSchedules();
  const results: Array<{ scheduleId: string; evaluationRunId?: string; error?: string }> = [];
  for (const schedule of due) {
    try {
      const result = await runRegressionSchedule({
        workspaceId: schedule.workspaceId,
        scheduleId: schedule.id,
        triggeredBy,
      });
      results.push({ scheduleId: schedule.id, evaluationRunId: result.evaluationRunId });
    } catch (error) {
      results.push({ scheduleId: schedule.id, error: error instanceof Error ? error.message : "Schedule failed" });
    }
  }
  return { checked: due.length, results };
}

export const regressionScheduleInternals = {
  computeNextRunAt,
};
