"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ShieldCheck,
  GitBranch,
  FlaskConical,
  SlidersHorizontal,
  Bell,
  ArrowUpRight,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

// ─── Static content ───────────────────────────────────────────────────────────

const benefits = [
  {
    icon: GitBranch,
    title: "Trace production AI failures clearly",
    body: "Replay every request with full prompt model and output lineage — no guessing required",
  },
  {
    icon: FlaskConical,
    title: "Evaluate candidate prompts before rollout",
    body: "Score new versions against baseline traces and catch issues before they reach users",
  },
  {
    icon: ShieldCheck,
    title: "Catch regressions before customers do",
    body: "Scheduled regression runs on golden trace sets surface quality drops automatically",
  },
  {
    icon: SlidersHorizontal,
    title: "Block risky releases with rollout gates",
    body: "Approval workflows and traffic splitting keep production behavior under control",
  },
  {
    icon: Bell,
    title: "Compare providers using quality and cost signals",
    body: "Evidence-based provider comparison across latency quality and operational fit",
  },
];

const CHALLENGE_OPTIONS = [
  { value: "", label: "Select your main challenge" },
  { value: "prompt_regressions",       label: "Prompt regressions" },
  { value: "llm_observability",        label: "LLM observability" },
  { value: "evaluation_automation",    label: "Evaluation automation" },
  { value: "rollout_safety",           label: "Rollout safety" },
  { value: "provider_comparison",      label: "Provider comparison" },
  { value: "production_incidents",     label: "Production incidents" },
  { value: "compliance_governance",    label: "Compliance or governance" },
  { value: "just_exploring",           label: "Just exploring" },
];

const SIZE_OPTIONS = [
  { value: "",       label: "Select company size" },
  { value: "1-10",   label: "1 to 10" },
  { value: "11-50",  label: "11 to 50" },
  { value: "51-200", label: "51 to 200" },
  { value: "201-1000", label: "201 to 1000" },
  { value: "1000+",  label: "1000 plus" },
];

// ─── Small components ─────────────────────────────────────────────────────────

function Label({ htmlFor, children, required }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-[13px] font-medium text-[#374151] mb-1.5">
      {children}
      {required && <span className="ml-1 text-[#B91C1C]">*</span>}
    </label>
  );
}

