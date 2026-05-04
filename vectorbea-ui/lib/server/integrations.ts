import "server-only";

import { writeAuditEvent } from "@/lib/server/audit-events";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntegrationType =
  | "sidecar" | "opentelemetry" | "sdk" | "direct_api" | "llm_provider"
  | "mcp_server" | "rag_pipeline" | "classification_system" | "extraction_system"
  | "skill_runtime" | "ci_cd" | "manual_upload" | "langgraph" | "custom_webhook";

export type IntegrationStatus = "not_configured" | "configured" | "connected" | "disabled" | "error";
export type IntegrationHealth = "healthy" | "degraded" | "failing" | "unknown";
export type EvidenceSourceEventType =
  | "agent_run" | "llm_call" | "tool_call" | "mcp_tool_call" | "rag_retrieval"
  | "rag_answer" | "classification_result" | "extraction_result" | "skill_execution"
  | "prompt_execution" | "ci_evidence" | "manual_evidence" | "provider_usage"
  | "policy_check_result" | "workflow_trace";

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  integrationType: IntegrationType;
  name: string;
  description: string | null;
  status: IntegrationStatus;
  healthStatus: IntegrationHealth;
  lastSeenAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  config: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  // derived
  eventsLast24h?: number;
}

export interface EvidenceSourceEvent {
  id: string;
  workspaceId: string;
  integrationConnectionId: string | null;
  sourceType: string;
  sourceId: string | null;
  aiSystemId: string | null;
  aiSystemVersionId: string | null;
  eventType: EvidenceSourceEventType;
  status: "received" | "normalized" | "validated" | "failed" | "ignored";
  payload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  createdAt: string;
}

