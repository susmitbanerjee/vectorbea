import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { Callout, Code, InlineCode, Step } from "@/components/docs/prose";

export const metadata = {
  title: "Node.js SDK — VectorBea Docs",
};

export default function NodeSdkPage() {
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 py-4 lg:py-8">

      {/* Hero */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#339933" }} />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Node.js SDK
          </p>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          VectorBea for Node.js
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          The official JavaScript / TypeScript SDK. Works with Node.js 18+,
          Deno, Bun, and any framework — Express, Fastify, Next.js, NestJS.
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Requires the sidecar running on{" "}
          <InlineCode>localhost:8080</InlineCode> —{" "}
          <Link
            href="/docs/quickstart#step-5"
            className="text-primary underline-offset-4 hover:underline"
          >
            run it first
          </Link>
        </div>
      </section>

      {/* Step 1 — Install */}
      <Step id="install" n={1} title="Install">
        <Code lang="bash">{`npm install @vectorbea-ai/node`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          The package ships full TypeScript types — no separate{" "}
          <InlineCode>@types/</InlineCode> package needed.
        </p>
      </Step>

      {/* Step 2 — Fetch */}
      <Step id="fetch" n={2} title="Fetch your first prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          Create a file called <InlineCode>testPrompt.mjs</InlineCode>, paste
          the script below, and run it.
        </p>
        <Code lang="javascript">{`import { VectorBeaClient } from "@vectorbea-ai/node";

const client = new VectorBeaClient({
  apiKey:  "any-value",             // not validated by the local sidecar
  baseUrl: "http://localhost:8080",
});

// Fetch the latest published version by name.
// Automatically records an audit event on every get().
const prompt = await client.prompts.get("greet-user");

console.log("Name:    ", prompt.name);           // greet-user
console.log("Version: ", prompt.versionTag);     // v1.0.0
console.log("Template:", prompt.templateText);   // Hello {{name}}, welcome to {{product}}!

// Render the template with your own variables
const message = prompt.compile({ name: "Alice", product: "Acme AI" });
console.log("Rendered:", message);               // Hello Alice, welcome to Acme AI!`}</Code>
        <Code lang="bash">{`node testPrompt.mjs`}</Code>

        <p className="text-sm font-medium">Expected output</p>
        <Code>{`Name:     greet-user
Version:  v1.0.0
Template: Hello {{name}}, welcome to {{product}}!
Rendered: Hello Alice, welcome to Acme AI!`}</Code>

        <Callout kind="info">
          Every <InlineCode>client.prompts.get()</InlineCode> call
          automatically records an audit event. Check{" "}
          <strong>Audit logs</strong> in the dashboard — your fetch should
          appear within a few seconds.
        </Callout>
      </Step>

      {/* Step 3 — Telemetry */}
      <Step id="telemetry" n={3} title="Report LLM telemetry (optional)">
        <p className="text-sm leading-7 text-muted-foreground">
          After calling your LLM, pass the response metadata back so the
          dashboard shows end-to-end latency and token cost per request.
        </p>
        <Code lang="javascript">{`import { VectorBeaClient } from "@vectorbea-ai/node";

const client = new VectorBeaClient({
  apiKey:  "any-value",
  baseUrl: "http://localhost:8080",
});

const prompt  = await client.prompts.get("greet-user");
const message = prompt.compile({ name: "Alice", product: "Acme AI" });

// Call your LLM (OpenAI shown — swap for any provider)
const t0 = Date.now();
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: message }],
});
const llmMs = Date.now() - t0;

// Log the full audit event — appears in Audit logs
await client.prompts.logAudit(prompt, {
  llmLatencyMs: llmMs,
  tokenCount: response.usage.total_tokens,
  metadata: { model: "gpt-4o" },
});`}</Code>
      </Step>

      {/* Step 4 — Production */}
      <Step id="production" n={4} title="Moving to production">
        <p className="text-sm leading-7 text-muted-foreground">
          For production, omit <InlineCode>baseUrl</InlineCode> and supply a
          real workspace API key. Generate one from{" "}
          <strong>API keys</strong> in the sidebar.
        </p>
        <Code lang="bash">{`export VECTORBEA_API_KEY="vb_live_..."`}</Code>
        <Code lang="javascript">{`import { VectorBeaClient } from "@vectorbea-ai/node";

// Reads VECTORBEA_API_KEY from process.env automatically.
// baseUrl defaults to https://vectorbea.com
const client = new VectorBeaClient();

const prompt  = await client.prompts.get("greet-user");
const message = prompt.compile({ name: "Bob", product: "Acme AI" });`}</Code>
        <Callout kind="info">
          In production, run the sidecar alongside your service and point the
          SDK at <InlineCode>{`baseUrl: "http://localhost:8080"`}</InlineCode>.
          Your prompts never leave your network — the control plane only
          receives heartbeats and audit metadata.
        </Callout>
      </Step>

      {/* Next steps */}
      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { href: "/docs/sdk/python",      label: "Python SDK",    desc: "Python equivalent" },
            { href: "/docs/sdk/kotlin",       label: "Kotlin SDK",    desc: "JVM / Android equivalent" },
            { href: "/docs/architecture",    label: "Architecture",  desc: "How the sidecar and control plane work together" },
            { href: "/docs/integrations",    label: "Integrations",  desc: "Express, Fastify, and container deployment patterns" },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href as Route}
              className="group flex flex-col gap-1 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="text-sm font-semibold text-foreground group-hover:text-primary">
                {c.label} <ArrowRight className="inline h-3.5 w-3.5" />
              </span>
              <span className="text-xs text-muted-foreground">{c.desc}</span>
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
