import { SITE, absoluteUrl } from "@/lib/seo";
import { USE_CASES, COMPARISONS, getUseCasePath, comparisonPath } from "@/lib/marketing/pages";

export const dynamic = "force-static";

/**
 * /llms.txt — a lightweight, machine-readable index of Vectorbea's key public
 * pages for AI/LLM-based discovery. Supplementary to robots.txt + sitemap.xml,
 * never a replacement. Generated from the same page registry so it stays honest.
 */
export function GET() {
  const lines: string[] = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    "Vectorbea is a control plane for durable, long-running agentic AI workflows:",
    "checkpoints, automatic retries, human approvals, observability and resume-from-failure recovery.",
    "",
    "## Key pages",
    `- [Overview](${SITE.url}): ${SITE.tagline}`,
    `- [Documentation](${absoluteUrl("/docs")}): concepts and first-workflow guide`,
    `- [Use cases](${absoluteUrl("/use-cases")}): engineering deep dives`,
    `- [Compare](${absoluteUrl("/compare")}): how Vectorbea relates to other tools`,
    `- [Engineering blog](${SITE.blogUrl}): engineering notes (separate site)`,
    "",
    "## Use cases",
    ...USE_CASES.map((p) => `- [${p.title}](${absoluteUrl(getUseCasePath(p.slug))}): ${p.description}`),
    "",
    "## Comparisons",
    ...COMPARISONS.map((p) => `- [${p.title}](${absoluteUrl(comparisonPath(p.slug))}): ${p.description}`),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
