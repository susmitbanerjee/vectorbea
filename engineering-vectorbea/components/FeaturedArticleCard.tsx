import Link from "next/link";
import type { Article } from "@/lib/articles";
import { TagPill } from "./TagPill";

export function FeaturedArticleCard({ article }: { article: Article }) {
  const { frontMatter, slug, readingTime } = article;
  return (
    <Link
      href={`/articles/${slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-all hover:border-accent-blue/50 hover:shadow-xl hover:shadow-slate-200/70 md:p-10"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent-blue to-accent-violet" />
      <span className="inline-flex w-fit items-center rounded-full bg-accent-blue/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-blue">
        Featured
      </span>
      <h2 className="mt-4 max-w-2xl text-2xl font-bold leading-tight text-ink group-hover:text-accent-blue md:text-3xl">
        {frontMatter.title}
      </h2>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-500">
        {frontMatter.description}
      </p>
      <div className="mt-5 flex items-center gap-2 text-xs font-medium text-slate-400">
        <span>{frontMatter.author}</span>
        <span>·</span>
        <span>{new Date(frontMatter.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
        <span>·</span>
        <span>{readingTime}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {frontMatter.tags.map((tag) => (
          <TagPill key={tag} tag={tag} />
        ))}
      </div>
    </Link>
  );
}
