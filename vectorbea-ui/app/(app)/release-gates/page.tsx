"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  BadgeCheck,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileBarChart2,
  GitMerge,
  Loader2,
  Scale,
  ShieldX,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiCapability } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type GateStatus = "approved" | "blocked" | "needs_review" | "missing_evidence" | "unknown";

type ReleaseGate = {
  id: string;
  systemName: string;
  systemType: string;
  environment: string;
  riskLevel: string;
  status: GateStatus;
  checks: {
    label: string;
    status: "pass" | "fail" | "missing" | "pending";
    detail?: string;
  }[];
  lastUpdated: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gateStatusConfig(status: GateStatus) {
  switch (status) {
    case "approved":
      return { label: "Approved", color: "bg-[#ECFDF5] text-[#065F46]", icon: CheckCircle2 };
    case "blocked":
      return { label: "Blocked", color: "bg-[#FEF2F2] text-[#991B1B]", icon: XCircle };
    case "needs_review":
      return { label: "Needs Review", color: "bg-[#FFFBEB] text-[#92400E]", icon: TriangleAlert };
    case "missing_evidence":
      return { label: "Missing Evidence", color: "bg-[#FFF7ED] text-[#C2410C]", icon: ShieldX };
    default:
      return { label: "Unknown", color: "bg-muted text-muted-foreground", icon: GitMerge };
  }
}

function checkStatusIcon(status: "pass" | "fail" | "missing" | "pending") {
  switch (status) {
    case "pass":
      return <CheckCircle2 className="h-3.5 w-3.5 text-[#065F46]" />;
    case "fail":
      return <XCircle className="h-3.5 w-3.5 text-[#991B1B]" />;
    case "missing":
      return <ShieldX className="h-3.5 w-3.5 text-[#C2410C]" />;
    case "pending":
      return <TriangleAlert className="h-3.5 w-3.5 text-[#92400E]" />;
  }
}

// ─── Build gates from AI systems ─────────────────────────────────────────────

function buildGatesFromCapabilities(caps: AiCapability[]): ReleaseGate[] {
  return caps.map((cap) => {
    const hasEvidence = cap.lastCheckStatus != null;
    const evidencePassed = cap.lastCheckStatus === "passed";
    const hasPolicy = (cap as any).policy_pack_id != null;
    const riskLevel = cap.riskLevel ?? "medium";

    const status: GateStatus =
      !hasEvidence
        ? "missing_evidence"
        : evidencePassed && hasPolicy
          ? "approved"
          : !evidencePassed
            ? "blocked"
            : "needs_review";

    return {
      id: cap.id,
      systemName: cap.name,
      systemType: cap.type ?? "prompt",
      environment: (cap as any).environment ?? "production",
      riskLevel,
      status,
      checks: [
        {
          label: "Policy applied",
          status: hasPolicy ? "pass" : "missing",
          detail: hasPolicy ? undefined : "No policy pack applied",
        },
        {
          label: "Behavioral evidence",
          status: hasEvidence ? (evidencePassed ? "pass" : "fail") : "missing",
          detail: hasEvidence
            ? evidencePassed ? "All checks passed" : "One or more checks failed"
            : "No evidence run found",
        },
        {
          label: "Regression evidence",
          status: "missing",
          detail: "No regression suite linked",
        },
        {
          label: "Human approval",
          status: "pending",
          detail: "Awaiting reviewer",
        },
      ],
      lastUpdated: cap.updatedAt ?? cap.createdAt ?? new Date().toISOString(),
    };
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReleaseGatesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [gates, setGates] = useState<ReleaseGate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GateStatus | "all">("all");

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/reliability/capabilities?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: AiCapability[]) => {
        setGates(buildGatesFromCapabilities(data));
      })
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Failed to load release gates");
      })
      .finally(() => setLoading(false));
  }, [activeWorkspaceId]);

  const counts = {
    all: gates.length,
    approved: gates.filter((g) => g.status === "approved").length,
    blocked: gates.filter((g) => g.status === "blocked").length,
    needs_review: gates.filter((g) => g.status === "needs_review").length,
    missing_evidence: gates.filter((g) => g.status === "missing_evidence").length,
    unknown: 0,
  };

  const visible = filter === "all" ? gates : gates.filter((g) => g.status === filter);

  return (
    <div className="flex flex-col">
      <AppHeader
        title="Release Gates"
        subtitle="Governance decisions for each AI system version before it goes live"
      />

      <div className="flex-1 space-y-6 p-6">
        {/* Summary strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { key: "approved", label: "Approved", icon: CheckCircle2, color: "text-[#065F46]", bg: "bg-[#ECFDF5]" },
              { key: "blocked", label: "Blocked", icon: XCircle, color: "text-[#991B1B]", bg: "bg-[#FEF2F2]" },
              { key: "needs_review", label: "Needs Review", icon: TriangleAlert, color: "text-[#92400E]", bg: "bg-[#FFFBEB]" },
              { key: "missing_evidence", label: "Missing Evidence", icon: ShieldX, color: "text-[#C2410C]", bg: "bg-[#FFF7ED]" },
            ] as const
          ).map(({ key, label, icon: Icon, color, bg }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(filter === key ? "all" : key)}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-all hover:shadow-sm",
                filter === key && "ring-2 ring-primary",
              )}
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", bg)}>
                <Icon className={cn("h-4 w-4", color)} />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{loading ? "—" : counts[key]}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Gates table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        ) : gates.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <GitMerge className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">No AI systems registered yet</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Register your first AI system in the AI Registry to see its release gate status here.
                </p>
              </div>
              <div className="flex gap-3">
                <Link href="/reliability/capabilities" className={buttonVariants({ size: "sm" })}>
                  Go to AI Registry
                </Link>
                <Link href="/governance/policy-packs" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Configure Policies
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No AI systems match this filter.{" "}
                <button
                  type="button"
                  className="text-primary underline underline-offset-2"
                  onClick={() => setFilter("all")}
                >
                  Show all
                </button>
              </p>
            ) : (
              visible.map((gate) => {
                const cfg = gateStatusConfig(gate.status);
                const StatusIcon = cfg.icon;
                return (
                  <Card key={gate.id} className="transition-shadow hover:shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        {/* Status icon */}
                        <div
                          className={cn(
                            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                            cfg.color.includes("065F46") ? "bg-[#ECFDF5]" :
                            cfg.color.includes("991B1B") ? "bg-[#FEF2F2]" :
                            cfg.color.includes("92400E") ? "bg-[#FFFBEB]" :
                            "bg-[#FFF7ED]",
                          )}
                        >
                          <StatusIcon className={cn("h-4.5 w-4.5", cfg.color.split(" ")[1])} />
                        </div>

                        {/* System info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">{gate.systemName}</h3>
                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cfg.color)}>
                              {cfg.label}
                            </span>
                            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground capitalize">
                              {gate.environment}
                            </span>
                            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground capitalize">
                              {gate.riskLevel} risk
                            </span>
                          </div>

                          {/* Check rows */}
                          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
                            {gate.checks.map((check) => (
                              <div key={check.label} className="flex items-center gap-1.5">
                                {checkStatusIcon(check.status)}
                                <span className="text-[11px] text-muted-foreground truncate">{check.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Actions */}
                        <Link
                          href={`/reliability/capabilities/${gate.id}` as Route}
                          className="shrink-0 flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          View <ChevronRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        )}

        {/* Bottom CTA strip */}
        {gates.length > 0 && !loading && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Scale className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Gate decisions are driven by policy compliance, evidence runs, and human approvals.
                </p>
              </div>
              <div className="flex gap-2">
                <Link href="/governance/policy-packs" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <Scale className="mr-1.5 h-3.5 w-3.5" />
                  Manage Policies
                </Link>
                <Link href="/evaluations" className={buttonVariants({ size: "sm" })}>
                  <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
                  Run Evidence Check
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
