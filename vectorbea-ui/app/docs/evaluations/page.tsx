export const metadata = {
  title: "Evaluations - VectorBea Docs",
};

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  HelpCircle,
  Play,
  Scale,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

// ── Evaluation flow diagram ───────────────────────────────────────────────────

function EvalFlowDiagram() {
  const steps = [
    { icon: ClipboardList, label: "Baseline dataset",   detail: "Set of real traces (inputs + expected outputs)", color: "text-blue-500",   bg: "bg-blue-500/10",   border: "border-blue-500/30"   },
    { icon: Play,          label: "Replay",             detail: "Each trace input is sent to the candidate version", color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/30" },
    { icon: Scale,         label: "Score checks",       detail: "Each output is scored against configured checks",   color: "text-amber-500",  bg: "bg-amber-500/10",  border: "border-amber-500/30"  },
    { icon: CheckCircle2,  label: "Verdict",            detail: "Pass, block, needs review, or inconclusive",        color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        {steps.map((step, i) => (
          <div key={step.label} className="flex flex-1 flex-col items-center gap-2 text-center">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${step.border} ${step.bg}`}>
              <step.icon size={18} className={step.color} />
            </div>
            <p className="text-[12px] font-semibold text-foreground">{step.label}</p>
            <p className="text-[11px] leading-snug text-muted-foreground">{step.detail}</p>
            {i < steps.length - 1 && (
              <div className="mt-2 text-[10px] text-muted-foreground">↓ feeds</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Verdict badges ────────────────────────────────────────────────────────────

function VerdictCard({
  icon: Icon,
  label,
  color,
  bg,
  border,
  description,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  color: string;
  bg: string;
  border: string;
  description: string;
}) {
  return (
    <div className={`rounded-xl border ${border} ${bg} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={color} />
        <span className={`text-[12px] font-semibold ${color}`}>{label}</span>
      </div>
      <p className="text-[12px] leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

// ── Scoring visual ────────────────────────────────────────────────────────────

function ScoringDiagram() {
  const checks = [
    { name: "Contains expected phrase",  weight: 30, score: 100, critical: false },
    { name: "Semantic similarity ≥ 0.85", weight: 40, score: 90,  critical: false },
    { name: "No hallucinated names",      weight: 20, score: 75,  critical: true  },
    { name: "Response length ≤ 200 words",weight: 10, score: 100, critical: false },
  ];
  const weighted = checks.reduce((sum, c) => sum + (c.score * c.weight) / 100, 0);

  return (
    <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
      <p className="mb-4 text-[13px] font-semibold text-foreground">Example check scoring</p>
      <div className="space-y-3">
        {checks.map((c) => (
          <div key={c.name} className="flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[12px] text-foreground">{c.name}</span>
                {c.critical && (
                  <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-600">
                    critical
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-full bg-muted/50 h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${c.score >= 80 ? "bg-emerald-500" : c.score >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${c.score}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground">{c.score}%</span>
              </div>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">w:{c.weight}%</span>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-border/60 pt-4 flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">Weighted composite score</span>
        <span className="text-base font-bold text-emerald-500">{weighted.toFixed(1)} / 100</span>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EvaluationsPage() {
  return (
    <DocsPage
      eyebrow="Evaluations"
      title="Replay, score, and decide before you ship"
      lede="Evaluation runs let you test a candidate prompt version against a set of real production traces before any live traffic reaches it. A run produces a scored verdict — pass, block, needs review, or inconclusive — that gates the rollout decision."
    >
      <DocsSection
        id="what-is-an-evaluation"
        title="What is an evaluation run?"
        description="An evaluation run is a structured experiment: take a baseline dataset of real traces, replay each one against the candidate prompt version, score the outputs, and produce a verdict."
      >
        <EvalFlowDiagram />
        <DocsCallout title="How replay executes">
          Evaluation runs use your real production inputs — the same messages your
          users actually sent. This means scores reflect real-world diversity, not
          synthetic test cases. Enterprise gateway replay executes live through the
          configured customer gateway. Direct-provider replay is only live when a
          secure provider executor is explicitly configured; otherwise VectorBea
          marks it as simulated and uses captured output rather than storing or
          replaying with raw customer provider API keys.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="scoring"
        title="Checks, weights, and critical failures"
        description="Each evaluation run has a set of checks. Checks are scored individually and combined into a weighted composite score."
      >
        <ScoringDiagram />
        <DocsTable
          headers={["Check type", "What it tests", "When to use"]}
          rows={[
            ["Exact match",       "Output contains an exact string",             "Verifying required phrases, labels, or codes are present"],
            ["Semantic match",    "Output is semantically similar to reference", "Comparing meaning when wording may vary"],
            ["Regex match",       "Output matches a regular expression",         "Structured output validation (JSON keys, phone numbers, etc.)"],
            ["Length constraint", "Output is within a word/character range",     "Enforcing response length SLOs"],
            ["Custom",            "User-defined scoring function",               "Domain-specific logic not covered by built-in checks"],
          ]}
        />
        <DocsCallout title="Critical checks block the run">
          Any check marked <strong>critical</strong> that scores below its threshold
          immediately sets the run verdict to <strong>blocked</strong>, regardless of
          the composite score. Use critical checks for must-have safety or compliance
          requirements — e.g. &ldquo;response must not contain PII&rdquo;.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="verdicts"
        title="Evaluation outcomes"
        description="Every evaluation run produces one of four verdicts."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <VerdictCard
            icon={CheckCircle2}
            label="Ready"
            color="text-emerald-600"
            bg="bg-emerald-500/5"
            border="border-emerald-500/25"
            description="All checks passed above threshold. No critical failures. The version is eligible for promotion and rollout."
          />
          <VerdictCard
            icon={AlertTriangle}
            label="Needs review"
            color="text-amber-600"
            bg="bg-amber-500/5"
            border="border-amber-500/25"
            description="Scores are borderline or a human reviewer flag was raised. A reviewer must approve before the version can be promoted."
          />
          <VerdictCard
            icon={XCircle}
            label="Blocked"
            color="text-red-600"
            bg="bg-red-500/5"
            border="border-red-500/25"
            description="One or more critical checks failed, or the composite score fell below the configured block threshold. Promotion is prevented until the issue is resolved."
          />
          <VerdictCard
            icon={HelpCircle}
            label="Inconclusive"
            color="text-muted-foreground"
            bg="bg-muted/30"
            border="border-border/70"
            description="The run did not produce enough data to score reliably — e.g. fewer than the minimum required traces, or too many LLM errors during replay."
          />
        </div>
      </DocsSection>

      <DocsSection
        id="human-review"
        title="Human review workflow"
        description="For high-stakes prompts, require a human to approve before promotion even if automated checks pass."
      >
        <DocsCallout title="When to enable human review">
          Human review is recommended for prompts that generate customer-facing
          content, handle financial or medical information, or where automated
          checks cannot fully capture quality (e.g. tone, creativity, brand voice).
        </DocsCallout>
        <DocsCardGrid>
          <DocsCard
            title="Reviewer receives notification"
            description="When an evaluation run completes and a review is required, assigned reviewers are notified via the alert channel configured for that workspace."
          />
          <DocsCard
            title="Reviewer inspects outputs"
            description="The review panel shows side-by-side diffs of the active vs candidate outputs for each trace in the dataset. Individual traces can be flagged."
          />
          <DocsCard
            title="Approve or reject"
            description="Approving transitions the version to 'ready for rollout'. Rejecting sets it back to 'needs work', surfacing reviewer comments to the prompt author."
          />
          <DocsCard
            title="Audit trail"
            description="All review decisions are logged with the reviewer identity and timestamp. Audit events are surfaced in the workspace audit log."
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="how-to-use"
        title="How to run an evaluation"
      >
        <div className="space-y-3">
          {[
            { n: "1", title: "Select traces", body: "In the Traces view, filter to the prompt you want to evaluate. Select a set of recent, representative traces. Aim for at least 20–50 traces to get a statistically meaningful score." },
            { n: "2", title: "Create a baseline dataset", body: "With traces selected, click 'Save as dataset'. Give it a descriptive name (e.g. 'support-agent-july-prod'). The dataset captures the input + expected output at the time of creation." },
            { n: "3", title: "Choose the candidate version", body: "In the Evaluations view, create a new run. Select your baseline dataset and the prompt version you want to test. Configure checks and weights." },
            { n: "4", title: "Run the evaluation", body: "Click 'Run'. The system replays each trace input against the candidate version, scoring outputs in real time. Depending on dataset size, runs typically complete in 30 seconds to a few minutes." },
            { n: "5", title: "Review results", body: "Inspect the per-trace score breakdown, the composite score, and any check failures. Critical failures will be highlighted in red." },
            { n: "6", title: "Decide: promote or fix", body: "If the verdict is 'ready', proceed to rollout. If 'blocked', review the specific failing traces to understand what changed and revise the prompt version." },
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
        title="How evaluations connect to other features"
      >
        <DocsCardGrid>
          <DocsCard
            title="Baseline Datasets →"
            description="Evaluations require a baseline dataset as their input. Learn how to create and manage datasets."
          >
            <Link href={"/docs/baseline-datasets" as any} className="text-xs font-medium text-primary hover:underline">
              Baseline Datasets docs →
            </Link>
          </DocsCard>
          <DocsCard
            title="Golden Traces →"
            description="Golden traces can be included in any baseline dataset. Including them ensures your most important cases are always tested."
          >
            <Link href={"/docs/golden-traces" as any} className="text-xs font-medium text-primary hover:underline">
              Golden Traces docs →
            </Link>
          </DocsCard>
          <DocsCard
            title="Rollout →"
            description="A 'ready' evaluation verdict is the gate before rollout. Blocked versions cannot be promoted."
          >
            <Link href={"/docs/rollout" as any} className="text-xs font-medium text-primary hover:underline">
              Rollout docs →
            </Link>
          </DocsCard>
          <DocsCard
            title="Regression →"
            description="Regression schedules re-run evaluations automatically on a schedule. They use the same baseline datasets and check configuration."
          >
            <Link href={"/docs/regression" as any} className="text-xs font-medium text-primary hover:underline">
              Regression docs →
            </Link>
          </DocsCard>
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
