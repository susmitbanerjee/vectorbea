import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllArticles,
  getArticleBySlug,
  getRelatedArticles,
  getAdjacentInSeries,
} from "@/lib/articles";
import { compileContent, extractHeadings } from "@/lib/mdx";
import { TableOfContents } from "@/components/TableOfContents";
import { RelatedArticles } from "@/components/RelatedArticles";
import { ReadingProgressBar } from "@/components/ReadingProgressBar";
import { TagPill } from "@/components/TagPill";
import { buildMetadata } from "@/lib/seo";
import { SITE, SERIES } from "@/lib/constants";

export function generateStaticParams() {
  return getAllArticles().map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const article = getArticleBySlug(params.slug);
  if (!article) return {};
  return buildMetadata({
    title: article.frontMatter.title,
    description: article.frontMatter.description,
    path: `/articles/${article.slug}`,
    type: "article",
    publishedTime: article.frontMatter.date,
    authors: [article.frontMatter.author],
    tags: article.frontMatter.tags,
  });
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const article = getArticleBySlug(params.slug);
  if (!article) notFound();

  const content = await compileContent(article.content);
  const headings = extractHeadings(article.content);
  const related = getRelatedArticles(article);
  const { prev, next } = getAdjacentInSeries(article);
  const seriesInfo = article.frontMatter.series === "building-vectorbea" ? SERIES["building-vectorbea"] : null;

  return (
    <div className="mx-auto max-w-page px-6 py-12">
      <ReadingProgressBar />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-12">
        <article className="mx-auto w-full max-w-article">
          <header>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
              <span className="text-accent-violet">{article.frontMatter.category}</span>
              <span>·</span>
              <span>
                {new Date(article.frontMatter.date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <span>·</span>
              <span>{article.readingTime}</span>
            </div>
            <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-ink md:text-4xl">
              {article.frontMatter.title}
            </h1>
            <p className="mt-3 text-lg leading-relaxed text-slate-500">
              {article.frontMatter.description}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Image
                src="/author.jpg"
                alt={article.frontMatter.author}
                width={36}
                height={36}
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
              <div>
                <p className="text-sm font-medium text-ink">{article.frontMatter.author}</p>
                <p className="text-xs text-slate-400">{SITE.author.title}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {article.frontMatter.tags.map((tag) => (
                <TagPill key={tag} tag={tag} href={`/articles?category=${encodeURIComponent(article.frontMatter.category)}`} />
              ))}
            </div>
          </header>

          {seriesInfo && (
            <div className="mt-8 rounded-xl border border-accent-blue/20 bg-accent-blue/5 px-5 py-4">
              <p className="text-sm font-semibold text-ink">
                {seriesInfo.title} · Part {article.frontMatter.part}
              </p>
              <p className="mt-1 text-sm text-slate-500">{seriesInfo.description}</p>
            </div>
          )}

          <div className="prose prose-slate mt-10 max-w-none prose-headings:scroll-mt-24 prose-headings:font-semibold prose-a:text-accent-blue prose-img:rounded-xl">
            {content}
          </div>

          {(prev || next) && (
            <nav className="mt-16 grid gap-4 border-t border-slate-200 pt-8 sm:grid-cols-2">
              {prev ? (
                <Link href={`/articles/${prev.slug}`} className="rounded-xl border border-slate-200 p-4 transition-colors hover:border-accent-blue/50">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">← Previous</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{prev.frontMatter.title}</p>
                </Link>
              ) : <div />}
              {next ? (
                <Link href={`/articles/${next.slug}`} className="rounded-xl border border-slate-200 p-4 text-right transition-colors hover:border-accent-blue/50">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Next →</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{next.frontMatter.title}</p>
                </Link>
              ) : <div />}
            </nav>
          )}

          <RelatedArticles articles={related} />
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <TableOfContents headings={headings} />
          </div>
        </aside>
      </div>
    </div>
  );
}
