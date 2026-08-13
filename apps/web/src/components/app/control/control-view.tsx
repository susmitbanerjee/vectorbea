"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { HealthStrip } from "./health-strip";
import { AttentionFeed } from "./attention-feed";
import { FleetHeatstrip } from "./fleet-heatstrip";
import { DetailBand } from "./detail-band";
import { TimeRangeControl, RefreshControl } from "./time-range";
import { EmptyWorkspace } from "./empty-workspace";
import {
  HealthStripSkeleton, AttentionFeedSkeleton, FleetSkeleton, DetailSkeleton,
} from "./skeletons";
import {
  buildHealth, buildAttention, buildFleet, buildLatency, buildCostTrend,
  resolveRange, DEFAULT_RANGE,
  type FleetSort, type TimeRangeId,
} from "~/mocks/control";

/* ══════════════════════════════════════════════════════════════════════════════
   CONTROL

   Four bands in priority order. The order is the argument: an operator arriving
   because something is wrong reads top to bottom and stops as soon as they know
   what to do. Health tells them whether it is bad, Needs attention tells them
   what to fix, Fleet tells them how far it has spread, and Detail is there for
   the diagnosis afterwards.

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

  /* ── Refresh ────────────────────────────────────────────────────────────── */
  const [tick, setTick] = React.useState(0);
  const [fetchedAt, setFetchedAt] = React.useState(() => Date.now());
  const [now, setNow] = React.useState(() => Date.now());
  const [refreshing, setRefreshing] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(true);

  const refresh = React.useCallback(() => {
    setRefreshing(true);
    // The real fetch lands in P12. The delay is here so the loading affordance
    // is a real state that has been designed and tested, not a branch that only
    // ever runs against a slow network.
    window.setTimeout(() => {
      setTick((t) => t + 1);
      setFetchedAt(Date.now());
      setRefreshing(false);
    }, 420);
  }, []);

  React.useEffect(() => {
    if (frozen || !autoRefresh) return;
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, refresh, frozen]);

  // Drives the "updated Xs ago" label without re-deriving the page data.
  React.useEffect(() => {
    if (frozen) return;
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, [frozen]);

  /* ── Data ───────────────────────────────────────────────────────────────── */
  const health = React.useMemo(() => buildHealth(range, tick), [range, tick]);
  const attention = React.useMemo(() => buildAttention(), []);
  const fleet = React.useMemo(() => buildFleet(sort), [sort]);
  const latency = React.useMemo(() => buildLatency(range), [range]);
  const cost = React.useMemo(() => buildCostTrend(range), [range]);

  /* ── First-paint loading ────────────────────────────────────────────────── */
  const [booted, setBooted] = React.useState(frozen);
  React.useEffect(() => {
    if (frozen) return;
    const id = window.setTimeout(() => setBooted(true), 320);
    return () => window.clearTimeout(id);
  }, [frozen]);

  const state: ControlState =
    forceState ?? stateParam ?? (booted ? "ready" : "loading");

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
              <RefreshControl
                ageMs={frozen ? 0 : Math.max(0, now - fetchedAt)}
                refreshing={refreshing}
                onRefresh={refresh}
                autoRefresh={autoRefresh}
                onAutoRefreshChange={setAutoRefresh}
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
          <BandHeading>Needs attention</BandHeading>
          <AttentionFeedSkeleton />
          <BandHeading>Fleet</BandHeading>
          <FleetSkeleton />
          <BandHeading>Detail</BandHeading>
          <DetailSkeleton />
        </div>
      ) : (
        <div className="grid gap-6">
          <HealthStrip health={health} />
          <AttentionFeed items={attention} />
          <FleetHeatstrip
            rows={fleet}
            sort={sort}
            onSortChange={(next) => setParam({ sort: next })}
          />
          <DetailBand latency={latency} cost={cost} range={range} streamPaused={frozen} />
        </div>
      )}
    </PageContainer>
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
