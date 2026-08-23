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
import { formatDuration, formatTokens } from "~/lib/format";
import { useScope } from "~/lib/workspace/workspace-provider";
import { AdminState, describeAdminFailure } from "./admin-states";

/* ══════════════════════════════════════════════════════════════════════════════
   AUDIT LOG

   The record of what happened, which is a different job from the run history:
   Runs answers "did my workflow work", this answers "who or what touched this
   workspace, and when" — the question a security review asks, and the one an
   incident post-mortem starts from.

   THE FILTER RUNS IN THE DATABASE. It used to fetch the newest 100 rows and
   substring-match them in the browser, which quietly redefined "no results" as
   "not in the last 100 rows". On this surface that distinction is the whole
   point: an audit log that cannot prove absence is not an audit log.

   EXPORT SAYS WHAT IT EXPORTED. The button writes the rows matching the current
   filter, and its label carries the count, because an export that silently
   contains a page of a larger set is worse than no export — somebody will
   attach it to a compliance answer.
══════════════════════════════════════════════════════════════════════════════ */

interface AuditRow {
  timestamp: string;
  workspaceId: string;
  promptName: string;
  versionTag: string;
  proxyLatencyMs: number;
  llmLatencyMs: number;
  tokenCount: number;
  useType: "runtime" | "audit";
  metadata: Record<string, unknown>;
}

interface AuditPage {
  items: AuditRow[];
  page: number;
  pageSize: number;
  total: number;
}

const RANGES = [
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "7d", label: "Last 7 days", hours: 24 * 7 },
  { value: "30d", label: "Last 30 days", hours: 24 * 30 },
  { value: "90d", label: "Last 90 days", hours: 24 * 90 },
  { value: "all", label: "All time", hours: null },
] as const;

type RangeValue = (typeof RANGES)[number]["value"];

const PAGE_SIZE = 50;

