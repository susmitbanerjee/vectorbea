"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Key, Copy, Check, WarningCircle, ArrowsClockwise, Prohibit,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Tooltip } from "~/components/ui/tooltip";
import {
  Modal, ModalBody, ModalFooter, ModalHeader, ModalNote, ModalSection,
} from "~/components/ui/modal";
import { DestructiveConfirmDialog } from "~/components/ui/destructive-confirm-dialog";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { useRole } from "~/lib/auth/use-role";
import { getPublicApiBaseUrl } from "~/lib/api/config";
import type { ApiKeyRow, CreatedApiKey } from "~/lib/api/client";

/* ══════════════════════════════════════════════════════════════════════════════
   API KEYS

   ── WHY THIS SCREEN WAS REBUILT RATHER THAN RESTYLED ────────────────────────
   The workflow overview tells you to call your workflow with a key, and links
   here to make one. The screen it linked to read and wrote a Supabase
   `api_keys` table that no environment points at any more (see
   /docs/audit/CURRENT-STATE.md on the dead `vectorbea` schema). So the list was
   always empty, "Create" reported success, and the key it printed authenticated
   nothing — the API validates against a Postgres table that row never reached.

   That is the worst shape a credential screen can take. A key that does not
   work is diagnosable; a key that is issued, displayed and silently unknown to
   the thing it is meant to open sends somebody to read their own request logs.

   This talks to `ApiKeyRoutes`, which is the same store `authenticate()` reads.

   ── THE SECRET IS SHOWN ONCE, AND THAT IS NOT A UI CHOICE ───────────────────
   `ApiKeyService` stores SHA-256 of the secret and keeps the first twelve
   characters in clear so a row can be matched to a log line. There is no column
   to read a key back from, so there is no "show again" to build. The dialog
   below is therefore modal, blocks on an explicit acknowledgement, and says so
   before the key appears rather than after.

   ── AND WHY A REVOKED KEY STAYS IN THE LIST ─────────────────────────────────
   "Was this live last Tuesday, and who was it acting as" is the first question
   asked when a key leaks. Removing the row removes the answer.
══════════════════════════════════════════════════════════════════════════════ */

