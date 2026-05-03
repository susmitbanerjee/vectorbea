import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listCapabilities, listVersions } from "@/lib/server/ai-capabilities";
import { computeReleaseGate } from "@/lib/server/evidence-runs";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const systems = await listCapabilities(workspaceId);
    const rows = [];

    for (const system of systems) {
      const versions = await listVersions(workspaceId, system.id);
      for (const version of versions) {
        const gate = await computeReleaseGate(workspaceId, version.id);
        rows.push({
          versionId: version.id,
          aiSystemId: system.id,
          systemName: system.name,
          systemType: system.type,
          versionNumber: version.versionNumber,
          versionStatus: version.status,
          environment: "production",
          riskLevel: system.riskLevel,
          decision: gate.decision,
          checks: gate.checks,
          reasons: gate.reasons,
          evaluatedAt: gate.evaluatedAt,
        });
      }
    }

    return NextResponse.json(rows);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load release gates");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
