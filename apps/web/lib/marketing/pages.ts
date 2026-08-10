/**
 * Registry of Vectorbea's SEO landing pages (use cases + comparisons).
 *
 * Single source of truth for:
 *   - sitemap.ts (URLs + stable lastModified)
 *   - internal linking / topic clusters (related links, nav, footer)
 *   - each page's own title/description metadata
 *
 * `lastModified` is a real, hand-set authored date — NOT `new Date()` — so the
 * sitemap doesn't lie about freshness on every deploy. Bump it only when a
 * page's content genuinely changes.
 */

export interface MarketingPage {
  slug: string;
  /** Page topic used in <title> ("<title> | Vectorbea") and nav. */
  title: string;
  /** Short label for compact nav/related lists. */
  navLabel: string;
  description: string;
  /** Slugs of related pages in the same topic cluster (internal linking). */
  related: string[];
  /** ISO date the content was authored/last meaningfully changed. */
  lastModified: string;
}

const AUTHORED = "2026-08-10";

export const USE_CASES: MarketingPage[] = [
  {
    slug: "durable-ai-workflows",
    title: "Durable AI Workflows",
    navLabel: "Durable AI workflows",
    description:
      "Why production AI workflows need durable execution, and how checkpoints, retries and resumability keep multi-step agent runs from losing work when things fail.",
    related: ["long-running-ai-agents", "ai-workflow-failure-recovery", "human-in-the-loop-ai"],
    lastModified: AUTHORED,
  },
  {
    slug: "long-running-ai-agents",
    title: "Long-Running AI Agents",
    navLabel: "Long-running AI agents",
    description:
      "Architecture for AI agents that run for minutes, hours or days — surviving worker restarts, deployments, rate limits and approval pauses without keeping a process alive.",
    related: ["durable-ai-workflows", "human-in-the-loop-ai", "ai-workflow-failure-recovery"],
    lastModified: AUTHORED,
  },
  {
    slug: "ai-agent-orchestration",
    title: "AI Agent Orchestration",
    navLabel: "AI agent orchestration",
    description:
      "Coordinate multi-step and multi-agent workflows: tool execution, parallel branches, retries and approvals — with a durable execution layer underneath every step.",
    related: ["durable-ai-workflows", "ai-workflow-observability", "long-running-ai-agents"],
    lastModified: AUTHORED,
  },
  {
    slug: "human-in-the-loop-ai",
    title: "Human-in-the-Loop AI Workflows",
    navLabel: "Human-in-the-loop AI",
    description:
      "Add approval gates to agent workflows without keeping a worker alive while you wait. Suspend on a decision, resume on approval, and keep a full audit trail.",
    related: ["durable-ai-workflows", "ai-workflow-failure-recovery", "ai-workflow-observability"],
    lastModified: AUTHORED,
  },
  {
    slug: "ai-workflow-observability",
    title: "AI Workflow Observability",
    navLabel: "AI workflow observability",
    description:
      "Debug agent workflows with an execution timeline: every node, tool call and LLM request with inputs, outputs, latency, retries, tokens and cost — replayable end to end.",
    related: ["ai-workflow-failure-recovery", "ai-agent-orchestration", "durable-ai-workflows"],
    lastModified: AUTHORED,
  },
  {
    slug: "ai-workflow-failure-recovery",
    title: "AI Workflow Failure Recovery",
    navLabel: "AI workflow failure recovery",
    description:
      "Retry policies, backoff, idempotency and checkpointing for AI workflows — so a failed run resumes from the last good state instead of restarting from scratch.",
    related: ["durable-ai-workflows", "long-running-ai-agents", "ai-workflow-observability"],
    lastModified: AUTHORED,
  },
];

export const COMPARISONS: MarketingPage[] = [
  {
    slug: "langgraph",
    title: "Vectorbea and LangGraph",
    navLabel: "LangGraph",
    description:
      "How LangGraph's in-process agent graphs and Vectorbea's managed durable execution relate — where they overlap, where they differ, and how they can complement each other in production.",
    related: ["temporal", "n8n"],
    lastModified: AUTHORED,
  },
  {
    slug: "temporal",
    title: "Vectorbea and Temporal",
    navLabel: "Temporal",
    description:
      "General-purpose durable execution (Temporal) vs an AI-native workflow layer. Where a Temporal-style engine fits, and where AI-specific abstractions for LLM calls, tools and approvals help.",
    related: ["langgraph", "n8n"],
    lastModified: AUTHORED,
  },
  {
    slug: "n8n",
    title: "Vectorbea and n8n",
    navLabel: "n8n",
    description:
      "Automation platforms like n8n vs durable AI application execution: failure semantics, long-running agents, workflow state and AI-specific debugging for production agent systems.",
    related: ["langgraph", "temporal"],
    lastModified: AUTHORED,
  },
];

const BY_SLUG: Record<string, MarketingPage> = Object.fromEntries(
  [...USE_CASES, ...COMPARISONS].map((p) => [p.slug, p]),
);

export function getUseCase(slug: string): MarketingPage | undefined {
  return USE_CASES.find((p) => p.slug === slug);
}
export function comparisonBySlug(slug: string): MarketingPage | undefined {
  return COMPARISONS.find((p) => p.slug === slug);
}

export function getUseCasePath(slug: string): string {
  return `/use-cases/${slug}`;
}
export function comparisonPath(slug: string): string {
  return `/compare/${slug}`;
}

/** Resolve a slug (either group) to its canonical site path. */
export function pathForSlug(slug: string): string {
  if (getUseCase(slug)) return getUseCasePath(slug);
  if (comparisonBySlug(slug)) return comparisonPath(slug);
  return "/";
}

/** Look up any registered page by slug (either group). */
export function pageBySlug(slug: string): MarketingPage | undefined {
  return BY_SLUG[slug];
}
