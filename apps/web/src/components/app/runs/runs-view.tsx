"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { DataTable, type DataColumn, type TableStatus } from "~/components/data/table/data-table";
import { useTablePreferences, useSelection } from "~/components/data/table/table-state";
import { QueryBar } from "~/components/data/query-bar";
import { QuickFilters, SavedViewsMenu, useSavedViews, type QuickFilter } from "~/components/data/saved-views";
import { FailureClusters } from "./failure-clusters";
import { BulkBar } from "./bulk-bar";
import { QuickPeek } from "./quick-peek";
import { TimeRangeControl } from "~/components/app/control/time-range";
import { parseQuery, compileRunPredicate } from "~/lib/query";
import { formatCost, formatDuration, formatTokens, EMPTY } from "~/lib/format";
import { resolveRange, DEFAULT_RANGE, type TimeRangeId } from "~/mocks/control";
import { RUNS } from "~/mocks/fixtures";
import { makeRunsAtScale, clusterFailures, countByStatus } from "~/mocks/runs-scale";
import type { Run, RunStatus } from "~/mocks/domain";
import {
  DurableRunIcon, IncidentIcon, ApprovalGateIcon, QueueDepthIcon, WorkerIcon,
} from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   RUNS

   The gap this page closes: you could not tell where a run got to before it
   died without opening it. The inline Ribbon in every row fixes that, and
   across forty rows it does something no per-run view can — it makes the SHAPE
   of the failures visible. Runs dying at step 2 are cheap to retry; runs dying
   at step 11 of 12 are not; and forty rows all dying at the same position is one
   broken dependency rather than forty broken runs.
══════════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-11T14:20:00Z").getTime();

const STATUS_META: Record<RunStatus, { label: string; icon: IconComponent; className: string }> = {
  succeeded: { label: "Succeeded", icon: DurableRunIcon, className: "text-status-success border-status-success-border bg-status-success-subtle" },
  failed: { label: "Failed", icon: IncidentIcon, className: "text-status-failed border-status-failed-border bg-status-failed-subtle" },
  running: { label: "Running", icon: WorkerIcon, className: "text-status-live border-status-live-border bg-status-live-subtle" },
  queued: { label: "Queued", icon: QueueDepthIcon, className: "text-status-queued border-status-queued-border bg-status-queued-subtle" },
  "awaiting-approval": { label: "Awaiting approval", icon: ApprovalGateIcon, className: "text-status-waiting border-status-waiting-border bg-status-waiting-subtle" },
  cancelled: { label: "Cancelled", icon: QueueDepthIcon, className: "text-status-cancelled border-status-cancelled-border bg-status-cancelled-subtle" },
};

const TRIGGER_GLYPH: Record<Run["trigger"], string> = {
  schedule: "M6 3v3l2 1.4",
  webhook: "M3 6h6M7 4l2 2-2 2",
  manual: "M6 2.6v6.8M3.4 6.6 6 9.2l2.6-2.6",
  api: "M4 3.4 2 6l2 2.6M8 3.4 10 6l-2 2.6",
};

export interface RunsViewProps {
  /** Overridable so the capture harness and Storybook can pin a state. */
  forceState?: TableStatus;
  /** Freeze relative timestamps for deterministic screenshots. */
  frozen?: boolean;
}

