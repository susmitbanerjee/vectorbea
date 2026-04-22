import Link from "next/link";
import type { Route } from "next";
import { cookies } from "next/headers";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditLogView } from "@/lib/api";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { Activity, Clock, FileText, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

// ── Audit diff helpers ────────────────────────────────────────────────────────

type AuditChange =
  | { kind: "template"; before: string; after: string }
  | { kind: "field"; path: string; before: string; after: string };

type AuditSummary = {
  headline: string;
  tone: "neutral" | "update" | "publish" | "runtime";
  changes: AuditChange[];
};

function resolveUseType(metadata: Record<string, unknown>): "runtime" | "audit" {
  const normalized = normalizeTraceMetadataV1(metadata);
  const explicit = normalized.tags?.use_type;
  if (explicit === "runtime" || explicit === "audit") return explicit;
  const action = (normalized.custom as Record<string, unknown> | undefined)?.action;
  return typeof action === "string" && action.trim() ? "audit" : "runtime";
}

function formatJsonValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function diffParameterObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: AuditChange[] = [];
  for (const key of Array.from(keys).sort()) {
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    out.push({ kind: "field", path: `parameters.${key}`, before: formatJsonValue(b), after: formatJsonValue(a) });
  }
  return out;
}

function summarizeAudit(metadata: Record<string, unknown>): AuditSummary {
  const action = typeof metadata.action === "string" ? metadata.action : undefined;
  const source = typeof metadata.source === "string" ? metadata.source : undefined;

  if (action === "publish") {
    const next = String(metadata.published_version ?? "");
    const prev = metadata.previous_published_version ? String(metadata.previous_published_version) : null;
    return {
      headline: prev ? `Published ${next} (replaces ${prev})` : `Published ${next}`,
      tone: "publish",
      changes: [],
    };
  }

  const changes: AuditChange[] = [];
  const beforeTpl = metadata.before_template;
  const afterTpl = metadata.after_template;
  if (typeof beforeTpl === "string" && typeof afterTpl === "string" && beforeTpl !== afterTpl) {
    changes.push({ kind: "template", before: beforeTpl, after: afterTpl });
  }
  const beforeParams = metadata.before_parameters;
  const afterParams = metadata.after_parameters;
  if (beforeParams && afterParams && typeof beforeParams === "object" && typeof afterParams === "object") {
    changes.push(...diffParameterObjects(beforeParams as Record<string, unknown>, afterParams as Record<string, unknown>));
  }

  if (action === "update" || changes.length > 0) {
    const parts: string[] = [];
    const templateChanges = changes.filter((c) => c.kind === "template").length;
    const fieldChanges = changes.filter((c) => c.kind === "field").length;
    if (templateChanges > 0) parts.push("template");
    if (fieldChanges > 0) parts.push(`${fieldChanges} parameter${fieldChanges === 1 ? "" : "s"}`);
    return { headline: parts.length > 0 ? `Updated ${parts.join(" & ")}` : "Updated prompt", tone: "update", changes };
  }

  if (source) return { headline: "Runtime call", tone: "runtime", changes: [] };
  return { headline: "Runtime call", tone: "runtime", changes: [] };
}

function truncate(value: string, limit = 80): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit) + "…";
}

function relativeTime(timestamp: string) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function llmLatencyBadgeVariant(ms: number) {
  if (ms < 300) return "success" as const;
  if (ms < 1000) return "warning" as const;
  return "destructive" as const;
}

function proxyLatencyBadgeVariant(ms: number) {
  if (ms < 5) return "success" as const;
  if (ms < 50) return "warning" as const;
  return "destructive" as const;
}

