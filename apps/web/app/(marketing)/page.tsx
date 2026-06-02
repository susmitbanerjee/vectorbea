import Link from "next/link";
import {
  ArrowRight, CheckCircle2, Clock, RefreshCw, Shield, Zap,
  Activity, Bot, ShieldCheck, GitBranch, Play, Loader2,
  ChevronRight, Database, AlertTriangle, RotateCcw, Eye,
  Layers, PauseCircle, ListChecks, Timer, TrendingUp,
} from "lucide-react";
import { BeeLogo } from "@/components/brand/bee-logo";

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: "succeeded" | "running" | "waiting" | "failed" | "queued" }) {
  const variants = {
    succeeded: { label: "Succeeded",         bg: "rgba(22,163,74,0.12)",  border: "rgba(22,163,74,0.3)",  color: "#4ADE80", dot: "#22C55E" },
    running:   { label: "Running",           bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)", color: "#93C5FD", dot: "#3B82F6" },
    waiting:   { label: "Awaiting approval", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", color: "#FCD34D", dot: "#F59E0B" },
    failed:    { label: "Failed",            bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  color: "#FCA5A5", dot: "#EF4444" },
    queued:    { label: "Queued",            bg: "rgba(148,163,184,0.1)", border: "rgba(148,163,184,0.3)",color: "#94A3B8", dot: "#64748B" },
  };
  const v = variants[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: v.bg, border: `1px solid ${v.border}`, color: v.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.dot }} />
      {v.label}
    </span>
  );
}

// ─── Timeline event ───────────────────────────────────────────────────────────
function TimelineEvent({
  icon, title, sub, time, status, last = false,
}: {
  icon: React.ReactNode; title: string; sub: string; time: string;
  status: "success" | "blue" | "amber" | "red" | "gray"; last?: boolean;
}) {
  const colors = {
    success: { ring: "rgba(34,197,94,0.5)",   bg: "rgba(34,197,94,0.08)",   text: "#4ADE80" },
    blue:    { ring: "rgba(59,130,246,0.5)",  bg: "rgba(59,130,246,0.08)",  text: "#93C5FD" },
    amber:   { ring: "rgba(245,158,11,0.5)",  bg: "rgba(245,158,11,0.08)",  text: "#FCD34D" },
    red:     { ring: "rgba(239,68,68,0.5)",   bg: "rgba(239,68,68,0.08)",   text: "#FCA5A5" },
    gray:    { ring: "rgba(148,163,184,0.4)", bg: "rgba(148,163,184,0.06)", text: "#94A3B8" },
  };
  const c = colors[status];
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: c.bg, border: `1px solid ${c.ring}`, color: c.text }}>
          {icon}
        </div>
        {!last && <div className="mt-1 w-px flex-1" style={{ background: "rgba(255,255,255,0.08)", minHeight: 20 }} />}
      </div>
      <div className="pb-3.5 min-w-0 flex-1" style={{ paddingTop: 4 }}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[12.5px] font-semibold text-white/90 leading-tight">{title}</p>
          <span className="shrink-0 font-mono text-[10.5px] text-white/30 tabular-nums">{time}</span>
        </div>
        <p className="mt-0.5 text-[11.5px] text-white/40 leading-relaxed">{sub}</p>
      </div>
    </div>
  );
}

