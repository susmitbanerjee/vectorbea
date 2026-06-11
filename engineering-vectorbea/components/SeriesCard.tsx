import Link from "next/link";
import type { Article } from "@/lib/articles";

export function SeriesCard({ title, description, articles }: { title: string; description: string; articles: Article[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-8">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-500">{description}</p>
      <ol className="mt-6 space-y-3">
        {articles.map((a) => (
          <li key={a.slug}>
            <Link
              href={`/articles/${a.slug}`}
              className="group flex items-baseline gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white"
            >
              <span className="text-sm font-semibold text-accent-blue">
                Part {a.frontMatter.part}
              </span>
              <span className="text-sm font-medium text-ink group-hover:text-accent-blue">
                {a.frontMatter.title}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
