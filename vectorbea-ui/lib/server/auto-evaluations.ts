import "server-only";

/**
 * Auto-evaluation trigger service.
 *
 * Called when:
 *  - A prompt version is created (trigger: "version_created")
 *  - A prompt version is marked Candidate (trigger: "candidate_promoted")
 *  - Before rollout promotion (trigger: "pre_rollout")
 *  - From scheduled regression (trigger: "scheduled")
 *  - Manual "Run now" (trigger: "manual")
 *
 * Rules:
 *  - Finds the prompt-scoped evaluation dataset
 *  - If no dataset exists → returns "no_dataset" without creating a run
 *  - Prevents duplicate runs for same version+dataset unless force=true
 *  - Persists evaluation run and returns its ID
 */

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { createDatasetEvaluationRun } from "@/lib/server/evaluation-runs";
import { listEvaluationDatasets } from "@/lib/server/evaluation-datasets";


export type AutoEvalTrigger =
  | "version_created"
  | "candidate_promoted"
  | "pre_rollout"
  | "scheduled"
  | "manual";

export type AutoEvalResult =
  | { status: "started"; runId: string; trigger: AutoEvalTrigger }
  | { status: "no_dataset"; reason: string; trigger: AutoEvalTrigger }
  | { status: "duplicate_skipped"; existingRunId: string; trigger: AutoEvalTrigger }
  | { status: "error"; reason: string; trigger: AutoEvalTrigger };

export async function triggerAutoEvaluation(args: {
  workspaceId: string;
  promptId: string;
  promptVersionId: string;
  trigger: AutoEvalTrigger;
  force?: boolean;
}): Promise<AutoEvalResult> {
  const { workspaceId, promptId, promptVersionId, trigger, force = false } = args;

  try {
    // 1. Find prompt-scoped evaluation dataset
    const allDatasets = await listEvaluationDatasets(workspaceId);
    const datasets = allDatasets.filter((d) => d.promptId === promptId || !d.promptId);
    const dataset = allDatasets.find((d) => d.promptId === promptId) ?? datasets[0] ?? null;

    if (!dataset) {
      return {
        status: "no_dataset",
        reason: `No evaluation dataset found for prompt ${promptId}. Create one to enable automatic evaluations.`,
        trigger,
      };
    }

    // 2. Check for duplicate (same version + dataset, not forced)
    if (!force) {
      const supabase = createVectorBeaAdminClient();
      const { data: existing } = await supabase
        .from("trace_set_evaluation_runs")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("candidate_prompt_version_id", promptVersionId)
        .eq("dataset_id", dataset.id)
        .not("status", "eq", "failed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        return { status: "duplicate_skipped", existingRunId: existing.id as string, trigger };
      }
    }

    // 3. Create the evaluation run
    const run = await createDatasetEvaluationRun({
      workspaceId,
      datasetId: dataset.id,
      candidatePromptVersionId: promptVersionId,
      triggeredBy: trigger,
    });

    return { status: "started", runId: run.id, trigger };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : String(err),
      trigger,
    };
  }
}

/**
 * Run auto-evaluations for all prompts that have a dataset but no recent evaluation run.
 * Used by the internal job runner.
 */
export async function runPendingAutoEvaluations(
  workspaceId: string,
): Promise<{ attempted: number; started: number; skipped: number; errors: string[] }> {
  const supabase = createVectorBeaAdminClient();

  // Get all published/candidate versions in workspace
  const { data: versions } = await supabase
    .from("prompt_versions")
    .select("id, prompt_id, version_tag, lifecycle_status")
    .eq("workspace_id", workspaceId)
    .in("lifecycle_status", ["candidate", "active"])
    .order("created_at", { ascending: false });

  if (!versions?.length) return { attempted: 0, started: 0, skipped: 0, errors: [] };

  let started = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const v of versions) {
    const result = await triggerAutoEvaluation({
      workspaceId,
      promptId: v.prompt_id as string,
      promptVersionId: v.id as string,
      trigger: "scheduled",
      force: false,
    });

    if (result.status === "started") started++;
    else if (result.status === "duplicate_skipped" || result.status === "no_dataset") skipped++;
    else if (result.status === "error") errors.push(`Version ${v.id}: ${result.reason}`);
  }

  return { attempted: versions.length, started, skipped, errors };
}
