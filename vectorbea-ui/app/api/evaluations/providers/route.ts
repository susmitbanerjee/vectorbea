import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listEnabledProviders } from "@/lib/server/provider-keys";

export const dynamic = "force-dynamic";

/**
 * GET /api/evaluations/providers?workspaceId=...
 * Returns the list of enabled provider configs (no API keys) so the UI
 * can populate a multi-provider evaluation selector.
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([], { status: 200 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const providers = await listEnabledProviders(workspaceId);
    return NextResponse.json(
      providers.map((p) => ({
        id: p.id,
        providerType: p.provider_type,
        displayName: p.display_name,
        defaultModel: p.default_model,
      })),
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
