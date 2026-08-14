"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { EMPTY } from "~/lib/format";
import type { Environment, RiskLevel } from "~/mocks/domain";
import type { RegistryStatus } from "~/mocks/registry";

/* ══════════════════════════════════════════════════════════════════════════════
   REGISTRY CELL VOCABULARY

   RISK IS NEVER COLOUR ALONE. Low, medium, high and critical are drawn as one,
   two, three and four filled bars — the tier is readable in greyscale, on a
   printout, and by the ~8% of men who cannot separate the ember tiers from the
   signal one. The colour is the fast path, the bars are the actual encoding.
══════════════════════════════════════════════════════════════════════════════ */

const RISK_META: Record<RiskLevel, { label: string; bars: number; className: string }> = {
  low: { label: "Low", bars: 1, className: "text-risk-low" },
  medium: { label: "Medium", bars: 2, className: "text-risk-medium" },
  high: { label: "High", bars: 3, className: "text-risk-high" },
  critical: { label: "Critical", bars: 4, className: "text-risk-critical" },
};

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  const meta = RISK_META[risk];
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1.5", meta.className, className)}
      title={`${meta.label} risk`}
    >
      <RiskBars bars={meta.bars} />
      <span className="font-ui text-caption truncate">{meta.label}</span>
    </span>
  );
}

/** Four slots, N filled. The count is the tier. */
function RiskBars({ bars }: { bars: number }) {
  return (
    <svg viewBox="0 0 14 10" aria-hidden="true" className="h-2.5 w-3.5 shrink-0">
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={i * 3.6}
          y={10 - (i + 1) * 2.2}
          width={2.4}
          height={(i + 1) * 2.2}
          rx={0.5}
          fill="currentColor"
          opacity={i < bars ? 1 : 0.2}
        />
      ))}
    </svg>
  );
}

/* ── Status ───────────────────────────────────────────────────────────────── */

const STATUS_META: Record<RegistryStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "text-status-success border-status-success-border bg-status-success-subtle" },
  paused: { label: "Paused", className: "text-status-waiting border-status-waiting-border bg-status-waiting-subtle" },
  draft: { label: "Draft", className: "text-fg-muted border-subtle bg-surface-sunken" },
};

export function RegistryStatusBadge({ status }: { status: RegistryStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("font-ui text-caption inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5", meta.className)}>
      <svg viewBox="0 0 8 8" aria-hidden="true" className="size-1.5 shrink-0">
        {status === "active" ? <circle cx="4" cy="4" r="3" fill="currentColor" /> : null}
        {status === "paused" ? <path d="M2 1h1.6v6H2zM4.4 1H6v6H4.4z" fill="currentColor" /> : null}
        {status === "draft" ? <circle cx="4" cy="4" r="2.6" fill="none" stroke="currentColor" strokeWidth={1.2} strokeDasharray="1.6 1.4" /> : null}
      </svg>
      {meta.label}
    </span>
  );
}

/* ── Health ───────────────────────────────────────────────────────────────── */

export function HealthDot({ status }: { status: "healthy" | "degraded" | "failing" | "unknown" }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "healthy" ? "bg-status-success"
          : status === "degraded" ? "bg-status-waiting"
            : status === "failing" ? "bg-status-failed" : "bg-fg-disabled",
      )}
      aria-hidden="true"
    />
  );
}

/** Success rate coloured by band, matching the workflows list. */
export function RateCell({ rate }: { rate: number }) {
  return (
    <Text
      variant="caption"
      tone="inherit"
      tabular
      className={rate >= 90 ? "text-status-success" : rate >= 60 ? "text-status-waiting" : "text-status-failed"}
    >
      {rate}%
    </Text>
  );
}

/* ── Environment scope ────────────────────────────────────────────────────── */

const ENV_SHORT: Record<Environment, string> = {
  production: "prod",
  staging: "stg",
  development: "dev",
};

const ENV_CLASS: Record<Environment, string> = {
  production: "text-env-production border-env-production/40",
  staging: "text-env-staging border-env-staging/40",
  development: "text-env-development border-env-development/40",
};

/**
 * Which environments a grant or policy covers, as three fixed slots.
 *
 * Fixed slots rather than a list of the ones that apply: the absence is the
 * information. "prod stg —" reads as scoped; a two-item list reads as complete
 * until you count it.
 */
export function EnvironmentScope({ environments }: { environments: Environment[] }) {
  const all: Environment[] = ["production", "staging", "development"];
  return (
    <span className="flex shrink-0 items-center gap-1">
      {all.map((env) => {
        const on = environments.includes(env);
        return (
          <span
            key={env}
            title={on ? `Allowed in ${env}` : `Not allowed in ${env}`}
            className={cn(
              "font-code rounded-xs border px-1 text-[9px] uppercase",
              on ? ENV_CLASS[env] : "border-subtle text-fg-disabled line-through",
            )}
          >
            {ENV_SHORT[env]}
          </span>
        );
      })}
    </span>
  );
}

/* ── Sparkline ────────────────────────────────────────────────────────────── */

/** A trend as a shape, for a table cell or a panel header. */
export function Sparkline({
  values, width = 96, height = 20, tone = "accent", label,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "accent" | "success" | "failed";
  label: string;
}) {
  if (values.length === 0) return <Text variant="caption" tone="disabled">{EMPTY}</Text>;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - ((v - min) / span) * (height - 2) - 1}`);

  const stroke = tone === "success" ? "var(--status-success)"
    : tone === "failed" ? "var(--status-failed)" : "var(--accent)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}. From ${values[0]} to ${values[values.length - 1]}, low ${min}, high ${max}.`}
      className="block shrink-0 overflow-visible"
    >
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" />
      <circle cx={(values.length - 1) * step} cy={height - ((values[values.length - 1] - min) / span) * (height - 2) - 1} r={1.8} fill={stroke} />
    </svg>
  );
}

/* ── Distribution bar ─────────────────────────────────────────────────────── */

export function DistributionBar({
  buckets, label,
}: {
  buckets: { label: string; count: number }[];
  label: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div role="img" aria-label={`${label}. ${buckets.map((b) => `${b.label}: ${b.count}`).join(", ")}.`}>
      <div className="flex items-end gap-1" style={{ height: 48 }}>
        {buckets.map((bucket) => (
          <span key={bucket.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span
              className="bg-accent block w-full rounded-xs"
              style={{ height: Math.max(2, (bucket.count / max) * 40) }}
            />
          </span>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {buckets.map((bucket) => (
          <span key={bucket.label} className="font-code text-fg-disabled min-w-0 flex-1 truncate text-center text-[9px]">
            {bucket.label}
          </span>
        ))}
      </div>
    </div>
  );
}