export interface DiscoveredAiSystem {
  id: string;
  workspaceId: string;
  suggestedName: string;
  sourceType: string;
  serviceName: string | null;
  provider: string | null;
  model: string | null;
  environment: string | null;
  toolsDetected: string[];
  mcpServersDetected: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  status: "pending" | "linked" | "registered" | "ignored";
  linkedAiSystemId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CoverageEntry {
  aiSystemId: string;
  aiSystemName: string;
  riskLevel: string | null;
  coverageStatus: "fully_monitored" | "partially_monitored" | "no_evidence" | "stale";
  lastEvidenceAt: string | null;
  sourceTypes: string[];
  eventsLast24h: number;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapConnection(row: Record<string, unknown>): IntegrationConnection {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    integrationType: row.integration_type as IntegrationType,
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    status: row.status as IntegrationStatus,
    healthStatus: row.health_status as IntegrationHealth,
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
    lastSuccessAt: (row.last_success_at as string | null) ?? null,
    lastErrorAt: (row.last_error_at as string | null) ?? null,
    lastErrorMessage: (row.last_error_message as string | null) ?? null,
    config: (row.config as Record<string, unknown>) ?? {},
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    disabledAt: (row.disabled_at as string | null) ?? null,
  };
}

function mapDiscovered(row: Record<string, unknown>): DiscoveredAiSystem {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    suggestedName: String(row.suggested_name),
    sourceType: String(row.source_type),
    serviceName: (row.service_name as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    environment: (row.environment as string | null) ?? null,
    toolsDetected: (row.tools_detected as string[]) ?? [],
    mcpServersDetected: (row.mcp_servers_detected as string[]) ?? [],
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    seenCount: Number(row.seen_count),
    status: row.status as DiscoveredAiSystem["status"],
    linkedAiSystemId: (row.linked_ai_system_id as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ─── Integration CRUD ─────────────────────────────────────────────────────────

export async function listIntegrations(workspaceId: string): Promise<IntegrationConnection[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => mapConnection(r as Record<string, unknown>));
}

export async function getIntegration(workspaceId: string, id: string): Promise<IntegrationConnection | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return mapConnection(data as Record<string, unknown>);
}

export async function createIntegration(args: {
  workspaceId: string;
  integrationType: IntegrationType;
  name: string;
  description?: string | null;
  config?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<IntegrationConnection> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .insert({
      workspace_id: args.workspaceId,
      integration_type: args.integrationType,
      name: args.name,
      description: args.description ?? null,
      status: "configured",
      health_status: "unknown",
      config: args.config ?? {},
      created_by: args.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const conn = mapConnection(data as Record<string, unknown>);
  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.createdBy ?? null,
    eventType: "integration_created",
    entityType: "integration_connection",
    entityId: conn.id,
    entityName: conn.name,
    metadata: { integration_type: args.integrationType },
  });
  return conn;
}

export async function updateIntegration(args: {
  workspaceId: string;
  id: string;
  name?: string;
  description?: string | null;
  status?: IntegrationStatus;
  healthStatus?: IntegrationHealth;
  lastSeenAt?: string | null;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMessage?: string | null;
  config?: Record<string, unknown>;
  disabledAt?: string | null;
}): Promise<IntegrationConnection> {
  const supabase = createVectorBeaAdminClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.name !== undefined) patch.name = args.name;
  if (args.description !== undefined) patch.description = args.description;
  if (args.status !== undefined) patch.status = args.status;
  if (args.healthStatus !== undefined) patch.health_status = args.healthStatus;
  if (args.lastSeenAt !== undefined) patch.last_seen_at = args.lastSeenAt;
  if (args.lastSuccessAt !== undefined) patch.last_success_at = args.lastSuccessAt;
  if (args.lastErrorAt !== undefined) patch.last_error_at = args.lastErrorAt;
  if (args.lastErrorMessage !== undefined) patch.last_error_message = args.lastErrorMessage;
  if (args.config !== undefined) patch.config = args.config;
  if (args.disabledAt !== undefined) patch.disabled_at = args.disabledAt;

  const { data, error } = await supabase
    .from("integration_connections")
    .update(patch)
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapConnection(data as Record<string, unknown>);
}

// ─── Evidence source event recording ──────────────────────────────────────────

export async function recordEvidenceSourceEvent(args: {
  workspaceId: string;
  integrationConnectionId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  aiSystemId?: string | null;
  aiSystemVersionId?: string | null;
  eventType: EvidenceSourceEventType;
  payload: Record<string, unknown>;
  normalizedPayload?: Record<string, unknown>;
}): Promise<string> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("evidence_source_events")
    .insert({
      workspace_id: args.workspaceId,
      integration_connection_id: args.integrationConnectionId ?? null,
      source_type: args.sourceType,
      source_id: args.sourceId ?? null,
      ai_system_id: args.aiSystemId ?? null,
      ai_system_version_id: args.aiSystemVersionId ?? null,
      event_type: args.eventType,
      status: "received",
      payload: args.payload,
      normalized_payload: args.normalizedPayload ?? {},
    })
    .select("id")
    .single();
  if (error) {
    if (!error.message.toLowerCase().includes("does not exist")) {
      console.error("[integrations] failed to record evidence_source_event:", error.message);
    }
    return "";
  }
  return String((data as Record<string, unknown>).id);
}

// ─── AI System resolution ─────────────────────────────────────────────────────

export async function resolveAiSystem(workspaceId: string, meta: {
  aiSystemId?: string | null;
  capabilityId?: string | null;
  aiSystemName?: string | null;
  serviceName?: string | null;
  agentName?: string | null;
  skillName?: string | null;
  workflowName?: string | null;
}): Promise<{ id: string; name: string; versionId?: string | null } | null> {
  const supabase = createVectorBeaAdminClient();

  // 1. Exact ai_system_id
  const directId = meta.aiSystemId ?? meta.capabilityId;
  if (directId) {
    const { data } = await supabase
      .from("ai_capabilities")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("id", directId)
      .maybeSingle();
    if (data) return { id: String((data as Record<string, unknown>).id), name: String((data as Record<string, unknown>).name) };
  }

  // 2. Name match (ai_system_name, agent_name, skill_name, workflow_name)
  const candidateNames = [meta.aiSystemName, meta.agentName, meta.skillName, meta.workflowName].filter(Boolean) as string[];
  for (const candidateName of candidateNames) {
    const { data } = await supabase
      .from("ai_capabilities")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .ilike("name", candidateName)
      .maybeSingle();
    if (data) return { id: String((data as Record<string, unknown>).id), name: String((data as Record<string, unknown>).name) };
  }

  // 3. Alias match
  const allCandidates = [meta.serviceName, ...candidateNames].filter(Boolean) as string[];
  for (const candidate of allCandidates) {
    const { data } = await supabase
      .from("ai_system_aliases")
      .select("ai_system_id, ai_capabilities!inner(id, name)")
      .eq("workspace_id", workspaceId)
      .ilike("alias", candidate)
      .maybeSingle();
    if (data) {
      const row = data as Record<string, unknown>;
      const cap = row["ai_capabilities"] as Record<string, unknown> | null;
      if (cap) return { id: String(cap.id), name: String(cap.name) };
    }
  }

  return null;
}

// ─── Discovered AI systems ────────────────────────────────────────────────────

export async function upsertDiscoveredAiSystem(args: {
  workspaceId: string;
  suggestedName: string;
  sourceType: string;
  serviceName?: string | null;
  provider?: string | null;
  model?: string | null;
  environment?: string | null;
  toolsDetected?: string[];
  mcpServersDetected?: string[];
  metadata?: Record<string, unknown>;
}): Promise<DiscoveredAiSystem> {
  const supabase = createVectorBeaAdminClient();
  const now = new Date().toISOString();

  // Try to find existing by workspace + suggested_name + source_type
  const { data: existing } = await supabase
    .from("discovered_ai_systems")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("suggested_name", args.suggestedName)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    const row = existing as Record<string, unknown>;
    const { data: updated, error } = await supabase
      .from("discovered_ai_systems")
      .update({
        last_seen_at: now,
        seen_count: Number(row.seen_count ?? 0) + 1,
        provider: args.provider ?? row.provider,
        model: args.model ?? row.model,
        environment: args.environment ?? row.environment,
        updated_at: now,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error || !updated) return mapDiscovered(row);
    return mapDiscovered(updated as Record<string, unknown>);
  }

  const { data, error } = await supabase
    .from("discovered_ai_systems")
    .insert({
      workspace_id: args.workspaceId,
      suggested_name: args.suggestedName,
      source_type: args.sourceType,
      service_name: args.serviceName ?? null,
      provider: args.provider ?? null,
      model: args.model ?? null,
      environment: args.environment ?? null,
      tools_detected: args.toolsDetected ?? [],
      mcp_servers_detected: args.mcpServersDetected ?? [],
      metadata: args.metadata ?? {},
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    eventType: "ai_system_discovered",
    entityType: "discovered_ai_system",
    entityId: String((data as Record<string, unknown>).id),
    entityName: args.suggestedName,
    metadata: { source_type: args.sourceType, service_name: args.serviceName ?? null },
  });

  return mapDiscovered(data as Record<string, unknown>);
}

export async function listDiscoveredSystems(
  workspaceId: string,
  opts?: { status?: string; limit?: number },
): Promise<DiscoveredAiSystem[]> {
  const supabase = createVectorBeaAdminClient();
  let query = supabase
    .from("discovered_ai_systems")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_seen_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => mapDiscovered(r as Record<string, unknown>));
}

