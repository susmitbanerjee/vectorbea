import "server-only";

import { randomUUID } from "crypto";
import type {
  EvaluationDataset,
  EvaluationDatasetItem,
  EvaluationDatasetItemSourceType,
  EvaluationDatasetType,
} from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ── Row shapes ────────────────────────────────────────────────────────────────

type DatasetRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  dataset_type: string;
  item_count: number;
  prompt_name: string | null;
  prompt_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  dataset_id: string;
  workspace_id: string;
  source_type: string;
  input: string;
  expected_output: string | null;
  reference_output: string | null;
  source_prompt_id: string | null;
  source_prompt_version_id: string | null;
  trace_id: string | null;
  metadata: Record<string, unknown> | null;
  notes: string | null;
  is_golden: boolean;
  ord: number;
  created_at: string;
};

// Rows from baseline_datasets (legacy)
type BaselineRow = {
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

// ── Mappers ───────────────────────────────────────────────────────────────────

function datasetFromRow(row: DatasetRow, origin: "evaluation" = "evaluation"): EvaluationDataset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    datasetType: row.dataset_type as EvaluationDatasetType,
    itemCount: row.item_count ?? 0,
    promptName: row.prompt_name,
    promptId: row.prompt_id ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    origin,
  };
}

function datasetFromBaselineRow(row: BaselineRow): EvaluationDataset {
  const count = Array.isArray(row.trace_ids) ? row.trace_ids.length : 0;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    datasetType: "runtime",
    itemCount: count,
    promptName: row.prompt_name,
    promptId: null, // legacy baseline datasets have no prompt_id
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    origin: "baseline",
  };
}

function itemFromRow(row: ItemRow): EvaluationDatasetItem {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    workspaceId: row.workspace_id,
    sourceType: row.source_type as EvaluationDatasetItemSourceType,
    input: row.input,
    expectedOutput: row.expected_output,
    referenceOutput: row.reference_output ?? null,
    sourcePromptId: row.source_prompt_id ?? null,
    sourcePromptVersionId: row.source_prompt_version_id ?? null,
    traceId: row.trace_id,
    metadata: row.metadata,
    notes: row.notes,
    isGolden: row.is_golden ?? false,
    ord: row.ord ?? 0,
    createdAt: row.created_at,
  };
}

// ── Dataset CRUD ──────────────────────────────────────────────────────────────

/**
 * List all datasets for a workspace.
 * Merges native evaluation_datasets with legacy baseline_datasets.
 * Native datasets come first (most recently updated).
 */
