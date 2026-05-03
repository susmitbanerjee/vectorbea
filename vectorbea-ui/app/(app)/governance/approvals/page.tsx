"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApprovalRequest } from "@/lib/api";
import { canUseApprovalWorkflows } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

export default function ApprovalsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !canUseApprovalWorkflows(planTier)) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    fetch(`/api/governance/approvals?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load approval requests");
        setRequests(json as ApprovalRequest[]);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, planTier]);

  async function submitDecision(id: string, decision: "approved" | "rejected") {
    if (!activeWorkspaceId) return;
    setWorkingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/governance/approvals/${encodeURIComponent(id)}/decisions?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to submit approval decision");
      setRequests((prev) => prev.map((item) => item.id === id
        ? {
            ...item,
            status: decision === "approved" && item.requiredApprovals <= item.approvedCount + 1 ? "approved" : decision === "rejected" ? "rejected" : item.status,
            approvedCount: decision === "approved" ? item.approvedCount + 1 : item.approvedCount,
            rejectedCount: decision === "rejected" ? item.rejectedCount + 1 : item.rejectedCount,
          }
        : item));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit approval decision");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Approvals" subtitle="Human governance decisions for AI system releases" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {!canUseApprovalWorkflows(planTier) && <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-4 text-sm text-[#6B7280]">Approval workflows are available on Pro and Enterprise.</div>}
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading approval requests…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}
        {canUseApprovalWorkflows(planTier) && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Approval queue</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {requests.map((request) => (
                <div key={request.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-[#111111]">{request.requestType.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-xs text-[#6B7280]">{request.reason ?? "No reason provided"} · {request.approvedCount}/{request.requiredApprovals} approvals</p>
                    </div>
                    <Badge className={request.status === "approved" ? "bg-[#ECFDF5] text-[#065F46]" : request.status === "rejected" ? "bg-[#FEF2F2] text-[#991B1B]" : "bg-[#FFFBEB] text-[#92400E]"}>{request.status}</Badge>
                  </div>
                  {request.status === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={workingId === request.id} onClick={() => void submitDecision(request.id, "approved")} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">Approve</button>
                      <button type="button" disabled={workingId === request.id} onClick={() => void submitDecision(request.id, "rejected")} className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-50">Reject</button>
                    </div>
                  )}
                </div>
              ))}
              {!requests.length && !loading && <p className="text-sm text-[#6B7280]">No approval requests yet.</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