// ─── Canvas node ──────────────────────────────────────────────────────────────
function CanvasNode({
  icon, label, type, badge, accent = "#3B82F6", selected = false,
}: {
  icon: React.ReactNode; label: string; type: string;
  badge?: string; accent?: string; selected?: boolean;
}) {
  return (
    <div className="relative rounded-xl px-3 py-2.5 min-w-[160px]"
      style={{
        background: selected ? `${accent}14` : "rgba(255,255,255,0.04)",
        border: `1px solid ${selected ? accent + "40" : "rgba(255,255,255,0.08)"}`,
        boxShadow: selected ? `0 0 0 1px ${accent}20, 0 4px 16px ${accent}14` : "none",
      }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${accent}18`, color: accent }}>
          {icon}
        </span>
        <span className="text-[11.5px] font-bold text-white/90 leading-tight">{label}</span>
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: accent + "99" }}>{type}</span>
        {badge && (
          <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
            style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, desc, accent }: { icon: React.ReactNode; title: string; desc: string; accent: string }) {
  return (
    <div className="group rounded-2xl p-6 transition-all duration-200 hover:bg-white/[0.04]"
      style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: `${accent}15`, border: `1px solid ${accent}25`, color: accent }}>
        {icon}
      </div>
      <h3 className="text-[15px] font-bold text-white/90 mb-2">{title}</h3>
      <p className="text-[13.5px] text-white/45 leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Problem card ─────────────────────────────────────────────────────────────
function ProblemCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl p-6 bg-white border border-slate-100"
      style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-500">
        {icon}
      </div>
      <h3 className="text-[14.5px] font-bold text-slate-800 mb-1.5">{title}</h3>
      <p className="text-[13px] text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-[#08080F] text-white">

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(8,8,15,0.85)", backdropFilter: "blur(20px)" }}>
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-6 py-4 lg:px-16">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <BeeLogo className="h-4 w-4 text-white" />
            </div>
            <span className="text-[15px] font-bold tracking-tight text-white">Vectorbea</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {["Features", "How it works", "Pricing"].map(label => (
              <a key={label} href={`#${label.toLowerCase().replace(/\s/g, "")}`}
                className="rounded-lg px-4 py-2 text-[13.5px] font-medium transition-colors text-white/55 hover:text-white/90">
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link href="/signin" className="rounded-lg px-4 py-2 text-[13.5px] font-medium transition-colors"
              style={{ color: "rgba(255,255,255,0.55)" }}>
              Sign in
            </Link>
            <Link href="/signup"
              className="flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-[13.5px] font-bold text-white transition-all"
              style={{ background: "#2563EB", boxShadow: "0 0 0 1px rgba(37,99,235,0.5), 0 4px 16px rgba(37,99,235,0.35)" }}>
              Start building →
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {/* Full-bleed dramatic background */}
        <div className="absolute inset-0 -z-10">
          {/* Grid pattern like Neon */}
          <div className="absolute inset-0" style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }} />
          {/* Large glow spots */}
          <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[1200px] h-[800px]"
            style={{ background: "radial-gradient(ellipse, rgba(37,99,235,0.18) 0%, rgba(124,58,237,0.08) 40%, transparent 70%)" }} />
          <div className="absolute bottom-0 left-0 w-[600px] h-[400px]"
            style={{ background: "radial-gradient(ellipse, rgba(124,58,237,0.12) 0%, transparent 60%)" }} />
          <div className="absolute bottom-0 right-0 w-[500px] h-[350px]"
            style={{ background: "radial-gradient(ellipse, rgba(5,150,105,0.10) 0%, transparent 60%)" }} />
        </div>

        <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-16 pt-28 pb-12">
          {/* Top badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] font-semibold tracking-widest uppercase"
              style={{ background: "rgba(37,99,235,0.12)", border: "1px solid rgba(37,99,235,0.3)", color: "#93C5FD" }}>
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              Agentic Automation Platform
            </div>
          </div>

          {/* Headline — full width, dramatic */}
          <h1 className="text-center font-black tracking-[-0.04em] text-white leading-[1.0] mb-6"
            style={{ fontSize: "clamp(48px, 7.5vw, 96px)", textShadow: "0 0 80px rgba(37,99,235,0.2)" }}>
            Durable automation<br />
            <span style={{ background: "linear-gradient(135deg, #60A5FA 0%, #A78BFA 50%, #34D399 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              for AI agents
            </span>
            <br />
            that must actually finish.
          </h1>

          <p className="text-center mx-auto max-w-2xl mb-10 leading-[1.7]"
            style={{ fontSize: "clamp(16px, 1.5vw, 19px)", color: "rgba(255,255,255,0.5)" }}>
            Vectorbea gives AI workflows the execution layer they&apos;re missing — durable runs,
            human approval gates, automatic retries, event history, and clean debugging.
            Without hiding your automation inside a black box.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
            <Link href="/signup"
              className="flex items-center gap-2 rounded-xl px-8 py-4 text-[15px] font-bold text-white transition-all"
              style={{ background: "#2563EB", boxShadow: "0 0 0 1px rgba(37,99,235,0.5), 0 8px 32px rgba(37,99,235,0.40)" }}>
              Start building free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/signin"
              className="flex items-center gap-2 rounded-xl px-8 py-4 text-[15px] font-bold transition-all"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)" }}>
              View run timeline
              <ChevronRight className="h-4 w-4 opacity-50" />
            </Link>
          </div>

          {/* Trust hints */}
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 mb-16">
            {["BYOK models", "Human approvals", "Durable retries", "Event-sourced runs", "No vendor lock-in"].map(hint => (
              <span key={hint} className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/60" />
                {hint}
              </span>
            ))}
          </div>

          {/* ── Full-width product preview ───────────────────────────────────── */}
          <div className="w-full grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]"
            style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, overflow: "hidden", background: "rgba(255,255,255,0.02)", backdropFilter: "blur(10px)" }}>

            {/* Canvas preview */}
            <div style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-500/60" />
                    <div className="h-3 w-3 rounded-full bg-yellow-500/60" />
                    <div className="h-3 w-3 rounded-full bg-green-500/60" />
                  </div>
                  <span className="text-[12.5px] font-semibold ml-2" style={{ color: "rgba(255,255,255,0.6)" }}>Customer Renewal Intelligence</span>
                </div>
                <StatusPill status="running" />
              </div>
              <div className="p-6 space-y-4" style={{ background: "rgba(0,0,0,0.3)" }}>
                <div className="flex items-center gap-4">
                  <CanvasNode icon={<Play className="h-3.5 w-3.5" />} label="Schedule Trigger" type="TRIGGER" badge="Daily" accent="#3B82F6" />
                  <div className="flex items-center flex-1">
                    <div className="flex-1 border-t border-dashed" style={{ borderColor: "rgba(255,255,255,0.12)" }} />
                    <div className="h-1.5 w-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }} />
                  </div>
                  <CanvasNode icon={<Database className="h-3.5 w-3.5" />} label="Fetch Renewals" type="DB READ" accent="#10B981" selected />
                </div>
                <div className="flex items-center gap-4 ml-8">
                  <CanvasNode icon={<Bot className="h-3.5 w-3.5" />} label="Risk Scoring Agent" type="LLM · gpt-4o" badge="running" accent="#8B5CF6" selected />
                  <div className="flex items-center flex-1">
                    <div className="flex-1 border-t border-dashed" style={{ borderColor: "rgba(255,255,255,0.12)" }} />
                    <div className="h-1.5 w-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }} />
                  </div>
                  <CanvasNode icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Approval Gate" type="HUMAN APPROVAL" badge="pending" accent="#F59E0B" />
                </div>
                <div className="flex items-center gap-4 ml-16">
                  <CanvasNode icon={<Activity className="h-3.5 w-3.5" />} label="Notify & Archive" type="HTTP · TOOL" accent="#0EA5E9" />
                </div>
              </div>
            </div>

            {/* Timeline preview */}
            <div>
              <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="text-[12.5px] font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>Run timeline</span>
                <span className="font-mono text-[11px] tabular-nums" style={{ color: "rgba(255,255,255,0.3)" }}>2m 14s</span>
              </div>
              <div className="p-5" style={{ background: "rgba(0,0,0,0.2)" }}>
                <TimelineEvent icon={<Play className="h-3 w-3" />} title="Run started" sub="Schedule trigger · daily 09:00" time="09:00:01" status="blue" />
                <TimelineEvent icon={<Database className="h-3 w-3" />} title="Fetched 34 renewals" sub="DB read · 284ms" time="09:00:02" status="success" />
                <TimelineEvent icon={<Bot className="h-3 w-3" />} title="Agent completed" sub="Risk scored 34 accounts · 6.2k tokens" time="09:01:18" status="blue" />
                <TimelineEvent icon={<ShieldCheck className="h-3 w-3" />} title="Approval requested" sub="Waiting for Finance Ops · 3 high-risk" time="09:01:20" status="amber" last />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLEM — light section ──────────────────────────────────────────── */}
      <section id="features" className="w-full bg-white py-24">
        <div className="mx-auto max-w-[1440px] px-6 lg:px-16">
          <div className="mb-16 max-w-2xl">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600 mb-4">The problem</p>
            <h2 className="font-black tracking-[-0.03em] text-slate-900 leading-[1.1] mb-5"
              style={{ fontSize: "clamp(28px, 4vw, 52px)" }}>
              AI workflows break when they leave the demo.
            </h2>
            <p className="text-[16px] text-slate-500 leading-relaxed">
              LLM calls are probabilistic. Networks fail. APIs rate-limit.
              Humans need to approve. Most frameworks don&apos;t handle any of this.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ProblemCard icon={<Eye className="h-4 w-4" />} title="Hidden tool calls" desc="No visibility into what your agent called, when, or what it returned." />
            <ProblemCard icon={<RotateCcw className="h-4 w-4" />} title="Manual retries" desc="Failed steps require human intervention. No automatic retry with backoff." />
            <ProblemCard icon={<ShieldCheck className="h-4 w-4" />} title="No approval trail" desc="Critical decisions happen inside the agent with no way to pause for a human." />
            <ProblemCard icon={<AlertTriangle className="h-4 w-4" />} title="Hard to debug" desc="When something fails at step 7 of 12, you start the whole thing over." />
            <ProblemCard icon={<Layers className="h-4 w-4" />} title="Lost state" desc="Long-running workflows lose intermediate results on failure or restart." />
            <ProblemCard icon={<TrendingUp className="h-4 w-4" />} title="Unclear costs" desc="No per-run breakdown of tokens, latency, tool calls, or estimated spend." />
          </div>
        </div>
      </section>

      {/* ── CAPABILITIES — dark section ──────────────────────────────────────── */}
      <section id="howItWorks" className="w-full py-24" style={{ background: "#0D0D18", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="mx-auto max-w-[1440px] px-6 lg:px-16">
          <div className="mb-16 max-w-2xl">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] mb-4" style={{ color: "#60A5FA" }}>Platform</p>
            <h2 className="font-black tracking-[-0.03em] text-white leading-[1.1] mb-5"
              style={{ fontSize: "clamp(28px, 4vw, 52px)" }}>
              Everything an agentic workflow needs in production.
            </h2>
            <p className="text-[16px] leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>
              Built for the workflows that actually matter — the ones that need to finish.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard accent="#3B82F6" icon={<GitBranch className="h-5 w-5" />} title="Visual workflow canvas" desc="Drag-and-drop builder for multi-step agentic workflows. Connect agents, tools, and approval gates visually." />
            <FeatureCard accent="#8B5CF6" icon={<Bot className="h-5 w-5" />} title="Durable agent runs" desc="Runs checkpoint at every step. Failures retry from the last checkpoint, not the beginning." />
            <FeatureCard accent="#F59E0B" icon={<ShieldCheck className="h-5 w-5" />} title="Human approval gates" desc="Pause mid-workflow for a human decision with full context, audit trail, and timeout handling." />
            <FeatureCard accent="#10B981" icon={<ListChecks className="h-5 w-5" />} title="Immutable event history" desc="Every tool call, LLM response, retry, and approval is recorded in a structured event log." />
            <FeatureCard accent="#0EA5E9" icon={<RotateCcw className="h-5 w-5" />} title="Automatic retry & resume" desc="Configure backoff policies per step. Failed runs resume from the last successful checkpoint." />
            <FeatureCard accent="#F97316" icon={<Zap className="h-5 w-5" />} title="BYOK connections" desc="Connect your own OpenAI, Anthropic, or Gemini keys. Your own databases and APIs too." />
          </div>
        </div>
      </section>

      {/* ── TIMELINE SHOWCASE — alternating ──────────────────────────────────── */}
      <section className="w-full py-24 bg-white" style={{ borderTop: "1px solid #F1F5F9" }}>
        <div className="mx-auto max-w-[1440px] px-6 lg:px-16">
          <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600 mb-4">Run timeline</p>
              <h2 className="font-black tracking-[-0.03em] text-slate-900 leading-[1.1] mb-5"
                style={{ fontSize: "clamp(28px, 3.5vw, 48px)" }}>
                Debug every run without reading raw logs first.
              </h2>
              <p className="text-[16px] text-slate-500 leading-relaxed mb-8">
                Every workflow run produces a structured execution trace — grouped by agent, annotated with timing, tokens, and cost. Find the failure in seconds, not minutes.
              </p>
              <ul className="space-y-3.5">
                {[
                  "Agent-grouped swimlane view with precise timing",
                  "Expandable events: input, output, error, metadata",
                  "Retry history with attempt count and backoff",
                  "Approval audit trail with decision and timestamp",
                ].map(item => (
                  <li key={item} className="flex items-center gap-3 text-[14.5px] text-slate-600">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Timeline mockup — dark card */}
            <div className="rounded-2xl overflow-hidden"
              style={{ background: "#0D0D18", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 32px 80px rgba(0,0,0,0.3)" }}>
              <div className="border-b px-5 py-4 flex items-center justify-between" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                <div>
                  <p className="text-[13px] font-bold text-white">Run #1,847</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>Customer Renewal Intelligence</p>
                </div>
                <StatusPill status="succeeded" />
              </div>
              <div className="p-5">
                <TimelineEvent icon={<Play className="h-3 w-3" />} title="Run started" sub="Manual trigger by admin@acme.com" time="10:30:01" status="blue" />
                <TimelineEvent icon={<Database className="h-3 w-3" />} title="Tool call: fetchCustomers" sub="GET /customers · 200 OK · 34 records" time="10:30:02" status="success" />
                <TimelineEvent icon={<Bot className="h-3 w-3" />} title="LLM agent completed" sub="gpt-4o-mini · 2,430 tokens · $0.0042" time="10:31:18" status="blue" />
                <TimelineEvent icon={<ShieldCheck className="h-3 w-3" />} title="Approval: approved" sub="Finance Ops approved within 14 min" time="10:45:22" status="success" />
                <TimelineEvent icon={<RefreshCw className="h-3 w-3" />} title="Retry attempted (2/3)" sub="HTTP 429 rate limit · backoff 30s" time="10:45:25" status="amber" />
                <TimelineEvent icon={<CheckCircle2 className="h-3 w-3" />} title="Run completed" sub="All 34 accounts processed · 15m 24s total" time="10:45:25" status="success" last />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA — full-bleed dark ──────────────────────────────────────── */}
      <section id="pricing" className="relative w-full py-32 overflow-hidden"
        style={{ background: "#08080F", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Background glow */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px]"
            style={{ background: "radial-gradient(ellipse, rgba(37,99,235,0.15) 0%, rgba(124,58,237,0.08) 40%, transparent 70%)" }} />
        </div>
        <div className="mx-auto max-w-[800px] px-6 text-center">
          <h2 className="font-black tracking-[-0.035em] text-white leading-[1.05] mb-6"
            style={{ fontSize: "clamp(36px, 5vw, 64px)", textShadow: "0 0 60px rgba(37,99,235,0.2)" }}>
            Build workflows your<br />team can trust.
          </h2>
          <p className="mb-10 leading-relaxed" style={{ fontSize: "clamp(16px, 1.5vw, 19px)", color: "rgba(255,255,255,0.45)" }}>
            Not another AI demo. Vectorbea is the production execution layer for agentic automation —
            durable, observable, and debuggable from day one.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
            <Link href="/signup"
              className="flex items-center gap-2 rounded-xl px-8 py-4 text-[15px] font-bold text-white transition-all"
              style={{ background: "#2563EB", boxShadow: "0 0 0 1px rgba(37,99,235,0.5), 0 8px 32px rgba(37,99,235,0.45)" }}>
              Create your first workflow
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/signin"
              className="flex items-center gap-2 rounded-xl px-8 py-4 text-[15px] font-bold transition-all"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)" }}>
              Sign in
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
            {["Free to start", "Bring your own model keys", "No usage-based lock-in", "Cancel anytime"].map(hint => (
              <span key={hint} className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                {hint}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer className="w-full py-10" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "#08080F" }}>
        <div className="mx-auto max-w-[1440px] px-6 lg:px-16 flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <BeeLogo className="h-3.5 w-3.5 text-white/50" />
            </div>
            <span className="text-[14px] font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>Vectorbea</span>
          </div>
          <p className="text-[12.5px]" style={{ color: "rgba(255,255,255,0.2)" }}>
            Durable agentic automation. Built for production.
          </p>
          <div className="flex items-center gap-6">
            {["Privacy", "Terms", "Docs"].map(link => (
              <a key={link} href={`/${link.toLowerCase()}`}
                className="text-[12.5px] text-white/25 transition-colors hover:text-white/50">
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
