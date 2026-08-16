"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { formatCost, formatTokens } from "~/lib/format";
import { RelativeTime } from "~/components/app/workflows/atoms";
import {
  LIMITS, USAGE_TODAY, RESETS_AT, forecasts, USAGE_HISTORY, costAttribution,
  FEATURE_MATRIX, TIERS, CURRENT_TIER, type Forecast, type LimitTile, type UsagePoint,
} from "~/mocks/admin";
import { POLICY } from "~/mocks/control";

/* ══════════════════════════════════════════════════════════════════════════════
   USAGE & LIMITS

   A limits page that only reports current state makes people discover their
   limits by hitting them — mid-run, in production, with no warning. The
   forecast is the whole addition: the same numbers arranged as a prediction so
   somebody can act a day early rather than a minute late.
══════════════════════════════════════════════════════════════════════════════ */

export function UsageView() {
  const predictions = React.useMemo(() => forecasts(), []);
  const attribution = React.useMemo(() => costAttribution(), []);
  const [metric, setMetric] = React.useState<keyof Omit<UsagePoint, "t">>("runs");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Usage & limits"
        description="What you have used, what you are about to use, and which workflow is spending the money."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href={"/settings/billing" as Route}>Upgrade</Link>
          </Button>
        }
      />

      <div className="grid gap-4">
        {/* ── Today, with the reset ─────────────────────────────────────── */}
        <section className="border-subtle bg-surface-raised rounded-lg border p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Text variant="eyebrow" tone="muted" className="block">Runs today</Text>
              <div className="mt-1 flex items-baseline gap-2">
                <Text variant="display-md" tone="max" tabular>{USAGE_TODAY}</Text>
                <Text variant="body-sm" tone="muted" tabular>of {POLICY.dailyRunLimit}</Text>
              </div>
            </div>
            <Text variant="caption" tone="muted">
              Resets <RelativeTime iso={RESETS_AT} /> at 00:00 UTC
            </Text>
          </div>
          <Meter value={USAGE_TODAY} max={POLICY.dailyRunLimit} className="mt-3" />
        </section>

        {/* ── The forecast ──────────────────────────────────────────────── */}
        <section>
          <Text variant="eyebrow" tone="muted" className="mb-2 block">Forecast</Text>
          <ul className="grid gap-2">
            {predictions.map((forecast) => (
              <li key={forecast.id}><ForecastCard forecast={forecast} /></li>
            ))}
          </ul>
        </section>

        {/* ── Limits ────────────────────────────────────────────────────── */}
        <section>
          <Text variant="eyebrow" tone="muted" className="mb-2 block">Limits</Text>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {LIMITS.map((limit) => (
              <li key={limit.id}><LimitCard limit={limit} /></li>
            ))}
          </ul>
        </section>

        {/* ── History ───────────────────────────────────────────────────── */}
        <section className="border-subtle bg-surface-raised rounded-lg border p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <Text variant="eyebrow" tone="muted" className="block">Last 30 days</Text>
              <Text variant="caption" tone="muted" className="mt-0.5 block">
                The limit line is drawn so you can see how close a normal day gets.
              </Text>
            </div>
            <Select
              options={[
                { value: "runs", label: "Runs" },
                { value: "tokens", label: "Tokens" },
                { value: "costUsd", label: "Cost" },
                { value: "storageMb", label: "Storage" },
              ]}
              value={metric}
              onValueChange={(v) => setMetric(v as typeof metric)}
              aria-label="Metric"
            />
          </div>
          <HistoryChart points={USAGE_HISTORY} metric={metric} />
        </section>

        {/* ── Attribution ───────────────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Attribution
            title="Spend by workflow"
            help="Where the money goes. A workflow at the top of this list is the one worth optimising."
            rows={attribution.workflows}
            hrefFor={(id) => `/workflows/${id}`}
          />
          <Attribution
            title="Spend by agent"
            help="Model spend per registered agent, across every workflow that binds it."
            rows={attribution.agents}
            hrefFor={() => "/agents"}
          />
        </div>

        {/* ── Tiers ─────────────────────────────────────────────────────── */}
        <FeatureMatrix />

        <RequestLimits />
      </div>
    </PageContainer>
  );
}

/* ── Forecast ─────────────────────────────────────────────────────────────── */

function ForecastCard({ forecast }: { forecast: Forecast }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        forecast.severity === "critical" ? "border-status-failed-border bg-status-failed-subtle"
          : forecast.severity === "warning" ? "border-status-waiting-border bg-status-waiting-subtle"
            : "border-subtle bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Text
          variant="body-sm"
          tone="inherit"
          className={cn(
            "font-medium",
            forecast.severity === "critical" ? "text-status-failed"
              : forecast.severity === "warning" ? "text-status-waiting" : "text-fg-primary",
          )}
        >
          {forecast.sentence}
        </Text>
        {forecast.at ? (
          <Text variant="caption" tone="muted" tabular><RelativeTime iso={forecast.at} /></Text>
        ) : null}
      </div>
      <Text variant="caption" tone="secondary" className="mt-1 block leading-snug">{forecast.detail}</Text>
    </div>
  );
}

