import { type NextRequest, NextResponse } from "next/server";

import {
  badRequest,
  handleServiceError,
  ok,
} from "@/server/api-response";
import { getMockSession } from "@/server/auth/mock-session";
import { archiveAgentJob, getAgentJob, updateAgentJob } from "@/server/services/agent-jobs";
import { UpdateAgentJobSchema, formatZodErrors } from "@/server/validation/agent-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── GET /api/agent-jobs/:id ──────────────────────────────────────────────────

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const session = await getMockSession();
    const { id } = await params;

    const result = await getAgentJob(session.organizationId, id);
    return ok(result);
  } catch (error) {
    return handleServiceError(error, "Failed to fetch agent job.");
  }
}

// ─── PATCH /api/agent-jobs/:id ────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await getMockSession();
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON.");
    }

    const parsed = UpdateAgentJobSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          errors: formatZodErrors(parsed.error.issues),
        },
        { status: 422 },
      );
    }

    if (Object.keys(parsed.data).length === 0) {
      return badRequest("Request body must include at least one field to update.");
    }

    const job = await updateAgentJob(session.organizationId, session.userId, id, parsed.data);
    return ok({ job });
  } catch (error) {
    return handleServiceError(error, "Failed to update agent job.");
  }
}

// ─── DELETE /api/agent-jobs/:id ───────────────────────────────────────────────
// Soft-deletes by setting status = ARCHIVED. No data is destroyed.

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const session = await getMockSession();
    const { id } = await params;

    const result = await archiveAgentJob(session.organizationId, session.userId, id);
    return ok(result);
  } catch (error) {
    return handleServiceError(error, "Failed to archive agent job.");
  }
}
