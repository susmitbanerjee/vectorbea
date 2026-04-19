"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  Cpu,
  Lock,
  Network,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { RolloutStatus } from "@/components/ui/rollout-status";
import { TrustBar, coreTrustSignals } from "@/components/ui/trust-bar";
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
    <section className="relative left-1/2 w-screen max-w-none -translate-x-1/2 px-4 md:px-6 xl:px-8">
      <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-gradient-to-br from-background via-background to-muted/30 px-6 py-10 sm:px-8 lg:px-10 lg:py-14">
        <div className="pointer-events-none absolute inset-0 surface-grid opacity-50" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(14,165,233,0.08),transparent_24%),radial-gradient(circle_at_80%_78%,rgba(34,197,94,0.07),transparent_22%)]" />
        <div className="pointer-events-none absolute inset-y-0 left-[52%] hidden w-px bg-gradient-to-b from-transparent via-border/80 to-transparent lg:block" />

        <div className="relative mx-auto max-w-[1480px]">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] lg:items-center">
            <div className="space-y-7">
          <motion.div {...fadeUpProps(0)}>
            <TrustBar
              signals={coreTrustSignals}
              variant="hero"
              density="dense"
              className="max-w-3xl"
            />
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
              className="relative w-full"
            >
              <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-zinc-950 p-5 text-white shadow-[0_30px_90px_-45px_rgba(0,0,0,0.75)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.08),transparent_26%)]" />
                <div className="pointer-events-none absolute left-0 top-[122px] hidden h-px w-full bg-gradient-to-r from-transparent via-sky-400/55 to-transparent opacity-80 lg:block hero-scan-line" />
                <div className="pointer-events-none absolute left-0 top-[304px] hidden h-px w-full bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent opacity-70 lg:block hero-scan-line-delayed" />
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
                <RolloutStatus
                  version="v12"
                  label="checkout-assistant"
                  stage="ramp"
                  progress={30}
                  target={50}
                  policy="Auto 10% / hr"
                  startedAt={new Date(Date.now() - 2 * 60 * 60 * 1000)}
                  variant="hero"
                  className="mb-5 border-white/10 bg-black/20"
                />

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] md:items-center">
                  <div className="rounded-2xl border border-white/10 bg-zinc-900/90 p-4">
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
                  </div>

                  <div className="relative flex items-center justify-center">
                    <div className="absolute h-16 w-16 rounded-full bg-sky-400/15 blur-xl hero-pulse-soft" />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-sky-400/25 bg-sky-400/10 text-sky-300">
                      <BrainCircuit className="h-6 w-6" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-zinc-900/90 p-4">
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
                  </div>
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
                        {
                          label: "support-agent",
                          version: "v12",
                          stage: "full" as const,
                          progress: 100,
                          target: 100,
                          policy: "Manual gate",
                        },
                        {
                          label: "checkout-assistant",
                          version: "v7",
                          stage: "ramp" as const,
                          progress: 72,
                          target: 100,
                          policy: "Auto 10% / hr",
                        },
                        {
                          label: "risk-review",
                          version: "v4",
                          stage: "canary" as const,
                          progress: 10,
                          target: 25,
                          policy: "Observe before ramp",
                        },
                      ].map((item) => (
                        <RolloutStatus
                          key={item.label}
                          label={item.label}
                          version={item.version}
                          stage={item.stage}
                          progress={item.progress}
                          target={item.target}
                          policy={item.policy}
                          variant="inline"
                          size="sm"
                          className="w-full border-white/10 bg-black/20"
                        />
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
        </div>
      </div>
    </section>
  );
}
