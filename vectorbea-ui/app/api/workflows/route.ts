import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getDiscoveryReview, listDiscoverySessions } from "@/lib/server/workflow-discovery";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ items: [] });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const sessions = await listDiscoverySessions(workspaceId);
    const items = [];
    for (const session of sessions) {
      const review = await getDiscoveryReview(workspaceId, session.id);
      if (!review) continue;
      for (const workflow of review.workflows) {
        items.push({
          ...workflow,
          session,
          capability: review.capabilities.find((capability) => capability.suggestedName === workflow.capabilityName) ?? null,
        });
      }
    }
    return NextResponse.json({ items });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load workflows");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
