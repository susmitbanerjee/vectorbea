import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const supabase = createVectorBeaAdminClient();

    // Derive required evidence: combine rows from ai_system_required_evidence table
    // plus synthesize from assigned policy packs' requiredEvidence JSON
    const [directRes, assignmentsRes, runsRes] = await Promise.all([
      supabase
        .from("ai_system_required_evidence")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("ai_system_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("capability_policy_pack_assignments")
        .select("policy_pack_id")
        .eq("workspace_id", workspaceId)
        .eq("capability_id", id)
        .eq("status", "active"),
      supabase
        .from("capability_evidence_runs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("ai_system_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (directRes.error && !directRes.error.message.includes("does not exist")) {
      throw new Error(directRes.error.message);
    }

    const latestRunByTypeAndPack = new Map<string, Record<string, unknown>>();
    for (const run of runsRes.data ?? []) {
      const key = `${run.evidence_type}:${run.policy_pack_id ?? ""}`;
      if (!latestRunByTypeAndPack.has(key)) latestRunByTypeAndPack.set(key, run as Record<string, unknown>);
      const typeKey = `${run.evidence_type}:`;
      if (!latestRunByTypeAndPack.has(typeKey)) latestRunByTypeAndPack.set(typeKey, run as Record<string, unknown>);
    }

    const withRunStatus = (item: Record<string, unknown>): Record<string, unknown> => {
      const run = latestRunByTypeAndPack.get(`${item.evidenceType}:${item.policyPackId ?? ""}`)
        ?? latestRunByTypeAndPack.get(`${item.evidenceType}:`);
      return {
        ...item,
        status: run?.status ?? "missing",
        latestEvidenceRunId: run?.id ?? null,
        latestEvidenceRunStatus: run?.status ?? null,
        latestEvidenceRunAt: run?.completed_at ?? run?.created_at ?? null,
      };
    };

    const directItems: Array<Record<string, unknown>> = (directRes.data ?? []).map((row: Record<string, unknown>) => withRunStatus({
      id: row.id,
      workspaceId,
      aiSystemId: id,
      policyPackId: row.policy_pack_id ?? null,
      policyPackName: null as string | null,
      evidenceType: row.evidence_type,
      label: row.label,
      description: row.description ?? null,
      required: row.required ?? true,
      blocking: row.blocking ?? true,
      threshold: row.threshold ?? null,
      createdAt: row.created_at,
    }));

    // Synthesize from policy packs
    const packIds = (assignmentsRes.data ?? []).map((r) => String(r.policy_pack_id));
    let policyItems: Array<Record<string, unknown>> = [];
    if (packIds.length > 0) {
      const { data: packs } = await supabase
        .from("policy_packs")
        .select("id, name, required_evidence")
        .in("id", packIds);
      for (const pack of packs ?? []) {
        const reqs = Array.isArray(pack.required_evidence) ? pack.required_evidence : [];
        for (const req of reqs as Array<Record<string, unknown>>) {
          // Only add if not already covered by a direct row for the same pack + evidenceType
          const alreadyCovered = directItems.some(
            (d) => d.policyPackId === String(pack.id) && d.evidenceType === req.evidenceType,
          );
          if (!alreadyCovered) {
            policyItems.push(withRunStatus({
              id: `synth:${pack.id}:${req.evidenceType}`,
              workspaceId,
              aiSystemId: id,
              policyPackId: String(pack.id),
              policyPackName: String(pack.name),
              evidenceType: req.evidenceType as string,
              label: (req.label as string) ?? String(req.evidenceType),
              description: (req.description as string | null) ?? null,
              required: req.required !== false,
              blocking: req.blocking !== false,
              threshold: (req.threshold as number | null) ?? null,
              createdAt: new Date().toISOString(),
            }));
          }
        }
      }
    }

    return NextResponse.json([...directItems, ...policyItems]);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load required evidence");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
