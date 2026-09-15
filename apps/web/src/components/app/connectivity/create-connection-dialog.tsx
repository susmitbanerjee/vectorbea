"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { contracts } from "@vectorbea/shared";
import {
  MagnifyingGlass, ShieldCheck, CheckCircle, WarningCircle, Plus, Plugs,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/choice";
import { Select } from "~/components/ui/select";
import { OptionCards } from "~/components/ui/option-card";
import { ProviderLogo, providerLabel, type ProviderId } from "~/components/ui/provider-logo";
import {
  Modal, ModalBody, ModalDivider, ModalFooter, ModalHeader, ModalLayout,
  ModalNote, ModalRail, ModalSection, ModalStepBar, type ModalStep,
} from "~/components/ui/modal";
import { SummaryList, SummaryRow } from "~/components/app/registry/create-atoms";
import { ConnectMcpDialog } from "./connect-mcp-dialog";
import { useApi } from "~/lib/api/api-provider";
import { useApiMutation } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { Tooltip } from "~/components/ui/tooltip";
import type { ConnectionTestResult, McpDiscoverResult } from "~/lib/api/client";
import {
  INTEGRATION_SEEDS, INTEGRATION_CATEGORY_LABEL, AUTH_LABEL,
  POOLING_LABEL, hostingFor, hostingEntry, detectHosting, detectPoolingMode,
  type IntegrationCategory, type AuthMethod, type DbHostingOption, type PoolingMode,
} from "~/content/integrations";

/* ══════════════════════════════════════════════════════════════════════════════
   CONNECT A PROVIDER

   This is the first thing anyone does in Vectorbea and the only screen where
   the product asks for a live credential, so it is built around one claim:
   NOTHING IS SAVED UNTIL IT HAS BEEN PROVEN TO WORK.

     Provider → Credential → Verify

   VERIFY IS A REAL CALL, NOT A FORM CHECK. `POST /api/connections/test-unsaved`
   takes the plaintext credential over TLS, opens an actual socket to the
   provider — a JDBC handshake and `SELECT 1`, or an authenticated GET — and
   throws the credential away. It is side-effect free by contract, so probing a
   database or a SaaS account never changes anything at the other end. The save
   button stays behind that result, because a registry full of connections that
   have never been dialled is worse than an empty one: every workflow bound to
   one is a failure deferred to the first run at 3am.

   THE ERROR IS THE PRODUCT HERE. "Unreachable" is what this screen used to say
   when a Supabase URL failed, and it sent people to check a password that was
   perfectly correct — the real cause being that Supabase direct hosts publish
   no IPv4 address. `DbTester.hostGuidance` now names the cause and the fix, and
   this dialog gets out of the way and prints it.

   OVERRIDE, DON'T BLOCK. A failing test does not make the save impossible —
   some providers refuse HEAD requests, some sit behind an allowlist that is not
   in place yet, and an operator who knows that should not be stuck. It makes it
   DELIBERATE: the primary action turns secondary and renames itself, so saving
   an unverified credential is a thing you chose rather than a thing you drifted
   into.
══════════════════════════════════════════════════════════════════════════════ */

const STEPS: ModalStep[] = [
  { id: "provider", label: "Provider", summary: "What you are connecting to" },
  { id: "credential", label: "Credential", summary: "How Vectorbea authenticates" },
  { id: "verify", label: "Verify", summary: "Prove it works, then save" },
];

/**
 * MCP gets a fourth step, and it is the point of connecting one.
 *
 * Every other provider's wizard ends at "saved". An MCP server's whole value is
 * the tools it advertises, and those do not exist as anything grantable until
 * discovery has written a row for each. Ending at "saved" would leave somebody
 * looking at a connection that does nothing, with no indication that a second
 * action was required — which is the state the product was in before this
 * screen existed.
 */
const MCP_STEPS: ModalStep[] = [
  { id: "provider", label: "Provider", summary: "What you are connecting to" },
  { id: "credential", label: "Server", summary: "Endpoint and credential" },
  { id: "verify", label: "Verify", summary: "Prove it speaks MCP" },
  { id: "discover", label: "Discover", summary: "Register the tools it offers" },
];

const CATEGORY_ORDER: IntegrationCategory[] = [
  "ai", "database", "messaging", "crm", "productivity", "developer", "generic",
];

/**
 * How a catalogue entry maps onto the API's own vocabulary.
 *
 * `type` is the API's `CONNECTION_TYPES`; `provider` is the free-text vendor.
 * They are NOT the same axis and the API validates them separately — Postgres
 * is `type: "database", provider: "postgresql"`, and getting that backwards is
 * a 400 that reads like the connection was rejected by the vendor.
 */
const LLM_PROVIDERS = new Set<ProviderId>(["openai", "anthropic", "gemini", "mistral"]);
const DATABASE_PROVIDERS = new Set<ProviderId>(["postgres", "mysql"]);

function apiTypeFor(id: ProviderId): string {
  if (LLM_PROVIDERS.has(id)) return "llm";
  if (DATABASE_PROVIDERS.has(id)) return "database";
  /* `mcp`, not `http`. An MCP server speaks JSON-RPC over a POST-only endpoint,
     and typing it `http` sends it to a tester that probes with HEAD and reports
     the spec's own 405 as a failure. `CONNECTION_TYPES` accepts both `mcp` and
     the older `tool` spelling; new rows use this one so a list can tell them
     apart. */
  if (id === "mcp") return "mcp";
  return "http";
}

function apiProviderFor(id: ProviderId): string {
  if (id === "postgres") return "postgresql";
  if (id === "gemini") return "google_gemini";
  return id;
}

/**
 * True when a host is private, judged the way `SsrfGuard` judges it.
 *
 * Deliberately a HINT and not a gate. The server makes the real decision and
 * this cannot see DNS, so a public name resolving to 10.x is missed here and
 * caught there. What it buys is that somebody typing `http://localhost:3000/mcp`
 * learns what they need BEFORE pressing Test — reading a fact rather than
 * hitting a refusal.
 */
function looksPrivate(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  let host: string;
  try {
    host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** `AUTH_TYPES` in Validation.kt. The catalogue's vocabulary is the UI's, not the API's. */
function apiAuthTypeFor(method: AuthMethod): string {
  switch (method) {
    case "api-key": return "api_key";
    case "connection-string": return "connection_string";
    case "oauth": return "oauth2";
    case "webhook-url": return "webhook_url";
    default: return "none";
  }
}

/**
 * Where each messaging provider hands out its channel webhook, and the shape of
 * the URL. A HINT, mirroring `WebhookUrlTester.problem` in the API, which makes
 * the real decision — this only means a Slack link pasted into the Teams field is
 * caught while the field is still in view rather than after pressing Test.
 */
const WEBHOOK_URLS: Partial<Record<ProviderId, {
  label: string; placeholder: string; whereToFind: string; matches: (url: URL) => boolean;
}>> = {
  teams: {
    label: "Teams channel webhook URL",
    placeholder: "https://…logic.azure.com/workflows/…",
    whereToFind: "the channel's Workflows, \u201cPost to a channel when a webhook request is received\u201d",
    matches: (url) =>
      /(\.logic\.azure\.com|\.powerplatform\.com|\.webhook\.office\.com)$/.test(url.hostname)
      && /\/(workflows|webhookb2|powerautomate)\//.test(url.pathname),
  },
  "google-chat": {
    label: "Google Chat webhook URL",
    placeholder: "https://chat.googleapis.com/v1/spaces/…/messages?key=…",
    whereToFind: "the space's Apps & integrations, then Webhooks",
    matches: (url) => url.hostname === "chat.googleapis.com" && url.pathname.startsWith("/v1/spaces/"),
  },
  discord: {
    label: "Discord webhook URL",
    placeholder: "https://discord.com/api/webhooks/…",
    whereToFind: "Edit Channel, then Integrations, then Webhooks",
    matches: (url) => /(^|\.)discord(app)?\.com$/.test(url.hostname) && url.pathname.startsWith("/api/webhooks/"),
  },
};

/** Why a pasted webhook URL cannot be right, or null. */
function webhookUrlProblem(providerId: ProviderId, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "That is not a URL. Paste the whole webhook URL, starting https://.";
  }
  if (url.protocol !== "https:") return "Webhook URLs must use https.";
  const known = WEBHOOK_URLS[providerId];
  if (known && !known.matches(url)) {
    return `That doesn't look like a ${providerLabel(providerId)} webhook URL. Copy it from ${known.whereToFind}.`;
  }
  return null;
}

/**
 * Canonical API bases, so a SaaS connection can be probed without asking for a URL.
 *
 * NOTE THE ABSENCE OF HEALTH PATHS. They used to live here too, and drifted from
 * the server's copy: this file sent GitHub `/user` while `ConnectionTester` used
 * `/rate_limit`, and a GitHub App installation token is refused by one and
 * accepted by the other. So the same credential could fail in this wizard and
 * pass on the connection page. `SaasEndpoints` in ConnectionTester.kt now owns
 * the probe outright — including the header Notion requires and the auth scheme
 * Atlassian mandates, neither of which a client has any business deciding. What
 * is left here is only what this screen needs in order to SHOW the user where
 * their credential is going.
 */
const PROVIDER_ENDPOINTS: Partial<Record<ProviderId, { baseUrl: string }>> = {
  slack: { baseUrl: "https://slack.com/api" },
  gmail: { baseUrl: "https://gmail.googleapis.com" },
  hubspot: { baseUrl: "https://api.hubapi.com" },
  github: { baseUrl: "https://api.github.com" },
  notion: { baseUrl: "https://api.notion.com" },
  airtable: { baseUrl: "https://api.airtable.com" },
  jira: { baseUrl: "https://api.atlassian.com" },
  "google-sheets": { baseUrl: "https://sheets.googleapis.com" },
};

/**
 * Providers whose API lives on the CUSTOMER'S OWN host rather than a shared one.
 *
 * An Atlassian or Zendesk API token is worthless without the site it belongs to,
 * and the probe has nowhere to send it. OAuth tokens do not need this — Atlassian
 * will list the sites a token can reach — so it is asked for only when it is
 * actually required.
 */
const PER_TENANT_HOST: Partial<Record<ProviderId, { label: string; placeholder: string; help: string }>> = {
  jira: {
    label: "Your Atlassian site",
    placeholder: "https://your-team.atlassian.net",
    help: "An API token is only valid against the site that issued it. Atlassian also requires the account email — put it in the name field's account, or use OAuth to skip both.",
  },
};

/** The wire protocol a database catalogue entry speaks. */
function wireFor(id: ProviderId): "postgres" | "mysql" {
  return id === "mysql" ? "mysql" : "postgres";
}

/**
 * What the credential field is called, and what a valid one looks like.
 *
 * The placeholder is the hosting product's own, because a generic
 * `host:5432/database` is exactly the shape people get wrong: Aiven's port is
 * never 3306, Supabase's pooler username is `postgres.<ref>`, and Neon's pooled
 * endpoint carries a `-pooler` suffix. Showing the real shape is cheaper than
 * explaining the failure afterwards.
 */
function secretHint(
  integration: CatalogueEntry,
  method: AuthMethod,
  hosting?: DbHostingOption | null,
): { label: string; placeholder: string; help: string } {
  if (method === "connection-string") {
    const wire = wireFor(integration.id);
    return {
      label: "Connection string",
      placeholder: hosting?.placeholder
        ?? (wire === "postgres"
          ? "postgresql://user:password@host:5432/database"
          : "mysql://user:password@host:3306/database"),
      help: hosting?.whereToFind
        ? `Find it under ${hosting.whereToFind}. It is encrypted at rest and never shown again.`
        : "Encrypted at rest and never shown again.",
    };
  }
  if (method === "webhook-url") {
    const known = WEBHOOK_URLS[integration.id];
    return {
      label: known?.label ?? "Webhook URL",
      placeholder: known?.placeholder ?? "https://…",
      help: `${known ? `Copy it from ${known.whereToFind}. ` : ""}Anyone with this URL can post to the channel, so it is encrypted at rest and never shown again.`,
    };
  }
  if (method === "oauth") {
    return {
      label: "OAuth access token",
      placeholder: "Paste the token issued by the provider",
      help: "Encrypted at rest and never shown again. Rotating replaces it.",
    };
  }
  if (integration.id === "slack") {
    return {
      label: "Bot token",
      placeholder: "xoxb-…",
      help: "In your Slack app, open OAuth & Permissions and copy the Bot User OAuth Token. Encrypted at rest and never shown again.",
    };
  }
  /* MCP carries its credential as `Authorization: Bearer <token>` and nothing
     else. Calling it an "API key" would send somebody looking for a field the
     protocol does not have. */
  if (integration.id === "mcp") {
    return {
      label: "Bearer token",
      placeholder: "Paste the token the server issued",
      help: "Sent as an Authorization: Bearer header on every call. Encrypted at rest and never shown again.",
    };
  }
  return {
    label: "API key",
    placeholder: "Paste the key",
    help: "Encrypted at rest and never shown again. Rotating replaces it; it cannot be read back.",
  };
}

type CatalogueEntry = (typeof INTEGRATION_SEEDS)[number];

export interface CreateConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a provider and start on step two. */
  presetProvider?: ProviderId | null;
  onCreated?: (connection: contracts.Connection) => void;
}

export function CreateConnectionDialog({
  open, onOpenChange, presetProvider, onCreated,
}: CreateConnectionDialogProps) {
  const [session, setSession] = React.useState(0);
  const [mcp, setMcp] = React.useState(presetProvider === "mcp");
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setSession((current) => current + 1);
      setMcp(presetProvider === "mcp");
    }
    wasOpen.current = open;
  }, [open, presetProvider]);

  /*
   * MCP has its own flow. It is not a credential form: the server is asked
   * what it needs, and the answer decides between connecting, signing in and
   * asking for a token — see `ConnectMcpDialog`. Routing it through this
   * wizard's "method → secret → test" steps is what produced a verify screen
   * reporting "the server rejected the token" for servers that use sign-in and
   * were never sent one.
   */
  if (mcp) {
    return (
      <ConnectMcpDialog
        key={`mcp-${session}`}
        open={open}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
        onBack={presetProvider === "mcp" ? undefined : () => setMcp(false)}
      />
    );
  }

  return (
    <CreateConnectionDialogBody
      key={session}
      open={open}
      onOpenChange={onOpenChange}
      presetProvider={presetProvider ?? null}
      onCreated={onCreated}
      onChooseMcp={() => setMcp(true)}
    />
  );
}

