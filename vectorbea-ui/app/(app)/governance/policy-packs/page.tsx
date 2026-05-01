"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiCapability, PolicyPack } from "@/lib/api";
import { canUsePolicyPacks } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

export default function PolicyPacksPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [packs, setPacks] = useState<PolicyPack[]>([]);
  const [capabilities, setCapabilities] = useState<AiCapability[]>([]);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState("");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !canUsePolicyPacks(planTier)) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    Promise.all([
      fetch(`/api/governance/policy-packs?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }).then((res) => res.json().then((json) => ({ ok: res.ok, json }))),
      fetch(`/api/reliability/capabilities?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }).then((res) => res.json().then((json) => ({ ok: res.ok, json }))),
    ]).then(([packsRes, capsRes]) => {
      if (cancelled) return;
      if (!packsRes.ok) throw new Error(packsRes.json.error ?? "Failed to load policy packs");
      if (!capsRes.ok) throw new Error(capsRes.json.error ?? "Failed to load capabilities");
      setPacks(packsRes.json as PolicyPack[]);
      setCapabilities(capsRes.json as AiCapability[]);
    }).catch((e: Error) => {
      if (!cancelled) setError(e.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, planTier]);

  async function applyPack(packId: string) {
    if (!activeWorkspaceId || !selectedCapabilityId) return;
    setWorkingId(packId);
    setError(null);
    try {
      const res = await fetch(`/api/governance/policy-packs/${encodeURIComponent(packId)}/apply?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityId: selectedCapabilityId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to apply policy pack");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply policy pack");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Policy Packs" subtitle="Sector templates for regulated AI workflows" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {!canUsePolicyPacks(planTier) && <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-4 text-sm text-[#6B7280]">Policy packs and custom governance controls are available on Enterprise.</div>}
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading policy packs…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}
        {canUsePolicyPacks(planTier) && (
          <>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Apply pack to capability</CardTitle></CardHeader>
              <CardContent>
                <select value={selectedCapabilityId} onChange={(e) => setSelectedCapabilityId(e.target.value)} className="w-full rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]">
                  <option value="">Select capability</option>
                  {capabilities.map((capability) => <option key={capability.id} value={capability.id}>{capability.name}</option>)}
                </select>
              </CardContent>
            </Card>
            <div className="grid gap-5 xl:grid-cols-2">
              {packs.map((pack) => (
                <Card key={pack.id} className="border-[#E7DED1] bg-white">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-sm text-[#111111]">{pack.name}</CardTitle>
                        <p className="mt-1 text-sm text-[#6B7280]">{pack.description}</p>
                      </div>
                      <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{pack.sector}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      {pack.rules.slice(0, 4).map((rule, index) => (
                        <div key={`${pack.id}-${index}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                          <p className="font-medium text-[#111111]">{String(rule.name ?? `Rule ${index + 1}`)}</p>
                          <p className="mt-1 text-xs text-[#6B7280]">{String(rule.ruleType ?? "business_policy").replaceAll("_", " ")}</p>
                        </div>
                      ))}
                    </div>
                    <button type="button" disabled={!selectedCapabilityId || workingId === pack.id} onClick={() => void applyPack(pack.id)} className="w-full rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
                      Apply to capability
                    </button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
