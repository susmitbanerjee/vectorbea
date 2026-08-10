import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/marketing/site-chrome";
import { Checkpoint } from "@/components/marketing/logo";
import { JsonLd } from "@/components/seo/json-ld";
import { createMetadata, breadcrumbSchema, absoluteUrl } from "@/lib/seo";
import { USE_CASES, getUseCasePath } from "@/lib/marketing/pages";

export const metadata: Metadata = createMetadata({
  title: "Use Cases",
  description:
    "Engineering deep dives into what Vectorbea is built for: durable AI workflows, long-running agents, agent orchestration, human-in-the-loop, observability and failure recovery.",
  path: "/use-cases",
});

const itemListSchema = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: USE_CASES.map((p, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: p.title,
    url: absoluteUrl(getUseCasePath(p.slug)),
  })),
};

export default function UseCasesPage() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      <JsonLd data={[breadcrumbSchema([{ name: "Vectorbea", path: "/" }, { name: "Use Cases", path: "/use-cases" }]), itemListSchema]} />
      <SiteHeader />

      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8">
        <header className="max-w-[720px] pb-8 pt-12">
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
            <Checkpoint />
            <span className="font-mono text-[11px] font-medium text-[#006B45]">Use cases</span>
          </span>
          <h1 className="mt-5 text-[36px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[46px]">
            What durable execution unlocks for AI agents
          </h1>
          <p className="mt-5 text-[17px] leading-[1.7] text-[#4B5563]">
            Each page explains a real production problem — process crashes, rate limits, multi-day approvals, lost
            state — and how a durable execution layer with checkpoints, retries and resumable runs solves it. Useful
            whether or not you ever run Vectorbea.
          </p>
        </header>

        <section className="pb-20" aria-label="Use cases">
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {USE_CASES.map((uc) => (
              <li key={uc.slug}>
                <Link
                  href={getUseCasePath(uc.slug) as Route}
                  className="group flex h-full flex-col rounded-[14px] border bg-white p-6 transition-colors hover:border-[#9CCFBB]"
                  style={{ borderColor: "#E0E3E6" }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <h2 className="text-[18px] font-bold tracking-[-0.01em] text-[#0B0D0F]">{uc.title}</h2>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#C9CED4] transition-colors group-hover:text-[#007F4E]" />
                  </span>
                  <p className="mt-2 flex-1 text-[13.5px] leading-[1.6] text-[#6B7280]">{uc.description}</p>
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
