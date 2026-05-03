import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listDiscoveredSystems } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const status = request.nextUrl.searchParams.get("status")?.trim() || undefined;
    return NextResponse.json(await listDiscoveredSystems(workspaceId, { status }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load discovered systems");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
