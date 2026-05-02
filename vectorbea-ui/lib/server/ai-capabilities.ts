import "server-only";

import type {
  AiCapability,
  AiCapabilityType,
  BusinessDomain,
  CapabilityVersion,
  CapabilityVersionStatus,
  ReliabilityRiskLevel,
} from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ─── Row types ────────────────────────────────────────────────────────────────

type CapabilityRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  type: string;
  business_domain: string;
  risk_level: string;
  owner_user_id: string | null;
  status: string;
  prompt_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type VersionRow = {
  id: string;
  workspace_id: string;
  capability_id: string;
  version_number: string;
  name: string | null;
  status: string;
  config: Record<string, unknown> | null;
  prompt_version_id: string | null;
  skill_definition: Record<string, unknown> | null;
  workflow_definition: Record<string, unknown> | null;
  provider_config: Record<string, unknown> | null;
  tool_policy_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  deprecated_at: string | null;
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapCapability(row: CapabilityRow): AiCapability {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    type: row.type as AiCapabilityType,
    businessDomain: row.business_domain as BusinessDomain,
    riskLevel: row.risk_level as ReliabilityRiskLevel,
    ownerUserId: row.owner_user_id,
    status: row.status as "active" | "archived",
    promptId: row.prompt_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function mapVersion(row: VersionRow): CapabilityVersion {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    capabilityId: row.capability_id,
    versionNumber: row.version_number,
    name: row.name,
    status: row.status as CapabilityVersionStatus,
    config: row.config ?? {},
    promptVersionId: row.prompt_version_id,
    skillDefinition: row.skill_definition,
    workflowDefinition: row.workflow_definition,
    providerConfig: row.provider_config,
    toolPolicyId: row.tool_policy_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
    deprecatedAt: row.deprecated_at,
  };
}

// ─── Capability CRUD ──────────────────────────────────────────────────────────

export async function listCapabilities(workspaceId: string): Promise<AiCapability[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("ai_capabilities")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as CapabilityRow[];

  // Enrich with active version counts
  const enriched = await Promise.all(
    rows.map(async (row) => {
      const cap = mapCapability(row);
      const [versionsRes, activeRes] = await Promise.all([
        supabase.from("capability_versions").select("id", { count: "exact", head: true }).eq("capability_id", row.id),
        supabase.from("capability_versions").select("*").eq("capability_id", row.id).eq("status", "active").maybeSingle(),
      ]);
      cap.versionCount = versionsRes.count ?? 0;
      cap.activeVersion = activeRes.data ? mapVersion(activeRes.data as VersionRow) : null;
      return cap;
    }),
  );
  return enriched;
}

export async function getCapability(workspaceId: string, id: string): Promise<AiCapability | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("ai_capabilities")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const cap = mapCapability(data as CapabilityRow);

  const [versionsRes, activeRes] = await Promise.all([
    supabase.from("capability_versions").select("id", { count: "exact", head: true }).eq("capability_id", id),
    supabase.from("capability_versions").select("*").eq("capability_id", id).eq("status", "active").maybeSingle(),
  ]);
  cap.versionCount = versionsRes.count ?? 0;
  cap.activeVersion = activeRes.data ? mapVersion(activeRes.data as VersionRow) : null;
  return cap;
}

export async function createCapability(args: {
  workspaceId: string;
  name: string;
  description?: string | null;
  type: AiCapabilityType;
  businessDomain: BusinessDomain;
  riskLevel: ReliabilityRiskLevel;
  ownerUserId?: string | null;
  promptId?: string | null;
  createdBy: string;
}): Promise<AiCapability> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("ai_capabilities")
    .insert({
      workspace_id: args.workspaceId,
      name: args.name,
      description: args.description ?? null,
      type: args.type,
      business_domain: args.businessDomain,
      risk_level: args.riskLevel,
      owner_user_id: args.ownerUserId ?? null,
      prompt_id: args.promptId ?? null,
      created_by: args.createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapCapability(data as CapabilityRow);
}

export async function updateCapability(
  workspaceId: string,
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    type: AiCapabilityType;
    businessDomain: BusinessDomain;
    riskLevel: ReliabilityRiskLevel;
    ownerUserId: string | null;
    status: "active" | "archived";
  }>,
): Promise<AiCapability> {
  const supabase = createVectorBeaAdminClient();
  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.type !== undefined) dbPatch.type = patch.type;
  if (patch.businessDomain !== undefined) dbPatch.business_domain = patch.businessDomain;
  if (patch.riskLevel !== undefined) dbPatch.risk_level = patch.riskLevel;
  if (patch.ownerUserId !== undefined) dbPatch.owner_user_id = patch.ownerUserId;
  if (patch.status !== undefined) {
    dbPatch.status = patch.status;
    if (patch.status === "archived") dbPatch.archived_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("ai_capabilities")
    .update(dbPatch)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapCapability(data as CapabilityRow);
}

// ─── Capability Version CRUD ──────────────────────────────────────────────────

