import type { Metadata } from "next";
import Link from "next/link";
import { getAllEntries } from "@/lib/mdx";
import { buildMetadata } from "@/lib/seo";
import { TagPill } from "@/components/TagPill";

export const metadata: Metadata = buildMetadata({
  title: "Experiments",
  description: "Sanitized toy demos and experiments related to Vectorbea's execution model — durable runners, worker simulations, and more.",
  path: "/experiments",
});

export default function ExperimentsPage() {
  const experiments = getAllEntries("experiments");
  return (
    <div className="mx-auto max-w-page px-6 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Experiments</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-500">
          Small, sanitized demos that explore ideas adjacent to Vectorbea's execution model —
          separate from the production codebase, meant for learning and discussion.
        </p>
      </div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {experiments.map((exp) => (
          <Link
            key={exp.slug}
            href={`/experiments/${exp.slug}`}
            className="group rounded-xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-accent-blue/50 hover:shadow-lg"
          >
            <p className="text-xs font-medium text-accent-violet">{exp.frontMatter.category}</p>
            <h2 className="mt-2 text-lg font-semibold text-ink group-hover:text-accent-blue">
              {exp.frontMatter.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{exp.frontMatter.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {exp.frontMatter.tags.map((t) => <TagPill key={t} tag={t} />)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
