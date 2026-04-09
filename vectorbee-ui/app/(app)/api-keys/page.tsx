import { AppHeader } from "@/components/layout/app-header";
import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import { apiFetch, type ApiKeyView, type OrganizationView } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const [organizations, keys] = await Promise.all([
    apiFetch<OrganizationView[]>("/api/organizations").catch(() => [] as OrganizationView[]),
    apiFetch<ApiKeyView[]>("/api/keys").catch(() => [] as ApiKeyView[]),
  ]);

  return (
    <div className="min-h-screen">
      <AppHeader title="API Keys" subtitle="Issue and rotate workspace credentials for local proxies." />
      <ApiKeysClient organizations={organizations} initialKeys={keys} />
    </div>
  );
}
