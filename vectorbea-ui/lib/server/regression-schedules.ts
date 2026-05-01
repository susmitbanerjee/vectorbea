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
  // Behavioral fields
  behavioral_dataset_id: string | null;
  behavioral_dataset_name: string | null;
  rubric_id: string | null;
  rubric_name: string | null;
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
    // Extended fields
    baselineScore: typeof record.baselineScore === "number" ? record.baselineScore : null,
    behavioralScore: typeof record.behavioralScore === "number" ? record.behavioralScore : null,
    combinedScore: typeof record.combinedScore === "number" ? record.combinedScore : null,
    failedCasesCount: typeof record.failedCasesCount === "number" ? record.failedCasesCount : 0,
    hardFailuresCount: typeof record.hardFailuresCount === "number" ? record.hardFailuresCount : 0,
    needsReviewCount: typeof record.needsReviewCount === "number" ? record.needsReviewCount : 0,
    childEvaluationRunIds: Array.isArray(record.childEvaluationRunIds) ? record.childEvaluationRunIds.map(String) : [],
    behavioralRunId: typeof record.behavioralRunId === "string" ? record.behavioralRunId : null,
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
    baselineScore: log.baselineScore,
    behavioralScore: log.behavioralScore,
    combinedScore: log.combinedScore,
    failedCasesCount: log.failedCasesCount,
    hardFailuresCount: log.hardFailuresCount,
    needsReviewCount: log.needsReviewCount,
    childEvaluationRunIds: log.childEvaluationRunIds,
    behavioralRunId: log.behavioralRunId,
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
    behavioralDatasetId: row.behavioral_dataset_id ?? null,
    behavioralDatasetName: row.behavioral_dataset_name ?? null,
    rubricId: row.rubric_id ?? null,
    rubricName: row.rubric_name ?? null,
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
  baselineDatasetId?: string | null;
  candidatePromptVersionStrategy: RegressionSchedule["candidatePromptVersionStrategy"];
  candidatePromptVersionId?: string | null;
  promptName?: string | null;
  cronExpression?: string | null;
  createdBy: string;
  // Behavioral support
  behavioralDatasetId?: string | null;
  rubricId?: string | null;
}): Promise<RegressionSchedule> {
  const supabase = createVectorBeaAdminClient();

  // Validate: must have at least one dataset
  if (!args.baselineDatasetId && !args.behavioralDatasetId) {
    throw new Error("At least one dataset (baseline or behavioral) is required.");
  }

  let baselineDs: Awaited<ReturnType<typeof getBaselineDataset>> = null;
  let evalDs: Awaited<ReturnType<typeof getEvaluationDataset>> = null;
  let datasetName: string | null = null;

  if (args.baselineDatasetId) {
    baselineDs = await getBaselineDataset(args.workspaceId, args.baselineDatasetId);
    evalDs = !baselineDs ? await getEvaluationDataset(args.workspaceId, args.baselineDatasetId) : null;
    if (!baselineDs && !evalDs) throw new Error("Baseline/evaluation dataset not found.");
    datasetName = baselineDs?.name ?? evalDs?.name ?? null;
  }

  const now = new Date().toISOString();
  const nextRunAt = computeNextRunAt(args.cronExpression, new Date(now));
  const { data, error } = await supabase
    .from("regression_schedules")
    .insert({
      id: randomUUID(),
      workspace_id: args.workspaceId,
      name: args.name.trim(),
      baseline_dataset_id: baselineDs ? args.baselineDatasetId : null,
      evaluation_dataset_id: evalDs ? args.baselineDatasetId : null,
      baseline_dataset_name: datasetName,
      candidate_prompt_version_strategy: args.candidatePromptVersionStrategy,
      candidate_prompt_version_id: args.candidatePromptVersionId ?? null,
      prompt_name: args.promptName ?? baselineDs?.promptName ?? evalDs?.promptName ?? null,
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
      behavioral_dataset_id: args.behavioralDatasetId ?? null,
      behavioral_dataset_name: null, // will be resolved on run
      rubric_id: args.rubricId ?? null,
      rubric_name: null, // will be resolved on run
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
 * Reset a schedule that got stuck in "running" state.
 */
export async function updateScheduleStatus(workspaceId: string, scheduleId: string, status: RegressionSchedule["status"]): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  await supabase
    .from("regression_schedules")
    .update({ status })
    .eq("workspace_id", workspaceId)
    .eq("id", scheduleId);
}

/**
 * Resolve the candidate prompt version ID for a schedule.
 */
async function resolveCandidateVersionId(schedule: RegressionSchedule, workspaceId: string, datasetPromptName?: string | null): Promise<string> {
  const supabase = createVectorBeaAdminClient();
  if (schedule.candidatePromptVersionStrategy === "specific_version") {
    if (!schedule.candidatePromptVersionId) {
      throw new Error("Schedule strategy is specific_version but no candidatePromptVersionId is set.");
    }
    return schedule.candidatePromptVersionId;
  }
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
}): Promise<{ evaluationRunId: string | null; runLog: RegressionScheduleRunLog }> {
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
        baselineScore: null,
        behavioralScore: null,
        combinedScore: null,
        failedCasesCount: 0,
        hardFailuresCount: 0,
        needsReviewCount: 0,
        childEvaluationRunIds: [],
        behavioralRunId: null,
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
    // ── 1. Baseline / evaluation dataset child run ─────────────────────────────
    let baselineRun: Awaited<ReturnType<typeof createTraceSetEvaluationRun>> | null = null;
    let baselineDs: Awaited<ReturnType<typeof getBaselineDataset>> = null;
    let evalDs: Awaited<ReturnType<typeof getEvaluationDataset>> = null;
    let datasetName: string | null = null;
    let datasetPromptName: string | null = null;
    let baselineScore: number | null = null;
    let failedTraceIds: string[] = [];
    const childEvaluationRunIds: string[] = [];

    const hasBaselineDataset = Boolean(schedule.baselineDatasetId);

    if (hasBaselineDataset) {
      baselineDs = await getBaselineDataset(args.workspaceId, schedule.baselineDatasetId);
      evalDs = !baselineDs ? await getEvaluationDataset(args.workspaceId, schedule.baselineDatasetId) : null;
      if (!baselineDs && !evalDs) throw new Error("Baseline/evaluation dataset not found.");
      datasetName = baselineDs?.name ?? evalDs?.name ?? "unknown";
      datasetPromptName = baselineDs?.promptName ?? evalDs?.promptName ?? null;
    }

    // ── 2. Behavioral child run ────────────────────────────────────────────────
    let behavioralRunId: string | null = null;
    let behavioralScore: number | null = null;
    let hardFailuresCount = 0;
    let needsReviewCount = 0;

    const hasBehavioralDataset = Boolean(schedule.behavioralDatasetId && schedule.rubricId);

    // Resolve candidate version (needed for both)
    const candidateVersionId = await resolveCandidateVersionId(
      schedule, args.workspaceId,
      datasetPromptName,
    );

    // Run baseline child eval
    if (hasBaselineDataset) {
      if (evalDs) {
        baselineRun = await createDatasetEvaluationRun({
          workspaceId: args.workspaceId,
          datasetId: evalDs.id,
          candidatePromptVersionId: candidateVersionId,
          triggeredBy: args.triggeredBy,
        });
      } else {
        if (!baselineDs || baselineDs.traceIds.length === 0)
          throw new Error("Baseline dataset has no traces.");
        baselineRun = await createTraceSetEvaluationRun({
          workspaceId: args.workspaceId,
          sourceTraceIds: baselineDs.traceIds,
          candidatePromptVersionId: candidateVersionId,
          triggeredBy: args.triggeredBy,
        });
      }
      childEvaluationRunIds.push(baselineRun.id);
      failedTraceIds = baselineRun.results
        .filter((result) => result.status === "error" || result.error)
        .map((result) => result.sourceTraceId);
      baselineScore = baselineRun.aggregate?.score ?? null;
    }

    // Run behavioral child eval
    if (hasBehavioralDataset) {
      const { startBehavioralRubricRun } = await import("@/lib/server/behavioral-evaluation-runs");
      const { listEnabledProviders } = await import("@/lib/server/provider-keys");
      const providers = await listEnabledProviders(args.workspaceId);
      if (providers.length === 0) throw new Error("No AI provider configured. Add a provider key to run behavioral evaluation.");
      const provider = providers[0];
      const behavioralView = await startBehavioralRubricRun({
        workspaceId: args.workspaceId,
        datasetId: schedule.behavioralDatasetId!,
        rubricId: schedule.rubricId!,
        promptVersionId: candidateVersionId,
        provider: provider.provider_type,
        model: provider.default_model ?? "gpt-4o-mini",
        startedBy: args.triggeredBy,
        runName: `Regression: ${schedule.name}`,
      });
      behavioralRunId = behavioralView.id;
      behavioralScore = behavioralView.aggregate?.finalScore ?? null;
      hardFailuresCount = behavioralView.aggregate?.hardFailureCount ?? 0;
      needsReviewCount = behavioralView.aggregate?.needsReviewCount ?? 0;
    }

    // ── 3. Compute combined score ──────────────────────────────────────────────
    let combinedScore: number | null = null;
    if (baselineScore !== null && behavioralScore !== null) {
      combinedScore = Number(((baselineScore * 0.5) + (behavioralScore * 0.5)).toFixed(2));
    } else if (baselineScore !== null) {
      combinedScore = baselineScore;
    } else if (behavioralScore !== null) {
      combinedScore = behavioralScore;
    }

    // ── 4. Determine status ────────────────────────────────────────────────────
    const hasBehavioralFailure = hasBehavioralDataset && hardFailuresCount > 0;
    const hasBaselineFailure = hasBaselineDataset && failedTraceIds.length > 0;
    const runStatus: RegressionScheduleRunLog["status"] = (hasBehavioralFailure || hasBaselineFailure) ? "failed" : "completed";

    const now = new Date().toISOString();
    const runLog: RegressionScheduleRunLog = {
      runId,
      status: runStatus,
      scheduleId: args.scheduleId,
      baselineDatasetId: baselineDs?.id ?? evalDs?.id ?? (hasBaselineDataset ? schedule.baselineDatasetId : null),
      baselineDatasetName: datasetName,
      promptVersionId: candidateVersionId,
      evaluationRunId: baselineRun?.id ?? null,
      replayCount: baselineRun?.results.length ?? 0,
      failedTraceIds,
      errorReason: runStatus === "failed"
        ? (hasBehavioralFailure ? "Behavioral evaluation detected hard failures." : "One or more baseline traces failed replay or evaluation.")
        : null,
      startedAt,
      completedAt: now,
      baselineScore,
      behavioralScore,
      combinedScore,
      failedCasesCount: failedTraceIds.length + hardFailuresCount,
      hardFailuresCount,
      needsReviewCount,
      childEvaluationRunIds,
      behavioralRunId,
    };

    const datasetNames = [datasetName, schedule.behavioralDatasetName].filter(Boolean).join(" + ");
    const history = [runLog, ...schedule.runHistory].slice(0, 20).map(toStoredRunLog);
    await supabase
      .from("regression_schedules")
      .update({
        status: runStatus === "failed" ? "failed" : "idle",
        last_run_at: now,
        last_run_evaluation_run_id: baselineRun?.id ?? null,
        last_run_recommendation: baselineRun?.aggregate?.recommendation ?? null,
        next_run_at: computeNextRunAt(schedule.cronExpression, new Date(now)),
        last_run_log: toStoredRunLog(runLog),
        run_history: history,
      })
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.scheduleId);

    if (runLog.status === "failed") {
      try {
        const { notifyRegressionFailed } = await import("@/lib/server/notifications");
        await notifyRegressionFailed({
          workspaceId: args.workspaceId,
          scheduleName: schedule.name,
          promptName: schedule.promptName ?? datasetPromptName,
          reason: runLog.errorReason ?? "Regression run completed with failures.",
          runId: baselineRun?.id ?? behavioralRunId,
          datasetName: datasetNames || undefined,
          promptVersion: candidateVersionId,
          failedCases: runLog.failedCasesCount,
          currentScore: runLog.combinedScore ?? runLog.baselineScore ?? null,
        });
      } catch {
        // Notification failures must never fail the regression run
      }
    }

    return { evaluationRunId: baselineRun?.id ?? null, runLog };
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
      baselineScore: null,
      behavioralScore: null,
      combinedScore: null,
      failedCasesCount: 0,
      hardFailuresCount: 0,
      needsReviewCount: 0,
      childEvaluationRunIds: [],
      behavioralRunId: null,
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

  // Schedules that are due
  const { data: dueData, error: dueError } = await supabase
    .from("regression_schedules")
    .select("*")
    .eq("enabled", true)
    .neq("status", "running")
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(25);
  if (dueError) throw new Error(dueError.message);

  // Schedules stuck in "running" for >10 minutes
  const stuckCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const { data: stuckData } = await supabase
    .from("regression_schedules")
    .select("*")
    .eq("enabled", true)
    .eq("status", "running")
    .lte("last_run_at", stuckCutoff)
    .limit(10);

  const all = [...(dueData ?? []), ...(stuckData ?? [])];
  const seen = new Set<string>();
  return all
    .filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; })
    .map(toView);
}

export async function runDueRegressionSchedules(triggeredBy = "system-scheduler") {
  const due = await listDueRegressionSchedules();
  const results: Array<{ scheduleId: string; evaluationRunId?: string | null; error?: string }> = [];
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