export async function linkDiscoveredSystem(args: {
  workspaceId: string;
  discoveredId: string;
  aiSystemId: string;
  actorUserId?: string | null;
}): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const disc = await supabase
    .from("discovered_ai_systems")
    .select("suggested_name, source_type")
    .eq("id", args.discoveredId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  await supabase
    .from("discovered_ai_systems")
    .update({ status: "linked", linked_ai_system_id: args.aiSystemId, updated_at: new Date().toISOString() })
    .eq("id", args.discoveredId)
    .eq("workspace_id", args.workspaceId);

  // Create alias for future resolution
  if (disc.data) {
    const row = disc.data as Record<string, unknown>;
    await supabase
      .from("ai_system_aliases")
      .upsert({
        workspace_id: args.workspaceId,
        ai_system_id: args.aiSystemId,
        alias: String(row.suggested_name),
        source_type: String(row.source_type),
      }, { onConflict: "workspace_id,alias" });
  }

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId ?? null,
    eventType: "discovered_system_linked",
    entityType: "discovered_ai_system",
    entityId: args.discoveredId,
    metadata: { ai_system_id: args.aiSystemId },
  });
}

export async function registerDiscoveredSystem(args: {
  workspaceId: string;
  discoveredId: string;
  actorUserId?: string | null;
  riskLevel?: string;
  name?: string;
}): Promise<{ id: string; name: string }> {
  const supabase = createVectorBeaAdminClient();
  const { data: disc } = await supabase
    .from("discovered_ai_systems")
    .select("*")
    .eq("id", args.discoveredId)
    .eq("workspace_id", args.workspaceId)
    .single();
  if (!disc) throw new Error("Discovered system not found");
  const row = disc as Record<string, unknown>;
  const name = args.name ?? String(row.suggested_name);

  const { data: cap, error: capErr } = await supabase
    .from("ai_capabilities")
    .insert({
      workspace_id: args.workspaceId,
      name,
      description: `Auto-registered from discovered AI activity (${String(row.source_type)})`,
      type: "agent",
      business_domain: "general",
      risk_level: args.riskLevel ?? "medium",
      data_sensitivity: "internal",
      status: "draft",
      created_by: args.actorUserId ?? null,
    })
    .select("id, name")
    .single();
  if (capErr || !cap) throw new Error(capErr?.message ?? "Failed to create AI system");
  const capRow = cap as Record<string, unknown>;

  await supabase
    .from("discovered_ai_systems")
    .update({ status: "registered", linked_ai_system_id: capRow.id, updated_at: new Date().toISOString() })
    .eq("id", args.discoveredId);

  await supabase
    .from("ai_system_aliases")
    .upsert({
      workspace_id: args.workspaceId,
      ai_system_id: capRow.id,
      alias: String(row.suggested_name),
      source_type: String(row.source_type),
    }, { onConflict: "workspace_id,alias" });

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId ?? null,
    eventType: "discovered_system_registered",
    entityType: "ai_system",
    entityId: String(capRow.id),
    entityName: String(capRow.name),
    metadata: { discovered_id: args.discoveredId },
  });

  return { id: String(capRow.id), name: String(capRow.name) };
}

