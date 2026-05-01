"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, Bell, CreditCard, Gauge, ShieldCheck, Swords, Users } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

type UsageMeter =
  | "traces"
  | "replay_runs"
  | "evaluation_executions"
  | "provider_executions"
  | "judge_executions"
  | "scheduled_regression_runs"
  | "provider_arena_runs"
  | "notification_emails";

type BillingUsage = {
  planTier: "free" | "plus" | "pro" | "enterprise";
  planLabel: string;
  resetAt: string;
  promptUsage: { used: number; limit: number };
  workspaceLimits: {
    workspaces: number | null;
    users: number | null;
    prompts: number | null;
    environments: number | null;
    providerConnections: number | null;
    retentionDays: number | null;
  };
  currentCounts: {
    seatsUsed: number | null;
    providerConnections: number;
  };
  usage: Record<UsageMeter, number>;
  usageLimits: Record<UsageMeter, number | null>;
  billingSummary: {
    plan: "free" | "plus" | "pro" | "enterprise";
    planDisplayName: string;
    status: "free" | "active" | "active_without_subscription";
    billingInterval: "monthly" | null;
    pricePerSeat: number | null;
    annualPricePerSeat: number | null;
    workspacePrice: number | null;
    annualWorkspacePrice: number | null;
    currency: string | null;
    seatCount: number | null;
    canUpgrade: boolean;
    canManageBilling: boolean;
    canCancel: boolean;
    canDowngrade: boolean;
    lemonSqueezyCustomerId: string | null;
    lemonSqueezySubscriptionId: string | null;
    portalUrl: string | null;
  };
};

function meterTone(used: number, limit: number | null) {
  if (limit === null || limit <= 0) return "neutral";
  const ratio = used / limit;
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.7) return "warning";
  return "healthy";
}

function meterLabel(meter: UsageMeter) {
  switch (meter) {
    case "traces":
      return "Traces";
    case "evaluation_executions":
      return "Evaluation executions";
    case "provider_executions":
      return "Provider executions";
    case "judge_executions":
      return "Judge executions";
    case "scheduled_regression_runs":
      return "Scheduled regressions";
    case "provider_arena_runs":
      return "Provider Arena runs";
    case "notification_emails":
      return "Notification emails";
    case "replay_runs":
      return "Replay runs";
    default:
      return meter;
  }
}

