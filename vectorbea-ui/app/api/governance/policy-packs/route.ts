import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { canUsePolicyPacksFeature } from "@/lib/server/feature-gates";
import { listPolicyPacks } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ items: [], canApply: false, locked: true });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // Preview is intentionally broader than apply. Free and Plus can inspect
    // system policy packs, while Pro and Enterprise can apply them.
    const gate = await canUsePolicyPacksFeature(workspaceId);
    return NextResponse.json({
      items: await listPolicyPacks(workspaceId),
      canApply: gate.allowed,
      locked: !gate.allowed,
      planTier: gate.planTier,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load policy packs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
