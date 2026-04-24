export const metadata = {
  title: "Blocked vs Full Rollout - VectorBea Docs",
};

import Link from "next/link";
import {
  CheckCircle2,
  Lock,
  Shield,
  TrendingUp,
  Unlock,
  UserCheck,
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

// ── Blocked vs ready split visual ─────────────────────────────────────────────

function BlockedVsReadyDiagram() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Blocked */}
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/15">
            <Lock size={14} className="text-red-600" />
          </div>
          <span className="text-[14px] font-semibold text-red-700 dark:text-red-400">Blocked</span>
        </div>
        <p className="mb-4 text-[12px] leading-5 text-muted-foreground">
          The version cannot advance to candidate or active status. Rollout is prevented.
        </p>
        <ul className="space-y-2">
          {[
            "Critical evaluation check failed",
            "Regression detected on golden traces",
            "Human reviewer rejected the version",
            "Composite score below block threshold",
            "LLM errors during evaluation replay",
          ].map((reason) => (
            <li key={reason} className="flex items-start gap-2">
              <XCircle size={11} className="mt-0.5 shrink-0 text-red-500" />
              <span className="text-[12px] text-muted-foreground">{reason}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Full rollout */}
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15">
            <Unlock size={14} className="text-emerald-600" />
          </div>
          <span className="text-[14px] font-semibold text-emerald-700 dark:text-emerald-400">Full rollout ready</span>
        </div>
        <p className="mb-4 text-[12px] leading-5 text-muted-foreground">
          The version has met all conditions and can receive 100% of live traffic.
        </p>
        <ul className="space-y-2">
          {[
            "All evaluation checks passed",
            "No critical check failures",
            "All golden traces passed",
            "Human reviewer approved (if required)",
            "Rollout metrics look healthy",
          ].map((cond) => (
            <li key={cond} className="flex items-start gap-2">
              <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-500" />
              <span className="text-[12px] text-muted-foreground">{cond}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BlockedRolloutPage() {
  return (
    <DocsPage
      eyebrow="Blocked vs Full Rollout"
      title="What prevents a rollout — and what enables one"
      lede="VectorBea does not auto-deploy blindly. Every rollout is gated by evaluation results, human review (if configured), and regression checks. This page explains exactly what blocks a version and what conditions must be met for a full rollout."
    >
      <DocsSection
        id="overview"
        title="The gates between draft and production"
        description="A prompt version must pass through several gates before it can receive 100% of live traffic. Each gate exists to catch a specific class of problem."
      >
        <BlockedVsReadyDiagram />
        <DocsCallout title="The system does not deploy automatically">
          Even when a version has a &apos;ready&apos; evaluation verdict, you must explicitly
          set its rollout percentage. The system will never automatically move a
          version to active. This is intentional — humans remain in the loop for
          every promotion decision.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="blocked-reasons"
        title="What causes a version to be blocked?"
        description="A version becomes blocked when any of the following conditions are true."
      >
        <DocsTable
          headers={["Condition", "How to resolve"]}
          rows={[
            [
              "Critical evaluation check failed",
              "Inspect the failing traces in the evaluation run. Identify what changed in the prompt that caused the failure. Edit the prompt version and re-evaluate.",
            ],
            [
              "Regression detected on golden traces",
              "Review the regression run results. The golden trace detail panel shows the before/after diff. Fix the issue or update the golden trace expectation if the new output is intentionally different.",
            ],
            [
              "Human reviewer rejected",
              "Check the reviewer comments in the evaluation panel. Address the concerns and request a new review. You may need to edit the prompt version.",
            ],
            [
              "Composite score below threshold",
              "Review which checks have low scores. The scoring breakdown shows which check types are failing. Adjust the prompt to improve those specific areas.",
            ],
            [
              "Too few traces in dataset (inconclusive)",
              "Add more traces to the baseline dataset and re-run the evaluation. A minimum of 10 traces is required; 20+ is recommended.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="full-rollout-conditions"
        title="Conditions for full rollout"
        description="To reach 100% traffic, all of the following must be true."
      >
        <DocsCardGrid>
          <DocsCard
            title="1. Evaluation verdict: ready"
            description="The most recent evaluation run for this version must have a 'ready' verdict. A 'needs review' verdict requires human approval first."
          />
          <DocsCard
            title="2. No critical failures"
            description="Zero critical evaluation checks can be in a failed state. Critical checks are configured per prompt and represent non-negotiable requirements."
          />
          <DocsCard
            title="3. Golden traces all pass"
            description="Every golden trace in the baseline dataset must have passed its checks. Golden trace failures always block rollout, regardless of composite score."
          />
          <DocsCard
            title="4. Human review (if required)"
            description="If the prompt has human review enabled, an authorised reviewer must have approved the evaluation run. No approval = no rollout."
          />
          <DocsCard
            title="5. Total candidate % ≤ 100"
            description="The combined rollout percentage across all candidate versions for a prompt cannot exceed 100%. This is enforced at the API level."
          />
          <DocsCard
            title="6. Rollout set to 100%"
            description="Even with all gates passed, you must explicitly set the rollout to 100%. The system transitions the version to 'Active' only when you confirm."
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="partial-rollout"
        title="Behaviour during partial rollout (candidate state)"
        description="While a version is in candidate state with traffic 0–99%, both the candidate and active versions are serving live requests."
      >
        <DocsCallout title="Both versions are live simultaneously">
          During a gradual rollout, the candidate version receives its assigned
          percentage of traffic while the active version handles the rest. Metrics
          for both versions appear side by side in the Metrics tab. Monitor both
          carefully — a spike in errors on the candidate version is a signal to
          reduce its percentage or revert.
        </DocsCallout>
        <DocsTable
          headers={["User sees candidate if...", "User sees active if..."]}
          rows={[
            [
              "SHA-256(seedKey + promptId) % 100 < candidate percentage",
              "SHA-256(seedKey + promptId) % 100 ≥ candidate percentage",
            ],
            [
              "The same seed key will always see the same version (deterministic)",
              "Users are consistently bucketed for the duration of the rollout",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="revert"
        title="How to revert a rollout"
        description="If you detect a problem during rollout, reverting is immediate."
      >
        <div className="space-y-3">
          {[
            { n: "1", title: "Open the Rollout panel", body: "Navigate to the prompt → Rollout tab." },
            { n: "2", title: "Set candidate percentage to 0%", body: "All traffic immediately returns to the active version. The candidate version remains in 'candidate' state — it is not deleted." },
            { n: "3", title: "Investigate the issue", body: "Use the Traces view to find calls that went to the candidate version and failed. Identify the root cause." },
            { n: "4", title: "Edit and re-evaluate", body: "Fix the prompt version, run a new evaluation, and restart the rollout if the new evaluation passes." },
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

      <DocsSection id="connections" title="Related features">
        <DocsCardGrid>
          <DocsCard title="Rollout & Promotion →" description="The full rollout workflow and version lifecycle.">
            <Link href={"/docs/rollout" as any} className="text-xs font-medium text-primary hover:underline">Rollout docs →</Link>
          </DocsCard>
          <DocsCard title="Evaluations →" description="How evaluation checks and verdicts work.">
            <Link href={"/docs/evaluations" as any} className="text-xs font-medium text-primary hover:underline">Evaluations docs →</Link>
          </DocsCard>
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
