import "server-only";

import type {
  CapabilityEvidenceRun,
  EvidenceRunStatus,
  EvidenceType,
  ReleaseGateCheck,
  ReleaseGateResult,
  ReleaseGateStatus,
} from "@/lib/api";
import { writeAuditEvent } from "@/lib/server/audit-events";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ─── Row type ─────────────────────────────────────────────────────────────────

type EvidenceRunRow = {
  id: string;
  workspace_id: string;
  ai_system_id: string;
  ai_system_version_id: string | null;
  evidence_type: string;
  status: string;
  blocking: boolean;
  policy_pack_id: string | null;
  underlying_run_id: string | null;
  underlying_run_type: string | null;
  result_score: number | null;
  result_summary: string | null;
  failure_reason: string | null;
  result_metadata: Record<string, unknown> | null;
  started_by: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Mapper ───────────────────────────────────────────────────────────────────

function mapRun(row: EvidenceRunRow): CapabilityEvidenceRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    aiSystemId: row.ai_system_id,
    aiSystemVersionId: row.ai_system_version_id,
    evidenceType: row.evidence_type as EvidenceType,
    status: row.status as EvidenceRunStatus,
    blocking: row.blocking,
    policyPackId: row.policy_pack_id,
    underlyingRunId: row.underlying_run_id,
    underlyingRunType: row.underlying_run_type,
    resultScore: row.result_score,
    resultSummary: row.result_summary,
    failureReason: row.failure_reason,
    resultMetadata: row.result_metadata ?? {},
    startedBy: row.started_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listEvidenceRuns(
  workspaceId: string,
  opts?: {
    aiSystemId?: string;
    aiSystemVersionId?: string;
    evidenceType?: EvidenceType;
    status?: EvidenceRunStatus;
    limit?: number;
  },
): Promise<CapabilityEvidenceRun[]> {
  const supabase = createVectorBeaAdminClient();
  let query = supabase
    .from("capability_evidence_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (opts?.aiSystemId) query = query.eq("ai_system_id", opts.aiSystemId);
  if (opts?.aiSystemVersionId) query = query.eq("ai_system_version_id", opts.aiSystemVersionId);
  if (opts?.evidenceType) query = query.eq("evidence_type", opts.evidenceType);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query;
  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }

  const runs = (data ?? []).map((row) => mapRun(row as EvidenceRunRow));

  // Enrich with names
  const systemIds = [...new Set(runs.map((r) => r.aiSystemId))];
  const versionIds = [...new Set(runs.map((r) => r.aiSystemVersionId).filter(Boolean))] as string[];
  const packIds = [...new Set(runs.map((r) => r.policyPackId).filter(Boolean))] as string[];

  const [systemsRes, versionsRes, packsRes] = await Promise.all([
    systemIds.length > 0
      ? supabase.from("ai_capabilities").select("id, name").in("id", systemIds)
      : { data: [] },
    versionIds.length > 0
      ? supabase.from("capability_versions").select("id, version_number").in("id", versionIds)
      : { data: [] },
    packIds.length > 0
      ? supabase.from("policy_packs").select("id, name").in("id", packIds)
      : { data: [] },
  ]);

  const sysMap = new Map((systemsRes.data ?? []).map((r) => [String(r.id), String(r.name)]));
  const verMap = new Map((versionsRes.data ?? []).map((r) => [String(r.id), String(r.version_number)]));
  const pkMap  = new Map((packsRes.data ?? []).map((r) => [String(r.id), String(r.name)]));

  return runs.map((run) => ({
    ...run,
    aiSystemName: sysMap.get(run.aiSystemId) ?? null,
    aiSystemVersionNumber: run.aiSystemVersionId ? verMap.get(run.aiSystemVersionId) ?? null : null,
    policyPackName: run.policyPackId ? pkMap.get(run.policyPackId) ?? null : null,
  }));
}

export async function getEvidenceRun(
  workspaceId: string,
  id: string,
): Promise<CapabilityEvidenceRun | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("capability_evidence_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const run = mapRun(data as EvidenceRunRow);

  // Enrich names
  const [sysRes, verRes, pkRes] = await Promise.all([
    supabase.from("ai_capabilities").select("name").eq("id", run.aiSystemId).maybeSingle(),
    run.aiSystemVersionId
      ? supabase.from("capability_versions").select("version_number").eq("id", run.aiSystemVersionId).maybeSingle()
      : Promise.resolve({ data: null }),
    run.policyPackId
      ? supabase.from("policy_packs").select("name").eq("id", run.policyPackId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    ...run,
    aiSystemName: (sysRes.data as { name?: string } | null)?.name ?? null,
    aiSystemVersionNumber: (verRes.data as { version_number?: string } | null)?.version_number ?? null,
    policyPackName: (pkRes.data as { name?: string } | null)?.name ?? null,
  };
}

export async function createEvidenceRun(args: {
  workspaceId: string;
  aiSystemId: string;
  aiSystemVersionId?: string | null;
  evidenceType: EvidenceType;
  blocking?: boolean;
  policyPackId?: string | null;
  underlyingRunId?: string | null;
  underlyingRunType?: string | null;
  startedBy: string;
}): Promise<CapabilityEvidenceRun> {
  const supabase = createVectorBeaAdminClient();

  // For human_approval: create an ApprovalRequest and link it
  let underlyingRunId = args.underlyingRunId ?? null;
  let underlyingRunType = args.underlyingRunType ?? null;

  if (args.evidenceType === "human_approval") {
    // Check if there's already a pending approval request for this version
    if (args.aiSystemVersionId) {
      const existingRes = await supabase
        .from("approval_requests")
        .select("id")
        .eq("workspace_id", args.workspaceId)
        .eq("capability_version_id", args.aiSystemVersionId)
        .eq("request_type", "rollout_approval")
        .eq("status", "pending")
        .maybeSingle();

      if (existingRes.data) {
        underlyingRunId = String(existingRes.data.id);
        underlyingRunType = "approval_request";
      } else {
        const insertRes = await supabase
          .from("approval_requests")
          .insert({
            workspace_id: args.workspaceId,
            capability_id: args.aiSystemId,
            capability_version_id: args.aiSystemVersionId,
            request_type: "rollout_approval",
            requested_by: args.startedBy,
            required_approvals: 1,
          })
          .select("id")
          .single();
        if (!insertRes.error && insertRes.data) {
          underlyingRunId = String(insertRes.data.id);
          underlyingRunType = "approval_request";
          await writeAuditEvent({
            workspaceId: args.workspaceId,
            actorUserId: args.startedBy,
            eventType: "approval_requested",
            entityType: "approval_request",
            entityId: underlyingRunId,
            metadata: {
              ai_system_id: args.aiSystemId,
              ai_system_version_id: args.aiSystemVersionId,
              evidence_type: args.evidenceType,
            },
          });
        }
      }
    }
  }

  const { data, error } = await supabase
    .from("capability_evidence_runs")
    .insert({
      workspace_id: args.workspaceId,
      ai_system_id: args.aiSystemId,
      ai_system_version_id: args.aiSystemVersionId ?? null,
      evidence_type: args.evidenceType,
      status: args.evidenceType === "human_approval" ? "needs_review" : "queued",
      blocking: args.blocking ?? true,
      policy_pack_id: args.policyPackId ?? null,
      underlying_run_id: underlyingRunId,
      underlying_run_type: underlyingRunType,
      started_by: args.startedBy,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.startedBy,
    eventType: "evidence_run_started",
    entityType: "capability_evidence_run",
    entityId: String(data.id),
    metadata: {
      ai_system_id: args.aiSystemId,
      ai_system_version_id: args.aiSystemVersionId ?? null,
      evidence_type: args.evidenceType,
    },
  });

  return mapRun(data as EvidenceRunRow);
}

export async function updateEvidenceRunStatus(
  workspaceId: string,
  id: string,
  status: EvidenceRunStatus,
  result?: {
    resultScore?: number | null;
    resultSummary?: string | null;
    failureReason?: string | null;
    resultMetadata?: Record<string, unknown>;
  },
): Promise<CapabilityEvidenceRun> {
  const supabase = createVectorBeaAdminClient();
  const patch: Record<string, unknown> = { status };
  if (status !== "queued" && status !== "running") {
    patch.completed_at = new Date().toISOString();
  }
  if (result?.resultScore !== undefined) patch.result_score = result.resultScore;
  if (result?.resultSummary !== undefined) patch.result_summary = result.resultSummary;
  if (result?.failureReason !== undefined) patch.failure_reason = result.failureReason;
  if (result?.resultMetadata !== undefined) patch.result_metadata = result.resultMetadata;

  const { data, error } = await supabase
    .from("capability_evidence_runs")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const eventType = status === "passed" ? "evidence_run_completed"
    : status === "failed" ? "evidence_run_failed"
    : "evidence_run_updated";

  await writeAuditEvent({
    workspaceId,
    eventType,
    entityType: "capability_evidence_run",
    entityId: id,
    metadata: { status, evidence_type: (data as EvidenceRunRow).evidence_type },
  });

  return mapRun(data as EvidenceRunRow);
}

// ─── Release Gate computation ─────────────────────────────────────────────────

export async function computeReleaseGate(
  workspaceId: string,
  versionId: string,
): Promise<ReleaseGateResult> {
  const supabase = createVectorBeaAdminClient();

  // 1. Get version + system info
  const verRes = await supabase
    .from("capability_versions")
    .select("id, capability_id, version_number, status")
    .eq("workspace_id", workspaceId)
    .eq("id", versionId)
    .maybeSingle();
  if (verRes.error) throw new Error(verRes.error.message);
  if (!verRes.data) throw new Error("Version not found");

  const version = verRes.data as { id: string; capability_id: string; version_number: string; status: string };
  const aiSystemId = version.capability_id;

  // 2. Get system (risk level, status)
  const sysRes = await supabase
    .from("ai_capabilities")
    .select("id, name, risk_level, status")
    .eq("workspace_id", workspaceId)
    .eq("id", aiSystemId)
    .maybeSingle();
  if (sysRes.error) throw new Error(sysRes.error.message);
  const system = sysRes.data as { id: string; name: string; risk_level: string; status: string } | null;
  const riskLevel = system?.risk_level ?? "medium";

  // 3. Get required evidence from policy assignments
  const [assignmentsRes, evidenceRunsRes, incidentsRes, approvalRes] = await Promise.all([
    supabase
      .from("capability_policy_pack_assignments")
      .select("policy_pack_id")
      .eq("workspace_id", workspaceId)
      .eq("capability_id", aiSystemId)
      .eq("status", "active"),
    supabase
      .from("capability_evidence_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("ai_system_version_id", versionId)
      .order("created_at", { ascending: false }),
    supabase
      .from("ai_incidents")
      .select("id, severity, status")
      .eq("workspace_id", workspaceId)
      .eq("capability_id", aiSystemId)
      .eq("status", "open")
      .in("severity", ["critical"]),
    supabase
      .from("approval_requests")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .eq("capability_version_id", versionId)
      .eq("request_type", "rollout_approval")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const packIds = (assignmentsRes.data ?? []).map((r) => String(r.policy_pack_id));

  // Get required evidence from all assigned packs
  let requiredEvidenceItems: Array<{
    evidenceType: EvidenceType;
    label: string;
    blocking: boolean;
    required: boolean;
    policyPackId: string;
    policyPackName: string;
  }> = [];

  if (packIds.length > 0) {
    const { data: packs } = await supabase
      .from("policy_packs")
      .select("id, name, required_evidence, approval_requirements")
      .in("id", packIds);

    for (const pack of packs ?? []) {
      const reqs = Array.isArray(pack.required_evidence) ? pack.required_evidence : [];
      for (const req of reqs as Array<Record<string, unknown>>) {
        requiredEvidenceItems.push({
          evidenceType: req.evidenceType as EvidenceType,
          label: (req.label as string) ?? String(req.evidenceType),
          blocking: req.blocking !== false,
          required: req.required !== false,
          policyPackId: String(pack.id),
          policyPackName: String(pack.name),
        });
      }

      // Check if approval required from pack config
      const approvalReqs = (pack.approval_requirements ?? {}) as Record<string, unknown>;
      if (approvalReqs.requiresApproval && !requiredEvidenceItems.some((r) => r.evidenceType === "human_approval")) {
        requiredEvidenceItems.push({
          evidenceType: "human_approval",
          label: "Human approval required",
          blocking: true,
          required: true,
          policyPackId: String(pack.id),
          policyPackName: String(pack.name),
        });
      }
    }
  }

  // High/critical risk always requires human approval
  if (["high", "critical"].includes(riskLevel) && !requiredEvidenceItems.some((r) => r.evidenceType === "human_approval")) {
    requiredEvidenceItems.push({
      evidenceType: "human_approval",
      label: "High-risk system approval",
      blocking: true,
      required: true,
      policyPackId: "",
      policyPackName: "Risk policy",
    });
  }

  // 4. Build latest evidence run map: evidenceType → latest run
  const runsData = (evidenceRunsRes.data ?? []) as EvidenceRunRow[];
  const latestRunByType = new Map<EvidenceType, EvidenceRunRow>();
  for (const run of runsData) {
    const et = run.evidence_type as EvidenceType;
    if (!latestRunByType.has(et)) latestRunByType.set(et, run);
  }

  // 5. For human_approval: check approval request status
  const latestApproval = (approvalRes.data ?? [])[0] as { id: string; status: string } | undefined;

  // 6. Build gate checks
  const checks: ReleaseGateCheck[] = [];
  const reasons: string[] = [];

  // Policy check
  if (packIds.length === 0) {
    checks.push({
      label: "Policy assigned",
      evidenceType: "policy_check" as EvidenceType,
      status: "missing",
      blocking: false,
      detail: "No policy pack assigned to this AI system",
      evidenceRunId: null,
      approvalRequestId: null,
    });
    reasons.push("No policy pack assigned");
  } else {
    checks.push({
      label: "Policy assigned",
      evidenceType: "policy_check" as EvidenceType,
      status: "pass",
      blocking: false,
      detail: `${packIds.length} policy pack${packIds.length !== 1 ? "s" : ""} assigned`,
      evidenceRunId: null,
      approvalRequestId: null,
    });
  }

  // Evidence checks
  for (const req of requiredEvidenceItems) {
    if (req.evidenceType === "human_approval") {
      // Special handling for approval
      let checkStatus: ReleaseGateCheck["status"] = "missing";
      let detail = "Approval request not created";
      let approvalRequestId: string | null = null;

      if (latestApproval) {
        approvalRequestId = latestApproval.id;
        if (latestApproval.status === "approved") {
          checkStatus = "pass";
          detail = "Approval granted";
        } else if (latestApproval.status === "rejected") {
          checkStatus = "fail";
          detail = "Approval rejected";
          if (req.blocking) reasons.push("Release approval was rejected");
        } else if (latestApproval.status === "pending") {
          checkStatus = "pending";
          detail = "Awaiting reviewer approval";
          if (req.blocking) reasons.push("Awaiting human approval");
        } else {
          checkStatus = "missing";
          detail = "Approval request cancelled — please re-request";
          if (req.blocking) reasons.push("Human approval required");
        }
      } else {
        // Check evidence run for human_approval
        const evidenceRun = latestRunByType.get("human_approval");
        if (evidenceRun) {
          approvalRequestId = evidenceRun.underlying_run_id;
          if (evidenceRun.status === "passed") { checkStatus = "pass"; detail = "Approval granted"; }
          else if (evidenceRun.status === "failed") {
            checkStatus = "fail"; detail = "Approval rejected";
            if (req.blocking) reasons.push("Release approval was rejected");
          }
          else { checkStatus = "pending"; detail = "Awaiting reviewer approval"; if (req.blocking) reasons.push("Awaiting human approval"); }
        } else {
          if (req.blocking) reasons.push(`Human approval required (from ${req.policyPackName})`);
        }
      }

      checks.push({
        label: req.label,
        evidenceType: "human_approval",
        status: checkStatus,
        blocking: req.blocking,
        detail,
        evidenceRunId: latestRunByType.get("human_approval")?.id ?? null,
        approvalRequestId,
      });
    } else {
      const latestRun = latestRunByType.get(req.evidenceType);
      let checkStatus: ReleaseGateCheck["status"] = "missing";
      let detail: string | null = null;
      let evidenceRunId: string | null = null;

      if (latestRun) {
        evidenceRunId = latestRun.id;
        if (latestRun.status === "passed") {
          checkStatus = "pass";
          detail = latestRun.result_summary ?? "Check passed";
        } else if (latestRun.status === "failed") {
          checkStatus = "fail";
          detail = latestRun.failure_reason ?? latestRun.result_summary ?? "Check failed";
          if (req.blocking) reasons.push(`${req.label} failed${latestRun.failure_reason ? `: ${latestRun.failure_reason}` : ""}`);
        } else if (latestRun.status === "needs_review") {
          checkStatus = "pending";
          detail = "Awaiting review";
          if (req.blocking) reasons.push(`${req.label} needs review`);
        } else if (latestRun.status === "running" || latestRun.status === "queued") {
          checkStatus = "pending";
          detail = latestRun.status === "running" ? "Running…" : "Queued";
          if (req.blocking) reasons.push(`${req.label} is running`);
        } else {
          checkStatus = "missing";
          detail = "No passing run found";
          if (req.blocking) reasons.push(`${req.label} required but not passed`);
        }
      } else {
        detail = `Missing: required by ${req.policyPackName}`;
        if (req.blocking) reasons.push(`Missing ${req.label} (${req.policyPackName})`);
      }

      checks.push({
        label: req.label,
        evidenceType: req.evidenceType,
        status: checkStatus,
        blocking: req.blocking,
        detail,
        evidenceRunId,
        approvalRequestId: null,
      });
    }
  }

  // Critical incidents check
  const criticalIncidents = incidentsRes.data ?? [];
  if (criticalIncidents.length > 0) {
    checks.push({
      label: "No critical incidents",
      evidenceType: "incident_check" as EvidenceType,
      status: "fail",
      blocking: true,
      detail: `${criticalIncidents.length} unresolved critical incident${criticalIncidents.length > 1 ? "s" : ""}`,
      evidenceRunId: null,
      approvalRequestId: null,
    });
    reasons.push(`${criticalIncidents.length} unresolved critical incident${criticalIncidents.length > 1 ? "s" : ""}`);
  }

  // 7. Compute decision
  const hasBlockingFail = checks.some((c) => c.blocking && c.status === "fail");
  const hasBlockingMissing = checks.some((c) => c.blocking && c.status === "missing");
  const hasBlockingPending = checks.some((c) => c.blocking && c.status === "pending");
  const allClear = checks.every((c) => !c.blocking || c.status === "pass");

  let decision: ReleaseGateStatus;
  if (hasBlockingFail) {
    decision = "blocked";
  } else if (hasBlockingMissing) {
    decision = "missing_evidence";
  } else if (hasBlockingPending) {
    decision = "needs_review";
  } else if (allClear) {
    decision = "safe_to_release";
  } else {
    decision = "needs_review";
  }

  return {
    versionId,
    aiSystemId,
    decision,
    reasons,
    checks,
    evaluatedAt: new Date().toISOString(),
  };
}

// ─── Gate-checked version activation ─────────────────────────────────────────

export async function activateVersionWithGateCheck(args: {
  workspaceId: string;
  versionId: string;
  actorUserId: string;
}): Promise<{ ok: true; version: Record<string, unknown> } | { ok: false; decision: ReleaseGateStatus; reasons: string[] }> {
  const gate = await computeReleaseGate(args.workspaceId, args.versionId);

  if (gate.decision !== "safe_to_release") {
    return { ok: false, decision: gate.decision, reasons: gate.reasons };
  }

  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("capability_versions")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.versionId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    eventType: "version_activated",
    entityType: "capability_version",
    entityId: args.versionId,
    metadata: {
      ai_system_id: gate.aiSystemId,
      gate_decision: gate.decision,
    },
  });

  return { ok: true, version: data as Record<string, unknown> };
}
