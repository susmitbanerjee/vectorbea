import "server-only";

import type { AuditLogView, DashboardSummary } from "@/lib/api";
import { resolveAuditProxyLatencyMs, resolveAuditLlmLatencyMs } from "@/lib/server/audit-latency";
import { computeReleaseGate } from "@/lib/server/evidence-runs";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

function resolveUseType(metadata: Record<string, unknown>): "runtime" | "audit" {
  const normalized = normalizeTraceMetadataV1(metadata);
  const explicit = normalized.tags?.use_type;
  if (explicit === "runtime" || explicit === "audit") return explicit;
  const action = (normalized.custom as Record<string, unknown> | undefined)?.action;
  return typeof action === "string" && action.trim() ? "audit" : "runtime";
}

export async function getRecentAuditLogsForWorkspace(
  workspaceId: string,
): Promise<AuditLogView[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select(
      "id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Failed to load audit logs: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    timestamp: row.created_at,
    workspaceId,
    promptName: row.prompt_name ?? "",
    versionTag: row.version_tag ?? "",
    proxyLatencyMs: resolveAuditProxyLatencyMs(row.proxy_latency_ms, row.metadata),
    llmLatencyMs: resolveAuditLlmLatencyMs(row.llm_latency_ms, row.metadata),
    tokenCount: row.token_count ?? 0,
    useType: resolveUseType((row.metadata as Record<string, unknown>) ?? {}),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));
}

export async function getDashboardSummaryForWorkspace(
  workspaceId: string,
  _auditLogs?: AuditLogView[],
): Promise<DashboardSummary> {
  const supabase = createVectorBeaAdminClient();
  const [{ data: systems }, { data: assignments }, { data: requiredEvidence }, { data: evidenceRuns }, { data: approvals }, { data: incidents }, { data: versions, error }] =
    await Promise.all([
      supabase
        .from("ai_capabilities")
        .select("id, risk_level, owner_user_id")
        .eq("workspace_id", workspaceId),
      supabase
        .from("capability_policy_pack_assignments")
        .select("capability_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      supabase
        .from("ai_system_required_evidence")
        .select("ai_system_id, evidence_type, blocking")
        .eq("workspace_id", workspaceId),
      supabase
        .from("capability_evidence_runs")
        .select("ai_system_id, evidence_type, status, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      supabase
        .from("approval_requests")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending"),
      supabase
        .from("ai_incidents")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("status", ["open", "investigating", "fix_in_progress", "verification_pending"]),
      supabase
        .from("capability_versions")
        .select("id")
        .eq("workspace_id", workspaceId),
    ]);

  if (error) {
    throw new Error(`Failed to load governance dashboard: ${error.message}`);
  }

  const assignedSystemIds = new Set((assignments ?? []).map((row) => String(row.capability_id)));
  const latestRunBySystemType = new Map<string, string>();
  for (const run of evidenceRuns ?? []) {
    const key = `${run.ai_system_id}:${run.evidence_type}`;
    if (!latestRunBySystemType.has(key)) latestRunBySystemType.set(key, String(run.status));
  }
  const systemsMissingEvidence = new Set<string>();
  for (const req of requiredEvidence ?? []) {
    const status = latestRunBySystemType.get(`${req.ai_system_id}:${req.evidence_type}`);
    if (!status || status === "queued" || status === "running") systemsMissingEvidence.add(String(req.ai_system_id));
  }
  let blockedReleases = 0;
  for (const version of versions ?? []) {
    const gate = await computeReleaseGate(workspaceId, String(version.id)).catch(() => null);
    if (gate?.decision === "blocked" || gate?.decision === "missing_evidence") blockedReleases += 1;
  }

  return {
    totalApiCallsLast24h: 0,
    auditsThisMonth: 0,
    averageLatencyMs: 0,
    activeAgents: 0,
    totalAiSystems: systems?.length ?? 0,
    highRiskSystems: (systems ?? []).filter((system) => ["high", "critical"].includes(String(system.risk_level))).length,
    systemsMissingEvidence: systemsMissingEvidence.size,
    blockedReleases,
    pendingApprovals: approvals?.length ?? 0,
    openIncidents: incidents?.length ?? 0,
    failedEvidenceRuns: (evidenceRuns ?? []).filter((run) => run.status === "failed").length,
    systemsWithoutPolicy: (systems ?? []).filter((system) => !assignedSystemIds.has(String(system.id))).length,
  };
}
