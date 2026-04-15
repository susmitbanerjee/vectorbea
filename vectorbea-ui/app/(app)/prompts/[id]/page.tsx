import { AppHeader } from "@/components/layout/app-header";
import { PromptEditor } from "@/components/prompts/prompt-editor";
import type { PromptDetail } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function PromptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { id } = await params;
  const supabase = createVectorBeaAdminClient();

  const { data, error } = await supabase
    .from("prompts")
    .select("id, name, description, workspace_id, created_at, prompt_versions(id, version_tag, is_published, content, parameters, created_at)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return (
      <div className="min-h-screen">
        <AppHeader title="Prompt Not Found" subtitle="" />
        <div className="px-4 py-6 md:px-6 xl:px-8">
          <p className="text-muted-foreground">This prompt could not be loaded.</p>
        </div>
      </div>
    );
  }

  const allVersions = Array.isArray(data.prompt_versions) ? data.prompt_versions : [];
  const sorted = [...allVersions].sort((a: { created_at: string }, b: { created_at: string }) =>
    b.created_at.localeCompare(a.created_at));
  const latest = sorted[0];

  const prompt: PromptDetail = {
    promptId: data.id,
    promptVersionId: latest?.id ?? "",
    workspaceId: data.workspace_id ?? "",
    name: data.name,
    description: data.description ?? null,
    versionTag: latest?.version_tag ?? "v0",
    templateText: latest?.content ?? "",
    parameters: (latest?.parameters as Record<string, unknown>) ?? {},
    isPublished: latest?.is_published ?? false,
    createdAt: data.created_at ?? null,
  };

  const versions: PromptDetail[] = sorted.map((v) => ({
    promptId: data.id,
    promptVersionId: v.id,
    workspaceId: data.workspace_id ?? "",
    name: data.name,
    description: data.description ?? null,
    versionTag: v.version_tag,
    templateText: v.content ?? "",
    parameters: (v.parameters as Record<string, unknown>) ?? {},
    isPublished: v.is_published ?? false,
    createdAt: v.created_at ?? null,
  }));

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Prompt Detail"
        subtitle="Inspect, edit, and compare prompt versions before promoting them to production."
      />
      <div className="px-4 py-6 md:px-6 xl:px-8">
        <PromptEditor prompt={prompt} versions={versions} />
      </div>
    </div>
  );
}
