import { cookies } from "next/headers";

import { AppHeader } from "@/components/layout/app-header";
import { RbacGuard } from "@/components/rbac-guard";
import { CreatePromptDialog } from "@/components/prompts/create-prompt-dialog";
import { PromptsTable } from "@/components/prompts/prompts-table";
import type { PromptListItem } from "@/lib/api";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; q?: string }>;
}) {
  const { org: workspaceId, q } = await searchParams;

  let prompts: PromptListItem[] = [];

  if (workspaceId) {
    // Auth check — redirect is handled by the layout; we just return empty on failure
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);

    if (user) {
      const supabase = createVectorBeaAdminClient();
      const { data } = await supabase
        .from("prompts")
        .select("id, name, description, created_at, updated_at, prompt_versions(version_tag, is_published, created_at)")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false });

      prompts = (data ?? []).map((row) => {
        const versions = Array.isArray(row.prompt_versions) ? row.prompt_versions : [];
        const latest = versions.sort(
          (a: { created_at: string }, b: { created_at: string }) =>
            b.created_at.localeCompare(a.created_at),
        )[0];
        return {
          id: row.id,
          name: row.name,
          description: row.description ?? null,
          latestVersion: latest?.version_tag ?? "v0",
          isPublished: latest?.is_published ?? false,
          updatedAt: row.updated_at ?? row.created_at ?? null,
        };
      });
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Prompts"
        subtitle="Registry of versioned prompts, policies, and model configurations."
        actions={
          <RbacGuard requiredRole="editor">
            <CreatePromptDialog />
          </RbacGuard>
        }
      />
      <div className="px-4 py-6 md:px-6 xl:px-8">
        <PromptsTable prompts={prompts} initialQuery={q ?? ""} />
      </div>
    </div>
  );
}
