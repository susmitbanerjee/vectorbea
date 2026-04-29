import "server-only";

import type {
  BehavioralDataset,
  BehavioralDatasetItem,
  BehavioralPromptType,
  RiskLevel,
} from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ── Row shapes ────────────────────────────────────────────────────────────────

type DatasetRow = {
  id: string;
  workspace_id: string;
  prompt_id: string;
  name: string;
  description: string | null;
  prompt_type: string;
  is_archived: boolean;
  item_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  dataset_id: string;
  input: string;
  context: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  risk_level: string;
  reference_output: string | null;
  rubric_override: Record<string, unknown> | null;
  source_trace_id: string | null;
  created_at: string;
  updated_at: string;
};

// ── Mappers ───────────────────────────────────────────────────────────────────

function datasetFromRow(row: DatasetRow): BehavioralDataset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    promptId: row.prompt_id,
    name: row.name,
    description: row.description,
    promptType: row.prompt_type as BehavioralPromptType,
    isArchived: row.is_archived,
    itemCount: row.item_count ?? 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: ItemRow): BehavioralDatasetItem {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    input: row.input,
    context: row.context,
    metadata: row.metadata,
    tags: row.tags ?? [],
    riskLevel: row.risk_level as RiskLevel,
    referenceOutput: row.reference_output,
    rubricOverride: row.rubric_override,
    sourceTraceId: row.source_trace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Dataset CRUD ──────────────────────────────────────────────────────────────

export async function listBehavioralDatasets(
  workspaceId: string,
): Promise<BehavioralDataset[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("behavioral_datasets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => datasetFromRow(row as DatasetRow));
}

export async function getBehavioralDataset(
  workspaceId: string,
  id: string,
): Promise<BehavioralDataset | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("behavioral_datasets")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }
  return data ? datasetFromRow(data as DatasetRow) : null;
}

export async function createBehavioralDataset(input: {
  workspaceId: string;
  promptId: string;
  name: string;
  description?: string | null;
  promptType?: BehavioralPromptType;
  createdBy: string;
}): Promise<BehavioralDataset> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("behavioral_datasets")
    .insert({
      workspace_id: input.workspaceId,
      prompt_id: input.promptId,
      name: input.name.trim(),
      description: input.description ?? null,
      prompt_type: input.promptType ?? "general",
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return datasetFromRow(data as DatasetRow);
}

export async function updateBehavioralDataset(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    promptType?: BehavioralPromptType;
    isArchived?: boolean;
  },
): Promise<BehavioralDataset> {
  const supabase = createVectorBeaAdminClient();
  const updateData: Record<string, unknown> = {};
  if (patch.name !== undefined) updateData.name = patch.name.trim();
  if (patch.description !== undefined) updateData.description = patch.description;
  if (patch.promptType !== undefined) updateData.prompt_type = patch.promptType;
  if (patch.isArchived !== undefined) updateData.is_archived = patch.isArchived;

  const { data, error } = await supabase
    .from("behavioral_datasets")
    .update(updateData)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return datasetFromRow(data as DatasetRow);
}

export async function deleteBehavioralDataset(
  workspaceId: string,
  id: string,
): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("behavioral_datasets")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

// ── Dataset items CRUD ────────────────────────────────────────────────────────

export async function listBehavioralItems(
  datasetId: string,
): Promise<BehavioralDatasetItem[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("behavioral_dataset_items")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => itemFromRow(row as ItemRow));
}

export async function createBehavioralItem(input: {
  datasetId: string;
  input: string;
  context?: string | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[];
  riskLevel?: RiskLevel;
  referenceOutput?: string | null;
  sourceTraceId?: string | null;
}): Promise<BehavioralDatasetItem> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("behavioral_dataset_items")
    .insert({
      dataset_id: input.datasetId,
      input: input.input.trim(),
      context: input.context ?? null,
      metadata: input.metadata ?? null,
      tags: input.tags ?? [],
      risk_level: input.riskLevel ?? "medium",
      reference_output: input.referenceOutput ?? null,
      source_trace_id: input.sourceTraceId ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return itemFromRow(data as ItemRow);
}

export async function bulkCreateBehavioralItems(
  datasetId: string,
  items: Array<{
    input: string;
    context?: string | null;
    tags?: string[];
    riskLevel?: RiskLevel;
    referenceOutput?: string | null;
  }>,
): Promise<number> {
  if (items.length === 0) return 0;
  const supabase = createVectorBeaAdminClient();
  const rows = items.map((item) => ({
    dataset_id: datasetId,
    input: item.input.trim(),
    context: item.context ?? null,
    tags: item.tags ?? [],
    risk_level: item.riskLevel ?? "medium",
    reference_output: item.referenceOutput ?? null,
  }));

  const { error, count } = await supabase
    .from("behavioral_dataset_items")
    .insert(rows, { count: "exact" });

  if (error) throw new Error(error.message);
  return count ?? items.length;
}

export async function updateBehavioralItem(
  id: string,
  patch: {
    input?: string;
    context?: string | null;
    tags?: string[];
    riskLevel?: RiskLevel;
    referenceOutput?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<BehavioralDatasetItem> {
  const supabase = createVectorBeaAdminClient();
  const updateData: Record<string, unknown> = {};
  if (patch.input !== undefined) updateData.input = patch.input.trim();
  if (patch.context !== undefined) updateData.context = patch.context;
  if (patch.tags !== undefined) updateData.tags = patch.tags;
  if (patch.riskLevel !== undefined) updateData.risk_level = patch.riskLevel;
  if (patch.referenceOutput !== undefined) updateData.reference_output = patch.referenceOutput;
  if (patch.metadata !== undefined) updateData.metadata = patch.metadata;

  const { data, error } = await supabase
    .from("behavioral_dataset_items")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return itemFromRow(data as ItemRow);
}

export async function deleteBehavioralItem(id: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("behavioral_dataset_items")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