export function AuditView() {
  const { workspaceId } = useScope();

  const [range, setRange] = React.useState<RangeValue>("7d");
  const [kind, setKind] = React.useState<"all" | "runtime" | "audit">("all");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<AuditRow | null>(null);
  const [preferences, setPreferences] = useTablePreferences("audit-log");
  const [sort, setSort] = React.useState([{ id: "recorded", desc: true }]);

  // Any filter change invalidates the page number — staying on page 7 of a
  // result set that now has two pages shows an empty table that looks like
  // "nothing matched" rather than "you are past the end".
  React.useEffect(() => { setPage(1); }, [range, kind, search]);

  const since = React.useMemo(() => {
    const hours = RANGES.find((entry) => entry.value === range)?.hours;
    if (!hours) return null;
    return new Date(Date.now() - hours * 3600_000).toISOString();
  }, [range]);

  const query = useQuery<AuditPage, Error>({
    queryKey: ["audit-log", workspaceId, since, search, page],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const params = new URLSearchParams({
        workspaceId: workspaceId!,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (since) params.set("since", since);
      if (search) params.set("q", search);
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

  /**
   * `useType` is derived from the metadata blob rather than stored, so it
   * cannot be a database predicate without a migration. Filtering it client-side
   * is therefore honest only about the page in hand — which is why the count
   * below reports the page, not the total, whenever this filter is on.
   */
  const rows = React.useMemo(() => {
    const items = query.data?.items ?? [];
    return kind === "all" ? items : items.filter((row) => row.useType === kind);
  }, [query.data, kind]);

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const status: TableStatus =
    query.isPending ? "loading"
      : query.error ? "error"
        : rows.length > 0 ? "ready"
          : search || kind !== "all" || range !== "all" ? "no-results"
            : "empty";

  const columns = React.useMemo<DataColumn<AuditRow>[]>(() => [
    {
      id: "recorded", header: "Recorded", width: 190, skeletonWidth: 150,
      sortValue: (row) => Date.parse(row.timestamp),
      cell: (row) => (
        <Text variant="caption" tone="secondary" tabular>
          {new Date(row.timestamp).toLocaleString()}
        </Text>
      ),
    },
    {
      id: "type", header: "Type", width: 100, skeletonWidth: 64,
      sortValue: (row) => row.useType,
      cell: (row) => (
        <span
          className={
            row.useType === "audit"
              ? "border-accent-border bg-accent-subtle text-accent font-ui text-caption rounded-full border px-1.5 py-0.5"
              : "border-subtle bg-surface-sunken text-fg-muted font-ui text-caption rounded-full border px-1.5 py-0.5"
          }
        >
          {row.useType === "audit" ? "Admin" : "Runtime"}
        </span>
      ),
    },
    {
      id: "event", header: "Event", width: 280, skeletonWidth: 220,
      sortValue: (row) => row.promptName,
      cell: (row) => (
        <Text variant="body-sm" tone="primary" className="truncate">
          {row.promptName || "Unlabelled event"}
        </Text>
      ),
    },
    {
      id: "version", header: "Version", width: 130, skeletonWidth: 80,
      sortValue: (row) => row.versionTag,
      cell: (row) => row.versionTag
        ? <Text variant="mono-sm" tone="secondary" className="truncate">{row.versionTag}</Text>
        : <Text variant="caption" tone="disabled">—</Text>,
    },
    {
      id: "proxy", header: "Proxy", width: 90, numeric: true, skeletonWidth: 48,
      sortValue: (row) => row.proxyLatencyMs,
      cell: (row) => <Text variant="caption" tone="secondary" tabular>{formatDuration(row.proxyLatencyMs)}</Text>,
    },
    {
      id: "llm", header: "LLM", width: 90, numeric: true, skeletonWidth: 48,
      sortValue: (row) => row.llmLatencyMs,
      cell: (row) => <Text variant="caption" tone="secondary" tabular>{formatDuration(row.llmLatencyMs)}</Text>,
    },
    {
      id: "tokens", header: "Tokens", width: 90, numeric: true, skeletonWidth: 48,
      sortValue: (row) => row.tokenCount,
      cell: (row) => <Text variant="caption" tone="secondary" tabular>{formatTokens(row.tokenCount)}</Text>,
    },
  ], []);

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Audit log"
        description="Append-only record of runtime and administrative activity. Filtering and paging run in the database, so an empty result means it did not happen in this range — not that it fell outside a page."
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

      <form onSubmit={applySearch} className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_10rem]">
        <Field label="Search" labelHidden>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search event or version — press Enter"
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
        <Field label="Type" labelHidden>
          <Select
            aria-label="Record type"
            value={kind}
            onValueChange={(value) => setKind(value as typeof kind)}
            options={[
              { value: "all", label: "All types" },
              { value: "audit", label: "Admin", description: "Configuration and access changes" },
              { value: "runtime", label: "Runtime", description: "Model and tool activity" },
            ]}
          />
        </Field>
      </form>

      <DataTable<AuditRow>
        label="Audit records"
        noun={["record", "records"]}
        rows={status === "ready" ? rows : []}
        columns={columns}
        rowId={(row) => `${row.timestamp}-${row.promptName}-${row.versionTag}`}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        status={status}
        renderState={(state) => (
          <AuditState
            status={state}
            error={query.error}
            onClear={() => { setSearchInput(""); setSearch(""); setKind("all"); setRange("all"); }}
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

/* ── The full record ──────────────────────────────────────────────────────── */

/**
 * Every stored field, including the raw metadata.
 *
 * The table shows what is scannable; an audit record is only useful once you
 * can see all of it, and the metadata blob is where the actor, the IP and the
 * changed values live. It is rendered as formatted JSON rather than parsed into
 * fields because its shape is not fixed, and inventing a schema for it here
 * would hide exactly the keys nobody anticipated.
 */
function RecordDetail({ row, onClose }: { row: AuditRow | null; onClose: () => void }) {
  return (
    <Modal open={row !== null} onOpenChange={(next) => { if (!next) onClose(); }} size="lg">
      <ModalHeader
        eyebrow="Govern · Audit log"
        title={row?.promptName || "Unlabelled event"}
        description={row ? new Date(row.timestamp).toLocaleString() : undefined}
      />
      <ModalLayout>
        <ModalBody>
          {row ? (
            <div className="grid gap-4">
              <ModalSection title="Record">
                <dl className="border-subtle divide-subtle divide-y rounded-md border">
                  <Row label="Recorded">{new Date(row.timestamp).toISOString()}</Row>
                  <Row label="Type">{row.useType === "audit" ? "Administrative" : "Runtime"}</Row>
                  <Row label="Version">{row.versionTag || "—"}</Row>
                  <Row label="Proxy latency">{formatDuration(row.proxyLatencyMs)}</Row>
                  <Row label="LLM latency">{formatDuration(row.llmLatencyMs)}</Row>
                  <Row label="Tokens">{formatTokens(row.tokenCount)}</Row>
                  <Row label="Workspace"><MonoId value={row.workspaceId} srLabel="Workspace id" /></Row>
                </dl>
              </ModalSection>

              <ModalSection title="Metadata" description="Exactly as recorded. Nothing is normalised on the way out.">
                <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary max-h-72 overflow-auto rounded-md border p-3">
                  {JSON.stringify(row.metadata ?? {}, null, 2)}
                </pre>
              </ModalSection>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-3 px-3 py-2">
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
      body="Records appear here as soon as anything runs or anyone changes workspace configuration. Nothing is written retroactively, so an empty log on a new workspace is expected."
    />
  );
}

/* ── Export ───────────────────────────────────────────────────────────────── */

function exportRows(rows: AuditRow[], range: string, search: string) {
  const header = ["recorded", "type", "event", "version", "proxy_ms", "llm_ms", "tokens", "metadata"];
  const body = [
    header.join(","),
    ...rows.map((row) => [
      row.timestamp, row.useType, row.promptName, row.versionTag,
      row.proxyLatencyMs, row.llmLatencyMs, row.tokenCount, JSON.stringify(row.metadata ?? {}),
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")),
  ].join("\n");

  // The filename carries the filter. An export called `audit-log.csv` tells the
  // person who receives it nothing about what was and was not in scope.
  const suffix = [range, search ? "filtered" : null].filter(Boolean).join("-");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `audit-log-${suffix}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
