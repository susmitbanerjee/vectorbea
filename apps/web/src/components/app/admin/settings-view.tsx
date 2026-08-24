"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UsersThree, ChartLineUp, Scroll as ScrollIcon, ShieldCheck, Terminal, CreditCard, ArrowRight,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/choice";
import { MonoId } from "~/components/ui/mono-id";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import { DestructiveConfirmDialog } from "~/components/ui/destructive-confirm-dialog";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { AdminInlineState, describeAdminFailure } from "./admin-states";

/* ══════════════════════════════════════════════════════════════════════════════
   SETTINGS

   A HUB PLUS THE ONE THING THAT HAS NOWHERE ELSE TO LIVE.

   Members, usage, audit, privacy and SDK each own a page, so repeating their
   controls here would create two places to change the same thing and no way to
   tell which one is authoritative. What is left is workspace identity (read
   only — nothing in the API renames a workspace) and model providers, which
   have no page of their own.

   NOTHING IS OFFERED THAT THE API CANNOT DO. There is no rename, no transfer,
   no delete-workspace and no SSO toggle on this screen, because no endpoint
   backs any of them — a disabled "Delete workspace" button in a Danger zone
   reads as a capability that exists and is merely gated, which is a lie that
   costs somebody a support ticket. When those endpoints land, this is where
   they go.

   ROLE GATING IS SHOWN, NOT JUST ENFORCED. `PATCH /api/settings/providers/:id`
   requires admin-or-owner. A viewer sees the toggles disabled with the reason
   attached, rather than discovering the rule from a 403 after clicking.
══════════════════════════════════════════════════════════════════════════════ */

interface ProviderConfig {
  id: string;
  providerType: string;
  displayName: string;
  enabled: boolean;
  defaultModel: string | null;
  maskedKey: string;
  updatedAt: string;
}

const SECTIONS = [
  { href: "/settings/members", title: "Members", detail: "Who has access, and at what role", icon: UsersThree },
  { href: "/settings/usage", title: "Usage & limits", detail: "Consumption against the plan, and operational budgets", icon: ChartLineUp },
  { href: "/audit-log", title: "Audit log", detail: "Append-only record of runtime and admin activity", icon: ScrollIcon },
  { href: "/settings/privacy", title: "Privacy", detail: "Retention windows and redaction rules", icon: ShieldCheck },
  { href: "/settings/sdk", title: "SDK & ingest", detail: "Client setup and ingest tokens", icon: Terminal },
  { href: "/settings/billing", title: "Billing", detail: "Plan, invoices and payment method", icon: CreditCard },
] as const;

const PROVIDER_MARK: Record<string, ProviderId> = {
  openai: "openai", azure_openai: "openai", anthropic: "anthropic",
  google: "gemini", gemini: "gemini", google_gemini: "gemini", mistral: "mistral",
};

