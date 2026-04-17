import { cookies } from "next/headers";

import type { PromptListItem } from "@/lib/api";
import { getAuthenticatedUserFromCookies, loadOrganizationsForUser } from "@/lib/auth/server";
import { getCachedPrompts } from "@/lib/dal/prompts";
import { PromptsShell } from "@/components/prompts/prompts-shell";

export const dynamic = "force-dynamic";

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; q?: string }>;
}) {
  const { org: workspaceId, q } = await searchParams;

  let prompts: PromptListItem[] = [];

  if (workspaceId) {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);

    if (user) {
      const organizations = await loadOrganizationsForUser(user.id);
      const canAccessWorkspace = organizations.some((organization) =>
        organization.workspaces?.some((workspace) => workspace.id === workspaceId),
      );

      if (canAccessWorkspace) {
        prompts = await getCachedPrompts(workspaceId);
      }
    }
  }

  return <PromptsShell initialPrompts={prompts} initialQuery={q ?? ""} />;
}