export async function listVersions(workspaceId: string, capabilityId: string): Promise<CapabilityVersion[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("capability_versions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("capability_id", capabilityId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapVersion(row as VersionRow));
}

export async function getVersion(workspaceId: string, versionId: string): Promise<CapabilityVersion | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("capability_versions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapVersion(data as VersionRow) : null;
}

export async function createVersion(args: {
  workspaceId: string;
  capabilityId: string;
  versionNumber?: string;
  name?: string | null;
  status?: CapabilityVersionStatus;
  config?: Record<string, unknown>;
  description?: string | null;
  baseVersionId?: string | null;
  promptVersionId?: string | null;
  skillDefinition?: Record<string, unknown> | null;
  workflowDefinition?: Record<string, unknown> | null;
  providerConfig?: Record<string, unknown> | null;
  createdBy: string;
}): Promise<CapabilityVersion> {
  const supabase = createVectorBeaAdminClient();
  const { data: capability, error: capabilityError } = await supabase
    .from("ai_capabilities")
    .select("id, workspace_id, type, prompt_id")
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.capabilityId)
    .maybeSingle();

  if (capabilityError) throw new Error(capabilityError.message);
  if (!capability) throw new Error("Capability not found");

  let baseVersion: VersionRow | null = null;
  if (args.baseVersionId) {
    const { data: base, error: baseError } = await supabase
      .from("capability_versions")
      .select("*")
      .eq("workspace_id", args.workspaceId)
      .eq("capability_id", args.capabilityId)
      .eq("id", args.baseVersionId)
      .maybeSingle();
    if (baseError) throw new Error(baseError.message);
    if (!base) throw new Error("Base version not found");
    baseVersion = base as VersionRow;
  }

  const nextVersionNumber = args.versionNumber?.trim()
    ? args.versionNumber.trim()
    : await (async () => {
        const { data: versionRows, error: versionError } = await supabase
          .from("capability_versions")
          .select("version_number")
          .eq("workspace_id", args.workspaceId)
          .eq("capability_id", args.capabilityId);
        if (versionError) throw new Error(versionError.message);
        const max = (versionRows ?? []).reduce((highest, row) => {
          const raw = String((row as { version_number?: string }).version_number ?? "");
          const numeric = Number.parseInt(raw.replace(/^v/i, ""), 10);
          return Number.isFinite(numeric) ? Math.max(highest, numeric) : highest;
        }, 0);
        return `v${max + 1}`;
      })();

  const mergedConfig = {
    ...(baseVersion?.config ?? {}),
    ...(args.config ?? {}),
  };

  const { data, error } = await supabase
    .from("capability_versions")
    .insert({
      workspace_id: args.workspaceId,
      capability_id: args.capabilityId,
      version_number: nextVersionNumber,
      name: args.name ?? null,
      status: args.status ?? "draft",
      config: mergedConfig,
      prompt_version_id: args.promptVersionId ?? baseVersion?.prompt_version_id ?? null,
      skill_definition: args.skillDefinition ?? baseVersion?.skill_definition ?? null,
      workflow_definition: args.workflowDefinition ?? baseVersion?.workflow_definition ?? null,
      provider_config: args.providerConfig ?? baseVersion?.provider_config ?? null,
      created_by: args.createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapVersion(data as VersionRow);
}

export async function updateVersionStatus(
  workspaceId: string,
  versionId: string,
  status: CapabilityVersionStatus,
): Promise<CapabilityVersion> {
  const supabase = createVectorBeaAdminClient();
  const patch: Record<string, unknown> = { status };
  if (status === "active") patch.activated_at = new Date().toISOString();
  if (status === "deprecated") patch.deprecated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("capability_versions")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", versionId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapVersion(data as VersionRow);
}

// ─── Prompt → Capability compatibility bridge ────────────────────────────────
// Surfaces prompts as AI Capabilities without modifying prompt tables.

export async function listCapabilitiesIncludingPrompts(workspaceId: string): Promise<AiCapability[]> {
  const [nativeCaps, promptRows] = await Promise.all([
    listCapabilities(workspaceId),
    (async () => {
      const supabase = createVectorBeaAdminClient();
      const { data } = await supabase
        .from("prompts")
        .select("id, name, description, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(200);
      return (data ?? []) as Array<{ id: string; name: string; description: string | null; created_by: string; created_at: string; updated_at: string }>;
    })(),
  ]);

  const nativePromptIds = new Set(nativeCaps.filter((c) => c.promptId).map((c) => c.promptId!));
  const syntheticCaps: AiCapability[] = promptRows
    .filter((row) => !nativePromptIds.has(row.id))
    .map((row) => ({
      id: `prompt:${row.id}`,
      workspaceId,
      name: row.name,
      description: row.description,
      type: "prompt" as AiCapabilityType,
      businessDomain: "general" as BusinessDomain,
      riskLevel: "medium" as ReliabilityRiskLevel,
      ownerUserId: null,
      status: "active" as const,
      promptId: row.id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: null,
      versionCount: 0,
      activeVersion: null,
    }));

  return [...nativeCaps, ...syntheticCaps];
}
