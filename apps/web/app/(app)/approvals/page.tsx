"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle, Clock, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

function statusIcon(status: ApprovalItem["status"]) {
  switch (status) {
    case "PENDING":  return <Clock className="h-4 w-4 text-amber-500" />;
    case "APPROVED": return <CheckCircle className="h-4 w-4 text-emerald-500" />;
    case "REJECTED": return <XCircle className="h-4 w-4 text-red-500" />;
    default:         return <AlertCircle className="h-4 w-4 text-gray-400" />;
  }
}

function statusBadge(status: ApprovalItem["status"]) {
  const map: Record<ApprovalItem["status"], { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    PENDING:  { variant: "outline",     label: "Pending"  },
    APPROVED: { variant: "default",     label: "Approved" },
    REJECTED: { variant: "destructive", label: "Rejected" },
  };
  const cfg = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
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

  const FILTERS: StatusFilter[] = ["PENDING", "APPROVED", "REJECTED", "ALL"];

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Approvals</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Review and act on pending human-in-the-loop approvals.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="mb-5 flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
        {total > 0 && (
          <span className="ml-auto self-center text-[12px] text-muted-foreground">
            {total} result{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Failed to load approvals:</strong> {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : approvals.length === 0 ? (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
          <CheckCircle className="h-8 w-8 text-emerald-400" />
          <p className="text-sm font-medium text-muted-foreground">
            {filter === "PENDING" ? "No pending approvals" : "No approvals found"}
          </p>
          <p className="text-xs text-muted-foreground">
            {filter === "PENDING"
              ? "All runs are proceeding without human intervention."
              : "Try changing the filter above."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => (
            <Card key={a.id} className="shadow-card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <CardTitle className="flex items-center gap-2 text-[14px] font-semibold">
                    {statusIcon(a.status)}
                    <span className="font-mono text-[12px] text-muted-foreground">
                      Run:{" "}
                      <Link
                        href={`/runs/${a.runId}` as never}
                        className="hover:underline text-foreground"
                      >
                        {a.runId.slice(0, 8)}…
                      </Link>
                    </span>
                    {a.nodeId && (
                      <span className="text-[11px] text-muted-foreground">· node {a.nodeId}</span>
                    )}
                  </CardTitle>
                  {statusBadge(a.status)}
                </div>
              </CardHeader>
              <CardContent>
                {a.message && (
                  <p className="mb-3 text-[13px] text-muted-foreground">{a.message}</p>
                )}
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                  <span>Requested: {fmtTime(a.createdAt)}</span>
                  {a.resolvedBy && <span>Resolved by: {a.resolvedBy}</span>}
                  {a.status !== "PENDING" && (
                    <span>Resolved: {fmtTime(a.updatedAt)}</span>
                  )}
                </div>
                {a.status === "PENDING" && (
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      disabled={actingId === a.id}
                      onClick={() => void handleApprove(a)}
                    >
                      {actingId === a.id ? "…" : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={actingId === a.id}
                      onClick={() => void handleReject(a)}
                    >
                      {actingId === a.id ? "…" : "Reject"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
