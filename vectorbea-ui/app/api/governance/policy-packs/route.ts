import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { listPolicyPacks } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "policy_packs");
    return NextResponse.json(await listPolicyPacks(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load policy packs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
