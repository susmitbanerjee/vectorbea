"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSearchParamWriter } from "~/lib/url/use-search-param-writer";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { useWorkspaceRole } from "~/lib/workspace/workspace-provider";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import { DataTable, type DataColumn, type TableStatus } from "~/components/data/table/data-table";
import { useTablePreferences, useSelection } from "~/components/data/table/table-state";
import { QueryBar } from "~/components/data/query-bar";
import { QuickFilters, type QuickFilter } from "~/components/data/saved-views";
import { parseQuery, compileRecordPredicate, AGENT_QUERY } from "~/lib/query";
import { formatCost, formatDuration, formatTokens } from "~/lib/format";
import { grantFindings, type AgentRecord } from "~/lib/registry/model";
import { RegistryStatusBadge, RateCell, RiskBadge } from "./atoms";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { AgentDetail } from "./agent-detail";
import { RegistryBulkBar } from "./bulk-bar";
import { RegistryRowActions, type RegistryActionHandlers } from "./row-actions";
import { DestructiveConfirmDialog } from "~/components/ui/destructive-confirm-dialog";
import { useAgentsData } from "./use-registry-data";
import { CreateAgentDialog } from "./create-agent-dialog";
import { useApi } from "~/lib/api/api-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   AGENTS — a registry, not a card grid (§1, diagnosis #2).

   You come here to compare: which agent costs the most per run, which one's
   success rate has slipped, which one can call a critical tool unattended. Every
   one of those is a column comparison, and a grid of cards makes all of them
   impossible.
══════════════════════════════════════════════════════════════════════════════ */

