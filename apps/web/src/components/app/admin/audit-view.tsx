"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { DownloadSimple, MagnifyingGlass, CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";

import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field } from "~/components/ui/field";
import { Select } from "~/components/ui/select";
import { MonoId } from "~/components/ui/mono-id";
import { Modal, ModalBody, ModalFooter, ModalHeader, ModalLayout, ModalSection } from "~/components/ui/modal";
import { DataTable, type DataColumn, type TableStatus } from "~/components/data/table/data-table";
import { useTablePreferences } from "~/components/data/table/table-state";
import { useScope } from "~/lib/workspace/workspace-provider";
import { cn } from "~/lib/cn";
import { AdminState, describeAdminFailure } from "./admin-states";

/* ══════════════════════════════════════════════════════════════════════════════
   AUDIT LOG

   The record of what happened, which is a different job from the run history:
   Runs answers "did my workflow work", this answers "who or what touched this
   workspace, and when" — the question a security review asks, and the one an
   incident post-mortem starts from.

   IT READS THE TABLE THAT IS WRITTEN. This screen used to query Supabase
   `vectorbea.audit_logs`, the LLM-proxy latency ledger, in a project no
   deployment provisions — so it answered "audit records are not provisioned in
   this environment" while the real trail sat in Postgres `audit_log`, appended
   to by the Kotlin API on every login, publish, approval decision, connection
   change, member change, settings change, run cancellation and data export.
   The columns changed with it: an audit record has an actor, an action, a
   target and an outcome. It never had a token count.

   DENIALS ARE THE POINT. A log that only shows what succeeded answers the
   easy question. `result` is a first-class column and a first-class filter,
   because "who tried and was refused" is what an investigation opens with.

   EVERY FILTER RUNS IN THE DATABASE, and `total` counts the same predicates, so
   "no results" means it did not happen in this range — not that it fell outside
   a page. On this surface that distinction is the whole point: an audit log
   that cannot prove absence is not an audit log.
══════════════════════════════════════════════════════════════════════════════ */

type ActorType = "user" | "system" | "api_key";
type ActionResult = "success" | "denied" | "error";

interface AuditRow {
  id: string;
  timestamp: string;
  workspaceId: string;
  environmentId: string | null;
  actorType: ActorType;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  result: ActionResult;
  before: unknown;
  after: unknown;
  userAgent: string | null;
  ipHash: string | null;
}

interface AuditPage {
  items: AuditRow[];
  page: number;
  pageSize: number;
  total: number;
  actions: string[];
}

const RANGES = [
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "7d", label: "Last 7 days", hours: 24 * 7 },
  { value: "30d", label: "Last 30 days", hours: 24 * 30 },
  { value: "90d", label: "Last 90 days", hours: 24 * 90 },
  { value: "all", label: "All time", hours: null },
] as const;

type RangeValue = (typeof RANGES)[number]["value"];

const RESULT_LABEL: Record<ActionResult, string> = {
  success: "Succeeded",
  denied: "Denied",
  error: "Errored",
};

const ACTOR_LABEL: Record<ActorType, string> = {
  user: "User",
  system: "System",
  api_key: "API key",
};

const PAGE_SIZE = 50;

