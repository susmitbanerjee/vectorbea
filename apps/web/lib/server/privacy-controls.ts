import "server-only";

import type { PrivacySettings, RedactionRule } from "@/lib/api";
import { writeAuditEvent } from "@/lib/server/audit-events";
import { createBuiltInRedactionRules, redactObjectWithRules, redactStringWithRules } from "@/lib/server/security";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

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
