import type { Route } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";

import { Callout, Code, InlineCode, Step } from "@/components/docs/prose";
import {
  GoIcon,
  JavaIcon,
  KotlinIcon,
  NodeIcon,
  PythonIcon,
  RustIcon,
} from "@/components/docs/sdk-logo-icons";

export const metadata = {
  title: "Quickstart — VectorBea Docs",
};

// ─── Language card ────────────────────────────────────────────────────────────

function LangCard({
  href,
  Icon,
  name,
  install,
  soon,
}: {
  href: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  name: string;
  install?: string;
  soon?: boolean;
}) {
  return (
    <Link
      href={href as Route}
      className="group relative flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground group-hover:text-primary">
          <Icon size={16} className="shrink-0" />
          {name}
        </span>
        {soon ? (
          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            Soon
          </span>
        ) : (
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
        )}
      </div>
      {install && (
        <code className="rounded bg-muted/60 px-2 py-1 text-[11px] font-mono text-muted-foreground">
          {install}
        </code>
      )}
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuickstartPage() {
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 py-4 lg:py-8">

      {/* Hero */}
      <section className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Quickstart
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          From zero to live prompt in 15 minutes
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Pull the VectorBea sidecar, publish your first prompt, then pick your
          language SDK and start fetching in real time.
        </p>
      </section>

      {/* Prerequisites */}
      <section id="before-you-start" className="space-y-3 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Before you start</h2>
        <p className="text-sm text-muted-foreground">
          You only need two things installed. Everything else is handled by VectorBea.
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "Docker Desktop — download from docker.com/get-started",
            "The runtime for your chosen SDK — Python 3.8+, Node.js 18+, or Java 17+",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
        <Callout kind="info">
          The VectorBea sidecar image is a multi-arch manifest — the same{" "}
          <InlineCode>docker pull</InlineCode> and{" "}
          <InlineCode>docker run</InlineCode> commands work on Intel / AMD,
          Apple Silicon (M1–M4 Max/Pro/Ultra), and AWS Graviton. Docker selects
          the correct native layer automatically.
        </Callout>
      </section>

      {/* Step 1 */}
      <Step id="step-1" n={1} title="Create a workspace">
        <p className="text-sm leading-7 text-muted-foreground">
          Sign in to{" "}
          <a
            href="https://vectorbea.com"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            vectorbea.com
          </a>{" "}
          and complete onboarding. Give your workspace a name — this groups all
          your prompts and sidecars together.
        </p>
        <p className="text-sm leading-7 text-muted-foreground">
          Once the workspace is created you land on the dashboard. You are
          ready for the next step.
        </p>
      </Step>

      {/* Step 2 */}
      <Step id="step-2" n={2} title="Create and publish a prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          Click <strong>Prompts</strong> in the left sidebar, then{" "}
          <strong>New prompt</strong>. Fill in the fields:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-7 text-muted-foreground">
          <li>
            <strong>Name</strong> — use something like{" "}
            <InlineCode>greet-user</InlineCode> (no spaces; hyphens are fine)
          </li>
          <li>
            <strong>Template</strong> — paste the text below
          </li>
        </ul>
        <Code>{`Hello {{name}}, welcome to {{product}}!`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          Click <strong>Save</strong>, then click <strong>Publish</strong>.
          The sidecar only serves <em>published</em> versions — a draft is
          invisible to it.
        </p>
        <Callout kind="warn">
          You must click <strong>Publish</strong>, not just Save. If you skip
          this the sidecar returns a 404 and the SDK raises a{" "}
          <InlineCode>NotFoundError</InlineCode>.
        </Callout>
      </Step>

      {/* Step 3 */}
      <Step id="step-3" n={3} title="Pull the sidecar image">
        <p className="text-sm leading-7 text-muted-foreground">
          Open a terminal and run the command below. Docker automatically pulls
          the correct native layer for your machine — no{" "}
          <InlineCode>--platform</InlineCode> flag needed.
        </p>
        <Code lang="bash">{`docker pull vectorbea/vectorbea-proxy:latest`}</Code>
        <Callout kind="info">
          The pull is roughly 150 MB. You only need to do this once — Docker
          reuses the cached image on every subsequent run.
        </Callout>
      </Step>

      {/* Step 4 */}
      <Step id="step-4" n={4} title="Register a sidecar and copy the token">
        <p className="text-sm leading-7 text-muted-foreground">
          Go to <strong>Infrastructure</strong> in the dashboard and click{" "}
          <strong>Register sidecar</strong>. Give it a name like{" "}
          <InlineCode>local-dev</InlineCode>, then click{" "}
          <strong>Generate token</strong>.
        </p>
        <p className="text-sm leading-7 text-muted-foreground">
          A <InlineCode>vbagent_…</InlineCode> string appears in the dialog.{" "}
          <strong>Copy it now.</strong>
        </p>
        <Callout kind="warn">
          <strong>This token is shown exactly once.</strong> If you close the
          dialog without copying it you must delete the sidecar and register a
          new one. Never commit it to source control.
        </Callout>
        <Callout kind="warn">
          <strong>Tokens are workspace-scoped.</strong> The sidecar can only
          fetch prompts that belong to the workspace it was registered in. If
          your prompt is in workspace A but the sidecar is in workspace B, every
          fetch returns a 404.
        </Callout>
      </Step>

      {/* Step 5 */}
      <Step id="step-5" n={5} title="Run the sidecar container">
        <p className="text-sm leading-7 text-muted-foreground">
          Replace <InlineCode>vbagent_your_token_here</InlineCode> with the
          token you copied.
        </p>
        <Code lang="bash">{`docker run --rm -p 8080:8080 \\
  -e VECTORBEA_HUB_URL="https://vectorbea.com" \\
  -e VECTORBEA_KEY="vbagent_your_token_here" \\
  -e VECTORBEA_HTTP_PORT="8080" \\
  vectorbea/vectorbea-proxy:latest`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          Within a few seconds you will see:
        </p>
        <Code>{`vectorbea sidecar ready — REST unix:/tmp/vectorbea-rest.sock, HTTP :8080, gRPC unix:/tmp/vectorbea.sock`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          The sidecar status in the dashboard changes from{" "}
          <strong>Pending → Online</strong> within ~5 seconds. Keep this
          terminal open while you run the SDK steps.
        </p>
        <Callout kind="info">
          To run in the background add <InlineCode>-d</InlineCode> after{" "}
          <InlineCode>docker run</InlineCode> and use{" "}
          <InlineCode>docker logs &lt;container-id&gt;</InlineCode> to view
          output.
        </Callout>
      </Step>

      {/* Step 6 — SDK choice */}
      <Step id="step-6" n={6} title="Choose your SDK">
        <p className="text-sm leading-7 text-muted-foreground">
          Open a <strong>new</strong> terminal and follow the guide for your
          preferred language. Each guide covers installation, fetching a prompt,
          reporting LLM telemetry, and moving to production.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <LangCard
            href="/docs/sdk/python"
            Icon={PythonIcon}
            name="Python"
            install="pip install vectorbea"
          />
          <LangCard
            href="/docs/sdk/nodejs"
            Icon={NodeIcon}
            name="Node.js"
            install="npm install @vectorbea-ai/node"
          />
          <LangCard
            href="/docs/sdk/java"
            Icon={JavaIcon}
            name="Java"
            install="com.vectorbea:vectorbea-jvm-sdk:0.2.1"
          />
          <LangCard
            href="/docs/sdk/kotlin"
            Icon={KotlinIcon}
            name="Kotlin"
            install="com.vectorbea:vectorbea-jvm-sdk:0.2.1"
          />
          <LangCard
            href="/docs/sdk/go"
            Icon={GoIcon}
            name="Go"
            soon
          />
          <LangCard
            href="/docs/sdk/rust"
            Icon={RustIcon}
            name="Rust"
            soon
          />
        </div>
      </Step>

      {/* Troubleshooting */}
      <section id="troubleshooting" className="space-y-4 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Troubleshooting</h2>
        <div className="space-y-3 text-sm">
          {[
            {
              problem: "Sidecar stuck on Pending after the container starts",
              fix: 'Wait 10 seconds after "sidecar ready" appears. If it is still Pending, double-check that VECTORBEA_HUB_URL and VECTORBEA_KEY are set correctly — a single typo prevents authentication.',
            },
            {
              problem: "NotFoundError: prompt not found",
              fix: 'Two root causes. (1) Workspace mismatch — the sidecar token is scoped to a specific workspace. Open Infrastructure and confirm it matches the workspace containing your prompt. (2) Not published — a saved draft is invisible to the sidecar. Open the prompt and click Publish.',
            },
            {
              problem: "ConnectionError: could not connect to sidecar",
              fix: 'Check the first terminal and confirm "sidecar ready" appeared. Verify nothing else is using port 8080: run lsof -i :8080 on Mac/Linux or netstat -ano | findstr 8080 on Windows.',
            },
            {
              problem: 'Container exits immediately with "DB_URL must be set"',
              fix: 'You pulled the wrong image. Run docker pull vectorbea/vectorbea-proxy:latest (not the backend image) to get the correct sidecar runtime.',
            },
          ].map(({ problem, fix }) => (
            <div
              key={problem}
              className="space-y-1 rounded-xl border border-border/60 bg-muted/20 p-4"
            >
              <p className="font-medium text-foreground">{problem}</p>
              <p className="text-muted-foreground">{fix}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Next steps */}
      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              href: "/docs/architecture",
              label: "Architecture",
              desc: "How the control plane and sidecar cooperate, and what stays in your network",
            },
            {
              href: "/docs/integrations",
              label: "Integrations",
              desc: "How to wire VectorBea into Python services, Node backends, and container platforms",
            },
            {
              href: "/docs/enterprise",
              label: "Enterprise",
              desc: "RBAC, workspace isolation, row-level security, and per-seat billing",
            },
          ].map((card) => (
            <Link
              key={card.href}
              href={card.href as Route}
              className="group flex flex-col gap-1 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="text-sm font-semibold text-foreground group-hover:text-primary">
                {card.label} <ArrowRight className="inline h-3.5 w-3.5" />
              </span>
              <span className="text-xs text-muted-foreground">{card.desc}</span>
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
