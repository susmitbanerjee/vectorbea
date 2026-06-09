"use client";

/**
 * Vectorbea brand signature elements — the recurring visual language
 * (checkpoint diamond, durable-run rail, dark runtime console, logo cube).
 * Purely presentational. Shared across marketing + auth + empty states.
 */

import { Play, CheckCircle2, RotateCcw, ShieldCheck, Terminal, Diamond, CornerDownLeft } from "lucide-react";

export function LogoCube({ size = 28 }: { size?: number }) {
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

export function Checkpoint({ size = 10 }: { size?: number }) {
  return (
    <span
      className="inline-block rotate-45 rounded-[2px]"
      style={{ width: size, height: size, background: "#FFFFFF", border: "2px solid #007F4E" }}
    />
  );
}

/** Compact durable-run event rail with a checkpoint + resume affordance. */
export function DurableRunPanel({ className = "" }: { className?: string }) {
  const events = [
    { icon: <Play className="h-3 w-3" />, c: "#007F4E", t: "WorkflowStarted", s: "schedule · daily 09:00", time: "09:00:01" },
    { icon: <CheckCircle2 className="h-3 w-3" />, c: "#007F4E", t: "NodeCompleted", s: "triage-agent · 6.2k tokens", time: "09:01:18" },
    { kind: "checkpoint" as const },
    { icon: <RotateCcw className="h-3 w-3" />, c: "#CA8A04", t: "RetryScheduled", s: "flight-api · attempt 2/3", time: "09:01:20" },
    { icon: <ShieldCheck className="h-3 w-3" />, c: "#0F766E", t: "ApprovalRequested", s: "waiting · Finance Ops", time: "09:01:24", live: true },
  ];
  return (
    <div className={`overflow-hidden rounded-[14px] border bg-white ${className}`} style={{ borderColor: "#E0E3E6", boxShadow: "0 18px 44px rgba(11,13,15,0.10)" }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "#ECEEEF" }}>
        <span className="font-mono text-[12px] text-[#6B7280]">run_a1f3 · renewals-ai</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#F0FDFA", borderColor: "#99F6E4", color: "#0F766E" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-teal-500" style={{ animation: "pulse 1.8s ease-in-out infinite" }} />
          Running
        </span>
      </div>
      <div className="px-4 py-4">
        {events.map((e, i) => {
          const last = i === events.length - 1;
          if ("kind" in e) {
            return (
              <div key={i} className="flex gap-3">
                <div className="flex w-[18px] flex-col items-center">
                  <Checkpoint />
                  {!last && <span className="my-1 w-px flex-1" style={{ background: "#9CCFBB", minHeight: 12 }} />}
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
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full" style={{ background: `${e.c}14`, color: e.c, boxShadow: e.live ? `0 0 0 3px ${e.c}1a` : undefined }}>
                  {e.icon}
                </span>
                {!last && <span className="my-1 w-px flex-1" style={{ background: "#E0E3E6", minHeight: 12 }} />}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[12.5px] font-medium text-[#0B0D0F]">{e.t}</p>
                  <span className="font-mono text-[10.5px] text-[#9CA3AF]">{e.time}</span>
                </div>
                <p className="text-[11.5px] text-[#6B7280]">{e.s}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3" style={{ borderColor: "#ECEEEF", background: "#FAFBFB" }}>
        <span className="flex items-center gap-1.5 text-[11.5px] text-[#6B7280]"><Diamond className="h-3 w-3 text-[#007F4E]" /> last checkpoint 09:01:18</span>
        <span className="inline-flex items-center gap-1.5 rounded-[7px] border bg-white px-2.5 py-1 text-[11.5px] font-semibold" style={{ borderColor: "#9CCFBB", color: "#006B45" }}>
          <CornerDownLeft className="h-3 w-3" /> Resume
        </span>
      </div>
    </div>
  );
}

/** Small dark runtime console — the engineering signature accent. */
export function RuntimeConsole({ className = "" }: { className?: string }) {
  const lines = [
    { t: "09:00:01", lvl: "info", c: "#34D399", msg: "run started · trigger=schedule" },
    { t: "09:01:18", lvl: "ckpt", c: "#5EEAD4", msg: "checkpoint persisted seq=14" },
    { t: "09:01:20", lvl: "warn", c: "#FBBF24", msg: "flight-api 429 — retry 2/3" },
    { t: "09:01:24", lvl: "hold", c: "#67E8F9", msg: "awaiting approval finance-ops" },
  ];
  return (
    <div className={`overflow-hidden rounded-[12px] ${className}`} style={{ background: "#0B0D0F", boxShadow: "0 18px 50px rgba(11,13,15,0.30)" }}>
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5" style={{ borderColor: "#1c1f22" }}>
        <Terminal className="h-3.5 w-3.5 text-[#6B7280]" />
        <span className="font-mono text-[11px] text-[#9CA3AF]">runtime · production</span>
        <span className="ml-auto font-mono text-[10px] text-[#4B5563]">durable</span>
      </div>
      <div className="space-y-1 px-3.5 py-3 font-mono text-[11.5px] leading-[1.7]">
        {lines.map((l, i) => (
          <p key={i} className="whitespace-nowrap">
            <span className="text-[#4B5563]">{l.t}</span>{" "}
            <span style={{ color: l.c }}>{l.lvl.padEnd(5, " ")}</span>{" "}
            <span className="text-[#D1D5DB]">{l.msg}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
