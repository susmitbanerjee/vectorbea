"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import { toast } from "sonner";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import { DataTable, type DataColumn, type TableStatus } from "~/components/data/table/data-table";
import { useTablePreferences, useSelection } from "~/components/data/table/table-state";
import { DetailSheet, Section, Facts } from "~/components/app/registry/detail-sheet";
import { Sparkline, HealthDot } from "~/components/app/registry/atoms";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { formatDuration, EMPTY } from "~/lib/format";
import {
  blastRadius, healthSummary, AUTH_LABEL, type ConnectionRecord,
} from "~/lib/connectivity/model";
import { useConnectionsData } from "./use-connections-data";
import { useApi } from "~/lib/api/api-provider";
import type { ConnectionTestResult, Scope } from "~/lib/api/client";
import { ConnectionEditor } from "./connection-editor";

/* ══════════════════════════════════════════════════════════════════════════════
   CONNECTIONS — the operational view.

   BLAST RADIUS IS THE ADDITION THAT MATTERS. Every other column here describes
   the connection; this one describes what happens to everything else when it
   breaks. The production failure this product actually had — a run dying at
   node n1001 because ‘Postgres Answers’ was unusable — was knowable from this
   row before it touched a single run.
══════════════════════════════════════════════════════════════════════════════ */

const DETAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "blast", label: "Blast radius" },
  { id: "health", label: "Health" },
  { id: "access", label: "Access" },
  { id: "audit", label: "Audit" },
  { id: "settings", label: "Settings" },
];

