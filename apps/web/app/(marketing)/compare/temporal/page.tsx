import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, H3, KeyPoints, Callout, CompareTable, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { comparisonBySlug, pageBySlug, pathForSlug, comparisonPath } from "@/lib/marketing/pages";

const page = comparisonBySlug("temporal")!;

export const metadata: Metadata = createMetadata({
  title: "Vectorbea and Temporal: Durable Execution for AI Workflows",
  description: page.description,
  path: comparisonPath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "Is Vectorbea a Temporal alternative for AI workflows?",
    answer:
      "For AI-specific use cases, it can be. Temporal is a mature, general-purpose durable execution platform for any domain. Vectorbea applies the same durability ideas — persisted state, retries, timers, resume — with abstractions built specifically for LLM calls, agents, tools, approvals and token/cost tracking. If your workload is agentic AI, the AI-native surface can be a lot less to build.",
  },
  {
    question: "What is Temporal good at?",
    answer:
      "Temporal is a proven, general-purpose durable execution engine. You write workflows as code in several languages, with deterministic replay, activities, durable timers and signals. It's an excellent foundation for reliable long-running processes across many domains, not just AI.",
  },
  {
    question: "When would I pick an AI-native layer over a general engine?",
    answer:
      "When most of your workflow is LLM calls, tool calls, agents and human approvals, and you want observability in those terms — tokens, cost, prompt/response history — without building those abstractions yourself on top of a general-purpose engine.",
  },
];

export default function Page() {
  const related = {
    title: "Related comparisons",
    links: page.related.map((s) => {
      const r = pageBySlug(s)!;
      return { href: pathForSlug(s), label: r.title, description: r.description };
    }),
  };

  return (
    <MarketingPageShell
      eyebrow="Compare · Temporal"
      h1="Vectorbea and Temporal"
      lead={
        <Lead>
          Temporal is a mature, general-purpose durable execution platform. Vectorbea applies the same durability
          principles with an <Term>AI-native</Term> surface. The real question isn&apos;t which is &quot;better&quot; —
          it&apos;s general-purpose durable execution versus abstractions built specifically for AI workflows.
        </Lead>
      }
      breadcrumbs={[
        { name: "Vectorbea", path: "/" },
        { name: "Compare", path: "/compare" },
        { name: "Temporal", path: comparisonPath(page.slug) },
      ]}
      jsonLd={[
        articleSchema({ headline: "Vectorbea and Temporal", description: page.description, path: comparisonPath(page.slug), dateModified: page.lastModified }),
        faqSchema(faqs),
      ]}
      related={related}
      cta={{
        title: "Durable execution, AI-native",
        body: "Get persisted state, retries, timers and resume — with first-class abstractions for LLM calls, tools, approvals and cost.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/use-cases/durable-ai-workflows",
        secondaryLabel: "How durable execution works",
      }}
    >
      <Section title="What Temporal is good at">
        <P>
          Temporal is a battle-tested durable execution platform used across many industries. You write workflows as
          code, and the engine gives you deterministic replay, durable timers, retries and signals so long-running
          processes survive crashes and restarts. It is general-purpose by design — a strong foundation for reliable
          workflows in almost any domain.
        </P>
        <KeyPoints
          items={[
            "Mature, widely adopted, general-purpose durable execution.",
            "Workflows-as-code with SDKs in multiple languages.",
            "Deterministic replay, durable timers, activities and signals.",
            "Domain-agnostic: not limited to AI workloads.",
          ]}
        />
      </Section>

      <Section title="Where an AI-native layer can simplify things">
        <P>
          The durability ideas Temporal popularized are exactly what AI workflows need. The difference Vectorbea offers
          is that the abstractions are shaped around AI work, so the common pieces don&apos;t have to be built by hand:
        </P>
        <KeyPoints
          items={[
            <><Term>LLM calls, agents and tools</Term> as first-class steps rather than generic activities you wrap.</>,
            <><Term>Prompt execution and history</Term> captured in terms you can read and replay.</>,
            <><Term>Human approvals</Term> as built-in gates that suspend and resume durably.</>,
            <><Term>AI-specific observability</Term> — token usage and cost per run, not just generic metrics.</>,
            <><Term>Provider configuration and BYOK</Term> — your OpenAI, Anthropic or Gemini keys, encrypted at rest.</>,
          ]}
        />
        <P>
          None of this is a knock on Temporal — it&apos;s a general engine, and generality is the point. It simply means
          that for an agentic AI workload, more of the scaffolding is yours to build.
        </P>
      </Section>

      <Section eyebrow="Side by side" title="General-purpose vs AI-native">
        <CompareTable
          head={["Dimension", "Temporal", "Vectorbea"]}
          rows={[
            ["Scope", "General-purpose durable execution, any domain", "Durable execution focused on agentic AI workflows"],
            ["Programming model", "Workflows as code (multi-language SDKs)", "Visual canvas + HTTP-callable agents and tools"],
            ["AI abstractions", "You build them on generic activities", "LLM calls, tools, agents, approvals as first-class"],
            ["Observability", "Generic workflow/activity metrics", "Run timeline with tokens, cost, prompt/response history"],
            ["Maturity", "Mature, broadly adopted, proven at scale", "Focused on the AI use case"],
            ["Best when", "You need general durable execution across domains", "Your workload is mostly LLMs, tools and agents"],
          ]}
        />
      </Section>

      <Section title="How to choose">
        <H3>Pick based on the shape of your workload</H3>
        <P>
          If you need durable execution across many kinds of processes — payments, provisioning, data pipelines and some
          AI — a general engine like Temporal is a sound, proven choice. If your workload is predominantly agents, tools
          and LLM calls, an AI-native layer removes a lot of the plumbing you&apos;d otherwise write on top of a general
          engine.
        </P>
        <Callout title="Not universally better — differently shaped">
          Vectorbea isn&apos;t a claim that AI-native beats general-purpose. It&apos;s that matching the abstraction to
          the workload saves work. For agentic AI, that abstraction is a good fit.
        </Callout>
      </Section>

      <Section eyebrow="FAQ" title="Vectorbea and Temporal — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
