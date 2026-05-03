import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getIntegration, updateIntegration } from "@/lib/server/integrations";
import { writeAuditEvent } from "@/lib/server/audit-events";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const conn = await getIntegration(workspaceId, id);
    if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Integration-type-specific test logic
    let testResult: { ok: boolean; message: string } = { ok: false, message: "Test not implemented for this integration type" };

    switch (conn.integrationType) {
      case "sidecar":
      case "opentelemetry":
      case "sdk":
      case "direct_api": {
        // For trace-based integrations: check if there's been a recent event
        const recentAt = conn.lastSeenAt ? new Date(conn.lastSeenAt).getTime() : 0;
        const age = Date.now() - recentAt;
        if (age < 5 * 60 * 1000) {
          testResult = { ok: true, message: `Last event received ${Math.round(age / 1000)}s ago` };
        } else if (conn.lastSeenAt) {
          testResult = { ok: false, message: `No events received recently. Last seen: ${new Date(conn.lastSeenAt).toLocaleString()}` };
        } else {
          testResult = { ok: false, message: "No events received yet. Send a test event to verify the connection." };
        }
        break;
      }
      case "llm_provider": {
        testResult = { ok: false, message: "Use the Providers settings page to test LLM provider connections." };
        break;
      }
      case "ci_cd": {
        testResult = { ok: false, message: "Send a test webhook to verify the CI/CD connection." };
        break;
      }
      case "manual_upload": {
        testResult = { ok: true, message: "Manual upload is always available. Upload a file to submit evidence." };
        break;
      }
      default: {
        // For trace-based integrations (mcp, rag, etc.) check last seen
        if (conn.lastSeenAt) {
          testResult = { ok: true, message: `Evidence received. Last event: ${new Date(conn.lastSeenAt).toLocaleString()}` };
        } else {
          testResult = { ok: false, message: "No evidence received yet. Send a trace with the correct metadata to verify." };
        }
      }
    }

    // Update health based on test result
    await updateIntegration({
      workspaceId,
      id,
      healthStatus: testResult.ok ? "healthy" : "degraded",
    });

    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "integration_tested",
      entityType: "integration_connection",
      entityId: id,
      entityName: conn.name,
      metadata: { ok: testResult.ok, message: testResult.message },
    });

    return NextResponse.json(testResult);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to test integration");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
