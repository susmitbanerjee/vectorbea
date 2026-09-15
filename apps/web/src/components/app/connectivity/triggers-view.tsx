"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { contracts } from "@vectorbea/shared";
import {
  Plus, Copy, Check, WarningCircle, ArrowsClockwise, Clock, Globe, Broadcast,
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
import type { IconComponent } from "~/components/icons/types";
import { RelativeTime } from "~/components/app/workflows/atoms";
import {
  Modal, ModalBody, ModalDivider, ModalFooter, ModalHeader, ModalNote, ModalSection,
} from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { useSearchParamWriter } from "~/lib/url/use-search-param-writer";
import { useSearchParams } from "next/navigation";
import type { EventTriggerRow, WebhookRow } from "~/lib/api/client";

/* ══════════════════════════════════════════════════════════════════════════════
   TRIGGERS — every way a run can start.

   ── WHAT THIS PAGE USED TO BE ───────────────────────────────────────────────
   A table of cron schedules, under a heading that said "schedules, webhooks and
   manual starts unified". Two thirds of that sentence was aspirational.
   `WebhookRoutes` and `EventTriggerRoutes` are complete — create, rotate,
   enable, disable, replay a delivery — and had no client method and no screen,
   so the only way to start a workflow from a third party was to read the route
   handler and construct the call by hand.

   The effect was that Vectorbea looked like a product whose workflows run on a
   timer or when a person presses Run. Everything else it can do was invisible.

   ── THE FOUR WAYS, AND WHY THEY ARE ONE PAGE ────────────────────────────────
   Schedule · Webhook · Event · API. They are four answers to one question —
   what makes this run — and somebody deciding between them is comparing them,
   so putting each behind its own navigation item would make the comparison a
   memory exercise. The API row is informational: there is nothing to configure,
   which is itself the useful fact, and the endpoint is on each workflow's page.

   ── A WEBHOOK URL IS A CREDENTIAL ───────────────────────────────────────────
   It is pasted into somebody else's console, which makes it a bearer token for
   "may enqueue work in this workspace" even with a signature on top. The API
   returns it exactly twice — on create and on rotate — and this screen is built
   around that: the url is shown once, prominently, with a copy button and a
   sentence saying it will not be shown again.
══════════════════════════════════════════════════════════════════════════════ */

type Kind = "schedule" | "webhook" | "event";

export function TriggersView() {
  const api = useApi();
  const scope = useScope();
  const params = useSearchParams();
  const setParams = useSearchParamWriter();
  const queryClient = useQueryClient();

  const keyScope = { workspaceId: scope.workspaceId, environmentId: null };
  const readScope = React.useMemo(
    () => ({ workspaceId: scope.workspaceId, environmentId: null }),
    [scope.workspaceId],
  );
  const enabled = Boolean(scope.workspaceId);

  const schedules = useApiQuery({
    queryKey: [...queryKeys.env(scope.workspaceId, null), "schedules"] as const,
    queryFn: () => api.schedules.list(readScope),
    enabled,
    freshness: "live",
  });
  const webhooks = useApiQuery({
    queryKey: [...queryKeys.env(scope.workspaceId, null), "webhooks"] as const,
    queryFn: () => api.webhooks.list(readScope),
    enabled,
  });
  const events = useApiQuery({
    queryKey: [...queryKeys.env(scope.workspaceId, null), "event-triggers"] as const,
    queryFn: () => api.eventTriggers.list(readScope),
    enabled,
  });
  const workflows = useApiQuery({
    queryKey: queryKeys.workflows.list(keyScope, { page: 1, pageSize: 100 }),
    queryFn: () => api.workflows.list({ ...readScope, page: 1, pageSize: 100 }),
    enabled,
  });

  const creating = params.get("create") as Kind | null;
  const [newUrl, setNewUrl] = React.useState<{ name: string; url: string } | null>(null);

  const workflowName = React.useCallback(
    (id: string) => workflows.data?.items.find((w) => w.id === id)?.name ?? id,
    [workflows.data],
  );

  const refresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...queryKeys.env(scope.workspaceId, null), "webhooks"] }),
      queryClient.invalidateQueries({ queryKey: [...queryKeys.env(scope.workspaceId, null), "event-triggers"] }),
    ]);
  }, [queryClient, scope.workspaceId]);

  const anyLoading = schedules.isPending || webhooks.isPending || events.isPending;
  const scheduleRows = schedules.data ?? [];
  const webhookRows = webhooks.data?.items ?? [];
  const eventRows = events.data?.items ?? [];
  const total = scheduleRows.length + webhookRows.length + eventRows.length;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Connect"
        title="Triggers"
        description="Ways a workflow can start."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setParams({ create: "event" })}>
              Subscribe to a broker
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setParams({ create: "webhook" })}
              iconLeft={<Icon icon={Plus} size="sm" decorative />}
            >
              New webhook
            </Button>
          </>
        }
      />

      <div className="grid gap-4">
        {/* The API row: nothing to configure, which is the fact worth showing. */}
        <ApiTriggerRow />

        <Group
          icon={Globe}
          title="Webhooks"
          help="A URL another service calls to start a workflow."
          count={webhookRows.length}
          loading={webhooks.isPending}
          error={webhooks.error}
          empty="No webhooks yet. Creating one gives you a URL to paste into the other system's console."
          onCreate={() => setParams({ create: "webhook" })}
          createLabel="New webhook"
        >
          {webhookRows.map((hook) => (
            <WebhookRowView
              key={hook.id}
              hook={hook}
              workflowName={workflowName(hook.workflowId)}
              onToggle={async (next) => {
                await api.webhooks.setEnabled(hook.id, next, readScope);
                toast.success(next ? `${hook.name} is receiving again.` : `${hook.name} is paused.`);
                await refresh();
              }}
              onRotate={async () => {
                const result = await api.webhooks.rotate(hook.id, readScope);
                setNewUrl({ name: hook.name, url: result.url });
                await refresh();
              }}
              onDelete={async () => {
                await api.webhooks.remove(hook.id, readScope);
                toast.success(`${hook.name} deleted. Calls to its URL are refused from now on.`);
                await refresh();
              }}
            />
          ))}
        </Group>

        <Group
          icon={Broadcast}
          title="Events"
          help="Start a workflow from Kafka, SQS or Pub/Sub messages."
          count={eventRows.length}
          loading={events.isPending}
          error={events.error}
          empty="No broker subscriptions. Use one when the event already exists on a queue rather than arriving over HTTP."
          onCreate={() => setParams({ create: "event" })}
          createLabel="Subscribe"
        >
          {eventRows.map((trigger) => (
            <EventRowView
              key={trigger.id}
              trigger={trigger}
              workflowName={workflowName(trigger.workflowId)}
              onToggle={async (next) => {
                await api.eventTriggers.setEnabled(trigger.id, next, readScope);
                toast.success(next ? `${trigger.name} is consuming again.` : `${trigger.name} is paused.`);
                await refresh();
              }}
              onDelete={async () => {
                await api.eventTriggers.remove(trigger.id, readScope);
                toast.success(`${trigger.name} deleted.`);
                await refresh();
              }}
            />
          ))}
        </Group>

        <Group
          icon={Clock}
          title="Schedules"
          help="Created when you publish a workflow with a schedule."
          count={scheduleRows.length}
          loading={schedules.isPending}
          error={schedules.error}
          empty="No scheduled triggers. Add a cron trigger to a workflow version and publish it."
        >
          {scheduleRows.map((schedule) => (
            <ScheduleRowView
              key={schedule.id}
              schedule={schedule}
              onToggle={async (next) => {
                await api.schedules.setEnabled(schedule.id, next, readScope);
                await schedules.refetch();
              }}
            />
          ))}
        </Group>

        {!anyLoading && total === 0 ? (
          <div className="border-subtle grid place-items-center rounded-lg border border-dashed px-4 py-10">
            <div className="max-w-[36rem] text-center">
              <Text variant="body-sm" tone="secondary" className="block leading-snug">
                Nothing starts a run automatically yet. Every workflow is already callable over the
                API — its endpoint is on its own page — and a webhook is the way to let something
                else do the calling.
              </Text>
            </div>
          </div>
        ) : null}
      </div>

      <CreateWebhookDialog
        open={creating === "webhook"}
        workflows={workflows.data?.items ?? []}
        onClose={() => setParams({ create: null })}
        onCreated={async (row) => {
          setParams({ create: null });
          setNewUrl({ name: row.name, url: row.url });
          await refresh();
        }}
      />

      <CreateEventTriggerDialog
        open={creating === "event"}
        workflows={workflows.data?.items ?? []}
        onClose={() => setParams({ create: null })}
        onCreated={async (row) => {
          setParams({ create: null });
          toast.success(`${row.name} is subscribed. Consuming starts within thirty seconds.`);
          await refresh();
        }}
      />

      <UrlOnceDialog value={newUrl} onClose={() => setNewUrl(null)} />
    </PageContainer>
  );
}

