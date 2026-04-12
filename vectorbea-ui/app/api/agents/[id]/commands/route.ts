import { NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
    };
    const workspaceId = payload.workspaceId?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { data: agent, error: agentError } = await supabase
      .from("deployment_agents")
      .select("id, workspace_id, name")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (agentError || !agent) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("agent_commands")
      .insert({
        agent_id: agent.id,
        command_type: "SYNC_RULES",
        payload: {
          requestedAt: new Date().toISOString(),
          source: "infrastructure-dashboard",
        },
        status: "pending",
      })
      .select("id, command_type, payload, status, created_at")
      .single();

    if (error || !data) {
      throw new Error(`Failed to enqueue agent command: ${error?.message ?? "Unknown error"}`);
    }

    return NextResponse.json(
      {
        command: {
          id: data.id,
          type: data.command_type,
          payload: data.payload,
          status: data.status,
          createdAt: data.created_at,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to enqueue agent command." },
      { status: 500 },
    );
  }
}
