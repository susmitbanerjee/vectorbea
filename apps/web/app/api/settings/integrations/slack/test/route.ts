import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { sendSlackDirect, sendSlackNotification } from "@/lib/server/slack";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = await request.json() as { webhookUrl?: string };

    const testPayload = {
      text: "🧪 VectorBea test notification — Slack integration is working!",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*🧪 VectorBea test notification*\nYour Slack integration is configured correctly. You will receive alerts, evaluation results, and rollout events here.",
          },
        },
      ],
    };

    let result;
    if (body.webhookUrl) {
      // Test with explicitly provided URL (during setup, before saving)
      if (!body.webhookUrl.startsWith("https://hooks.slack.com/")) {
        return NextResponse.json({ error: "Invalid Slack webhook URL" }, { status: 400 });
      }
      result = await sendSlackDirect(body.webhookUrl, testPayload);
    } else {
      // Test using stored webhook
      result = await sendSlackNotification(workspaceId, testPayload);
    }

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to send test notification");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
