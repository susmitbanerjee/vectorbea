import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function getTimeFilter(timeRange: string): string {
  switch (timeRange) {
    case "24h":
      return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    case "90d":
      return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    default: // 7d
      return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
}

// Helper: group array by a key and count
function groupCount<T>(arr: T[], key: keyof T): Array<{ [k: string]: string | number }> {
  const map = new Map<string, number>();
  for (const item of arr) {
    const k = String(item[key] ?? "unknown");
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([k, count]) => ({ [String(key)]: k, count }));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const workspaceId = searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const timeRange = searchParams.get("time_range") ?? "7d";
    const since = getTimeFilter(timeRange);

    const supabase = createVectorBeaAdminClient();

    // ── Core tables (always exist) ────────────────────────────────────────────

    const [
      { data: systems },
      { data: integrations },
      { data: discoveredSystems },
    ] = await Promise.all([
      supabase
        .schema("vectorbea")
        .from("ai_capabilities")
        .select("id, name, type, risk_level, status, business_domain")
        .eq("workspace_id", workspaceId),
      supabase
        .schema("vectorbea")
        .from("integration_connections")
        .select("id, name, integration_type, status, health_status, last_seen_at")
        .eq("workspace_id", workspaceId),
      supabase
        .schema("vectorbea")
        .from("discovered_ai_systems")
        .select("id, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending"),
    ]);

    const allSystems = systems ?? [];
    const allIntegrations = integrations ?? [];

    // ── Evidence runs ─────────────────────────────────────────────────────────

    let evidenceRuns: Array<{ ai_system_id: string; evidence_type: string; status: string; blocking: boolean }> = [];
    try {
      const { data, error } = await supabase
        .schema("vectorbea")
        .from("capability_evidence_runs")
        .select("ai_system_id, evidence_type, status, blocking")
        .eq("workspace_id", workspaceId);
      if (error) {
        if (!error.message?.includes("does not exist")) throw error;
        console.warn("[governance] capability_evidence_runs not available:", error.message);
      } else {
        evidenceRuns = data ?? [];
      }
    } catch (e) {
      console.warn("[governance] evidence_runs query failed", e);
    }

    // Latest evidence run per system+type
    const latestRunMap = new Map<string, string>(); // key -> status
    for (const run of evidenceRuns) {
      const key = `${run.ai_system_id}:${run.evidence_type}`;
      if (!latestRunMap.has(key)) latestRunMap.set(key, run.status);
    }

    // ── Required evidence ─────────────────────────────────────────────────────

    let requiredEvidence: Array<{ id: string; ai_system_id: string; evidence_type: string; blocking: boolean; label: string; policy_pack_id: string | null }> = [];
    try {
      const { data, error } = await supabase
        .schema("vectorbea")
        .from("ai_system_required_evidence")
        .select("id, ai_system_id, evidence_type, blocking, label, policy_pack_id")
        .eq("workspace_id", workspaceId);
      if (error) {
        if (!error.message?.includes("does not exist")) throw error;
        console.warn("[governance] ai_system_required_evidence not available:", error.message);
      } else {
        requiredEvidence = data ?? [];
      }
    } catch (e) {
      console.warn("[governance] required_evidence query failed", e);
    }

    // ── Capability versions (for release gate data) ───────────────────────────

    let capabilityVersions: Array<{ id: string; capability_id: string; version_number: string; status: string }> = [];
    try {
      const { data, error } = await supabase
        .schema("vectorbea")
        .from("capability_versions")
        .select("id, capability_id, version_number, status")
        .eq("workspace_id", workspaceId);
      if (error) {
        if (!error.message?.includes("does not exist")) throw error;
        console.warn("[governance] capability_versions not available:", error.message);
      } else {
        capabilityVersions = data ?? [];
      }
    } catch (e) {
      console.warn("[governance] capability_versions query failed", e);
    }

    // ── Approval requests ─────────────────────────────────────────────────────

    let approvalRequests: Array<{ id: string; capability_id: string | null; capability_version_id: string | null; request_type: string; status: string; requested_by: string; created_at: string; reason: string | null }> = [];
    try {
      const { data, error } = await supabase
        .schema("vectorbea")
        .from("approval_requests")
        .select("id, capability_id, capability_version_id, request_type, status, requested_by, created_at, reason")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) {
        if (!error.message?.includes("does not exist")) throw error;
        console.warn("[governance] approval_requests not available:", error.message);
      } else {
        approvalRequests = data ?? [];
      }
    } catch (e) {
      console.warn("[governance] approval_requests query failed", e);
    }

    // ── Incidents ─────────────────────────────────────────────────────────────

    let incidents: Array<{ id: string; title: string; severity: string; capability_id: string | null; status: string; owner_user_id: string | null; updated_at: string }> = [];
    try {
      const { data, error } = await supabase
        .schema("vectorbea")
        .from("ai_incidents")
        .select("id, title, severity, capability_id, status, owner_user_id, updated_at")
        .eq("workspace_id", workspaceId)
        .in("status", ["open", "investigating", "fix_in_progress", "verification_pending"])
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) {
        if (!error.message?.includes("does not exist")) throw error;
        console.warn("[governance] ai_incidents not available:", error.message);
      } else {
        incidents = data ?? [];
      }
    } catch (e) {
      console.warn("[governance] incidents query failed", e);
    }

    // ── Audit events ──────────────────────────────────────────────────────────

    let auditEvents: Array<{ id: string; event_type: string; actor_user_id: string | null; entity_name: string | null; entity_type: string; created_at: string; metadata: Record<string, unknown> }> = [];
    try {
      const { data, error } = await supabase
        .schema("vectorbea")
        .from("audit_events")
        .select("id, event_type, actor_user_id, entity_name, entity_type, created_at, metadata")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) {
        if (!error.message?.includes("does not exist")) throw error;
        console.warn("[governance] audit_events not available:", error.message);
      } else {
        auditEvents = data ?? [];
      }
    } catch (e) {
      console.warn("[governance] audit_events query failed", e);
    }

    // ── Policy pack assignments ───────────────────────────────────────────────

    let assignments: Array<{ capability_id: string; status: string }> = [];
    try {
      const { data, error } = await supabase
        .schema("vectorbea")
        .from("capability_policy_pack_assignments")
        .select("capability_id, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active");
      if (error) {
        if (!error.message?.includes("does not exist")) throw error;
        console.warn("[governance] capability_policy_pack_assignments not available:", error.message);
      } else {
        assignments = data ?? [];
      }
    } catch (e) {
      console.warn("[governance] assignments query failed", e);
    }

    // ── Compute derived data ──────────────────────────────────────────────────

    const systemMap = new Map(allSystems.map((s) => [s.id, s]));
    const versionMap = new Map(capabilityVersions.map((v) => [v.id, v]));
    const assignedSystemIds = new Set(assignments.map((a) => a.capability_id));

    // Systems with no policy assigned
    const systemsWithNoPolicyCount = allSystems.filter((s) => !assignedSystemIds.has(s.id)).length;

    // Missing required evidence per system
    const systemsMissingEvidence = new Set<string>();
    const missingEvidenceItems: Array<{ id: string; capabilityName: string; evidenceType: string; isBlocking: boolean; policyName: string }> = [];

    for (const req of requiredEvidence) {
      const key = `${req.ai_system_id}:${req.evidence_type}`;
      const runStatus = latestRunMap.get(key);
      const isMissing = !runStatus || runStatus === "failed" || runStatus === "needs_review";
      if (isMissing) {
        systemsMissingEvidence.add(req.ai_system_id);
        const sys = systemMap.get(req.ai_system_id);
        if (req.blocking) {
          missingEvidenceItems.push({
            id: req.id,
            capabilityName: sys?.name ?? req.ai_system_id,
            evidenceType: req.evidence_type,
            isBlocking: req.blocking,
            policyName: req.policy_pack_id ?? "Policy",
          });
        }
      }
    }

    // Blocked versions (status = blocked)
    const blockedVersions = capabilityVersions.filter((v) => v.status === "blocked");
    const blockedSystemIds = new Set(blockedVersions.map((v) => v.capability_id));
    const blockedReleasesCount = blockedVersions.length;

    // Release gate status derived from version status
    const releaseGateStatusCounts = new Map<string, number>();
    for (const v of capabilityVersions) {
      const decision = v.status === "blocked" ? "blocked" : v.status === "approved" || v.status === "active" ? "approved" : "pending";
      releaseGateStatusCounts.set(decision, (releaseGateStatusCounts.get(decision) ?? 0) + 1);
    }
    const releaseGateStatus = Array.from(releaseGateStatusCounts.entries()).map(([decision, count]) => ({ decision, count }));

    // Governance readiness per system
    const readinessMap = new Map<string, string>();
    for (const s of allSystems) {
      const hasPolicy = assignedSystemIds.has(s.id);
      const missingEv = systemsMissingEvidence.has(s.id);
      const isBlocked = blockedSystemIds.has(s.id);

      if (!hasPolicy) {
        readinessMap.set(s.id, "No Policy");
      } else if (isBlocked) {
        readinessMap.set(s.id, "Blocked");
      } else if (missingEv) {
        readinessMap.set(s.id, "Missing Evidence");
      } else if (s.status === "under_review" || s.status === "draft") {
        readinessMap.set(s.id, "Needs Review");
      } else {
        readinessMap.set(s.id, "Ready");
      }
    }

    const readinessCounts = new Map<string, number>();
    for (const status of readinessMap.values()) {
      readinessCounts.set(status, (readinessCounts.get(status) ?? 0) + 1);
    }
    const total = allSystems.length || 1;
    const governanceReadiness = Array.from(readinessCounts.entries()).map(([status, count]) => ({
      status,
      count,
      pct: Math.round((count / total) * 100),
    }));

    // Risk distribution
    const riskDistribution = groupCount(allSystems, "risk_level").map((r) => ({
      risk_level: String(r.risk_level),
      count: Number(r.count),
    }));

    // Type distribution
    const typeDistribution = groupCount(allSystems, "type").map((r) => ({
      type: String(r.type),
      count: Number(r.count),
    }));

    // Evidence health from runs
    const evidenceHealthCounts = new Map<string, number>();
    for (const run of evidenceRuns) {
      evidenceHealthCounts.set(run.status, (evidenceHealthCounts.get(run.status) ?? 0) + 1);
    }
    const evidenceHealth = Array.from(evidenceHealthCounts.entries()).map(([status, count]) => ({ status, count }));

    // Evidence by type
    const evidenceByTypeCounts = new Map<string, number>();
    for (const run of evidenceRuns) {
      evidenceByTypeCounts.set(run.evidence_type, (evidenceByTypeCounts.get(run.evidence_type) ?? 0) + 1);
    }
    const evidenceByType = Array.from(evidenceByTypeCounts.entries()).map(([evidence_type, count]) => ({ evidence_type, count }));

    // Integration health
    const integrationHealth = allIntegrations.map((i) => ({
      id: i.id,
      name: i.name,
      integrationType: i.integration_type,
      status: i.status,
      healthStatus: i.health_status,
      lastSeenAt: i.last_seen_at,
    }));

    // Monitoring coverage from integrations
    const monitoringCoverage = [
      { status: "connected", count: allIntegrations.filter((i) => i.status === "connected").length },
      { status: "configured", count: allIntegrations.filter((i) => i.status === "configured").length },
      { status: "not_configured", count: allIntegrations.filter((i) => i.status === "not_configured").length },
      { status: "error", count: allIntegrations.filter((i) => i.status === "error").length },
    ].filter((r) => r.count > 0);

    // Recent release gates (recent versions with their decisions)
    const recentReleaseGates = capabilityVersions
      .slice(0, 10)
      .map((v) => {
        const sys = systemMap.get(v.capability_id);
        const decision = v.status === "blocked" ? "blocked" : v.status === "approved" || v.status === "active" ? "approved" : "pending";
        return {
          id: v.id,
          capabilityName: sys?.name ?? v.capability_id,
          versionNumber: v.version_number,
          decision,
          reason: v.status,
          updatedAt: "",
        };
      });

    // Approval requests enriched
    const pendingApprovalsEnriched = approvalRequests.map((a) => {
      const sys = a.capability_id ? systemMap.get(a.capability_id) : null;
      const ver = a.capability_version_id ? versionMap.get(a.capability_version_id) : null;
      return {
        id: a.id,
        type: a.request_type,
        capabilityName: sys?.name ?? (a.capability_id ?? "Unknown"),
        versionNumber: ver?.version_number ?? null,
        riskLevel: sys?.risk_level ?? null,
        requestedBy: a.requested_by,
        createdAt: a.created_at,
      };
    });

    // Incidents enriched
    const openIncidentsEnriched = incidents.map((i) => {
      const sys = i.capability_id ? systemMap.get(i.capability_id) : null;
      return {
        id: i.id,
        title: i.title,
        severity: i.severity,
        capabilityName: sys?.name ?? (i.capability_id ?? "Unknown"),
        status: i.status,
        ownerName: i.owner_user_id ?? "Unassigned",
        updatedAt: i.updated_at,
      };
    });

    // Audit events enriched
    const recentAuditEvents = auditEvents.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      actorName: e.actor_user_id ?? "System",
      entityName: e.entity_name ?? e.entity_type,
      entityType: e.entity_type,
      createdAt: e.created_at,
      metadata: e.metadata,
    }));

    // Policy violations — not in schema yet, return empty
    const policyViolationsBySeverity: Array<{ severity: string; count: number }> = [];
    const policyViolationsByType: Array<{ policy_type: string; count: number }> = [];
    const topOpenViolations: Array<{ id: string; capabilityName: string; policyName: string; severity: string; count: number; lastSeenAt: string; status: string }> = [];

    // ── Summary ───────────────────────────────────────────────────────────────

    const summary = {
      total_ai_systems: allSystems.length,
      high_risk_systems: allSystems.filter((s) => s.risk_level === "high" || s.risk_level === "critical").length,
      missing_required_evidence: systemsMissingEvidence.size,
      blocked_releases: blockedReleasesCount,
      pending_approvals: approvalRequests.length,
      open_incidents: incidents.length,
      runtime_policy_violations: 0, // no table yet
      unregistered_ai_activity: (discoveredSystems ?? []).length,
    };

    // ── Recommended actions ───────────────────────────────────────────────────

    const recommendedActions: Array<{ id: string; title: string; reason: string; count: number; cta: string; href: string }> = [];

    if (summary.missing_required_evidence > 0) {
      recommendedActions.push({
        id: "missing-evidence",
        title: "Collect missing required evidence",
        reason: `${summary.missing_required_evidence} AI system(s) are missing required evidence checks before they can be released.`,
        count: summary.missing_required_evidence,
        cta: "View Evidence",
        href: "/registry/systems",
      });
    }
    if (summary.blocked_releases > 0) {
      recommendedActions.push({
        id: "blocked-releases",
        title: "Resolve blocked releases",
        reason: `${summary.blocked_releases} version(s) are blocked from release and need remediation.`,
        count: summary.blocked_releases,
        cta: "View Releases",
        href: "/registry/systems",
      });
    }
    if (summary.pending_approvals > 0) {
      recommendedActions.push({
        id: "pending-approvals",
        title: "Review pending approvals",
        reason: `${summary.pending_approvals} approval request(s) are awaiting review.`,
        count: summary.pending_approvals,
        cta: "Review",
        href: "/governance/approvals",
      });
    }
    if (summary.open_incidents > 0) {
      recommendedActions.push({
        id: "open-incidents",
        title: "Investigate open incidents",
        reason: `${summary.open_incidents} incident(s) are open and need investigation.`,
        count: summary.open_incidents,
        cta: "View Incidents",
        href: "/incidents",
      });
    }
    if (summary.unregistered_ai_activity > 0) {
      recommendedActions.push({
        id: "unregistered-ai",
        title: "Register discovered AI systems",
        reason: `${summary.unregistered_ai_activity} AI system(s) were detected but not yet registered.`,
        count: summary.unregistered_ai_activity,
        cta: "Review",
        href: "/integrations/discovered",
      });
    }
    if (systemsWithNoPolicyCount > 0) {
      recommendedActions.push({
        id: "no-policy",
        title: "Assign policies to AI systems",
        reason: `${systemsWithNoPolicyCount} AI system(s) have no policy pack assigned.`,
        count: systemsWithNoPolicyCount,
        cta: "Assign Policy",
        href: "/governance/policies",
      });
    }

    return NextResponse.json({
      summary,
      governance_readiness: governanceReadiness,
      risk_distribution: riskDistribution,
      system_type_distribution: typeDistribution,
      evidence_health: evidenceHealth,
      evidence_by_type: evidenceByType,
      release_gate_status: releaseGateStatus,
      policy_violations_by_severity: policyViolationsBySeverity,
      policy_violations_by_type: policyViolationsByType,
      monitoring_coverage: monitoringCoverage,
      integration_health: integrationHealth,
      recent_release_gates: recentReleaseGates,
      top_missing_evidence: missingEvidenceItems.slice(0, 10),
      top_open_violations: topOpenViolations,
      pending_approvals: pendingApprovalsEnriched,
      open_incidents: openIncidentsEnriched,
      recent_audit_events: recentAuditEvents,
      recommended_actions: recommendedActions,
    });
  } catch (error) {
    console.error("[governance dashboard] error:", error);
    return NextResponse.json(
      { error: "Failed to load governance dashboard" },
      { status: 500 },
    );
  }
}