export function SettingsView() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { workspaceId, environmentId } = useScope();

  const me = useApiQuery({
    queryKey: queryKeys.me(),
    queryFn: () => api.me(),
    enabled: Boolean(workspaceId),
  });

  const membership = me.data?.workspaces.find((workspace) => workspace.id === workspaceId);
  const role = membership?.role ?? "viewer";
  const canConfigure = role === "owner" || role === "admin";

  const providers = useQuery<ProviderConfig[], Error>({
    queryKey: [...queryKeys.workspace(workspaceId), "provider-settings"],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const response = await fetch(
        `/api/settings/providers?workspaceId=${encodeURIComponent(workspaceId!)}`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as ProviderConfig[] | { error?: string; code?: string };
      if (!response.ok || !Array.isArray(json)) {
        const error = new Error(Array.isArray(json) ? "Failed to load providers" : json.error ?? "Failed to load providers");
        (error as Error & { code?: string }).code = Array.isArray(json) ? undefined : json.code;
        throw error;
      }
      return json;
    },
  });

  const [pending, setPending] = React.useState<string | null>(null);
  const [confirmOff, setConfirmOff] = React.useState<ProviderConfig | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  async function setEnabled(provider: ProviderConfig, enabled: boolean) {
    if (!workspaceId) return;
    setPending(provider.id);
    setFailure(null);
    try {
      const response = await fetch(
        `/api/settings/providers/${provider.id}?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "The provider could not be updated.");
      }
      await queryClient.invalidateQueries({
        queryKey: [...queryKeys.workspace(workspaceId), "provider-settings"],
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The provider could not be updated.");
    } finally {
      setPending(null);
      setConfirmOff(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Settings"
        description="Workspace identity, the model providers this workspace may call, and the way in to every other governance surface."
        metadata={
          membership ? (
            <>
              <Text variant="caption" tone="muted">Your role</Text>
              <Text variant="caption" tone="secondary" className="capitalize">{role}</Text>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-3">
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Panel title="Workspace" help="Identity as the API reports it. Renaming and transfer are not exposed by any endpoint yet.">
            {me.isPending ? (
              <IdentitySkeleton />
            ) : me.error ? (
              (() => {
                const described = describeAdminFailure(me.error, "workspace identity");
                return <AdminInlineState tone={described.tone} title={described.title} body={described.body} />;
              })()
            ) : (
              <dl className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
                <Fact label="Name">{membership?.name ?? "Unknown workspace"}</Fact>
                <Fact label="Workspace id">
                  {workspaceId ? <MonoId value={workspaceId} srLabel="Workspace id" /> : "—"}
                </Fact>
                <Fact label="Environment"><span className="capitalize">{environmentId}</span></Fact>
                <Fact label="Your role"><span className="capitalize">{role}</span></Fact>
              </dl>
            )}
          </Panel>

          <Panel title="Governance surfaces" help="Each one owns its own controls. Nothing here duplicates them.">
            <nav className="grid gap-1">
              {SECTIONS.map((section) => (
                <Link
                  key={section.href}
                  href={section.href as Route}
                  className={cn(
                    "group border-subtle flex items-center gap-2.5 rounded-md border px-2.5 py-2",
                    "transition-colors duration-fast ease-standard",
                    "hover:border-accent-border hover:bg-surface-hover",
                    "outline-none focus-visible:focus-ring",
                  )}
                >
                  <span
                    className="border-subtle bg-surface-sunken text-fg-muted grid size-7 shrink-0 place-items-center rounded-sm border"
                    aria-hidden="true"
                  >
                    <Icon icon={section.icon} size="sm" decorative />
                  </span>
                  <span className="min-w-0 flex-1">
                    <Text variant="body-sm" tone="primary" className="block truncate font-medium">{section.title}</Text>
                    <Text variant="caption" tone="muted" className="block truncate">{section.detail}</Text>
                  </span>
                  <Icon
                    icon={ArrowRight}
                    size="sm"
                    decorative
                    className="text-fg-disabled group-hover:text-accent shrink-0 transition-colors duration-fast"
                  />
                </Link>
              ))}
            </nav>
          </Panel>
        </div>

        <Panel
          title="Model providers"
          help={
            canConfigure
              ? "Disabling a provider stops every agent and tool bound to it on the next call. Credentials are untouched."
              : "Disabling a provider needs the admin or owner role. You can see the configuration but not change it."
          }
        >
          {providers.isPending ? <ProviderSkeleton /> : null}

          {providers.error ? (() => {
            // Provider settings are the one governance surface still backed by
            // the legacy Supabase project, so the remediation must name that
            // migration set rather than the Flyway one.
            const described = describeAdminFailure(providers.error, "model providers", "supabase");
            return (
              <AdminInlineState
                tone={described.tone}
                title={described.title}
                body={described.body}
                action={described.retryable
                  ? <Button size="xs" variant="secondary" onClick={() => void providers.refetch()}>Retry</Button>
                  : undefined}
              />
            );
          })() : null}

          {providers.data?.length === 0 ? (
            <AdminInlineState
              tone="neutral"
              title="No model providers configured"
              body="Providers are registered as LLM connections. Add one from Integrations and it appears here with its own on/off switch."
              action={
                <Button asChild size="xs" variant="secondary">
                  <Link href={"/integrations" as Route}>Browse integrations</Link>
                </Button>
              }
            />
          ) : null}

          {failure ? (
            <AdminInlineState tone="failed" title="The change was not saved" body={failure} />
          ) : null}

          {providers.data && providers.data.length > 0 ? (
            <ul className="border-subtle divide-subtle divide-y rounded-md border">
              {providers.data.map((provider) => {
                const mark = PROVIDER_MARK[provider.providerType.toLowerCase()];
                return (
                  <li key={provider.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <span
                      className="border-subtle bg-surface-sunken grid size-7 shrink-0 place-items-center rounded-sm border"
                      aria-hidden="true"
                    >
                      {mark ? <ProviderLogo provider={mark} size={14} /> : null}
                    </span>

                    <span className="min-w-0 flex-1">
                      <Text variant="body-sm" tone="primary" className="block truncate font-medium">
                        {provider.displayName}
                      </Text>
                      <Text variant="caption" tone="muted" className="block truncate">
                        {provider.defaultModel ?? "No default model"} · {provider.maskedKey}
                      </Text>
                    </span>

                    <Text
                      variant="caption"
                      tone="inherit"
                      className={cn("shrink-0", provider.enabled ? "text-status-success" : "text-fg-muted")}
                    >
                      {provider.enabled ? "Enabled" : "Disabled"}
                    </Text>

                    <Switch
                      checked={provider.enabled}
                      disabled={!canConfigure || pending === provider.id}
                      aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.displayName}`}
                      onCheckedChange={(next) => {
                        // Turning a provider OFF stops live traffic, so it is
                        // confirmed. Turning one on cannot break anything.
                        if (next) void setEnabled(provider, true);
                        else setConfirmOff(provider);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Panel>
      </div>

      <DestructiveConfirmDialog
        open={confirmOff !== null}
        title={`Disable ${confirmOff?.displayName ?? "provider"}?`}
        description={
          <>
            Every agent and tool bound to this provider starts failing on its next call, including runs
            already in flight when they reach their next model step. The credential is kept, so
            re-enabling restores service immediately.
          </>
        }
        confirmLabel="Disable provider"
        pending={pending === confirmOff?.id}
        onOpenChange={(open) => { if (!open) setConfirmOff(null); }}
        onConfirm={() => { if (confirmOff) void setEnabled(confirmOff, false); }}
      />
    </PageContainer>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function Panel({
  title, help, children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border">
      <header className="border-subtle border-b px-4 py-3">
        <Text variant="label" tone="primary" as="h2" className="block">{title}</Text>
        {help ? (
          <Text variant="caption" tone="muted" className="mt-0.5 block max-w-[72ch] leading-snug">{help}</Text>
        ) : null}
      </header>
      <div className="grid gap-3 p-4">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd className="min-w-0"><Text variant="body-sm" tone="primary" className="block truncate">{children}</Text></dd>
    </>
  );
}

function IdentitySkeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <div className="bg-surface-active h-3 w-24 animate-pulse rounded-xs" />
          <div className="bg-surface-active h-3 w-40 animate-pulse rounded-xs" />
        </div>
      ))}
    </div>
  );
}

function ProviderSkeleton() {
  return (
    <div className="border-subtle divide-subtle divide-y rounded-md border" aria-hidden="true">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-3 px-3 py-2.5">
          <div className="bg-surface-active size-7 shrink-0 animate-pulse rounded-sm" />
          <div className="flex-1">
            <div className="bg-surface-active h-3 w-32 animate-pulse rounded-xs" />
            <div className="bg-surface-active mt-1.5 h-2.5 w-48 animate-pulse rounded-xs" />
          </div>
          <div className="bg-surface-active h-4 w-8 shrink-0 animate-pulse rounded-full" />
        </div>
      ))}
    </div>
  );
}
