export const metadata = {
  title: "Metrics & Observability - VectorBea Docs",
};

import {
  Activity,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Clock,
  DollarSign,
  Info,
  Layers,
  TrendingUp,
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

// ── Metrics dashboard mockup ──────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/80 p-4">
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon size={14} className="text-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xl font-semibold text-foreground">{value}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function MetricsDashboardMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/20 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-foreground">Prompt metrics — last 24 h</p>
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Live
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard icon={Activity}    label="Requests"        value="14,302"  sub="+4.2% vs yesterday"  color="bg-blue-500/15" />
        <MetricCard icon={CheckCircle2} label="Success rate"   value="99.1%"   sub="128 errors total"    color="bg-emerald-500/15" />
        <MetricCard icon={Clock}       label="Avg latency"     value="241 ms"  sub="p95: 610 ms"         color="bg-amber-500/15" />
        <MetricCard icon={Zap}         label="Cache hit rate"  value="63.4%"   sub="9,069 cache hits"    color="bg-violet-500/15" />
        <MetricCard icon={TrendingUp}  label="Eval score"      value="0.87"    sub="↑ 0.03 this week"   color="bg-teal-500/15" />
        <MetricCard icon={DollarSign}  label="Est. cost"       value="$3.12"   sub="~$0.00022 / req"    color="bg-orange-500/15" />
      </div>
    </div>
  );
}

// ── Latency breakdown ─────────────────────────────────────────────────────────

function LatencyBreakdown() {
  const bars = [
    { label: "p50", pct: 32, value: "184 ms", color: "bg-emerald-500" },
    { label: "p75", pct: 52, value: "298 ms", color: "bg-amber-500" },
    { label: "p90", pct: 74, value: "430 ms", color: "bg-orange-500" },
    { label: "p95", pct: 88, value: "610 ms", color: "bg-red-500" },
  ];
  return (
    <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
      <p className="mb-4 text-[13px] font-semibold text-foreground">Latency distribution</p>
      <div className="space-y-3">
        {bars.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="w-7 shrink-0 text-right text-[11px] font-medium text-muted-foreground">{b.label}</span>
            <div className="flex-1 rounded-full bg-muted/50">
              <div
                className={`h-2 rounded-full ${b.color}`}
                style={{ width: `${b.pct}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-[11px] text-foreground">{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MetricsPage() {
  return (
    <DocsPage
      eyebrow="Metrics & Observability"
      title="What is tracked and how to use it"
      lede="VectorBea automatically aggregates metrics from every runtime trace. No instrumentation code is required beyond the SDK — latency, errors, token counts, cache hits, and cost are captured for every prompt invocation."
    >
      <DocsSection
        id="overview"
        title="What is measured"
        description="Metrics are derived entirely from runtime traces captured by the sidecar and audit events emitted by the SDK. No sampling — every call contributes."
      >
        <MetricsDashboardMockup />
        <DocsTable
          headers={["Metric", "Source", "Notes"]}
          rows={[
            ["Request count",       "Sidecar runtime trace",   "Incremented on every prompt fetch, regardless of LLM outcome"],
            ["Success / error rate","Sidecar runtime trace",   "HTTP 2xx = success; 4xx/5xx = error. LLM-level failures are also counted"],
            ["Latency (avg, p95)",  "Sidecar runtime trace",   "Time from SDK call to response received. Includes network + LLM time"],
            ["Cache hit rate",      "SDK audit event",         "Reported via t.set_cache_status('hit'). Defaults to 'miss' if not set"],
            ["Evaluation score",    "Evaluation run results",  "Rolling average of recent evaluation run scores for the active version"],
            ["Token count",         "SDK audit event",         "Sum of input + output tokens. Requires SDK trace() with record()"],
            ["Estimated cost",      "SDK audit event",         "Derived from token counts × per-model pricing. May be zero if not reported"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="partial-observability"
        title="Partial observability"
        description="Not all metrics are always available — this is expected and by design."
      >
        <DocsCallout title="When token and cost data is missing">
          Token counts and cost estimates are only available when your application
          uses the SDK <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">trace()</code> context
          manager and calls <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">t.record(response)</code> after
          receiving the LLM response. If you fetch a prompt but do not emit an audit
          event, the trace will show latency and success/error but no token or cost data.
          The metrics dashboard displays &ldquo;—&rdquo; for unavailable fields rather than zero.
        </DocsCallout>
        <DocsTable
          headers={["Deployment type", "Latency", "Tokens / cost", "Cache hits"]}
          rows={[
            ["SDK with trace() + record()", "✓", "✓", "✓ if set_cache_status called"],
            ["SDK without trace()",         "✓", "—", "—"],
            ["Direct sidecar HTTP call",    "✓", "—", "—"],
            ["Enterprise gateway",          "✓", "✓ (gateway-reported)", "✓"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="latency"
        title="Understanding latency"
        description="Latency in VectorBea measures end-to-end time from prompt fetch to LLM response receipt, as reported by the SDK."
      >
        <LatencyBreakdown />
        <DocsCallout title="Why p95 matters more than average">
          Average latency hides tail behaviour. A prompt with avg 200 ms but p95
          800 ms will cause visible timeouts for 5% of users. Use p95 as your
          primary SLO anchor. The Traces view lets you filter and sort by latency to
          find the slowest individual calls.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="how-to-use"
        title="How to use the Metrics tab"
      >
        <div className="space-y-4">
          {[
            { n: "1", title: "Open the Metrics tab", body: "Navigate to the Metrics section in the main sidebar. You will see aggregate metrics across all prompts in your workspace for the selected time window (default: last 24 hours)." },
            { n: "2", title: "Filter by prompt or environment", body: "Use the prompt selector to focus on a single prompt. Use the environment filter to compare prod vs. staging metrics. The charts and table update immediately." },
            { n: "3", title: "Identify slow or failing prompts", body: "Sort the prompt table by error rate (descending) to find prompts with elevated failure rates. Sort by p95 latency to find the slowest prompts. Hover chart points for exact values." },
            { n: "4", title: "Click into traces for debugging", body: "Every metric row links to the Trace Explorer pre-filtered to that prompt. Drill into individual traces to see the exact input, output, and timing breakdown for any call." },
            { n: "5", title: "Monitor evaluation score trends", body: "The evaluation score chart shows how scores have changed across recent evaluation runs. A declining trend signals prompt quality regression even if runtime metrics look healthy." },
          ].map((step) => (
            <div key={step.n} className="flex gap-4 rounded-xl border border-border/70 bg-card/95 p-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-bold text-primary">
                {step.n}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection
        id="connections"
        title="How metrics connect to other features"
      >
        <DocsCardGrid>
          <DocsCard
            title="Traces → Metrics"
            description="Every sidecar call writes a trace. The metrics engine aggregates traces into time-bucketed summaries. There is no separate instrumentation step."
          />
          <DocsCard
            title="Metrics → Alerts"
            description="Alert rules watch metric thresholds (e.g. error rate > 5%, latency p95 > 1s). When a rule fires, an incident is created and notifications are sent."
          />
          <DocsCard
            title="Metrics → Rollout decisions"
            description="During a gradual rollout, the Metrics tab shows per-version breakdowns. A spike in errors or latency on the candidate version is a signal to pause the rollout."
          />
          <DocsCard
            title="Evaluation scores → Metrics"
            description="Evaluation run scores are surfaced as a metric trend, letting you correlate production quality changes with prompt version deployments."
          />
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