function CreateConnectionDialogBody({
  open, onOpenChange, presetProvider, onCreated, onChooseMcp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetProvider: ProviderId | null;
  onCreated?: (connection: contracts.Connection) => void;
  onChooseMcp: () => void;
}) {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const [step, setStep] = React.useState(presetProvider ? 1 : 0);
  const [providerId, setProviderId] = React.useState<ProviderId | null>(presetProvider);
  const [search, setSearch] = React.useState("");

  const [method, setMethod] = React.useState<AuthMethod>("api-key");
  const [name, setName] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [healthPath, setHealthPath] = React.useState("");
  const [apiKeyHeader, setApiKeyHeader] = React.useState("Authorization");
  const [readOnly, setReadOnly] = React.useState(true);

  /* Where the database lives and how it is reached.
     `hostingTouched` / `poolingTouched` are what stop the detector from
     fighting the user: a pasted URL seeds both, and the moment somebody picks a
     value by hand, editing the URL stops overwriting it. Without that, choosing
     "session pooler" and then fixing a typo in the string silently reverted the
     choice — and the difference between session and transaction pooling is
     whether prepared statements work four runs later. */
  const [hostingId, setHostingId] = React.useState<string | null>(null);
  const [hostingTouched, setHostingTouched] = React.useState(false);
  const [pooling, setPooling] = React.useState<PoolingMode | null>(null);
  const [poolingTouched, setPoolingTouched] = React.useState(false);
  const [detectedFromUrl, setDetectedFromUrl] = React.useState<string | null>(null);

  const [verifying, setVerifying] = React.useState(false);
  const [result, setResult] = React.useState<ConnectionTestResult | null>(null);
  const [verifyError, setVerifyError] = React.useState<string | null>(null);

  /* The saved connection, and what discovery found on it. Only MCP reaches
     these: every other provider's wizard closes on save. */
  const [saved, setSaved] = React.useState<contracts.Connection | null>(null);
  const [discovering, setDiscovering] = React.useState(false);
  const [discovery, setDiscovery] = React.useState<McpDiscoverResult | null>(null);
  const [discoverError, setDiscoverError] = React.useState<string | null>(null);

  const integration = React.useMemo(
    () => INTEGRATION_SEEDS.find((entry) => entry.id === providerId) ?? null,
    [providerId],
  );

  React.useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [step]);

  /* Choosing a provider seeds everything that depends on it, and invalidates
     any test result that was about the previous one. */
  React.useEffect(() => {
    if (!integration) return;
    setMethod(integration.auth[0]);
    setName(`${integration.name} — ${new Date().getUTCFullYear()}`);
    setSecret("");
    setEndpoint(PROVIDER_ENDPOINTS[integration.id]?.baseUrl ?? "");
    setHealthPath("");
    setApiKeyHeader("Authorization");
    setResult(null);
    setVerifyError(null);
    // The hosting list is per wire protocol, so a Postgres choice is meaningless
    // once the provider is MySQL. Default to the generic entry rather than null:
    // "self-hosted" is a real answer, and an empty picker reads like a required
    // field nobody explained.
    const generic = hostingFor(wireFor(integration.id))[0] ?? null;
    setHostingId(generic?.id ?? null);
    setHostingTouched(false);
    setPooling(generic?.modes[0] ?? null);
    setPoolingTouched(false);
    setDetectedFromUrl(null);
  }, [integration]);

  const isDatabase = integration ? apiTypeFor(integration.id) === "database" : false;
  const isMcp = integration?.id === "mcp";
  const steps = isMcp ? MCP_STEPS : STEPS;
  const hosting = React.useMemo(() => hostingEntry(hostingId) ?? null, [hostingId]);
  const hostingOptions = React.useMemo(
    () => (integration && isDatabase ? hostingFor(wireFor(integration.id)) : []),
    [integration, isDatabase],
  );

  /* READ THE URL RATHER THAN ASK ABOUT IT.
     A pasted connection string already names the vendor and, on several
     products, the pooling mode — port 6543 IS Supavisor's transaction mode.
     Making somebody answer a question their own clipboard just answered is how
     a three-field form becomes a five-field one for no gain. Detection only
     seeds untouched fields; see the state declarations above. */
  React.useEffect(() => {
    if (!integration || !isDatabase || method !== "connection-string") return;
    const trimmed = secret.trim();
    if (!trimmed.includes("://")) return;

    const wire = wireFor(integration.id);
    const detected = detectHosting(trimmed, wire);
    if (detected && !hostingTouched) setHostingId(detected.id);

    const target = hostingTouched ? hosting : (detected ?? hosting);
    const mode = detectPoolingMode(trimmed, target);
    if (mode && !poolingTouched) setPooling(mode);

    setDetectedFromUrl(
      detected ? `${detected.label}${mode ? ` · ${POOLING_LABEL[mode]}` : ""}` : null,
    );
    // `hosting` is derived from hostingId and would re-run this on its own write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, integration, isDatabase, method, hostingTouched, poolingTouched]);

  /* A mode that the newly-chosen product does not offer is not a mode. */
  React.useEffect(() => {
    if (!hosting) return;
    setPooling((current) => (current && hosting.modes.includes(current) ? current : hosting.modes[0]));
  }, [hosting]);

  const trimmedName = name.trim();
  const needsSecret = method !== "none";
  const tenantHost = integration && method === "api-key" ? PER_TENANT_HOST[integration.id] ?? null : null;
  const needsEndpoint = integration
    ? integration.id === "http" || integration.id === "webhook" || integration.id === "mcp"
      || tenantHost !== null
    : false;

  const stepErrors: (string | null)[] = [
    !integration ? "Pick what you are connecting to." : null,
    !trimmedName ? "Give the connection a name — workflows bind to it by name."
      : isMcp && !endpoint.trim() ? "Enter the MCP server's endpoint — the URL it answers JSON-RPC on."
        : needsSecret && !secret.trim()
          ? method === "webhook-url" ? "Paste the channel's webhook URL."
            : `Paste the ${secretHint(integration!, method, hosting).label.toLowerCase()}.`
          : method === "webhook-url" && integration ? webhookUrlProblem(integration.id, secret)
          : needsEndpoint && !endpoint.trim()
            ? tenantHost ? `Enter ${tenantHost.label.toLowerCase()} — an API token is only valid against the site that issued it.`
              : "Enter the base URL Vectorbea should call."
            : null,
    null,
    /* The discover step is never blocking. Its own action is optional, and
       "Discover later" is a real answer. */
    ...(isMcp ? [null] : []),
  ];

  const firstBroken = stepErrors.findIndex((entry) => entry !== null);
  const reachableIndex = firstBroken === -1 ? steps.length - 1 : firstBroken;
  const complete = firstBroken === -1;

  /** Exactly what will be posted — used by both the probe and the save. */
  const payload = React.useMemo(() => {
    if (!integration) return null;
    const known = PROVIDER_ENDPOINTS[integration.id];
    const baseUrl = needsEndpoint ? endpoint.trim() : known?.baseUrl;
    // Health paths and vendor headers are the server's, not ours. See the note
    // on PROVIDER_ENDPOINTS.
    return {
      type: apiTypeFor(integration.id),
      provider: apiProviderFor(integration.id),
      authType: apiAuthTypeFor(method),
      config: {
        ...(baseUrl ? { baseUrl } : {}),
        ...(integration.id === "mcp" ? {
          /* `serverUrl` is the canonical key — first in the resolution order
             both `ConnectionTester` and `McpToolExecutor` walk, and the name
             `McpConnectionConfig` declares. `baseUrl` above also resolves, but
             writing the canonical one means the stored row reads as what it is.

             `transport` is stored explicitly rather than left to default,
             because the worker refuses anything but streamable-http BY NAME and
             a missing key would make that refusal look like a bug rather than a
             setting. */
          serverUrl: endpoint.trim(),
          transport: "streamable-http",
        } : {}),
        ...(integration.id === "http" ? {
          ...(healthPath.trim() ? { healthPath: healthPath.trim() } : {}),
          ...(method === "api-key" ? { authHeaderName: apiKeyHeader.trim() || "Authorization" } : {}),
        } : {}),
        ...(isDatabase
          ? {
              // `connectionMode` says how the CREDENTIAL WAS ENTERED, and the
              // worker keys its whole connection-string path off this exact
              // value. `poolingMode` is the separate axis — how the database is
              // REACHED. Two names because they are two questions; overloading
              // one key is how "connection_string" would have started meaning a
              // pooling choice.
              connectionMode: "connection_string",
              poolingMode: pooling ?? "direct",
              dbHosting: hosting?.id ?? undefined,
              // sslRequired is not a UI preference — every managed Postgres and
              // MySQL in the catalogue mandates TLS, and offering to turn it off
              // would only ever be used to work around a certificate problem by
              // disabling the check that found it.
              sslRequired: true,
              readOnly,
            }
          : {}),
      } as Record<string, unknown>,
    };
  }, [integration, method, endpoint, needsEndpoint, readOnly, isDatabase, pooling, hosting,
      healthPath, apiKeyHeader]);

  async function verify() {
    if (!payload) return;
    setVerifying(true);
    setResult(null);
    setVerifyError(null);
    try {
      const outcome = await api.connections.testDraft(
        { ...payload, plaintextSecret: secret.trim() || null },
        { workspaceId: scope.workspaceId, environmentId: null },
      );
      setResult(outcome);
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : "The connection test could not be run.");
    } finally {
      setVerifying(false);
    }
  }

  const save = useApiMutation<contracts.Connection, void>({
    mutationFn: async () => {
      if (!payload) throw new Error("No provider selected.");
      return api.connections.create(
        {
          name: trimmedName,
          ...payload,
          // The environment SLUG, not the uuid. `ConnectionRoutes.create`
          // resolves (and creates) the environment from it, which is why
          // connecting a provider works even when the bootstrap environment id
          // has not resolved — unlike agents, tools and workflows.
          environment: "production",
          ...(secret.trim() ? { plaintextSecret: secret.trim() } : {}),
        },
        { workspaceId: scope.workspaceId, environmentId: null },
      );
    },
    onSuccess: (connection) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.connections.all({ workspaceId: scope.workspaceId, environmentId: null }),
      });
      /*
       * MCP does not close here. The connection is saved and useless until its
       * tools are registered, so the wizard carries on to the step that does
       * that — and a person who would rather not can still leave, because
       * "Discover later" is on the footer of that step.
       *
       * `onCreated` IS DELIBERATELY NOT CALLED YET. Every caller reads it as
       * "the wizard is finished" and closes the dialog on it — which is correct
       * for every other provider and would cut the discover step off entirely
       * for this one. It fires on the way out instead, from `finish`.
       */
      if (isMcp) {
        setSaved(connection);
        setStep(3);
        return;
      }
      /* Verify ran against the draft and nothing stored its result, so a
         connection that passed was saved as "not tested". The saved-connection
         test writes the status the Connections list and the worker read. */
      void api.connections.test(connection.id, { workspaceId: scope.workspaceId, environmentId: null })
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.connections.all({ workspaceId: scope.workspaceId, environmentId: null }),
          });
        });
      onCreated?.(connection);
      onOpenChange(false);
    },
  });

  /**
   * Leave the wizard, telling the caller a connection was made.
   *
   * The single exit for the MCP path, whether the tools were discovered or
   * deferred: the connection exists either way, so the list behind this dialog
   * is stale either way.
   */
  function finish() {
    if (saved) {
      void api.connections.test(saved.id, { workspaceId: scope.workspaceId, environmentId: null })
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.connections.all({ workspaceId: scope.workspaceId, environmentId: null }),
          });
        });
      onCreated?.(saved);
    }
    onOpenChange(false);
  }

  /**
   * Register what the server advertises.
   *
   * Writes one tool row per remote tool and grants NOTHING. The copy on the
   * step says so, because this is the moment somebody is definitely reading and
   * the alternative is finding out at an agent's grant list.
   */
  async function discover() {
    const connectionId = saved?.id;
    if (!connectionId) return;
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const outcome = await api.connections.mcpDiscover(connectionId, {
        workspaceId: scope.workspaceId, environmentId: null,
      });
      setDiscovery(outcome);
      /* The registry has new rows. Anything listing tools is now stale. */
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tools.all({ workspaceId: scope.workspaceId, environmentId: null }),
      });
    } catch (error) {
      setDiscoverError(
        error instanceof Error ? error.message : "The server could not be asked for its tools.");
    } finally {
      setDiscovering(false);
    }
  }

  const busy = save.isPending;
  const verified = result?.status === "connected";
  const error = stepErrors[step];

  const railSteps: ModalStep[] = steps.map((entry, index) => ({
    ...entry,
    value:
      index === 0 ? integration?.name
        : index === 1 ? (trimmedName || undefined)
          : index === 2 ? (verified ? "Verified" : result ? "Test failed" : undefined)
            : index === 3
              ? (discovery
                  ? `${discovery.toolsWritten} tool${discovery.toolsWritten === 1 ? "" : "s"}`
                  : saved ? "Saved, not discovered" : undefined)
              : undefined,
  }));

  return (
    <Modal
      open={open}
      /* Through `finish`, not `onOpenChange`: dismissing the discover step with
         Escape or the close button still means a connection was created, and
         the list behind this dialog is still stale. */
      onOpenChange={(next) => { if (!next && !busy && !discovering) finish(); }}
      dismissible={!busy && !discovering}
      size="xl"
    >
      <ModalHeader
        eyebrow="Connect · Integrations"
        title={integration ? `Connect ${integration.name}` : "Connect a provider"}
        description="Connect an account your tools and agents can use."
        mark={<Icon icon={Plugs} size="md" decorative />}
        closeDisabled={busy || discovering}
      />

      <ModalStepBar steps={railSteps} activeIndex={step} reachableIndex={reachableIndex} onSelect={setStep} />

      <ModalLayout
        rail={
          <ModalRail
            eyebrow="New connection"
            steps={railSteps}
            activeIndex={step}
            reachableIndex={reachableIndex}
            onSelect={setStep}
            footnote="Credentials are encrypted and never shown again."
          />
        }
      >
        <ModalBody ref={bodyRef}>
          {step === 0 ? (
            <ProviderStep
              search={search}
              onSearch={setSearch}
              selected={providerId}
              onSelect={(id) => {
                if (id === "mcp") { onChooseMcp(); return; }
                setProviderId(id); setStep(1);
              }}
            />
          ) : null}

          {step === 1 && integration ? (
            <CredentialStep
              integration={integration}
              method={method}
              onMethod={(next) => { setMethod(next); setResult(null); }}
              name={name}
              onName={setName}
              secret={secret}
              onSecret={(next) => { setSecret(next); setResult(null); }}
              endpoint={endpoint}
              onEndpoint={(next) => { setEndpoint(next); setResult(null); }}
              needsEndpoint={needsEndpoint}
              healthPath={healthPath}
              onHealthPath={(next) => { setHealthPath(next); setResult(null); }}
              apiKeyHeader={apiKeyHeader}
              onApiKeyHeader={(next) => { setApiKeyHeader(next); setResult(null); }}
              tenantHost={tenantHost}
              readOnly={readOnly}
              onReadOnly={setReadOnly}
              isMcp={isMcp}
              isDatabase={isDatabase}
              hosting={hosting}
              hostingOptions={hostingOptions}
              onHosting={(id) => {
                setHostingId(id);
                setHostingTouched(true);
                setResult(null);
              }}
              pooling={pooling}
              onPooling={(mode) => {
                setPooling(mode);
                setPoolingTouched(true);
                setResult(null);
              }}
              detectedFromUrl={detectedFromUrl}
            />
          ) : null}

          {step === 2 && integration ? (
            <div className="grid gap-4">
              <ModalSection title="What will be saved">
                <SummaryList>
                  <SummaryRow label="Provider" onEdit={() => setStep(0)}>{integration.name}</SummaryRow>
                  <SummaryRow label="Name" onEdit={() => setStep(1)}>{trimmedName}</SummaryRow>
                  <SummaryRow label="Method" onEdit={() => setStep(1)}>{AUTH_LABEL[method]}</SummaryRow>
                  {isDatabase && hosting ? (
                    <>
                      <SummaryRow label="Hosting" onEdit={() => setStep(1)}>{hosting.label}</SummaryRow>
                      <SummaryRow label="Connection mode" onEdit={() => setStep(1)}>
                        {pooling ? POOLING_LABEL[pooling] : "Direct connection"}
                      </SummaryRow>
                    </>
                  ) : null}
                  {isMcp ? (
                    <>
                      <SummaryRow label="Server URL" mono onEdit={() => setStep(1)}>
                        {endpoint.trim()}
                      </SummaryRow>
                      <SummaryRow label="Transport">Streamable HTTP</SummaryRow>
                    </>
                  ) : payload?.config.baseUrl ? (
                    <SummaryRow label="Endpoint" mono onEdit={() => setStep(1)}>
                      {String(payload.config.baseUrl)}
                    </SummaryRow>
                  ) : null}
                  <SummaryRow label="Credential" onEdit={() => setStep(1)}>
                    {secret.trim() ? "Encrypted on save, never shown again" : "None"}
                  </SummaryRow>
                </SummaryList>
              </ModalSection>

              <ModalDivider />

              <ModalSection
                title="Verify"
                description={isMcp
                  ? "Asks the server for its tool list using this credential, then throws it away. tools/list is a read — nothing is written at either end."
                  : "Opens a real connection to the provider using this credential, then throws it away. Nothing is written at either end."}
                aside={
                  <Button
                    size="xs"
                    variant="secondary"
                    loading={verifying}
                    loadingLabel="Testing"
                    onClick={() => void verify()}
                    iconLeft={<Icon icon={ShieldCheck} size="sm" decorative />}
                  >
                    Test connection
                  </Button>
                }
              >
                {verifying ? (
                  <ModalNote title={isMcp ? "Asking the server for its tools" : "Testing the connection"}>
                    {isMcp
                      ? "Sending tools/list to the endpoint. A cold server can take a few seconds to answer."
                      : `Opening a connection to ${integration.name}. A database handshake can take a few seconds on a cold instance.`}
                  </ModalNote>
                ) : result ? (
                  <TestOutcome result={result} isMcp={isMcp} />
                ) : verifyError ? (
                  <ModalNote tone="danger" title="The test could not be run">
                    {verifyError} This is Vectorbea failing to reach its own API, not the provider
                    rejecting you.
                  </ModalNote>
                ) : (
                  <ModalNote title="Not tested yet">
                    {isMcp
                      ? "Saving an untested server is allowed, but nothing will be discoverable on it until it answers."
                      : "Saving an untested credential is allowed, but the first thing that finds out it is wrong will be a workflow run."}
                  </ModalNote>
                )}
              </ModalSection>

              {save.error ? (
                <ModalNote tone="danger" title="The connection was not saved">
                  {save.error.message} Nothing was written.
                </ModalNote>
              ) : null}
            </div>
          ) : null}

          {step === 3 && isMcp ? (
            <DiscoverStep
              serverName={trimmedName || integration?.name || "this server"}
              discovering={discovering}
              discovery={discovery}
              error={discoverError}
              onDiscover={() => void discover()}
            />
          ) : null}
        </ModalBody>

        <ModalFooter
          hint={
            error ? (
              <span className="flex items-start gap-1.5">
                <Icon icon={WarningCircle} size="sm" decorative className="text-status-waiting mt-px" />
                <Text variant="caption" tone="muted" className="leading-snug">{error}</Text>
              </span>
            ) : step === 2 && verified ? (
              <span className="flex items-center gap-1.5">
                <Icon icon={CheckCircle} size="sm" decorative className="text-status-success" />
                <Text variant="caption" tone="muted">
                  {isMcp ? "Verified. Safe to save and discover." : "Verified. Safe to save."}
                </Text>
              </span>
            ) : step === 3 && discovery ? (
              <span className="flex items-center gap-1.5">
                <Icon icon={CheckCircle} size="sm" decorative className="text-status-success" />
                <Text variant="caption" tone="muted">
                  Registered. Grant them from an agent&rsquo;s Grants tab.
                </Text>
              </span>
            ) : null
          }
        >
          {/* The connection is already saved by the time the discover step is
              reached, so going back would offer to edit fields that no longer
              drive anything. Leaving is the only backward move, and it says so. */}
          {step > 0 && step < 3 ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStep((current) => current - 1)}>
              Back
            </Button>
          ) : step === 3 ? (
            <Button variant="ghost" size="sm" disabled={discovering} onClick={finish}>
              {discovery ? "Close" : "Discover later"}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}

          {step < 2 ? (
            <Button
              variant="primary"
              size="sm"
              disabled={Boolean(error)}
              onClick={() => setStep((current) => current + 1)}
            >
              Continue
            </Button>
          ) : step === 2 ? (
            <Button
              // Unverified saves stay possible and stop looking like the happy
              // path: secondary chrome, and a label that says what you are
              // actually doing.
              variant={verified ? "primary" : "secondary"}
              size="sm"
              loading={busy}
              loadingLabel="Saving"
              disabled={!complete}
              onClick={() => save.mutate()}
              iconLeft={<Icon icon={Plus} size="sm" decorative />}
            >
              {verified
                ? isMcp ? "Save and discover tools" : "Save connection"
                : "Save without verifying"}
            </Button>
          ) : (
            <Button
              variant={discovery ? "secondary" : "primary"}
              size="sm"
              loading={discovering}
              loadingLabel="Discovering"
              onClick={() => void discover()}
              iconLeft={<Icon icon={MagnifyingGlass} size="sm" decorative />}
            >
              {discovery ? "Discover again" : "Discover tools"}
            </Button>
          )}
        </ModalFooter>
      </ModalLayout>
    </Modal>
  );
}

