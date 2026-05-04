import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { linkDiscoveredSystem, registerDiscoveredSystem, ignoreDiscoveredSystem } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

// POST /api/integrations/discovered-systems/[id]
// Action can be in the JSON body OR the query string — body takes precedence.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      aiSystemId?: string;
      riskLevel?: string;
      name?: string;
      description?: string;
    };

    // Body action takes precedence over query param
    const action = body.action?.trim() || request.nextUrl.searchParams.get("action")?.trim();

    if (action === "link") {
      if (!body.aiSystemId) return NextResponse.json({ error: "aiSystemId required" }, { status: 400 });
      await linkDiscoveredSystem({ workspaceId, discoveredId: id, aiSystemId: body.aiSystemId, actorUserId: auth.user.id });
      return NextResponse.json({ ok: true });
    }

    if (action === "register") {
      const result = await registerDiscoveredSystem({
        workspaceId,
        discoveredId: id,
        actorUserId: auth.user.id,
        riskLevel: body.riskLevel,
        name: body.name,
        description: body.description,
      });
      return NextResponse.json(result, { status: 201 });
    }

    if (action === "ignore") {
      await ignoreDiscoveredSystem({ workspaceId, discoveredId: id });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action must be link, register, or ignore" }, { status: 400 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to process discovered system");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
