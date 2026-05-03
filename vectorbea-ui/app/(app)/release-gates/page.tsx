"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  GitMerge,
  Loader2,
  ShieldX,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ReleaseGateCheck, ReleaseGateStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

type GateRow = {
  versionId: string;
  aiSystemId: string;
  systemName: string;
  systemType: string;
  versionNumber: string;
  versionStatus: string;
  environment: string;
  riskLevel: string;
  decision: ReleaseGateStatus;
  checks: ReleaseGateCheck[];
  reasons: string[];
  evaluatedAt: string;
};

const DECISION_CONFIG: Record<ReleaseGateStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  safe_to_release: { label: "Safe", color: "bg-[#ECFDF5] text-[#065F46]", icon: CheckCircle2 },
  blocked: { label: "Blocked", color: "bg-[#FEF2F2] text-[#991B1B]", icon: XCircle },
  needs_review: { label: "Needs Review", color: "bg-[#FFFBEB] text-[#92400E]", icon: AlertTriangle },
  missing_evidence: { label: "Missing Evidence", color: "bg-[#FFF7ED] text-[#C2410C]", icon: ShieldX },
};

function checkStatusIcon(status: ReleaseGateCheck["status"]) {
  if (status === "pass") return <CheckCircle2 className="h-3.5 w-3.5 text-[#065F46]" />;
  if (status === "fail") return <XCircle className="h-3.5 w-3.5 text-[#991B1B]" />;
  if (status === "pending") return <AlertTriangle className="h-3.5 w-3.5 text-[#92400E]" />;
  return <ShieldX className="h-3.5 w-3.5 text-[#C2410C]" />;
}

export default function ReleaseGatesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [gates, setGates] = useState<GateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReleaseGateStatus | "all">("all");

  useEffect(() => {
    if (!activeWorkspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/release-gates?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.error ?? "Failed to load release gates");
        setGates(Array.isArray(data) ? data : []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load release gates"))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId]);

  const visible = filter === "all" ? gates : gates.filter((gate) => gate.decision === filter);
  const count = (decision: ReleaseGateStatus) => gates.filter((gate) => gate.decision === decision).length;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Release Gates"
        subtitle="Evidence-backed release decisions for AI system versions"
      />

      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["safe_to_release", "blocked", "needs_review", "missing_evidence"] as ReleaseGateStatus[]).map((decision) => {
            const cfg = DECISION_CONFIG[decision];
            const Icon = cfg.icon;
            return (
              <button
                key={decision}
                type="button"
                onClick={() => setFilter(filter === decision ? "all" : decision)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-[#E7DED1] bg-white px-4 py-3 text-left transition-all hover:border-[#2563EB]/40",
                  filter === decision && "ring-2 ring-[#2563EB]",
                )}
              >
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", cfg.color.split(" ")[0])}>
                  <Icon className={cn("h-4 w-4", cfg.color.split(" ")[1])} />
                </span>
                <span>
                  <span className="block text-xl font-bold text-[#111111]">{loading ? "-" : count(decision)}</span>
                  <span className="block text-[11px] text-[#6B7280]">{cfg.label}</span>
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-[#6B7280]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading release gates...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-6 text-center">
            <p className="text-sm text-[#991B1B]">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        ) : gates.length === 0 ? (
          <Card className="border-dashed border-[#E7DED1] bg-white">
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#EFF6FF]">
                <GitMerge className="h-7 w-7 text-[#2563EB]" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#111111]">No versions ready for gate evaluation</h3>
                <p className="mt-1 max-w-sm text-sm text-[#6B7280]">
                  Create an AI System version, apply a policy pack, and run required evidence to evaluate its release gate.
                </p>
              </div>
              <Link href="/registry/systems" className={buttonVariants({ size: "sm" })}>
                Go to AI Registry
              </Link>
            </CardContent>
          </Card>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#6B7280]">
            No versions match this gate filter.
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((gate) => {
              const cfg = DECISION_CONFIG[gate.decision];
              const Icon = cfg.icon;
              return (
                <Card key={gate.versionId} className="border-[#E7DED1] bg-white transition-shadow hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", cfg.color.split(" ")[0])}>
                        <Icon className={cn("h-4 w-4", cfg.color.split(" ")[1])} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-[#111111]">{gate.systemName}</h3>
                          <Badge className={`${cfg.color} text-[10px] font-normal`}>{cfg.label}</Badge>
                          <Badge className="bg-[#F3F4F6] text-[#374151] text-[10px] font-normal">{gate.versionNumber}</Badge>
                          <Badge className="bg-[#F3F4F6] text-[#374151] text-[10px] font-normal">{gate.versionStatus}</Badge>
                          <Badge className="bg-[#FFF7ED] text-[#C2410C] text-[10px] font-normal">{gate.riskLevel} risk</Badge>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {gate.checks.slice(0, 4).map((check) => (
                            <div key={`${gate.versionId}-${check.label}`} className="flex items-center gap-1.5">
                              {checkStatusIcon(check.status)}
                              <span className="truncate text-[11px] text-[#6B7280]">{check.label}</span>
                            </div>
                          ))}
                        </div>
                        {gate.reasons.length > 0 && (
                          <p className="mt-2 text-xs text-[#92400E]">{gate.reasons[0]}</p>
                        )}
                      </div>
                      <Link
                        href={`/release-gates/${gate.versionId}` as Route}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-[#E7DED1] bg-white px-3 py-1.5 text-xs text-[#374151] hover:bg-[#F8F5EF]"
                      >
                        View gate <ChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
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
