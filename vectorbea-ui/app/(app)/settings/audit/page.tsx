"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuditEvent } from "@/lib/api";
import { canUseGovernanceDashboard } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

export default function AuditPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !canUseGovernanceDashboard(planTier)) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    fetch(`/api/governance/audit?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load audit events");
        setEvents(json as AuditEvent[]);
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
      <AppHeader title="Audit" subtitle="Critical actions and governance history" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading audit history…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Audit history</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                    <th className="py-2 text-left font-semibold">Event</th>
                    <th className="py-2 text-left font-semibold">Entity</th>
                    <th className="py-2 text-left font-semibold">Name</th>
                    <th className="py-2 text-left font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-[#F1ECE3] last:border-0">
                      <td className="py-2.5 text-[#111111]">{event.eventType.replaceAll("_", " ")}</td>
                      <td className="py-2.5 text-[#374151]">{event.entityType}</td>
                      <td className="py-2.5 text-[#6B7280]">{event.entityName ?? event.entityId}</td>
                      <td className="py-2.5 text-[#6B7280]">{new Date(event.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!events.length && !loading && <p className="py-8 text-center text-sm text-[#6B7280]">No audit events yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
