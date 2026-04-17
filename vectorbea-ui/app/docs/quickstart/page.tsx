import type { Route } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
} from "lucide-react";

export const metadata = {
  title: "Quickstart - VectorBea Docs",
};

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 border-t border-border/60 pt-8">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {n}
        </span>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Code({ lang, children }: { lang?: string; children: string }) {
  return (
    <div className="relative">
      {lang ? (
        <span className="pointer-events-none absolute right-3 top-2.5 select-none text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
          {lang}
        </span>
      ) : null}
      <pre className="overflow-x-auto rounded-xl bg-muted px-5 py-4 text-sm leading-relaxed text-foreground shadow-sm">
        <code>{children.trim()}</code>
      </pre>
    </div>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-mono text-foreground">
      {children}
    </code>
  );
}

function Callout({
  kind = "info",
  children,
}: {
  kind?: "info" | "warn";
  children: React.ReactNode;
}) {
  const styles =
    kind === "warn"
      ? "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300"
      : "border-primary/30 bg-primary/5 text-foreground";
  const Icon = kind === "warn" ? AlertTriangle : Info;
  return (
    <div className={`flex gap-3 rounded-xl border p-4 text-sm leading-relaxed ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
      <div>{children}</div>
    </div>
  );
}

export default function QuickstartPage() {
  return (
    <article className="mx-auto max-w-[65ch] space-y-4 py-4 lg:py-8">
      <section className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Quickstart
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Test the backend from your own Python app
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          This is the simplest working path in the current setup. You will
          create a prompt in the VectorBea dashboard, generate a deployment
          agent token, install the Python SDK, and fetch that prompt directly
          from the hosted backend.
        </p>
      </section>

      <Callout kind="info">
        <strong>Start here first.</strong> This quickstart is written around the
        path that currently works end to end with the existing backend and SDK.
        It does <em>not</em> require you to run the local Docker proxy to do
        your first successful prompt fetch.
      </Callout>

      <section className="space-y-3 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Prerequisites</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "A VectorBea account and access to the dashboard",
            "At least one published prompt in your workspace",
            "A deployment agent token from the Infrastructure page",
            "Python 3.8+",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <Step n={1} title="Create and publish a prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          In the VectorBea dashboard, create a prompt such as{" "}
          <InlineCode>greet-user</InlineCode> and publish it.
        </p>
        <Code>{`name: greet-user
template: Hello {{name}}, welcome to {{product}}!`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          The SDK fetches the latest published version by prompt name.
        </p>
      </Step>

      <Step n={2} title="Register a deployment agent">
        <p className="text-sm leading-7 text-muted-foreground">
          Open <strong>Infrastructure</strong> in the dashboard and click{" "}
          <strong>Register New Agent</strong>. Copy the generated{" "}
          <InlineCode>vbagent_...</InlineCode> token immediately.
        </p>
        <Callout kind="warn">
          Use the deployment agent token for this quickstart, not a workspace
          API key. The currently exposed backend route behind the Python SDK
          authenticates deployment agents.
        </Callout>
      </Step>

      <Step n={3} title="Install the Python SDK">
        <Code lang="bash">{`pip install vectorbea`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          The SDK uses <InlineCode>requests</InlineCode> under the hood and can
          point directly at the hosted VectorBea backend.
        </p>
      </Step>

      <Step n={4} title="Fetch a prompt from the hosted backend">
        <p className="text-sm leading-7 text-muted-foreground">
          Point the SDK at the hosted development environment and use your
          deployment agent token as the API key:
        </p>
        <Code lang="python">{`import vectorbea

if __name__ == "__main__":
    client = vectorbea.VectorBea(
        api_key="vbagent_your_agent_token",
        base_url="https://dev.vectorbea.com",
    )

    prompt = client.prompts.get("greet-user")

    print(prompt.name)
    print(prompt.version_tag)
    print(prompt.template_text)

    message = prompt.format(name="Alice", product="Acme AI")
    print(message)`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          If the prompt exists and has a published version, this returns the
          prompt payload directly from the hosted backend.
        </p>
      </Step>

      <Step n={5} title="What success looks like">
        <Code>{`greet-user
v1.0.0
Hello {{name}}, welcome to {{product}}!
Hello Alice, welcome to Acme AI!`}</Code>
      </Step>

      <Step n={6} title="What common failures mean">
        <div className="space-y-3 text-sm leading-7 text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>NotFoundError:</strong> the prompt name is wrong, or the
              prompt has no published version yet.
            </li>
            <li>
              <strong>AuthenticationError:</strong> the token is wrong, expired,
              or not a valid deployment agent token.
            </li>
            <li>
              <strong>Calling localhost with the SDK:</strong> the current SDK
              route shape does not match the local proxy route shape, so the
              hosted backend is the safer starting point right now.
            </li>
          </ul>
        </div>
      </Step>

      <Step n={7} title="About the local Docker proxy">
        <p className="text-sm leading-7 text-muted-foreground">
          The repo also contains a local Kotlin proxy image, but the current
          SDK and local proxy are not yet aligned on the same route shape. That
          means the fastest developer-start path today is:
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
          <li>Use the hosted backend with the Python SDK for your first test.</li>
          <li>Use the local proxy later only when you are explicitly testing the proxy runtime itself.</li>
        </ol>
      </Step>

      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              href: "/docs/architecture",
              label: "Architecture",
              desc: "Understand the hosted control plane, proxy runtime, and customer boundary",
            },
            {
              href: "/docs/enterprise",
              label: "Enterprise",
              desc: "RBAC, project isolation, row-level security, and seat billing",
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
