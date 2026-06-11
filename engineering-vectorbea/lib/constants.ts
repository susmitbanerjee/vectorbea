export const SITE = {
  name: "Vectorbea Engineering",
  shortName: "Vectorbea Eng",
  tagline: "Engineering durable AI workflows.",
  description:
    "Engineering notes from the team building Vectorbea, a durable, long-running visual agentic workflow builder. Execution guarantees, retries, checkpoints, approvals, BYOK, and worker orchestration.",
  url: "https://engineering.vectorbea.com",
  mainSiteUrl: "https://vectorbea.com",
  githubUrl: "https://github.com/vectorbea",
  linkedinUrl: "https://www.linkedin.com/company/vectorbea",
  rssPath: "/rss.xml",
  author: {
    name: "Susmit Banerjee",
    title: "Backend Engineer, Vectorbea",
    bio: "Backend engineer with 9+ years building distributed systems in Java and Kotlin. Building Vectorbea's execution engine, worker orchestration, and event history.",
  },
};

export const NAV_LINKS = [
  { href: "/articles", label: "Articles" },
  { href: "/architecture", label: "Architecture" },
  { href: "/rfcs", label: "RFCs" },
  { href: "/experiments", label: "Experiments" },
  { href: "/about", label: "About" },
];

export const CATEGORIES = [
  "Execution Engine",
  "Reliability",
  "Agentic Systems",
  "Security",
  "Infrastructure",
  "Lessons",
  "RFC",
  "Experiment",
] as const;

export const SERIES = {
  "building-vectorbea": {
    title: "Building Vectorbea",
    description:
      "A running series on the design and engineering decisions behind Vectorbea's durable execution engine: from event history to approval gates to BYOK.",
  },
};
