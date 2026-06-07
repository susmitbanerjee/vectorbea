import Link from "next/link";
import {
  getAllArticles,
  getFeaturedArticle,
  getSeriesArticles,
  getAllCategories,
} from "@/lib/articles";
import { FeaturedArticleCard } from "@/components/FeaturedArticleCard";
import { ArticleCard } from "@/components/ArticleCard";
import { CategorySection } from "@/components/CategorySection";
import { SeriesCard } from "@/components/SeriesCard";
import { SITE, SERIES } from "@/lib/constants";

const TIMELINE_EVENTS = [
  { ts: "12:04:01.203", type: "RUN_STARTED", detail: "run_8f2e checkpoint=0" },
  { ts: "12:04:01.812", type: "STEP_COMPLETED", detail: "fetch_ticket → ok (412ms)" },
  { ts: "12:04:02.044", type: "APPROVAL_REQUESTED", detail: "gate=publish_release awaiting human" },
  { ts: "12:04:58.391", type: "APPROVAL_GRANTED", detail: "by=susmit reason='looks good'" },
  { ts: "12:04:58.402", type: "STEP_RETRIED", detail: "deploy_worker attempt=2/5" },
  { ts: "12:05:00.118", type: "RUN_CHECKPOINTED", detail: "checkpoint=4 durable=true" },
];

export default function HomePage() {
  const articles = getAllArticles();
  const featured = getFeaturedArticle();
  const seriesArticles = getSeriesArticles("building-vectorbea");
  const categories = getAllCategories();
  const recent = articles.filter((a) => a.slug !== featured?.slug).slice(0, 6);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-mesh">
        <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto max-w-page px-6 py-20 md:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-1.5 text-xs font-medium text-slate-500 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-blue" />
                Private product. Public engineering notes.
              </span>
              <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-ink md:text-5xl">
                {SITE.tagline}
              </h1>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-500">
                Notes from the team building <strong className="text-ink">Vectorbea</strong> — a
                durable, long-running visual agentic workflow builder. Execution guarantees,
                checkpoints, retries, approvals, BYOK, and worker orchestration, written up as we
                build them.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/articles"
                  className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-blue"
                >
                  Read the articles
                </Link>
                <Link
                  href="/architecture"
                  className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-accent-blue hover:text-accent-blue"
                >
                  Explore the architecture
                </Link>
              </div>
            </div>

            <div className="terminal-card p-5 text-xs leading-relaxed md:text-sm">
              <div className="mb-3 flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-red-400/80" />
                <span className="h-3 w-3 rounded-full bg-yellow-400/80" />
                <span className="h-3 w-3 rounded-full bg-green-400/80" />
                <span className="ml-3 text-slate-400">run_8f2e — event history</span>
              </div>
              <ul className="space-y-1.5">
                {TIMELINE_EVENTS.map((ev) => (
                  <li key={ev.ts} className="flex flex-wrap gap-2">
                    <span className="text-slate-500">{ev.ts}</span>
                    <span className="font-semibold text-accent-blue">{ev.type}</span>
                    <span className="text-slate-300">{ev.detail}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-slate-500">
                <span className="text-accent-violet">$</span> tail -f events.log{" "}
                <span className="animate-pulse">▌</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-page space-y-20 px-6 py-16">
        {/* Featured */}
        {featured && (
          <section>
            <h2 className="mb-5 text-xl font-semibold text-ink">Featured</h2>
            <FeaturedArticleCard article={featured} />
          </section>
        )}

        {/* Series */}
        {seriesArticles.length > 0 && (
          <SeriesCard
            title={SERIES["building-vectorbea"].title}
            description={SERIES["building-vectorbea"].description}
            articles={seriesArticles}
          />
        )}

        {/* Categories */}
        <CategorySection categories={categories} />

        {/* Recent */}
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold text-ink">Recent articles</h2>
            <Link href="/articles" className="text-sm font-medium text-accent-blue hover:underline">
              View all →
            </Link>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((a) => (
              <ArticleCard key={a.slug} article={a} />
            ))}
          </div>
        </section>

        {/* About blurb */}
        <section className="rounded-2xl border border-slate-200 bg-white p-8 md:p-10">
          <h2 className="text-xl font-semibold text-ink">About this project</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-500">
            Vectorbea is a durable, long-running visual agentic workflow builder — it gives teams
            execution guarantees, retry and resume, checkpointing, human approval gates, BYOK LLM
            keys, worker orchestration, full event history, run timelines, cost budgets, and rate
            limits. Vectorbea Engineering is where we write publicly about the decisions, tradeoffs,
            and mistakes behind it. The product is private; these notes are not marketing copy —
            they're the kind of write-up we'd want to read if we were building something similar.
          </p>
          <Link href="/about" className="mt-4 inline-block text-sm font-medium text-accent-blue hover:underline">
            More about this blog and its author →
          </Link>
        </section>
      </div>
    </div>
  );
}
