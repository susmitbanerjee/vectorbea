import "server-only";

import type {
  EvaluationRubric,
  RubricDimension,
  RubricRule,
  BehavioralPromptType,
  RubricRuleType,
  RubricSeverity,
} from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ── Row shapes ────────────────────────────────────────────────────────────────

type RubricRow = {
  id: string;
  workspace_id: string;
  dataset_id: string;
  prompt_id: string;
  name: string;
  prompt_type: string;
  goal: string | null;
  pass_threshold: number;
  judge_model: string | null;
  judge_provider: string | null;
  is_locked: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type DimensionRow = {
  id: string;
  rubric_id: string;
  name: string;
  description: string | null;
  weight: number;
  scale_min: number;
  scale_max: number;
  pass_threshold: number;
  ord: number;
  created_at: string;
  updated_at: string;
};

type RuleRow = {
  id: string;
  rubric_id: string;
  rule_type: string;
  description: string;
  severity: string;
  created_at: string;
  updated_at: string;
};

// ── Mappers ───────────────────────────────────────────────────────────────────

function rubricFromRow(row: RubricRow): EvaluationRubric {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    promptId: row.prompt_id,
    name: row.name,
    promptType: row.prompt_type as BehavioralPromptType,
    goal: row.goal,
    passThreshold: row.pass_threshold,
    judgeModel: row.judge_model,
    judgeProvider: row.judge_provider,
    isLocked: row.is_locked,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dimensionFromRow(row: DimensionRow): RubricDimension {
  return {
    id: row.id,
    rubricId: row.rubric_id,
    name: row.name,
    description: row.description,
    weight: row.weight,
    scaleMin: row.scale_min,
    scaleMax: row.scale_max,
    passThreshold: row.pass_threshold,
    ord: row.ord,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ruleFromRow(row: RuleRow): RubricRule {
  return {
    id: row.id,
    rubricId: row.rubric_id,
    ruleType: row.rule_type as RubricRuleType,
    description: row.description,
    severity: row.severity as RubricSeverity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Rubric CRUD ───────────────────────────────────────────────────────────────

export async function listRubricsForDataset(
  datasetId: string,
): Promise<EvaluationRubric[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("evaluation_rubrics")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => rubricFromRow(row as RubricRow));
}

export async function getRubricWithDetails(
  rubricId: string,
): Promise<EvaluationRubric | null> {
  const supabase = createVectorBeaAdminClient();
  const [rubricResult, dimensionsResult, rulesResult] = await Promise.all([
    supabase.from("evaluation_rubrics").select("*").eq("id", rubricId).single(),
    supabase.from("rubric_dimensions").select("*").eq("rubric_id", rubricId).order("ord"),
    supabase.from("rubric_rules").select("*").eq("rubric_id", rubricId).order("created_at"),
  ]);

  if (rubricResult.error) {
    if (rubricResult.error.code === "PGRST116") return null;
    throw new Error(rubricResult.error.message);
  }

  const rubric = rubricFromRow(rubricResult.data as RubricRow);
  rubric.dimensions = (dimensionsResult.data ?? []).map((r) => dimensionFromRow(r as DimensionRow));
  rubric.rules = (rulesResult.data ?? []).map((r) => ruleFromRow(r as RuleRow));
  return rubric;
}

export async function createRubric(input: {
  workspaceId: string;
  datasetId: string;
  promptId: string;
  name: string;
  promptType?: BehavioralPromptType;
  goal?: string | null;
  passThreshold?: number;
  judgeModel?: string | null;
  judgeProvider?: string | null;
  createdBy: string;
}): Promise<EvaluationRubric> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("evaluation_rubrics")
    .insert({
      workspace_id: input.workspaceId,
      dataset_id: input.datasetId,
      prompt_id: input.promptId,
      name: input.name.trim(),
      prompt_type: input.promptType ?? "general",
      goal: input.goal ?? null,
      pass_threshold: input.passThreshold ?? 80,
      judge_model: input.judgeModel ?? null,
      judge_provider: input.judgeProvider ?? null,
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return rubricFromRow(data as RubricRow);
}

export async function updateRubric(
  rubricId: string,
  patch: {
    name?: string;
    promptType?: BehavioralPromptType;
    goal?: string | null;
    passThreshold?: number;
    judgeModel?: string | null;
    judgeProvider?: string | null;
    isLocked?: boolean;
  },
): Promise<EvaluationRubric> {
  const supabase = createVectorBeaAdminClient();
  const updateData: Record<string, unknown> = {};
  if (patch.name !== undefined) updateData.name = patch.name.trim();
  if (patch.promptType !== undefined) updateData.prompt_type = patch.promptType;
  if (patch.goal !== undefined) updateData.goal = patch.goal;
  if (patch.passThreshold !== undefined) updateData.pass_threshold = patch.passThreshold;
  if (patch.judgeModel !== undefined) updateData.judge_model = patch.judgeModel;
  if (patch.judgeProvider !== undefined) updateData.judge_provider = patch.judgeProvider;
  if (patch.isLocked !== undefined) updateData.is_locked = patch.isLocked;

  const { data, error } = await supabase
    .from("evaluation_rubrics")
    .update(updateData)
    .eq("id", rubricId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return rubricFromRow(data as RubricRow);
}

export async function deleteRubric(rubricId: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("evaluation_rubrics")
    .delete()
    .eq("id", rubricId);
  if (error) throw new Error(error.message);
}

// ── Dimension CRUD ────────────────────────────────────────────────────────────

export async function listDimensions(rubricId: string): Promise<RubricDimension[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("rubric_dimensions")
    .select("*")
    .eq("rubric_id", rubricId)
    .order("ord");

  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => dimensionFromRow(r as DimensionRow));
}

export async function createDimension(input: {
  rubricId: string;
  name: string;
  description?: string | null;
  weight: number;
  scaleMin?: number;
  scaleMax?: number;
  passThreshold?: number;
  ord?: number;
}): Promise<RubricDimension> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("rubric_dimensions")
    .insert({
      rubric_id: input.rubricId,
      name: input.name.trim(),
      description: input.description ?? null,
      weight: input.weight,
      scale_min: input.scaleMin ?? 0,
      scale_max: input.scaleMax ?? 100,
      pass_threshold: input.passThreshold ?? 70,
      ord: input.ord ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return dimensionFromRow(data as DimensionRow);
}

export async function updateDimension(
  dimensionId: string,
  patch: {
    name?: string;
    description?: string | null;
    weight?: number;
    passThreshold?: number;
    ord?: number;
  },
): Promise<RubricDimension> {
  const supabase = createVectorBeaAdminClient();
  const updateData: Record<string, unknown> = {};
  if (patch.name !== undefined) updateData.name = patch.name.trim();
  if (patch.description !== undefined) updateData.description = patch.description;
  if (patch.weight !== undefined) updateData.weight = patch.weight;
  if (patch.passThreshold !== undefined) updateData.pass_threshold = patch.passThreshold;
  if (patch.ord !== undefined) updateData.ord = patch.ord;

  const { data, error } = await supabase
    .from("rubric_dimensions")
    .update(updateData)
    .eq("id", dimensionId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return dimensionFromRow(data as DimensionRow);
}

export async function deleteDimension(dimensionId: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("rubric_dimensions")
    .delete()
    .eq("id", dimensionId);
  if (error) throw new Error(error.message);
}

// ── Rule CRUD ─────────────────────────────────────────────────────────────────

export async function listRules(rubricId: string): Promise<RubricRule[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("rubric_rules")
    .select("*")
    .eq("rubric_id", rubricId)
    .order("created_at");

  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ruleFromRow(r as RuleRow));
}

export async function createRule(input: {
  rubricId: string;
  ruleType: RubricRuleType;
  description: string;
  severity?: RubricSeverity;
}): Promise<RubricRule> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("rubric_rules")
    .insert({
      rubric_id: input.rubricId,
      rule_type: input.ruleType,
      description: input.description.trim(),
      severity: input.severity ?? "medium",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return ruleFromRow(data as RuleRow);
}

export async function updateRule(
  ruleId: string,
  patch: {
    ruleType?: RubricRuleType;
    description?: string;
    severity?: RubricSeverity;
  },
): Promise<RubricRule> {
  const supabase = createVectorBeaAdminClient();
  const updateData: Record<string, unknown> = {};
  if (patch.ruleType !== undefined) updateData.rule_type = patch.ruleType;
  if (patch.description !== undefined) updateData.description = patch.description.trim();
  if (patch.severity !== undefined) updateData.severity = patch.severity;

  const { data, error } = await supabase
    .from("rubric_rules")
    .update(updateData)
    .eq("id", ruleId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return ruleFromRow(data as RuleRow);
}

export async function deleteRule(ruleId: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("rubric_rules")
    .delete()
    .eq("id", ruleId);
  if (error) throw new Error(error.message);
}

// ── Validation helper ─────────────────────────────────────────────────────────

export function validateDimensionWeights(
  dimensions: Array<{ weight: number }>,
): { valid: boolean; total: number } {
  const total = dimensions.reduce((sum, d) => sum + d.weight, 0);
  return { valid: total === 100, total };
}
