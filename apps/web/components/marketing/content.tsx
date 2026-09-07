import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/marketing/site-chrome";
import { Checkpoint } from "@/components/marketing/logo";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema, type BreadcrumbItem } from "@/lib/seo";

/**
 * Shared shell + prose primitives for public SEO content pages (use cases,
 * comparisons). Provides consistent semantic structure — one <h1>, ordered
 * <h2>/<h3>, real <article>/<section>/<nav> landmarks — plus visible
 * breadcrumbs and their BreadcrumbList JSON-LD. Pages pass additional JSON-LD
 * (Article, FAQ) via `jsonLd`.
 */

export interface RelatedLink {
  href: string;
  label: string;
  description?: string;
}

export function MarketingPageShell({
  eyebrow,
  h1,
  lead,
  breadcrumbs,
  jsonLd = [],
  related,
  cta,
  children,
}: {
  eyebrow: string;
  h1: string;
  lead: React.ReactNode;
  breadcrumbs: BreadcrumbItem[];
  jsonLd?: Record<string, unknown>[];
  related?: { title: string; links: RelatedLink[] };
  cta?: CtaProps;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      <JsonLd data={[breadcrumbSchema(breadcrumbs), ...jsonLd]} />
      <SiteHeader />

      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8">
        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="pt-8">
          <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[11.5px] text-[#9CA3AF]">
            {breadcrumbs.map((b, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <li key={b.path} className="flex items-center gap-1.5">
                  {last ? (
                    <span className="text-[#6B7280]" aria-current="page">{b.name}</span>
                  ) : (
                    <Link href={b.path as Route} className="transition-colors hover:text-[#0B0D0F]">{b.name}</Link>
                  )}
                  {!last && <ChevronRight className="h-3 w-3 text-[#C9CED4]" />}
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Hero */}
        <header className="max-w-[760px] pb-10 pt-6">
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
            <Checkpoint />
            <span className="font-mono text-[11px] font-medium tracking-[0.02em] text-[#006B45]">{eyebrow}</span>
          </span>
          <h1 className="mt-5 text-balance text-[34px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[44px] lg:text-[52px]">{h1}</h1>
          <div className="mt-5 text-[17px] leading-[1.7] text-[#4B5563]">{lead}</div>
        </header>
      </div>

      {/* Article body */}
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-4 sm:px-6 lg:px-8">
        <article className="max-w-[760px]">{children}</article>
      </div>

      {/* Related cluster */}
      {related && related.links.length > 0 && (
        <div className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6 lg:px-8">
          <div className="max-w-[760px]">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{related.title}</p>
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {related.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href as Route} className="group block rounded-[12px] border bg-white p-4 transition-colors hover:border-[#9CCFBB]" style={{ borderColor: "#E0E3E6" }}>
                    <span className="flex items-center justify-between gap-2 text-[14px] font-semibold text-[#0B0D0F]">
                      {l.label}
                      <ArrowRight className="h-4 w-4 shrink-0 text-[#C9CED4] transition-colors group-hover:text-[#007F4E]" />
                    </span>
                    {l.description && <span className="mt-1 block text-[12.5px] leading-[1.55] text-[#6B7280]">{l.description}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {cta && <Cta {...cta} />}
      <SiteFooter />
    </div>
  );
}

// ─── Prose primitives ─────────────────────────────────────────────────────────

export function Section({ id, eyebrow, title, children }: { id?: string; eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t py-8 first:border-t-0 first:pt-0" style={{ borderColor: "#ECEEEF" }}>
      {eyebrow && <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{eyebrow}</p>}
      <h2 className="text-[24px] font-bold leading-[1.15] tracking-[-0.02em] sm:text-[28px]">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-[17px] font-semibold tracking-[-0.01em] text-[#0B0D0F]">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15.5px] leading-[1.75] text-[#374151]">{children}</p>;
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-[17px] leading-[1.7] text-[#4B5563]">{children}</p>;
}

/** Emphasized inline term. */
export function Term({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-[#0B0D0F]">{children}</strong>;
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-[15px] leading-[1.65] text-[#374151]">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#C9CED4]" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function KeyPoints({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-[15px] leading-[1.65] text-[#374151]">
          <Check className="mt-[3px] h-4 w-4 shrink-0 text-[#007F4E]" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function Callout({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border px-4 py-3.5" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
      {title && <p className="flex items-center gap-2 text-[13px] font-semibold text-[#006B45]"><Checkpoint /> {title}</p>}
      <div className={`text-[14px] leading-[1.65] text-[#04543a] ${title ? "mt-1.5" : ""}`}>{children}</div>
    </div>
  );
}

/**
 * WHAT A CLAIM ON THIS PAGE ACTUALLY REQUIRES.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE RULE THIS COMPONENT EXISTS TO ENFORCE
 * ══════════════════════════════════════════════════════════════════════════════
 * A feature behind a default-off flag is not shipped, and a feature only some
 * plans include is not "in the product" for everyone reading. Both are still
 * worth describing — hidden features do not sell — but an unqualified sentence
 * about either is a false claim, and the ones about RELIABILITY are the worst
 * kind, because reliability is precisely what a buyer is evaluating.
 *
 * ── WHY ONE STRIP RATHER THAN QUALIFYING EVERY SENTENCE ─────────────────────
 * These pages mention replay a dozen times between them. Appending "(on Pro and
 * above)" to each would be accurate and unreadable, and unreadable qualifications
 * get skimmed past, which leaves the reader exactly as misinformed as no
 * qualification at all. One strip, in the same place on every page, stating what
 * the page's claims require, is read once and believed.
 *
 * ── IT SAYS WHICH KIND OF UNAVAILABLE ───────────────────────────────────────
 * "Needs a paid plan" and "not switched on in this deployment" look identical in
 * a footnote and are completely different to a buyer: the first is solved with a
 * credit card, the second is not solved at all. `tone` keeps them apart.
 */
export function Availability({
  tone = "plan",
  items,
}: {
  /** `plan` — included on some plans. `flag` — built, shipped dark. */
  tone?: "plan" | "flag";
  items: React.ReactNode[];
}) {
  const flag = tone === "flag";
  return (
    <div
      className="rounded-[12px] border px-4 py-3.5"
      style={
        flag
          ? { borderColor: "#FDE68A", background: "#FFFBEB" }
          : { borderColor: "#E0E3E6", background: "#FAFBFB" }
      }
    >
      <p
        className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: flag ? "#92400E" : "#6B7280" }}
      >
        {flag ? "Built, not switched on" : "What this needs"}
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span
              className="mt-[8px] h-1 w-1 shrink-0 rounded-full"
              style={{ background: flag ? "#D97706" : "#C9CED4" }}
              aria-hidden="true"
            />
            <span className="text-[13.5px] leading-[1.6]" style={{ color: flag ? "#78350F" : "#4B5563" }}>
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Definitional two-column table for comparisons/concepts. */
export function CompareTable({ head, rows }: { head: [string, string, string]; rows: [string, React.ReactNode, React.ReactNode][] }) {
  return (
    <div className="overflow-x-auto rounded-[12px] border" style={{ borderColor: "#E0E3E6" }}>
      <table className="w-full min-w-[520px] border-collapse text-left text-[13.5px]">
        <thead>
          <tr style={{ background: "#FAFBFB" }}>
            {head.map((h, i) => (
              <th key={i} className={`px-4 py-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#6B7280] ${i > 0 ? "border-l" : ""}`} style={{ borderColor: "#ECEEEF" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t align-top" style={{ borderColor: "#ECEEEF" }}>
              <th scope="row" className="px-4 py-3 font-semibold text-[#0B0D0F]">{r[0]}</th>
              <td className="border-l px-4 py-3 leading-[1.55] text-[#374151]" style={{ borderColor: "#ECEEEF" }}>{r[1]}</td>
              <td className="border-l px-4 py-3 leading-[1.55] text-[#374151]" style={{ borderColor: "#ECEEEF" }}>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface FaqEntry { question: string; answer: React.ReactNode }

export function Faq({ items }: { items: FaqEntry[] }) {
  return (
    <dl className="divide-y" style={{ borderColor: "#ECEEEF" }}>
      {items.map((it, i) => (
        <div key={i} className="py-4 first:pt-0">
          <dt className="text-[16px] font-semibold text-[#0B0D0F]">{it.question}</dt>
          <dd className="mt-2 text-[15px] leading-[1.7] text-[#374151]">{it.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

export interface CtaProps {
  title: string;
  body: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export function Cta({ title, body, primaryHref, primaryLabel, secondaryHref, secondaryLabel }: CtaProps) {
  return (
    <section className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#FFFFFF" }}>
      <div className="mx-auto w-full max-w-[1180px] px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
        <h2 className="mx-auto max-w-[20ch] text-[28px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[38px]">{title}</h2>
        <p className="mx-auto mt-4 max-w-[52ch] text-[16px] leading-[1.65] text-[#4B5563]">{body}</p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 min-[420px]:flex-row min-[420px]:items-center">
          <Link href={primaryHref as Route} className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-[#0B0D0F] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
            {primaryLabel} <ArrowRight className="h-4 w-4" />
          </Link>
          {secondaryHref && secondaryLabel && (
            <Link href={secondaryHref as Route} className="inline-flex items-center justify-center gap-2 rounded-[9px] border bg-white px-6 py-3 text-[15px] font-semibold text-[#0B0D0F] transition-colors hover:bg-[#F3F4F5]" style={{ borderColor: "#E0E3E6" }}>
              {secondaryLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
