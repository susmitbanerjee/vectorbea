import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { USE_CASES, COMPARISONS, getUseCasePath, comparisonPath } from "@/lib/marketing/pages";

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

export default function sitemap(): MetadataRoute.Sitemap {
  const core: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: CORE_LAST_MODIFIED, changeFrequency: "weekly", priority: 1.0 },
    { url: absoluteUrl("/use-cases"), lastModified: CORE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/compare"), lastModified: CORE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/docs"), lastModified: CORE_LAST_MODIFIED, changeFrequency: "weekly", priority: 0.7 },
  ];

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

  return [...core, ...useCases, ...comparisons];
}
