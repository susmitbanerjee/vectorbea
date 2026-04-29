"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  Check,
  ChevronDown,
  GitBranch,
  ShieldCheck,
  Bell,
  ClipboardList,
  SlidersHorizontal,
  Minus,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import {
  PLANS,
  COMPARISON_CATEGORIES,
  PRICING_FAQ,
  PRODUCTION_BOUNDARY,
  ADD_ONS,
  formatPrice,
  type Billing,
  type PricingPlan,
} from "@/lib/pricing-data";

// ─── Sub-components ───────────────────────────────────────────────────────────

function BillingToggle({ billing, onChange }: { billing: Billing; onChange: (b: Billing) => void }) {
  return (
    <div className="inline-flex items-center gap-3">
      <div className="flex items-center rounded-lg border border-[#E7DED1] bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => onChange("monthly")}
          className={cn(
            "rounded-md px-4 py-1.5 text-[13px] font-medium transition-all",
            billing === "monthly"
              ? "bg-[#111111] text-white shadow-sm"
              : "text-[#6B7280] hover:text-[#111111]",
          )}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => onChange("annual")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-[13px] font-medium transition-all",
            billing === "annual"
              ? "bg-[#111111] text-white shadow-sm"
              : "text-[#6B7280] hover:text-[#111111]",
          )}
        >
          Annual
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors",
            billing === "annual"
              ? "bg-[#15803D] text-white"
              : "bg-[#DCFCE7] text-[#15803D]",
          )}>
            Save 20%
          </span>
        </button>
      </div>
    </div>
  );
}

