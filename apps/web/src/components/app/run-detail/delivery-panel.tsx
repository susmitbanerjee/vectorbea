"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { formatDuration } from "~/lib/format";
import { IncidentIcon, DurableRunIcon, WaitUntilIcon } from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   DID THE RESULT GET THERE?

   ── WHY THIS IS ON THE RUN AND NOT ITS OWN SCREEN ───────────────────────────
   A run that produced the right answer and failed to deliver it is not a
   success from the customer's side. If delivery lived on a page of its own,
   the run would show green, the person would close the tab, and the failure
   would be found when somebody downstream asked where the data was.

   So it sits under the header, beside the recovery card, and it is loud when it
   has failed — a dead delivery is the run's real outcome and it gets the
   failure ramp, on a run whose own status badge says succeeded. Those two
   things disagreeing is the POINT: they are different facts.
══════════════════════════════════════════════════════════════════════════════ */

type Status = "pending" | "delivering" | "delivered" | "retrying" | "dead"
  | "cancelled" | "skipped";

/**
 * The tone each delivery state gets.
 *
 * `dead` is the only one on the failure ramp. `retrying` is deliberately the
 * waiting ramp rather than the failure one — it has not failed yet, and painting
 * a retry red teaches people to ignore red.
 */
const STATE: Record<Status, { label: string; icon: IconComponent; tone: string; ring: string }> = {
  delivered: {
    label: "Delivered", icon: DurableRunIcon,
    tone: "text-status-success", ring: "border-status-success-border bg-status-success-subtle",
  },
  pending: {
    label: "Queued", icon: WaitUntilIcon,
    tone: "text-status-waiting", ring: "border-status-waiting-border bg-status-waiting-subtle",
  },
  delivering: {
    label: "Sending", icon: WaitUntilIcon,
    tone: "text-status-live", ring: "border-status-live-border bg-status-live-subtle",
  },
  retrying: {
    label: "Retrying", icon: WaitUntilIcon,
    tone: "text-status-waiting", ring: "border-status-waiting-border bg-status-waiting-subtle",
  },
  dead: {
    label: "Not delivered", icon: IncidentIcon,
    tone: "text-status-failed", ring: "border-status-failed-border bg-status-failed-subtle",
  },
  cancelled: {
    label: "Cancelled", icon: WaitUntilIcon,
    tone: "text-fg-muted", ring: "border-subtle bg-surface-raised",
  },
  skipped: {
    label: "Not sent", icon: WaitUntilIcon,
    tone: "text-fg-muted", ring: "border-subtle bg-surface-raised",
  },
};

export interface DeliveryPanelProps {
  deliveries: contracts.RunDelivery[];
  /** Requeue one. Resolves when the API has accepted it. */
  onRedeliver: (deliveryId: string) => Promise<void>;
  className?: string;
}

