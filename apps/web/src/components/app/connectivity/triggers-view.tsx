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
import { Switch } from "~/components/ui/choice";
import { DetailSheet, Section, Facts } from "~/components/app/registry/detail-sheet";
import { RateCell } from "~/components/app/registry/atoms";
import { RelativeTime, TriggerGlyph, EnvironmentChip } from "~/components/app/workflows/atoms";
import { formatCost, formatDuration, EMPTY } from "~/lib/format";
import {
  TRIGGER_RECORDS, triggerById, calendar, describeCron, observesDst,
  backfillEstimate, OVERLAP_LABEL, OVERLAP_HELP,
  type TriggerRecord, type OverlapPolicy,
} from "~/mocks/connectivity";
import type { TriggerKind } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   TRIGGERS — schedules, webhooks and manual runs on one surface.

   They were three things in three places, and webhooks had nowhere at all
   despite shipping. They belong together because they answer one question —
   what causes this workflow to run — and because the operational concerns are
   shared: is it on, when did it last fire, did it work.

   THE CALENDAR IS THE ADDITION. Three workflows all set to 06:00 look like
   three unremarkable rows and like one crowded hour. Collisions and quiet
   periods are only visible across schedules, never within one.
══════════════════════════════════════════════════════════════════════════════ */

const TYPES: (TriggerKind | "all")[] = ["all", "schedule", "webhook", "manual", "api"];

const TYPE_LABEL: Record<TriggerKind, string> = {
  schedule: "Schedule",
  webhook: "Webhook",
  manual: "Manual",
  api: "API",
};

