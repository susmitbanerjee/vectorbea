import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { Callout, Code, InlineCode, Step } from "@/components/docs/prose";

export const metadata = {
  title: "Kotlin SDK — VectorBea Docs",
};

// Kotlin string interpolation uses ${...} which conflicts with JS template literals.
// Use {"$"}{varName} to produce the literal characters ${ in the rendered output.

export default function KotlinSdkPage() {
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 py-4 lg:py-8">

      {/* Hero */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#7F52FF" }} />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Kotlin SDK
          </p>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          VectorBea for Kotlin
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          The official JVM SDK with idiomatic Kotlin APIs — coroutine-friendly,
          null-safe, and works on JVM 17+, Android, and Kotlin Multiplatform.
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
        <p className="text-sm leading-7 text-muted-foreground">
          Add the dependency to your build file. The artifact is published to
          Maven Central.
        </p>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Gradle (Kotlin DSL) — build.gradle.kts
        </p>
        <Code lang="kotlin">{`implementation("com.vectorbea:vectorbea-jvm-sdk:0.2.1")`}</Code>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Maven — pom.xml
        </p>
        <Code lang="xml">{`<dependency>
  <groupId>com.vectorbea</groupId>
  <artifactId>vectorbea-jvm-sdk</artifactId>
  <version>0.2.1</version>
</dependency>`}</Code>
      </Step>

      {/* Step 2 — Fetch */}
      <Step id="fetch" n={2} title="Fetch your first prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          Create a file called <InlineCode>TestPrompt.kt</InlineCode>, paste
          the script below, and run it.
        </p>
        <Code lang="kotlin">{`import com.vectorbea.sdk.VectorBeaClient

suspend fun main() {
    val client = VectorBeaClient(
        apiKey  = "any-value",           // not validated by the local sidecar
        baseUrl = "http://localhost:8080",
    )

    // Fetch the latest published version by name.
    // Automatically records an audit event on every get().
    val prompt = client.prompts.get("greet-user")

    println("Name:     ${"$"}{prompt.name}")
    println("Version:  ${"$"}{prompt.versionTag}")
    println("Template: ${"$"}{prompt.templateText}")

    // Render the template with your own variables
    val message = prompt.compile(mapOf(
        "name"    to "Alice",
        "product" to "Acme AI",
    ))
    println("Rendered: $message")
}`}</Code>

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
        <Code lang="kotlin">{`val client = VectorBeaClient(
    apiKey  = "any-value",
    baseUrl = "http://localhost:8080",
)

val prompt  = client.prompts.get("greet-user")
val message = prompt.compile(mapOf("name" to "Alice", "product" to "Acme AI"))

// Call your LLM (OpenAI shown — swap for any provider)
val t0 = System.currentTimeMillis()
// ... call your LLM here ...
val llmMs = System.currentTimeMillis() - t0

// Log the full audit event — appears in Audit logs
client.prompts.logAudit(
    prompt,
    llmLatencyMs = llmMs,
    tokenCount   = response.usage.totalTokens,
    metadata     = mapOf("model" to "gpt-4o"),
)`}</Code>
      </Step>

      {/* Step 4 — Production */}
      <Step id="production" n={4} title="Moving to production">
        <p className="text-sm leading-7 text-muted-foreground">
          For production, use <InlineCode>fromEnvironment()</InlineCode> to
          read credentials from the environment. Generate a workspace API key
          from <strong>API keys</strong> in the sidebar.
        </p>
        <Code lang="bash">{`export VECTORBEA_API_KEY="vb_live_..."`}</Code>
        <Code lang="kotlin">{`import com.vectorbea.sdk.VectorBeaClient

// Reads VECTORBEA_API_KEY from the environment automatically.
// baseUrl defaults to https://vectorbea.com
val client = VectorBeaClient.fromEnvironment()

val prompt  = client.prompts.get("greet-user")
val message = prompt.compile(mapOf("name" to "Bob", "product" to "Acme AI"))`}</Code>
        <Callout kind="info">
          In production, run the sidecar alongside your service and point the
          SDK at <InlineCode>baseUrl = "http://localhost:8080"</InlineCode>.
          Your prompts never leave your network.
        </Callout>
      </Step>

      {/* Next steps */}
      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { href: "/docs/sdk/java",        label: "Java SDK",      desc: "Same SDK, Java-style API" },
            { href: "/docs/sdk/nodejs",      label: "Node.js SDK",   desc: "JavaScript / TypeScript equivalent" },
            { href: "/docs/architecture",    label: "Architecture",  desc: "How the sidecar and control plane work together" },
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
