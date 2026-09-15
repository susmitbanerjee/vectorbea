"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { DestructiveConfirmDialog } from "~/components/ui/destructive-confirm-dialog";
import { formatCost } from "~/lib/format";
import { formatSpan } from "~/lib/control/model";
import type { IncidentSeverity, IncidentStatus, IncidentView } from "~/lib/incidents/model";
import { IncidentIcon } from "~/components/icons/domain";
import { useIncidentsData } from "./use-incidents-data";
import { useApi } from "~/lib/api/api-provider";

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

/** What the confirmation dialog is currently asking about. */
type Confirming =
  | { kind: "resolve-all" }
  | { kind: "delete-resolved" }
  | { kind: "delete"; incident: IncidentView };

export function IncidentsView({ frozen: frozenProp }: { frozen?: boolean } = {}) {
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  void (frozenProp ?? params.get("frozen") === "1");
  const data = useIncidentsData();
  const incidents = data.rows;
  /*
   * PURGING RESOLVED AND DELETED NOTHING.
   *
   * "Purge incidents" called `mark-all-resolved`, which closes every open
   * incident and leaves every row exactly where it was — a resolved incident is
   * still a signature row on this page, forever. So an incident raised by a
   * misconfiguration during setup could be purged repeatedly and never go away,
   * which is what "even if the incident is purged we are not able to delete it"
   * describes.
   *
   * Resolving and deleting are now separate, because they answer different
   * questions. Resolve says "this is handled" and keeps the record. Delete says
   * "this was never a real problem" and removes it. Deletion only ever touches
   * RESOLVED incidents in bulk — clearing an open one would destroy the evidence
   * of an outage while it is still happening.
   */
  const [confirming, setConfirming] = React.useState<Confirming | null>(null);
  const [pending, setPending] = React.useState(false);
  const [operationMessage, setOperationMessage] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);

  const plural = (n: number, one: string, many: string) =>
    `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

  const runOperation = React.useCallback(
    async (work: () => Promise<string>, failure: string) => {
      setPending(true);
      setOperationMessage(null);
      try {
        const text = await work();
        setConfirming(null);
        setOperationMessage({ tone: "success", text });
        await data.refetch();
      } catch (error) {
        setOperationMessage({
          tone: "error",
          text: error instanceof Error ? error.message : failure,
        });
      } finally {
        setPending(false);
      }
    },
    [data],
  );

  const resolveAll = React.useCallback(
    () => runOperation(async () => {
      const result = await api.incidents.resolveAll(data.scope);
      return result.resolved === 0
        ? "There were no open incidents to resolve."
        : `${plural(result.resolved, "incident was", "incidents were")} resolved.`;
    }, "The incidents could not be resolved."),
    [api, data.scope, runOperation],
  );

  const deleteResolved = React.useCallback(
    () => runOperation(async () => {
      const result = await api.incidents.deleteResolved(data.scope);
      return result.deleted === 0
        ? "There were no resolved incidents to delete. Resolve them first, then clear them."
        : `${plural(result.deleted, "resolved incident was", "resolved incidents were")} deleted.`;
    }, "The resolved incidents could not be deleted."),
    [api, data.scope, runOperation],
  );

  /* A row on this page is a SIGNATURE — several incident records sharing a
     category, code and failing component. Deleting the row means deleting every
     record behind it, which is why `sourceIds` exists and why the confirmation
     names the count rather than saying "this incident". */
  const deleteSignature = React.useCallback(
    (incident: IncidentView) => runOperation(async () => {
      const ids = incident.sourceIds.length > 0 ? incident.sourceIds : [incident.id];
      const outcomes = await Promise.allSettled(
        ids.map((id) => api.incidents.remove(id, data.scope)),
      );
      const failed = outcomes.filter((o) => o.status === "rejected").length;
      if (failed === ids.length) {
        const first = outcomes[0];
        throw first?.status === "rejected" && first.reason instanceof Error
          ? first.reason
          : new Error("The incident could not be deleted.");
      }
      // A partial failure is reported as one, not silently rounded up to
      // success: the row will still be on the page after the refetch and the
      // reader needs to know why.
      return failed === 0
        ? `${plural(ids.length, "incident record was", "incident records were")} deleted.`
        : `${ids.length - failed} of ${ids.length} incident records were deleted; ${failed} could not be.`;
    }, "The incident could not be deleted."),
    [api, data.scope, runOperation],
  );

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
    () => [...new Set(incidents.flatMap((i) => i.affectedWorkflows))].sort(),
    [incidents],
  );

  const visible = incidents.filter((incident) => {
    if (status && incident.status !== status) return false;
    if (severity && incident.severity !== severity) return false;
    if (workflow && !incident.affectedWorkflows.includes(workflow)) return false;
    return true;
  });

  const totalRuns = incidents.reduce((sum, i) => sum + i.affectedRuns, 0);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Observe"
        title="Incidents"
        description={`${totalRuns} failed ${totalRuns === 1 ? "run" : "runs"}, grouped into ${incidents.length} ${incidents.length === 1 ? "problem" : "problems"}.`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setConfirming({ kind: "resolve-all" })}>
              Resolve all
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirming({ kind: "delete-resolved" })}>
              Delete resolved
            </Button>
          </div>
        }
      />

      {operationMessage ? (
        <div
          role={operationMessage.tone === "error" ? "alert" : "status"}
          className={cn(
            "mb-3 rounded-md border px-3 py-2",
            operationMessage.tone === "error"
              ? "border-status-failed-border bg-status-failed-subtle"
              : "border-status-success-border bg-status-success-subtle",
          )}
        >
          <Text
            variant="body-sm"
            tone={operationMessage.tone === "error" ? "inherit" : "primary"}
            className={operationMessage.tone === "error" ? "text-status-failed" : undefined}
          >
            {operationMessage.text}
          </Text>
        </div>
      ) : null}

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

      {data.loading ? (
        <div className="border-subtle rounded-lg border p-8 text-center"><Text variant="body-sm" tone="muted">Loading incidents…</Text></div>
      ) : data.error ? (
        <div className="border-status-failed-border rounded-lg border p-8 text-center"><Text variant="body-sm" tone="inherit" className="text-status-failed">Could not load incidents.</Text></div>
      ) : visible.length === 0 ? (
        <div className="border-status-success-border bg-status-success-subtle rounded-lg border p-8 text-center">
          <Text variant="heading-sm" tone="max" as="p" className="block">No incidents match</Text>
          <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
            {incidents.length === 0
              ? "Nothing is failing repeatedly. Individual failures still appear in Runs."
              : "Try clearing a filter — there are incidents, just none in this slice."}
          </Text>
        </div>
      ) : (
        <ul className="grid gap-2">
          {visible.map((incident) => (
            <IncidentRow
              key={incident.id}
              incident={incident}
              onDelete={() => setConfirming({ kind: "delete", incident })}
            />
          ))}
        </ul>
      )}

      <DestructiveConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => { if (!open) setConfirming(null); }}
        title={
          confirming?.kind === "resolve-all" ? "Resolve every open incident"
            : confirming?.kind === "delete-resolved" ? "Delete every resolved incident"
              : "Delete this incident"
        }
        description={
          confirming?.kind === "resolve-all"
            ? "Every open incident in this workspace is marked resolved. Nothing is deleted — the records stay available for audit under the resolved filter, and can be cleared afterwards with Delete resolved."
            : confirming?.kind === "delete-resolved"
              ? "Every incident already marked resolved is removed permanently. Open incidents are left alone: an incident that is still open is a live problem, and deleting it would destroy the record of an outage in progress."
              : confirming?.kind === "delete"
                ? `${confirming.incident.signature} — ${plural(confirming.incident.sourceIds.length || 1, "record", "records")} will be removed permanently. The runs that produced them are not affected.`
                : ""
        }
        confirmLabel={
          confirming?.kind === "resolve-all" ? "Resolve all incidents"
            : confirming?.kind === "delete-resolved" ? "Delete resolved incidents"
              : "Delete permanently"
        }
        pending={pending}
        onConfirm={() => {
          if (!confirming) return;
          if (confirming.kind === "delete") void deleteSignature(confirming.incident);
          else if (confirming.kind === "delete-resolved") void deleteResolved();
          else void resolveAll();
        }}
      />
    </PageContainer>
  );
}

function IncidentRow({ incident, onDelete }: { incident: IncidentView; onDelete: () => void }) {
  return (
    /* The delete control is a SIBLING of the link, not a child of it. Nesting an
       interactive element inside an anchor is invalid, and it makes the button
       navigate as well as fire — which on a destructive action is the worst
       possible failure mode. */
    <li className="relative">
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

            <Text variant="caption" tone="secondary" className="mt-0.5 block truncate" title={incident.reason ?? undefined}>
              {incident.reason ?? incident.failingComponent}
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
          {/* Reserves the delete button's footprint so the sparkline is never
              covered by it. */}
          <span aria-hidden="true" className="w-7 shrink-0" />
        </div>
      </Link>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete incident ${incident.signature}`}
        title="Delete this incident"
        className={cn(
          "text-fg-disabled hover:text-status-failed absolute right-3 top-3 grid size-6 place-items-center rounded-xs",
          "hover:bg-status-failed-subtle transition-colors duration-fast",
          "outline-none focus-visible:focus-ring",
        )}
      >
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true" fill="none">
          <path
            d="M2.5 3.5h7M4.75 3.5V2.5h2.5v1M4.5 5.5v3M7.5 5.5v3M3.25 3.5l.4 5.6a.9.9 0 0 0 .9.9h2.9a.9.9 0 0 0 .9-.9l.4-5.6"
            stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      </button>
    </li>
  );
}

/** Title derived from the root cause, not the raw signature. */
export function titleFor(incident: IncidentView): string {
  if (incident.title) return incident.failingComponent && incident.failingComponent !== "Workflow"
    ? `${incident.title} · ${incident.failingComponent}`
    : incident.title;
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
