"use client";

/**
 * /agent-runs/mock-waiting-approval
 *
 * Static demo — Contract Compliance Review run WAITING_FOR_APPROVAL.
 * Approval tab is surfaced by default to show the pending gate.
 * No API calls.
 */

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { RunHeaderV2 } from "@/components/agent-runs/v2/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/v2/RunSummaryCards";
import { RunDetailTabsV2 } from "@/components/agent-runs/v2/RunDetailTabsV2";
import { scenarioCMock } from "@/mocks/preproduction-agent-run.mock";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

export default function MockWaitingApprovalPage() {
  const [model, setModel] = useState<AgentRunUiModel>(scenarioCMock);

  function handleApprove() {
    toast.success("Approved (mock) — in production this would resume the run.", {
      description: "Connect to POST /api/approvals/:id/approve to enable.",
    });
    // Update model to show APPROVED state (mock only)
    setModel((prev) => ({
      ...prev,
      run: { ...prev.run, status: "RUNNING", currentStep: "Sending redlines to Acme Corp…" },
      approvals: prev.approvals.map((a) =>
        a.id === "appr-ccr-001"
          ? { ...a, status: "APPROVED", decidedBy: "Demo Owner", decidedAt: new Date().toISOString(), decisionReason: "Reviewed and approved for send" }
          : a,
      ),
      timelineEvents: [
        ...prev.timelineEvents,
        {
          id: "c-ev-24",
          sequence: prev.timelineEvents.length + 1,
          type: "APPROVAL_APPROVED",
          status: "SUCCEEDED",
          source: "HUMAN",
          title: "Approval granted — Send redlines to Acme Corp",
          summary: "Reviewed and approved for send",
          timestamp: new Date().toISOString(),
          actorName: "Demo Owner",
          approval: { id: "appr-ccr-001", title: "Send redlines to Acme Corp", message: "", status: "APPROVED", decidedBy: "Demo Owner", decidedAt: new Date().toISOString(), decisionReason: "Reviewed and approved for send" },
        },
      ],
    }));
  }

  function handleReject() {
    toast.error("Rejected (mock) — in production this would stop the run.", {
      description: "Connect to POST /api/approvals/:id/reject to enable.",
    });
    setModel((prev) => ({
      ...prev,
      run: { ...prev.run, status: "FAILED", errorMessage: "Approval rejected by operator." },
      approvals: prev.approvals.map((a) =>
        a.id === "appr-ccr-001"
          ? { ...a, status: "REJECTED", decidedBy: "Demo Owner", decidedAt: new Date().toISOString(), decisionReason: "Do not send to counterparty yet — revise clause 4.2 first" }
          : a,
      ),
    }));
  }

  const isPending = model.approvals.some((a) => a.status === "PENDING");

  return (
    <div className="min-h-full">
      {/* Banner */}
      <div className="border-b border-amber-500/20 bg-amber-500/[0.04] px-6 py-3 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600/80 dark:text-amber-400/80">
                Demo scenario · Waiting for approval
              </p>
              <p className="text-xs text-muted-foreground">
                Run paused at approval gate. Review the proposed action before the agent continues.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isPending && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApprove}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                >
                  Approve (mock)
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-500/20 transition-colors"
                >
                  Reject (mock)
                </button>
              </div>
            )}
            <div className="flex items-center gap-3 border-l border-border/50 pl-3">
              <Link href="/agent-runs/mock" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                ← Success scenario
              </Link>
              <Link href="/agent-runs/mock-failed" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                Failed scenario →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pb-16 pt-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <RunHeaderV2 model={model} isMock />
          <RunSummaryCards model={model} />
          {/* Default to approvals tab to surface the pending gate */}
          <RunDetailTabsV2 model={model} defaultTab="approvals" />

          <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Developer note</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Static mock from{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">mocks/preproduction-agent-run.mock.ts</code>
              {" "}· scenario C (scenarioCMock). Approve/Reject buttons are mock-only.
              Connect real actions via{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">POST /api/approvals/:id/approve</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
