import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getIntegrationOverviewStats } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    return NextResponse.json(await getIntegrationOverviewStats(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load overview");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
