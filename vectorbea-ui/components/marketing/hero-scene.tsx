"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  Cpu,
  Lock,
  Network,
  ShieldCheck,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function fadeUpProps(delay = 0) {
  return {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.65,
      delay,
    },
  };
}

function orbitProps(delay = 0) {
  return {
    animate: { y: [0, -10, 0] },
    transition: {
      duration: 6,
      delay,
      repeat: Number.POSITIVE_INFINITY,
    },
  };
}

function SignalCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.55)] backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

export function MarketingHero() {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-gradient-to-br from-background via-background to-muted/30 px-6 py-10 sm:px-8 lg:px-10 lg:py-12">
      <div className="pointer-events-none absolute inset-0 surface-grid opacity-60" />
      <div className="pointer-events-none absolute left-[-120px] top-[-120px] h-[300px] w-[300px] rounded-full bg-brand/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-140px] right-[-80px] h-[300px] w-[300px] rounded-full bg-brand-muted/10 blur-3xl" />

      <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)] lg:items-center">
        <div className="space-y-7">
          <motion.div
            {...fadeUpProps(0)}
            className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/90 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground shadow-sm"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Privacy-first
            <span className="text-border">&middot;</span>
            Docker-native
            <span className="text-border">&middot;</span>
            Enterprise-ready
          </motion.div>

          <div className="space-y-4">
            <motion.p
              {...fadeUpProps(0.08)}
              className="text-sm font-medium uppercase tracking-[0.24em] text-primary"
            >
              The Enterprise AI Infrastructure Platform
            </motion.p>
            <motion.h1
              {...fadeUpProps(0.16)}
              className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl xl:text-6xl"
            >
              Control AI behavior like infrastructure, not app copy
            </motion.h1>
            <motion.p
              {...fadeUpProps(0.24)}
              className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8"
            >
              Manage prompts, evaluations, and rollout state from one control
              plane while the VectorBea Sidecar delivers prompt fetches locally
              inside your VPC for low latency, stronger privacy, and cleaner
              separation between AI behavior and application code
            </motion.p>
          </div>

          <motion.div
            {...fadeUpProps(0.32)}
            className="flex flex-wrap items-center gap-3"
          >
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "gap-2 rounded-lg px-7")}>
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-lg px-7")}
            >
              Read the docs
            </Link>
          </motion.div>

          <motion.div
            {...fadeUpProps(0.4)}
            className="grid gap-3 sm:grid-cols-3"
          >
            {[
              ["Sidecar delivery", "Local prompt fetches with no inbound firewall path"],
              ["Prompt governance", "Versions, approvals, and rollbacks in one control plane"],
              ["Operational clarity", "Audits, latency, and deployment health in one view"],
            ].map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm backdrop-blur">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div
          {...fadeUpProps(0.2)}
          className="relative mx-auto w-full max-w-[560px]"
        >
          <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-zinc-950 p-5 text-white shadow-[0_30px_90px_-45px_rgba(0,0,0,0.75)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.08),transparent_26%)]" />
            <div className="relative space-y-5">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
                    <Cloud className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                      Control plane
                    </p>
                    <p className="text-sm font-medium text-white">
                      Prompt versions, rollout policy, deployment inventory
                    </p>
                  </div>
                </div>
                <div className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                  Healthy
                </div>
              </div>

              <div className="relative rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
                <div className="absolute inset-x-10 top-[72px] hidden h-px bg-gradient-to-r from-sky-400/20 via-sky-400/70 to-transparent md:block" />
                <div className="absolute inset-x-10 top-[152px] hidden h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-emerald-400/35 md:block" />

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] md:items-center">
                  <motion.div
                    {...orbitProps(0)}
                    className="rounded-2xl border border-white/10 bg-zinc-900/90 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
                        <Network className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                          VectorBea Sidecar
                        </p>
                        <p className="text-sm font-medium text-white">
                          Local cache and runtime boundary
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2">
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-300">
                        GET /v1/prompts/support-agent
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-300">
                        POST /v1/audit
                      </div>
                    </div>
                  </motion.div>

                  <div className="relative flex items-center justify-center">
                    <motion.div
                      animate={{ scale: [1, 1.12, 1], opacity: [0.75, 1, 0.75] }}
                      transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                      className="absolute h-16 w-16 rounded-full bg-sky-400/15 blur-xl"
                    />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-sky-400/25 bg-sky-400/10 text-sky-300">
                      <BrainCircuit className="h-6 w-6" />
                    </div>
                  </div>

                  <motion.div
                    {...orbitProps(0.6)}
                    className="rounded-2xl border border-white/10 bg-zinc-900/90 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                        <Cpu className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                          Customer runtime
                        </p>
                        <p className="text-sm font-medium text-white">
                          AI services stay inside your network
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {[
                        "Prod cluster / VPC",
                        "Model traffic stays local",
                        "Secrets remain in customer infra",
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-2 text-xs text-zinc-300">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5, duration: 0.55 }}
                  >
                    <SignalCard
                      title="P99 prompt latency"
                      value="8 ms"
                      detail="Served from the sidecar hot path"
                    />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.62, duration: 0.55 }}
                  >
                    <SignalCard
                      title="Audit throughput"
                      value="1.8k"
                      detail="Events captured across active sidecars"
                    />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.74, duration: 0.55 }}
                  >
                    <SignalCard
                      title="Policy status"
                      value="Green"
                      detail="Rollout and access boundaries enforced"
                    />
                  </motion.div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-[1.05fr_0.95fr]">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                        Live prompt routing
                      </p>
                      <div className="rounded-full bg-emerald-500/12 px-2 py-1 text-[11px] font-medium text-emerald-300">
                        Live
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {[
                        ["support-agent", "v12 published"],
                        ["checkout-assistant", "v7 rollout 100%"],
                        ["risk-review", "v4 canary complete"],
                      ].map(([name, state], index) => (
                        <motion.div
                          key={name}
                          initial={{ opacity: 0.5 }}
                          animate={{ opacity: [0.55, 1, 0.55] }}
                          transition={{
                            duration: 3.2,
                            delay: index * 0.35,
                            repeat: Number.POSITIVE_INFINITY,
                            ease: "easeInOut",
                          }}
                          className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
                        >
                          <span className="text-zinc-100">{name}</span>
                          <span className="text-zinc-400">{state}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-sky-300" />
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                        Enterprise boundary
                      </p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zinc-300">
                      Governance lives in the control plane, execution stays in your
                      environment, and runtime traffic never needs to leave the
                      systems you already trust
                    </p>
                    <div className="mt-4 space-y-2 text-xs text-zinc-400">
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        Outbound HTTPS only
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        Zero inbound firewall requirement
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        Sidecar-first prompt delivery
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
