"use client";
import type { WorkflowRun, RunStep, ViewMode } from "@/types/runs";
import { StatusBadge } from "./StatusBadge";
import { StepTypeIcon } from "./StepTypeIcon";
import { JsonViewer } from "./JsonViewer";
import { RotateCcw, Shield, ThumbsDown, ThumbsUp } from "lucide-react";

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtMs(ms: number | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <span style={{ fontSize: 11.5, color: "#64748B", fontWeight: 600, minWidth: 110 }}>{label}</span>
      <span style={{ fontSize: 12, color: "#0F172A", fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function BusinessPanel({ step, run, onAction }: { step: RunStep; run: WorkflowRun; onAction: (a: string) => void }) {
  const approval = run.approvals.find(a => a.id === step.approvalId);
  return (
    <div className="space-y-4">
      <p style={{ fontSize: 14, color: "#334155", lineHeight: 1.6 }}>{step.businessDescription}</p>

      {step.status === "waiting_for_approval" && approval && (
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #FDE68A", background: "#FFFBEB" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid #FDE68A" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>Approval required</p>
          </div>
          <div className="p-4 space-y-3">
            {step.input !== undefined && (
              <div>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", marginBottom: 6 }}>Recommendation for review:</p>
                <div className="rounded-xl border border-amber-200 bg-white p-3">
                  {typeof step.input === "object" && step.input !== null && "recommendation" in step.input && (
                    <p style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>{(step.input as Record<string, unknown>).recommendation as string}</p>
                  )}
                </div>
              </div>
            )}
            <p style={{ fontSize: 11.5, color: "#78716C" }}>Requested: {fmtDate(approval.requestedAt)}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => onAction("approve")}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#059669] text-[13px] font-semibold text-white hover:bg-[#047857] transition-colors">
                <ThumbsUp className="h-3.5 w-3.5" /> Approve
              </button>
              <button type="button" onClick={() => onAction("reject")}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-[13px] font-semibold text-red-700 hover:bg-red-100 transition-colors">
                <ThumbsDown className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {step.error && (
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #FECACA", background: "#FEF2F2" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid #FECACA" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#B91C1C" }}>Step failed</p>
          </div>
          <div className="p-4 space-y-2">
            <p style={{ fontSize: 13, color: "#334155" }}>{step.error.message}</p>
            {step.error.impact && <p style={{ fontSize: 12, color: "#64748B" }}><strong>Impact:</strong> {step.error.impact}</p>}
            {step.error.retryable && (
              <button type="button" onClick={() => onAction("retry_step")}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 text-[12px] font-semibold text-white hover:bg-[#1D4ED8] transition-colors">
                <RotateCcw className="h-3.5 w-3.5" /> Retry this step
              </button>
            )}
          </div>
        </div>
      )}

      {step.attemptCount > 1 && !step.error && (
        <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
          <Shield className="h-4 w-4 text-violet-600 shrink-0" />
          <p style={{ fontSize: 12.5, color: "#5B21B6" }}>
            Vectorbea automatically recovered from {step.attemptCount - 1} temporary {step.attemptCount - 1 === 1 ? "failure" : "failures"}.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Time spent</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginTop: 2 }}>{fmtMs(step.durationMs)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Status</p>
          <div className="mt-1.5"><StatusBadge status={step.status} size="sm" /></div>
        </div>
      </div>
    </div>
  );
}

function EngineeringPanel({ step, run, onAction }: { step: RunStep; run: WorkflowRun; onAction: (a: string) => void }) {
  const approval = run.approvals.find(a => a.id === step.approvalId);
  return (
    <div className="space-y-4">
      {/* Core metadata */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>Step Metadata</span>
        </div>
        <div className="px-3 py-1">
          <Field label="Step ID" value={<code className="font-mono text-[11px]">{step.id}</code>} />
          <Field label="Type" value={step.type} />
          <Field label="Start" value={fmtDate(step.startedAt)} />
          <Field label="End" value={fmtDate(step.endedAt)} />
          <Field label="Duration" value={fmtMs(step.durationMs)} />
          <Field label="Attempts" value={`${step.attemptCount}${step.maxAttempts ? ` / ${step.maxAttempts}` : ""}`} />
          {step.workerId && <Field label="Worker" value={<code className="font-mono text-[11px]">{step.workerId}</code>} />}
          {step.queueName && <Field label="Queue" value={<code className="font-mono text-[11px]">{step.queueName}</code>} />}
          {step.model && <Field label="Model" value={step.model} />}
          {step.promptVersion && <Field label="Prompt ver." value={step.promptVersion} />}
          {step.tokens != null && <Field label="Tokens" value={step.tokens.toLocaleString()} />}
          {step.costUsd != null && <Field label="Cost" value={`$${step.costUsd.toFixed(4)}`} />}
          <Field label="Replay safe" value={
            <span style={{ color: step.isReplaySafe ? "#059669" : "#B91C1C", fontWeight: 600 }}>
              {step.isReplaySafe ? "Yes" : "No"}
            </span>
          } />
        </div>
      </div>

      {/* Retry policy */}
      {step.retryPolicy && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>Retry Policy</span>
          </div>
          <div className="px-3 py-1">
            <Field label="Strategy" value={step.retryPolicy.strategy} />
            <Field label="Max attempts" value={step.retryPolicy.maxAttempts} />
            <Field label="Current" value={step.retryPolicy.currentAttempt} />
            {step.retryPolicy.nextRetryAt && <Field label="Next retry" value={fmtDate(step.retryPolicy.nextRetryAt)} />}
            {step.retryPolicy.backoffSeconds != null && <Field label="Backoff" value={`${step.retryPolicy.backoffSeconds}s`} />}
          </div>
        </div>
      )}

      {/* Error */}
      {step.error && (
        <div className="rounded-xl border border-red-200 overflow-hidden bg-red-50">
          <div className="px-3 py-2 border-b border-red-200">
            <span style={{ fontSize: 11, fontWeight: 700, color: "#B91C1C", textTransform: "uppercase", letterSpacing: "0.06em" }}>Error</span>
          </div>
          <div className="px-3 py-2 space-y-2">
            <p style={{ fontSize: 12, fontWeight: 700, color: "#B91C1C" }}>{step.error.code}</p>
            <p style={{ fontSize: 12, color: "#334155" }}>{step.error.message}</p>
            {step.error.rootCause && <p style={{ fontSize: 11.5, color: "#64748B" }}><strong>Root cause:</strong> {step.error.rootCause}</p>}
            {step.error.stackTrace && (
              <pre className="overflow-auto rounded-xl bg-white p-2 font-mono text-[10.5px] text-red-700" style={{ maxHeight: 120 }}>
                {step.error.stackTrace}
              </pre>
            )}
            {step.error.retryable && (
              <button type="button" onClick={() => onAction("retry_step")}
                className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 text-[12px] font-semibold text-white hover:bg-[#1D4ED8] transition-colors">
                <RotateCcw className="h-3.5 w-3.5" /> Retry step
              </button>
            )}
          </div>
        </div>
      )}

      {/* Approval */}
      {approval && (
        <div className="rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-200">
            <span style={{ fontSize: 11, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.06em" }}>Approval</span>
          </div>
          <div className="px-3 py-1">
            <Field label="ID" value={<code className="font-mono text-[11px]">{approval.id}</code>} />
            <Field label="Status" value={<StatusBadge status={approval.status === "requested" ? "waiting_for_approval" : approval.status === "approved" ? "completed" : "failed"} size="xs" />} />
            <Field label="Requested" value={fmtDate(approval.requestedAt)} />
            <Field label="Assigned to" value={approval.assignedTo} />
            {approval.expiresAt && <Field label="Expires" value={fmtDate(approval.expiresAt)} />}
          </div>
          {approval.status === "requested" && (
            <div className="px-3 pb-3 flex gap-2">
              <button type="button" onClick={() => onAction("approve")}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-xl bg-[#059669] text-[12px] font-semibold text-white hover:bg-[#047857] transition-colors">
                <ThumbsUp className="h-3 w-3" /> Approve
              </button>
              <button type="button" onClick={() => onAction("reject")}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50 text-[12px] font-semibold text-red-700 hover:bg-red-100 transition-colors">
                <ThumbsDown className="h-3 w-3" /> Reject
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input / Output */}
      {step.input !== undefined && <JsonViewer data={step.input} label="Input" />}
      {step.output !== undefined && <JsonViewer data={step.output} label="Output" />}
    </div>
  );
}

export function StepDetailsPanel({
  run, stepId, viewMode, onAction,
}: {
  run: WorkflowRun; stepId: string | null; viewMode: ViewMode; onAction: (a: string) => void;
}) {
  const step = run.steps.find(s => s.id === stepId);

  if (!step) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center rounded-2xl border border-slate-200 bg-white px-6">
        <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
          <span style={{ fontSize: 20 }}>→</span>
        </div>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: "#334155" }}>Select a step</p>
        <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>Click any step in the timeline to see details</p>
      </div>
    );
  }

  const name = viewMode === "business" ? step.businessName : step.name;

  return (
    <div
      className="rounded-2xl bg-white overflow-hidden"
      style={{ border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(15,23,42,0.04)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>
        <StepTypeIcon type={step.type} size={32} />
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }} className="truncate">{name}</p>
          <StatusBadge status={step.status} size="xs" />
        </div>
      </div>

      <div className="p-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 400px)" }}>
        {viewMode === "business"
          ? <BusinessPanel step={step} run={run} onAction={onAction} />
          : <EngineeringPanel step={step} run={run} onAction={onAction} />
        }
      </div>
    </div>
  );
}
