import type { Metadata } from "next";
import { SITE } from "./constants";

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
