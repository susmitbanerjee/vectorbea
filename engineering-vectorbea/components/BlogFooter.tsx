import Image from "next/image";
import Link from "next/link";
import { SITE, NAV_LINKS } from "@/lib/constants";

export function BlogFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-page px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/logo.svg" alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
              <span className="font-display text-sm font-semibold text-ink">{SITE.name}</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-slate-500">{SITE.tagline}</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-ink">Browse</h4>
            <ul className="mt-3 space-y-2">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-slate-500 hover:text-accent-blue">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-ink">Elsewhere</h4>
            <ul className="mt-3 space-y-2">
              <li>
                <a href={SITE.githubUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-accent-blue">
                  GitHub
                </a>
              </li>
              <li>
                <a href={SITE.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-accent-blue">
                  LinkedIn
                </a>
              </li>
              <li>
                <a href={SITE.mainSiteUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-accent-blue">
                  Vectorbea (main site)
                </a>
              </li>
              <li>
                <a href={SITE.rssPath} className="text-sm text-slate-500 hover:text-accent-blue">
                  RSS feed
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-ink">About</h4>
            <p className="mt-3 text-sm text-slate-500">
              Public engineering notes from the team building Vectorbea, a private product.
              Opinions are our own and reflect a small team shipping fast.
            </p>
          </div>
        </div>
        <div className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-400">
          © {new Date().getFullYear()} Vectorbea. Engineering notes published independently of the product roadmap.
        </div>
      </div>
    </footer>
  );
}
