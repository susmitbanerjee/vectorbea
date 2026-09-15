"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { useSearchParamWriter } from "~/lib/url/use-search-param-writer";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { useWorkspaceRole } from "~/lib/workspace/workspace-provider";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Heatstrip } from "~/components/charts/heatstrip";
import { DataTable, type DataColumn, type TableStatus } from "~/components/data/table/data-table";
import { useTablePreferences, useSelection } from "~/components/data/table/table-state";
import { QueryBar } from "~/components/data/query-bar";
import {
  QuickFilters, SavedViewsMenu, useSavedViews, SEED_WORKFLOW_VIEWS, type QuickFilter,
} from "~/components/data/saved-views";
import {
  parseQuery, compileWorkflowPredicate, healthBand, WORKFLOW_QUERY,
} from "~/lib/query";
import { formatCost, formatDuration, EMPTY } from "~/lib/format";
import {
  WorkflowStatusBadge, TriggerCell, SuccessRateCell, LastRunCell, TagList,
  EnvironmentChip, StepsCell,
} from "./atoms";
import { WorkflowRowActions, DeleteWorkflowDialog, type WorkflowActionHandlers } from "./row-actions";
import { WorkflowBulkBar } from "./bulk-bar";
import { WorkflowCardGrid } from "./workflow-cards";
import type { Workflow } from "~/lib/workflows/model";
import { useWorkflowsData } from "./use-workflows-data";
import { CreateWorkflowDialog } from "./create-workflow-dialog";
import { useApi } from "~/lib/api/api-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   WORKFLOWS

   The gap this page closes: the old list told you a workflow existed and when it
   was edited. It could not tell you whether it was WORKING. The health column —
   a 30-run heatstrip per row — is the whole point: a workflow that has failed
   its last eleven runs is a band of red you see before reading a single name,
   and no arrangement of "83% success" across forty rows produces that.

   Everything else on the page exists to get you from that band to the cause:
   search that reaches inside the graph, so `node:postgres` finds every workflow
   that would break if one connection went down.
══════════════════════════════════════════════════════════════════════════════ */

export type ViewMode = "table" | "cards";

const VIEW_KEY = "vectorbea-workflows-view";

/**
 * View mode is a PREFERENCE, so it persists to localStorage and stays out of the
 * URL — nobody wants a shared link that also switches their colleague to cards.
 * Read after mount, never in the initialiser: a localStorage read during render
 * makes the server and first client render disagree, which Next renders as a
 * full-page hydration crash in dev.
 */
function useViewMode(): [ViewMode, (next: ViewMode) => void] {
  const [mode, setMode] = React.useState<ViewMode>("table");

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_KEY);
      if (raw === "cards" || raw === "table") setMode(raw);
    } catch {}
  }, []);

  const update = React.useCallback((next: ViewMode) => {
    setMode(next);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch {}
  }, []);

  return [mode, update];
}

/**
 * One lowercase haystack per workflow, built once.
 *
 * Includes the live version's node names, tool ids and every scalar config
 * value, which is what makes a bare search term reach INSIDE the graph:
 * "postgres" finds the workflow whose third node binds a Postgres connection
 * even though the word appears nowhere in its name or description. That is the
 * search an operator actually needs during an incident, and it is impossible
 * against a name-only index.
 */
function buildSearchIndex(workflows: Workflow[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const workflow of workflows) {
    const parts: string[] = [
      workflow.name, workflow.description, workflow.owner,
      workflow.environment, workflow.status, workflow.trigger,
      ...workflow.tags,
      ...workflow.triggers.map((t) => `${t.summary} ${t.detail}`),
    ];

    index.set(workflow.id, parts.join(" ").toLowerCase());
  }

  return index;
}

export interface WorkflowsViewProps {
  /** Overridable so the capture harness and Storybook can pin a state. */
  forceState?: TableStatus;
  forceView?: ViewMode;
}

