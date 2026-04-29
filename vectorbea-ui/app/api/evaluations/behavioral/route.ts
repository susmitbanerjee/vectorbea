import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import {
  createBehavioralDataset,
  listBehavioralDatasets,
} from "@/lib/server/behavioral-datasets";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { BehavioralPromptType } from "@/lib/api";

export const dynamic = "force-dynamic";

const VALID_PROMPT_TYPES: BehavioralPromptType[] = [
  "customer_support", "rag_answer", "summarization",
  "classification", "extraction", "agent_workflow", "general",
];

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");
    return NextResponse.json(await listBehavioralDatasets(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load behavioral datasets");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const body = await request.json().catch(() => ({})) as {
      name?: string;
      description?: string | null;
      promptId?: string;
      promptType?: BehavioralPromptType;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!body.promptId?.trim()) {
      return NextResponse.json({ error: "promptId is required" }, { status: 400 });
    }

    const promptType: BehavioralPromptType = VALID_PROMPT_TYPES.includes(body.promptType as BehavioralPromptType)
      ? (body.promptType as BehavioralPromptType)
      : "general";

    const dataset = await createBehavioralDataset({
      workspaceId,
      promptId: body.promptId,
      name: body.name,
      description: body.description,
      promptType,
      createdBy: auth.user.id,
    });

    return NextResponse.json(dataset, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create behavioral dataset");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
