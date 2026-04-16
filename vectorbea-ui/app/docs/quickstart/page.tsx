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
          Pull the proxy image and test it from your own Python app
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          This guide assumes you already have your own application codebase. You
          will create a workspace in the VectorBea dashboard, pull the published
          Docker image from Docker Hub, run the proxy locally,
          and call it from a simple Python script.
        </p>
      </section>

      <Callout kind="info">
        <strong>You do not need this repository to get started.</strong> The
        normal customer workflow is: create prompts in the hosted dashboard,
        pull the VectorBea proxy image from Docker Hub, run it in Docker, and point
        your own service at <InlineCode>http://localhost:8080</InlineCode>.
      </Callout>

      <section className="space-y-3 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Prerequisites</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "Docker installed and running",
            "A VectorBea account and access to the hosted dashboard",
            "A generated VectorBea API key for your workspace",
            "Python 3.8+ with requests installed",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <Step n={1} title="Create a workspace and publish a prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          Sign in to the VectorBea dashboard, create your workspace, then create
          and publish at least one prompt. For example:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
          <li>Prompt name: <InlineCode>greet-user</InlineCode></li>
          <li>
            Template:{" "}
            <InlineCode>{"Hello {{name}}, welcome to {{product}}!"}</InlineCode>
          </li>
        </ul>
        <p className="text-sm leading-7 text-muted-foreground">
          The proxy serves published prompts by name. If nothing has been
          published yet, your local test will correctly return an error.
        </p>
      </Step>

      <Step n={2} title="Generate an API key">
        <p className="text-sm leading-7 text-muted-foreground">
          In the dashboard, open <strong>Settings → API Keys</strong> and create
          a key for the workspace you want to test. Copy it immediately. It
          will start with <InlineCode>vb_</InlineCode> and is only shown once.
        </p>
        <Callout kind="warn">
          Treat the key like an application secret. If it leaks, revoke it and
          create a new one instead of trying to reuse it.
        </Callout>
      </Step>

      <Step n={3} title="Pull and run the official VectorBea proxy image">
        <p className="text-sm leading-7 text-muted-foreground">
          The official proxy image is published on Docker Hub. Use the{" "}
          <InlineCode>dev</InlineCode> tag for development testing and point it
          at a VectorBea <strong>hub API base URL</strong> that exposes the
          proxy-facing prompt routes:
        </p>
        <Code lang="bash">{`# Dev / testing
docker pull vectorbea/vectorbea-proxy:dev

# Stable production tag
docker pull vectorbea/vectorbea-proxy:latest`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          Then start the container locally:
        </p>
        <Code lang="bash">{`docker run --rm -p 8080:8080 \\
  -e VECTORBEA_HUB_URL="https://your-vectorbea-hub-api.example.com" \\
  -e VECTORBEA_KEY="vb_your_workspace_api_key" \\
  -e VECTORBEA_HTTP_PORT="8080" \\
  vectorbea/vectorbea-proxy:dev`}</Code>
        <Callout kind="warn">
          <strong>Do not point the proxy at the frontend domain unless that
          domain also exposes the proxy-compatible backend API.</strong> The
          proxy expects a hub URL that serves{" "}
          <InlineCode>/api/prompts/:name</InlineCode> using Bearer API-key
          authentication. If you point it at a frontend-only deployment, prompt
          fetches will fail even though the local container starts cleanly.
        </Callout>
        <p className="text-sm leading-7 text-muted-foreground">
          You should see a startup message similar to:
        </p>
        <Code>{`vectorbea proxy ready - REST unix:/tmp/vectorbea-rest.sock, HTTP :8080, gRPC unix:/tmp/vectorbea.sock`}</Code>
      </Step>

      <Step n={4} title="Verify prompt resolution with curl">
        <p className="text-sm leading-7 text-muted-foreground">
          Before wiring the SDK into your application, confirm the proxy can
          reach the hub and resolve prompts:
        </p>
        <Code lang="bash">{`curl http://localhost:8080/api/proxy/prompts/greet-user \\
  -H "Authorization: Bearer vb_your_api_key"`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          You should receive a JSON object with <InlineCode>templateText</InlineCode>,{" "}
          <InlineCode>versionTag</InlineCode>, and the other prompt fields. A{" "}
          <InlineCode>404</InlineCode> means the prompt has no published version yet.
        </p>
      </Step>

      <Step n={5} title="Install the Python SDK">
        <p className="text-sm leading-7 text-muted-foreground">
          The official VectorBea Python SDK wraps the proxy API and gives you
          a clean, typed interface — no manual HTTP calls required.
        </p>
        <Code lang="bash">{`pip install vectorbea-sdk`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          The SDK requires Python 3.8+ and has a single dependency:{" "}
          <InlineCode>requests</InlineCode>.
        </p>
      </Step>

      <Step n={6} title="Fetch and render a prompt with the SDK">
        <p className="text-sm leading-7 text-muted-foreground">
          Instantiate the client once and reuse it across your application.
          Point <InlineCode>base_url</InlineCode> at your local proxy when
          developing, or omit it to use the hosted cloud endpoint in production.
        </p>
        <Code lang="python">{`import vectorbea

# Local development — proxy running on Docker
client = vectorbea.VectorBea(
    api_key="vb_your_api_key",
    base_url="http://localhost:8080",
)

# Fetch the latest published version of a prompt
prompt = client.prompts.get("greet-user")

print(prompt.name)         # greet-user
print(prompt.version_tag)  # v1.0.0
print(prompt.template_text)
# → Hello {{name}}, welcome to {{product}}!

# Render the template by injecting variables
message = prompt.format(name="Alice", product="Acme AI")
print(message)
# → Hello Alice, welcome to Acme AI!`}</Code>
        <Callout kind="info">
          <strong>Zero code changes on prompt updates.</strong> When you publish
          a new version in the dashboard, the next call to{" "}
          <InlineCode>client.prompts.get()</InlineCode> returns it automatically.
          Your application code never needs to change.
        </Callout>
      </Step>

      <Step n={7} title="Production — use the cloud endpoint">
        <p className="text-sm leading-7 text-muted-foreground">
          In production, omit <InlineCode>base_url</InlineCode> to target the
          hosted VectorBea cloud, or set the{" "}
          <InlineCode>VECTORBEA_BASE_URL</InlineCode> and{" "}
          <InlineCode>VECTORBEA_API_KEY</InlineCode> environment variables so
          no credentials appear in source code:
        </p>
        <Code lang="bash">{`export VECTORBEA_API_KEY="vb_live_..."
export VECTORBEA_BASE_URL="https://app.vectorbea.com"  # optional, this is the default`}</Code>
        <Code lang="python">{`import vectorbea

# Reads VECTORBEA_API_KEY and VECTORBEA_BASE_URL from the environment
client = vectorbea.VectorBea()

prompt  = client.prompts.get("customer-support-reply")
message = prompt.format(customer_name="Bob", issue="billing")

# Pass the rendered string directly to your LLM of choice
response = openai_client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": message}],
)`}</Code>
      </Step>

      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Troubleshooting</h2>
        <div className="space-y-3 text-sm">
          {[
            {
              problem: "The container starts but prompt fetches fail",
              fix: "Check VECTORBEA_HUB_URL and VECTORBEA_KEY first. The proxy must point to a hub API base URL that supports GET /api/prompts/:name with Bearer API-key authentication.",
            },
            {
              problem: "Container exits with `DB_URL or JDBC_DATABASE_URL must be set`",
              fix: "That means the image you pulled is an older backend/API image, not the current proxy runtime expected by these docs. For testing against dev.vectorbea.com, use vectorbea/vectorbea-proxy:dev until the stable latest tag is refreshed.",
            },
            {
              problem: "Local proxy returns 500 for /v1/prompts/<name>",
              fix: "This usually means the upstream hub URL is wrong for the proxy contract. A common mistake is pointing VECTORBEA_HUB_URL at the frontend domain, which does not expose the proxy-facing prompt-by-name API.",
            },
            {
              problem: "localhost:8080 does not respond",
              fix: "Make sure the container is running with -p 8080:8080 and confirm startup logs do not contain a configuration error.",
            },
            {
              problem: "Prompt lookup returns 404 or empty results",
              fix: "Make sure the prompt exists in the dashboard and that you published a version before testing locally.",
            },
            {
              problem: "I only want to test from my own codebase",
              fix: "That is the intended path. You do not need this repo; you only need your dashboard credentials, the Docker Hub image, and your local app.",
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

      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Next steps</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              href: "/docs/architecture",
              label: "Architecture",
              desc: "Understand the cloud control plane, local proxy, and customer boundary",
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
