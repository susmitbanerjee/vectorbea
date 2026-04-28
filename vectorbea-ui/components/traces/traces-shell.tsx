"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, SearchX, XCircle } from "lucide-react";

import type { TraceListResponse, TraceSummaryView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(cost: number | null): string {
  if (cost === null || Number.isNaN(cost)) return "—";
  if (cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatRelative(timestamp: string) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusBadge(status: TraceSummaryView["status"]) {
  if (status === "success") return "success";
  if (status === "warning" || status === "partial") return "warning";
  return "destructive";
}

export function TracesShell({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeWorkspaceId } = useWorkspace();
  const [isRefreshing, startRefresh] = useTransition();

  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(searchParams.get("status") ?? "all");
  const [environment, setEnvironment] = useState(searchParams.get("environment") ?? "all");
  const [promptName, setPromptName] = useState(searchParams.get("promptName") ?? "all");
  const [since, setSince] = useState(searchParams.get("since") ?? "all");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") ?? "newest");
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1") || 1);
  const [result, setResult] = useState<TraceListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTraceId, setPendingTraceId] = useState<string | null>(null);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (query.trim()) {
      params.set("q", query.trim());
    } else {
      params.delete("q");
    }
    params.set("status", status);
    params.set("environment", environment);
    params.delete("useType");
    params.set("promptName", promptName);
    params.set("since", since);
    params.set("sortBy", sortBy);
    params.set("page", String(page));
    const current = searchParams.toString();
    const next = params.toString();
    if (next !== current) {
      router.replace(`${pathname}?${next}` as Route);
    }
  }, [environment, page, pathname, promptName, query, router, searchParams, since, sortBy, status]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!activeWorkspaceId) {
        setResult(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          workspaceId: activeWorkspaceId,
          q: query,
          status,
          environment,
          promptName,
          since,
          sortBy,
          page: String(page),
          pageSize: "25",
        });
        const response = await fetch(`/api/traces?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({ error: "Failed to load traces" }))) as { error?: string };
          throw new Error(body.error || `Failed to load traces (${response.status})`);
        }
        const payload = (await response.json()) as TraceListResponse;
        if (!cancelled) setResult(payload);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load traces");
          setResult(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, environment, page, promptName, query, since, sortBy, status]);

  const promptOptions = useMemo(() => {
    const names = new Set((result?.items ?? []).map((item) => item.promptName).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [result]);

  const summary = useMemo(() => {
    const items = result?.items ?? [];
    if (items.length === 0) {
      return {
        total: 0,
        errors: 0,
        avgLatency: 0,
        cacheHitRate: 0,
      };
    }
    const errors = items.filter((item) => item.status === "error").length;
    const hits = items.filter((item) => item.cacheStatus === "hit").length;
    const avgLatency = Math.round(items.reduce((sum, item) => sum + item.durationMs, 0) / items.length);
    return {
      total: result?.total ?? items.length,
      errors,
      avgLatency,
      cacheHitRate: Math.round((hits / items.length) * 100),
    };
  }, [result]);

  const rows = result?.items ?? [];

  const openTrace = (traceId: string) => {
    if (!activeWorkspaceId) return;
    setPendingTraceId(traceId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", activeWorkspaceId);
    router.push(`/traces/${traceId}?${params.toString()}` as Route);
  };

  const prefetchTrace = (traceId: string) => {
    if (!activeWorkspaceId) return;
    router.prefetch(`/traces/${traceId}?org=${encodeURIComponent(activeWorkspaceId)}` as Route);
  };

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Trace"
        subtitle="Request-level AI runtime debugging across sidecars, prompts, and model calls"
        actions={
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total traces</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{summary.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Error traces</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{summary.errors}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg latency</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{formatDuration(summary.avgLatency)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Cache hit rate</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{summary.cacheHitRate}%</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader className="space-y-3">
            <CardTitle>Trace browser</CardTitle>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search trace, prompt, model, sidecar…"
              />

              {/* Status filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-[#D8CFC2] bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-[#F8F4EC]"
                  >
                    <span className="truncate">
                      {{ all: "All status", success: "Success", warning: "Warning", error: "Error" }[status] ?? status}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuRadioGroup value={status} onValueChange={(v) => { setPage(1); setStatus(v); }}>
                    <DropdownMenuPanelRadioItem value="all">All status</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="success">Success</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="warning">Warning</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="error">Error</DropdownMenuPanelRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuPanel>
              </DropdownMenu>

              {/* Environment filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-[#D8CFC2] bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-[#F8F4EC]"
                  >
                    <span className="truncate">
                      {{ all: "All environments", prod: "Prod", staging: "Staging", dev: "Dev" }[environment] ?? environment}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuRadioGroup value={environment} onValueChange={(v) => { setPage(1); setEnvironment(v); }}>
                    <DropdownMenuPanelRadioItem value="all">All environments</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="prod">Prod</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="staging">Staging</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="dev">Dev</DropdownMenuPanelRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuPanel>
              </DropdownMenu>

              {/* Prompt filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-[#D8CFC2] bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-[#F8F4EC]"
                  >
                    <span className="truncate">
                      {promptName === "all" ? "All prompts" : promptOptions.find(n => n.toLowerCase() === promptName) ?? promptName}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuRadioGroup value={promptName} onValueChange={(v) => { setPage(1); setPromptName(v); }}>
                    <DropdownMenuPanelRadioItem value="all">All prompts</DropdownMenuPanelRadioItem>
                    {promptOptions.map((name) => (
                      <DropdownMenuPanelRadioItem key={name} value={name.toLowerCase()}>{name}</DropdownMenuPanelRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuPanel>
              </DropdownMenu>

              {/* Time range filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-[#D8CFC2] bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-[#F8F4EC]"
                  >
                    <span className="truncate">
                      {{ all: "All time", "24h": "Last 24h", "7d": "Last 7 days", "30d": "Last 30 days" }[since] ?? since}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuRadioGroup value={since} onValueChange={(v) => { setPage(1); setSince(v); }}>
                    <DropdownMenuPanelRadioItem value="all">All time</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="24h">Last 24h</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="7d">Last 7 days</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="30d">Last 30 days</DropdownMenuPanelRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuPanel>
              </DropdownMenu>

              {/* Sort filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-[#D8CFC2] bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-[#F8F4EC]"
                  >
                    <span className="truncate">
                      {{ newest: "Newest first", latency: "Highest latency", tokens: "Highest tokens", cost: "Highest cost" }[sortBy] ?? sortBy}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuRadioGroup value={sortBy} onValueChange={setSortBy}>
                    <DropdownMenuPanelRadioItem value="newest">Newest first</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="latency">Highest latency</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="tokens">Highest tokens</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="cost">Highest cost</DropdownMenuPanelRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuPanel>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            {!activeWorkspaceId ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
                Select a workspace to load traces.
              </div>
            ) : null}

            {activeWorkspaceId && loading ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
                Loading traces…
              </div>
            ) : null}

            {activeWorkspaceId && !loading && error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-8 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {activeWorkspaceId && !loading && !error && rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
                <SearchX className="h-6 w-6 text-muted-foreground" />
                <p className="font-medium">No traces found</p>
                <p className="text-sm text-muted-foreground">
                  Try adjusting the filters or search query.
                </p>
              </div>
            ) : null}

            {activeWorkspaceId && !loading && !error && rows.length > 0 ? (
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-xl border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Trace</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Prompt</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Executor</TableHead>
                        <TableHead>Sidecar</TableHead>
                        <TableHead>Latency</TableHead>
                        <TableHead>Tokens</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Cache</TableHead>
                        <TableHead>Fallback</TableHead>
                        <TableHead className="text-right">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-accent/40",
                            pendingTraceId === row.id && "bg-accent/30",
                          )}
                          onClick={() => openTrace(row.id)}
                          onMouseEnter={() => prefetchTrace(row.id)}
                          onFocus={() => prefetchTrace(row.id)}
                        >
                          <TableCell className="font-mono text-xs">{row.id}</TableCell>
                          <TableCell>
                            <Badge variant={statusBadge(row.status)}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{row.promptName}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.promptVersion}</TableCell>
                          <TableCell>
                            <div>{row.model ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{row.provider ?? "—"}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.executorType === "enterprise_gateway" ? "warning" : "secondary"}>
                              {row.executorType === "enterprise_gateway"
                                ? "Gateway"
                                : row.executorType === "direct_provider"
                                  ? "Direct"
                                  : row.executorType}
                            </Badge>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {row.executorName ?? row.executorObservability}
                            </div>
                          </TableCell>
                          <TableCell>{row.sidecarName ?? "—"}</TableCell>
                          <TableCell className="tabular-nums" title={`proxy ${formatDuration(Math.max(row.durationMs - row.llmLatencyMs, 0))} + llm ${formatDuration(row.llmLatencyMs)}`}>
                            {formatDuration(row.durationMs)}
                          </TableCell>
                          <TableCell className="tabular-nums">{row.tokenCount}</TableCell>
                          <TableCell className="tabular-nums">{formatCost(row.totalCostUsd)}</TableCell>
                          <TableCell>
                            <Badge variant={row.cacheStatus === "hit" ? "success" : row.cacheStatus === "miss" || row.cacheStatus === "stale" ? "warning" : "secondary"}>
                              {row.cacheStatus === "unknown" ? "Unavailable" : row.cacheStatus}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.fallbackUsed ? "warning" : "secondary"}>
                              {row.fallbackUsed ? "Used" : "No"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {formatRelative(row.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Showing {(result!.page - 1) * result!.pageSize + 1}-{Math.min(result!.page * result!.pageSize, result!.total)} of {result!.total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={result!.page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {result!.page} of {Math.max(result!.totalPages, 1)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={result!.totalPages === 0 || result!.page >= result!.totalPages}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trace status legend</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Legend icon={CheckCircle2} label="Success" detail="Runtime completed as expected" />
            <Legend icon={AlertTriangle} label="Warning" detail="Fallback, cache miss, or flagged policy path" />
            <Legend icon={XCircle} label="Error" detail="Execution failed or provider error detected" />
            <Legend icon={Activity} label="Runtime only" detail="Prompt executions and replays only; admin audit events are excluded" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Legend({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof CheckCircle2;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-primary" />
        {label}
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
