"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSearchParamWriter } from "~/lib/url/use-search-param-writer";
import Link from "next/link";
import type { Route } from "next";
import { useWorkspaceRole } from "~/lib/workspace/workspace-provider";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { DataTable, type DataColumn, type TableStatus } from "~/components/data/table/data-table";
import { useTablePreferences, useSelection } from "~/components/data/table/table-state";
import { QueryBar } from "~/components/data/query-bar";
import { QuickFilters, type QuickFilter } from "~/components/data/saved-views";
import { parseQuery, compileRecordPredicate, TOOL_QUERY } from "~/lib/query";
import { formatDuration, EMPTY } from "~/lib/format";
import { policyFindings, TOOL_TYPE_LABEL, type ToolRecord } from "~/lib/registry/model";
import { RiskBadge, RegistryStatusBadge, RateCell, HealthDot } from "./atoms";
import { ToolDetail } from "./tool-detail";
import { RegistryBulkBar } from "./bulk-bar";
import { useToolsData } from "./use-registry-data";
import { CreateToolDialog } from "./create-tool-dialog";
import { useApi } from "~/lib/api/api-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   TOOLS — a registry, sorted riskiest first by default.

   Risk leads the sort because the question this page exists to answer is "what
   can hurt us and is it controlled". Sorting by name would be alphabetising a
   permissions list.
══════════════════════════════════════════════════════════════════════════════ */

