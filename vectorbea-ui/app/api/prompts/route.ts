import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type PromptListItem } from "@/lib/api";
import {
  getWorkspacePlanLimits,
  getWorkspacePromptCount,
} from "@/lib/server/workspace-limits";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.toString();
    const prompts = await apiFetch<PromptListItem[]>(`/api/prompts${query ? `?${query}` : ""}`);
    return NextResponse.json(prompts);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load prompts" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required." },
        { status: 400 },
      );
    }

    const planLimits = await getWorkspacePlanLimits(workspaceId);
    const promptCount = await getWorkspacePromptCount(workspaceId);
    const promptLimit = Math.max(planLimits.maxPrompts ?? 5, 5);

    if (planLimits.planTier === "free" && promptCount >= promptLimit) {
      return NextResponse.json(
        {
          error: `Free plan limit reached (${promptLimit} prompts). Please upgrade to the Team plan.`,
        },
        { status: 403 },
      );
    }

    const payload = await request.json();
    const response = await apiFetch("/api/prompts", {
      method: "POST",
      body: JSON.stringify(payload),
      workspaceId,
    });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create prompt" },
      { status: 500 },
    );
  }
}
