import "server-only";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export type ProviderConfigRow = {
  id: string;
  workspace_id: string;
  provider_type: string;
  display_name: string;
  enabled: boolean;
  default_model: string | null;
  base_url: string | null;
  masked_key: string;
  encrypted_key: string;
};

function decryptKey(encryptedKey: string): string {
  const encKey = process.env.VECTORBEA_ENCRYPTION_KEY ?? "";
  const data = Buffer.from(encryptedKey, "base64");
  if (!encKey) return data.toString("utf8");
  const keyBytes = Buffer.from(encKey.slice(0, 32).padEnd(32, "0"));
  const decrypted = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    decrypted[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return decrypted.toString("utf8");
}

export async function getProviderConfig(
  workspaceId: string,
  providerType: string,
): Promise<{ config: ProviderConfigRow; apiKey: string } | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("provider_configs")
    .select(
      "id, workspace_id, provider_type, display_name, enabled, default_model, base_url, masked_key, encrypted_key",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider_type", providerType)
    .eq("enabled", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const config = data as ProviderConfigRow;
  const apiKey = decryptKey(config.encrypted_key);
  return { config, apiKey };
}

export async function listEnabledProviders(workspaceId: string): Promise<ProviderConfigRow[]> {
  const supabase = createVectorBeaAdminClient();
  const { data } = await supabase
    .from("provider_configs")
    .select(
      "id, workspace_id, provider_type, display_name, enabled, default_model, base_url, masked_key, encrypted_key",
    )
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .order("created_at", { ascending: false });
  return (data ?? []) as ProviderConfigRow[];
}
