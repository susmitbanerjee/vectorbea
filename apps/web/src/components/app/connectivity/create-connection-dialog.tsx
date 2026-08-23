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
import { OptionCards } from "~/components/ui/option-card";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import {
  Modal, ModalBody, ModalDivider, ModalFooter, ModalHeader, ModalLayout,
  ModalNote, ModalRail, ModalSection, ModalStepBar, type ModalStep,
} from "~/components/ui/modal";
import { SummaryList, SummaryRow } from "~/components/app/registry/create-atoms";
import { useApi } from "~/lib/api/api-provider";
import { useApiMutation } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import type { ConnectionTestResult } from "~/lib/api/client";
import {
  INTEGRATION_SEEDS, INTEGRATION_CATEGORY_LABEL, AUTH_LABEL,
  type IntegrationCategory, type AuthMethod,
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
  return "http";
}

function apiProviderFor(id: ProviderId): string {
  if (id === "postgres") return "postgresql";
  if (id === "gemini") return "google_gemini";
  return id;
}

/** `AUTH_TYPES` in Validation.kt. The catalogue's vocabulary is the UI's, not the API's. */
function apiAuthTypeFor(method: AuthMethod): string {
  switch (method) {
    case "api-key": return "api_key";
    case "connection-string": return "connection_string";
    case "oauth": return "oauth2";
    default: return "none";
  }
}

/** Canonical API bases, so a SaaS connection can be probed without asking for a URL. */
const PROVIDER_ENDPOINTS: Partial<Record<ProviderId, { baseUrl: string; healthPath?: string }>> = {
  slack: { baseUrl: "https://slack.com/api", healthPath: "/auth.test" },
  gmail: { baseUrl: "https://gmail.googleapis.com", healthPath: "/gmail/v1/users/me/profile" },
  hubspot: { baseUrl: "https://api.hubapi.com", healthPath: "/account-info/v3/details" },
  github: { baseUrl: "https://api.github.com", healthPath: "/user" },
  notion: { baseUrl: "https://api.notion.com/v1", healthPath: "/users/me" },
  airtable: { baseUrl: "https://api.airtable.com/v0/meta", healthPath: "/bases" },
  jira: { baseUrl: "https://api.atlassian.com" },
  "google-sheets": { baseUrl: "https://sheets.googleapis.com/v4" },
};

/** What the credential field is called, and what a valid one looks like. */
function secretHint(integration: CatalogueEntry, method: AuthMethod): { label: string; placeholder: string; help: string } {
  if (method === "connection-string") {
    const isPostgres = integration.id === "postgres";
    return {
      label: "Connection string",
      placeholder: isPostgres
        ? "postgresql://user:password@host:5432/database"
        : "mysql://user:password@host:3306/database",
      help: isPostgres
        ? "Supabase, Neon, RDS, Timescale and Cockroach all speak this. If you are on Supabase, use the connection-pooling URL — the direct db.<ref>.supabase.co host has no IPv4 address and cannot be reached from here."
        : "PlanetScale, RDS and Aurora all speak this.",
    };
  }
  if (method === "oauth") {
    return {
      label: "OAuth access token",
      placeholder: "Paste the token issued by the provider",
      help: "Encrypted at rest and never shown again. Rotating replaces it.",
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
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current) setSession((current) => current + 1);
    wasOpen.current = open;
  }, [open]);

  return (
    <CreateConnectionDialogBody
      key={session}
      open={open}
      onOpenChange={onOpenChange}
      presetProvider={presetProvider ?? null}
      onCreated={onCreated}
    />
  );
}

