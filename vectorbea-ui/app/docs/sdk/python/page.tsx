import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { Callout, Code, InlineCode, Step } from "@/components/docs/prose";

export const metadata = {
  title: "Python SDK — VectorBea Docs",
};

export default function PythonSdkPage() {
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 py-4 lg:py-8">

      {/* Hero */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#3776AB" }} />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Python SDK
          </p>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          VectorBea for Python
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          The official Python SDK. Works with Python 3.8+ and any framework —
          FastAPI, Django, Flask, or plain scripts.
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
        <Code lang="bash">{`pip install vectorbea`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          You need <strong>0.2.0 or later</strong> for automatic audit
          reporting. Verify and upgrade if needed:
        </p>
        <Code lang="bash">{`pip show vectorbea
pip install --upgrade vectorbea`}</Code>
      </Step>

      {/* Step 2 — Fetch */}
      <Step id="fetch" n={2} title="Fetch your first prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          Create a file called <InlineCode>test_prompt.py</InlineCode>, paste
          the script below, and run it.
        </p>
        <Code lang="python">{`from vectorbea import VectorBeaClient

client = VectorBeaClient(
    api_key="any-value",            # not validated by the local sidecar
    base_url="http://localhost:8080",
)

# Fetch the latest published version by name.
# 0.2.0+ automatically records an audit event on every get().
prompt = client.prompts.get("greet-user")

print("Name:    ", prompt.name)            # greet-user
print("Version: ", prompt.version_tag)     # v1.0.0
print("Template:", prompt.template_text)   # Hello {{name}}, welcome to {{product}}!

# Render the template with your own variables
message = prompt.compile({"name": "Alice", "product": "Acme AI"})
print("Rendered:", message)                # Hello Alice, welcome to Acme AI!`}</Code>
        <Code lang="bash">{`python test_prompt.py`}</Code>

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
        <Code lang="python">{`import time
from vectorbea import VectorBeaClient

client = VectorBeaClient(
    api_key="any-value",
    base_url="http://localhost:8080",
)

prompt  = client.prompts.get("greet-user")
message = prompt.compile({"name": "Alice", "product": "Acme AI"})

# Call your LLM (OpenAI shown — swap for any provider)
t0 = time.time()
response = openai_client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": message}],
)
llm_ms = int((time.time() - t0) * 1000)

# Log the full audit event — appears in Audit logs
client.prompts.log_audit(
    prompt,
    llm_latency_ms=llm_ms,
    token_count=response.usage.total_tokens,
    metadata={"model": "gpt-4o"},
)`}</Code>
      </Step>

      {/* Step 4 — Production */}
      <Step id="production" n={4} title="Moving to production">
        <p className="text-sm leading-7 text-muted-foreground">
          For production, omit <InlineCode>base_url</InlineCode> and supply a
          real workspace API key. Generate one from{" "}
          <strong>API keys</strong> in the sidebar.
        </p>
        <Code lang="bash">{`export VECTORBEA_API_KEY="vb_live_..."`}</Code>
        <Code lang="python">{`from vectorbea import VectorBeaClient

# Reads VECTORBEA_API_KEY from the environment automatically.
# base_url defaults to https://vectorbea.com
client = VectorBeaClient()

prompt  = client.prompts.get("greet-user")
message = prompt.compile({"name": "Bob", "product": "Acme AI"})`}</Code>
        <Callout kind="info">
          In production, run the sidecar as a container alongside your service
          and point the SDK at <InlineCode>base_url="http://localhost:8080"</InlineCode>.
          Your prompts never leave your network — the control plane only
          receives heartbeats and audit metadata.
        </Callout>
      </Step>

      {/* Next steps */}
      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { href: "/docs/sdk/nodejs",      label: "Node.js SDK",   desc: "JavaScript / TypeScript equivalent" },
            { href: "/docs/architecture",    label: "Architecture",  desc: "How the sidecar and control plane work together" },
            { href: "/docs/integrations",    label: "Integrations",  desc: "FastAPI, Django, and container deployment patterns" },
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