function MeterCard({
  label,
  value,
  limit,
  icon,
}: {
  label: string;
  value: number;
  limit: number | null;
  icon: React.ReactNode;
}) {
  const tone = meterTone(value, limit);
  const pct = limit ? Math.min((value / Math.max(limit, 1)) * 100, 100) : 0;
  const barClass =
    tone === "critical"
      ? "bg-red-600"
      : tone === "warning"
        ? "bg-amber-600"
        : "bg-emerald-600";

  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">
                {limit === null ? `${value} used` : `${value} of ${limit} used`}
              </p>
            </div>
          </div>
          <Badge variant={tone === "critical" ? "destructive" : "outline"}>
            {limit === null ? "Custom" : `${Math.round(pct)}%`}
          </Badge>
        </div>
        <div className="space-y-2">
          <div className="h-2.5 rounded-full bg-muted/70">
            <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${limit ? pct : 0}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {limit === null ? "Enterprise custom limit" : `${Math.max(limit - value, 0)} remaining this month`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function BillingDashboard() {
  const { activeOrganization, activeWorkspaceId } = useWorkspace();
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const workspaceId = activeWorkspaceId;
        if (!workspaceId) return;
        const response = await fetch(`/api/billing/usage?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as BillingUsage | { error?: string };
        if (!response.ok) {
          throw new Error("error" in payload && payload.error ? payload.error : "Failed to load usage.");
        }
        if (!cancelled) setUsage(payload as BillingUsage);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load usage.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const upgradeHref = useMemo(() => {
    if (!usage) return "/signup?plan=pro";
    if (usage.planTier === "free" || usage.planTier === "plus") return "/signup?plan=pro";
    return "/book-demo";
  }, [usage]);

  const meters: UsageMeter[] = [
    "traces",
    "evaluation_executions",
    "provider_executions",
    "judge_executions",
    "scheduled_regression_runs",
    "provider_arena_runs",
  ];

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <AppHeader
        title="Usage and billing"
        subtitle={`Monitor plan limits and upgrade paths for ${activeOrganization?.name ?? "your workspace"}.`}
      />

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Current plan</CardTitle>
                <CardDescription>Server enforced quotas and feature access for this workspace.</CardDescription>
              </div>
              <Badge className="ml-auto" variant={usage?.planTier === "enterprise" ? "outline" : "secondary"}>
                {usage?.planLabel ?? "Loading"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Prompts</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {usage?.promptUsage.used ?? 0}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">/ {usage?.promptUsage.limit ?? "—"}</span>
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Seats</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {usage?.currentCounts.seatsUsed ?? 0}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">/ {usage?.workspaceLimits.users ?? "—"}</span>
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Provider connections</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {usage?.currentCounts.providerConnections ?? 0}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">/ {usage?.workspaceLimits.providerConnections ?? "—"}</span>
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {meters.map((meter) => (
                <MeterCard
                  key={meter}
                  label={meterLabel(meter)}
                  value={usage?.usage[meter] ?? 0}
                  limit={usage?.usageLimits[meter] ?? null}
                  icon={
                    meter === "traces" ? <Activity className="h-4 w-4" /> :
                    meter === "evaluation_executions" ? <ShieldCheck className="h-4 w-4" /> :
                    meter === "provider_executions" ? <Users className="h-4 w-4" /> :
                    meter === "judge_executions" ? <Bell className="h-4 w-4" /> :
                    meter === "provider_arena_runs" ? <Swords className="h-4 w-4" /> :
                    <Gauge className="h-4 w-4" />
                  }
                />
              ))}
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground">
              Monthly reset
              <span className="ml-2 font-medium text-foreground">
                {usage?.resetAt ? new Date(usage.resetAt).toLocaleDateString() : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Billing</CardTitle>
                <CardDescription>Upgrade paths and billing controls.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Plan</p>
              <p className="mt-2 text-xl font-semibold text-foreground">{usage?.billingSummary.planDisplayName ?? "—"}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {usage?.planTier === "free" && "Explore AI risk control"}
                {usage?.planTier === "plus" && "Validate LLM features before production"}
                {usage?.planTier === "pro" && "Control production LLM risk"}
                {usage?.planTier === "enterprise" && "Govern AI behavior at scale"}
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/70 p-4 text-sm">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Pricing</p>
              <div className="mt-2 space-y-1 text-foreground">
                {usage?.planTier === "plus" && (
                  <>
                    <p>$29 monthly</p>
                    <p className="text-muted-foreground">$23 billed annually</p>
                  </>
                )}
                {usage?.planTier === "pro" && (
                  <>
                    <p>$499 per workspace monthly</p>
                    <p className="text-muted-foreground">$399 per workspace billed annually</p>
                  </>
                )}
                {usage?.planTier === "enterprise" && <p>Custom pricing and governance controls</p>}
                {usage?.planTier === "free" && <p>$0 with small monthly limits</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground">
              Retention
              <span className="ml-2 font-medium text-foreground">
                {usage?.workspaceLimits.retentionDays === null ? "Custom" : `${usage?.workspaceLimits.retentionDays ?? 0} days`}
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              {usage?.billingSummary.canManageBilling && usage.billingSummary.portalUrl ? (
                <a
                  href={usage.billingSummary.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "default" }))}
                >
                  Manage billing
                </a>
              ) : null}
              {usage?.billingSummary.canUpgrade ? (
                <Link
                  href={upgradeHref}
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  {usage.planTier === "pro" ? "Talk to sales" : "Upgrade"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading current usage…</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
