import { NextRequest, NextResponse } from "next/server";

import type { PromptDetail } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = createVectorBeaAdminClient();

    const { data: prompt, error: promptError } = await supabase
      .from("prompts")
      .select("id, name, description, workspace_id, created_at")
      .eq("id", id)
      .single();

    if (promptError) throw new Error(promptError.message);

    const { data: versions, error: versionsError } = await supabase
      .from("prompt_versions")
      .select("id, version_tag, is_published, content, parameters, created_at")
      .eq("prompt_id", id)
      .order("created_at", { ascending: false });

    if (versionsError) throw new Error(versionsError.message);

    const result: PromptDetail[] = (versions ?? []).map((v) => ({
      promptId: prompt.id,
      promptVersionId: v.id,
      workspaceId: prompt.workspace_id ?? "",
      name: prompt.name,
      description: prompt.description ?? null,
      versionTag: v.version_tag,
      templateText: v.content ?? "",
      parameters: (v.parameters as Record<string, unknown>) ?? {},
      isPublished: v.is_published ?? false,
      createdAt: v.created_at ?? null,
    }));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load prompt versions" },
      { status: 500 },
    );
  }
}