/* ── Steps ────────────────────────────────────────────────────────────────── */

function ProviderStep({
  search, onSearch, selected, onSelect,
}: {
  search: string;
  onSearch: (value: string) => void;
  selected: ProviderId | null;
  onSelect: (id: ProviderId) => void;
}) {
  const needle = search.trim().toLowerCase();
  const matches = INTEGRATION_SEEDS.filter((entry) =>
    !needle || `${entry.name} ${entry.description} ${entry.category}`.toLowerCase().includes(needle),
  );

  const grouped = CATEGORY_ORDER
    .map((category) => ({ category, items: matches.filter((entry) => entry.category === category) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="grid gap-4">
      <Field label="Find a provider" labelHidden>
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search providers — Postgres, Slack, OpenAI…"
          prefix={<Icon icon={MagnifyingGlass} size="sm" decorative />}
          autoFocus
        />
      </Field>

      {grouped.length === 0 ? (
        <ModalNote tone="warning" title={`Nothing matches "${search.trim()}"`}>
          The catalogue covers the providers with a first-class adapter. Anything else with an
          HTTP API connects through Generic HTTP.
        </ModalNote>
      ) : null}

      {grouped.map((group) => (
        <ModalSection key={group.category} title={INTEGRATION_CATEGORY_LABEL[group.category]}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelect(entry.id)}
                aria-pressed={selected === entry.id}
                className={cn(
                  "group flex min-w-0 items-start gap-2.5 rounded-md border p-2.5 text-left",
                  "transition-colors duration-fast ease-standard",
                  "outline-none focus-visible:focus-ring",
                  selected === entry.id
                    ? "border-accent-border bg-accent-subtle"
                    : "border-subtle bg-surface-raised hover:border-strong hover:bg-surface-hover",
                )}
              >
                <span
                  className="border-subtle bg-surface-sunken grid size-7 shrink-0 place-items-center rounded-sm border"
                  aria-hidden="true"
                >
                  <ProviderLogo provider={entry.id} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <Text variant="body-sm" tone="primary" className="block truncate font-medium">
                    {entry.name}
                  </Text>
                  <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
                    {entry.credentialLabel ?? entry.auth.map((m) => AUTH_LABEL[m]).join(" · ")}
                  </Text>
                </span>
              </button>
            ))}
          </div>
        </ModalSection>
      ))}
    </div>
  );
}

