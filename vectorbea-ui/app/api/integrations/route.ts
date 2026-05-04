import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createIntegration, listIntegrations, type IntegrationType } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ connections: [] });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const typeParam = request.nextUrl.searchParams.get("type")?.trim() as IntegrationType | undefined;
    const connections = await listIntegrations(workspaceId, typeParam ? { integrationType: typeParam } : undefined);
    return NextResponse.json({ connections });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load integrations");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as {
      integrationType?: IntegrationType;
      name?: string;
      description?: string | null;
      config?: Record<string, unknown>;
    };
    if (!body.integrationType) return NextResponse.json({ error: "integrationType is required" }, { status: 400 });
    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    return NextResponse.json(
      await createIntegration({
        workspaceId,
        integrationType: body.integrationType,
        name: body.name.trim(),
        description: body.description ?? null,
        config: body.config ?? {},
        createdBy: auth.user.id,
      }),
      { status: 201 },
    );
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create integration");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
