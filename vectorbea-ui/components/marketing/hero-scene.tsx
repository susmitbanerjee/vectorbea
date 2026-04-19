"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Lock,
  Radar,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { TrustBar, coreTrustSignals } from "@/components/ui/trust-bar";
import { cn } from "@/lib/utils";

const posters = [
  {
    eyebrow: "Sidecar delivery",
    title: "Run prompt delivery inside your own network",
    description:
      "Keep runtime traffic close to the application, cut latency, and separate AI behavior from release cycles without opening inbound infrastructure.",
    accent: "from-cyan-500/20 via-sky-500/10 to-transparent",
    border: "border-cyan-400/25",
    glow: "bg-cyan-400/15",
    icon: Zap,
    metrics: [
      { label: "P99 fetch path", value: "8 ms" },
      { label: "Ingress model", value: "Outbound only" },
      { label: "Runtime mode", value: "VPC sidecar" },
    ],
    bullets: [
      "Local prompt fetches served through the sidecar hot path",
      "No app redeploy when prompt behavior changes",
      "No inbound firewall requirement for rollout operations",
    ],
  },
  {
    eyebrow: "Rollout controls",
    title: "Ship prompt changes with infrastructure-grade safety",
    description:
      "Version every prompt, ramp traffic deliberately, and expose deployment state in a language platform teams already trust.",
    accent: "from-indigo-500/20 via-primary/10 to-transparent",
    border: "border-primary/25",
    glow: "bg-primary/15",
    icon: Workflow,
    metrics: [
      { label: "Current rollout", value: "30 → 50%" },
      { label: "Policy", value: "Manual gate" },
      { label: "Rollback", value: "< 1 min" },
    ],
    bullets: [
      "Canary, ramp, and full rollout states visible to every operator",
      "Versioned prompt inventory across environments and teams",
      "Faster rollback when model behavior shifts unexpectedly",
    ],
  },
  {
    eyebrow: "Evaluation and audit",
    title: "Observe model behavior like a production system",
    description:
      "Capture prompt executions, audit trails, and evaluation feedback in one control plane so rollout decisions are backed by evidence, not instinct.",
    accent: "from-emerald-500/18 via-green-500/10 to-transparent",
    border: "border-emerald-400/25",
    glow: "bg-emerald-400/15",
    icon: Radar,
    metrics: [
      { label: "Audit throughput", value: "1.8k / hr" },
      { label: "Traceability", value: "Versioned" },
      { label: "Operators", value: "Platform + AI" },
    ],
    bullets: [
      "Prompt execution history tied to versions and rollout state",
      "Evaluation loops that fit operational review, not notebook workflows",
      "Shared evidence for AI teams, platform owners, and compliance reviewers",
    ],
  },
  {
    eyebrow: "Enterprise trust",
    title: "Bring AI infrastructure to procurement-ready posture",
    description:
      "Enterprise buyers need more than a prompt editor. They need trust signals, identity controls, and a platform story that stands up in security review.",
    accent: "from-amber-500/15 via-orange-500/10 to-transparent",
    border: "border-white/15",
    glow: "bg-amber-300/10",
    icon: ShieldCheck,
    metrics: [
      { label: "Identity", value: "SSO / SAML" },
      { label: "Evidence", value: "Audit logs" },
      { label: "Control plane", value: "Governed" },
    ],
    bullets: [
      "Security and trust posture surfaced before the demo even starts",
      "Enterprise narrative aligned with sidecar architecture and policy controls",
      "Built for platform teams, not just prompt experimentation",
    ],
  },
] as const;

function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.65, delay },
  };
}

