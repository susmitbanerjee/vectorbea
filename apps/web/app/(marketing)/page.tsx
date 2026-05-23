import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  Shield,
  Timer,
  Zap,
  AlertTriangle,
  Activity,
  ScrollText,
  Bot,
  ShieldCheck,
  GitBranch,
  Play,
  Loader2,
  PauseCircle,
} from "lucide-react";
import { Logo } from "@/components/ui/Logo";

// ─── Shared styles (hardcoded — marketing page is theme-independent) ──────────

const S = {
  bg:        "#070A11",
  s1:        "#0D1424",
  s2:        "#111A2B",
  s3:        "#162033",
  border:    "rgba(148,163,184,0.10)",
  borderMd:  "rgba(148,163,184,0.18)",
  t1:        "#F8FAFC",
  t2:        "#CBD5E1",
  t3:        "#94A3B8",
  t4:        "#64748B",
  sky:       "#38BDF8",
  skyBg:     "rgba(56,189,248,0.09)",
  skyBorder: "rgba(56,189,248,0.18)",
} as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({
  status,
}: {
  status: "SUCCEEDED" | "RUNNING" | "WAITING" | "FAILED" | "QUEUED";
}) {
  const map = {
    SUCCEEDED: { label: "Succeeded",       bg: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.22)",  color: "#34D399" },
    RUNNING:   { label: "Running",         bg: "rgba(56,189,248,0.12)",  border: "rgba(56,189,248,0.22)",  color: "#38BDF8" },
    WAITING:   { label: "Awaiting approval", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.22)", color: "#FCD34D" },
    FAILED:    { label: "Failed",           bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.22)",   color: "#F87171" },
    QUEUED:    { label: "Queued",           bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.18)", color: "#94A3B8" },
  };
  const { label, bg, border, color } = map[status];
  const icons = {
    SUCCEEDED: <CheckCircle2 className="h-3 w-3" />,
    RUNNING:   <Loader2 className="h-3 w-3 animate-spin" />,
    WAITING:   <PauseCircle className="h-3 w-3" />,
    FAILED:    <AlertTriangle className="h-3 w-3" />,
    QUEUED:    <Clock className="h-3 w-3" />,
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: bg, border: `1px solid ${border}`, color }}
    >
      {icons[status]}
      {label}
    </span>
  );
}

