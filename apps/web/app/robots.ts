import type { MetadataRoute } from "next";
import { SITE, absoluteUrl } from "@/lib/seo";

/**
 * /robots.txt
 *
 * Public marketing, product, use-case, compare and docs pages are crawlable.
 * The authenticated application and auth/utility routes are disallowed so they
 * don't surface in search. This is a crawl hint only — real access control is
 * enforced by authentication in the (app) layout, never by robots.txt.
 */

// Prefixes for the authenticated SaaS app + auth/utility flows. Kept in sync
// with the (app) route group and the standalone auth pages.
const PRIVATE_PREFIXES = [
  "/api/",
  "/dashboard",
  "/workflows",
  "/runs",
  "/agents",
  "/agent-jobs",
  "/agent-runs",
  "/connections",
  "/settings",
  "/approvals",
  "/schedules",
  "/tools",
  "/integrations",
  "/templates",
  "/workers",
  "/alerts",
  "/release-gates",
  "/artifacts",
  "/audit-logs",
  "/api-keys",
  "/onboarding",
  "/support",
  "/admin",
  "/signin",
  "/signup",
  "/login",
  "/verify-email",
  "/beta",
  "/auth",
  "/book-demo",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PREFIXES,
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE.url,
  };
}
