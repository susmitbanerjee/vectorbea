"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  Terminal,
  GitBranch,
  Bot,
  ShieldCheck,
  RotateCcw,
  Webhook,
  Database,
  Zap,
  Eye,
  ChevronRight,
  Play,
  CheckCircle2,
  Diamond,
  CornerDownLeft,
} from "lucide-react";
import { CanvasMock, MockNode } from "@/components/brand/canvas-mock";
import { USE_CASES, getUseCasePath } from "@/lib/marketing/pages";

/* ── Logo cube ────────────────────────────────────────────────────────────── */
function LogoCube({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center justify-center rounded-[8px]" style={{ width: size, height: size, background: "#0B0D0F" }}>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 32 32" fill="none">
        <g stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="11.6" cy="11.4" rx="3" ry="2.1" fill="#00A65A" fillOpacity="0.9" />
          <ellipse cx="20.4" cy="11.4" rx="3" ry="2.1" fill="#00A65A" fillOpacity="0.9" />
          <ellipse cx="16" cy="18" rx="4" ry="5" fill="#007F4E" />
          <path d="M12.4 16.4h7.2" />
          <path d="M12.2 19h7.6" />
          <path d="M12.8 21.6h6.4" />
        </g>
      </svg>
    </span>
  );
}

function MonoLabel({ children }: { children: React.ReactNode }) {
  return <span className="vb-mono-label">{children}</span>;
}

/* ── Checkpoint diamond — recurring brand motif ───────────────────────────── */
function Checkpoint({ size = 10 }: { size?: number }) {
  return (
    <span
      className="inline-block rotate-45 rounded-[2px]"
      style={{ width: size, height: size, background: "#FFFFFF", border: "2px solid #007F4E" }}
    />
  );
}

/* ── Signature: live durable-run panel (hero right) ───────────────────────── */
function DurableRunPanel() {
  const events = [
    { icon: <Play className="h-3 w-3" />, c: "#007F4E", t: "WorkflowStarted", s: "schedule · daily 09:00", time: "09:00:01" },
    { icon: <CheckCircle2 className="h-3 w-3" />, c: "#007F4E", t: "NodeCompleted", s: "triage-agent · 6.2k tokens", time: "09:01:18" },
    { kind: "checkpoint" as const, time: "09:01:18" },
    { icon: <RotateCcw className="h-3 w-3" />, c: "#CA8A04", t: "RetryScheduled", s: "flight-api · attempt 2/3", time: "09:01:20" },
    { icon: <ShieldCheck className="h-3 w-3" />, c: "#0F766E", t: "ApprovalRequested", s: "waiting · Finance Ops", time: "09:01:24", live: true },
  ];
  return (
    <div className="w-full overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#E0E3E6", boxShadow: "0 24px 60px rgba(11,13,15,0.10)" }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b px-3 py-3 sm:px-4" style={{ borderColor: "#ECEEEF" }}>
        <div className="min-w-0">
          <span className="block truncate font-mono text-[12px] text-[#6B7280]">run_a1f3 · renewals-ai</span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#F0FDFA", borderColor: "#99F6E4", color: "#0F766E" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-teal-500" style={{ animation: "pulse 1.8s ease-in-out infinite" }} />
          Running
        </span>
      </div>
      {/* Event rail */}
      <div className="px-3 py-4 sm:px-4">
        {events.map((e, i) => {
          const last = i === events.length - 1;
          if ("kind" in e) {
            return (
              <div key={i} className="flex gap-3">
                <div className="flex w-[18px] flex-col items-center">
                  <Checkpoint />
                  {!last && <span className="my-1 w-px flex-1" style={{ background: "#9CCFBB", minHeight: 14 }} />}
                </div>
                <div className="pb-3">
                  <p className="font-mono text-[12px] font-medium text-[#006B45]">Checkpoint saved</p>
                  <p className="text-[11px] text-[#9CA3AF]">durable state · resumable</p>
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="flex gap-3">
              <div className="flex w-[18px] flex-col items-center">
                <span
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
                  style={{ background: `${e.c}14`, color: e.c, boxShadow: e.live ? `0 0 0 3px ${e.c}1a` : undefined }}
                >
                  {e.icon}
                </span>
                {!last && <span className="my-1 w-px flex-1" style={{ background: "#E0E3E6", minHeight: 14 }} />}
              </div>
              <div className="min-w-0 flex-1 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-mono text-[12.5px] font-medium text-[#0B0D0F]">{e.t}</p>
                  <span className="shrink-0 font-mono text-[10.5px] text-[#9CA3AF]">{e.time}</span>
                </div>
                <p className="text-[11.5px] text-[#6B7280]">{e.s}</p>
              </div>
            </div>
          );
        })}
      </div>
      {/* Resume action */}
      <div className="flex flex-col items-stretch justify-between gap-2 border-t px-3 py-3 sm:flex-row sm:items-center sm:px-4" style={{ borderColor: "#ECEEEF", background: "#FAFBFB" }}>
        <span className="flex items-center gap-1.5 text-[11.5px] text-[#6B7280]"><Diamond className="h-3 w-3 shrink-0 text-[#007F4E]" /> last checkpoint 09:01:18</span>
        <button className="inline-flex w-full items-center justify-center gap-1.5 rounded-[7px] border bg-white px-2.5 py-1 text-[11.5px] font-semibold sm:w-auto" style={{ borderColor: "#9CCFBB", color: "#006B45" }}>
          <CornerDownLeft className="h-3 w-3" /> Resume from checkpoint
        </button>
      </div>
    </div>
  );
}

