/**
 * SEO foundation tests: metadata helper, robots rules, sitemap contents and
 * JSON-LD builders. Pure functions — no DB, no Next runtime.
 */
import {
  SITE, absoluteUrl, createMetadata,
  organizationSchema, websiteSchema, softwareApplicationSchema,
  breadcrumbSchema, articleSchema, faqSchema, serializeJsonLd,
} from "../lib/seo";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { USE_CASES, COMPARISONS, getUseCasePath, comparisonPath } from "../lib/marketing/pages";

describe("createMetadata", () => {
  it("builds a canonical, OG and indexable robots for a public page", () => {
    const m = createMetadata({ title: "Durable AI Workflows", description: "d", path: "/use-cases/durable-ai-workflows" });
    expect(m.title).toBe("Durable AI Workflows");
    expect(m.alternates?.canonical).toBe("https://vectorbea.com/use-cases/durable-ai-workflows");
    expect((m.openGraph as { url?: string }).url).toBe("https://vectorbea.com/use-cases/durable-ai-workflows");
    expect((m.openGraph as { siteName?: string }).siteName).toBe("Vectorbea");
    expect((m.twitter as { card?: string }).card).toBe("summary_large_image");
    expect(m.robots).toMatchObject({ index: true, follow: true });
  });

  it("supports an absolute (untemplated) title for the homepage", () => {
    const m = createMetadata({ title: SITE.defaultTitle, titleAbsolute: true, path: "/" });
    expect(m.title).toEqual({ absolute: SITE.defaultTitle });
    expect(m.alternates?.canonical).toBe("https://vectorbea.com");
  });

  it("emits noindex when asked", () => {
    const m = createMetadata({ title: "Private", path: "/x", noIndex: true });
    expect(m.robots).toMatchObject({ index: false, follow: false });
  });
});

describe("absoluteUrl", () => {
  it("prefixes the production origin and normalizes slashes", () => {
    expect(absoluteUrl("/")).toBe("https://vectorbea.com");
    expect(absoluteUrl("/use-cases")).toBe("https://vectorbea.com/use-cases");
    expect(absoluteUrl("/use-cases/")).toBe("https://vectorbea.com/use-cases");
  });
  it("passes through absolute URLs", () => {
    expect(absoluteUrl("https://engineering.vectorbea.com")).toBe("https://engineering.vectorbea.com");
  });
});

describe("robots.txt", () => {
  const r = robots();

  it("allows crawling and points at the sitemap", () => {
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    expect(r.sitemap).toBe("https://vectorbea.com/sitemap.xml");
  });

  it("disallows the private app + auth surfaces", () => {
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    const disallow = rule.disallow as string[];
    for (const p of ["/dashboard", "/settings", "/support", "/admin", "/signin", "/api/"]) {
      expect(disallow).toContain(p);
    }
  });

  it("never blocks the whole site", () => {
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    // allow is "/", and disallow is a list of prefixes — not a bare "/".
    expect(rule.allow).toBe("/");
    expect(rule.disallow).not.toBe("/");
    expect(rule.disallow).not.toEqual(["/"]);
  });
});

describe("sitemap.xml", () => {
  const entries = sitemap();
  const urls = entries.map((e) => e.url);

  it("includes core public pages", () => {
    for (const p of ["/", "/use-cases", "/compare", "/docs"]) {
      expect(urls).toContain(absoluteUrl(p));
    }
  });

  it("includes every use-case and comparison page", () => {
    for (const uc of USE_CASES) expect(urls).toContain(absoluteUrl(getUseCasePath(uc.slug)));
    for (const c of COMPARISONS) expect(urls).toContain(absoluteUrl(comparisonPath(c.slug)));
  });

  it("excludes private, auth and API routes", () => {
    const joined = urls.join("\n");
    for (const bad of ["/dashboard", "/signin", "/signup", "/support", "/admin", "/api/", "/settings", "/beta"]) {
      expect(joined).not.toContain(bad);
    }
  });

  it("uses stable authored lastModified dates, not per-deploy timestamps", () => {
    // Date-only strings (YYYY-MM-DD), never full `new Date()` ISO timestamps.
    for (const e of entries) {
      expect(String(e.lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Deterministic across calls — the same input always yields the same dates.
    const again = sitemap().map((e) => String(e.lastModified));
    expect(entries.map((e) => String(e.lastModified))).toEqual(again);
  });
});

describe("structured data", () => {
  it("produces valid, typed JSON-LD objects", () => {
    expect(organizationSchema()["@type"]).toBe("Organization");
    expect(websiteSchema()["@type"]).toBe("WebSite");
    expect(softwareApplicationSchema()["@type"]).toBe("SoftwareApplication");

    const crumbs = breadcrumbSchema([{ name: "Vectorbea", path: "/" }, { name: "Use Cases", path: "/use-cases" }]);
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect((crumbs.itemListElement as unknown[]).length).toBe(2);

    const article = articleSchema({ headline: "H", description: "d", path: "/use-cases/x", dateModified: "2026-08-10" });
    expect(article["@type"]).toBe("Article");
    expect(article.url).toBe("https://vectorbea.com/use-cases/x");

    const faq = faqSchema([{ question: "q?", answer: "a" }]);
    expect(faq["@type"]).toBe("FAQPage");
  });

  it("serializes JSON-LD with `<` escaped (XSS-safe) and valid JSON", () => {
    const s = serializeJsonLd({ x: "</script><b>hi</b>" });
    expect(s).not.toContain("</script>");
    expect(s).toContain("\\u003c");
    expect(() => JSON.parse(s)).not.toThrow();
  });
});

describe("content registry (no doorway/duplicate pages)", () => {
  const all = [...USE_CASES, ...COMPARISONS];

  it("has unique slugs, titles and descriptions", () => {
    const slugs = all.map((p) => p.slug);
    const titles = all.map((p) => p.title);
    const descriptions = all.map((p) => p.description);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("gives every page a substantive description", () => {
    for (const p of all) expect(p.description.length).toBeGreaterThan(60);
  });
});