/* ── Groups and rows ──────────────────────────────────────────────────────── */

function Group({
  icon, title, help, count, loading, error, empty, children, onCreate, createLabel,
}: {
  icon: IconComponent;
  title: string;
  help: string;
  count: number;
  loading: boolean;
  error: Error | null;
  empty: string;
  children: React.ReactNode;
  onCreate?: () => void;
  createLabel?: string;
}) {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border">
      <div className="border-subtle flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2.5">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5">
            <Icon icon={icon} size="sm" decorative className="text-fg-muted" />
            <Text variant="label" tone="primary">{title}</Text>
            {!loading ? <Text variant="caption" tone="muted" tabular>{count}</Text> : null}
          </span>
          <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{help}</Text>
        </div>
        {onCreate ? (
          <Button size="xs" variant="secondary" onClick={onCreate}>{createLabel}</Button>
        ) : null}
      </div>

      <div className="divide-subtle divide-y">
        {loading ? (
          <div className="px-3 py-3" aria-hidden>
            <span className="bg-surface-sunken block h-3.5 w-2/3 rounded-xs" />
          </div>
        ) : error ? (
          <div className="px-3 py-3">
            <Text variant="body-sm" tone="secondary" className="block leading-snug">
              This list could not be read. {error.message} The triggers themselves are unaffected.
            </Text>
          </div>
        ) : count === 0 ? (
          <div className="px-3 py-3">
            <Text variant="body-sm" tone="secondary" className="block leading-snug">{empty}</Text>
          </div>
        ) : children}
      </div>
    </section>
  );
}

