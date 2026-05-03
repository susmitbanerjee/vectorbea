"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  Shield,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApprovalRequest, ApprovalRequestStatus, ApprovalRequestType } from "@/lib/api";
import { canUseApprovalWorkflows } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TYPE_LABELS: Record<ApprovalRequestType, string> = {
  rollout_approval:    "Rollout Approval",
  incident_resolution: "Incident Resolution",
  policy_override:     "Policy Override",
  high_risk_action:    "High-Risk Action",
};

const STATUS_STYLE: Record<ApprovalRequestStatus, { label: string; cls: string }> = {
  pending:   { label: "Pending",   cls: "bg-[#FFFBEB] text-[#92400E]" },
  approved:  { label: "Approved",  cls: "bg-[#ECFDF5] text-[#065F46]" },
  rejected:  { label: "Rejected",  cls: "bg-[#FEF2F2] text-[#991B1B]" },
  cancelled: { label: "Cancelled", cls: "bg-[#F3F4F6] text-[#9CA3AF]" },
};

const ALL_REQUEST_TYPES: ApprovalRequestType[] = [
  "rollout_approval", "incident_resolution", "policy_override", "high_risk_action",
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// ─── Approve / Reject modal ───────────────────────────────────────────────────

function DecisionModal({
  request,
  onClose,
  onDone,
  workspaceId,
}: {
  request: ApprovalRequest;
  onClose: () => void;
  onDone: (updated: ApprovalRequest) => void;
  workspaceId: string;
}) {
  const [decision, setDecision] = useState<"approved" | "rejected" | "">("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!decision) return;
    if (decision === "rejected" && !comment.trim()) {
      setErr("A comment is required when rejecting.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/governance/approvals/${encodeURIComponent(request.id)}/decisions?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, comment: comment.trim() || null }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed to submit");
      // Optimistically update the request status
      const approvals = decision === "approved" ? request.approvedCount + 1 : request.approvedCount;
      const rejections = decision === "rejected" ? request.rejectedCount + 1 : request.rejectedCount;
      const nextStatus: ApprovalRequestStatus =
        rejections > 0 ? "rejected" :
        approvals >= request.requiredApprovals ? "approved" :
        "pending";
      onDone({ ...request, approvedCount: approvals, rejectedCount: rejections, status: nextStatus });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#E7DED1] bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-[#111111]">Submit decision</h2>
        <p className="mt-1 text-sm text-[#6B7280]">{REQUEST_TYPE_LABELS[request.requestType]}</p>
        {request.reason && (
          <p className="mt-3 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#374151]">
            {request.reason}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setDecision("approved")}
            className={`flex-1 rounded-xl border py-2 text-sm font-semibold transition-colors ${
              decision === "approved"
                ? "border-[#065F46] bg-[#ECFDF5] text-[#065F46]"
                : "border-[#E7DED1] bg-white text-[#374151] hover:bg-[#F8F5EF]"
            }`}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setDecision("rejected")}
            className={`flex-1 rounded-xl border py-2 text-sm font-semibold transition-colors ${
              decision === "rejected"
                ? "border-[#991B1B] bg-[#FEF2F2] text-[#991B1B]"
                : "border-[#E7DED1] bg-white text-[#374151] hover:bg-[#F8F5EF]"
            }`}
          >
            Reject
          </button>
        </div>
        <textarea
          className="mt-3 w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none resize-none"
          rows={3}
          placeholder={decision === "rejected" ? "Rejection reason (required)…" : "Comment (optional)…"}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        {err && (
          <p className="mt-2 text-xs text-[#991B1B]">{err}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F8F5EF]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!decision || saving}
            onClick={() => void submit()}
            className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateModal({
  onClose,
  onDone,
  workspaceId,
}: {
  onClose: () => void;
  onDone: (r: ApprovalRequest) => void;
  workspaceId: string;
}) {
  const [requestType, setRequestType] = useState<ApprovalRequestType>("rollout_approval");
  const [reason, setReason] = useState("");
  const [requiredApprovals, setRequiredApprovals] = useState(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/governance/approvals?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestType, reason: reason.trim() || null, requiredApprovals }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed to create");
      onDone(json as ApprovalRequest);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#E7DED1] bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-[#111111]">New approval request</h2>
        <p className="mt-1 text-sm text-[#6B7280]">Manually request a governance approval.</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">Request type</label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as ApprovalRequestType)}
              className="w-full rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]"
            >
              {ALL_REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>{REQUEST_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">Reason</label>
            <textarea
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none resize-none"
              rows={3}
              placeholder="Describe what needs approval and why…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">Required approvals</label>
            <input
              type="number"
              min={1}
              max={10}
              value={requiredApprovals}
              onChange={(e) => setRequiredApprovals(Number(e.target.value))}
              className="w-24 rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]"
            />
          </div>
        </div>
        {err && <p className="mt-2 text-xs text-[#991B1B]">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F8F5EF]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "pending" | "approved" | "rejected" | "all";

export default function ApprovalsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const [deciding, setDeciding] = useState<ApprovalRequest | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId || !canUseApprovalWorkflows(planTier)) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/governance/approvals?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: unknown) => {
        if (Array.isArray(json)) setRequests(json as ApprovalRequest[]);
        else setError((json as { error?: string }).error ?? "Failed to load");
      })
      .catch(() => setError("Failed to load approval requests"))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, planTier]);

  const counts = {
    pending:  requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
    all:      requests.length,
  };

  const visible = tab === "all" ? requests : requests.filter((r) => r.status === tab);

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      {deciding && activeWorkspaceId && (
        <DecisionModal
          request={deciding}
          workspaceId={activeWorkspaceId}
          onClose={() => setDeciding(null)}
          onDone={(updated) => {
            setRequests((prev) => prev.map((r) => r.id === updated.id ? updated : r));
            setDeciding(null);
          }}
        />
      )}
      {creating && activeWorkspaceId && (
        <CreateModal
          workspaceId={activeWorkspaceId}
          onClose={() => setCreating(false)}
          onDone={(created) => {
            setRequests((prev) => [created, ...prev]);
            setCreating(false);
          }}
        />
      )}

      <AppHeader
        title="Approvals"
        subtitle="Human governance decisions for AI system releases"
        actions={
          canUseApprovalWorkflows(planTier) ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
            >
              <Plus className="h-3.5 w-3.5" /> New request
            </button>
          ) : undefined
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">
        {!canUseApprovalWorkflows(planTier) && (
          <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-4 text-sm text-[#6B7280]">
            Approval workflows are available on Pro and Enterprise.
          </div>
        )}

        {canUseApprovalWorkflows(planTier) && (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {([
                { key: "pending" as Tab,  label: "Pending",  color: "text-[#92400E]", icon: Clock },
                { key: "approved" as Tab, label: "Approved", color: "text-[#065F46]", icon: CheckCircle2 },
                { key: "rejected" as Tab, label: "Rejected", color: "text-[#991B1B]", icon: XCircle },
                { key: "all" as Tab,      label: "Total",    color: "text-[#111111]", icon: Shield },
              ]).map(({ key, label, color, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`rounded-xl border bg-white px-4 py-3 text-left transition-all hover:shadow-sm ${tab === key ? "border-[#2563EB] ring-1 ring-[#2563EB]" : "border-[#E7DED1]"}`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${color}`} />
                    <p className={`text-2xl font-bold ${color}`}>{loading ? "—" : counts[key]}</p>
                  </div>
                  <p className="text-xs text-[#6B7280] mt-0.5">{label}</p>
                </button>
              ))}
            </div>

            {/* List */}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-[#6B7280]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>
            )}

            {!loading && !error && (
              <div className="rounded-xl border border-[#E7DED1] bg-white overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-[1fr_140px_100px_90px_100px_36px] gap-3 px-4 py-2 border-b border-[#F1ECE3] bg-[#FBFAF7] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">
                  <span>Request / Reason</span>
                  <span className="hidden sm:block">Type</span>
                  <span>Approvals</span>
                  <span>Status</span>
                  <span className="hidden sm:block">Created</span>
                  <span />
                </div>

                {visible.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-14 text-center">
                    <div className="rounded-full bg-[#EFF6FF] p-4">
                      <Shield className="h-7 w-7 text-[#2563EB]" />
                    </div>
                    <div>
                      <p className="font-semibold text-[#111111]">
                        {tab === "pending" ? "No pending approvals" : `No ${tab} requests`}
                      </p>
                      <p className="text-sm text-[#6B7280] mt-1">
                        {tab === "pending"
                          ? "Approval requests are created automatically when releasing high-risk AI systems."
                          : "Switch tabs to see other requests."}
                      </p>
                    </div>
                    {tab === "pending" && (
                      <Link href={"/release-gates" as Route} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                        View Release Gates
                      </Link>
                    )}
                  </div>
                ) : (
                  visible.map((req) => {
                    const sc = STATUS_STYLE[req.status];
                    return (
                      <div key={req.id} className="grid grid-cols-[1fr_140px_100px_90px_100px_36px] gap-3 px-4 py-3 border-b border-[#F1ECE3] last:border-0 items-center">
                        {/* Request */}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#111111] truncate">
                            {REQUEST_TYPE_LABELS[req.requestType]}
                          </p>
                          <p className="text-[10px] text-[#9CA3AF] mt-0.5 truncate">
                            {req.reason ?? "No reason provided"}
                          </p>
                        </div>
                        {/* Type */}
                        <span className="hidden sm:block text-xs text-[#374151]">
                          {REQUEST_TYPE_LABELS[req.requestType]}
                        </span>
                        {/* Approvals */}
                        <span className="text-xs text-[#374151]">
                          {req.approvedCount}/{req.requiredApprovals}
                        </span>
                        {/* Status */}
                        <Badge className={`${sc.cls} text-[10px] font-normal w-fit`}>{sc.label}</Badge>
                        {/* Created */}
                        <span className="hidden sm:block text-[10px] text-[#9CA3AF]">{fmtDate(req.createdAt)}</span>
                        {/* Action */}
                        {req.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => setDeciding(req)}
                            className="rounded-lg border border-[#2563EB] bg-[#EFF6FF] px-2 py-1 text-[11px] font-semibold text-[#2563EB] hover:bg-[#DBEAFE]"
                          >
                            Review
                          </button>
                        ) : (
                          <ChevronRight className="h-4 w-4 text-[#D1C9BD]" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
