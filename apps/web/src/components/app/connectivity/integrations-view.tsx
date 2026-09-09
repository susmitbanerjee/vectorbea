"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox } from "~/components/ui/choice";
import { ProviderLogo } from "~/components/ui/provider-logo";
import { getConnections } from "@/lib/repository";
import { CreateConnectionDialog } from "./create-connection-dialog";
import { HttpClientDialog } from "./http-client-dialog";
import { CreateToolDialog } from "../registry/create-tool-dialog";
import { ImportSpecDialog } from "../registry/import-spec-dialog";
import { useWorkspaceRole } from "~/lib/workspace/workspace-provider";
import type { Connection } from "@/types/connections";
import {
  INTEGRATIONS, integrationById, INTEGRATION_CATEGORY_LABEL, AUTH_LABEL,
  type IntegrationCategory, type IntegrationRecord, type AuthMethod,
} from "~/mocks/connectivity";

/* ══════════════════════════════════════════════════════════════════════════════
   INTEGRATIONS — a catalogue, and the one place a grid is right.

   §6.3: logos are monochrome-on-tint by DEFAULT and full colour ONLY when
   connected. That is the whole information design of this page — it turns "what
   am I actually connected to" into something you see rather than read, and it is
   what stops the directory reading as a sticker sheet.
══════════════════════════════════════════════════════════════════════════════ */

const CATEGORIES: (IntegrationCategory | "all")[] = [
  "all", "ai", "database", "messaging", "crm", "productivity", "developer", "generic",
];

export function IntegrationsView() {
  const { canBuild } = useWorkspaceRole();
  const [httpAction, setHttpAction] = React.useState<"test" | "create" | "import" | null>(null);
  const [httpConnectionId, setHttpConnectionId] = React.useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const category = (params.get("category") ?? "all") as IntegrationCategory | "all";
  const openId = params.get("integration");
  const connecting = params.get("connect");
  const [search, setSearch] = React.useState(params.get("q") ?? "");
  const [connections, setConnections] = React.useState<Connection[]>([]);

  const refreshConnections = React.useCallback(async () => {
    setConnections(await getConnections());
  }, []);

  React.useEffect(() => {
    void refreshConnections();
  }, [refreshConnections]);

  const setParams = React.useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
  }, [params, pathname, router]);

  const matches = React.useCallback((integration: IntegrationRecord) => {
    if (category !== "all" && integration.category !== category) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [integration.name, integration.description, ...integration.tools]
      .join(" ").toLowerCase().includes(needle);
  }, [category, search]);

  const catalogue = INTEGRATIONS.map((integration) => ({
    ...integration,
    connectionNames: connections
      .filter((connection) => providerMatches(integration.id, connection.provider))
      .map((connection) => connection.name),
  }));
  const shown = catalogue.filter(matches);
  const connected = shown.filter((i) => i.connectionNames.length > 0);
  const available = shown.filter((i) => i.connectionNames.length === 0);

  const open = openId ? catalogue.find((item) => item.id === openId) ?? integrationById(openId) ?? null : null;
  const connectTo = connecting ? catalogue.find((item) => item.id === connecting) ?? integrationById(connecting) ?? null : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Connect"
        title="Integrations"
        description="Everything Vectorbea can talk to. Connected ones are in full colour — the rest are waiting."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={"/connections" as Route}>Manage connections</Link>
          </Button>
        }
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => setParams({ q: search })}
            placeholder="Search integrations and tools"
            aria-label="Search integrations"
            className="h-8 max-w-xs text-body-sm"
          />
          <Text variant="caption" tone="muted">
            {connected.length} connected · {available.length} available
          </Text>
        </div>

        <div role="group" aria-label="Category" className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <button
                key={c}
                onClick={() => setParams({ category: c })}
                aria-pressed={active}
                className={cn(
                  "font-ui text-caption rounded-full border px-2.5 py-1",
                  "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  active
                    ? "bg-accent-subtle border-accent-border text-accent"
                    : "bg-surface-raised border-subtle text-fg-secondary hover:border-default",
                )}
              >
                {c === "all" ? "All" : INTEGRATION_CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <EmptyState query={search} onClear={() => { setSearch(""); setParams({ q: null, category: null }); }} />
        ) : null}

        {connected.length > 0 ? (
          <section>
            <Text variant="eyebrow" tone="muted" className="mb-2 block">Connected</Text>
            <Grid integrations={connected} onOpen={(id) => setParams({ integration: id })} />
          </section>
        ) : null}

        {available.length > 0 ? (
          <section className="mt-2">
            <Text variant="eyebrow" tone="muted" className="mb-2 block">Available</Text>
            <Grid integrations={available} onOpen={(id) => setParams({ integration: id })} />
          </section>
        ) : null}

        <RequestIntegration />
      </div>

      <IntegrationDetail
        integration={open}
        onClose={() => setParams({ integration: null })}
        onConnect={(id) => { if (id === "http") { setParams({ integration: null }); setHttpAction("test"); } else setParams({ integration: null, connect: id }); }}
        canBuild={canBuild}
        onHttpAction={(action) => {
          const existing = connections.filter((connection) => providerMatches("http", connection.provider));
          setHttpConnectionId(existing.length === 1 ? existing[0]!.id : null);
          setParams({ integration: null });
          setHttpAction(action);
        }}
      />
      <CreateConnectionDialog
        open={connectTo !== null && connectTo.id !== "http"}
        presetProvider={connectTo?.id ?? null}
        onOpenChange={(next) => { if (!next) { setParams({ connect: null }); } }}
        onCreated={() => {
          void refreshConnections();
          setParams({ connect: null });

        }}
      />
      {httpAction === "test" || connectTo?.id === "http" ? <HttpClientDialog onClose={() => { setHttpAction(null); setParams({ connect: null }); }} /> : null}
      {httpAction === "create" ? <CreateToolDialog
        open presetConnectionId={httpConnectionId}
        onOpenChange={(next) => { if (!next) setHttpAction(null); }}
      /> : null}
      {httpAction === "import" ? <ImportSpecDialog
        open presetConnectionId={httpConnectionId}
        onOpenChange={(next) => { if (!next) setHttpAction(null); }}
      /> : null}
    </PageContainer>
  );
}

