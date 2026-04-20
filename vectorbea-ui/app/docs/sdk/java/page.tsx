import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { Callout, Code, InlineCode, Step } from "@/components/docs/prose";

export const metadata = {
  title: "Java SDK — VectorBea Docs",
};

export default function JavaSdkPage() {
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 py-4 lg:py-8">

      {/* Hero */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#ED8B00" }} />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Java SDK
          </p>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          VectorBea for Java
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          The official JVM SDK — written in Kotlin, fully compatible with Java
          17+. Works with Spring Boot, Micronaut, Quarkus, and plain Java
          applications.
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
          Maven — pom.xml
        </p>
        <Code lang="xml">{`<dependency>
  <groupId>com.vectorbea</groupId>
  <artifactId>vectorbea-jvm-sdk</artifactId>
  <version>0.2.1</version>
</dependency>`}</Code>

        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Gradle (Kotlin DSL) — build.gradle.kts
        </p>
        <Code lang="kotlin">{`implementation("com.vectorbea:vectorbea-jvm-sdk:0.2.1")`}</Code>

        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Gradle (Groovy) — build.gradle
        </p>
        <Code lang="groovy">{`implementation 'com.vectorbea:vectorbea-jvm-sdk:0.2.1'`}</Code>
      </Step>

      {/* Step 2 — Fetch */}
      <Step id="fetch" n={2} title="Fetch your first prompt">
        <Code lang="java">{`import com.vectorbea.sdk.VectorBeaClient;
import com.vectorbea.sdk.model.Prompt;
import java.util.Map;

public class TestPrompt {
    public static void main(String[] args) throws Exception {
        VectorBeaClient client = new VectorBeaClient.Builder()
            .apiKey("any-value")           // not validated by the local sidecar
            .baseUrl("http://localhost:8080")
            .build();

        // Fetch the latest published version by name.
        // Automatically records an audit event on every get().
        Prompt prompt = client.prompts().get("greet-user");

        System.out.println("Name:     " + prompt.getName());
        System.out.println("Version:  " + prompt.getVersionTag());
        System.out.println("Template: " + prompt.getTemplateText());

        // Render the template with your own variables
        String message = prompt.compile(Map.of(
            "name",    "Alice",
            "product", "Acme AI"
        ));
        System.out.println("Rendered: " + message);
    }
}`}</Code>

        <p className="text-sm font-medium">Expected output</p>
        <Code>{`Name:     greet-user
Version:  v1.0.0
Template: Hello {{name}}, welcome to {{product}}!
Rendered: Hello Alice, welcome to Acme AI!`}</Code>

        <Callout kind="info">
          Every <InlineCode>client.prompts().get()</InlineCode> call
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
        <Code lang="java">{`import com.vectorbea.sdk.VectorBeaClient;
import com.vectorbea.sdk.model.Prompt;
import java.util.Map;

VectorBeaClient client = new VectorBeaClient.Builder()
    .apiKey("any-value")
    .baseUrl("http://localhost:8080")
    .build();

Prompt prompt  = client.prompts().get("greet-user");
String message = prompt.compile(Map.of("name", "Alice", "product", "Acme AI"));

// Call your LLM (OpenAI shown — swap for any provider)
long t0 = System.currentTimeMillis();
// ... call your LLM here ...
long llmMs = System.currentTimeMillis() - t0;

// Log the full audit event — appears in Audit logs
client.prompts().logAudit(
    prompt,
    llmMs,
    response.usage().totalTokens(),
    Map.of("model", "gpt-4o")
);`}</Code>
      </Step>

      {/* Step 4 — Production */}
      <Step id="production" n={4} title="Moving to production">
        <p className="text-sm leading-7 text-muted-foreground">
          For production, use <InlineCode>fromEnvironment()</InlineCode> to
          read credentials from the environment. Generate a workspace API key
          from <strong>API keys</strong> in the sidebar.
        </p>
        <Code lang="bash">{`export VECTORBEA_API_KEY="vb_live_..."`}</Code>
        <Code lang="java">{`import com.vectorbea.sdk.VectorBeaClient;

// Reads VECTORBEA_API_KEY from the environment automatically.
// baseUrl defaults to https://vectorbea.com
VectorBeaClient client = new VectorBeaClient.Builder()
    .fromEnvironment()
    .build();

Prompt prompt  = client.prompts().get("greet-user");
String message = prompt.compile(Map.of("name", "Bob", "product", "Acme AI"));`}</Code>
        <Callout kind="info">
          In production, run the sidecar alongside your service and point the
          SDK at <InlineCode>{`.baseUrl("http://localhost:8080")`}</InlineCode>.
          Your prompts never leave your network.
        </Callout>
      </Step>

      {/* Next steps */}
      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { href: "/docs/sdk/kotlin",      label: "Kotlin SDK",    desc: "Idiomatic Kotlin version of this SDK" },
            { href: "/docs/sdk/python",      label: "Python SDK",    desc: "Python equivalent" },
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
