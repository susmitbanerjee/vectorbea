import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  PauseCircle,
  RefreshCw,
  Shield,
  ShieldOff,
  Timer,
  Zap,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Data ─────────────────────────────────────────────────────────────────────

const problems = [
  { label: "They call LLMs", detail: "token usage and cost are unpredictable run-to-run" },
  { label: "They use tools", detail: "file writes, API calls, DB mutations — side effects are real" },
  { label: "They wait for humans", detail: "some steps need approval before proceeding" },
  { label: "They can exceed budgets", detail: "a single runaway run can cost hundreds of dollars" },
  { label: "They can partially fail", detail: "step 3 of 7 fails — what do you retry and from where?" },
  { label: "They need audit trails", detail: "who ran what, when, why, and what did it decide?" },
];

const capabilities = [
  {
    icon: Clock,
    title: "Schedule recurring jobs",
    body: "Cron expressions, timezones, manual triggers, and webhook-driven starts. Define once, run reliably.",
  },
  {
    icon: Zap,
    title: "Trigger external agent endpoints",
    body: "POST to any HTTP endpoint — your LangChain app, CrewAI agent, custom script, or cloud function.",
  },
  {
    icon: Shield,
    title: "Pause for approval",
    body: "Agent requests human sign-off mid-run. Approvals route to the right person with full context.",
  },
  {
    icon: RefreshCw,
    title: "Retry failed jobs safely",
    body: "Per-job retry policy with backoff. Idempotency keys prevent duplicate side effects on retry.",
  },
  {
    icon: Timer,
    title: "Enforce token and cost budgets",
    body: "Set per-run and daily limits. Runs that exceed budget are blocked or flagged before they cost you.",
  },
  {
    icon: CheckCircle2,
    title: "Track every run and step",
    body: "Full run history: status, duration, step trace, token usage, cost, and the exact error if it failed.",
  },
  {
    icon: AlertCircle,
    title: "Preserve audit logs",
    body: "Every state change, approval, and retry is immutably logged with actor, timestamp, and reason.",
  },
];

const exampleJobs = [
  {
    name: "Daily Support Ticket Triage",
    description: "Reads open tickets, classifies by urgency with an LLM, assigns to the right queue.",
    trigger: "CRON",
    schedule: "0 8 * * *",
    status: "SUCCEEDED",
  },
  {
    name: "Weekly Account Health Summary",
    description: "Aggregates usage and billing data, flags at-risk accounts, sends Slack digest.",
    trigger: "CRON",
    schedule: "0 9 * * 1",
    status: "WAITING_FOR_APPROVAL",
  },
  {
    name: "Failed Payment Recovery",
    description: "Drafts a personalised recovery email using billing history. Queued for review before send.",
    trigger: "MANUAL",
    schedule: null,
    status: "RUNNING",
  },
  {
    name: "CRM Enrichment with Approval",
    description: "Analyses customer records and proposes CRM updates. Pauses for human review before writing.",
    trigger: "MANUAL",
    schedule: null,
    status: "SUCCEEDED",
  },
  {
    name: "Document Processing Exception Review",
    description: "Identifies parsing failures in overnight document batch, classifies exceptions, creates issues.",
    trigger: "CRON",
    schedule: "0 7 * * *",
    status: "FAILED",
  },
];

