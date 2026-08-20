"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { LatencyDistributionChart } from "~/components/charts/latency-distribution";
import { CostTrendChart } from "~/components/charts/cost-trend";
import { ActivityStream } from "./activity-stream";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { formatCost, formatTokens } from "~/lib/format";
import { formatAxisDuration } from "~/components/charts/scale";
import type { CostTrend, LatencyDistribution, TimeRange } from "~/mocks/control";
import { AgentBrainIcon } from "~/components/icons/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   BAND 4 · DETAIL

   Everything here is diagnostic rather than triage. It sits below the fold on
   purpose: an operator arriving mid-incident needs bands 1–3, and only reaches
   for a latency histogram once they know what they are looking for.

   Both charts resolve to filtered runs on click, same rule as the rest of the
   page — a bucket you cannot click is a bucket you have to reproduce by hand in
   the Runs query bar.
══════════════════════════════════════════════════════════════════════════════ */

export interface DetailBandProps {
  latency: LatencyDistribution;
  cost: CostTrend;
  range: TimeRange;
  /** Frozen for screenshots. */
  streamPaused?: boolean;
  className?: string;
}

export function DetailBand({ latency, cost, range, streamPaused, className }: DetailBandProps) {
  const router = useRouter();

  return (
    <section aria-labelledby="detail-heading" className={cn("min-w-0", className)}>
      <Text variant="heading-sm" tone="max" as="h2" id="detail-heading" className="mb-2.5 block">
        Detail
      </Text>

      <div className="grid gap-3">
        <Panel
          title="Execution latency"
          meta={
            <>
              <span className="tabular">{latency.sampleCount}</span> completed runs · p95{" "}
              <span className="tabular">{formatAxisDuration(latency.p95)}</span>
            </>
          }
        >
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Metric label="p50" value={formatAxisDuration(latency.p50)} />
            <Metric label="p95" value={formatAxisDuration(latency.p95)} tone="waiting" />
            <Metric label="p99" value={formatAxisDuration(latency.p99)} tone="failed" />
          </div>
          <LatencyDistributionChart
            data={latency}
            height={220}
            onSelectBucket={(lower, upper) =>
              router.push(
                `/runs?duration_gte=${Math.round(lower)}&duration_lte=${Math.round(upper)}` as Route,
              )
            }
          />
        </Panel>

        <Panel
          title="Spend and tokens"
          meta={
            <>
              <span className="tabular">{formatCost(cost.totalUsd)}</span> ·{" "}
              <span className="tabular">{formatTokens(cost.totalTokens)}</span> tokens in range
            </>
          }
        >
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Metric label="Spend" value={formatCost(cost.totalUsd)} />
            <Metric label="Tokens" value={formatTokens(cost.totalTokens)} />
            <Metric
              label="Bucket budget"
              value={cost.budgetPerBucketUsd > 0 ? formatCost(cost.budgetPerBucketUsd) : "Not set"}
              tone={cost.budgetPerBucketUsd > 0 ? "waiting" : undefined}
            />
          </div>
          <CostTrendChart
            data={cost}
            range={range}
            height={220}
            onSelectBucket={(from, to) => router.push(`/runs?from=${from}&to=${to}` as Route)}
          />
        </Panel>

        <LiveActivityStream paused={streamPaused} />

        <ArchitectEntry />
      </div>
    </section>
  );
}

function Metric({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone?: "waiting" | "failed";
}) {
  return (
    <div className="border-subtle bg-surface-sunken rounded-md border px-2.5 py-2">
      <Text variant="caption" tone="muted" className="block">{label}</Text>
      <Text
        variant="body-sm"
        tone="max"
        tabular
        className={cn(
          "mt-0.5 block font-medium",
          tone === "waiting" && "text-status-waiting",
          tone === "failed" && "text-status-failed",
        )}
      >
        {value}
      </Text>
    </div>
  );
}

/** Owns the only polling query on Control, isolating activity updates from all metrics. */
function LiveActivityStream({ paused = false }: { paused?: boolean }) {
  const api = useApi();
  const { workspaceId } = useScope();
  const [tick, setTick] = React.useState(0);
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const activity = useApiQuery({
    queryKey: [...queryKeys.env(workspaceId, null), "control-activity", tick],
    queryFn: () => api.controlActivity({ ...scope, limit: 20 }),
    enabled: Boolean(workspaceId),
    freshness: "live",
  });

  React.useEffect(() => {
    if (paused || !autoRefresh) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, paused]);

  return (
    <ActivityStream
      events={activity.data ?? []}
      paused={paused}
      refreshing={activity.isFetching}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
      onRefresh={() => setTick((value) => value + 1)}
    />
  );
}

function Panel({
  title, meta, children,
}: {
  title: string;
  meta: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-subtle bg-surface-raised min-w-0 rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <Text variant="label" tone="primary">{title}</Text>
        <Text variant="caption" tone="muted">{meta}</Text>
      </div>
      {children}
    </div>
  );
}

/**
 * AI Architect, last on the page and deliberately quiet.
 *
 * It is a real differentiator and it stays, but it is a creation affordance on a
 * page whose job is operations. Given brand iris and a hero treatment it would
 * out-shout a failing connection, which is precisely the wrong priority during
 * the ten minutes this page matters most.
 */
function ArchitectEntry() {
  return (
    <div
      className={cn(
        "border-subtle bg-surface-sunken rounded-lg border p-4",
        "flex flex-wrap items-center gap-x-4 gap-y-3",
      )}
    >
      <AgentBrainIcon size={20} aria-hidden="true" className="text-accent shrink-0" />
      <div className="min-w-0 flex-1">
        <Text variant="body-sm" tone="primary" className="block font-medium">
          Describe a workflow and let AI Architect draft it
        </Text>
        <Text variant="caption" tone="muted" className="block">
          You edit the blueprint before anything is created, and see exactly what will be built.
        </Text>
      </div>
      <Button asChild variant="secondary" size="sm">
        <Link href={"/workflows/new/architect" as Route}>Open Architect</Link>
      </Button>
    </div>
  );
}
