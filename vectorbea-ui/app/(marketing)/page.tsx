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

import { BeeLogo } from "@/components/brand/bee-logo";
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
      <div className="docs-shell-grid min-h-screen">
        <header className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-4 py-5 md:px-6 xl:px-8">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/80 bg-card shadow-sm">
              <BeeLogo className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">VectorBea</p>
              <p className="text-xs text-muted-foreground">Prompt infrastructure</p>
            </div>
          </Link>

          <div className="flex items-center gap-2 md:gap-3">
            <ThemeToggle />
            <Link
              href="/docs"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Docs
            </Link>
            <Link
              href="/pricing"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
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
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
            >
              Create account
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-20 px-4 pb-20 pt-10 md:px-6 xl:px-8">
          <section className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] lg:items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-brand">
                <ShieldCheck className="h-3.5 w-3.5" />
                Control plane for production AI
              </div>

              <div className="space-y-5">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                  Govern prompts centrally. Keep execution local.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
                  VectorBea gives platform teams one rigorous control plane for
                  prompts, routing, RBAC, and telemetry while customer agents and
                  microservices continue running inside their own environment.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/signup"
                  className={cn(buttonVariants({ size: "lg" }), "gap-2 px-8")}
                >
                  Start for free
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/docs"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "px-8",
                  )}
                >
                  Explore docs
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["1 control plane", "Supabase-backed prompts, billing, and RBAC."],
                  ["Outbound only", "HTTPS heartbeats over standard port 443."],
                  ["Project safe", "Workspace isolation enforced across UI and DB."],
                ].map(([title, body]) => (
                  <div
                    key={title}
                    className="rounded-2xl border border-border/70 bg-card/90 p-4"
                  >
                    <p className="text-sm font-semibold text-foreground">{title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-border/70 bg-card/95 p-6 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.32)]">
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                      System overview
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                      Enterprise clarity without UI noise
                    </h2>
                  </div>
                  <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs text-muted-foreground">
                    Light + Dark ready
                  </div>
                </div>

                <div className="space-y-3 rounded-3xl border border-border/70 bg-background p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Vercel control plane
                      </p>
                      <p className="text-sm text-muted-foreground">
                        UI, API routes, and Supabase-backed governance
                      </p>
                    </div>
                    <div className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
                      Active
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {["Organizations", "Billing", "Prompts", "Audit logs"].map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm font-medium text-foreground"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4 rounded-3xl border border-dashed border-brand/30 bg-brand/5 px-5 py-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background text-brand">
                    →
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      HTTPS outbound heartbeat
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Agents sync metrics and receive commands without inbound firewall rules.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 rounded-3xl border border-border/70 bg-background p-5">
                  <p className="text-sm font-medium text-foreground">
                    Customer environment
                  </p>
                  <div className="grid gap-3">
                    {["Firewall boundary", "VectorBea agent", "Local microservices"].map(
                      (item) => (
                        <div
                          key={item}
                          className="rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm font-medium text-foreground"
                        >
                          {item}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-8">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                How it works
              </p>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground">
                A clear path from identity to production traffic
              </h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {steps.map((step) => (
                <div
                  key={step.label}
                  className="rounded-[1.75rem] border border-border/70 bg-card/95 p-6"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
                    {step.label}
                  </p>
                  <h3 className="mt-3 text-lg font-semibold text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-8">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                Capabilities
              </p>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground">
                Minimalist surface, serious operating model
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={feature.title}
                    className="rounded-[1.75rem] border border-border/70 bg-card/95 p-6 transition-colors hover:bg-accent/30"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-foreground">
                      {feature.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
