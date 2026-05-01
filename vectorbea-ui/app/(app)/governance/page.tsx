"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckSquare, Loader2, Shield, Siren, UserRoundCheck } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GovernanceDashboardData } from "@/lib/api";
import { canUseGovernanceDashboard } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

function toneForSeverity(severity: string) {
  if (severity === "critical") return "bg-[#FEF2F2] text-[#991B1B]";
  if (severity === "high") return "bg-[#FFF7ED] text-[#C2410C]";
  if (severity === "medium") return "bg-[#FFFBEB] text-[#92400E]";
  return "bg-[#ECFDF5] text-[#065F46]";
}

function LockedState() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Governance" subtitle="Production controls and incident loop" />
      <div className="mx-auto flex max-w-lg flex-col items-center gap-5 px-4 py-16 text-center">
        <div className="rounded-full bg-[#EFF6FF] p-5"><Shield className="h-10 w-10 text-[#2563EB]" /></div>
        <div>
          <h2 className="text-2xl font-semibold text-[#111111]">Governance is available on Pro</h2>
          <p className="mt-3 text-sm leading-relaxed text-[#6B7280]">
            Incidents, approvals, audit history, and enterprise privacy controls are part of the production governance layer.
          </p>
        </div>
        <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}

export default function GovernanceDashboardPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [data, setData] = useState<GovernanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !canUseGovernanceDashboard(planTier)) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/governance?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load governance dashboard");
        setData(json as GovernanceDashboardData);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, planTier]);

  if (!canUseGovernanceDashboard(planTier)) return <LockedState />;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Governance" subtitle="Incidents, approvals, audit history, and privacy status" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading governance dashboard…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}
        {data && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Open incidents</p><p className="mt-2 text-2xl font-semibold text-[#111111]">{data.openIncidents.length}</p></CardContent></Card>
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Pending approvals</p><p className="mt-2 text-2xl font-semibold text-[#92400E]">{data.pendingApprovals.length}</p></CardContent></Card>
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Critical failure clusters</p><p className="mt-2 text-2xl font-semibold text-[#991B1B]">{data.criticalClusters.length}</p></CardContent></Card>
              <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Policy packs applied</p><p className="mt-2 text-2xl font-semibold text-[#111111]">{data.policyPacks.filter((pack) => (pack.appliedToCapabilityIds?.length ?? 0) > 0).length}</p></CardContent></Card>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm text-[#111111] flex items-center gap-2"><Siren className="h-4 w-4 text-[#991B1B]" />Open incidents</CardTitle>
                  <Link href="/incidents" className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]">View all</Link>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.openIncidents.map((incident) => (
                    <Link key={incident.id} href={`/incidents/${incident.id}`} className="block rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3 hover:bg-[#F1ECE3]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[#111111]">{incident.title}</p>
                          <p className="mt-1 text-xs text-[#6B7280]">{incident.capabilityName ?? "Workspace incident"} · {incident.sourceType.replaceAll("_", " ")}</p>
                        </div>
                        <Badge className={toneForSeverity(incident.severity)}>{incident.severity}</Badge>
                      </div>
                    </Link>
                  ))}
                  {data.openIncidents.length === 0 && <p className="text-sm text-[#6B7280]">No open incidents right now.</p>}
                </CardContent>
              </Card>

              <div className="space-y-5">
                <Card className="border-[#E7DED1] bg-white">
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111] flex items-center gap-2"><UserRoundCheck className="h-4 w-4 text-[#92400E]" />Pending approvals</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {data.pendingApprovals.map((approval) => (
                      <div key={approval.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                        <p className="font-medium text-[#111111]">{approval.requestType.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-xs text-[#6B7280]">{approval.approvedCount}/{approval.requiredApprovals} approvals · {approval.status}</p>
                      </div>
                    ))}
                    {data.pendingApprovals.length === 0 && <p className="text-sm text-[#6B7280]">No approvals pending.</p>}
                  </CardContent>
                </Card>

                <Card className="border-[#E7DED1] bg-white">
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111] flex items-center gap-2"><CheckSquare className="h-4 w-4 text-[#065F46]" />Privacy status</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm text-[#374151]">
                    <div className="flex items-center justify-between"><span>PII redaction</span><Badge className={data.privacySettings?.enablePiiRedaction ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-[#991B1B]"}>{data.privacySettings?.enablePiiRedaction ? "On" : "Off"}</Badge></div>
                    <div className="flex items-center justify-between"><span>Store raw inputs</span><span className="text-[#6B7280]">{data.privacySettings?.storeRawInputs ? "Yes" : "No"}</span></div>
                    <div className="flex items-center justify-between"><span>Store raw outputs</span><span className="text-[#6B7280]">{data.privacySettings?.storeRawOutputs ? "Yes" : "No"}</span></div>
                    <Link href="/settings/privacy" className="inline-flex text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]">Open privacy controls</Link>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111] flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-[#991B1B]" />Critical failure clusters</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.criticalClusters.map((cluster) => (
                    <div key={cluster.id} className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-[#991B1B]">{cluster.name}</p>
                        <span className="text-xs text-[#991B1B]">{(cluster as { affectedTracesCount?: number }).affectedTracesCount ?? 0} traces</span>
                      </div>
                      <p className="mt-1 text-xs text-[#7F1D1D]">{((cluster as { clusterType?: string }).clusterType ?? "unknown").replaceAll("_", " ")}</p>
                    </div>
                  ))}
                  {data.criticalClusters.length === 0 && <p className="text-sm text-[#6B7280]">No critical clusters detected.</p>}
                </CardContent>
              </Card>

              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Recent audit activity</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.auditActivity.map((event) => (
                    <div key={event.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-[#111111]">{event.eventType.replaceAll("_", " ")}</p>
                        <span className="text-xs text-[#6B7280]">{new Date(event.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-xs text-[#6B7280]">{event.entityType} · {event.entityName ?? event.entityId}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