function CreateConnectionDialogBody({
  open, onOpenChange, presetProvider, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetProvider: ProviderId | null;
  onCreated?: (connection: contracts.Connection) => void;
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
  const [readOnly, setReadOnly] = React.useState(true);

  const [verifying, setVerifying] = React.useState(false);
  const [result, setResult] = React.useState<ConnectionTestResult | null>(null);
  const [verifyError, setVerifyError] = React.useState<string | null>(null);

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
    setResult(null);
    setVerifyError(null);
  }, [integration]);

  const trimmedName = name.trim();
  const needsSecret = method !== "none";
  const needsEndpoint = integration ? (integration.id === "http" || integration.id === "webhook") : false;

  const stepErrors: (string | null)[] = [
    !integration ? "Pick what you are connecting to." : null,
    !trimmedName ? "Give the connection a name — workflows bind to it by name."
      : needsSecret && !secret.trim() ? `Paste the ${secretHint(integration!, method).label.toLowerCase()}.`
        : needsEndpoint && !endpoint.trim() ? "Enter the base URL Vectorbea should call."
          : null,
    null,
  ];

  const firstBroken = stepErrors.findIndex((entry) => entry !== null);
  const reachableIndex = firstBroken === -1 ? STEPS.length - 1 : firstBroken;
  const complete = firstBroken === -1;

  /** Exactly what will be posted — used by both the probe and the save. */
  const payload = React.useMemo(() => {
    if (!integration) return null;
    const known = PROVIDER_ENDPOINTS[integration.id];
    const baseUrl = needsEndpoint ? endpoint.trim() : known?.baseUrl;
    const isDatabase = apiTypeFor(integration.id) === "database";
    return {
      type: apiTypeFor(integration.id),
      provider: apiProviderFor(integration.id),
      authType: apiAuthTypeFor(method),
      config: {
        ...(baseUrl ? { baseUrl } : {}),
        ...(known?.healthPath ? { healthPath: known.healthPath } : {}),
        // sslRequired is not a UI preference — every managed Postgres and MySQL
        // in the catalogue mandates TLS, and offering to turn it off would only
        // ever be used to work around a certificate problem by disabling the
        // check that found it.
        ...(isDatabase ? { connectionMode: "connection_string", sslRequired: true, readOnly } : {}),
      } as Record<string, unknown>,
    };
  }, [integration, method, endpoint, needsEndpoint, readOnly]);

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
      onCreated?.(connection);
      onOpenChange(false);
    },
  });

  const busy = save.isPending;
  const verified = result?.status === "connected";
  const error = stepErrors[step];

  const railSteps: ModalStep[] = STEPS.map((entry, index) => ({
    ...entry,
    value:
      index === 0 ? integration?.name
        : index === 1 ? (trimmedName || undefined)
          : index === 2 ? (verified ? "Verified" : result ? "Test failed" : undefined)
            : undefined,
  }));

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next && !busy) onOpenChange(false); }}
      dismissible={!busy}
      size="xl"
    >
      <ModalHeader
        eyebrow="Connect · Integrations"
        title={integration ? `Connect ${integration.name}` : "Connect a provider"}
        description="A connection is one credential Vectorbea holds on your behalf. Tools and agents reference it by id — the secret itself is encrypted and never read back."
        mark={<Icon icon={Plugs} size="md" decorative />}
        closeDisabled={busy}
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
            footnote="The credential is encrypted at rest and never returned by the API, including to this screen."
          />
        }
      >
        <ModalBody ref={bodyRef}>
          {step === 0 ? (
            <ProviderStep
              search={search}
              onSearch={setSearch}
              selected={providerId}
              onSelect={(id) => { setProviderId(id); setStep(1); }}
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
              readOnly={readOnly}
              onReadOnly={setReadOnly}
            />
          ) : null}

          {step === 2 && integration ? (
            <div className="grid gap-4">
              <ModalSection title="What will be saved">
                <SummaryList>
                  <SummaryRow label="Provider" onEdit={() => setStep(0)}>{integration.name}</SummaryRow>
                  <SummaryRow label="Name" onEdit={() => setStep(1)}>{trimmedName}</SummaryRow>
                  <SummaryRow label="Method" onEdit={() => setStep(1)}>{AUTH_LABEL[method]}</SummaryRow>
                  {payload?.config.baseUrl ? (
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
                description="Opens a real connection to the provider using this credential, then throws it away. Nothing is written at either end."
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
                  <ModalNote title="Testing the connection">
                    Opening a connection to {integration.name}. A database handshake can take a
                    few seconds on a cold instance.
                  </ModalNote>
                ) : result ? (
                  <TestOutcome result={result} />
                ) : verifyError ? (
                  <ModalNote tone="danger" title="The test could not be run">
                    {verifyError} This is Vectorbea failing to reach its own API, not the provider
                    rejecting you.
                  </ModalNote>
                ) : (
                  <ModalNote title="Not tested yet">
                    Saving an untested credential is allowed, but the first thing that finds out it
                    is wrong will be a workflow run.
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
        </ModalBody>

        <ModalFooter
          hint={
            error ? (
              <span className="flex items-start gap-1.5">
                <Icon icon={WarningCircle} size="sm" decorative className="text-status-waiting mt-px" />
                <Text variant="caption" tone="muted" className="leading-snug">{error}</Text>
              </span>
            ) : step === STEPS.length - 1 && verified ? (
              <span className="flex items-center gap-1.5">
                <Icon icon={CheckCircle} size="sm" decorative className="text-status-success" />
                <Text variant="caption" tone="muted">Verified. Safe to save.</Text>
              </span>
            ) : null
          }
        >
          {step > 0 ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStep((current) => current - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}

          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              size="sm"
              disabled={Boolean(error)}
              onClick={() => setStep((current) => current + 1)}
            >
              Continue
            </Button>
          ) : (
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
              {verified ? "Save connection" : "Save without verifying"}
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
                    {entry.auth.map((m) => AUTH_LABEL[m]).join(" · ")}
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
  endpoint, onEndpoint, needsEndpoint, readOnly, onReadOnly,
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
  readOnly: boolean;
  onReadOnly: (value: boolean) => void;
}) {
  const hint = secretHint(integration, method);
  const isDatabase = apiTypeFor(integration.id) === "database";

  return (
    <div className="grid gap-4">
      <ModalSection title="Identity" description="What this connection is called wherever a tool or agent binds to it.">
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

      {needsEndpoint ? (
        <ModalSection title="Endpoint" description="The HTTPS base URL Vectorbea will call.">
          <Field label="Base URL" required>
            <Input
              type="url"
              value={endpoint}
              onChange={(event) => onEndpoint(event.target.value)}
              placeholder="https://api.example.com"
              className="font-code text-mono-sm"
            />
          </Field>
        </ModalSection>
      ) : null}

      {method === "none" ? (
        <ModalNote title="No credential required">
          This endpoint is saved without one. Anything it can reach, it can reach unauthenticated.
        </ModalNote>
      ) : (
        <ModalSection title={hint.label} description={hint.help}>
          <Field label={hint.label} labelHidden required>
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
          <ModalSection title="Blast radius" description="Enforced by the engine on every tool call that uses this connection.">
            <Checkbox
              checked={readOnly}
              onCheckedChange={(value) => onReadOnly(value === true)}
              description="Statements that write are refused. Turn this off only when a workflow genuinely has to write."
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
function TestOutcome({ result }: { result: ConnectionTestResult }) {
  if (result.status === "connected") {
    return (
      <ModalNote tone="success" title={`Connected in ${result.latencyMs} ms`}>
        {result.message}
      </ModalNote>
    );
  }

  const title =
    result.status === "private_runner_required" ? "This host needs a private runner"
      : result.status === "whitelist_required" ? "This host is behind an allowlist"
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
