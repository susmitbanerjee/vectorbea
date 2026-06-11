"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDur(ms?: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─── JSON panel ──────────────────────────────────────────────────────────────

function JsonSection({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);

  async function copy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-faint)" }}>
          {label}
        </h3>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors hover:bg-white/5"
          style={{ color: "var(--text-faint)" }}
        >
          {copied ? <><Check className="h-3 w-3 text-emerald-500" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
        </button>
      </div>
      <pre
        className="overflow-auto rounded-lg px-4 py-3 text-[12px] leading-relaxed font-mono"
        style={{
          background: "#060A10",
          border: "1px solid rgba(148,163,184,0.1)",
          color: "#CBD5E1",
          maxHeight: "220px",
        }}
      >
        {json}
      </pre>
    </section>
  );
}

// ─── KV table ─────────────────────────────────────────────────────────────────

function KVTable({ rows }: { rows: { label: string; value: string; mono?: boolean }[] }) {
  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ border: "1px solid var(--border-subtle)" }}
    >
      {rows.map((row, i) => (
        <div
          key={row.label}
          className="grid items-center gap-4 px-4 py-2.5"
          style={{
            gridTemplateColumns: "160px 1fr",
            background: i % 2 === 0 ? "var(--surface-2)" : "var(--surface-3)",
            borderBottom: i < rows.length - 1 ? "1px solid rgba(148,163,184,0.05)" : undefined,
          }}
        >
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-faint)" }}>{row.label}</span>
          <span
            className={row.mono ? "font-mono text-[11px]" : "text-[12px]"}
            style={{ color: "var(--text-secondary)" }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface MetadataTabProps {
  model: AgentRunUiModel;
}

export function MetadataTab({ model }: MetadataTabProps) {
  const { run, runMetadata } = model;

  const executionRows = [
    { label: "Run ID",          value: run.id,             mono: true },
    { label: "Job",             value: run.jobName },
    { label: "Status",          value: run.status },
    { label: "Trigger",         value: run.triggerSource },
    { label: "Environment",     value: run.environment },
    { label: "Attempt",         value: `#${run.attemptNumber}` },
    { label: "Started At",      value: new Date(run.startedAt).toLocaleString(), mono: true },
    { label: "Finished At",     value: run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—", mono: true },
    { label: "Duration",        value: fmtDur(run.durationMs), mono: true },
    { label: "Idempotency Key", value: run.idempotencyKey, mono: true },
  ];

  const aiRows = [
    { label: "Total Tokens",    value: run.totalTokens?.toLocaleString() ?? "—", mono: true },
    { label: "Estimated Cost",  value: run.estimatedCostUsd != null ? `$${(run.estimatedCostUsd ?? 0).toFixed(6)}` : "—", mono: true },
    { label: "Current Agent",   value: run.currentAgent ?? "—" },
    { label: "Current Step",    value: run.currentStep ?? "—" },
  ];

  return (
    <div className="space-y-8">
      {/* Execution metadata */}
      <section>
        <h3
          className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: "var(--text-faint)" }}
        >
          Execution Metadata
        </h3>
        <KVTable rows={executionRows} />
      </section>

      {/* AI metadata */}
      <section>
        <h3
          className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: "var(--text-faint)" }}
        >
          AI Metadata
        </h3>
        <KVTable rows={aiRows} />
      </section>

      {/* Dynamic JSON sections from runMetadata */}
      {runMetadata?.searchAttributes && (
        <JsonSection label="Search Attributes" value={runMetadata.searchAttributes} />
      )}
      {runMetadata?.aiMetadata && (
        <JsonSection label="AI Configuration" value={runMetadata.aiMetadata} />
      )}
      {runMetadata?.budgetMetadata && (
        <JsonSection label="Budget Policy" value={runMetadata.budgetMetadata} />
      )}
      {runMetadata?.retryPolicy && (
        <JsonSection label="Retry Policy" value={runMetadata.retryPolicy} />
      )}
      {runMetadata?.executionMetadata && (
        <JsonSection label="Execution Config" value={runMetadata.executionMetadata} />
      )}
      {runMetadata?.memo && (
        <JsonSection label="Memo" value={runMetadata.memo} />
      )}

      {/* Error */}
      {run.errorMessage && (
        <section>
          <h3
            className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "#EF4444" }}
          >
            Error
          </h3>
          <pre
            className="overflow-auto rounded-lg px-4 py-3 text-[12px] font-mono leading-relaxed"
            style={{
              background: "rgba(239,68,68,0.04)",
              border: "1px solid rgba(239,68,68,0.2)",
              color: "#FCA5A5",
            }}
          >
            {run.errorMessage}
          </pre>
        </section>
      )}
    </div>
  );
}
