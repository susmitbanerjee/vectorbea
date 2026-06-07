import type { Metadata } from "next";
import { getAllArticles, getAllTags, getAllCategories } from "@/lib/articles";
import { SearchAndFilter } from "@/components/SearchAndFilter";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Articles",
  description: "All engineering articles from Vectorbea Engineering — durable execution, reliability, agentic systems, security, and infrastructure.",
  path: "/articles",
});

export default function ArticlesPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  const articles = getAllArticles();
  const tags = getAllTags();
  const categories = getAllCategories();

  return (
    <div className="mx-auto max-w-page px-6 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Articles</h1>
        <p className="mt-3 text-base text-slate-500">
          Engineering write-ups on durable execution, reliability, agentic systems, security,
          and infrastructure — from the team building Vectorbea.
        </p>
      </div>
      <div className="mt-10">
        <SearchAndFilter
          articles={articles}
          tags={tags}
          categories={categories}
          initialCategory={searchParams.category}
        />
      </div>
    </div>
  );
}