const notList = [
  {
    icon: ShieldOff,
    item: "Not an agent framework",
    detail:
      "Vectorbea doesn't build or run agents. You bring the agent — LangChain, CrewAI, AutoGen, or your own code. Vectorbea handles the scheduling layer around it.",
  },
  {
    icon: HelpCircle,
    item: "Not a LangChain replacement",
    detail:
      "LangChain builds agents. Vectorbea schedules, monitors, and governs them in production. They are complementary.",
  },
  {
    icon: HelpCircle,
    item: "Not a Temporal replacement",
    detail:
      "Temporal is a general workflow engine. Vectorbea is purpose-built for AI agent job orchestration — approval gates, LLM budgets, and agent-specific run semantics.",
  },
  {
    icon: HelpCircle,
    item: "Not generic observability",
    detail:
      "Datadog and Grafana trace your infrastructure. Vectorbea tracks agent run outcomes — jobs, runs, steps, budgets, approvals — not spans and metrics.",
  },
  {
    icon: HelpCircle,
    item: "Not prompt evaluation software",
    detail:
      "LangSmith and Braintrust evaluate prompt quality. Vectorbea controls when and how agents execute — scheduling, safety, and accountability in production.",
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    SUCCEEDED: {
      label: "Succeeded",
      className: "bg-[#EDF9F1] text-[#047857] border-[#DCEFE4]",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    FAILED: {
      label: "Failed",
      className: "bg-[#FFF3F3] text-[#B91C1C] border-[#F2D2D2]",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    RUNNING: {
      label: "Running",
      className: "bg-[#EEF4FF] text-[#2563EB] border-[#BFDBFE]",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    WAITING_FOR_APPROVAL: {
      label: "Awaiting approval",
      className: "bg-[#FFF5EC] text-[#B45309] border-[#F4DFD0]",
      icon: <PauseCircle className="h-3 w-3" />,
    },
    QUEUED: {
      label: "Queued",
      className: "bg-[#F3F4F6] text-[#374151] border-[#E5E7EB]",
      icon: <Clock className="h-3 w-3" />,
    },
  };

  const { label, className, icon } = map[status] ?? map.QUEUED;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function TriggerChip({ trigger, schedule }: { trigger: string; schedule: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[#E5E0D8] bg-[#FFFCF7] px-2 py-0.5 text-[11px] font-mono text-[#6B7280]">
      {trigger === "CRON" && schedule ? schedule : "manual"}
    </span>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F8F5EF] text-[#111827]">
      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-[#E5E0D8] bg-[#FBF8F1]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 py-3.5 md:px-6">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E0D8] bg-white">
              <Logo className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-[#111827]">Vectorbea</span>
          </Link>

          <nav className="hidden items-center gap-1 text-sm text-[#4B5563] sm:flex">
            <a href="#what-it-does" className="rounded-md px-3 py-1.5 transition-colors hover:bg-[#F1ECE3] hover:text-[#111827]">
              Features
            </a>
            <a href="#examples" className="rounded-md px-3 py-1.5 transition-colors hover:bg-[#F1ECE3] hover:text-[#111827]">
              Examples
            </a>
            <a href="#what-it-is-not" className="rounded-md px-3 py-1.5 transition-colors hover:bg-[#F1ECE3] hover:text-[#111827]">
              Scope
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-[#374151]")}
            >
              Dashboard
            </Link>
            <Link href="/agent-jobs/new" className={cn(buttonVariants({ size: "sm" }))}>
              Create job
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── MVP badge ────────────────────────────────────────────────────── */}
        <div className="border-b border-[#E5E0D8] bg-[#FFF5EC]">
          <div className="mx-auto flex w-full max-w-[1120px] items-center gap-3 px-4 py-2.5 md:px-6">
            <span className="rounded-full border border-[#F4DFD0] bg-[#FFF5EC] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B45309]">
              Developer preview
            </span>
            <p className="text-xs text-[#6B7280]">
              This is an MVP. Core scheduling, retries, approvals, and budgets are working. Some features are stubs.
              Feedback welcome.
            </p>
          </div>
        </div>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-16 md:px-6 lg:grid lg:grid-cols-[1fr_420px] lg:items-start lg:gap-12 xl:pt-20">
          {/* Left */}
          <div className="space-y-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
              Agent Scheduler — MVP
            </p>
            <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-5xl lg:text-[3.25rem]">
              Run AI agent jobs safely in production.
            </h1>
            <p className="max-w-xl text-base leading-7 text-[#374151] md:text-lg">
              Vectorbea Agent Scheduler helps teams schedule, approve, retry, and audit
              long-running AI automations that touch real business systems.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/agent-jobs/new"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                Create Agent Job
              </Link>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2 text-[13px] text-[#6B7280]">
              {[
                "Cron + manual triggers",
                "Approval gates",
                "Per-job budgets",
                "Full audit log",
              ].map((f) => (
                <span key={f} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#15803D]" />
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Right — live run preview */}
          <div className="mt-10 lg:mt-0">
            <div className="rounded-2xl border border-[#E5E0D8] bg-white p-5 shadow-[0_12px_30px_rgba(17,24,39,0.06)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6B7280]">
                  Recent runs
                </p>
                <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#15803D]" />
                  live
                </span>
              </div>
              <div className="space-y-2">
                {[
                  { name: "Support Ticket Triage", time: "08:00", status: "SUCCEEDED", tokens: "2,341", cost: "$0.009" },
                  { name: "CRM Enrichment", time: "09:12", status: "WAITING_FOR_APPROVAL", tokens: "—", cost: "—" },
                  { name: "Payment Recovery #4", time: "09:47", status: "RUNNING", tokens: "1,102", cost: "$0.004" },
                  { name: "Support Ticket Triage", time: "yesterday", status: "FAILED", tokens: "—", cost: "—" },
                ].map((run, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#F1ECE3] bg-[#FFFCF7] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#111827]">{run.name}</p>
                      <p className="text-[11px] text-[#9CA3AF]">{run.time}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <RunStatusBadge status={run.status} />
                      {run.tokens !== "—" && (
                        <p className="text-[10px] text-[#9CA3AF]">
                          {run.tokens} tokens · {run.cost}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-[#E5E0D8] bg-[#FFF5EC] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-medium text-[#B45309]">Approval pending</p>
                  <span className="rounded-full border border-[#F4DFD0] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#B45309]">
                    1 waiting
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#6B7280]">
                  CRM Enrichment — agent wants to update 12 customer records
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Problem ──────────────────────────────────────────────────────── */}
        <section className="border-y border-[#E5E0D8] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[1120px] px-4 py-16 md:px-6">
            <div className="max-w-2xl space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
                The problem
              </p>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                AI jobs are not normal cron jobs
              </h2>
              <p className="text-base leading-7 text-[#374151]">
                A bash script that fails can be re-run safely. An AI agent that fails may have already
                written to your CRM, sent an email, or spent $4 on tokens — and the next retry
                might do it again.
              </p>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {problems.map(({ label, detail }) => (
                <div
                  key={label}
                  className="rounded-xl border border-[#E5E0D8] bg-white p-4"
                >
                  <p className="text-sm font-semibold text-[#111827]">{label}</p>
                  <p className="mt-1.5 text-[13px] leading-5 text-[#6B7280]">{detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── What Vectorbea does ───────────────────────────────────────────── */}
        <section id="what-it-does" className="mx-auto w-full max-w-[1120px] px-4 py-16 md:px-6">
          <div className="max-w-2xl space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
              What Vectorbea does
            </p>
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              A control plane for AI agent jobs
            </h2>
            <p className="text-base leading-7 text-[#374151]">
              Vectorbea sits between your scheduler and your agents. It handles
              the operational layer — triggering, monitoring, budgeting, approving, retrying — so
              you don&apos;t have to build it yourself.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {capabilities.map(({ icon: Icon, title, body }) => (
              <article
                key={title}
                className="rounded-xl border border-[#E5E0D8] bg-white p-5"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#2563EB]">
                  <Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                </span>
                <h3 className="mt-3.5 text-sm font-semibold text-[#111827]">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-5 text-[#6B7280]">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Example jobs ─────────────────────────────────────────────────── */}
        <section
          id="examples"
          className="border-y border-[#E5E0D8] bg-[#FBF8F1]"
        >
          <div className="mx-auto w-full max-w-[1120px] px-4 py-16 md:px-6">
            <div className="max-w-2xl space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
                Example jobs
              </p>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                What teams run on Vectorbea
              </h2>
              <p className="text-base leading-7 text-[#374151]">
                Any recurring AI task that calls real systems and needs to be reliable
                enough for production.
              </p>
            </div>

            <div className="mt-8 space-y-3">
              {exampleJobs.map((job) => (
                <div
                  key={job.name}
                  className="flex flex-col gap-3 rounded-xl border border-[#E5E0D8] bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[#111827]">{job.name}</p>
                      <TriggerChip trigger={job.trigger} schedule={job.schedule} />
                    </div>
                    <p className="text-[13px] leading-5 text-[#6B7280]">{job.description}</p>
                  </div>
                  <div className="shrink-0">
                    <RunStatusBadge status={job.status} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 text-center">
              <Link
                href="/agent-jobs"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "gap-2",
                )}
              >
                View all jobs in dashboard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── What Vectorbea is not ─────────────────────────────────────────── */}
        <section id="what-it-is-not" className="mx-auto w-full max-w-[1120px] px-4 py-16 md:px-6">
          <div className="max-w-2xl space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280]">
              Scope
            </p>
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              What Vectorbea is not
            </h2>
            <p className="text-base leading-7 text-[#374151]">
              Understanding what a tool doesn&apos;t do is as important as what it does.
            </p>
          </div>

          <div className="mt-8 space-y-3">
            {notList.map(({ icon: Icon, item, detail }) => (
              <div
                key={item}
                className="flex gap-4 rounded-xl border border-[#E5E0D8] bg-white px-5 py-4"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E5E0D8] bg-[#F8F5EF] text-[#6B7280]">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#374151]">{item}</p>
                  <p className="mt-1 text-[13px] leading-5 text-[#6B7280]">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── MVP status ───────────────────────────────────────────────────── */}
        <section className="border-y border-[#E5E0D8] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[1120px] px-4 py-16 md:px-6">
            <div className="rounded-2xl border border-[#F4DFD0] bg-white p-7 md:p-10">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="max-w-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-[#F4DFD0] bg-[#FFF5EC] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B45309]">
                      MVP · Developer Preview
                    </span>
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight text-[#111827] md:text-2xl">
                    This is an early version. Core features work — some are stubs.
                  </h2>
                  <p className="text-[13px] leading-6 text-[#6B7280]">
                    Vectorbea is production-ready for the features listed below. Not everything is
                    built yet. If something is missing, check the backlog or open an issue.
                  </p>
                </div>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Job definitions (cron + manual)", done: true },
                  { label: "Run history with status, cost, duration", done: true },
                  { label: "Approval gates (pause + resume)", done: true },
                  { label: "Retry policy (max attempts, backoff)", done: true },
                  { label: "Budget caps (USD + token limits)", done: true },
                  { label: "Audit log for all actions", done: true },
                  { label: "Mock agent endpoints for local testing", done: true },
                  { label: "BullMQ worker (stub — not yet wired)", done: false },
                  { label: "Failure alerts (Slack + email)", done: false },
                  { label: "API key management", done: false },
                  { label: "Multi-tenant workspaces", done: false },
                  { label: "Billing and usage quotas", done: false },
                ].map(({ label, done }) => (
                  <div key={label} className="flex items-center gap-2.5 text-[13px]">
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#15803D]" />
                    ) : (
                      <Clock className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
                    )}
                    <span className={done ? "text-[#111827]" : "text-[#9CA3AF]"}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-16 md:px-6">
          <div className="rounded-2xl border border-[#D8CFC2] bg-white p-8 text-center shadow-[0_12px_30px_rgba(17,24,39,0.05)] md:p-12">
            <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
              Ready to put your first agent job in production?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#4B5563] md:text-base md:leading-7">
              Open the dashboard, load the seed data, and run a mock agent end-to-end
              in under five minutes.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/agent-jobs/new"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                Create Agent Job
              </Link>
            </div>
            <p className="mt-4 text-[12px] text-[#9CA3AF]">
              No Supabase account needed in open mode · Runs on{" "}
              <code className="rounded bg-[#F1ECE3] px-1 py-0.5 text-[#374151]">localhost:3000</code>
            </p>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#E5E0D8] bg-[#FBF8F1]">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E0D8] bg-white">
              <Logo className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold text-[#374151]">Vectorbea Agent Scheduler</span>
            <span className="rounded-full border border-[#F4DFD0] bg-[#FFF5EC] px-2 py-0.5 text-[10px] font-semibold text-[#B45309]">
              MVP
            </span>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[#6B7280]">
            <Link href="/dashboard" className="hover:text-[#111827]">Dashboard</Link>
            <Link href="/agent-jobs" className="hover:text-[#111827]">Agent Jobs</Link>
            <Link href="/approvals" className="hover:text-[#111827]">Approvals</Link>
            <Link href="/audit-logs" className="hover:text-[#111827]">Audit Logs</Link>
            <Link href={"/api/health" as never} className="hover:text-[#111827]">Health</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
