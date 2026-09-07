import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, Availability, H3, Bullets, KeyPoints, Callout, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { getUseCase, pageBySlug, pathForSlug, getUseCasePath } from "@/lib/marketing/pages";

const page = getUseCase("long-running-ai-agents")!;

export const metadata: Metadata = createMetadata({
  title: page.title,
  description: page.description,
  path: getUseCasePath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "What counts as a long-running AI agent?",
    answer:
      "Any agent whose work spans well beyond a single request/response — minutes, hours or days. Examples: an agent that polls an external job until it finishes, one that waits on a human approval, or one that runs a multi-stage pipeline across scheduled windows.",
  },
  {
    question: "How can an agent run for days without holding a worker the whole time?",
    answer:
      "By modeling waiting as durable state. When an agent hits a timer, a backoff window, or an approval, it persists its position and releases the worker. A scheduler wakes the run when the wait is over and resumes it on any available worker, so no process sits idle for days.",
  },
  {
    question: "What happens to a long-running agent during a deployment?",
    answer:
      "With durable execution, an in-flight run is checkpointed, so a deployment that restarts workers doesn't lose it. After the deploy, the run resumes from its last checkpoint on a fresh worker instead of failing or restarting.",
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
      eyebrow="Use case · Long-running agents"
      h1="Long-Running AI Agents"
      lead={
        <Lead>
          Some agents finish in a second. The interesting ones don&apos;t — they poll external jobs, wait on people, and
          span deployments. Running an agent for hours or days is less about the model and more about what holds its
          state while time passes.
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
        title: "Run an agent that survives production",
        body: "Build a long-running workflow that checkpoints, waits, and resumes across restarts and deploys — without keeping a process pinned the whole time.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/use-cases/durable-ai-workflows",
        secondaryLabel: "How durable execution works",
      }}
    >
      <Section title="The problem: time is the hard part">
        <P>
          A request/response agent lives and dies inside one HTTP handler. Once an agent&apos;s work outlives a single
          request — because it&apos;s waiting on something, or doing a lot — the naive approaches break down. Keeping a
          worker blocked for hours is wasteful and fragile; the moment it restarts, the run is gone.
        </P>
        <P>Long-running agents routinely have to cope with:</P>
        <Bullets
          items={[
            <>Runs that last <Term>minutes, hours or days</Term>, not milliseconds.</>,
            <><Term>Human approval pauses</Term> in the middle of otherwise automated work.</>,
            <><Term>Rate limits</Term> that force backoff and spread work over time.</>,
            <><Term>External asynchronous jobs</Term> the agent must poll until they complete.</>,
            <><Term>Timer-based execution</Term> — &quot;check again in an hour,&quot; &quot;escalate after a day.&quot;</>,
            <><Term>Worker restarts</Term> and rescheduling under the orchestrator.</>,
            <><Term>Deployments</Term> that land while runs are in flight.</>,
          ]}
        />
      </Section>

      <Section eyebrow="Concepts" title="What it takes to run for a long time">
        <H3>Waiting as durable state</H3>
        <P>
          The key move: a wait is not a blocked thread — it&apos;s a persisted position plus a wake condition. The run
          records &quot;I&apos;m paused at step 7 until time T (or event E)&quot; and gives up the worker. This is what
          lets a run &quot;sleep&quot; for days cheaply.
        </P>
        <H3>Checkpoint recovery</H3>
        <P>
          Because progress is checkpointed, a restart doesn&apos;t reset the agent. Recovery means loading the last
          checkpoint and continuing, so elapsed work is preserved across crashes and deploys.
        </P>
        <H3>Deployment survival</H3>
        <P>
          Long-running runs must outlive the code that started them. Durable state decouples a run&apos;s lifetime from
          any single process or release, so shipping new code doesn&apos;t drop in-flight agents.
        </P>
        <H3>Idempotent resumption</H3>
        <P>
          When a run resumes, already-completed side effects must not repeat. Idempotency keys make &quot;continue from
          here&quot; safe even if the last step was interrupted after acting.
        </P>
      </Section>

      <Section eyebrow="How Vectorbea helps" title="Built for runs that outlive a request">
        <KeyPoints
          items={[
            <><Term>Checkpointed runs.</Term> Every node records durable state as it completes, so a run always has a resume point.</>,
            <><Term>Resume across restarts and deploys.</Term> An interrupted run continues from its last checkpoint on the next available worker.</>,
            <><Term>Approvals without idle workers.</Term> A run suspends on a human decision and wakes when it arrives, holding state rather than a process.</>,
            <><Term>Retries with backoff.</Term> Rate limits and transient errors are absorbed over time instead of killing the run.</>,
            <><Term>Full event history.</Term> Even a multi-day run has a complete timeline of what happened and when. Re-executing it against that recording is available on Pro and above.</>,
          ]}
        />
        <Callout title="Why this matters">
          The cost of a long-running agent should scale with the work it does, not the wall-clock time it waits. Durable
          state is what makes a three-day run affordable and reliable.
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

      <Section eyebrow="FAQ" title="Long-running AI agents — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
