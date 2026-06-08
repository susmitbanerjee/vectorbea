"use client";

import Link from "next/link";
import {
  ArrowRight,
  Terminal,
  GitBranch,
  Bot,
  ShieldCheck,
  RotateCcw,
  Webhook,
  Zap,
  Eye,
  ChevronRight,
} from "lucide-react";
import {
  BrowserShell,
  ProductTopBar,
  CanvasMock,
  MockNode,
} from "@/components/brand/canvas-mock";

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

/* ── Reusable bits ────────────────────────────────────────────────────────── */
function MonoLabel({ children }: { children: React.ReactNode }) {
  return <span className="vb-mono-label">{children}</span>;
}

function MetricBars({ tint = "#007F4E", values }: { tint?: string; values: number[] }) {
  return (
    <div className="flex items-end gap-[3px]" style={{ height: 44 }}>
      {values.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-[2px]"
          style={{ height: `${v}%`, background: tint, opacity: 0.35 + (i / values.length) * 0.65 }}
        />
      ))}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function MarketingPage() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      {/* ── NAV ───────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 w-full backdrop-blur"
        style={{ background: "rgba(247,248,249,0.85)", borderBottom: "1px solid #E0E3E6" }}
      >
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <LogoCube />
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Vectorbea</span>
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {["Product", "Docs", "Pricing", "Changelog"].map((l) => (
                <a key={l} href="#" className="rounded-[7px] px-3 py-1.5 text-[13.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">
                  {l}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/signin" className="text-[13.5px] font-medium text-[#4B5563] transition-colors hover:text-[#0B0D0F]">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#1c1f22]"
            >
              Start free <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1180px] px-6 pt-20 pb-10">
        <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#00A65A" }} />
          <span className="font-mono text-[11px] font-medium tracking-[0.04em] text-[#4B5563]">Early access</span>
        </span>

        <h1 className="mt-7 max-w-[16ch] text-balance font-bold leading-[1.02] tracking-[-0.035em]" style={{ fontSize: "clamp(44px, 6.4vw, 78px)" }}>
          Durable AI workflows that actually finish.
        </h1>

        <p className="mt-6 max-w-[56ch] text-[18px] leading-[1.6] text-[#4B5563]">
          Vectorbea is a visual control plane for long-running agentic workflows — build on a canvas, watch
          every node execute, and resume from a durable checkpoint instead of starting over. No black boxes.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-[9px] bg-[#0B0D0F] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#1c1f22]"
          >
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#" className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#0B0D0F]">
            <Terminal className="h-4 w-4 text-[#6B7280]" /> Read the docs
          </a>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          {["BYOK models", "Human approvals", "Durable retries", "Event-sourced runs"].map((h) => (
            <span key={h} className="flex items-center gap-1.5 text-[13px] text-[#6B7280]">
              <span className="h-1 w-1 rounded-full" style={{ background: "#9CCFBB" }} /> {h}
            </span>
          ))}
        </div>
      </section>

      {/* ── HERO PRODUCT SHOT ─────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1180px] px-6 pb-24">
        <BrowserShell>
          <ProductTopBar />
          <CanvasMock height={520} />
        </BrowserShell>
      </section>

      {/* ── PLATFORM ──────────────────────────────────────────────────────── */}
      <section className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
        <div className="mx-auto w-full max-w-[1180px] px-6 py-24">
          <MonoLabel>The platform</MonoLabel>
          <h2 className="mt-4 max-w-[20ch] font-bold leading-[1.08] tracking-[-0.03em]" style={{ fontSize: "clamp(30px, 4vw, 50px)" }}>
            A canvas, observability, and reliability in one platform.
          </h2>
          <p className="mt-4 max-w-[60ch] text-[17px] leading-[1.6] text-[#4B5563]">
            Click any node to jump to its inputs, prompt, tool calls, and logs. Every change lands in an
            immutable history, and any previous run state is one click away.
          </p>

          {/* 01 — Visual canvas */}
          <div className="mt-14 grid items-stretch gap-5 lg:grid-cols-2">
            <div className="flex flex-col justify-center rounded-[14px] border p-9" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
              <MonoLabel>01 · Visual canvas</MonoLabel>
              <h3 className="mt-3 text-[28px] font-bold tracking-[-0.02em]">See your workflow.</h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-[#4B5563]">
                Every agent, tool, approval, and branch on one production-grade canvas. You get the audit
                trail and rollback of infrastructure-as-code without writing any.
              </p>
            </div>
            <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: "#E0E3E6" }}>
              <div className="vb-canvas-dots relative h-full min-h-[300px]">
                <MockNode
                  style={{ left: 28, top: 36 }}
                  icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#EEF2FF", color: "#4F46E5" }}><Webhook className="h-4 w-4" /></span>}
                  title="webhook-trigger"
                  subtitle="POST /v1/intake"
                  visibility="Public"
                  dotColor="#9CA3AF"
                />
                <MockNode
                  style={{ right: 28, top: 96 }}
                  selected
                  icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#E6F4EF", color: "#007F4E" }}><Bot className="h-4 w-4" /></span>}
                  title="triage-agent"
                  subtitle="claude · BYOK Anthropic"
                  visibility="Private"
                  dotColor="#0F766E"
                />
                <MockNode
                  style={{ left: 70, bottom: 28 }}
                  icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#FFFBEB", color: "#CA8A04" }}><ShieldCheck className="h-4 w-4" /></span>}
                  title="approval-gate"
                  subtitle="waits for human decision"
                  subRows={[{ icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "SLA 24h" }]}
                  dotColor="#CA8A04"
                />
                <svg className="pointer-events-none absolute inset-0 h-full w-full">
                  <path d="M 250 70 C 340 70 320 150 372 150" fill="none" stroke="#8B8F94" strokeWidth="1.5" />
                </svg>
              </div>
            </div>
          </div>

          {/* 02 — Observability */}
          <div className="mt-5 grid items-stretch gap-5 lg:grid-cols-2">
            <div className="grid grid-cols-2 gap-3 rounded-[14px] border p-5" style={{ borderColor: "#E0E3E6", background: "#FAFBFB" }}>
              <div className="rounded-[10px] border bg-white p-4" style={{ borderColor: "#E0E3E6" }}>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9CA3AF]">Tokens</p>
                <p className="mt-1 text-[22px] font-semibold tabular-nums">128.4k</p>
                <div className="mt-3"><MetricBars values={[30, 45, 38, 60, 52, 70, 48, 64, 55, 80, 62, 90]} /></div>
              </div>
              <div className="rounded-[10px] border bg-white p-4" style={{ borderColor: "#E0E3E6" }}>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9CA3AF]">Cost</p>
                <p className="mt-1 text-[22px] font-semibold tabular-nums">$2.41</p>
                <div className="mt-3"><MetricBars tint="#0F766E" values={[40, 35, 55, 42, 60, 48, 70, 52, 66, 58, 74, 68]} /></div>
              </div>
              <div className="col-span-2 rounded-[10px] border bg-white p-4" style={{ borderColor: "#E0E3E6" }}>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#9CA3AF]">Logs</p>
                <div className="space-y-1 font-mono text-[11.5px] leading-[1.7]">
                  <p><span className="text-[#9CA3AF]">12:04:19</span> <span className="text-[#007F4E]">info</span> workflow started</p>
                  <p><span className="text-[#9CA3AF]">12:04:20</span> <span className="text-[#007F4E]">info</span> node triage-agent completed 842ms</p>
                  <p><span className="text-[#9CA3AF]">12:04:22</span> <span className="text-[#CA8A04]">warn</span> retry scheduled for flight-api</p>
                  <p><span className="text-[#9CA3AF]">12:04:23</span> <span className="text-[#DC2626]">error</span> hotel-api returned 500</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center rounded-[14px] border p-9" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
              <MonoLabel>02 · Observability</MonoLabel>
              <h3 className="mt-3 text-[28px] font-bold tracking-[-0.02em]">Watch it run.</h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-[#4B5563]">
                Follow every prompt, tool call, retry, approval, token, and cost in one place. Click a node on
                the canvas and see exactly what it&apos;s doing.
              </p>
            </div>
          </div>

          {/* 03 — Reliability */}
          <div className="mt-5 grid items-stretch gap-5 lg:grid-cols-2">
            <div className="flex flex-col justify-center rounded-[14px] border p-9" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
              <MonoLabel>03 · Reliability</MonoLabel>
              <h3 className="mt-3 text-[28px] font-bold tracking-[-0.02em]">Recover from failure.</h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-[#4B5563]">
                Resume workflows from durable checkpoints instead of restarting from scratch. Retry a single
                node, replay from an event, or roll back to any previous state.
              </p>
            </div>
            <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
              <div className="border-b px-5 py-3" style={{ borderColor: "#ECEEEF" }}>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Run timeline</span>
              </div>
              <div className="space-y-0 p-5">
                {[
                  { c: "#007F4E", t: "WorkflowStarted", s: "schedule · daily 09:00", time: "09:00:01" },
                  { c: "#007F4E", t: "NodeCompleted", s: "triage-agent · 6.2k tokens", time: "09:01:18" },
                  { c: "#CA8A04", t: "RetryScheduled", s: "flight-api · attempt 2/3", time: "09:01:20" },
                  { c: "#0F766E", t: "ApprovalRequested", s: "waiting Finance Ops", time: "09:01:24", last: true },
                ].map((e, i, arr) => (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ background: e.c, boxShadow: `0 0 0 3px ${e.c}1f` }} />
                      {i < arr.length - 1 && <span className="my-1 w-px flex-1" style={{ background: "#E0E3E6" }} />}
                    </div>
                    <div className="pb-4">
                      <p className="font-mono text-[12.5px] font-medium text-[#0B0D0F]">{e.t}</p>
                      <p className="text-[12px] text-[#6B7280]">{e.s} · <span className="text-[#9CA3AF]">{e.time}</span></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ──────────────────────────────────────────────────────── */}
      <section className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#F7F8F9" }}>
        <div className="mx-auto w-full max-w-[1180px] px-6 py-24">
          <MonoLabel>Built for production</MonoLabel>
          <h2 className="mt-4 max-w-[22ch] font-bold leading-[1.08] tracking-[-0.03em]" style={{ fontSize: "clamp(28px, 3.6vw, 46px)" }}>
            Everything an agentic workflow needs to survive the real world.
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: GitBranch, title: "Visual workflow canvas", desc: "Drag-and-drop builder for multi-step agentic workflows. Connect agents, tools, and approval gates." },
              { icon: Bot, title: "Durable agent runs", desc: "Runs checkpoint at every step. Failures resume from the last checkpoint, not the beginning." },
              { icon: ShieldCheck, title: "Human approval gates", desc: "Pause mid-workflow for a human decision with full context and a complete audit trail." },
              { icon: Eye, title: "Immutable event history", desc: "Every tool call, LLM response, retry, and approval recorded in a structured, replayable log." },
              { icon: RotateCcw, title: "Automatic retry & resume", desc: "Configure backoff per node. Failed runs resume from the last successful durable checkpoint." },
              { icon: Zap, title: "Bring your own keys", desc: "Connect your own OpenAI, Anthropic, or Gemini keys — plus your own databases and APIs." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-[12px] border bg-white p-6 transition-shadow hover:shadow-[0_8px_24px_rgba(11,13,15,0.06)]" style={{ borderColor: "#E0E3E6" }}>
                <span className="flex h-10 w-10 items-center justify-center rounded-[10px]" style={{ background: "#E6F4EF", border: "1px solid #9CCFBB", color: "#007F4E" }}>
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <h3 className="mt-4 text-[15.5px] font-bold tracking-[-0.01em]">{title}</h3>
                <p className="mt-2 text-[13.5px] leading-[1.6] text-[#6B7280]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
        <div className="mx-auto w-full max-w-[1180px] px-6 py-28 text-center">
          <h2 className="mx-auto max-w-[18ch] font-bold leading-[1.05] tracking-[-0.035em]" style={{ fontSize: "clamp(34px, 5vw, 64px)" }}>
            Build workflows your team can trust.
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-[17px] leading-[1.6] text-[#4B5563]">
            Not another AI demo. Vectorbea is the production execution layer for agentic automation — durable,
            observable, and debuggable from day one.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link href="/signup" className="inline-flex items-center gap-2 rounded-[9px] bg-[#0B0D0F] px-7 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/signin" className="inline-flex items-center gap-2 rounded-[9px] border bg-white px-7 py-3.5 text-[15px] font-semibold text-[#0B0D0F] transition-colors hover:bg-[#F3F4F5]" style={{ borderColor: "#E0E3E6" }}>
              View run timeline <ChevronRight className="h-4 w-4 text-[#9CA3AF]" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#F7F8F9" }}>
        <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <LogoCube size={22} />
            <span className="text-[14px] font-semibold">Vectorbea</span>
          </div>
          <p className="font-mono text-[12px] text-[#9CA3AF]">Durable agentic automation. Built for production.</p>
          <div className="flex items-center gap-6">
            {["Privacy", "Terms", "Docs"].map((l) => (
              <a key={l} href="#" className="text-[13px] text-[#6B7280] transition-colors hover:text-[#0B0D0F]">{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
