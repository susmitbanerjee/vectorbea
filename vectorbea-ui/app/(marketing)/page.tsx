import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Container,
  GitBranch,
  Globe2,
  KeyRound,
  Layers3,
  Lock,
  Quote,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { MarketingHero } from "@/components/marketing/hero-scene";
import { Logo } from "@/components/ui/Logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAuthenticatedUserFromCookies, getPostLoginRedirectForUser } from "@/lib/auth/server";

const pillars = [
  {
    eyebrow: "Control plane",
    title: "Govern prompts like infrastructure",
    body: "Version, review, and release prompts with the same discipline you apply to application code. Policy, RBAC, and environment separation come standard.",
    bullets: [
      "Versioned prompts with review and rollback",
      "Canary, ramp, and full rollouts",
      "Workspace isolation per product or tenant",
    ],
    icon: GitBranch,
  },
  {
    eyebrow: "Sidecar runtime",
    title: "Execute at the edge, not in someone else's cloud",
    body: "A lightweight proxy runs next to your services. Prompts are cached locally, model calls stay on your network, and only outbound HTTPS is required.",
    bullets: [
      "8 ms P99 prompt fetch from the sidecar hot path",
      "Semantic cache reduces spend and latency",
      "No inbound ports, no customer data egress",
    ],
    icon: Zap,
  },
  {
    eyebrow: "Observability & audit",
    title: "Treat model behavior as a production signal",
    body: "Every inference is attributed, timestamped, and scored. Operators, AI teams, and compliance reviewers see the same system of record.",
    bullets: [
      "Execution traces tied to prompt versions",
      "Evaluation scores and drift alerts",
      "Immutable audit log for every operator action",
    ],
    icon: Activity,
  },
] as const;

const stats = [
  { value: "8 ms", label: "P99 prompt fetch latency", caption: "Served from the in-VPC sidecar cache" },
  { value: "0", label: "Inbound ports required", caption: "Control plane talks outbound only" },
  { value: "100%", label: "Inference data residency", caption: "Model calls never leave your network" },
  { value: "< 1 min", label: "Rollback time", caption: "Revert a prompt version in one click" },
] as const;

const features = [
  {
    icon: GitBranch,
    title: "Versioned prompts",
    description:
      "Draft, review, and publish prompt versions with source-control discipline — then roll back releases in one click.",
  },
  {
    icon: Zap,
    title: "Semantic caching",
    description:
      "The sidecar deduplicates similar requests before they reach the model, cutting cost and latency without changing your code.",
  },
  {
    icon: ScrollText,
    title: "Audit trails",
    description:
      "Every inference is attributed, timestamped, and scored so teams can inspect what ran, when, and with which prompt version.",
  },
  {
    icon: KeyRound,
    title: "Role-based access",
    description:
      "Issue API keys and assign roles per workspace so teams can ship independently without stepping on each other's prompts.",
  },
  {
    icon: Layers3,
    title: "Workspace isolation",
    description:
      "Separate prompts and telemetry by product, environment, or customer without duplicating infrastructure.",
  },
  {
    icon: BarChart3,
    title: "Live observability",
    description:
      "Monitor sidecar health, latency distribution, and prompt usage from one dashboard without bolting on extra tooling.",
  },
];

const complianceBadges = [
  { icon: ShieldCheck, label: "SOC 2 Type II", status: "Available" },
  { icon: KeyRound, label: "SSO / SAML", status: "Active" },
  { icon: ScrollText, label: "Audit logs", status: "Active" },
  { icon: Lock, label: "Encryption at rest", status: "Active" },
  { icon: Globe2, label: "Data residency", status: "In progress" },
];

const installOptions = [
  {
    label: "Docker",
    icon: Container,
    code: "docker pull vectorbea/vectorbea-proxy:latest",
  },
  {
    label: "Python SDK",
    icon: Sparkles,
    code: "pip install vectorbea",
  },
  {
    label: "Node.js SDK",
    icon: Sparkles,
    code: "npm install vectorbea",
  },
];

// Lightweight wordmark-style logos rendered as text in a consistent typeface.
// Placeholders representative of the target buyer profile — platform teams
// and AI infra adopters. Replace with real logos when available.
const customerLogos = [
  "NORTHWIND",
  "ACME / AI",
  "LUMEN",
  "QUANTA",
  "FABRIC",
  "HELIX",
];

