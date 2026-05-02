"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { AiCapability, PolicyPack } from "@/lib/api";
import { canUsePolicyPacks } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

const SECTOR_LABELS: Record<string, string> = {
  retail:           "Retail",
  bfsi:             "BFSI",
  healthcare:       "Healthcare",
  pharma:           "Pharma",
  software_support: "Software Support",
  travel:           "Travel",
  general:          "General AI Safety",
};

const SECTOR_COLOR: Record<string, string> = {
  retail:           "bg-[#FFF7ED] text-[#C2410C]",
  bfsi:             "bg-[#EFF6FF] text-[#1D4ED8]",
  healthcare:       "bg-[#ECFDF5] text-[#065F46]",
  pharma:           "bg-[#F0FDF4] text-[#15803D]",
  software_support: "bg-[#F5F3FF] text-[#6D28D9]",
  travel:           "bg-[#FFF1F2] text-[#BE123C]",
  general:          "bg-[#F3F4F6] text-[#374151]",
};

function GateBanner() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Policy Packs" subtitle="Sector templates for regulated AI workflows" />
      <div className="flex flex-col items-center text-center gap-6 max-w-lg mx-auto px-4 py-16">
        <div className="rounded-full bg-[#EFF6FF] p-5">
          <ShieldAlert className="h-10 w-10 text-[#2563EB]" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-[#111111] mb-3">Policy Packs — available on Pro</h2>
          <p className="text-sm text-[#6B7280] leading-relaxed">
            Apply sector-specific compliance rules to your AI capabilities. Covers Retail, BFSI,
            Healthcare, Pharma, Software Support, Travel, and General AI Safety.
          </p>
        </div>
        <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="rounded-xl border border-[#E7DED1] bg-white p-5 space-y-3 animate-pulse">
          <div className="h-4 w-1/2 rounded bg-[#F1ECE3]" />
          <div className="h-3 w-3/4 rounded bg-[#F1ECE3]" />
          <div className="space-y-2 pt-1">
            {[1, 2, 3].map((r) => <div key={r} className="h-10 rounded-xl bg-[#F8F5EF]" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PolicyPacksPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [packs, setPacks] = useState<PolicyPack[]>([]);
  const [capabilities, setCapabilities] = useState<AiCapability[]>([]);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState("");
  const [canApply, setCanApply] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  function loadData(workspaceId: string) {
    setLoading(true);
    setError(null);
    let cancelled = false;
    Promise.all([
      fetch(`/api/governance/policy-packs?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      fetch(`/api/reliability/capabilities?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
    ]).then(([packsRes, capsRes]) => {
      if (cancelled) return;
      if (!packsRes.ok) throw new Error((packsRes.j as { error?: string }).error ?? "Failed to load policy packs");
      const policyPayload = packsRes.j as { items?: PolicyPack[]; canApply?: boolean };
      const loadedPacks = Array.isArray(policyPayload.items) ? policyPayload.items : [];
      setPacks(loadedPacks);
      setCanApply(Boolean(policyPayload.canApply));
      setCapabilities(capsRes.ok && Array.isArray(capsRes.j) ? capsRes.j as AiCapability[] : []);
      // Collect already-applied pack IDs for the selected capability
      const applied = new Set<string>();
      if (selectedCapabilityId) {
        for (const p of loadedPacks) {
          if ((p.appliedToCapabilityIds ?? []).includes(selectedCapabilityId)) applied.add(p.id);
        }
      }
      setAppliedIds(applied);
    }).catch((e: Error) => {
      if (!cancelled) setError(e.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }

  useEffect(() => {
    if (!activeWorkspaceId) { setLoading(false); return; }
    return loadData(activeWorkspaceId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // Recompute applied set when capability selection changes
  useEffect(() => {
    const applied = new Set<string>();
    for (const p of packs) {
      if (selectedCapabilityId && (p.appliedToCapabilityIds ?? []).includes(selectedCapabilityId)) {
        applied.add(p.id);
      }
    }
    setAppliedIds(applied);
  }, [selectedCapabilityId, packs]);

  async function applyPack(packId: string) {
    if (!activeWorkspaceId || !selectedCapabilityId) return;
    setWorkingId(packId);
    setError(null);
    try {
      const res = await fetch(
        `/api/governance/policy-packs/${encodeURIComponent(packId)}/apply?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capabilityId: selectedCapabilityId }) },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to apply policy pack");
      setAppliedIds((prev) => new Set([...prev, packId]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply policy pack");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Policy Packs" subtitle="Sector compliance templates for your AI capabilities" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {!canUsePolicyPacks(planTier) && (
          <div className="rounded-2xl border border-[#D8CFC2] bg-white p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#111111]">Policy Packs are available on Pro</p>
                <p className="text-xs text-[#6B7280]">
                  Preview system packs now, then upgrade to apply them to capabilities and enforce sector-specific governance rules.
                </p>
              </div>
              <Link href="/settings/billing" className="inline-flex items-center justify-center rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                Upgrade to Pro
              </Link>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => activeWorkspaceId && loadData(activeWorkspaceId)}
              className="flex items-center gap-1.5 rounded-lg border border-[#FECACA] px-2.5 py-1 text-xs font-medium text-[#991B1B] hover:bg-[#FEE2E2]"
            >
              <RefreshCw className="h-3 w-3" />Retry
            </button>
          </div>
        )}

        {/* Apply-to selector */}
        {!loading && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#111111]">Apply pack to capability</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px]">
                <Select
                  value={selectedCapabilityId}
                  onChange={(e) => setSelectedCapabilityId(e.target.value)}
                >
                  <option value="">Select a capability…</option>
                  {capabilities.map((cap) => (
                    <option key={cap.id} value={cap.id}>{cap.name}</option>
                  ))}
                </Select>
              </div>
              {selectedCapabilityId && (
                <p className="text-xs text-[#6B7280]">
                  {appliedIds.size} pack{appliedIds.size !== 1 ? "s" : ""} already applied
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Loading skeleton */}
        {loading && <LoadingSkeleton />}

        {/* Empty state (only after successful load) */}
        {!loading && !error && packs.length === 0 && (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-16 text-center">
              <ShieldAlert className="h-10 w-10 text-[#D8CFC2] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#374151] mb-1">No policy packs found</p>
              <p className="text-xs text-[#6B7280]">
                Default system packs should appear here. If they are missing, run the seed migration.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Pack grid */}
        {!loading && packs.length > 0 && (
          <div className="grid gap-5 xl:grid-cols-2">
            {packs.map((pack) => {
              const isApplied = appliedIds.has(pack.id);
              const sectorColor = SECTOR_COLOR[pack.sector] ?? "bg-[#F3F4F6] text-[#374151]";
              const sectorLabel = SECTOR_LABELS[pack.sector] ?? pack.sector;
              return (
                <Card key={pack.id} className="border-[#E7DED1] bg-white">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-sm text-[#111111]">{pack.name}</CardTitle>
                          {pack.systemPack && (
                            <Badge className="bg-[#F3F4F6] text-[#6B7280] text-[10px]">System</Badge>
                          )}
                          {isApplied && (
                            <Badge className="bg-[#ECFDF5] text-[#065F46] text-[10px] flex items-center gap-1">
                              <CheckCircle2 className="h-2.5 w-2.5" />Applied
                            </Badge>
                          )}
                        </div>
                        {pack.description && (
                          <p className="mt-1 text-xs text-[#6B7280] leading-relaxed">{pack.description}</p>
                        )}
                      </div>
                      <Badge className={`${sectorColor} text-[10px] shrink-0`}>{sectorLabel}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Rule list */}
                    <div className="space-y-1.5">
                      {(pack.rules ?? []).slice(0, 5).map((rule, idx) => (
                        <div
                          key={`${pack.id}-rule-${idx}`}
                          className="flex items-start gap-2.5 rounded-lg border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2"
                        >
                          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2563EB] mt-[5px]" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[#111111] leading-snug">
                              {String(rule.name ?? `Rule ${idx + 1}`)}
                            </p>
                            <p className="text-[10px] text-[#6B7280] mt-0.5">
                              {String(rule.ruleType ?? "policy").replaceAll("_", " ")}
                              {" · "}
                              {String(rule.severity ?? "medium")} severity
                            </p>
                          </div>
                        </div>
                      ))}
                      {(pack.rules ?? []).length > 5 && (
                        <p className="text-xs text-[#6B7280] pl-1">
                          +{(pack.rules ?? []).length - 5} more rules
                        </p>
                      )}
                    </div>

                    {/* Apply CTA */}
                    <button
                      type="button"
                      disabled={!canApply || !selectedCapabilityId || workingId === pack.id || isApplied}
                      onClick={() => void applyPack(pack.id)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {workingId === pack.id
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Applying…</>
                        : isApplied
                          ? <><CheckCircle2 className="h-3.5 w-3.5" />Applied</>
                          : "Apply to capability"}
                    </button>
                    {!canApply && (
                      <p className="text-center text-[11px] text-[#9CA3AF]">Upgrade to Pro to apply policy packs</p>
                    )}
                    {canApply && !selectedCapabilityId && (
                      <p className="text-center text-[11px] text-[#9CA3AF]">Select a capability above to apply this pack</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
