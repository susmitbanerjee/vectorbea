"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import type { contracts } from "@vectorbea/shared";
import { ArrowSquareOut, Plugs } from "@phosphor-icons/react/dist/ssr";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { ProviderLogo, providerLabel, type ProviderId } from "~/components/ui/provider-logo";
import { OptionCards, type OptionCardItem } from "~/components/ui/option-card";
import { ModalNote } from "~/components/ui/modal";

/* ══════════════════════════════════════════════════════════════════════════════
   Shared pieces of the two registry create flows.

   Both the tool and the agent dialog end on a review step, and both have to
   pick a connection. Writing either twice is how the two screens drift apart —
   one gains a health dot and the other does not, and the registry starts to
   look like two products.
══════════════════════════════════════════════════════════════════════════════ */

/* ── Review rows ──────────────────────────────────────────────────────────── */

/**
 * One line of the review step.
 *
 * A definition list rather than a table: these are label/value pairs of wildly
 * different lengths (a name, then eight lines of instructions), and a table
 * would force the longest value to set the column width for all of them.
 */
export function SummaryList({ children }: { children: React.ReactNode }) {
  return <dl className="border-subtle divide-subtle divide-y rounded-md border">{children}</dl>;
}

export function SummaryRow({
  label,
  children,
  mono = false,
  /** Jump back to the step that owns this value. */
  onEdit,
  editLabel = "Change",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  mono?: boolean;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2">
      <dt>
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      </dt>
      <dd className="min-w-0">
        <Text
          variant={mono ? "mono-sm" : "body-sm"}
          tone="primary"
          className="block break-words"
        >
          {children}
        </Text>
      </dd>
      {onEdit ? (
        <Button variant="ghost" size="xs" onClick={onEdit}>
          {editLabel}
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

/* ── Connection picking ───────────────────────────────────────────────────── */

/**
 * Connection health, as a dot.
 *
 * Status hues only — a connection that has never been tested is graphite
 * (`queued`), not green, because "we have not looked" and "it works" are
 * different answers and the registry has been known to conflate them.
 */
export function ConnectionHealthDot({ status }: { status?: string | null }) {
  const tone =
    status === "healthy" || status === "connected" || status === "active"
      ? "bg-status-success"
      : status === "degraded"
        ? "bg-status-waiting"
        : status === "failing" || status === "error" || status === "failed"
          ? "bg-status-failed"
          : "bg-status-queued";
  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone)} />;
}

export function connectionHealthLabel(status?: string | null): string {
  if (status === "healthy" || status === "connected" || status === "active") return "Healthy";
  if (status === "degraded") return "Degraded";
  if (status === "failing" || status === "error" || status === "failed") return "Failing";
  return "Never tested";
}

/**
 * Provider id for the brand mark, or null for a generic plug.
 *
 * The API's provider vocabulary and the drawn mark set do not match one to one
 * and should not be forced to: `google` is drawn as Gemini, `azure_openai`
 * borrows the OpenAI mark because it IS OpenAI behind an Azure endpoint, and
 * `cohere` has no mark yet. An unmapped provider gets the plug rather than a
 * wrong logo — a mark that names the wrong vendor is worse than no mark.
 */
const PROVIDER_MARK_BY_NAME: Record<string, ProviderId> = {
  openai: "openai",
  azure_openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  gemini: "gemini",
  mistral: "mistral",
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  slack: "slack",
  gmail: "gmail",
  notion: "notion",
  airtable: "airtable",
  hubspot: "hubspot",
  github: "github",
  jira: "jira",
  webhook: "webhook",
  http: "http",
};

function providerIdOf(connection: contracts.Connection): ProviderId | null {
  return PROVIDER_MARK_BY_NAME[connection.provider?.toLowerCase() ?? ""] ?? null;
}

/**
 * How the provider is written, not how it is stored.
 *
 * CSS `capitalize` was doing this job and gets the vendors wrong in exactly the
 * cases people notice: `openai` becomes "Openai", `azure_openai` becomes
 * "Azure_openai". The drawn mark set already carries the correct spelling of
 * every provider it knows, so that is the source; anything unmapped falls back
 * to per-word capitalisation, which is right for "stripe" and "cohere" and no
 * worse than what it replaces for the rest.
 */
function providerDisplayName(connection: contracts.Connection): string {
  const id = providerIdOf(connection);
  if (id) return providerLabel(id);
  return (connection.provider ?? "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface ConnectionPickerProps {
  connections: contracts.Connection[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  label: string;
  /** When true, "No connection" is offered as an explicit choice. */
  allowNone?: boolean;
  noneLabel?: string;
  noneDescription?: string;
  /** Rendered when `connections` is empty — says what to go and create. */
  emptyTitle: string;
  emptyBody: React.ReactNode;
  disabled?: boolean;
  /**
   * Right-aligned marker per connection — "2 operations", "generic".
   *
   * Exists because "pick a connection" is not a question anybody can answer
   * from a list of names. For an HTTP tool EVERY SaaS connection is type
   * `http`, so the picker offered all of them with nothing to tell them apart
   * and no hint that choosing Gmail would produce a very different next step
   * from choosing a bare webhook.
   */
  badgeFor?: (connection: contracts.Connection) => React.ReactNode;
}

/**
 * Pick a connection, with its health visible at the moment of choosing.
 *
 * A bare <Select> of names is the version of this that produces a tool bound to
 * a credential that has been failing for a week. The list is short by nature —
 * a workspace has a handful of connections, not hundreds — so the cards cost
 * nothing and carry the provider, the auth method and the last test result.
 */
export function ConnectionPicker({
  connections,
  value,
  onValueChange,
  label,
  allowNone = false,
  noneLabel = "No connection",
  noneDescription = "This adapter runs without external credentials.",
  emptyTitle,
  emptyBody,
  disabled,
  badgeFor,
}: ConnectionPickerProps) {
  if (connections.length === 0) {
    return (
      <div className="grid gap-2">
        <ModalNote tone="warning" title={emptyTitle}>
          {emptyBody}
        </ModalNote>
        <div>
          <Button asChild variant="secondary" size="sm" iconRight={<Icon icon={ArrowSquareOut} size="sm" decorative />}>
            <Link href={"/connections/new" as Route}>Add a connection</Link>
          </Button>
        </div>
      </div>
    );
  }

  const options: OptionCardItem[] = [
    ...(allowNone
      ? [{ value: "none", label: noneLabel, description: noneDescription, icon: Plugs }]
      : []),
    ...connections.map((connection) => ({
      value: connection.id,
      label: connection.name,
      badge: badgeFor?.(connection),
      description: (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span>{providerDisplayName(connection)}</span>
          <span aria-hidden="true">·</span>
          <span>{connection.authType.replace(/_/g, " ")}</span>
          <span aria-hidden="true">·</span>
          <ConnectionHealthDot status={connection.lastTestStatus} />
          <span>{connectionHealthLabel(connection.lastTestStatus)}</span>
        </span>
      ),
    })),
  ];

  return (
    <div className="grid gap-2">
      <OptionCards
        label={label}
        columns={2}
        density="compact"
        value={value ?? (allowNone ? "none" : null)}
        onValueChange={(next) => onValueChange(next === "none" ? null : next)}
        disabled={disabled}
        options={options}
      />
      <ConnectionBrandStrip connections={connections} selectedId={value} />
    </div>
  );
}

/**
 * The selected connection, echoed with its provider mark and id.
 *
 * The id is here because it is what appears in an error two weeks from now, and
 * rule 8 wants it mono, middle-truncated and copyable wherever it appears.
 */
function ConnectionBrandStrip({
  connections,
  selectedId,
}: {
  connections: contracts.Connection[];
  selectedId: string | null;
}) {
  const selected = connections.find((connection) => connection.id === selectedId);
  if (!selected) return null;
  const provider = providerIdOf(selected);

  return (
    <div className="bg-surface-sunken border-subtle flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
      {provider ? <ProviderLogo provider={provider} size={14} /> : <Icon icon={Plugs} size="sm" decorative className="text-fg-muted" />}
      <Text variant="caption" tone="secondary" className="truncate">
        {selected.name}
      </Text>
      <span className="flex-1" />
      <MonoId value={selected.id} />
    </div>
  );
}
