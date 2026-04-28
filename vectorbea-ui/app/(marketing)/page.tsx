import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Eye,
  GitBranch,
  Layers3,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Split,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAuthenticatedUserFromCookies, getPostLoginRedirectForUser } from "@/lib/auth/server";

const topNav = ["Platform", "Solutions", "Customers", "Pricing", "Docs"];

const trustRows = [
  "Built for teams shipping production AI",
  "Visibility control and confidence in one system",
  "From prompt changes to rollout safety",
];

const painCards = [
  "Prompt changes break production silently",
  "Regression detection stays manual for too long",
  "Tracing without context leaves teams guessing",
  "Output changes are hard to explain across releases",
  "Risky rollouts move without clear safety gates",
  "Provider switches happen without solid evidence",
];

const pillars = [
  { title: "Tracing", body: "Replay exactly what happened across prompt input model and output", icon: Eye },
  { title: "Evaluations", body: "Inspect score logic checks and confidence with full context", icon: BarChart3 },
  { title: "Regressions", body: "Detect quality drops early with baseline and golden trace sets", icon: AlertTriangle },
  { title: "Rollout control", body: "Gate releases and split traffic with clear approval rules", icon: SlidersHorizontal },
  { title: "Alerts", body: "Catch drift in latency errors and quality signals before impact grows", icon: Siren },
];

const workflows = [
  "Draft prompt",
  "Test candidate",
  "Run evaluations",
  "Detect regressions",
  "Approve rollout",
  "Monitor production",
  "Alert on drift",
];

const useCases = [
  { title: "For AI engineers", body: "Trace failures faster and inspect model behavior with clarity" },
  { title: "For platform teams", body: "Set rollout guardrails and keep production stable" },
  { title: "For product teams", body: "Ship changes with confidence and measurable quality signals" },
  { title: "For enterprises", body: "Bring governance to production AI across teams and environments" },
];

const compareRows = [
  ["Runtime tracing", "Basic", "Partial", "Manual", "Complete"],
  ["Explainable evaluations", "No", "No", "Custom", "Yes"],
  ["Regression scheduling", "No", "No", "Script heavy", "Yes"],
  ["Rollout gating", "No", "No", "Manual", "Yes"],
  ["Provider comparison", "No", "No", "Manual", "Yes"],
  ["Production alerts", "No", "Partial", "Custom", "Yes"],
];

const faq = [
  {
    q: "What does VectorBea monitor",
    a: "VectorBea tracks runtime traces evaluations regressions rollout decisions and production quality signals",
  },
  {
    q: "How do evaluations work",
    a: "You run candidate prompt versions on baseline traces then review scores checks confidence and evidence",
  },
  {
    q: "Can we compare providers",
    a: "Yes you can compare providers side by side for quality latency and operational fit",
  },
  {
    q: "Can we block risky rollouts",
    a: "Yes rollout gates can block candidate versions when checks fail or confidence is low",
  },
  {
    q: "Does VectorBea work with existing stacks",
    a: "VectorBea sits above your model stack and helps teams ship safer production AI behavior",
  },
  {
    q: "Is there a free plan",
    a: "Yes you can start free then scale with team and enterprise options",
  },
];

