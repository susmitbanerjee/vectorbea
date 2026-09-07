import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, Availability, H3, Bullets, KeyPoints, Callout, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { getUseCase, pageBySlug, pathForSlug, getUseCasePath } from "@/lib/marketing/pages";

const page = getUseCase("durable-ai-workflows")!;

export const metadata: Metadata = createMetadata({
  title: page.title,
  description: page.description,
  path: getUseCasePath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "What is a durable AI workflow?",
    answer:
      "A durable AI workflow is an AI/agent process whose state is persisted at each step, so it can survive crashes, restarts and long pauses and resume from the last completed step instead of starting over. Durability comes from checkpointing progress to a database rather than holding it only in a running process's memory.",
  },
  {
    question: "Why do AI workflows need durable execution?",
    answer:
      "Production AI workflows chain many model calls, tool calls, API requests and sometimes human approvals over minutes to days. Any of those can fail or stall — a provider outage, a rate limit, a worker restart, a deploy. Without durable execution a failure loses all in-progress work and re-runs everything, which is slow, expensive and often non-idempotent.",
  },
  {
    question: "How is durable execution different from just adding retries?",
    answer:
      "Retries alone re-attempt a failed call, but if the process holding the workflow's state dies, retries can't help — the state is gone. Durable execution persists the workflow's progress so that after any failure the run resumes from the last checkpoint, and retries operate on top of that persisted state.",
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
      eyebrow="Use case · Durable execution"
      h1="Durable AI Workflows"
      lead={
        <Lead>
          Production AI workflows are long, multi-step and fragile. Durable execution is the discipline of persisting a
          workflow&apos;s progress so it can survive failures and resume from where it stopped — instead of restarting
          from the first token every time something breaks.
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
        title: "Build a durable workflow",
        body: "Design a workflow on the canvas, run it, and watch every node checkpoint as it executes. When something fails, resume from the last good state.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/docs",
        secondaryLabel: "Read the docs",
      }}
    >
      <Section title="The problem: real AI workflows don't fit in one function call">
        <P>
          A demo agent runs in a single process, in one uninterrupted burst. A <Term>production</Term> AI workflow does
          not. It fans out across multiple model calls, tool and API calls, database writes, and sometimes a human
          approval that can take hours or days. The longer and more distributed a run gets, the more ways it has to
          fail partway through.
        </P>
        <P>Any of these can interrupt a run in flight:</P>
        <Bullets
          items={[
            <>The process <Term>crashes</Term> or is OOM-killed mid-run.</>,
            <>A model <Term>provider fails</Term> or times out on one call out of twenty.</>,
            <>An API returns a <Term>429 rate limit</Term> and needs backoff.</>,
            <>A transient <Term>network failure</Term> drops a tool call.</>,
            <>A <Term>worker restarts</Term> or is rescheduled by the orchestrator.</>,
            <>A step waits on a <Term>human approval</Term> that arrives much later.</>,
            <>A <Term>deployment</Term> ships while a run is halfway through.</>,
          ]}
        />
        <Callout title="The failure mode to avoid">
          Without durability, a failure at step 18 of 20 throws away steps 1–17. You re-run every model call and tool
          call — paying for the tokens again, and risking duplicate side effects (a second email, a second charge)
          because the earlier steps were not idempotent.
        </Callout>
      </Section>

      <Section eyebrow="Concepts" title="What durable execution actually means">
        <P>
          Durable execution turns a workflow from an in-memory program into a <Term>persisted, recoverable</Term> one.
          A handful of concepts do the work:
        </P>

        <H3>Persisted workflow state</H3>
        <P>
          The run&apos;s progress — which steps completed, their outputs, what&apos;s pending — lives in a database, not
          only in process memory. If the process disappears, the state does not.
        </P>

        <H3>Checkpoints</H3>
        <P>
          After each meaningful step, the workflow writes a checkpoint: a durable marker of &quot;this step finished,
          here is its result.&quot; Checkpoints are the points a run can safely resume from.
        </P>

        <H3>Retries and backoff</H3>
        <P>
          Failed steps are retried with a policy (attempt limits, exponential backoff) rather than failing the whole
          run. Because state is persisted, retries pick up against the last checkpoint.
        </P>

        <H3>Resumability</H3>
        <P>
          After a crash, restart or pause, the workflow resumes from its last checkpoint — not from the beginning. The
          completed work is not repeated.
        </P>

        <H3>Idempotency</H3>
        <P>
          Steps with side effects (sending mail, charging a card, calling a tool) should be safe to re-enter. Durable
          engines lean on idempotency keys so a retried step doesn&apos;t duplicate its effect.
        </P>

        <H3>Timers and approvals</H3>
        <P>
          Waiting — for a backoff window, a scheduled time, or a human decision — is modeled as durable state, so a run
          can sleep for days without holding a live worker the entire time.
        </P>
      </Section>

      <Section eyebrow="How Vectorbea helps" title="Durable execution, as the default">
        <P>
          Vectorbea is a control plane for long-running agentic workflows. Durability isn&apos;t a library you wire up —
          it&apos;s how every run works:
        </P>
        <KeyPoints
          items={[
            <><Term>Every node checkpoints as it runs.</Term> Each step&apos;s completion and output are recorded durably, so a run always has a known-good point to resume from.</>,
            <><Term>Resume from the last checkpoint.</Term> A failed tool call, a rate limit, or a worker restart picks up exactly where it left off — no work lost, no tokens re-spent.</>,
            <><Term>Automatic retries with per-node backoff.</Term> Transient failures are retried on top of persisted state instead of failing the whole workflow.</>,
            <><Term>Immutable event history.</Term> Every tool call, LLM response, retry and approval is recorded as an event you can inspect. Re-executing a whole run against that recording is available on Pro and above.</>,
            <><Term>Human approval gates.</Term> A run can suspend on a decision and resume when it&apos;s approved, without a process sitting idle in between.</>,
            <><Term>Token and cost visibility.</Term> Usage is tracked per run so durability doesn&apos;t come at the price of a black box.</>,
          ]}
        />
      </Section>

      <Section title="A durable run, step by step">
        <P>Consider a renewals agent that runs on a schedule:</P>
        <Bullets
          items={[
            <><Term>Start:</Term> the workflow begins and checkpoints its trigger and inputs.</>,
            <><Term>Triage:</Term> an agent classifies the account; the node completes and checkpoints its output.</>,
            <><Term>Tool call:</Term> a pricing API returns a 429. The node retries with backoff — against the checkpoint, not from scratch.</>,
            <><Term>Approval:</Term> the run requests a human sign-off and suspends. It holds durable state, not a live worker, while it waits.</>,
            <><Term>Resume &amp; finish:</Term> on approval, the run continues from the approval checkpoint and completes.</>,
          ]}
        />
        <Callout title="The payoff">
          If the worker had crashed during the approval wait — or a deploy had shipped — the run would resume from the
          approval checkpoint on the next available worker. The earlier triage and pricing work is never repeated.
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
        <Availability tone="plan" items={[
            <>
              <Term>Replay</Term> — re-executing a run against its recording, with no provider calls
              and no cost — is on Pro and above, not on Free. It also needs a run whose model calls
              were recorded; the API refuses rather than quietly executing it live and billing for it.
            </>,
            <>
              There is no <Term>SLA</Term> and no published uptime figure, and we hold no SOC 2 or
              ISO 27001 certification. If any of those decides your purchase, the answer today is no.
            </>,
        ]} />
      </Section>

      <Section eyebrow="FAQ" title="Durable AI workflows — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
