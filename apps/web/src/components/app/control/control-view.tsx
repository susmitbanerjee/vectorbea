"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { HealthStrip } from "./health-strip";
import { AttentionSummary } from "./attention-summary";
import { FleetHeatstrip } from "./fleet-heatstrip";
import { DetailBand } from "./detail-band";
import { TimeRangeControl } from "./time-range";
import { EmptyWorkspace } from "./empty-workspace";
import { worstSeverity } from "~/components/app/shell/inbox-signal";
import {
  HealthStripSkeleton, AttentionSummarySkeleton, FleetSkeleton, DetailSkeleton,
} from "./skeletons";
import { useControlData } from "./use-control-data";
import { resolveRange, DEFAULT_RANGE } from "~/lib/control/range";
import type { FleetSort, TimeRangeId } from "~/lib/control/model";

/* ══════════════════════════════════════════════════════════════════════════════
   CONTROL

   The order is the argument: an operator arriving because something is wrong
   reads top to bottom and stops as soon as they know what to do. Health tells
   them whether it is bad, the attention line tells them how much needs doing
   and how badly, Fleet tells them how far it has spread, and Detail is there
   for the diagnosis afterwards.

   The triage feed itself has moved to the notification inbox, which makes it
   reachable from every screen rather than only this one. What stayed is a
   single severity-weighted line that opens it — see attention-summary.tsx for
   why burying it entirely would have cost more than it saved. Fleet is promoted
   into the space that freed up.

   Every number is a link. That is the single rule this rebuild exists to
   enforce — the old Overview reported "41% success rate" and "1 failed" and
   neither went anywhere, so the page could tell you that you had a problem but
   never help you resolve it.
══════════════════════════════════════════════════════════════════════════════ */

export type ControlState = "ready" | "loading" | "empty";

export interface ControlViewProps {
  /** Overridable so Storybook and the capture harness can pin a state. */
  forceState?: ControlState;
  /** Freeze the activity stream and the clock for deterministic screenshots. */
  frozen?: boolean;
}

export function ControlView({ forceState, frozen: frozenProp }: ControlViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /* ── URL-synced state ───────────────────────────────────────────────────── */
  const rangeId = (params.get("range") ?? DEFAULT_RANGE) as TimeRangeId;
  const sort = (params.get("sort") ?? "failure") as FleetSort;
  const stateParam = params.get("state") as ControlState | null;
  const range = resolveRange(rangeId);

  // `?frozen=1` stops the clock and the activity stream. It exists for the
  // capture harness and for Storybook: without it every screenshot diff is a
  // ticking timestamp and a scrolling log, and visual regression is impossible.
  const frozen = frozenProp ?? params.get("frozen") === "1";

  const setParam = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      // replace, not push: changing the range is refining one view, not
      // navigating, and it should not fill the back button with dashboards.
      router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
    },
    [params, pathname, router],
  );

  /* ── Data — live, from the API ──────────────────────────────────────────── */
  const data = useControlData(range, sort);
  const { health, attention, fleet, latency, cost } = data;
  // Only the shape of the attention list is needed here — the items themselves
  // are rendered by the inbox.
  const attentionWorst = React.useMemo(
    () => worstSeverity(attention.map((a) => a.severity)),
    [attention],
  );

  /* ── First-paint loading ────────────────────────────────────────────────── */
  const [booted, setBooted] = React.useState(frozen);
  React.useEffect(() => {
    if (frozen) return;
    const id = window.setTimeout(() => setBooted(true), 320);
    return () => window.clearTimeout(id);
  }, [frozen]);

  const state: ControlState =
    forceState ?? stateParam ?? (booted && !data.loading ? "ready" : "loading");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Observe"
        title="Control"
        description={
          state === "empty"
            ? undefined
            : "Fleet health, and every number one click from its cause."
        }
        actions={
          state === "empty" ? undefined : (
            <>
              <TimeRangeControl
                value={rangeId}
                onChange={(id) => setParam({ range: id })}
              />
            </>
          )
        }
      />

      {state === "empty" ? (
        <EmptyWorkspace />
      ) : state === "loading" ? (
        <div className="grid gap-6">
          <p role="status" className="sr-only">Loading workspace health.</p>
          <HealthStripSkeleton />
          <AttentionSummarySkeleton />
          <BandHeading>Fleet</BandHeading>
          <FleetSkeleton />
          <BandHeading>Detail</BandHeading>
          <DetailSkeleton />
        </div>
      ) : (
        <div className="grid gap-6">
          {data.unavailable.length > 0 ? (
            <UnavailableNotice endpoints={data.unavailable} />
          ) : null}
          <HealthStrip health={health} />
          <AttentionSummary count={attention.length} worst={attentionWorst} />
          <FleetHeatstrip
            rows={fleet}
            sort={sort}
            onSortChange={(next) => setParam({ sort: next })}
          />
          <DetailBand
            latency={latency}
            cost={cost}
            range={range}
            streamPaused={frozen}
          />
        </div>
      )}
    </PageContainer>
  );
}

/**
 * Says which endpoints did not answer.
 *
 * A band fed by a failed request renders as "nothing is happening", which is
 * indistinguishable from a genuinely quiet workspace and far more dangerous.
 * Naming the endpoint is the difference between "all clear" and "we cannot see".
 */
function UnavailableNotice({ endpoints }: { endpoints: string[] }) {
  return (
    <div
      role="status"
      className="border-status-waiting-border bg-status-waiting-subtle rounded-md border px-3 py-2"
    >
      <Text variant="body-sm" tone="primary">
        Some of this page could not load: {endpoints.join(", ")}. The bands below show only what
        the API returned.
      </Text>
    </div>
  );
}

/** Keeps the loading state's rhythm identical to the loaded one. */
function BandHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="heading-sm" tone="max" as="h2" className="-mb-3 block">
      {children}
    </Text>
  );
}
