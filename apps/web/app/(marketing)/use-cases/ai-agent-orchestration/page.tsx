import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, Availability, H3, Bullets, KeyPoints, Callout, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { getUseCase, pageBySlug, pathForSlug, getUseCasePath } from "@/lib/marketing/pages";

const page = getUseCase("ai-agent-orchestration")!;

export const metadata: Metadata = createMetadata({
  title: page.title,
  description: page.description,
  path: getUseCasePath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "What is AI agent orchestration?",
    answer:
      "Coordinating the steps of an AI workflow — model calls, tool calls, branches, parallel work and human approvals — so they run in the right order, handle failures, and share state. Orchestration is the layer above individual agents that decides what runs when and what happens on failure.",
  },
  {
    question: "How is agent orchestration different from a job queue?",
    answer:
      "A job queue moves discrete tasks between workers. Orchestration adds workflow-level structure: ordered and parallel steps, branching, shared run state, retries, approvals and a durable history of the whole run. You can build orchestration on a queue, but the queue alone doesn't give you resumable, stateful workflows.",
  },
  {
    question: "How do you orchestrate multiple agents reliably?",
    answer:
      "Model each agent and tool as a step in a durable workflow. The orchestration layer runs steps (sequentially or in parallel), checkpoints their outputs, retries failures, pauses for approvals, and keeps one shared, inspectable history — so a multi-agent run is coordinated and recoverable rather than a tangle of calls.",
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
      eyebrow="Use case · Orchestration"
      h1="AI Agent Orchestration"
      lead={
        <Lead>
          One agent calling one model is easy. Coordinating several agents, their tools, parallel branches, retries and
          approvals into one reliable run is the actual work. Orchestration is the layer that decides what runs when —
          and what happens when a step fails.
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
        title: "Orchestrate agents on a durable canvas",
        body: "Compose multi-step, multi-agent workflows visually — with tools, parallel branches, retries and approvals — running on a durable execution layer.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/use-cases/ai-workflow-observability",
        secondaryLabel: "See run observability",
      }}
    >
      <Section title="The problem: coordination, not just calling models">
        <P>
          As soon as a system has more than one agent or a handful of tools, the hard part shifts from &quot;prompt the
          model&quot; to <Term>coordination</Term>: ordering, data passing, concurrency, and failure handling. Real
          orchestration has to cover:
        </P>
        <Bullets
          items={[
            <><Term>Multi-step and multi-agent workflows</Term> that pass state between stages.</>,
            <><Term>Tool execution</Term> — calling APIs, databases and services as first-class steps.</>,
            <><Term>Parallel execution</Term> of independent branches, then joining their results.</>,
            <><Term>Retries</Term> on individual steps without restarting the whole run.</>,
            <><Term>Human approvals</Term> inserted at the right points.</>,
            <><Term>Observability</Term> across the whole run, not per isolated call.</>,
          ]}
        />
      </Section>

      <Section eyebrow="Concepts" title="What a good orchestration layer provides">
        <H3>Steps with shared, durable state</H3>
        <P>
          Each model call, tool call or agent is a step. The orchestrator runs steps and checkpoints their outputs into
          one shared run state, so later steps can build on earlier ones and the whole run can resume after a failure.
        </P>
        <H3>Sequential and parallel</H3>
        <P>
          Independent work — enriching three sources, calling two APIs — should run in <Term>parallel</Term> and join,
          while dependent work runs in order. Orchestration expresses both without you hand-rolling concurrency and
          error handling each time.
        </P>
        <H3>Failure handling as part of the graph</H3>
        <P>
          Retries, backoff and approvals aren&apos;t bolted on — they&apos;re properties of steps in the workflow. A
          failed tool call retries; a risky step waits for a human; the rest of the run is unaffected.
        </P>
      </Section>

      <Section eyebrow="How Vectorbea helps" title="A control plane for coordinated runs">
        <KeyPoints
          items={[
            <><Term>Visual canvas.</Term> Compose multi-step, multi-agent workflows and see the whole graph at once.</>,
            <><Term>Tools as steps.</Term> Call your own APIs and databases as nodes, with keys and secrets encrypted at rest.</>,
            <><Term>Durable underneath every step.</Term> Each node checkpoints, so a coordinated run is also a recoverable one.</>,
            <><Term>Approvals and retries in the graph.</Term> Insert human gates and per-node retry/backoff where they belong.</>,
            <><Term>One run history.</Term> The whole orchestration — every agent, tool and branch — is one timeline. Replaying it against the recording is available on Pro and above.</>,
          ]}
        />
        <Callout title="Orchestration and durability go together">
          Coordinating many steps only pays off if the coordination survives failure. A durable execution layer is what
          keeps a multi-agent run from unraveling when one step goes wrong.
        </Callout>

        {/* AUDIT: "multi-agent" above means several agent STEPS in one workflow,
            which ships and runs today. It does not mean a team of agents that
            delegate to each other — that is behind a runtime switch which is
            off by default. A reader who assumes the second meaning has been
            misled by the first, so the distinction is stated rather than left
            to the demo. */}
        <Callout title="What &ldquo;multi-agent&rdquo; means here, precisely">
          Several agents as steps in one workflow — running in order or in parallel, passing state, each with its own
          model, tools and budget — works today. Agent <Term>teams</Term>, where members delegate work to each other
          under a roster and a depth limit, are built but ship behind a runtime switch that is off by default. If you
          are evaluating us for delegation specifically, ask us where that stands before you decide.
        </Callout>
      </Section>

      {/* AUDIT: the claims above are worded strongly because they are
          true of the product. Some of them are not true of every PLAN, and
          two are not true of a deployment that has not switched them on.
          Qualifying each mention inline would be accurate and unreadable —
          and an unreadable qualification gets skimmed, which leaves the
          reader exactly as misinformed as none at all. One strip, in the
          same place on every page, is read once and believed. */}
      <Section title="What these claims require">
        <Availability tone="flag" items={[
            <>
              <Term>Agent teams</Term> — a roster whose members delegate to each other under a depth
              limit — are built and ship behind a runtime switch that is off by default. Several
              agents as independent steps in one workflow is a different thing, and it works today.
            </>,
            <>
              <Term>Replay</Term> — re-executing a run against its recording, with no provider calls
              and no cost — is on Pro and above, not on Free. It also needs a run whose model calls
              were recorded; the API refuses rather than quietly executing it live and billing for it.
            </>,
        ]} />
      </Section>

      <Section eyebrow="FAQ" title="AI agent orchestration — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
