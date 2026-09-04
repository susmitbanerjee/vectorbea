/**
 * Docs information architecture — data only.
 *
 * Deliberately free of JSX and of "use client", because the route files are
 * Server Components that read titles, descriptions and slugs at build time for
 * generateStaticParams and generateMetadata. The prose lives in
 * ~/content/docs/bodies, joined by slug.
 */

export interface TocEntry {
  id: string;
  title: string;
  depth: 2 | 3;
}

export interface DocsPageMeta {
  slug: string;
  title: string;
  section: string;
  description: string;
  toc: TocEntry[];
}

export const DOCS_PAGES: DocsPageMeta[] = [
  {
    slug: "introduction",
    title: "Introduction",
    section: "Getting started",
    description: "What Vectorbea is, the problem it solves, and where it fits.",
    toc: [
      { id: "what-is", title: "What Vectorbea is", depth: 2 },
      { id: "problem", title: "The problem it solves", depth: 2 },
      { id: "lifecycle", title: "The shape of a run", depth: 2 },
      { id: "use-cases", title: "Where it fits", depth: 2 },
    ],
  },
  {
    slug: "core-concepts",
    title: "Core concepts",
    section: "Getting started",
    description: "Connections, agents, tools, approvals, workflows and runs.",
    toc: [
      { id: "connections", title: "Connections", depth: 2 },
      { id: "agents", title: "Agents", depth: 2 },
      { id: "tools", title: "Tools", depth: 2 },
      { id: "approvals", title: "Approvals", depth: 2 },
      { id: "workflows", title: "Workflows and runs", depth: 2 },
    ],
  },
  {
    slug: "first-workflow",
    title: "Your first workflow",
    section: "Building workflows",
    description:
      "From an empty canvas to a published, scheduled, gated workflow — then break it on purpose.",
    toc: [
      { id: "build", title: "Build the graph", depth: 2 },
      { id: "simulate", title: "Simulate before you publish", depth: 2 },
      { id: "publish", title: "Publish and schedule", depth: 2 },
      { id: "break-it", title: "Break it on purpose", depth: 2 },
    ],
  },
  {
    slug: "building-workflows",
    title: "The canvas",
    section: "Building workflows",
    description: "Node types, validation and versioning.",
    toc: [
      { id: "nodes", title: "Node types", depth: 2 },
      { id: "validation", title: "Validation before publish", depth: 2 },
      { id: "versions", title: "Versions", depth: 2 },
    ],
  },
  {
    slug: "io-mapping",
    title: "Unified I/O & mapping",
    section: "Building workflows",
    description:
      "Output schemas, binding inputs to upstream fields, coercion, and what happens when a mapping breaks.",
    toc: [
      { id: "output-schema", title: "The output schema of a node", depth: 2 },
      { id: "binding", title: "Binding an input", depth: 2 },
      { id: "coercion", title: "Type coercion", depth: 2 },
      { id: "broken", title: "When a mapping breaks", depth: 2 },
    ],
  },
  {
    slug: "agents-tools",
    title: "Agents & tools",
    section: "Building workflows",
    description: "Grants, risk tiers and the used-by index.",
    toc: [
      { id: "grants", title: "Tool grants", depth: 2 },
      { id: "risk", title: "Risk tiers", depth: 2 },
      { id: "used-by", title: "The used-by index", depth: 2 },
    ],
  },
  {
    slug: "connections-byok",
    title: "Connections & BYOK",
    section: "Operating",
    description: "Why bring your own keys, and exactly how they are stored.",
    toc: [
      { id: "why-byok", title: "Why bring your own keys", depth: 2 },
      { id: "storage", title: "How keys are stored", depth: 2 },
    ],
  },
  {
    slug: "running-observability",
    title: "Running & observability",
    section: "Operating",
    description: "Timelines, cost accounting and failure clustering.",
    toc: [
      { id: "timeline", title: "The event timeline", depth: 2 },
      { id: "cost", title: "Token and cost accounting", depth: 2 },
      { id: "clustering", title: "Failure clustering", depth: 2 },
    ],
  },
  {
    slug: "durability",
    title: "How durability works",
    section: "Operating",
    description:
      "The queue, leases, checkpoints, event sourcing and replay — and what each costs you when it is missing.",
    toc: [
      { id: "cost", title: "The cost argument", depth: 2 },
      { id: "queue", title: "The queue and the worker", depth: 2 },
      { id: "leases", title: "Leases", depth: 3 },
      { id: "checkpoints", title: "Checkpoints", depth: 2 },
      { id: "idempotency", title: "Idempotency keys", depth: 3 },
      { id: "event-sourcing", title: "Event sourcing and replay", depth: 2 },
      { id: "retries", title: "Retries and timeouts", depth: 2 },
    ],
  },
  {
    slug: "approvals",
    title: "Human approvals",
    section: "Operating",
    description: "Pausing a run for a person, without holding a worker.",
    toc: [
      { id: "context", title: "Decision context", depth: 2 },
      { id: "sla", title: "SLA and escalation", depth: 2 },
    ],
  },
  {
    slug: "triggers",
    title: "Triggers & schedules",
    section: "Operating",
    description: "Schedules, webhooks, manual starts and overlap policy.",
    toc: [
      { id: "schedules", title: "Schedules", depth: 2 },
      { id: "overlap", title: "Overlap policy", depth: 2 },
    ],
  },
  {
    slug: "ai-architect",
    title: "AI Architect",
    section: "Reference",
    description: "Describe a workflow; edit the blueprint before anything is created.",
    toc: [{ id: "blueprint", title: "The blueprint is editable", depth: 2 }],
  },
  {
    slug: "api-reference",
    title: "API reference",
    section: "Reference",
    description: "The HTTP API, with cURL, TypeScript and Python.",
    toc: [{ id: "start-run", title: "Start a run", depth: 2 }],
  },
  {
    slug: "security",
    title: "Security & compliance",
    section: "Reference",
    description: "Encryption, private runners and the audit trail.",
    toc: [
      { id: "encryption", title: "Encryption", depth: 2 },
      { id: "private-runners", title: "Private runners", depth: 2 },
      { id: "audit", title: "Audit trail", depth: 2 },
    ],
  },
];

/** Reading order. Drives the sidebar, prev/next and the ⌘K default list. */
export const DOCS_SECTIONS = [
  "Getting started",
  "Building workflows",
  "Operating",
  "Reference",
] as const;

export const DOCS_NAV = DOCS_SECTIONS.map((label) => ({
  label,
  items: DOCS_PAGES.filter((p) => p.section === label),
}));

export function getDocsPage(slug: string): DocsPageMeta | undefined {
  return DOCS_PAGES.find((p) => p.slug === slug);
}

/** `introduction` is served at /docs, not /docs/introduction. */
export function docsPath(slug: string): string {
  return slug === "introduction" ? "/docs" : `/docs/${slug}`;
}
