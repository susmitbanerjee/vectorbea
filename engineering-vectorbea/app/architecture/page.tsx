import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Architecture",
  description: "A high-level look at how Vectorbea is built: Next.js frontend, Kotlin backend and workers, Postgres, Redis Streams, and the durable execution model.",
  path: "/architecture",
});

const COMPONENTS = [
  {
    name: "Frontend (Next.js)",
    detail: "The visual workflow builder and run inspector. Talks to the API over REST/JSON, renders run timelines and event history.",
  },
  {
    name: "API (Kotlin)",
    detail: "Owns workflow definitions, run lifecycle, auth (Supabase), budgets and rate limits. Validates and persists to Postgres.",
  },
  {
    name: "Worker (Kotlin)",
    detail: "Pulls work from Redis Streams consumer groups, executes steps, writes checkpoints and event history, handles retries.",
  },
  {
    name: "Postgres / Neon",
    detail: "System of record for workflow definitions, runs, checkpoints, and the append-only event history.",
  },
  {
    name: "Redis Streams",
    detail: "Durable work queue between API and workers. Consumer groups, pending entry lists, and DLQ-style retry handling.",
  },
  {
    name: "Deploy (Vercel + Railway)",
    detail: "Frontend on Vercel, backend services on Railway. Kept deliberately simple for a small team.",
  },
];

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-page px-6 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Architecture</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-500">
          A high-level map of how Vectorbea is put together. This is intentionally a simple system
          The early goal was to ship something durable and correct before reaching for anything more
          elaborate. We go deeper on each piece in the articles.
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {COMPONENTS.map((c) => (
          <div key={c.name} className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold text-ink">{c.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{c.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-8">
        <h2 className="text-lg font-semibold text-ink">Request flow, in short</h2>
        <ol className="mt-4 space-y-2 text-sm leading-relaxed text-slate-500">
          <li>1. A user designs a workflow visually in the frontend and starts a run.</li>
          <li>2. The API validates the definition, creates a run record, and enqueues the first step onto a Redis Stream.</li>
          <li>3. A worker claims the step via a consumer group, executes it, appends events to the run's event history, and writes a checkpoint.</li>
          <li>4. On failure, the step is retried with backoff; on success, the next step is enqueued. Approval gates pause the run until a human acts.</li>
          <li>5. The frontend polls (or subscribes to) the event history to render a live timeline of the run.</li>
        </ol>
      </div>
    </div>
  );
}
