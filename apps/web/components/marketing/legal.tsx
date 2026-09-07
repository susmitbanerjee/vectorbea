import Link from "next/link";
import type { Route } from "next";
import { SiteHeader, SiteFooter } from "@/components/marketing/site-chrome";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema } from "@/lib/seo";

/**
 * The shell every legal page uses.
 *
 * ── ONE SHELL, SO THE FOUR CANNOT DRIFT ─────────────────────────────────────
 * Terms, privacy, the DPA and the subprocessor list are read together and are
 * incorporated into each other by reference. Four separately built pages is four
 * chances for one of them to carry a different "last updated" date, a different
 * contact address, or a different set of cross-links — and in a document set
 * whose whole purpose is to be relied on, a broken cross-reference is a defect
 * rather than a typo.
 *
 * ── THE DATE IS AUTHORED, NOT `new Date()` ──────────────────────────────────
 * A legal page that stamps today's date on every deploy tells a reader it was
 * reviewed today. It was not. `effective` is passed in and changed by hand when
 * the text changes.
 */

export interface LegalPageProps {
  title: string;
  /** One sentence on what this document is for. */
  intro: string;
  /** ISO date the text last changed. Hand-set. */
  effective: string;
  path: string;
  children: React.ReactNode;
}

const LEGAL_NAV: { href: string; label: string }[] = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/dpa", label: "Data Processing Addendum" },
  { href: "/legal/subprocessors", label: "Subprocessors" },
];

export function LegalPage({ title, intro, effective, path, children }: LegalPageProps) {
  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      <JsonLd
        data={[breadcrumbSchema([
          { name: "Vectorbea", path: "/" },
          { name: "Legal", path: "/legal/terms" },
          { name: title, path },
        ])]}
      />
      <SiteHeader />

      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 pb-16 pt-12 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Legal documents" className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">
              Legal
            </p>
            <ul className="mt-3 space-y-2">
              {LEGAL_NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href as Route}
                    className="text-[13px] transition-colors hover:text-[#0B0D0F]"
                    style={{ color: item.href === path ? "#0B0D0F" : "#6B7280", fontWeight: item.href === path ? 600 : 400 }}
                    aria-current={item.href === path ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <article className="max-w-[76ch]">
            <h1 className="text-[32px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
              {title}
            </h1>
            <p className="mt-4 text-[15.5px] leading-[1.65] text-[#4B5563]">{intro}</p>
            <p className="mt-3 font-mono text-[12px] text-[#9CA3AF]">
              Effective {effective}
            </p>
            <div className="mt-8">{children}</div>
          </article>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

export function LegalSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <section id={id} className="scroll-mt-24 border-t pt-7" style={{ borderColor: "#E0E3E6" }}>
      <h2 className="text-[19px] font-bold tracking-[-0.015em]">
        <span className="mr-2 font-mono text-[13px] font-medium text-[#9CA3AF]">{n}</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function LegalP({ children }: { children: React.ReactNode }) {
  return <p className="text-[14.5px] leading-[1.7] text-[#4B5563]">{children}</p>;
}

export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full" style={{ background: "#C9CED4" }} aria-hidden="true" />
          <span className="text-[14.5px] leading-[1.7] text-[#4B5563]">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A statement the reader should not skim past — a limitation, not a feature. */
export function LegalNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border px-4 py-3" style={{ borderColor: "#FDE68A", background: "#FFFBEB" }}>
      <p className="text-[14px] leading-[1.65]" style={{ color: "#92400E" }}>{children}</p>
    </div>
  );
}
