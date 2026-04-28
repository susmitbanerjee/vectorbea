import Link from "next/link";
import { ArrowRight, GitBranch, Lock, ShieldCheck, Terminal, Zap } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MarketingHero() {
  return (
    <section className="relative left-1/2 w-screen max-w-none -translate-x-1/2">
      <div className="relative overflow-hidden border-b border-border/50 bg-background">

        {/* Background layers: dot grid + top glow */}
        <div aria-hidden className="pointer-events-none absolute inset-0 surface-grid" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-px h-[480px]"
          style={{
            background:
              "radial-gradient(ellipse 70% 45% at 50% 0%, hsl(var(--primary)/0.10) 0%, transparent 70%)",
          }}
        />

        <div className="relative mx-auto w-full max-w-[1120px] px-5 pb-20 pt-20 md:px-8 md:pb-28 md:pt-28">
          <div className="mx-auto max-w-3xl text-center">

            {/* Eyebrow badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/90 px-3.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-xs backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary/50 animate-ping" style={{ animationDuration: "2.4s" }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              AI Risk Control for Production LLMs &nbsp;·&nbsp; v2
            </div>

            {/* H1 */}
            <h1 className="mt-7 text-balance text-[2.625rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl md:text-[3.5rem] xl:text-[4rem]">
              Control, evaluate, and safely deploy
              {" "}LLM behavior in production.
              <span
                className="bg-gradient-to-r from-primary via-primary to-brand-muted bg-clip-text text-transparent"
              >
                production infrastructure.
              </span>
            </h1>

            {/* Subhead */}
            <p className="mx-auto mt-6 max-w-xl text-balance text-[1.0625rem] leading-7 text-muted-foreground">
              Version, review, and ship prompt changes with evaluation gates and
              canary rollouts — while a lightweight sidecar keeps every inference
              and secret inside your own VPC.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "gap-2 px-6 shadow-[0_0_24px_rgba(79,70,229,0.25)] hover:shadow-[0_0_32px_rgba(79,70,229,0.35)]",
                )}
              >
                Get started free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-6")}
              >
                Read the docs
              </Link>
            </div>

            <p className="mt-5 text-xs text-muted-foreground/70">
              Free for small teams &nbsp;·&nbsp; No credit card &nbsp;·&nbsp; SOC 2 available
            </p>
          </div>

          {/* Terminal block */}
          <div className="mx-auto mt-16 max-w-2xl">
            <div className="overflow-hidden rounded-xl border border-border/60 bg-[#0d1117] shadow-[0_24px_64px_-24px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.04)]">
              {/* Traffic lights */}
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                  <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                  <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600">
                  <Terminal className="h-3 w-3" />
                  sidecar setup
                </div>
                <div className="w-14" />
              </div>

              {/* Code */}
              <pre className="overflow-x-auto px-6 py-5 font-mono text-[12.5px] leading-6">
                <code className="text-slate-400">
                  <span className="text-zinc-600">{`# Pull the VectorBea sidecar — runs next to your service`}</span>
                  {"\n"}
                  <span className="text-emerald-400">$</span>
                  <span className="text-slate-300">{` docker run -p 8080:8080 \\`}</span>
                  {"\n"}
                  {"    "}
                  <span className="text-slate-500">{`-e `}</span>
                  <span className="text-yellow-300/90">{"VECTORBEA_KEY"}</span>
                  <span className="text-slate-500">{"="}</span>
                  <span className="text-sky-300/90">{`"vbagent_..."`}</span>
                  <span className="text-slate-300">{` \\`}</span>
                  {"\n"}
                  {"    "}
                  <span className="text-slate-300">{"vectorbea/vectorbea-proxy:latest"}</span>
                  {"\n\n"}
                  <span className="text-zinc-600">{`# Prompts are fetched from your control plane.`}</span>
                  {"\n"}
                  <span className="text-zinc-600">{`# Model calls and audit events stay in your VPC.`}</span>
                  {"\n\n"}
                  <span className="text-emerald-400">$</span>
                  <span className="text-slate-300">{` curl http://localhost:8080/v1/prompt/my-prompt`}</span>
                  {"\n"}
                  <span className="text-zinc-600">{`# → {"version":"v3","content":"You are a...","cached":true}`}</span>
                </code>
              </pre>
            </div>
          </div>

          {/* Trust proof strip */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {[
              { icon: Lock,       label: "No inference data stored" },
              { icon: ShieldCheck, label: "Outbound HTTPS only" },
              { icon: GitBranch,  label: "Versioned prompts & rollbacks" },
              { icon: Zap,        label: "8 ms P99 from sidecar cache" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
                <Icon className="h-3.5 w-3.5 text-primary/70" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}