export function AuditView() {
  const { workspaceId } = useScope();

  const [range, setRange] = React.useState<RangeValue>("7d");
  const [action, setAction] = React.useState("all");
  const [result, setResult] = React.useState<"all" | ActionResult>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<AuditRow | null>(null);
  const [preferences, setPreferences] = useTablePreferences("audit-log");
  const [sort, setSort] = React.useState([{ id: "recorded", desc: true }]);

  // Any filter change invalidates the page number — staying on page 7 of a
  // result set that now has two pages shows an empty table that looks like
  // "nothing matched" rather than "you are past the end".
  React.useEffect(() => { setPage(1); }, [range, action, result, search]);

  const since = React.useMemo(() => {
    const hours = RANGES.find((entry) => entry.value === range)?.hours;
    if (!hours) return null;
    return new Date(Date.now() - hours * 3600_000).toISOString();
  }, [range]);

  const query = useQuery<AuditPage, Error>({
    queryKey: ["audit-log", workspaceId, since, search, action, result, page],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const params = new URLSearchParams({
        workspaceId: workspaceId!,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (since) params.set("since", since);
      if (search) params.set("q", search);
      if (action !== "all") params.set("action", action);
      if (result !== "all") params.set("result", result);
      const response = await fetch(`/api/audit?${params.toString()}`, { cache: "no-store" });
      const json = (await response.json()) as AuditPage | { error?: string; code?: string };
      if (!response.ok || !("items" in json)) {
        const error = new Error(("error" in json && json.error) || "Failed to load audit records");
        (error as Error & { code?: string }).code = "code" in json ? json.code : undefined;
        throw error;
      }
      return json;
    },
  });

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(search) || action !== "all" || result !== "all" || range !== "all";

  /**
   * The action filter offers what this workspace's log contains.
   *
   * A fixed list of every action the platform can record would offer twenty
   * options on a workspace that has produced three, and an operator who picks
   * one of the seventeen empty ones learns nothing about whether it never
   * happened or was never possible.
   */
  const actionOptions = React.useMemo(() => {
    const available = query.data?.actions ?? (action === "all" ? [] : [action]);
    return [
      { value: "all", label: "All actions" },
      ...available.map((entry) => ({ value: entry, label: entry })),
    ];
  }, [query.data, action]);

  const status: TableStatus =
    query.isPending ? "loading"
      : query.error ? "error"
        : rows.length > 0 ? "ready"
          : filtered ? "no-results"
            : "empty";

  const columns = React.useMemo<DataColumn<AuditRow>[]>(() => [
    {
      id: "recorded", header: "Recorded", width: 180, skeletonWidth: 150,
      sortValue: (row) => Date.parse(row.timestamp),
      cell: (row) => (
        <Text variant="caption" tone="secondary" tabular>
          {new Date(row.timestamp).toLocaleString()}
        </Text>
      ),
    },
    {
      id: "actor", header: "Actor", width: 220, skeletonWidth: 170,
      sortValue: (row) => row.actorLabel ?? row.actorId ?? row.actorType,
      cell: (row) => <ActorCell row={row} />,
    },
    {
      id: "action", header: "Action", width: 200, skeletonWidth: 160,
      sortValue: (row) => row.action,
      cell: (row) => (
        <Text variant="mono-sm" tone="primary" className="truncate">{row.action}</Text>
      ),
    },
    {
      id: "target", header: "Target", width: 220, skeletonWidth: 170,
      sortValue: (row) => row.targetType,
      cell: (row) => (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <Text variant="body-sm" tone="secondary" className="truncate">{row.targetType}</Text>
          {row.targetId
            ? <MonoId value={row.targetId} srLabel={`${row.targetType} id`} />
            : null}
        </span>
      ),
    },
    {
      id: "result", header: "Result", width: 110, skeletonWidth: 72,
      sortValue: (row) => row.result,
      cell: (row) => <ResultChip result={row.result} />,
    },
  ], []);

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setAction("all");
    setResult("all");
    setRange("all");
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Audit log"
        description="Append-only record of who or what changed this workspace, and whether they were allowed to. Filtering and paging run in the database, so an empty result means it did not happen in this range — not that it fell outside a page."
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={rows.length === 0}
            iconLeft={<Icon icon={DownloadSimple} size="sm" decorative />}
            onClick={() => exportRows(rows, range, search)}
          >
            Export {rows.length > 0 ? `${rows.length.toLocaleString()} shown` : ""}
          </Button>
        }
        metadata={
          query.data ? (
            <Text variant="caption" tone="muted" tabular>
              {total.toLocaleString()} record{total === 1 ? "" : "s"} in range
            </Text>
          ) : undefined
        }
      />

      <form onSubmit={applySearch} className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_12rem_10rem]">
        <Field label="Search" labelHidden>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search actor, action or target — press Enter"
            prefix={<Icon icon={MagnifyingGlass} size="sm" decorative />}
          />
        </Field>
        <Field label="Range" labelHidden>
          <Select
            aria-label="Time range"
            value={range}
            onValueChange={(value) => setRange(value as RangeValue)}
            options={RANGES.map((entry) => ({ value: entry.value, label: entry.label }))}
          />
        </Field>
        <Field label="Action" labelHidden>
          <Select
            aria-label="Action"
            value={action}
            onValueChange={setAction}
            options={actionOptions}
          />
        </Field>
        <Field label="Result" labelHidden>
          <Select
            aria-label="Result"
            value={result}
            onValueChange={(value) => setResult(value as typeof result)}
            options={[
              { value: "all", label: "All results" },
              { value: "success", label: "Succeeded" },
              { value: "denied", label: "Denied", description: "The actor was refused" },
              { value: "error", label: "Errored" },
            ]}
          />
        </Field>
      </form>

      <DataTable<AuditRow>
        label="Audit records"
        noun={["record", "records"]}
        rows={status === "ready" ? rows : []}
        columns={columns}
        rowId={(row) => row.id}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        status={status}
        renderState={(state) => (
          <AuditState
            status={state}
            error={query.error}
            onClear={clearFilters}
            onRetry={() => void query.refetch()}
          />
        )}
        sort={sort}
        onSortChange={setSort}
        onOpenRow={(row) => setOpen(row)}
        height={560}
      />

      {pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <Text variant="caption" tone="muted" tabular>
            Page {page} of {pageCount.toLocaleString()}
          </Text>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="secondary" disabled={page <= 1 || query.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              iconLeft={<Icon icon={CaretLeft} size="sm" decorative />}
            >
              Newer
            </Button>
            <Button
              size="sm" variant="secondary" disabled={page >= pageCount || query.isFetching}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              iconRight={<Icon icon={CaretRight} size="sm" decorative />}
            >
              Older
            </Button>
          </div>
        </div>
      ) : null}

      <RecordDetail row={open} onClose={() => setOpen(null)} />
    </PageContainer>
  );
}

