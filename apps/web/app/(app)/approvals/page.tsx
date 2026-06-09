"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle, ShieldCheck, RefreshCw, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Chip, FilterTabs, EmptyHint, Diamond } from "@/components/ui/page-kit";
import {
  getApprovals,
  approveRunGate,
  rejectRunGate,
  type ApprovalItem,
} from "@/lib/repository";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusChip(status: ApprovalItem["status"]) {
  switch (status) {
    case "PENDING":  return <Chip tone="amber" pulse>Awaiting decision</Chip>;
    case "APPROVED": return <Chip tone="green">Approved</Chip>;
    case "REJECTED": return <Chip tone="red">Rejected</Chip>;
    default:         return <Chip tone="gray">{status}</Chip>;
  }
}

function gateIcon(status: ApprovalItem["status"]) {
  const cfg = {
    PENDING:  { bg: "#FFFBEB", bd: "#FDE68A", fg: "#CA8A04", Icon: ShieldCheck },
    APPROVED: { bg: "#E6F4EF", bd: "#9CCFBB", fg: "#007F4E", Icon: CheckCircle2 },
    REJECTED: { bg: "#FEF2F2", bd: "#FECACA", fg: "#DC2626", Icon: XCircle },
  }[status] ?? { bg: "#F3F4F5", bd: "#E0E3E6", fg: "#6B7280", Icon: ShieldCheck };
  const { Icon } = cfg;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border" style={{ background: cfg.bg, borderColor: cfg.bd, color: cfg.fg }}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
      const page = await getApprovals({
        status: filter === "ALL" ? undefined : filter,
        pageSize: 50,
      });
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

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Governance</span>
          <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.025em] text-[#0B0D0F]">Approval gates</h1>
          <p className="mt-1 text-[13.5px] text-[#6B7280]">
            Runs pause here for a human decision — every gate is logged to the durable timeline.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filter + count */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <FilterTabs options={FILTER_OPTS} value={filter} onChange={(v) => setFilter(v as StatusFilter)} />
        {total > 0 && (
          <span className="font-mono text-[12px] text-[#9CA3AF]">{total} gate{total !== 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
          <strong>Failed to load approvals:</strong> {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[120px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />
          ))}
        </div>
      ) : approvals.length === 0 ? (
        <EmptyHint
          icon={CheckCircle2}
          title={filter === "PENDING" ? "No gates waiting" : "No approvals found"}
          desc={filter === "PENDING"
            ? "Every run is proceeding without human intervention."
            : "Try a different filter above."}
        />
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => {
            const pending = a.status === "PENDING";
            return (
              <div
                key={a.id}
                className="rounded-[12px] border bg-white p-4 transition-colors"
                style={{ borderColor: pending ? "#FDE68A" : "#E0E3E6", background: pending ? "#FFFDF5" : "#FFFFFF" }}
              >
                <div className="flex items-start gap-3.5">
                  {gateIcon(a.status)}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-[#0B0D0F]">
                        {a.nodeId ? `Approval · ${a.nodeId}` : "Manager approval gate"}
                      </h3>
                      {statusChip(a.status)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-[#6B7280]">
                      <Link href={`/runs/${a.runId}` as never} className="inline-flex items-center gap-1 text-[#007F4E] hover:underline">
                        run {a.runId.slice(0, 8)} <ArrowRight className="h-3 w-3" />
                      </Link>
                      <span className="inline-flex items-center gap-1 text-[#9CA3AF]">
                        <Clock className="h-3 w-3" /> {fmtTime(a.createdAt)}
                      </span>
                      {a.resolvedBy && <span>by {a.resolvedBy}</span>}
                      {a.status !== "PENDING" && <span>resolved {fmtTime(a.updatedAt)}</span>}
                    </div>
                    {a.message && (
                      <p className="mt-2.5 rounded-[8px] border border-[#ECEEEF] bg-[#FAFBFB] px-3 py-2 text-[13px] leading-[1.5] text-[#4B5563]">
                        {a.message}
                      </p>
                    )}
                    {pending && (
                      <div className="mt-3.5 flex items-center gap-2">
                        <Button size="sm" variant="primary" disabled={actingId === a.id} onClick={() => void handleApprove(a)}>
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          {actingId === a.id ? "…" : "Approve"}
                        </Button>
                        <Button size="sm" variant="destructive" disabled={actingId === a.id} onClick={() => void handleReject(a)}>
                          <XCircle className="mr-1 h-3.5 w-3.5" />
                          {actingId === a.id ? "…" : "Reject"}
                        </Button>
                        <span className="ml-1 inline-flex items-center gap-1.5 font-mono text-[11px] text-[#9CA3AF]">
                          <Diamond size={8} color="#CA8A04" /> resumes on decision
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
