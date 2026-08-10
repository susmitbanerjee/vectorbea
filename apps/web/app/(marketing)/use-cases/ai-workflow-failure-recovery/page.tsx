import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, H3, Bullets, KeyPoints, Callout, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { getUseCase, pageBySlug, pathForSlug, getUseCasePath } from "@/lib/marketing/pages";

const page = getUseCase("ai-workflow-failure-recovery")!;

export const metadata: Metadata = createMetadata({
  title: page.title,
  description: page.description,
  path: getUseCasePath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "How do you recover a failed AI workflow?",
    answer:
      "With durable execution you recover by resuming from the last checkpoint rather than re-running from the start. The engine reloads the run's persisted state, retries the failed step under a retry policy, and continues. Completed steps aren't repeated.",
  },
  {
    question: "How do you resume an AI workflow instead of restarting it?",
    answer:
      "Resuming requires that the workflow's progress was checkpointed as it ran. On failure, the run loads its last checkpoint and continues from the next step. Restarting — losing all prior work — is what happens when there's no persisted state to resume from.",
  },
  {
    question: "How do retries avoid duplicate side effects?",
    answer:
      "By making steps idempotent, usually with an idempotency key. If a step is retried after it already performed its side effect, the key ensures the effect isn't applied twice — so a retried 'send email' or 'charge card' doesn't fire again.",
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
      eyebrow="Use case · Failure recovery"
      h1="AI Workflow Failure Recovery"
      lead={
        <Lead>
          In production, AI workflows fail — providers time out, APIs rate-limit, workers restart. The question isn&apos;t
          whether they fail but what happens next: does the run resume from the last good state, or throw away everything
          and start over?
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
        title: "Make failure a checkpoint, not a restart",
        body: "Run workflows that retry, resume from the last checkpoint, and never re-do completed work — even across crashes and deploys.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/use-cases/durable-ai-workflows",
        secondaryLabel: "How durable execution works",
      }}
    >
      <Section title="The problem: a late failure shouldn't undo early work">
        <P>
          A workflow that fails at step 18 of 20 and restarts from step 1 is worse than slow — it re-issues every model
          and tool call, doubling cost and risking duplicate side effects. Good failure recovery for AI workflows rests
          on a few mechanisms working together:
        </P>
        <Bullets
          items={[
            <><Term>Retry policies</Term> — attempt limits and which errors are retryable.</>,
            <><Term>Backoff</Term> — spacing out retries (often exponential) so you don&apos;t hammer a struggling provider.</>,
            <><Term>Persistent state</Term> — progress that outlives the process that produced it.</>,
            <><Term>Idempotency</Term> — steps that are safe to re-enter without duplicating effects.</>,
            <><Term>Partial completion</Term> — recognizing which steps already finished.</>,
            <><Term>Resume semantics</Term> — continuing from the next incomplete step.</>,
            <><Term>Checkpointing</Term> — the durable markers that make all of the above possible.</>,
          ]}
        />
      </Section>

      <Section eyebrow="Concepts" title="Retry, resume, and not doing it twice">
        <H3>Retry vs. resume</H3>
        <P>
          <Term>Retry</Term> re-attempts a single failed step. <Term>Resume</Term> continues an entire run from its last
          checkpoint. You need both: retries handle a flaky call in place; resume handles the process itself dying. Retry
          without persisted state can&apos;t survive a worker restart — the state is gone.
        </P>
        <H3>Idempotency is what makes resume safe</H3>
        <P>
          Resuming is only safe if re-entering a step can&apos;t double its side effects. An idempotency key per
          side-effecting step (send, charge, write) means &quot;if this already happened, don&apos;t do it again.&quot;
          Without it, recovery risks sending the second email.
        </P>
        <H3>Backoff protects the thing that&apos;s failing</H3>
        <P>
          When a provider returns 429 or 503, immediate retries make it worse. Exponential backoff gives the dependency
          room to recover and turns a transient failure into a short delay rather than a dead run.
        </P>
      </Section>

      <Section title="Worked example: recovering a data-enrichment run">
        <P>An agent enriches 500 records, calling an LLM and two APIs per record:</P>
        <Bullets
          items={[
            <>At record 320, an API rate-limits. The step <Term>backs off and retries</Term> — the first 319 records stay done.</>,
            <>During the backoff, the worker is redeployed. The run is <Term>checkpointed</Term>, so it isn&apos;t lost.</>,
            <>A new worker <Term>resumes</Term> from record 320, not record 1.</>,
            <>Records already written are guarded by <Term>idempotency keys</Term>, so nothing is written twice.</>,
            <>The run completes; its history shows the retry and the resume for later inspection.</>,
          ]}
        />
        <Callout title="The difference">
          The same failure that would restart a naive pipeline from zero costs a durable one a short backoff and a
          seamless resume. Recovery is boring — which is the goal.
        </Callout>
      </Section>

      <Section eyebrow="How Vectorbea helps" title="Recovery is the default behavior">
        <KeyPoints
          items={[
            <><Term>Per-node retries with backoff.</Term> Transient failures are retried under a policy instead of failing the run.</>,
            <><Term>Resume from the last checkpoint.</Term> After a crash, restart or deploy, a run continues where it stopped.</>,
            <><Term>Immutable history.</Term> Retries and resumes are recorded, so you can see exactly how a run recovered.</>,
            <><Term>Replay for debugging.</Term> Reproduce a failed run from its event history to find the root cause.</>,
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="AI workflow failure recovery — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
