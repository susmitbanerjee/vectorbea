import { cookies } from "next/headers";

import { AppHeader } from "@/components/layout/app-header";
import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import type { ApiKeyView } from "@/lib/api";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: workspaceId } = await searchParams;

  let keys: ApiKeyView[] = [];

  if (workspaceId) {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);

    if (user) {
      const supabase = createVectorBeaAdminClient();
      const { data } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        const { data: keyRows } = await supabase
          .from("api_keys")
          .select("id, workspace_id, key_name, key_last_four, key_role, created_at, last_used_at, revoked_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false });

        keys = (keyRows ?? []).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          name: row.key_name ?? "",
          maskedKey: `vb_****${row.key_last_four ?? ""}`,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at ?? null,
          revokedAt: row.revoked_at ?? null,
          active: !row.revoked_at,
        }));
      }
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader title="API Keys" subtitle="Issue and rotate workspace credentials for local proxies." />
      <ApiKeysClient initialKeys={keys} />
    </div>
  );
}
