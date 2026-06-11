import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllEntries, getEntryBySlug, compileContent } from "@/lib/mdx";
import { buildMetadata } from "@/lib/seo";
import { TagPill } from "@/components/TagPill";

export function generateStaticParams() {
  return getAllEntries("experiments").map((e) => ({ slug: e.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const entry = getEntryBySlug("experiments", params.slug);
  if (!entry) return {};
  return buildMetadata({
    title: entry.frontMatter.title,
    description: entry.frontMatter.description,
    path: `/experiments/${entry.slug}`,
    type: "article",
    publishedTime: entry.frontMatter.date,
    authors: [entry.frontMatter.author],
    tags: entry.frontMatter.tags,
  });
}

export default async function ExperimentPage({ params }: { params: { slug: string } }) {
  const entry = getEntryBySlug("experiments", params.slug);
  if (!entry) notFound();
  const content = await compileContent(entry.content);

  return (
    <div className="mx-auto max-w-article px-6 py-16">
      <p className="text-xs font-medium text-accent-violet">{entry.frontMatter.category}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink md:text-4xl">{entry.frontMatter.title}</h1>
      <p className="mt-3 text-base leading-relaxed text-slate-500">{entry.frontMatter.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>{entry.frontMatter.author}</span>
        <span>·</span>
        <span>{new Date(entry.frontMatter.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {entry.frontMatter.tags.map((t) => <TagPill key={t} tag={t} />)}
      </div>
      <div className="prose prose-slate mt-10 max-w-none prose-headings:font-semibold prose-a:text-accent-blue">
        {content}
      </div>
    </div>
  );
}
