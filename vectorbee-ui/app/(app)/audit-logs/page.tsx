import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  apiFetch,
  type AuditLogView,
  type OrganizationView,
} from "@/lib/api";
import { Activity, Clock, FileText, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

type AuditChange =
  | { kind: "template"; before: string; after: string }
  | { kind: "field"; path: string; before: string; after: string };

type AuditSummary = {
  headline: string;
  tone: "neutral" | "update" | "publish" | "runtime";
  changes: AuditChange[];
};

function formatJsonValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    out.push({
      kind: "field",
      path: `parameters.${key}`,
      before: formatJsonValue(b),
      after: formatJsonValue(a),
    });
  }
  return out;
}

function summarizeAudit(metadata: Record<string, unknown>): AuditSummary {
  const action = typeof metadata.action === "string" ? metadata.action : undefined;
  const source = typeof metadata.source === "string" ? metadata.source : undefined;

  // Publish audit event
  if (action === "publish") {
    const next = String(metadata.published_version ?? "");
    const prev = metadata.previous_published_version
      ? String(metadata.previous_published_version)
      : null;
    return {
      headline: prev
        ? `Published ${next} (replaces ${prev})`
        : `Published ${next}`,
      tone: "publish",
      changes: [],
    };
  }

  // Update audit event — compute a field-level diff from before/after blobs
  const changes: AuditChange[] = [];
  const beforeTpl = metadata.before_template;
  const afterTpl = metadata.after_template;
  if (
    typeof beforeTpl === "string" &&
    typeof afterTpl === "string" &&
    beforeTpl !== afterTpl
  ) {
    changes.push({ kind: "template", before: beforeTpl, after: afterTpl });
  }

  const beforeParams = metadata.before_parameters;
  const afterParams = metadata.after_parameters;
  if (
    beforeParams &&
    afterParams &&
    typeof beforeParams === "object" &&
    typeof afterParams === "object"
  ) {
    changes.push(
      ...diffParameterObjects(
        beforeParams as Record<string, unknown>,
        afterParams as Record<string, unknown>,
      ),
    );
  }

  if (action === "update" || changes.length > 0) {
    const parts: string[] = [];
    const templateChanges = changes.filter((c) => c.kind === "template").length;
    const fieldChanges = changes.filter((c) => c.kind === "field").length;
    if (templateChanges > 0) parts.push("template");
    if (fieldChanges > 0) {
      parts.push(`${fieldChanges} parameter${fieldChanges === 1 ? "" : "s"}`);
    }
    const headline =
      parts.length > 0 ? `Updated ${parts.join(" & ")}` : "Updated prompt";
    return { headline, tone: "update", changes };
  }

  // Runtime audit from SDK / proxy
  if (source) {
    return { headline: `Runtime call`, tone: "runtime", changes: [] };
  }
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

function computeStats(logs: AuditLogView[]) {
  if (logs.length === 0) {
    return { total: 0, avgLlmLatency: 0, avgProxyLatency: 0, totalTokens: 0, mostActivePrompt: "N/A" };
  }

  const avgLlmLatency = Math.round(logs.reduce((sum, l) => sum + l.llmLatencyMs, 0) / logs.length);
  const avgProxyLatency = logs.reduce((sum, l) => sum + l.proxyLatencyMs, 0) / logs.length;
  const totalTokens = logs.reduce((sum, l) => sum + l.tokenCount, 0);

  const promptCounts = new Map<string, number>();
  for (const log of logs) {
    promptCounts.set(log.promptName, (promptCounts.get(log.promptName) ?? 0) + 1);
  }
  let mostActivePrompt = "";
  let maxCount = 0;
  for (const [name, count] of promptCounts) {
    if (count > maxCount) {
      mostActivePrompt = name;
      maxCount = count;
    }
  }

  return { total: logs.length, avgLlmLatency, avgProxyLatency, totalTokens, mostActivePrompt };
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; q?: string }>;
}) {
  const { org, q } = await searchParams;
  const suffix = org ? `?workspaceId=${org}` : "";
  const organizations = await apiFetch<OrganizationView[]>("/api/organizations").catch(() => [] as OrganizationView[]);
  const organizationMap = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const logs = (await apiFetch<AuditLogView[]>(`/api/audit${suffix}`)).filter((log) =>
    !q
      ? true
      : `${log.promptName} ${log.versionTag} ${JSON.stringify(log.metadata)}`.toLowerCase().includes(q.toLowerCase()),
  );

  const stats = computeStats(logs);

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Audit Logs"
        subtitle="Execution traces, ingestion health, and route-level observability."
      />
      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 animate-fade-in">
          {[
            { label: "Total Entries", value: stats.total.toLocaleString(), icon: Activity },
            { label: "Avg VectorBee Latency", value: formatProxyLatency(stats.avgProxyLatency), icon: Zap },
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

        <Card className="animate-slide-up stagger-1-5">
          <CardHeader>
            <CardTitle>Recent Audit Events</CardTitle>
            <CardDescription>
              {logs.length > 0
                ? `Showing ${logs.length} event${logs.length !== 1 ? "s" : ""} from the backend audit feed.`
                : "No audit events match the current filters."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
                  <Activity className="h-7 w-7 text-muted-foreground/60" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">No audit logs found</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Events will appear here once prompts are executed.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Organization</TableHead>
                      <TableHead>Prompt</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>VectorBee Latency</TableHead>
                      <TableHead>LLM Latency</TableHead>
                      <TableHead>Tokens</TableHead>
                      <TableHead>Details</TableHead>
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
                        <TableCell>
                          <span className="text-sm">{organizationMap.get(log.workspaceId) ?? "Unknown workspace"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{log.promptName}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.versionTag}</Badge>
                        </TableCell>
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
                            const summary = summarizeAudit(log.metadata);
                            const badgeVariant =
                              summary.tone === "publish"
                                ? "success"
                                : summary.tone === "update"
                                  ? "warning"
                                  : "outline";
                            return (
                              <div className="space-y-1.5">
                                <Badge variant={badgeVariant} className="text-[11px]">
                                  {summary.headline}
                                </Badge>
                                {summary.changes.length > 0 && (
                                  <details className="group/details">
                                    <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                                      View {summary.changes.length} change
                                      {summary.changes.length === 1 ? "" : "s"}
                                    </summary>
                                    <ul className="mt-2 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                                      {summary.changes.map((change, idx) => (
                                        <li
                                          key={`${change.kind}-${idx}`}
                                          className="text-[11px]"
                                        >
                                          {change.kind === "template" ? (
                                            <div className="space-y-1">
                                              <div className="font-semibold text-foreground">
                                                Template
                                              </div>
                                              <div className="grid gap-1 md:grid-cols-2">
                                                <div className="rounded bg-red-500/10 p-2 text-red-300">
                                                  <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">
                                                    Before
                                                  </div>
                                                  <pre className="whitespace-pre-wrap font-mono">
                                                    {truncate(change.before, 240)}
                                                  </pre>
                                                </div>
                                                <div className="rounded bg-emerald-500/10 p-2 text-emerald-300">
                                                  <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">
                                                    After
                                                  </div>
                                                  <pre className="whitespace-pre-wrap font-mono">
                                                    {truncate(change.after, 240)}
                                                  </pre>
                                                </div>
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <span className="font-mono font-semibold text-foreground">
                                                {change.path}:
                                              </span>
                                              <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-red-300 line-through">
                                                {truncate(change.before, 40)}
                                              </span>
                                              <span className="text-muted-foreground">→</span>
                                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300">
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
