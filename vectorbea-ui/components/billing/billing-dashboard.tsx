"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  ExternalLink,
  FileText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TrustBar, coreTrustSignals } from "@/components/ui/trust-bar";
import { useWorkspace } from "@/lib/workspace-context";

const FALLBACK_PORTAL_URL = process.env.NEXT_PUBLIC_BILLING_PORTAL_URL ?? "";
const TEAM_PLAN_PRICE = 19.99;

const PLAN_COPY: Record<string, string> = {
  free: "Free includes 1 seat, 5 prompts, and 100 audit events every month.",
  team: "Team unlocks more seats, more prompts, and higher monthly audit throughput.",
  pro: "Pro keeps growing teams moving with additional usage headroom.",
  enterprise: "Enterprise adds centralized governance and custom commercial support.",
};

type BillingUsage = {
  planTier: "free" | "team" | "pro" | "enterprise";
  promptsUsed: number;
  promptLimit: number;
  auditsUsed: number;
  auditLimit: number;
  seatsUsed: number | null;
  seatLimit: number;
  usage?: {
    runtime_traces?: number;
    replay_runs?: number;
    evaluation_runs?: number;
  };
  usageLimits?: {
    runtime_traces?: number | null;
    replay_runs?: number | null;
    evaluation_runs?: number | null;
  };
  features?: {
    evaluations?: boolean;
    rollout?: boolean;
    alerts?: boolean;
  };
  billingSummary?: {
    plan: "free" | "team" | "pro" | "enterprise";
    planDisplayName: string;
    status: "free" | "active" | "active_without_subscription";
    billingInterval: "monthly" | null;
    pricePerSeat: number | null;
    originalPricePerSeat: number | null;
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

function UsageBar({
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
  const numericLimit = limit ?? Number.MAX_SAFE_INTEGER;
  const percentage = limit === null ? 0 : Math.min((value / Math.max(numericLimit, 1)) * 100, 100);
  const atLimit = limit !== null && value >= numericLimit;

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">
              {limit === null ? `${value} used` : `${value} / ${numericLimit} used`}
            </p>
          </div>
        </div>
        <Badge variant={atLimit ? "destructive" : "outline"} className="tabular-nums">
          {limit === null ? `${value}/unlimited` : `${value}/${numericLimit}`}
        </Badge>
      </div>
      {limit !== null ? (
        <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
          <div
            className={`h-full rounded-full transition-all ${atLimit ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      ) : (
        <div className="h-2.5 rounded-full bg-muted/60" />
      )}
    </div>
  );
}

export function BillingDashboard() {
  const { activeOrganization, activeWorkspaceId, planTier, seatUsage } = useWorkspace();
  const [seatCount, setSeatCount] = useState(String(Math.max(seatUsage.max, 1)));
  const [isRedirectingToCheckout, setIsRedirectingToCheckout] = useState(false);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const seatsUsed = seatUsage.used;
  const maxSeats = seatUsage.max;
  const effectivePlanTier = (usage?.planTier ?? planTier) as "free" | "team" | "pro" | "enterprise";
  const planLabel = effectivePlanTier.charAt(0).toUpperCase() + effectivePlanTier.slice(1);
  const portalUrl =
    usage?.billingSummary?.portalUrl?.trim() ||
    activeOrganization?.billingPortalUrl?.trim() ||
    FALLBACK_PORTAL_URL;
  const parsedSeatCount = Number.parseInt(seatCount, 10);
  const billingWorkspaceId = activeWorkspaceId ?? activeOrganization?.workspaces?.[0]?.id ?? null;
  const showUpgradeCta = Boolean(usage?.billingSummary?.canUpgrade ?? (effectivePlanTier === "free"));

  useEffect(() => {
    if (!billingWorkspaceId) {
      setUsage(null);
      return;
    }

    const targetWorkspaceId = billingWorkspaceId;
    let cancelled = false;

    async function loadUsage() {
      try {
        setLoadingUsage(true);
        const response = await fetch(
          `/api/billing/usage?workspaceId=${encodeURIComponent(targetWorkspaceId)}`,
          { cache: "no-store" },
        );

        const payload = (await response.json().catch(() => ({}))) as BillingUsage | { error?: string };
        if (!response.ok) {
          throw new Error("error" in payload && payload.error ? payload.error : "Failed to load billing usage.");
        }

        if (!cancelled) {
          setUsage(payload as BillingUsage);
          setSeatCount((current) => {
            const parsed = Number.parseInt(current, 10);
            if (Number.isFinite(parsed) && parsed > 0) return current;
            return String(Math.max((payload as BillingUsage).seatLimit, 1));
          });
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load billing usage.");
        }
      } finally {
        if (!cancelled) {
          setLoadingUsage(false);
        }
      }
    }

    void loadUsage();
    return () => {
      cancelled = true;
    };
  }, [billingWorkspaceId]);

  const effectiveUsage = useMemo(
    () => ({
      promptsUsed: usage?.promptsUsed ?? 0,
      promptLimit: usage?.promptLimit ?? 5,
      auditsUsed: usage?.auditsUsed ?? 0,
      auditLimit: usage?.auditLimit ?? 100,
    }),
    [usage],
  );

  const handleUpgrade = async () => {
    const targetWorkspaceId = billingWorkspaceId;
    if (!targetWorkspaceId) {
      toast.error("No active workspace is selected for billing.");
      return;
    }

    if (!Number.isFinite(parsedSeatCount) || parsedSeatCount < 1) {
      toast.error("Enter a valid number of seats.");
      return;
    }

    setIsRedirectingToCheckout(true);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: parsedSeatCount, workspaceId: targetWorkspaceId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Failed to create Lemon Squeezy checkout.");
      }
      window.location.assign(payload.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create Lemon Squeezy checkout.");
      setIsRedirectingToCheckout(false);
    }
  };

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <AppHeader
        title="Billing & plan"
        subtitle={`Track usage and upgrade options for ${activeOrganization?.name ?? "your organization"}.`}
      />

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
        <Card className="animate-slide-up">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">Current Plan: {planLabel}</CardTitle>
                <CardDescription>{PLAN_COPY[effectivePlanTier] ?? PLAN_COPY.free}</CardDescription>
              </div>
              <Badge variant={effectivePlanTier === "free" ? "outline" : "success"} className="ml-auto">
                {planLabel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl border border-border/60 bg-card/50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Seats used</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {seatsUsed} / {maxSeats}
                  </p>
                </div>
                <Badge variant={seatUsage.atLimit ? "destructive" : "outline"}>
                  {seatUsage.remaining} remaining
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <UsageBar label="Prompts" value={effectiveUsage.promptsUsed} limit={effectiveUsage.promptLimit} icon={<FileText className="h-4 w-4" />} />
              <UsageBar label="Audit events" value={effectiveUsage.auditsUsed} limit={effectiveUsage.auditLimit} icon={<ShieldCheck className="h-4 w-4" />} />
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <UsageBar label="Runtime traces" value={usage?.usage?.runtime_traces ?? 0} limit={usage?.usageLimits?.runtime_traces ?? null} icon={<Sparkles className="h-4 w-4" />} />
              <UsageBar label="Replay runs" value={usage?.usage?.replay_runs ?? 0} limit={usage?.usageLimits?.replay_runs ?? null} icon={<RefreshCw className="h-4 w-4" />} />
              <UsageBar label="Evaluation runs" value={usage?.usage?.evaluation_runs ?? 0} limit={usage?.usageLimits?.evaluation_runs ?? null} icon={<ShieldCheck className="h-4 w-4" />} />
            </div>

            {loadingUsage ? (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                Loading current usage...
              </div>
            ) : null}

            {effectivePlanTier === "free" ? (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                Free plan workspaces default to 1 seat, 5 prompts, and 100 audit events each month.
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                {usage?.billingSummary?.status === "active_without_subscription"
                  ? "Team plan is active from workspace settings, but billing subscription metadata is not linked yet."
                  : "Paid plan is active and enforced server-side."}
              </div>
            )}

            <div className="rounded-xl border border-border/60 bg-card/50 p-4 text-xs text-muted-foreground">
              Feature access on this workspace:
              <span className="ml-2 font-medium">Evaluations</span> {usage?.features?.evaluations ? "enabled" : "locked"} |
              <span className="ml-2 font-medium">Rollout</span> {usage?.features?.rollout ? "enabled" : "locked"} |
              <span className="ml-2 font-medium">Alerts</span> {usage?.features?.alerts ? "enabled" : "locked"}
            </div>
          </CardContent>
        </Card>

        <Card className="animate-slide-up stagger-1">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10">
                <CreditCard className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <CardTitle className="text-base">Subscription</CardTitle>
                <CardDescription>{PLAN_COPY[effectivePlanTier] ?? PLAN_COPY.free}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-border/60 bg-card/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Current plan</p>
                  <p className="mt-2 text-lg font-semibold">{planLabel}</p>
                </div>
                <Badge variant={effectivePlanTier === "free" ? "outline" : "success"}>{planLabel}</Badge>
              </div>
            </div>

            {usage?.billingSummary?.billingInterval ? (
              <div className="rounded-xl border border-border/60 bg-card/50 p-4 text-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Monthly billing</p>
                <p className="mt-2 font-medium">
                  {usage.billingSummary.pricePerSeat !== null ? `$${usage.billingSummary.pricePerSeat.toFixed(2)}` : "Custom"}
                  {usage.billingSummary.billingInterval ? ` / seat / ${usage.billingSummary.billingInterval}` : ""}
                </p>
                {usage.billingSummary.originalPricePerSeat ? (
                  <p className="text-xs text-muted-foreground">
                    Early adopter price. Standard price ${usage.billingSummary.originalPricePerSeat.toFixed(2)}.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-xl border border-border/60 bg-card/50 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">Customer portal</p>
                  <p className="text-xs text-muted-foreground">
                    Update payment details, review invoices, and manage seats from your billing provider.
                  </p>
                </div>
              </div>
            </div>

            <TrustBar signals={coreTrustSignals} variant="compact" />

            {showUpgradeCta ? (
              <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium">Upgrade to Team Plan</p>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">
                      ${TEAM_PLAN_PRICE.toFixed(2)}
                      <span className="ml-1 text-sm font-medium text-muted-foreground">/ month per seat</span>
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="seat-count" className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Number of seats
                    </label>
                    <Input id="seat-count" type="number" min={1} step={1} value={seatCount} onChange={(event) => setSeatCount(event.target.value)} />
                  </div>
                  <Button type="button" onClick={() => void handleUpgrade()} disabled={isRedirectingToCheckout || !billingWorkspaceId} className="w-full">
                    {isRedirectingToCheckout ? "Redirecting to checkout..." : "Upgrade to Team Plan"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-card/50 p-4 text-xs text-muted-foreground">
                This workspace is already on a paid plan.
                {usage?.billingSummary?.canCancel || usage?.billingSummary?.canDowngrade
                  ? " Use billing portal actions for cancel or downgrade."
                  : " Billing portal actions are unavailable until subscription metadata is linked."}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => {
                  if (portalUrl) {
                    window.location.assign(portalUrl);
                  }
                }}
                disabled={!portalUrl}
              >
                Manage Subscription
                <ExternalLink className="h-4 w-4" />
              </Button>
              {!portalUrl ? (
                <p className="text-xs text-muted-foreground">
                  Billing portal URL is not configured for this environment.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