export function ConnectionsView({ forceState }: { forceState?: TableStatus }) {
  const api = useApi();
  const data = useConnectionsData();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const frozen = params.get("frozen") === "1";
  const filter = params.get("filter") ?? "";
  const stateParam = params.get("state") as TableStatus | null;
  const openId = params.get("connection");
  const detailTab = params.get("tab") ?? "overview";
  const [search, setSearch] = React.useState(params.get("q") ?? "");

  const setParams = React.useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
  }, [params, pathname, router]);

  const [preferences, setPreferences] = useTablePreferences("connections");
  const summary = React.useMemo(() => healthSummary(data.rows), [data.rows]);
  const expiring = React.useMemo(() => data.rows.filter((c) => c.expiresAt && Date.parse(c.expiresAt) <= Date.now() + 14 * 86_400_000), [data.rows]);

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.rows.filter((c) => {
      if (filter === "failing" && c.status !== "failing") return false;
      if (filter === "degraded" && c.status !== "degraded") return false;
      if (filter === "healthy" && c.status !== "healthy") return false;
      if (filter === "expiring" && !expiring.some((e) => e.id === c.id)) return false;
      if (!needle) return true;
      return [c.name, c.provider, c.type].join(" ").toLowerCase().includes(needle);
    }).sort((a, b) => {
      // Broken first. This page is opened during an incident.
      const rank = { failing: 0, degraded: 1, healthy: 2 } as const;
      return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name);
    });
  }, [data.rows, search, filter, expiring]);

  const orderedIds = React.useMemo(() => rows.map((c) => c.id), [rows]);
  const selection = useSelection(orderedIds);

  const [booted, setBooted] = React.useState(frozen);
  React.useEffect(() => {
    if (frozen) return;
    const id = window.setTimeout(() => setBooted(true), 240);
    return () => window.clearTimeout(id);
  }, [frozen]);

  const status: TableStatus = forceState ?? stateParam
    ?? (data.loading || !booted ? "loading" : data.rows.length === 0 ? "empty" : rows.length === 0 ? "no-results" : "ready");

  const open = openId ? data.rows.find((row) => row.id === openId) ?? null : null;

  const columns = React.useMemo<DataColumn<ConnectionRecord>[]>(() => [
    {
      id: "select", header: "", width: 36, locked: true, skeletonWidth: 14,
      cell: (c, index) => (
        <span data-row-stop>
          <input
            type="checkbox"
            checked={selection.isSelected(c.id)}
            onChange={() => {}}
            onClick={(e) => { e.stopPropagation(); selection.toggle(c.id, index, e.shiftKey); }}
            aria-label={`Select ${c.name}`}
            className="accent-accent size-3.5 rounded-xs outline-none focus-visible:focus-ring"
          />
        </span>
      ),
    },
    {
      id: "name", header: "Connection", width: 220, minWidth: 150, sortValue: (c) => c.name, skeletonWidth: 150,
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <ProviderLogo provider={c.provider as ProviderId} connected={c.status === "healthy"} size={12} decorative />
          <span className="flex min-w-0 flex-col justify-center leading-tight">
            <span className="font-ui text-body-sm text-fg-primary truncate">{c.name}</span>
            {c.readOnly ? (
              <span className="font-ui text-caption text-status-live">read-only</span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      id: "type", header: "Type", width: 132, minWidth: 100, sortValue: (c) => c.type, skeletonWidth: 84,
      cell: (c) => <Text variant="caption" tone="secondary" className="truncate">{AUTH_LABEL[c.type]}</Text>,
    },
    {
      id: "status", header: "Status", width: 148, minWidth: 110, sortValue: (c) => c.status, skeletonWidth: 96,
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <HealthDot status={c.status} />
          <span className="flex min-w-0 flex-col justify-center leading-tight">
            <Text
              variant="caption"
              tone="inherit"
              className={cn(
                "capitalize",
                c.status === "healthy" ? "text-status-success" : c.status === "degraded" ? "text-status-waiting" : "text-status-failed",
              )}
            >
              {c.lastCheckedAt ? c.status : "not tested"}
            </Text>
            <Text variant="caption" tone="disabled" className="truncate">
              {c.lastCheckedAt ? <>checked <RelativeTime iso={c.lastCheckedAt} /></> : "Run a connection test"}
            </Text>
          </span>
        </span>
      ),
    },
    {
      id: "latency", header: "Latency", width: 132, minWidth: 100,
      sortValue: (c) => c.latencyMs ?? Number.MAX_SAFE_INTEGER, skeletonWidth: 90,
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <Text variant="caption" tone="secondary" tabular className="shrink-0">
            {c.latencyMs === null ? EMPTY : `${c.latencyMs}ms`}
          </Text>
          <Sparkline
            values={c.latencyTrend}
            width={56}
            height={14}
            tone={c.status === "failing" ? "failed" : "accent"}
            label={`${c.name} latency over 24 hours`}
          />
        </span>
      ),
    },
    {
      /* The column this page exists for. */
      id: "blast", header: "Used by", width: 168, minWidth: 120, skeletonWidth: 110,
      sortValue: (c) => blastRadius(c).workflows.length,
      cell: (c) => {
        const radius = blastRadius(c);
        const broken = c.status !== "healthy" && (radius.workflows.length > 0 || radius.queuedRuns > 0);
        return (
          <Text
            variant="caption"
            tone="inherit"
            className={cn("truncate", broken ? "text-status-failed" : "text-fg-secondary")}
            title={radius.sentence}
          >
            {radius.workflows.length}w · {radius.tools.length}t · {radius.agents.length}a
            {radius.queuedRuns > 0 ? ` · ${radius.queuedRuns} queued` : ""}
          </Text>
        );
      },
    },
    {
      id: "created", header: "Created", width: 92, minWidth: 78,
      sortValue: (c) => Date.parse(c.createdAt), skeletonWidth: 54,
      cell: (c) => <Text variant="caption" tone="secondary" tabular><RelativeTime iso={c.createdAt} /></Text>,
    },
    {
      id: "lastUsed", header: "Last used", width: 96, minWidth: 78,
      sortValue: (c) => Date.parse(c.lastUsedAt), skeletonWidth: 54,
      cell: (c) => <Text variant="caption" tone="secondary" tabular><RelativeTime iso={c.lastUsedAt} /></Text>,
    },
    {
      id: "expires", header: "Expires", width: 104, minWidth: 84,
      sortValue: (c) => (c.expiresAt ? Date.parse(c.expiresAt) : Number.MAX_SAFE_INTEGER), skeletonWidth: 54,
      cell: (c) => {
        if (!c.expiresAt) return <Text variant="caption" tone="disabled">{EMPTY}</Text>;
        const days = (Date.parse(c.expiresAt) - Date.now()) / 86_400_000;
        const soon = days <= 14;
        return (
          <Text
            variant="caption"
            tone="inherit"
            tabular
            className={soon ? "text-status-waiting" : "text-fg-secondary"}
            title={soon ? "Expires soon — rotate before it lapses" : undefined}
          >
            <RelativeTime iso={c.expiresAt} />
          </Text>
        );
      },
    },
  ], [selection]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Connect"
        title="Connections"
        description="Credentials, their health, and exactly what each one blocks when it breaks."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href={"/integrations" as Route}>New connection</Link>
          </Button>
        }
      />

      <div className="grid gap-3">
        {/* Health strip. Each tile is a filter, so the number is a way in. */}
        <div className="grid gap-2 sm:grid-cols-4">
          <HealthTile label="Connected" value={summary.connected} tone="success" active={filter === "healthy"} onClick={() => setParams({ filter: filter === "healthy" ? null : "healthy" })} />
          <HealthTile label="Degraded" value={summary.degraded} tone="waiting" active={filter === "degraded"} onClick={() => setParams({ filter: filter === "degraded" ? null : "degraded" })} />
          <HealthTile label="Failing" value={summary.failing} tone="failed" active={filter === "failing"} onClick={() => setParams({ filter: filter === "failing" ? null : "failing" })} />
          <HealthTile label="Expiring soon" value={summary.expiring} tone="waiting" active={filter === "expiring"} onClick={() => setParams({ filter: filter === "expiring" ? null : "expiring" })} />
        </div>

        {data.error ? <Text variant="body-sm" tone="inherit" className="text-status-failed">Could not load connections. Try refreshing the page.</Text> : null}
        {summary.failing > 0 && filter === "" ? <FailingBanner failing={data.rows.filter((c) => c.status === "failing")} onShow={() => setParams({ filter: "failing" })} /> : null}

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search connections"
          aria-label="Search connections"
          className="h-8 max-w-xs text-body-sm"
        />

        <DataTable<ConnectionRecord>
          label="Connections"
          noun={["connection", "connections"]}
          rows={status === "ready" ? rows : []}
          columns={columns}
          rowId={(c) => c.id}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          status={status}
          renderState={(s) => <ConnectionsState status={s} onClear={() => { setSearch(""); setParams({ filter: null, q: null }); }} />}
          sort={[]}
          onSortChange={() => {}}
          isSelected={selection.isSelected}
          onToggleSelect={selection.toggle}
          onToggleSelectAll={selection.toggleAll}
          onOpenRow={(c) => setParams({ connection: c.id, tab: null })}
          height={560}
        />
      </div>

      <ConnectionDetail
        connection={open}
        onTest={async (id) => {
          const result = await api.connections.test(id, data.scope);
          await data.refetch();
          return result;
        }}
        onDelete={async (id) => {
          try {
            await api.connections.delete(id, data.scope);
            setParams({ connection: null, tab: null });
            await data.refetch();
            toast.success("Connection deleted.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to delete connection.");
            throw error;
          }
        }}
        scope={data.scope}
        onUpdated={data.refetch}
        onClose={() => setParams({ connection: null, tab: null })}
        tab={detailTab}
        onTabChange={(id) => setParams({ tab: id })}
      />
    </PageContainer>
  );
}

