import Link from "next/link";

const CATEGORY_BLURBS: Record<string, string> = {
  "Execution Engine": "Checkpoints, retries, replay, and the core run model.",
  "Reliability": "Idempotency, retries, resume, and failure handling.",
  "Agentic Systems": "Approval gates, self-correction, and human-in-the-loop design.",
  "Security": "BYOK, secret boundaries, and trust models.",
  "Infrastructure": "Workers, queues, Redis Streams, and scaling.",
  "Lessons": "Retrospectives from building and shipping Vectorbea.",
};

export function CategorySection({ categories }: { categories: string[] }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-ink">Browse by category</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => (
          <Link
            key={cat}
            href={`/articles?category=${encodeURIComponent(cat)}`}
            className="rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-accent-violet/50 hover:shadow-md"
          >
            <h3 className="font-semibold text-ink">{cat}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {CATEGORY_BLURBS[cat] ?? "Notes and write-ups."}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