function ApiTriggerRow() {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border px-3 py-2.5">
      <span className="flex items-center gap-1.5">
        <Icon icon={ArrowsClockwise} size="sm" decorative className="text-fg-muted" />
        <Text variant="label" tone="primary">API</Text>
        <Text variant="caption" tone="muted">always on</Text>
      </span>
      <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
        Every workflow is an HTTP endpoint without any configuration —{" "}
        <span className="font-code">POST /api/workflows/&#123;id&#125;/run</span> with an API key. The
        exact call, and the three response modes, are on each workflow&rsquo;s own page.
      </Text>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild size="xs" variant="secondary">
          <Link href={"/workflows" as Route}>Pick a workflow</Link>
        </Button>
        <Button asChild size="xs" variant="ghost">
          <Link href={"/api-keys" as Route}>API keys</Link>
        </Button>
      </div>
    </section>
  );
}

function RowShell({
  title, workflowName, meta, enabled, warning, actions,
}: {
  title: React.ReactNode;
  workflowName: string;
  meta: React.ReactNode;
  enabled: boolean;
  warning?: string | null;
  actions: React.ReactNode;
}) {
  return (
    <div className={cn("px-3 py-2.5", !enabled && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Text variant="body-sm" tone="primary" className="font-medium">{title}</Text>
            <Text variant="caption" tone="muted">→ {workflowName}</Text>
            {!enabled ? <Text variant="caption" className="text-status-waiting">paused</Text> : null}
          </span>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">{meta}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      </div>

      {/* A trigger the SERVER disabled says why. "My events stopped arriving"
          is otherwise unanswerable from this screen. */}
      {warning ? (
        <div className="border-status-failed-border bg-status-failed-subtle mt-2 flex items-start gap-1.5 rounded-sm border p-2">
          <Icon icon={WarningCircle} size="sm" decorative className="text-status-failed mt-px shrink-0" />
          <Text variant="caption" tone="secondary" className="min-w-0 leading-snug">{warning}</Text>
        </div>
      ) : null}
    </div>
  );
}

function WebhookRowView({
  hook, workflowName, onToggle, onRotate, onDelete,
}: {
  hook: WebhookRow;
  workflowName: string;
  onToggle: (next: boolean) => Promise<void>;
  onRotate: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = (key: string, go: () => Promise<void>) => {
    setBusy(key);
    void go()
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "That did not work."))
      .finally(() => setBusy(null));
  };

  return (
    <RowShell
      title={hook.name}
      workflowName={workflowName}
      enabled={hook.enabled}
      meta={
        <>
          {/* Signed or not is the security fact about a webhook, so it leads. */}
          {hook.signed ? (
            <Text variant="caption" tone="secondary">Signed · {hook.signatureScheme}</Text>
          ) : (
            <Tooltip content="Anybody who learns the URL can start this workflow. Add a signing secret if the sender supports one.">
              <span>
                <Text variant="caption" className="text-status-waiting">Unsigned</Text>
              </span>
            </Tooltip>
          )}
          {hook.eventTypes.length > 0 ? (
            <Text variant="caption" tone="muted">{hook.eventTypes.length} event type{hook.eventTypes.length === 1 ? "" : "s"}</Text>
          ) : null}
          {hook.runDedupPath ? (
            <Text variant="caption" tone="muted">deduped on {hook.runDedupPath}</Text>
          ) : null}
          <Text variant="caption" tone="muted">
            created <RelativeTime iso={hook.createdAt} />
          </Text>
        </>
      }
      actions={
        <>
          <Button size="xs" variant="ghost" loading={busy === "rotate"} onClick={() => run("rotate", onRotate)}>
            Rotate URL
          </Button>
          <Button size="xs" variant="secondary" loading={busy === "toggle"} onClick={() => run("toggle", () => onToggle(!hook.enabled))}>
            {hook.enabled ? "Pause" : "Resume"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-status-failed"
            loading={busy === "delete"}
            onClick={() => {
              if (window.confirm(
                `Delete ${hook.name}? Its URL stops working immediately, and anything still calling it gets a 404.`,
              )) run("delete", onDelete);
            }}
          >
            Delete
          </Button>
        </>
      }
    />
  );
}

function EventRowView({
  trigger, workflowName, onToggle, onDelete,
}: {
  trigger: EventTriggerRow;
  workflowName: string;
  onToggle: (next: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = (key: string, go: () => Promise<void>) => {
    setBusy(key);
    void go()
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "That did not work."))
      .finally(() => setBusy(null));
  };

  return (
    <RowShell
      title={trigger.name}
      workflowName={workflowName}
      enabled={trigger.enabled}
      warning={
        trigger.disabledReason
          ? `Stopped by the consumer: ${trigger.disabledReason}`
          : trigger.lastError
            ? `Last error: ${trigger.lastError}`
            : null
      }
      meta={
        <>
          <Text variant="caption" tone="secondary" className="uppercase">{trigger.broker}</Text>
          <Text variant="caption" tone="muted" className="font-code">{trigger.source}</Text>
          {trigger.consumerGroup ? (
            <Text variant="caption" tone="muted">group {trigger.consumerGroup}</Text>
          ) : null}
          <Text variant="caption" tone="muted" tabular>
            {trigger.messagesConsumed} consumed
          </Text>
          {trigger.lastMessageAt ? (
            <Text variant="caption" tone="muted">last <RelativeTime iso={trigger.lastMessageAt} /></Text>
          ) : (
            <Text variant="caption" tone="muted">nothing yet</Text>
          )}
        </>
      }
      actions={
        <>
          <Button size="xs" variant="secondary" loading={busy === "toggle"} onClick={() => run("toggle", () => onToggle(!trigger.enabled))}>
            {trigger.enabled ? "Pause" : "Resume"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-status-failed"
            loading={busy === "delete"}
            onClick={() => {
              if (window.confirm(`Delete ${trigger.name}? Consuming stops within thirty seconds.`)) {
                run("delete", onDelete);
              }
            }}
          >
            Delete
          </Button>
        </>
      }
    />
  );
}

function ScheduleRowView({
  schedule, onToggle,
}: {
  schedule: contracts.Schedule;
  onToggle: (next: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const active = schedule.status === "ACTIVE";

  return (
    <RowShell
      title={<span className="font-code">{schedule.cron}</span>}
      workflowName={schedule.jobName}
      enabled={active}
      meta={
        <>
          <Text variant="caption" tone="muted">{schedule.timezone}</Text>
          <Text variant="caption" tone="muted">
            last {schedule.lastRun ? <RelativeTime iso={schedule.lastRun} /> : "never"}
          </Text>
          <Text variant="caption" tone="secondary">
            next {schedule.nextRun ? <RelativeTime iso={schedule.nextRun} /> : "not scheduled"}
          </Text>
        </>
      }
      actions={
        <Button
          size="xs"
          variant="secondary"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void onToggle(!active).finally(() => setBusy(false));
          }}
        >
          {active ? "Pause" : "Resume"}
        </Button>
      }
    />
  );
}

/* ── Create a webhook ─────────────────────────────────────────────────────── */

function CreateWebhookDialog({
  open, workflows, onClose, onCreated,
}: {
  open: boolean;
  workflows: contracts.Workflow[];
  onClose: () => void;
  onCreated: (row: WebhookRow & { url: string }) => Promise<void>;
}) {
  const api = useApi();
  const scope = useScope();

  const [workflowId, setWorkflowId] = React.useState("");
  const [name, setName] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [signatureHeader, setSignatureHeader] = React.useState("");
  const [eventTypePath, setEventTypePath] = React.useState("");
  const [eventTypes, setEventTypes] = React.useState("");
  const [dedupePath, setDedupePath] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setWorkflowId(""); setName(""); setSecret(""); setSignatureHeader("");
    setEventTypePath(""); setEventTypes(""); setDedupePath("");
    setError(null);
  }, [open]);

  if (!open) return null;

  const trimmedName = name.trim();
  const ready = Boolean(workflowId) && Boolean(trimmedName);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const row = await api.webhooks.create({
        workflowId,
        name: trimmedName,
        signingSecret: secret.trim() || null,
        signatureHeader: signatureHeader.trim() || null,
        eventTypePath: eventTypePath.trim() || null,
        eventTypes: eventTypes.split(",").map((s) => s.trim()).filter(Boolean),
        dedupePath: dedupePath.trim() || null,
      }, { workspaceId: scope.workspaceId, environmentId: null });
      await onCreated(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The webhook was not created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onOpenChange={(next) => { if (!next && !saving) onClose(); }} dismissible={!saving} size="lg">
      <ModalHeader
        eyebrow="Connect · Triggers"
        title="New webhook"
        description="A URL you paste into another system. When it calls, this workflow runs."
        closeDisabled={saving}
      />
      <ModalBody>
        <div className="grid gap-4">
          <ModalSection title="What it starts">
            <Field label="Workflow" required>
              <Select
                value={workflowId}
                onValueChange={(next) => {
                  setWorkflowId(next);
                  if (!name.trim()) {
                    const wf = workflows.find((w) => w.id === next);
                    if (wf) setName(`${wf.name} webhook`);
                  }
                }}
                options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                placeholder="Pick a workflow"
              />
            </Field>
            <Field label="Name" required description="Yours, for this list. The sender never sees it.">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
          </ModalSection>

          <ModalDivider />

          <ModalSection
            title="Signature"
            description="Recommended. Without it, anyone with the URL can start this workflow."
          >
            <Field
              label="Signing secret"
              description="The signing secret from the sender. Never shown again."
            >
              <Input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Leave empty for an unsigned webhook"
                className="font-code text-mono-sm"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Signature header"
              description="For example X-Slack-Signature, Stripe-Signature or X-Hub-Signature-256."
            >
              <Input
                value={signatureHeader}
                onChange={(e) => setSignatureHeader(e.target.value)}
                placeholder="X-Slack-Signature"
                className="font-code text-mono-sm"
              />
            </Field>
          </ModalSection>

          <ModalDivider />

          <ModalSection
            title="Filtering and deduplication"
            description="Optional. Only these events start a run."
          >
            <Field
              label="Event type path"
              description="Where the event type is in the body, for example event.type."
            >
              <Input
                value={eventTypePath}
                onChange={(e) => setEventTypePath(e.target.value)}
                placeholder="event.type"
                className="font-code text-mono-sm"
              />
            </Field>
            <Field
              label="Only these types"
              description="Comma separated. Other events are ignored."
            >
              <Input
                value={eventTypes}
                onChange={(e) => setEventTypes(e.target.value)}
                placeholder="app_mention, message.channels"
                className="font-code text-mono-sm"
              />
            </Field>
            <Field
              label="Deduplicate on"
              description="The sender's event id, so a repeated delivery does not run twice."
            >
              <Input
                value={dedupePath}
                onChange={(e) => setDedupePath(e.target.value)}
                placeholder="event_id"
                className="font-code text-mono-sm"
              />
            </Field>
          </ModalSection>

          <ModalNote title="Slack, specifically">
            Point Slack&rsquo;s Event Subscriptions at the URL this creates, set the signature header
            to <span className="font-code">X-Slack-Signature</span>, filter to{" "}
            <span className="font-code">app_mention</span>, and deduplicate on{" "}
            <span className="font-code">event_id</span>. Slack retries three times on anything but a
            fast 200, which is what the deduplication is for.
          </ModalNote>

          {error ? (
            <ModalNote tone="danger" title="The webhook was not created">{error}</ModalNote>
          ) : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          loadingLabel="Creating"
          disabled={!ready}
          onClick={() => void create()}
        >
          Create webhook
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ── Create an event trigger ──────────────────────────────────────────────── */

const BROKERS = [
  { value: "kafka", label: "Kafka", sourceLabel: "Topic", placeholder: "orders.created" },
  { value: "sqs", label: "Amazon SQS", sourceLabel: "Queue URL", placeholder: "https://sqs.eu-west-1.amazonaws.com/…/orders" },
  { value: "pubsub", label: "Google Pub/Sub", sourceLabel: "Subscription", placeholder: "projects/acme/subscriptions/orders" },
];

function CreateEventTriggerDialog({
  open, workflows, onClose, onCreated,
}: {
  open: boolean;
  workflows: contracts.Workflow[];
  onClose: () => void;
  onCreated: (row: EventTriggerRow) => Promise<void>;
}) {
  const api = useApi();
  const scope = useScope();

  const [workflowId, setWorkflowId] = React.useState("");
  const [name, setName] = React.useState("");
  const [broker, setBroker] = React.useState("kafka");
  const [source, setSource] = React.useState("");
  const [consumerGroup, setConsumerGroup] = React.useState("");
  const [dedupePath, setDedupePath] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setWorkflowId(""); setName(""); setBroker("kafka"); setSource("");
    setConsumerGroup(""); setDedupePath(""); setError(null);
  }, [open]);

  if (!open) return null;

  const spec = BROKERS.find((b) => b.value === broker) ?? BROKERS[0];
  const ready = Boolean(workflowId) && Boolean(name.trim()) && Boolean(source.trim());

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const row = await api.eventTriggers.create({
        workflowId,
        name: name.trim(),
        broker,
        source: source.trim(),
        consumerGroup: consumerGroup.trim() || null,
        dedupePath: dedupePath.trim() || null,
      }, { workspaceId: scope.workspaceId, environmentId: null });
      await onCreated(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The subscription was not created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onOpenChange={(next) => { if (!next && !saving) onClose(); }} dismissible={!saving} size="lg">
      <ModalHeader
        eyebrow="Connect · Triggers"
        title="Subscribe to a broker"
        description="Start runs from messages on your queue."
        closeDisabled={saving}
      />
      <ModalBody>
        <div className="grid gap-4">
          <ModalSection title="What it starts">
            <Field label="Workflow" required>
              <Select
                value={workflowId}
                onValueChange={(next) => {
                  setWorkflowId(next);
                  if (!name.trim()) {
                    const wf = workflows.find((w) => w.id === next);
                    if (wf) setName(`${wf.name} subscription`);
                  }
                }}
                options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                placeholder="Pick a workflow"
              />
            </Field>
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
          </ModalSection>

          <ModalDivider />

          <ModalSection title="Where the messages are">
            <Field label="Broker" required>
              <Select
                value={broker}
                onValueChange={setBroker}
                options={BROKERS.map((b) => ({ value: b.value, label: b.label }))}
              />
            </Field>
            <Field label={spec.sourceLabel} required>
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={spec.placeholder}
                className="font-code text-mono-sm"
              />
            </Field>
            <Field
              label="Consumer group"
              description="Kafka and Pub/Sub only. Use a dedicated group."
            >
              <Input
                value={consumerGroup}
                onChange={(e) => setConsumerGroup(e.target.value)}
                placeholder="vectorbea-orders"
                className="font-code text-mono-sm"
              />
            </Field>
            <Field
              label="Deduplicate on"
              description="The message id, so a repeated message does not run twice."
            >
              <Input
                value={dedupePath}
                onChange={(e) => setDedupePath(e.target.value)}
                placeholder="id"
                className="font-code text-mono-sm"
              />
            </Field>
          </ModalSection>

          <ModalNote title="It starts within thirty seconds">
            The consumer picks new subscriptions up on its next sweep, so this needs no deploy — and
            pausing one stops it just as quickly, which is the direction that matters during an
            incident.
          </ModalNote>

          {error ? (
            <ModalNote tone="danger" title="The subscription was not created">{error}</ModalNote>
          ) : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          loadingLabel="Subscribing"
          disabled={!ready}
          onClick={() => void create()}
        >
          Subscribe
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ── The URL, once ────────────────────────────────────────────────────────── */

/**
 * A webhook url, shown the only time it can be.
 *
 * The API returns it on create and on rotate and never again, because it is a
 * bearer credential for "may enqueue work in this workspace". A dialog rather
 * than a row in the table: this has to be copied NOW, and a value that quietly
 * scrolls past in a list is one somebody has to rotate to get back.
 */
function UrlOnceDialog({
  value, onClose,
}: {
  value: { name: string; url: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  if (!value) return null;

  return (
    <Modal open onOpenChange={(next) => { if (!next) onClose(); }} size="lg">
      <ModalHeader
        eyebrow="Connect · Triggers"
        title={`${value.name} is live`}
        description="Copy this URL now. It is only shown once."
      />
      <ModalBody>
        <div className="grid gap-3">
          <div className="border-subtle bg-surface-sunken flex items-center gap-2 rounded-sm border p-2.5">
            <code className="font-code text-mono-sm text-fg-secondary min-w-0 flex-1 break-all">
              {value.url}
            </code>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(value.url)
                  .then(() => setCopied(true))
                  .catch(() => toast.error("The clipboard is not available here. Select the URL and copy it."));
              }}
              iconLeft={<Icon icon={copied ? Check : Copy} size="sm" decorative />}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <ModalNote title="Treat it like a password">
            Anyone who has this URL can start the workflow. A signing secret narrows that to
            somebody who can also sign the request, which is why it is worth setting whenever the
            sender supports one.
          </ModalNote>
        </div>
      </ModalBody>
      <ModalFooter>
        <span />
        <Button variant="primary" size="sm" onClick={onClose}>I have copied it</Button>
      </ModalFooter>
    </Modal>
  );
}