/* ── Dark runtime console (engineering signature accent) ──────────────────── */
function RuntimeConsole() {
  const lines: { t: string; lvl: string; c: string; msg: string }[] = [
    { t: "09:00:01", lvl: "info", c: "#34D399", msg: "run started" },
    { t: "09:00:02", lvl: "info", c: "#34D399", msg: "fetch-renewals ok 284ms" },
    { t: "09:01:18", lvl: "ckpt", c: "#5EEAD4", msg: "checkpoint seq=14" },
    { t: "09:01:20", lvl: "warn", c: "#FBBF24", msg: "flight-api 429 retry" },
    { t: "09:01:24", lvl: "hold", c: "#67E8F9", msg: "awaiting approval" },
  ];
  return (
    <div className="overflow-hidden rounded-[12px]" style={{ background: "#0B0D0F", boxShadow: "0 18px 50px rgba(11,13,15,0.30)" }}>
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5" style={{ borderColor: "#1c1f22" }}>
        <Terminal className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
        <span className="truncate font-mono text-[11px] text-[#9CA3AF]">runtime · production</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[#4B5563]">durable</span>
      </div>
      <div className="space-y-1 px-3.5 py-3 font-mono text-[11px] leading-[1.7]">
        {lines.map((l, i) => (
          <p key={i} className="truncate">
            <span className="text-[#4B5563]">{l.t}</span>{" "}
            <span style={{ color: l.c }}>{l.lvl}</span>{" "}
            <span className="text-[#D1D5DB]">{l.msg}</span>
          </p>
        ))}
        <p className="text-[#34D399]">
          <span className="text-[#4B5563]">$</span> _<span className="ml-0.5 inline-block h-3 w-1.5 align-middle" style={{ background: "#34D399", animation: "pulse 1.1s steps(2) infinite" }} />
        </p>
      </div>
    </div>
  );
}

/* ── Anatomy-of-a-run lifecycle band ──────────────────────────────────────── */
function AnatomyBand() {
  const steps = [
    { icon: Webhook, label: "Trigger", c: "#4F46E5" },
    { icon: Bot, label: "Agent", c: "#007F4E" },
    { icon: Zap, label: "Tool call", c: "#0F766E", failed: true },
    { icon: ShieldCheck, label: "Approval", c: "#CA8A04" },
    { icon: CheckCircle2, label: "Complete", c: "#007F4E" },
  ];
  return (
    <div className="relative rounded-[14px] border bg-white p-4 sm:p-7" style={{ borderColor: "#E0E3E6" }}>
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="flex shrink-0 items-center gap-2">
              <div className="flex flex-col items-center gap-2">
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-[11px] border"
                  style={{ background: `${s.c}10`, borderColor: `${s.c}33`, color: s.c }}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <span className="font-mono text-[10.5px] text-[#6B7280]">{s.label}</span>
                {s.failed && <span className="rounded-full px-1.5 py-px font-mono text-[9px] font-semibold" style={{ background: "#FFFBEB", color: "#B45309" }}>retried ×2</span>}
              </div>
              {i < steps.length - 1 && (
                <svg width="56" height="14" className="shrink-0">
                  <line x1="2" y1="7" x2="46" y2="7" stroke="#C9CED4" strokeWidth="1.6" strokeDasharray={s.failed ? "4 3" : "0"} />
                  <path d="M44 3 L50 7 L44 11" fill="none" stroke="#C9CED4" strokeWidth="1.6" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
      {/* Resume-from-checkpoint arc */}
      <div className="mt-5 flex items-start gap-2 rounded-[10px] border px-3 py-2.5 sm:items-center sm:px-4" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
        <span className="mt-1 shrink-0 sm:mt-0"><Checkpoint /></span>
        <span className="text-[12.5px] font-medium text-[#006B45]">
          Tool call failed at step 3 — resumed from the last checkpoint, not the beginning. No work lost.
        </span>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export function HomeContent() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      {/* ── NAV ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full backdrop-blur" style={{ background: "rgba(247,248,249,0.85)", borderBottom: "1px solid #E0E3E6" }}>
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:px-8 2xl:max-w-[1360px]">
          <div className="flex min-w-0 items-center gap-8">
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <LogoCube />
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Vectorbea</span>
            </Link>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
              <a href="#product" className="rounded-[7px] px-3 py-1.5 text-[13.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">Product</a>
              <Link href="/use-cases" className="rounded-[7px] px-3 py-1.5 text-[13.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">Use cases</Link>
              <Link href="/compare" className="rounded-[7px] px-3 py-1.5 text-[13.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">Compare</Link>
              <Link href="/docs" className="rounded-[7px] px-3 py-1.5 text-[13.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">Docs</Link>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link href="/signin" className="hidden text-[13.5px] font-medium text-[#4B5563] transition-colors hover:text-[#0B0D0F] sm:inline">Sign in</Link>
            <Link href="/signup" className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-3 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#1c1f22] sm:px-4">
              Start free <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO — asymmetric split ───────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8 lg:pb-28 2xl:max-w-[1360px]">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] xl:gap-14">
          {/* Left */}
          <div>
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
              <Checkpoint size={9} />
              <span className="font-mono text-[11px] font-medium tracking-[0.02em] text-[#006B45]">Durable execution for AI agents</span>
            </span>

            <h1 className="mt-6 text-balance text-[38px] font-bold leading-[1.03] tracking-[-0.035em] sm:text-[52px] lg:text-[64px] 2xl:text-[68px]">
              Agents that resume,<br className="hidden sm:block" /> not restart.
            </h1>

            <p className="mt-6 max-w-[52ch] text-[16px] leading-[1.65] text-[#4B5563] sm:text-[18px]">
              Vectorbea is the control plane for long-running agentic workflows. Every node checkpoints as it runs —
              so a failed tool call, a rate limit, or a 3-day approval picks up exactly where it left off.
            </p>

            <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row min-[420px]:flex-wrap min-[420px]:items-center sm:gap-4">
              <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-[#0B0D0F] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/docs" className="inline-flex items-center justify-center gap-2 text-[15px] font-semibold text-[#0B0D0F] min-[420px]:justify-start">
                <Terminal className="h-4 w-4 text-[#6B7280]" /> Read the docs
              </Link>
            </div>

            <div className="mt-7 grid gap-x-6 gap-y-2 min-[420px]:flex min-[420px]:flex-wrap min-[420px]:items-center">
              {["Event-sourced runs", "Human approvals", "BYOK models", "Replay any run"].map((h) => (
                <span key={h} className="flex items-center gap-1.5 text-[13px] text-[#6B7280]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#007F4E]" /> {h}
                </span>
              ))}
            </div>
          </div>

          {/* Right — signature durable run + console */}
          <div className="relative min-w-0">
            <DurableRunPanel />
            <div className="mt-4 lg:absolute lg:-bottom-10 lg:-left-10 lg:mt-0 lg:w-[330px] xl:-left-12">
              <RuntimeConsole />
            </div>
          </div>
        </div>
      </section>

      {/* ── ANATOMY OF A RUN ──────────────────────────────────────────────── */}
      <section id="product" className="w-full scroll-mt-16 border-t" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
        <div className="mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 2xl:max-w-[1360px]">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-8">
            <div>
              <MonoLabel>Anatomy of a run</MonoLabel>
              <h2 className="mt-3 max-w-[18ch] text-[28px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[36px] lg:text-[44px]">
                Failure is a checkpoint, not a restart.
              </h2>
            </div>
            <p className="max-w-[40ch] text-[15px] leading-[1.6] text-[#4B5563]">
              Vectorbea records every step as a durable event. When something breaks, you resume from the last good
              state — or replay the whole run to debug it.
            </p>
          </div>
          <div className="mt-10"><AnatomyBand /></div>
        </div>
      </section>

      {/* ── BENTO — capabilities ──────────────────────────────────────────── */}
      <section className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#F7F8F9" }}>
        <div className="mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 2xl:max-w-[1360px]">
          <MonoLabel>One control plane</MonoLabel>
          <h2 className="mt-3 max-w-[22ch] text-[28px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[38px] lg:text-[48px]">
            Canvas, observability, and recovery — together.
          </h2>

          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6 lg:auto-rows-[200px]">
            {/* Big canvas tile */}
            <div className="overflow-hidden rounded-[14px] border bg-white md:col-span-3 lg:col-span-4 lg:row-span-2" style={{ borderColor: "#E0E3E6" }}>
              <div className="flex items-center justify-between px-4 pt-5 sm:px-5">
                <div className="min-w-0">
                  <MonoLabel>Visual canvas</MonoLabel>
                  <h3 className="mt-1.5 text-[19px] font-bold tracking-[-0.01em]">See the whole workflow.</h3>
                </div>
              </div>
              <div className="mt-3 h-[300px] border-t" style={{ borderColor: "#ECEEEF" }}>
                <CanvasMock height={300} compact />
              </div>
            </div>

            {/* Approvals */}
            <BentoCard className="md:col-span-3 lg:col-span-2" icon={ShieldCheck} title="Human approval gates" desc="Pause mid-run for a decision — with full context and a complete audit trail.">
              <MockNode
                inline
                icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#FFFBEB", color: "#CA8A04" }}><ShieldCheck className="h-4 w-4" /></span>}
                title="manager-approval"
                subtitle="waits for human decision"
                subRows={[{ icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "SLA 24h" }]}
                dotColor="#CA8A04"
              />
            </BentoCard>

            {/* Retries */}
            <BentoCard className="lg:col-span-2" icon={RotateCcw} title="Automatic retry & resume" desc="Per-node backoff. Resume from the last durable checkpoint.">
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <Checkpoint size={9} />
                <span className="text-[#6B7280]">seq=14 · resumable</span>
              </div>
            </BentoCard>

            {/* Observability */}
            <div className="rounded-[14px] border bg-white p-5 md:col-span-3 lg:col-span-2" style={{ borderColor: "#E0E3E6" }}>
              <MonoLabel>Observability</MonoLabel>
              <h3 className="mt-1.5 text-[16px] font-bold tracking-[-0.01em]">Tokens & cost, live.</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9CA3AF]">Tokens</p>
                  <p className="text-[18px] font-semibold tabular-nums">128.4k</p>
                  <Bars values={[30, 50, 40, 65, 55, 80, 62, 90]} />
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9CA3AF]">Cost</p>
                  <p className="text-[18px] font-semibold tabular-nums">$2.41</p>
                  <Bars tint="#0F766E" values={[40, 35, 55, 48, 66, 58, 74, 68]} />
                </div>
              </div>
            </div>

            {/* BYOK */}
            <BentoCard className="md:col-span-3 lg:col-span-2" icon={Zap} title="Bring your own keys" desc="Your OpenAI, Anthropic, or Gemini keys — plus your own databases and APIs.">
              <div className="flex items-center gap-2 font-mono text-[11px] text-[#6B7280]">
                <Database className="h-3.5 w-3.5 text-[#9CA3AF]" /> encrypted at rest
              </div>
            </BentoCard>

            {/* Event history */}
            <BentoCard className="lg:col-span-2" icon={Eye} title="Immutable event history" desc="Every tool call, LLM response, retry, and approval — replayable.">
              <div className="flex items-center gap-2 font-mono text-[11px] text-[#6B7280]">
                <GitBranch className="h-3.5 w-3.5 text-[#9CA3AF]" /> 14 events · 0 lost
              </div>
            </BentoCard>
          </div>
        </div>
      </section>

      {/* ── USE CASES — topic cluster hub ─────────────────────────────────── */}
      <section id="use-cases" className="w-full scroll-mt-16 border-t" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
        <div className="mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 2xl:max-w-[1360px]">
          <MonoLabel>Use cases</MonoLabel>
          <h2 className="mt-3 max-w-[24ch] text-[28px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[38px] lg:text-[44px]">
            Built for the hard parts of production agents.
          </h2>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-[1.65] text-[#4B5563]">
            Deep dives into the engineering problems Vectorbea is designed for — durable execution, long-running
            agents, human approvals, observability and recovery. Each one explains the problem first, then how a
            durable execution layer addresses it.
          </p>

          <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((uc) => (
              <li key={uc.slug}>
                <Link
                  href={getUseCasePath(uc.slug) as Route}
                  className="group flex h-full flex-col rounded-[14px] border bg-white p-5 transition-colors hover:border-[#9CCFBB]"
                  style={{ borderColor: "#E0E3E6" }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-bold tracking-[-0.01em] text-[#0B0D0F]">{uc.title}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#C9CED4] transition-colors group-hover:text-[#007F4E]" />
                  </span>
                  <span className="mt-2 flex-1 text-[13px] leading-[1.55] text-[#6B7280]">{uc.description}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#007F4E] hover:underline">
              Browse all use cases <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
        <div className="mx-auto w-full max-w-[1180px] px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-8 2xl:max-w-[1360px]">
          <div className="mx-auto mb-6 flex w-fit items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
            <Checkpoint size={9} />
            <span className="font-mono text-[11px] font-medium text-[#006B45]">Resume, don&apos;t restart</span>
          </div>
          <h2 className="mx-auto max-w-[18ch] text-[34px] font-bold leading-[1.05] tracking-[-0.035em] sm:text-[48px] lg:text-[60px]">
            Build agents your team can trust in production.
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-[16px] leading-[1.65] text-[#4B5563] sm:text-[17px]">
            Not another AI demo. Vectorbea is the durable execution layer for agentic automation — observable,
            recoverable, and debuggable from the first run.
          </p>
          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 min-[420px]:flex-row min-[420px]:flex-wrap min-[420px]:items-center sm:gap-4">
            <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-[#0B0D0F] px-7 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/signin" className="inline-flex items-center justify-center gap-2 rounded-[9px] border bg-white px-7 py-3.5 text-[15px] font-semibold text-[#0B0D0F] transition-colors hover:bg-[#F3F4F5]" style={{ borderColor: "#E0E3E6" }}>
              View a run timeline <ChevronRight className="h-4 w-4 text-[#9CA3AF]" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#F7F8F9" }}>
        <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center justify-between gap-4 px-4 py-10 text-center sm:flex-row sm:px-6 sm:text-left lg:px-8 2xl:max-w-[1360px]">
          <div className="flex items-center gap-2.5">
            <LogoCube size={22} />
            <span className="text-[14px] font-semibold">Vectorbea</span>
          </div>
          <p className="font-mono text-[12px] text-[#9CA3AF]">Durable agentic automation. Built for production.</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2" aria-label="Footer">
            <Link href="/use-cases" className="text-[13px] text-[#6B7280] transition-colors hover:text-[#0B0D0F]">Use cases</Link>
            <Link href="/compare" className="text-[13px] text-[#6B7280] transition-colors hover:text-[#0B0D0F]">Compare</Link>
            <Link href="/docs" className="text-[13px] text-[#6B7280] transition-colors hover:text-[#0B0D0F]">Docs</Link>
            <a href="https://engineering.vectorbea.com" className="text-[13px] text-[#6B7280] transition-colors hover:text-[#0B0D0F]">Engineering</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ── Bento helper ─────────────────────────────────────────────────────────── */
function BentoCard({
  icon: Icon,
  title,
  desc,
  className = "",
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  desc: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-[14px] border bg-white p-5 ${className}`} style={{ borderColor: "#E0E3E6" }}>
      <span className="flex h-9 w-9 items-center justify-center rounded-[9px]" style={{ background: "#E6F4EF", border: "1px solid #9CCFBB", color: "#007F4E" }}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <h3 className="mt-3 text-[15px] font-bold tracking-[-0.01em]">{title}</h3>
      <p className="mt-1.5 flex-1 text-[13px] leading-[1.55] text-[#6B7280]">{desc}</p>
      {children && <div className="mt-3 border-t pt-3" style={{ borderColor: "#ECEEEF" }}>{children}</div>}
    </div>
  );
}

function Bars({ tint = "#007F4E", values }: { tint?: string; values: number[] }) {
  return (
    <div className="mt-2 flex items-end gap-[3px]" style={{ height: 32 }}>
      {values.map((v, i) => (
        <span key={i} className="flex-1 rounded-[2px]" style={{ height: `${v}%`, background: tint, opacity: 0.35 + (i / values.length) * 0.65 }} />
      ))}
    </div>
  );
}
