export const metadata = {
  title: "Regression Checks - VectorBea Docs",
};

import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Code2,
  RefreshCw,
  Terminal,
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

// ── Regression schedule mockup ────────────────────────────────────────────────

function RegressionScheduleMockup() {
  const schedules = [
    { name: "nightly-support-agent",  dataset: "support-prod-aug",   last: "2h ago",   result: "passed",  nextRun: "In 22h" },
    { name: "weekly-finance-parser",  dataset: "finance-qa-july",    last: "3 days ago", result: "passed",  nextRun: "In 4d"  },
    { name: "pre-deploy-contract-qa", dataset: "contract-qa-prod",   last: "Just now", result: "blocked", nextRun: "Manual" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-3">
        <RefreshCw size={13} className="text-primary" />
        <span className="text-[12px] font-semibold text-foreground">Regression schedules</span>
      </div>
      <div className="divide-y divide-border/50">
        {schedules.map((s) => (
          <div key={s.name} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground">{s.name}</p>
              <p className="text-[11px] text-muted-foreground">Dataset: {s.dataset}</p>
            </div>
            <div className="shrink-0 text-right">
              <div className={`flex items-center justify-end gap-1 text-[11px] font-medium ${
                s.result === "passed" ? "text-emerald-600" : "text-red-600"
              }`}>
                {s.result === "passed" ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                {s.result}
              </div>
              <p className="text-[10px] text-muted-foreground">Last: {s.last}</p>
            </div>
            <div className="shrink-0 text-right w-20">
              <div className="flex items-center gap-1 justify-end text-[10px] text-muted-foreground">
                <Clock size={9} />
                {s.nextRun}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CI trigger diagram ────────────────────────────────────────────────────────

function CITriggerDiagram() {
  const steps = [
    { icon: Code2,       label: "PR merged / deploy triggered", detail: "CI pipeline starts" },
    { icon: Terminal,    label: "POST /regression-schedules/[id]/run", detail: "CI calls VectorBea API" },
    { icon: RefreshCw,   label: "Regression run executes",     detail: "Traces replayed, outputs scored" },
    { icon: CheckCircle2, label: "Result returned",            detail: "Pass → deploy; Block → halt pipeline" },
  ];

  return (
    <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
      <p className="mb-4 text-[13px] font-semibold text-foreground">CI/CD integration pattern</p>
      <div className="space-y-1">
        {steps.map((step, i) => (
          <div key={step.label}>
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                <step.icon size={13} className="text-muted-foreground" />
              </div>
              <div className="pt-0.5">
                <p className="text-[12px] font-medium text-foreground">{step.label}</p>
                <p className="text-[11px] text-muted-foreground">{step.detail}</p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="ml-3.5 my-1 h-4 w-px bg-border/60" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RegressionPage() {
  return (
    <DocsPage
      eyebrow="Regression Checks"
      title="Catch prompt regressions before they reach users"
      lede="Regression checks re-run a saved evaluation against a baseline dataset — either on a schedule or triggered from a CI/CD pipeline. They detect when a prompt version that previously passed starts failing, without manual intervention."
    >
      <DocsSection
        id="what-is-regression"
        title="What is a regression check?"
        description="A regression check is an evaluation run that is configured to execute automatically by the built-in scheduler, the Run now action, or the protected run endpoint."
      >
        <RegressionScheduleMockup />
        <DocsCallout title="Built-in scheduler">
          VectorBea checks enabled regression schedules and runs them when their
          next run time is due. The same execution path is used by Run now, so
          schedule history and failure logs are consistent whether a run is
          automatic or manual.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="trigger-api"
        title="How to trigger a regression run"
        description="Every regression schedule has a unique endpoint. Call it to start a run synchronously."
      >
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">API endpoint</p>
          <p className="font-mono text-[13px] text-foreground">
            POST /api/evaluations/regression-schedules/<span className="text-primary">[schedule-id]</span>/run
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Requires a workspace API key in the <code className="rounded bg-muted px-1 font-mono text-[11px]">Authorization: Bearer</code> header.
            Returns the run result synchronously or a run ID for async polling.
          </p>
        </div>
        <DocsTable
          headers={["Field", "Type", "Description"]}
          rows={[
            ["schedule-id", "string (path param)", "The ID of the regression schedule to run"],
            ["Authorization", "header: Bearer <key>", "Workspace API key with 'run regression' permission"],
            ["Response: status", "string", "'passed' | 'blocked' | 'inconclusive'"],
            ["Response: score",  "number", "Composite evaluation score (0–100)"],
            ["Response: runId",  "string", "Unique ID for this run (for audit/history)"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="ci-integration"
        title="CI/CD integration"
        description="The most common pattern is triggering a regression run as a step in your deployment pipeline."
      >
        <CITriggerDiagram />
        <DocsCallout title="Block deploys on regression">
          Configure your CI step to exit with a non-zero code if the regression
          result is &apos;blocked&apos;. Most CI systems (GitHub Actions, GitLab CI,
          CircleCI, Jenkins) will automatically halt the pipeline and mark the
          deployment as failed. This creates a hard gate: no regression → no deploy.
        </DocsCallout>
        <DocsCardGrid>
          <DocsCard
            title="GitHub Actions"
            description="Add a curl step after your build step that POSTs to the regression endpoint. Use VECTORBEA_API_KEY as a repository secret. Fail the job if the response status is 'blocked'."
          />
          <DocsCard
            title="GitLab CI"
            description="Add a 'regression-gate' job in your pipeline that calls the endpoint using a masked CI variable. Gate your deploy job on this job passing."
          />
          <DocsCard
            title="Cron trigger"
            description="Use your infrastructure's cron system (cron, Kubernetes CronJob, AWS EventBridge) to POST to the endpoint on a schedule. Useful for nightly checks on stable prompts."
          />
          <DocsCard
            title="Webhook / event-driven"
            description="Trigger regression runs in response to any webhook — e.g. when a new prompt version is published, or when a data pipeline completes."
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="how-to-use"
        title="How to set up a regression schedule"
      >
        <div className="space-y-3">
          {[
            { n: "1", title: "Create a baseline dataset", body: "Regression schedules require a baseline dataset as their input. If you don't have one, create it from recent production traces first." },
            { n: "2", title: "Open Regression in the sidebar", body: "Navigate to Evaluations → Regression. Click 'New regression schedule'." },
            { n: "3", title: "Configure the schedule", body: "Select the prompt to test, the baseline dataset, and the evaluation checks. Give it a descriptive name (e.g. 'nightly-support-agent')." },
            { n: "4", title: "Copy the schedule ID", body: "After saving, copy the schedule ID from the detail panel. This is the ID you will use in your API call." },
            { n: "5", title: "Add to CI or cron", body: "Add a step to your CI pipeline or cron job that POSTs to /api/evaluations/regression-schedules/[id]/run with your workspace API key." },
            { n: "6", title: "Review results", body: "After each run, results appear in the Regression history tab. Blocked runs generate an alert event if alerts are configured." },
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
        id="alert-evaluation"
        title="Alert evaluation on regression"
        description="Configure alert rules so that a blocked regression run immediately notifies your team."
      >
        <DocsTable
          headers={["Alert condition", "Recommended threshold", "Action"]}
          rows={[
            ["Regression status = blocked",  "Any single blocked run",     "Notify on-call + open incident"],
            ["Regression score drops > 10pt", "Score delta -10 vs baseline", "Notify prompt author"],
            ["Regression run failed (error)", "Any run error",               "Notify engineering team"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="connections"
        title="Related features"
      >
        <DocsCardGrid>
          <DocsCard
            title="Baseline Datasets →"
            description="Regression schedules consume baseline datasets as their input set."
          >
            <Link href={"/docs/baseline-datasets" as any} className="text-xs font-medium text-primary hover:underline">
              Baseline Datasets docs →
            </Link>
          </DocsCard>
          <DocsCard
            title="Scheduled Execution →"
            description="Learn how to call regression endpoints from external schedulers and CI systems."
          >
            <Link href={"/docs/scheduled-execution" as any} className="text-xs font-medium text-primary hover:underline">
              Scheduled Execution docs →
            </Link>
          </DocsCard>
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
