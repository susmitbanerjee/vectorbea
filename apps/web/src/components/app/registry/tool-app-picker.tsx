"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { Plus } from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Select } from "~/components/ui/select";
import { OptionCards } from "~/components/ui/option-card";
import { ModalNote, ModalSection } from "~/components/ui/modal";
import { ProviderLogo, providerLabel, type ProviderId } from "~/components/ui/provider-logo";
import { connectionHealthLabel } from "./create-atoms";
import {
  catalogueEntry, normaliseProvider, operationsFor, type ProviderOperation,
} from "~/content/integrations";

/* ══════════════════════════════════════════════════════════════════════════════
   START FROM THE APP, NOT FROM THE ADAPTER

   "Post to Slack" used to be five decisions deep: pick the HTTP API adapter,
   know that Slack is an HTTP connection, pick it on the next step, and only then
   find the operation list. Nothing on the first screen said Slack, Teams or
   email existed — the cards read HTTP API, Database, Code — so people reasonably
   concluded messaging was not supported.

   This puts the apps first and asks the two questions a person actually has:
   which app, and what should the tool do there. Choosing both fills in the
   adapter, the connection and the operation, and the rest of the wizard is the
   same wizard — the fixed-versus-agent decision, risk and approval are still
   asked, because those are the parts that are genuinely the operator's.

   An app with no connection is still shown. Hiding it is how Teams "did not
   exist"; offering the connect flow in place is the shorter road.
══════════════════════════════════════════════════════════════════════════════ */

/** Always offered, connected or not — these connect from this screen. */
const MESSAGING_APPS: ProviderId[] = ["slack", "teams", "google-chat", "discord"];

/** Offered once the workspace has a connection for them. */
const OTHER_APPS: ProviderId[] = ["gmail", "github", "jira", "notion", "airtable", "hubspot", "google-sheets"];

function isHealthy(connection: contracts.Connection) {
  return connectionHealthLabel(connection.lastTestStatus) === "Healthy";
}

