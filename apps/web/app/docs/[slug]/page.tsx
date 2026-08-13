import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createMetadata } from "@/lib/seo";
import { DocsShell } from "~/components/docs/docs-shell";
import { DOCS_PAGES, getDocsPage } from "~/content/docs/registry";

/**
 * Every docs page except the introduction, which is served at /docs.
 * Statically generated — these are the most-linked, least-personalised URLs in
 * the product, so none of them should cost a render at request time.
 */
export function generateStaticParams() {
  return DOCS_PAGES.filter((p) => p.slug !== "introduction").map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocsPage(slug);
  if (!page) return createMetadata({ title: "Documentation", path: "/docs" });

  return createMetadata({
    title: page.title,
    description: page.description,
    path: `/docs/${page.slug}`,
  });
}

export default async function DocsSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getDocsPage(slug) || slug === "introduction") notFound();
  return <DocsShell slug={slug} />;
}
