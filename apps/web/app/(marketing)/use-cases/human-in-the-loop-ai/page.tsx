import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, H3, Bullets, KeyPoints, Callout, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { getUseCase, pageBySlug, pathForSlug, getUseCasePath } from "@/lib/marketing/pages";

const page = getUseCase("human-in-the-loop-ai")!;

export const metadata: Metadata = createMetadata({
  title: page.title,
  description: page.description,
  path: getUseCasePath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "What is a human-in-the-loop AI workflow?",
    answer:
      "A workflow where an agent pauses at a defined point for a person to review, approve, edit or reject before it proceeds — typically before a risky or irreversible action like sending a payment, emailing a customer, or writing to a system of record.",
  },
  {
    question: "Why shouldn't a workflow keep a worker alive while it waits for approval?",
    answer:
      "Approvals can take minutes to days. Blocking a worker or process the whole time wastes resources and is fragile — a restart loses the paused run. The durable approach persists the run's position, releases the worker, and resumes when the decision arrives.",
  },
  {
    question: "How do approval timeouts and escalation work?",
    answer:
      "Because a suspended run is durable state with a wake condition, it can also carry a deadline. If no decision arrives in time, the run can time out or escalate (notify a backup approver) instead of hanging forever — all recorded in the run's history.",
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
      eyebrow="Use case · Human approvals"
      h1="Human-in-the-Loop AI Workflows"
      lead={
        <Lead>
          Autonomy is great until an agent is about to spend money or email a customer. Human-in-the-loop workflows put
          a person in front of the risky steps — the engineering question is how to pause for a decision that might take
          days without leaving a process hanging.
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
        title: "Add an approval gate to your workflow",
        body: "Pause a run for a human decision with full context, resume automatically on approval, and keep an audit trail of who decided what.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/use-cases/durable-ai-workflows",
        secondaryLabel: "How durable execution works",
      }}
    >
      <Section title="The problem: agents need judgment on the risky steps">
        <P>
          Most agent workflows are safe to automate end to end — until one step isn&apos;t. Issuing a refund, sending an
          external email, changing a production config, or approving spend often needs a human to look first. A good
          human-in-the-loop design covers:
        </P>
        <Bullets
          items={[
            <><Term>Approval gates</Term> before irreversible or high-impact actions.</>,
            <><Term>Manual review</Term> of an agent&apos;s proposed action, with the context that produced it.</>,
            <><Term>Workflow suspension</Term> at the gate, and clean <Term>continuation</Term> after a decision.</>,
            <><Term>Auditability</Term> — who approved what, when, and why.</>,
            <><Term>Approval timeouts</Term> so a run doesn&apos;t wait forever.</>,
            <><Term>Escalation</Term> to a backup approver when the first doesn&apos;t respond.</>,
          ]}
        />
      </Section>

      <Section eyebrow="Concept" title="Why a paused run shouldn't hold a worker">
        <P>
          The naive implementation blocks: the workflow calls something like <Term>await approval()</Term> and the
          worker sits there. That&apos;s fine for seconds and disastrous for days. It ties up a worker per pending
          approval, and if that worker restarts — a deploy, a crash, autoscaling — the paused run vanishes.
        </P>
        <H3>Suspension as durable state</H3>
        <P>
          The durable model treats the gate as a persisted checkpoint plus a pending decision. The run records
          &quot;waiting for approval at step N,&quot; releases the worker, and does nothing until a decision (or a
          timeout) wakes it. No process is pinned while a human takes their time.
        </P>
        <H3>Continuation and audit</H3>
        <P>
          When the decision arrives, the run resumes from the gate checkpoint. The decision — approve or reject, by
          whom, when, with any note — becomes part of the run&apos;s immutable history, which is exactly what an audit
          later needs.
        </P>
      </Section>

      <Section eyebrow="How Vectorbea helps" title="Approval gates, without the idle worker">
        <KeyPoints
          items={[
            <><Term>Pause mid-run for a decision</Term> with the full context that led to it, so the approver isn&apos;t guessing.</>,
            <><Term>Suspend and resume durably.</Term> A gated run holds durable state, not a live process, and continues automatically on approval.</>,
            <><Term>Complete audit trail.</Term> Every approval request and decision is recorded in the run&apos;s immutable event history.</>,
            <><Term>Survives restarts.</Term> A pending approval isn&apos;t lost to a deploy or worker restart — it resumes where it paused.</>,
          ]}
        />
        <Callout title="The point">
          A human approval step should cost you a database row, not a blocked worker. That&apos;s what makes
          &quot;wait for a person&quot; a first-class, reliable step in an agent workflow.
        </Callout>
      </Section>

      <Section eyebrow="FAQ" title="Human-in-the-loop AI — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
