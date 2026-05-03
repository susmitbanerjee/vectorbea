import "server-only";

import type {
  AiCapability,
  AiIncident,
  ApprovalDecision,
  ApprovalRequest,
  AuditEvent,
  GovernanceFailureCluster,
  GovernanceDashboardData,
  IncidentActivity,
  IncidentDetailView,
  IncidentSeverity,
  IncidentStatus,
  IncidentVerification,
  PolicyPack,
  PrivacySettings,
  RedactionRule,
  WorkflowRegressionRunView,
  WorkflowTrace,
} from "@/lib/api";
import { writeAuditEvent as persistAuditEvent } from "@/lib/server/audit-events";
import { getCapability, getVersion, listCapabilities } from "@/lib/server/ai-capabilities";
import { createRule } from "@/lib/server/reliability-rules";
import { createBuiltInRedactionRules, redactObjectWithRules, redactStringWithRules } from "@/lib/server/security";
import {
  createRegressionCase,
  getWorkflowRegressionRunDetail,
  listRegressionCases,
  listRegressionSuites,
} from "@/lib/server/workflow-regressions";
import { getWorkflowTrace } from "@/lib/server/workflow-traces";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type IncidentRow = {
  id: string;
  workspace_id: string;
  capability_id: string | null;
  capability_version_id: string | null;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  source_type: string;
  source_id: string | null;
  failure_cluster_id: string | null;
  owner_user_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type FailureClusterRow = {
  id: string;
  workspace_id: string;
  capability_id: string | null;
  name: string;
  description: string | null;
  cluster_type: string;
  severity: string;
  grouping_key: string;
  affected_runs_count: number;
  affected_traces_count: number;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type IncidentActivityRow = {
  id: string;
  workspace_id: string;
  incident_id: string;
  actor_user_id: string | null;
  activity_type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type IncidentVerificationRow = {
  id: string;
  workspace_id: string;
  incident_id: string;
  regression_run_id: string;
  capability_version_id: string | null;
  status: string;
  summary: string | null;
  created_at: string;
};

type AuditEventRow = {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

type ApprovalRequestRow = {
  id: string;
  workspace_id: string;
  capability_id: string | null;
  capability_version_id: string | null;
  request_type: string;
  status: string;
  requested_by: string;
  required_approvals: number;
  approved_count: number;
  rejected_count: number;
  reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ApprovalDecisionRow = {
  id: string;
  workspace_id: string;
  approval_request_id: string;
  reviewer_user_id: string;
  decision: string;
  comment: string | null;
  created_at: string;
};

type PolicyPackRow = {
  id: string;
  workspace_id: string | null;
  name: string;
  description: string | null;
  sector: string;
  version: string;
  rules: Array<Record<string, unknown>> | null;
  required_evidence: Array<Record<string, unknown>> | null;
  approval_requirements: Record<string, unknown> | null;
  enabled: boolean;
  system_pack: boolean | null;
  created_at: string;
};

type RedactionRuleRow = {
  id: string;
  workspace_id: string;
  name: string;
  rule_type: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
  scope: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type PrivacySettingsRow = {
  workspace_id: string;
  enable_pii_redaction: boolean;
  store_raw_inputs: boolean;
  store_raw_outputs: boolean;
  store_tool_arguments: boolean;
  store_tool_results: boolean;
  retention_days: number | null;
  created_at: string;
  updated_at: string;
};

type TracePrivacyPrepared = {
  userInput: string | null;
  finalResponse: string | null;
  steps: Array<{
    inputPayload?: Record<string, unknown>;
    outputPayload?: Record<string, unknown>;
    toolArguments?: Record<string, unknown>;
    toolResult?: Record<string, unknown>;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringArray(value: unknown): string[] {
  return asArray(value).map((entry) => String(entry).trim()).filter(Boolean);
}

function mapIncident(row: IncidentRow): AiIncident {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    capabilityId: row.capability_id,
    capabilityVersionId: row.capability_version_id,
    title: row.title,
    description: row.description,
    severity: row.severity as IncidentSeverity,
    status: row.status as IncidentStatus,
    sourceType: row.source_type as AiIncident["sourceType"],
    sourceId: row.source_id,
    failureClusterId: row.failure_cluster_id,
    ownerUserId: row.owner_user_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function mapFailureCluster(row: FailureClusterRow): GovernanceFailureCluster {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    capabilityId: row.capability_id,
    name: row.name,
    description: row.description,
    clusterType: row.cluster_type as GovernanceFailureCluster["clusterType"],
    severity: row.severity as GovernanceFailureCluster["severity"],
    groupingKey: row.grouping_key,
    affectedRunsCount: row.affected_runs_count,
    affectedTracesCount: row.affected_traces_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status as GovernanceFailureCluster["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIncidentActivity(row: IncidentActivityRow): IncidentActivity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    incidentId: row.incident_id,
    actorUserId: row.actor_user_id,
    activityType: row.activity_type,
    message: row.message,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapIncidentVerification(row: IncidentVerificationRow): IncidentVerification {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    incidentId: row.incident_id,
    regressionRunId: row.regression_run_id,
    capabilityVersionId: row.capability_version_id,
    status: row.status as IncidentVerification["status"],
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityName: row.entity_name,
    metadata: row.metadata ?? {},
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

function mapApprovalRequest(row: ApprovalRequestRow): ApprovalRequest {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    capabilityId: row.capability_id,
    capabilityVersionId: row.capability_version_id,
    requestType: row.request_type as ApprovalRequest["requestType"],
    status: row.status as ApprovalRequest["status"],
    requestedBy: row.requested_by,
    requiredApprovals: row.required_approvals,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapApprovalDecision(row: ApprovalDecisionRow): ApprovalDecision {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    approvalRequestId: row.approval_request_id,
    reviewerUserId: row.reviewer_user_id,
    decision: row.decision as ApprovalDecision["decision"],
    comment: row.comment,
    createdAt: row.created_at,
  };
}

function mapPolicyPack(row: PolicyPackRow): PolicyPack {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    sector: row.sector as PolicyPack["sector"],
    version: row.version,
    rules: row.rules ?? [],
    requiredEvidence: (row.required_evidence ?? []) as PolicyPack["requiredEvidence"],
    approvalRequirements: (row.approval_requirements ?? {}) as PolicyPack["approvalRequirements"],
    enabled: row.enabled,
    systemPack: row.system_pack ?? false,
    createdAt: row.created_at,
  };
}

function mapRedactionRule(row: RedactionRuleRow): RedactionRule {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    ruleType: row.rule_type as RedactionRule["ruleType"],
    pattern: row.pattern,
    replacement: row.replacement,
    enabled: row.enabled,
    scope: row.scope as RedactionRule["scope"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrivacySettings(row: PrivacySettingsRow): PrivacySettings {
  return {
    workspaceId: row.workspace_id,
    enablePiiRedaction: row.enable_pii_redaction,
    storeRawInputs: row.store_raw_inputs,
    storeRawOutputs: row.store_raw_outputs,
    storeToolArguments: row.store_tool_arguments,
    storeToolResults: row.store_tool_results,
    retentionDays: row.retention_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function writeAuditEvent(args: {
  workspaceId: string;
  actorUserId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  entityName?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return persistAuditEvent(args);
}

async function addIncidentActivity(args: {
  workspaceId: string;
  incidentId: string;
  actorUserId?: string | null;
  activityType: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase.from("incident_activity").insert({
    workspace_id: args.workspaceId,
    incident_id: args.incidentId,
    actor_user_id: args.actorUserId ?? null,
    activity_type: args.activityType,
    message: args.message,
    metadata: args.metadata ?? {},
  });
  if (error) throw new Error(error.message);
}

function inferClusterFromTrace(trace: WorkflowTrace) {
  const stepErrors = (trace.steps ?? []).filter((step) => step.status === "failed");
  const failedStep = stepErrors[0] ?? null;
  const reason = trace.outcomeReason ?? trace.errorMessage ?? failedStep?.errorMessage ?? "unknown";
  let clusterType: GovernanceFailureCluster["clusterType"] = "unknown";
  if ((reason ?? "").toLowerCase().includes("timeout")) clusterType = "provider_timeout";
  else if ((reason ?? "").toLowerCase().includes("loop")) clusterType = "agent_loop";
  else if ((reason ?? "").toLowerCase().includes("argument")) clusterType = "invalid_arguments";
  else if ((reason ?? "").toLowerCase().includes("unsafe")) clusterType = "unsafe_action";
  else if ((reason ?? "").toLowerCase().includes("handoff")) clusterType = "human_handoff_spike";
  else if ((trace.totalCostEstimate ?? 0) > 0.5) clusterType = "high_cost";
  else if ((trace.totalLatencyMs ?? 0) > 30_000) clusterType = "high_latency";

  const groupingKey = `${clusterType}:${failedStep?.toolName ?? trace.finalAction ?? trace.outcomeReason ?? "generic"}`.toLowerCase();
  return {
    clusterType,
    groupingKey,
    summary: reason ?? "Unknown workflow failure",
  };
}

export async function createOrAttachFailureCluster(args: {
  workspaceId: string;
  capabilityId?: string | null;
  sourceType: "trace" | "workflow_regression_case" | "reliability_rule_result" | "evaluation_run" | "alert_event";
  sourceId: string;
  summary: string;
  clusterType: GovernanceFailureCluster["clusterType"];
  groupingKey: string;
  severity: IncidentSeverity;
}) {
  const supabase = createVectorBeaAdminClient();
  const existing = await supabase
    .from("failure_clusters")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("grouping_key", args.groupingKey)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  let clusterId: string;
  if (existing.data) {
    clusterId = String(existing.data.id);
    const patch = {
      affected_runs_count: Number(existing.data.affected_runs_count ?? 0) + (args.sourceType === "trace" ? 0 : 1),
      affected_traces_count: Number(existing.data.affected_traces_count ?? 0) + (args.sourceType === "trace" ? 1 : 0),
      last_seen_at: new Date().toISOString(),
      severity: args.severity,
    };
    const updateRes = await supabase.from("failure_clusters").update(patch).eq("id", clusterId);
    if (updateRes.error) throw new Error(updateRes.error.message);
  } else {
    const insertRes = await supabase
      .from("failure_clusters")
      .insert({
        workspace_id: args.workspaceId,
        capability_id: args.capabilityId ?? null,
        name: args.summary.slice(0, 120),
        description: args.summary,
        cluster_type: args.clusterType,
        severity: args.severity,
        grouping_key: args.groupingKey,
        affected_runs_count: args.sourceType === "trace" ? 0 : 1,
        affected_traces_count: args.sourceType === "trace" ? 1 : 0,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (insertRes.error) throw new Error(insertRes.error.message);
    clusterId = String(insertRes.data.id);
  }

  const itemRes = await supabase.from("failure_cluster_items").upsert({
    workspace_id: args.workspaceId,
    cluster_id: clusterId,
    source_type: args.sourceType,
    source_id: args.sourceId,
    summary: args.summary,
  }, { onConflict: "cluster_id,source_type,source_id" });
  if (itemRes.error) throw new Error(itemRes.error.message);

  return getFailureCluster(args.workspaceId, clusterId);
}

export async function getFailureCluster(workspaceId: string, id: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("failure_clusters")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapFailureCluster(data as FailureClusterRow) : null;
}

export async function listFailureClusters(workspaceId: string, opts?: { severity?: string; status?: string; limit?: number }) {
  const supabase = createVectorBeaAdminClient();
  let query = supabase
    .from("failure_clusters")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_seen_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.severity) query = query.eq("severity", opts.severity);
  if (opts?.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapFailureCluster(row as FailureClusterRow));
}

export async function createIncidentFromTrace(args: {
  workspaceId: string;
  traceId: string;
  createdBy: string;
  title?: string | null;
  description?: string | null;
}) {
  const trace = await getWorkflowTrace(args.workspaceId, args.traceId);
  if (!trace) throw new Error("Trace not found");
  const clusterSeed = inferClusterFromTrace(trace);
  const cluster = await createOrAttachFailureCluster({
    workspaceId: args.workspaceId,
    capabilityId: trace.capabilityId ?? null,
    sourceType: "trace",
    sourceId: trace.id,
    summary: clusterSeed.summary,
    clusterType: clusterSeed.clusterType,
    groupingKey: clusterSeed.groupingKey,
    severity: trace.status === "failed" ? "high" : trace.outcomeStatus === "human_handoff" ? "medium" : "low",
  });

  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("ai_incidents")
    .insert({
      workspace_id: args.workspaceId,
      capability_id: trace.capabilityId ?? null,
      capability_version_id: trace.capabilityVersionId ?? null,
      title: args.title?.trim() || `Trace incident for ${trace.capabilityName ?? trace.id.slice(0, 8)}`,
      description: args.description?.trim() || clusterSeed.summary,
      severity: trace.status === "failed" ? "high" : trace.outcomeStatus === "human_handoff" ? "medium" : "low",
      status: "open",
      source_type: "trace",
      source_id: trace.id,
      failure_cluster_id: cluster?.id ?? null,
      created_by: args.createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await addIncidentActivity({
    workspaceId: args.workspaceId,
    incidentId: String(data.id),
    actorUserId: args.createdBy,
    activityType: "incident_created",
    message: "Incident created from workflow trace",
    metadata: { trace_id: trace.id, failure_cluster_id: cluster?.id ?? null },
  });
  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.createdBy,
    eventType: "incident_created",
    entityType: "incident",
    entityId: String(data.id),
    entityName: String(data.title),
    metadata: { source_type: "trace", source_id: trace.id, failure_cluster_id: cluster?.id ?? null },
  });
  return mapIncident(data as IncidentRow);
}

export async function createIncident(args: {
  workspaceId: string;
  createdBy: string | null;
  capabilityId?: string | null;
  capabilityVersionId?: string | null;
  title: string;
  description?: string | null;
  severity: IncidentSeverity;
  status?: IncidentStatus;
  sourceType: AiIncident["sourceType"];
  sourceId?: string | null;
  failureClusterId?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase.from("ai_incidents").insert({
    workspace_id: args.workspaceId,
    capability_id: args.capabilityId ?? null,
    capability_version_id: args.capabilityVersionId ?? null,
    title: args.title,
    description: args.description ?? null,
    severity: args.severity,
    status: args.status ?? "open",
    source_type: args.sourceType,
    source_id: args.sourceId ?? null,
    failure_cluster_id: args.failureClusterId ?? null,
    created_by: args.createdBy ?? null,
  }).select("*").single();
  if (error) throw new Error(error.message);
  await addIncidentActivity({
    workspaceId: args.workspaceId,
    incidentId: String(data.id),
    actorUserId: args.createdBy ?? null,
    activityType: "incident_created",
    message: "Incident created",
    metadata: { source_type: args.sourceType, source_id: args.sourceId ?? null },
  });
  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.createdBy ?? null,
    eventType: "incident_created",
    entityType: "incident",
    entityId: String(data.id),
    entityName: args.title,
    metadata: { source_type: args.sourceType, source_id: args.sourceId ?? null },
  });
  return mapIncident(data as IncidentRow);
}

export async function listIncidents(workspaceId: string, opts?: { status?: string; severity?: string; capabilityId?: string; limit?: number }) {
  const supabase = createVectorBeaAdminClient();
  let query = supabase
    .from("ai_incidents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.severity) query = query.eq("severity", opts.severity);
  if (opts?.capabilityId) query = query.eq("capability_id", opts.capabilityId);
  const { data, error } = await query;
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }
  const incidents = (data ?? []).map((row) => mapIncident(row as IncidentRow));
  const capabilities = await listCapabilities(workspaceId).catch(() => []);
  const capsById = new Map(capabilities.map((cap) => [cap.id, cap]));
  return incidents.map((incident) => ({
    ...incident,
    capabilityName: incident.capabilityId ? capsById.get(incident.capabilityId)?.name ?? null : null,
  }));
}

export async function getIncidentDetail(workspaceId: string, incidentId: string): Promise<IncidentDetailView | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("ai_incidents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", incidentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const incident = mapIncident(data as IncidentRow);
  const [cluster, activitiesRes, verificationsRes, trace, run] = await Promise.all([
    incident.failureClusterId ? getFailureCluster(workspaceId, incident.failureClusterId) : Promise.resolve(null),
    supabase.from("incident_activity").select("*").eq("incident_id", incidentId).order("created_at", { ascending: false }),
    supabase.from("incident_verifications").select("*").eq("incident_id", incidentId).order("created_at", { ascending: false }),
    incident.sourceType === "trace" && incident.sourceId ? getWorkflowTrace(workspaceId, incident.sourceId) : Promise.resolve(null),
    incident.sourceType === "workflow_regression" && incident.sourceId ? getWorkflowRegressionRunDetail(workspaceId, incident.sourceId) : Promise.resolve(null),
  ]);
  if (activitiesRes.error) throw new Error(activitiesRes.error.message);
  if (verificationsRes.error) throw new Error(verificationsRes.error.message);
  return {
    ...incident,
    failureCluster: cluster,
    activities: (activitiesRes.data ?? []).map((row) => mapIncidentActivity(row as IncidentActivityRow)),
    verifications: (verificationsRes.data ?? []).map((row) => mapIncidentVerification(row as IncidentVerificationRow)),
    relatedTrace: trace,
    relatedRegressionRun: run as WorkflowRegressionRunView | null,
  };
}

export async function updateIncidentStatus(args: {
  workspaceId: string;
  incidentId: string;
  actorUserId: string;
  status: IncidentStatus;
  description?: string | null;
  ownerUserId?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const patch: Record<string, unknown> = { status: args.status };
  if (args.description !== undefined) patch.description = args.description;
  if (args.ownerUserId !== undefined) patch.owner_user_id = args.ownerUserId;
  if (args.status === "resolved" || args.status === "dismissed") patch.resolved_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("ai_incidents")
    .update(patch)
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.incidentId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await addIncidentActivity({
    workspaceId: args.workspaceId,
    incidentId: args.incidentId,
    actorUserId: args.actorUserId,
    activityType: "incident_status_updated",
    message: `Incident moved to ${args.status.replaceAll("_", " ")}`,
    metadata: patch,
  });
  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    eventType: args.status === "resolved" ? "incident_resolved" : "incident_updated",
    entityType: "incident",
    entityId: args.incidentId,
    metadata: patch,
  });
  return mapIncident(data as IncidentRow);
}

export async function createRegressionCaseFromIncidentTrace(args: {
  workspaceId: string;
  incidentId: string;
  suiteId: string;
  actorUserId: string;
}) {
  const incident = await getIncidentDetail(args.workspaceId, args.incidentId);
  if (!incident) throw new Error("Incident not found");
  const trace = incident.relatedTrace ?? (incident.sourceType === "trace" && incident.sourceId ? await getWorkflowTrace(args.workspaceId, incident.sourceId) : null);
  if (!trace) throw new Error("Incident does not have a workflow trace source");
  const tools = (trace.steps ?? []).map((step) => step.toolName).filter((value): value is string => Boolean(value));
  const failedTool = (trace.steps ?? []).find((step) => step.status === "failed")?.toolName ?? null;
  const rules: Record<string, unknown> = {};
  if (trace.finalAction) rules.expected_final_action = trace.finalAction;
  const expectedOutcome = trace.finalBusinessOutcome ?? trace.outcomeStatus ?? "human_handoff";
  const regressionCase = await createRegressionCase({
    workspaceId: args.workspaceId,
    suiteId: args.suiteId,
    name: incident.title,
    description: incident.description ?? `Created from incident ${incident.id}`,
    inputPayload: {
      user_input: trace.userInput ?? "",
      trace_id: trace.traceId ?? trace.id,
      source_incident_id: incident.id,
    },
    expectedToolSequence: tools,
    requiredTools: failedTool ? tools.filter((tool) => tool !== failedTool) : tools,
    forbiddenTools: failedTool ? [failedTool] : [],
    expectedOutcome: String(expectedOutcome),
    expectedFinalAction: trace.finalAction ?? null,
    rules,
    tags: ["incident-generated", incident.severity, incident.sourceType],
    riskLevel: incident.severity,
    sourceTraceId: trace.id,
    createdBy: args.actorUserId,
  });
  await addIncidentActivity({
    workspaceId: args.workspaceId,
    incidentId: incident.id,
    actorUserId: args.actorUserId,
    activityType: "regression_case_created",
    message: "Regression case created from incident",
    metadata: { regression_case_id: regressionCase.id, suite_id: args.suiteId },
  });
  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    eventType: "regression_case_created",
    entityType: "regression_case",
    entityId: regressionCase.id,
    entityName: regressionCase.name,
    metadata: { source_incident_id: incident.id, suite_id: args.suiteId },
  });
  return regressionCase;
}

export async function verifyIncidentWithRegression(args: {
  workspaceId: string;
  incidentId: string;
  regressionRunId: string;
  capabilityVersionId?: string | null;
  actorUserId: string;
}) {
  const run = await getWorkflowRegressionRunDetail(args.workspaceId, args.regressionRunId);
  if (!run) throw new Error("Regression run not found");
  const status = run.safetyGate.decision === "safe_to_rollout" ? "passed" : run.safetyGate.decision === "blocked" ? "failed" : "needs_review";
  const summary = run.safetyGate.reasons.join("; ") || `Regression run ${run.status}`;
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase.from("incident_verifications").insert({
    workspace_id: args.workspaceId,
    incident_id: args.incidentId,
    regression_run_id: args.regressionRunId,
    capability_version_id: args.capabilityVersionId ?? run.capabilityVersionId ?? null,
    status,
    summary,
  }).select("*").single();
  if (error) throw new Error(error.message);

  await updateIncidentStatus({
    workspaceId: args.workspaceId,
    incidentId: args.incidentId,
    actorUserId: args.actorUserId,
    status: status === "passed" ? "verification_pending" : "fix_in_progress",
  });
  await addIncidentActivity({
    workspaceId: args.workspaceId,
    incidentId: args.incidentId,
    actorUserId: args.actorUserId,
    activityType: "incident_verified",
    message: status === "passed" ? "Fix verified by regression run" : "Fix did not pass regression verification",
    metadata: { regression_run_id: args.regressionRunId, verification_status: status },
  });
  return mapIncidentVerification(data as IncidentVerificationRow);
}

export async function listAuditEvents(workspaceId: string, opts?: { eventType?: string; entityType?: string; limit?: number }) {
  const supabase = createVectorBeaAdminClient();
  let query = supabase.from("audit_events").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(opts?.limit ?? 200);
  if (opts?.eventType) query = query.eq("event_type", opts.eventType);
  if (opts?.entityType) query = query.eq("entity_type", opts.entityType);
  const { data, error } = await query;
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapAuditEvent(row as AuditEventRow));
}

export async function createApprovalRequest(args: {
  workspaceId: string;
  capabilityId?: string | null;
  capabilityVersionId?: string | null;
  requestType: ApprovalRequest["requestType"];
  requestedBy: string;
  requiredApprovals?: number;
  reason?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  let existingQuery = supabase
    .from("approval_requests")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("request_type", args.requestType)
    .eq("status", "pending");
  existingQuery = args.capabilityId ? existingQuery.eq("capability_id", args.capabilityId) : existingQuery.is("capability_id", null);
  existingQuery = args.capabilityVersionId ? existingQuery.eq("capability_version_id", args.capabilityVersionId) : existingQuery.is("capability_version_id", null);
  const existingRes = await existingQuery.maybeSingle();
  if (existingRes.error && !existingRes.error.message.toLowerCase().includes("does not exist")) {
    throw new Error(existingRes.error.message);
  }
  if (existingRes.data) return mapApprovalRequest(existingRes.data as ApprovalRequestRow);
  const { data, error } = await supabase.from("approval_requests").insert({
    workspace_id: args.workspaceId,
    capability_id: args.capabilityId ?? null,
    capability_version_id: args.capabilityVersionId ?? null,
    request_type: args.requestType,
    requested_by: args.requestedBy,
    required_approvals: args.requiredApprovals ?? 1,
    reason: args.reason ?? null,
  }).select("*").single();
  if (error) throw new Error(error.message);
  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.requestedBy,
    eventType: "approval_requested",
    entityType: "approval_request",
    entityId: String(data.id),
    metadata: { request_type: args.requestType, capability_id: args.capabilityId ?? null, capability_version_id: args.capabilityVersionId ?? null },
  });
  return mapApprovalRequest(data as ApprovalRequestRow);
}

export async function listApprovalRequests(workspaceId: string, opts?: { status?: string; capabilityId?: string; limit?: number }) {
  const supabase = createVectorBeaAdminClient();
  let query = supabase.from("approval_requests").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(opts?.limit ?? 100);
  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.capabilityId) query = query.eq("capability_id", opts.capabilityId);
  const { data, error } = await query;
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapApprovalRequest(row as ApprovalRequestRow));
}

export async function submitApprovalDecision(args: {
  workspaceId: string;
  approvalRequestId: string;
  reviewerUserId: string;
  decision: ApprovalDecision["decision"];
  comment?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const insertRes = await supabase.from("approval_decisions").upsert({
    workspace_id: args.workspaceId,
    approval_request_id: args.approvalRequestId,
    reviewer_user_id: args.reviewerUserId,
    decision: args.decision,
    comment: args.comment ?? null,
  }, { onConflict: "approval_request_id,reviewer_user_id" }).select("*").single();
  if (insertRes.error) throw new Error(insertRes.error.message);

  const decisionsRes = await supabase.from("approval_decisions").select("*").eq("approval_request_id", args.approvalRequestId);
  if (decisionsRes.error) throw new Error(decisionsRes.error.message);
  const approvals = (decisionsRes.data ?? []).filter((row) => String(row.decision) === "approved").length;
  const rejections = (decisionsRes.data ?? []).filter((row) => String(row.decision) === "rejected").length;
  const requestRes = await supabase.from("approval_requests").select("*").eq("id", args.approvalRequestId).single();
  if (requestRes.error) throw new Error(requestRes.error.message);
  const request = requestRes.data as ApprovalRequestRow;
  const nextStatus =
    rejections > 0 ? "rejected" :
    approvals >= Number(request.required_approvals ?? 1) ? "approved" :
    "pending";
  const updatePatch: Record<string, unknown> = {
    approved_count: approvals,
    rejected_count: rejections,
    status: nextStatus,
  };
  if (nextStatus !== "pending") updatePatch.completed_at = new Date().toISOString();
  const updateRes = await supabase.from("approval_requests").update(updatePatch).eq("id", args.approvalRequestId);
  if (updateRes.error) throw new Error(updateRes.error.message);

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.reviewerUserId,
    eventType: nextStatus === "approved" ? "approval_approved" : args.decision === "rejected" ? "approval_rejected" : "approval_reviewed",
    entityType: "approval_request",
    entityId: args.approvalRequestId,
    metadata: { decision: args.decision, comment: args.comment ?? null, status: nextStatus },
  });
  return mapApprovalDecision(insertRes.data as ApprovalDecisionRow);
}

export async function getApprovalRequirementForCapability(args: {
  workspaceId: string;
  capabilityId?: string | null;
  capabilityVersionId?: string | null;
}) {
  if (!args.capabilityId) return { required: false, openRequest: null as ApprovalRequest | null };
  const capability = await getCapability(args.workspaceId, args.capabilityId);
  if (!capability || !["high", "critical"].includes(capability.riskLevel)) {
    return { required: false, openRequest: null as ApprovalRequest | null };
  }
  const requests = await listApprovalRequests(args.workspaceId, { capabilityId: args.capabilityId, status: "pending", limit: 20 });
  const matching = requests.find((request) => request.requestType === "rollout_approval" && (!args.capabilityVersionId || request.capabilityVersionId === args.capabilityVersionId)) ?? null;
  return { required: true, openRequest: matching };
}

export async function listPolicyPacks(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();
  const [packsRes, assignmentsRes] = await Promise.all([
    supabase.from("policy_packs").select("*").or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`).order("system_pack", { ascending: false }).order("name", { ascending: true }),
    supabase.from("capability_policy_pack_assignments").select("policy_pack_id,capability_id").eq("workspace_id", workspaceId),
  ]);
  if (packsRes.error) {
    if (packsRes.error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(packsRes.error.message);
  }
  if (assignmentsRes.error) throw new Error(assignmentsRes.error.message);
  const assignments = new Map<string, string[]>();
  for (const row of assignmentsRes.data ?? []) {
    const key = String(row.policy_pack_id);
    assignments.set(key, [...(assignments.get(key) ?? []), String(row.capability_id)]);
  }
  return (packsRes.data ?? []).map((row) => ({
    ...mapPolicyPack(row as PolicyPackRow),
    appliedToCapabilityIds: assignments.get(String((row as PolicyPackRow).id)) ?? [],
  }));
}

export async function applyPolicyPackToCapability(args: {
  workspaceId: string;
  capabilityId: string;
  policyPackId: string;
  actorUserId: string;
}) {
  const supabase = createVectorBeaAdminClient();
  const [packRes, capability] = await Promise.all([
    supabase.from("policy_packs").select("*").eq("id", args.policyPackId).maybeSingle(),
    getCapability(args.workspaceId, args.capabilityId),
  ]);
  if (packRes.error) throw new Error(packRes.error.message);
  if (!packRes.data) throw new Error("Policy pack not found");
  if (!capability) throw new Error("Capability not found");
  const pack = mapPolicyPack(packRes.data as PolicyPackRow);
  const existingRules = await listRegressionSuites(args.workspaceId, args.capabilityId).catch(() => []);

  for (const rawRule of pack.rules) {
    const rule = asRecord(rawRule);
    await createRule({
      workspaceId: args.workspaceId,
      capabilityId: args.capabilityId,
      capabilityVersionId: null,
      name: asString(rule.name) ?? `${pack.name} rule`,
      description: asString(rule.description),
      ruleType: (asString(rule.ruleType) ?? "business_policy") as Parameters<typeof createRule>[0]["ruleType"],
      severity: (asString(rule.severity) ?? capability.riskLevel) as Parameters<typeof createRule>[0]["severity"],
      enabled: true,
      config: asRecord(rule.config),
      createdBy: args.actorUserId,
    });
  }
  const assignRes = await supabase.from("capability_policy_pack_assignments").upsert({
    workspace_id: args.workspaceId,
    capability_id: args.capabilityId,
    policy_pack_id: args.policyPackId,
    applied_by: args.actorUserId,
    enabled: true,
  }, { onConflict: "capability_id,policy_pack_id" });
  if (assignRes.error) throw new Error(assignRes.error.message);

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    eventType: "policy_pack_applied",
    entityType: "policy_pack",
    entityId: args.policyPackId,
    entityName: pack.name,
    metadata: { capability_id: args.capabilityId, generated_rules: pack.rules.length, existing_suites: existingRules.length },
  });
  return pack;
}

export async function getPrivacySettings(workspaceId: string): Promise<PrivacySettings> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase.from("privacy_settings").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) {
      return {
        workspaceId,
        enablePiiRedaction: true,
        storeRawInputs: true,
        storeRawOutputs: true,
        storeToolArguments: true,
        storeToolResults: true,
        retentionDays: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    throw new Error(error.message);
  }
  return data ? mapPrivacySettings(data as PrivacySettingsRow) : {
    workspaceId,
    enablePiiRedaction: true,
    storeRawInputs: true,
    storeRawOutputs: true,
    storeToolArguments: true,
    storeToolResults: true,
    retentionDays: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updatePrivacySettings(args: {
  workspaceId: string;
  actorUserId: string;
  enablePiiRedaction?: boolean;
  storeRawInputs?: boolean;
  storeRawOutputs?: boolean;
  storeToolArguments?: boolean;
  storeToolResults?: boolean;
  retentionDays?: number | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const patch: Record<string, unknown> = {};
  if (args.enablePiiRedaction !== undefined) patch.enable_pii_redaction = args.enablePiiRedaction;
  if (args.storeRawInputs !== undefined) patch.store_raw_inputs = args.storeRawInputs;
  if (args.storeRawOutputs !== undefined) patch.store_raw_outputs = args.storeRawOutputs;
  if (args.storeToolArguments !== undefined) patch.store_tool_arguments = args.storeToolArguments;
  if (args.storeToolResults !== undefined) patch.store_tool_results = args.storeToolResults;
  if (args.retentionDays !== undefined) patch.retention_days = args.retentionDays;
  const { data, error } = await supabase.from("privacy_settings").upsert({
    workspace_id: args.workspaceId,
    ...patch,
  }, { onConflict: "workspace_id" }).select("*").single();
  if (error) throw new Error(error.message);
  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    eventType: "privacy_settings_updated",
    entityType: "privacy_settings",
    entityId: args.workspaceId,
    metadata: patch,
  });
  return mapPrivacySettings(data as PrivacySettingsRow);
}

export async function listRedactionRules(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase.from("redaction_rules").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapRedactionRule(row as RedactionRuleRow));
}

export async function createRedactionRule(args: {
  workspaceId: string;
  actorUserId: string;
  name: string;
  ruleType: RedactionRule["ruleType"];
  pattern: string;
  replacement?: string;
  enabled?: boolean;
  scope: RedactionRule["scope"];
}) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase.from("redaction_rules").insert({
    workspace_id: args.workspaceId,
    name: args.name,
    rule_type: args.ruleType,
    pattern: args.pattern,
    replacement: args.replacement ?? "[REDACTED]",
    enabled: args.enabled ?? true,
    scope: args.scope,
    created_by: args.actorUserId,
  }).select("*").single();
  if (error) throw new Error(error.message);
  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    eventType: "redaction_rule_created",
    entityType: "redaction_rule",
    entityId: String(data.id),
    entityName: args.name,
    metadata: { scope: args.scope, rule_type: args.ruleType },
  });
  return mapRedactionRule(data as RedactionRuleRow);
}

function filterRulesForScope(rules: RedactionRule[], scope: RedactionRule["scope"]) {
  return rules.filter((rule) => rule.enabled && (rule.scope === "all" || rule.scope === scope));
}

export async function prepareTraceForStorage(args: {
  workspaceId: string;
  userInput?: string | null;
  finalResponse?: string | null;
  steps?: Array<{
    inputPayload?: Record<string, unknown>;
    outputPayload?: Record<string, unknown>;
    toolArguments?: Record<string, unknown>;
    toolResult?: Record<string, unknown>;
  }>;
}): Promise<TracePrivacyPrepared> {
  const [settings, customRules] = await Promise.all([
    getPrivacySettings(args.workspaceId),
    listRedactionRules(args.workspaceId),
  ]);
  const builtInRules = settings.enablePiiRedaction ? createBuiltInRedactionRules() : [];
  const effectiveRules = [...builtInRules, ...customRules];

  return {
    userInput: settings.storeRawInputs
      ? redactStringWithRules(args.userInput ?? null, filterRulesForScope(effectiveRules, "traces"))
      : null,
    finalResponse: settings.storeRawOutputs
      ? redactStringWithRules(args.finalResponse ?? null, filterRulesForScope(effectiveRules, "final_response"))
      : null,
    steps: (args.steps ?? []).map((step) => ({
      inputPayload: redactObjectWithRules(step.inputPayload ?? {}, filterRulesForScope(effectiveRules, "traces")),
      outputPayload: redactObjectWithRules(step.outputPayload ?? {}, filterRulesForScope(effectiveRules, "traces")),
      toolArguments: settings.storeToolArguments
        ? redactObjectWithRules(step.toolArguments ?? {}, filterRulesForScope(effectiveRules, "tool_arguments"))
        : {},
      toolResult: settings.storeToolResults
        ? redactObjectWithRules(step.toolResult ?? {}, filterRulesForScope(effectiveRules, "tool_results"))
        : {},
    })),
  };
}

export async function getGovernanceDashboard(workspaceId: string): Promise<GovernanceDashboardData> {
  const [openIncidents, pendingApprovals, recentBlockedRollouts, policyPacks, auditActivity, privacySettings, highRiskCapabilities, criticalClusters] = await Promise.all([
    listIncidents(workspaceId, { status: "open", limit: 8 }),
    listApprovalRequests(workspaceId, { status: "pending", limit: 8 }),
    listAuditEvents(workspaceId, { eventType: "rollout_blocked", limit: 8 }),
    listPolicyPacks(workspaceId),
    listAuditEvents(workspaceId, { limit: 12 }),
    getPrivacySettings(workspaceId).catch(() => null),
    listCapabilities(workspaceId).then((items) => items.filter((item) => ["high", "critical"].includes(item.riskLevel)).slice(0, 8)),
    listFailureClusters(workspaceId, { status: "open", limit: 8 }).then((items) => items.filter((item) => item.severity === "critical")),
  ]);
  return {
    openIncidents,
    pendingApprovals,
    recentBlockedRollouts,
    policyPacks,
    auditActivity,
    privacySettings,
    highRiskCapabilities,
    criticalClusters,
  };
}

export async function getRegressionSuitesForIncidentCreation(workspaceId: string, capabilityId: string | null) {
  if (!capabilityId) return [];
  const suites = await listRegressionSuites(workspaceId, capabilityId);
  return await Promise.all(suites.map(async (suite) => ({
    ...suite,
    caseCount: suite.caseCount ?? (await listRegressionCases(workspaceId, suite.id)).length,
  })));
}
