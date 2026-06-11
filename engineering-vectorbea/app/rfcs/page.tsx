import type { Metadata } from "next";
import Link from "next/link";
import { getAllEntries } from "@/lib/mdx";
import { buildMetadata } from "@/lib/seo";
import { TagPill } from "@/components/TagPill";

export const metadata: Metadata = buildMetadata({
  title: "RFCs",
  description: "Design proposals for Vectorbea's execution engine: context, goals, alternatives considered, and open questions.",
  path: "/rfcs",
});

export default function RFCsPage() {
  const rfcs = getAllEntries("rfcs");
  return (
    <div className="mx-auto max-w-page px-6 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">RFCs</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-500">
          Lightweight design proposals we wrote before building significant pieces of Vectorbea.
          Each one lays out the problem, goals, the design we picked, alternatives we considered,
          and what we're still unsure about.
        </p>
      </div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {rfcs.map((rfc) => (
          <Link
            key={rfc.slug}
            href={`/rfcs/${rfc.slug}`}
            className="group rounded-xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-accent-blue/50 hover:shadow-lg"
          >
            <p className="text-xs font-medium text-accent-violet">{rfc.frontMatter.category}</p>
            <h2 className="mt-2 text-lg font-semibold text-ink group-hover:text-accent-blue">
              {rfc.frontMatter.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{rfc.frontMatter.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {rfc.frontMatter.tags.map((t) => <TagPill key={t} tag={t} />)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
