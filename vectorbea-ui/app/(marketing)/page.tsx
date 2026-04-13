import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  GitBranch,
  KeyRound,
  Layers3,
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
      "Prompts move through draft, review, and publish states with the same rigor teams expect from source control.",
  },
  {
    icon: Zap,
    title: "Semantic caching",
    description:
      "The sidecar deduplicates repeated intent before requests hit the model, reducing both cost and latency.",
  },
  {
    icon: ScrollText,
    title: "Structured audit trails",
    description:
      "Every inference is attributed, timestamped, and measured so platform teams can inspect behavior confidently.",
  },
  {
    icon: KeyRound,
    title: "Scoped access",
    description:
      "Issue keys and roles per workspace so the right teams can ship while the wrong teams cannot drift into shared state.",
  },
  {
    icon: Layers3,
    title: "Project isolation",
    description:
      "Separate prompts, telemetry, and operations by product, environment, or customer without duplicating infrastructure.",
  },
  {
    icon: BarChart3,
    title: "Operational clarity",
    description:
      "Live metrics expose agent health, latency distribution, and prompt usage from a single control-plane surface.",
  },
];

const steps = [
  {
    label: "01",
    title: "Create an account",
    body: "Start with GitHub or Google so VectorBea can identify the user, capture profile data, and route them correctly.",
  },
  {
    label: "02",
    title: "Create your workspace",
    body: "Every new account starts on Free. Name one workspace and begin governing prompts immediately.",
  },
  {
    label: "03",
    title: "Run the sidecar locally",
    body: "Deploy the proxy next to your workloads and keep execution close to customer data while the control plane stays centralized.",
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
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Prompt infrastructure</p>
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
          <a
            href="https://github.com/vectorbea/vectorbea"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            GitHub
          </a>
          <Link href="/signup" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
            Create account
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-24 px-4 pb-24 pt-12 md:px-6 xl:px-8">

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl space-y-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            Control plane for production AI
          </div>

          <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
            Govern prompts centrally.{" "}
            <span className="text-zinc-500 dark:text-zinc-400">Keep execution local.</span>
          </h1>

          <p className="mx-auto max-w-xl text-base leading-7 text-zinc-500 dark:text-zinc-400">
            VectorBea gives platform teams one rigorous control plane for prompts,
            routing, RBAC, and telemetry — while customer agents and microservices
            continue running inside their own environment.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "gap-2 rounded-lg px-7")}>
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-lg px-7")}
            >
              Explore docs
            </Link>
          </div>

          <div className="grid gap-3 text-left sm:grid-cols-3">
            {[
              ["1 control plane", "Supabase-backed prompts, billing, and RBAC."],
              ["Outbound only", "HTTPS heartbeats over standard port 443."],
              ["Project safe", "Workspace isolation enforced across UI and DB."],
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
        <section className="space-y-8">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              How it works
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              A clear path from identity to production traffic
            </h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.label}
                className="rounded-lg border border-border bg-card p-6"
              >
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
            ))}
          </div>
        </section>

        {/* ── Capabilities ─────────────────────────────────────────────── */}
        <section className="space-y-8">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              Capabilities
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Minimalist surface, serious operating model
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
      </main>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
        <p>© {new Date().getFullYear()} VectorBea · Prompt infrastructure for production AI</p>
      </footer>
    </div>
  );
}
