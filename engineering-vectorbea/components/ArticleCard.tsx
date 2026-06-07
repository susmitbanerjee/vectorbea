import Link from "next/link";
import type { Article } from "@/lib/articles";
import { TagPill } from "./TagPill";

export function ArticleCard({ article }: { article: Article }) {
  const { frontMatter, slug, readingTime } = article;
  return (
    <Link
      href={`/articles/${slug}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-accent-blue/50 hover:shadow-lg hover:shadow-slate-200/60"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
        <span>{new Date(frontMatter.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
        <span>·</span>
        <span>{readingTime}</span>
        <span>·</span>
        <span className="text-accent-violet">{frontMatter.category}</span>
      </div>
      <h3 className="mt-3 text-lg font-semibold leading-snug text-ink group-hover:text-accent-blue">
        {frontMatter.title}
      </h3>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-500">
        {frontMatter.description}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {frontMatter.tags.slice(0, 3).map((tag) => (
          <TagPill key={tag} tag={tag} />
        ))}
      </div>
    </Link>
  );
}
