export const metadata = {
  title: "Internal Tracking Model - VectorBea Docs",
};

import {
  Activity,
  AlertTriangle,
  BarChart2,
  Database,
  FlaskConical,
  GitBranch,
  Layers,
  RefreshCw,
  Star,
  Zap,
} from "lucide-react";
import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

// ── Data model visual ─────────────────────────────────────────────────────────

type EntityBoxProps = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  table: string;
  label: string;
  fields: string[];
  color: string;
  bg: string;
  border: string;
};

function EntityBox({ icon: Icon, table, label, fields, color, bg, border }: EntityBoxProps) {
  return (
    <div className={`rounded-xl border ${border} ${bg} p-3`}>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={12} className={color} />
        <span className={`text-[11px] font-semibold ${color}`}>{label}</span>
      </div>
      <p className="mb-1.5 font-mono text-[9px] text-muted-foreground">{table}</p>
      <ul className="space-y-0.5">
        {fields.map((f) => (
          <li key={f} className="font-mono text-[10px] text-foreground/80">{f}</li>
        ))}
      </ul>
    </div>
  );
}

function DataModelDiagram() {
  const entities: EntityBoxProps[] = [
    {
      icon: Zap,
      table: "audit_logs",
      label: "Runtime traces",
      color: "text-blue-500",
      bg: "bg-blue-500/5",
      border: "border-blue-500/20",
      fields: ["id", "prompt_version_id", "proxy_latency_ms", "llm_latency_ms", "token_count", "metadata"],
    },
    {
      icon: BarChart2,
      table: "(aggregated)",
      label: "Metrics",
      color: "text-violet-500",
      bg: "bg-violet-500/5",
      border: "border-violet-500/20",
      fields: ["request_count", "error_rate", "avg_latency", "p95_latency", "cache_hit_rate"],
    },
    {
      icon: Database,
      table: "baseline_datasets",
      label: "Datasets",
      color: "text-teal-500",
      bg: "bg-teal-500/5",
      border: "border-teal-500/20",
      fields: ["id", "prompt_id", "name", "trace_ids[]", "created_at"],
    },
    {
      icon: Star,
      table: "golden_traces",
      label: "Golden traces",
      color: "text-amber-500",
      bg: "bg-amber-500/5",
      border: "border-amber-500/20",
      fields: ["id", "trace_id (→ audit_logs)", "prompt_id", "annotated_by", "created_at"],
    },
    {
      icon: FlaskConical,
      table: "evaluation_runs",
      label: "Evaluations",
      color: "text-emerald-500",
      bg: "bg-emerald-500/5",
      border: "border-emerald-500/20",
      fields: ["id", "dataset_id", "prompt_version_id", "status", "score", "verdict"],
    },
    {
      icon: RefreshCw,
      table: "regression_schedules",
      label: "Regression",
      color: "text-orange-500",
      bg: "bg-orange-500/5",
      border: "border-orange-500/20",
      fields: ["id", "prompt_id", "dataset_id", "last_run_at", "last_status"],
    },
    {
      icon: GitBranch,
      table: "prompt_versions",
      label: "Rollout state",
      color: "text-pink-500",
      bg: "bg-pink-500/5",
      border: "border-pink-500/20",
      fields: ["id", "rollout_status", "rollout_percentage", "is_published"],
    },
    {
      icon: AlertTriangle,
      table: "alert_rules",
      label: "Alerts",
      color: "text-red-500",
      bg: "bg-red-500/5",
      border: "border-red-500/20",
      fields: ["id", "prompt_id", "metric", "threshold", "condition", "channel"],
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {entities.map((e) => (
        <EntityBox key={e.table} {...e} />
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TrackingModelPage() {
  return (
    <DocsPage
      eyebrow="Internal Tracking Model"
      title="How VectorBea stores and connects your data"
      lede="Understanding the internal data model helps you make sense of what the API returns, how metrics are derived, and what is stored when you mark a trace as golden or run an evaluation."
    >
      <DocsSection
        id="data-entities"
        title="Data entities"
        description="Each VectorBea feature maps to one or more database entities. These are the tables that back the UI."
      >
        <DataModelDiagram />
      </DocsSection>

      <DocsSection
        id="runtime-vs-audit"
        title="Runtime trace vs audit event"
        description="Two types of data are captured per prompt invocation — they serve different purposes."
      >
        <DocsCallout title="Stored together, originated separately">
          The runtime trace is captured by the sidecar at the moment the prompt is
          fetched. The audit event is emitted by the SDK after the LLM response is
          received. Both are stored in <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">audit_logs</code> and
          surfaced as a single trace record in the UI, but they carry different
          fields.
        </DocsCallout>
        <DocsTable
          headers={["Field", "Runtime trace", "Audit event"]}
          rows={[
            ["Prompt version served",  "✓",  "✓ (confirmed)"],
            ["Proxy latency",          "✓",  "—"],
            ["LLM latency",            "—",  "✓"],
            ["Token counts",           "—",  "✓ (via SDK record())"],
            ["Cost estimate",          "—",  "✓ (via SDK record())"],
            ["Model / provider",       "—",  "✓ (via SDK record())"],
            ["Input text",             "—",  "✓ (via trace() input_text)"],
            ["Output text",            "—",  "✓ (via SDK record())"],
            ["Cache status",           "—",  "✓ (via set_cache_status())"],
            ["Guardrail result",       "—",  "✓ (via set_guardrail())"],
            ["RAG context",            "—",  "✓ (via set_rag())"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="metrics-derivation"
        title="How metrics are derived"
        description="Metrics are not stored — they are computed from audit_logs on query."
      >
        <DocsTable
          headers={["Metric", "Derived from", "Aggregation"]}
          rows={[
            ["Request count",    "audit_logs rows",              "COUNT(*)"],
            ["Error rate",       "audit_logs.metadata.error",    "COUNT(error) / COUNT(*) * 100"],
            ["Avg latency",      "audit_logs.llm_latency_ms",    "AVG(llm_latency_ms)"],
            ["p95 latency",      "audit_logs.llm_latency_ms",    "PERCENTILE_CONT(0.95)"],
            ["Cache hit rate",   "audit_logs.metadata.cache",    "COUNT(hit) / COUNT(*) * 100"],
            ["Token count",      "audit_logs.token_count",       "SUM(token_count)"],
            ["Est. cost",        "audit_logs.metadata.model.cost","SUM(total_cost)"],
            ["Eval score trend", "evaluation_runs.score",        "AVG over last N runs"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="observability-gaps"
        title="Partial observability — what can be missing"
        description="Not all fields are populated in every trace. This is expected and documented."
      >
        <DocsCardGrid>
          <DocsCard
            title="Token / cost missing"
            description="If the SDK trace() context manager is not used, or record() is not called, token_count and cost fields will be null. Metrics will show '—' rather than zero for these fields."
          />
          <DocsCard
            title="Model / provider missing"
            description="Model name and provider are extracted from the LLM response object by record(). If you pass a raw dict without these fields, they will be null."
          />
          <DocsCard
            title="LLM latency missing"
            description="LLM latency is measured inside the with trace() block. If the SDK trace() is not used, only proxy_latency_ms (sidecar-reported) is available."
          />
          <DocsCard
            title="Enterprise gateway vs direct provider"
            description="When routing through an enterprise LLM gateway (e.g. Azure APIM, AWS Bedrock), the gateway may populate token/cost fields automatically, even without SDK trace(). Check your gateway documentation."
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="golden-traces-model"
        title="How golden traces work internally"
        description="Golden traces are annotations stored in a separate table, not a modification of the original trace."
      >
        <DocsCallout title="Non-destructive annotations">
          The <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">golden_traces</code> table holds a foreign key
          to <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">audit_logs.id</code>. Marking a trace as golden
          does not modify the original audit log row. Unmarking it deletes the
          golden_traces row. The original trace is never changed.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="rollout-model"
        title="Rollout state in the database"
        description="Rollout status and percentage are stored as columns on the prompt_versions table."
      >
        <DocsTable
          headers={["Column", "Type", "Values"]}
          rows={[
            ["rollout_status",     "text",    "'draft' | 'candidate' | 'active' | 'deprecated'"],
            ["rollout_percentage", "integer", "0–100"],
            ["is_published",       "boolean", "true = visible to SDK; false = draft only"],
          ]}
        />
        <DocsCallout title="Migration-safe schema">
          The <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">rollout_status</code> and
          <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono"> rollout_percentage</code> columns
          were added as ALTER TABLE additions. Older schema versions that do not have
          these columns fall back gracefully to &apos;draft&apos; / 0% defaults in the
          application layer. No data migration is required for existing workspaces.
        </DocsCallout>
      </DocsSection>
    </DocsPage>
  );
}
