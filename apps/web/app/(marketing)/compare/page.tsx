import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/marketing/site-chrome";
import { Checkpoint } from "@/components/marketing/logo";
import { JsonLd } from "@/components/seo/json-ld";
import { createMetadata, breadcrumbSchema } from "@/lib/seo";
import { COMPARISONS, comparisonPath } from "@/lib/marketing/pages";

export const metadata: Metadata = createMetadata({
  title: "Compare",
  description:
    "How Vectorbea's durable, AI-native workflow orchestration relates to LangGraph, Temporal and n8n — where the approaches overlap, where they differ, and when each fits.",
  path: "/compare",
});

export default function ComparePage() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      <JsonLd data={[breadcrumbSchema([{ name: "Vectorbea", path: "/" }, { name: "Compare", path: "/compare" }])]} />
      <SiteHeader />

      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8">
        <header className="max-w-[720px] pb-8 pt-12">
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
            <Checkpoint />
            <span className="font-mono text-[11px] font-medium text-[#006B45]">Compare</span>
          </span>
          <h1 className="mt-5 text-[36px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[46px]">
            How Vectorbea relates to other tools
          </h1>
          <p className="mt-5 text-[17px] leading-[1.7] text-[#4B5563]">
            Honest, architecture-first comparisons — not scorecards. Each page explains what the other tool is good at,
            where Vectorbea&apos;s durable, AI-native approach differs, and when you&apos;d reach for each (sometimes
            together).
          </p>
        </header>

        <section className="pb-20" aria-label="Comparisons">
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {COMPARISONS.map((c) => (
              <li key={c.slug}>
                <Link
                  href={comparisonPath(c.slug) as Route}
                  className="group flex h-full flex-col rounded-[14px] border bg-white p-6 transition-colors hover:border-[#9CCFBB]"
                  style={{ borderColor: "#E0E3E6" }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <h2 className="text-[17px] font-bold tracking-[-0.01em] text-[#0B0D0F]">{c.title}</h2>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#C9CED4] transition-colors group-hover:text-[#007F4E]" />
                  </span>
                  <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-[#6B7280]">{c.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}
