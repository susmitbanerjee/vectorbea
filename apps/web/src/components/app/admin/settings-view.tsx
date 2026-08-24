"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { MonoId } from "~/components/ui/mono-id";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import { Modal, ModalBody, ModalFooter, ModalHeader, ModalLayout, ModalSection } from "~/components/ui/modal";
import { useScope } from "~/lib/workspace/workspace-provider";
import { AdminInlineState, describeAdminFailure } from "./admin-states";
import { SettingsNav } from "./settings-nav";
import { Fact, Panel, StatusLine, type SaveState } from "./settings-chrome";

/* ══════════════════════════════════════════════════════════════════════════════
   SETTINGS — GENERAL

   This screen used to state that "renaming and transfer are not exposed by any
   endpoint yet" and offer a provider on/off switch. Both were wrong in opposite
   directions: renaming needed a route nobody had written, and the switch wrote
   a Supabase table the runtime never reads — a kill switch that killed nothing.

   So: the name is editable, by an admin, against `workspaces` in the
   application database. The providers panel is a read-only inventory of the LLM
   connections this workspace can actually call, with the controls where they
   take effect. And the danger zone is real, gated on owner, and states what it
   destroys before it destroys it.

   ROLE GATING IS SHOWN, NOT ONLY ENFORCED. A viewer sees the fields disabled
   with the reason attached rather than discovering the rule from a 403.
══════════════════════════════════════════════════════════════════════════════ */

type Role = "owner" | "admin" | "developer" | "viewer";

interface WorkspaceFootprint {
  rows: { table: string; count: number }[];
  total: number;
  workflows: number;
  runs: number;
  connections: number;
  secrets: number;
  members: number;
}

interface WorkspaceSettings {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  ownerEmail: string | null;
  ownerName: string | null;
  yourRole: Role;
  footprint: WorkspaceFootprint | null;
}

interface ProviderSummary {
  id: string;
  providerType: string;
  displayName: string;
  status: string;
  networkStatus: string;
  defaultModel: string | null;
  maskedKey: string | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
}

const PROVIDER_MARK: Record<string, ProviderId> = {
  openai: "openai", azure_openai: "openai", anthropic: "anthropic",
  google: "gemini", gemini: "gemini", google_gemini: "gemini", mistral: "mistral",
};

const NAME_MAX = 80;
const SLUG_MAX = 60;

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(json.error || fallback);
    (error as Error & { code?: string }).code = json.code;
    throw error;
  }
  return json;
}

export function SettingsView() {
  const { workspaceId } = useScope();
  const queryClient = useQueryClient();

  const workspace = useQuery<WorkspaceSettings, Error>({
    queryKey: ["settings", "workspace", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      readJson<WorkspaceSettings>(
        await fetch(`/api/settings/workspace?workspaceId=${encodeURIComponent(workspaceId!)}`, {
          cache: "no-store",
        }),
        "The workspace could not be loaded",
      ),
  });

  const role = workspace.data?.yourRole ?? "viewer";
  const canRename = role === "owner" || role === "admin";
  const canDelete = role === "owner";

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Settings"
        description="This workspace's identity, the model providers it can call, and the controls that end it."
        metadata={
          workspace.data ? (
            <>
              <Text variant="caption" tone="muted">Your role</Text>
              <Text variant="caption" tone="secondary" className="capitalize">{role}</Text>
            </>
          ) : undefined
        }
      />

      <SettingsNav />

      {workspace.error ? (() => {
        const failure = describeAdminFailure(workspace.error, "workspace settings");
        return (
          <AdminInlineState
            tone={failure.tone}
            title={failure.title}
            body={failure.body}
            action={failure.retryable
              ? <Button size="xs" variant="secondary" onClick={() => void workspace.refetch()}>Retry</Button>
              : undefined}
          />
        );
      })() : null}

      <div className="grid gap-4">
        <IdentityPanel
          workspace={workspace.data}
          loading={workspace.isPending}
          canEdit={canRename}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ["settings", "workspace", workspaceId] });
            // The workspace switcher and every scoped query render the name.
            void queryClient.invalidateQueries({ queryKey: ["session", "workspaces"] });
          }}
        />

        <ProvidersPanel workspaceId={workspaceId} />

        {canDelete && workspace.data ? (
          <DangerPanel workspace={workspace.data} />
        ) : workspace.data ? (
          <Panel
            title="Danger zone"
            tone="danger"
            help="Deleting this workspace needs the owner role. Ask an owner if it needs to go."
          />
        ) : null}
      </div>
    </PageContainer>
  );
}

