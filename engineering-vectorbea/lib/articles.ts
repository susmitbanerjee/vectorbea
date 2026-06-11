import { getAllEntries, getEntryBySlug, FrontMatter, ContentEntry } from "./mdx";
import { getReadingTime } from "./reading-time";

export interface Article extends ContentEntry {
  readingTime: string;
}

export function getAllArticles(): Article[] {
  return getAllEntries("articles").map((entry) => ({
    ...entry,
    readingTime: getReadingTime(entry.content),
  }));
}

export function getArticleBySlug(slug: string): Article | null {
  const entry = getEntryBySlug("articles", slug);
  if (!entry) return null;
  return { ...entry, readingTime: getReadingTime(entry.content) };
}

export function getFeaturedArticle(): Article | null {
  const articles = getAllArticles();
  return articles.find((a) => a.frontMatter.featured) ?? articles[0] ?? null;
}

export function getRelatedArticles(current: Article, max = 3): Article[] {
  const all = getAllArticles().filter((a) => a.slug !== current.slug);
  const scored = all.map((a) => {
    const sharedTags = a.frontMatter.tags.filter((t) =>
      current.frontMatter.tags.includes(t)
    ).length;
    const sameCategory = a.frontMatter.category === current.frontMatter.category ? 1 : 0;
    return { article: a, score: sharedTags * 2 + sameCategory };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.article);
}

export function getSeriesArticles(series: string): Article[] {
  return getAllArticles()
    .filter((a) => a.frontMatter.series === series)
    .sort((a, b) => (a.frontMatter.part ?? 0) - (b.frontMatter.part ?? 0));
}

export function getAdjacentInSeries(current: Article): { prev: Article | null; next: Article | null } {
  if (!current.frontMatter.series) return { prev: null, next: null };
  const series = getSeriesArticles(current.frontMatter.series);
  const idx = series.findIndex((a) => a.slug === current.slug);
  return {
    prev: idx > 0 ? series[idx - 1] : null,
    next: idx >= 0 && idx < series.length - 1 ? series[idx + 1] : null,
  };
}

export function getAllTags(): string[] {
  const tagSet = new Set<string>();
  getAllArticles().forEach((a) => a.frontMatter.tags.forEach((t) => tagSet.add(t)));
  return Array.from(tagSet).sort();
}

export function getAllCategories(): string[] {
  const set = new Set<string>();
  getAllArticles().forEach((a) => set.add(a.frontMatter.category));
  return Array.from(set).sort();
}

export type { FrontMatter };
