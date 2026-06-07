import Link from "next/link";
import { NAV_LINKS, SITE } from "@/lib/constants";

export function BlogHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-page items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-blue to-accent-violet text-sm font-bold text-white">
            V
          </span>
          <span className="text-base font-semibold tracking-tight text-ink">
            {SITE.name}
          </span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-accent-blue"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <a
          href={SITE.mainSiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden rounded-full border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-accent-blue hover:text-accent-blue sm:inline-block"
        >
          Main site →
        </a>
      </div>
    </header>
  );
}
