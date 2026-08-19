"use client";

import * as React from "react";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatDuration, formatTokens } from "~/lib/format";
import { useScope } from "~/lib/workspace/workspace-provider";

interface AuditLog {
  timestamp: string; workspaceId: string; promptName: string; versionTag: string;
  proxyLatencyMs: number; llmLatencyMs: number; tokenCount: number; useType: "runtime" | "audit";
  metadata: Record<string, unknown>;
}

export function AuditView() {
  const { workspaceId } = useScope();
  const [logs, setLogs] = React.useState<AuditLog[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/audit?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const json = await response.json() as AuditLog[] | { error?: string }; if (!response.ok || !Array.isArray(json)) throw new Error(Array.isArray(json) ? "Failed to load audit logs" : json.error ?? "Failed to load audit logs"); setLogs(json); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Failed to load audit logs"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId]);

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((log) => [log.promptName, log.versionTag, log.useType, JSON.stringify(log.metadata)].join(" ").toLowerCase().includes(needle));
  }, [logs, search]);

  return <PageContainer>
    <PageHeader eyebrow="Govern" title="Audit log" description="Append-only runtime and administrative audit records captured by the backend."
      actions={<><Button size="sm" variant="secondary" disabled={!visible.length} onClick={() => download(visible, "csv")}>Export CSV</Button><Button size="sm" variant="secondary" disabled={!visible.length} onClick={() => download(visible, "json")}>Export JSON</Button></>} />
    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search prompts, versions, event metadata" className="mb-3 h-8 max-w-md" />
    {loading ? <State text="Loading audit logs…" /> : null}{error ? <State text={error} error /> : null}
    {!loading && !error ? <div className="border-subtle bg-surface-raised overflow-x-auto rounded-lg border"><table className="w-full min-w-[48rem]">
      <thead><tr className="border-subtle bg-surface-sunken text-fg-muted font-ui text-eyebrow border-b uppercase">{["Recorded","Type","Prompt","Version","Proxy","LLM","Tokens"].map((label) => <th key={label} className="px-3 py-2 text-left font-normal">{label}</th>)}</tr></thead>
      <tbody>{visible.map((log, index) => <tr key={`${log.timestamp}-${index}`} className="border-subtle border-b last:border-0">
        <td className="px-3 py-2"><Text variant="caption" tone="muted">{new Date(log.timestamp).toLocaleString()}</Text></td>
        <td className="px-3 py-2"><span className="border-subtle bg-surface-sunken rounded-full border px-2 py-0.5 text-caption capitalize">{log.useType}</span></td>
        <td className="px-3 py-2"><Text variant="body-sm" tone="primary">{log.promptName || "Unlabelled event"}</Text></td>
        <td className="px-3 py-2"><Text variant="caption" tone="secondary" className="font-code">{log.versionTag || "—"}</Text></td>
        <td className="px-3 py-2"><Text variant="caption" tone="secondary" tabular>{formatDuration(log.proxyLatencyMs)}</Text></td>
        <td className="px-3 py-2"><Text variant="caption" tone="secondary" tabular>{formatDuration(log.llmLatencyMs)}</Text></td>
        <td className="px-3 py-2"><Text variant="caption" tone="secondary" tabular>{formatTokens(log.tokenCount)}</Text></td>
      </tr>)}</tbody>
    </table>{visible.length === 0 ? <Text variant="body-sm" tone="muted" className="block p-8 text-center">No audit records match this view.</Text> : null}</div> : null}
  </PageContainer>;
}

function download(rows: AuditLog[], format: "csv" | "json") {
  const body = format === "json" ? JSON.stringify(rows, null, 2) : ["timestamp,type,prompt,version,proxy_ms,llm_ms,tokens", ...rows.map((row) => [row.timestamp,row.useType,row.promptName,row.versionTag,row.proxyLatencyMs,row.llmLatencyMs,row.tokenCount].map((value) => `"${String(value).replaceAll('"','""')}"`).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: format === "json" ? "application/json" : "text/csv" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `audit-log.${format}`; anchor.click(); URL.revokeObjectURL(url);
}
function State({ text, error }: { text: string; error?: boolean }) { return <div className={error ? "border-status-failed-border bg-status-failed-subtle rounded-lg border p-5 text-center text-status-failed" : "border-subtle bg-surface-raised rounded-lg border p-5 text-center"}><Text variant="body-sm" tone="inherit">{text}</Text></div>; }
