"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle, ShieldCheck, RefreshCw, ArrowRight, Bot, Pause } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Chip, FilterTabs, EmptyHint, Diamond } from "@/components/ui/page-kit";
import {
  getApprovals,
  approveRunGate,
  rejectRunGate,
  type ApprovalItem,
} from "@/lib/repository";

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

function fmtTime(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Render an approval message that may contain unresolved {{steps.x.output.y}}
 * template expressions. Instead of dumping the raw token, show a readable
 * field chip (last path segment, humanized) — values resolve at runtime.
 */
function TemplateText({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  const hasTokens = parts.length > 1;
  return (
    <div>
      <p className="text-[13px] leading-[1.9] text-[#374151]">
        {parts.map((part, i) => {
          const m = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(part);
          if (!m) return <span key={i}>{part}</span>;
          const path = m[1]!;
          const segs = path.split(".");
          const field = (segs[segs.length - 1] ?? path).replace(/[_-]/g, " ");
          // "steps.risk_scorer.output.risk_score" → source "risk scorer"
          const source = segs[0] === "steps" && segs.length > 2 ? segs[1]!.replace(/[_-]/g, " ") : null;
          return (
            <span
              key={i}
              title={source ? `From step "${source}" — resolves at runtime` : "Resolves at runtime"}
              className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-[6px] border border-[#BFDBD2] bg-[#EFF7F3] px-1.5 py-px align-middle font-mono text-[11px] font-medium leading-[1.6] text-[#0E6E4C]"
            >
              <Diamond size={6} />
              {field}
            </span>
          );
        })}
      </p>
      {hasTokens && (
        <p className="mt-1.5 font-mono text-[10.5px] text-[#9CA3AF]">
          highlighted fields are filled from step outputs when the run reaches this gate
        </p>
      )}
    </div>
  );
}

function statusChip(status: ApprovalItem["status"]) {
  switch (status) {
    case "PENDING":  return <Chip tone="amber" pulse>Awaiting decision</Chip>;
    case "APPROVED": return <Chip tone="green">Approved</Chip>;
    case "REJECTED": return <Chip tone="red">Rejected</Chip>;
    default:         return <Chip tone="gray">{status}</Chip>;
  }
}

// Mini "run paused at gate" timeline — the distinctive durable framing.
function PausedTimeline({ nodeId }: { nodeId?: string | null }) {
  const steps = [
    { label: "agent", done: true },
    { label: "checkpoint", checkpoint: true },
    { label: nodeId ? nodeId.slice(0, 14) : "approval", current: true },
    { label: "resume", pending: true },
  ];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto rounded-[8px] border border-[#FDE68A] bg-[#FFFDF5] px-3 py-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {s.checkpoint ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#006B45]"><Diamond size={8} /> {s.label}</span>
          ) : s.current ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#B45309]">
              <Pause className="h-3 w-3" /> {s.label}
            </span>
          ) : (
            <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${s.done ? "text-[#047857]" : "text-[#9CA3AF]"}`}>
              {s.done && <CheckCircle2 className="h-3 w-3" />} {s.label}
            </span>
          )}
          {i < steps.length - 1 && <span className="text-[#C9CED4]">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [total, setTotal]         = useState(0);
  const [filter, setFilter]       = useState<StatusFilter>("PENDING");
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [actingId, setActingId]   = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const page = await getApprovals({ status: filter === "ALL" ? undefined : filter, pageSize: 50 });
      setApprovals(page.items ?? []);
      setTotal(page.total ?? 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.error("[approvals] load failed:", msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function handleApprove(approval: ApprovalItem) {
    setActingId(approval.id);
    try {
      await approveRunGate(approval.runId, approval.id);
      toast.success("Approved");
      void load(true);
    } catch {
      toast.error("Failed to approve.");
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(approval: ApprovalItem) {
    setActingId(approval.id);
    try {
      await rejectRunGate(approval.runId, approval.id);
      toast.success("Rejected");
      void load(true);
    } catch {
      toast.error("Failed to reject.");
    } finally {
      setActingId(null);
    }
  }

  const FILTER_OPTS = [
    { value: "PENDING", label: "Pending" },
    { value: "APPROVED", label: "Approved" },
    { value: "REJECTED", label: "Rejected" },
    { value: "ALL", label: "All" },
  ];
  const pendingCount = approvals.filter((a) => a.status === "PENDING").length;

  return (
    <div className="page-shell space-y-5">
      {/* Header — distinctive governance banner */}
      <div className="overflow-hidden rounded-[14px] border border-[#E0E3E6] bg-white">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-[#FDE68A] bg-[#FFFBEB] text-[#CA8A04]">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <span className="vb-mono-label">Governance</span>
              <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-[-0.025em] text-[#0B0D0F]">Approval gates</h1>
              <p className="mt-1 max-w-[52ch] text-[13.5px] text-[#6B7280]">
                Runs pause at a gate and <span className="font-medium text-[#0B0D0F]">resume from the last checkpoint</span> once a human decides — no work is lost while waiting.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:flex-col sm:items-end">
            <div className="text-right">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#9CA3AF]">Waiting</p>
              <p className="text-[28px] font-semibold leading-none tabular-nums text-[#B45309]">{loading ? "…" : pendingCount}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Filter + count */}
      <div className="flex items-center justify-between gap-3">
        <FilterTabs options={FILTER_OPTS} value={filter} onChange={(v) => setFilter(v as StatusFilter)} />
        {total > 0 && <span className="font-mono text-[12px] text-[#9CA3AF]">{total} gate{total !== 1 ? "s" : ""}</span>}
      </div>

      {error && (
        <div className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
          <strong>Failed to load approvals:</strong> {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-[150px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />)}</div>
      ) : approvals.length === 0 ? (
        <EmptyHint
          icon={CheckCircle2}
          title={filter === "PENDING" ? "No gates waiting" : "No approvals found"}
          desc={filter === "PENDING" ? "Every run is proceeding without human intervention." : "Try a different filter above."}
        />
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => {
            const pending = a.status === "PENDING";
            return (
              <div key={a.id} className="overflow-hidden rounded-[12px] border bg-white" style={{ borderColor: pending ? "#FDE68A" : "#E0E3E6" }}>
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border"
                      style={pending ? { background: "#FFFBEB", borderColor: "#FDE68A", color: "#CA8A04" } : a.status === "APPROVED" ? { background: "#E6F4EF", borderColor: "#9CCFBB", color: "#007F4E" } : { background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                      {a.status === "REJECTED" ? <XCircle className="h-4 w-4" /> : a.status === "APPROVED" ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    </span>
                    <h3 className="text-[14.5px] font-semibold text-[#0B0D0F]">{a.nodeId ? `Approval · ${a.nodeId}` : "Manager approval gate"}</h3>
                    {statusChip(a.status)}
                    <Link href={`/runs/${a.runId}` as never} className="ml-auto inline-flex items-center gap-1 font-mono text-[12px] text-[#007F4E] hover:underline">
                      run {a.runId.slice(0, 8)} <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-[#9CA3AF]">
                    <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" /> requested {fmtTime(a.createdAt)}</span>
                    {a.resolvedBy && <span>· by {a.resolvedBy}</span>}
                    {a.status !== "PENDING" && <span>· resolved {fmtTime(a.updatedAt)}</span>}
                  </div>

                  {/* Distinctive paused-at-gate timeline (pending only) */}
                  {pending && <div className="mt-3"><PausedTimeline nodeId={a.nodeId} /></div>}

                  {a.message && (
                    <div className="mt-3 rounded-[10px] border border-[#ECEEEF] bg-[#FAFBFB] px-3.5 py-3">
                      <p className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Decision context</p>
                      <TemplateText text={a.message} />
                    </div>
                  )}
                </div>

                {pending && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[#FDE68A] bg-[#FFFDF5] px-4 py-3">
                    <Button size="sm" variant="primary" disabled={actingId === a.id} onClick={() => void handleApprove(a)}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{actingId === a.id ? "…" : "Approve & resume"}
                    </Button>
                    <Button size="sm" variant="destructive" disabled={actingId === a.id} onClick={() => void handleReject(a)}>
                      <XCircle className="mr-1 h-3.5 w-3.5" />{actingId === a.id ? "…" : "Reject"}
                    </Button>
                    <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-[#9CA3AF]">
                      <Diamond size={8} color="#CA8A04" /> resumes from checkpoint on decision
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
