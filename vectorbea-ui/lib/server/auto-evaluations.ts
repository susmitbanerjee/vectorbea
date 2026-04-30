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
 *  - Finds prompt-scoped baseline evaluation datasets → creates dataset eval runs
 *  - Finds prompt-scoped behavioral datasets with rubrics (Pro/Enterprise only) → creates behavioral_rubric runs
 *  - Prevents duplicate runs for same version+dataset unless force=true
 *  - Returns a summary of all runs started/skipped
 */

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { createDatasetEvaluationRun } from "@/lib/server/evaluation-runs";
import { listEvaluationDatasets } from "@/lib/server/evaluation-datasets";
import { listBehavioralDatasets } from "@/lib/server/behavioral-datasets";
import { startBehavioralRubricRun } from "@/lib/server/behavioral-evaluation-runs";
import { listRubricsForDataset } from "@/lib/server/rubrics";
import { listEnabledProviders } from "@/lib/server/provider-keys";
import { canUseFeature } from "@/lib/server/feature-gates";

export type AutoEvalTrigger =
  | "version_created"
  | "candidate_promoted"
  | "pre_rollout"
  | "scheduled"
  | "manual";

export interface AutoEvalRunResult {
  type: "baseline" | "behavioral";
  datasetId: string;
  datasetName: string;
  status: "started" | "duplicate_skipped" | "no_rubric" | "plan_gate" | "no_provider" | "error";
  runId?: string;
  reason?: string;
}

export type AutoEvalResult =
  | { status: "started"; runs: AutoEvalRunResult[]; trigger: AutoEvalTrigger }
  | { status: "no_dataset"; reason: string; trigger: AutoEvalTrigger }
  | { status: "error"; reason: string; trigger: AutoEvalTrigger };