export async function listEvaluationDatasets(workspaceId: string): Promise<EvaluationDataset[]> {
  const supabase = createVectorBeaAdminClient();

  const [nativeResult, baselineResult] = await Promise.all([
    supabase
      .from("evaluation_datasets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("baseline_datasets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (nativeResult.error && !nativeResult.error.message.includes("does not exist")) {
    throw new Error(nativeResult.error.message);
  }

  const native = (nativeResult.data ?? []).map((row) => datasetFromRow(row as DatasetRow));
  const baseline = (baselineResult.data ?? []).map((row) => datasetFromBaselineRow(row as BaselineRow));

  // Deduplicate: prefer native if same id appears in both (shouldn't happen but be safe)
  const nativeIds = new Set(native.map((d) => d.id));
  const uniqueBaseline = baseline.filter((d) => !nativeIds.has(d.id));

  return [...native, ...uniqueBaseline];
}

export async function getEvaluationDataset(
  workspaceId: string,
  id: string,
): Promise<EvaluationDataset | null> {
  const supabase = createVectorBeaAdminClient();

  // Try native first
  const { data: native, error: nativeError } = await supabase
    .from("evaluation_datasets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (nativeError && !nativeError.message.includes("does not exist")) {
    throw new Error(nativeError.message);
  }
  if (native) return datasetFromRow(native as DatasetRow);

  // Fall back to baseline_datasets
  const { data: baseline, error: baselineError } = await supabase
    .from("baseline_datasets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (baselineError) throw new Error(baselineError.message);
  return baseline ? datasetFromBaselineRow(baseline as BaselineRow) : null;
}

export async function createEvaluationDataset(args: {
  workspaceId: string;
  name: string;
  description?: string | null;
  datasetType: EvaluationDatasetType;
  promptName?: string | null;
  promptId?: string | null;
  createdBy: string;
}): Promise<EvaluationDataset> {
  if (!args.name.trim()) throw new Error("Dataset name is required.");
  const supabase = createVectorBeaAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("evaluation_datasets")
    .insert({
      id: randomUUID(),
      workspace_id: args.workspaceId,
      name: args.name.trim(),
      description: args.description?.trim() ?? null,
      dataset_type: args.datasetType,
      item_count: 0,
      prompt_name: args.promptName?.trim() ?? null,
      prompt_id: args.promptId ?? null,
      created_by: args.createdBy,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return datasetFromRow(data as DatasetRow);
}

export async function deleteEvaluationDataset(workspaceId: string, id: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("evaluation_datasets")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Item CRUD ─────────────────────────────────────────────────────────────────

export async function listDatasetItems(
  workspaceId: string,
  datasetId: string,
): Promise<EvaluationDatasetItem[]> {
  const supabase = createVectorBeaAdminClient();

  // Check if this is a baseline dataset
  const dataset = await getEvaluationDataset(workspaceId, datasetId);
  if (!dataset) throw new Error("Dataset not found.");

  if (dataset.origin === "baseline") {
    // For baseline datasets, synthetic items come from trace_ids array
    const { data: bdRow, error: bdError } = await supabase
      .from("baseline_datasets")
      .select("trace_ids")
      .eq("workspace_id", workspaceId)
      .eq("id", datasetId)
      .single();
    if (bdError) throw new Error(bdError.message);
    const traceIds: string[] = Array.isArray(bdRow?.trace_ids) ? bdRow.trace_ids : [];
    return traceIds.map((tid, i) => ({
      id: `${datasetId}-item-${i}`,
      datasetId,
      workspaceId,
      sourceType: "runtime_trace" as EvaluationDatasetItemSourceType,
      input: "",
      expectedOutput: null,
      traceId: tid,
      metadata: null,
      notes: null,
      isGolden: false,
      ord: i,
      createdAt: dataset.createdAt,
    }));
  }

  const { data, error } = await supabase
    .from("evaluation_dataset_items")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("dataset_id", datasetId)
    .order("ord", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => itemFromRow(row as ItemRow));
}

/**
 * For golden_trace items without a referenceOutput, try to populate it
 * from the audit_log trace metadata.
 */
async function enrichGoldenTraceItems(
  supabase: ReturnType<typeof createVectorBeaAdminClient>,
  workspaceId: string,
  items: Array<{
    sourceType: EvaluationDatasetItemSourceType;
    traceId?: string | null;
    referenceOutput?: string | null;
    sourcePromptId?: string | null;
    [key: string]: unknown;
  }>,
): Promise<void> {
  const needsEnrichment = items.filter(
    (item) => item.sourceType === "golden_trace" && item.traceId && !item.referenceOutput,
  );
  if (needsEnrichment.length === 0) return;

  const traceIds = needsEnrichment.map((item) => item.traceId as string);
  const { data: traces } = await supabase
    .from("audit_logs")
    .select("id, metadata")
    .in("id", traceIds)
    .eq("workspace_id", workspaceId);

  if (!traces) return;

  for (const trace of traces) {
    const matching = needsEnrichment.filter((item) => item.traceId === trace.id);
    const meta = trace.metadata as Record<string, unknown> | null;
    if (!meta) continue;

    // Try to extract output text from various known metadata locations
    // (mirrors the normalizeTraceMetadataV1 path in traces.ts)
    const output = meta.output as Record<string, unknown> | null;
    const response = meta.response as Record<string, unknown> | null;
    const outputText =
      (output?.final_text as string | null) ??
      (output?.final as string | null) ??
      (output?.text as string | null) ??
      (output?.raw_text as string | null) ??
      (output?.rawPrimary as string | null) ??
      (response?.content as string | null) ??
      null;

    const tags = meta.tags as Record<string, unknown> | null;
    const promptId =
      (meta.promptId as string | null) ??
      (tags?.prompt_id as string | null) ??
      (tags?.prompt_version_id as string | null) ??
      null;

    for (const item of matching) {
      if (outputText) item.referenceOutput = outputText;
      if (promptId && !item.sourcePromptId) item.sourcePromptId = promptId;
    }
  }
}

export async function addDatasetItems(args: {
  workspaceId: string;
  datasetId: string;
  items: Array<{
    sourceType: EvaluationDatasetItemSourceType;
    input: string;
    expectedOutput?: string | null;
    referenceOutput?: string | null;
    sourcePromptId?: string | null;
    sourcePromptVersionId?: string | null;
    traceId?: string | null;
    metadata?: Record<string, unknown> | null;
    notes?: string | null;
    isGolden?: boolean;
  }>;
}): Promise<EvaluationDatasetItem[]> {
  if (args.items.length === 0) return [];
  const supabase = createVectorBeaAdminClient();

  // Enrich golden trace items with reference output from audit logs
  await enrichGoldenTraceItems(supabase, args.workspaceId, args.items);

  // Determine current max ord
  const { data: existing } = await supabase
    .from("evaluation_dataset_items")
    .select("ord")
    .eq("dataset_id", args.datasetId)
    .order("ord", { ascending: false })
    .limit(1);
  const baseOrd = (existing?.[0]?.ord ?? -1) + 1;

  const now = new Date().toISOString();
  const rows = args.items.map((item, i) => ({
    id: randomUUID(),
    dataset_id: args.datasetId,
    workspace_id: args.workspaceId,
    source_type: item.sourceType,
    input: item.input ?? "",
    expected_output: item.expectedOutput?.trim() ?? null,
    reference_output: item.referenceOutput?.trim() ?? null,
    source_prompt_id: item.sourcePromptId ?? null,
    source_prompt_version_id: item.sourcePromptVersionId ?? null,
    trace_id: item.traceId ?? null,
    metadata: item.metadata ?? null,
    notes: item.notes?.trim() ?? null,
    is_golden: item.isGolden ?? false,
    ord: baseOrd + i,
    created_at: now,
  }));

  const { data, error } = await supabase
    .from("evaluation_dataset_items")
    .insert(rows)
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => itemFromRow(row as ItemRow));
}

export async function deleteDatasetItem(
  workspaceId: string,
  itemId: string,
): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("evaluation_dataset_items")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

/**
 * Get trace IDs for a dataset (works for both baseline and native datasets).
 * For manual/imported items without a trace_id, returns null slots.
 */
export async function getDatasetTraceIds(
  workspaceId: string,
  datasetId: string,
): Promise<Array<{ traceId: string | null; item: EvaluationDatasetItem }>> {
  const items = await listDatasetItems(workspaceId, datasetId);
  return items.map((item) => ({ traceId: item.traceId, item }));
}