/* ── Health strip ─────────────────────────────────────────────────────────── */

function HealthTile({
  label, value, tone, active, onClick,
}: {
  label: string;
  value: number;
  tone: "success" | "waiting" | "failed";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      disabled={value === 0}
      className={cn(
        "border-subtle bg-surface-raised rounded-lg border px-3 py-2 text-left",
        "transition-colors duration-fast outline-none focus-visible:focus-ring",
        "disabled:cursor-default disabled:opacity-60",
        active && "border-accent-border bg-surface-selected",
        !active && value > 0 && "hover:border-default",
      )}
    >
      <Text variant="caption" tone="muted" className="block">{label}</Text>
      <Text
        variant="heading-sm"
        tone="inherit"
        tabular
        className={cn(
          "block",
          value === 0 ? "text-fg-disabled"
            : tone === "success" ? "text-status-success"
              : tone === "waiting" ? "text-status-waiting" : "text-status-failed",
        )}
      >
        {value}
      </Text>
    </button>
  );
}

function FailingBanner({ failing, onShow }: { failing: ConnectionRecord[]; onShow: () => void }) {

  /* Deduplicated across connections. Summing each radius counted a workflow
     once per broken connection it binds, which produced "13 workflows" in a
     workspace that has 11 — a number a reader can falsify at a glance, on the
     one banner whose whole job is to be believed during an incident. */
  const workflowIds = new Set<string>();
  const runIds = new Set<string>();
  for (const connection of failing) {
    const radius = blastRadius(connection);
    for (const workflow of radius.workflows) workflowIds.add(workflow.id);
    for (const run of radius.queuedRunIds) runIds.add(run);
  }
  const total = workflowIds.size;
  const queued = runIds.size;

  return (
    <button
      onClick={onShow}
      className="border-status-failed-border bg-status-failed-subtle rounded-md border px-3 py-2 text-left outline-none focus-visible:focus-ring"
    >
      <Text variant="body-sm" tone="inherit" className="text-status-failed block">
        {failing.length} {failing.length === 1 ? "connection is" : "connections are"} failing, blocking{" "}
        {total} {total === 1 ? "workflow" : "workflows"}
        {queued > 0 ? ` and ${queued} queued ${queued === 1 ? "run" : "runs"}` : ""}
      </Text>
      <Text variant="caption" tone="secondary" className="mt-0.5 block">
        {failing.map((c) => c.name).join(", ")}. Show them.
      </Text>
    </button>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────────── */

function ConnectionDetail({
  connection, onClose, tab, onTabChange, onTest, onDelete, scope, onUpdated,
}: {
  connection: ConnectionRecord | null;
  onClose: () => void;
  tab: string;
  onTabChange: (id: string) => void;
  onTest: (id: string) => Promise<ConnectionTestResult>;
  onDelete: (id: string) => Promise<void>;
  scope: Scope;
  onUpdated: () => void | Promise<void>;
}) {
  const [testResult, setTestResult] = React.useState<ConnectionTestResult | "testing" | null>(null);
  React.useEffect(() => { setTestResult(null); }, [connection?.id]);

  if (!connection) return null;
  const radius = blastRadius(connection);

  return (
    <DetailSheet
      open
      onClose={onClose}
      title={connection.name}
      subtitle={
        <>
          <span className="flex items-center gap-1.5">
            <ProviderLogo provider={connection.provider as ProviderId} connected={connection.status === "healthy"} size={12} decorative />
            <Text variant="caption" tone="secondary">{connection.provider}</Text>
          </span>
          <Text variant="caption" tone="muted">{AUTH_LABEL[connection.type]}</Text>
          <span className="flex items-center gap-1.5">
            <HealthDot status={connection.status} />
            <Text variant="caption" tone="muted" className="capitalize">{connection.status}</Text>
          </span>
        </>
      }
      badges={
        connection.readOnly ? (
          <span className="border-status-live-border bg-status-live-subtle text-status-live font-ui text-caption rounded-full border px-2 py-0.5">
            Read-only
          </span>
        ) : null
      }
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant={tab === "settings" ? "subtle" : "secondary"} onClick={() => onTabChange("settings")}>Edit</Button>
          <Button
            size="sm"
            variant="secondary"
            loading={testResult === "testing"}
            onClick={() => {
              setTestResult("testing");
              void onTest(connection.id).then(setTestResult, (error: unknown) => {
                setTestResult({
                  status: "failed",
                  latencyMs: 0,
                  errorCode: "REQUEST_FAILED",
                  message: error instanceof Error ? error.message : "The connection test request failed.",
                  testedAt: new Date().toISOString(),
                  details: {},
                });
              });
            }}
          >
            Test
          </Button>
        </div>
      }
      tabs={DETAIL_TABS.map((t) => (t.id === "blast" && connection.status !== "healthy" ? { ...t, badge: radius.workflows.length } : t))}
      activeTab={tab}
      onTabChange={onTabChange}
    >
      <div className="grid gap-3 p-4">
        {testResult && testResult !== "testing" ? (
          <Section title={testResult.status === "connected" ? "Test passed" : "Test failed"} tone={testResult.status === "connected" ? undefined : "error"}>
            <Text variant="body-sm" tone="secondary">
              {testResult.message}
            </Text>
            {testResult.errorCode ? <Text variant="caption" tone="muted" className="mt-1 block font-mono">{testResult.errorCode}</Text> : null}
          </Section>
        ) : null}

        {tab === "overview" ? <Overview connection={connection} onDelete={onDelete} onEdit={() => onTabChange("settings")} /> : null}
        {tab === "blast" ? <Blast connection={connection} radius={radius} /> : null}
        {tab === "health" ? <Health connection={connection} /> : null}
        {tab === "access" ? <Access connection={connection} /> : null}
        {tab === "audit" ? <Audit connection={connection} /> : null}
        {tab === "settings" ? <ConnectionEditor id={connection.id} scope={scope} onUpdated={onUpdated} /> : null}
      </div>
    </DetailSheet>
  );
}

function Overview({ connection, onDelete, onEdit }: { connection: ConnectionRecord; onDelete: (id: string) => Promise<void>; onEdit: () => void }) {
  return (
    <>
      <Section title="Configuration" help="Secrets are never displayed — only replaced. There is no path in this product that reads a credential back out.">
        <Facts
          items={[
            { label: "Provider", value: connection.provider },
            { label: "Method", value: AUTH_LABEL[connection.type] },
            { label: "Created", value: <RelativeTime iso={connection.createdAt} /> },
            { label: "Last used", value: <RelativeTime iso={connection.lastUsedAt} /> },
            { label: "Latency", value: connection.latencyMs === null ? "Not responding" : `${connection.latencyMs}ms` },
            { label: "Expires", value: connection.expiresAt ? <RelativeTime iso={connection.expiresAt} /> : "Does not expire" },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit}>Rotate credentials</Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-status-failed"
            onClick={() => {
              if (window.confirm(`Delete ${connection.name}? This cannot be undone.`)) {
                void onDelete(connection.id).catch(() => undefined);
              }
            }}
          >
            Delete
          </Button>
        </div>
      </Section>

      {connection.needsPrivateRunner ? (
        <Section
          title="Reaching a private network"
          help="This connection targets a system that is usually not on the public internet."
        >
          <Text variant="body-sm" tone="secondary" className="block">
            If the host sits inside a VPC, Vectorbea cannot reach it from its shared egress range. Two
            options: allow the egress range on your firewall, or run a private runner inside the
            network so the connection is made outbound from your side.
          </Text>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="xs" variant="secondary">
              <Link href={"/docs/security" as Route} target="_blank" rel="noreferrer">Private runner setup</Link>
            </Button>
            <Button asChild size="xs" variant="ghost">
              <Link href={"/docs/security" as Route} target="_blank" rel="noreferrer">Egress ranges</Link>
            </Button>
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Blast({ connection, radius }: { connection: ConnectionRecord; radius: ReturnType<typeof blastRadius> }) {
  const broken = connection.status !== "healthy";

  return (
    <>
      <Section title="What this blocks" tone={broken && radius.workflows.length > 0 ? "error" : undefined}>
        <Text variant="body-sm" tone="primary" className="block">{radius.sentence}</Text>
        {broken ? (
          <Text variant="caption" tone="secondary" className="mt-1 block leading-snug">
            These are failing now, or will fail on their next run. Fixing the connection fixes all of
            them at once — there is nothing to change in the workflows themselves.
          </Text>
        ) : (
          <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
            This is what would stop if the connection lapsed. It is the reason to rotate before expiry
            rather than after.
          </Text>
        )}
      </Section>

      <Section title="Workflows" help="Each with the step that binds this connection.">
        {radius.workflows.length === 0 ? (
          <Text variant="body-sm" tone="secondary">No workflow binds this connection.</Text>
        ) : (
          <ul className="grid gap-1">
            {radius.workflows.map((w) => (
              <li key={`${w.id}-${w.nodeName}`}>
                <Link
                  href={`/workflows/${w.id}` as Route}
                  className={cn(
                    "-mx-1 flex items-baseline gap-2 rounded-sm px-1 py-1",
                    "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
                  )}
                >
                  <Text variant="body-sm" tone="primary" className="truncate">{w.name}</Text>
                  <Text variant="caption" tone="muted" className="truncate">{w.nodeName}</Text>
                  <Text variant="caption" tone="disabled" className="ml-auto shrink-0">{w.environment}</Text>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Tools" help="Unusable while this connection is down, whether or not a workflow binds them yet.">
        <ul className="flex flex-wrap gap-1.5">
          {radius.tools.map((tool) => (
            <li key={tool} className="border-subtle text-fg-secondary font-code text-mono-sm rounded-xs border px-1.5 py-0.5">
              {tool}
            </li>
          ))}
        </ul>
      </Section>

      {radius.agents.length > 0 ? (
        <Section title="Agents" help="Hold a grant for one of the blocked tools.">
          <ul className="flex flex-wrap gap-1.5">
            {radius.agents.map((agent) => (
              <li key={agent} className="border-subtle text-fg-secondary font-ui text-caption rounded-xs border px-1.5 py-0.5">
                {agent}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {radius.queuedRuns > 0 ? (
        <Section title="Queued runs" tone="warning">
          <Text variant="body-sm" tone="secondary" className="block">
            {radius.queuedRuns} runs are waiting on workflows that bind this connection. They resume
            from their last checkpoint once it recovers — nothing already committed is replayed.
          </Text>
          <div className="mt-2">
            <Button asChild size="xs" variant="secondary">
              <Link href={"/runs?q=status:queued" as Route}>Show the queue</Link>
            </Button>
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Health({ connection }: { connection: ConnectionRecord }) {
  return (
    <>
      <Section title="Latency — 24 hours" help="Per hour. A rising trend is the warning that precedes a failure.">
        <Sparkline values={connection.latencyTrend} width={420} height={56} tone={connection.status === "failing" ? "failed" : "accent"} label={`${connection.name} latency`} />
      </Section>

      <Section title="Health — 30 days" help="One cell per day. Bands of amber before a red run are the pattern worth catching.">
        <div className="flex flex-wrap gap-0.5">
          {connection.healthHistory.map((day, i) => (
            <span
              key={i}
              title={`Day ${30 - i}: ${day}`}
              className={cn(
                "h-5 w-2 rounded-xs",
                day === "healthy" ? "bg-status-success" : day === "degraded" ? "bg-status-waiting" : "bg-status-failed",
              )}
            />
          ))}
        </div>
      </Section>

      <Section title="Recent errors" help="With links to the runs that hit them.">
        {connection.recentErrors.length === 0 ? (
          <Text variant="body-sm" tone="secondary">No errors recorded.</Text>
        ) : (
          <ul className="grid gap-1">
            {connection.recentErrors.map((error) => (
              <li key={error.runId}>
                <Link
                  href={`/runs/${error.runId}` as Route}
                  className={cn(
                    "-mx-1 block rounded-sm px-1 py-1",
                    "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
                  )}
                >
                  <Text variant="caption" tone="secondary" className="block break-words">{error.message}</Text>
                  <Text variant="caption" tone="disabled" className="font-code block truncate">{error.runId}</Text>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Access({ connection }: { connection: ConnectionRecord }) {
  return (
    <>
      <Section
        title="Read-only"
        help="A governance flag, enforced at the connection rather than trusted to each workflow."
        tone={connection.readOnly ? undefined : "warning"}
      >
        <Text variant="body-sm" tone="secondary" className="block">
          {connection.readOnly
            ? "Writes through this connection are refused, whatever a workflow asks for. This is the safe default for anything reading production data."
            : "This connection permits writes. Any workflow that binds it can modify data in the connected system."}
        </Text>
        <div className="mt-2">
          <Button size="xs" variant="secondary">
            {connection.readOnly ? "Allow writes" : "Restrict to reads"}
          </Button>
        </div>
      </Section>

      <Section title="Granted scopes" help="Narrower is better. A scope you have not granted is a class of mistake nobody can make.">
        {connection.scopes.length === 0 ? (
          <Text variant="body-sm" tone="secondary">This connection type has no scopes.</Text>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {connection.scopes.map((scope) => (
              <li key={scope} className="border-accent-border bg-accent-subtle text-accent font-code text-mono-sm rounded-xs border px-1.5 py-0.5">
                {scope}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {connection.expiresAt ? (
        <Section title="Expiry" tone={Date.parse(connection.expiresAt) - Date.now() < 14 * 86_400_000 ? "warning" : undefined}>
          <Text variant="body-sm" tone="secondary" className="block">
            This token expires <RelativeTime iso={connection.expiresAt} />. Rotate before it lapses —
            an expired token fails every workflow bound to it at once, and the failure looks like an
            outage rather than a calendar event.
          </Text>
        </Section>
      ) : null}
    </>
  );
}

function Audit({ connection }: { connection: ConnectionRecord }) {
  return (
    <Section title="Changes" help="Who changed what, and when. Rotations are recorded; the values never are.">
      <ol className="grid gap-2">
        {connection.audit.map((entry, i) => (
          <li key={i} className="border-subtle flex flex-wrap items-baseline gap-2 border-b pb-2 last:border-b-0 last:pb-0">
            <Text variant="body-sm" tone="primary" className="min-w-0 flex-1">{entry.action}</Text>
            <Text variant="caption" tone="muted">{entry.actor}</Text>
            <Text variant="caption" tone="disabled"><RelativeTime iso={entry.at} /></Text>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ── States ───────────────────────────────────────────────────────────────── */

function ConnectionsState({ status, onClear }: { status: Exclude<TableStatus, "ready">; onClear: () => void }) {
  if (status === "loading") return null;

  if (status === "empty") {
    return (
      <div className="max-w-[38rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No connections yet</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          A connection is one set of credentials for one system. Workflows bind connections rather
          than carrying secrets, so rotating a credential in one place fixes every workflow that uses
          it — and this page is where you see what each one would break.
        </Text>
        <div className="mt-4">
          <Button asChild variant="primary" size="sm">
            <Link href={"/integrations" as Route}>Browse integrations</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (status === "no-results") {
    return (
      <div className="max-w-[34rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">Nothing matches</Text>
        <div className="mt-4"><Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-[34rem] text-center">
      <Text variant="heading-sm" tone="inherit" as="p" className="text-status-failed block">
        Could not load connections
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
        The request timed out. Existing connections keep working — this is a read failure.
      </Text>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Try again</Button>
      </div>
    </div>
  );
}
