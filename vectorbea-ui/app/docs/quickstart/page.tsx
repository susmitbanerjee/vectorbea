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
          From zero to your first prompt in 10 minutes
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Run the VectorBea proxy locally, fetch a live prompt from your own
          Python script, and watch the dashboard update in real time.
        </p>
      </section>

      <Callout kind="info">
        You only need <strong>Docker</strong> and <strong>Python 3.8+</strong>.
        Everything else — the proxy binary, the hub connection, prompt storage —
        is handled by VectorBea.
      </Callout>

      <section className="space-y-3 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Prerequisites</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "Docker Desktop installed and running",
            "A VectorBea account — sign up at vectorbea.com",
            "Python 3.8+ with pip",
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
          Sign in to the VectorBea dashboard, create a workspace, then create
          and publish a prompt. Use any name and template you like — for example:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
          <li>Prompt name: <InlineCode>greet-user</InlineCode></li>
          <li>
            Template:{" "}
            <InlineCode>{"Hello {{name}}, welcome to {{product}}!"}</InlineCode>
          </li>
        </ul>
        <p className="text-sm leading-7 text-muted-foreground">
          Click <strong>Publish</strong>. The proxy only serves published versions —
          drafts are invisible to it.
        </p>
      </Step>

      <Step n={2} title="Register a deployment agent">
        <p className="text-sm leading-7 text-muted-foreground">
          In the dashboard, go to <strong>Infrastructure</strong> and click{" "}
          <strong>Register New Agent</strong>. Give it any name (e.g.{" "}
          <InlineCode>local-dev</InlineCode>), then click{" "}
          <strong>Generate token</strong>.
        </p>
        <Callout kind="warn">
          Copy the <InlineCode>vbagent_…</InlineCode> token immediately — it is
          only shown once. This is your <strong>agent token</strong> used by the
          proxy to authenticate with the hub. Keep it secret.
        </Callout>
        <p className="text-sm leading-7 text-muted-foreground">
          The agent will show <strong>Pending</strong> until the proxy connects
          for the first time. It flips to <strong>Online</strong> automatically
          within a few seconds of the container starting — no manual steps needed.
        </p>
      </Step>

      <Step n={3} title="Pull and run the proxy">
        <p className="text-sm leading-7 text-muted-foreground">
          Pull the official proxy image and start it with your agent token and
          the hub URL:
        </p>
        <Code lang="bash">{`docker pull vectorbea/vectorbea-proxy:dev

docker run --rm -p 8080:8080 \\
  -e VECTORBEA_HUB_URL="https://dev.vectorbea.com" \\
  -e VECTORBEA_KEY="vbagent_your_agent_token" \\
  -e VECTORBEA_HTTP_PORT="8080" \\
  vectorbea/vectorbea-proxy:dev`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          Wait for the startup message:
        </p>
        <Code>{`vectorbea proxy ready — REST unix:/tmp/vectorbea-rest.sock, HTTP :8080, gRPC unix:/tmp/vectorbea.sock`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          Within ~5 seconds the proxy sends its first heartbeat and your agent
          status in <strong>Infrastructure</strong> will flip from{" "}
          <strong>Pending</strong> to <strong>Online</strong>.
        </p>
      </Step>

      <Step n={4} title="Install the Python SDK">
        <Code lang="bash">{`pip install vectorbea`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          Requires Python 3.8+ and <InlineCode>requests</InlineCode> (installed
          automatically). No other dependencies.
        </p>
      </Step>

      <Step n={5} title="Fetch and render a prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          Point the client at your local proxy. No API key is needed for local
          development — the proxy handles hub authentication with the agent token
          you already configured.
        </p>
        <Code lang="python">{`import vectorbea

client = vectorbea.VectorBea(
    api_key="any-value",          # not validated by the local proxy
    base_url="http://localhost:8080",
)

# Fetch the latest published version of a prompt.
# Proxy latency is measured and reported to the dashboard automatically.
prompt = client.prompts.get("greet-user")

print(prompt.name)           # greet-user
print(prompt.version_tag)    # v1.0.0
print(prompt.template_text)  # Hello {{name}}, welcome to {{product}}!

# Render the template
message = prompt.format(name="Alice", product="Acme AI")
print(message)               # Hello Alice, welcome to Acme AI!`}</Code>
        <Callout kind="info">
          Every <InlineCode>client.prompts.get()</InlineCode> call automatically
          records an audit event — proxy latency, prompt name, and version all
          appear in the dashboard immediately. No extra instrumentation needed.
        </Callout>
      </Step>

      <Step n={6} title="Record LLM latency and token usage (optional)">
        <p className="text-sm leading-7 text-muted-foreground">
          After calling your LLM, pass the response metadata back so the
          dashboard shows full end-to-end latency and token cost per request:
        </p>
        <Code lang="python">{`import time
import vectorbea

client = vectorbea.VectorBea(
    api_key="any-value",
    base_url="http://localhost:8080",
)

prompt = client.prompts.get("greet-user")
message = prompt.format(name="Alice", product="Acme AI")

# Call your LLM
t0 = time.time()
response = openai_client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": message}],
)
llm_ms = int((time.time() - t0) * 1000)

# Report the full audit event
client.prompts.log_audit(
    prompt,
    llm_latency_ms=llm_ms,
    token_count=response.usage.total_tokens,
    metadata={"model": "gpt-4o"},
)`}</Code>
      </Step>

      <Step n={7} title="Production — point at the cloud endpoint">
        <p className="text-sm leading-7 text-muted-foreground">
          In production, remove <InlineCode>base_url</InlineCode> (or set it to
          the hosted endpoint) and supply a real workspace API key. Generate one
          from <strong>Settings → API Keys</strong> in the dashboard.
        </p>
        <Code lang="bash">{`export VECTORBEA_API_KEY="vb_live_..."
# VECTORBEA_BASE_URL defaults to https://app.vectorbea.com`}</Code>
        <Code lang="python">{`import vectorbea

# Reads credentials from environment — no hardcoded keys in source code
client = vectorbea.VectorBea()

prompt  = client.prompts.get("customer-support-reply")
message = prompt.format(customer_name="Bob", issue="billing")`}</Code>
        <Callout kind="info">
          In production you can still run the proxy sidecar alongside your
          service for lower latency and local caching. Simply deploy the proxy
          container with the same environment variables and point{" "}
          <InlineCode>base_url</InlineCode> at the sidecar instead.
        </Callout>
      </Step>

      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Troubleshooting</h2>
        <div className="space-y-3 text-sm">
          {[
            {
              problem: "Agent stuck on Pending after container starts",
              fix: 'Check the container logs for "proxy ready". If the startup message appeared, the heartbeat fires within 5 seconds and the status flips automatically. If you still see Pending, verify VECTORBEA_HUB_URL and VECTORBEA_KEY are set correctly.',
            },
            {
              problem: "NotFoundError: prompt not found",
              fix: "Make sure you published a version of the prompt in the dashboard. Drafts are not served by the proxy. The prompt name must match exactly (case-sensitive).",
            },
            {
              problem: "ConnectionError: could not connect to proxy",
              fix: "Confirm the container is running with -p 8080:8080 and the startup log appeared. On some systems Docker Desktop may block the port — try restarting Docker.",
            },
            {
              problem: "Dashboard shows 0 API calls",
              fix: "Make sure you are on SDK version 0.1.8 or later (pip install --upgrade vectorbea). Earlier versions did not auto-report audit events.",
            },
            {
              problem: "Container exits with DB_URL or JDBC_DATABASE_URL must be set",
              fix: "You pulled an old backend image. Run: docker pull vectorbea/vectorbea-proxy:dev to get the correct proxy runtime.",
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
