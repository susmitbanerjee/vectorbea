import Link from "next/link";
import { ArrowRight, Check, Sparkles, Building2, Code2 } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Tier {
  id: string;
  name: string;
  tagline: string;
  priceLabel: string;
  priceSuffix: string;
  billingNote: string;
  cta: { label: string; href: string };
  highlight?: boolean;
  icon: typeof Sparkles;
  iconColor: string;
  iconBg: string;
  features: string[];
}

const tiers: Tier[] = [
  {
    id: "developer",
    name: "Developer",
    tagline: "For solo builders shipping side projects.",
    priceLabel: "$0",
    priceSuffix: "/ month",
    billingNote: "Free forever — no credit card.",
    cta: { label: "Start free", href: "/checkout?plan=developer" },
    icon: Code2,
    iconColor: "text-cyan-400",
    iconBg: "bg-cyan-500/10 ring-cyan-500/20",
    features: [
      "1 workspace, 1 seat",
      "10,000 proxied calls / month",
      "30-day audit log retention",
      "Community Discord support",
      "Self-host the proxy sidecar",
    ],
  },
  {
    id: "team",
    name: "Team",
    tagline: "Per-seat billing for growing AI teams.",
    priceLabel: "$29",
    priceSuffix: "/ seat / month",
    billingNote: "Billed monthly or annually (save 20%).",
    cta: { label: "Start 14-day trial", href: "/checkout?plan=team" },
    highlight: true,
    icon: Sparkles,
    iconColor: "text-primary",
    iconBg: "bg-primary/10 ring-primary/30",
    features: [
      "Unlimited workspaces",
      "1,000,000 proxied calls / month included",
      "$0.50 per additional 1k calls",
      "1-year audit log retention",
      "RBAC & SSO (Google, Microsoft)",
      "Priority email support · 1 business day",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Custom billing cycles, on-prem, dedicated support.",
    priceLabel: "Custom",
    priceSuffix: "",
    billingNote: "Annual or quarterly invoicing · NET-30/60.",
    cta: { label: "Talk to sales", href: "mailto:sales@vectorbee.dev" },
    icon: Building2,
    iconColor: "text-violet-400",
    iconBg: "bg-violet-500/10 ring-violet-500/20",
    features: [
      "Unlimited seats & calls",
      "Air-gapped / VPC deployment",
      "SAML SSO, SCIM provisioning",
      "Indefinite audit log retention",
      "Custom DPA, SOC 2 report, MSA",
      "Dedicated Slack channel · 99.9% SLA",
      "Named solutions architect",
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-white">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade" style={{ backgroundSize: "100% 100%, 24px 24px, 24px 24px" }} />
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2">
        <div className="h-[600px] w-[800px] rounded-full bg-primary/8 blur-[140px]" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-semibold tracking-tight">VectorBee</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Home
          </Link>
          <Link href="/onboarding" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-3xl px-6 pt-16 text-center md:pt-24">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-xs font-medium text-primary">
          Simple, predictable pricing
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Pay for what you ship,
          <br />
          <span className="bg-gradient-to-r from-primary via-violet-400 to-cyan-400 bg-clip-text text-transparent">
            not what you experiment with.
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
          Free for individual developers. Per-seat billing for teams. Custom contracts for enterprises with bespoke billing cycles.
        </p>
      </section>

      <section className="relative z-10 mx-auto mt-16 grid max-w-6xl gap-6 px-6 pb-24 md:grid-cols-3">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          return (
            <div
              key={tier.id}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card/60 p-7 backdrop-blur-xl transition-all",
                tier.highlight
                  ? "border-primary/40 shadow-[0_0_0_1px_rgba(99,102,241,0.3),0_20px_60px_-20px_rgba(99,102,241,0.4)]"
                  : "border-white/8 hover:border-white/15",
              )}
            >
              {tier.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
                  Most popular
                </div>
              )}

              <div className={cn("mb-5 flex h-11 w-11 items-center justify-center rounded-xl ring-1", tier.iconBg)}>
                <Icon className={cn("h-5 w-5", tier.iconColor)} />
              </div>

              <h3 className="text-lg font-semibold">{tier.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{tier.tagline}</p>

              <div className="mt-6 flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tracking-tight">{tier.priceLabel}</span>
                {tier.priceSuffix && (
                  <span className="text-sm text-muted-foreground">{tier.priceSuffix}</span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{tier.billingNote}</p>

              <a
                href={tier.cta.href}
                className={cn(
                  buttonVariants({ size: "sm", variant: tier.highlight ? "default" : "outline" }),
                  "mt-6 w-full gap-1.5 text-center",
                )}
              >
                {tier.cta.label} <ArrowRight className="h-3.5 w-3.5" />
              </a>

              <ul className="mt-7 space-y-3 border-t border-white/8 pt-6">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <Check className={cn("mt-0.5 h-4 w-4 flex-shrink-0", tier.iconColor)} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-32">
        <div className="rounded-2xl border border-white/8 bg-card/40 p-8 backdrop-blur-xl">
          <h2 className="text-xl font-semibold">Frequently asked</h2>
          <div className="mt-6 grid gap-6 text-sm md:grid-cols-2">
            <div>
              <p className="font-medium text-white">How does per-seat billing work?</p>
              <p className="mt-1.5 text-muted-foreground">
                Each user that logs into your workspace counts as one seat. We pro-rate
                additions and removals daily, so adding a teammate mid-cycle only charges
                for the days they were active.
              </p>
            </div>
            <div>
              <p className="font-medium text-white">What counts as a &quot;proxied call&quot;?</p>
              <p className="mt-1.5 text-muted-foreground">
                Any inference request that flows through the VectorBee sidecar to an LLM
                provider. Prompt edits, audit views, and dashboard activity are
                <span className="text-white"> never</span> billed as calls.
              </p>
            </div>
            <div>
              <p className="font-medium text-white">Can enterprises invoice quarterly?</p>
              <p className="mt-1.5 text-muted-foreground">
                Yes — enterprise contracts support monthly, quarterly, or annual billing
                cycles with NET-30 or NET-60 terms. We&apos;ll match your AP process.
              </p>
            </div>
            <div>
              <p className="font-medium text-white">Is there a free trial for Team?</p>
              <p className="mt-1.5 text-muted-foreground">
                Every Team workspace gets a 14-day trial of all paid features. No credit
                card required to start, and you can downgrade to Developer at any time.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/8 px-6 py-10 text-center text-xs text-slate-600">
        <p>© {new Date().getFullYear()} VectorBee · Prompt infrastructure for production AI</p>
      </footer>
    </div>
  );
}
