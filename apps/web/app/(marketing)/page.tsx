import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  Shield,
  Zap,
  Activity,
  Bot,
  ShieldCheck,
  GitBranch,
  Play,
  Loader2,
  ChevronRight,
  Database,
  AlertTriangle,
  RotateCcw,
  Eye,
  Layers,
  PauseCircle,
  ListChecks,
  Timer,
  TrendingUp,
} from "lucide-react";
import { BeeLogo } from "@/components/brand/bee-logo";

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: "succeeded" | "running" | "waiting" | "failed" | "queued" }) {
  const variants = {
    succeeded: { label: "Succeeded",         bg: "#ECFDF5", border: "#BBF7D0", color: "#15803D", icon: <CheckCircle2 className="h-3 w-3" /> },
    running:   { label: "Running",           bg: "#EFF6FF", border: "#BFDBFE", color: "#1D4ED8", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    waiting:   { label: "Awaiting approval", bg: "#FFFBEB", border: "#FDE68A", color: "#92400E", icon: <PauseCircle className="h-3 w-3" /> },
    failed:    { label: "Failed",            bg: "#FEF2F2", border: "#FECACA", color: "#B91C1C", icon: <AlertTriangle className="h-3 w-3" /> },
    queued:    { label: "Queued",            bg: "#F0F9FF", border: "#BAE6FD", color: "#075985", icon: <Clock className="h-3 w-3" /> },
  };
  const v = variants[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
      style={{ background: v.bg, border: `1px solid ${v.border}`, color: v.color }}>
      {v.icon}{v.label}
    </span>
  );
}

// ─── Timeline event row ───────────────────────────────────────────────────────

function TimelineEvent({
  icon, title, sub, time, status, last = false,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  time: string;
  status: "success" | "blue" | "amber" | "red" | "gray";
  last?: boolean;
}) {
  const colors = {
    success: { ring: "#22C55E", bg: "#ECFDF5", text: "#15803D" },
    blue:    { ring: "#3B82F6", bg: "#EFF6FF", text: "#1D4ED8" },
    amber:   { ring: "#F59E0B", bg: "#FFFBEB", text: "#92400E" },
    red:     { ring: "#EF4444", bg: "#FEF2F2", text: "#B91C1C" },
    gray:    { ring: "#94A3B8", bg: "#F8FAFC", text: "#64748B" },
  };
  const c = colors[status];
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2"
          style={{ background: c.bg, borderColor: c.ring, color: c.text }}>
          {icon}
        </div>
        {!last && <div className="mt-1 w-0.5 flex-1 bg-slate-200" style={{ minHeight: 24 }} />}
      </div>
      <div className="pb-4 min-w-0 flex-1" style={{ paddingTop: 4 }}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-semibold text-slate-800 leading-tight">{title}</p>
          <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">{time}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-slate-500 leading-relaxed">{sub}</p>
      </div>
    </div>
  );
}

// ─── Canvas node ─────────────────────────────────────────────────────────────

