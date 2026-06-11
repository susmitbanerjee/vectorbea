import type { Article } from "@/lib/articles";
import { ArticleCard } from "./ArticleCard";

export function RelatedArticles({ articles }: { articles: Article[] }) {
  if (articles.length === 0) return null;
  return (
    <section className="mt-16">
      <h2 className="text-lg font-semibold text-ink">Related articles</h2>
      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((a) => (
          <ArticleCard key={a.slug} article={a} />
        ))}
      </div>
    </section>
  );
}