function Field({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}

const inputCls = [
  "h-10 w-full rounded-lg border border-[#E7DED1] bg-white px-3.5 text-[14px] text-[#111111]",
  "placeholder:text-[#9CA3AF] transition-colors",
  "focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15",
].join(" ");

const selectCls = [
  "h-10 w-full rounded-lg border border-[#E7DED1] bg-white px-3.5 text-[14px] text-[#111111]",
  "transition-colors appearance-none",
  "focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15",
  // custom caret
  "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] bg-no-repeat bg-[position:right_12px_center]",
].join(" ");

function ErrorMsg({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1.5 text-[12px] text-[#B91C1C]">{msg}</p>;
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface FormData {
  full_name: string;
  work_email: string;
  company_name: string;
  role: string;
  company_size: string;
  llm_use_case: string;
  main_challenge: string;
  preferred_time: string;
}

type FormErrors = Partial<Record<keyof FormData, string>>;

const INITIAL: FormData = {
  full_name:      "",
  work_email:     "",
  company_name:   "",
  role:           "",
  company_size:   "",
  llm_use_case:   "",
  main_challenge: "",
  preferred_time: "",
};

function validate(data: FormData): FormErrors {
  const errs: FormErrors = {};
  if (!data.full_name.trim())      errs.full_name      = "Required";
  if (!data.work_email.trim())     errs.work_email     = "Required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.work_email))
                                   errs.work_email     = "Enter a valid work email";
  if (!data.company_name.trim())   errs.company_name   = "Required";
  if (!data.role.trim())           errs.role           = "Required";
  if (!data.company_size)          errs.company_size   = "Required";
  if (!data.llm_use_case.trim())   errs.llm_use_case   = "Required";
  if (!data.main_challenge)        errs.main_challenge = "Required";
  return errs;
}

export default function BookDemoPage() {
  const [form, setForm]         = useState<FormData>(INITIAL);
  const [errors, setErrors]     = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function set(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch("/api/book-demo", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...form, source_page: "/book-demo" }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setServerError(json.error ?? "Something went wrong — please try again");
        return;
      }
      setSubmitted(true);
    } catch {
      setServerError("Network error — please check your connection and try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF] text-[#111111]">
      {/* ── Top nav ── */}
      <header className="border-b border-[#E7DED1] bg-[#FBF8F1]/90 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-4 md:px-6 xl:px-8">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E7DED1] bg-white">
              <Logo className="h-4.5 w-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-[#111111]">VectorBea</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13px] text-[#6B7280] transition-colors hover:text-[#111111]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-4 py-14 md:px-6 xl:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_480px] lg:gap-16 xl:grid-cols-[1fr_520px]">

          {/* ── Left: value prop ─────────────────────────────────────────── */}
          <div className="space-y-10">
            <div className="space-y-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
                Book a demo
              </p>
              <h1 className="text-balance text-[2.25rem] font-semibold leading-tight tracking-tight md:text-[2.75rem]">
                See how VectorBea controls production LLM risk
              </h1>
              <p className="max-w-xl text-base leading-7 text-[#4B5563]">
                Walk through tracing evaluations regressions rollout gates alerts and provider comparison with your own use case in mind
              </p>
            </div>

            <div className="space-y-5">
              {benefits.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex gap-4">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E7DED1] bg-white shadow-sm">
                    <Icon className="h-4 w-4 text-[#2563EB]" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-[#111111]">{title}</p>
                    <p className="mt-0.5 text-[13px] leading-6 text-[#6B7280]">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Trust strip */}
            <div className="rounded-2xl border border-[#E7DED1] bg-white p-6">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6B7280]">
                What to expect
              </p>
              <ul className="mt-4 space-y-3">
                {[
                  "30-minute tailored walkthrough",
                  "Live demo of your specific use case",
                  "Q&A with the founding team",
                  "No hard sell — just honest answers",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[14px] text-[#374151]">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#15803D]" />
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="/docs/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#2563EB] transition-colors hover:text-[#1D4ED8]"
              >
                Read the docs first
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* ── Right: form card ──────────────────────────────────────────── */}
          <div>
            <div className="rounded-2xl border border-[#E7DED1] bg-white shadow-[0_4px_24px_rgba(17,24,39,0.07)] sticky top-24">
              {submitted ? (
                <SuccessState name={form.full_name} email={form.work_email} />
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <div className="border-b border-[#F1ECE3] px-7 py-6">
                    <h2 className="text-[18px] font-semibold tracking-tight text-[#111111]">
                      Request a demo
                    </h2>
                    <p className="mt-1 text-[13px] text-[#6B7280]">
                      We will review your request and share available slots shortly
                    </p>
                  </div>

                  <div className="space-y-5 px-7 py-6">
                    {/* Name + Email */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <Label htmlFor="full_name" required>Full name</Label>
                        <input
                          id="full_name"
                          className={cn(inputCls, errors.full_name && "border-[#B91C1C] focus:ring-[#B91C1C]/15")}
                          placeholder="Jane Smith"
                          value={form.full_name}
                          onChange={(e) => set("full_name", e.target.value)}
                          autoComplete="name"
                        />
                        <ErrorMsg msg={errors.full_name} />
                      </Field>
                      <Field>
                        <Label htmlFor="work_email" required>Work email</Label>
                        <input
                          id="work_email"
                          type="email"
                          className={cn(inputCls, errors.work_email && "border-[#B91C1C] focus:ring-[#B91C1C]/15")}
                          placeholder="jane@company.com"
                          value={form.work_email}
                          onChange={(e) => set("work_email", e.target.value)}
                          autoComplete="email"
                        />
                        <ErrorMsg msg={errors.work_email} />
                      </Field>
                    </div>

                    {/* Company + Role */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <Label htmlFor="company_name" required>Company</Label>
                        <input
                          id="company_name"
                          className={cn(inputCls, errors.company_name && "border-[#B91C1C] focus:ring-[#B91C1C]/15")}
                          placeholder="Acme Corp"
                          value={form.company_name}
                          onChange={(e) => set("company_name", e.target.value)}
                          autoComplete="organization"
                        />
                        <ErrorMsg msg={errors.company_name} />
                      </Field>
                      <Field>
                        <Label htmlFor="role" required>Your role</Label>
                        <input
                          id="role"
                          className={cn(inputCls, errors.role && "border-[#B91C1C] focus:ring-[#B91C1C]/15")}
                          placeholder="AI Engineer"
                          value={form.role}
                          onChange={(e) => set("role", e.target.value)}
                          autoComplete="organization-title"
                        />
                        <ErrorMsg msg={errors.role} />
                      </Field>
                    </div>

                    {/* Company size */}
                    <Field>
                      <Label htmlFor="company_size" required>Company size</Label>
                      <select
                        id="company_size"
                        className={cn(selectCls, errors.company_size && "border-[#B91C1C]", !form.company_size && "text-[#9CA3AF]")}
                        value={form.company_size}
                        onChange={(e) => set("company_size", e.target.value)}
                      >
                        {SIZE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value} disabled={!o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <ErrorMsg msg={errors.company_size} />
                    </Field>

                    {/* LLM use case */}
                    <Field>
                      <Label htmlFor="llm_use_case" required>What are you building with LLMs</Label>
                      <textarea
                        id="llm_use_case"
                        rows={3}
                        className={cn(
                          "w-full rounded-lg border border-[#E7DED1] bg-white px-3.5 py-2.5 text-[14px] text-[#111111]",
                          "placeholder:text-[#9CA3AF] resize-none transition-colors",
                          "focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15",
                          errors.llm_use_case && "border-[#B91C1C] focus:ring-[#B91C1C]/15",
                        )}
                        placeholder="Customer support assistant, document Q&A, code generation pipeline..."
                        value={form.llm_use_case}
                        onChange={(e) => set("llm_use_case", e.target.value)}
                      />
                      <ErrorMsg msg={errors.llm_use_case} />
                    </Field>

                    {/* Main challenge */}
                    <Field>
                      <Label htmlFor="main_challenge" required>Main challenge</Label>
                      <select
                        id="main_challenge"
                        className={cn(selectCls, errors.main_challenge && "border-[#B91C1C]", !form.main_challenge && "text-[#9CA3AF]")}
                        value={form.main_challenge}
                        onChange={(e) => set("main_challenge", e.target.value)}
                      >
                        {CHALLENGE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value} disabled={!o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <ErrorMsg msg={errors.main_challenge} />
                    </Field>

                    {/* Preferred time */}
                    <Field>
                      <Label htmlFor="preferred_time">Preferred time</Label>
                      <input
                        id="preferred_time"
                        className={inputCls}
                        placeholder="e.g. Weekday afternoons EST"
                        value={form.preferred_time}
                        onChange={(e) => set("preferred_time", e.target.value)}
                      />
                    </Field>

                    {/* Server error */}
                    {serverError && (
                      <div className="rounded-lg border border-[#F2D2D2] bg-[#FFF3F3] px-4 py-3 text-[13px] text-[#B91C1C]">
                        {serverError}
                      </div>
                    )}

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={submitting}
                      className={cn(
                        "w-full rounded-lg bg-[#111111] px-5 py-3 text-[14px] font-semibold text-white",
                        "transition-all hover:bg-[#1F1F1F] active:scale-[0.98]",
                        "focus:outline-none focus:ring-2 focus:ring-[#111111]/30 focus:ring-offset-2",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                      )}
                    >
                      {submitting ? "Sending request…" : "Request demo"}
                    </button>

                    <p className="text-center text-[12px] text-[#9CA3AF]">
                      No spam — we will only reach out about your demo
                    </p>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Success state ────────────────────────────────────────────────────────────

function SuccessState({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex flex-col items-center gap-6 px-7 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DCFCE7] text-[#15803D]">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h2 className="text-[20px] font-semibold tracking-tight text-[#111111]">
          Demo request received
        </h2>
        <p className="text-[14px] leading-6 text-[#4B5563]">
          Thanks {name.split(" ")[0]} — we will review your request and share available slots with{" "}
          <span className="font-medium text-[#111111]">{email}</span> shortly
        </p>
      </div>
      <div className="w-full rounded-xl border border-[#E7DED1] bg-[#F8F5EF] p-5 text-left">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6B7280]">
          While you wait
        </p>
        <ul className="mt-3 space-y-2.5">
          {[
            { label: "Read the architecture overview", href: "/docs/architecture" },
            { label: "Explore evaluation docs",        href: "/docs/evaluations" },
            { label: "See rollout gating in action",   href: "/docs/blocked-rollout" },
          ].map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="flex items-center gap-2 text-[13px] font-medium text-[#2563EB] transition-colors hover:text-[#1D4ED8]"
              >
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <Link
        href="/"
        className="text-[13px] text-[#6B7280] transition-colors hover:text-[#111111]"
      >
        Return to home
      </Link>
    </div>
  );
}