export function RunsView({ forceState, frozen: frozenProp }: RunsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const frozen = frozenProp ?? params.get("frozen") === "1";
  const scale = Number(params.get("scale") ?? "0");

  /* ── URL-synced view state ──────────────────────────────────────────────── */
  const urlQuery = params.get("q") ?? "";
  const rangeId = (params.get("range") ?? DEFAULT_RANGE) as TimeRangeId;
  const stateParam = params.get("state") as TableStatus | null;
  const sortParam = params.get("sort") ?? "started:desc";

  const sort = React.useMemo(
    () =>
      sortParam
        .split(",")
        .filter(Boolean)
        .map((piece) => {
          const [id, dir] = piece.split(":");
          return { id, desc: dir !== "asc" };
        }),
    [sortParam],
  );

  const setParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
    },
    [params, pathname, router],
  );

  /* The input is local so typing is never gated on a router round trip; the URL
     catches up on submit and on chip/cluster/view selection. */
  const [queryInput, setQueryInput] = React.useState(urlQuery);
  React.useEffect(() => { setQueryInput(urlQuery); }, [urlQuery]);

  const { views, save, remove, update } = useSavedViews();

  /* ── Data ───────────────────────────────────────────────────────────────── */
  const allRuns = React.useMemo(
    () => (scale > 0 ? makeRunsAtScale(scale) : RUNS),
    [scale],
  );

  const range = resolveRange(rangeId);

  const [preferences, setPreferences] = useTablePreferences("runs");

  /**
   * Filtering is one compiled predicate over one array, run against a DEFERRED
   * copy of the input.
   *
   * Measured, not assumed (tests/perf/runs-10k.mjs). At 10,000 rows the filter
   * pass plus the re-render costs ~110ms, which blows the 100ms budget and —
   * worse — blocks the keystroke that caused it, so the input visibly lags
   * behind the typist. useDeferredValue splits the two: the input updates at
   * urgent priority every keystroke, the table catches up at transition
   * priority and React abandons superseded passes instead of running all of
   * them.
   */
  const deferredQuery = React.useDeferredValue(queryInput);

  const filtered = React.useMemo(() => {
    const parsed = parseQuery(deferredQuery);
    const predicate = compileRunPredicate(parsed, NOW);
    const floor = range.durationMs === null ? 0 : NOW - range.durationMs;
    const out: Run[] = [];
    for (const run of allRuns) {
      if (Date.parse(run.startedAt) < floor) continue;
      if (predicate(run)) out.push(run);
    }
    return out;
  }, [allRuns, deferredQuery, range.durationMs]);

  const sorted = React.useMemo(() => {
    if (sort.length === 0) return filtered;
    const accessors: Record<string, (r: Run) => number | string> = {
      run: (r) => r.workflowName,
      status: (r) => r.status,
      duration: (r) => r.durationMs ?? -1,
      steps: (r) => r.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length,
      tokens: (r) => r.tokens,
      cost: (r) => r.costUsd,
      started: (r) => Date.parse(r.startedAt),
      trigger: (r) => r.trigger,
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

  const orderedIds = React.useMemo(() => sorted.map((r) => r.id), [sorted]);
  const selection = useSelection(orderedIds);
  const selectedRuns = React.useMemo(
    () => sorted.filter((r) => selection.isSelected(r.id)),
    [sorted, selection],
  );

  /* Chips and clusters count within the SAME time range as the table.
     Counting globally made a chip read "Failed 79" and then show 41 rows when
     clicked, because the table is range-scoped and the chip was not. Two
     numbers describing one filter must not disagree. */
  const inRange = React.useMemo(() => {
    const floor = range.durationMs === null ? 0 : NOW - range.durationMs;
    return allRuns.filter((r) => Date.parse(r.startedAt) >= floor);
  }, [allRuns, range.durationMs]);

  const statusCounts = React.useMemo(() => countByStatus(inRange), [inRange]);
  const clusters = React.useMemo(() => clusterFailures(inRange), [inRange]);

  /* ── Quick peek ─────────────────────────────────────────────────────────── */
  const [peek, setPeek] = React.useState<{ run: Run; el: HTMLElement } | null>(null);

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
    (!booted ? "loading"
      : allRuns.length === 0 ? "empty"
      : sorted.length === 0 ? "no-results"
      : "ready");

  /* ── Columns ────────────────────────────────────────────────────────────── */
  const columns = React.useMemo<DataColumn<Run>[]>(() => [
    {
      id: "select", header: "", width: 36, locked: true, skeletonWidth: 14,
      cell: (run, index) => (
        <span data-row-stop>
          <input
            type="checkbox"
            checked={selection.isSelected(run.id)}
            onChange={() => {}}
            onClick={(e) => { e.stopPropagation(); selection.toggle(run.id, index, e.shiftKey); }}
            aria-label={`Select run ${run.id}`}
            className="accent-accent size-3.5 rounded-xs outline-none focus-visible:focus-ring"
          />
        </span>
      ),
    },
    {
      id: "run", header: "Run", width: 236, minWidth: 160,
      sortValue: (r) => r.workflowName,
      skeletonWidth: 150,
      cell: (run) => (
        <span className="flex min-w-0 flex-col justify-center leading-tight">
          <span className="font-ui text-body-sm text-fg-primary truncate">{run.workflowName}</span>
          <span data-row-stop className="flex">
            <MonoId value={run.id} head={7} tail={4} srLabel="Run identifier" />
          </span>
        </span>
      ),
    },
    {
      id: "status", header: "Status", width: 128, minWidth: 92,
      sortValue: (r) => r.status,
      skeletonWidth: 80,
      cell: (run) => <StatusBadge status={run.status} />,
    },
    {
      // The point of the page.
      id: "ribbon", header: "Checkpoints", width: 168, minWidth: 96,
      skeletonWidth: 130,
      cell: (run) => (
        <CheckpointRibbon
          nodes={run.nodes}
          size="xs"
          runId={run.id}
          maxCells={40}
          className="w-full"
        />
      ),
    },
    {
      id: "trigger", header: "Trigger", width: 104, minWidth: 80,
      sortValue: (r) => r.trigger,
      skeletonWidth: 60,
      cell: (run) => (
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" aria-hidden="true" className="text-fg-muted size-3 shrink-0">
            <path d={TRIGGER_GLYPH[run.trigger]} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
            {run.trigger === "schedule" ? <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth={1.1} /> : null}
          </svg>
          <Text variant="caption" tone="secondary" className="truncate">{run.trigger}</Text>
        </span>
      ),
    },
    {
      id: "duration", header: "Duration", width: 92, numeric: true, minWidth: 72,
      sortValue: (r) => r.durationMs ?? -1,
      skeletonWidth: 46,
      cell: (run) => (
        <Text variant="caption" tone="secondary" tabular>{formatDuration(run.durationMs)}</Text>
      ),
    },
    {
      id: "steps", header: "Steps", width: 78, numeric: true, minWidth: 62,
      sortValue: (r) => r.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length,
      skeletonWidth: 34,
      cell: (run) => {
        const committed = run.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length;
        const partial = committed > 0 && committed < run.nodes.length;
        return (
          <Text
            variant="caption"
            tone={partial ? "inherit" : "secondary"}
            tabular
            className={partial ? "text-status-waiting" : undefined}
          >
            {committed}/{run.nodes.length}
          </Text>
        );
      },
    },
    {
      id: "tokens", header: "Tokens", width: 82, numeric: true, minWidth: 66,
      sortValue: (r) => r.tokens,
      skeletonWidth: 40,
      cell: (run) => (
        <Text variant="caption" tone="secondary" tabular>
          {run.tokens ? formatTokens(run.tokens) : EMPTY}
        </Text>
      ),
    },
    {
      id: "cost", header: "Cost", width: 86, numeric: true, minWidth: 70,
      sortValue: (r) => r.costUsd,
      skeletonWidth: 44,
      cell: (run) => (
        <Text variant="caption" tone="secondary" tabular>{formatCost(run.costUsd)}</Text>
      ),
    },
    {
      id: "started", header: "Started", width: 104, minWidth: 84,
      sortValue: (r) => Date.parse(r.startedAt),
      skeletonWidth: 56,
      cell: (run) => <StartedCell startedAt={run.startedAt} />,
    },
    {
      id: "actions", header: "", width: 40, locked: true, skeletonWidth: 14,
      cell: (run) => (
        <span data-row-stop className="flex justify-end">
          <Link
            href={`/runs/${run.id}` as Route}
            aria-label={`Open run ${run.id}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "text-fg-disabled hover:text-fg-primary grid size-6 place-items-center rounded-xs",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </span>
      ),
    },
  ], [selection]);

  /* ── Quick filters ──────────────────────────────────────────────────────── */
  const quickFilters: QuickFilter[] = [
    { id: "failed", label: "Failed", query: "status:failed", count: statusCounts.failed, tone: "failed" },
    { id: "running", label: "Running", query: "status:running", count: statusCounts.running, tone: "live" },
    { id: "queued", label: "Queued", query: "status:queued", count: statusCounts.queued },
    { id: "gates", label: "Awaiting approval", query: "status:awaiting-approval", count: statusCounts["awaiting-approval"], tone: "waiting" },
    { id: "today", label: "Last 24h", query: "since:24h" },
    { id: "expensive", label: "Over $0.01", query: "cost:>0.01" },
  ];

  const applyQuery = (query: string) => {
    setQueryInput(query);
    setParams({ q: query });
    selection.clear();
  };

  const openRun = (run: Run, event: { metaKey: boolean; ctrlKey: boolean }) => {
    const href = `/runs/${run.id}`;
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href as Route);
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Observe"
        title="Runs"
        description="Every execution, with the checkpoint shape inline — see where a run died without opening it."
        actions={
          <>
            <TimeRangeControl value={rangeId} onChange={(id) => setParams({ range: id })} />
            <SavedViewsMenu
              views={views}
              currentQuery={queryInput}
              onApply={applyQuery}
              onSave={save}
              onRemove={remove}
              onUpdate={update}
            />
          </>
        }
      />

      <div className="grid gap-3">
        <QueryBar
          value={queryInput}
          onChange={setQueryInput}
          onSubmit={applyQuery}
          resultCount={status === "ready" ? sorted.length : undefined}
        />

        <QuickFilters filters={quickFilters} activeQuery={queryInput} onApply={applyQuery} />

        <FailureClusters
          clusters={clusters}
          totalFailed={statusCounts.failed}
          activeQuery={queryInput}
          onSelect={applyQuery}
        />

        <DataTable<Run>
          label="Runs"
          rows={status === "ready" ? sorted : []}
          columns={columns}
          rowId={(r) => r.id}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          status={status}
          renderState={(s) => (
            <TableState
              status={s}
              onClear={() => applyQuery("")}
              query={queryInput}
            />
          )}
          sort={sort}
          onSortChange={(next) =>
            setParams({ sort: next.map((s) => `${s.id}:${s.desc ? "desc" : "asc"}`).join(",") })
          }
          isSelected={selection.isSelected}
          onToggleSelect={selection.toggle}
          onToggleSelectAll={selection.toggleAll}
          onOpenRow={openRun}
          onRetryRow={(run) => retry([run])}
          onRowHover={(run, el) => setPeek(run && el ? { run, el } : null)}
          height={640}
        />

        {/* A time range that truncates results is a partial answer and has to
            say so — silently showing 500 of 9,000 is how people conclude a
            problem is smaller than it is. */}
        {status === "ready" && range.durationMs !== null && filtered.length < allRuns.length ? (
          <Text variant="caption" tone="muted" className="block">
            Showing <span className="tabular">{sorted.length.toLocaleString("en-GB")}</span> of{" "}
            <span className="tabular">{allRuns.length.toLocaleString("en-GB")}</span> runs — the rest
            fall outside the {range.label} window.{" "}
            <button
              onClick={() => setParams({ range: "30d" })}
              className="text-accent hover:text-accent-hover rounded-xs underline decoration-dotted underline-offset-2 outline-none focus-visible:focus-ring"
            >
              Widen to 30d
            </button>
          </Text>
        ) : null}
      </div>

      <QuickPeek
        run={peek?.run ?? null}
        anchor={peek?.el ?? null}
        onRetry={(run) => retry([run])}
      />

      <BulkBar
        selected={selectedRuns}
        onClear={selection.clear}
        onRetry={retry}
        onCancel={(runs) => console.info("cancel", runs.length)}
        onCompare={(runs) => router.push(`/runs/compare?a=${runs[0].id}&b=${runs[1].id}` as Route)}
        onExport={(runs) => exportCsv(runs)}
      />
    </PageContainer>
  );
}

/* P12 wires these to the API. Until then they are honest no-ops rather than
   fake success toasts — a toast that says "retried" when nothing was retried is
   worse than no affordance. */
function retry(runs: Run[]) {
  console.info("retry from checkpoint", runs.map((r) => r.id));
}

function exportCsv(runs: Run[]) {
  const header = "id,workflow,status,started,duration_ms,steps_committed,steps_total,tokens,cost_usd";
  const body = runs
    .map((r) => {
      const committed = r.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length;
      return [
        r.id, r.workflowName, r.status, r.startedAt, r.durationMs ?? "",
        committed, r.nodes.length, r.tokens, r.costUsd,
      ].join(",");
    })
    .join("\n");

  const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `runs-${runs.length}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Cells ────────────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: RunStatus }) {
  const meta = STATUS_META[status];
  const Glyph = meta.icon;
  return (
    <span
      className={cn(
        "font-ui text-caption inline-flex min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5",
        meta.className,
      )}
    >
      <Glyph size={11} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

/**
 * Relative by default, absolute on hover.
 *
 * "3h ago" is what you want while scanning; the exact UTC timestamp is what you
 * need the moment you are correlating with someone else's logs.
 */
function StartedCell({ startedAt }: { startedAt: string }) {
  const at = Date.parse(startedAt);
  const absolute = new Date(at).toISOString().replace("T", " ").slice(0, 19) + "Z";
  const delta = NOW - at;
  const relative =
    delta < 60_000 ? `${Math.round(delta / 1000)}s ago`
    : delta < 3_600_000 ? `${Math.round(delta / 60_000)}m ago`
    : delta < 86_400_000 ? `${Math.round(delta / 3_600_000)}h ago`
    : `${Math.round(delta / 86_400_000)}d ago`;

  return (
    <Text variant="caption" tone="secondary" tabular>
      <time dateTime={startedAt} title={absolute}>{relative}</time>
    </Text>
  );
}

/* ── Non-happy states ─────────────────────────────────────────────────────── */

function TableState({
  status, query, onClear,
}: {
  status: Exclude<TableStatus, "ready">;
  query: string;
  onClear: () => void;
}) {
  if (status === "loading") return null;

  if (status === "empty") {
    return (
      <div className="max-w-[36rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">Nothing has run yet</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Runs appear here the moment a workflow executes — triggered on a schedule, by a webhook,
          or by hand. Each one keeps its checkpoint history, so you can see where it got to.
        </Text>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button asChild variant="primary" size="sm">
            <Link href={"/workflows" as Route}>Run a workflow</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={"/docs/first-workflow" as Route}>Read the tutorial</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (status === "no-results") {
    return (
      <div className="max-w-[36rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No runs match this filter</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Nothing matched <code className="font-code text-mono-sm text-fg-primary">{query}</code>.
          Widening the time range is the usual fix — the filter is applied within the selected
          window, not across all history.
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
        Could not load runs
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
        The request to the runs API timed out after 30 seconds. Your runs are unaffected — this is a
        read failure, and everything already committed is still committed.
      </Text>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
