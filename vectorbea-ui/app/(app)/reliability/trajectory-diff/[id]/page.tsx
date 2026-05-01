"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Loader2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrajectoryDiffResult } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export default function TrajectoryDiffPage() {
  const { id } = useParams<{ id: string }>();
  const { activeWorkspaceId } = useWorkspace();
  const [diff, setDiff] = useState<TrajectoryDiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !id) return;
    const workspaceId = activeWorkspaceId;
    async function load() {
      try {
        const res = await fetch(`/api/reliability/trajectory-diff/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load trajectory diff");
        setDiff(json as TrajectoryDiffResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load trajectory diff");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [activeWorkspaceId, id]);

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading trajectory diff…</div>;
  if (error || !diff) return <div className="px-4 py-8"><div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error ?? "Trajectory diff not found"}</div></div>;

  const before = Array.isArray(diff.toolSequenceDiff?.before) ? diff.toolSequenceDiff.before : [];
  const after = Array.isArray(diff.toolSequenceDiff?.after) ? diff.toolSequenceDiff.after : [];
  const argumentChanges = Array.isArray(diff.argumentDiff?.changed_arguments) ? diff.argumentDiff.changed_arguments : [];

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Trajectory Diff" subtitle="Compare workflow paths across versions" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <Link href="/reliability/capabilities" className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" />Back to reliability
        </Link>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Old path</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {before.map((step, index) => (
                <div key={`${String(step)}-${index}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]">
                  {index + 1}. {String(step)}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">New path</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {after.map((step, index) => (
                <div key={`${String(step)}-${index}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]">
                  {index + 1}. {String(step)}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Differences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-[#374151]">
              <div>
                <p className="font-medium text-[#111111]">Added tools</p>
                <p>{(diff.toolSequenceDiff?.added_tools as string[] | undefined)?.join(", ") || "None"}</p>
              </div>
              <div>
                <p className="font-medium text-[#111111]">Removed tools</p>
                <p>{(diff.toolSequenceDiff?.removed_tools as string[] | undefined)?.join(", ") || "None"}</p>
              </div>
              <div>
                <p className="font-medium text-[#111111]">Order changed</p>
                <p>{diff.toolSequenceDiff?.order_changed ? "Yes" : "No"}</p>
              </div>
              <div>
                <p className="font-medium text-[#111111]">Argument changes</p>
                <div className="mt-2 space-y-2">
                  {argumentChanges.length === 0 && <p>None</p>}
                  {argumentChanges.map((change, index) => (
                    <pre key={index} className="overflow-x-auto rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3 text-xs text-[#111111]">{JSON.stringify(change, null, 2)}</pre>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="font-medium text-[#111111]">Latency delta</p>
                  <p>{String(diff.latencyDiff?.delta ?? "—")} ms</p>
                </div>
                <div>
                  <p className="font-medium text-[#111111]">Cost delta</p>
                  <p>{String(diff.costDiff?.delta ?? "—")}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Risk flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(diff.riskFlags ?? []).length === 0 && <p className="text-sm text-[#6B7280]">No material risk flags detected</p>}
              {(diff.riskFlags ?? []).map((flag, index) => (
                <Badge key={index} className="mr-2 bg-[#FEF2F2] text-[#991B1B]">{flag}</Badge>
              ))}
              <div className="mt-4 rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4 text-sm text-[#374151]">
                Recommended action: review removed required steps, any new forbidden tools, and whether the final action changed before rollout.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