function CredentialStep({
  integration, method, onMethod, name, onName, secret, onSecret,
  endpoint, onEndpoint, needsEndpoint, tenantHost, readOnly, onReadOnly,
  isMcp, isDatabase, hosting, hostingOptions, onHosting, pooling, onPooling, detectedFromUrl,
  healthPath, onHealthPath, apiKeyHeader, onApiKeyHeader,
}: {
  integration: CatalogueEntry;
  method: AuthMethod;
  onMethod: (value: AuthMethod) => void;
  name: string;
  onName: (value: string) => void;
  secret: string;
  onSecret: (value: string) => void;
  endpoint: string;
  onEndpoint: (value: string) => void;
  needsEndpoint: boolean;
  healthPath: string;
  onHealthPath: (value: string) => void;
  apiKeyHeader: string;
  onApiKeyHeader: (value: string) => void;
  tenantHost: { label: string; placeholder: string; help: string } | null;
  readOnly: boolean;
  onReadOnly: (value: boolean) => void;
  isMcp: boolean;
  isDatabase: boolean;
  hosting: DbHostingOption | null;
  hostingOptions: DbHostingOption[];
  onHosting: (id: string) => void;
  pooling: PoolingMode | null;
  onPooling: (mode: PoolingMode) => void;
  detectedFromUrl: string | null;
}) {
  const hint = secretHint(integration, method, hosting);

  return (
    <div className="grid gap-4">
      <ModalSection title="Identity" description="Shown when you pick this connection.">
        <Field label="Name" required>
          <Input value={name} onChange={(event) => onName(event.target.value)} maxLength={255} autoComplete="off" />
        </Field>
      </ModalSection>

      {integration.auth.length > 1 ? (
        <>
          <ModalDivider />
          <ModalSection title="Method" description="Pick the credential type the provider issued you.">
            <OptionCards
              label="Authentication method"
              columns={2}
              density="compact"
              value={method}
              onValueChange={(value) => onMethod(value as AuthMethod)}
              options={integration.auth.map((item) => ({ value: item, label: AUTH_LABEL[item] }))}
            />
          </ModalSection>
        </>
      ) : null}

      <ModalDivider />

      {isMcp ? (
        <ModalSection
          title="Server"
          description="The one URL this server answers JSON-RPC on."
        >
          <Field
            label="Server URL"
            required
            description="The streamable-HTTP endpoint, usually ending in /mcp."
          >
            <Input
              type="url"
              value={endpoint}
              onChange={(event) => onEndpoint(event.target.value)}
              placeholder="https://mcp.example.com/mcp"
              className="font-code text-mono-sm"
            />
          </Field>

          {/*
            A one-option select, deliberately, rather than no field at all.

            Leaving it out means somebody holding an SSE URL finds out at Verify,
            as a failure. Showing the field with the answer already in it means
            they find out here, while reading the form, as a fact.
          */}
          <Field label="Transport" description="The only transport Vectorbea implements.">
            <Select
              value="streamable-http"
              disabled
              onValueChange={() => {}}
              options={[{
                value: "streamable-http",
                label: "Streamable HTTP",
                description: "One URL, JSON-RPC over POST.",
              }]}
            />
          </Field>

          <ModalNote title="SSE and stdio are not supported">
            An SSE server needs a connection held open for the life of a run, and stdio needs a
            process on our side. Neither is implemented, and a connection configured for one is
            refused by name rather than quietly downgraded.
          </ModalNote>

          {looksPrivate(endpoint) ? (
            <ModalNote tone="warning" title="This looks like a private address">
              Vectorbea calls MCP servers from the public internet. To reach this one, set the
              connection&rsquo;s egress to private allowed and name this host in its allow-list —
              both on the connection&rsquo;s Network tab after saving. Allowing private egress
              without naming a host reaches nothing, on purpose.
            </ModalNote>
          ) : null}
        </ModalSection>
      ) : needsEndpoint ? (
        <ModalSection
          title={tenantHost ? tenantHost.label : "Endpoint"}
          description={tenantHost ? tenantHost.help : "The HTTPS base URL Vectorbea will call."}
        >
          <Field label={tenantHost ? tenantHost.label : "Base URL"} required>
            <Input
              type="url"
              value={endpoint}
              onChange={(event) => onEndpoint(event.target.value)}
              placeholder={tenantHost ? tenantHost.placeholder : "https://api.example.com"}
              className="font-code text-mono-sm"
            />
          </Field>
        </ModalSection>
      ) : null}

      {integration.id === "http" ? <ModalSection title="HTTP connection test" description="Check the connection works before saving.">
        <Field label="Test endpoint path" description="Added to the base URL, for example /me. Leave blank to check it is reachable.">
          <Input value={healthPath} onChange={(event) => onHealthPath(event.target.value)} placeholder="/me" className="font-code text-mono-sm" />
        </Field>
        {method === "api-key" ? <Field label="API key header" description="The header your API expects, such as X-API-Key.">
          <Input value={apiKeyHeader} onChange={(event) => onApiKeyHeader(event.target.value)} placeholder="X-API-Key" className="font-code text-mono-sm" />
        </Field> : null}
      </ModalSection> : null}

      {isDatabase && hostingOptions.length > 0 ? (
        <>
          <ModalSection
            title="Where it is hosted"
            description="Detected from the connection string when possible."
          >
            <Field label="Hosting">
              <Select
                value={hosting?.id ?? hostingOptions[0].id}
                onValueChange={onHosting}
                options={hostingOptions.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  description: entry.whereToFind,
                }))}
              />
            </Field>
            {detectedFromUrl ? (
              <Text variant="caption" tone="muted" className="flex items-center gap-1.5">
                <Icon icon={CheckCircle} size="sm" decorative className="text-status-success" />
                Detected {detectedFromUrl} from the connection string.
              </Text>
            ) : null}
            {hosting?.caution ? <ModalNote tone="warning" title="Before you test">{hosting.caution}</ModalNote> : null}
          </ModalSection>

          <ModalDivider />

          <ModalSection
            title="Connection mode"
            description="Choose how this database is reached. A transaction pooler needs the pooler option."
          >
            {hosting && hosting.modes.length > 1 ? (
              <OptionCards
                label="Connection mode"
                columns={1}
                density="compact"
                value={pooling}
                onValueChange={(value) => onPooling(value as PoolingMode)}
                options={hosting.modes.map((mode) => ({
                  value: mode,
                  label: POOLING_LABEL[mode],
                  description: hosting.modeNotes[mode],
                }))}
              />
            ) : hosting ? (
              <ModalNote title={POOLING_LABEL[hosting.modes[0]]}>
                {hosting.modeNotes[hosting.modes[0]] ?? "This product offers one way in, so there is nothing to choose."}
              </ModalNote>
            ) : null}
          </ModalSection>

          <ModalDivider />
        </>
      ) : null}

      {method === "none" ? (
        <ModalNote title="No credential required">
          This endpoint is saved without one. Anything it can reach, it can reach unauthenticated.
        </ModalNote>
      ) : (
        <ModalSection title={hint.label} description={hint.help}>
          <Field
            label={hint.label}
            labelHidden
            required
            error={method === "webhook-url" ? webhookUrlProblem(integration.id, secret) ?? undefined : undefined}
          >
            <Input
              type="password"
              value={secret}
              onChange={(event) => onSecret(event.target.value)}
              placeholder={hint.placeholder}
              className="font-code text-mono-sm"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </ModalSection>
      )}

      {isDatabase ? (
        <>
          <ModalDivider />
          <ModalSection title="Blast radius" description="Applies to every tool using this connection.">
            <Checkbox
              checked={readOnly}
              onCheckedChange={(value) => onReadOnly(value === true)}
              description="Blocks writes. Turn off only if a workflow needs to write."
            >
              Read-only connection
            </Checkbox>
          </ModalSection>
        </>
      ) : null}

      {integration.setup.length > 0 ? (
        <>
          <ModalDivider />
          <ModalSection title={`Getting a ${integration.name} credential`}>
            <ol className="grid gap-1.5">
              {integration.setup.map((line, index) => (
                <li key={line} className="flex gap-2">
                  <Text variant="caption" tone="disabled" tabular className="w-4 shrink-0">{index + 1}</Text>
                  <Text variant="body-sm" tone="secondary" className="min-w-0 leading-snug">{line}</Text>
                </li>
              ))}
            </ol>
          </ModalSection>
        </>
      ) : null}
    </div>
  );
}