const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export function ToolsView({ forceState }: { forceState?: TableStatus }) {
  const { canBuild } = useWorkspaceRole();
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const data = useToolsData();
  const tools = data.rows;

  const frozen = params.get("frozen") === "1";
  const urlQuery = params.get("q") ?? "";
  const stateParam = params.get("state") as TableStatus | null;
  const sortParam = params.get("sort") ?? "risk:asc";
  const openId = params.get("tool");
  /* Creation is URL-synced so `/tools/new` can redirect here and the dialog is
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

  const [preferences, setPreferences] = useTablePreferences("tools");

  const searchText = React.useCallback(
    (tool: ToolRecord) => [
      tool.name, tool.description, tool.type, tool.owner, tool.endpoint,
      ...tool.parameters.map((p) => `${p.name} ${p.description}`),
      ...tool.outputFields.map((f) => f.name),
    ].join(" ").toLowerCase(),
    [],
  );

  const deferred = React.useDeferredValue(queryInput);

  const filtered = React.useMemo(() => {
    const parsed = parseQuery(deferred, TOOL_QUERY.fields);
    const predicate = compileRecordPredicate<ToolRecord>(parsed, {
      status: (t) => t.status,
      type: (t) => t.type,
      risk: (t) => t.risk,
      connection: (t) => t.connection ?? "",
      owner: (t) => t.owner,
      rate: (t) => t.successRate,
      calls: (t) => t.calls30d,
      latency: (t) => t.p95LatencyMs,
      failing: (t) => (t.lastError ? "true" : "false"),
      policy: (t) => (policyFindings(t).length > 0 ? "violation" : "ok"),
    }, searchText);
    return tools.filter(predicate);
  }, [deferred, searchText, tools]);

  const sorted = React.useMemo(() => {
    if (sort.length === 0) return filtered;
    const accessors: Record<string, (t: ToolRecord) => string | number> = {
      name: (t) => t.name,
      type: (t) => t.type,
      risk: (t) => RISK_ORDER[t.risk],
      connection: (t) => t.connection ?? "",
      calls: (t) => t.calls30d,
      rate: (t) => t.successRate,
      latency: (t) => t.p95LatencyMs,
      timeout: (t) => t.timeoutMs,
      usedBy: (t) => t.usedBy.length,
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

  const orderedIds = React.useMemo(() => sorted.map((t) => t.id), [sorted]);
  const selection = useSelection(orderedIds);
  const selected = React.useMemo(() => sorted.filter((t) => selection.isSelected(t.id)), [sorted, selection]);

  const [booted, setBooted] = React.useState(frozen);
  React.useEffect(() => {
    if (frozen) return;
    const id = window.setTimeout(() => setBooted(true), 240);
    return () => window.clearTimeout(id);
  }, [frozen]);

  const status: TableStatus = forceState ?? stateParam
    ?? (data.loading || !booted ? "loading" : data.error ? "error" : tools.length === 0 ? "empty" : sorted.length === 0 ? "no-results" : "ready");

  const openTool = React.useMemo(() => tools.find((t) => t.id === openId) ?? null, [openId, tools]);

  const columns = React.useMemo<DataColumn<ToolRecord>[]>(() => [
    {
      id: "select", header: "", width: 36, locked: true, skeletonWidth: 14,
      cell: (tool, index) => (
        <span data-row-stop>
          <input
            type="checkbox"
            checked={selection.isSelected(tool.id)}
            onChange={() => {}}
            onClick={(e) => { e.stopPropagation(); selection.toggle(tool.id, index, e.shiftKey); }}
            aria-label={`Select ${tool.name}`}
            className="accent-accent size-3.5 rounded-xs outline-none focus-visible:focus-ring"
          />
        </span>
      ),
    },
    {
      id: "name", header: "Tool", width: 252, minWidth: 168, sortValue: (t) => t.name, skeletonWidth: 170,
      cell: (tool) => (
        <span className="flex min-w-0 flex-col justify-center leading-tight">
          <span className="font-code text-mono-sm text-fg-primary truncate">{tool.name}</span>
          <span className="font-ui text-caption text-fg-muted truncate">{tool.description}</span>
        </span>
      ),
    },
    {
      id: "type", header: "Type", width: 116, minWidth: 92, sortValue: (t) => t.type, skeletonWidth: 70,
      cell: (tool) => <Text variant="caption" tone="secondary" className="truncate">{TOOL_TYPE_LABEL[tool.type]}</Text>,
    },
    {
      /* Risk leads, and it is drawn with bars as well as colour — the tier has
         to survive greyscale and colour blindness (§6). */
      id: "risk", header: "Risk", width: 108, minWidth: 88, sortValue: (t) => RISK_ORDER[t.risk], skeletonWidth: 62,
      cell: (tool) => {
        const findings = policyFindings(tool);
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <RiskBadge risk={tool.risk} />
            {findings.length > 0 ? (
              <span
                className="bg-status-failed size-1.5 shrink-0 rounded-full"
                aria-label={`${findings.length} policy findings`}
                title={findings.map((f) => f.title).join("\n")}
              />
            ) : null}
          </span>
        );
      },
    },
    {
      id: "connection", header: "Connection", width: 156, minWidth: 110,
      sortValue: (t) => t.connection ?? "", skeletonWidth: 100,
      cell: (tool) => {
        if (!tool.connection) return <Text variant="caption" tone="disabled">{EMPTY}</Text>;
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <HealthDot status={(tool.connectionStatus as "healthy") ?? "unknown"} />
            <Text variant="caption" tone="secondary" className="truncate">{tool.connection}</Text>
          </span>
        );
      },
    },
    {
      id: "calls", header: "Calls 30d", width: 92, minWidth: 76, numeric: true,
      sortValue: (t) => t.calls30d, skeletonWidth: 44,
      cell: (tool) => tool.hasUsageData ? <Text variant="caption" tone="secondary" tabular>{tool.calls30d.toLocaleString("en-GB")}</Text> : <Text variant="caption" tone="disabled">{EMPTY}</Text>,
    },
    {
      id: "rate", header: "Success", width: 84, minWidth: 70, numeric: true,
      sortValue: (t) => t.successRate, skeletonWidth: 34,
      cell: (tool) => tool.hasUsageData ? <RateCell rate={tool.successRate} /> : <Text variant="caption" tone="disabled">{EMPTY}</Text>,
    },
    {
      id: "latency", header: "p95", width: 80, minWidth: 66, numeric: true,
      sortValue: (t) => t.p95LatencyMs, skeletonWidth: 40,
      cell: (tool) => tool.hasUsageData ? <Text variant="caption" tone="secondary" tabular>{formatDuration(tool.p95LatencyMs)}</Text> : <Text variant="caption" tone="disabled">{EMPTY}</Text>,
    },
    {
      id: "timeout", header: "Timeout", width: 84, minWidth: 70, numeric: true,
      sortValue: (t) => t.timeoutMs, skeletonWidth: 38,
      cell: (tool) => (
        <Text
          variant="caption"
          tone="inherit"
          tabular
          // A p95 close to the timeout is a failure waiting for a slow day.
          className={tool.p95LatencyMs > tool.timeoutMs * 0.7 ? "text-status-waiting" : "text-fg-secondary"}
          title={tool.p95LatencyMs > tool.timeoutMs * 0.7 ? "p95 is within 30% of the timeout" : undefined}
        >
          {formatDuration(tool.timeoutMs)}
        </Text>
      ),
    },
    {
      id: "lastError", header: "Last error", width: 196, minWidth: 120, skeletonWidth: 140,
      cell: (tool) => (
        tool.lastError
          ? <Text variant="caption" tone="inherit" className="text-status-failed truncate" title={tool.lastError}>{tool.lastError}</Text>
          : <Text variant="caption" tone="disabled">{EMPTY}</Text>
      ),
    },
    {
      id: "usedBy", header: "Used by", width: 88, minWidth: 72, numeric: true,
      sortValue: (t) => t.usedBy.length, skeletonWidth: 28,
      cell: (tool) => (
        <Text
          variant="caption"
          tone="secondary"
          tabular
          title={tool.usedBy.length === 0 ? "Not referenced by any workflow" : tool.usedBy.map((r) => `${r.workflowName} — ${r.nodeName}`).join("\n")}
        >
          {tool.usedBy.length}
        </Text>
      ),
    },
    {
      id: "status", header: "Status", width: 96, minWidth: 80, sortValue: (t) => t.status, skeletonWidth: 60,
      cell: (tool) => <RegistryStatusBadge status={tool.status} />,
    },
  ], [selection]);

  const counts = React.useMemo(() => ({
    violations: tools.filter((t) => policyFindings(t).length > 0).length,
    failing: tools.filter((t) => t.lastError !== null).length,
    critical: tools.filter((t) => t.risk === "critical" || t.risk === "high").length,
  }), [tools]);

  const quickFilters: QuickFilter[] = [
    { id: "violations", label: "Policy violations", query: "policy:violation", count: counts.violations, tone: "failed" },
    { id: "highrisk", label: "High and critical", query: "risk:high", count: counts.critical, tone: "waiting" },
    { id: "failing", label: "Has an error", query: "failing:true", count: counts.failing, tone: "failed" },
    { id: "writes", label: "Database writes", query: "type:db-write" },
    { id: "slow", label: "Over 1s p95", query: "latency:>1000" },
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
        title="Tools"
        description="Every registered tool, riskiest first — what it can do, what it is allowed to do, and how often it works."
        actions={
          <Button
            variant="primary"
            size="sm"
            disabled={!canBuild}
            title={canBuild ? undefined : "Creating a tool needs the developer role or higher. Ask an owner or admin."}
            onClick={() => setParams({ create: "1" })}
          >
            New tool
          </Button>
        }
      />

      <div className="grid gap-3">
        <QueryBar
          schema={TOOL_QUERY}
          value={queryInput}
          onChange={setQueryInput}
          onSubmit={applyQuery}
          resultCount={status === "ready" ? sorted.length : undefined}
        />
        <QuickFilters filters={quickFilters} activeQuery={queryInput} onApply={applyQuery} />

        {counts.violations > 0 && queryInput === "" ? (
          <button
            onClick={() => applyQuery("policy:violation")}
            className="border-status-failed-border bg-status-failed-subtle rounded-md border px-3 py-2 text-left outline-none focus-visible:focus-ring"
          >
            <Text variant="body-sm" tone="inherit" className="text-status-failed block">
              {counts.violations} {counts.violations === 1 ? "tool has" : "tools have"} a policy that
              contradicts its risk tier
            </Text>
            <Text variant="caption" tone="secondary" className="mt-0.5 block">
              A high-risk tool that can run without an approval gate is a control somebody switched
              off. Show them.
            </Text>
          </button>
        ) : null}

        <DataTable<ToolRecord>
          label="Tools"
          noun={["tool", "tools"]}
          rows={status === "ready" ? sorted : []}
          columns={columns}
          rowId={(t) => t.id}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          status={status}
          renderState={(s) => (
            <ToolsState
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
          onOpenRow={(tool) => setParams({ tool: tool.id, tab: null })}
          height={620}
        />
      </div>

      <CreateToolDialog
        open={creating}
        onOpenChange={(next) => setParams({ create: next ? "1" : null })}
        onCreated={(tool) => setParams({ create: null, tool: tool.id, tab: null })}
      />

      <ToolDetail
        tool={openTool}
        open={openTool !== null}
        onClose={() => setParams({ tool: null, tab: null })}
        tab={detailTab}
        onTabChange={(id) => setParams({ tab: id })}
        onUpdated={data.refetch}
      />

      <RegistryBulkBar
        count={selected.length}
        noun="tool"
        onClear={selection.clear}
        onActivate={() => {
          void Promise.all(selected.map((tool) => api.tools.update(tool.id, { status: "active" }, data.scope)))
            .then(data.refetch);
        }}
        onDeactivate={() => {
          void Promise.all(selected.map((tool) => api.tools.update(tool.id, { status: "paused" }, data.scope)))
            .then(data.refetch);
        }}
        onExport={() => {
          const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `tools-${selected.length}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}
      />
    </PageContainer>
  );
}

function ToolsState({
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
        <Text variant="heading-sm" tone="max" as="p" className="block">No tools registered</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          A tool is one thing an agent or a workflow can actually do: query a database, post a
          message, issue a refund. Registering it here declares its schema once, binds it to a
          connection, and gives it a risk tier — and the tier is what decides whether calling it
          needs a human first.
        </Text>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="sm" onClick={onCreate}>Register a tool</Button>
          <Button variant="secondary" size="sm">Import from OpenAPI</Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={"/integrations" as Route}>Browse integrations</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (status === "no-results") {
    return (
      <div className="max-w-[36rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No tools match this filter</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Nothing matched <code className="font-code text-mono-sm text-fg-primary">{query}</code>.
          Search also covers parameter names and descriptions, so a term that finds nothing here is
          absent from every tool schema.
        </Text>
        <div className="mt-4"><Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-[36rem] text-center">
      <Text variant="heading-sm" tone="inherit" as="p" className="text-status-failed block">
        Could not load tools
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
        The registry request timed out. Tools already bound into workflows keep working — this is a
        read failure, not an execution one.
      </Text>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Try again</Button>
      </div>
    </div>
  );
}