/* ── Cells ────────────────────────────────────────────────────────────────── */

function ActorCell({ row }: { row: AuditRow }) {
  if (row.actorLabel) {
    return (
      <span className="flex min-w-0 flex-col">
        <Text variant="body-sm" tone="primary" className="truncate">{row.actorLabel}</Text>
        <Text variant="caption" tone="muted">{ACTOR_LABEL[row.actorType]}</Text>
      </span>
    );
  }
  if (row.actorId) {
    return (
      <span className="flex min-w-0 flex-col">
        <MonoId value={row.actorId} srLabel="Actor id" />
        <Text variant="caption" tone="muted">{ACTOR_LABEL[row.actorType]}</Text>
      </span>
    );
  }
  return <Text variant="body-sm" tone="secondary">{ACTOR_LABEL[row.actorType]}</Text>;
}

/**
 * Denials and errors are coloured; success is not.
 *
 * Painting every row green teaches the eye to skip the column, which is exactly
 * the column an investigation reads. Only the two outcomes worth stopping on
 * carry a hue.
 */
function ResultChip({ result }: { result: ActionResult }) {
  return (
    <span
      className={cn(
        "font-ui text-caption rounded-full border px-1.5 py-0.5",
        result === "denied"
          ? "border-status-waiting-border bg-status-waiting-subtle text-status-waiting"
          : result === "error"
            ? "border-status-failed-border bg-status-failed-subtle text-status-failed"
            : "border-subtle bg-surface-sunken text-fg-muted",
      )}
    >
      {RESULT_LABEL[result]}
    </span>
  );
}

/* ── The full record ──────────────────────────────────────────────────────── */

/**
 * Every stored field, including both sides of a change.
 *
 * The table shows what is scannable. "Someone changed the workspace settings"
 * is not an audit trail; "someone changed max_concurrent_runs from 2 to 50" is,
 * and that is what `before` and `after` carry. They are rendered as formatted
 * JSON rather than parsed into fields because their shape is not fixed, and
 * inventing a schema here would hide exactly the keys nobody anticipated.
 */
