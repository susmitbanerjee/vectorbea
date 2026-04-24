import "server-only";

import { randomUUID } from "crypto";
import type { RegressionSchedule } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { createTraceSetEvaluationRun } from "@/lib/server/evaluation-runs";
import { getBaselineDataset } from "@/lib/server/baseline-datasets";

type RegressionScheduleRow = {
  id: string;
  workspace_id: string;
  name: string;
  baseline_dataset_id: string;
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
  created_by: string;
  created_at: string;
};

function toView(row: RegressionScheduleRow): RegressionSchedule {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    baselineDatasetId: row.baseline_dataset_id,
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
  baselineDatasetId: string;
  candidatePromptVersionStrategy: RegressionSchedule["candidatePromptVersionStrategy"];
  candidatePromptVersionId?: string | null;
  promptName?: string | null;
  cronExpression?: string | null;
  createdBy: string;
}): Promise<RegressionSchedule> {
  const supabase = createVectorBeaAdminClient();
  // Look up dataset name for denormalized display
  const dataset = await getBaselineDataset(args.workspaceId, args.baselineDatasetId);
  if (!dataset) throw new Error("Baseline dataset not found.");
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("regression_schedules")
    .insert({
      id: randomUUID(),
      workspace_id: args.workspaceId,
      name: args.name.trim(),
      baseline_dataset_id: args.baselineDatasetId,
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
      next_run_at: null,
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
async function resolveCandidateVersionId(schedule: RegressionSchedule, workspaceId: string): Promise<string> {
  const supabase = createVectorBeaAdminClient();
  if (schedule.candidatePromptVersionStrategy === "specific_version") {
    if (!schedule.candidatePromptVersionId) {
      throw new Error("Schedule strategy is specific_version but no candidatePromptVersionId is set.");
    }
    return schedule.candidatePromptVersionId;
  }
  // latest_published — find the most recently published version for this prompt
  if (!schedule.promptName) throw new Error("Schedule has no promptName; cannot resolve latest published version.");
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("id, prompts!inner(name, workspace_id)")
    .eq("prompts.workspace_id", workspaceId)
    .eq("prompts.name", schedule.promptName)
    .eq("is_published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new Error(`No published version found for prompt '${schedule.promptName}'.`);
  return data.id;
}

/**
 * Run a regression schedule now (manual trigger or cron runner call).
 * Updates the schedule's status and last_run fields.
 * Returns the created evaluation run ID.
 *
 * HOW TO INVOKE:
 * This function is called by the POST /api/evaluations/regression-schedules/[id]/run route.
 * For automated execution, an external cron or scheduled task should call that route with a service token.
 * No built-in cron runner exists in this repo; see docs/internal/regression-schedules.md for guidance.
 */
export async function runRegressionSchedule(args: {
  workspaceId: string;
  scheduleId: string;
  triggeredBy: string;
}): Promise<{ evaluationRunId: string }> {
  const supabase = createVectorBeaAdminClient();
  // Mark running
  const { data: scheduleData, error: fetchError } = await supabase
    .from("regression_schedules")
    .update({ status: "running" })
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.scheduleId)
    .select("*")
    .single();
  if (fetchError) throw new Error(fetchError.message);
  const schedule = toView(scheduleData as RegressionScheduleRow);
  if (!schedule.enabled) throw new Error("Schedule is disabled.");

  try {
    const dataset = await getBaselineDataset(args.workspaceId, schedule.baselineDatasetId);
    if (!dataset) throw new Error("Baseline dataset not found.");
    if (dataset.traceIds.length === 0) throw new Error("Baseline dataset has no traces.");

    const candidateVersionId = await resolveCandidateVersionId(schedule, args.workspaceId);
    const run = await createTraceSetEvaluationRun({
      workspaceId: args.workspaceId,
      sourceTraceIds: dataset.traceIds,
      candidatePromptVersionId: candidateVersionId,
      triggeredBy: args.triggeredBy,
    });

    const now = new Date().toISOString();
    await supabase
      .from("regression_schedules")
      .update({
        status: "idle",
        last_run_at: now,
        last_run_evaluation_run_id: run.id,
        last_run_recommendation: run.aggregate.recommendation,
      })
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.scheduleId);

    return { evaluationRunId: run.id };
  } catch (error) {
    await supabase
      .from("regression_schedules")
      .update({ status: "failed", last_run_at: new Date().toISOString() })
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.scheduleId);
    throw error;
  }
}