export function TriggersView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const type = (params.get("type") ?? "all") as TriggerKind | "all";
  const view = params.get("view") ?? "list";
  const openId = params.get("trigger");
  const detailTab = params.get("tab") ?? "config";
  const backfillId = params.get("backfill");

  const setParams = React.useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "" || value === "all" || value === "list") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
  }, [params, pathname, router]);

  const rows = React.useMemo(
    () => TRIGGER_RECORDS.filter((t) => type === "all" || t.type === type)
      .sort((a, b) => {
        // Next to fire, first. A trigger list is read forwards in time.
        const an = a.nextFires[0] ? Date.parse(a.nextFires[0]) : Number.MAX_SAFE_INTEGER;
        const bn = b.nextFires[0] ? Date.parse(b.nextFires[0]) : Number.MAX_SAFE_INTEGER;
        return an - bn;
      }),
    [type],
  );

  const open = openId ? triggerById(openId) ?? null : null;
  const backfilling = backfillId ? triggerById(backfillId) ?? null : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Connect"
        title="Triggers"
        description="Everything that causes a workflow to run — schedules, webhooks and manual starts, in one place."
        actions={
          <div role="group" aria-label="View" className="border-subtle bg-surface-raised flex items-center gap-0.5 rounded-md border p-0.5">
            {(["list", "calendar"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setParams({ view: v })}
                aria-pressed={view === v}
                className={cn(
                  "font-ui text-caption rounded-xs px-2 py-1 capitalize",
                  "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  view === v ? "bg-surface-active text-fg-primary" : "text-fg-muted hover:text-fg-primary",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-3">
        <div role="group" aria-label="Trigger type" className="flex flex-wrap items-center gap-1.5">
          {TYPES.map((t) => {
            const active = type === t;
            const count = t === "all" ? TRIGGER_RECORDS.length : TRIGGER_RECORDS.filter((x) => x.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setParams({ type: t })}
                aria-pressed={active}
                className={cn(
                  "font-ui text-caption inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                  "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  active
                    ? "bg-accent-subtle border-accent-border text-accent"
                    : "bg-surface-raised border-subtle text-fg-secondary hover:border-default",
                )}
              >
                {t === "all" ? "All" : TYPE_LABEL[t]}
                <span className="font-code text-fg-muted text-[10px] tabular">{count}</span>
              </button>
            );
          })}
        </div>

        {view === "calendar" ? (
          <CalendarView onOpen={(id) => setParams({ trigger: id })} />
        ) : (
          <TriggerList rows={rows} onOpen={(id) => setParams({ trigger: id })} />
        )}
      </div>

      <TriggerDetail
        trigger={open}
        onClose={() => setParams({ trigger: null, tab: null })}
        tab={detailTab}
        onTabChange={(id) => setParams({ tab: id })}
        onBackfill={(id) => setParams({ trigger: null, backfill: id })}
      />
      <BackfillDialog trigger={backfilling} onClose={() => setParams({ backfill: null })} />
    </PageContainer>
  );
}

/* ── List ─────────────────────────────────────────────────────────────────── */

function TriggerList({ rows, onOpen }: { rows: TriggerRecord[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) {
    return (
      <div className="border-subtle grid place-items-center rounded-lg border border-dashed px-4 py-14">
        <div className="max-w-[34rem] text-center">
          <Text variant="heading-sm" tone="max" as="p" className="block">No triggers of this type</Text>
          <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
            A workflow with no trigger only runs when somebody presses run. Add a schedule for
            recurring work, or a webhook to start on an event from another system.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className="border-subtle bg-surface-raised overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[54rem]">
        <caption className="sr-only">Triggers</caption>
        <thead>
          <tr className="border-subtle bg-surface-sunken text-fg-muted font-ui text-eyebrow border-b uppercase">
            <th scope="col" className="px-3 py-2 text-left font-normal">Workflow</th>
            <th scope="col" className="px-3 py-2 text-left font-normal">Type</th>
            <th scope="col" className="px-3 py-2 text-left font-normal">Schedule</th>
            <th scope="col" className="px-3 py-2 text-left font-normal">Next fire</th>
            <th scope="col" className="px-3 py-2 text-left font-normal">Last fire</th>
            <th scope="col" className="px-3 py-2 text-right font-normal">Success</th>
            <th scope="col" className="px-3 py-2 text-right font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((trigger) => (
            <tr
              key={trigger.id}
              onClick={() => onOpen(trigger.id)}
              className="border-subtle hover:bg-surface-hover cursor-pointer border-b transition-colors duration-instant last:border-b-0"
            >
              <td className="px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Text variant="body-sm" tone="primary" className="truncate">{trigger.workflowName}</Text>
                  <EnvironmentChip environment={trigger.environment} />
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <TriggerGlyph kind={trigger.type} className="text-fg-muted" />
                  <Text variant="caption" tone="secondary">{TYPE_LABEL[trigger.type]}</Text>
                </span>
              </td>
              <td className="px-3 py-2">
                <Text variant="caption" tone="secondary" className="truncate">{trigger.summary}</Text>
              </td>
              <td className="px-3 py-2">
                {trigger.nextFires[0] ? (
                  <Text variant="caption" tone="secondary" tabular>
                    <RelativeTime iso={trigger.nextFires[0]} />
                  </Text>
                ) : (
                  <Text variant="caption" tone="disabled">
                    {trigger.enabled ? "On demand" : "Suspended"}
                  </Text>
                )}
              </td>
              <td className="px-3 py-2">
                {trigger.lastFireAt ? (
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn("size-1.5 shrink-0 rounded-full", trigger.lastFireOk ? "bg-status-success" : "bg-status-failed")}
                      aria-hidden="true"
                    />
                    <Text variant="caption" tone="secondary" tabular><RelativeTime iso={trigger.lastFireAt} /></Text>
                  </span>
                ) : (
                  <Text variant="caption" tone="disabled">{EMPTY}</Text>
                )}
              </td>
              <td className="px-3 py-2 text-right"><RateCell rate={trigger.successRate} /></td>
              <td className="px-3 py-2 text-right">
                <Text
                  variant="caption"
                  tone="inherit"
                  className={trigger.enabled ? "text-status-success" : "text-status-waiting"}
                >
                  {trigger.enabled ? "Active" : "Suspended"}
                </Text>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Calendar ─────────────────────────────────────────────────────────────── */

function CalendarView({ onOpen }: { onOpen: (id: string) => void }) {
  const slots = React.useMemo(() => calendar(48), []);
  const busiest = Math.max(1, ...slots.map((s) => s.fires.length));

  return (
    <div className="border-subtle bg-surface-raised rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <Text variant="eyebrow" tone="muted">Next 48 hours</Text>
        <Text variant="caption" tone="muted">
          {slots.reduce((n, s) => n + s.fires.length, 0)} fires · busiest hour has {busiest}
        </Text>
      </div>

      <ol className="grid gap-px">
        {slots.map((slot) => {
          const hour = new Date(slot.at);
          const isNewDay = hour.getUTCHours() === 0;
          const crowded = slot.fires.length > 1;

          return (
            <li key={slot.at}>
              {isNewDay ? (
                <div className="border-subtle mb-1 mt-2 border-t pt-1.5">
                  <Text variant="caption" tone="muted">
                    {hour.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}
                  </Text>
                </div>
              ) : null}

              <div
                className={cn(
                  "grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-sm px-1 py-0.5",
                  crowded && "bg-status-waiting-subtle",
                )}
              >
                <Text variant="caption" tone={slot.fires.length > 0 ? "secondary" : "disabled"} tabular className="font-code">
                  {String(hour.getUTCHours()).padStart(2, "0")}:00
                </Text>

                {slot.fires.length === 0 ? (
                  <span className="bg-surface-active block h-px" aria-hidden="true" />
                ) : (
                  <span className="flex flex-wrap items-center gap-1">
                    {slot.fires.map((fire) => (
                      <button
                        key={`${fire.triggerId}-${fire.at}`}
                        onClick={() => onOpen(fire.triggerId)}
                        className={cn(
                          "font-ui text-caption border-accent-border bg-accent-subtle text-accent rounded-xs border px-1.5 py-0.5",
                          "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
                        )}
                      >
                        {fire.workflowName}
                      </button>
                    ))}
                    {/* A collision is the thing this view exists to reveal. */}
                    {crowded ? (
                      <Text variant="caption" tone="inherit" className="text-status-waiting">
                        {slot.fires.length} at once
                      </Text>
                    ) : null}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <Text variant="caption" tone="muted" className="mt-3 block leading-snug">
        Hours with more than one fire are highlighted. Schedules that collide compete for workers and
        for the same downstream rate limits — spreading them, or adding jitter, is usually cheaper
        than raising concurrency.
      </Text>
    </div>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────────── */

function TriggerDetail({
  trigger, onClose, tab, onTabChange, onBackfill,
}: {
  trigger: TriggerRecord | null;
  onClose: () => void;
  tab: string;
  onTabChange: (id: string) => void;
  onBackfill: (id: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  if (!trigger) return null;

  const tabs = [
    { id: "config", label: trigger.type === "schedule" ? "Schedule" : trigger.type === "webhook" ? "Endpoint" : "Invocation" },
    ...(trigger.type === "webhook" ? [{ id: "deliveries", label: "Deliveries" }] : []),
    ...(trigger.type === "schedule" ? [{ id: "upcoming", label: "Upcoming" }] : []),
  ];

  return (
    <DetailSheet
      open
      onClose={onClose}
      title={trigger.workflowName}
      subtitle={
        <>
          <span className="flex items-center gap-1.5">
            <TriggerGlyph kind={trigger.type} className="text-fg-muted" />
            <Text variant="caption" tone="secondary">{TYPE_LABEL[trigger.type]}</Text>
          </span>
          <Text variant="caption" tone="muted">{trigger.summary}</Text>
          <EnvironmentChip environment={trigger.environment} />
        </>
      }
      badges={
        <span className="flex items-center gap-2">
          <Switch checked={trigger.enabled} onCheckedChange={() => {}} aria-label="Enabled" />
          <Text variant="caption" tone={trigger.enabled ? "inherit" : "muted"} className={trigger.enabled ? "text-status-success" : undefined}>
            {trigger.enabled ? "Active" : "Suspended"}
          </Text>
        </span>
      }
      actions={
        trigger.type === "schedule" ? (
          <Button size="sm" variant="secondary" onClick={() => onBackfill(trigger.id)}>Backfill</Button>
        ) : null
      }
      tabs={tabs}
      activeTab={tab}
      onTabChange={onTabChange}
    >
      <div className="grid gap-3 p-4">
        {tab === "config" && trigger.type === "schedule" ? <ScheduleConfig trigger={trigger} /> : null}
        {tab === "config" && trigger.type === "webhook" ? (
          <WebhookConfig trigger={trigger} copied={copied} onCopy={async () => {
            try { await navigator.clipboard.writeText(trigger.url ?? ""); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch {}
          }} />
        ) : null}
        {tab === "config" && (trigger.type === "manual" || trigger.type === "api") ? <ManualConfig trigger={trigger} /> : null}
        {tab === "deliveries" ? <Deliveries trigger={trigger} /> : null}
        {tab === "upcoming" ? <Upcoming trigger={trigger} /> : null}
      </div>
    </DetailSheet>
  );
}

function ScheduleConfig({ trigger }: { trigger: TriggerRecord }) {
  const dst = observesDst(trigger.timezone);

  return (
    <>
      <Section title="Cron" help="The preview beside it is what it actually means — a cron nobody can read is a cron nobody checks.">
        <Input value={trigger.cron ?? ""} readOnly className="h-8 font-code text-mono-sm" aria-label="Cron expression" />
        <Text variant="body-sm" tone="primary" className="mt-1.5 block">
          {describeCron(trigger.cron ?? "")} {trigger.timezone ? `(${trigger.timezone})` : ""}
        </Text>
      </Section>

      <Section title="Timezone" tone={dst ? "warning" : undefined}>
        <Facts items={[{ label: "Timezone", value: trigger.timezone ?? "UTC" }]} />
        {dst ? (
          <Text variant="caption" tone="inherit" className="text-status-waiting mt-1.5 block leading-snug">
            {trigger.timezone} observes daylight saving, so this fires an hour earlier in UTC for part
            of the year. Anything correlating its output with a UTC system will appear to drift twice
            a year. Use UTC unless the local hour genuinely matters.
          </Text>
        ) : (
          <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
            UTC does not observe daylight saving, so the fire time is stable all year.
          </Text>
        )}
      </Section>

      <Section title="Behaviour" help="What happens around the edges of a firing.">
        <div className="grid gap-2.5">
          <div>
            <Text variant="caption" tone="secondary" className="block">Overlap policy</Text>
            <Select
              options={(Object.keys(OVERLAP_LABEL) as OverlapPolicy[]).map((p) => ({ value: p, label: OVERLAP_LABEL[p] }))}
              value={trigger.overlap}
              onValueChange={() => {}}
              aria-label="Overlap policy"
            />
            <Text variant="caption" tone="muted" className="mt-1 block leading-snug">{OVERLAP_HELP[trigger.overlap]}</Text>
          </div>

          <Facts
            items={[
              { label: "Jitter", value: trigger.jitterSeconds > 0 ? `${trigger.jitterSeconds}s` : "None" },
              { label: "Catch up on missed", value: trigger.catchUp ? "Yes" : "No" },
              { label: "Starts", value: trigger.startsAt ? <RelativeTime iso={trigger.startsAt} /> : "Immediately" },
              { label: "Ends", value: trigger.endsAt ? <RelativeTime iso={trigger.endsAt} /> : "Never" },
            ]}
          />

          <Text variant="caption" tone="muted" className="block leading-snug">
            {trigger.catchUp
              ? "After an outage, missed windows are run in order before the schedule resumes. Correct when every window must be processed; expensive after a long outage."
              : "Missed windows are skipped. The next firing covers only its own window."}
          </Text>
        </div>
      </Section>
    </>
  );
}

function WebhookConfig({ trigger, copied, onCopy }: { trigger: TriggerRecord; copied: boolean; onCopy: () => void }) {
  return (
    <>
      <Section title="Endpoint" help="POST here to start a run. The URL is the credential — treat it as a secret.">
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-code text-mono-sm border-subtle bg-surface-sunken min-w-0 flex-1 truncate rounded-sm border px-2 py-1.5">
            {trigger.url}
          </code>
          <Button size="xs" variant="secondary" onClick={onCopy}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      </Section>

      <Section title="Signature" help="Every delivery is signed. Verifying it is what stops anyone who learns the URL from starting your workflows.">
        <Facts
          items={[
            { label: "Header", value: trigger.signatureHeader ?? EMPTY },
            { label: "Secret", value: `••••••••${trigger.secretLast4 ?? ""}` },
            { label: "Algorithm", value: "HMAC-SHA256" },
            { label: "Rate limit", value: trigger.rateLimitPerMinute ? `${trigger.rateLimitPerMinute}/min` : "None" },
          ]}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="xs" variant="secondary">Rotate secret</Button>
          <Button asChild size="xs" variant="ghost">
            <Link href={"/docs/security" as Route}>How to verify</Link>
          </Button>
        </div>
        <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
          Rotating invalidates the old secret immediately. Deploy the new one at your end first — a
          rotation without that is an outage you scheduled yourself.
        </Text>
      </Section>

      <Section title="Payload mapping" help="Which fields of the incoming body become workflow inputs.">
        <ul className="grid gap-1">
          {[
            { from: "body.account_id", to: "accountId" },
            { from: "body.amount", to: "amount" },
            { from: "headers.x-request-id", to: "correlationId" },
          ].map((m) => (
            <li key={m.from} className="flex flex-wrap items-baseline gap-2">
              <code className="font-code text-mono-sm text-fg-secondary">{m.from}</code>
              <span className="text-fg-disabled" aria-hidden="true">→</span>
              <code className="font-code text-mono-sm text-accent">{m.to}</code>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function ManualConfig({ trigger }: { trigger: TriggerRecord }) {
  const curl = `curl -X POST '${(trigger.endpoint ?? "").replace(/^POST\s+/, "")}' \\
  -H 'Authorization: Bearer $VECTORBEA_TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{ "input": { "accountId": "acct_8812" } }'`;

  return (
    <>
      <Section title="Endpoint" help="Start a run from your own code or by hand.">
        <code className="font-code text-mono-sm border-subtle bg-surface-sunken block truncate rounded-sm border px-2 py-1.5">
          {trigger.endpoint}
        </code>
        <Facts
          items={[
            { label: "Auth", value: "Workspace API token" },
            { label: "Rate limit", value: "600/min" },
          ]}
        />
      </Section>

      <Section title="Input schema" help="What the run accepts. Anything not declared here is ignored rather than passed through.">
        <ul className="grid gap-1.5">
          {[
            { name: "accountId", type: "string", required: true, description: "The account the run operates on." },
            { name: "dryRun", type: "boolean", required: false, description: "Mock every tool call instead of executing." },
          ].map((field) => (
            <li key={field.name}>
              <span className="flex flex-wrap items-baseline gap-2">
                <code className="font-code text-mono-sm text-fg-primary">{field.name}</code>
                <span className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[10px]">{field.type}</span>
                {field.required ? <Text variant="caption" tone="inherit" className="text-status-failed">required</Text> : null}
              </span>
              <Text variant="caption" tone="muted" className="block leading-snug">{field.description}</Text>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Example">
        <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary overflow-auto rounded-sm border p-2">
          {curl}
        </pre>
      </Section>
    </>
  );
}

function Deliveries({ trigger }: { trigger: TriggerRecord }) {
  return (
    <Section title="Recent deliveries" help="Every inbound call, with what Vectorbea answered. Replay re-runs the workflow with the same payload.">
      <ul className="grid gap-1.5">
        {trigger.deliveries.map((delivery) => (
          <li key={delivery.id} className="border-subtle flex flex-wrap items-center gap-2 border-b pb-1.5 last:border-b-0">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", delivery.ok ? "bg-status-success" : "bg-status-failed")}
              aria-hidden="true"
            />
            <Text
              variant="caption"
              tone="inherit"
              tabular
              className={cn("shrink-0", delivery.ok ? "text-status-success" : "text-status-failed")}
            >
              {delivery.status}
            </Text>
            <Text variant="caption" tone="secondary" tabular className="shrink-0">{formatDuration(delivery.durationMs)}</Text>
            <Text variant="caption" tone="muted" className="min-w-0 flex-1"><RelativeTime iso={delivery.at} /></Text>
            <Button size="xs" variant="ghost">Replay</Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Upcoming({ trigger }: { trigger: TriggerRecord }) {
  return (
    <Section title="Next five fires" help="Computed from the cron in its timezone, including any jitter.">
      {trigger.nextFires.length === 0 ? (
        <Text variant="body-sm" tone="secondary">
          Suspended, so nothing is scheduled. Re-enable it above to resume.
        </Text>
      ) : (
        <ol className="grid gap-1.5">
          {trigger.nextFires.map((at, i) => (
            <li key={at} className="flex flex-wrap items-baseline gap-2">
              <Text variant="caption" tone="disabled" tabular className="w-4 shrink-0">{i + 1}</Text>
              <Text variant="body-sm" tone="primary" tabular>
                {new Date(at).toISOString().replace("T", " ").slice(0, 16)}Z
              </Text>
              <Text variant="caption" tone="muted"><RelativeTime iso={at} /></Text>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/* ── Backfill ─────────────────────────────────────────────────────────────── */

function BackfillDialog({ trigger, onClose }: { trigger: TriggerRecord | null; onClose: () => void }) {
  const [days, setDays] = React.useState(7);
  if (!trigger) return null;

  const to = Date.now();
  const from = to - days * 86_400_000;
  const estimate = backfillEstimate(trigger, from, to);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "motion-overlay z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-surface-overlay border-subtle shadow-3 w-[min(32rem,calc(100vw-2rem))] rounded-lg border p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">Backfill {trigger.workflowName}</Text>
          </Dialog.Title>
          <Text variant="body-sm" tone="secondary" className="mt-1 block">
            Runs the schedule over a past range as if it had fired then. Every run is real — tools are
            called, messages are sent, gates fire.
          </Text>

          <div className="mt-3">
            <label className="grid gap-1">
              <Text variant="caption" tone="secondary">Range (days back)</Text>
              <Input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                className="h-8 text-body-sm"
              />
            </label>
          </div>

          {/* The count and the cost, before the button — a backfill over a
              quarter of an hourly schedule is thousands of runs. */}
          <div className="border-status-waiting-border bg-status-waiting-subtle mt-3 rounded-md border p-3">
            <Text variant="body-sm" tone="inherit" className="text-status-waiting block">
              {estimate.runs.toLocaleString("en-GB")} runs · about {formatCost(estimate.costUsd)}
            </Text>
            <Text variant="caption" tone="secondary" className="mt-1 block leading-snug">
              Roughly {formatDuration(estimate.durationMs)} of total execution, spread across available
              workers. They queue behind live traffic rather than displacing it.
            </Text>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button variant="primary" size="sm" disabled={estimate.runs === 0}>
              Backfill {estimate.runs.toLocaleString("en-GB")} runs
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
