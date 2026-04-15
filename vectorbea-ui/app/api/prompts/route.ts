import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type PromptListItem } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspacePlanLimits,
  getWorkspacePromptCount,
} from "@/lib/server/workspace-limits";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json([] as PromptListItem[]);
    }

    const supabase = createVectorBeaAdminClient();

    const { data, error } = await supabase
      .from("prompts")
      .select("id, name, description, created_at, updated_at, prompt_versions(version_tag, is_published, created_at)")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    const prompts: PromptListItem[] = (data ?? []).map((row) => {
      const versions = Array.isArray(row.prompt_versions) ? row.prompt_versions : [];
      const latest = versions.sort((a: { created_at: string }, b: { created_at: string }) =>
        b.created_at.localeCompare(a.created_at))[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        latestVersion: latest?.version_tag ?? "v0",
        isPublished: latest?.is_published ?? false,
        updatedAt: row.updated_at ?? row.created_at ?? null,
      };
    });

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
