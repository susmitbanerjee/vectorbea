import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * DELETE /api/agents/:id?workspaceId=<uuid>
 *
 * Permanently removes a deployment agent and all its associated data
 * (agent_metrics, agent_commands) via ON DELETE CASCADE.
 *
 * Auth: the caller must be an authenticated member of the workspace that
 * owns the agent. An admin check is intentionally NOT required here because
 * workspace members can legitimately remove agents they registered themselves.
 * If stricter rules are needed in the future, swap the membership check for
 * an admin-only guard.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const agentId     = params.id?.trim();
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();

  if (!agentId) {
    return NextResponse.json({ error: "Agent ID is required." }, { status: 400 });
  }
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId query parameter is required." }, { status: 400 });
  }

  // ── 1. Authenticate + verify workspace membership ────────────────────────
  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;

  const supabase = createVectorBeaAdminClient();

  // ── 2. Confirm the agent belongs to the stated workspace ─────────────────
  // This prevents a member of workspace A from deleting an agent in workspace B
  // by guessing its UUID.
  const { data: agent, error: lookupError } = await supabase
    .from("deployment_agents")
    .select("id")
    .eq("id", agentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (lookupError) {
    console.error("[DELETE /api/agents/:id] lookup error:", lookupError.message);
    return NextResponse.json({ error: "Failed to verify agent ownership." }, { status: 500 });
  }

  if (!agent) {
    // Return 404 — don't confirm whether the agent exists in another workspace.
    return NextResponse.json(
      { error: "Agent not found in this workspace." },
      { status: 404 },
    );
  }

  // ── 3. Delete — cascades to agent_metrics and agent_commands ────────────
  const { error: deleteError } = await supabase
    .from("deployment_agents")
    .delete()
    .eq("id", agentId);

  if (deleteError) {
    console.error("[DELETE /api/agents/:id] delete error:", deleteError.message);
    return NextResponse.json(
      { error: `Failed to delete agent: ${deleteError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ deleted: true, agentId });
}
