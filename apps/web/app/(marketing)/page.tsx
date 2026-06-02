"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, CheckCircle2, RefreshCw, Shield, Zap,
  Activity, Bot, ShieldCheck, GitBranch, Play,
  ChevronRight, Database, AlertTriangle, RotateCcw, Eye,
  Layers, ListChecks,
} from "lucide-react";
import { BeeLogo } from "@/components/brand/bee-logo";

// ─── Bee SVG ─────────────────────────────────────────────────────────────────
function BeeSVG({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
      {/* Body */}
      <ellipse cx="16" cy="18" rx="7" ry="9" fill="#F59E0B" />
      {/* Stripes */}
      <ellipse cx="16" cy="16" rx="7" ry="3.5" fill="#1C1917" opacity="0.8" />
      <ellipse cx="16" cy="21" rx="6" ry="2.5" fill="#1C1917" opacity="0.7" />
      <ellipse cx="16" cy="25.5" rx="4.5" ry="2" fill="#92400E" opacity="0.6" />
      {/* Head */}
      <circle cx="16" cy="9" r="4" fill="#1C1917" />
      {/* Antennae */}
      <line x1="14" y1="6" x2="11" y2="3" stroke="#1C1917" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11" cy="3" r="1" fill="#F59E0B" />
      <line x1="18" y1="6" x2="21" y2="3" stroke="#1C1917" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="21" cy="3" r="1" fill="#F59E0B" />
      {/* Wings */}
      <ellipse cx="8" cy="13" rx="6" ry="3" fill="white" opacity="0.85" transform="rotate(-20 8 13)" />
      <ellipse cx="24" cy="13" rx="6" ry="3" fill="white" opacity="0.85" transform="rotate(20 24 13)" />
    </svg>
  );
}

// ─── Animated bee ─────────────────────────────────────────────────────────────
function FlyingBee({ delay = 0, y = 20, size = 28, speed = 18 }: { delay?: number; y?: number; size?: number; speed?: number }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        top: `${y}%`,
        left: "-60px",
        animation: `flyBee ${speed}s ${delay}s linear infinite`,
        zIndex: 2,
      }}
    >
      <div style={{ animation: `wiggle 0.4s ease-in-out infinite alternate` }}>
        <BeeSVG size={size} />
      </div>
    </div>
  );
}

// ─── Hex cell ─────────────────────────────────────────────────────────────────
function HexCell({ x, y, opacity = 0.06 }: { x: number; y: number; opacity?: number }) {
  return (
    <polygon
      points="30,0 60,17 60,52 30,69 0,52 0,17"
      fill="none"
      stroke="#D97706"
      strokeWidth="1"
      opacity={opacity}
      transform={`translate(${x},${y})`}
    />
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: "succeeded" | "running" | "waiting" }) {
  const v = {
    succeeded: { label: "Succeeded", bg: "#ECFDF5", border: "#BBF7D0", color: "#15803D", dot: "#22C55E" },
    running:   { label: "Running",   bg: "#EFF6FF", border: "#BFDBFE", color: "#1D4ED8", dot: "#3B82F6" },
    waiting:   { label: "Awaiting",  bg: "#FFFBEB", border: "#FDE68A", color: "#92400E", dot: "#F59E0B" },
  }[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: v.bg, border: `1px solid ${v.border}`, color: v.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.dot }} />{v.label}
    </span>
  );
}

