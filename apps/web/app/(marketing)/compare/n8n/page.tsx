import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, H3, KeyPoints, Callout, CompareTable, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { comparisonBySlug, pageBySlug, pathForSlug, comparisonPath } from "@/lib/marketing/pages";

const page = comparisonBySlug("n8n")!;

export const metadata: Metadata = createMetadata({
  title: "Vectorbea and n8n: Automation vs Durable AI Workflows",
  description: page.description,
  path: comparisonPath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "Is Vectorbea an n8n alternative?",
    answer:
      "They target different jobs. n8n is a workflow automation platform for connecting apps and automating tasks, with a rich library of integrations. Vectorbea is a durable execution layer for long-running, agentic AI workflows. If your goal is reliable multi-step AI agents with checkpoints, retries, approvals and AI observability, that's Vectorbea's focus.",
  },
  {
    question: "What is n8n good at?",
    answer:
      "n8n excels at automation: visually wiring together many app integrations and triggers to move data and automate tasks, self-hosted or cloud. It's a strong, flexible choice for connecting systems and building automations, including ones that call AI.",
  },
  {
    question: "When does durable AI execution matter more than automation?",
    answer:
      "When runs are long and stateful — agents that span minutes to days, pause for human approval, retry around provider failures, and must resume after a crash without redoing work — and when you need to debug them with AI-specific observability like token and cost history.",
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
      eyebrow="Compare · n8n"
      h1="Vectorbea and n8n"
      lead={
        <Lead>
          n8n and Vectorbea both let you build workflows visually, but they aim at different problems: n8n at
          <Term> automation and integrations</Term>, Vectorbea at <Term>durable execution for long-running AI
          agents</Term>. The distinction shows up most in failure semantics and long-running state.
        </Lead>
      }
      breadcrumbs={[
        { name: "Vectorbea", path: "/" },
        { name: "Compare", path: "/compare" },
        { name: "n8n", path: comparisonPath(page.slug) },
      ]}
      jsonLd={[
        articleSchema({ headline: "Vectorbea and n8n", description: page.description, path: comparisonPath(page.slug), dateModified: page.lastModified }),
        faqSchema(faqs),
      ]}
      related={related}
      cta={{
        title: "For agents, not just automations",
        body: "When your workflow is a long-running AI agent that must checkpoint, retry, wait for approval and resume, run it on a durable execution layer.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/use-cases/long-running-ai-agents",
        secondaryLabel: "Long-running agents",
      }}
    >
      <Section title="What n8n is good at">
        <P>
          n8n is a popular workflow automation platform. Its node-based editor and large library of integrations make it
          excellent for connecting apps, moving data between systems, and automating recurring tasks — self-hosted or in
          the cloud. It can also call AI models as part of an automation.
        </P>
        <KeyPoints
          items={[
            "Broad library of app integrations and triggers.",
            "Visual, node-based automation that's quick to assemble.",
            "Self-hostable, flexible, strong for connecting systems.",
            "Great fit for task automation and data movement.",
          ]}
        />
      </Section>

      <Section title="What Vectorbea focuses on">
        <P>
          Vectorbea is built around the lifecycle of a long-running AI agent rather than task automation. The emphasis is
          on what happens when a multi-step agent run meets production reality — failures, rate limits, approvals and
          time:
        </P>
        <KeyPoints
          items={[
            <><Term>Durable execution</Term>: every node checkpoints; runs resume from the last good state.</>,
            <><Term>Long-running state</Term>: agents that span minutes to days without holding a worker.</>,
            <><Term>Failure semantics</Term>: per-node retries and backoff, then seamless resume.</>,
            <><Term>Human approvals</Term> that suspend and resume durably.</>,
            <><Term>AI debugging</Term>: replayable event history with tokens and cost.</>,
          ]}
        />
      </Section>

      <Section eyebrow="Side by side" title="Automation vs durable AI execution">
        <CompareTable
          head={["Dimension", "n8n", "Vectorbea"]}
          rows={[
            ["Primary job", "Automating tasks and connecting apps", "Running durable, long-running AI agent workflows"],
            ["Integrations", "Large catalog of app connectors", "HTTP-callable tools/agents; BYOK model providers"],
            ["Long-running state", "Best for shorter automations", "First-class: checkpoints, timers, resume across days"],
            ["Failure handling", "Node error handling and retries", "Per-node retries + resume-from-checkpoint after crashes"],
            ["AI observability", "General execution logs", "Run timeline with tokens, cost and replay"],
            ["Best when", "You're automating tasks between systems", "You're operating stateful AI agents in production"],
          ]}
        />
      </Section>

      <Section title="Which to use">
        <H3>Often complementary</H3>
        <P>
          Plenty of teams use an automation platform for integrations and a durable execution layer for their agent
          workflows. If your need is &quot;when X happens, do a few steps across apps,&quot; automation tooling is a great
          fit. If it&apos;s &quot;run a stateful agent that must survive failures, wait for people, and be debuggable,&quot;
          that&apos;s the durable-execution problem Vectorbea targets.
        </P>
        <Callout title="Different tools, different jobs">
          This isn&apos;t automation versus agents as a rivalry. It&apos;s matching the tool to the workload — and
          long-running, stateful AI agents are what Vectorbea is for.
        </Callout>
      </Section>

      <Section eyebrow="FAQ" title="Vectorbea and n8n — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