function CanvasNode({
  icon, label, type, badge, accent = "#2563EB", selected = false,
}: {
  icon: React.ReactNode;
  label: string;
  type: string;
  badge?: string;
  accent?: string;
  selected?: boolean;
}) {
  const accentBg = accent + "12";
  return (
    <div className="relative flex items-start gap-3 rounded-xl border bg-white p-3.5"
      style={{
        minWidth: 200,
        borderColor: selected ? accent : "#E2E8F0",
        boxShadow: selected
          ? `0 0 0 3px ${accent}22, 0 4px 16px rgba(15,23,42,0.08)`
          : "0 2px 8px rgba(15,23,42,0.06)",
      }}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: accentBg, color: accent }}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-slate-800 truncate leading-tight">{label}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{type}</p>
      </div>
      {badge && (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: accentBg, color: accent }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ─── Problem card ─────────────────────────────────────────────────────────────

function ProblemCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-red-100 bg-red-50/60 p-5">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-600">
        {icon}
      </div>
      <p className="text-[14px] font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, desc, accent = "#2563EB" }: {
  icon: React.ReactNode; title: string; desc: string; accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 transition-all hover:border-slate-300 hover:shadow-md"
      style={{ boxShadow: "0 2px 8px rgba(15,23,42,0.04)" }}>
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: accent + "12", color: accent }}>
        {icon}
      </div>
      <p className="text-[14px] font-semibold text-slate-800">{title}</p>
      <p className="mt-1.5 text-[13px] text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">

      {/* ════════════════════════════════════════════════════════════════
          NAV
      ════════════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
              <BeeLogo className="h-4 w-4 text-white" />
            </div>
            <span className="text-[15px] font-bold tracking-tight text-slate-900">Vectorbea</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {["Features", "How it works", "Pricing"].map(label => (
              <a key={label} href={`#${label.toLowerCase().replace(/\s/g, "")}`}
                className="rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/signin"
              className="rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium text-slate-600 transition-colors hover:text-slate-900">
              Sign in
            </Link>
            <Link href="/signup"
              className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13.5px] font-semibold text-white transition-all hover:bg-slate-800 hover:shadow-md"
              style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.2)" }}>
              Start building
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════════
          HERO
      ════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden pt-20 pb-24">
        {/* Subtle background */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-white via-[#F8FAFC] to-[#F8FAFC]" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[600px] w-[900px] rounded-full"
            style={{ background: "radial-gradient(ellipse, rgba(37,99,235,0.06) 0%, transparent 70%)" }} />
        </div>

        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="flex flex-col items-center text-center">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span className="text-[12px] font-semibold text-blue-700 tracking-wide uppercase">Agentic Automation Platform</span>
            </div>

            {/* Headline */}
            <h1 className="mx-auto max-w-3xl text-5xl font-bold tracking-[-0.04em] text-slate-900 leading-[1.1]"
              style={{ fontSize: "clamp(36px, 5vw, 56px)" }}>
              Durable automation for AI agents that must actually finish.
            </h1>

            <p className="mt-6 mx-auto max-w-2xl text-[17px] text-slate-500 leading-[1.7]">
              Vectorbea gives AI workflows the execution layer they&#39;re missing: durable runs,
              human approval gates, automatic retries, event history, and clean debugging —
              without hiding your automation inside a black box.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup"
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-[15px] font-semibold text-white transition-all hover:bg-blue-700 hover:shadow-lg"
                style={{ boxShadow: "0 4px 14px rgba(37,99,235,0.30)" }}>
                Start building free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/signin"
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3 text-[15px] font-semibold text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300 hover:shadow-sm">
                View run timeline
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            </div>

            {/* Trust hints */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {["BYOK models", "Human approvals", "Durable retries", "Event-sourced runs", "No vendor lock-in"].map(hint => (
                <span key={hint} className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {hint}
                </span>
              ))}
            </div>
          </div>

          {/* ── Hero product preview ─────────────────────────────────────────── */}
          <div className="mt-16 grid grid-cols-1 gap-4 lg:grid-cols-5">

            {/* Canvas preview */}
            <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white overflow-hidden"
              style={{ boxShadow: "0 8px 40px rgba(15,23,42,0.08)" }}>
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-slate-400" />
                  <span className="text-[13px] font-semibold text-slate-700">Customer Renewal Intelligence</span>
                </div>
                <StatusPill status="running" />
              </div>
              <div className="p-5 space-y-3">
                {/* Canvas nodes mockup */}
                <div className="flex items-start gap-3">
                  <CanvasNode icon={<Play className="h-4 w-4" />} label="Schedule Trigger" type="TRIGGER" badge="Daily" accent="#2563EB" />
                  <div className="flex items-center self-center">
                    <div className="h-px w-8 border-t-2 border-dashed border-slate-200" />
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300 -ml-0.5" />
                  </div>
                  <CanvasNode icon={<Database className="h-4 w-4" />} label="Fetch Renewals" type="DB READ" accent="#059669" selected />
                </div>
                <div className="flex items-start gap-3 pl-10">
                  <CanvasNode icon={<Bot className="h-4 w-4" />} label="Risk Scoring Agent" type="LLM AGENT · gpt-4o" badge="running" accent="#7C3AED" selected />
                  <div className="flex items-center self-center">
                    <div className="h-px w-8 border-t-2 border-dashed border-slate-200" />
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300 -ml-0.5" />
                  </div>
                  <CanvasNode icon={<ShieldCheck className="h-4 w-4" />} label="Approval Gate" type="HUMAN APPROVAL" badge="pending" accent="#D97706" />
                </div>
                <div className="flex items-start gap-3 pl-20">
                  <CanvasNode icon={<Activity className="h-4 w-4" />} label="Notify & Archive" type="HTTP · TOOL" accent="#0891B2" />
                </div>
              </div>
            </div>

            {/* Timeline preview */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden"
              style={{ boxShadow: "0 8px 40px rgba(15,23,42,0.08)" }}>
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-[13px] font-semibold text-slate-700">Run timeline</span>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">2m 14s</span>
              </div>
              <div className="p-4">
                <TimelineEvent
                  icon={<Play className="h-3.5 w-3.5" />}
                  title="Run started"
                  sub="Schedule trigger · daily 09:00"
                  time="09:00:01"
                  status="blue"
                />
                <TimelineEvent
                  icon={<Database className="h-3.5 w-3.5" />}
                  title="Fetched 34 renewals"
                  sub="DB read · 284ms"
                  time="09:00:02"
                  status="success"
                />
                <TimelineEvent
                  icon={<Bot className="h-3.5 w-3.5" />}
                  title="Agent completed"
                  sub="Risk scored 34 accounts · 6.2k tokens"
                  time="09:01:18"
                  status="blue"
                />
                <TimelineEvent
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  title="Approval requested"
                  sub="Waiting for Finance Ops · 3 high-risk"
                  time="09:01:20"
                  status="amber"
                  last
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          PROBLEM
      ════════════════════════════════════════════════════════════════ */}
      <section id="features" className="border-t border-slate-200 bg-white py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-blue-600 mb-3">The problem</p>
            <h2 className="text-3xl font-bold tracking-[-0.03em] text-slate-900" style={{ fontSize: "clamp(24px,3.5vw,36px)" }}>
              AI workflows break when they leave the demo.
            </h2>
            <p className="mt-4 mx-auto max-w-xl text-[16px] text-slate-500 leading-relaxed">
              LLM calls are probabilistic. Networks fail. APIs rate-limit. Humans need to approve.
              Most frameworks don&#39;t handle any of this.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ProblemCard icon={<Eye className="h-4 w-4" />} title="Hidden tool calls" desc="No visibility into what your agent actually called, when, or what it returned." />
            <ProblemCard icon={<RotateCcw className="h-4 w-4" />} title="Manual retries" desc="Failed steps require human intervention. No automatic retry with backoff." />
            <ProblemCard icon={<ShieldCheck className="h-4 w-4" />} title="No approval trail" desc="Critical decisions happen inside the agent with no way to pause and ask a human." />
            <ProblemCard icon={<AlertTriangle className="h-4 w-4" />} title="Hard to debug" desc="When something fails at step 7 of 12, you start the whole thing over." />
            <ProblemCard icon={<Layers className="h-4 w-4" />} title="Lost state" desc="Long-running workflows lose intermediate results on failure or restart." />
            <ProblemCard icon={<TrendingUp className="h-4 w-4" />} title="Unclear costs" desc="No per-run breakdown of tokens, latency, tool calls, or estimated spend." />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          CAPABILITIES
      ════════════════════════════════════════════════════════════════ */}
      <section id="howItWorks" className="border-t border-slate-200 bg-[#F8FAFC] py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-blue-600 mb-3">Platform</p>
            <h2 className="text-3xl font-bold tracking-[-0.03em] text-slate-900" style={{ fontSize: "clamp(24px,3.5vw,36px)" }}>
              Everything an agentic workflow needs in production.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard accent="#2563EB" icon={<GitBranch className="h-5 w-5" />} title="Workflow canvas" desc="Visual drag-and-drop builder for constructing multi-step agentic workflows." />
            <FeatureCard accent="#7C3AED" icon={<Bot className="h-5 w-5" />} title="Durable agent runs" desc="Runs checkpoint at every step. Failures retry from the last checkpoint, not the beginning." />
            <FeatureCard accent="#D97706" icon={<ShieldCheck className="h-5 w-5" />} title="Human approval gates" desc="Pause mid-workflow for a human decision with full context and audit trail." />
            <FeatureCard accent="#059669" icon={<ListChecks className="h-5 w-5" />} title="Event history" desc="Every tool call, LLM response, retry, and approval is recorded in an immutable event log." />
            <FeatureCard accent="#0891B2" icon={<RotateCcw className="h-5 w-5" />} title="Automatic retry & resume" desc="Configure backoff policies per step. Failed runs resume from the last successful checkpoint." />
            <FeatureCard accent="#EA580C" icon={<Zap className="h-5 w-5" />} title="BYOK connections" desc="Connect your own OpenAI, Anthropic, or Gemini keys. Connect your own databases and APIs." />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          TIMELINE SHOWCASE
      ════════════════════════════════════════════════════════════════ */}
      <section className="border-t border-slate-200 bg-white py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-blue-600 mb-3">Run timeline</p>
              <h2 className="text-3xl font-bold tracking-[-0.03em] text-slate-900 leading-tight" style={{ fontSize: "clamp(24px,3.5vw,36px)" }}>
                Debug every run without reading raw logs first.
              </h2>
              <p className="mt-4 text-[16px] text-slate-500 leading-relaxed">
                Every workflow run produces a structured execution trace — grouped by agent, annotated with timing, tokens, and cost. Find the failure in seconds, not minutes.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "Agent-grouped swimlane view with precise timing",
                  "Expandable events: input, output, error, metadata",
                  "Retry history with attempt count and backoff",
                  "Approval audit trail with decision and timestamp",
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-[14px] text-slate-600">
                    <CheckCircle2 className="h-4.5 w-4.5 mt-0.5 shrink-0 text-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Timeline mockup */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
              style={{ boxShadow: "0 8px 40px rgba(15,23,42,0.08)" }}>
              <div className="border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-slate-800">Run #1,847</p>
                  <p className="text-[11.5px] text-slate-400 mt-0.5">Customer Renewal Intelligence · Succeeded</p>
                </div>
                <StatusPill status="succeeded" />
              </div>
              <div className="p-5">
                <TimelineEvent
                  icon={<Play className="h-3.5 w-3.5" />}
                  title="Run started"
                  sub="Manual trigger by admin@acme.com"
                  time="10:30:01"
                  status="blue"
                />
                <TimelineEvent
                  icon={<Database className="h-3.5 w-3.5" />}
                  title="Tool call: fetchCustomers"
                  sub="GET /customers · 200 OK · 34 records"
                  time="10:30:02"
                  status="success"
                />
                <TimelineEvent
                  icon={<Bot className="h-3.5 w-3.5" />}
                  title="LLM agent completed"
                  sub="gpt-4o-mini · 2,430 tokens · $0.0042"
                  time="10:31:18"
                  status="blue"
                />
                <TimelineEvent
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  title="Approval: approved"
                  sub="Finance Ops approved within 14 min"
                  time="10:45:22"
                  status="success"
                />
                <TimelineEvent
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  title="Retry attempted (2/3)"
                  sub="HTTP 429 rate limit · backoff 30s"
                  time="10:45:25"
                  status="amber"
                />
                <TimelineEvent
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  title="Run completed"
                  sub="All 34 accounts processed · 15m 24s total"
                  time="10:45:25"
                  status="success"
                  last
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          FINAL CTA
      ════════════════════════════════════════════════════════════════ */}
      <section id="pricing" className="border-t border-slate-200 bg-slate-900 py-24">
        <div className="mx-auto max-w-3xl px-5 text-center lg:px-8">
          <h2 className="text-4xl font-bold tracking-[-0.035em] text-white leading-tight" style={{ fontSize: "clamp(28px,4vw,44px)" }}>
            Build workflows your team can trust.
          </h2>
          <p className="mt-5 text-[17px] text-slate-400 leading-relaxed">
            Not another AI demo. Vectorbea is the production execution layer for agentic automation — durable, observable, and debuggable.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup"
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-[15px] font-semibold text-white transition-all hover:bg-blue-500"
              style={{ boxShadow: "0 4px 20px rgba(37,99,235,0.40)" }}>
              Create your first workflow
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/signin"
              className="rounded-xl border border-slate-700 px-7 py-3.5 text-[15px] font-semibold text-slate-300 transition-all hover:border-slate-500 hover:text-white">
              Sign in
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {["Free to start", "Bring your own model keys", "No usage-based lock-in", "Cancel anytime"].map(hint => (
              <span key={hint} className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
                <CheckCircle2 className="h-3.5 w-3.5 text-slate-600" />
                {hint}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════════════════ */}
      <footer className="border-t border-slate-800 bg-slate-900 py-10">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800">
                <BeeLogo className="h-3.5 w-3.5 text-slate-300" />
              </div>
              <span className="text-[14px] font-semibold text-slate-400">Vectorbea</span>
            </div>
            <p className="text-[12.5px] text-slate-600">
              Durable agentic automation. Built for production.
            </p>
            <div className="flex items-center gap-4">
              {["Privacy", "Terms", "Docs"].map(link => (
                <a key={link} href={`/${link.toLowerCase()}`}
                  className="text-[12.5px] text-slate-600 transition-colors hover:text-slate-400">
                  {link}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
