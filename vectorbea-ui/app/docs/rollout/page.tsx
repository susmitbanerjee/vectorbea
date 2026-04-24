export const metadata = {
  title: "Rollout & Promotion - VectorBea Docs",
};

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Layers,
  Lock,
  RotateCcw,
  Sliders,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

// ── Version lifecycle diagram ─────────────────────────────────────────────────

function VersionLifecycle() {
  const states = [
    { label: "Draft",      color: "text-muted-foreground", bg: "bg-muted/40",      border: "border-border/60",      desc: "Being edited. Not deployed."           },
    { label: "Candidate",  color: "text-blue-600",         bg: "bg-blue-500/10",   border: "border-blue-500/30",    desc: "Passed evaluation. In rollout (0–99%)." },
    { label: "Active",     color: "text-emerald-600",      bg: "bg-emerald-500/10", border: "border-emerald-500/30", desc: "Receiving 100% of traffic."             },
    { label: "Deprecated", color: "text-muted-foreground", bg: "bg-muted/30",      border: "border-border/60",      desc: "Replaced by a newer active version."   },
  ];

  return (
    <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
      <p className="mb-5 text-[13px] font-semibold text-foreground">Prompt version lifecycle</p>
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {states.map((state, i) => (
          <div key={state.label} className="flex items-center gap-2">
            <div className={`flex min-w-[120px] flex-col items-center gap-1.5 rounded-xl border ${state.border} ${state.bg} p-3`}>
              <span className={`text-[12px] font-semibold ${state.color}`}>{state.label}</span>
              <span className="text-center text-[10px] leading-snug text-muted-foreground">{state.desc}</span>
            </div>
            {i < states.length - 1 && (
              <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Versions move forward through the lifecycle. A version cannot move from Deprecated back to Active without going through evaluation again.
      </p>
    </div>
  );
}

// ── Traffic split visual ──────────────────────────────────────────────────────

function TrafficSplitVisual() {
  const stages = [
    { pct: 10,  label: "Initial canary",    sub: "Monitor errors and latency"   },
    { pct: 25,  label: "Widen",             sub: "Check evaluation score trend" },
    { pct: 50,  label: "Half traffic",      sub: "Validate at scale"            },
    { pct: 100, label: "Full rollout",      sub: "Deprecate previous version"   },
  ];

  return (
    <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
      <p className="mb-4 text-[13px] font-semibold text-foreground">Gradual traffic shift — candidate version</p>
      <div className="space-y-3">
        {stages.map((s) => (
          <div key={s.label} className="flex items-center gap-4">
            <div className="w-28 shrink-0">
              <p className="text-[12px] font-medium text-foreground">{s.label}</p>
              <p className="text-[10px] text-muted-foreground">{s.sub}</p>
            </div>
            <div className="flex-1">
              <div className="flex h-4 overflow-hidden rounded-full bg-muted/50">
                <div
                  className="flex h-full items-center justify-end rounded-full bg-primary/70 pr-1.5 transition-all"
                  style={{ width: `${s.pct}%` }}
                >
                  <span className="text-[9px] font-bold text-primary-foreground">{s.pct}%</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RolloutPage() {
  return (
    <DocsPage
      eyebrow="Rollout & Promotion"
      title="Safely promote prompt versions to production"
      lede="VectorBea's rollout system lets you shift traffic to a new prompt version gradually — from 1% to 100% — with deterministic traffic splitting, evaluation gates, and instant revert capability."
    >
      <DocsSection
        id="lifecycle"
        title="Prompt version lifecycle"
        description="Every prompt version moves through a defined set of states. Promotion is intentional — versions do not auto-advance."
      >
        <VersionLifecycle />
        <DocsTable
          headers={["State", "Traffic share", "Can rollout?", "How to get here"]}
          rows={[
            ["Draft",      "0%",      "No",  "Created or edited in the prompt editor"],
            ["Candidate",  "0–99%",   "Yes", "Evaluation run verdict is 'ready' and a user promotes it"],
            ["Active",     "100%",    "N/A", "Rollout percentage reaches 100%"],
            ["Deprecated", "0%",      "No",  "A new version becomes active; previous is auto-deprecated"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="traffic-splitting"
        title="Deterministic traffic splitting"
        description="When a candidate version has a rollout percentage > 0%, incoming requests are assigned to either the candidate or active version using a deterministic hash."
      >
        <DocsCallout title="How the split works">
          The SDK computes <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">SHA-256(seedKey + promptId) mod 100</code> to
          assign each request to a bucket 0–99. A candidate with 20% rollout claims
          buckets 0–19. The same seed key always resolves to the same version — so a
          given user always gets the same experience during the rollout window. Pass
          a user ID, session ID, or request ID as the seed key.
        </DocsCallout>
        <TrafficSplitVisual />
      </DocsSection>

      <DocsSection
        id="after-full-rollout"
        title="What happens after full rollout"
        description="A full rollout means the selected prompt version receives 100% of eligible runtime traffic for that prompt and environment."
      >
        <DocsCallout title="Full rollout is not the end of monitoring">
          Runtime traces continue recording the selected prompt version and rollout
          decision. Metrics and alert rules continue watching latency, errors,
          cache behavior, and evaluation score trends for the active version.
          Baseline datasets and regression schedules should remain in place so
          future candidate versions are still guarded before promotion.
        </DocsCallout>
        <DocsTable
          headers={["After 100%", "What continues", "Why it matters"]}
          rows={[
            ["Traffic", "All eligible requests resolve to the active version", "Users see one stable behavior"],
            ["Traces", "Selected version and rollout decision are stored", "Debugging remains explainable"],
            ["Metrics & alerts", "Dashboards keep monitoring the active version", "Production regressions are still visible"],
            ["Rollback", "Use the existing prompt version lifecycle if rollback is enabled", "Teams can revert safely when needed"],
            ["Future changes", "Evaluations and regressions guard the next candidate", "Full rollout does not bypass governance"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="how-to-rollout"
        title="How to promote and roll out a version"
      >
        <div className="space-y-3">
          {[
            { n: "1", title: "Run an evaluation", body: "Before promotion, run an evaluation against the candidate version. The version must have a 'ready' verdict. Blocked versions cannot be promoted." },
            { n: "2", title: "Open the Rollout panel", body: "In the prompt editor, navigate to the Rollout tab. You will see all versions and their current rollout status." },
            { n: "3", title: "Set status to Candidate", body: "Click the version you want to promote. Set its rollout status to 'Candidate'. Optionally set an initial traffic percentage (e.g. 10%)." },
            { n: "4", title: "Monitor metrics", body: "Watch the Metrics tab for this prompt. Compare error rate, latency, and evaluation score between the candidate and active versions. Give it 30–60 minutes at the initial percentage." },
            { n: "5", title: "Increase rollout percentage", body: "If metrics look healthy, increase the candidate percentage (25% → 50% → 75%). Each change takes effect immediately." },
            { n: "6", title: "Complete rollout", body: "Set the candidate to 100%. The system automatically transitions it to 'Active' status and marks the previous active version as 'Deprecated'." },
            { n: "7", title: "Revert if needed", body: "To revert at any point, set the candidate percentage back to 0% or set its status to 'Draft'. Traffic immediately returns to the active version." },
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
        id="rollout-rules"
        title="Rollout constraints"
        description="The system enforces rules to prevent misconfiguration."
      >
        <DocsTable
          headers={["Rule", "Enforced by"]}
          rows={[
            ["Total candidate traffic across all versions cannot exceed 100%", "API validation on rollout update"],
            ["A version cannot become Active unless it had a 'ready' evaluation run", "Promotion gate in the UI and API"],
            ["Only one version can be Active at a time", "DB constraint — setting a new active deprecates the previous"],
            ["Blocked versions cannot be set to Candidate", "UI and API guard"],
            ["Deprecated versions cannot be set to Candidate without a new evaluation", "Promotion gate"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="connections"
        title="Related features"
      >
        <DocsCardGrid>
          <DocsCard
            title="Blocked vs Full Rollout →"
            description="Understand exactly what causes a version to be blocked and what conditions enable full rollout."
          >
            <Link href={"/docs/blocked-rollout" as any} className="text-xs font-medium text-primary hover:underline">
              Blocked vs Full Rollout docs →
            </Link>
          </DocsCard>
          <DocsCard
            title="Evaluations →"
            description="Evaluation verdicts gate the rollout. A version must pass evaluation before it can become a candidate."
          >
            <Link href={"/docs/evaluations" as any} className="text-xs font-medium text-primary hover:underline">
              Evaluations docs →
            </Link>
          </DocsCard>
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
