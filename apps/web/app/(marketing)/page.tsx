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
  ChevronRight,
  Database,
  Lock,
} from "lucide-react";
import { BeeLogo } from "@/components/brand/bee-logo";

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:       "#05080F",
  s1:       "#080D18",
  s2:       "#0C1220",
  s3:       "#111827",
  border:   "rgba(148,163,184,0.08)",
  borderMd: "rgba(148,163,184,0.15)",
  t1:       "#F1F5F9",
  t2:       "#CBD5E1",
  t3:       "#94A3B8",
  t4:       "#475569",
  sky:      "#38BDF8",
  skyD:     "#0EA5E9",
  skyBg:    "rgba(56,189,248,0.08)",
  skyBdr:   "rgba(56,189,248,0.20)",
  emerald:  "#34D399",
  violet:   "#A78BFA",
  amber:    "#FCD34D",
} as const;

// ─── StatusPill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: "SUCCEEDED"|"RUNNING"|"WAITING"|"FAILED"|"QUEUED" }) {
  const map = {
    SUCCEEDED: { label: "Succeeded",         bg: "rgba(52,211,153,0.10)", border: "rgba(52,211,153,0.22)", color: "#34D399" },
    RUNNING:   { label: "Running",           bg: "rgba(56,189,248,0.10)", border: "rgba(56,189,248,0.22)", color: "#38BDF8" },
    WAITING:   { label: "Awaiting approval", bg: "rgba(252,211,77,0.10)", border: "rgba(252,211,77,0.22)", color: "#FCD34D" },
    FAILED:    { label: "Failed",            bg: "rgba(248,113,113,0.10)",border: "rgba(248,113,113,0.22)",color: "#F87171" },
    QUEUED:    { label: "Queued",            bg: "rgba(148,163,184,0.08)",border: "rgba(148,163,184,0.16)",color: "#94A3B8" },
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
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ background: bg, border: `1px solid ${border}`, color }}>
      {icons[status]}{label}
    </span>
  );
}

// ─── MiniSpan — horizontal trace bar ─────────────────────────────────────────