function PricingCard({ plan, billing }: { plan: PricingPlan; billing: Billing }) {
  const priceStr    = formatPrice(plan, billing);
  const isCustom    = plan.monthlyPrice === null;
  const isFree      = plan.monthlyPrice === 0;
  const billingNote = billing === "annual" ? plan.billingNoteAnnual : plan.billingNoteMonthly;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border bg-white p-6 transition-shadow",
        plan.highlight
          ? "border-[#2563EB] shadow-[0_0_0_1px_#2563EB,0_8px_32px_rgba(37,99,235,0.10)]"
          : "border-[#E7DED1] shadow-sm hover:shadow-md",
      )}
    >
      {plan.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#2563EB]">
          {plan.badge}
        </div>
      )}

      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#6B7280]">
          {plan.name}
        </p>
        <p className="mt-1 text-[13px] leading-5 text-[#4B5563]">{plan.positioning}</p>
      </div>

      <div className="mt-5">
        <div className="flex items-end gap-1.5">
          <span className={cn(
            "font-semibold tracking-tight leading-none",
            isCustom ? "text-[2rem]" : "text-[2.25rem]",
            "text-[#111111]",
          )}>
            {priceStr}
          </span>
          {!isCustom && !isFree && (
            <span className="mb-1 text-[13px] text-[#6B7280]">{plan.priceSuffix}</span>
          )}
        </div>
        <p className="mt-1.5 text-[12px] text-[#9CA3AF]">{billingNote}</p>
      </div>

      <Link
        href={plan.cta.href as Route}
        className={cn(
          "mt-5 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-all",
          plan.highlight
            ? "bg-[#111111] text-white hover:bg-[#1F1F1F] shadow-sm"
            : "border border-[#E7DED1] bg-white text-[#111111] hover:bg-[#F8F5EF] hover:border-[#D8CFC2]",
        )}
      >
        {plan.cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>

      <ul className="mt-5 space-y-2.5 border-t border-[#F1ECE3] pt-5">
        {plan.features.slice(0, 12).map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13px] leading-5 text-[#374151]">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#15803D]" />
            {f}
          </li>
        ))}
        {plan.features.length > 12 && (
          <li className="pt-1 text-[12px] text-[#9CA3AF]">
            +{plan.features.length - 12} more included
          </li>
        )}
      </ul>

      {plan.notIncluded && plan.notIncluded.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-[#F1ECE3] pt-4">
          {plan.notIncluded.map((f) => (
            <li key={f} className="flex items-center gap-2.5 text-[12px] text-[#9CA3AF]">
              <Minus className="h-3 w-3 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CellValue({ value }: { value: string }) {
  if (value === "✓")
    return <Check className="mx-auto h-4 w-4 text-[#15803D]" />;
  if (value === "—")
    return <Minus className="mx-auto h-3.5 w-3.5 text-[#D1C9BE]" />;
  return <span>{value}</span>;
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#F1ECE3] last:border-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[14px] font-semibold text-[#111111]">{q}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#9CA3AF] transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <p className="pb-4 text-[14px] leading-7 text-[#4B5563]">{a}</p>
      )}
    </div>
  );
}

const BOUNDARY_ICONS = [GitBranch, SlidersHorizontal, Bell, ClipboardList];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="min-h-screen bg-[#F8F5EF] text-[#111111]">

      {/* ── Navbar ── */}
      <header className="sticky top-0 z-40 border-b border-[#E7DED1] bg-[#FBF8F1]/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-4 md:px-6 xl:px-8">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E7DED1] bg-white">
              <Logo className="h-4.5 w-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-[#111111]">VectorBea</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/signin" className="px-3 py-1.5 text-[13px] text-[#6B7280] transition-colors hover:text-[#111111]">
              Sign in
            </Link>
            <Link href="/signup" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#111111] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1F1F1F]">
              Start free
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>

        {/* ── 1. Hero ── */}
        <section className="border-b border-[#E7DED1] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-16 text-center md:px-6 xl:px-8">
            <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#2563EB]">
              Pricing
            </p>
            <h1 className="mx-auto mt-3 max-w-2xl text-balance text-[2.5rem] font-semibold leading-tight tracking-tight md:text-[3.25rem]">
              Pricing that scales with your AI risk
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-[#4B5563]">
              Start free, upgrade when you need regressions, rollout gates, alerts, and governance
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup" className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#111111] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1F1F1F]">
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/book-demo" className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#E7DED1] bg-white px-5 text-[14px] font-semibold text-[#111111] transition-colors hover:bg-[#F8F5EF] hover:border-[#D8CFC2]">
                Book demo
              </Link>
            </div>
            <p className="mt-5 text-[12px] text-[#9CA3AF]">
              Built for teams shipping production LLM features
            </p>
          </div>
        </section>

        {/* ── 2 + 3. Billing toggle + Pricing cards ── */}
        <section className="mx-auto w-full max-w-[1280px] px-4 py-14 md:px-6 xl:px-8">
          <div className="mb-8 flex justify-center">
            <BillingToggle billing={billing} onChange={setBilling} />
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {PLANS.map((plan) => (
              <PricingCard key={plan.id} plan={plan} billing={billing} />
            ))}
          </div>
        </section>

        {/* ── 4. Production boundary callout ── */}
        <section className="border-y border-[#E7DED1] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-14 md:px-6 xl:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#2563EB]">
                Pro only
              </span>
              <h2 className="mt-3 text-balance text-[1.75rem] font-semibold tracking-tight md:text-[2.25rem]">
                Production controls start with Pro
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-[14px] leading-7 text-[#4B5563]">
                Plus helps builders validate LLM behavior — Pro gives teams scheduled regressions, rollout gates, Slack alerts, audit trails, and production controls
              </p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PRODUCTION_BOUNDARY.map(({ title, body }, i) => {
                const Icon = BOUNDARY_ICONS[i];
                return (
                  <div key={title} className="rounded-2xl border border-[#E7DED1] bg-white p-5 shadow-sm">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <p className="mt-4 text-[14px] font-semibold text-[#111111]">{title}</p>
                    <p className="mt-1.5 text-[13px] leading-5 text-[#6B7280]">{body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 5. Usage add-ons ── */}
        <section className="mx-auto w-full max-w-[1280px] px-4 py-14 md:px-6 xl:px-8">
          <div className="max-w-xl">
            <h2 className="text-[1.75rem] font-semibold tracking-tight">Need more capacity</h2>
            <p className="mt-2 text-[14px] leading-6 text-[#4B5563]">
              Add trace, evaluation, and retention capacity as production usage grows
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ADD_ONS.map(({ title, body, pricing }) => (
              <div key={title} className="rounded-2xl border border-[#E7DED1] bg-white p-5 shadow-sm">
                <p className="text-[14px] font-semibold text-[#111111]">{title}</p>
                <p className="mt-1.5 text-[13px] leading-5 text-[#4B5563]">{body}</p>
                <p className="mt-4 text-[12px] font-semibold text-[#2563EB]">{pricing}</p>
              </div>
            ))}
          </div>

          <p className="mt-5 text-[12px] text-[#9CA3AF]">
            Evaluation execution means one test case evaluated against one prompt version or provider
          </p>
        </section>

        {/* ── 6. Feature comparison table ── */}
        <section className="border-t border-[#E7DED1] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-14 md:px-6 xl:px-8">
            <h2 className="text-[1.75rem] font-semibold tracking-tight">Compare all plans</h2>
            <p className="mt-2 text-[14px] text-[#4B5563]">Full feature breakdown across Free, Plus, Pro, and Enterprise</p>

            <div className="mt-8 overflow-x-auto rounded-2xl border border-[#E7DED1] bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                {/* colgroup locks column widths so the sticky header stays aligned */}
                <colgroup>
                  <col style={{ width: "36%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>
                <thead className="sticky top-16 z-10">
                  <tr
                    className="bg-[#FFFCF7]"
                    style={{ boxShadow: "inset 0 -1px 0 #F1ECE3" }}
                  >
                    <th className="px-5 py-3.5 text-left text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6B7280]">
                      Feature
                    </th>
                    {PLANS.map((p) => (
                      <th key={p.id} className={cn(
                        "px-4 py-3.5 text-center text-[12px] font-semibold uppercase tracking-[0.12em]",
                        p.highlight ? "text-[#2563EB]" : "text-[#6B7280]",
                      )}>
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_CATEGORIES.map((cat) => (
                    <React.Fragment key={cat.name}>
                      <tr className="border-b border-[#F1ECE3] bg-[#F8F5EF]">
                        <td colSpan={5} className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B7280]">
                          {cat.name}
                        </td>
                      </tr>
                      {cat.rows.map((row, ri) => (
                        <tr key={row.label} className={cn(
                          "border-b border-[#F1ECE3] last:border-0",
                          ri % 2 === 0 ? "bg-white" : "bg-[#FEFCFA]",
                          "hover:bg-[#FBF8F1] transition-colors",
                        )}>
                          <td className="px-5 py-3 font-medium text-[#374151]">{row.label}</td>
                          <td className="px-4 py-3 text-center text-[#4B5563]"><CellValue value={row.free} /></td>
                          <td className="px-4 py-3 text-center text-[#4B5563]"><CellValue value={row.plus} /></td>
                          <td className={cn("px-4 py-3 text-center font-medium", "text-[#111111]")}><CellValue value={row.pro} /></td>
                          <td className="px-4 py-3 text-center text-[#4B5563]"><CellValue value={row.enterprise} /></td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── 7. Enterprise trust section ── */}
        <section className="mx-auto w-full max-w-[1280px] px-4 py-14 md:px-6 xl:px-8">
          <div className="rounded-2xl border border-[#D8CFC2] bg-white p-8 shadow-sm md:p-12">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="space-y-4">
                <span className="inline-block text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">
                  Enterprise
                </span>
                <h2 className="text-balance text-[1.75rem] font-semibold tracking-tight md:text-[2.25rem]">
                  Need governance across production AI
                </h2>
                <p className="max-w-xl text-[14px] leading-7 text-[#4B5563]">
                  For teams that need security controls, private deployment, custom retention, organization policies, and audit-ready workflows
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {[
                    "SSO and SAML",
                    "Advanced RBAC",
                    "Private deployment",
                    "Custom retention",
                    "Audit logs",
                    "Data residency",
                    "PII redaction policies",
                    "Dedicated onboarding",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-[13px] text-[#374151]">
                      <Check className="h-3.5 w-3.5 shrink-0 text-[#15803D]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="shrink-0">
                <Link
                  href="/book-demo"
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#111111] px-6 text-[14px] font-semibold text-white transition-colors hover:bg-[#1F1F1F] whitespace-nowrap"
                >
                  Talk to sales
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── 8. FAQ ── */}
        <section className="border-t border-[#E7DED1] bg-[#FBF8F1]">
          <div className="mx-auto w-full max-w-[860px] px-4 py-14 md:px-6">
            <h2 className="text-[1.75rem] font-semibold tracking-tight">Frequently asked</h2>
            <p className="mt-2 text-[14px] text-[#4B5563]">
              Common questions from builders and production teams
            </p>
            <div className="mt-8 rounded-2xl border border-[#E7DED1] bg-white px-6 shadow-sm">
              {PRICING_FAQ.map((item) => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>

        {/* ── 9. Final CTA ── */}
        <section className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-14 md:px-6 xl:px-8">
          <div className="rounded-2xl border border-[#D8CFC2] bg-white p-10 text-center shadow-[0_8px_32px_rgba(17,24,39,0.06)] md:p-16">
            <h2 className="text-balance text-[1.875rem] font-semibold tracking-tight md:text-[2.5rem]">
              Ship production AI with confidence
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-[#4B5563]">
              Start free, or book a demo to see how VectorBea handles regressions, rollout gates, alerts, and governance
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#111111] px-6 text-[14px] font-semibold text-white transition-colors hover:bg-[#1F1F1F]">
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/book-demo" className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#E7DED1] bg-white px-6 text-[14px] font-semibold text-[#111111] transition-colors hover:bg-[#F8F5EF] hover:border-[#D8CFC2]">
                Book demo
              </Link>
            </div>
          </div>
        </section>

      </main>

      <footer className="border-t border-[#E7DED1] bg-[#FBF8F1] py-8">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 md:px-6 xl:px-8">
          <Link href="/" className="inline-flex items-center gap-2 text-[13px] font-medium text-[#374151] transition-colors hover:text-[#111111]">
            <Logo className="h-4 w-4" />
            VectorBea
          </Link>
          <div className="flex flex-wrap gap-5 text-[13px] text-[#6B7280]">
            <Link href="/"        className="hover:text-[#111111]">Home</Link>
            <Link href="/docs"    className="hover:text-[#111111]">Docs</Link>
            <Link href="/pricing" className="font-medium text-[#111111]">Pricing</Link>
            <Link href="/book-demo" className="hover:text-[#111111]">Book demo</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