function formatProxyLatency(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

// Stats are computed from up to 500 most-recent logs so they represent a
// meaningful aggregate rather than just the current page.
type StatsRow = { proxy_latency_ms: number | null; llm_latency_ms: number | null; token_count: number | null; prompt_name: string | null };
function computeStats(rows: StatsRow[], total: number) {
  if (rows.length === 0) return { total, avgLlmLatency: 0, avgProxyLatency: 0, mostActivePrompt: "N/A" };
  const avgLlmLatency = Math.round(rows.reduce((s, r) => s + (r.llm_latency_ms ?? 0), 0) / rows.length);
  const avgProxyLatency = rows.reduce((s, r) => s + (r.proxy_latency_ms ?? 0), 0) / rows.length;
  const promptCounts = new Map<string, number>();
  for (const row of rows) {
    const name = row.prompt_name ?? "";
    promptCounts.set(name, (promptCounts.get(name) ?? 0) + 1);
  }
  let mostActivePrompt = "";
  let maxCount = 0;
  for (const [name, count] of promptCounts) {
    if (count > maxCount) { mostActivePrompt = name; maxCount = count; }
  }
  return { total, avgLlmLatency, avgProxyLatency, mostActivePrompt };
}

// Returns an ordered list of page numbers and "…" ellipsis markers for the
// pagination control. Always shows first + last page; shows up to 3 pages
// around the current page; inserts "…" where pages are skipped.
function buildPageSlots(current: number, total: number): (number | "…")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const slots = new Set<number>([1, total]);
  for (let p = Math.max(2, current - 2); p <= Math.min(total - 1, current + 2); p++) {
    slots.add(p);
  }

  const sorted = Array.from(slots).sort((a, b) => a - b);
  const result: (number | "…")[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i]!;
    if (prev !== undefined && cur - prev > 1) result.push("…");
    result.push(cur);
  }

  return result;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; q?: string; page?: string }>;
}) {
  const { org: workspaceId, q, page: pageParam } = await searchParams;

  // When a search query is active, return all matching results (no pagination)
  // so users can search across the full dataset. Pagination only applies to
  // the unfiltered view.
  const isSearching = Boolean(q?.trim());
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let logs: AuditLogView[] = [];
  let totalCount = 0;
  let stats = { total: 0, avgLlmLatency: 0, avgProxyLatency: 0, mostActivePrompt: "N/A" };

  if (workspaceId) {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);

    if (user) {
      const supabase = createVectorBeaAdminClient();

      // Run stats query + paginated data query in parallel for performance.
      // Stats query fetches up to 500 rows for aggregate computation and also
      // returns the exact total count via PostgREST's count header.
      const [statsResult, pageResult] = await Promise.all([
        supabase
          .from("audit_logs")
          .select("proxy_latency_ms, llm_latency_ms, token_count, prompt_name", { count: "exact" })
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(500),

        isSearching
          // Search: fetch enough rows to filter across; cap at 200 for safety.
          ? supabase
              .from("audit_logs")
              .select("id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
              .eq("workspace_id", workspaceId)
              .order("created_at", { ascending: false })
              .limit(200)
          // Normal view: one page only.
          : supabase
              .from("audit_logs")
              .select("id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
              .eq("workspace_id", workspaceId)
              .order("created_at", { ascending: false })
              .range(offset, offset + PAGE_SIZE - 1),
      ]);

      totalCount = statsResult.count ?? 0;
      stats = computeStats(statsResult.data ?? [], totalCount);

      const rawRows = pageResult.data ?? [];
      const mapped: AuditLogView[] = rawRows.map((row) => ({
        timestamp: row.created_at,
        workspaceId: workspaceId,
        promptName: row.prompt_name ?? "",
        versionTag: row.version_tag ?? "",
        proxyLatencyMs: row.proxy_latency_ms ?? 0,
        llmLatencyMs: row.llm_latency_ms ?? 0,
        tokenCount: row.token_count ?? 0,
        useType: resolveUseType((row.metadata as Record<string, unknown>) ?? {}),
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      }));

      // Apply client-side search filter on the fetched rows.
      logs = q
        ? mapped.filter((log) =>
            `${log.promptName} ${log.versionTag} ${JSON.stringify(log.metadata)}`
              .toLowerCase()
              .includes(q.toLowerCase()),
          )
        : mapped;
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Build a URL preserving all current search params while changing page.
  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (workspaceId) params.set("org", workspaceId);
    if (q) params.set("q", q);
    params.set("page", String(p));
    return `/audit-logs?${params.toString()}`;
  }

  return (
    <div className="min-h-full">
      <AppHeader
        title="Audit Logs"
        subtitle="Every prompt call your sidecar handled — timestamped, attributed, and scored."
      />
      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">

        {/* ── Stats ── */}
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 animate-fade-in">
          {[
            { label: "Total events", value: stats.total.toLocaleString(), icon: Activity },
            { label: "Avg sidecar latency", value: formatProxyLatency(stats.avgProxyLatency), icon: Zap },
            { label: "Avg LLM Latency", value: `${stats.avgLlmLatency} ms`, icon: Clock },
            { label: "Most Active Prompt", value: stats.mostActivePrompt, icon: FileText },
          ].map((stat) => (
            <Card key={stat.label} className="animate-slide-up">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <stat.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="truncate text-lg font-semibold tracking-tight">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* ── Table ── */}
        <Card className="animate-slide-up stagger-1-5">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Recent Audit Events</CardTitle>
                <CardDescription className="mt-1">
                  {isSearching
                    ? `${logs.length} result${logs.length !== 1 ? "s" : ""} matching "${q}"`
                    : totalCount > 0
                    ? `Page ${page} of ${totalPages} · ${totalCount.toLocaleString()} total event${totalCount !== 1 ? "s" : ""}`
                    : "No audit events match the current filters."}
                </CardDescription>
              </div>
              {/* Page counter badge */}
              {!isSearching && totalPages > 1 && (
                <p className="shrink-0 text-xs text-muted-foreground">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
                </p>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
                  <Activity className="h-7 w-7 text-muted-foreground/60" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">No audit events yet</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {isSearching ? "Try a different search term." : "Sidecar calls will appear here once your sidecar is connected and handling requests."}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Prompt</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Sidecar latency</TableHead>
                        <TableHead>LLM Latency</TableHead>
                        <TableHead>Tokens</TableHead>
                        <TableHead>Use type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={`${log.timestamp}-${log.promptName}-${log.versionTag}`} className="group">
                          <TableCell className="whitespace-nowrap">
                            <span className="text-sm" title={new Date(log.timestamp).toLocaleString()}>
                              {relativeTime(log.timestamp)}
                            </span>
                          </TableCell>
                          <TableCell><span className="font-medium">{log.promptName}</span></TableCell>
                          <TableCell><Badge variant="outline">{log.versionTag}</Badge></TableCell>
                          <TableCell>
                            <Badge variant={proxyLatencyBadgeVariant(log.proxyLatencyMs)}>
                              {formatProxyLatency(log.proxyLatencyMs)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={llmLatencyBadgeVariant(log.llmLatencyMs)}>{log.llmLatencyMs} ms</Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">{log.tokenCount.toLocaleString()}</TableCell>
                          <TableCell className="max-w-md">
                            {(() => {
                              const useType = log.useType === "audit" ? "Audit" : "Runtime";
                              const summary = summarizeAudit(log.metadata);
                              const badgeVariant = log.useType === "audit" ? "warning" : "secondary";
                              return (
                                <div className="space-y-1.5">
                                  <Badge variant={badgeVariant} className="text-[11px]">
                                    {useType}
                                  </Badge>
                                  {log.useType === "audit" && summary.changes.length > 0 && (
                                    <details className="group/details">
                                      <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                                        View {summary.changes.length} change{summary.changes.length === 1 ? "" : "s"}
                                      </summary>
                                      <ul className="mt-2 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                                        {summary.changes.map((change, idx) => (
                                          <li key={`${change.kind}-${idx}`} className="text-[11px]">
                                            {change.kind === "template" ? (
                                              <div className="space-y-1">
                                                <div className="font-semibold text-foreground">Template</div>
                                                <div className="grid gap-1 md:grid-cols-2">
                                                  <div className="rounded bg-red-500/10 p-2 text-red-600 dark:text-red-300">
                                                    <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">Before</div>
                                                    <pre className="whitespace-pre-wrap font-mono">{truncate(change.before, 240)}</pre>
                                                  </div>
                                                  <div className="rounded bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-300">
                                                    <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">After</div>
                                                    <pre className="whitespace-pre-wrap font-mono">{truncate(change.after, 240)}</pre>
                                                  </div>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="font-mono font-semibold text-foreground">{change.path}:</span>
                                                <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-red-600 dark:text-red-300 line-through">
                                                  {truncate(change.before, 40)}
                                                </span>
                                                <span className="text-muted-foreground">→</span>
                                                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-600 dark:text-emerald-300">
                                                  {truncate(change.after, 40)}
                                                </span>
                                              </div>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    </details>
                                  )}
                                </div>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* ── Pagination controls ── */}
                {!isSearching && totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-4">
                    <Link
                      href={pageUrl(page - 1) as Route}
                      aria-disabled={page <= 1}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-colors",
                        page <= 1
                          ? "pointer-events-none opacity-40"
                          : "hover:bg-accent/40 hover:text-foreground text-muted-foreground",
                      )}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </Link>

                    <div className="flex items-center gap-1">
                      {buildPageSlots(page, totalPages).map((slot, i) =>
                        slot === "…" ? (
                          <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                        ) : (
                          <Link
                            key={slot}
                            href={pageUrl(slot) as Route}
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium transition-colors",
                              slot === page
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                            )}
                          >
                            {slot}
                          </Link>
                        ),
                      )}
                    </div>

                    <Link
                      href={pageUrl(page + 1) as Route}
                      aria-disabled={page >= totalPages}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-colors",
                        page >= totalPages
                          ? "pointer-events-none opacity-40"
                          : "hover:bg-accent/40 hover:text-foreground text-muted-foreground",
                      )}
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
