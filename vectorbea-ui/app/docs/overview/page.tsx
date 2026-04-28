export const metadata = {
  title: "Overview - VectorBea Docs",
};

import Link from "next/link";
import {
  ArrowRight,
  BarChart2,
  CheckCircle2,
  Database,
  FlaskConical,
  GitBranch,
  Layers,
  Play,
  RefreshCw,
  Shield,
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

// ── Visual flow diagram ───────────────────────────────────────────────────────

function PipelineFlow() {
  const stages = [
    { icon: Zap,          label: "Trace",    sub: "Runtime calls are captured as traces", color: "text-blue-500",   bg: "bg-blue-500/10",   border: "border-blue-500/30"   },
    { icon: Play,         label: "Replay",   sub: "Traces are replayed against new prompt versions", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/30" },
    { icon: RefreshCw,    label: "Compare",  sub: "Outputs are compared to baseline expectations", color: "text-amber-500",  bg: "bg-amber-500/10",  border: "border-amber-500/30"  },
    { icon: FlaskConical, label: "Evaluate", sub: "Checks and scores determine if the version is ready", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
    { icon: CheckCircle2, label: "Promote",  sub: "Passing versions are marked as candidates", color: "text-teal-500",   bg: "bg-teal-500/10",   border: "border-teal-500/30"   },
    { icon: GitBranch,    label: "Rollout",  sub: "Traffic is gradually shifted to the new version", color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/30" },
    { icon: BarChart2,    label: "Monitor",  sub: "Live metrics and alerts watch production behaviour", color: "text-pink-500",   bg: "bg-pink-500/10",   border: "border-pink-500/30"   },
  ];

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/95 p-6 shadow-sm">
      <div className="flex min-w-[700px] items-start justify-between gap-2">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex flex-1 flex-col items-center gap-2">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl border ${stage.border} ${stage.bg}`}>
              <stage.icon size={20} className={stage.color} />
            </div>
            <p className="text-[13px] font-semibold text-foreground">{stage.label}</p>
            <p className="text-center text-[11px] leading-tight text-muted-foreground">{stage.sub}</p>
            {i < stages.length - 1 && (
              <div className="absolute" style={{ display: "none" }} />
            )}
          </div>
        ))}
      </div>
      {/* Connector line */}
      <div className="mt-4 flex min-w-[700px] items-center justify-between px-6">
        {stages.map((_, i) => (
          <div key={i} className="flex flex-1 items-center">
            <div className="h-0.5 flex-1 bg-border/60" />
            {i < stages.length - 1 && (
              <ArrowRight size={12} className="shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  return (
    <DocsPage
      eyebrow="Platform Overview"
      title="How VectorBea works end-to-end"
      lede="VectorBea closes the loop between deploying an LLM prompt and knowing whether it's actually working in production — without requiring you to rewrite your application each time a prompt changes."
    >
      <DocsSection
        id="the-loop"
        title="The core loop"
        description="Every feature in VectorBea maps to a stage in this pipeline. Understanding the loop helps you know which tool to reach for and why."
      >
        <PipelineFlow />
        <DocsCallout title="Why a loop, not a pipeline?">
          Each deployment feeds back into the next. Traces from production become
          the dataset for the next evaluation. Metrics from rollout determine whether
          to continue or revert. The system is designed to improve continuously, not
          deploy once and forget.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="stages"
        title="Stage-by-stage breakdown"
        description="A summary of what happens at each stage and which docs section goes deeper."
      >
        <DocsTable
          headers={["Stage", "What happens", "Where to learn more"]}
          rows={[
            ["Trace",    "Every prompt call at runtime produces a trace: the rendered input, raw LLM output, latency, token counts, and any cost data.", "Metrics & Observability"],
            ["Replay",   "Evaluation runs re-send a set of saved traces (your baseline dataset) to a candidate prompt version to generate fresh outputs.", "Evaluations"],
            ["Compare",  "The new outputs are compared to golden expectations using configurable checks (exact match, semantic match, contains, regex, etc.).", "Golden Traces"],
            ["Evaluate", "Checks are scored and weighted. A version is blocked if any critical check fails, or if the aggregate score falls below threshold.", "Evaluations"],
            ["Promote",  "A human reviewer (or an automated gate) approves the candidate. The version transitions from candidate → active.", "Rollout & Promotion"],
            ["Rollout",  "Traffic is shifted gradually: 10% → 50% → 100%. The SDK performs deterministic traffic splitting using a seed key.", "Rollout & Promotion"],
            ["Monitor",  "Live metrics track latency, error rates, cache hits, and evaluation score trends. Alerts fire if thresholds are breached.", "Metrics & Observability"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="concepts"
        title="Core concepts"
        description="Six concepts underpin the entire platform. Each has its own documentation section."
      >
        <DocsCardGrid className="md:grid-cols-3">
          <DocsCard
            title="Traces"
            description="A record of every live prompt invocation — input, output, latency, tokens, and cost. The raw material for everything else."
          />
          <DocsCard
            title="Baseline Datasets"
            description="A named collection of real traces used as the input set for evaluation runs and regression schedules."
          />
          <DocsCard
            title="Golden Traces"
            description="Traces hand-picked as critical reference cases. They represent the most important behaviours you must never break."
          />
          <DocsCard
            title="Evaluation Runs"
            description="Replay a baseline dataset against a candidate prompt version, score each output, and produce a pass/block verdict."
          />
          <DocsCard
            title="Regression Schedules"
            description="Automated or CI-triggered jobs that re-run an evaluation on a schedule to catch drift before it reaches production."
          />
          <DocsCard
            title="Rollout"
            description="The controlled promotion of a prompt version from 0% to 100% of live traffic, with deterministic traffic splitting."
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="data-model"
        title="How data flows through the system"
        description="Understanding where data originates and how it is transformed helps you instrument your application correctly."
      >
        <DocsCallout title="Runtime vs audit">
          VectorBea distinguishes between <strong>runtime traces</strong> (captured
          by the sidecar at call time) and <strong>audit events</strong> (emitted by
          the SDK after an LLM response is received). Runtime traces give you
          latency and prompt resolution metadata. Audit events carry token counts,
          cost, and model details. Both are stored together and surfaced as a single
          trace record in the UI.
        </DocsCallout>
        <DocsTable
          headers={["Data type", "Origin", "Used by"]}
          rows={[
            ["Runtime trace",      "Sidecar — every prompt fetch",          "Metrics, Trace Explorer"],
            ["Audit event",        "SDK — after LLM response received",     "Token/cost metrics, Trace details"],
            ["Baseline dataset",   "User — manually created from traces",   "Evaluations, Regression schedules"],
            ["Golden trace",       "User — annotation on any trace",        "Evaluation checks, Regression"],
            ["Evaluation result",  "Evaluation run — automated scoring",    "Promotion gate, Rollout decision"],
            ["Rollout state",      "User or API — version lifecycle update", "Traffic splitting in SDK"],
            ["Alert event",        "Rules engine — threshold breach",        "Notifications, Incident response"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="next-steps"
        title="Where to go next"
      >
        <DocsCardGrid>
          <DocsCard
            title="Metrics & Observability →"
            description="Learn what is tracked automatically and how to interpret latency, error rate, and cost signals."
          >
            <Link href={"/docs/metrics" as any} className="text-xs font-medium text-primary hover:underline">
              Read the Metrics docs
            </Link>
          </DocsCard>
          <DocsCard
            title="Evaluations →"
            description="Understand how to configure evaluation runs, scoring checks, and promotion gates."
          >
            <Link href={"/docs/evaluations" as any} className="text-xs font-medium text-primary hover:underline">
              Read the Evaluations docs
            </Link>
          </DocsCard>
          <DocsCard
            title="Rollout →"
            description="Learn the prompt version lifecycle and how to safely promote a candidate to full production traffic."
          >
            <Link href={"/docs/rollout" as any} className="text-xs font-medium text-primary hover:underline">
              Read the Rollout docs
            </Link>
          </DocsCard>
          <DocsCard
            title="Regression →"
            description="Set up automated regression schedules so regressions are caught before your next deployment."
          >
            <Link href={"/docs/regression" as any} className="text-xs font-medium text-primary hover:underline">
              Read the Regression docs
            </Link>
          </DocsCard>
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
