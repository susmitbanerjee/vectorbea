import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { SITE } from "@/lib/constants";

export const metadata: Metadata = buildMetadata({
  title: "About",
  description: "About Vectorbea Engineering and its author, Susmit Banerjee.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-article px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">About</h1>

      <div className="prose prose-slate mt-8 max-w-none">
        <h2>What this is</h2>
        <p>
          Vectorbea Engineering is a public engineering blog written by the team building{" "}
          <a href={SITE.mainSiteUrl}>Vectorbea</a>, a durable, long-running visual agentic workflow
          builder. Vectorbea itself is a private product — this blog is where we write about the
          engineering decisions, tradeoffs, and mistakes behind it, in the kind of detail we'd want
          to read ourselves.
        </p>
        <p>
          We write about durable execution, checkpointing, retries and resume, event history,
          human approval gates, BYOK key management, worker orchestration over Redis Streams, cost
          budgets, rate limits, and the occasional retrospective on what we got wrong.
        </p>

        <h2>About the author</h2>
        <p>
          <strong>{SITE.author.name}</strong> is a backend engineer with 9+ years building
          distributed systems in Java and Kotlin. At Vectorbea, Susmit works on the execution
          engine, worker orchestration, and event history — the durability layer that the rest of
          the product sits on top of.
        </p>

        <h2>Why we write this</h2>
        <p>
          Most of what we learn building Vectorbea comes from reading other teams' write-ups about
          systems they've shipped — the honest ones, with the parts that didn't work included. This
          is our attempt to return the favor. We try to be specific about what we built, why, and
          what we'd do differently, without overselling the scale we're operating at. We're a small
          team; these are notes from the trenches, not claims of having solved distributed systems.
        </p>

        <h2>Get in touch</h2>
        <p>
          Find us on <a href={SITE.githubUrl}>GitHub</a> and{" "}
          <a href={SITE.linkedinUrl}>LinkedIn</a>, or subscribe via{" "}
          <a href={SITE.rssPath}>RSS</a>. For the product itself, visit{" "}
          <a href={SITE.mainSiteUrl}>vectorbea.com</a>.
        </p>
      </div>
    </div>
  );
}
