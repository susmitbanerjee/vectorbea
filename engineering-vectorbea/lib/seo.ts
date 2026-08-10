import type { Metadata } from "next";
import { SITE } from "./constants";

type Json = Record<string, unknown>;

/** Serialize JSON-LD for a <script>, escaping `<` to prevent breakout. */
export function serializeJsonLd(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** BlogPosting schema for an engineering article. dateModified is omitted
 *  unless real — the article front matter carries only a publish date. */
export function blogPostingJsonLd(input: {
  title: string;
  description: string;
  path: string;
  datePublished: string;
  authorName: string;
  tags?: string[];
}): Json {
  const url = `${SITE.url}${input.path}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    description: input.description,
    url,
    mainEntityOfPage: url,
    datePublished: input.datePublished,
    author: { "@type": "Person", name: input.authorName },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      logo: { "@type": "ImageObject", url: `${SITE.url}/logo.svg` },
    },
    ...(input.tags && input.tags.length ? { keywords: input.tags.join(", ") } : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE.url}${it.path}`,
    })),
  };
}

interface BuildMetadataOptions {
  title: string;
  description: string;
  path?: string;
  type?: "website" | "article";
  publishedTime?: string;
  authors?: string[];
  tags?: string[];
}

export function buildMetadata({
  title,
  description,
  path = "/",
  type = "website",
  publishedTime,
  authors,
  tags,
}: BuildMetadataOptions): Metadata {
  const url = `${SITE.url}${path}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE.name,
      type,
      ...(type === "article" && publishedTime ? { publishedTime } : {}),
      ...(type === "article" && authors ? { authors } : {}),
      ...(type === "article" && tags ? { tags } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  } as Metadata;
}
