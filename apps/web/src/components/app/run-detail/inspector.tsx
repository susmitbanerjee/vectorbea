"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { formatCost, formatDuration, formatTokens, EMPTY } from "~/lib/format";
import { resolvedInputs, sampleOutput } from "~/mocks/run-detail";
import { useReplay } from "./replay";
import { PaneHeader } from "./step-timeline";

/* ══════════════════════════════════════════════════════════════════════════════
   RIGHT PANE · CONTEXT INSPECTOR

   Tabbed — and these are the ONE place on this screen where tabs are right. The
   panes are tabbed-wrongly when you need them simultaneously; input, output and
   the tool call are alternatives for the same step, and nobody reads a request
   body and a cost breakdown at the same time.

   COPY AS cURL is the highest-value control in here. Reproducing a failing tool
   call outside the product is the first thing anyone does when they do not
   believe the error, and reconstructing it by hand from a JSON viewer is ten
   minutes of transcription errors.
══════════════════════════════════════════════════════════════════════════════ */

type TabId = "overview" | "input" | "output" | "tool" | "error" | "cost";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "input", label: "Input" },
  { id: "output", label: "Output" },
  { id: "tool", label: "Tool call" },
  { id: "error", label: "Error" },
  { id: "cost", label: "Cost" },
];

