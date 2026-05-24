"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle, Clock, XCircle, AlertCircle, RefreshCw, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecidedBy {
  id: string;
  name: string | null;
  email: string;
}

interface Approval {
  id: string;
  title: string;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  requestedBySystem: boolean;
  requestedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  agentRunStepId: string | null;
  agentRun: {
    id: string;
    status: string;
    triggerSource: string;
    agentJob: { id: string; name: string };
  };
  decidedBy: DecidedBy | null;
}

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: Approval["status"] }) {
  const map = {
    PENDING: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    APPROVED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    REJECTED: "bg-red-500/10 text-red-600 border-red-500/20",
    EXPIRED: "bg-muted text-muted-foreground border-border",
  };
  const icons = {
    PENDING: <Clock className="h-3 w-3" />,
    APPROVED: <CheckCircle className="h-3 w-3" />,
    REJECTED: <XCircle className="h-3 w-3" />,
    EXPIRED: <AlertCircle className="h-3 w-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[status]}`}>
      {icons[status]}
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

// ─── Decision modal ────────────────────────────────────────────────────────────

interface DecisionModalProps {
  approval: Approval;
  action: "approve" | "reject";
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function DecisionModal({ approval, action, onConfirm, onCancel, loading }: DecisionModalProps) {
  const [reason, setReason] = useState("");
  const isApprove = action === "approve";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold">
            {isApprove ? "Approve" : "Reject"} request
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{approval.title}</p>
        </div>

        <div className="rounded-lg bg-muted/50 border border-border/60 p-3 text-sm text-muted-foreground">
          {approval.message}
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            Reason {isApprove ? "(optional)" : "(recommended)"}
          </label>
          <textarea
            rows={3}
            placeholder={isApprove ? "e.g. Looks safe to proceed…" : "e.g. Do not update CRM automatically…"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={isApprove ? "default" : "destructive"}
            onClick={() => onConfirm(reason.trim())}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : isApprove ? (
              <CheckCircle className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {isApprove ? "Approve & resume" : "Reject & cancel run"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Approval card ─────────────────────────────────────────────────────────────

interface ApprovalCardProps {
  approval: Approval;
  onDecide: (id: string, action: "approve" | "reject") => void;
  acting: string | null;
}

function ApprovalCard({ approval, onDecide, acting }: ApprovalCardProps) {
  const isPending = approval.status === "PENDING";

  return (
    <Card className={isPending ? "border-amber-500/20 bg-amber-500/[0.02]" : ""}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{approval.title}</CardTitle>
              <StatusBadge status={approval.status} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                Job:{" "}
                <Link
                  href={`/agent-jobs/${approval.agentRun.agentJob.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {approval.agentRun.agentJob.name}
                </Link>
              </span>
              <span>
                Run:{" "}
                <Link
                  href={`/agent-runs/${approval.agentRun.id}`}
                  className="font-mono text-foreground hover:underline"
                >
                  {approval.agentRun.id.slice(0, 12)}…
                </Link>
              </span>
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                Requested {fmtTime(approval.requestedAt)}
              </span>
              {!approval.requestedBySystem && (
                <Badge variant="outline" className="text-[10px]">Manual</Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Message */}
        <p className="text-sm text-muted-foreground leading-relaxed">{approval.message}</p>

        {/* Decision history (non-pending) */}
        {!isPending && approval.decidedAt && (
          <div className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
            approval.status === "APPROVED"
              ? "border-emerald-500/20 bg-emerald-500/5"
              : "border-red-500/20 bg-red-500/5"
          }`}>
            <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">
                {approval.status === "APPROVED" ? "Approved" : "Rejected"} by{" "}
                {approval.decidedBy?.name ?? approval.decidedBy?.email ?? "Unknown"}{" "}
                <span className="text-muted-foreground font-normal">· {fmtTime(approval.decidedAt)}</span>
              </p>
              {approval.decisionReason && (
                <p className="mt-1 text-xs text-muted-foreground">&ldquo;{approval.decisionReason}&rdquo;</p>
              )}
            </div>
          </div>
        )}

        {/* Actions (pending only) */}
        {isPending && (
          <div className="flex gap-3">
            <Button
              size="sm"
              onClick={() => onDecide(approval.id, "approve")}
              disabled={acting === approval.id}
              className="gap-1.5"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDecide(approval.id, "reject")}
              disabled={acting === approval.id}
              className="gap-1.5"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
            <Link
              href={`/agent-runs/${approval.agentRun.id}`}
              className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            >
              View run →
            </Link>
          </div>
        )}

        {!isPending && (
          <Link
            href={`/agent-runs/${approval.agentRun.id}`}
            className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          >
            View run →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [acting, setActing] = useState<string | null>(null);
  const [modal, setModal] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const load = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      params.set("pageSize", "50");
      const res = await fetch(`/api/approvals?${params.toString()}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { approvals: Approval[]; pagination: { total: number } };
      setApprovals(data.approvals);
    } catch {
      toast.error("Failed to load approvals.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Also load pending count for the badge on non-pending tabs
  const loadPendingCount = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals?status=PENDING&pageSize=1");
      if (!res.ok) return;
      const data = (await res.json()) as { pagination: { total: number } };
      setPendingCount(data.pagination.total);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load(statusFilter);
    void loadPendingCount();
  }, [load, loadPendingCount, statusFilter]);

  async function handleDecide(reason: string) {
    if (!modal) return;
    const { id, action } = modal;
    setModal(null);
    setActing(id);
    try {
      const res = await fetch(`/api/approvals/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });

      if (!res.ok) {
        const b = (await res.json()) as { error?: string; detail?: string };
        throw new Error(b.detail ?? b.error ?? "Failed");
      }

      toast.success(
        action === "approve"
          ? "Approved — run will continue."
          : "Rejected — run has been cancelled.",
      );
      void load(statusFilter);
      void loadPendingCount();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setActing(null);
    }
  }

  const tabs: { label: string; value: StatusFilter }[] = [
    { label: "Pending", value: "PENDING" },
    { label: "Approved", value: "APPROVED" },
    { label: "Rejected", value: "REJECTED" },
    { label: "All", value: "ALL" },
  ];

  const activeApproval = modal ? approvals.find((a) => a.id === modal.id) : null;

  return (
    <>
      {/* Decision modal */}
      {modal && activeApproval && (
        <DecisionModal
          approval={activeApproval}
          action={modal.action}
          onConfirm={(reason) => void handleDecide(reason)}
          onCancel={() => setModal(null)}
          loading={acting === modal.id}
        />
      )}

      <div className="page-shell space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold">Approvals</h1>
              {pendingCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">
                  {pendingCount}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Agent runs waiting for human approval before continuing.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void load(statusFilter); void loadPendingCount(); }}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === tab.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.value === "PENDING" && pendingCount > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-[14px] bg-muted" />
            ))}
          </div>
        ) : approvals.length === 0 ? (
          <EmptyState status={statusFilter} />
        ) : (
          <div className="space-y-4">
            {approvals.map((ap) => (
              <ApprovalCard
                key={ap.id}
                approval={ap}
                onDecide={(id, action) => setModal({ id, action })}
                acting={acting}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function EmptyState({ status }: { status: StatusFilter }) {
  const messages: Record<StatusFilter, { icon: React.ReactNode; title: string; body: string }> = {
    PENDING: {
      icon: <CheckCircle className="h-10 w-10 text-emerald-500/40" />,
      title: "No approvals waiting",
      body: "All clear. When agent runs require approval, they'll appear here.",
    },
    APPROVED: {
      icon: <CheckCircle className="h-10 w-10 text-emerald-500/40" />,
      title: "No approved requests yet",
      body: "Approved approvals will be listed here.",
    },
    REJECTED: {
      icon: <XCircle className="h-10 w-10 text-red-500/30" />,
      title: "No rejected requests",
      body: "Rejected approvals will be listed here.",
    },
    ALL: {
      icon: <AlertCircle className="h-10 w-10 text-muted-foreground/30" />,
      title: "No approval requests",
      body: "No approval requests have been created yet.",
    },
  };
  const { icon, title, body } = messages[status];
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[14px] border border-border bg-card py-16 text-center">
      {icon}
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
