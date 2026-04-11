import { CreditCard, ExternalLink, Sparkles, Zap } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";


export const dynamic = "force-dynamic";

const PLAN_FEATURES = [
  "Unlimited prompts & versions",
  "Up to 1 M proxied requests / month",
  "90-day audit log retention",
  "SSO via Google Workspace",
  "Priority email & Slack support",
  "Custom data-retention policies",
];

export default function BillingPage() {
  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <AppHeader
        title="Billing & plan"
        subtitle="Manage your subscription, payment method, and invoices."
      />

      {/* ── Coming soon banner ── */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/[0.06] via-card/40 to-card/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Stripe integration — coming soon</CardTitle>
            <Badge variant="outline" className="border-primary/30 text-primary">
              In progress
            </Badge>
          </div>
          <CardDescription className="max-w-xl">
            Billing is not yet wired to a payment provider. When Stripe integration ships, this
            page will display your active plan, payment method, usage meters, and downloadable
            invoices — all pulled live from Stripe and your workspace database record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Placeholder plan card */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-semibold text-foreground">What's planned</span>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Zap className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* What to expect */}
          <div className="rounded-xl border border-border/40 bg-muted/30 p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What will be available
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { title: "Subscription management", desc: "Upgrade, downgrade, or cancel your plan directly from the dashboard." },
                { title: "Usage meters", desc: "Live request counts, active seats, and audit log storage vs. your plan limits." },
                { title: "Invoice history", desc: "Download PDF receipts for every billing cycle, with VAT support." },
              ].map((item) => (
                <div key={item.title} className="rounded-lg border border-border/30 bg-card/40 p-3">
                  <p className="mb-1 text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href="https://stripe.com/docs/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Stripe Billing docs
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Button variant="ghost" className="text-muted-foreground">
              Contact us about enterprise pricing
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
