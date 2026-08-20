"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { contracts } from "@vectorbea/shared";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader, PageMeta } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { Spinner } from "~/components/ui/spinner";
import { Heatstrip } from "~/components/charts/heatstrip";
import { NotAvailableYet } from "~/components/app/not-available-yet";
import { ControlSkeleton } from "~/components/app/control/skeletons";
import { formatDuration, formatCost, EMPTY } from "~/lib/format";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { fromStoredGraph } from "~/lib/workflows/graph-codec";
import type { BuilderGraph } from "~/lib/workflows/builder-graph";
import type { RunStatus } from "~/lib/workflows/model";
import { WorkflowStatusBadge } from "./atoms";

/* ══════════════════════════════════════════════════════════════════════════════
   WORKFLOW OVERVIEW — on real data

   Clicking a workflow lands HERE, not in the builder. The builder is where you
   change a workflow; this is where you find out whether you should. Dropping an
   operator into an editing canvas when their question was "is this thing
   working?" puts a destructive surface in front of a diagnostic one.

   WHAT THIS PAGE SHOWS IS BOUNDED BY WHAT THE API RETURNS, and that boundary is
   drawn explicitly rather than papered over. The previous version of this screen
   rendered a cost trend, a dependency graph and a checkpoint ribbon — all from
   fixtures, none of which have an endpoint. Those are marked
   `<NotAvailableYet>` here instead of being filled with numbers that look
   measured and are not.

   Three real sources: the workflow row, its versions (which carry the graph),
   and its runs.
══════════════════════════════════════════════════════════════════════════════ */

const RUN_WINDOW = 30;