function RecordDetail({ row, onClose }: { row: AuditRow | null; onClose: () => void }) {
  return (
    <Modal open={row !== null} onOpenChange={(next) => { if (!next) onClose(); }} size="lg">
      <ModalHeader
        eyebrow="Govern · Audit log"
        title={row?.action ?? "Audit record"}
        description={row ? new Date(row.timestamp).toLocaleString() : undefined}
      />
      <ModalLayout>
        <ModalBody>
          {row ? (
            <div className="grid gap-4">
              <ModalSection title="Record">
                <dl className="border-subtle divide-subtle divide-y rounded-md border">
                  <Row label="Recorded">{new Date(row.timestamp).toISOString()}</Row>
                  <Row label="Action">{row.action}</Row>
                  <Row label="Result">{RESULT_LABEL[row.result]}</Row>
                  <Row label="Actor">
                    {row.actorLabel ?? row.actorId ?? "—"} ({ACTOR_LABEL[row.actorType]})
                  </Row>
                  <Row label="Target">{row.targetType}</Row>
                  <Row label="Target id">
                    {row.targetId ? <MonoId value={row.targetId} srLabel="Target id" /> : "—"}
                  </Row>
                  <Row label="Environment">
                    {row.environmentId
                      ? <MonoId value={row.environmentId} srLabel="Environment id" />
                      : "Workspace-level"}
                  </Row>
                  <Row label="Workspace"><MonoId value={row.workspaceId} srLabel="Workspace id" /></Row>
                  <Row label="Client">{row.userAgent ?? "—"}</Row>
                  <Row label="Client fingerprint">
                    {row.ipHash
                      ? <MonoId value={row.ipHash} srLabel="Hashed client address" />
                      : "—"}
                  </Row>
                </dl>
                <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
                  The client address is hashed, never stored. It answers &ldquo;was this the same client as
                  last time&rdquo; without making the audit trail a second source of personal data.
                </Text>
              </ModalSection>

              {row.before !== null || row.after !== null ? (
                <ModalSection
                  title="Change"
                  description="Both sides, exactly as recorded. Nothing is normalised on the way out."
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <JsonPanel label="Before" value={row.before} />
                    <JsonPanel label="After" value={row.after} />
                  </div>
                </ModalSection>
              ) : (
                <ModalSection title="Change">
                  <Text variant="body-sm" tone="muted" className="block leading-snug">
                    This action recorded no before/after state. Reads, sign-ins and cancellations change
                    nothing that can be diffed.
                  </Text>
                </ModalSection>
              )}
            </div>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </ModalFooter>
      </ModalLayout>
    </Modal>
  );
}

function JsonPanel({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <Text variant="caption" tone="muted" className="mb-1 block">{label}</Text>
      <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary max-h-72 overflow-auto rounded-md border p-3">
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-baseline gap-3 px-3 py-2">
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd className="min-w-0"><Text variant="body-sm" tone="primary" className="block break-words">{children}</Text></dd>
    </div>
  );
}

/* ── States ───────────────────────────────────────────────────────────────── */

function AuditState({
  status, error, onClear, onRetry,
}: {
  status: Exclude<TableStatus, "ready">;
  error: Error | null;
  onClear: () => void;
  onRetry: () => void;
}) {
  if (status === "loading") return null;

  if (status === "error" && error) {
    const failure = describeAdminFailure(error, "audit records");
    // The tone comes from the diagnosis, not from the fact that a request
    // failed: an unprovisioned table is amber (nothing is wrong, a deployment
    // step is outstanding), a genuine read failure is red. Hardcoding red here
    // taught the operator to ignore red on the one screen where it matters.
    return <AdminState tone={failure.tone} title={failure.title} body={failure.body} action={
      failure.retryable ? <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button> : undefined
    } />;
  }

  if (status === "no-results") {
    return (
      <AdminState
        tone="neutral"
        title="Nothing recorded in this range"
        body="The query reached the audit table and it returned no rows for these filters. That is a real absence, not a truncated page — widen the range to be sure."
        action={<Button size="sm" variant="secondary" onClick={onClear}>Clear filters</Button>}
      />
    );
  }

  return (
    <AdminState
      tone="neutral"
      title="No audit records yet"
      body="Records appear here the first time anyone signs in, publishes a workflow, decides an approval or changes a connection. Nothing is written retroactively, so an empty log on a new workspace is expected."
    />
  );
}

/* ── Export ───────────────────────────────────────────────────────────────── */

function exportRows(rows: AuditRow[], range: string, search: string) {
  const header = [
    "recorded", "actor_type", "actor", "action", "target_type", "target_id",
    "result", "environment_id", "before", "after",
  ];
  const body = [
    header.join(","),
    ...rows.map((row) => [
      row.timestamp,
      row.actorType,
      row.actorLabel ?? row.actorId ?? "",
      row.action,
      row.targetType,
      row.targetId ?? "",
      row.result,
      row.environmentId ?? "",
      row.before === null || row.before === undefined ? "" : JSON.stringify(row.before),
      row.after === null || row.after === undefined ? "" : JSON.stringify(row.after),
    ].map(csvCell).join(",")),
  ].join("\n");

  // The filename carries the filter. An export called `audit-log.csv` tells the
  // person who receives it nothing about what was and was not in scope.
  const suffix = [range, search ? "filtered" : null].filter(Boolean).join("-");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `audit-log-${suffix}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
