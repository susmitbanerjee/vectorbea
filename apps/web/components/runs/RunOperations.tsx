"use client";

/**
 * The three operations, as three controls.
 *
 * Until this component existed the UI offered roughly one button for three
 * operations with three different costs. The one it offered was labelled "Replay"
 * and did a full re-execution: it called every provider again, charged for every
 * token again, and re-fired every side effect. A user who pressed it on a
 * workflow that sends email sent the email twice.
 *
 * So the labelling rule here is strict, and it is the point of the component:
 * **every control states what it calls, what it costs, and whether side effects
 * fire.** Not in a tooltip — on the control. A user should never have to know
 * our architecture to predict what a button will do to their bill.
 *
 * See docs/architecture/REPLAY-AUDIT.md.
 */

import { useState } from "react";
import { RotateCcw, RefreshCw, Play, AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type RunOperation = "replay" | "retry" | "rerun";

interface Props {
  runId: string;
  /** Whether the run has recorded model calls. Without them, replay is impossible. */
  replayable: boolean;
  /** Number of recorded provider calls, shown so "free" is credible rather than asserted. */
  recordedCalls?: number;
  /** Whether the run stopped somewhere resumable. */
  resumable: boolean;
  onRun: (op: RunOperation, opts?: { untilNode?: string }) => Promise<void> | void;
  className?: string;
}

interface OperationSpec {
  op: RunOperation;
  label: string;
  icon: typeof RotateCcw;
  /** One line: what it does. */
  what: string;
  /** The consequence, stated plainly. This is the part that must never be vague. */
  cost: string;
  /** Whether providers are called — drives the colour and the confirm step. */
  callsProvider: boolean;
  tone: "safe" | "caution" | "danger";
}

const OPERATIONS: OperationSpec[] = [
  {
    op: "replay",
    label: "Replay",
    icon: RotateCcw,
    what: "Reconstruct this run from its recording, exactly as it happened.",
    cost: "No provider calls. No side effects. No cost.",
    callsProvider: false,
    tone: "safe",
  },
  {
    op: "retry",
    label: "Retry from checkpoint",
    icon: RefreshCw,
    what: "Resume from the last checkpoint and finish the remaining work.",
    cost: "Calls providers for the remaining nodes. Incurs cost. Side effects from those nodes fire.",
    callsProvider: true,
    tone: "caution",
  },
  {
    op: "rerun",
    label: "Re-run",
    icon: Play,
    what: "Execute again from the trigger with current data. Creates a new run.",
    cost: "Calls every provider again. Full cost. Every side effect fires again — including emails.",
    callsProvider: true,
    tone: "danger",
  },
];

const TONE: Record<OperationSpec["tone"], { border: string; accent: string; button: string }> = {
  safe: {
    border: "border-[#D1FAE5] hover:border-[#6EE7B7]",
    accent: "text-[#047857]",
    button: "bg-[#047857] hover:bg-[#036049] text-white",
  },
  caution: {
    border: "border-[#FDE68A] hover:border-[#FCD34D]",
    accent: "text-[#B45309]",
    button: "bg-[#B45309] hover:bg-[#92400E] text-white",
  },
  danger: {
    border: "border-[#FECACA] hover:border-[#FCA5A5]",
    accent: "text-[#B91C1C]",
    button: "bg-[#B91C1C] hover:bg-[#991B1B] text-white",
  },
};

export function RunOperations({
  runId, replayable, recordedCalls, resumable, onRun, className,
}: Props) {
  const [busy, setBusy] = useState<RunOperation | null>(null);
  // Only the operations that spend money ask twice. Confirming a free, read-only
  // action trains people to click through confirmations, which is how the
  // expensive one gets clicked through too.
  const [confirming, setConfirming] = useState<RunOperation | null>(null);

  const disabledReason = (op: RunOperation): string | null => {
    if (op === "replay" && !replayable) {
      return "This run has no recorded model calls, so it cannot be replayed. Runs from before call recording was enabled are not replayable.";
    }
    if (op === "retry" && !resumable) {
      return "This run has no checkpoint to resume from.";
    }
    return null;
  };

  const act = async (op: RunOperation) => {
    setBusy(op);
    try {
      await onRun(op);
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      {OPERATIONS.map((spec) => {
        const tone = TONE[spec.tone];
        const disabled = disabledReason(spec.op);
        const isConfirming = confirming === spec.op;
        const Icon = spec.icon;

        return (
          <div
            key={spec.op}
            className={cn(
              "rounded-[10px] border bg-white p-3.5 transition-colors",
              disabled ? "border-[#E5E7EB] opacity-60" : tone.border,
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Icon className={cn("h-3.5 w-3.5", disabled ? "text-[#9CA3AF]" : tone.accent)} />
                  <span className="text-[13px] font-semibold text-[#111827]">{spec.label}</span>
                  {spec.op === "replay" && replayable && recordedCalls != null && (
                    // The count is what makes "no cost" believable. "Free" as a
                    // bare claim invites doubt; "reconstructed from 8 recorded
                    // calls" explains why it is free.
                    <span className="rounded-full bg-[#ECFDF5] px-1.5 py-px text-[10.5px] font-medium text-[#047857]">
                      {recordedCalls} recorded calls
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-[1.5] text-[#4B5563]">{spec.what}</p>
                <p
                  className={cn(
                    "mt-1 text-[11.5px] font-medium leading-[1.5]",
                    spec.callsProvider ? tone.accent : "text-[#047857]",
                  )}
                >
                  {spec.cost}
                </p>
                {disabled && (
                  <p className="mt-1.5 text-[11.5px] leading-[1.5] text-[#6B7280]">{disabled}</p>
                )}
              </div>

              <div className="shrink-0">
                {isConfirming ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => act(spec.op)}
                      disabled={busy != null}
                      className={cn(
                        "inline-flex h-8 items-center gap-1 rounded-[8px] px-3 text-[12px] font-semibold transition-colors disabled:opacity-50",
                        tone.button,
                      )}
                    >
                      <Check className="h-3 w-3" />
                      {busy === spec.op ? "Starting…" : "Yes, run it"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="inline-flex h-8 items-center rounded-[8px] border border-[#E5E7EB] px-3 text-[12px] font-medium text-[#4B5563] transition-colors hover:bg-[#F9FAFB]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => (spec.callsProvider ? setConfirming(spec.op) : act(spec.op))}
                    disabled={!!disabled || busy != null}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      disabled ? "bg-[#E5E7EB] text-[#9CA3AF]" : tone.button,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {busy === spec.op ? "Starting…" : spec.label}
                  </button>
                )}
              </div>
            </div>

            {isConfirming && spec.op === "rerun" && (
              <div className="mt-2.5 flex items-start gap-1.5 rounded-[8px] bg-[#FEF2F2] p-2.5">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[#B91C1C]" />
                <p className="text-[11.5px] leading-[1.5] text-[#7F1D1D]">
                  This sends any emails, webhooks and database writes in the workflow a
                  second time. To inspect what happened without side effects, use Replay.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
