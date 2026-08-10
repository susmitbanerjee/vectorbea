import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { LogoCube } from "@/components/marketing/logo";
import { SITE } from "@/lib/seo";
import { USE_CASES, COMPARISONS, getUseCasePath, comparisonPath } from "@/lib/marketing/pages";

/**
 * Shared marketing header + footer for public SEO pages (use cases, compare,
 * etc.). Real crawlable <a>/<Link> navigation — never JS-only click handlers —
 * so the topic clusters are reachable by crawlers and users alike.
 */

const NAV: { href: string; label: string; external?: boolean }[] = [
  { href: "/#product", label: "Product" },
  { href: "/use-cases", label: "Use cases" },
  { href: "/compare", label: "Compare" },
  { href: "/docs", label: "Docs" },
  { href: SITE.blogUrl, label: "Engineering", external: true },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur" style={{ background: "rgba(247,248,249,0.85)", borderBottom: "1px solid #E0E3E6" }}>
      <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <LogoCube />
            <span className="text-[16px] font-semibold tracking-[-0.01em] text-[#0B0D0F]">Vectorbea</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) =>
              item.external ? (
                <a key={item.label} href={item.href} className="rounded-[7px] px-3 py-1.5 text-[13.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">
                  {item.label}
                </a>
              ) : (
                <Link key={item.label} href={item.href as Route} className="rounded-[7px] px-3 py-1.5 text-[13.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/signin" className="hidden text-[13.5px] font-medium text-[#4B5563] transition-colors hover:text-[#0B0D0F] sm:inline">Sign in</Link>
          <Link href="/signup" className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-3 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#1c1f22] sm:px-4">
            Start free <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{title}</p>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}
function FooterLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  return (
    <li>
      {external ? (
        <a href={href} className="text-[13px] text-[#6B7280] transition-colors hover:text-[#0B0D0F]">{children}</a>
      ) : (
        <Link href={href as Route} className="text-[13px] text-[#6B7280] transition-colors hover:text-[#0B0D0F]">{children}</Link>
      )}
    </li>
  );
}

export function SiteFooter() {
  return (
    <footer className="w-full border-t" style={{ borderColor: "#E0E3E6", background: "#F7F8F9" }}>
      <div className="mx-auto w-full max-w-[1180px] px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <LogoCube size={22} />
              <span className="text-[14px] font-semibold text-[#0B0D0F]">Vectorbea</span>
            </div>
            <p className="mt-3 max-w-[26ch] text-[12.5px] leading-[1.6] text-[#9CA3AF]">
              Durable execution for long-running, agentic AI workflows.
            </p>
          </div>

          <FooterCol title="Product">
            <FooterLink href="/">Overview</FooterLink>
            <FooterLink href="/docs">Documentation</FooterLink>
            <FooterLink href="/use-cases">Use cases</FooterLink>
            <FooterLink href="/compare">Compare</FooterLink>
          </FooterCol>

          <FooterCol title="Use cases">
            {USE_CASES.slice(0, 4).map((p) => (
              <FooterLink key={p.slug} href={getUseCasePath(p.slug)}>{p.navLabel}</FooterLink>
            ))}
          </FooterCol>

          <FooterCol title="Compare">
            {COMPARISONS.map((p) => (
              <FooterLink key={p.slug} href={comparisonPath(p.slug)}>{p.navLabel}</FooterLink>
            ))}
          </FooterCol>

          <FooterCol title="Resources">
            <FooterLink href={SITE.blogUrl} external>Engineering blog</FooterLink>
            <FooterLink href={SITE.githubUrl} external>GitHub</FooterLink>
            <FooterLink href="/docs">Concepts</FooterLink>
          </FooterCol>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t pt-6 text-center sm:flex-row sm:text-left" style={{ borderColor: "#E0E3E6" }}>
          <p className="font-mono text-[12px] text-[#9CA3AF]">Durable agentic automation. Built for production.</p>
          <div className="flex items-center gap-6">
            <span className="text-[13px] text-[#9CA3AF]">© {new Date().getFullYear()} Vectorbea</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
