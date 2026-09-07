import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { USE_CASES, COMPARISONS, getUseCasePath, comparisonPath } from "@/lib/marketing/pages";
import { DOCS_PAGES, docsPath } from "~/content/docs/registry";

/**
 * /sitemap.xml — every valuable, indexable public URL on vectorbea.com.
 *
 * Excludes the authenticated app, auth flows, support/admin and API routes.
 * The engineering blog is a separate deployment (engineering.vectorbea.com)
 * and ships its own sitemap, so its articles are not listed here.
 *
 * `lastModified` comes from hand-set authored dates in the page registry, not
 * `new Date()`, so freshness signals stay honest across deploys.
 */

// Stable authored date for the hand-maintained top-level pages.
const CORE_LAST_MODIFIED = "2026-08-10";

// The docs were rebuilt wholesale in P09; every page is new as of this date.
const DOCS_LAST_MODIFIED = "2026-08-12";

// The pricing page and the legal set were written together, from the plan
// records and from the code respectively.
const LEGAL_LAST_MODIFIED = "2026-09-07";

export default function sitemap(): MetadataRoute.Sitemap {
  const core: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: CORE_LAST_MODIFIED, changeFrequency: "weekly", priority: 1.0 },
    { url: absoluteUrl("/use-cases"), lastModified: CORE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/compare"), lastModified: CORE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.6 },
    /* Pricing is a high-intent page and belongs near the top. Its own date is
       LEGAL_LAST_MODIFIED's sibling — bumped when the plan grid changes, which
       the consistency test makes impossible to do silently. */
    { url: absoluteUrl("/pricing"), lastModified: LEGAL_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.9 },
  ];

  /**
   * The legal set. Indexable on purpose: a procurement reviewer looking for a
   * DPA searches for one, and a document they cannot find is a document that
   * does not exist for the purpose it was written for.
   */
  const legal: MetadataRoute.Sitemap = [
    "/legal/terms", "/legal/privacy", "/legal/dpa", "/legal/subprocessors",
  ].map((path) => ({
    url: absoluteUrl(path),
    lastModified: LEGAL_LAST_MODIFIED,
    changeFrequency: "yearly" as const,
    priority: 0.3,
  }));

  /**
   * Every docs page, driven off the registry so a new page is indexable the
   * moment it is added rather than whenever someone remembers this file.
   * /docs itself carries the higher priority as the section entry point.
   */
  const docs: MetadataRoute.Sitemap = DOCS_PAGES.map((p) => ({
    url: absoluteUrl(docsPath(p.slug)),
    lastModified: DOCS_LAST_MODIFIED,
    changeFrequency: "weekly",
    priority: p.slug === "introduction" ? 0.7 : 0.6,
  }));

  const useCases: MetadataRoute.Sitemap = USE_CASES.map((p) => ({
    url: absoluteUrl(getUseCasePath(p.slug)),
    lastModified: p.lastModified,
    changeFrequency: "monthly",
    priority: 0.9,
  }));

  const comparisons: MetadataRoute.Sitemap = COMPARISONS.map((p) => ({
    url: absoluteUrl(comparisonPath(p.slug)),
    lastModified: p.lastModified,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...core, ...useCases, ...comparisons, ...docs, ...legal];
}
