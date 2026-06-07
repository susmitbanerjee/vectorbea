"use client";

import { useMemo, useState } from "react";
import type { Article } from "@/lib/articles";
import { ArticleCard } from "./ArticleCard";

export function SearchAndFilter({
  articles,
  tags,
  categories,
  initialCategory,
}: {
  articles: Article[];
  tags: string[];
  categories: string[];
  initialCategory?: string;
}) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(initialCategory ?? null);

  const filtered = useMemo(() => {
    return articles.filter((a) => {
      const matchesQuery =
        query.trim() === "" ||
        a.frontMatter.title.toLowerCase().includes(query.toLowerCase()) ||
        a.frontMatter.description.toLowerCase().includes(query.toLowerCase());
      const matchesTag = !tag || a.frontMatter.tags.includes(tag);
      const matchesCategory = !category || a.frontMatter.category === category;
      return matchesQuery && matchesTag && matchesCategory;
    });
  }, [articles, query, tag, category]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search articles…"
          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={category ?? ""}
            onChange={(e) => setCategory(e.target.value || null)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 focus:border-accent-blue focus:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={tag ?? ""}
            onChange={(e) => setTag(e.target.value || null)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 focus:border-accent-blue focus:outline-none"
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-400">
        {filtered.length} article{filtered.length === 1 ? "" : "s"}
      </p>

      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((a) => (
          <ArticleCard key={a.slug} article={a} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-slate-400">
          No articles match your filters.
        </p>
      )}
    </div>
  );
}
