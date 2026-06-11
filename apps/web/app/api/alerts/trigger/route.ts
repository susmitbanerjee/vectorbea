import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listAlertRules } from "@/lib/server/alerts";
import { sendEmail } from "@/lib/server/email";
import { alertTriggeredEmail } from "@/lib/server/email-templates";
import { createSupabaseAdminClient, createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/alerts/trigger?workspaceId=...
 * Body: { ruleId: string; promptName?: string }
 *
 * Manually fires the notification for a specific alert rule without waiting
 * for metric evaluation. Used for testing and manual override.
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({})) as { ruleId?: string; promptName?: string };
    if (!body.ruleId) return NextResponse.json({ error: "ruleId required" }, { status: 400 });

    const rules = await listAlertRules(workspaceId);
    const rule = rules.find((r) => r.id === body.ruleId);
    if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    // Get workspace name
    const supabase = createVectorBeaAdminClient();
    const { data: ws } = await supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
    const workspaceName = ws?.name ?? workspaceId;

    // Get recipient emails directly — bypass the notification dispatcher so we can return errors
    const adminClient = createSupabaseAdminClient();
    const { data: members, error: membersError } = await supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId);

    if (membersError) {
      console.error("[alerts/trigger] workspace_members query error:", membersError.message);
    }
    console.log(`[alerts/trigger] workspace_members found: ${members?.length ?? 0}`, members?.map(m => ({ user_id: m.user_id, role: m.role })));

    const emails: string[] = [];
    for (const m of members ?? []) {
      const { data, error: userError } = await adminClient.auth.admin.getUserById(m.user_id as string);
      if (userError) {
        console.error("[alerts/trigger] getUserById failed for", m.user_id, userError.message);
        continue;
      }
      if (data?.user?.email) {
        emails.push(data.user.email);
      } else {
        console.warn("[alerts/trigger] No email for user", m.user_id);
      }
    }

    if (emails.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No recipient emails found. Check Vercel logs for details.",
        debug: { workspaceId, membersFound: members?.length ?? 0, membersError: membersError?.message ?? null },
      }, { status: 422 });
    }

    const alertsUrl = `${process.env.APP_URL ?? "https://app.vectorbea.app"}/alerts?org=${encodeURIComponent(workspaceId)}`;
    const tmpl = alertTriggeredEmail({
      workspaceName,
      ruleName: rule.name,
      metricType: rule.metricType,
      metricValue: rule.threshold,
      threshold: rule.threshold,
      comparison: rule.comparison,
      alertsUrl,
    });

    const results = await Promise.all(emails.map((to) => sendEmail({ ...tmpl, to })));
    const allOk = results.every((r) => r.ok);
    const errors = results.filter((r) => !r.ok).map((r) => r.error);

    return NextResponse.json({
      ok: allOk,
      ruleName: rule.name,
      recipients: emails,
      emailResults: results,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to trigger alert");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