export async function triggerAutoEvaluation(args: {
  workspaceId: string;
  promptId: string;
  promptVersionId: string;
  trigger: AutoEvalTrigger;
  force?: boolean;
  startedBy?: string;
}): Promise<AutoEvalResult> {
  const { workspaceId, promptId, promptVersionId, trigger, force = false, startedBy = "system" } = args;

  try {
    const runs: AutoEvalRunResult[] = [];

    // ── 1. Baseline evaluation datasets ──────────────────────────────────────
    const allDatasets = await listEvaluationDatasets(workspaceId);
    const baselineDatasets = allDatasets.filter(
      (d) => d.promptId === promptId || (!d.promptId && allDatasets.every((x) => !x.promptId || x.promptId !== promptId)),
    );
    // Prefer prompt-scoped dataset; if none exist use workspace-wide fallback
    const promptScopedBaseline = allDatasets.filter((d) => d.promptId === promptId);
    const baselineCandidates = promptScopedBaseline.length > 0 ? promptScopedBaseline : (allDatasets[0] ? [allDatasets[0]] : []);

    for (const dataset of baselineCandidates) {
      const runResult = await _triggerBaselineRun({
        workspaceId,
        datasetId: dataset.id,
        datasetName: dataset.name,
        promptVersionId,
        force,
        startedBy,
      });
      runs.push(runResult);
      // Only use first workspace-wide dataset if no prompt-scoped ones exist
      if (promptScopedBaseline.length === 0) break;
    }

    // ── 2. Behavioral datasets (Pro/Enterprise only) ──────────────────────────
    const behavioralFeature = await canUseFeature(workspaceId, "behavioral_evaluations");
    if (behavioralFeature.allowed) {
      const allBehavioralDatasets = await listBehavioralDatasets(workspaceId);
      const activeDatasets = allBehavioralDatasets.filter((d) => d.promptId === promptId);

      for (const bDataset of activeDatasets) {
        const rubrics = await listRubricsForDataset(bDataset.id);
        if (rubrics.length === 0) {
          runs.push({
            type: "behavioral",
            datasetId: bDataset.id,
            datasetName: bDataset.name,
            status: "no_rubric",
            reason: "No rubric found for behavioral dataset",
          });
          continue;
        }

        // Use the most recently created rubric
        const rubric = rubrics[0];

        // Find a provider to use
        const providers = await listEnabledProviders(workspaceId);
        if (providers.length === 0) {
          runs.push({
            type: "behavioral",
            datasetId: bDataset.id,
            datasetName: bDataset.name,
            status: "no_provider",
            reason: "No enabled providers found",
          });
          continue;
        }

        const provider = providers[0];
        const model = provider.default_model ?? "gpt-4o";

        const runResult = await _triggerBehavioralRun({
          workspaceId,
          datasetId: bDataset.id,
          datasetName: bDataset.name,
          rubricId: rubric.id,
          promptVersionId,
          provider: provider.provider_type,
          model,
          force,
          startedBy,
        });
        runs.push(runResult);
      }
    } else {
      console.log(`[auto-eval] behavioral_evaluations gated — workspace=${workspaceId} plan=${behavioralFeature.planTier}`);
    }

    if (runs.length === 0) {
      return {
        status: "no_dataset",
        reason: `No evaluation datasets found for prompt ${promptId}. Create one to enable automatic evaluations.`,
        trigger,
      };
    }

    console.log(`[auto-eval] trigger=${trigger} workspace=${workspaceId} promptVersion=${promptVersionId} runs=${runs.map((r) => `${r.type}:${r.status}`).join(", ")}`);
    return { status: "started", runs, trigger };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[auto-eval] error trigger=${trigger} workspace=${workspaceId}`, err);
    return { status: "error", reason, trigger };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _triggerBaselineRun(args: {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
  promptVersionId: string;
  force: boolean;
  startedBy: string;
}): Promise<AutoEvalRunResult> {
  const { workspaceId, datasetId, datasetName, promptVersionId, force, startedBy } = args;

  try {
    if (!force) {
      const supabase = createVectorBeaAdminClient();
      const { data: existing } = await supabase
        .from("trace_set_evaluation_runs")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("candidate_prompt_version_id", promptVersionId)
        .eq("dataset_id", datasetId)
        .not("status", "eq", "failed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        return {
          type: "baseline",
          datasetId,
          datasetName,
          status: "duplicate_skipped",
          runId: existing.id as string,
        };
      }
    }

    const run = await createDatasetEvaluationRun({
      workspaceId,
      datasetId,
      candidatePromptVersionId: promptVersionId,
      triggeredBy: startedBy,
    });

    return { type: "baseline", datasetId, datasetName, status: "started", runId: run.id };
  } catch (err) {
    return {
      type: "baseline",
      datasetId,
      datasetName,
      status: "error",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function _triggerBehavioralRun(args: {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
  rubricId: string;
  promptVersionId: string;
  provider: string;
  model: string;
  force: boolean;
  startedBy: string;
}): Promise<AutoEvalRunResult> {
  const { workspaceId, datasetId, datasetName, rubricId, promptVersionId, provider, model, force, startedBy } = args;

  try {
    if (!force) {
      const supabase = createVectorBeaAdminClient();
      const { data: existing } = await supabase
        .from("behavioral_evaluation_runs")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("prompt_version_id", promptVersionId)
        .eq("dataset_id", datasetId)
        .eq("rubric_id", rubricId)
        .not("status", "eq", "failed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        return {
          type: "behavioral",
          datasetId,
          datasetName,
          status: "duplicate_skipped",
          runId: existing.id as string,
        };
      }
    }

    const run = await startBehavioralRubricRun({
      workspaceId,
      datasetId,
      rubricId,
      promptVersionId,
      provider,
      model,
      startedBy,
    });

    return { type: "behavioral", datasetId, datasetName, status: "started", runId: run.id };
  } catch (err) {
    return {
      type: "behavioral",
      datasetId,
      datasetName,
      status: "error",
      reason: err instanceof Error ? err.message : String(err),
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

    if (result.status === "started") {
      const startedCount = result.runs.filter((r) => r.status === "started").length;
      const skippedCount = result.runs.filter((r) => r.status !== "started" && r.status !== "error").length;
      started += startedCount;
      skipped += skippedCount;
    } else if (result.status === "no_dataset") {
      skipped++;
    } else if (result.status === "error") {
      errors.push(`Version ${v.id}: ${result.reason}`);
    }
  }

  return { attempted: versions.length, started, skipped, errors };
}
