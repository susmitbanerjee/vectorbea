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
      "Every inference request is logged with split latency — VectorBea fetch time vs. model generation time — for precise observability.",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  {
    icon: KeyRound,
    title: "API key management",
    description:
      "Issue scoped vb_ keys per workspace. One dashboard to rotate, revoke, and audit access across your whole team.",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  {
    icon: Layers,
    title: "Multi-tenant workspaces",
    description:
      "Isolate prompts and telemetry per product, environment, or customer — without running separate infrastructure.",
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
  },
  {
    icon: BarChart3,
    title: "Real-time analytics",
    description:
      "Track token spend, agent activity, and latency trends on a live dashboard. Exportable as JSON for any downstream pipeline.",
    color: "text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
  },
];

const steps = [
  { n: "01", title: "Create a workspace", body: "Name your team's environment and generate a scoped API key in under a minute." },
  { n: "02", title: "Start the proxy", body: "One docker run command launches the VectorBea sidecar on port 4040. Zero code changes required." },
  { n: "03", title: "Import prompts", body: "Replace your hard-coded strings with client.get_prompt(). The proxy handles caching, versioning, and telemetry automatically." },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Grid background */}
      <div
        className="pointer-events-none fixed inset-0 bg-grid-fade"
        style={{ backgroundSize: "100% 100%, 24px 24px, 24px 24px" }}
      />
      {/* Top glow */}
      <div className="pointer-events-none fixed left-1/2 top-0 -translate-x-1/2">
        <div className="h-[600px] w-[800px] rounded-full bg-primary/8 blur-[140px]" />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-400/15 to-amber-600/5 shadow-[0_0_18px_-6px_rgba(251,191,36,0.45)]">
            <BeeLogo className="h-5 w-5 text-amber-400" />
          </div>
          <span className="text-sm font-semibold tracking-tight">VectorBea</span>
        </div>
        <div className="flex items-center gap-3">
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
            href="/onboarding"
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
          >
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-24 pt-20 text-center md:pt-32">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-xs font-medium text-primary">
          <Shield className="h-3 w-3" />
          Open-source prompt infrastructure
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          The missing layer
          <br />
          <span className="bg-gradient-to-r from-primary via-violet-400 to-cyan-400 bg-clip-text text-transparent">
            between your code and the LLM
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
          VectorBea is a self-hosted sidecar proxy that intercepts every OpenAI
          call, injects versioned prompts, caches semantically-similar requests,
          and streams telemetry to a live dashboard — all in under 1 ms of added
          latency.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/onboarding"
            className={cn(
              buttonVariants({ size: "lg" }),
              "gap-2 px-8 shadow-glow",
            )}
          >
            Start for free <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pricing"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "px-8",
            )}
          >
            See pricing
          </Link>
        </div>

        {/* Social proof strip */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground/60">
          {[
            "Zero cold-start overhead",
            "Docker-native",
            "No vendor lock-in",
            "Full audit trail",
          ].map((item) => (
            <span key={item} className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-primary/50" />
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────── */}
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
              <p className="mb-3 font-mono text-xs font-bold text-primary/60">
                {step.n}
              </p>
              <h3 className="mb-2 font-semibold text-white">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
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
                <div
                  className={cn(
                    "mb-4 inline-flex h-9 w-9 items-center justify-center rounded-xl",
                    feat.bg,
                  )}
                >
                  <Icon className={cn("h-4.5 w-4.5", feat.color)} />
                </div>
                <h3 className="mb-1.5 font-semibold text-white">
                  {feat.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feat.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Code in action ──────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-24">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Drop-in integration
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Three lines from prototype to production
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            No new abstraction, no migration. Your existing OpenAI calls keep working — VectorBea just makes them observable, cacheable, and version-controlled.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/8 bg-card/40 p-6 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
              <span className="ml-2 font-mono">before.py</span>
            </div>
            <pre className="overflow-x-auto font-mono text-[12px] leading-6 text-slate-400">
{`import openai

# Hard-coded prompt buried in code
SYSTEM = "You are a helpful assistant..."

response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "system", "content": SYSTEM}],
)`}
            </pre>
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-6 shadow-glow backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
              <span className="ml-2 font-mono text-primary/80">after.py</span>
            </div>
            <pre className="overflow-x-auto font-mono text-[12px] leading-6 text-slate-300">
{`from vectorbea import VectorBeaClient
import openai

vb = VectorBeaClient(api_key="vb_...", organization_id="...")
config = vb.get_prompt("welcome-agent")  # versioned + cached

response = openai.chat.completions.create(**config.to_openai())`}
            </pre>
          </div>
        </div>
      </section>

      {/* ── Stats row ───────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20">
        <div className="rounded-3xl border border-white/8 bg-card/30 px-8 py-12 backdrop-blur-sm">
          <div className="grid gap-10 text-center md:grid-cols-4">
            {[
              { value: "<1ms", label: "Added latency p50" },
              { value: "70%", label: "Cache hit savings" },
              { value: "100%", label: "Audit log coverage" },
              { value: "0", label: "Vendor lock-in" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  <span className="bg-gradient-to-br from-primary via-violet-400 to-cyan-400 bg-clip-text text-transparent">
                    {stat.value}
                  </span>
                </p>
                <p className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison ──────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Why VectorBea
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Built for teams that ship every day
          </h2>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/8 bg-card/30 backdrop-blur-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-white/8 bg-white/[0.02]">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-4 font-medium">Capability</th>
                <th className="px-6 py-4 font-medium">DIY config files</th>
                <th className="px-6 py-4 font-medium">SaaS prompt tools</th>
                <th className="px-6 py-4 font-medium text-primary">VectorBea</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[
                ["Version-controlled prompts", "—", "✓", "✓"],
                ["Self-hosted sidecar", "✓", "—", "✓"],
                ["Semantic caching", "—", "—", "✓"],
                ["Sub-millisecond proxy", "—", "—", "✓"],
                ["Per-tenant isolation", "—", "✓", "✓"],
                ["Open-source core", "—", "—", "✓"],
              ].map((row) => (
                <tr key={row[0]} className="text-slate-300">
                  <td className="px-6 py-3.5 font-medium">{row[0]}</td>
                  <td className="px-6 py-3.5 text-slate-500">{row[1]}</td>
                  <td className="px-6 py-3.5 text-slate-500">{row[2]}</td>
                  <td className="px-6 py-3.5 font-semibold text-primary">{row[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Quote ───────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="mx-auto max-w-2xl text-xl font-medium leading-relaxed text-white sm:text-2xl">
          &ldquo;We replaced three internal tools with VectorBea in a single
          afternoon. Our prompt deployment now feels like deploying code — pull
          requests, audit logs, instant rollback.&rdquo;
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-violet-500" />
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Maya Chen</p>
            <p className="text-xs text-muted-foreground">Staff ML Engineer · Lattice AI</p>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 py-20">
        <div className="mb-10 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Questions
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Frequently asked
          </h2>
        </div>

        <div className="space-y-3">
          {[
            {
              q: "Does VectorBea work with providers other than OpenAI?",
              a: "Yes — the sidecar speaks the OpenAI API format and proxies to any compatible endpoint, including Anthropic, Mistral, Ollama, vLLM, and self-hosted models.",
            },
            {
              q: "Will it slow down my requests?",
              a: "No. The proxy adds under 1 ms p50 latency on a warm cache. On cache hits, your requests skip the LLM entirely — typically a 200x speedup.",
            },
            {
              q: "How does versioning work?",
              a: "Every prompt edit creates an immutable version. You promote a draft to published with one click — and roll back just as easily. The SDK always fetches the currently-published version.",
            },
            {
              q: "Is the data ever sent to a third party?",
              a: "No. VectorBea is self-hosted by default. Your prompts, audit logs, and traffic never leave your infrastructure unless you choose our managed cloud.",
            },
            {
              q: "Can I run it in air-gapped environments?",
              a: "Yes. The proxy and central hub both ship as Docker images with no outbound network requirements. Enterprise customers can also receive a tarball build.",
            },
          ].map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-white/8 bg-card/40 px-5 py-4 backdrop-blur-sm transition-all open:border-primary/30 open:bg-card/60"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-medium text-white">
                {item.q}
                <span className="text-xs text-primary transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-2xl px-6 py-24 text-center">
        <div className="rounded-3xl border border-primary/20 bg-primary/5 px-8 py-12 shadow-glow">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Ready to ship smarter AI?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Set up your workspace in two minutes. No credit card, no cloud
            account — just Docker.
          </p>
          <Link
            href="/onboarding"
            className={cn(
              buttonVariants({ size: "lg" }),
              "mt-8 gap-2 px-10 shadow-glow",
            )}
          >
            Get started for free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/5 px-6 py-8 text-center">
        <p className="text-xs text-muted-foreground/50">
          VectorBea · Prompt registry &amp; sidecar proxy for production AI ·{" "}
          <Link href="/pricing" className="hover:text-muted-foreground transition-colors">
            Pricing →
          </Link>
        </p>
      </footer>
    </div>
  );
}
