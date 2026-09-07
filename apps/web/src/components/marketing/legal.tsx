"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Wordmark } from "~/components/app/shell/wordmark";
import { MarketingNavCta } from "./session-cta";

/* ══════════════════════════════════════════════════════════════════════════════
   THE SHELL EVERY LEGAL PAGE USES.

   ── WHY THIS MOVED OUT OF components/marketing ──────────────────────────────
   The first version of these pages wrapped `SiteHeader`/`SiteFooter` from the
   LEGACY marketing chrome — raw hex, Lucide icons, its own light palette. That
   chrome belongs to `home-content.tsx`, which nothing renders any more. So
   clicking "DPA" in the landing page's footer walked a reader out of the current
   design and into the previous one, mid-sentence.

   For most pages that is a visual inconsistency. For these four it is worse: a
   Terms page that does not look like the product it governs reads as a template
   somebody pasted in, which is exactly the impression a document whose entire
   value is that it can be relied on cannot afford.

   So this lives in `src/` on the token layer, uses the same `Wordmark` and
   `MarketingNavCta` the landing page uses, and pins `light` the same way — the
   reader crosses no boundary.

   ── ONE SHELL, SO THE FOUR CANNOT DRIFT ─────────────────────────────────────
   Terms, privacy, the DPA and the subprocessor list are read together and are
   incorporated into each other by reference. Four separately built pages is four
   chances for one to carry a different effective date, a different contact
   address, or a broken cross-link — and in a document set meant to be relied on,
   a broken cross-reference is a defect rather than a typo.

   ── THE DATE IS AUTHORED, NOT `new Date()` ──────────────────────────────────
   A legal page that stamps today's date on every deploy tells a reader it was
   reviewed today. It was not. `effective` is passed in and changed by hand when
   the text changes.
══════════════════════════════════════════════════════════════════════════════ */

const LEGAL_NAV: { href: string; label: string }[] = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/dpa", label: "Data Processing Addendum" },
  { href: "/legal/subprocessors", label: "Subprocessors" },
];

export interface LegalPageProps {
  title: string;
  /** One sentence on what this document is for. */
  intro: string;
  /** ISO-ish date the text last changed. Hand-set. */
  effective: string;
  path: string;
  children: React.ReactNode;
}

export function LegalPage({ title, intro, effective, path, children }: LegalPageProps) {
  return (
    /* `light` pins these to the light theme regardless of the visitor's product
       preference, exactly as the landing page does — the two are read in one
       session and must not disagree about which theme the marketing site is. */
    <div className="light bg-surface-base text-fg-primary font-ui min-h-dvh">
      <header className="border-subtle border-b">
        <nav className="mx-auto flex w-full max-w-(--container-marketing) items-center gap-6 px-5 py-5 sm:px-8">
          <Link href={"/" as never} className="rounded-sm outline-none focus-visible:focus-ring">
            <Wordmark />
          </Link>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link
              href={"/docs" as never}
              className="font-ui text-body-sm text-fg-secondary hover:text-fg-primary rounded-sm px-2 py-1 transition-colors duration-fast outline-none focus-visible:focus-ring"
            >
              Docs
            </Link>
            <MarketingNavCta />
          </div>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-(--container-marketing) px-5 py-12 sm:px-8 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="Legal documents" className="lg:sticky lg:top-8 lg:self-start">
            <Text variant="eyebrow" tone="muted" className="mb-3 block">Legal</Text>
            <ul className="grid gap-2">
              {LEGAL_NAV.map((item) => {
                const current = item.href === path;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href as never}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "font-ui text-body-sm rounded-sm transition-colors duration-fast outline-none focus-visible:focus-ring",
                        current ? "text-fg-primary" : "text-fg-muted hover:text-fg-secondary",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* 76ch, for the same reason the docs measure is 68: a legal document
              set at the full width of a 1920px monitor is one nobody finishes. */}
          <article className="max-w-[76ch]">
            <Text variant="display-md" tone="max" as="h1" className="text-balance block">
              {title}
            </Text>
            <Text variant="body-lg" tone="secondary" className="mt-4 block">{intro}</Text>
            <Text variant="caption" tone="muted" className="mt-3 block tabular">
              Effective {effective}
            </Text>
            <div className="mt-10 grid gap-8">{children}</div>
          </article>
        </div>
      </div>

      <footer className="border-subtle bg-surface-base border-t">
        <div className="mx-auto flex w-full max-w-(--container-marketing) flex-wrap items-center gap-4 px-5 py-8 sm:px-8">
          <Wordmark />
          <Text variant="caption" tone="muted" className="ml-auto">
            © {new Date().getFullYear()} Vectorbea
          </Text>
          <nav className="flex flex-wrap gap-4">
            {LEGAL_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href as never}
                className="font-ui text-caption text-fg-muted hover:text-fg-primary rounded-sm transition-colors duration-fast outline-none focus-visible:focus-ring"
              >
                {item.label.replace(" of Service", "").replace(" Policy", "").replace("Data Processing Addendum", "DPA")}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({
  n, title, children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <section id={id} className="border-subtle scroll-mt-8 border-t pt-7">
      <Text variant="heading-sm" tone="max" as="h2" className="block">
        <span className="font-code text-fg-muted mr-2 tabular">{n}</span>
        {title}
      </Text>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

export function LegalP({ children }: { children: React.ReactNode }) {
  return <Text variant="body-sm" tone="secondary" className="block leading-relaxed">{children}</Text>;
}

export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="bg-border-strong mt-2 size-1 shrink-0 rounded-full" aria-hidden="true" />
          <Text variant="body-sm" tone="secondary" className="leading-relaxed">{item}</Text>
        </li>
      ))}
    </ul>
  );
}

/**
 * A statement the reader should not skim past — a limitation, not a feature.
 *
 * Ember, which is the same tone the product uses for "stopped, and you need to
 * know why". Reusing it here is deliberate: these boxes say what we do NOT
 * offer, and they should read as the same kind of interruption.
 */
export function LegalNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-status-waiting-border bg-status-waiting-subtle rounded-md border px-4 py-3">
      <Text variant="body-sm" tone="inherit" className="text-status-waiting block leading-relaxed">
        {children}
      </Text>
    </div>
  );
}