export function AgentsView({ forceState }: { forceState?: TableStatus }) {
  const { canBuild } = useWorkspaceRole();
  const [bulkDelete, setBulkDelete] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<AgentRecord | null>(null);
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const data = useAgentsData();
  const agents = data.rows;

  const frozen = params.get("frozen") === "1";
  const urlQuery = params.get("q") ?? "";
  const stateParam = params.get("state") as TableStatus | null;
  const sortParam = params.get("sort") ?? "runs:desc";
  const openId = params.get("agent");
  /* Creation is URL-synced so `/agents/new` can redirect here and the dialog is
     linkable — "open the register form for me" is a link, not a set of clicks. */
  const creating = params.get("create") === "1";
  const detailTab = params.get("tab") ?? "overview";

  const sort = React.useMemo(
    () => sortParam.split(",").filter(Boolean).map((piece) => {
      const [id, dir] = piece.split(":");
      return { id, desc: dir !== "asc" };
    }),
    [sortParam],
  );

  /* Two writes in one tick must merge, not overwrite — the create dialogs do
     exactly that on success. See use-search-param-writer.ts. */
  const setParams = useSearchParamWriter();

  const [queryInput, setQueryInput] = React.useState(urlQuery);
  React.useEffect(() => { setQueryInput(urlQuery); }, [urlQuery]);

  const [preferences, setPreferences] = useTablePreferences("agents");

  /* ── Filter and sort ────────────────────────────────────────────────────── */
  const searchText = React.useCallback(
    (agent: AgentRecord) => [
      agent.name, agent.description, agent.model, agent.provider, agent.owner, agent.type,
      agent.systemPrompt, ...agent.grants.map((g) => g.tool),
    ].join(" ").toLowerCase(),
    [],
  );

  const deferred = React.useDeferredValue(queryInput);

  const filtered = React.useMemo(() => {
    const parsed = parseQuery(deferred, AGENT_QUERY.fields);
    const predicate = compileRecordPredicate<AgentRecord>(parsed, {
      status: (a) => a.status,
      type: (a) => a.type,
      provider: (a) => a.provider,
      model: (a) => a.model,
      owner: (a) => a.owner,
      tool: (a) => a.grants.map((g) => g.tool),
      rate: (a) => a.successRate,
      cost: (a) => a.avgCostUsd,
      runs: (a) => a.runs30d,
      grants: (a) => a.grants.length,
      governance: (a) => (grantFindings(a).length > 0 ? "violation" : "ok"),
    }, searchText);
    return agents.filter(predicate);
  }, [agents, deferred, searchText]);

  const sorted = React.useMemo(() => {
    if (sort.length === 0) return filtered;
    const accessors: Record<string, (a: AgentRecord) => string | number> = {
      name: (a) => a.name,
      model: (a) => a.model,
      type: (a) => a.type,
      status: (a) => a.status,
      grants: (a) => a.grants.length,
      runs: (a) => a.runs30d,
      rate: (a) => a.successRate,
      tokens: (a) => a.avgTokens,
      cost: (a) => a.avgCostUsd,
      p95: (a) => a.p95DurationMs,
      lastUsed: (a) => Date.parse(a.lastUsedAt),
      version: (a) => a.version,
      owner: (a) => a.owner,
    };
    const next = [...filtered];
    next.sort((a, b) => {
      for (const rule of sort) {
        const get = accessors[rule.id];
        if (!get) continue;
        const av = get(a);
        const bv = get(b);
        if (av === bv) continue;
        return rule.desc ? (av < bv ? 1 : -1) : (av < bv ? -1 : 1);
      }
      return 0;
    });
    return next;
  }, [filtered, sort]);

  const orderedIds = React.useMemo(() => sorted.map((a) => a.id), [sorted]);
  const selection = useSelection(orderedIds);
  const selected = React.useMemo(() => sorted.filter((a) => selection.isSelected(a.id)), [sorted, selection]);

  const [booted, setBooted] = React.useState(frozen);
  React.useEffect(() => {
    if (frozen) return;
    const id = window.setTimeout(() => setBooted(true), 240);
    return () => window.clearTimeout(id);
  }, [frozen]);

  const status: TableStatus = forceState ?? stateParam
    ?? (data.loading || !booted ? "loading" : data.error ? "error" : agents.length === 0 ? "empty" : sorted.length === 0 ? "no-results" : "ready");

  const openAgent = React.useMemo(() => agents.find((a) => a.id === openId) ?? null, [agents, openId]);

  /* ── Columns ────────────────────────────────────────────────────────────── */
  /*
   * Row actions. Delete opens a confirmation the VIEW owns rather than one
   * mounted per row: a dialog rendered inside a table row sits under the row's
   * own click handler, and closing it lands the click on the row.
   */
  const handlers = React.useMemo<RegistryActionHandlers<AgentRecord>>(() => ({
    onSetStatus: (record, status) => {
      void api.agents.update(record.id, { status }, data.scope).then(data.refetch);
    },
    onExport: (record) => exportAgents([record]),
    onRequestDelete: (record) => setPendingDelete(record),
  }), [api, data]);

  const columns = React.useMemo<DataColumn<AgentRecord>[]>(() => [
    {
      id: "select", header: "", width: 36, locked: true, skeletonWidth: 14,
      cell: (agent, index) => (
        <span data-row-stop>
          <input
            type="checkbox"
            checked={selection.isSelected(agent.id)}
            onChange={() => {}}
            onClick={(e) => { e.stopPropagation(); selection.toggle(agent.id, index, e.shiftKey); }}
            aria-label={`Select ${agent.name}`}
            className="accent-accent size-3.5 rounded-xs outline-none focus-visible:focus-ring"
          />
        </span>
      ),
    },
    {
      id: "name", header: "Agent", width: 232, minWidth: 160, sortValue: (a) => a.name, skeletonWidth: 160,
      cell: (agent) => (
        <span className="flex min-w-0 flex-col justify-center leading-tight">
          <span className="font-ui text-body-sm text-fg-primary truncate">{agent.name}</span>
          <span className="font-ui text-caption text-fg-muted truncate">{agent.description}</span>
        </span>
      ),
    },
    {
      id: "model", header: "Model", width: 168, minWidth: 120, sortValue: (a) => a.model, skeletonWidth: 110,
      cell: (agent) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <ProviderLogo provider={agent.provider as ProviderId} size={12} decorative />
          <Text variant="mono-sm" tone="secondary" className="truncate">{agent.model}</Text>
        </span>
      ),
    },
    {
      id: "type", header: "Type", width: 88, minWidth: 70, sortValue: (a) => a.type, skeletonWidth: 52,
      cell: (agent) => <Text variant="caption" tone="secondary" className="truncate">{agent.type}</Text>,
    },
    {
      id: "status", header: "Status", width: 96, minWidth: 80, sortValue: (a) => a.status, skeletonWidth: 60,
      cell: (agent) => <RegistryStatusBadge status={agent.status} />,
    },
    {
      /* The count is a link into the matrix, and it carries the governance
         finding — a bare number was the original sin on this page. */
      id: "grants", header: "Tools", width: 92, minWidth: 72, numeric: true,
      sortValue: (a) => a.grants.length, skeletonWidth: 30,
      cell: (agent) => {
        const findings = grantFindings(agent);
        return (
          <span
            className="flex items-center justify-end gap-1"
            title={agent.grants.length === 0
              ? "No tools granted"
              : agent.grants.map((g) => `${g.tool} — ${g.risk}${g.requiresApproval ? ", gated" : ", ungated"}`).join("\n")}
          >
            <Text variant="caption" tone="secondary" tabular>{agent.grants.length}</Text>
            {findings.length > 0 ? (
              <span className="bg-status-failed size-1.5 shrink-0 rounded-full" aria-label={`${findings.length} governance findings`} />
            ) : null}
          </span>
        );
      },
    },
    {
      id: "runs", header: "Runs 30d", width: 88, minWidth: 72, numeric: true,
      sortValue: (a) => a.runs30d, skeletonWidth: 40,
      cell: (agent) => agent.hasUsageData
        ? <Text variant="caption" tone="secondary" tabular>{agent.runs30d.toLocaleString("en-GB")}</Text>
        : <Text variant="caption" tone="disabled">—</Text>,
    },
    {
      id: "rate", header: "Success", width: 84, minWidth: 70, numeric: true,
      sortValue: (a) => a.successRate, skeletonWidth: 34,
      cell: (agent) => agent.hasUsageData ? <RateCell rate={agent.successRate} /> : <Text variant="caption" tone="disabled">—</Text>,
    },
    {
      id: "tokens", header: "Avg tokens", width: 92, minWidth: 76, numeric: true,
      sortValue: (a) => a.avgTokens, skeletonWidth: 42,
      cell: (agent) => agent.hasUsageData ? <Text variant="caption" tone="secondary" tabular>{formatTokens(agent.avgTokens)}</Text> : <Text variant="caption" tone="disabled">—</Text>,
    },
    {
      id: "cost", header: "Avg cost", width: 88, minWidth: 72, numeric: true,
      sortValue: (a) => a.avgCostUsd, skeletonWidth: 44,
      cell: (agent) => agent.hasUsageData ? <Text variant="caption" tone="secondary" tabular>{formatCost(agent.avgCostUsd)}</Text> : <Text variant="caption" tone="disabled">—</Text>,
    },
    {
      id: "p95", header: "p95", width: 80, minWidth: 66, numeric: true,
      sortValue: (a) => a.p95DurationMs, skeletonWidth: 40,
      cell: (agent) => agent.hasUsageData ? <Text variant="caption" tone="secondary" tabular>{formatDuration(agent.p95DurationMs)}</Text> : <Text variant="caption" tone="disabled">—</Text>,
    },
    {
      id: "lastUsed", header: "Last used", width: 92, minWidth: 78,
      sortValue: (a) => Date.parse(a.lastUsedAt), skeletonWidth: 54,
      cell: (agent) => (
        <Text variant="caption" tone="secondary" tabular><RelativeTime iso={agent.lastUsedAt} /></Text>
      ),
    },
    {
      id: "version", header: "Version", width: 76, minWidth: 62, numeric: true,
      sortValue: (a) => a.version, skeletonWidth: 26,
      cell: (agent) => <Text variant="caption" tone="secondary" tabular>v{agent.version}</Text>,
    },
    {
      id: "owner", header: "Owner", width: 112, minWidth: 84, sortValue: (a) => a.owner, skeletonWidth: 70,
      cell: (agent) => <Text variant="caption" tone="secondary" className="truncate">{agent.owner}</Text>,
    },
    {
      // Locked to the right, like selection on the left: row actions are
      // furniture, not a column somebody should be able to hide or reorder.
      id: "actions", header: "", width: 44, locked: true, skeletonWidth: 14,
      cell: (agent) => (
        <span data-row-stop className="flex justify-end">
          <RegistryRowActions
            record={agent}
            noun="agent"
            detailHref={`/agents/${agent.id}` as Route}
            handlers={handlers}
            canBuild={canBuild}
          />
        </span>
      ),
    },
  ], [selection, canBuild, handlers]);

  const counts = React.useMemo(() => ({
    ungated: agents.filter((a) => grantFindings(a).length > 0).length,
    paused: agents.filter((a) => a.status === "paused").length,
    failing: agents.filter((a) => a.hasUsageData && a.successRate < 70).length,
  }), [agents]);

  const quickFilters: QuickFilter[] = [
    { id: "ungated", label: "Ungated high risk", query: "governance:violation", count: counts.ungated, tone: "failed" },
    { id: "failing", label: "Below 70%", query: "rate:<70", count: counts.failing, tone: "failed" },
    { id: "paused", label: "Paused", query: "status:paused", count: counts.paused, tone: "waiting" },
    { id: "anthropic", label: "Anthropic", query: "provider:anthropic" },
    { id: "expensive", label: "Over $0.01 a run", query: "cost:>0.01" },
  ];

  const applyQuery = (query: string) => {
    setQueryInput(query);
    setParams({ q: query });
    selection.clear();
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Build"
        title="Agents"
        description="Every registered agent, with what it costs, how often it works, and exactly what it is permitted to do."
        actions={
          <Button
            variant="primary"
            size="sm"
            disabled={!canBuild}
            title={canBuild ? undefined : "Creating an agent needs the developer role or higher. Ask an owner or admin."}
            onClick={() => setParams({ create: "1" })}
          >
            New agent
          </Button>
        }
      />

      <div className="grid gap-3">
        <QueryBar
          schema={AGENT_QUERY}
          value={queryInput}
          onChange={setQueryInput}
          onSubmit={applyQuery}
          resultCount={status === "ready" ? sorted.length : undefined}
        />
        <QuickFilters filters={quickFilters} activeQuery={queryInput} onApply={applyQuery} />

        <DataTable<AgentRecord>
          label="Agents"
          noun={["agent", "agents"]}
          rows={status === "ready" ? sorted : []}
          columns={columns}
          rowId={(a) => a.id}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          status={status}
          renderState={(s) => (
            <AgentsState
              status={s}
              query={queryInput}
              onClear={() => applyQuery("")}
              onCreate={() => setParams({ create: "1" })}
            />
          )}
          sort={sort}
          onSortChange={(next) => setParams({ sort: next.map((s) => `${s.id}:${s.desc ? "desc" : "asc"}`).join(",") })}
          isSelected={selection.isSelected}
          onToggleSelect={selection.toggle}
          onToggleSelectAll={selection.toggleAll}
          onOpenRow={(agent) => setParams({ agent: agent.id, tab: null })}
          height={620}
        />
      </div>

      <CreateAgentDialog
        open={creating}
        onOpenChange={(next) => setParams({ create: next ? "1" : null })}
        onCreated={(agent) => setParams({ create: null, agent: agent.id, tab: null })}
      />

      <AgentDetail
        agent={openAgent}
        open={openAgent !== null}
        onClose={() => setParams({ agent: null, tab: null })}
        tab={detailTab}
        onTabChange={(id) => setParams({ tab: id })}
        onUpdated={data.refetch}
      />

      <RegistryBulkBar
        count={selected.length}
        noun="agent"
        canBuild={canBuild}
        onDelete={() => setBulkDelete(true)}
        onClear={selection.clear}
        onActivate={() => {
          void Promise.all(selected.map((agent) => api.agents.update(agent.id, { status: "active" }, data.scope)))
            .then(data.refetch);
        }}
        onDeactivate={() => {
          void Promise.all(selected.map((agent) => api.agents.update(agent.id, { status: "paused" }, data.scope)))
            .then(data.refetch);
        }}
        onExport={() => exportAgents(selected)}
      />

      <DestructiveConfirmDialog
        open={bulkDelete}
        title={`Delete ${selected.length} ${selected.length === 1 ? "agent" : "agents"}?`}
        description={
          <>
            Anything bound to them starts failing on its next run. The definitions and their history go;
            nothing recreates them.
          </>
        }
        confirmLabel={`Delete ${selected.length} ${selected.length === 1 ? "agent" : "agents"}`}
        onOpenChange={(open) => { if (!open) setBulkDelete(false); }}
        onConfirm={() => {
          const doomed = [...selected];
          setBulkDelete(false);
          selection.clear();
          void Promise.all(doomed.map((record) => api.agents.delete(record.id, data.scope)))
            .then(data.refetch);
        }}
      />

      {/*
        Owned by the view, not by the row. A confirmation mounted inside a table
        row lives under that row's click handler, so dismissing it lands a click
        on the row and navigates away — which is exactly what "it opens the
        detail even when I press Keep it" was.
      */}
      <DestructiveConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "agent"}?`}
        description={
          <>
            Every workflow node bound to it starts failing on its next run. The definition and its history go; nothing recreates it.
            Pausing it instead stops it being used and keeps it.
          </>
        }
        confirmLabel="Delete agent"
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onConfirm={() => {
          const record = pendingDelete;
          setPendingDelete(null);
          if (record) void api.agents.delete(record.id, data.scope).then(data.refetch);
        }}
      />
    </PageContainer>
  );
}

function exportAgents(agents: AgentRecord[]) {
  const blob = new Blob([JSON.stringify(agents, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = agents.length === 1 ? `${agents[0].name}.json` : `agents-${agents.length}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function AgentsState({
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
      <div className="max-w-[38rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No agents registered</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          An agent is a model with a task, a set of tools it may call, and bounds on how far it may
          go. Registering one here means every workflow can use it without repeating its
          configuration — and changing its prompt changes every workflow at once, which is the point
          and also the risk this page exists to make visible.
        </Text>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="sm" onClick={onCreate}>Register an agent</Button>
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
        <Text variant="heading-sm" tone="max" as="p" className="block">No agents match this filter</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Nothing matched <code className="font-code text-mono-sm text-fg-primary">{query}</code>.
          Search also covers system prompts and granted tool names.
        </Text>
        <div className="mt-4"><Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-[36rem] text-center">
      <Text variant="heading-sm" tone="inherit" as="p" className="text-status-failed block">
        Could not load agents
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
        The registry request timed out. Agents already bound into workflows keep running — this is a
        read failure, not an execution one.
      </Text>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Try again</Button>
      </div>
    </div>
  );
}

export { RiskBadge };