export function DeliveryPanel({ deliveries, onRedeliver, className }: DeliveryPanelProps) {
  /* Nothing configured is not a state worth a panel. An empty box saying "no
     deliveries" on every run would train people to skip this area. */
  if (deliveries.length === 0) return null;

  const dead = deliveries.filter((d) => d.status === "dead");
  const failed = dead.length > 0;

  return (
    <section
      aria-labelledby="delivery-heading"
      className={cn(
        "overflow-hidden rounded-lg border",
        failed
          ? "border-status-failed-border bg-status-failed-subtle"
          : "border-subtle bg-surface-raised",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        {failed ? (
          <IncidentIcon size={17} aria-hidden="true" className="text-status-failed shrink-0" />
        ) : (
          <DurableRunIcon size={17} aria-hidden="true" className="text-fg-secondary shrink-0" />
        )}
        <Text
          variant="body-sm"
          tone="inherit"
          as="h2"
          id="delivery-heading"
          className={cn("font-medium", failed ? "text-status-failed" : "text-fg-primary")}
        >
          {failed ? "The result was not delivered" : "Result delivery"}
        </Text>
        <Text variant="caption" tone="muted" className="ml-auto">
          {failed
            ? `${dead.length} of ${deliveries.length} failed. This run succeeded; its result did not arrive.`
            : `${deliveries.length} target${deliveries.length === 1 ? "" : "s"}`}
        </Text>
      </div>

      <ul className="mt-2 flex flex-col gap-2 px-4 pb-3">
        {deliveries.map((delivery) => (
          <DeliveryRow key={delivery.id} delivery={delivery} onRedeliver={onRedeliver} />
        ))}
      </ul>
    </section>
  );
}

function DeliveryRow({
  delivery,
  onRedeliver,
}: {
  delivery: contracts.RunDelivery;
  onRedeliver: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const state = STATE[delivery.status as Status] ?? STATE.pending;
  const Icon = state.icon;

  const redeliver = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onRedeliver(delivery.id);
    } catch (e) {
      // Says what did not happen, per the copy rules — a redelivery the API
      // refuses is an answer, not a fault.
      setError(e instanceof Error ? e.message : "The redelivery could not be queued.");
    } finally {
      setBusy(false);
    }
  }, [delivery.id, onRedeliver]);

  return (
    <li className={cn("rounded-md border px-3 py-2", state.ring)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon size={15} aria-hidden="true" className={cn("shrink-0", state.tone)} />
        <Text variant="body-sm" tone="primary" className="min-w-0 font-medium">
          {delivery.targetName ?? "Delivery"}
        </Text>
        <Text variant="caption" tone="inherit" className={state.tone}>
          {state.label}
        </Text>
        {delivery.partial ? (
          <Text variant="caption" tone="muted">
            partial #{delivery.sequence}
          </Text>
        ) : null}

        {delivery.redeliverable ? (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => void redeliver()}
            disabled={busy}
          >
            {busy ? "Queueing" : "Redeliver"}
          </Button>
        ) : null}
      </div>

      <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Fact label="Attempts">{`${delivery.attempts} of ${delivery.maxAttempts}`}</Fact>
        {delivery.payloadMode ? (
          <Fact label="Sent as">
            {/* Requirement 5: SAY which shape was used. A receiver that got a
                link where it expected a body needs to know it was a size
                decision rather than a missing field. */}
            {delivery.payloadMode === "url"
              ? `link (${formatBytes(delivery.payloadBytes)} of output)`
              : `inline (${formatBytes(delivery.payloadBytes)})`}
          </Fact>
        ) : null}
        {delivery.deliveredAt ? (
          <Fact label="Delivered">{new Date(delivery.deliveredAt).toLocaleString()}</Fact>
        ) : null}
        {delivery.nextAttemptAt ? (
          <Fact label="Next try">{relative(delivery.nextAttemptAt)}</Fact>
        ) : null}
        {/* The key the receiver dedupes on. Shown so a support conversation can
            match our row to their log line without asking us to look it up. */}
        <Fact label="Key" mono>
          {delivery.idempotencyKey}
        </Fact>
      </dl>

      {delivery.lastError ? (
        <Text variant="caption" tone="inherit" className={cn("mt-1 block", state.tone)}>
          {delivery.lastError}
        </Text>
      ) : null}

      {delivery.status === "dead" ? (
        <Text variant="caption" tone="muted" className="mt-1 block">
          Redelivering sends the same payload with the same idempotency key, so a
          receiver that deduplicates will recognise it rather than acting twice.
        </Text>
      ) : null}

      {error ? (
        <Text variant="caption" tone="inherit" className="text-status-failed mt-1 block">
          {error}
        </Text>
      ) : null}
    </li>
  );
}

function Fact({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      </dt>
      <dd>
        <Text variant="caption" tone="secondary" tabular className={cn(mono && "font-code")}>
          {children}
        </Text>
      </dd>
    </div>
  );
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "in 4m", from a timestamp.
 *
 * Rendered once per load rather than ticking: the value comes from a poll and a
 * second hand would be inventing precision the page does not have.
 */
function relative(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return "soon";
  if (ms <= 0) return "any moment";
  return `in ${formatDuration(ms)}`;
}
