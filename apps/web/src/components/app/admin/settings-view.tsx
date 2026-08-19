"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";

interface ProviderConfig { id: string; providerType: string; displayName: string; enabled: boolean; defaultModel: string | null; maskedKey: string; updatedAt: string }
const SECTIONS = [
  { href: "/settings/members", title: "Members", detail: "Workspace access and authoritative roles" },
  { href: "/settings/usage", title: "Usage & limits", detail: "Quota consumption and monthly reset" },
  { href: "/audit-log", title: "Audit log", detail: "Append-only runtime and administrative records" },
  { href: "/settings/privacy", title: "Privacy", detail: "Retention and redaction controls" },
  { href: "/settings/sdk", title: "SDK & ingest", detail: "Client setup and ingest tokens" },
] as const;

export function SettingsView() {
  const api = useApi();
  const { workspaceId, environmentId } = useScope();
  const me = useApiQuery({ queryKey: queryKeys.me(), queryFn: () => api.me(), enabled: Boolean(workspaceId) });
  const providers = useApiQuery({
    queryKey: [...queryKeys.workspace(workspaceId), "provider-settings"], enabled: Boolean(workspaceId),
    queryFn: async () => {
      const response = await fetch(`/api/settings/providers?workspaceId=${encodeURIComponent(workspaceId!)}`, { cache: "no-store" });
      const json = await response.json() as ProviderConfig[] | { error?: string };
      if (!response.ok || !Array.isArray(json)) throw new Error(Array.isArray(json) ? "Failed to load providers" : json.error ?? "Failed to load providers");
      return json;
    },
  });
  const [changing, setChanging] = React.useState<string | null>(null);
  const membership = me.data?.workspaces.find((workspace) => workspace.id === workspaceId);

  const toggle = async (provider: ProviderConfig) => {
    if (!workspaceId) return;
    setChanging(provider.id);
    try {
      const response = await fetch(`/api/settings/providers/${provider.id}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !provider.enabled }) });
      if (!response.ok) throw new Error("Failed to update provider");
      await providers.refetch();
    } finally { setChanging(null); }
  };

  return <PageContainer>
    <PageHeader eyebrow="Admin" title="Settings" description="Workspace identity, provider configuration, security, and governance entry points." />
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Workspace">
        {me.isPending ? <Text variant="body-sm" tone="muted">Loading workspace…</Text> : <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-body-sm">
          <dt className="text-fg-muted">Name</dt><dd className="text-fg-primary">{membership?.name ?? "Unknown workspace"}</dd>
          <dt className="text-fg-muted">Identifier</dt><dd className="text-fg-secondary font-code break-all">{workspaceId ?? "—"}</dd>
          <dt className="text-fg-muted">Your role</dt><dd className="text-fg-primary capitalize">{membership?.role ?? "—"}</dd>
          <dt className="text-fg-muted">Environment</dt><dd className="text-fg-primary capitalize">{environmentId}</dd>
        </dl>}
      </Card>
      <Card title="Settings sections"><div className="grid gap-1">{SECTIONS.map((section) => <Link key={section.href} href={section.href as Route} className="border-subtle hover:border-accent-border rounded-md border px-3 py-2 transition-colors"><Text variant="body-sm" tone="primary" className="block">{section.title}</Text><Text variant="caption" tone="muted" className="block">{section.detail}</Text></Link>)}</div></Card>
    </div>
    <Card title="Model providers" className="mt-3">
      {providers.isPending ? <Text variant="body-sm" tone="muted">Loading providers…</Text> : null}
      {providers.error ? <Text variant="body-sm" tone="inherit" className="text-status-failed">{providers.error.message}</Text> : null}
      {providers.data?.length === 0 ? <Text variant="body-sm" tone="muted">No model-provider settings have been configured.</Text> : null}
      <div className="grid gap-2">{providers.data?.map((provider) => <div key={provider.id} className="border-subtle flex flex-wrap items-center gap-3 rounded-md border p-3">
        <span className="min-w-0 flex-1"><Text variant="body-sm" tone="primary" className="block">{provider.displayName}</Text><Text variant="caption" tone="muted" className="block">{provider.providerType} · {provider.defaultModel ?? "No default model"} · {provider.maskedKey}</Text></span>
        <span className={provider.enabled ? "text-status-success text-caption" : "text-fg-muted text-caption"}>{provider.enabled ? "Enabled" : "Disabled"}</span>
        <Button size="xs" variant="secondary" loading={changing === provider.id} onClick={() => void toggle(provider)}>{provider.enabled ? "Disable" : "Enable"}</Button>
      </div>)}</div>
    </Card>
  </PageContainer>;
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) { return <section className={`border-subtle bg-surface-raised rounded-lg border p-3 ${className ?? ""}`}><Text variant="label" tone="primary" className="mb-2 block">{title}</Text>{children}</section>; }
