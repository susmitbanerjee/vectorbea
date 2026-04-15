import { NextRequest, NextResponse } from "next/server";

import type { PromptDetail } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = createVectorBeaAdminClient();

    // Get the latest version
    const { data: latest, error: versionError } = await supabase
      .from("prompt_versions")
      .select("id, version_tag")
      .eq("prompt_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (versionError) throw new Error(versionError.message);
    if (!latest) throw new Error("No versions found for this prompt");

    // Unpublish all versions, then publish the latest
    await supabase
      .from("prompt_versions")
      .update({ is_published: false })
      .eq("prompt_id", id);

    const { error: publishError } = await supabase
      .from("prompt_versions")
      .update({ is_published: true })
      .eq("id", latest.id);

    if (publishError) throw new Error(publishError.message);

    // Return updated prompt
    const { data: prompt, error: promptError } = await supabase
      .from("prompts")
      .select("id, name, description, workspace_id, created_at, prompt_versions(id, version_tag, is_published, content, parameters, created_at)")
      .eq("id", id)
      .single();

    if (promptError) throw new Error(promptError.message);

    const versions = Array.isArray(prompt.prompt_versions) ? prompt.prompt_versions : [];
    const published = versions.find((v: { is_published: boolean }) => v.is_published) ?? versions[0];

    const result: PromptDetail = {
      promptId: prompt.id,
      promptVersionId: published?.id ?? "",
      workspaceId: prompt.workspace_id ?? "",
      name: prompt.name,
      description: prompt.description ?? null,
      versionTag: published?.version_tag ?? "v0",
      templateText: published?.content ?? "",
      parameters: (published?.parameters as Record<string, unknown>) ?? {},
      isPublished: published?.is_published ?? false,
      createdAt: prompt.created_at ?? null,
    };

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to publish prompt" },
      { status: 500 },
    );
  }
}