export async function ignoreDiscoveredSystem(args: {
  workspaceId: string;
  discoveredId: string;
}): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  await supabase
    .from("discovered_ai_systems")
    .update({ status: "ignored", updated_at: new Date().toISOString() })
    .eq("id", args.discoveredId)
    .eq("workspace_id", args.workspaceId);
}

// ─── Coverage calculation ─────────────────────────────────────────────────────

const STALE_HOURS = 48;

export async function getIntegrationCoverage(workspaceId: string): Promise<CoverageEntry[]> {
  const supabase = createVectorBeaAdminClient();
  const staleThreshold = new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString();
  const last24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // Get all registered AI systems
  const { data: systems, error: sysErr } = await supabase
    .from("ai_capabilities")
    .select("id, name, risk_level")
    .eq("workspace_id", workspaceId)
    .neq("status", "archived")
    .order("name");
  if (sysErr) {
    if (sysErr.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(sysErr.message);
  }
  if (!systems?.length) return [];

  // Get recent evidence events per AI system
  const { data: events } = await supabase
    .from("evidence_source_events")
    .select("ai_system_id, source_type, created_at")
    .eq("workspace_id", workspaceId)
    .in("ai_system_id", systems.map((s) => (s as Record<string, unknown>).id as string))
    .order("created_at", { ascending: false });

  const eventsPerSystem = new Map<string, { sourceTypes: Set<string>; lastAt: string; last24h: number }>();
  for (const ev of (events ?? [])) {
    const row = ev as Record<string, unknown>;
    const sid = String(row.ai_system_id ?? "");
    if (!sid) continue;
    const existing = eventsPerSystem.get(sid) ?? { sourceTypes: new Set<string>(), lastAt: "", last24h: 0 };
    existing.sourceTypes.add(String(row.source_type));
    if (!existing.lastAt || String(row.created_at) > existing.lastAt) existing.lastAt = String(row.created_at);
    if (String(row.created_at) >= last24h) existing.last24h++;
    eventsPerSystem.set(sid, existing);
  }

  return (systems as Record<string, unknown>[]).map((s): CoverageEntry => {
    const sid = String(s.id);
    const ev = eventsPerSystem.get(sid);
    let coverageStatus: CoverageEntry["coverageStatus"];
    if (!ev) {
      coverageStatus = "no_evidence";
    } else if (ev.lastAt < staleThreshold) {
      coverageStatus = "stale";
    } else if (ev.sourceTypes.size >= 2) {
      coverageStatus = "fully_monitored";
    } else {
      coverageStatus = "partially_monitored";
    }
    return {
      aiSystemId: sid,
      aiSystemName: String(s.name),
      riskLevel: (s.risk_level as string | null) ?? null,
      coverageStatus,
      lastEvidenceAt: ev?.lastAt ?? null,
      sourceTypes: ev ? [...ev.sourceTypes] : [],
      eventsLast24h: ev?.last24h ?? 0,
    };
  });
}

// ─── Overview stats ────────────────────────────────────────────────────────────

export async function getIntegrationOverviewStats(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();
  const last24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [connsRes, eventsRes, discoveredRes] = await Promise.all([
    supabase.from("integration_connections").select("status, health_status").eq("workspace_id", workspaceId),
    supabase.from("evidence_source_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", last24h),
    supabase.from("discovered_ai_systems").select("status").eq("workspace_id", workspaceId),
  ]);

  const conns = (connsRes.data ?? []) as Record<string, unknown>[];
  const totalEvents24h = eventsRes.count ?? 0;
  const discovered = (discoveredRes.data ?? []) as Record<string, unknown>[];

  return {
    connected: conns.filter((c) => c.status === "connected").length,
    configured: conns.filter((c) => c.status === "configured").length,
    notConfigured: conns.filter((c) => c.status === "not_configured").length,
    disabled: conns.filter((c) => c.status === "disabled").length,
    error: conns.filter((c) => c.status === "error").length,
    healthy: conns.filter((c) => c.health_status === "healthy").length,
    degraded: conns.filter((c) => c.health_status === "degraded").length,
    failing: conns.filter((c) => c.health_status === "failing").length,
    totalEvents24h,
    discoveredPending: discovered.filter((d) => d.status === "pending").length,
    totalConnections: conns.length,
  };
}

// ─── Update connection health from ingest ─────────────────────────────────────

export async function touchIntegrationConnection(args: {
  workspaceId: string;
  integrationType: IntegrationType;
  success: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const now = new Date().toISOString();

  // Find or create a connection for this type
  const { data: existing } = await supabase
    .from("integration_connections")
    .select("id, status")
    .eq("workspace_id", args.workspaceId)
    .eq("integration_type", args.integrationType)
    .eq("status", "connected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const row = existing as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      last_seen_at: now,
      updated_at: now,
      health_status: args.success ? "healthy" : "degraded",
      status: "connected",
    };
    if (args.success) patch.last_success_at = now;
    else { patch.last_error_at = now; patch.last_error_message = args.errorMessage ?? null; }
    await supabase.from("integration_connections").update(patch).eq("id", row.id);
  } else {
    // No connection row yet — auto-create one on first successful ingest.
    // This means the dashboard shows the integration as soon as data arrives,
    // without requiring manual configuration.
    const insert: Record<string, unknown> = {
      workspace_id: args.workspaceId,
      integration_type: args.integrationType,
      status: "connected",
      health_status: args.success ? "healthy" : "degraded",
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    };
    if (args.success) insert.last_success_at = now;
    else { insert.last_error_at = now; insert.last_error_message = args.errorMessage ?? null; }
    await supabase.from("integration_connections").insert(insert);
  }
}