export function MarketingHero() {
  const [activePoster, setActivePoster] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActivePoster((current) => (current + 1) % posters.length);
    }, 3200);

    return () => window.clearInterval(interval);
  }, []);

  const current = posters[activePoster];
  const CurrentIcon = current.icon;

  return (
    <section className="relative left-1/2 w-screen max-w-none -translate-x-1/2 px-4 md:px-6 xl:px-8">
      <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-gradient-to-br from-background via-background to-muted/20 px-6 py-10 sm:px-8 lg:px-10 lg:py-14">
        <div className="pointer-events-none absolute inset-0 surface-grid opacity-40" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_14%,rgba(56,189,248,0.14),transparent_24%),radial-gradient(circle_at_72%_20%,rgba(99,102,241,0.12),transparent_24%),radial-gradient(circle_at_80%_80%,rgba(34,197,94,0.08),transparent_20%)]" />

        <div className="relative mx-auto max-w-[1520px]">
          <div className="grid gap-10 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:items-center">
            <div className="space-y-7">
              <motion.div {...fadeUp(0)}>
                <TrustBar
                  signals={coreTrustSignals}
                  variant="hero"
                  density="dense"
                  className="max-w-3xl"
                />
              </motion.div>

              <div className="space-y-5">
                <motion.p
                  {...fadeUp(0.08)}
                  className="text-sm font-medium uppercase tracking-[0.22em] text-primary"
                >
                  The Enterprise AI Infrastructure Platform
                </motion.p>
                <motion.h1
                  {...fadeUp(0.16)}
                  className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl xl:text-6xl"
                >
                  Control AI behavior like infrastructure, not app copy
                </motion.h1>
                <motion.p
                  {...fadeUp(0.24)}
                  className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8"
                >
                  Manage, evaluate, and deliver prompts at the edge with zero latency. Run the
                  VectorBea Sidecar in your VPC to separate AI behavior from your codebase without
                  compromising data privacy.
                </motion.p>
              </div>

              <motion.div
                {...fadeUp(0.32)}
                className="flex flex-wrap items-center gap-3"
              >
                <Link
                  href="/login"
                  className={cn(buttonVariants({ size: "lg" }), "gap-2 rounded-lg px-7")}
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
                    "rounded-lg px-7",
                  )}
                >
                  Read the docs
                </Link>
              </motion.div>

              <motion.div
                {...fadeUp(0.4)}
                className="grid gap-3 sm:grid-cols-3"
              >
                {[
                  ["Runtime separation", "AI behavior moves independently from application deploys"],
                  ["Enterprise control", "Policy, visibility, and trust signals live in one plane"],
                  ["Operational speed", "Sidecar delivery keeps prompt changes fast and local"],
                ].map(([title, body]) => (
                  <div
                    key={title}
                    className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur"
                  >
                    <p className="text-sm font-semibold text-foreground">{title}</p>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
                  </div>
                ))}
              </motion.div>
            </div>

            <motion.div
              {...fadeUp(0.18)}
              className="relative min-h-[620px] overflow-hidden rounded-[2rem] border border-border/70 bg-zinc-950 p-5 text-white shadow-[0_30px_90px_-45px_rgba(0,0,0,0.75)]"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.16),transparent_30%)]" />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_28%,transparent_72%,rgba(255,255,255,0.03))]" />

              <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Product story
                    </p>
                    <p className="mt-1 text-sm text-zinc-300">
                      Feature posters that frame VectorBea like enterprise infrastructure
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {posters.map((poster, index) => (
                      <button
                        key={poster.eyebrow}
                        type="button"
                        onClick={() => setActivePoster(index)}
                        className={cn(
                          "h-2.5 rounded-full transition-all",
                          index === activePoster
                            ? "w-10 bg-white"
                            : "w-2.5 bg-white/25 hover:bg-white/45",
                        )}
                        aria-label={`Show ${poster.eyebrow} poster`}
                      />
                    ))}
                  </div>
                </div>

                <div className="relative mt-6 min-h-[500px]">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={current.eyebrow}
                      initial={{ opacity: 0, x: 28, scale: 0.985 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -24, scale: 0.985 }}
                      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                      className={cn(
                        "absolute inset-0 overflow-hidden rounded-[1.75rem] border bg-gradient-to-br p-7",
                        current.border,
                        current.accent,
                      )}
                    >
                      <div className={cn("absolute -right-14 top-10 h-44 w-44 rounded-full blur-3xl", current.glow)} />
                      <div className="relative flex h-full flex-col">
                        <div className="flex items-start justify-between gap-6">
                          <div className="space-y-4">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                              <CurrentIcon className="h-3.5 w-3.5 text-white" />
                              {current.eyebrow}
                            </div>
                            <div className="max-w-xl space-y-3">
                              <h2 className="text-3xl font-semibold tracking-tight text-white md:text-[2.5rem] md:leading-[1.04]">
                                {current.title}
                              </h2>
                              <p className="text-base leading-7 text-zinc-300">
                                {current.description}
                              </p>
                            </div>
                          </div>

                          <div className="hidden rounded-2xl border border-white/10 bg-black/20 p-4 lg:block">
                            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                              Platform fit
                            </p>
                            <div className="mt-4 space-y-3">
                              {[
                                "Built for platform teams",
                                "Designed for rollout discipline",
                                "Fits enterprise buying motion",
                              ].map((item) => (
                                <div key={item} className="flex items-center gap-2 text-sm text-zinc-300">
                                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="mt-8 grid gap-3 md:grid-cols-3">
                          {current.metrics.map((metric) => (
                            <div
                              key={metric.label}
                              className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                            >
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                                {metric.label}
                              </p>
                              <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
                                {metric.value}
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-6 grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                          <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                              Why teams buy in
                            </p>
                            <div className="mt-5 space-y-4">
                              {current.bullets.map((item, index) => (
                                <motion.div
                                  key={item}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: index * 0.08 + 0.12 }}
                                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                                >
                                  <div className="flex items-start gap-3">
                                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-white">
                                      0{index + 1}
                                    </div>
                                    <p className="text-sm leading-6 text-zinc-200">{item}</p>
                                  </div>
                                </motion.div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                              Enterprise positioning
                            </p>
                            <div className="mt-5 space-y-3">
                              {[
                                {
                                  title: "Infrastructure first",
                                  body: "Frames VectorBea as a control plane and runtime layer, not a prompt editor",
                                  icon: Bot,
                                },
                                {
                                  title: "Trust visible",
                                  body: "Connects product motion to procurement, compliance, and platform review",
                                  icon: Lock,
                                },
                                {
                                  title: "Operational language",
                                  body: "Talks about rollout, policy, runtime, and visibility instead of templates and settings",
                                  icon: Sparkles,
                                },
                              ].map((item) => (
                                <div
                                  key={item.title}
                                  className="rounded-2xl border border-white/10 bg-black/20 p-4"
                                >
                                  <div className="flex items-start gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white">
                                      <item.icon className="h-4 w-4" />
                                    </div>
                                    <div>
                                      <p className="text-sm font-semibold text-white">{item.title}</p>
                                      <p className="mt-1 text-sm leading-6 text-zinc-400">{item.body}</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
