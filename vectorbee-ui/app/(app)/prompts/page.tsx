import { AppHeader } from "@/components/layout/app-header";
import { CreatePromptDialog } from "@/components/prompts/create-prompt-dialog";
import { PromptsTable } from "@/components/prompts/prompts-table";
import { apiFetch, type PromptListItem } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; q?: string }>;
}) {
  const { org, q } = await searchParams;
  const suffix = org ? `?organizationId=${org}` : "";
  const prompts = await apiFetch<PromptListItem[]>(`/api/prompts${suffix}`);

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Prompts"
        subtitle="Registry of versioned prompts, policies, and model configurations."
        actions={<CreatePromptDialog />}
      />
      <div className="px-4 py-6 md:px-6 xl:px-8">
        <PromptsTable prompts={prompts} initialQuery={q ?? ""} />
      </div>
    </div>
  );
}
