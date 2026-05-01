"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Siren } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiIncident } from "@/lib/api";
import { canUseIncidents } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

function toneForSeverity(severity: string) {
  if (severity === "critical") return "bg-[#FEF2F2] text-[#991B1B]";
  if (severity === "high") return "bg-[#FFF7ED] text-[#C2410C]";
  if (severity === "medium") return "bg-[#FFFBEB] text-[#92400E]";
  return "bg-[#ECFDF5] text-[#065F46]";
}

export default function IncidentsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [items, setItems] = useState<AiIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !canUseIncidents(planTier)) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    fetch(`/api/incidents?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load incidents");
        setItems(json as AiIncident[]);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, planTier]);

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Incidents" subtitle="Operational failures, investigation, and fix verification" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading incidents…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}
        {!loading && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111] flex items-center gap-2"><Siren className="h-4 w-4 text-[#991B1B]" />Incident queue</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                      <th className="py-2 text-left font-semibold">Title</th>
                      <th className="py-2 text-left font-semibold">Severity</th>
                      <th className="py-2 text-left font-semibold">Capability</th>
                      <th className="py-2 text-left font-semibold">Status</th>
                      <th className="py-2 text-left font-semibold">Source</th>
                      <th className="py-2 text-left font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((incident) => (
                      <tr key={incident.id} className="border-b border-[#F1ECE3] last:border-0">
                        <td className="py-2.5">
                          <Link href={`/incidents/${incident.id}`} className="font-medium text-[#111111] hover:text-[#2563EB]">{incident.title}</Link>
                        </td>
                        <td className="py-2.5"><Badge className={toneForSeverity(incident.severity)}>{incident.severity}</Badge></td>
                        <td className="py-2.5 text-[#374151]">{incident.capabilityName ?? "—"}</td>
                        <td className="py-2.5 text-[#374151]">{incident.status.replaceAll("_", " ")}</td>
                        <td className="py-2.5 text-[#6B7280]">{incident.sourceType.replaceAll("_", " ")}</td>
                        <td className="py-2.5 text-[#6B7280]">{new Date(incident.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!items.length && <p className="py-8 text-center text-sm text-[#6B7280]">No incidents yet.</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