/* ── Limits ───────────────────────────────────────────────────────────────── */

function LimitCard({ limit }: { limit: LimitTile }) {
  const pct = Math.min(100, Math.round((limit.current / limit.max) * 100));
  const tight = pct >= 80;

  return (
    <div className="border-subtle bg-surface-raised rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Text variant="caption" tone="muted">{limit.label}</Text>
        <Text
          variant="caption"
          tone="inherit"
          tabular
          className={pct >= 90 ? "text-status-failed" : tight ? "text-status-waiting" : "text-fg-muted"}
        >
          {pct}%
        </Text>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <Text variant="heading-sm" tone="max" tabular>
          {limit.unit === "USD" ? formatCost(limit.current) : limit.current.toLocaleString("en-GB")}
        </Text>
        <Text variant="caption" tone="muted" tabular>
          of {limit.unit === "USD" ? formatCost(limit.max) : limit.max.toLocaleString("en-GB")}
        </Text>
      </div>
      <Meter value={limit.current} max={limit.max} className="mt-2" />
      <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">{limit.help}</Text>
      {/* An upgrade path per limit, not one banner for all of them. */}
      <Text variant="caption" tone={tight ? "inherit" : "disabled"} className={cn("mt-1 block", tight && "text-accent")}>
        {limit.upgrade}
      </Text>
    </div>
  );
}