/* ── Identity ─────────────────────────────────────────────────────────────── */

function IdentityPanel({
  workspace, loading, canEdit, onSaved,
}: {
  workspace: WorkspaceSettings | undefined;
  loading: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { workspaceId, environmentId } = useScope();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [status, setStatus] = React.useState<SaveState>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (workspace && !loaded) {
      setName(workspace.name);
      setSlug(workspace.slug);
      setLoaded(true);
    }
  }, [workspace, loaded]);

  const save = useMutation({
    mutationFn: async () =>
      readJson<WorkspaceSettings>(
        await fetch(`/api/settings/workspace?workspaceId=${encodeURIComponent(workspaceId!)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), slug: slug.trim() }),
        }),
        "The workspace could not be saved",
      ),
    onSuccess: (next) => {
      setName(next.name);
      setSlug(next.slug);
      setStatus({ tone: "ok", text: `Saved. This workspace is now "${next.name}".` });
      onSaved();
    },
    onError: (error: Error) => setStatus({ tone: "error", text: error.message }),
  });

  const nameError =
    name.trim().length === 0 ? "A workspace needs a name."
      : name.length > NAME_MAX ? `Keep it to ${NAME_MAX} characters or fewer.`
        : undefined;
  const slugError =
    slug.trim().length === 0 ? "A slug needs at least one letter or number."
      : !/^[a-z0-9-]+$/.test(slug) ? "Lower-case letters, numbers and hyphens only."
        : undefined;

  const dirty =
    Boolean(workspace) && (name !== workspace!.name || slug !== workspace!.slug);
  const invalid = Boolean(nameError || slugError);

  return (
    <Panel
      title="Workspace"
      help="The name appears in the switcher, in invitations and on every screen. The slug is its stable handle."
      footer={
        <>
          <StatusLine
            state={status}
            resting={
              canEdit
                ? dirty
                  ? "Unsaved changes."
                  : "Renaming is recorded in the audit log with both the old and the new value."
                : "Renaming this workspace needs the admin or owner role. You can see the settings but not change them."
            }
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!canEdit || !dirty || invalid || loading}
            loading={save.isPending}
            loadingLabel="Saving"
            onClick={() => { setStatus(null); save.mutate(); }}
          >
            Save workspace
          </Button>
        </>
      }
    >
      {loading ? <IdentitySkeleton /> : null}

      {workspace ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Name"
              error={canEdit ? nameError : undefined}
              disabled={!canEdit}
              characterCount={{ value: name.length, max: NAME_MAX }}
            >
              <Input
                value={name}
                disabled={!canEdit}
                maxLength={NAME_MAX}
                onChange={(event) => { setName(event.target.value); setStatus(null); }}
              />
            </Field>
            <Field
              label="Slug"
              description="Used in links and invitations. Changing it does not redirect the old one."
              error={canEdit ? slugError : undefined}
              disabled={!canEdit}
            >
              <Input
                mono
                value={slug}
                disabled={!canEdit}
                maxLength={SLUG_MAX}
                onChange={(event) => {
                  setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                  setStatus(null);
                }}
              />
            </Field>
          </div>

          <dl className="border-subtle grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 border-t pt-3">
            <Fact label="Workspace id">
              {workspaceId ? <MonoId value={workspaceId} srLabel="Workspace id" /> : "—"}
            </Fact>
            <Fact label="Owner">
              {workspace.ownerName ?? workspace.ownerEmail ?? "Not recorded"}
            </Fact>
            <Fact label="Created">{new Date(workspace.createdAt).toLocaleDateString()}</Fact>
            <Fact label="Environment"><span className="capitalize">{environmentId}</span></Fact>
          </dl>
        </>
      ) : null}
    </Panel>
  );
}

/* ── Providers ────────────────────────────────────────────────────────────── */

function ProvidersPanel({ workspaceId }: { workspaceId: string | null }) {
  const providers = useQuery<{ providers: ProviderSummary[] }, Error>({
    queryKey: ["settings", "providers", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      readJson<{ providers: ProviderSummary[] }>(
        await fetch(`/api/settings/providers?workspaceId=${encodeURIComponent(workspaceId!)}`, {
          cache: "no-store",
        }),
        "Model providers could not be loaded",
      ),
  });

  const rows = providers.data?.providers ?? [];

  return (
    <Panel
      title="Model providers"
      help="The LLM connections this workspace can call. Enabling, testing and rotating one happens on Connections — that record is what the runtime resolves a model call through, so it is the only place a change takes effect."
      action={
        <Button asChild size="xs" variant="secondary">
          <Link href={"/connections" as Route}>
            Manage on Connections
            <Icon icon={ArrowSquareOut} size="sm" decorative className="ml-1" />
          </Link>
        </Button>
      }
    >
      {providers.isPending ? <ProviderSkeleton /> : null}

      {providers.error ? (() => {
        const failure = describeAdminFailure(providers.error, "model providers");
        return (
          <AdminInlineState
            tone={failure.tone}
            title={failure.title}
            body={failure.body}
            action={failure.retryable
              ? <Button size="xs" variant="secondary" onClick={() => void providers.refetch()}>Retry</Button>
              : undefined}
          />
        );
      })() : null}

      {providers.data && rows.length === 0 ? (
        <AdminInlineState
          tone="neutral"
          title="No model providers connected"
          body="Add an LLM connection and it appears here. Until one exists, every agent in this workspace has nothing to call."
          action={
            <Button asChild size="xs" variant="secondary">
              <Link href={"/connections" as Route}>Add a connection</Link>
            </Button>
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <ul className="border-subtle divide-subtle divide-y rounded-md border">
          {rows.map((provider) => {
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
                    {provider.defaultModel ?? "No default model"}
                    {provider.maskedKey ? ` · ${provider.maskedKey}` : " · no credential"}
                  </Text>
                </span>
                <ConnectionStatus status={provider.status} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </Panel>
  );
}

function ConnectionStatus({ status }: { status: string }) {
  const healthy = status === "healthy" || status === "ok" || status === "passed";
  const broken = status === "failed" || status === "error" || status === "unhealthy";
  return (
    <span
      className={cn(
        "font-ui text-caption shrink-0 rounded-full border px-1.5 py-0.5 capitalize",
        healthy
          ? "border-status-success-border bg-status-success-subtle text-status-success"
          : broken
            ? "border-status-failed-border bg-status-failed-subtle text-status-failed"
            : "border-subtle bg-surface-sunken text-fg-muted",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/* ── Danger zone ──────────────────────────────────────────────────────────── */

/**
 * Deletion states what it destroys, and requires the name typed back.
 *
 * "This cannot be undone" asks somebody to accept a consequence nobody has
 * named. The counts come from the same discovery the purge uses, so the dialog
 * and the delete can never describe different things — and the audit trail is
 * called out as surviving, because it does and somebody will need to know.
 */
function DangerPanel({ workspace }: { workspace: WorkspaceSettings }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState("");
  const [status, setStatus] = React.useState<SaveState>(null);

  const footprint = workspace.footprint;

  const remove = useMutation({
    mutationFn: async () =>
      readJson<{ deleted: boolean; rowsRemoved: number }>(
        await fetch(`/api/settings/workspace?workspaceId=${encodeURIComponent(workspace.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmName }),
        }),
        "The workspace could not be deleted",
      ),
    onSuccess: () => {
      setOpen(false);
      // Everything cached is scoped to a workspace that no longer exists.
      router.replace("/control" as Route);
      router.refresh();
    },
    onError: (error: Error) => setStatus({ tone: "error", text: error.message }),
  });

  return (
    <>
      <Panel
        id="danger-zone"
        title="Danger zone"
        tone="danger"
        help="Deleting this workspace removes its workflows, runs, connections and stored credentials. There is no restore."
        footer={
          <>
            <StatusLine
              state={status}
              resting={
                footprint
                  ? `${footprint.total.toLocaleString()} rows across ${footprint.rows.length} tables belong to this workspace.`
                  : "The footprint could not be counted, so deletion is not offered."
              }
            />
            <Button
              size="sm"
              variant="danger"
              disabled={!footprint}
              onClick={() => { setConfirmName(""); setStatus(null); setOpen(true); }}
            >
              Delete workspace
            </Button>
          </>
        }
      >
        {footprint ? (
          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            <FootprintItem label="Workflows" value={footprint.workflows} />
            <FootprintItem label="Runs" value={footprint.runs} />
            <FootprintItem label="Connections" value={footprint.connections} />
            <FootprintItem label="Stored credentials" value={footprint.secrets} />
            <FootprintItem label="Members" value={footprint.members} />
            <FootprintItem label="Rows in total" value={footprint.total} />
          </ul>
        ) : null}
      </Panel>

      <Modal open={open} onOpenChange={(next) => { if (!next && !remove.isPending) setOpen(false); }} size="md">
        <ModalHeader
          eyebrow="Govern · Settings"
          title={`Delete "${workspace.name}"?`}
          description="This removes the workspace and everything scoped to it."
        />
        <ModalLayout>
          <ModalBody>
            <div className="grid gap-4">
              <ModalSection title="What goes">
                <ul className="border-subtle divide-subtle divide-y rounded-md border">
                  {(footprint?.rows ?? []).slice(0, 8).map((row) => (
                    <li key={row.table} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                      <Text variant="mono-sm" tone="secondary" className="truncate">{row.table}</Text>
                      <Text variant="caption" tone="primary" tabular>{row.count.toLocaleString()}</Text>
                    </li>
                  ))}
                </ul>
                {(footprint?.rows.length ?? 0) > 8 ? (
                  <Text variant="caption" tone="muted" className="mt-1.5 block">
                    …and {(footprint!.rows.length - 8).toLocaleString()} more tables.
                  </Text>
                ) : null}
              </ModalSection>

              <ModalSection title="What stays">
                <Text variant="body-sm" tone="secondary" className="block leading-snug">
                  The audit log. It is append-only and refuses deletion at the database, so the record of
                  what happened in this workspace — including this deletion — survives it. That is
                  deliberate, and it is the answer to give a compliance reviewer who asks.
                </Text>
              </ModalSection>

              <Field
                label={`Type "${workspace.name}" to confirm`}
                description="The name is checked on the server, not only here."
              >
                <Input
                  value={confirmName}
                  autoComplete="off"
                  disabled={remove.isPending}
                  onChange={(event) => { setConfirmName(event.target.value); setStatus(null); }}
                />
              </Field>

              {status?.tone === "error" ? (
                <AdminInlineState tone="failed" title="The workspace was not deleted" body={status.text} />
              ) : null}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="secondary" disabled={remove.isPending} onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={confirmName !== workspace.name}
              loading={remove.isPending}
              loadingLabel="Deleting"
              onClick={() => { setStatus(null); remove.mutate(); }}
            >
              Delete permanently
            </Button>
          </ModalFooter>
        </ModalLayout>
      </Modal>
    </>
  );
}

function FootprintItem({ label, value }: { label: string; value: number }) {
  return (
    <li className="border-subtle bg-surface-sunken flex items-baseline justify-between gap-2 rounded-md border px-2.5 py-1.5">
      <Text variant="caption" tone="secondary">{label}</Text>
      <Text variant="body-sm" tone="max" tabular>{value.toLocaleString()}</Text>
    </li>
  );
}

/* ── Loading ──────────────────────────────────────────────────────────────── */

function IdentitySkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2" aria-hidden="true">
      {[0, 1].map((row) => (
        <div key={row} className="grid gap-1.5">
          <div className="bg-surface-active h-3 w-20 animate-pulse rounded-xs" />
          <div className="bg-surface-active h-8 w-full animate-pulse rounded-md" />
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
          <div className="bg-surface-active h-4 w-16 shrink-0 animate-pulse rounded-full" />
        </div>
      ))}
    </div>
  );
}
