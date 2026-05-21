import { type NextRequest, NextResponse } from "next/server";

import {
  badRequest,
  created,
  handleServiceError,
  ok,
} from "@/server/api-response";
import { getMockSession } from "@/server/auth/mock-session";
import { createAgentJob, listAgentJobs } from "@/server/services/agent-jobs";
import {
  CreateAgentJobSchema,
  ListAgentJobsQuerySchema,
  formatZodErrors,
} from "@/server/validation/agent-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/agent-jobs ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const session = await getMockSession();

    const rawQuery = {
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      triggerType: request.nextUrl.searchParams.get("triggerType") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      page: request.nextUrl.searchParams.get("page") ?? "1",
      pageSize: request.nextUrl.searchParams.get("pageSize") ?? "20",
    };

    const parsed = ListAgentJobsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return badRequest("Invalid query parameters", formatZodErrors(parsed.error.issues));
    }

    const result = await listAgentJobs(session.organizationId, parsed.data);
    return ok(result);
  } catch (error) {
    return handleServiceError(error, "Failed to list agent jobs.");
  }
}

// ─── POST /api/agent-jobs ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const session = await getMockSession();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON.");
    }

    const parsed = CreateAgentJobSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          errors: formatZodErrors(parsed.error.issues),
        },
        { status: 422 },
      );
    }

    const job = await createAgentJob(session.organizationId, session.userId, parsed.data);
    return created({ job });
  } catch (error) {
    return handleServiceError(error, "Failed to create agent job.");
  }
}