function Meter({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div
      className={cn("bg-surface-active h-1.5 w-full overflow-hidden rounded-full", className)}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${Math.round(pct)}% of the limit used`}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          pct >= 90 ? "bg-status-failed" : pct >= 80 ? "bg-status-waiting" : "bg-accent",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── History ──────────────────────────────────────────────────────────────── */

function HistoryChart({ points, metric }: { points: UsagePoint[]; metric: keyof Omit<UsagePoint, "t"> }) {
  const width = 720;
  const height = 180;
  const padL = 48;
  const padB = 22;
  const padT = 12;

  const values = points.map((p) => p[metric] as number);
  const limit = metric === "runs" ? POLICY.dailyRunLimit
    : metric === "costUsd" ? POLICY.dailyBudgetUsd : null;
  const max = Math.max(...values, limit ?? 0) * 1.1 || 1;

  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (width - padL - 10);
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  const barWidth = Math.max(2, (width - padL - 10) / points.length - 3);

  const format = (v: number) => metric === "costUsd" ? formatCost(v)
    : metric === "tokens" ? formatTokens(v)
      : metric === "storageMb" ? `${Math.round(v)}MB` : String(Math.round(v));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full min-w-[34rem]"
        role="img"
        aria-label={`${metric} over 30 days. Low ${format(Math.min(...values))}, high ${format(Math.max(...values))}.${limit ? ` The daily limit is ${format(limit)}.` : ""}`}
      >
        {points.map((point, i) => {
          const v = point[metric] as number;
          const over = limit !== null && v > limit;
          return (
            <rect
              key={point.t}
              x={x(i) - barWidth / 2}
              y={y(v)}
              width={barWidth}
              height={Math.max(1, height - padB - y(v))}
              fill={over ? "var(--status-failed)" : "var(--accent)"}
              opacity={over ? 0.9 : 0.55}
            >
              <title>{`${new Date(point.t).toISOString().slice(0, 10)} · ${format(v)}`}</title>
            </rect>
          );
        })}

        {/* The limit line, on top of the bars so a breach reads as a breach. */}
        {limit !== null ? (
          <>
            <line
              x1={padL} x2={width - 10} y1={y(limit)} y2={y(limit)}
              stroke="var(--status-waiting)" strokeWidth={1} strokeDasharray="4 3"
            />
            <text
              x={width - 10} y={y(limit) - 4} textAnchor="end"
              className="font-ui" fontSize={9} fill="var(--status-waiting)"
            >
              limit {format(limit)}
            </text>
          </>
        ) : null}

        <line x1={padL} x2={width - 10} y1={height - padB} y2={height - padB} stroke="var(--border-default)" strokeWidth={1} />
        {[max / 2, max].map((v) => (
          <text key={v} x={padL - 6} y={y(v) + 3} textAnchor="end" className="font-code tabular" fontSize={9} fill="var(--fg-disabled)">
            {format(v)}
          </text>
        ))}
        {[0, Math.floor(points.length / 2), points.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)} y={height - padB + 13}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            className="font-code tabular" fontSize={9} fill="var(--fg-disabled)"
          >
            {new Date(points[i].t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ── Attribution ──────────────────────────────────────────────────────────── */

function Attribution({
  title, help, rows, hrefFor,
}: {
  title: string;
  help: string;
  rows: ReturnType<typeof costAttribution>["workflows"];
  hrefFor: (id: string) => string;
}) {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border p-3">
      <Text variant="eyebrow" tone="muted" className="block">{title}</Text>
      <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">{help}</Text>

      <ul className="grid gap-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={hrefFor(row.id) as Route}
              className={cn(
                "-mx-1 block rounded-sm px-1 py-1",
                "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <Text variant="body-sm" tone="primary" className="min-w-0 truncate">{row.name}</Text>
                <Text variant="caption" tone="secondary" tabular className="shrink-0">
                  {formatCost(row.costUsd)} · {row.share}%
                </Text>
              </span>
              <span className="bg-surface-active mt-1 block h-1 rounded-full">
                <span className="bg-accent block h-1 rounded-full" style={{ width: `${row.share}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Tiers ────────────────────────────────────────────────────────────────── */

function FeatureMatrix() {
  return (
    <section className="border-subtle bg-surface-raised overflow-x-auto rounded-lg border">
      <div className="border-subtle border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">Plans</Text>
        <Text variant="caption" tone="muted" className="mt-0.5 block">
          You are on {CURRENT_TIER}. Building by hand is never limited by tier — only volume,
          retention and controls are.
        </Text>
      </div>

      <table className="w-full min-w-[44rem]">
        <caption className="sr-only">What each plan includes</caption>
        <thead>
          <tr className="border-subtle text-fg-muted font-ui text-eyebrow border-b uppercase">
            <th scope="col" className="px-3 py-2 text-left font-normal">Feature</th>
            {TIERS.map((tier) => (
              <th
                key={tier}
                scope="col"
                className={cn("px-3 py-2 text-right font-normal", tier === CURRENT_TIER && "text-accent")}
              >
                {tier}
                {tier === CURRENT_TIER ? <span className="sr-only"> — your current plan</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FEATURE_MATRIX.map((row) => (
            <tr key={row.feature} className="border-subtle border-b last:border-b-0">
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <Text variant="body-sm" tone="primary" className="block">{row.feature}</Text>
                {row.help ? <Text variant="caption" tone="muted" className="block leading-snug">{row.help}</Text> : null}
              </th>
              {TIERS.map((tier) => (
                <td
                  key={tier}
                  className={cn(
                    "px-3 py-2 text-right",
                    tier === CURRENT_TIER && "bg-surface-selected",
                  )}
                >
                  <Text
                    variant="caption"
                    tone={row.values[tier] === "—" ? "disabled" : tier === CURRENT_TIER ? "primary" : "secondary"}
                    tabular
                  >
                    {row.values[tier]}
                  </Text>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ── Request ──────────────────────────────────────────────────────────────── */

function RequestLimits() {
  const [limit, setLimit] = React.useState(LIMITS[0].id);
  const [needed, setNeeded] = React.useState("");
  const [reason, setReason] = React.useState("");
  const selected = LIMITS.find((l) => l.id === limit)!;

  return (
    <section className="border-subtle bg-surface-raised rounded-lg border p-3">
      <Text variant="eyebrow" tone="muted" className="block">Request higher limits</Text>
      <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">
        Pre-filled with what you are actually consuming, so the request does not need a conversation
        to establish the facts.
      </Text>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">
          <Text variant="caption" tone="secondary">Which limit</Text>
          <Select
            options={LIMITS.map((l) => ({ value: l.id, label: l.label }))}
            value={limit}
            onValueChange={setLimit}
            aria-label="Limit"
          />
          <Text variant="caption" tone="muted">
            Currently {selected.current.toLocaleString("en-GB")} of {selected.max.toLocaleString("en-GB")}{" "}
            {selected.unit}.
          </Text>
        </label>

        <label className="grid gap-1">
          <Text variant="caption" tone="secondary">What you need</Text>
          <Input
            value={needed}
            onChange={(e) => setNeeded(e.target.value)}
            placeholder={String(Math.round(selected.max * 3))}
            className="h-8 text-body-sm"
          />
          <Text variant="caption" tone="muted">A number, in {selected.unit}.</Text>
        </label>
      </div>

      <label className="mt-2 grid gap-1">
        <Text variant="caption" tone="secondary">Why</Text>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Onboarding a second business unit in September."
          className="h-8 text-body-sm"
        />
        <Text variant="caption" tone="muted">
          What is driving the increase, and by when. Sizing is easier with a date attached.
        </Text>
      </label>

      <div className="mt-3">
        <Button variant="primary" size="sm" disabled={!needed.trim()}>Send the request</Button>
      </div>
    </section>
  );
}
