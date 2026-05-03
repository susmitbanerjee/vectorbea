import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getIntegration, updateIntegration, type IntegrationStatus } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const conn = await getIntegration(workspaceId, id);
    if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(conn);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load integration");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      status?: IntegrationStatus;
      config?: Record<string, unknown>;
    };
    return NextResponse.json(await updateIntegration({ workspaceId, id, ...body }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update integration");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