export function ApiKeysView() {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();
  /*
   * `RbacGuard` holds create, rotate, revoke and rate-limit to WORKSPACE_WRITE
   * — admin and owner. Reading the list is not gated, and is not gated here
   * either: not being able to see which credentials exist in a workspace you
   * belong to helps nobody.
   *
   * This is presentation. The API re-checks, and a developer who defeats it
   * gets a 403 rather than a key. What it buys is a disabled button with a
   * sentence naming the role to ask for, instead of an enabled one that throws.
   */
  const role = useRole();
  const mayManage = role.can("apikey.manage");
  const denial = role.denialReason("apikey.manage");

  const readScope = React.useMemo(
    () => ({ workspaceId: scope.workspaceId, environmentId: null }),
    [scope.workspaceId],
  );
  const enabled = Boolean(scope.workspaceId);
  const listKey = React.useMemo(
    () => [...queryKeys.env(scope.workspaceId, null), "api-keys"] as const,
    [scope.workspaceId],
  );

  const keys = useApiQuery({
    queryKey: listKey,
    queryFn: () => api.apiKeys.list(readScope),
    enabled,
  });

  const [creating, setCreating] = React.useState(false);
  const [minted, setMinted] = React.useState<CreatedApiKey | null>(null);
  const [revoking, setRevoking] = React.useState<ApiKeyRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const refresh = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: listKey }),
    [queryClient, listKey],
  );

  const rows = keys.data?.keys ?? [];
  const live = rows.filter((row) => !row.revokedAt && !isExpired(row));
  const retired = rows.filter((row) => row.revokedAt || isExpired(row));
  const limit = keys.data?.limit ?? null;
  const atLimit = limit != null && limit >= 0 && live.length >= limit;

  async function revoke(row: ApiKeyRow) {
    setBusyId(row.id);
    try {
      await api.apiKeys.revoke(row.id, readScope);
      await refresh();
      toast.success(`${row.name} revoked. Calls using it are refused from now on.`);
    } catch (error) {
      toast.error(message(error, "The key could not be revoked. Nothing has changed."));
    } finally {
      setBusyId(null);
      setRevoking(null);
    }
  }

  async function rotate(row: ApiKeyRow) {
    setBusyId(row.id);
    try {
      const created = await api.apiKeys.rotate(row.id, undefined, readScope);
      await refresh();
      setMinted(created);
    } catch (error) {
      toast.error(message(error, "The key could not be rotated. The existing one is untouched."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="API keys"
        description="Let your own code start runs and read results."
        actions={
          <Tooltip content={denial ?? (atLimit ? (limit === 0 ? "Your plan does not include API keys." : "This workspace is at its plan's key limit.") : "")} disabled={mayManage && !atLimit}>
            <span>
              <Button
                variant="primary"
                size="sm"
                disabled={!enabled || atLimit || !mayManage}
                onClick={() => setCreating(true)}
                iconLeft={<Icon icon={Key} size="sm" decorative />}
              >
                Create a key
              </Button>
            </span>
          </Tooltip>
        }
      />

      <div className="grid grid-cols-1 gap-4">
        {atLimit ? (
          <Banner tone="warning">
            {limit === 0
              ? "Your plan does not include API keys. Upgrade under Settings → Plan & access to create one."
              : `This workspace has ${live.length} of ${limit} keys. Revoke or rotate one to make room.`}
          </Banner>
        ) : null}

        {keys.isPending ? (
          <Skeleton />
        ) : keys.error ? (
          <Banner tone="error">
            The key list could not be read, so nothing is shown rather than an empty table that
            would read as &ldquo;you have none&rdquo;. {message(keys.error, "")} Existing keys are
            unaffected and still work.
          </Banner>
        ) : rows.length === 0 ? (
          <Empty
            onCreate={() => setCreating(true)}
            disabled={!enabled || !mayManage}
            denial={mayManage ? null : denial}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <KeyTable
              caption="Live keys"
              rows={live}
              busyId={busyId}
              /* Omitted rather than disabled for a reader who cannot act: the
                 column disappears instead of showing two greyed buttons per
                 row. The banner below says why once, which beats saying it
                 n times in tooltips. */
              onRotate={mayManage ? rotate : undefined}
              onRevoke={mayManage ? setRevoking : undefined}
              emptyNote="Every key in this workspace has been revoked or has expired."
            />
            {!mayManage && denial ? (
              <Text variant="caption" tone="muted" className="block leading-snug">
                {denial} You can see which keys exist and when they were last used; creating,
                rotating and revoking them is an admin action because a key can be minted to spend
                against the workspace rather than against any one member&rsquo;s budget.
              </Text>
            ) : null}
            {retired.length > 0 ? (
              <KeyTable
                caption="Revoked and expired"
                rows={retired}
                busyId={busyId}
                emptyNote=""
              />
            ) : null}
          </div>
        )}

        <UsageNote rateLimitPerMinute={keys.data?.rateLimitPerMinute ?? null} />
      </div>

      <CreateKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (created) => {
          setCreating(false);
          await refresh();
          setMinted(created);
        }}
      />

      <SecretOnceDialog value={minted} onClose={() => setMinted(null)} />

      <DestructiveConfirmDialog
        open={revoking !== null}
        title={revoking ? `Revoke ${revoking.name}?` : "Revoke this key?"}
        description={
          <>
            Every call presenting it is refused from the moment you confirm, with no grace period.
            Anything still using it — a cron, a CI job, somebody else&rsquo;s backend — starts
            failing immediately. If you are replacing it rather than killing it, close this and
            rotate instead: that keeps the old key alive for a day while you deploy the new one.
          </>
        }
        confirmLabel="Revoke the key"
        pending={busyId !== null}
        onOpenChange={(open) => { if (!open) setRevoking(null); }}
        onConfirm={() => { if (revoking) void revoke(revoking); }}
      />
    </PageContainer>
  );
}

/* ── The table ────────────────────────────────────────────────────────────── */

function KeyTable({
  caption, rows, busyId, onRotate, onRevoke, emptyNote,
}: {
  caption: string;
  rows: ApiKeyRow[];
  busyId: string | null;
  onRotate?: (row: ApiKeyRow) => void;
  onRevoke?: (row: ApiKeyRow) => void;
  emptyNote: string;
}) {
  return (
    <section className="border-subtle bg-surface-raised min-w-0 rounded-lg border">
      <header className="border-subtle border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">{caption}</Text>
      </header>

      {rows.length === 0 ? (
        <div className="p-3">
          <Text variant="body-sm" tone="secondary" className="block">{emptyNote}</Text>
        </div>
      ) : (
        /* The table scrolls inside its own box rather than widening the page.
           Seven columns of key metadata do not fit a narrow window, and a page
           that scrolls sideways loses the sidebar with it. */
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse">
            <thead>
              <tr className="border-subtle border-b">
                <Th>Name</Th>
                <Th>Prefix</Th>
                <Th>Spends as</Th>
                <Th>Last used</Th>
                <Th>Expires</Th>
                <Th>Status</Th>
                <Th align="right">{onRotate || onRevoke ? "Actions" : ""}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const busy = busyId === row.id;
                return (
                  <tr key={row.id} className="border-subtle hover:bg-surface-hover border-b last:border-b-0">
                    <Td>
                      <Text variant="body-sm" tone="primary" className="block">{row.name}</Text>
                      <Text variant="caption" tone="muted" className="mt-0.5 block">
                        Created {formatDate(row.createdAt)}
                      </Text>
                    </Td>
                    <Td>
                      {/*
                        The prefix, never the key. It exists so a row can be
                        matched to a log line; it authenticates nothing, which is
                        why it is safe to show and worth showing.
                      */}
                      <code className="font-code text-mono-sm text-fg-secondary">{row.prefix}…</code>
                    </Td>
                    <Td>
                      {row.actsAs ? (
                        <Text variant="body-sm" tone="secondary" className="block">{row.actsAs}</Text>
                      ) : (
                        <Tooltip content="An unattributed service key. Its spend is charged to the workspace and to no member's cap, which is why only an admin can mint one.">
                          <Text variant="body-sm" tone="muted" className="block">Nobody</Text>
                        </Tooltip>
                      )}
                    </Td>
                    <Td>
                      <Text variant="body-sm" tone="secondary" tabular className="block">
                        {row.lastUsedAt ? formatDate(row.lastUsedAt) : "Never"}
                      </Text>
                    </Td>
                    <Td>
                      <Text variant="body-sm" tone="secondary" tabular className="block">
                        {row.expiresAt ? formatDate(row.expiresAt) : "—"}
                      </Text>
                    </Td>
                    <Td><StatusPill row={row} /></Td>
                    <Td align="right">
                      {onRotate || onRevoke ? (
                        <span className="flex justify-end gap-1.5">
                          {onRotate ? (
                            <Tooltip content="Mints a replacement and keeps this one working for 24 hours, so you can deploy without an outage.">
                              <Button
                                size="xs"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => onRotate(row)}
                                iconLeft={<Icon icon={ArrowsClockwise} size="sm" decorative />}
                              >
                                Rotate
                              </Button>
                            </Tooltip>
                          ) : null}
                          {onRevoke ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => onRevoke(row)}
                              iconLeft={<Icon icon={Prohibit} size="sm" decorative />}
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </span>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      scope="col"
      className={cn("px-3 py-2", align === "right" ? "text-right" : "text-left")}
    >
      <Text variant="caption" tone="muted">{children}</Text>
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <td className={cn("px-3 py-2 align-top", align === "right" ? "text-right" : "text-left")}>
      {children}
    </td>
  );
}

function StatusPill({ row }: { row: ApiKeyRow }) {
  const state = row.revokedAt ? "revoked" : isExpired(row) ? "expired" : "live";
  return (
    <span
      className={cn(
        "font-ui text-caption inline-flex items-center rounded-full border px-2 py-0.5",
        state === "live" && "border-status-success-border bg-status-success-subtle text-status-success",
        state === "revoked" && "border-status-failed-border bg-status-failed-subtle text-status-failed",
        state === "expired" && "border-subtle bg-surface-sunken text-fg-muted",
      )}
    >
      {state === "live" ? "Live" : state === "revoked" ? "Revoked" : "Expired"}
    </span>
  );
}

/* ── Creating ─────────────────────────────────────────────────────────────── */

/**
 * `expiresAt` is offered as a small set of durations rather than a date picker.
 *
 * The decision somebody is actually making is "how long do I want to be exposed
 * if this leaks", and that is answered in months, not in dates. A picker turns a
 * risk judgement into a calendar exercise and gets skipped, which is how keys
 * end up immortal.
 */
const LIFETIMES = [
  { value: "0", label: "No expiry", note: "It works until somebody revokes it." },
  { value: "30", label: "30 days", note: "" },
  { value: "90", label: "90 days", note: "" },
  { value: "365", label: "A year", note: "" },
];

function CreateKeyDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreatedApiKey) => void | Promise<void>;
}) {
  const api = useApi();
  const scope = useScope();

  const [name, setName] = React.useState("");
  const [lifetime, setLifetime] = React.useState("90");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setLifetime("90");
    setError(null);
  }, [open]);

  const trimmed = name.trim();

  async function submit() {
    if (trimmed === "") return;
    setSaving(true);
    setError(null);
    try {
      const days = Number(lifetime);
      const created = await api.apiKeys.create(
        {
          name: trimmed,
          expiresAt: days > 0
            ? new Date(Date.now() + days * 86_400_000).toISOString()
            : null,
        },
        { workspaceId: scope.workspaceId, environmentId: null },
      );
      await onCreated(created);
    } catch (err) {
      setError(message(err, "The key could not be created. Nothing was issued."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }} size="md" dismissible={!saving}>
      <ModalHeader
        title="Create an API key"
        description="The key appears once, on the next screen. Nothing here or anywhere else can show it again."
        closeDisabled={saving}
      />
      <ModalBody>
        <div className="grid grid-cols-1 gap-4">
          <ModalSection title="What is it for">
            <Field
              label="Name"
              required
              description="Where it will be used, for example CI pipeline or billing-service."
            >
              <Input
                value={name}
                autoFocus
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && trimmed !== "") void submit();
                }}
                placeholder="CI pipeline"
              />
            </Field>
          </ModalSection>

          <ModalSection title="How long it lives">
            <Field
              label="Expiry"
              description="A key that expires bounds the damage a leak can do without anybody noticing it leaked."
            >
              <Select
                value={lifetime}
                onValueChange={setLifetime}
                options={LIFETIMES.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                  description: entry.note || undefined,
                }))}
              />
            </Field>
          </ModalSection>

          <ModalNote title="This key spends as you">
            It is charged against your own member budget, so it cannot spend more than you can. It
            resolves the same plan, the same quota and the same feature gates as your browser — an
            API key is another door into this workspace, never a wider one.
          </ModalNote>

          {error ? <ModalNote tone="danger" title="Not created">{error}</ModalNote> : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          loadingLabel="Creating"
          disabled={trimmed === ""}
          onClick={() => void submit()}
        >
          Create the key
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ── The one showing ──────────────────────────────────────────────────────── */

/**
 * The secret, the only time it exists outside the caller's memory.
 *
 * Deliberately NOT dismissible by Escape or an overlay click. Every other
 * dialog in the product is, and the inconsistency is the point: closing this one
 * by accident costs a key, and the recovery is to revoke and start again.
 */
function SecretOnceDialog({
  value, onClose,
}: {
  value: CreatedApiKey | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const origin = React.useMemo(() => getPublicApiBaseUrl(), []);

  React.useEffect(() => { if (value) setCopied(false); }, [value]);

  if (!value) return null;

  const example = [
    `curl \\`,
    `  '${origin}/api/runs' \\`,
    `  -H 'Authorization: Bearer ${value.secret}'`,
  ].join("\n");

  return (
    <Modal open onOpenChange={() => { /* only the button closes this */ }} size="md" dismissible={false}>
      <ModalHeader
        eyebrow={value.rotatedFrom ? "Rotated" : "Created"}
        title={value.name}
        description="Copy this now. It is stored as a hash, so there is nothing left to show you a second time."
        closeDisabled
      />
      <ModalBody>
        <div className="grid grid-cols-1 gap-4">
          <div className="min-w-0">
            <Text variant="caption" tone="muted" className="mb-1 block">The key</Text>
            <div className="border-accent-border bg-accent-subtle flex items-start gap-2 rounded-sm border p-2.5">
              <code className="font-code text-mono-sm text-fg-primary min-w-0 flex-1 break-all">
                {value.secret}
              </code>
              <Button
                size="xs"
                variant="secondary"
                aria-label="Copy the key"
                onClick={() => {
                  void navigator.clipboard.writeText(value.secret)
                    .then(() => setCopied(true))
                    .catch(() => toast.error(
                      "The clipboard is not available here. Select the key and copy it manually.",
                    ));
                }}
                iconLeft={<Icon icon={copied ? Check : Copy} size="sm" decorative />}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="min-w-0">
            <Text variant="caption" tone="muted" className="mb-1 block">Try it</Text>
            <pre className="border-subtle bg-surface-sunken min-w-0 max-w-full overflow-x-auto rounded-sm border p-2.5">
              <code className="font-code text-mono-sm text-fg-secondary whitespace-pre">{example}</code>
            </pre>
          </div>

          {value.rotatedFrom ? (
            <ModalNote tone="warning" title="The old key is still live, for now">
              {value.message
                ?? "The key this replaces keeps working for 24 hours. Deploy this one before then."}{" "}
              That overlap is what makes rotation safe to do during business hours — but it does
              end, and the old key stops working whether or not you were ready.
            </ModalNote>
          ) : null}

          <ModalNote title="If you lose it">
            There is no way to recover it and no support request that can. Revoke the key and
            create another — which is the correct answer, and is cheap.
          </ModalNote>
        </div>
      </ModalBody>
      <ModalFooter
        hint={
          !copied ? (
            <span className="flex items-start gap-1.5">
              <Icon icon={WarningCircle} size="sm" decorative className="text-status-waiting mt-px" />
              <Text variant="caption" tone="muted" className="leading-snug">
                You have not copied it yet.
              </Text>
            </span>
          ) : null
        }
      >
        <Button variant="primary" size="sm" onClick={onClose}>
          I have saved it
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────────────── */

function UsageNote({ rateLimitPerMinute }: { rateLimitPerMinute: number | null }) {
  const base = React.useMemo(() => getPublicApiBaseUrl(), []);

  return (
    <section className="border-subtle bg-surface-raised min-w-0 rounded-lg border">
      <header className="border-subtle border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">Using a key</Text>
      </header>
      <div className="grid min-w-0 grid-cols-1 gap-3 p-3">
        <div className="min-w-0">
          <pre className="border-subtle bg-surface-sunken min-w-0 max-w-full overflow-x-auto rounded-sm border p-2.5">
            <code className="font-code text-mono-sm text-fg-secondary whitespace-pre">
              {`Authorization: Bearer <your key>`}
            </code>
          </pre>
          <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
            Against <span className="font-code">{base}</span>.
          </Text>
        </div>

        {rateLimitPerMinute && rateLimitPerMinute > 0 ? (
          <Text variant="caption" tone="muted" className="block">
            Up to {rateLimitPerMinute} requests a minute per key.
          </Text>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button asChild size="xs" variant="secondary">
            <Link href={"/workflows" as Route}>Workflows you can trigger</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Empty({
  onCreate, disabled, denial,
}: {
  onCreate: () => void;
  disabled: boolean;
  denial: string | null;
}) {
  return (
    <div className="border-subtle grid place-items-center rounded-lg border border-dashed px-4 py-14">
      <div className="max-w-[46ch] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No API keys yet</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block leading-snug">
          Create a key to start runs from your backend, a scheduled job or CI.
        </Text>
        {denial ? (
          <Text variant="caption" tone="muted" className="mt-2 block leading-snug">{denial}</Text>
        ) : null}
        <div className="mt-4">
          <Button variant="primary" size="sm" disabled={disabled} onClick={onCreate}>
            Create the first key
          </Button>
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warning" | "error"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-sm border p-2.5",
        tone === "warning" && "border-status-waiting-border bg-status-waiting-subtle",
        tone === "error" && "border-status-failed-border bg-status-failed-subtle",
      )}
    >
      <Icon
        icon={WarningCircle}
        size="sm"
        decorative
        className={cn("mt-px shrink-0", tone === "warning" ? "text-status-waiting" : "text-status-failed")}
      />
      <Text variant="body-sm" tone="secondary" className="block leading-snug">{children}</Text>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="border-subtle bg-surface-raised rounded-lg border p-3" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="border-subtle flex items-center gap-3 border-b py-2.5 last:border-b-0">
          <span className="bg-surface-sunken block h-3.5 w-40 rounded-xs" />
          <span className="bg-surface-sunken block h-3.5 w-24 rounded-xs" />
          <span className="bg-surface-sunken ml-auto block h-3.5 w-20 rounded-xs" />
        </div>
      ))}
    </div>
  );
}

/* ── Derivations ──────────────────────────────────────────────────────────── */

function isExpired(row: ApiKeyRow): boolean {
  return row.expiresAt != null && Date.parse(row.expiresAt) <= Date.now();
}

function formatDate(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  return new Date(at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

/**
 * The API's own sentence when it wrote one, ours only when it did not.
 *
 * The refusals here are written to be read — "the Free plan does not include API
 * access", "'name' is required — a key nobody can identify is a key nobody will
 * revoke" — and paraphrasing them into "something went wrong" throws away the
 * only actionable part.
 */
function message(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
