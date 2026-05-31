"use client";
import type { StepStatus, RunStatus } from "@/types/runs";
import { cn } from "@/lib/utils";

type AnyStatus = StepStatus | RunStatus;

const CFG: Record<string, { bg: string; text: string; border: string; dot?: string; pulse?: boolean; label: string }> = {
  queued:                { bg: "#F8FAFC", text: "#475569", border: "#E2E8F0", dot: "#94A3B8", label: "Queued" },
  running:               { bg: "#EFF6FF", text: "#2563EB", border: "#BFDBFE", dot: "#2563EB", pulse: true, label: "Running" },
  waiting:               { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", dot: "#D97706", pulse: true, label: "Waiting" },
  waiting_for_approval:  { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", dot: "#D97706", pulse: true, label: "Awaiting Approval" },
  waiting_for_signal:    { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", dot: "#D97706", label: "Waiting for Signal" },
  retrying:              { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA", dot: "#EA580C", pulse: true, label: "Retrying" },
  self_correcting:       { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE", dot: "#7C3AED", pulse: true, label: "Self-correcting" },
  completed:             { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0", dot: "#10B981", label: "Completed" },
  failed:                { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA", dot: "#EF4444", label: "Failed" },
  skipped:               { bg: "#F8FAFC", text: "#64748B", border: "#E2E8F0", dot: "#94A3B8", label: "Skipped" },
  cancelled:             { bg: "#F8FAFC", text: "#64748B", border: "#E2E8F0", dot: "#94A3B8", label: "Cancelled" },
  timed_out:             { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA", dot: "#EF4444", label: "Timed Out" },
  budget_exceeded:       { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA", dot: "#EF4444", label: "Budget Exceeded" },
  rate_limited:          { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA", dot: "#EA580C", label: "Rate Limited" },
  recovering:            { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE", dot: "#7C3AED", pulse: true, label: "Recovering" },
  partially_completed:   { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", dot: "#D97706", label: "Partial" },
  continued_as_new:      { bg: "#EFF6FF", text: "#2563EB", border: "#BFDBFE", dot: "#2563EB", label: "Continued" },
};

export function StatusBadge({ status, size = "sm" }: { status: AnyStatus; size?: "xs" | "sm" | "md" }) {
  const cfg = CFG[status] ?? CFG.queued;
  const sizes = { xs: "px-1.5 py-px text-[10px]", sm: "px-2 py-0.5 text-[11px]", md: "px-2.5 py-1 text-[12px]" };
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border font-semibold", sizes[size])}
      style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.pulse && "animate-pulse")}
        style={{ background: cfg.dot }}
      />
      {cfg.label}
    </span>
  );
}