function MiniSpan({ color, startPct, widthPct, label, indent = 0 }: {
  color: string; startPct: number; widthPct: number; label: string; indent?: number;
}) {
  return (
    <div className="flex items-center" style={{ height: 24 }}>
      <div className="shrink-0 truncate text-[10px]" style={{ width: 150, paddingLeft: 4 + indent * 14, color: C.t4 }}>
        {label}
      </div>
      <div className="relative flex-1" style={{ height: 24 }}>
        <div style={{
          position: "absolute", left: `${startPct}%`, width: `${widthPct}%`,
          top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", minWidth: 24,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 4px ${color}80` }} />
          <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg,${color}60,${color}b0)` }} />
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}90` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div style={{ background: C.bg, color: C.t2, minHeight: "100vh" }}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 backdrop-blur-md"
        style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(5,8,15,0.88)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: C.s2, border: `1px solid ${C.borderMd}` }}>
              <BeeLogo className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-bold tracking-tight" style={{ color: C.t1 }}>Vectorbee</span>
          </Link>

          <nav className="hidden items-center gap-0.5 sm:flex">
            {(["Features","How it works","Examples","Pricing"] as const).map(label => (
              <a key={label} href={`#${label.toLowerCase().replace(" ","")}`}
                className="rounded-lg px-3 py-1.5 text-[13px] transition-colors hover:text-white"
                style={{ color: C.t3 }}>
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/signin"
              className="rounded-lg px-3 py-1.5 text-[13px] transition-colors hover:text-white"
              style={{ color: C.t3 }}>
              Sign in
            </Link>
            <Link href="/signup"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold transition-all hover:opacity-90"
              style={{ background: C.sky, color: "#05080F", boxShadow: "0 0 18px rgba(56,189,248,0.20)" }}>
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main>

        {/* ── Hero ────────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden"
          style={{ background: `radial-gradient(ellipse 80% 45% at 50% -5%, rgba(56,189,248,0.07) 0%, transparent 65%), ${C.bg}` }}>
          {/* Grid lines */}
          <div className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
              backgroundSize: "64px 64px",
              maskImage: "radial-gradient(ellipse 65% 45% at 50% 0%, black, transparent)",
            }}
          />

          <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-20 lg:px-8 lg:pb-28 lg:pt-28">
            <div className="grid items-start gap-14 lg:grid-cols-[1fr_500px]">

              {/* Left — copy */}
              <div className="space-y-8">
                {/* Badge */}
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest"
                    style={{ background: C.skyBg, border: `1px solid ${C.skyBdr}`, color: C.sky }}>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: C.sky }} />
                    Open beta
                  </span>
                  <a href="/runs" className="inline-flex items-center gap-1 text-[12px] transition-colors hover:text-white"
                    style={{ color: C.t4 }}>
                    View a live run <ChevronRight className="h-3 w-3" />
                  </a>
                </div>

                {/* Headline */}
                <div className="space-y-4">
                  <h1 className="text-balance text-[2.75rem] font-bold leading-[1.08] tracking-[-0.03em] md:text-[3.25rem] lg:text-[3.5rem]"
                    style={{ color: C.t1 }}>
                    AI agents that run
                    <br />
                    <span style={{
                      background: `linear-gradient(135deg, ${C.sky} 0%, ${C.violet} 100%)`,
                      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    }}>
                      reliably in production.
                    </span>
                  </h1>
                  <p className="max-w-[480px] text-[17px] leading-[1.75]" style={{ color: C.t3 }}>
                    Durable workflow orchestration for AI agent jobs — with approval gates,
                    retry policies, cost budgets, and a complete execution timeline.
                    Built for backend and AI engineering teams.
                  </p>
                </div>

                {/* CTAs */}
                <div className="flex flex-wrap gap-3">
                  <Link href="/signup"
                    className="inline-flex h-11 items-center gap-2 rounded-xl px-6 text-[14px] font-bold transition-all hover:opacity-90 hover:shadow-xl"
                    style={{ background: C.sky, color: "#05080F", boxShadow: "0 0 28px rgba(56,189,248,0.22)" }}>
                    Start free <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/runs"
                    className="inline-flex h-11 items-center gap-2 rounded-xl px-6 text-[14px] font-medium transition-colors hover:text-white"
                    style={{ background: C.s2, border: `1px solid ${C.borderMd}`, color: C.t2 }}>
                    <Play className="h-4 w-4" /> View demo run
                  </Link>
                </div>

                {/* Trust signals */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-6" style={{ borderColor: C.border }}>
                  {[
                    { icon: ShieldCheck, label: "Human approval gates" },
                    { icon: RefreshCw,   label: "Idempotent retries" },
                    { icon: Zap,         label: "Per-run cost budgets" },
                    { icon: ScrollText,  label: "Immutable audit trail" },
                  ].map(({ icon: Icon, label }) => (
                    <span key={label} className="flex items-center gap-1.5 text-[12px]" style={{ color: C.t4 }}>
                      <Icon className="h-3.5 w-3.5" style={{ color: C.t3 }} /> {label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Right — product mockup */}
              <div className="rounded-2xl overflow-hidden shadow-2xl"
                style={{
                  background: C.s1, border: `1px solid ${C.borderMd}`,
                  boxShadow: `0 0 0 1px ${C.skyBdr}, 0 40px 80px rgba(0,0,0,0.55)`,
                }}>
                {/* Chrome */}
                <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.border}`, background: C.s2 }}>
                  <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]/80" />
                  <span className="ml-3 text-[11px]" style={{ color: C.t4 }}>
                    Customer Renewal Intelligence · Run #47
                  </span>
                  <span className="ml-auto"><StatusPill status="SUCCEEDED" /></span>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4" style={{ borderBottom: `1px solid ${C.border}` }}>
                  {[
                    { label: "Agents",   value: "5",       color: C.violet },
                    { label: "Events",   value: "40",      color: C.sky },
                    { label: "Duration", value: "2m 38s",  color: C.t2 },
                    { label: "Cost",     value: "$0.061",  color: C.emerald },
                  ].map(stat => (
                    <div key={stat.label} className="px-3 py-3 text-center" style={{ borderRight: `1px solid ${C.border}` }}>
                      <div className="text-[14px] font-bold tabular-nums" style={{ color: stat.color }}>{stat.value}</div>
                      <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: C.t4 }}>{stat.label}</div>
                    </div>
                  ))}
                </div>

                {/* Trace */}
                <div className="px-4 pt-4 pb-3">
                  <div className="mb-2 text-[9px] font-semibold uppercase tracking-widest" style={{ color: C.t4 }}>Execution trace</div>
                  <div className="mb-3 flex" style={{ paddingLeft: 154 }}>
                    {["0","30s","1m","1m30s","2m38s"].map(t => (
                      <div key={t} className="flex-1 text-center" style={{ fontSize: 8, color: C.t4 }}>{t}</div>
                    ))}
                  </div>
                  <MiniSpan label="Run"                   color={C.sky}     startPct={0}  widthPct={100} indent={0} />
                  <MiniSpan label="Orchestrator Agent"    color={C.violet}  startPct={1}  widthPct={10}  indent={1} />
                  <MiniSpan label="Customer Data Agent"   color={C.violet}  startPct={12} widthPct={28}  indent={1} />
                  <MiniSpan label="  Tool: crm-api"       color="#22D3EE"   startPct={13} widthPct={5}   indent={2} />
                  <MiniSpan label="  LLM: gpt-4.1-mini"  color="#C084FC"   startPct={20} widthPct={18}  indent={2} />
                  <MiniSpan label="Risk Assessment Agent" color={C.violet}  startPct={41} widthPct={22}  indent={1} />
                  <MiniSpan label="Compliance Scoring"    color={C.violet}  startPct={64} widthPct={17}  indent={1} />
                  <MiniSpan label="CRM Update Agent"      color={C.violet}  startPct={82} widthPct={12}  indent={1} />
                </div>

                {/* Approval card */}
                <div className="mx-4 mb-4 rounded-xl px-3.5 py-3"
                  style={{ background: "rgba(252,211,77,0.05)", border: "1px solid rgba(252,211,77,0.18)" }}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: C.amber }}>
                      <ShieldCheck className="h-3.5 w-3.5" /> Approval gate passed
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: "rgba(52,211,153,0.12)", color: C.emerald }}>
                      Approved
                    </span>
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: C.t4 }}>
                    CRM update · 12 records · decided by Demo Owner
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Stat bar ────────────────────────────────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, background: C.s1 }}>
          <div className="mx-auto max-w-6xl px-5 lg:px-8">
            <div className="grid grid-cols-2 divide-x md:grid-cols-4" style={{ divideColor: C.border } as React.CSSProperties}>
              {[
                { value: "40+",   label: "Event types tracked per run" },
                { value: "100%",  label: "Idempotent retry on failure" },
                { value: "<1ms",  label: "Trigger-to-queue latency" },
                { value: "∞",     label: "Run history retained" },
              ].map(stat => (
                <div key={stat.label} className="py-5 px-6 text-center" style={{ borderRight: `1px solid ${C.border}` }}>
                  <div className="text-[22px] font-bold tabular-nums" style={{ color: C.t1 }}>{stat.value}</div>
                  <div className="mt-0.5 text-[11px]" style={{ color: C.t4 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Problem ─────────────────────────────────────────────────────────── */}
        <section style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-14 max-w-2xl">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.sky }}>
                The problem
              </p>
              <h2 className="mb-4 text-[2rem] font-bold tracking-tight md:text-[2.25rem]" style={{ color: C.t1 }}>
                AI agent jobs are not cron jobs.
              </h2>
              <p className="text-[16px] leading-7" style={{ color: C.t3 }}>
                A bash script that fails can be safely re-run. An AI agent that fails may have
                already written to your CRM, sent an email, or spent $8 on tokens — and a naive
                retry will do it all again.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: Zap,         head: "They call LLMs",         body: "Token usage and cost are unpredictable run-to-run with no built-in cap.", color: C.sky },
                { icon: Database,    head: "They use tools",          body: "File writes, API calls, DB mutations — side effects that can't be undone.", color: "#22D3EE" },
                { icon: ShieldCheck, head: "They wait for humans",    body: "Some steps require approval before the agent is allowed to proceed.", color: C.amber },
                { icon: AlertTriangle,head:"They can exceed budgets", body: "A single runaway run can cost hundreds of dollars before you notice.", color: "#F87171" },
                { icon: RefreshCw,   head: "They partially fail",     body: "Step 3 of 7 fails — what do you retry, and from which step?", color: C.violet },
                { icon: ScrollText,  head: "They need audit trails",  body: "Who ran what, when, why, and what exactly did the agent decide?", color: C.emerald },
              ].map(({ icon: Icon, head, body, color }) => (
                <div key={head} className="rounded-xl p-5 transition-all hover:-translate-y-px"
                  style={{ background: C.s1, border: `1px solid ${C.border}` }}>
                  <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: `${color}12`, border: `1px solid ${color}20` }}>
                    <Icon className="h-4 w-4" style={{ color }} />
                  </span>
                  <p className="mb-1.5 text-[13px] font-semibold" style={{ color: C.t1 }}>{head}</p>
                  <p className="text-[12px] leading-5" style={{ color: C.t3 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────────── */}
        <section id="features" style={{ borderTop: `1px solid ${C.border}`, background: C.s1 }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-14 max-w-2xl">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.sky }}>
                What Vectorbee does
              </p>
              <h2 className="mb-4 text-[2rem] font-bold tracking-tight md:text-[2.25rem]" style={{ color: C.t1 }}>
                Everything the operational layer needs.
              </h2>
              <p className="text-[16px] leading-7" style={{ color: C.t3 }}>
                Vectorbee sits between your scheduler and your agents — handling triggering,
                monitoring, budgeting, approving, and retrying so you don&apos;t have to build it.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: Clock,      title: "Cron & manual triggers",        body: "Timezone-aware cron, one-off runs, and webhook starts. Define once, run reliably.",             color: C.sky,     tag: "Scheduling" },
                { icon: ShieldCheck,title: "Human-in-the-loop approvals",  body: "Agent pauses mid-run and requests sign-off, routed to the right person with full context.",      color: C.amber,   tag: "Governance" },
                { icon: Timer,      title: "Token & cost budget caps",      body: "Per-run and daily limits. Runs that exceed budget are blocked before they cost you.",            color: C.violet,  tag: "Cost control" },
                { icon: RefreshCw,  title: "Safe retry policies",           body: "Per-job retry with exponential backoff. Idempotency keys prevent duplicate side-effects.",       color: C.emerald, tag: "Reliability" },
                { icon: ScrollText, title: "Full execution history",        body: "Every run: agents, steps, token usage, cost, duration, and the exact error trace on failure.",   color: "#22D3EE", tag: "Observability" },
                { icon: Activity,   title: "Worker fleet monitoring",       body: "Live worker health, queue depths, capacity utilisation, and heartbeat for every worker.",        color: "#6EE7B7", tag: "Infrastructure" },
              ].map(({ icon: Icon, title, body, color, tag }) => (
                <div key={title}
                  className="group relative rounded-xl p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg"
                  style={{ background: C.s2, border: `1px solid ${C.border}` }}>
                  {/* Left accent bar */}
                  <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ background: color }} />
                  <div className="mb-4 flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl"
                      style={{ background: `${color}12`, border: `1px solid ${color}22` }}>
                      <Icon className="h-4.5 w-4.5" style={{ color, width: 18, height: 18 }} />
                    </span>
                    <span className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: `${color}10`, color, border: `1px solid ${color}20` }}>
                      {tag}
                    </span>
                  </div>
                  <h3 className="mb-2 text-[14px] font-semibold" style={{ color: C.t1 }}>{title}</h3>
                  <p className="text-[13px] leading-5" style={{ color: C.t3 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────────── */}
        <section id="howitworks" style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-14 max-w-2xl">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.sky }}>
                How it works
              </p>
              <h2 className="text-[2rem] font-bold tracking-tight md:text-[2.25rem]" style={{ color: C.t1 }}>
                Three steps to production-grade agent jobs.
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {[
                { step: "01", icon: Bot,        title: "Define your workflow",
                  body:  "Name your workflow, connect your agent endpoint, set a cron schedule or manual trigger, and configure retry and budget caps.",
                  accent: C.sky },
                { step: "02", icon: Activity,    title: "Agent runs, Vectorbee tracks",
                  body:  "Vectorbee triggers your endpoint, streams the event timeline, tracks token usage and cost in real time, and waits for approval if requested.",
                  accent: C.violet },
                { step: "03", icon: ShieldCheck, title: "Inspect, approve, audit",
                  body:  "Approve or reject pending actions, retry failed runs from any step, and inspect the complete immutable audit log of every agent decision.",
                  accent: C.emerald },
              ].map(({ step, icon: Icon, title, body, accent }) => (
                <div key={step} className="relative rounded-2xl p-6"
                  style={{ background: C.s1, border: `1px solid ${C.border}` }}>
                  <div className="mb-5 flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{ background: `${accent}12`, border: `1px solid ${accent}22` }}>
                      <Icon className="h-5 w-5" style={{ color: accent }} />
                    </span>
                    <span className="font-mono text-[36px] font-black leading-none" style={{ color: `${accent}18` }}>
                      {step}
                    </span>
                  </div>
                  <h3 className="mb-2 text-[15px] font-semibold" style={{ color: C.t1 }}>{title}</h3>
                  <p className="text-[13px] leading-6" style={{ color: C.t3 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Live run examples ────────────────────────────────────────────────── */}
        <section id="examples" style={{ borderTop: `1px solid ${C.border}`, background: C.s1 }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-10 max-w-2xl">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.sky }}>
                Real-world examples
              </p>
              <h2 className="mb-4 text-[2rem] font-bold tracking-tight md:text-[2.25rem]" style={{ color: C.t1 }}>
                What teams run on Vectorbee.
              </h2>
              <p className="text-[16px] leading-7" style={{ color: C.t3 }}>
                Any recurring AI task that calls real systems and needs to be reliable enough for production.
              </p>
            </div>

            <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${C.borderMd}` }}>
              <div className="grid items-center gap-4 px-5 py-3 text-[10px] font-bold uppercase tracking-widest"
                style={{ gridTemplateColumns: "1fr auto auto", background: C.s2, borderBottom: `1px solid ${C.border}`, color: C.t4 }}>
                <span>Job</span><span>Trigger</span><span>Status</span>
              </div>
              {[
                { name: "Daily Support Ticket Triage",     desc: "Reads open tickets, classifies by urgency, assigns to the right queue.",                                   trigger: "0 8 * * *", status: "SUCCEEDED" as const },
                { name: "Weekly Account Health Summary",   desc: "Aggregates usage data, flags at-risk accounts, sends Slack digest.",                                        trigger: "0 9 * * 1", status: "WAITING"   as const },
                { name: "Failed Payment Recovery",         desc: "Drafts personalised recovery emails using billing history. Approval required before send.",                  trigger: "manual",    status: "RUNNING"   as const },
                { name: "CRM Enrichment with Approval",    desc: "Analyses customer records and proposes CRM updates. Pauses for human review before writing.",                trigger: "manual",    status: "SUCCEEDED" as const },
                { name: "Document Exception Review",       desc: "Identifies parsing failures in overnight batch, classifies exceptions, creates issues.",                      trigger: "0 7 * * *", status: "FAILED"    as const },
              ].map((job, i, arr) => (
                <div key={job.name}
                  className="grid items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
                  style={{ gridTemplateColumns: "1fr auto auto", borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : undefined, background: C.s1 }}>
                  <div className="min-w-0">
                    <p className="mb-0.5 text-[13px] font-semibold" style={{ color: C.t1 }}>{job.name}</p>
                    <p className="text-[12px]" style={{ color: C.t4 }}>{job.desc}</p>
                  </div>
                  <code className="rounded-md px-2 py-1 text-[11px] font-mono"
                    style={{ background: C.s3, color: C.t3, border: `1px solid ${C.border}` }}>
                    {job.trigger}
                  </code>
                  <StatusPill status={job.status} />
                </div>
              ))}
            </div>

            <div className="mt-6 text-center">
              <Link href="/runs"
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium transition-colors hover:text-white"
                style={{ background: C.s2, border: `1px solid ${C.borderMd}`, color: C.t2 }}>
                Explore a live demo run <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── Comparison — what Vectorbee is not ──────────────────────────────── */}
        <section style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="mb-12 max-w-2xl">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.t4 }}>
                Scope
              </p>
              <h2 className="mb-4 text-[2rem] font-bold tracking-tight md:text-[2.25rem]" style={{ color: C.t1 }}>
                What Vectorbee is not.
              </h2>
              <p className="text-[16px] leading-7" style={{ color: C.t3 }}>
                Understanding the boundaries matters as much as understanding the capabilities.
              </p>
            </div>

            {/* Comparison table */}
            <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${C.borderMd}` }}>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-0"
                style={{ background: C.s2, borderBottom: `1px solid ${C.border}` }}>
                <div className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: C.t4 }}>Capability</div>
                {["Temporal","n8n","LangSmith","Vectorbee"].map(tool => (
                  <div key={tool} className="px-4 py-3 text-center text-[11px] font-semibold"
                    style={{ color: tool === "Vectorbee" ? C.sky : C.t3, borderLeft: `1px solid ${C.border}` }}>
                    {tool}
                  </div>
                ))}
              </div>
              {[
                { cap: "Durable workflow execution",     vals: [true,  true,  false, true]  },
                { cap: "AI agent job semantics",         vals: [false, false, false, true]  },
                { cap: "Human approval gates",           vals: [false, true,  false, true]  },
                { cap: "Per-run LLM cost budgets",       vals: [false, false, true,  true]  },
                { cap: "Idempotent safe retry",          vals: [true,  false, false, true]  },
                { cap: "Step-level event history",       vals: [true,  false, true,  true]  },
                { cap: "No-code workflow builder",       vals: [false, true,  false, true]  },
                { cap: "Works with any agent framework", vals: [true,  true,  true,  true]  },
              ].map(({ cap, vals }, i, arr) => (
                <div key={cap} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center transition-colors hover:bg-white/[0.015]"
                  style={{ borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : undefined, background: C.s1 }}>
                  <div className="px-5 py-3.5 text-[13px]" style={{ color: C.t2 }}>{cap}</div>
                  {vals.map((v, vi) => (
                    <div key={vi} className="flex items-center justify-center px-4 py-3.5"
                      style={{ borderLeft: `1px solid ${C.border}` }}>
                      {v
                        ? <CheckCircle2 className="h-4 w-4" style={{ color: vi === 3 ? C.emerald : C.t3 }} />
                        : <span className="h-4 w-4 flex items-center justify-center text-[14px]" style={{ color: C.t4 }}>—</span>
                      }
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────────────────── */}
        <section style={{ borderTop: `1px solid ${C.border}`, background: C.s1 }}>
          <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
            <div className="relative overflow-hidden rounded-2xl px-8 py-16 text-center md:px-16"
              style={{
                background: `radial-gradient(ellipse 70% 60% at 50% 115%, rgba(56,189,248,0.14) 0%, transparent 70%), ${C.s2}`,
                border: `1px solid ${C.borderMd}`,
                boxShadow: `0 0 0 1px ${C.skyBdr}`,
              }}>
              {/* Bottom glow */}
              <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2"
                style={{ width: 480, height: 200, background: "radial-gradient(ellipse at center, rgba(56,189,248,0.10) 0%, transparent 70%)" }} />
              <div className="relative">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.sky }}>
                  Get started free
                </p>
                <h2 className="mb-4 text-balance text-[2rem] font-bold tracking-tight md:text-[2.25rem]" style={{ color: C.t1 }}>
                  Put your first AI agent job in production.
                </h2>
                <p className="mx-auto mb-10 max-w-lg text-[16px] leading-7" style={{ color: C.t3 }}>
                  Create a workspace, explore the demo runs, and see how Vectorbee handles
                  scheduling, approvals, and retries end-to-end.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Link href="/signup"
                    className="inline-flex h-11 items-center gap-2 rounded-xl px-8 text-[14px] font-bold transition-all hover:opacity-90 hover:shadow-xl"
                    style={{ background: C.sky, color: "#05080F", boxShadow: "0 0 32px rgba(56,189,248,0.28)" }}>
                    Start free <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/runs"
                    className="inline-flex h-11 items-center gap-2 rounded-xl px-7 text-[14px] font-medium transition-colors hover:text-white"
                    style={{ background: "transparent", border: `1px solid ${C.borderMd}`, color: C.t2 }}>
                    <Play className="h-4 w-4" /> View demo run
                  </Link>
                </div>
                <p className="mt-5 text-[12px]" style={{ color: C.t4 }}>
                  No credit card required · Demo scenarios ready to explore · Works with any agent framework
                </p>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: `1px solid ${C.border}`, background: C.s2 }}>
        <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            {/* Brand */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ background: C.s3, border: `1px solid ${C.border}` }}>
                  <BeeLogo className="h-3.5 w-3.5" />
                </span>
                <span className="text-[14px] font-bold tracking-tight" style={{ color: C.t2 }}>Vectorbee</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: C.skyBg, border: `1px solid ${C.skyBdr}`, color: C.sky }}>
                  Beta
                </span>
              </div>
              <p className="max-w-xs text-[12px] leading-5" style={{ color: C.t4 }}>
                Durable AI workflow orchestration for teams that need agent jobs to run reliably in production.
              </p>
            </div>

            {/* Nav columns */}
            <div className="flex flex-wrap gap-x-12 gap-y-6">
              <div className="space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.t4 }}>Platform</p>
                {[["Workflows","/workflows"],["Runs","/runs"],["Approvals","/approvals"],["Workers","/workers"]].map(([l,h]) => (
                  <Link key={l} href={h as never} className="block text-[13px] transition-colors hover:text-white" style={{ color: C.t4 }}>{l}</Link>
                ))}
              </div>
              <div className="space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.t4 }}>Account</p>
                {[["Sign in","/signin"],["Create account","/signup"],["Dashboard","/dashboard"]].map(([l,h]) => (
                  <Link key={l} href={h as never} className="block text-[13px] transition-colors hover:text-white" style={{ color: C.t4 }}>{l}</Link>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-10 flex items-center justify-between border-t pt-6" style={{ borderColor: C.border }}>
            <p className="text-[12px]" style={{ color: C.t4 }}>© 2025 Vectorbee. All rights reserved.</p>
            <div className="flex items-center gap-4">
              {[["Privacy","/docs/security"],["Terms","/docs/terms"]].map(([l,h]) => (
                <Link key={l} href={h as never} className="text-[12px] transition-colors hover:text-white" style={{ color: C.t4 }}>{l}</Link>
              ))}
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