/**
 * The test result, said in the provider's terms.
 *
 * The API's `message` is printed verbatim and is the most valuable line on the
 * screen — `DbTester.hostGuidance` and the LLM testers put the actual remedy
 * there ("use the connection-pooling URL", "check it was copied whole"). The
 * error CODE is shown beside it because it is what a support conversation will
 * ask for, and it is stable where the prose is not.
 */
function TestOutcome({ result, isMcp = false }: { result: ConnectionTestResult; isMcp?: boolean }) {
  if (result.status === "connected") {
    /* A Teams or Google Chat webhook can only be proven by posting into the
       channel, which a test must not do — so the API checks its shape and says
       `verified: false`. Calling that "connected" would overstate it. */
    if (result.details?.verified === false) {
      return (
        <ModalNote tone="success" title="The webhook URL is well-formed">
          {result.message}
        </ModalNote>
      );
    }
    return (
      <ModalNote tone="success" title={`Connected in ${result.latencyMs} ms`}>
        {result.message}
      </ModalNote>
    );
  }

  const title =
    result.status === "private_runner_required"
      /* Different remedy, different sentence. A private MCP server is reached by
         setting the connection's own egress policy and allow-list, not by
         standing up a private runner — and naming the wrong feature is how
         somebody spends an afternoon in the wrong screen. */
      ? isMcp ? "This server is on a private network" : "This host needs a private runner"
      : result.status === "whitelist_required" ? "This host is behind an allowlist"
        : isMcp ? "The server did not answer with a tool list"
          : "The provider refused the connection";

  return (
    <div className="grid gap-2">
      <ModalNote tone="danger" title={title}>
        {result.message}
      </ModalNote>
      {result.errorCode ? (
        <Text variant="mono-sm" tone="disabled" className="block">
          {result.errorCode}
        </Text>
      ) : null}
    </div>
  );
}

