import Link from "next/link";
import { ArrowRight, Building2, Check, Code2, Sparkles } from "lucide-react";

import { RolloutStatus } from "@/components/ui/rollout-status";
import { TrustBar, coreTrustSignals } from "@/components/ui/trust-bar";
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
  cta: { label: string; href: string };
  highlight?: boolean;
  icon: typeof Sparkles;
  features: string[];
}

const tiers: Tier[] = [
  {
    id: "developer",
    name: "Developer",
    tagline: "For solo builders validating the sidecar path",
    priceLabel: "$0",
    priceSuffix: "/ month",
    billingNote: "Free forever, no card required",
    cta: { label: "Start free", href: "/login" },
    icon: Code2,
    features: [
      "1 workspace, 1 seat",
      "10,000 proxied calls / month",
      "30-day audit retention",
      "Self-hosted sidecar runtime",
      "Community support",
    ],
  },
  {
    id: "team",
    name: "Team",
    tagline: "For platform teams rolling out governed prompt delivery",
    priceLabel: "$19.99",
    originalPriceLabel: "$29",
    priceSuffix: "/ seat / month",
    billingNote: "Early adopter pricing, then standardizes at $29 / seat",
    cta: { label: "Get started", href: "/login" },
    highlight: true,
    icon: Sparkles,
    features: [
      "Unlimited workspaces",
      "1,000,000 proxied calls / month included",
      "Prompt versioning and rollout control",
      "RBAC and SSO",
      "1-year audit retention",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For security, procurement, and dedicated rollout controls",
    priceLabel: "Custom",
    priceSuffix: "",
    billingNote: "Quarterly or annual contracts with private deployment support",
    cta: { label: "Talk to sales", href: "mailto:sales@vectorbea.com" },
    icon: Building2,
    features: [
      "VPC and air-gapped deployment options",
      "Security review and procurement workflows",
      "Custom retention and regional posture",
      "SAML / SCIM roadmap alignment",
      "Dedicated solutions partner",
      "Commercial SLA and onboarding support",
    ],
  },
];

const faq = [
  {
    question: "What counts as a proxied call?",
    answer:
      "Any request served through the VectorBea Sidecar to an LLM provider counts as a proxied call. Prompt edits, dashboard reads, and admin actions do not.",
  },
  {
    question: "How does seat billing work?",
    answer:
      "Every active user in a workspace counts as a seat. Teams can scale seats up as they expand the people touching rollout, governance, and auditing.",
  },
  {
    question: "Can we run VectorBea inside our own network?",
    answer:
      "Yes. The core product posture is sidecar-first deployment, with the runtime running in your environment and the control plane handling policy, versions, and visibility.",
  },
  {
    question: "Do you support enterprise identity?",
    answer:
      "Team already supports Google and Microsoft sign-in. Enterprise plans are where SAML, procurement review, and deeper identity workflows are handled.",
  },
  {
    question: "How are upgrades managed?",
    answer:
      "Developer can upgrade into Team at any time. Enterprise is handled through a sales conversation so legal, security, and billing expectations are aligned before rollout.",
  },
  {
    question: "What happens when usage grows?",
    answer:
      "Team includes a large monthly call allowance and scales with overage pricing. Enterprise plans are designed around higher-volume production traffic and tailored commercial terms.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/88 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <Logo />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-white">VectorBea</p>
              <p className="text-xs text-zinc-400">Enterprise AI Infrastructure Platform</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-zinc-300 hover:text-white")}>
              Home
            </Link>
            <Link
              href="/login"
              className={cn(buttonVariants({ size: "sm" }), "gap-1.5 rounded-lg")}
            >
              Get started
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-24 pt-16">
        <section className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-end">
          <div className="space-y-6">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
              Pricing built for teams shipping AI into production
            </div>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Choose the control plane that matches your rollout surface
              </h1>
              <p className="max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
                VectorBea starts free for builders, scales into governed sidecar delivery for teams,
                and expands into enterprise infrastructure for organizations that need trust, rollout
                control, and procurement-ready posture.
              </p>
            </div>
          </div>

          <RolloutStatus
            version="v12"
            label="checkout-assistant"
            stage="ramp"
            progress={60}
            target={100}
            policy="Auto 10% / hr"
            startedAt={new Date(Date.now() - 90 * 60 * 1000)}
            variant="hero"
            className="border-white/10 bg-white/[0.04]"
          />
        </section>

        <section className="mt-14 grid gap-5 lg:grid-cols-3">
          {tiers.map((tier) => {
            const Icon = tier.icon;
            return (
              <div
                key={tier.id}
                className={cn(
                  "relative flex flex-col rounded-[1.5rem] border bg-white/[0.03] p-7 shadow-[0_20px_70px_-45px_rgba(0,0,0,0.85)]",
                  tier.highlight
                    ? "border-primary/50 ring-1 ring-primary/25"
                    : "border-white/10",
                )}
              >
                {tier.highlight ? (
                  <div className="absolute -top-3 left-6 rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                    Most popular
                  </div>
                ) : null}

                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>

                <div className="mt-6 space-y-2">
                  <h2 className="text-xl font-semibold text-white">{tier.name}</h2>
                  <p className="text-sm leading-6 text-zinc-400">{tier.tagline}</p>
                </div>

                <div className="mt-8 flex items-end gap-2">
                  {tier.originalPriceLabel ? (
                    <span className="pb-1 text-xl font-medium text-zinc-500 line-through">
                      {tier.originalPriceLabel}
                    </span>
                  ) : null}
                  <span className="text-4xl font-semibold tracking-tight text-white">
                    {tier.priceLabel}
                  </span>
                  {tier.priceSuffix ? (
                    <span className="pb-1 text-sm text-zinc-400">{tier.priceSuffix}</span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-zinc-400">{tier.billingNote}</p>

                <a
                  href={tier.cta.href}
                  className={cn(
                    buttonVariants({
                      size: "lg",
                      variant: tier.highlight ? "default" : "outline",
                    }),
                    "mt-8 w-full justify-center rounded-lg",
                  )}
                >
                  {tier.cta.label}
                  <ArrowRight className="h-4 w-4" />
                </a>

                <ul className="mt-8 space-y-3 border-t border-white/10 pt-6">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        <section className="mt-8">
          <TrustBar
            signals={coreTrustSignals}
            variant="compact"
            className="border-white/10 bg-white/[0.04]"
          />
        </section>

        <section className="mt-16 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold text-white">Frequently asked</h2>
            <p className="mt-3 text-sm leading-7 text-zinc-400">
              The questions enterprise buyers, platform teams, and security reviewers ask before
              rollout starts
            </p>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {faq.map((item) => (
              <div key={item.question} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <p className="text-sm font-semibold text-white">{item.question}</p>
                <p className="mt-2 text-sm leading-7 text-zinc-400">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
