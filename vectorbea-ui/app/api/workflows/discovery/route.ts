import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getDiscoveryReview, listDiscoverySessions } from "@/lib/server/workflow-discovery";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
    if (!workspaceId) return NextResponse.json({ items: [] });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    if (sessionId) {
      const review = await getDiscoveryReview(workspaceId, sessionId);
      if (!review) return NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
      return NextResponse.json(review);
    }

    const sessions = await listDiscoverySessions(workspaceId);
    return NextResponse.json({ items: sessions });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load workflow discovery");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