/* ── Discover ─────────────────────────────────────────────────────────────── */

/**
 * What the server offers, registered.
 *
 * ── THREE RULES, AND THEY ARE ALL COPY ──────────────────────────────────────
 *
 * 1. IT REGISTERS; IT DOES NOT GRANT. The sentence under the count is not
 *    reassurance — it is the grant model, stated at the one moment somebody is
 *    definitely reading. There is no "grant all" control here, and there is
 *    none anywhere else either, because `allowed_tool_ids` holds TOOL ids and
 *    no column in the schema could express "every tool from this server".
 *
 * 2. AN ALTERED DESCRIPTION IS SHOWN, MARKED, AND NOT HIDDEN. MCP.md §4 says
 *    the injection flag is for the log AND the UI; a marker nobody can see is
 *    only for the log. The `[removed]` markers stay visible in the text, which
 *    is why the sanitizer writes a marker instead of deleting.
 *
 * 3. ZERO TOOLS IS A STATE, NOT A FAILURE. A reachable server that advertises
 *    nothing is a normal thing on a Monday morning, and rendering it as an
 *    error teaches people to distrust a screen that was telling the truth.
 */
function DiscoverStep({
  serverName, discovering, discovery, error, onDiscover,
}: {
  serverName: string;
  discovering: boolean;
  discovery: McpDiscoverResult | null;
  error: string | null;
  onDiscover: () => void;
}) {
  if (discovering) {
    return (
      <div className="grid gap-4">
        <ModalNote title="Asking the server what it offers">
          Sending tools/list to {serverName}, then registering one tool for each thing it names.
        </ModalNote>
        <ToolRowsSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid gap-4">
        <ModalNote tone="danger" title="The server could not be asked for its tools">
          {error}
        </ModalNote>
        <ModalNote title="The connection is saved">
          Nothing was lost. Fix the server or its credential, then discover again — from here, or
          from the connection&rsquo;s Tools tab whenever you like.
        </ModalNote>
      </div>
    );
  }

  if (!discovery) {
    return (
      <ModalNote title="Nothing registered yet">
        {serverName} is saved. Its tools become usable once they are registered — each one
        becomes a tool in your registry, which you then grant to an agent individually.
      </ModalNote>
    );
  }

  if (discovery.toolsFound === 0) {
    return (
      <div className="grid gap-4">
        <ModalNote title="This server advertises no tools">
          It answered, and its tool list is empty. Nothing to register yet — discover again once
          the server publishes some.
        </ModalNote>
        {discovery.stale && discovery.lastError ? (
          <ModalNote tone="warning" title="The last refresh failed">
            {discovery.lastError}
          </ModalNote>
        ) : null}
      </div>
    );
  }

  const shown = discovery.tools.slice(0, 8);
  const remaining = discovery.tools.length - shown.length;

  return (
    <div className="grid gap-4">
      <ModalSection
        title={`${discovery.toolsWritten} tool${discovery.toolsWritten === 1 ? "" : "s"} registered from ${serverName}`}
        description="These tools are ready. Grant them to agents from each agent's Tool grants tab."
      >
        <ul className="grid gap-1.5">
          {shown.map((tool) => (
            <li key={tool.name} className="flex min-w-0 items-center gap-2">
              {/*
                The vendor's mark, guessed from the server name and the tool's
                own. This is the moment discovery has to look like it WORKED —
                a list of strings proves a request returned, a list of
                ServiceNow-marked rows proves we found ServiceNow.
              */}
              <ProviderLogo
                provider={`${serverName} ${tool.name}`}
                fallbackLabel={serverName}
                size={14}
                decorative
                className="shrink-0"
              />
              <Text variant="mono-sm" tone="primary" className="w-40 shrink-0 truncate">
                {tool.name}
              </Text>
              <Text variant="body-sm" tone="secondary" className="min-w-0 flex-1 leading-snug">
                {tool.description ?? "No description."}
              </Text>
              {tool.descriptionWasAltered ? (
                <Tooltip content="Part of this description looked like an instruction to the model and was replaced. The tool still works, and this does not affect what it is allowed to do.">
                  <span className="mt-px shrink-0">
                    <Icon icon={WarningCircle} size="sm" className="text-status-waiting" label="Description altered" />
                  </span>
                </Tooltip>
              ) : null}
            </li>
          ))}
        </ul>
        {remaining > 0 ? (
          <Text variant="caption" tone="muted" tabular className="block">
            and {remaining} more
          </Text>
        ) : null}
      </ModalSection>

      {discovery.toolsFlagged > 0 ? (
        <ModalNote tone="warning" title={
          discovery.toolsFlagged === 1
            ? "One description was altered before it was stored"
            : `${discovery.toolsFlagged} descriptions were altered before they were stored`
        }>
          They contained text shaped like an instruction to the model. The wording was replaced
          with [removed] markers and the tools work normally. This changes nothing about what any
          agent may call — that is decided by grants, which no description can reach.
        </ModalNote>
      ) : null}

      {discovery.toolsWritten < discovery.toolsFound ? (
        <ModalNote tone="warning" title="Not every tool was registered">
          The server advertised {discovery.toolsFound} and {discovery.toolsWritten} were written.
          Discover again; if the gap persists, the connection&rsquo;s Tools tab shows which ones
          are present.
        </ModalNote>
      ) : null}

      {discovery.stale && discovery.lastError ? (
        <ModalNote tone="warning" title="These came from an earlier refresh">
          {discovery.lastError} The tools above are what the server last successfully advertised.
        </ModalNote>
      ) : null}

      {discovery.resourcesFound > 0 ? (
        <ModalNote title={`This server also offers ${discovery.resourcesFound} resource${discovery.resourcesFound === 1 ? "" : "s"}`}>
          Resources are read-only context an agent pulls on demand. They are reached by passing a
          resource URI to one of the tools above.
        </ModalNote>
      ) : null}
    </div>
  );
}

/** A skeleton in the shape of the rows it will become, not a spinner. */
function ToolRowsSkeleton() {
  return (
    <ul className="grid gap-1.5" aria-hidden>
      {[0, 1, 2, 3].map((row) => (
        <li key={row} className="flex items-center gap-2">
          <span className="h-3.5 w-44 shrink-0 rounded-xs bg-surface-sunken" />
          <span className="h-3.5 min-w-0 flex-1 rounded-xs bg-surface-sunken" />
        </li>
      ))}
    </ul>
  );
}