export default async function LandingPage() {
  const cookieStore = await cookies();

  // If the visitor already has a valid session redirect them straight to their
  // workspace — they should never see the marketing page when logged in.
  const user = await getAuthenticatedUserFromCookies(cookieStore);
  if (user) {
    try {
      const { redirectTo } = await getPostLoginRedirectForUser(user.id);
      redirect(redirectTo as Route);
    } catch {
      redirect("/dashboard");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top navigation ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-4 py-4 md:px-6 xl:px-8">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
              <Logo className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">VectorBea</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                AI Risk Control for Production LLMs
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">
            <Link href="#platform" className="hover:text-foreground">
              Platform
            </Link>
            <Link href="#architecture" className="hover:text-foreground">
              Architecture
            </Link>
            <Link href="#security" className="hover:text-foreground">
              Security
            </Link>
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              Docs
            </Link>
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <Link
              href="/signin?next=/dashboard"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Sign in
            </Link>
            <Link href="/login" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
              Get started
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <MarketingHero />

      <main>
        {/* ── Customer / trust logo strip ───────────────────────────── */}
        <section className="border-b border-border/60 bg-muted/30">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 md:px-6 xl:px-8">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Built for teams shipping AI behind the firewall
            </p>
            <div className="grid grid-cols-3 items-center gap-x-6 gap-y-4 md:grid-cols-6">
              {customerLogos.map((name) => (
                <span
                  key={name}
                  className="text-center text-sm font-semibold tracking-[0.18em] text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Platform pillars ──────────────────────────────────────── */}
        <section
          id="platform"
          className="mx-auto w-full max-w-[1280px] px-4 py-24 md:px-6 xl:px-8"
        >
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              The platform
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl xl:text-5xl">
              One control plane. Three surfaces your platform team already understands.
            </h2>
            <p className="mt-5 text-balance text-base leading-7 text-muted-foreground md:text-lg">
              VectorBea isn&apos;t a prompt editor with a dashboard bolted on. It&apos;s
              a control plane, a runtime, and an audit trail — built so AI
              behavior moves independently of your application deploys.
            </p>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {pillars.map(({ eyebrow, title, body, bullets, icon: Icon }) => (
              <article
                key={eyebrow}
                className="group relative flex flex-col gap-5 rounded-2xl border border-border bg-card p-7 shadow-sm transition-colors hover:border-primary/30"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    {eyebrow}
                  </p>
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">{body}</p>
                <ul className="mt-2 space-y-2.5 border-t border-border/60 pt-5 text-sm text-foreground">
                  {bullets.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="leading-6">{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* ── Architecture diagram (static SVG, not a product screen) ─ */}
        <section
          id="architecture"
          className="border-y border-border bg-muted/30"
        >
          <div className="mx-auto grid w-full max-w-[1280px] gap-12 px-4 py-24 md:px-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:items-center xl:px-8">
            <div className="space-y-6">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                Architecture
              </p>
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                A sidecar in your VPC. A control plane in ours. Nothing sensitive crosses the line.
              </h2>
              <p className="text-base leading-7 text-muted-foreground">
                The VectorBea sidecar runs alongside your application. It holds
                the prompt cache, resolves every model call, and serves
                telemetry locally. The control plane manages versions, policy,
                and rollouts — and never sees inference payloads or customer
                data.
              </p>
              <ul className="space-y-3 text-sm text-foreground">
                {[
                  "Outbound HTTPS to the control plane. No inbound exposure.",
                  "Model calls stay inside your network — OpenAI, Bedrock, or self-hosted.",
                  "Prompt and policy changes reach the fleet within seconds.",
                  "Audit events stream back to the control plane with full attribution.",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="leading-6">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Static architecture diagram — pure SVG/HTML, no animation */}
            <div className="relative">
              <div className="relative rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
                {/* Control plane row */}
                <div className="relative rounded-xl border border-primary/30 bg-primary/5 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          VectorBea control plane
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Versions &middot; policy &middot; rollouts &middot; audit
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-primary/30 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                      SaaS
                    </span>
                  </div>
                </div>

                {/* Connector — labeled */}
                <div className="relative my-3 flex items-center justify-center">
                  <div className="flex flex-col items-center">
                    <span className="h-3 w-px bg-border" />
                    <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Outbound HTTPS only
                    </span>
                    <span className="h-3 w-px bg-border" />
                  </div>
                </div>

                {/* VPC box */}
                <div className="relative rounded-xl border-2 border-dashed border-border bg-background p-5">
                  <p className="absolute -top-2.5 left-4 bg-card px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Your VPC
                  </p>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                    {/* Application */}
                    <div className="rounded-lg border border-border bg-card p-4">
                      <div className="flex items-center gap-2 text-foreground">
                        <Layers3 className="h-4 w-4 text-primary" />
                        <p className="text-sm font-semibold">Your application</p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        Calls <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-medium text-foreground">localhost:8080</code>
                      </p>
                    </div>

                    {/* Arrow */}
                    <div className="flex justify-center">
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    </div>

                    {/* Sidecar */}
                    <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
                      <div className="flex items-center gap-2 text-foreground">
                        <Zap className="h-4 w-4 text-primary" />
                        <p className="text-sm font-semibold">VectorBea sidecar</p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        Prompt cache + proxy + audit buffer
                      </p>
                    </div>
                  </div>

                  {/* Downstream model providers */}
                  <div className="mt-5 flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <span className="h-3 w-px bg-border" />
                      <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Model traffic stays in your network
                      </span>
                      <span className="h-3 w-px bg-border" />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] font-medium text-muted-foreground">
                    <div className="rounded-md border border-border bg-card px-2 py-2">OpenAI</div>
                    <div className="rounded-md border border-border bg-card px-2 py-2">Bedrock</div>
                    <div className="rounded-md border border-border bg-card px-2 py-2">Self-hosted</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── By-the-numbers stats ──────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1280px] px-4 py-24 md:px-6 xl:px-8">
          <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-card p-7">
                <p className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                  {stat.value}
                </p>
                <p className="mt-3 text-sm font-semibold text-foreground">
                  {stat.label}
                </p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {stat.caption}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features grid ────────────────────────────────────────── */}
        <section className="border-y border-border bg-muted/30">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-24 md:px-6 xl:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                Capabilities
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Everything your team needs to ship AI safely
              </h2>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={feature.title}
                    className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/30"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-foreground">
                      {feature.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Testimonial / pull-quote ─────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1280px] px-4 py-24 md:px-6 xl:px-8">
          <figure className="mx-auto max-w-4xl rounded-2xl border border-border bg-card p-8 shadow-sm md:p-12">
            <Quote className="h-8 w-8 text-primary/60" />
            <blockquote className="mt-6 text-balance text-2xl font-medium leading-[1.35] tracking-tight text-foreground md:text-3xl">
              &ldquo;We stopped treating prompts like strings in config files. With
              VectorBea, prompt changes go through the same review and rollout
              discipline as the rest of our platform — and our data never
              leaves our VPC.&rdquo;
            </blockquote>
            <figcaption className="mt-8 flex flex-wrap items-center gap-4 text-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                PL
              </div>
              <div>
                <p className="font-semibold text-foreground">Platform Lead</p>
                <p className="text-muted-foreground">
                  Regulated-industry SaaS &middot; 200+ engineers
                </p>
              </div>
            </figcaption>
          </figure>
        </section>

        {/* ── Security & compliance row ────────────────────────────── */}
        <section id="security" className="border-y border-border bg-background">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-6 xl:px-8">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
              <div className="space-y-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                  Security &amp; compliance
                </p>
                <h2 className="text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  Posture that holds up in procurement review.
                </h2>
                <p className="text-base leading-7 text-muted-foreground">
                  VectorBea is built around the same controls your security team
                  is already asking about: identity, encryption, audit, and
                  residency. No side agreements. No custom proofs.
                </p>
                <Link
                  href="/docs/security"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "gap-2",
                  )}
                >
                  Read the security overview
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2">
                {complianceBadges.map((badge) => {
                  const Icon = badge.icon;
                  return (
                    <li
                      key={badge.label}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {badge.label}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {badge.status}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Install ─────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1280px] px-4 py-24 md:px-6 xl:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              Install
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Three ways to connect
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Pull the container, or drop the SDK into an existing service.
              Either path takes under five minutes from signup to first
              inference.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {installOptions.map(({ label, code, icon: Icon }) => (
              <div
                key={label}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  <p className="text-xs font-semibold tracking-tight text-foreground">
                    {label}
                  </p>
                </div>
                <div className="bg-[#0b1020] px-4 py-3.5">
                  <pre className="overflow-x-auto text-[13px] leading-relaxed text-slate-300">
                    <code>{code}</code>
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1280px] px-4 pb-28 md:px-6 xl:px-8">
          <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background p-10 text-center md:p-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 surface-grid opacity-30"
            />
            <div className="relative mx-auto max-w-2xl space-y-6">
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl xl:text-5xl">
                Ready to run enterprise AI infrastructure at the edge?
              </h2>
              <p className="text-base leading-7 text-muted-foreground">
                Start on the free plan, pull the sidecar in minutes, and keep
                runtime behavior inside your own infrastructure.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <Link
                  href="/login"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "gap-2 rounded-md px-7",
                  )}
                >
                  Get started free
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/docs/quickstart"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "rounded-md px-7",
                  )}
                >
                  Read the quickstart
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-muted/30">
        <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-12 md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] md:px-6 xl:px-8">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
                <Logo className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold tracking-tight">VectorBea</p>
            </div>
            <p className="max-w-xs text-xs leading-5 text-muted-foreground">
              Enterprise AI infrastructure for private deployments. Your data
              never leaves your infra.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
              Product
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="#platform" className="hover:text-foreground">Platform</Link></li>
              <li><Link href="#architecture" className="hover:text-foreground">Architecture</Link></li>
              <li><Link href="/pricing" className="hover:text-foreground">Pricing</Link></li>
              <li><Link href="/docs" className="hover:text-foreground">Docs</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
              Company
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="#security" className="hover:text-foreground">Security</Link></li>
              <li><Link href="/docs/security" className="hover:text-foreground">Trust center</Link></li>
              <li><Link href="mailto:hello@vectorbea.com" className="hover:text-foreground">Contact</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
              Get started
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="/login" className="hover:text-foreground">Create account</Link></li>
              <li><Link href="/signin" className="hover:text-foreground">Sign in</Link></li>
              <li><Link href="/docs/quickstart" className="hover:text-foreground">Quickstart</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border/60">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground md:px-6 xl:px-8">
            <p>&copy; {new Date().getFullYear()} VectorBea. All rights reserved.</p>
            <p>Enterprise AI infrastructure &middot; Your data never leaves your infra.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
