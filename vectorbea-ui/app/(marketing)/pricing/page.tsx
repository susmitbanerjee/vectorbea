import Link from "next/link";
import { ArrowRight, Check, Sparkles, Building2, Code2 } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Tier {
  id: string;
  name: string;
  tagline: string;
  priceLabel: string;
  originalPriceLabel?: string;
  priceSuffix: string;
  billingNote: string;
  promoNote?: string;
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
    iconColor: "text-cyan-600 dark:text-cyan-400",
    iconBg: "bg-cyan-500/10 ring-1 ring-cyan-500/20",
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
    priceLabel: "$19.99",
    originalPriceLabel: "$29",
    priceSuffix: "/ seat / month",
    billingNote: "Early adopter pricing for the first teams onboarded to VectorBea.",
    promoNote: "List price is $29 / seat / month. Lock in $19.99 while the early adopter program is open.",
    cta: { label: "Start 14-day trial", href: "/checkout?plan=team" },
    highlight: true,
    icon: Sparkles,
    iconColor: "text-primary",
    iconBg: "bg-primary/10 ring-1 ring-primary/30",
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
    cta: { label: "Talk to sales", href: "mailto:sales@vectorbea.dev" },
    icon: Building2,
    iconColor: "text-violet-600 dark:text-violet-400",
    iconBg: "bg-violet-500/10 ring-1 ring-violet-500/20",
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
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800 md:px-10">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <Logo />
          </div>
          <span className="text-sm font-semibold tracking-tight">VectorBea</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Home
          </Link>
          <Link
            href="/onboarding"
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5 rounded-md")}
          >
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pt-16 text-center md:pt-24">
        <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3.5 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Simple, predictable pricing
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-5xl">
          Pay for what you ship,{" "}
          <span className="text-zinc-500 dark:text-zinc-400">
            not what you experiment with.
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-zinc-500 dark:text-zinc-400">
          Free for individual developers. Per-seat billing for teams. Custom contracts for
          enterprises with bespoke billing cycles.
        </p>
      </section>

      {/* ── Pricing cards ─────────────────────────────────────────────────── */}
      <section className="mx-auto mt-16 grid max-w-6xl gap-5 px-6 pb-24 md:grid-cols-3">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          return (
            <div
              key={tier.id}
              className={cn(
                "relative flex flex-col rounded-lg border bg-white p-7 dark:bg-zinc-900",
                tier.highlight
                  ? "border-primary shadow-[0_0_0_1px] shadow-primary/20"
                  : "border-zinc-200 dark:border-zinc-800",
              )}
            >
              {tier.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-md border border-primary/30 bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground">
                  Most popular
                </div>
              )}

              <div className={cn("mb-5 flex h-10 w-10 items-center justify-center rounded-md", tier.iconBg)}>
                <Icon className={cn("h-5 w-5", tier.iconColor)} />
              </div>

              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {tier.name}
              </h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{tier.tagline}</p>

              <div className="mt-6 flex items-baseline gap-1.5">
                {tier.originalPriceLabel && (
                  <span className="text-lg font-medium text-zinc-400 line-through dark:text-zinc-500">
                    {tier.originalPriceLabel}
                  </span>
                )}
                <span className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {tier.priceLabel}
                </span>
                {tier.priceSuffix && (
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {tier.priceSuffix}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">{tier.billingNote}</p>
              {tier.promoNote && (
                <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary">
                  {tier.promoNote}
                </div>
              )}

              <a
                href={tier.cta.href}
                className={cn(
                  buttonVariants({ size: "sm", variant: tier.highlight ? "default" : "outline" }),
                  "mt-6 w-full gap-1.5 rounded-md text-center",
                )}
              >
                {tier.cta.label} <ArrowRight className="h-3.5 w-3.5" />
              </a>

              <ul className="mt-7 space-y-3 border-t border-zinc-100 pt-6 dark:border-zinc-800">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                    <Check className={cn("mt-0.5 h-4 w-4 shrink-0", tier.iconColor)} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Frequently asked
          </h2>
          <div className="mt-6 grid gap-6 text-sm md:grid-cols-2">
            {[
              {
                q: "How does per-seat billing work?",
                a: "Each user that logs into your workspace counts as one seat. We pro-rate additions and removals daily, so adding a teammate mid-cycle only charges for the days they were active.",
              },
              {
                q: 'What counts as a "proxied call"?',
                a: "Any inference request that flows through the VectorBea sidecar to an LLM provider. Prompt edits, audit views, and dashboard activity are never billed as calls.",
              },
              {
                q: "Can enterprises invoice quarterly?",
                a: "Yes — enterprise contracts support monthly, quarterly, or annual billing cycles with NET-30 or NET-60 terms. We'll match your AP process.",
              },
              {
                q: "Is there a free trial for Team?",
                a: "Every Team workspace gets a 14-day trial of all paid features. No credit card required to start, and you can downgrade to Developer at any time.",
              },
            ].map(({ q, a }) => (
              <div key={q}>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">{q}</p>
                <p className="mt-1.5 text-zinc-500 dark:text-zinc-400">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-200 px-6 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
        <p>© {new Date().getFullYear()} VectorBea · Prompt infrastructure for production AI</p>
      </footer>
    </div>
  );
}