export default async function MarketingPage() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);
  if (user) {
    try {
      const { redirectTo } = await getPostLoginRedirectForUser(user.id);
      redirect(redirectTo as Route);
    } catch {
      redirect("/dashboard");
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF] text-[#111827]">
      <header className="sticky top-0 z-40 border-b border-[#E5E0D8] bg-[#FBF8F1]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-4 py-4 md:px-6 xl:px-8">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E5E0D8] bg-white">
              <Logo className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-[#111827]">VectorBea</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-[#374151] lg:flex">
            {topNav.map((item) => (
              <Link
                key={item}
                href={item === "Docs" ? "/docs" : "#"}
                className="transition-colors hover:text-[#111827]"
              >
                {item}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <Link href="/signin" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Sign in
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Book demo
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ size: "sm" }))}>
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-[1280px] gap-10 px-4 pb-16 pt-16 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center xl:px-8">
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
              AI risk control for production LLMs
            </p>
            <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
              Catch bad LLM behavior before users do
            </h1>
            <p className="max-w-2xl text-base leading-7 text-[#374151] md:text-lg">
              VectorBea helps teams trace evaluate compare and safely roll out LLM changes in production
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/signup" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                Book demo
              </Link>
              <Link href="#platform" className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}>
                See platform
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-[#E5E0D8] bg-white p-6 shadow-[0_12px_30px_rgba(17,24,39,0.06)]">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["TraceLoop", "Prompt model timing output"],
                ["Evaluation score", "Ready 82 confidence high"],
                ["Provider compare", "OpenAI Anthropic Gemini"],
                ["Rollout gate", "Candidate blocked by regression"],
              ].map(([title, value]) => (
                <div key={title} className="rounded-xl border border-[#EDE6DA] bg-[#FFFCF7] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6B7280]">{title}</p>
                  <p className="mt-2 text-sm font-semibold text-[#111827]">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-[#E5E0D8] bg-[#FBF8F1]">
          <div className="mx-auto grid w-full max-w-[1280px] gap-4 px-4 py-10 md:grid-cols-3 md:px-6 xl:px-8">
            {trustRows.map((row) => (
              <div key={row} className="rounded-xl border border-[#EDE6DA] bg-white px-4 py-3 text-sm font-medium text-[#374151]">
                {row}
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-6 xl:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">The problem</p>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Production AI fails quietly until trust drops
              </h2>
              <p className="text-base leading-7 text-[#374151]">
                Teams need one clear system for trace evaluation regression and rollout safety
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {painCards.map((card) => (
                <div key={card} className="rounded-xl border border-[#E5E0D8] bg-white p-4 text-sm text-[#374151]">
                  {card}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="platform" className="border-y border-[#E5E0D8] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-6 xl:px-8">
            <div className="max-w-3xl space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">The solution</p>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                The control system for production LLM behavior
              </h2>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {pillars.map(({ title, body, icon: Icon }) => (
                <article key={title} className="rounded-2xl border border-[#E5E0D8] bg-white p-5">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#2563EB]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#4B5563]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] space-y-16 px-4 py-20 md:px-6 xl:px-8">
          {[
            {
              title: "Tracing for real production debugging",
              body: "Follow every request and inspect prompts model calls timing context and outputs with full lineage",
              chips: ["Prompt resolution", "LLM call", "Replay linkage"],
            },
            {
              title: "Explainable evaluations",
              body: "Review input prompt output score confidence and check logic in one clear report",
              chips: ["Score breakdown", "Critical checks", "Review workflow"],
            },
            {
              title: "Regression detection",
              body: "Run scheduled checks on baseline and golden trace sets to catch drift early",
              chips: ["Baseline datasets", "Run history", "Failed trace ids"],
            },
            {
              title: "Safe rollouts",
              body: "Move from draft to candidate to active with approval gates and controlled traffic",
              chips: ["Blocked states", "Traffic split", "Approval signals"],
            },
            {
              title: "Provider comparison and decision support",
              body: "Compare quality latency and confidence across providers with evidence not guesswork",
              chips: ["Provider matrix", "Latency deltas", "Decision summary"],
            },
          ].map((block, idx) => (
            <div
              key={block.title}
              className={cn(
                "grid gap-8 rounded-2xl border border-[#E5E0D8] bg-white p-6 md:p-8 lg:grid-cols-2 lg:items-center",
                idx % 2 === 1 && "lg:[&>*:first-child]:order-2",
              )}
            >
              <div className="space-y-4">
                <h3 className="text-2xl font-semibold tracking-tight">{block.title}</h3>
                <p className="text-base leading-7 text-[#374151]">{block.body}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {block.chips.map((chip) => (
                    <span key={chip} className="rounded-full border border-[#E5E0D8] bg-[#FBF8F1] px-3 py-1 text-xs font-medium text-[#4B5563]">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-[#EDE6DA] bg-[#FFFCF7] p-5">
                <div className="space-y-3">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="rounded-lg border border-[#E5E0D8] bg-white p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-[#111827]">Signal {n}</p>
                        <Clock3 className="h-4 w-4 text-[#6B7280]" />
                      </div>
                      <p className="mt-1 text-xs text-[#6B7280]">Runtime evidence with clear attribution</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="border-y border-[#E5E0D8] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-6 xl:px-8">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Built for every AI shipping team</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {useCases.map((item) => (
                <article key={item.title} className="rounded-xl border border-[#E5E0D8] bg-white p-5">
                  <h3 className="text-base font-semibold text-[#111827]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#4B5563]">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-6 xl:px-8">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Workflow from change to confidence</h2>
          <div className="mt-8 grid gap-3 md:grid-cols-7">
            {workflows.map((step, idx) => (
              <div key={step} className="relative rounded-xl border border-[#E5E0D8] bg-white p-4 text-sm font-medium text-[#1F2937]">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6B7280]">Step {idx + 1}</p>
                <p className="mt-2">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-[#E5E0D8] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-6 xl:px-8">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">More than prompt management</h2>
            <div className="mt-8 overflow-hidden rounded-2xl border border-[#E5E0D8] bg-white">
              <div className="grid grid-cols-5 border-b border-[#EDE6DA] bg-[#FFFCF7] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#6B7280]">
                <span>Capability</span>
                <span>Prompt tools</span>
                <span>Tracing tools</span>
                <span>Custom scripts</span>
                <span>VectorBea</span>
              </div>
              {compareRows.map((row) => (
                <div key={row[0]} className="grid grid-cols-5 border-b border-[#EFE7DA] px-4 py-3 text-sm text-[#374151] last:border-0">
                  {row.map((cell, idx) => (
                    <span key={cell + idx} className={cn(idx === 4 && "font-semibold text-[#111827]")}>
                      {cell}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-6 xl:px-8">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Pricing preview</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { name: "Free", subtitle: "For getting started", cta: "Start free" },
              { name: "Team", subtitle: "For product and engineering teams", cta: "Book demo", highlight: true },
              { name: "Enterprise", subtitle: "For scale governance and advanced controls", cta: "Talk to sales" },
            ].map((plan) => (
              <article
                key={plan.name}
                className={cn(
                  "rounded-2xl border bg-white p-6",
                  plan.highlight ? "border-[#2563EB]" : "border-[#E5E0D8]",
                )}
              >
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <p className="mt-2 text-sm text-[#4B5563]">{plan.subtitle}</p>
                <ul className="mt-4 space-y-2 text-sm text-[#374151]">
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#059669]" />Trace and replay</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#059669]" />Evaluation workflows</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#059669]" />Rollout and alert controls</li>
                </ul>
                <Link href="/signup" className={cn(buttonVariants({ variant: plan.highlight ? "default" : "outline" }), "mt-6 w-full")}>
                  {plan.cta}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-[#E5E0D8] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[980px] px-4 py-20 md:px-6">
            <h2 className="text-center text-3xl font-semibold tracking-tight md:text-4xl">FAQ</h2>
            <div className="mt-8 space-y-3">
              {faq.map((item) => (
                <details key={item.q} className="rounded-xl border border-[#E5E0D8] bg-white p-5">
                  <summary className="cursor-pointer text-sm font-semibold text-[#111827]">{item.q}</summary>
                  <p className="mt-3 text-sm leading-6 text-[#4B5563]">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-4 pb-24 pt-20 md:px-6 xl:px-8">
          <div className="rounded-2xl border border-[#D8CFC2] bg-white p-10 text-center shadow-[0_12px_30px_rgba(17,24,39,0.06)] md:p-14">
            <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
              Ship production AI with confidence
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#374151]">
              Catch regressions before they reach users and bring control to your LLM stack
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/signup" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                Book demo
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E5E0D8] bg-[#FBF8F1]">
        <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-12 md:grid-cols-[1.2fr_1fr_1fr_1fr] md:px-6 xl:px-8">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E5E0D8] bg-white">
                <Logo className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-[#111827]">VectorBea</span>
            </div>
            <p className="max-w-xs text-xs leading-5 text-[#6B7280]">
              AI risk control for production LLM teams
            </p>
          </div>
          {[
            { title: "Product", links: ["Platform", "Pricing", "Docs", "Security"] },
            { title: "Company", links: ["Customers", "Contact", "Careers", "Blog"] },
            { title: "Legal", links: ["Privacy", "Terms", "Trust", "Status"] },
          ].map((group) => (
            <div key={group.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#374151]">{group.title}</p>
              <ul className="mt-3 space-y-2 text-sm text-[#4B5563]">
                {group.links.map((label) => (
                  <li key={label}>
                    <Link href="#" className="transition-colors hover:text-[#111827]">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
