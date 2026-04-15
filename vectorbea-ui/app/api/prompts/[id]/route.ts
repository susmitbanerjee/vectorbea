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

    const { data, error } = await supabase
      .from("prompts")
      .select("id, name, description, workspace_id, created_at, updated_at, prompt_versions(id, version_tag, is_published, template_text, parameters, created_at)")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

    const versions = Array.isArray(data.prompt_versions) ? data.prompt_versions : [];
    const latest = versions.sort((a: { created_at: string }, b: { created_at: string }) =>
      b.created_at.localeCompare(a.created_at))[0];

    const prompt: PromptDetail = {
      promptId: data.id,
      promptVersionId: latest?.id ?? "",
      workspaceId: data.workspace_id ?? "",
      name: data.name,
      description: data.description ?? null,
      versionTag: latest?.version_tag ?? "v0",
      templateText: latest?.template_text ?? "",
      parameters: (latest?.parameters as Record<string, unknown>) ?? {},
      isPublished: latest?.is_published ?? false,
      createdAt: data.created_at ?? null,
    };

    return NextResponse.json(prompt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load prompt" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = (await request.json()) as {
      name?: string;
      description?: string;
      templateText?: string;
      parameters?: Record<string, unknown>;
    };

    const supabase = createVectorBeaAdminClient();

    // Update prompt metadata
    const { error: promptError } = await supabase
      .from("prompts")
      .update({
        ...(payload.name ? { name: payload.name.trim() } : {}),
        ...(payload.description !== undefined ? { description: payload.description?.trim() ?? null } : {}),
      })
      .eq("id", id);

    if (promptError) throw new Error(promptError.message);

    // If content provided, insert a new version
    if (payload.templateText !== undefined) {
      const { data: existing } = await supabase
        .from("prompt_versions")
        .select("version_tag")
        .eq("prompt_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      const nextVersion = existing?.version_tag
        ? `v${(parseInt(existing.version_tag.replace("v", "")) || 0) + 1}`
        : "v1";

      const { error: versionError } = await supabase
        .from("prompt_versions")
        .insert({
          prompt_id: id,
          version_tag: nextVersion,
          template_text: payload.templateText,
          parameters: payload.parameters ?? {},
          is_published: false,
        });

      if (versionError) throw new Error(versionError.message);
    }

    // Return updated prompt via GET logic
    const { data, error } = await supabase
      .from("prompts")
      .select("id, name, description, workspace_id, created_at, prompt_versions(id, version_tag, is_published, template_text, parameters, created_at)")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);

    const versions = Array.isArray(data.prompt_versions) ? data.prompt_versions : [];
    const latest = versions.sort((a: { created_at: string }, b: { created_at: string }) =>
      b.created_at.localeCompare(a.created_at))[0];

    const prompt: PromptDetail = {
      promptId: data.id,
      promptVersionId: latest?.id ?? "",
      workspaceId: data.workspace_id ?? "",
      name: data.name,
      description: data.description ?? null,
      versionTag: latest?.version_tag ?? "v0",
      templateText: latest?.template_text ?? "",
      parameters: (latest?.parameters as Record<string, unknown>) ?? {},
      isPublished: latest?.is_published ?? false,
      createdAt: data.created_at ?? null,
    };

    return NextResponse.json(prompt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update prompt" },
      { status: 500 },
    );
  }
}
