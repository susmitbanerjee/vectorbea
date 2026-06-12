import { createHash, randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toAgentView(agent: {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  last_heartbeat: string | null;
  created_at: string | null;
}) {
  return {
    id: agent.id,
    workspaceId: agent.workspace_id,
    name: agent.name,
    status: agent.status,
    lastHeartbeat: agent.last_heartbeat,
    createdAt: agent.created_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("deployment_agents")
      .select("id, workspace_id, name, status, last_heartbeat, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to load deployment agents: ${error.message}`);
    }

    return NextResponse.json((data ?? []).map(toAgentView));
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load deployment agents.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      workspaceId?: string;
      name?: string;
    };
    const workspaceId = payload.workspaceId?.trim();
    const name = payload.name?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: "Agent name is required." }, { status: 400 });
    }

    const token = `vbagent_${randomBytes(24).toString("hex")}`;
    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("deployment_agents")
      .insert({
        workspace_id: workspaceId,
        name,
        status: "offline",
        api_token: token,
      })
      .select("id, workspace_id, name, status, last_heartbeat, created_at")
      .single();

    if (error || !data) {
      throw new Error(`Failed to register agent: ${error?.message ?? "Unknown error"}`);
    }

    // Also register an api_keys entry so the sidecar can authenticate immediately.
    const keyHash = createHash("sha256").update(token).digest("hex");
    const keyLastFour = token.slice(-4);
    const { error: keyError } = await supabase
      .from("api_keys")
      .insert({
        workspace_id: workspaceId,
        key_name: name,
        key_hash: keyHash,
        key_last_four: keyLastFour,
        key_role: "admin",
      });
    if (keyError) {
      console.warn(`[agents] api_keys insert failed for agent "${name}": ${keyError.message}`);
    }

    return NextResponse.json(
      {
        agent: toAgentView(data),
        token,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to register deployment agent.",
      },
      { status: 500 },
    );
  }
}
