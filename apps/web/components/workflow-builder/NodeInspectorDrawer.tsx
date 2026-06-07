"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, GripVertical,
  Search, Sparkles, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDebugNodeAttempts, getDebugNodeDetail, type DebugNodeDetail } from "@/lib/repository";

type TabId = "inputs" | "outputs" | "variables" | "failure" | "raw";

const TABS: { id: TabId; label: string; short: string }[] = [
  { id: "inputs",    label: "Resolved Inputs",  short: "Inputs" },
  { id: "outputs",   label: "Outputs",          short: "Outputs" },
  { id: "variables", label: "Variable Mapping", short: "Variables" },
  { id: "failure",   label: "Failure Reason",   short: "Failure" },
  { id: "raw",       label: "Raw JSON",         short: "Raw JSON" },
];

function tryParse(json: string | null | undefined): unknown {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return json; }
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Pretty key/value renderer with missing-value highlighting ────────────────

function PrettyValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) {
    return <span className="rounded px-1.5 py-0.5 text-[11.5px] font-mono" style={{ background: "#FEF2F2", color: "#B91C1C" }}>null</span>;
  }
  if (typeof value === "string") {
    if (value.trim() === "") {
      return <span className="rounded px-1.5 py-0.5 text-[11.5px] font-mono" style={{ background: "#FFFBEB", color: "#B45309" }}>&quot;&quot; (empty)</span>;
    }
    return <span className="text-[12px] font-mono" style={{ color: "#0F766E" }}>&quot;{value}&quot;</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-[12px] font-mono" style={{ color: "#1D4ED8" }}>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[11.5px] text-slate-400">[ ] empty array</span>;
    return (
      <div className="space-y-1 border-l pl-3" style={{ borderColor: "#E2E8F0" }}>
        {value.map((v, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-[11px] text-slate-400 font-mono shrink-0">[{i}]</span>
            <PrettyValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-[11.5px] text-slate-400">{"{ } empty object"}</span>;
    return (
      <div className="space-y-1.5 border-l pl-3" style={{ borderColor: "#E2E8F0" }}>
        {entries.map(([k, v]) => (
          <div key={k}>
            <span className="text-[11.5px] font-semibold" style={{ color: "#475569" }}>{k}</span>
            <span className="text-slate-300 mx-1">:</span>
            <PrettyValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-[12px] font-mono">{String(value)}</span>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy JSON"}
    </button>
  );
}

function SearchableJson({ value }: { value: unknown }) {
  const [query, setQuery] = useState("");
  const [mode, setMode]   = useState<"pretty" | "raw">("pretty");
  const json = useMemo(() => JSON.stringify(value ?? null, null, 2), [value]);

  const filteredRaw = useMemo(() => {
    if (!query.trim()) return json;
    return json
      .split("\n")
      .filter(line => line.toLowerCase().includes(query.toLowerCase()))
      .join("\n") || "(no matching lines)";
  }, [json, query]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search this payload…"
            className="h-8 w-full rounded-lg border border-slate-200 pl-8 pr-3 text-[12px] outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {(["pretty", "raw"] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "h-7 rounded-md px-2.5 text-[11px] font-semibold capitalize transition-colors",
                mode === m ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700",
              )}
            >
              {m === "pretty" ? "Pretty View" : "Raw JSON"}
            </button>
          ))}
        </div>
        <CopyButton text={json} />
      </div>

      <div className="rounded-xl border border-slate-200 p-3 overflow-auto" style={{ background: "#FAFBFC", maxHeight: 420 }}>
        {value == null ? (
          <p className="text-[12px] text-slate-400">null</p>
        ) : mode === "pretty" ? (
          <PrettyValue value={value} />
        ) : (
          <pre className="text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap break-all text-slate-700">{filteredRaw}</pre>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon = Sparkles, text }: { icon?: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "#F1F5F9" }}>
        <Icon className="h-5 w-5 text-slate-400" />
      </div>
      <p className="max-w-[240px] text-[12.5px] text-slate-500 leading-relaxed">{text}</p>
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export function NodeInspectorDrawer({
  runId, nodeId, nodeLabel, nodeType, inputMapping, outputMapping, onClose,
}: {
  runId: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  onClose: () => void;
}) {
  const [width, setWidth]       = useState(420);
  const [resizing, setResizing] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [detail, setDetail]     = useState<DebugNodeDetail | null>(null);
  const [attempts, setAttempts] = useState<DebugNodeDetail[]>([]);
  const [attemptIdx, setAttemptIdx] = useState(0);
  const [activeTab, setActiveTab]   = useState<TabId>("inputs");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setAttemptIdx(0);
    Promise.all([
      getDebugNodeDetail(runId, nodeId).catch(() => null),
      getDebugNodeAttempts(runId, nodeId).catch(() => ({ attempts: [] as DebugNodeDetail[] })),
    ]).then(([d, a]) => {
      if (cancelled) return;
      if (!d) { setNotFound(true); setLoading(false); return; }
      setDetail(d);
      setAttempts(a.attempts.length ? a.attempts : [d]);
      setActiveTab(d.status === "failed" ? "failure" : "inputs");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [runId, nodeId]);

  // Resize handling
  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      const next = Math.min(720, Math.max(340, window.innerWidth - e.clientX));
      setWidth(next);
    }
    function onUp() { setResizing(false); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  const current = attempts[attemptIdx] ?? detail;

  return (
    <div
      className="absolute top-0 right-0 bottom-0 z-40 flex bg-white shadow-2xl"
      style={{ width, borderLeft: "1px solid #E2E8F0" }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={() => setResizing(true)}
        className="flex w-2 shrink-0 cursor-col-resize items-center justify-center hover:bg-slate-100 transition-colors"
        title="Drag to resize"
      >
        <GripVertical className="h-4 w-4 text-slate-300" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3" style={{ background: "#F8FAFC" }}>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold text-slate-800">{nodeLabel}</p>
            <p className="text-[11px] text-slate-400">{nodeType} · Node Inspector</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />
          </div>
        ) : notFound || !current ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <EmptyState text="No debug data captured for this node yet. This node has not executed in this Debug Run." />
          </div>
        ) : (
          <>
            {/* Status + attempt selector */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <StatusPill status={current.status} />
                <span className="text-[11px] text-slate-400">{fmtMs(current.durationMs)}</span>
              </div>
              {attempts.length > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={attemptIdx === 0}
                    onClick={() => setAttemptIdx(i => Math.max(0, i - 1))}
                    className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-[11px] font-medium text-slate-600 px-1">
                    Attempt {current.attempt} / {attempts.length}
                  </span>
                  <button
                    type="button"
                    disabled={attemptIdx === attempts.length - 1}
                    onClick={() => setAttemptIdx(i => Math.min(attempts.length - 1, i + 1))}
                    className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Tab bar — equal-width grid, no horizontal scrolling */}
            <div className="grid grid-cols-5 border-b border-slate-200" style={{ background: "#F8FAFC" }}>
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.label}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex h-10 items-center justify-center gap-1 border-b-2 px-1 text-[11px] font-semibold transition-colors truncate",
                    activeTab === tab.id ? "border-amber-500 text-amber-700" : "border-transparent text-slate-500 hover:text-slate-700",
                  )}
                >
                  <span className="truncate">{tab.short}</span>
                  {tab.id === "failure" && current.status === "failed" && (
                    <span className="absolute top-1.5 right-2.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === "inputs"    && <ResolvedInputsTab detail={current} />}
              {activeTab === "outputs"   && <OutputsTab detail={current} />}
              {activeTab === "variables" && <VariableMappingTab detail={current} inputMapping={inputMapping} outputMapping={outputMapping} />}
              {activeTab === "failure"   && <FailureReasonTab detail={current} />}
              {activeTab === "raw"       && <RawJsonTab detail={current} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const meta: Record<string, { bg: string; text: string; dot: string }> = {
    success:  { bg: "#ECFDF5", text: "#059669", dot: "#10B981" },
    failed:   { bg: "#FEF2F2", text: "#DC2626", dot: "#EF4444" },
    running:  { bg: "#EFF6FF", text: "#2563EB", dot: "#3B82F6" },
    pending:  { bg: "#F8FAFC", text: "#64748B", dot: "#94A3B8" },
    skipped:  { bg: "#F8FAFC", text: "#64748B", dot: "#CBD5E1" },
    retried:  { bg: "#FFFBEB", text: "#B45309", dot: "#F59E0B" },
  };
  const m = meta[status] ?? meta.pending;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize" style={{ background: m.bg, color: m.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
      {status}
    </span>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function ResolvedInputsTab({ detail }: { detail: DebugNodeDetail }) {
  const resolved = tryParse(detail.resolvedInput);
  const template = tryParse(detail.inputTemplate);
  if (resolved == null) {
    return <EmptyState text={
      detail.status === "pending" ? "This node has not executed yet." : "No resolved input was captured for this node."
    } />;
  }
  return (
    <div className="space-y-4">
      <SearchableJson value={resolved} />
      {template != null && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Input template (before resolution)</p>
          <div className="rounded-xl border border-slate-200 p-3 overflow-auto" style={{ background: "#FAFBFC", maxHeight: 200 }}>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-slate-500">{JSON.stringify(template, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function OutputsTab({ detail }: { detail: DebugNodeDetail }) {
  const output = tryParse(detail.output);
  const parsed = tryParse(detail.parsedOutput);
  const validation = tryParse(detail.schemaValidation) as { valid?: boolean; errors?: unknown[] } | null;

  if (output == null && detail.status !== "failed") {
    return <EmptyState text={
      detail.status === "pending" ? "This node has not executed yet."
        : detail.status === "skipped" ? "This node was skipped because condition evaluated false."
        : "No output was captured for this node."
    } />;
  }

  return (
    <div className="space-y-4">
      {(detail.modelProvider || detail.modelName || detail.tokensInput != null) && (
        <div className="grid grid-cols-2 gap-2">
          {detail.modelProvider && <Stat label="Model provider" value={detail.modelProvider} />}
          {detail.modelName && <Stat label="Model" value={detail.modelName} />}
          {detail.tokensInput != null && <Stat label="Tokens in" value={String(detail.tokensInput)} />}
          {detail.tokensOutput != null && <Stat label="Tokens out" value={String(detail.tokensOutput)} />}
          {detail.costEstimate != null && <Stat label="Est. cost" value={`$${detail.costEstimate.toFixed(4)}`} />}
        </div>
      )}

      {detail.nodeType === "condition" || detail.nodeType === "branch" ? (
        <ConditionOutput output={output as Record<string, unknown> | null} />
      ) : (
        <>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Generated output</p>
            <SearchableJson value={output} />
          </div>
          {parsed != null && parsed !== output && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Parsed output</p>
              <div className="rounded-xl border border-slate-200 p-3" style={{ background: "#FAFBFC" }}>
                <PrettyValue value={parsed} />
              </div>
            </div>
          )}
          {validation && (
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
              style={validation.valid
                ? { borderColor: "#A7F3D0", background: "#ECFDF5" }
                : { borderColor: "#FECACA", background: "#FEF2F2" }}>
              {validation.valid
                ? <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                : <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />}
              <p className="text-[12px]" style={{ color: validation.valid ? "#047857" : "#B91C1C" }}>
                Schema validation {validation.valid ? "passed" : "failed"}
                {Array.isArray(validation.errors) && validation.errors.length > 0 && ` — ${validation.errors.length} issue(s)`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConditionOutput({ output }: { output: Record<string, unknown> | null }) {
  if (!output) return <EmptyState text="No condition evaluation was captured." />;
  const original = output.originalExpression ?? output.expression;
  const resolved = output.resolvedExpression;
  const result = output.result ?? output.value;
  return (
    <div className="space-y-3">
      {original != null && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Original expression</p>
          <pre className="rounded-lg border border-slate-200 p-2.5 text-[12px] font-mono" style={{ background: "#FAFBFC" }}>{String(original)}</pre>
        </div>
      )}
      {resolved != null && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Resolved expression</p>
          <pre className="rounded-lg border border-slate-200 p-2.5 text-[12px] font-mono" style={{ background: "#FAFBFC" }}>{String(resolved)}</pre>
        </div>
      )}
      {result != null && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Result</span>
          <span className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold",
            result === true || result === "true" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
          )}>
            {String(result)}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-2.5 py-2" style={{ background: "#FAFBFC" }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[12.5px] font-semibold text-slate-700 truncate">{value}</p>
    </div>
  );
}

interface VariableEntry {
  variable?: string;
  field?: string;
  resolvedValue?: unknown;
  sourceNode?: string;
  sourcePath?: string;
  fallback?: unknown;
  missing?: boolean;
}

function FlowArrow() {
  return (
    <svg width="40" height="16" viewBox="0 0 40 16" fill="none" className="shrink-0">
      <line x1="2" y1="8" x2="32" y2="8" stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="4 3">
        <animate attributeName="stroke-dashoffset" from="14" to="0" dur="0.7s" repeatCount="indefinite" />
      </line>
      <path d="M27 3 L34 8 L27 13" stroke="#94A3B8" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MappingFlowCard({
  title, subtitle, rows, direction,
}: {
  title: string;
  subtitle: string;
  rows: { left: string; right: string }[];
  direction: "in" | "out";
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
        <span className="text-[11.5px] font-bold text-slate-700">{title}</span>
        <span className="text-[10.5px] text-slate-400">· {subtitle}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2.5">
            <code className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[11.5px] font-mono"
              style={{ background: direction === "in" ? "#EFF6FF" : "#FAFBFC", color: direction === "in" ? "#1D4ED8" : "#475569" }}>
              {direction === "in" ? r.right : r.left}
            </code>
            <FlowArrow />
            <code className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[11.5px] font-mono"
              style={{ background: direction === "in" ? "#FAFBFC" : "#ECFDF5", color: direction === "in" ? "#475569" : "#047857" }}>
              {direction === "in" ? r.left : r.right}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

function VariableMappingTab({
  detail, inputMapping, outputMapping,
}: {
  detail: DebugNodeDetail;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
}) {
  const vars = (tryParse(detail.variableSources) ?? tryParse(detail.resolvedVariables)) as VariableEntry[] | null;
  const inRows  = inputMapping  ? Object.entries(inputMapping).map(([left, right]) => ({ left, right })) : [];
  const outRows = outputMapping ? Object.entries(outputMapping).map(([left, right]) => ({ left, right })) : [];
  const hasVars = Array.isArray(vars) && vars.length > 0;

  if (!hasVars && inRows.length === 0 && outRows.length === 0) {
    return <EmptyState text="This node does not reference any template variables or field mappings." />;
  }

  return (
    <div className="space-y-4">
      {inRows.length > 0 && (
        <MappingFlowCard
          title="Inputs into this node"
          subtitle="source field → node field"
          rows={inRows}
          direction="in"
        />
      )}
      {outRows.length > 0 && (
        <MappingFlowCard
          title="Outputs from this node"
          subtitle="node field → published variable"
          rows={outRows}
          direction="out"
        />
      )}

      {hasVars && (
        <div className="space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Template variables resolved</p>
          {vars!.map((v, i) => (
            <div key={i} className="rounded-xl border overflow-hidden" style={{ borderColor: v.missing ? "#FECACA" : "#E2E8F0" }}>
              <div className="flex items-center justify-between px-3 py-2" style={{ background: v.missing ? "#FEF2F2" : "#F8FAFC" }}>
                <code className="text-[12px] font-mono font-semibold" style={{ color: "#1D4ED8" }}>{v.variable ?? `{{${v.field}}}`}</code>
                {v.missing && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                    <AlertTriangle className="h-2.5 w-2.5" /> MISSING
                  </span>
                )}
              </div>
              <div className="px-3 py-2.5 space-y-1.5 text-[12px]">
                <Row label="Resolved value">
                  {v.resolvedValue == null
                    ? <span className="font-mono text-red-600">null / undefined</span>
                    : <span className="font-mono text-slate-700">{typeof v.resolvedValue === "string" ? `"${v.resolvedValue}"` : JSON.stringify(v.resolvedValue)}</span>}
                </Row>
                {v.sourceNode && <Row label="Source"><span className="text-slate-700">{v.sourceNode}</span></Row>}
                {v.sourcePath && <Row label="Path"><code className="font-mono text-slate-500">{v.sourcePath}</code></Row>}
                {v.fallback !== undefined && v.fallback !== null && (
                  <Row label="Fallback used"><span className="font-mono text-amber-700">{JSON.stringify(v.fallback)}</span></Row>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-24 shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function FailureReasonTab({ detail }: { detail: DebugNodeDetail }) {
  if (detail.status !== "failed") {
    return <EmptyState icon={Check} text="This node did not fail — nothing to explain here." />;
  }
  return (
    <div className="space-y-3">
      <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "#FECACA" }}>
        <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ background: "#FEF2F2", borderBottom: "1px solid #FECACA" }}>
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <p className="text-[12.5px] font-bold text-red-700">Why this node failed</p>
        </div>
        <div className="px-3.5 py-3 space-y-3">
          <p className="text-[13px] leading-relaxed text-slate-700">
            {detail.humanFailureReason ?? detail.errorMessage ?? "This node failed during execution."}
          </p>
          {detail.errorType && (
            <Row label="Error type"><code className="font-mono text-[11.5px] text-slate-600">{detail.errorType}</code></Row>
          )}
          {detail.errorMessage && detail.errorMessage !== detail.humanFailureReason && (
            <Row label="Raw error"><code className="font-mono text-[11px] text-slate-500 break-all">{detail.errorMessage}</code></Row>
          )}
        </div>
      </div>

      {detail.suggestedFix && (
        <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "#BFDBFE" }}>
          <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ background: "#EFF6FF", borderBottom: "1px solid #BFDBFE" }}>
            <Sparkles className="h-4 w-4 text-blue-600" />
            <p className="text-[12.5px] font-bold text-blue-700">Suggested fix</p>
          </div>
          <div className="px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-slate-700">{detail.suggestedFix}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RawJsonTab({ detail }: { detail: DebugNodeDetail }) {
  const full = useMemo(() => ({
    nodeId: detail.nodeId,
    nodeType: detail.nodeType,
    nodeName: detail.nodeName,
    attempt: detail.attempt,
    status: detail.status,
    inputTemplate: tryParse(detail.inputTemplate),
    resolvedInput: tryParse(detail.resolvedInput),
    resolvedVariables: tryParse(detail.resolvedVariables),
    variableSources: tryParse(detail.variableSources),
    output: tryParse(detail.output),
    parsedOutput: tryParse(detail.parsedOutput),
    schemaValidation: tryParse(detail.schemaValidation),
    error: { type: detail.errorType, message: detail.errorMessage, humanFailureReason: detail.humanFailureReason, suggestedFix: detail.suggestedFix },
    model: { provider: detail.modelProvider, name: detail.modelName, tokensInput: detail.tokensInput, tokensOutput: detail.tokensOutput, costEstimate: detail.costEstimate },
    timing: { startedAt: detail.startedAt, finishedAt: detail.finishedAt, durationMs: detail.durationMs },
  }), [detail]);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-400">Full debug snapshot for engineers — secrets are redacted server-side.</p>
      <SearchableJson value={full} />
    </div>
  );
}
