"use client";
import type { WorkflowRun } from "@/types/runs";
import { JsonViewer } from "../JsonViewer";
import { ThumbsDown, ThumbsUp, Clock } from "lucide-react";

function fmtDate(iso: string | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ApprovalsTab({ run, onAction }: { run: WorkflowRun; onAction: (a: string) => void }) {
  if (run.approvals.length === 0) {
    return <div className="py-12 text-center text-slate-400" style={{ fontSize: 13 }}>No approval gates in this run.</div>;
  }
  return (
    <div className="space-y-4">
      {run.approvals.map(a => {
        const step = run.steps.find(s => s.id === a.stepId);
        return (
          <div key={a.id} className="rounded-2xl border overflow-hidden bg-white"
            style={{ borderColor: a.status === "requested" ? "#FDE68A" : "#E2E8F0" }}>
            <div className="px-4 py-3 flex items-center justify-between"
              style={{ borderBottom: "1px solid #E2E8F0", background: a.status === "requested" ? "#FFFBEB" : "#F8FAFC" }}>
              <div>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>
                  {step?.businessName ?? "Approval gate"}
                </p>
                <p style={{ fontSize: 11.5, color: "#64748B" }}>ID: {a.id} · Assigned to: {a.assignedTo}</p>
              </div>
              <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                style={a.status === "requested" ? { background: "#FFFBEB", color: "#B45309", borderColor: "#FDE68A" }
                  : a.status === "approved" ? { background: "#ECFDF5", color: "#059669", borderColor: "#A7F3D0" }
                  : { background: "#FEF2F2", color: "#B91C1C", borderColor: "#FECACA" }}>
                {a.status}
              </span>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div><span style={{ color: "#94A3B8" }}>Requested by</span><br /><strong>{a.requestedBy}</strong></div>
                <div><span style={{ color: "#94A3B8" }}>Requested at</span><br /><strong>{fmtDate(a.requestedAt)}</strong></div>
                {a.decidedAt && <div><span style={{ color: "#94A3B8" }}>Decided at</span><br /><strong>{fmtDate(a.decidedAt)}</strong></div>}
                {a.decidedBy && <div><span style={{ color: "#94A3B8" }}>Decided by</span><br /><strong>{a.decidedBy}</strong></div>}
                {a.expiresAt && (
                  <div className="col-span-2 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    <span style={{ color: "#B45309" }}>Expires: {fmtDate(a.expiresAt)}</span>
                  </div>
                )}
              </div>
              {a.comment && <p style={{ fontSize: 12.5, color: "#334155" }}><strong>Comment:</strong> {a.comment}</p>}
              {a.payloadSnapshot !== undefined && <JsonViewer data={a.payloadSnapshot} label="Approval payload" />}
              {a.status === "requested" && (
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => onAction("approve")}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#059669] text-[13px] font-semibold text-white hover:bg-[#047857] transition-colors">
                    <ThumbsUp className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button type="button" onClick={() => onAction("reject")}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-[13px] font-semibold text-red-700 hover:bg-red-100 transition-colors">
                    <ThumbsDown className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
