import Link from "next/link";
import { ArrowRight, Lock, ShieldCheck, Terminal } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Marketing hero — text-first, no animated product screen previews.
 * Inspired by enterprise developer-platform hero sections (Snyk, Vercel, HashiCorp):
 *   • confident eyebrow + single focused H1
 *   • short, specific subhead
 *   • two CTAs
 *   • a single static install terminal as the only visual anchor
 *   • proof strip underneath
 */
export function MarketingHero() {
  return (
    <section className="relative left-1/2 w-screen max-w-none -translate-x-1/2">
      <div className="relative overflow-hidden border-b border-border bg-background">
        {/* subtle grid + glow, no motion */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 surface-grid opacity-40"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.14),transparent_60%)]"
        />

        <div className="relative mx-auto w-full max-w-[1280px] px-4 pb-20 pt-16 md:px-6 md:pb-28 md:pt-24 xl:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              <span className="tracking-wide uppercase">
                The Enterprise AI Infrastructure Platform
              </span>
            </div>

            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl md:text-6xl xl:text-[4.25rem]">
              AI infrastructure that runs{" "}
              <span className="relative inline-block">
                <span className="relative z-10 bg-gradient-to-r from-primary to-[hsl(var(--brand-muted))] bg-clip-text text-transparent">
                  inside your perimeter
                </span>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-1 z-0 h-[0.35em] rounded-sm bg-primary/10"
                />
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
              Version prompts, ship rollouts, and audit every inference from a
              central control plane — while a lightweight sidecar keeps model
              calls, secrets, and customer data inside your VPC.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "gap-2 rounded-md px-6",
                )}
              >
                Get started free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "rounded-md px-6",
                )}
              >
                Read the docs
              </Link>
            </div>

            <p className="mt-5 text-xs text-muted-foreground">
              Free forever for small teams &middot; No credit card required
              &middot; SOC 2 available
            </p>
          </div>

          {/* Single static code surface — an anchor, not a product screenshot */}
          <div className="mx-auto mt-14 max-w-3xl">
            <div className="overflow-hidden rounded-xl border border-border bg-[#0b1020] shadow-[0_40px_80px_-40px_rgba(15,23,42,0.55)]">
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                  <Terminal className="h-3 w-3" />
                  Run the sidecar
                </div>
                <div className="w-12" />
              </div>
              <pre className="overflow-x-auto px-5 py-5 text-[13px] leading-relaxed text-slate-300">
                <code>
                  <span className="text-zinc-500"># Pull and run the VectorBea sidecar alongside your app</span>
                  {"\n"}
                  <span className="text-emerald-400">$</span> docker run -p 8080:8080 \{"\n"}
                  {"    "}-e VECTORBEA_KEY=<span className="text-sky-300">&quot;vbagent_...&quot;</span> \{"\n"}
                  {"    "}vectorbea/vectorbea-proxy:latest
                  {"\n\n"}
                  <span className="text-zinc-500"># Your app keeps calling localhost — prompts, policy, and</span>
                  {"\n"}
                  <span className="text-zinc-500"># audit stream back to the control plane over outbound HTTPS.</span>
                </code>
              </pre>
            </div>
          </div>

          {/* Proof strip */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-primary" />
              No inference data stored
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-border sm:block" />
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Outbound HTTPS only
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-border sm:block" />
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              SSO / SAML &middot; audit logs &middot; SOC 2
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
