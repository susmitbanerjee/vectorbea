import "server-only";

import { unstable_cache } from "next/cache";

import type { PromptListItem } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { PROMPTS_TAG, workspaceTag } from "@/lib/dal/cache-tags";

type PromptRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
  prompt_versions:
    | Array<{
        version_tag: string | null;
        is_published: boolean | null;
        created_at: string | null;
      }>
    | null;
};

function mapPromptRow(row: PromptRow): PromptListItem {
  const versions = Array.isArray(row.prompt_versions) ? [...row.prompt_versions] : [];
  const latest = versions.sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  )[0];

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    latestVersion: latest?.version_tag ?? "v0",
    isPublished: latest?.is_published ?? false,
    updatedAt: row.updated_at ?? row.created_at ?? null,
  };
}

export async function getCachedPrompts(workspaceId: string): Promise<PromptListItem[]> {
  const loadPrompts = unstable_cache(
    async () => {
      const supabase = createVectorBeaAdminClient();
      const { data, error } = await supabase
        .from("prompts")
        .select(
          "id, name, description, created_at, updated_at, prompt_versions(version_tag, is_published, created_at)",
        )
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false });

      if (error) {
        throw new Error(`Failed to load prompts: ${error.message}`);
      }

      return ((data ?? []) as PromptRow[]).map(mapPromptRow);
    },
    ["prompts", workspaceId],
    {
      tags: [PROMPTS_TAG, workspaceTag(workspaceId)],
      revalidate: 3600,
    },
  );

  return loadPrompts();
}
