import { AppHeader } from "@/components/layout/app-header";
import { PromptEditor } from "@/components/prompts/prompt-editor";
import { apiFetch, type PromptDetail } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PromptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { id } = await params;
  const { org } = await searchParams;
  const prompt = await apiFetch<PromptDetail>(`/api/prompts/${id}`, {
    workspaceId: org ?? null,
  });
  const versions = await apiFetch<PromptDetail[]>(`/api/prompts/${id}/versions`, {
    workspaceId: org ?? null,
  });

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