/* ── Grid ─────────────────────────────────────────────────────────────────── */

function Grid({ integrations, onOpen }: { integrations: IntegrationRecord[]; onOpen: (id: string) => void }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {integrations.map((integration) => {
        const isConnected = integration.connectionNames.length > 0;
        return (
          <li key={integration.id}>
            <button
              onClick={() => onOpen(integration.id)}
              className={cn(
                "bg-surface-raised border-subtle flex h-full w-full flex-col gap-2 rounded-lg border p-3 text-left",
                "hover:border-default cursor-pointer transition-colors duration-fast",
                "outline-none focus-visible:focus-ring",
              )}
            >
              <div className="flex items-start gap-2.5">
                {/* §6.3 — the one prop that carries the page's information design. */}
                <ProviderLogo provider={integration.id} connected={isConnected} size={18} decorative className="!size-9" />
                <span className="min-w-0 flex-1">
                  <Text variant="body-sm" tone="primary" className="block truncate">{integration.name}</Text>
                  <Text variant="caption" tone="muted" className="block">
                    {INTEGRATION_CATEGORY_LABEL[integration.category]}
                  </Text>
                </span>
                {isConnected ? (
                  <span className="bg-status-success size-1.5 shrink-0 rounded-full" aria-label="Connected" />
                ) : null}
              </div>

              <Text variant="caption" tone="secondary" className="line-clamp-2 block leading-snug">
                {integration.description}
              </Text>

              <div className="mt-auto flex flex-wrap items-baseline gap-x-3 pt-1">
                <Text variant="caption" tone="disabled">
                  {integration.tools.length} {integration.tools.length === 1 ? "tool" : "tools"}
                </Text>
                <Text variant="caption" tone={isConnected ? "inherit" : "disabled"} className={isConnected ? "text-status-success" : undefined}>
                  {isConnected
                    ? `${integration.connectionNames.length} ${integration.connectionNames.length === 1 ? "connection" : "connections"}`
                    : "Not connected"}
                </Text>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────────── */

function IntegrationDetail({
  integration, onClose, onConnect, onHttpAction, canBuild,
}: {
  integration: IntegrationRecord | null;
  onClose: () => void;
  onConnect: (id: string) => void;
  onHttpAction: (action: "test" | "create" | "import") => void;
  canBuild: boolean;
}) {
  if (!integration) return null;
  const isConnected = integration.connectionNames.length > 0;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "motion-overlay z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-surface-base border-subtle shadow-3 flex max-h-[90dvh] w-[min(46rem,calc(100vw-2rem))] flex-col rounded-lg border",
          )}
        >
          <header className="border-subtle flex items-start gap-3 border-b px-4 py-3">
            <ProviderLogo provider={integration.id} connected={isConnected} size={18} decorative className="!size-9" />
            <div className="min-w-0 flex-1">
              <Dialog.Title asChild>
                <Text variant="heading-sm" tone="max" as="h2">{integration.name}</Text>
              </Dialog.Title>
              <Text variant="caption" tone="muted" className="mt-0.5 block">
                {INTEGRATION_CATEGORY_LABEL[integration.category]} · {integration.tools.length} tools
              </Text>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" iconOnly aria-label="Close">
                <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                </svg>
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-4">
              <Text variant="body-sm" tone="secondary" className="block">{integration.description}</Text>
              {integration.id === "http" ? <Section title="HTTP requests and API documents" help="Configure request inputs, authentication, response extraction and pagination, or generate tools from an API document.">
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" disabled={!canBuild} onClick={() => onHttpAction("test")}>Open HTTP client</Button>
                  <Button variant="secondary" size="sm" disabled={!canBuild} onClick={() => onHttpAction("create")}>Create HTTP tool</Button>
                  <Button variant="secondary" size="sm" disabled={!canBuild} onClick={() => onHttpAction("import")}>Import OpenAPI / Postman</Button>
                </div>
                <Text variant="caption" tone="muted" className="mt-2 block">
                  {!canBuild ? "Creating tools requires the developer role or higher." : isConnected ? "Choose a saved connection for these tools." : "Test requests without saving a connection. Import API documents separately to generate tools."}
                </Text>
              </Section> : null}

              {isConnected ? (
                <Section title="Existing connections">
                  <ul className="grid gap-1">
                    {integration.connectionNames.map((name) => (
                      <li key={name}>
                        <Link
                          href={"/connections" as Route}
                          className="text-accent hover:text-accent-hover font-ui text-body-sm rounded-xs outline-none transition-colors duration-fast focus-visible:focus-ring"
                        >
                          {name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              <Section title="Tools it supplies" help="Each becomes callable from any workflow once a connection exists.">
                {integration.tools.length === 0 ? (
                  <Text variant="body-sm" tone="secondary">No registered tools yet.</Text>
                ) : (
                  <ul className="grid gap-1">
                    {integration.tools.map((tool) => (
                      <li key={tool}>
                        <code className="font-code text-mono-sm text-fg-primary">{tool}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Authentication" help="Pick the method that fits your security posture.">
                <ul className="flex flex-wrap gap-1.5">
                  {integration.authMethods.map((method) => (
                    <li key={method} className="border-subtle text-fg-secondary font-ui text-caption rounded-xs border px-1.5 py-0.5">
                      {AUTH_LABEL[method]}
                    </li>
                  ))}
                </ul>
              </Section>

              {integration.scopes.length > 0 ? (
                <Section title="Scopes" help="Grant only what the workflows need. A scope you do not grant is a class of mistake you cannot make.">
                  <ul className="grid gap-1.5">
                    {integration.scopes.map((scope) => (
                      <li key={scope.name} className="flex flex-wrap items-baseline gap-2">
                        <code className="font-code text-mono-sm text-fg-primary">{scope.name}</code>
                        {scope.required ? (
                          <Text variant="caption" tone="inherit" className="text-status-failed">required</Text>
                        ) : (
                          <Text variant="caption" tone="disabled">optional</Text>
                        )}
                        <Text variant="caption" tone="muted" className="min-w-0 flex-1">{scope.description}</Text>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              <Section title="Setting it up">
                <ol className="grid gap-1.5">
                  {integration.setup.map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <Text variant="caption" tone="disabled" tabular className="w-4 shrink-0">{i + 1}</Text>
                      <Text variant="body-sm" tone="secondary" className="min-w-0 leading-snug">{step}</Text>
                    </li>
                  ))}
                </ol>
              </Section>
            </div>
          </div>

          <footer className="border-subtle flex justify-end gap-2 border-t px-4 py-3">
            <Button variant="primary" size="sm" onClick={() => onConnect(integration.id)}>
              {integration.id === "http" ? "Open HTTP client" : isConnected ? "Add another connection" : `Connect ${integration.name}`}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RequestIntegration() {
  return (
    <div className="border-subtle mt-2 rounded-lg border border-dashed p-4 text-center">
      <Text variant="body-sm" tone="primary" className="block">Something missing?</Text>
      <Text variant="caption" tone="muted" className="mx-auto mt-1 block max-w-[36rem] leading-snug">
        Anything with an HTTP API can be reached today through the generic HTTP tool. Requesting a
        first-class integration gets you a typed schema, a tested auth flow, and health checks.
      </Text>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" size="sm">Request an integration</Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={"/tools" as Route}>Use the generic HTTP tool</Link>
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="border-subtle grid place-items-center rounded-lg border border-dashed px-4 py-12">
      <div className="max-w-[34rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No integrations match</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Nothing matched <code className="font-code text-mono-sm text-fg-primary">{query}</code>. Search
          covers tool names too, so a term that finds nothing is not supplied by any integration.
        </Text>
        <div className="mt-4"><Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button></div>
      </div>
    </div>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section>
      <Text variant="eyebrow" tone="muted" className="block">{title}</Text>
      {help ? <Text variant="caption" tone="muted" className="mb-1.5 mt-0.5 block leading-snug">{help}</Text> : <div className="mb-1.5" />}
      {children}
    </section>
  );
}

function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1">
      <Text variant="caption" tone="secondary">{label}</Text>
      {children}
      <Text variant="caption" tone="muted" className="leading-snug">{help}</Text>
    </label>
  );
}

function providerMatches(catalogueProvider: string, savedProvider: string): boolean {
  if (catalogueProvider === savedProvider) return true;
  return (catalogueProvider === "postgres" && savedProvider === "postgresql")
    || (catalogueProvider === "gemini" && savedProvider === "google_gemini");
}
