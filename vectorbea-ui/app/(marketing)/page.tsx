import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  GitBranch,
  KeyRound,
  Layers,
  ScrollText,
  Shield,
  Zap,
} from "lucide-react";

import { BeeLogo } from "@/components/brand/bee-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: GitBranch,
    title: "Prompt version control",
    description:
      "Draft, review, and publish prompt versions just like code. Never ship an untested prompt to production again.",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
  },
  {
    icon: Zap,
    title: "Semantic caching",
    description:
      "The sidecar proxy deduplicates semantically-identical requests before they hit the LLM, cutting cost by up to 70%.",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
  {
    icon: ScrollText,
    title: "Full audit trail",
    description:
      "Every inference request is logged with split latency so teams can observe platform overhead separately from model latency.",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  {
    icon: KeyRound,
    title: "API key management",
    description:
      "Issue scoped keys per workspace and rotate them centrally with clear auditability.",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  {
    icon: Layers,
    title: "Project isolation",
    description:
      "Separate prompts and telemetry by product, environment, or customer without separate infrastructure.",
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
  },
  {
    icon: BarChart3,
    title: "Live analytics",
    description:
      "Track latency, agent activity, and prompt usage from a clean control-plane dashboard.",
    color: "text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
  },
];

const steps = [
  { n: "01", title: "Create an account", body: "Start with GitHub or Google so VectorBea can route you into the correct onboarding flow." },
  { n: "02", title: "Create a workspace", body: "Name your environment and generate the control-plane state your sidecar will consume." },
  { n: "03", title: "Run the sidecar", body: "Launch the proxy locally and point your agents at it without rewriting your stack." },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        className="pointer-events-none fixed inset-0 bg-grid-fade"
        style={{ backgroundSize: "100% 100%, 24px 24px, 24px 24px" }}
      />
      <div className="pointer-events-none fixed left-1/2 top-0 -translate-x-1/2">
        <div className="h-[600px] w-[800px] rounded-full bg-primary/8 blur-[140px]" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/80 bg-card shadow-sm">
            <BeeLogo className="h-5 w-5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">VectorBea</span>
        </div>
        <div className="flex items-center gap-3">
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
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-24 pt-20 text-center md:pt-32">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-xs font-medium text-primary">
          <Shield className="h-3 w-3" />
          Open-source prompt infrastructure
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          The missing layer
          <br />
          <span className="bg-gradient-to-r from-primary via-sky-400 to-cyan-400 bg-clip-text text-transparent">
            between your code and the LLM
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
          VectorBea is a self-hosted sidecar proxy that intercepts every OpenAI
          call, injects versioned prompts, caches semantically-similar requests,
          and streams telemetry to a live dashboard with sub-millisecond overhead.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: "lg" }), "gap-2 px-8 shadow-glow")}
          >
            Start for free <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pricing"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-8")}
          >
            See pricing
          </Link>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">
            How it works
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Live in three steps
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.n}
              className="rounded-2xl border border-white/8 bg-card/40 p-6 backdrop-blur-sm"
            >
              <p className="mb-3 font-mono text-xs font-bold text-primary/60">{step.n}</p>
              <h3 className="mb-2 font-semibold text-white">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Features
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Everything your prompts need in production
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className={cn(
                  "rounded-2xl border bg-card/40 p-6 backdrop-blur-sm transition-all duration-200 hover:bg-card/60",
                  feat.border,
                )}
              >
                <div className={cn("mb-4 inline-flex h-9 w-9 items-center justify-center rounded-xl", feat.bg)}>
                  <Icon className={cn("h-4.5 w-4.5", feat.color)} />
                </div>
                <h3 className="mb-1.5 font-semibold text-white">{feat.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{feat.description}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
