import type { Metadata } from "next";

/**
 * Central SEO configuration and helpers for the Vectorbea marketing/product
 * site (vectorbea.com). The engineering blog is a separate deployment
 * (engineering.vectorbea.com) with its own SEO config — do not duplicate it.
 *
 * Everything crawler-facing (titles, descriptions, canonicals, OpenGraph,
 * Twitter, robots, JSON-LD) flows through here so pages stay consistent and
 * free of copy-pasted metadata.
 */

const PROD_URL = "https://vectorbea.com";

// Canonical/OG URLs must always point at the production HTTPS origin, even in
// preview/dev — otherwise search engines could canonicalize to a preview host.
// NEXT_PUBLIC_SITE_URL lets a self-hosted fork override the domain.
const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || PROD_URL;

export const SITE = {
  name: "Vectorbea",
  /** Used as the <title> on the homepage and as the OG/Twitter site name. */
  // A hyphen, not an em dash, matching `titleTemplate` below. A tab strip
  // renders the two at very different weights, so mixing them made the
  // homepage tab look like it belonged to a different site.
  defaultTitle: "Vectorbea - Durable Agentic AI Workflows",
  /**
   * Applied to every other page: "<Page> - Vectorbea".
   *
   * A hyphen, not a pipe. It is what Gmail, Google Docs and most of the tools
   * this sits beside in a tab strip use, and at the ~15 characters a favicon-
   * width tab actually shows, a pipe reads as part of the page name while a
   * hyphen reads as a separator.
   */
  titleTemplate: "%s - Vectorbea",
  tagline: "Durable execution for AI agents",
  description:
    "Build and run durable, long-running AI agent workflows — with checkpoints, automatic retries, human approvals, live observability and resume-from-failure recovery.",
  url: rawSiteUrl.replace(/\/$/, ""),
  /** File-based OG image lives at app/opengraph-image.tsx and is auto-attached. */
  ogImagePath: "/opengraph-image",
  githubUrl: "https://github.com/vectorbea",
  linkedinUrl: "https://www.linkedin.com/company/vectorbea",
  /** Separate deployment — the engineering blog. */
  blogUrl: "https://engineering.vectorbea.com",
  organizationName: "Vectorbea",
} as const;

/** Absolute URL for a site-relative path, collapsing duplicate slashes. */
export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//i.test(path)) return path;
  const clean = `/${path}`.replace(/\/{2,}/g, "/");
  // Preserve the trailing slash only for the root.
  const normalized = clean !== "/" ? clean.replace(/\/$/, "") : "/";
  return `${SITE.url}${normalized === "/" ? "" : normalized}` || SITE.url;
}

export interface CreateMetadataInput {
  /** Page topic, e.g. "Durable AI Workflows". Runs through the title template. */
  title: string;
  description?: string;
  /** Site-relative canonical path, e.g. "/use-cases/durable-ai-workflows". */
  path: string;
  /** When true, sets the exact <title> without the "- Vectorbea" template. */
  titleAbsolute?: boolean;
  /** Override the default OG image (site-relative or absolute). */
  image?: string;
  /** Private/utility pages: emit noindex,nofollow. */
  noIndex?: boolean;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
  tags?: string[];
}

/**
 * Produce a complete, consistent Next.js Metadata object: canonical URL,
 * OpenGraph, Twitter card and robots directives. The site-wide OG image
 * (app/opengraph-image.tsx) is attached automatically unless `image` overrides.
 */
export function createMetadata(input: CreateMetadataInput): Metadata {
  const {
    title, description = SITE.description, path, titleAbsolute = false,
    image, noIndex = false, type = "website",
    publishedTime, modifiedTime, authors, tags,
  } = input;

  const canonical = absoluteUrl(path);
  // metadataBase (set in the root layout) resolves this relative path to an
  // absolute URL. Referenced explicitly so it's attached even on pages that
  // define their own openGraph object.
  const ogImage = image ?? SITE.ogImagePath;

  const metadata: Metadata = {
    title: titleAbsolute ? { absolute: title } : title,
    description,
    alternates: { canonical },
    openGraph: {
      type,
      url: canonical,
      title,
      description,
      siteName: SITE.name,
      images: [{ url: ogImage, width: 1200, height: 630, alt: SITE.defaultTitle }],
      ...(type === "article"
        ? {
            ...(publishedTime ? { publishedTime } : {}),
            ...(modifiedTime ? { modifiedTime } : {}),
            ...(authors ? { authors } : {}),
            ...(tags ? { tags } : {}),
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    robots: noIndex
      ? { index: false, follow: false, googleBot: { index: false, follow: false } }
      : { index: true, follow: true },
  };

  return metadata;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD structured data builders
//
// Only describe things that visibly exist on the corresponding page. Each
// builder returns a plain object; render it with <JsonLd data={...} />, which
// serializes safely.
// ─────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

export function organizationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.organizationName,
    url: SITE.url,
    description: SITE.description,
    logo: absoluteUrl("/icon.svg"),
    sameAs: [SITE.githubUrl, SITE.linkedinUrl, SITE.blogUrl],
  };
}

export function websiteSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
  };
}

/**
 * SoftwareApplication for the Vectorbea platform. `offers` is intentionally
 * omitted — do not assert pricing we cannot substantiate here.
 */
export function softwareApplicationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    url: SITE.url,
    description: SITE.description,
    featureList: [
      "Durable execution with per-node checkpoints",
      "Automatic retries with backoff",
      "Resume from the last checkpoint after failure",
      "Human approval gates",
      "Immutable, replayable event history",
      "Token and cost observability",
      "Bring-your-own model keys (OpenAI, Anthropic, Gemini)",
    ],
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbSchema(items: BreadcrumbItem[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export interface ArticleSchemaInput {
  headline: string;
  description: string;
  path: string;
  datePublished?: string;
  dateModified?: string;
  authorName?: string;
}

export function articleSchema(input: ArticleSchemaInput): Json {
  const { headline, description, path, datePublished, dateModified, authorName } = input;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    url: absoluteUrl(path),
    mainEntityOfPage: absoluteUrl(path),
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...(authorName ? { author: { "@type": "Person", name: authorName } } : {}),
    publisher: {
      "@type": "Organization",
      name: SITE.organizationName,
      logo: { "@type": "ImageObject", url: absoluteUrl("/icon.svg") },
    },
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqSchema(items: FaqItem[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/** Serialize JSON-LD for embedding in a <script>, escaping `<` to block XSS. */
export function serializeJsonLd(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
