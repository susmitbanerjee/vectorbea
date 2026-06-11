import type { MetadataRoute } from "next";
import { getAllArticles } from "@/lib/articles";
import { getAllEntries } from "@/lib/mdx";
import { SITE } from "@/lib/constants";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/articles",
    "/architecture",
    "/rfcs",
    "/experiments",
    "/about",
  ].map((path) => ({
    url: `${SITE.url}${path}`,
    lastModified: new Date(),
  }));

  const articleRoutes = getAllArticles().map((a) => ({
    url: `${SITE.url}/articles/${a.slug}`,
    lastModified: new Date(a.frontMatter.date),
  }));

  const rfcRoutes = getAllEntries("rfcs").map((r) => ({
    url: `${SITE.url}/rfcs/${r.slug}`,
    lastModified: new Date(r.frontMatter.date),
  }));

  const experimentRoutes = getAllEntries("experiments").map((e) => ({
    url: `${SITE.url}/experiments/${e.slug}`,
    lastModified: new Date(e.frontMatter.date),
  }));

  return [...staticRoutes, ...articleRoutes, ...rfcRoutes, ...experimentRoutes];
}