// Dot–line–dot mini span bar for the hero mockup
function MiniSpan({
  color, startPct, widthPct, label, indent = 0,
}: {
  color: string; startPct: number; widthPct: number; label: string; indent?: number;
}) {
  return (
    <div className="flex items-center gap-0" style={{ height: 26 }}>
      <div
        className="shrink-0 truncate text-[10px]"
        style={{ width: 148, paddingLeft: 4 + indent * 14, color: S.t4, fontSize: 10 }}
      >
        {label}
      </div>
      <div className="relative flex-1" style={{ height: 26 }}>
        <div
          style={{
            position: "absolute",
            left:  `${startPct}%`,
            width: `${widthPct}%`,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            minWidth: 28,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}80` }} />
          <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg, ${color}70, ${color}bb)` }} />
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}99` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div style={{ background: S.bg, color: S.t2, minHeight: "100vh" }}>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 backdrop-blur-sm"
        style={{ borderBottom: `1px solid ${S.border}`, background: "rgba(7,10,17,0.92)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: S.s2, border: `1px solid ${S.border}` }}
            >
              <Logo className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-semibold" style={{ color: S.t1 }}>Vectorbee</span>
          </Link>

          <nav className="hidden items-center gap-0.5 sm:flex">
            {[["Features", "#features"], ["How it works", "#how"], ["Examples", "#examples"]].map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="rounded-lg px-3 py-2 text-[13px] transition-colors hover:text-white"
                style={{ color: S.t3 }}
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/agent-runs/mock"
              className="rounded-lg px-3 py-2 text-[13px] transition-colors hover:text-white"
              style={{ color: S.t3 }}
            >
              Live demo
            </Link>
            <Link
              href="/agent-jobs"
              className="inline-flex h-8 items-center rounded-lg px-4 text-[13px] font-semibold transition-colors hover:opacity-90"
              style={{ background: S.sky, color: "#070A11" }}
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section
          className="relative overflow-hidden"
          style={{ background: `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(56,189,248,0.08) 0%, transparent 70%), ${S.bg}` }}
        >
          {/* Subtle grid */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(${S.border} 1px, transparent 1px), linear-gradient(90deg, ${S.border} 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
              maskImage: "radial-gradient(ellipse 70% 50% at 50% 0%, black 0%, transparent 100%)",
            }}
          />

          <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-20 lg:px-8 lg:pb-24 lg:pt-24">
            <div className="grid items-center gap-12 lg:grid-cols-[1fr_480px]">
              {/* Left: copy */}
              <div className="space-y-7">
                {/* Badge */}
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest"
                  style={{ background: S.skyBg, border: `1px solid ${S.skyBorder}`, color: S.sky }}
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: S.sky }} />
                  Developer preview
                </span>

                <h1
                  className="text-balance text-4xl font-bold leading-[1.12] tracking-tight md:text-5xl lg:text-[3.5rem]"
                  style={{ color: S.t1 }}
                >
                  Production control plane
                  <br />
                  <span style={{ color: S.sky }}>for AI agent jobs</span>
                </h1>

                <p className="max-w-xl text-[17px] leading-[1.7]" style={{ color: S.t3 }}>
                  Schedule, monitor, approve, and audit long-running AI automations
                  that touch real business systems — without building the infrastructure yourself.
                </p>

                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    href="/agent-jobs"
                    className="inline-flex h-11 items-center gap-2 rounded-xl px-6 text-[14px] font-semibold transition-all hover:opacity-90 hover:shadow-lg"
                    style={{ background: S.sky, color: "#070A11", boxShadow: "0 0 24px rgba(56,189,248,0.2)" }}
                  >
                    Open dashboard
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/agent-runs/mock"
                    className="inline-flex h-11 items-center gap-2 rounded-xl px-6 text-[14px] font-medium transition-colors hover:text-white"
                    style={{ background: S.s2, border: `1px solid ${S.borderMd}`, color: S.t2 }}
                  >
                    <Play className="h-4 w-4" />
                    View demo run
                  </Link>
                </div>

                {/* Feature pills */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    "Cron + manual triggers",
                    "Approval gates",
                    "Token & cost budgets",
                    "Full event history",
                    "Retry policies",
                  ].map(f => (
                    <span
                      key={f}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]"
                      style={{ background: "rgba(148,163,184,0.06)", border: `1px solid ${S.border}`, color: S.t3 }}
                    >
                      <CheckCircle2 className="h-3 w-3" style={{ color: "#10B981" }} />
                      {f}
                    </span>
                  ))}
                </div>
              </div>

              {/* Right: UI mockup */}
              <div
                className="rounded-2xl overflow-hidden shadow-2xl"
                style={{ background: S.s1, border: `1px solid ${S.borderMd}`, boxShadow: "0 0 0 1px rgba(56,189,248,0.06), 0 40px 80px rgba(0,0,0,0.5)" }}
              >
                {/* Mockup chrome */}
                <div
                  className="flex items-center gap-2 px-4 py-3"
                  style={{ borderBottom: `1px solid ${S.border}`, background: S.s2 }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#EF4444" }} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F59E0B" }} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#10B981" }} />
                  <span className="ml-2 text-[11px]" style={{ color: S.t4 }}>Customer Renewal Intelligence · Run #47</span>
                  <span className="ml-auto"><StatusPill status="SUCCEEDED" /></span>
                </div>

                {/* Stats row */}
                <div
                  className="flex gap-0 divide-x px-0"
                  style={{ borderBottom: `1px solid ${S.border}`, divideColor: S.border } as React.CSSProperties}
                >
                  {[
                    { label: "Agents", value: "5" },
                    { label: "Events", value: "40" },
                    { label: "Duration", value: "2m 38s" },
                    { label: "Cost", value: "$0.061" },
                  ].map(stat => (
                    <div
                      key={stat.label}
                      className="flex-1 px-4 py-2.5 text-center"
                      style={{ borderRight: `1px solid ${S.border}` }}
                    >
                      <div className="text-[13px] font-bold" style={{ color: S.t1 }}>{stat.value}</div>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: S.t4 }}>{stat.label}</div>
                    </div>
                  ))}
                </div>

                {/* Mini horizontal timeline */}
                <div className="px-4 py-4">
                  <div className="mb-2 text-[9px] font-semibold uppercase tracking-widest" style={{ color: S.t4 }}>
                    Execution trace
                  </div>
                  {/* Time ruler */}
                  <div className="mb-3 flex items-center" style={{ paddingLeft: 152 }}>
                    {["0", "30s", "1m", "1m30s", "2m38s"].map((t, i) => (
                      <div key={t} className="flex-1 text-center" style={{ fontSize: 8, color: S.t4 }}>
                        {t}
                      </div>
                    ))}
                  </div>
                  <MiniSpan label="Run"                    color="#38BDF8" startPct={0}   widthPct={100} indent={0} />
                  <MiniSpan label="Orchestrator Agent"     color="#A78BFA" startPct={1}   widthPct={10}  indent={1} />
                  <MiniSpan label="Customer Data Agent"    color="#A78BFA" startPct={12}  widthPct={28}  indent={1} />
                  <MiniSpan label="  Tool: crm-api"        color="#22D3EE" startPct={13}  widthPct={5}   indent={2} />
                  <MiniSpan label="  LLM: gpt-4.1-mini"   color="#C084FC" startPct={20}  widthPct={18}  indent={2} />
                  <MiniSpan label="Risk Assessment Agent"  color="#A78BFA" startPct={41}  widthPct={22}  indent={1} />
                  <MiniSpan label="Compliance Scoring"     color="#A78BFA" startPct={64}  widthPct={17}  indent={1} />
                  <MiniSpan label="CRM Update Agent"       color="#A78BFA" startPct={82}  widthPct={12}  indent={1} />
                </div>

                {/* Approval badge */}
                <div
                  className="mx-4 mb-4 rounded-lg px-3 py-2.5"
                  style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.16)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold" style={{ color: "#FCD34D" }}>
                      ◉ Approval gate passed
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ background: "rgba(16,185,129,0.12)", color: "#34D399" }}
                    >
                      Approved
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px]" style={{ color: S.t4 }}>
                    CRM update · 12 records · decided by Demo Owner
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Problem ──────────────────────────────────────────────────────── */}
        <section style={{ borderTop: `1px solid ${S.border}`, background: S.s1 }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-12 max-w-2xl">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: S.sky }}>
                The problem
              </p>
              <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl" style={{ color: S.t1 }}>
                AI agent jobs are not cron jobs
              </h2>
              <p className="text-[16px] leading-7" style={{ color: S.t3 }}>
                A bash script that fails can be safely re-run. An AI agent that fails
                may have already written to your CRM, sent an email, or spent $8 on
                tokens — and a naive retry will do it again.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: "⚡", head: "They call LLMs",         body: "Token usage and cost are unpredictable run-to-run with no built-in cap." },
                { icon: "🔧", head: "They use tools",          body: "File writes, API calls, DB mutations — side effects can't be undone." },
                { icon: "👤", head: "They wait for humans",    body: "Some steps need approval before the agent can proceed." },
                { icon: "💸", head: "They can exceed budgets", body: "A single runaway run can cost hundreds of dollars before you notice." },
                { icon: "↺",  head: "They partially fail",     body: "Step 3 of 7 fails — what do you retry and from where?" },
                { icon: "📋", head: "They need audit trails",  body: "Who ran what, when, why, and what exactly did it decide?" },
              ].map(({ icon, head, body }) => (
                <div
                  key={head}
                  className="rounded-xl p-5"
                  style={{ background: S.s2, border: `1px solid ${S.border}` }}
                >
                  <div className="mb-3 text-xl">{icon}</div>
                  <p className="mb-1.5 text-[13px] font-semibold" style={{ color: S.t1 }}>{head}</p>
                  <p className="text-[12px] leading-5" style={{ color: S.t3 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <section id="features" style={{ borderTop: `1px solid ${S.border}` }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-12 max-w-2xl">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: S.sky }}>
                What Vectorbee does
              </p>
              <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl" style={{ color: S.t1 }}>
                Everything the operational layer needs
              </h2>
              <p className="text-[16px] leading-7" style={{ color: S.t3 }}>
                Vectorbee sits between your scheduler and your agents. It handles
                triggering, monitoring, budgeting, approving, and retrying — so you
                don't have to build it.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Clock,
                  title: "Scheduled & manual triggers",
                  body: "Cron expressions, timezones, one-off manual runs, and webhook-driven starts. Define once, run reliably.",
                  color: "#38BDF8",
                },
                {
                  icon: ShieldCheck,
                  title: "Human-in-the-loop approvals",
                  body: "Agent pauses mid-run and requests sign-off. Approvals route to the right person with full context.",
                  color: "#FCD34D",
                },
                {
                  icon: Timer,
                  title: "Token & cost budget caps",
                  body: "Set per-run and daily limits. Runs exceeding budget are blocked before they cost you.",
                  color: "#A78BFA",
                },
                {
                  icon: RefreshCw,
                  title: "Safe retry policies",
                  body: "Per-job retry with configurable backoff. Idempotency keys prevent duplicate side effects on retry.",
                  color: "#10B981",
                },
                {
                  icon: ScrollText,
                  title: "Full event history",
                  body: "Every run: status, agents, steps, token usage, cost, duration, and the exact error trace if it failed.",
                  color: "#22D3EE",
                },
                {
                  icon: Activity,
                  title: "Worker fleet monitoring",
                  body: "Live worker health, queue depths, capacity utilisation, and last heartbeat for every worker.",
                  color: "#6EE7B7",
                },
              ].map(({ icon: Icon, title, body, color }) => (
                <div
                  key={title}
                  className="group rounded-xl p-5 transition-all hover:-translate-y-0.5"
                  style={{ background: S.s1, border: `1px solid ${S.border}` }}
                >
                  <span
                    className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ background: `${color}14`, border: `1px solid ${color}25` }}
                  >
                    <Icon className="h-5 w-5" style={{ color }} />
                  </span>
                  <h3 className="mb-2 text-[14px] font-semibold" style={{ color: S.t1 }}>{title}</h3>
                  <p className="text-[13px] leading-5" style={{ color: S.t3 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section id="how" style={{ borderTop: `1px solid ${S.border}`, background: S.s1 }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-14 max-w-2xl">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: S.sky }}>
                How it works
              </p>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl" style={{ color: S.t1 }}>
                Three steps to production-grade agent jobs
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  step: "01",
                  icon: Bot,
                  title: "Define your job",
                  body: "Give your job a name, attach an HTTP endpoint (your agent), set a cron schedule or manual trigger, and configure retry policy and budget caps.",
                  accent: "#38BDF8",
                },
                {
                  step: "02",
                  icon: Activity,
                  title: "Agent runs, reports back",
                  body: "Vectorbee triggers your endpoint, streams the event timeline, tracks token usage and cost in real time, and waits for approval if the agent requests it.",
                  accent: "#A78BFA",
                },
                {
                  step: "03",
                  icon: ShieldCheck,
                  title: "Review, approve, audit",
                  body: "Approve or reject pending actions, retry failed runs from any step, and inspect the complete immutable audit log of every decision.",
                  accent: "#10B981",
                },
              ].map(({ step, icon: Icon, title, body, accent }) => (
                <div key={step} className="relative">
                  <div
                    className="rounded-2xl p-6"
                    style={{ background: S.s2, border: `1px solid ${S.border}` }}
                  >
                    <div className="mb-5 flex items-center justify-between">
                      <span
                        className="flex h-10 w-10 items-center justify-center rounded-xl"
                        style={{ background: `${accent}14`, border: `1px solid ${accent}25` }}
                      >
                        <Icon className="h-5 w-5" style={{ color: accent }} />
                      </span>
                      <span
                        className="font-mono text-[32px] font-bold leading-none"
                        style={{ color: `${accent}20` }}
                      >
                        {step}
                      </span>
                    </div>
                    <h3 className="mb-2 text-[15px] font-semibold" style={{ color: S.t1 }}>{title}</h3>
                    <p className="text-[13px] leading-6" style={{ color: S.t3 }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Example jobs ─────────────────────────────────────────────────── */}
        <section id="examples" style={{ borderTop: `1px solid ${S.border}` }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-10 max-w-2xl">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: S.sky }}>
                Real-world examples
              </p>
              <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl" style={{ color: S.t1 }}>
                What teams run on Vectorbee
              </h2>
              <p className="text-[16px] leading-7" style={{ color: S.t3 }}>
                Any recurring AI task that calls real systems and needs to be reliable enough for production.
              </p>
            </div>

            <div
              className="overflow-hidden rounded-2xl"
              style={{ border: `1px solid ${S.borderMd}` }}
            >
              {/* Table header */}
              <div
                className="grid items-center gap-4 px-5 py-3 text-[10px] font-semibold uppercase tracking-widest"
                style={{
                  gridTemplateColumns: "1fr auto auto",
                  background: S.s2,
                  borderBottom: `1px solid ${S.border}`,
                  color: S.t4,
                }}
              >
                <span>Job</span>
                <span>Trigger</span>
                <span>Status</span>
              </div>

              {[
                {
                  name: "Daily Support Ticket Triage",
                  desc: "Reads open tickets, classifies by urgency, assigns to the right queue.",
                  trigger: "0 8 * * *",
                  status: "SUCCEEDED" as const,
                },
                {
                  name: "Weekly Account Health Summary",
                  desc: "Aggregates usage data, flags at-risk accounts, sends Slack digest.",
                  trigger: "0 9 * * 1",
                  status: "WAITING" as const,
                },
                {
                  name: "Failed Payment Recovery",
                  desc: "Drafts personalised recovery emails using billing history. Approval required before send.",
                  trigger: "manual",
                  status: "RUNNING" as const,
                },
                {
                  name: "CRM Enrichment with Approval Gate",
                  desc: "Analyses customer records and proposes CRM updates. Pauses for human review before writing.",
                  trigger: "manual",
                  status: "SUCCEEDED" as const,
                },
                {
                  name: "Document Processing Exception Review",
                  desc: "Identifies parsing failures in overnight batch, classifies exceptions, creates issues.",
                  trigger: "0 7 * * *",
                  status: "FAILED" as const,
                },
              ].map((job, i, arr) => (
                <div
                  key={job.name}
                  className="grid items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
                  style={{
                    gridTemplateColumns: "1fr auto auto",
                    borderBottom: i < arr.length - 1 ? `1px solid ${S.border}` : undefined,
                    background: S.s1,
                  }}
                >
                  <div className="min-w-0">
                    <p className="mb-0.5 text-[13px] font-semibold" style={{ color: S.t1 }}>{job.name}</p>
                    <p className="text-[12px]" style={{ color: S.t4 }}>{job.desc}</p>
                  </div>
                  <code
                    className="rounded px-2 py-0.5 text-[11px]"
                    style={{ background: S.s3, color: S.t3, border: `1px solid ${S.border}` }}
                  >
                    {job.trigger}
                  </code>
                  <StatusPill status={job.status} />
                </div>
              ))}
            </div>

            <div className="mt-6 text-center">
              <Link
                href="/agent-runs/mock"
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium transition-colors hover:text-white"
                style={{ background: S.s2, border: `1px solid ${S.borderMd}`, color: S.t2 }}
              >
                Explore a live demo run
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── Positioning ──────────────────────────────────────────────────── */}
        <section style={{ borderTop: `1px solid ${S.border}`, background: S.s1 }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-10 max-w-2xl">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: S.t4 }}>
                Scope
              </p>
              <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl" style={{ color: S.t1 }}>
                What Vectorbee is not
              </h2>
              <p className="text-[16px] leading-7" style={{ color: S.t3 }}>
                Understanding the boundaries is as important as understanding the capabilities.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  head: "Not an agent framework",
                  body: "Vectorbee doesn't build or run agents. You bring the agent — LangChain, CrewAI, AutoGen, or your own code. Vectorbee handles the scheduling layer around it.",
                },
                {
                  head: "Not a LangChain replacement",
                  body: "LangChain builds agents. Vectorbee schedules, monitors, and governs them in production. They are complementary.",
                },
                {
                  head: "Not a Temporal replacement",
                  body: "Temporal is a general workflow engine. Vectorbee is purpose-built for AI agent job orchestration — approval gates, LLM budgets, and agent-specific run semantics.",
                },
                {
                  head: "Not generic observability",
                  body: "Datadog and Grafana trace infrastructure. Vectorbee tracks agent run outcomes — jobs, runs, steps, budgets, approvals — not infrastructure spans.",
                },
                {
                  head: "Not prompt evaluation software",
                  body: "LangSmith and Braintrust evaluate prompt quality. Vectorbee controls when and how agents execute in production — safety, scheduling, and accountability.",
                },
                {
                  head: "Not a job queue",
                  body: "BullMQ and Celery are task queues. Vectorbee is an agent-aware control plane that understands LLM costs, approval gates, and multi-step agent runs.",
                },
              ].map(({ head, body }) => (
                <div
                  key={head}
                  className="rounded-xl p-5"
                  style={{ background: S.s2, border: `1px solid ${S.border}` }}
                >
                  <p className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold" style={{ color: S.t1 }}>
                    <span style={{ color: S.t4 }}>✕</span>
                    {head}
                  </p>
                  <p className="text-[12px] leading-5" style={{ color: S.t3 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <section style={{ borderTop: `1px solid ${S.border}` }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div
              className="relative overflow-hidden rounded-2xl px-8 py-14 text-center md:px-16"
              style={{
                background: `radial-gradient(ellipse 70% 60% at 50% 110%, rgba(56,189,248,0.12) 0%, transparent 70%), ${S.s1}`,
                border: `1px solid ${S.borderMd}`,
                boxShadow: "0 0 0 1px rgba(56,189,248,0.06)",
              }}
            >
              {/* Glow */}
              <div
                className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2"
                style={{ width: 400, height: 200, background: "radial-gradient(ellipse at center, rgba(56,189,248,0.08) 0%, transparent 70%)" }}
              />

              <div className="relative">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: S.sky }}>
                  Get started today
                </p>
                <h2 className="mb-4 text-balance text-3xl font-bold tracking-tight md:text-4xl" style={{ color: S.t1 }}>
                  Put your first agent job in production
                </h2>
                <p className="mx-auto mb-8 max-w-lg text-[16px] leading-7" style={{ color: S.t3 }}>
                  Open the dashboard, explore the mock runs, and see exactly how
                  Vectorbee handles scheduling, approvals, and retries end-to-end.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/agent-jobs"
                    className="inline-flex h-11 items-center gap-2 rounded-xl px-7 text-[14px] font-semibold transition-all hover:opacity-90"
                    style={{ background: S.sky, color: "#070A11", boxShadow: "0 0 28px rgba(56,189,248,0.25)" }}
                  >
                    Open dashboard
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/agent-runs/mock"
                    className="inline-flex h-11 items-center gap-2 rounded-xl px-7 text-[14px] font-medium transition-colors hover:text-white"
                    style={{ background: "transparent", border: `1px solid ${S.borderMd}`, color: S.t2 }}
                  >
                    <Play className="h-4 w-4" />
                    View demo run
                  </Link>
                </div>
                <p className="mt-5 text-[12px]" style={{ color: S.t4 }}>
                  No account needed in open mode · Three mock scenarios ready to explore
                </p>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: `1px solid ${S.border}`, background: S.s1 }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: S.s2, border: `1px solid ${S.border}` }}
            >
              <Logo className="h-3.5 w-3.5" />
            </span>
            <span className="text-[14px] font-semibold" style={{ color: S.t2 }}>Vectorbee</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: S.skyBg, border: `1px solid ${S.skyBorder}`, color: S.sky }}
            >
              Developer preview
            </span>
          </div>

          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]" style={{ color: S.t4 }}>
            {[
              ["Agent Jobs", "/agent-jobs"],
              ["Runs",       "/agent-runs"],
              ["Approvals",  "/approvals"],
              ["Workers",    "/workers"],
              ["Demo run",   "/agent-runs/mock"],
            ].map(([label, href]) => (
              <Link key={label} href={href as never} className="transition-colors hover:text-white">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>

    </div>
  );
}
