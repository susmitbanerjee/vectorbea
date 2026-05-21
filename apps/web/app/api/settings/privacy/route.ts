import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { getPrivacySettings, listRedactionRules, updatePrivacySettings } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "privacy_controls");
    const [settings, rules] = await Promise.all([
      getPrivacySettings(workspaceId),
      listRedactionRules(workspaceId),
    ]);
    return NextResponse.json({ settings, rules });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load privacy settings");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "privacy_controls");
    const body = (await request.json().catch(() => ({}))) as {
      enablePiiRedaction?: boolean;
      storeRawInputs?: boolean;
      storeRawOutputs?: boolean;
      storeToolArguments?: boolean;
      storeToolResults?: boolean;
      retentionDays?: number | null;
    };
    return NextResponse.json(await updatePrivacySettings({
      workspaceId,
      actorUserId: auth.user.id,
      ...body,
    }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update privacy settings");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