// ─── Timeline event ───────────────────────────────────────────────────────────
function TEvent({ icon, title, sub, time, color, last = false }: {
  icon: React.ReactNode; title: string; sub: string; time: string; color: string; last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2"
          style={{ borderColor: color + "40", background: color + "10", color }}>
          {icon}
        </div>
        {!last && <div className="mt-1 w-px flex-1 bg-amber-100" style={{ minHeight: 18 }} />}
      </div>
      <div className="pb-3 flex-1 min-w-0" style={{ paddingTop: 4 }}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[12.5px] font-semibold text-slate-800">{title}</p>
          <span className="shrink-0 font-mono text-[10px] text-slate-400">{time}</span>
        </div>
        <p className="text-[11.5px] text-slate-500 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

// ─── Canvas node ──────────────────────────────────────────────────────────────
function WNode({ icon, label, type, badge, accent = "#2563EB", active }: {
  icon: React.ReactNode; label: string; type: string; badge?: string; accent?: string; active?: boolean;
}) {
  return (
    <div className="rounded-xl px-3 py-2.5 min-w-[150px]"
      style={{
        background: active ? accent + "0f" : "#FAFAFA",
        border: `1.5px solid ${active ? accent + "40" : "#E5E7EB"}`,
        boxShadow: active ? `0 0 0 3px ${accent}12` : "none",
      }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
          style={{ background: accent + "15", color: accent }}>{icon}</span>
        <span className="text-[11.5px] font-bold text-slate-800 leading-tight">{label}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: accent + "aa" }}>{type}</span>
        {badge && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
          style={{ background: accent + "15", color: accent, border: `1px solid ${accent}30` }}>{badge}</span>}
      </div>
    </div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────
function FCard({ icon, title, desc, accent }: { icon: React.ReactNode; title: string; desc: string; accent: string }) {
  return (
    <div className="rounded-2xl p-6 bg-white border border-amber-100 hover:border-amber-200 transition-all hover:shadow-md"
      style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: accent + "12", border: `1.5px solid ${accent}25`, color: accent }}>{icon}</div>
      <h3 className="text-[15px] font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-[13.5px] text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MarketingPage() {
  return (
    <>
      {/* Bee animation keyframes */}
      <style>{`
        @keyframes flyBee {
          0%   { transform: translateX(-60px) translateY(0px); }
          20%  { transform: translateX(20vw) translateY(-30px); }
          40%  { transform: translateX(40vw) translateY(15px); }
          60%  { transform: translateX(60vw) translateY(-20px); }
          80%  { transform: translateX(80vw) translateY(10px); }
          100% { transform: translateX(110vw) translateY(-5px); }
        }
        @keyframes wiggle {
          from { transform: translateY(0px) rotate(-5deg); }
          to   { transform: translateY(-6px) rotate(5deg); }
        }
        @keyframes floatBee {
          0%,100% { transform: translateY(0px) rotate(-3deg); }
          50%     { transform: translateY(-12px) rotate(3deg); }
        }
        @keyframes hexPulse {
          0%,100% { opacity: 0.04; }
          50%     { opacity: 0.12; }
        }
        .hex-pulse { animation: hexPulse 3s ease-in-out infinite; }
        .float-bee { animation: floatBee 3s ease-in-out infinite; }
      `}</style>

      <div className="min-h-screen w-full overflow-x-hidden" style={{ background: "#FFFBF0", color: "#1C1917" }}>

        {/* ── NAV ─────────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 w-full" style={{ background: "rgba(255,251,240,0.92)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(217,119,6,0.12)" }}>
          <div className="flex w-full items-center justify-between gap-4 px-6 py-4 lg:px-16 xl:px-24">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "#FEF3C7", border: "1.5px solid #FDE68A" }}>
                <BeeLogo className="h-4 w-4" />
              </div>
              <span className="text-[15px] font-bold tracking-tight text-slate-900">Vectorbea</span>
            </Link>

            <nav className="hidden items-center gap-1 sm:flex">
              {["Features", "How it works", "Pricing"].map(label => (
                <a key={label} href={`#${label.toLowerCase().replace(/\s/g, "")}`}
                  className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-slate-600 hover:text-amber-700 hover:bg-amber-50 transition-colors">
                  {label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-3 shrink-0">
              <Link href="/signin" className="px-4 py-2 text-[13.5px] font-medium text-slate-600 hover:text-slate-900 transition-colors">
                Sign in
              </Link>
              <Link href="/signup"
                className="flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-[13.5px] font-bold text-white transition-all hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #D97706 0%, #F59E0B 100%)", boxShadow: "0 4px 16px rgba(217,119,6,0.35)" }}>
                Start building →
              </Link>
            </div>
          </div>
        </header>

        {/* ── HERO — full-screen with bees ─────────────────────────────────── */}
        <section className="relative w-full overflow-hidden" style={{ minHeight: "100vh" }}>
          {/* Honeycomb SVG background — full bleed */}
          <svg className="absolute inset-0 w-full h-full" style={{ opacity: 1 }} preserveAspectRatio="xMidYMid slice">
            {/* Tiled hex grid */}
            {Array.from({ length: 12 }).map((_, row) =>
              Array.from({ length: 20 }).map((_, col) => {
                const x = col * 90 - (row % 2 === 0 ? 0 : 45);
                const y = row * 60;
                return <HexCell key={`${row}-${col}`} x={x} y={y} opacity={0.06 + (col + row) % 3 * 0.02} />;
              })
            )}
          </svg>

          {/* Amber radial glow top-center */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] pointer-events-none"
            style={{ background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(251,191,36,0.22) 0%, transparent 70%)" }} />

          {/* Flying bees */}
          <FlyingBee delay={0}  y={15} size={28} speed={22} />
          <FlyingBee delay={4}  y={55} size={20} speed={28} />
          <FlyingBee delay={9}  y={30} size={24} speed={20} />
          <FlyingBee delay={14} y={70} size={18} speed={32} />
          <FlyingBee delay={2}  y={80} size={22} speed={25} />

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 lg:px-16 xl:px-24 pt-28 pb-16" style={{ minHeight: "100vh" }}>
            {/* Badge */}
            <div className="mb-8 inline-flex items-center gap-2 rounded-full px-5 py-2"
              style={{ background: "#FEF3C7", border: "1.5px solid #FDE68A", color: "#92400E" }}>
              <span className="text-base">🐝</span>
              <span className="text-[12px] font-bold tracking-widest uppercase">Agentic Automation Platform</span>
            </div>

            {/* Headline — big and full-width */}
            <h1 className="w-full font-black tracking-[-0.045em] text-stone-900 leading-[1.0] mb-6"
              style={{ fontSize: "clamp(52px, 9vw, 110px)" }}>
              Durable automation<br />
              <span style={{ background: "linear-gradient(135deg, #D97706 0%, #F59E0B 40%, #22C55E 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                for AI agents
              </span>
              <br />
              that must finish.
            </h1>

            <p className="max-w-3xl mx-auto mb-10 text-stone-600 leading-[1.7]"
              style={{ fontSize: "clamp(16px, 1.8vw, 21px)" }}>
              Like a hive where every worker bee knows its job —
              Vectorbea gives AI workflows durable execution, human approval gates,
              automatic retries, and full observability. No black boxes.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
              <Link href="/signup"
                className="flex items-center gap-2 rounded-2xl px-8 py-4 text-[16px] font-black text-white transition-all hover:scale-[1.02] active:scale-[0.99]"
                style={{ background: "linear-gradient(135deg, #D97706 0%, #F59E0B 100%)", boxShadow: "0 8px 32px rgba(217,119,6,0.40), 0 0 0 1px rgba(217,119,6,0.2)" }}>
                Start building free <ArrowRight className="h-5 w-5" />
              </Link>
              <Link href="/signin"
                className="flex items-center gap-2 rounded-2xl px-8 py-4 text-[16px] font-bold text-stone-700 bg-white border border-stone-200 hover:border-amber-300 hover:bg-amber-50/50 transition-all"
                style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                View run timeline <ChevronRight className="h-4 w-4 text-stone-400" />
              </Link>
            </div>

            {/* Trust hints */}
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 mb-16">
              {["BYOK models", "Human approvals", "Durable retries", "Event-sourced runs", "No vendor lock-in"].map(hint => (
                <span key={hint} className="flex items-center gap-1.5 text-[13px] text-stone-500">
                  <span className="text-amber-500">🐝</span> {hint}
                </span>
              ))}
            </div>

            {/* ── Full-width product preview ─────────────────────────────── */}
            <div className="w-full max-w-none rounded-3xl overflow-hidden"
              style={{ border: "1.5px solid rgba(217,119,6,0.2)", background: "white", boxShadow: "0 40px 120px rgba(217,119,6,0.12), 0 8px 32px rgba(0,0,0,0.08)" }}>

              {/* Window chrome */}
              <div className="flex items-center justify-between px-5 py-4" style={{ background: "#FFFBF0", borderBottom: "1px solid rgba(217,119,6,0.12)" }}>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-400" />
                    <div className="h-3 w-3 rounded-full bg-yellow-400" />
                    <div className="h-3 w-3 rounded-full bg-green-400" />
                  </div>
                  <span className="ml-3 text-[13px] font-semibold text-stone-600">Customer Renewal Intelligence</span>
                </div>
                <StatusPill status="running" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px]">
                {/* Canvas */}
                <div className="p-8 space-y-5" style={{ background: "#FAFAF7", borderRight: "1px solid rgba(217,119,6,0.08)" }}>
                  {/* Row 1 */}
                  <div className="flex items-center gap-6 flex-wrap">
                    <WNode icon={<Play className="h-3.5 w-3.5" />} label="Schedule Trigger" type="TRIGGER" badge="Daily" accent="#2563EB" />
                    <div className="flex-1 min-w-[60px] flex items-center gap-1">
                      <div className="flex-1 border-t-2 border-dashed border-stone-200" />
                      <span className="text-stone-300 text-xs">→</span>
                    </div>
                    <WNode icon={<Database className="h-3.5 w-3.5" />} label="Fetch Renewals" type="DB READ" accent="#059669" active />
                  </div>
                  {/* Row 2 */}
                  <div className="flex items-center gap-6 flex-wrap pl-8">
                    <WNode icon={<Bot className="h-3.5 w-3.5" />} label="Risk Scoring Agent" type="LLM · gpt-4o" badge="running" accent="#7C3AED" active />
                    <div className="flex-1 min-w-[60px] flex items-center gap-1">
                      <div className="flex-1 border-t-2 border-dashed border-stone-200" />
                      <span className="text-stone-300 text-xs">→</span>
                    </div>
                    <WNode icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Approval Gate" type="HUMAN APPROVAL" badge="pending" accent="#D97706" />
                  </div>
                  {/* Row 3 */}
                  <div className="flex items-center gap-6 flex-wrap pl-16">
                    <WNode icon={<Activity className="h-3.5 w-3.5" />} label="Notify & Archive" type="HTTP · TOOL" accent="#0891B2" />
                  </div>
                  {/* Little bee workers */}
                  <div className="flex items-center gap-3 pt-2 border-t border-stone-100">
                    <span className="text-[11px] text-stone-400">Hive workers:</span>
                    <div className="flex gap-1">
                      {[0.2, 0.4, 0.6].map((d, i) => (
                        <div key={i} style={{ animation: `floatBee 2.5s ${d}s ease-in-out infinite` }}>
                          <BeeSVG size={20} />
                        </div>
                      ))}
                    </div>
                    <span className="text-[11px] text-stone-400">3 agents active</span>
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(217,119,6,0.08)" }}>
                    <span className="text-[13px] font-bold text-stone-700">Run timeline</span>
                    <span className="font-mono text-[11px] text-stone-400">2m 14s</span>
                  </div>
                  <div className="p-5 space-y-0">
                    <TEvent icon={<Play className="h-3 w-3" />} title="Run started" sub="Schedule trigger · daily 09:00" time="09:00:01" color="#3B82F6" />
                    <TEvent icon={<Database className="h-3 w-3" />} title="Fetched 34 renewals" sub="DB read · 284ms" time="09:00:02" color="#22C55E" />
                    <TEvent icon={<Bot className="h-3 w-3" />} title="Agent completed" sub="Risk scored · 6.2k tokens" time="09:01:18" color="#8B5CF6" />
                    <TEvent icon={<ShieldCheck className="h-3 w-3" />} title="Approval requested" sub="Waiting Finance Ops · 3 high-risk" time="09:01:20" color="#F59E0B" last />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── PROBLEM — warm white full bleed ──────────────────────────────── */}
        <section id="features" className="w-full py-28" style={{ background: "white", borderTop: "1px solid #FEF3C7" }}>
          <div className="w-full px-6 lg:px-16 xl:px-24">
            <div className="mb-16">
              <div className="flex items-center gap-2 mb-4">
                <BeeSVG size={22} />
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-600">The problem</p>
              </div>
              <h2 className="font-black tracking-[-0.035em] text-stone-900 leading-[1.05] mb-5"
                style={{ fontSize: "clamp(32px, 5vw, 64px)" }}>
                AI workflows break when<br />they leave the demo.
              </h2>
              <p className="max-w-xl text-[17px] text-stone-500 leading-relaxed">
                LLM calls are probabilistic. Networks fail. APIs rate-limit.
                Humans need to approve. Most frameworks don&apos;t handle any of this.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {[
                { icon: <Eye className="h-4 w-4" />, title: "Hidden tool calls", desc: "No visibility into what your agent called." },
                { icon: <RotateCcw className="h-4 w-4" />, title: "Manual retries", desc: "Failed steps require human intervention." },
                { icon: <ShieldCheck className="h-4 w-4" />, title: "No approval trail", desc: "Decisions happen inside the agent silently." },
                { icon: <AlertTriangle className="h-4 w-4" />, title: "Hard to debug", desc: "Failure at step 7? Start from scratch." },
                { icon: <Layers className="h-4 w-4" />, title: "Lost state", desc: "Intermediate results vanish on failure." },
                { icon: <Activity className="h-4 w-4" />, title: "Unclear costs", desc: "No per-run token or spend breakdown." },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="rounded-2xl p-5 border border-red-100 bg-red-50/50">
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-red-100 text-red-500">{icon}</div>
                  <h3 className="text-[13.5px] font-bold text-stone-800 mb-1">{title}</h3>
                  <p className="text-[12.5px] text-stone-500 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CAPABILITIES — honey amber full bleed ────────────────────────── */}
        <section id="howItWorks" className="w-full py-28 relative overflow-hidden" style={{ background: "linear-gradient(180deg, #FFFBF0 0%, #FEF3C7 100%)", borderTop: "1px solid #FDE68A" }}>
          {/* Honeycomb decorative */}
          <svg className="absolute right-0 top-0 h-full opacity-[0.07]" width="400" viewBox="0 0 300 800">
            {Array.from({ length: 6 }).map((_, row) =>
              Array.from({ length: 4 }).map((_, col) => (
                <HexCell key={`d-${row}-${col}`} x={col * 90 - (row % 2 === 0 ? 0 : 45)} y={row * 60} />
              ))
            )}
          </svg>

          <div className="relative z-10 w-full px-6 lg:px-16 xl:px-24">
            <div className="mb-16">
              <div className="flex items-center gap-2 mb-4">
                <BeeSVG size={22} />
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-700">The hive</p>
              </div>
              <h2 className="font-black tracking-[-0.035em] text-stone-900 leading-[1.05] mb-5"
                style={{ fontSize: "clamp(32px, 5vw, 64px)" }}>
                Every bee knows its role.<br />
                <span style={{ color: "#D97706" }}>Every step gets done.</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FCard accent="#2563EB" icon={<GitBranch className="h-5 w-5" />} title="Visual workflow canvas" desc="Drag-and-drop builder for multi-step agentic workflows. Connect agents, tools, and approval gates." />
              <FCard accent="#7C3AED" icon={<Bot className="h-5 w-5" />} title="Durable agent runs" desc="Runs checkpoint at every step. Failures retry from the last checkpoint, not the beginning." />
              <FCard accent="#D97706" icon={<ShieldCheck className="h-5 w-5" />} title="Human approval gates" desc="Pause mid-workflow for a human decision with full context and audit trail." />
              <FCard accent="#059669" icon={<ListChecks className="h-5 w-5" />} title="Immutable event history" desc="Every tool call, LLM response, retry, and approval is recorded in a structured log." />
              <FCard accent="#0891B2" icon={<RotateCcw className="h-5 w-5" />} title="Automatic retry & resume" desc="Configure backoff per step. Failed runs resume from the last successful checkpoint." />
              <FCard accent="#F97316" icon={<Zap className="h-5 w-5" />} title="BYOK connections" desc="Connect your own OpenAI, Anthropic, or Gemini keys. Your own databases and APIs too." />
            </div>
          </div>
        </section>

        {/* ── FINAL CTA — full bleed warm ──────────────────────────────────── */}
        <section id="pricing" className="relative w-full py-36 overflow-hidden" style={{ background: "#1C1917", borderTop: "1px solid rgba(217,119,6,0.3)" }}>
          {/* Honeycomb bg */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.05]" preserveAspectRatio="xMidYMid slice">
            {Array.from({ length: 10 }).map((_, row) =>
              Array.from({ length: 18 }).map((_, col) => (
                <HexCell key={`cta-${row}-${col}`} x={col * 90 - (row % 2 === 0 ? 0 : 45)} y={row * 60} />
              ))
            )}
          </svg>
          {/* Glow */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(251,191,36,0.15) 0%, transparent 70%)" }} />

          {/* Floating bee cluster */}
          <div className="absolute right-16 top-1/3 flex gap-3 opacity-40">
            {[0, 0.8, 1.6].map((d, i) => (
              <div key={i} style={{ animation: `floatBee 3s ${d}s ease-in-out infinite` }}>
                <BeeSVG size={32} />
              </div>
            ))}
          </div>

          <div className="relative z-10 w-full text-center px-6 lg:px-16 xl:px-24">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2"
              style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", color: "#FCD34D" }}>
              <BeeSVG size={18} /> <span className="text-[12px] font-bold">Join the hive</span>
            </div>
            <h2 className="font-black tracking-[-0.04em] text-white leading-[1.0] mb-6"
              style={{ fontSize: "clamp(40px, 6vw, 80px)" }}>
              Build workflows your<br />
              <span style={{ background: "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                team can trust.
              </span>
            </h2>
            <p className="max-w-2xl mx-auto mb-12 leading-relaxed"
              style={{ fontSize: "clamp(16px, 1.5vw, 20px)", color: "rgba(255,255,255,0.5)" }}>
              Not another AI demo. Vectorbea is the production execution layer for agentic automation.
              Durable, observable, and debuggable from day one.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
              <Link href="/signup"
                className="flex items-center gap-2 rounded-2xl px-10 py-5 text-[16px] font-black text-stone-900 transition-all hover:scale-[1.02]"
                style={{ background: "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)", boxShadow: "0 8px 32px rgba(251,191,36,0.35)" }}>
                Create your first workflow <ArrowRight className="h-5 w-5" />
              </Link>
              <Link href="/signin"
                className="rounded-2xl px-10 py-5 text-[16px] font-bold transition-all"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)" }}>
                Sign in
              </Link>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
              {["Free to start", "Bring your own keys", "No usage lock-in", "Cancel anytime"].map(hint => (
                <span key={hint} className="flex items-center gap-1.5 text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                  <CheckCircle2 className="h-3.5 w-3.5 text-amber-500/50" /> {hint}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <footer className="w-full py-10" style={{ background: "#1C1917", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex w-full flex-col items-center justify-between gap-4 px-6 sm:flex-row lg:px-16 xl:px-24">
            <div className="flex items-center gap-2.5">
              <BeeSVG size={22} />
              <span className="text-[14px] font-semibold text-stone-400">Vectorbea</span>
            </div>
            <p className="text-[12.5px] text-stone-600">Durable agentic automation. Built for production.</p>
            <div className="flex items-center gap-6">
              {["Privacy", "Terms", "Docs"].map(link => (
                <a key={link} href={`/${link.toLowerCase()}`}
                  className="text-[12.5px] text-stone-600 hover:text-stone-400 transition-colors">{link}</a>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
