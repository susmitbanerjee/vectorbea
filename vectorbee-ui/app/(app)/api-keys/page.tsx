import { AppHeader } from "@/components/layout/app-header";
import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import { apiFetch, type ApiKeyView } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const keys = await apiFetch<ApiKeyView[]>("/api/keys", {
    workspaceId: org ?? null,
  }).catch(() => [] as ApiKeyView[]);

  return (
    <div className="min-h-screen">
      <AppHeader title="API Keys" subtitle="Issue and rotate workspace credentials for local proxies." />
      <ApiKeysClient initialKeys={keys} />
    </div>
  );
}
