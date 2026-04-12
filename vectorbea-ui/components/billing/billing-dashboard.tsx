"use client";

import { useState } from "react";
import { CreditCard, ExternalLink, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/workspace-context";

const FALLBACK_PORTAL_URL = process.env.NEXT_PUBLIC_BILLING_PORTAL_URL ?? "";

const PLAN_COPY: Record<string, string> = {
  free: "Free tier with starter limits for a single organization and a small team.",
  pro: "Pro plan with more room for growing delivery teams and heavier prompt operations.",
  enterprise: "Enterprise plan with per-seat billing, larger limits, and centralized governance.",
};

export function BillingDashboard() {
  const { activeOrganization, planTier, seatUsage } = useWorkspace();
  const [seatCount, setSeatCount] = useState(
    String(Math.max(seatUsage.max, seatUsage.used, 1)),
  );
  const [isRedirectingToCheckout, setIsRedirectingToCheckout] = useState(false);

  const seatsUsed = seatUsage.used;
  const maxSeats = seatUsage.max;
  const usagePercent = Math.min((seatsUsed / Math.max(maxSeats, 1)) * 100, 100);
  const portalUrl = activeOrganization?.billingPortalUrl?.trim() || FALLBACK_PORTAL_URL;
  const planLabel = planTier.charAt(0).toUpperCase() + planTier.slice(1);
  const parsedSeatCount = Number.parseInt(seatCount, 10);

  const handleUpgrade = async () => {
    if (!activeOrganization?.id) {
      toast.error("No active organization is selected for billing.");
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quantity: parsedSeatCount,
          workspaceId: activeOrganization.id,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Failed to create Lemon Squeezy checkout.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create Lemon Squeezy checkout.",
      );
      setIsRedirectingToCheckout(false);
    }
  };

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <AppHeader
        title="Billing & plan"
        subtitle={`Track seat usage and subscription details for ${activeOrganization?.name ?? "your organization"}.`}
      />

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
        <Card className="animate-slide-up">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">Seats used</CardTitle>
                <CardDescription>
                  {seatsUsed} of {maxSeats} paid seats are currently assigned across this organization.
                </CardDescription>
              </div>
              <Badge variant={seatUsage.atLimit ? "destructive" : "outline"} className="ml-auto">
                {seatsUsed}/{maxSeats}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                <span>Seat usage</span>
                <span>{Math.round(usagePercent)}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-muted/60">
                <div
                  className={`h-full rounded-full transition-all ${
                    seatUsage.atLimit ? "bg-destructive" : "bg-primary"
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Seats used
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{seatsUsed}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Max seats
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{maxSeats}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Remaining
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {seatUsage.remaining}
                </p>
              </div>
            </div>

            {seatUsage.atLimit && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                Seat capacity is fully allocated. Upgrade the subscription before inviting more developers.
              </div>
            )}
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
                <CardDescription>{PLAN_COPY[planTier] ?? PLAN_COPY.free}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-border/60 bg-card/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Current plan
                  </p>
                  <p className="mt-2 text-lg font-semibold">{planLabel}</p>
                </div>
                <Badge variant={planTier === "enterprise" ? "success" : "outline"}>
                  {planLabel}
                </Badge>
              </div>
            </div>

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

            <div className="rounded-xl border border-border/60 bg-card/50 p-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Upgrade to Enterprise</p>
                  <p className="text-xs text-muted-foreground">
                    Choose how many paid seats this organization needs, then continue to Lemon Squeezy checkout.
                  </p>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="seat-count"
                    className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                  >
                    Number of seats
                  </label>
                  <Input
                    id="seat-count"
                    type="number"
                    min={1}
                    step={1}
                    value={seatCount}
                    onChange={(event) => setSeatCount(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => void handleUpgrade()}
                  disabled={isRedirectingToCheckout || !activeOrganization?.id}
                  className="w-full"
                >
                  {isRedirectingToCheckout ? "Redirecting to checkout..." : "Upgrade to Enterprise"}
                </Button>
              </div>
            </div>

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
              {!portalUrl && (
                <p className="text-xs text-muted-foreground">
                  Add a billing portal URL to this organization to enable self-serve subscription management.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
