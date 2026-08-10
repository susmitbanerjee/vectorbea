import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, H3, Bullets, KeyPoints, Callout, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { getUseCase, pageBySlug, pathForSlug, getUseCasePath } from "@/lib/marketing/pages";

const page = getUseCase("ai-workflow-observability")!;

export const metadata: Metadata = createMetadata({
  title: page.title,
  description: page.description,
  path: getUseCasePath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "What is AI workflow observability?",
    answer:
      "The ability to see exactly what an agent workflow did: each node's execution, the tool calls and LLM requests it made, their inputs and outputs, latency, retries, failures, and token/cost usage — as a timeline you can inspect and replay.",
  },
  {
    question: "How do you debug an agent workflow that failed?",
    answer:
      "Start from the run's execution timeline, find the node that failed, and read its inputs, outputs and error. Because a durable run records every step as an immutable event, you can replay the run to reproduce the failure deterministically instead of guessing from logs.",
  },
  {
    question: "Why are tokens and cost part of observability?",
    answer:
      "LLM calls are the dominant cost and a common source of surprises. Tracking tokens and cost per node and per run turns spend into something you can see, attribute and control — not a monthly invoice shock.",
  },
];

export default function Page() {
  const related = {
    title: "Related",
    links: page.related.map((s) => {
      const r = pageBySlug(s)!;
      return { href: pathForSlug(s), label: r.title, description: r.description };
    }),
  };

  return (
    <MarketingPageShell
      eyebrow="Use case · Observability & debugging"
      h1="AI Workflow Observability"
      lead={
        <Lead>
          When an agent does something surprising, &quot;read the logs&quot; isn&apos;t enough. You need the run&apos;s
          execution timeline: every node, every tool call and model request, with inputs, outputs, latency, retries and
          cost — and the ability to replay it.
        </Lead>
      }
      breadcrumbs={[
        { name: "Vectorbea", path: "/" },
        { name: "Use Cases", path: "/use-cases" },
        { name: page.title, path: getUseCasePath(page.slug) },
      ]}
      jsonLd={[
        articleSchema({ headline: page.title, description: page.description, path: getUseCasePath(page.slug), dateModified: page.lastModified }),
        faqSchema(faqs),
      ]}
      related={related}
      cta={{
        title: "See inside every run",
        body: "Run a workflow and inspect its full timeline — nodes, tool calls, model requests, retries, tokens and cost — then replay it to debug.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/use-cases/ai-workflow-failure-recovery",
        secondaryLabel: "Failure recovery",
      }}
    >
      <Section title="The problem: agents are hard to see into">
        <P>
          An agent&apos;s behavior emerges from a chain of model decisions and tool calls. When the output is wrong, the
          cause could be any link in that chain — a bad prompt, a tool that returned junk, a retry that changed the
          state, a rate limit that reordered things. Flat text logs rarely reconstruct that story. Useful observability
          for AI workflows means being able to see:
        </P>
        <Bullets
          items={[
            <>The <Term>execution timeline</Term> of a run, node by node.</>,
            <>Each <Term>node&apos;s execution</Term>: when it started, finished, and its status.</>,
            <>Every <Term>tool call</Term> and <Term>LLM request</Term>, with their inputs and outputs.</>,
            <><Term>Latency</Term> per step and across the run.</>,
            <><Term>Failures and retries</Term> — what failed, how many attempts, and why.</>,
            <>Complete <Term>workflow history</Term>, so nothing is lost between steps.</>,
            <><Term>Cost visibility</Term>: tokens and dollars, attributable to nodes.</>,
          ]}
        />
      </Section>

      <Section eyebrow="Concept" title="Event history is what makes runs debuggable">
        <H3>Every step is an event</H3>
        <P>
          A durable run isn&apos;t just checkpointed for recovery — the same event log is what you read to understand
          it. Each tool call, model response, retry and approval is an immutable event with its inputs and outputs
          attached.
        </P>
        <H3>Replay instead of guess</H3>
        <P>
          Because the history is complete and immutable, you can <Term>replay</Term> a run to reproduce exactly what
          happened. Debugging becomes deterministic: you&apos;re not reconstructing state from scattered logs, you&apos;re
          reading the record of the run itself.
        </P>
      </Section>

      <Section eyebrow="How Vectorbea helps" title="A timeline for every run">
        <KeyPoints
          items={[
            <><Term>Immutable event history.</Term> Every tool call, LLM response, retry and approval is recorded and inspectable.</>,
            <><Term>Replay any run.</Term> Reproduce a run from its history to debug a failure deterministically.</>,
            <><Term>Live tokens and cost.</Term> Usage is tracked as the run executes, so spend is visible per run — not a monthly surprise.</>,
            <><Term>Retry visibility.</Term> See where a node backed off and retried, and how it eventually resolved.</>,
          ]}
        />
        <Callout title="Observability and durability are the same log">
          The event history that lets a run resume after failure is the same history you read to debug it. One durable
          record does double duty: recovery and observability.
        </Callout>
      </Section>

      <Section eyebrow="FAQ" title="AI workflow observability — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
