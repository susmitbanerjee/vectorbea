import { NextRequest, NextResponse } from "next/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";

/**
 * Required table schema for trace_issue_flags:
 *
 * CREATE TABLE trace_issue_flags (
 *   id uuid PRIMARY KEY,
 *   workspace_id uuid NOT NULL,
 *   trace_id text NOT NULL,
 *   reason text,
 *   flagged_by uuid NOT NULL,
 *   flagged_at timestamptz NOT NULL,
 *   resolved boolean NOT NULL DEFAULT false,
 *   resolved_at timestamptz,
 *   resolved_by uuid
 * );
 */

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: traceId } = await params;
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;
  try {
    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("trace_issue_flags")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("trace_id", traceId)
      .eq("resolved", false)
      .order("flagged_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json(data ?? null);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: traceId } = await params;
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;
  try {
    const body = await request.json() as { reason?: string };
    const supabase = createVectorBeaAdminClient();
    // Resolve any existing flags for this trace first
    await supabase
      .from("trace_issue_flags")
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: authResult.user.id })
      .eq("workspace_id", workspaceId)
      .eq("trace_id", traceId)
      .eq("resolved", false);
    const { data, error } = await supabase
      .from("trace_issue_flags")
      .insert({
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        trace_id: traceId,
        reason: body.reason?.trim() ?? null,
        flagged_by: authResult.user.id,
        flagged_at: new Date().toISOString(),
        resolved: false,
        resolved_at: null,
        resolved_by: null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: traceId } = await params;
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;
  try {
    const supabase = createVectorBeaAdminClient();
    const { error } = await supabase
      .from("trace_issue_flags")
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: authResult.user.id })
      .eq("workspace_id", workspaceId)
      .eq("trace_id", traceId)
      .eq("resolved", false);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
