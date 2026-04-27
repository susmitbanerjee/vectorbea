import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { encryptSecret, decryptSecret } from "@/lib/server/slack";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const supabase = createVectorBeaAdminClient();
    const { data } = await supabase
      .from("workspace_integrations")
      .select("slack_enabled, slack_events, slack_webhook_encrypted")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    // Always return a valid shape — even if the table is missing or row doesn't exist
    return NextResponse.json({
      configured: !!data?.slack_webhook_encrypted,
      enabled: data?.slack_enabled ?? false,
      events: data?.slack_events ?? {},
      webhookMasked: data?.slack_webhook_encrypted ? "https://hooks.slack.com/services/***" : null,
    });
  } catch {
    // Table may not exist yet — return safe empty config
    return NextResponse.json({ configured: false, enabled: false, events: {}, webhookMasked: null });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = await request.json() as {
      webhookUrl?: string;
      enabled?: boolean;
      events?: Record<string, boolean>;
    };

    const supabase = createVectorBeaAdminClient();

    // Get current record
    const { data: current } = await supabase
      .from("workspace_integrations")
      .select("slack_webhook_encrypted, slack_events")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const updates: Record<string, unknown> = {
      workspace_id: workspaceId,
      updated_at: new Date().toISOString(),
    };

    if (typeof body.enabled === "boolean") updates.slack_enabled = body.enabled;
    if (body.events) updates.slack_events = body.events;

    if (body.webhookUrl) {
      if (!body.webhookUrl.startsWith("https://hooks.slack.com/")) {
        return NextResponse.json({ error: "Invalid Slack webhook URL" }, { status: 400 });
      }
      updates.slack_webhook_encrypted = await encryptSecret(body.webhookUrl);
    } else if (current?.slack_webhook_encrypted) {
      updates.slack_webhook_encrypted = current.slack_webhook_encrypted;
    }

    await supabase
      .from("workspace_integrations")
      .upsert(updates, { onConflict: "workspace_id" });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update Slack integration");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
