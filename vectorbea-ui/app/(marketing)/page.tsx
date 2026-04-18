import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Container,
  GitBranch,
  KeyRound,
  Layers3,
  Lock,
  ScrollText,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: GitBranch,
    title: "Versioned prompts",
    description:
      "Draft, review, and publish prompt versions with the same rigour as source control. Roll back any version with one click.",
  },
  {
    icon: Zap,
    title: "Semantic caching",
    description:
      "The sidecar deduplicates similar requests before they reach the model — cutting cost and latency without changing your code.",
  },
  {
    icon: ScrollText,
    title: "Audit trails",
    description:
      "Every inference is attributed, timestamped, and scored. Inspect what ran, when, and with which prompt version.",
  },
  {
    icon: KeyRound,
    title: "Role-based access",
    description:
      "Issue API keys and assign roles per workspace. Teams ship independently without stepping on each other's prompts.",
  },
  {
    icon: Layers3,
    title: "Workspace isolation",
    description:
      "Separate prompts and telemetry by product, environment, or customer — no duplicated infrastructure needed.",
  },
  {
    icon: BarChart3,
    title: "Live observability",
    description:
      "Monitor sidecar health, latency distribution, and prompt usage from one dashboard. No extra tooling required.",
  },
];

const steps = [
  {
    label: "01",
    title: "Create an account",
    body: "Sign in with GitHub, Google, or Microsoft. No forms, no setup — your workspace is one step away.",
  },
  {
    label: "02",
    title: "Name your workspace",
    body: "Every account starts on the free plan. Name a workspace and you're in the dashboard within seconds.",
  },
  {
    label: "03",
    title: "Run the sidecar",
    body: "Pull the docker image and start the sidecar next to your services. Prompts and settings sync from the control plane — your data never leaves your infra.",
    code: `docker pull vectorbea/vectorbea-proxy:latest
docker run -p 8080:8080 \\
  -e VECTORBEA_KEY="vbagent_..." \\
  vectorbea/vectorbea-proxy:latest`,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <header className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-4 py-5 md:px-6 xl:px-8">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
            <Logo className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">VectorBea</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Prompt &amp; AI settings registry</p>
          </div>
        </Link>

        <div className="flex items-center gap-2 md:gap-3">
          <ThemeToggle />
          <Link href="/docs" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Docs
          </Link>
          <Link href="/pricing" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Pricing
          </Link>
          <Link
            href="/signin?next=/dashboard"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Sign in
          </Link>
          <Link href="/login" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
            Get started free
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-28 px-4 pb-28 pt-12 md:px-6 xl:px-8">

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl space-y-8 text-center">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Privacy-first &middot; Docker-native &middot; Zero data residency
          </div>

          {/* Heading */}
          <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
            Version and govern prompts centrally.{" "}
            <span className="text-zinc-500 dark:text-zinc-400">
              Your data never leaves your infra.
            </span>
          </h1>

          {/* Sub-paragraph */}
          <p className="mx-auto max-w-xl text-base leading-7 text-zinc-500 dark:text-zinc-400">
            VectorBea is a prompt and AI settings repository your team manages
            from the cloud — but every inference, secret, and audit event stays
            inside your own containers. Pull the docker image, run the sidecar,
            and connect in minutes.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "gap-2 rounded-lg px-7")}>
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-lg px-7")}
            >
              Read the docs
            </Link>
          </div>

          {/* Trust cards */}
          <div className="grid gap-3 text-left sm:grid-cols-3">
            {[
              [
                "1 control plane",
                "Manage prompts, access, and billing — all from the cloud UI.",
              ],
              [
                "Outbound only",
                "Your sidecar connects over HTTPS. No inbound ports, no open firewall rules.",
              ],
              [
                "Data stays yours",
                "VectorBea Cloud stores no inference data, no prompt content, no secrets.",
              ],
            ].map(([title, body]) => (
              <div
                key={title}
                className="rounded-lg border border-border bg-card p-4"
              >
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section className="space-y-10">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              How it works
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              From signup to running sidecar in three steps
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.label}
                className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6"
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                    {step.label}
                  </p>
                  <h3 className="mt-3 text-base font-semibold text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    {step.body}
                  </p>
                </div>
                {step.code && (
                  <div className="overflow-hidden rounded-lg border border-border/40 bg-[#0d1117]">
                    <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed text-slate-300">
                      <code>{step.code}</code>
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Privacy callout ──────────────────────────────────────────── */}
        <section className="rounded-2xl border border-primary/20 bg-primary/5 px-8 py-10 md:px-12">
          <div className="mx-auto flex max-w-4xl flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Lock className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1.5">
                <p className="text-base font-semibold text-foreground">
                  Built for teams with data residency requirements
                </p>
                <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                  The VectorBea control plane manages governance. Your sidecar
                  handles execution. Model calls, secrets, and customer data
                  never leave your network — by design, not by configuration.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 text-sm text-muted-foreground">
              {[
                "No inference data stored",
                "No secrets transmitted",
                "Outbound HTTPS only",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Capabilities ─────────────────────────────────────────────── */}
        <section className="space-y-10">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              Capabilities
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Everything your team needs to ship AI safely
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-lg border border-border bg-card p-6 transition-colors hover:bg-accent/40"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Install strip ────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              Install
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Three ways to connect
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                label: "Docker",
                icon: Container,
                code: "docker pull vectorbea/vectorbea-proxy:latest",
              },
              {
                label: "Python SDK",
                icon: null,
                code: "pip install vectorbea",
              },
              {
                label: "Node.js SDK",
                icon: null,
                code: "npm install vectorbea",
              },
            ].map(({ label, icon: Icon, code }) => (
              <div
                key={label}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
                  <p className="text-xs font-semibold text-foreground">{label}</p>
                </div>
                <div className="bg-[#0d1117] px-4 py-3">
                  <pre className="overflow-x-auto text-xs leading-relaxed text-slate-300">
                    <code>{code}</code>
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA banner ───────────────────────────────────────────────── */}
        <section className="mx-auto max-w-2xl space-y-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Ready to govern your prompts?
          </h2>
          <p className="text-base leading-7 text-zinc-500 dark:text-zinc-400">
            Free plan, no credit card required. Pull the sidecar in minutes and
            your data stays exactly where it belongs — in your infra.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "gap-2 rounded-lg px-7")}>
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/quickstart"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-lg px-7")}
            >
              Read the quickstart
            </Link>
          </div>
        </section>

      </main>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
        <p>© {new Date().getFullYear()} VectorBea &middot; Prompt &amp; AI settings registry &middot; Your data never leaves your infra</p>
      </footer>
    </div>
  );
}
