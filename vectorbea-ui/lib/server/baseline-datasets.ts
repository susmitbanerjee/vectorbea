import "server-only";

import { randomUUID } from "crypto";
import type { BaselineDataset, BaselineDatasetSourceType } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type BaselineDatasetRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  source_type: string;
  trace_ids: string[];
  prompt_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function toView(row: BaselineDatasetRow): BaselineDataset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    sourceType: row.source_type as BaselineDatasetSourceType,
    traceIds: Array.isArray(row.trace_ids) ? row.trace_ids : [],
    promptName: row.prompt_name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBaselineDatasets(workspaceId: string): Promise<BaselineDataset[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("baseline_datasets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toView);
}

export async function getBaselineDataset(workspaceId: string, id: string): Promise<BaselineDataset | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("baseline_datasets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toView(data as BaselineDatasetRow) : null;
}

export async function createBaselineDataset(args: {
  workspaceId: string;
  name: string;
  description?: string | null;
  sourceType: BaselineDatasetSourceType;
  traceIds: string[];
  promptName?: string | null;
  createdBy: string;
}): Promise<BaselineDataset> {
  if (!args.name.trim()) throw new Error("Dataset name is required.");
  if (args.traceIds.length === 0) throw new Error("At least one trace ID is required.");
  const supabase = createVectorBeaAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("baseline_datasets")
    .insert({
      id: randomUUID(),
      workspace_id: args.workspaceId,
      name: args.name.trim(),
      description: args.description?.trim() ?? null,
      source_type: args.sourceType,
      trace_ids: args.traceIds,
      prompt_name: args.promptName ?? null,
      created_by: args.createdBy,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toView(data as BaselineDatasetRow);
}

export async function deleteBaselineDataset(workspaceId: string, id: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("baseline_datasets")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
