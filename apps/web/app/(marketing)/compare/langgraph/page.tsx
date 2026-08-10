import type { Metadata } from "next";
import {
  MarketingPageShell, Section, P, Lead, H3, KeyPoints, Callout, CompareTable, Faq, Term,
} from "@/components/marketing/content";
import { createMetadata, articleSchema, faqSchema } from "@/lib/seo";
import { comparisonBySlug, pageBySlug, pathForSlug, comparisonPath } from "@/lib/marketing/pages";

const page = comparisonBySlug("langgraph")!;

export const metadata: Metadata = createMetadata({
  title: "Vectorbea and LangGraph: Production AI Workflow Orchestration",
  description: page.description,
  path: comparisonPath(page.slug),
  type: "article",
  modifiedTime: page.lastModified,
});

const faqs = [
  {
    question: "Is Vectorbea a LangGraph alternative?",
    answer:
      "They operate at different layers. LangGraph is a framework for authoring stateful agent graphs in code. Vectorbea is a managed durable execution control plane for running agent workflows in production. You can use Vectorbea instead of building your own durability/observability, or alongside LangGraph by running LangGraph-built agents as steps.",
  },
  {
    question: "Can I use LangGraph and Vectorbea together?",
    answer:
      "Yes. Vectorbea orchestrates and observes HTTP-callable agents, including agents built with frameworks like LangGraph, CrewAI or AutoGen. You keep your agent logic where it is and get durable execution, retries, approvals and observability around it.",
  },
  {
    question: "When should I use LangGraph directly?",
    answer:
      "When you want to express intricate agent control flow in Python or JavaScript in your own runtime, with tight LangChain integration and full control over the process. If you then need managed durability and operational visibility in production, that's where a control plane like Vectorbea fits.",
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
      eyebrow="Compare · LangGraph"
      h1="Vectorbea and LangGraph"
      lead={
        <Lead>
          LangGraph and Vectorbea are often mentioned together, but they solve different parts of the problem. LangGraph
          helps you <Term>author</Term> stateful agent graphs; Vectorbea helps you <Term>run</Term> agent workflows
          durably in production. Here&apos;s how they relate — and how they can work together.
        </Lead>
      }
      breadcrumbs={[
        { name: "Vectorbea", path: "/" },
        { name: "Compare", path: "/compare" },
        { name: "LangGraph", path: comparisonPath(page.slug) },
      ]}
      jsonLd={[
        articleSchema({ headline: "Vectorbea and LangGraph", description: page.description, path: comparisonPath(page.slug), dateModified: page.lastModified }),
        faqSchema(faqs),
      ]}
      related={related}
      cta={{
        title: "Run your agents durably",
        body: "Bring an agent — including one built with LangGraph — and give it durable execution, retries, approvals and a full run history.",
        primaryHref: "/signup",
        primaryLabel: "Start free",
        secondaryHref: "/use-cases/ai-agent-orchestration",
        secondaryLabel: "Agent orchestration",
      }}
    >
      <Section title="What LangGraph is good at">
        <P>
          LangGraph is an open-source framework for building stateful, multi-actor LLM applications as graphs of nodes
          and edges. It gives you a clean way to express agent control flow — loops, branches, shared state — in code,
          with strong integration into the LangChain ecosystem and pluggable checkpointers for persistence and
          human-in-the-loop.
        </P>
        <KeyPoints
          items={[
            "Expressive graph API for complex agent control flow in Python/JavaScript.",
            "Runs in your own process and runtime — full control over the environment.",
            "Tight LangChain integration and a large ecosystem of components.",
            "Checkpointer backends enable memory and human-in-the-loop patterns.",
          ]}
        />
      </Section>

      <Section title="What Vectorbea is designed for">
        <P>
          Vectorbea is a managed control plane for long-running, agentic workflows. Rather than a library you assemble
          and host, it operates the durable execution layer for you: every node checkpoints, failures retry and resume,
          approvals suspend and continue, and every run has an immutable, replayable history with token and cost
          visibility.
        </P>
        <KeyPoints
          items={[
            "Durable execution and resume-from-checkpoint as the default, operated for you.",
            "Per-node retries with backoff, and human approval gates that don't pin a worker.",
            "Immutable event history you can replay, plus live tokens and cost per run.",
            "A visual canvas to compose and observe multi-step workflows.",
          ]}
        />
      </Section>

      <Section eyebrow="Side by side" title="Where they overlap and differ">
        <P>Both model agent work as a graph and both support persistence and human-in-the-loop. The difference is layer and operating model:</P>
        <CompareTable
          head={["Dimension", "LangGraph", "Vectorbea"]}
          rows={[
            ["What it is", "Open-source framework for authoring agent graphs", "Managed control plane for running agent workflows"],
            ["Where it runs", "In your own process/runtime", "Operated platform with its own workers"],
            ["Durability", "Via checkpointer backends you configure", "Built-in: every node checkpoints; runs resume automatically"],
            ["Failure handling", "You implement retry/resume around the graph", "Per-node retries, backoff and resume as defaults"],
            ["Observability", "Bring your own / LangChain tooling", "Built-in run timeline, replay, tokens and cost"],
            ["Best when", "You want full control of agent logic in code", "You want managed durability + operational visibility"],
          ]}
        />
      </Section>

      <Section title="Can they complement each other?">
        <H3>Yes — different layers</H3>
        <P>
          Vectorbea orchestrates and observes HTTP-callable agents, including those built with LangGraph. A common shape
          is to keep intricate agent logic in LangGraph and run it as a step inside a Vectorbea workflow, gaining durable
          execution, approvals, retries and a replayable history without rewriting the agent.
        </P>
        <Callout title="A fair summary">
          LangGraph is a strong way to build agent logic. Vectorbea is a way to run agent workflows durably in
          production. Choosing one doesn&apos;t rule out the other — many teams will want both.
        </Callout>
      </Section>

      <Section eyebrow="FAQ" title="Vectorbea and LangGraph — FAQ">
        <Faq items={faqs} />
      </Section>
    </MarketingPageShell>
  );
}
