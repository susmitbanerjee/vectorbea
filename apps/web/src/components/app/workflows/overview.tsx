"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader, PageMeta } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { Heatstrip } from "~/components/charts/heatstrip";
import { CostTrendChart } from "~/components/charts/cost-trend";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { formatCost, formatDuration, EMPTY } from "~/lib/format";
import { resolveRange } from "~/mocks/control";
import {
  currentVersion, liveVersion, draftVersion, versionsFor, recentRuns,
  dependencies, workflowCostTrend, validateVersion,
  type DependencyHealth,
} from "~/mocks/workflow-versions";
import {
  WorkflowStatusBadge, EnvironmentChip, TagList, TriggerGlyph, RelativeTime,
  SuccessRateCell,
} from "./atoms";
import { WorkflowRowActions, type WorkflowActionHandlers } from "./row-actions";
import { VersionGraph } from "./graph-canvas";
import type { Workflow } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   WORKFLOW OVERVIEW

   Clicking a workflow lands HERE, not in the builder. The builder is where you
   change a workflow; this is where you find out whether you should. Dropping an
   operator into an editing canvas when their question was "is this thing
   working?" is the single worst default in the current product — it puts a
   destructive surface in front of a diagnostic question.

   Everything on the page answers one of four questions, in this order:
   is it healthy · what is it · what does it depend on · what does it cost.
══════════════════════════════════════════════════════════════════════════════ */

export function WorkflowOverview({ workflow }: { workflow: Workflow }) {
  const router = useRouter();

  const live = liveVersion(workflow.id);
  const draft = draftVersion(workflow.id);
  const current = currentVersion(workflow.id);
  const versions = versionsFor(workflow.id);
  const runs = React.useMemo(() => recentRuns(workflow.id), [workflow.id]);
  const deps = React.useMemo(() => dependencies(workflow.id), [workflow.id]);
  const range = resolveRange("30d");
  const trend = React.useMemo(() => workflowCostTrend(workflow.id, range), [workflow.id, range]);
  const findings = React.useMemo(
    () => validateVersion(current?.nodes ?? []),
    [current],
  );
  const errors = findings.filter((f) => f.severity === "error");

  const handlers = React.useMemo<WorkflowActionHandlers>(() => ({
    onRunNow: (w) => console.info("run now", w.id),
    onDuplicate: (w) => console.info("duplicate", w.id),
    onExport: (w) => console.info("export", w.id),
    onDelete: (w) => console.info("delete", w.id),
    onSetStatus: (w, s) => console.info("set status", w.id, s),
  }), []);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link
            href={"/workflows" as Route}
            className="hover:text-fg-secondary rounded-xs outline-none transition-colors duration-fast focus-visible:focus-ring"
          >
            Build · Workflows
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {workflow.name}
            <WorkflowStatusBadge status={workflow.status} />
          </span>
        }
        description={workflow.description}
        metadata={
          <>
            <PageMeta label="Owner">{workflow.owner}</PageMeta>
            <PageMeta label="Environment"><EnvironmentChip environment={workflow.environment} /></PageMeta>
            <PageMeta label="Version">{workflow.version === 0 ? EMPTY : `v${workflow.version}`}</PageMeta>
            <PageMeta label="Steps">{workflow.stepCount}</PageMeta>
            <span className="inline-flex items-baseline gap-1.5">
              <Text variant="caption" tone="muted">ID</Text>
              <MonoId value={workflow.id} head={8} tail={4} srLabel="Workflow identifier" />
            </span>
            <TagList tags={workflow.tags} max={4} onSelect={(tag) => router.push(`/workflows?q=tag:${tag}` as Route)} />
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => handlers.onRunNow(workflow)}>
              Run now
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/runs?q=workflow:${workflow.name}` as Route}>View runs</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/workflows/${workflow.id}/versions` as Route}>Version history</Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href={`/workflows/${workflow.id}/builder` as Route}>Open builder</Link>
            </Button>
            <WorkflowRowActions workflow={workflow} handlers={handlers} />
          </>
        }
      />

      <VersionBanner workflow={workflow} live={live} draft={draft} errorCount={errors.length} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          <HealthCard workflow={workflow} />
          <GraphCard workflow={workflow} nodes={current?.nodes ?? []} isDraft={!live} />
          <RecentRunsCard runs={runs} workflowName={workflow.name} />
        </div>

        <div className="grid min-w-0 gap-4">
          <TriggersCard workflow={workflow} />
          <DependenciesCard dependencies={deps} />
          <SpendCard trend={trend} range={range} />
          <VersionsCard workflow={workflow} versions={versions.slice(0, 4)} total={versions.length} />
        </div>
      </div>
    </PageContainer>
  );
}

