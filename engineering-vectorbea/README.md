# Engineering Vectorbea

Public engineering blog for **Vectorbea Engineering** (`engineering.vectorbea.com`) — built with
Next.js 14 (App Router), TypeScript, Tailwind CSS, and MDX.

This is a standalone project, separate from the main Vectorbea SaaS app (`apps/`).

## Stack

- Next.js 14 App Router + TypeScript
- Tailwind CSS + `@tailwindcss/typography`
- MDX via `next-mdx-remote/rsc`, `gray-matter` for frontmatter
- Syntax highlighting via `rehype-pretty-code` (Shiki)
- `remark-gfm`, `rehype-slug`, `rehype-autolink-headings`
- Mermaid diagrams rendered client-side from fenced ` ```mermaid ` blocks

## Getting started

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

## Project structure

```
app/                 routes (homepage, articles, architecture, rfcs, experiments, about, rss, sitemap)
components/          shared UI + MDX components
content/articles/    MDX articles (frontmatter: title, description, date, author, tags, category, series, part, featured)
content/rfcs/        MDX RFC documents
content/experiments/ MDX experiment write-ups
lib/                 content loading (mdx.ts, articles.ts), SEO helpers, constants
```

## Adding an article

1. Create a new `.mdx` file in `content/articles/`, e.g. `my-new-post.mdx`.
2. Add frontmatter:

   ```yaml
   ---
   title: "My New Post"
   description: "One-sentence summary for cards and SEO."
   date: "2026-05-01"
   author: "Susmit Banerjee"
   tags: ["reliability", "workers"]
   category: "Reliability"
   series: "building-vectorbea"   # optional
   part: 11                        # optional, only with series
   featured: false
   ---
   ```

3. Write the body in MDX. Use `<Callout type="decision" title="...">...</Callout>` (types:
   `decision`, `tradeoff`, `note`, `warning`, `lesson`) for highlighted asides, and fenced
   ` ```mermaid ` blocks for diagrams.
4. The article is automatically picked up by the articles list, homepage, RSS feed, and sitemap.

RFCs and experiments work the same way under `content/rfcs/` and `content/experiments/`
(category should be `"RFC"` or `"Experiment"` respectively).

## Build

```bash
npm run build
npm run start
```

## Notes

- This blog is intentionally simple — static generation of all content at build time, no CMS,
  no database. Content lives in the repo as MDX.
- Branding, copy, and all article content describe Vectorbea's engineering decisions in
  general terms; no production secrets or implementation internals are included.