export function Inspector({ className }: { className?: string }) {
  const { run, focusIndex } = useReplay();
  const node = run.nodes[focusIndex];
  const [tab, setTab] = React.useState<TabId>("overview");

  /* Land on Error when the focused step failed. Making someone click through to
     the error on a failed run is the tab-shaped mistake this screen exists to
     stop making. */
  React.useEffect(() => {
    if (node?.state === "failed") setTab("error");
  }, [node?.id, node?.state]);

  if (!node) return null;

  const available = TABS.filter((t) => {
    if (t.id === "error") return node.state === "failed";
    if (t.id === "tool") return node.kind === "tool";
    return true;
  });

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
      <PaneHeader title="Inspector">
        <Text variant="caption" tone="muted" className="font-code truncate">{node.id}</Text>
      </PaneHeader>

      <div role="tablist" aria-label="Step context" className="border-subtle flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1">
        {available.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "font-ui text-caption shrink-0 rounded-xs px-2 py-1",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
              tab === t.id
                ? "bg-surface-active text-fg-primary"
                : "text-fg-muted hover:text-fg-primary",
              t.id === "error" && tab !== t.id && "text-status-failed",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2.5">
        {tab === "overview" ? <Overview /> : null}
        {tab === "input" ? <Inputs /> : null}
        {tab === "output" ? <Output /> : null}
        {tab === "tool" ? <ToolCall /> : null}
        {tab === "error" ? <ErrorTab /> : null}
        {tab === "cost" ? <Cost /> : null}
      </div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────────────── */

function Overview() {
  const { run, focusIndex } = useReplay();
  const node = run.nodes[focusIndex];
  return (
    <dl className="grid gap-2">
      <Row label="Status">{node.state}</Row>
      <Row label="Kind">{node.kind}</Row>
      <Row label="Duration">{formatDuration(node.durationMs)}</Row>
      <Row label="Attempts">{node.attempt ?? 1}</Row>
      <Row label="Checkpoint seq">
        {node.state === "committed" || node.state === "recovered" ? focusIndex + 1 : EMPTY}
      </Row>
      <Row label="Committed at">
        {node.at ? new Date(node.at).toISOString().replace("T", " ").slice(0, 19) + "Z" : EMPTY}
      </Row>
    </dl>
  );
}

function Inputs() {
  const { run, focusIndex } = useReplay();
  const inputs = resolvedInputs(run, focusIndex);

  if (inputs.length === 0) {
    return <Text variant="caption" tone="muted">This step takes no bound inputs.</Text>;
  }

  return (
    <div className="grid gap-2">
      <Text variant="caption" tone="muted" className="block">
        Resolved values, with the binding that produced each one.
      </Text>
      {inputs.map((input) => (
        <div key={input.field} className="border-subtle rounded-sm border p-2">
          <div className="flex items-baseline justify-between gap-2">
            <Text variant="caption" tone="muted" className="font-code">{input.field}</Text>
            <Text variant="body-sm" tone="primary" className="font-code min-w-0 truncate">{input.value}</Text>
          </div>
          <Text variant="caption" tone="muted" className="mt-1 block font-code">
            ← {input.fromNode} · {input.path}
          </Text>
        </div>
      ))}
    </div>
  );
}

function Output() {
  const { run, focusIndex } = useReplay();
  const value = sampleOutput(run, focusIndex);
  return <JsonViewer value={value} />;
}

function ToolCall() {
  const { run, focusIndex } = useReplay();
  const node = run.nodes[focusIndex];
  const [copied, setCopied] = React.useState(false);

  const tool = node.error?.toolCall ?? node.name;
  const body = JSON.stringify({ lookaheadDays: 30, environment: run.environment }, null, 2);

  const curl = [
    `curl -X POST https://api.vectorbea.com/v1/tools/${tool}/invoke \\`,
    `  -H "Authorization: Bearer $VECTORBEA_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Idempotency-Key: ${run.id}:${node.id}" \\`,
    `  -d '${body.replace(/\n\s*/g, " ")}'`,
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  return (
    <div className="grid gap-2">
      <dl className="grid gap-2">
        <Row label="Tool">{tool}</Row>
        <Row label="Timing">{formatDuration(node.durationMs)}</Row>
        <Row label="Idempotency key">
          <span className="font-code text-[10px]">{run.id.slice(0, 12)}…:{node.id}</span>
        </Row>
      </dl>

      <div>
        <Text variant="eyebrow" tone="muted" className="mb-1 block">Request</Text>
        <pre className="bg-surface-sunken border-subtle font-code text-mono-sm max-w-full overflow-x-auto rounded-sm border p-2">
          <code className="text-fg-secondary">{body}</code>
        </pre>
      </div>

      <div>
        <Text variant="eyebrow" tone="muted" className="mb-1 block">Response</Text>
        <pre className="bg-surface-sunken border-subtle font-code text-mono-sm max-w-full overflow-x-auto rounded-sm border p-2">
          <code className={node.state === "failed" ? "text-status-failed" : "text-fg-secondary"}>
            {node.state === "failed"
              ? `ECONNREFUSED after 3 attempts\n${node.error?.message ?? ""}`
              : JSON.stringify({ ok: true, rowCount: 2 }, null, 2)}
          </code>
        </pre>
      </div>

      <Button size="sm" variant="secondary" onClick={copy} fullWidth>
        {copied ? "Copied" : "Copy as cURL"}
      </Button>
    </div>
  );
}

function ErrorTab() {
  const { run, focusIndex } = useReplay();
  const node = run.nodes[focusIndex];
  if (!node.error) return <Text variant="caption" tone="muted">This step did not fail.</Text>;

  return (
    <div className="grid gap-2">
      <div className="border-status-failed-border bg-status-failed-subtle max-w-full overflow-hidden rounded-sm border p-2">
        <Text variant="body-sm" tone="inherit" className="text-status-failed block break-words">
          {node.error.message}
        </Text>
      </div>
      <dl className="grid gap-2">
        <Row label="Classification">
          {node.error.connection ? "connection_unavailable" : "tool_call_failed"}
        </Row>
        <Row label="Retryable">yes</Row>
        <Row label="Attempts">3 of 3</Row>
        {node.error.connection ? <Row label="Connection">{node.error.connection}</Row> : null}
      </dl>

      <div>
        <Text variant="eyebrow" tone="muted" className="mb-1 block">Stack</Text>
        <pre className="bg-surface-sunken border-subtle font-code text-mono-sm max-w-full overflow-x-auto rounded-sm border p-2">
          <code className="text-fg-muted">{`at ToolInvoker.invoke (tool-invoker.kt:184)
at NodeExecutor.runNode (node-executor.kt:96)
at RunLoop.step (run-loop.kt:212)
at Worker.lease (worker.kt:58)`}</code>
        </pre>
      </div>

      <Button asChild size="sm" variant="primary" fullWidth>
        <Link href={"/connections" as Route}>Go to remediation</Link>
      </Button>
    </div>
  );
}

function Cost() {
  const { run, focusIndex } = useReplay();
  const node = run.nodes[focusIndex];
  const inTokens = Math.round((node.tokens ?? 0) * 0.7);
  const outTokens = (node.tokens ?? 0) - inTokens;

  return (
    <dl className="grid gap-2">
      <Row label="Model">{node.kind === "llm" || node.kind === "agent" ? "claude-sonnet-5" : EMPTY}</Row>
      <Row label="Tokens in">{node.tokens ? formatTokens(inTokens) : EMPTY}</Row>
      <Row label="Tokens out">{node.tokens ? formatTokens(outTokens) : EMPTY}</Row>
      <Row label="Unit price">{node.tokens ? "$3.20 / 1M" : EMPTY}</Row>
      <Row label="Step cost">{formatCost(node.costUsd)}</Row>
      <Row label="Share of run">
        {node.costUsd && run.costUsd ? `${((node.costUsd / run.costUsd) * 100).toFixed(1)}%` : EMPTY}
      </Row>
    </dl>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────────────── */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0"><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd className="min-w-0"><Text variant="caption" tone="primary" tabular className="truncate">{children}</Text></dd>
    </div>
  );
}

/**
 * JSON viewer with search, collapse and copy-path.
 *
 * Copy-path is the one that earns its place: an operator reading a failure needs
 * `result.rows[0].account_id` to paste into the next query, and counting
 * brackets by eye is how people get it wrong.
 */
function JsonViewer({ value }: { value: unknown }) {
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null);

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      window.setTimeout(() => setCopiedPath(null), 1400);
    } catch {}
  };

  const rows = React.useMemo(() => flatten(value, "$", collapsed), [value, collapsed]);
  const filtered = query
    ? rows.filter((r) => r.path.toLowerCase().includes(query.toLowerCase()) || r.preview.toLowerCase().includes(query.toLowerCase()))
    : rows;

  return (
    <div className="grid gap-1.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search keys and values"
        aria-label="Search output"
        data-no-shortcuts
        className={cn(
          "bg-surface-sunken border-subtle font-code text-mono-sm w-full rounded-sm border px-2 py-1",
          "text-fg-primary placeholder:text-fg-disabled",
          "outline-none focus-visible:focus-ring",
        )}
      />

      <div className="font-code text-mono-sm">
        {filtered.map((row) => (
          <div
            key={row.path}
            className="group hover:bg-surface-hover flex items-start gap-1 rounded-xs py-0.5"
            style={{ paddingLeft: row.depth * 10 }}
          >
            {row.expandable ? (
              <button
                onClick={() =>
                  setCollapsed((c) => {
                    const next = new Set(c);
                    if (next.has(row.path)) next.delete(row.path);
                    else next.add(row.path);
                    return next;
                  })
                }
                aria-label={collapsed.has(row.path) ? `Expand ${row.path}` : `Collapse ${row.path}`}
                className="text-fg-disabled hover:text-fg-primary w-3 shrink-0 outline-none focus-visible:focus-ring"
              >
                {collapsed.has(row.path) ? "▸" : "▾"}
              </button>
            ) : (
              <span className="w-3 shrink-0" />
            )}

            <span className="text-accent shrink-0">{row.key}</span>
            <span className="text-fg-muted shrink-0">:</span>
            <span className={cn("min-w-0 flex-1 truncate", row.tone)}>{row.preview}</span>

            <button
              onClick={() => copyPath(row.path)}
              aria-label={`Copy path ${row.path}`}
              className={cn(
                "text-fg-disabled hover:text-accent shrink-0 px-1 text-[10px]",
                "opacity-0 transition-opacity duration-fast group-hover:opacity-100",
                "outline-none focus-visible:opacity-100 focus-visible:focus-ring",
              )}
            >
              {copiedPath === row.path ? "copied" : "path"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface JsonRow {
  path: string;
  key: string;
  preview: string;
  depth: number;
  expandable: boolean;
  tone: string;
}

function flatten(value: unknown, path: string, collapsed: Set<string>, depth = 0, key = "result"): JsonRow[] {
  if (value === null) return [{ path, key, preview: "null", depth, expandable: false, tone: "text-fg-muted" }];

  if (Array.isArray(value)) {
    const row: JsonRow = {
      path, key, preview: `[${value.length}]`, depth, expandable: value.length > 0, tone: "text-fg-muted",
    };
    if (collapsed.has(path) || value.length === 0) return [row];
    return [row, ...value.flatMap((v, i) => flatten(v, `${path}[${i}]`, collapsed, depth + 1, String(i)))];
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const row: JsonRow = {
      path, key, preview: `{${entries.length}}`, depth, expandable: entries.length > 0, tone: "text-fg-muted",
    };
    if (collapsed.has(path) || entries.length === 0) return [row];
    return [row, ...entries.flatMap(([k, v]) => flatten(v, `${path}.${k}`, collapsed, depth + 1, k))];
  }

  const tone =
    typeof value === "string" ? "text-status-success"
    : typeof value === "number" ? "text-status-live"
    : "text-fg-primary";
  return [{
    path, key,
    preview: typeof value === "string" ? `"${value}"` : String(value),
    depth, expandable: false, tone,
  }];
}
