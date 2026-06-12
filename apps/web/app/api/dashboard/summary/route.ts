import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import type { DashboardSummary } from "@/lib/api";
import { computeReleaseGate } from "@/lib/server/evidence-runs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({
        totalApiCallsLast24h: 0,
        auditsThisMonth: 0,
        averageLatencyMs: 0,
        activeAgents: 0,
      } as DashboardSummary);
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const supabase = createVectorBeaAdminClient();

    const [{ data: systems }, { data: assignments }, { data: requiredEvidence }, { data: evidenceRuns }, { data: approvals }, { data: incidents }, { data: versions }] = await Promise.all([
      supabase
        .from("ai_capabilities")
        .select("id, risk_level")
        .eq("workspace_id", workspaceId),
      supabase
        .from("capability_policy_pack_assignments")
        .select("capability_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      supabase
        .from("ai_system_required_evidence")
        .select("ai_system_id, evidence_type")
        .eq("workspace_id", workspaceId),
      supabase
        .from("capability_evidence_runs")
        .select("ai_system_id, evidence_type, status, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      supabase.from("approval_requests").select("id").eq("workspace_id", workspaceId).eq("status", "pending"),
      supabase.from("ai_incidents").select("id").eq("workspace_id", workspaceId).in("status", ["open", "investigating", "fix_in_progress", "verification_pending"]),
      supabase.from("capability_versions").select("id").eq("workspace_id", workspaceId),
    ]);

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

    return NextResponse.json({
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
    } as DashboardSummary);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load dashboard summary" },
      { status: 500 },
    );
  }
}
