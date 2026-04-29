"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace-context";
import type { HumanReviewItem } from "@/lib/api";

export default function ReviewQueuePage() {
  const { activeWorkspaceId } = useWorkspace();
  const [items, setItems] = useState<HumanReviewItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | HumanReviewItem["status"]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ workspaceId: activeWorkspaceId });
    if (statusFilter !== "all") params.set("status", statusFilter);
    fetch(`/api/evaluations/review?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((json) => {
        if (json?.error) throw new Error(json.error);
        setItems(json as HumanReviewItem[]);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, statusFilter]);

  const counts = useMemo(() => ({
    open: items.filter((item) => item.status === "open").length,
    inReview: items.filter((item) => item.status === "in_review").length,
    critical: items.filter((item) => item.status === "open" && item.severity === "critical").length,
  }), [items]);

  return (
    <div className="min-h-screen bg-[#FBFAF7]">
      <AppHeader title="Review queue" subtitle="Human review for uncertain or high risk evaluation cases" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-[#111111]">Queue summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-xs text-[#6B7280]">Open</p>
              <p className="text-xl font-semibold text-[#111111]">{counts.open}</p>
            </div>
            <div className="rounded-lg border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-xs text-[#6B7280]">In review</p>
              <p className="text-xl font-semibold text-[#111111]">{counts.inReview}</p>
            </div>
            <div className="rounded-lg border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-xs text-[#6B7280]">Critical open</p>
              <p className="text-xl font-semibold text-[#991B1B]">{counts.critical}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-[#111111]">Review items</CardTitle>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="rounded-md border border-[#D8CFC2] bg-white px-2 py-1 text-sm text-[#111111]"
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="in_review">In review</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-[#6B7280]">Loading review queue...</p>
            ) : error ? (
              <p className="text-sm text-[#991B1B]">{error}</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-[#6B7280]">No review items found for this filter</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                      <th className="py-2 text-left font-semibold">Run</th>
                      <th className="py-2 text-left font-semibold">Reason</th>
                      <th className="py-2 text-left font-semibold">Severity</th>
                      <th className="py-2 text-left font-semibold">Status</th>
                      <th className="py-2 text-left font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b border-[#F1ECE3] last:border-0">
                        <td className="py-2.5">
                          <Link href={`/evaluations/runs/${item.evaluationRunId}`} className="text-[#2563EB] hover:text-[#1D4ED8]">
                            {item.evaluationRunId.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="py-2.5 text-[#374151]">{item.reason}</td>
                        <td className="py-2.5">
                          <Badge className={item.severity === "critical" ? "bg-[#FEF2F2] text-[#991B1B]" : item.severity === "high" ? "bg-[#FFFBEB] text-[#B45309]" : "bg-[#EEF2FF] text-[#1E3A8A]"}>
                            {item.severity}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-[#374151]">{item.status}</td>
                        <td className="py-2.5 text-[#6B7280]">{new Date(item.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