export function WorkflowsView({ forceState, forceView }: WorkflowsViewProps) {
  const { canBuild } = useWorkspaceRole();
  const [pendingDelete, setPendingDelete] = React.useState<Workflow | null>(null);
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const data = useWorkflowsData();
  const workflows = data.rows;

  const frozen = params.get("frozen") === "1";
  /* Creation is URL-synced so `/workflows/new` can redirect here and the dialog
     is linkable — "start a workflow for me" is a link, not a set of clicks. */
  const creating = params.get("create") === "1";
  const urlQuery = params.get("q") ?? "";
  const stateParam = params.get("state") as TableStatus | null;
  const sortParam = params.get("sort") ?? "health:asc";

  const sort = React.useMemo(
    () =>
      sortParam.split(",").filter(Boolean).map((piece) => {
        const [id, dir] = piece.split(":");
        return { id, desc: dir !== "asc" };
      }),
    [sortParam],
  );

  /* Two writes in one tick must merge, not overwrite — the create dialogs do
     exactly that on success. See use-search-param-writer.ts. */
  const setParams = useSearchParamWriter();

  /* Local so typing is never gated on a router round trip; the URL catches up on
     submit and on chip or view selection. */
  const [queryInput, setQueryInput] = React.useState(urlQuery);
  React.useEffect(() => { setQueryInput(urlQuery); }, [urlQuery]);

  const [storedView, setStoredView] = useViewMode();
  const view = forceView ?? (params.get("view") as ViewMode | null) ?? storedView;

  const { views, save, remove, update } = useSavedViews("workflows", SEED_WORKFLOW_VIEWS);
  const [preferences, setPreferences] = useTablePreferences("workflows");

  /* ── Data ───────────────────────────────────────────────────────────────── */
  const searchIndex = React.useMemo(() => buildSearchIndex(workflows), [workflows]);
  const searchText = React.useCallback(
    (workflow: Workflow) => searchIndex.get(workflow.id) ?? "",
    [searchIndex],
  );

  const deferredQuery = React.useDeferredValue(queryInput);

  const filtered = React.useMemo(() => {
    const parsed = parseQuery(deferredQuery, WORKFLOW_QUERY.fields);
    const predicate = compileWorkflowPredicate(parsed, searchText);
    return workflows.filter(predicate);
  }, [deferredQuery, searchText, workflows]);

  const sorted = React.useMemo(() => {
    if (sort.length === 0) return filtered;
    const accessors: Record<string, (w: Workflow) => number | string> = {
      name: (w) => w.name,
      status: (w) => w.status,
      health: (w) => w.successRate30d,
      steps: (w) => w.stepCount,
      trigger: (w) => w.triggers[0]?.summary ?? w.trigger,
      lastRun: (w) => (w.lastRunAt ? Date.parse(w.lastRunAt) : 0),
      rate: (w) => w.successRate30d,
      duration: (w) => w.avgDurationMs ?? -1,
      spend: (w) => w.spend30dUsd,
      version: (w) => w.version,
      owner: (w) => w.owner,
    };
    const next = [...filtered];
    next.sort((a, b) => {
      for (const rule of sort) {
        const get = accessors[rule.id];
        if (!get) continue;
        const av = get(a);
        const bv = get(b);
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return rule.desc ? -cmp : cmp;
      }
      return 0;
    });
    return next;
  }, [filtered, sort]);

  const orderedIds = React.useMemo(() => sorted.map((w) => w.id), [sorted]);
  const selection = useSelection(orderedIds);
  const selected = React.useMemo(
    () => sorted.filter((w) => selection.isSelected(w.id)),
    [sorted, selection],
  );

  /* ── State resolution ───────────────────────────────────────────────────── */
  const [booted, setBooted] = React.useState(frozen);
  React.useEffect(() => {
    if (frozen) return;
    const id = window.setTimeout(() => setBooted(true), 260);
    return () => window.clearTimeout(id);
  }, [frozen]);

  const status: TableStatus =
    forceState ??
    stateParam ??
    (data.loading || !booted ? "loading"
      : data.error ? "error"
      : workflows.length === 0 ? "empty"
        : sorted.length === 0 ? "no-results"
          : "ready");

  /* ── Actions ────────────────────────────────────────────────────────────── */
  const applyQuery = React.useCallback((query: string) => {
    setQueryInput(query);
    setParams({ q: query });
    selection.clear();
  }, [setParams, selection]);

  const openWorkflow = React.useCallback(
    (workflow: Workflow, event: { metaKey: boolean; ctrlKey: boolean }) => {
      const href = `/workflows/${workflow.id}`;
      if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
      else router.push(href as Route);
    },
    [router],
  );

  const handlers = React.useMemo<WorkflowActionHandlers>(() => ({
    /* Same defect the builder's Run button had: the promise was discarded, so
       a refusal — no published version, real execution disabled, daily limit —
       was indistinguishable from a run that started. "Run now" from a list is
       a simulation: nothing on this screen asked for live connections. */
    onRunNow: (w) => {
      void api.workflows.run(
        w.id,
        { mode: "simulation" },
        { workspaceId: data.scope.workspaceId, environmentId: null },
      )
        .then(({ runId }) => {
          toast.success(`Test run started for ${w.name}.`, {
            action: { label: "Watch", onClick: () => router.push(`/runs/${runId}` as Route) },
          });
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error ? error.message : `${w.name} could not be started.`,
          );
        });
    },
    onExport: (w) => exportJson([w]),
    onRequestDelete: (w) => setPendingDelete(w),
    onSetStatus: (w, s) => { void api.workflows.update(w.id, { status: s }, data.scope).then(data.refetch); },
  }), [api, data, router]);

  /* ── Columns ────────────────────────────────────────────────────────────── */
  const columns = React.useMemo<DataColumn<Workflow>[]>(() => [
    {
      id: "select", header: "", width: 36, locked: true, skeletonWidth: 14,
      cell: (workflow, index) => (
        <span data-row-stop>
          <input
            type="checkbox"
            checked={selection.isSelected(workflow.id)}
            onChange={() => {}}
            onClick={(e) => { e.stopPropagation(); selection.toggle(workflow.id, index, e.shiftKey); }}
            aria-label={`Select ${workflow.name}`}
            className="accent-accent size-3.5 rounded-xs outline-none focus-visible:focus-ring"
          />
        </span>
      ),
    },
    {
      id: "name", header: "Workflow", width: 250, minWidth: 168,
      sortValue: (w) => w.name, skeletonWidth: 170,
      cell: (workflow) => (
        <span className="flex min-w-0 flex-col justify-center leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-ui text-body-sm text-fg-primary truncate">{workflow.name}</span>
            <EnvironmentChip environment={workflow.environment} />
          </span>
          <span className="font-ui text-caption text-fg-muted truncate">{workflow.description}</span>
        </span>
      ),
    },
    {
      id: "status", header: "Status", width: 104, minWidth: 88,
      sortValue: (w) => w.status, skeletonWidth: 66,
      cell: (workflow) => <WorkflowStatusBadge status={workflow.status} />,
    },
    {
      /* The point of the page. Cells are 4px so thirty of them fit a column an
         operator can still scan across forty rows. */
      id: "health", header: "Health", width: 176, minWidth: 120,
      sortValue: (w) => w.successRate30d, skeletonWidth: 150,
      cell: (workflow) => (
        <span data-row-stop className="flex">
          {!workflow.hasRunData ? <Text variant="caption" tone="disabled">{EMPTY}</Text> :
          <Heatstrip
            statuses={workflow.last30}
            runIds={workflow.last30RunIds}
            label={workflow.name}
            cellWidth={4}
            cellHeight={16}
            gap={1}
            onSelect={(_, runId) => { if (runId) router.push(`/runs/${runId}` as Route); }}
          />}
        </span>
      ),
    },
    {
      id: "steps", header: "Steps", width: 86, minWidth: 68,
      sortValue: (w) => w.stepCount, skeletonWidth: 40,
      cell: (workflow) => (
        <StepsCell steps={workflow.stepCount} agents={workflow.agentCount} tools={workflow.toolCount} />
      ),
    },
    {
      id: "trigger", header: "Trigger", width: 148, minWidth: 96,
      sortValue: (w) => w.triggers[0]?.summary ?? w.trigger, skeletonWidth: 100,
      cell: (workflow) => (
        <TriggerCell kind={workflow.trigger} summary={workflow.triggers[0]?.summary ?? workflow.trigger} />
      ),
    },
    {
      id: "lastRun", header: "Last run", width: 108, minWidth: 84,
      sortValue: (w) => (w.lastRunAt ? Date.parse(w.lastRunAt) : 0), skeletonWidth: 62,
      cell: (workflow) => <LastRunCell status={workflow.lastRunStatus} at={workflow.lastRunAt} />,
    },
    {
      id: "rate", header: "Success 30d", width: 96, numeric: true, minWidth: 78,
      sortValue: (w) => w.successRate30d, skeletonWidth: 36,
      cell: (workflow) => workflow.hasRunData
        ? <SuccessRateCell rate={workflow.successRate30d} />
        : <Text variant="caption" tone="disabled">{EMPTY}</Text>,
    },
    {
      id: "duration", header: "Avg duration", width: 100, numeric: true, minWidth: 80,
      sortValue: (w) => w.avgDurationMs ?? -1, skeletonWidth: 48,
      cell: (workflow) => (
        <Text variant="caption" tone="secondary" tabular>{formatDuration(workflow.avgDurationMs)}</Text>
      ),
    },
    {
      id: "spend", header: "Spend 30d", width: 92, numeric: true, minWidth: 76,
      sortValue: (w) => w.spend30dUsd, skeletonWidth: 46,
      cell: (workflow) => (
        <Text variant="caption" tone="secondary" tabular>{formatCost(workflow.spend30dUsd)}</Text>
      ),
    },
    {
      id: "version", header: "Version", width: 92, minWidth: 72,
      sortValue: (w) => w.version, skeletonWidth: 34,
      cell: (workflow) => <VersionCell version={workflow.version} draft={workflow.draftVersion} known={workflow.versionKnown !== false} published={Boolean(workflow.versionKnown === false && workflow.draftVersion === null)} />,
    },
    {
      id: "owner", header: "Owner", width: 120, minWidth: 88,
      sortValue: (w) => w.owner, skeletonWidth: 74,
      cell: (workflow) => (
        <Text
          variant="caption"
          tone="secondary"
          className="truncate"
          title={workflow.tags.length > 0 ? `Tagged ${workflow.tags.join(", ")}` : undefined}
        >
          {workflow.owner}
        </Text>
      ),
    },
    {
      id: "actions", header: "", width: 44, locked: true, skeletonWidth: 14,
      cell: (workflow) => (
        <span data-row-stop className="flex justify-end">
          <WorkflowRowActions workflow={workflow} handlers={handlers} canBuild={canBuild} />
        </span>
      ),
    },
  ], [selection, router, handlers, canBuild]);

  /* ── Quick filters ──────────────────────────────────────────────────────── */
  const counts = React.useMemo(() => ({
    failing: workflows.filter((w) => w.hasRunData && healthBand(w.successRate30d) === "failing").length,
    active: workflows.filter((w) => w.status === "active").length,
    paused: workflows.filter((w) => w.status === "paused").length,
    draft: workflows.filter((w) => w.status === "draft").length,
    drafts: workflows.filter((w) => w.draftVersion !== null).length,
    scheduled: workflows.filter((w) => w.trigger === "schedule").length,
  }), [workflows]);

  const quickFilters: QuickFilter[] = [
    { id: "failing", label: "Failing", query: "health:failing", count: counts.failing, tone: "failed" },
    { id: "paused", label: "Paused", query: "status:paused", count: counts.paused, tone: "waiting" },
    { id: "active", label: "Active", query: "status:active", count: counts.active },
    { id: "draft", label: "Drafts", query: "status:draft", count: counts.draft },
    { id: "scheduled", label: "Scheduled", query: "trigger:schedule", count: counts.scheduled },
    { id: "prod", label: "Production", query: "env:production" },
  ];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Build"
        title="Workflows"
        description="Your workflows and how their recent runs went."
        actions={
          <>
            <ViewToggle
              value={view}
              onChange={(next) => {
                setStoredView(next);
                // Mirrored into the URL only when it is already there, so a
                // shared link keeps whatever the sender was looking at without
                // every toggle rewriting the address bar.
                if (params.get("view")) setParams({ view: next });
              }}
            />
            <SavedViewsMenu
              views={views}
              currentQuery={queryInput}
              onApply={applyQuery}
              onSave={save}
              onRemove={remove}
              onUpdate={update}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!canBuild}
              title={canBuild ? undefined : "Creating a workflow needs the developer role or higher. Ask an owner or admin."}
              onClick={() => setParams({ create: "1" })}
            >
              New workflow
            </Button>
          </>
        }
      />

      <div className="grid gap-3">
        <QueryBar
          schema={WORKFLOW_QUERY}
          value={queryInput}
          onChange={setQueryInput}
          onSubmit={applyQuery}
          resultCount={status === "ready" ? sorted.length : undefined}
        />

        <QuickFilters filters={quickFilters} activeQuery={queryInput} onApply={applyQuery} />

        {view === "table" ? (
          <DataTable<Workflow>
            label="Workflows"
            noun={["workflow", "workflows"]}
            rows={status === "ready" ? sorted : []}
            columns={columns}
            rowId={(w) => w.id}
            preferences={preferences}
            onPreferencesChange={setPreferences}
            status={status}
            renderState={(s) => (
              <WorkflowsTableState
                status={s}
                query={queryInput}
                onClear={() => applyQuery("")}
                onCreate={() => setParams({ create: "1" })}
              />
            )}
            sort={sort}
            onSortChange={(next) =>
              setParams({ sort: next.map((s) => `${s.id}:${s.desc ? "desc" : "asc"}`).join(",") })
            }
            isSelected={selection.isSelected}
            onToggleSelect={selection.toggle}
            onToggleSelectAll={selection.toggleAll}
            onOpenRow={openWorkflow}
            onRetryRow={(w) => handlers.onRunNow(w)}
            height={620}
          />
        ) : status === "ready" ? (
          <WorkflowCardGrid
            workflows={sorted}
            isSelected={selection.isSelected}
            onToggleSelect={selection.toggle}
            handlers={handlers}
            canBuild={canBuild}
            onSelectTag={(tag) => applyQuery(`tag:${tag}`)}
            onOpenRun={(runId) => router.push(`/runs/${runId}` as Route)}
          />
        ) : (
          <div className="border-subtle bg-surface-raised grid place-items-center rounded-lg border px-4 py-16">
            {status === "loading" ? <CardSkeletons /> : (
              <WorkflowsTableState
                status={status}
                query={queryInput}
                onClear={() => applyQuery("")}
                onCreate={() => setParams({ create: "1" })}
              />
            )}
          </div>
        )}
      </div>

      <CreateWorkflowDialog
        open={creating}
        onOpenChange={(next) => setParams({ create: next ? "1" : null })}
      />

      <WorkflowBulkBar
        selected={selected}
        onClear={selection.clear}
        onSetStatus={(items, next) => {
          void Promise.all(items.map((workflow) => api.workflows.update(workflow.id, { status: next }, data.scope)))
            .then(data.refetch);
        }}
        onExport={exportJson}
      />
      {/*
        ONE dialog for the whole table, mounted outside it. Per-row it sat under
        the row's click handler, so dismissing it opened the workflow detail
        whichever button you pressed.
      */}
      <DeleteWorkflowDialog
        workflow={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const workflow = pendingDelete;
          setPendingDelete(null);
          if (workflow) void api.workflows.delete(workflow.id, data.scope).then(data.refetch);
        }}
      />
    </PageContainer>
  );
}

