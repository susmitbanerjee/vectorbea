"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { formatCost } from "~/lib/format";
import { formatSpan } from "~/mocks/control";
import { INCIDENT_VIEWS, type IncidentSeverity, type IncidentStatus, type IncidentView } from "~/mocks/governance";
import { IncidentIcon } from "~/components/icons/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   INCIDENTS — grouped by failure signature.

   §9: "83 failed runs are not 83 problems; they're probably 3." This page is
   that sentence as a screen. The unit is the SIGNATURE, not the run — which is
   why the list has three rows where Runs has eighty-three, and why the count is
   a property of the row rather than the page.
══════════════════════════════════════════════════════════════════════════════ */

export const SEVERITY_STYLE: Record<IncidentSeverity, string> = {
  critical: "text-status-failed border-status-failed-border bg-status-failed-subtle",
  high: "text-status-waiting border-status-waiting-border bg-status-waiting-subtle",
  medium: "text-fg-secondary border-default",
  low: "text-fg-muted border-subtle",
};

export const STATUS_STYLE: Record<IncidentStatus, string> = {
  open: "text-status-failed border-status-failed-border",
  acknowledged: "text-status-waiting border-status-waiting-border",
  resolved: "text-status-success border-status-success-border",
  muted: "text-fg-disabled border-subtle",
};

export function IncidentsView({ frozen: frozenProp }: { frozen?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  void (frozenProp ?? params.get("frozen") === "1");

  const status = params.get("status") ?? "";
  const severity = params.get("severity") ?? "";
  const workflow = params.get("workflow") ?? "";

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.replace(`${pathname}?${p.toString()}` as never, { scroll: false });
  };

  const workflows = React.useMemo(
    () => [...new Set(INCIDENT_VIEWS.flatMap((i) => i.affectedWorkflows))].sort(),
    [],
  );

  const visible = INCIDENT_VIEWS.filter((incident) => {
    if (status && incident.status !== status) return false;
    if (severity && incident.severity !== severity) return false;
    if (workflow && !incident.affectedWorkflows.includes(workflow)) return false;
    return true;
  });

  const totalRuns = INCIDENT_VIEWS.reduce((sum, i) => sum + i.affectedRuns, 0);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Observe"
        title="Incidents"
        description={`${totalRuns} failed runs across ${INCIDENT_VIEWS.length} signatures. The signature is the problem; the runs are symptoms.`}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter label="Status" value={status} onChange={(v) => setParam("status", v)}
          options={["open", "acknowledged", "resolved", "muted"]} />
        <Filter label="Severity" value={severity} onChange={(v) => setParam("severity", v)}
          options={["critical", "high", "medium", "low"]} />
        <Filter label="Workflow" value={workflow} onChange={(v) => setParam("workflow", v)} options={workflows} />
        {(status || severity || workflow) ? (
          <Button size="sm" variant="ghost" onClick={() => router.replace(pathname as never, { scroll: false })}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="border-status-success-border bg-status-success-subtle rounded-lg border p-8 text-center">
          <Text variant="heading-sm" tone="max" as="p" className="block">No incidents match</Text>
          <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
            {INCIDENT_VIEWS.length === 0
              ? "Nothing is failing repeatedly. Individual failures still appear in Runs."
              : "Try clearing a filter — there are incidents, just none in this slice."}
          </Text>
        </div>
      ) : (
        <ul className="grid gap-2">
          {visible.map((incident) => <IncidentRow key={incident.id} incident={incident} />)}
        </ul>
      )}
    </PageContainer>
  );
}

function IncidentRow({ incident }: { incident: IncidentView }) {
  return (
    <li>
      <Link
        href={`/incidents/${incident.id}` as Route}
        className={cn(
          "border-subtle bg-surface-raised hover:border-default block rounded-lg border p-3",
          "transition-colors duration-fast outline-none focus-visible:focus-ring",
        )}
      >
        <div className="flex flex-wrap items-start gap-3">
          <IncidentIcon size={18} aria-hidden="true" className={cn("mt-0.5 shrink-0", incident.severity === "critical" ? "text-status-failed" : "text-status-waiting")} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Text variant="body-sm" tone="max" className="font-medium">
                {titleFor(incident)}
              </Text>
              <span className={cn("font-ui text-caption rounded-full border px-1.5 py-0.5", SEVERITY_STYLE[incident.severity])}>
                {incident.severity}
              </span>
              <span className={cn("font-ui text-caption rounded-sm border px-1.5 py-0.5", STATUS_STYLE[incident.status])}>
                {incident.status}
              </span>
            </div>

            <Text variant="caption" tone="muted" className="mt-0.5 block truncate font-code">
              {incident.signature}
            </Text>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Text variant="caption" tone="muted">
                <span className="text-status-failed tabular">{incident.occurrences}</span> occurrences
              </Text>
              <Text variant="caption" tone="muted">
                <span className="tabular">{incident.affectedRuns}</span> runs ·{" "}
                <span className="tabular">{incident.affectedWorkflows.length}</span> workflows
              </Text>
              <Text variant="caption" tone="muted">
                first seen {formatSpan(Date.now() - Date.parse(incident.firstSeen))} ago · last{" "}
                {formatSpan(Date.now() - Date.parse(incident.lastSeen))} ago
              </Text>
              <Text variant="caption" tone="muted">
                {incident.assignee ? (
                  <>assigned to <span className="text-fg-primary font-code">{incident.assignee}</span></>
                ) : (
                  <span className="text-status-waiting">unassigned</span>
                )}
              </Text>
            </div>
          </div>

          <Sparkline values={incident.sparkline} className="shrink-0" />
        </div>
      </Link>
    </li>
  );
}

/** Title derived from the root cause, not the raw signature. */
export function titleFor(incident: IncidentView): string {
  if (incident.failingComponent && incident.classification.includes("tool_call")) {
    return `${incident.failingComponent} is refusing connections`;
  }
  if (incident.classification.includes("llm_timeout")) return `Model calls timing out on ${incident.failingComponent}`;
  if (incident.classification.includes("approval_expired")) return `Approvals expiring before review`;
  return incident.signature.split(" · ").slice(0, 2).join(" · ");
}

/** 24 hourly buckets. Bars, not a line — these are counts, not a continuum. */
export function Sparkline({ values, className, width = 132, height = 34 }: {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const barWidth = width / values.length;
  return (
    <svg
      width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label={`${values.reduce((a, b) => a + b, 0)} occurrences over the last 24 hours`}
      className={className}
    >
      {values.map((v, i) => {
        const h = (v / max) * (height - 2);
        return (
          <rect
            key={i}
            x={i * barWidth} y={height - h}
            width={Math.max(1, barWidth - 1)} height={Math.max(v > 0 ? 1 : 0, h)}
            fill={v > 0 ? "var(--status-failed)" : "var(--border-subtle)"}
            opacity={v > 0 ? 0.85 : 1}
          />
        );
      })}
    </svg>
  );
}

function Filter({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const id = React.useId();
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={id}><Text variant="caption" tone="muted">{label}</Text></label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "bg-surface-raised border-default font-ui text-caption rounded-sm border px-2 py-1",
          "text-fg-secondary outline-none focus-visible:focus-ring",
        )}
      >
        <option value="">Any</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </span>
  );
}