/** Healthy first, then most recently changed — the one a person most likely means. */
function rank(connections: contracts.Connection[]) {
  return [...connections].sort((a, b) =>
    Number(isHealthy(b)) - Number(isHealthy(a))
    || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

export interface ToolAppPickerProps {
  connections: contracts.Connection[];
  /** The connection the tool currently runs as, if it came from here. */
  connectionId: string | null;
  operationId: string | null;
  onChoose: (connection: contracts.Connection, operation: ProviderOperation) => void;
  /** Picked an app that is not connected: drop the previous app's choice. */
  onClear: () => void;
  onConnect: (provider: ProviderId) => void;
}

export function ToolAppPicker({
  connections, connectionId, operationId, onChoose, onClear, onConnect,
}: ToolAppPickerProps) {
  const byApp = React.useMemo(() => {
    const map = new Map<ProviderId, contracts.Connection[]>();
    for (const app of [...MESSAGING_APPS, ...OTHER_APPS]) {
      const matching = connections.filter((c) => normaliseProvider(c.provider ?? "") === app);
      map.set(app, rank(matching));
    }
    return map;
  }, [connections]);

  const selectedConnection = connections.find((c) => c.id === connectionId) ?? null;
  const selectedFromConnection = selectedConnection
    ? ([...MESSAGING_APPS, ...OTHER_APPS].find((app) => app === normaliseProvider(selectedConnection.provider ?? "")) ?? null)
    : null;
  const [app, setApp] = React.useState<ProviderId | null>(selectedFromConnection);
  React.useEffect(() => {
    if (selectedFromConnection) setApp(selectedFromConnection);
  }, [selectedFromConnection]);

  const apps = [
    ...MESSAGING_APPS,
    ...OTHER_APPS.filter((candidate) => (byApp.get(candidate)?.length ?? 0) > 0),
  ];

  const appConnections = app ? byApp.get(app) ?? [] : [];
  const current = appConnections.find((c) => c.id === connectionId) ?? null;
  const operations = app ? operationsFor(app) : [];

  function pick(next: ProviderId) {
    setApp(next);
    const available = byApp.get(next) ?? [];
    const first = operationsFor(next)[0];
    /* Picking a connected app picks its best connection and its first
       operation straight away, so one click is a complete choice. */
    if (available[0] && first) onChoose(available[0], first);
    else onClear();
  }

  return (
    <ModalSection
      title="Send a message or use an app"
      description="Pick the app and what the tool should do."
    >
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="App">
        {apps.map((candidate) => {
          const count = byApp.get(candidate)?.length ?? 0;
          const active = app === candidate;
          return (
            <button
              key={candidate}
              type="button"
              onClick={() => pick(candidate)}
              aria-pressed={active}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-md border p-2.5 text-left",
                "transition-colors duration-fast ease-standard outline-none focus-visible:focus-ring",
                active
                  ? "border-accent-border bg-accent-subtle"
                  : "border-subtle bg-surface-raised hover:border-strong hover:bg-surface-hover active:bg-surface-sunken",
              )}
            >
              <span
                className="border-subtle bg-surface-sunken grid size-8 shrink-0 place-items-center rounded-sm border"
                aria-hidden="true"
              >
                <ProviderLogo provider={candidate} size={16} connected={count > 0} />
              </span>
              <span className="min-w-0 flex-1">
                <Text variant="body-sm" tone="primary" className="block truncate font-medium">
                  {providerLabel(candidate)}
                </Text>
                <Text variant="caption" tone={count > 0 ? "muted" : "disabled"} className="block truncate">
                  {count === 0 ? "Not connected" : count === 1 ? "Connected" : `${count} connections`}
                </Text>
              </span>
            </button>
          );
        })}
      </div>

      {app && appConnections.length === 0 ? (
        <ModalNote title={`${providerLabel(app)} is not connected yet`}>
          <span className="grid gap-2">
            <span>
              {catalogueEntry(app)?.description ?? `Connect ${providerLabel(app)} to register tools for it.`}{" "}
              Connecting takes a minute and you come straight back here.
            </span>
            <span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onConnect(app)}
                iconLeft={<Icon icon={Plus} size="sm" decorative />}
              >
                Connect {providerLabel(app)}
              </Button>
            </span>
          </span>
        </ModalNote>
      ) : null}

      {app && appConnections.length > 0 ? (
        <div className="grid gap-3">
          {appConnections.length > 1 ? (
            <Field
              label={`Which ${providerLabel(app)} connection`}
              description={
                app === "teams" || app === "google-chat" || app === "discord"
                  ? "Each connection posts to one channel, so this is where the messages go."
                  : "The account the tool runs as."
              }
            >
              <Select
                value={current?.id ?? appConnections[0]!.id}
                onValueChange={(id) => {
                  const next = appConnections.find((c) => c.id === id);
                  const op = operations.find((o) => o.id === operationId) ?? operations[0];
                  if (next && op) onChoose(next, op);
                }}
                options={appConnections.map((c) => ({
                  value: c.id,
                  label: c.name,
                  description: connectionHealthLabel(c.lastTestStatus),
                }))}
              />
            </Field>
          ) : (
            <Text variant="caption" tone="muted" className="block">
              Runs as <span className="text-fg-primary font-medium">{appConnections[0]!.name}</span>
              {" · "}{connectionHealthLabel(appConnections[0]!.lastTestStatus)}
            </Text>
          )}

          {operations.length > 1 || !current ? (
            <OptionCards
              label={`What the ${providerLabel(app)} tool does`}
              columns={1}
              density="compact"
              value={current ? operationId : null}
              onValueChange={(id) => {
                const op = operations.find((o) => o.id === id);
                const connection = current ?? appConnections[0];
                if (op && connection) onChoose(connection, op);
              }}
              options={operations.map((op) => ({
                value: op.id,
                label: op.label,
                description: op.description,
                badge: op.writes
                  ? <Text variant="caption" tone="muted">writes</Text>
                  : <Text variant="caption" tone="disabled">reads</Text>,
              }))}
            />
          ) : (
            <Text variant="caption" tone="muted" className="block">
              {operations[0]?.label}: {operations[0]?.description}
            </Text>
          )}
        </div>
      ) : null}
    </ModalSection>
  );
}
