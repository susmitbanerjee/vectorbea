import type { MetadataRoute } from "next";
import { SITE } from "@/lib/constants";

/**
 * /robots.txt for the engineering blog (engineering.vectorbea.com). The whole
 * blog is public and crawlable; this just points crawlers at the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