export function WorkflowDetail({ workflowId }: { workflowId: string }) {
  const api = useApi();
  const router = useRouter();
  const scope = useScope();

  const keyScope = { workspaceId: scope.workspaceId, environmentId: null };
  const readScope = React.useMemo(
    () => ({ workspaceId: scope.workspaceId, environmentId: null }),
    [scope.workspaceId],
  );
  const enabled = Boolean(scope.workspaceId);

  const workflowQuery = useApiQuery({
    queryKey: queryKeys.workflows.detail(keyScope, workflowId),
    queryFn: () => api.workflows.get(workflowId, readScope),
    enabled,
  });

  const versionsQuery = useApiQuery({
    queryKey: queryKeys.workflows.versions(keyScope, workflowId),
    queryFn: () => api.workflows.versions(workflowId, { ...readScope, page: 1, pageSize: 50 }),
    enabled,
  });

  const runsQuery = useApiQuery({
    queryKey: queryKeys.runs.list(keyScope, { workflowId, pageSize: RUN_WINDOW }),
    queryFn: () => api.runs.list({ ...readScope, workflowId, page: 1, pageSize: RUN_WINDOW }),
    enabled,
    freshness: "live",
  });

  const workflow = workflowQuery.data ?? null;
  const versions = React.useMemo(
    () => [...(versionsQuery.data?.items ?? [])].sort((a, b) => b.version - a.version),
    [versionsQuery.data],
  );
  const current = React.useMemo(
    () => versions.find((v) => v.id === workflow?.currentVersionId) ?? versions[0] ?? null,
    [versions, workflow?.currentVersionId],
  );

  const graph = React.useMemo<BuilderGraph | null>(() => {
    if (!current) return null;
    const decoded = fromStoredGraph(current.graph);
    return decoded.nodes.length > 0 ? { nodes: decoded.nodes, edges: decoded.edges } : null;
  }, [current]);

  /* Oldest → newest, so the strip reads left-to-right as time. The list arrives
     newest-first. */
  const runs = React.useMemo(
    () => [...(runsQuery.data?.items ?? [])].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    ),
    [runsQuery.data],
  );

  if (workflowQuery.isPending) {
    return <PageContainer><ControlSkeleton /></PageContainer>;
  }

  if (workflowQuery.error || !workflow) {
    return <LoadFailure workflowId={workflowId} message={workflowQuery.error?.message} />;
  }

  const health = summarise(runs);

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
            <WorkflowStatusBadge status={toUiStatus(workflow.status)} />
          </span>
        }
        description={workflow.description ?? "No description yet."}
        metadata={
          <>
            <PageMeta label="Version">
              {current ? `v${current.version}` : EMPTY}
            </PageMeta>
            <PageMeta label="Steps">{workflow.stepCount}</PageMeta>
            <PageMeta label="Agents">{workflow.agentCount}</PageMeta>
            <PageMeta label="Tools">{workflow.toolCount}</PageMeta>
            <PageMeta label="Workflow id">
              <MonoId value={workflow.id} head={8} tail={4} srLabel="Workflow identifier" />
            </PageMeta>
          </>
        }
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/runs?q=workflow:${encodeURIComponent(workflow.name)}` as Route}>View runs</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/workflows/${workflow.id}/versions` as Route}>Version history</Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href={`/workflows/${workflow.id}/builder` as Route}>Open builder</Link>
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-3">
          <Card
            title="Health"
            help="The last thirty runs, oldest first. A band of red is the answer before you read a number."
          >
            {runsQuery.isPending ? (
              <WorkingRow label="Reading run history…" />
            ) : runsQuery.error ? (
              <Text variant="body-sm" tone="secondary" className="block">
                Run history could not be read, so health is unknown. The workflow itself is unaffected.
              </Text>
            ) : runs.length === 0 ? (
              <Text variant="body-sm" tone="secondary" className="block">
                This workflow has never run. Health appears once it has — nothing is wrong, there is
                simply nothing to measure yet.
              </Text>
            ) : (
              <div className="grid gap-3">
                <Heatstrip
                  statuses={runs.map((r) => toUiRunStatus(r.status))}
                  runIds={runs.map((r) => r.id)}
                  label={`Last ${runs.length} runs of ${workflow.name}`}
                  onSelect={(_, runId) => { if (runId) router.push(`/runs/${runId}` as Route); }}
                />
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Stat label="Runs" value={runs.length} />
                  <Stat
                    label="Success rate"
                    value={health.finished === 0 ? EMPTY : `${health.successRate}%`}
                  />
                  <Stat label="Avg duration" value={formatDuration(health.avgDurationMs)} />
                  <Stat label="Spend" value={formatCost(health.spendUsd)} />
                </div>
              </div>
            )}
          </Card>

          <Card
            title="The graph"
            help={
              graph
                ? "The current version, drawn where it was placed on the canvas."
                : undefined
            }
            action={
              <Button asChild size="xs" variant="secondary">
                <Link href={`/workflows/${workflow.id}/builder` as Route}>Edit</Link>
              </Button>
            }
          >
            {versionsQuery.isPending ? (
              <WorkingRow label="Reading the current version…" />
            ) : !graph ? (
              <EmptyGraph workflowId={workflow.id} hasVersion={Boolean(current)} />
            ) : (
              <GraphPreview graph={graph} label={`${workflow.name} graph`} />
            )}
          </Card>
        </div>

        <div className="grid min-w-0 gap-3">
          <Card title="Versions" help="Every save writes one. The newest is what runs.">
            {versionsQuery.isPending ? (
              <WorkingRow label="Loading…" />
            ) : versions.length === 0 ? (
              <Text variant="body-sm" tone="secondary" className="block">
                No versions yet — the workflow exists but has no graph. Open the builder to draw one.
              </Text>
            ) : (
              <ul className="grid gap-1">
                {versions.slice(0, 8).map((version) => (
                  <li
                    key={version.id}
                    className={cn(
                      "flex flex-wrap items-baseline gap-2 rounded-md px-2 py-1.5",
                      version.id === workflow.currentVersionId ? "bg-surface-selected" : null,
                    )}
                  >
                    <Text variant="body-sm" tone="primary" className="font-code">v{version.version}</Text>
                    {version.id === workflow.currentVersionId ? (
                      <Text variant="caption" tone="inherit" className="text-status-success">current</Text>
                    ) : null}
                    <Text variant="caption" tone="muted" className="ml-auto">
                      {countNodes(version)} node{countNodes(version) === 1 ? "" : "s"}
                    </Text>
                  </li>
                ))}
                {versions.length > 8 ? (
                  <li className="px-2 pt-1">
                    <Link
                      href={`/workflows/${workflow.id}/versions` as Route}
                      className="font-ui text-caption text-accent rounded-xs outline-none focus-visible:focus-ring"
                    >
                      {versions.length - 8} more
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </Card>

          <Card title="Cost trend">
            <NotAvailableYet
              label="Per-workflow cost over time"
              reason="Runs carry a cost each, but the API has no endpoint that aggregates them by workflow over a window."
            />
          </Card>

          <Card title="Dependencies">
            <NotAvailableYet
              label="Connection and tool dependencies"
              reason="The graph names the tools it binds, but nothing yet reports which connections they resolve to or whether those are healthy."
            />
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

/* ── The graph preview ────────────────────────────────────────────────────── */

const NODE_W = 168;
const NODE_H = 46;

/**
 * The current version, drawn AT ITS STORED POSITIONS.
 *
 * Deliberately not `<VersionGraph>`: that one re-runs `layoutGraph` and derives
 * edges by chaining node index to index+1, which is fine for a version-diff
 * thumbnail and wrong here. A workflow whose nodes were arranged by hand and
 * then shown in a different arrangement on its own detail page reads as two
 * different workflows.
 */
function GraphPreview({ graph, label }: { graph: BuilderGraph; label: string }) {
  const bounds = React.useMemo(() => {
    const xs = graph.nodes.map((n) => n.x);
    const ys = graph.nodes.map((n) => n.y);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs) + NODE_W,
      minY: Math.min(...ys), maxY: Math.max(...ys) + NODE_H,
    };
  }, [graph.nodes]);

  const pad = 24;
  const width = bounds.maxX - bounds.minX + pad * 2;
  const height = bounds.maxY - bounds.minY + pad * 2;
  const byId = React.useMemo(
    () => new Map(graph.nodes.map((n) => [n.node.id, n])),
    [graph.nodes],
  );

  return (
    <div className="bg-surface-sunken border-subtle overflow-auto rounded-md border" style={{ maxHeight: 380 }}>
      <svg
        viewBox={`${bounds.minX - pad} ${bounds.minY - pad} ${width} ${height}`}
        role="img"
        aria-label={`${label}. ${graph.nodes.length} steps: ${graph.nodes.map((n) => n.node.name).join(", ")}.`}
        style={{ width, minWidth: "100%", height: Math.min(height, 380) }}
        preserveAspectRatio="xMinYMin meet"
        className="block"
      >
        {graph.edges.map((edge) => {
          const a = byId.get(edge.source);
          const b = byId.get(edge.target);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={edge.id}
              d={`M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={edge.kind === "error" ? "var(--status-failed)" : "var(--border-default)"}
              strokeWidth={1.4}
              strokeDasharray={edge.kind === "conditional" ? "4 3" : undefined}
            />
          );
        })}

        {graph.nodes.map((n) => {
          const gate = n.node.kind === "approval";
          return (
            <g key={n.node.id} transform={`translate(${n.x} ${n.y})`}>
              <rect
                width={NODE_W} height={NODE_H} rx={8}
                fill={gate ? "var(--status-waiting-subtle)" : "var(--bg-raised)"}
                stroke={gate ? "var(--status-waiting-border)" : "var(--border-default)"}
                strokeWidth={gate ? 1.6 : 1.2}
              />
              <text x={11} y={18} className="font-code" fontSize={8} fill="var(--fg-muted)">
                {n.node.kind}
              </text>
              <text x={11} y={33} className="font-ui" fontSize={11} fill="var(--fg-primary)">
                {n.node.name.length > 20 ? `${n.node.name.slice(0, 19)}…` : n.node.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EmptyGraph({ workflowId, hasVersion }: { workflowId: string; hasVersion: boolean }) {
  return (
    <div className="grid gap-2">
      <Text variant="body-sm" tone="secondary" className="block max-w-[62ch]">
        {hasVersion
          ? "The current version has no nodes in it. Open the builder to add the first step."
          : "This workflow has no version yet, so there is no graph to draw. Open the builder — the first save records version 1."}
      </Text>
      <div>
        <Button asChild variant="primary" size="sm">
          <Link href={`/workflows/${workflowId}/builder` as Route}>Open builder</Link>
        </Button>
      </div>
    </div>
  );
}

/* ── Derivations ──────────────────────────────────────────────────────────── */

const FINISHED = new Set(["succeeded", "completed", "failed", "cancelled", "timed_out", "enqueue_failed"]);

function summarise(runs: contracts.RunSummary[]) {
  const finished = runs.filter((r) => FINISHED.has(r.status));
  const succeeded = finished.filter((r) => r.status === "succeeded" || r.status === "completed");
  const durations = finished.flatMap((r) => (r.durationMs == null ? [] : [r.durationMs]));

  return {
    finished: finished.length,
    successRate: finished.length === 0 ? 0 : Math.round((succeeded.length / finished.length) * 100),
    avgDurationMs: durations.length === 0
      ? null
      : Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length),
    spendUsd: runs.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0),
  };
}

function toUiRunStatus(status: string): RunStatus {
  if (status === "succeeded" || status === "completed") return "succeeded";
  if (status === "failed" || status === "timed_out" || status === "enqueue_failed") return "failed";
  if (status === "running" || status === "recovering") return "running";
  if (status === "awaiting_approval" || status === "waiting_for_approval" || status === "paused") return "awaiting-approval";
  if (status === "cancelled" || status === "cancellation_requested") return "cancelled";
  return "queued";
}

function toUiStatus(status: string) {
  return status === "active" || status === "paused" || status === "archived" ? status : "draft";
}

function countNodes(version: contracts.WorkflowVersion): number {
  const nodes = (version.graph as { nodes?: unknown })?.nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function Card({
  title, help, action, children,
}: {
  title: string;
  help?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border">
      <header className="border-subtle flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <Text variant="eyebrow" tone="muted">{title}</Text>
          {help ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{help}</Text>
          ) : null}
        </div>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text variant="caption" tone="muted" className="block">{label}</Text>
      <Text variant="body" tone="max" tabular className="block">{value}</Text>
    </div>
  );
}

function WorkingRow({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Spinner className="size-4" />
      <Text variant="body-sm" tone="secondary">{label}</Text>
    </span>
  );
}

function LoadFailure({ workflowId, message }: { workflowId: string; message?: string }) {
  const missing = message?.toLowerCase().includes("not found") ?? false;

  return (
    <PageContainer>
      <div className="border-subtle bg-surface-raised grid place-items-center rounded-lg border px-4 py-16">
        <div className="max-w-[36rem] text-center">
          <Text variant="heading-sm" tone="max" as="p" className="block">
            {missing ? "This workflow no longer exists" : "This workflow could not be loaded"}
          </Text>
          <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
            {missing
              ? "It was deleted, or the link points at a workflow in another workspace."
              : message ?? "The workflow could not be read. Nothing has been changed."}
          </Text>
          <Text variant="caption" tone="disabled" className="font-code mt-2 block">{workflowId}</Text>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button asChild variant="primary" size="sm">
              <Link href={"/workflows" as Route}>Back to workflows</Link>
            </Button>
            {!missing ? (
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Try again
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
