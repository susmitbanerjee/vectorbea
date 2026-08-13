"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/input";
import { MonoId } from "~/components/ui/mono-id";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { formatCost, formatDuration } from "~/lib/format";
import { formatSpan } from "~/mocks/control";
import {
  getIncident, incidentRuns, incidentWorkflows, autoResolveProgress,
  type IncidentActivity, type IncidentStatus, type IncidentView,
} from "~/mocks/governance";
import { SEVERITY_STYLE, STATUS_STYLE, Sparkline, titleFor } from "./incidents-view";
import { RootCauseIcon, BlastRadiusIcon, RecoveryEngineIcon } from "~/components/icons/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   INCIDENT DETAIL

   The affected-runs table reuses the inline Ribbon from Runs, and that reuse is
   the diagnostic point rather than a saving: forty runs all dying at the same
   node position is one broken dependency: the Ribbon makes that a glance instead
   of a query.
══════════════════════════════════════════════════════════════════════════════ */

export function IncidentDetail({ incidentId }: { incidentId: string }) {
  const base = getIncident(incidentId);
  const [incident, setIncident] = React.useState<IncidentView | undefined>(base);
  const [resolveOpen, setResolveOpen] = React.useState(false);
  const [note, setNote] = React.useState("");

  if (!incident) {
    return (
      <PageContainer>
        <div className="border-subtle mx-auto mt-16 max-w-[32rem] rounded-lg border p-6 text-center">
          <Text variant="heading-sm" tone="max" as="h1" className="block">Incident not found</Text>
          <Button asChild variant="secondary" size="sm" className="mt-4">
            <Link href={"/incidents" as Route}>Back to incidents</Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  const runs = incidentRuns(incident);
  const workflows = incidentWorkflows(incident);
  const quiet = autoResolveProgress(incident);

  const act = (action: string, next?: Partial<IncidentView>, noteText?: string) => {
    setIncident((current) =>
      current
        ? {
            ...current,
            ...next,
            activity: [...current.activity, { at: Date.now(), actor: "you", action, note: noteText }],
          }
        : current,
    );
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow={<Link href={"/incidents" as Route} className="hover:text-accent rounded-xs outline-none focus-visible:focus-ring">Incidents</Link>}
        title={titleFor(incident)}
        description={incident.remediation}
        metadata={
          <>
            <span className={cn("font-ui text-caption rounded-full border px-1.5 py-0.5", SEVERITY_STYLE[incident.severity])}>
              {incident.severity}
            </span>
            <span className={cn("font-ui text-caption rounded-sm border px-1.5 py-0.5", STATUS_STYLE[incident.status])}>
              {incident.status}
            </span>
            <MonoId value={incident.id} head={10} tail={4} srLabel="Incident identifier" />
            <Text variant="caption" tone="muted">
              first seen {formatSpan(Date.now() - Date.parse(incident.firstSeen))} ago
            </Text>
            {incident.externalTracker ? (
              <Text variant="caption" tone="muted" className="font-code">{incident.externalTracker}</Text>
            ) : null}
          </>
        }
        actions={
          <>
            {incident.status === "open" ? (
              <Button size="sm" variant="secondary" onClick={() => act("Acknowledged", { status: "acknowledged", assignee: "you" })}>
                Acknowledge
              </Button>
            ) : null}
            {incident.status !== "resolved" ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => act("Assigned to platform-ops", { assignee: "platform-ops" })}>
                  Assign
                </Button>
                <Button size="sm" variant="secondary" onClick={() => act("Muted for 4 hours", { status: "muted", mutedUntil: Date.now() + 4 * 3_600_000 })}>
                  Mute
                </Button>
                <Button size="sm" variant="primary" onClick={() => setResolveOpen((o) => !o)}>Resolve</Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost">Link tracker</Button>
          </>
        }
      />

      {resolveOpen ? (
        <div className="border-subtle bg-surface-raised mb-3 rounded-lg border p-3">
          <Text variant="label" tone="primary" className="mb-1.5 block">Resolution note (required)</Text>
          <Textarea
            minRows={2} maxRows={4} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What fixed it, and what would stop it recurring"
            aria-label="Resolution note"
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm" variant="primary" disabled={!note.trim()}
              onClick={() => { act("Resolved", { status: "resolved" }, note.trim()); setResolveOpen(false); setNote(""); }}
            >
              Resolve incident
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setResolveOpen(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[1fr_20rem]">
        <div className="grid min-w-0 gap-3">
          {/* ── Root cause ─────────────────────────────────────────────────── */}
          <section className="border-subtle bg-surface-raised rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <RootCauseIcon size={14} aria-hidden="true" className="text-status-failed shrink-0" />
              <Text variant="eyebrow" tone="muted">Root cause</Text>
            </div>
            <Text variant="body-sm" tone="primary" className="block">{incident.signature}</Text>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Fact label="Classified as">{incident.classification}</Fact>
              <Fact label="Failing component">
                <Link href={incident.componentHref as Route} className="hover:text-accent underline decoration-dotted underline-offset-2 rounded-xs outline-none focus-visible:focus-ring">
                  {incident.failingComponent}
                </Link>
              </Fact>
            </div>
          </section>

          {/* ── Blast radius ───────────────────────────────────────────────── */}
          <section className="border-subtle bg-surface-raised rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <BlastRadiusIcon size={14} aria-hidden="true" className="text-fg-muted shrink-0" />
              <Text variant="eyebrow" tone="muted">Blast radius</Text>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
              <Stat label="Workflows" value={String(incident.blastRadius.workflows)} href="/workflows" />
              <Stat label="Tools" value={String(incident.blastRadius.tools)} href="/tools" />
              <Stat label="Connections" value={String(incident.blastRadius.connections)} href="/connections" />
              <Stat label="Runs" value={String(incident.blastRadius.runs)} href="/runs?q=status%3Afailed" />
              <Stat label="Cost of failure" value={formatCost(incident.blastRadius.costOfFailureUsd)} tone="failed" />
            </dl>
            <Text variant="caption" tone="muted" className="mt-2 block">
              Cost of failure counts only the committed steps on runs that then died — work paid for
              and thrown away.
            </Text>
          </section>

          {/* ── Occurrences ────────────────────────────────────────────────── */}
          <section className="border-subtle bg-surface-raised rounded-lg border p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <Text variant="eyebrow" tone="muted">Occurrence timeline</Text>
              <Text variant="caption" tone="muted">
                quiet for <span className="tabular">{formatSpan(quiet.quietMs)}</span> of the{" "}
                <span className="tabular">{formatSpan(incident.autoResolveAfterMs)}</span> auto-resolve window
              </Text>
            </div>
            <Sparkline values={incident.sparkline} width={640} height={64} className="w-full" />
            <div className="bg-surface-sunken mt-2 h-1 overflow-hidden rounded-full">
              <div
                className={cn("h-full rounded-full", quiet.fraction >= 1 ? "bg-status-success" : "bg-accent")}
                style={{ width: `${quiet.fraction * 100}%` }}
              />
            </div>
          </section>

          {/* ── Affected runs ──────────────────────────────────────────────── */}
          <section className="border-subtle bg-surface-raised overflow-hidden rounded-lg border">
            <div className="border-subtle flex items-baseline justify-between gap-2 border-b px-3 py-2">
              <Text variant="eyebrow" tone="muted">Affected runs</Text>
              <Link
                href={"/runs?q=status%3Afailed" as Route}
                className="font-ui text-caption text-accent hover:text-accent-hover rounded-xs outline-none focus-visible:focus-ring"
              >
                Open in Runs
              </Link>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {runs.slice(0, 40).map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}` as Route}
                  className={cn(
                    "border-subtle grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b px-3 py-1.5 last:border-b-0",
                    "hover:bg-surface-hover transition-colors duration-instant outline-none focus-visible:focus-ring",
                  )}
                >
                  <span className="min-w-0">
                    <Text variant="caption" tone="primary" className="block truncate">{run.workflowName}</Text>
                    <Text variant="caption" tone="disabled" className="block truncate font-code">{run.id}</Text>
                  </span>
                  <CheckpointRibbon nodes={run.nodes} size="xs" runId={run.id} className="w-32" />
                  <Text variant="caption" tone="muted" tabular className="w-14 text-right">
                    {formatDuration(run.durationMs)}
                  </Text>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* ── Side ───────────────────────────────────────────────────────────── */}
        <div className="grid min-w-0 content-start gap-3">
          <section className="border-status-failed-border bg-status-failed-subtle rounded-lg border p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <RecoveryEngineIcon size={14} aria-hidden="true" className="text-status-failed shrink-0" />
              <Text variant="eyebrow" tone="muted">Suggested remediation</Text>
            </div>
            <Text variant="body-sm" tone="primary" className="block">{incident.remediation}</Text>
            <Button asChild size="sm" variant="primary" className="mt-2.5" fullWidth>
              <Link href={incident.componentHref as Route}>Fix {incident.failingComponent}</Link>
            </Button>
          </section>

          <section className="border-subtle bg-surface-raised rounded-lg border p-3">
            <Text variant="eyebrow" tone="muted" className="mb-1.5 block">Affected workflows</Text>
            <ul className="grid gap-1">
              {workflows.map((w) => w ? (
                <li key={w.id}>
                  <Link
                    href={`/workflows/${w.id}` as Route}
                    className="font-ui text-caption text-fg-secondary hover:text-accent rounded-xs outline-none focus-visible:focus-ring"
                  >
                    {w.name}
                  </Link>
                </li>
              ) : null)}
            </ul>
          </section>

          <section className="border-subtle bg-surface-raised rounded-lg border p-3">
            <Text variant="eyebrow" tone="muted" className="mb-1.5 block">Activity</Text>
            <ol className="grid gap-2">
              {incident.activity.map((entry, i) => <ActivityRow key={i} entry={entry} />)}
            </ol>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}

function ActivityRow({ entry }: { entry: IncidentActivity }) {
  return (
    <li className="border-subtle border-l-2 pl-2">
      <Text variant="caption" tone="primary" className="block">
        <span className="font-code">{entry.actor}</span> — {entry.action}
      </Text>
      <Text variant="caption" tone="disabled" className="block" tabular>
        {new Date(entry.at).toISOString().replace("T", " ").slice(0, 16)}Z
      </Text>
      {entry.note ? (
        <Text variant="caption" tone="muted" className="mt-0.5 block">“{entry.note}”</Text>
      ) : null}
    </li>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="caption" tone="primary" className="font-code">{children}</Text>
    </span>
  );
}

function Stat({ label, value, href, tone }: { label: string; value: string; href?: string; tone?: "failed" }) {
  const body = (
    <>
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd>
        <Text
          variant="body-sm" tone={tone ? "inherit" : "primary"} tabular
          className={tone === "failed" ? "text-status-failed" : undefined}
        >
          {value}
        </Text>
      </dd>
    </>
  );
  if (!href) return <div className="min-w-0">{body}</div>;
  return (
    <Link href={href as Route} className="hover:text-accent min-w-0 rounded-xs outline-none focus-visible:focus-ring">
      {body}
    </Link>
  );
}

export type { IncidentStatus };