/* ── Version banner ───────────────────────────────────────────────────────── */

/**
 * The one sentence that reconciles "what is running" with "what was last
 * edited". Those are different things in every version-controlled product and
 * the current builder shows neither — it shows "V1" and a History button with
 * nothing behind it.
 */
function VersionBanner({
  workflow, live, draft, errorCount,
}: {
  workflow: Workflow;
  live: ReturnType<typeof liveVersion>;
  draft: ReturnType<typeof draftVersion>;
  errorCount: number;
}) {
  const tone = draft ? "waiting" : live ? "neutral" : "waiting";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2",
        tone === "waiting"
          ? "border-status-waiting-border bg-status-waiting-subtle"
          : "border-subtle bg-surface-raised",
      )}
    >
      <span className={cn("shrink-0", tone === "waiting" ? "text-status-waiting" : "text-fg-muted")}>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
          <path d="M8 1.6 14 5v6l-6 3.4L2 11V5z" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
          <path d="M8 5.4v3.2M8 10.8h.01" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        </svg>
      </span>

      <Text variant="body-sm" tone="primary" className="min-w-0">
        {!live ? (
          <>
            Nothing published yet. <strong className="font-medium">Draft v{draft?.number ?? 1}</strong> exists
            but no version of this workflow has ever run.
          </>
        ) : draft ? (
          <>
            <strong className="font-medium">v{live.number}</strong> is live, published{" "}
            <RelativeTime iso={live.at} /> by {live.author}.{" "}
            {/* Only the first character is lowered. `toLowerCase()` on the whole
                sentence turned `contracts.getUpcomingRenewals` into
                `contracts.getupcomingrenewals`, which is not the name of
                anything and cannot be searched for. */}
            <strong className="font-medium">Draft v{draft.number}</strong> is ahead of it —{" "}
            {draft.changeSummary.charAt(0).toLowerCase() + draft.changeSummary.slice(1)}
          </>
        ) : (
          <>
            <strong className="font-medium">v{live.number}</strong> is live, published{" "}
            <RelativeTime iso={live.at} /> by {live.author}. No unpublished changes.
          </>
        )}
      </Text>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {errorCount > 0 ? (
          <Text variant="caption" tone="inherit" className="text-status-failed">
            {errorCount} validation {errorCount === 1 ? "error" : "errors"}
          </Text>
        ) : null}
        {draft || !live ? (
          <Button asChild variant="primary" size="sm">
            <Link href={`/workflows/${workflow.id}/publish` as Route}>Review and publish</Link>
          </Button>
        ) : (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/workflows/${workflow.id}/versions` as Route}>Compare versions</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Cards ────────────────────────────────────────────────────────────────── */

function Card({
  title, action, children, className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-surface-raised border-subtle min-w-0 rounded-lg border", className)}>
      <header className="border-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">{title}</Text>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function HealthCard({ workflow }: { workflow: Workflow }) {
  const router = useRouter();
  const succeeded = workflow.last30.filter((s) => s === "succeeded").length;
  const failed = workflow.last30.filter((s) => s === "failed").length;

  return (
    <Card
      title="Health — last 30 runs"
      action={<SuccessRateCell rate={workflow.successRate30d} />}
    >
      <Heatstrip
        statuses={workflow.last30}
        runIds={workflow.last30RunIds}
        label={workflow.name}
        cellWidth={16}
        cellHeight={34}
        gap={4}
        onSelect={(_, runId) => { if (runId) router.push(`/runs/${runId}` as Route); }}
        className="overflow-x-auto"
      />
      <dl className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Stat label="Succeeded" value={String(succeeded)} tone="success" />
        <Stat label="Failed" value={String(failed)} tone="failed" />
        <Stat label="Avg duration" value={formatDuration(workflow.avgDurationMs)} />
        <Stat label="Spend 30d" value={formatCost(workflow.spend30dUsd)} />
      </dl>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "failed" }) {
  return (
    <div>
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd>
        <Text
          variant="body-sm"
          tone={tone ? "inherit" : "primary"}
          tabular
          className={tone === "success" ? "text-status-success" : tone === "failed" ? "text-status-failed" : undefined}
        >
          {value}
        </Text>
      </dd>
    </div>
  );
}

function GraphCard({
  workflow, nodes, isDraft,
}: {
  workflow: Workflow;
  nodes: Parameters<typeof VersionGraph>[0]["nodes"];
  isDraft: boolean;
}) {
  return (
    <Card
      title={isDraft ? "Graph — draft" : "Graph — live version"}
      action={
        <Button asChild variant="ghost" size="xs">
          <Link href={`/workflows/${workflow.id}/builder` as Route}>Edit in builder</Link>
        </Button>
      }
    >
      {/* Read-only, and it says so. This is not the builder with editing
          disabled: it is a picture of the graph, and a picture that offers a
          drag handle it will not honour is worse than one that offers none. */}
      <VersionGraph nodes={nodes} label={`${workflow.name} graph`} height={230} />
      <Text variant="caption" tone="muted" className="mt-2 block">
        Read-only preview. {workflow.stepCount} steps · {workflow.agentCount} agents ·{" "}
        {workflow.toolCount} tool calls.
      </Text>
    </Card>
  );
}

function RecentRunsCard({ runs, workflowName }: { runs: ReturnType<typeof recentRuns>; workflowName: string }) {
  return (
    <Card
      title="Recent runs"
      action={
        <Button asChild variant="ghost" size="xs">
          <Link href={`/runs?q=workflow:${workflowName}` as Route}>All runs</Link>
        </Button>
      }
    >
      {runs.length === 0 ? (
        <Text variant="body-sm" tone="muted">
          This workflow has not run yet. Runs appear the moment a trigger fires or somebody starts
          one by hand.
        </Text>
      ) : (
        <ul className="grid gap-px">
          {runs.map((run) => (
            <li key={run.id}>
              <Link
                href={`/runs/${run.id}` as Route}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 py-1.5",
                  "hover:bg-surface-hover transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CheckpointRibbon nodes={run.nodes} size="xs" runId={run.id} maxCells={40} className="w-28 shrink-0" />
                  <Text variant="caption" tone="secondary" className="truncate">
                    <RelativeTime iso={run.startedAt} />
                  </Text>
                </span>
                <span className="flex items-center gap-3">
                  <Text variant="caption" tone="secondary" tabular>{formatDuration(run.durationMs)}</Text>
                  <Text variant="caption" tone="secondary" tabular>{formatCost(run.costUsd)}</Text>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TriggersCard({ workflow }: { workflow: Workflow }) {
  return (
    <Card
      title="Triggers"
      action={
        <Button asChild variant="ghost" size="xs">
          <Link href={"/triggers" as Route}>Manage</Link>
        </Button>
      }
    >
      <ul className="grid gap-2">
        {workflow.triggers.map((trigger) => (
          <li key={trigger.id} className="grid gap-0.5">
            <span className="flex items-center gap-1.5">
              <TriggerGlyph kind={trigger.kind} className={trigger.enabled ? "text-status-success" : "text-fg-disabled"} />
              <Text variant="body-sm" tone="primary" className="truncate">{trigger.summary}</Text>
              {/* A suspended trigger is the reason a paused workflow is not
                  running. Saying so here saves the trip to the Triggers page. */}
              {!trigger.enabled ? (
                <Text variant="caption" tone="inherit" className="text-status-waiting">suspended</Text>
              ) : null}
            </span>
            <Text variant="caption" tone="muted" className="truncate font-code">{trigger.detail}</Text>
            {trigger.nextFireAt && trigger.enabled ? (
              <Text variant="caption" tone="muted">
                Next fire <RelativeTime iso={trigger.nextFireAt} />
                {trigger.timezone ? ` · ${trigger.timezone}` : null}
              </Text>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const DEP_TONE: Record<DependencyHealth["status"], string> = {
  healthy: "text-status-success",
  degraded: "text-status-waiting",
  failing: "text-status-failed",
  unknown: "text-fg-disabled",
};

function DependenciesCard({ dependencies: deps }: { dependencies: DependencyHealth[] }) {
  const broken = deps.filter((d) => d.status === "failing").length;

  return (
    <Card
      title="Connections and tools"
      action={
        broken > 0 ? (
          <Text variant="caption" tone="inherit" className="text-status-failed">
            {broken} failing
          </Text>
        ) : null
      }
    >
      {deps.length === 0 ? (
        <Text variant="body-sm" tone="muted">
          This workflow calls no tools and binds no connections. Nothing outside the workspace can
          break it.
        </Text>
      ) : (
        <ul className="grid gap-2">
          {deps.map((dep) => (
            <li key={`${dep.kind}-${dep.name}`}>
              <Link
                href={dep.href as Route}
                className={cn(
                  "-mx-1 grid gap-0.5 rounded-sm px-1 py-1",
                  "hover:bg-surface-hover transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className={cn("shrink-0", DEP_TONE[dep.status])} aria-hidden="true">
                    <svg viewBox="0 0 8 8" className="size-1.5">
                      <circle cx="4" cy="4" r="3" fill="currentColor" />
                    </svg>
                  </span>
                  <Text variant="body-sm" tone="primary" className="truncate">{dep.name}</Text>
                  <Text variant="caption" tone="disabled" className="ml-auto shrink-0">{dep.kind}</Text>
                </span>
                <Text variant="caption" tone="muted" className="truncate">{dep.detail}</Text>
                {/* Which nodes break with it — a red dot is a fact, this is the
                    decision about whether the workflow can run at all. */}
                <Text variant="caption" tone="disabled" className="truncate">
                  Used by {dep.usedByNodes.join(", ")}
                </Text>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SpendCard({
  trend, range,
}: {
  trend: ReturnType<typeof workflowCostTrend>;
  range: ReturnType<typeof resolveRange>;
}) {
  return (
    <Card
      title="Spend — 30 days"
      action={<Text variant="caption" tone="secondary" tabular>{formatCost(trend.totalUsd)}</Text>}
    >
      <CostTrendChart data={trend} range={range} height={130} />
    </Card>
  );
}

function VersionsCard({
  workflow, versions, total,
}: {
  workflow: Workflow;
  versions: ReturnType<typeof versionsFor>;
  total: number;
}) {
  return (
    <Card
      title="Recent versions"
      action={
        <Button asChild variant="ghost" size="xs">
          <Link href={`/workflows/${workflow.id}/versions` as Route}>All {total}</Link>
        </Button>
      }
    >
      <ol className="grid gap-2">
        {versions.map((version) => (
          <li key={version.id} className="grid gap-0.5">
            <span className="flex items-baseline gap-2">
              <Text variant="body-sm" tone="primary" tabular>v{version.number}</Text>
              {!version.published ? (
                <Text variant="caption" tone="inherit" className="text-status-waiting">draft</Text>
              ) : null}
              <Text variant="caption" tone="muted" className="ml-auto shrink-0">
                <RelativeTime iso={version.at} />
              </Text>
            </span>
            <Text variant="caption" tone="secondary" className="break-words">{version.changeSummary}</Text>
            <Text variant="caption" tone="disabled">
              {version.author}
              {version.runCount > 0 ? ` · ${version.runCount} runs at ${version.successRate}%` : " · never ran"}
            </Text>
          </li>
        ))}
      </ol>
    </Card>
  );
}
