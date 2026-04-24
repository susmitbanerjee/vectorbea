import "server-only";

import { randomUUID } from "crypto";
import type { GoldenTrace } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type GoldenTraceRow = {
  id: string;
  workspace_id: string;
  trace_id: string;
  prompt_name: string | null;
  prompt_version: string | null;
  label: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};

function toView(row: GoldenTraceRow): GoldenTrace {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    traceId: row.trace_id,
    promptName: row.prompt_name,
    promptVersion: row.prompt_version,
    label: row.label,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listGoldenTraces(workspaceId: string): Promise<GoldenTrace[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("golden_traces")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toView);
}

export async function markGoldenTrace(args: {
  workspaceId: string;
  traceId: string;
  promptName?: string | null;
  promptVersion?: string | null;
  label?: string | null;
  notes?: string | null;
  createdBy: string;
}): Promise<GoldenTrace> {
  const supabase = createVectorBeaAdminClient();
  // Upsert so re-marking is idempotent
  const { data, error } = await supabase
    .from("golden_traces")
    .upsert(
      {
        id: randomUUID(),
        workspace_id: args.workspaceId,
        trace_id: args.traceId,
        prompt_name: args.promptName ?? null,
        prompt_version: args.promptVersion ?? null,
        label: args.label ?? null,
        notes: args.notes ?? null,
        created_by: args.createdBy,
      },
      { onConflict: "workspace_id,trace_id", ignoreDuplicates: false },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toView(data as GoldenTraceRow);
}

export async function unmarkGoldenTrace(workspaceId: string, traceId: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("golden_traces")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("trace_id", traceId);
  if (error) throw new Error(error.message);
}

export async function isGoldenTrace(workspaceId: string, traceId: string): Promise<boolean> {
  const supabase = createVectorBeaAdminClient();
  const { data } = await supabase
    .from("golden_traces")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("trace_id", traceId)
    .maybeSingle();
  return data !== null;
}
