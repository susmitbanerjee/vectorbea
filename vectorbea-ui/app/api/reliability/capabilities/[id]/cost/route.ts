import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getCapabilityCostAnalytics } from "@/lib/server/roi-analytics";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const analytics = await getCapabilityCostAnalytics(workspaceId, id);
    return NextResponse.json(analytics);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load capability cost analytics");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