/* P12 wires these to the API. Until then they are honest no-ops rather than fake
   success toasts — a toast that says "paused" when nothing paused is worse than
   no affordance at all. Export is real, because it can be. */
function exportJson(workflows: Workflow[]) {
  const payload = workflows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    status: w.status,
    environment: w.environment,
    owner: w.owner,
    tags: w.tags,
    version: w.version,
    draftVersion: w.draftVersion,
    triggers: w.triggers,
  }));

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = workflows.length === 1 ? `${workflows[0].name}.json` : `workflows-${workflows.length}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Cells ────────────────────────────────────────────────────────────────── */

/**
 * `v6` · `v6 +draft` · `— draft v1`.
 *
 * Version 0 means nothing has ever been published, which is not "version zero"
 * — it is the absence of a version, and the em dash is how this product says
 * that. A draft sitting past the live version is news: what is running is not
 * what the last person edited.
 */
function VersionCell({ version, draft, known = true, published = false }: { version: number; draft: number | null; known?: boolean; published?: boolean }) {
  if (!known && published) {
    return <Text variant="caption" tone="secondary">Published</Text>;
  }
  if (version === 0) {
    return (
      <span className="flex min-w-0 items-baseline gap-1">
        <Text variant="caption" tone="disabled">{EMPTY}</Text>
        <Text
          variant="caption"
          tone="inherit"
          className="text-status-waiting truncate text-[10px]"
          title="Never published"
        >
          draft v{draft ?? 1}
        </Text>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <Text variant="caption" tone="secondary" tabular>v{version}</Text>
      {draft ? (
        <Text
          variant="caption"
          tone="inherit"
          className="text-status-waiting truncate text-[10px]"
          title={`Draft v${draft} is unpublished`}
        >
          +draft
        </Text>
      ) : null}
    </span>
  );
}

/* ── View toggle ──────────────────────────────────────────────────────────── */

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (next: ViewMode) => void }) {
  return (
    <div role="group" aria-label="View" className="border-subtle bg-surface-raised flex items-center gap-0.5 rounded-md border p-0.5">
      {(["table", "cards"] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          title={mode === "table" ? "Table view" : "Card view"}
          className={cn(
            "grid size-6 place-items-center rounded-xs",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
            value === mode ? "bg-surface-active text-fg-primary" : "text-fg-disabled hover:text-fg-primary",
          )}
        >
          {mode === "table" ? <TableGlyph /> : <CardsGlyph />}
          <span className="sr-only">{mode === "table" ? "Table view" : "Card view"}</span>
        </button>
      ))}
    </div>
  );
}

function TableGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
      <rect x="1" y="2" width="10" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth={1.1} />
      <path d="M1 4.6h10M4.4 4.6V10" fill="none" stroke="currentColor" strokeWidth={1.1} />
    </svg>
  );
}

function CardsGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
      <rect x="1" y="1.6" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth={1.1} />
      <rect x="7" y="1.6" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth={1.1} />
      <rect x="1" y="7" width="4" height="3.6" rx="0.8" fill="none" stroke="currentColor" strokeWidth={1.1} />
      <rect x="7" y="7" width="4" height="3.6" rx="0.8" fill="none" stroke="currentColor" strokeWidth={1.1} />
    </svg>
  );
}

function CardSkeletons() {
  return (
    <div aria-hidden="true" className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="border-subtle grid gap-2 rounded-lg border p-3">
          <span
            data-motion="decorative"
            className="bg-surface-active block h-3 w-1/2 rounded-xs motion-safe:animate-[ink-fade-in_1.4s_ease-in-out_infinite_alternate]"
          />
          <span className="bg-surface-active block h-2 w-3/4 rounded-xs" />
          <span className="bg-surface-active mt-2 block h-4 w-full rounded-xs" />
          <span className="bg-surface-active block h-2 w-2/3 rounded-xs" />
        </div>
      ))}
    </div>
  );
}

/* ── Non-happy states ─────────────────────────────────────────────────────── */

function WorkflowsTableState({
  status, query, onClear, onCreate,
}: {
  status: Exclude<TableStatus, "ready">;
  query: string;
  onClear: () => void;
  onCreate: () => void;
}) {
  if (status === "loading") return null;

  if (status === "empty") {
    return (
      <div className="max-w-[36rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No workflows yet</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          A workflow is a graph of steps that survives a crash: each one commits as it goes, so a
          failure at step nine costs you step nine, not the whole run. Start from a template or
          describe what you want and let the Architect draft it.
        </Text>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="sm" onClick={onCreate}>
            New workflow
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={"/templates" as Route}>Browse templates</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (status === "no-results") {
    return (
      <div className="max-w-[36rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No workflows match this filter</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Nothing matched <code className="font-code text-mono-sm text-fg-primary">{query}</code>.
          Search reaches inside the graph, so a bare word also matches node names, tool ids and
          config values — a term that finds nothing here really is absent from every workflow.
        </Text>
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[36rem] text-center">
      <Text variant="heading-sm" tone="inherit" as="p" className="text-status-failed block">
        Could not load workflows
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
        The request to the workflows API timed out after 30 seconds. Nothing has stopped running —
        this is a read failure, and every schedule is still firing.
      </Text>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
