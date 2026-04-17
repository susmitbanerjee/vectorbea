import type { Route } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Terminal,
} from "lucide-react";

import { CopyButton } from "@/components/docs/copy-button";

export const metadata = {
  title: "Quickstart — VectorBea Docs",
};

// ─── Code block ───────────────────────────────────────────────────────────────

function Code({ lang, children }: { lang?: string; children: string }) {
  const trimmed = children.trim();
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/40 bg-[#0d1117] shadow-sm">
      {/* top bar */}
      <div className="flex items-center justify-between border-b border-border/30 bg-white/[0.03] px-4 py-1.5">
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground/50" />
          {lang && (
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/50">
              {lang}
            </span>
          )}
        </div>
        {/* CopyButton is the only client island on this page */}
        <CopyButton text={trimmed} />
      </div>
      <pre className="overflow-x-auto px-5 py-4 text-sm leading-relaxed text-slate-200">
        <code>{trimmed}</code>
      </pre>
    </div>
  );
}

// ─── Inline code ──────────────────────────────────────────────────────────────

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-mono text-foreground">
      {children}
    </code>
  );
}

// ─── Callout ─────────────────────────────────────────────────────────────────

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

// ─── Step ─────────────────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuickstartPage() {
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 py-4 lg:py-8">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Quickstart
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          From zero to live prompt in 15 minutes
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Install Docker, spin up the VectorBea proxy locally, publish your
          first prompt, and watch your Python script fetch it in real time —
          all before your coffee goes cold.
        </p>
      </section>

      {/* ── Prerequisites ────────────────────────────────────────────────── */}
      <section className="space-y-3 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Before you start</h2>
        <p className="text-sm text-muted-foreground">
          You only need two things installed on your machine. Everything else
          is handled by VectorBea.
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "Docker Desktop — download from docker.com/get-started",
            "Python 3.8 or newer — download from python.org",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
        <Callout kind="info">
          <strong>Mac with Apple Silicon (M1 / M2 / M3 / M4)?</strong> You
          have an ARM64 chip. Every <InlineCode>docker</InlineCode> command
          below has an ARM64 variant — use those instead of the default ones.
        </Callout>
      </section>

      {/* ── Step 1 ───────────────────────────────────────────────────────── */}
      <Step n={1} title="Create a workspace">
        <p className="text-sm leading-7 text-muted-foreground">
          Sign in to{" "}
          <a
            href="https://dev.vectorbea.com"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            dev.vectorbea.com
          </a>{" "}
          and complete the onboarding flow. Give your workspace a name — this
          groups all your prompts and agents together.
        </p>
        <p className="text-sm leading-7 text-muted-foreground">
          Once the workspace is created you land on the dashboard. You are
          ready for the next step.
        </p>
      </Step>

      {/* ── Step 2 ───────────────────────────────────────────────────────── */}
      <Step n={2} title="Create and publish a prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          Click <strong>Prompts</strong> in the left sidebar, then{" "}
          <strong>New Prompt</strong>. Fill in the fields:
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
          The proxy only serves <em>published</em> versions — a draft is
          invisible to it.
        </p>
        <Callout kind="warn">
          You must hit <strong>Publish</strong>, not just Save. If you skip
          this the proxy returns a 404 and the SDK raises a{" "}
          <InlineCode>NotFoundError</InlineCode>.
        </Callout>
      </Step>

      {/* ── Step 3 ───────────────────────────────────────────────────────── */}
      <Step n={3} title="Pull the proxy image">
        <p className="text-sm leading-7 text-muted-foreground">
          Open a terminal and pull the proxy image. Choose the command that
          matches your machine.
        </p>

        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Intel / AMD (x86-64) — Windows · Linux · older Mac
        </p>
        <Code lang="bash">{`docker pull vectorbea/vectorbea-proxy:dev`}</Code>

        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Apple Silicon (M1 / M2 / M3 / M4) — ARM64
        </p>
        <Code lang="bash">{`docker pull --platform linux/arm64 vectorbea/vectorbea-proxy:dev`}</Code>

        <Callout kind="info">
          The pull downloads roughly 150 MB. You only need to do this once —
          Docker reuses the cached image on every subsequent run.
        </Callout>
      </Step>

      {/* ── Step 4 ───────────────────────────────────────────────────────── */}
      <Step n={4} title="Register a deployment agent and copy the token">
        <p className="text-sm leading-7 text-muted-foreground">
          Every proxy instance is identified by an <em>agent token</em>. Go
          to <strong>Infrastructure</strong> in the dashboard and click{" "}
          <strong>Register New Agent</strong>. Give it a name such as{" "}
          <InlineCode>local-dev</InlineCode>, then click{" "}
          <strong>Generate token</strong>.
        </p>
        <p className="text-sm leading-7 text-muted-foreground">
          A <InlineCode>vbagent_…</InlineCode> string appears in the dialog.{" "}
          <strong>Copy it now.</strong>
        </p>
        <Callout kind="warn">
          <strong>This token is shown exactly once.</strong> If you close the
          dialog without copying it you must delete the agent and register a
          new one. Store it somewhere safe — never commit it to source control.
        </Callout>
        <p className="text-sm leading-7 text-muted-foreground">
          The agent shows <strong>Pending</strong> in the dashboard until the
          proxy container starts. It flips to <strong>Online</strong>{" "}
          automatically within ~5 seconds of the container sending its first
          heartbeat.
        </p>
      </Step>

      {/* ── Step 5 ───────────────────────────────────────────────────────── */}
      <Step n={5} title="Run the proxy container">
        <p className="text-sm leading-7 text-muted-foreground">
          Replace <InlineCode>vbagent_your_token_here</InlineCode> with the
          token you just copied, then run the command for your machine.
        </p>

        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Intel / AMD (x86-64) — Windows · Linux · older Mac
        </p>
        <Code lang="bash">{`docker run --rm -p 8080:8080 \\
  -e VECTORBEA_HUB_URL="https://dev.vectorbea.com" \\
  -e VECTORBEA_KEY="vbagent_your_token_here" \\
  -e VECTORBEA_HTTP_PORT="8080" \\
  vectorbea/vectorbea-proxy:dev`}</Code>

        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Apple Silicon (M1 / M2 / M3 / M4) — ARM64
        </p>
        <Code lang="bash">{`docker run --rm -p 8080:8080 \\
  --platform linux/arm64 \\
  -e VECTORBEA_HUB_URL="https://dev.vectorbea.com" \\
  -e VECTORBEA_KEY="vbagent_your_token_here" \\
  -e VECTORBEA_HTTP_PORT="8080" \\
  vectorbea/vectorbea-proxy:dev`}</Code>

        <p className="text-sm leading-7 text-muted-foreground">
          Watch the terminal. Within a few seconds you will see:
        </p>
        <Code>{`vectorbea proxy ready — REST unix:/tmp/vectorbea-rest.sock, HTTP :8080, gRPC unix:/tmp/vectorbea.sock`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          That line means the proxy is up, authenticated with the hub, and
          listening on <InlineCode>localhost:8080</InlineCode>. The agent
          status in the dashboard changes from <strong>Pending → Online</strong>{" "}
          within ~5 seconds.
        </p>
        <Callout kind="info">
          Keep this terminal open. The proxy runs in the foreground — closing
          it stops the container. To run it in the background, add{" "}
          <InlineCode>-d</InlineCode> after <InlineCode>docker run</InlineCode>{" "}
          and use <InlineCode>docker logs &lt;container-id&gt;</InlineCode> to
          view output.
        </Callout>
      </Step>

      {/* ── Step 6 ───────────────────────────────────────────────────────── */}
      <Step n={6} title="Install the Python SDK">
        <p className="text-sm leading-7 text-muted-foreground">
          Open a <strong>new</strong> terminal (leave the proxy running in the
          first one) and install the SDK:
        </p>
        <Code lang="bash">{`pip install vectorbea`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          Requires Python 3.8+ and installs{" "}
          <InlineCode>requests</InlineCode> automatically. No other
          dependencies.
        </p>
        <p className="text-sm leading-7 text-muted-foreground">
          Verify the installed version:
        </p>
        <Code lang="bash">{`pip show vectorbea`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          You need <strong>0.1.8 or later</strong> for automatic audit
          reporting. If you see an older version, upgrade:
        </p>
        <Code lang="bash">{`pip install --upgrade vectorbea`}</Code>
      </Step>

      {/* ── Step 7 ───────────────────────────────────────────────────────── */}
      <Step n={7} title="Fetch your prompt and check the heartbeat">
        <p className="text-sm leading-7 text-muted-foreground">
          Create a file called <InlineCode>test_prompt.py</InlineCode>, paste
          the script below, and run it.
        </p>
        <Code lang="python">{`import vectorbea

client = vectorbea.VectorBea(
    api_key="any-value",            # not validated by the local proxy
    base_url="http://localhost:8080",
)

# Fetch the latest published version by name.
# SDK 0.1.8+ automatically records proxy latency in the dashboard.
prompt = client.prompts.get("greet-user")

print("Name:    ", prompt.name)            # greet-user
print("Version: ", prompt.version_tag)     # v1.0.0
print("Template:", prompt.template_text)   # Hello {{name}}, welcome to {{product}}!

# Render the template with your own variables
message = prompt.format(name="Alice", product="Acme AI")
print("Rendered:", message)                # Hello Alice, welcome to Acme AI!`}</Code>

        <Code lang="bash">{`python test_prompt.py`}</Code>

        <p className="text-sm font-medium">Expected output</p>
        <Code>{`Name:     greet-user
Version:  v1.0.0
Template: Hello {{name}}, welcome to {{product}}!
Rendered: Hello Alice, welcome to Acme AI!`}</Code>

        <p className="text-sm leading-7 text-muted-foreground">
          Now open the VectorBea dashboard and check:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-7 text-muted-foreground">
          <li>
            <strong>Infrastructure →</strong> agent status is{" "}
            <strong>Online</strong> with a recent last-seen timestamp
          </li>
          <li>
            <strong>Dashboard →</strong> API Calls incremented, Avg Proxy
            Latency populated, Active Agents shows 1
          </li>
          <li>
            <strong>Recent Audit Logs →</strong> your fetch appears with prompt
            name, version, and latency
          </li>
        </ul>
        <Callout kind="info">
          Every <InlineCode>client.prompts.get()</InlineCode> call
          automatically records an audit event — no extra instrumentation
          needed. The proxy sends a heartbeat every 30 seconds and the live
          telemetry chart updates on the same cadence.
        </Callout>
      </Step>

      {/* ── Step 8 (optional) ────────────────────────────────────────────── */}
      <Step n={8} title="Report LLM latency and token usage (optional)">
        <p className="text-sm leading-7 text-muted-foreground">
          After calling your LLM, pass the response metadata back so the
          dashboard shows end-to-end latency and token cost per request:
        </p>
        <Code lang="python">{`import time
import vectorbea

client = vectorbea.VectorBea(
    api_key="any-value",
    base_url="http://localhost:8080",
)

prompt  = client.prompts.get("greet-user")
message = prompt.format(name="Alice", product="Acme AI")

# Call your LLM (OpenAI shown — swap for any provider)
t0 = time.time()
response = openai_client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": message}],
)
llm_ms = int((time.time() - t0) * 1000)

# Log the full audit event — appears in Recent Audit Logs
client.prompts.log_audit(
    prompt,
    llm_latency_ms=llm_ms,
    token_count=response.usage.total_tokens,
    metadata={"model": "gpt-4o"},
)`}</Code>
      </Step>

      {/* ── Step 9 ───────────────────────────────────────────────────────── */}
      <Step n={9} title="Moving to production">
        <p className="text-sm leading-7 text-muted-foreground">
          For production, remove <InlineCode>base_url</InlineCode> and supply
          a real workspace API key. Generate one from{" "}
          <strong>Settings → API Keys</strong> in the dashboard.
        </p>
        <Code lang="bash">{`export VECTORBEA_API_KEY="vb_live_..."`}</Code>
        <Code lang="python">{`import vectorbea

# Reads VECTORBEA_API_KEY from the environment automatically.
# base_url defaults to https://dev.vectorbea.com
client = vectorbea.VectorBea()

prompt  = client.prompts.get("greet-user")
message = prompt.format(name="Bob", product="Acme AI")`}</Code>
        <Callout kind="info">
          In production you can still run the proxy as a sidecar alongside
          your service for lower latency and local caching. Deploy the same
          Docker image with the same environment variables and set{" "}
          <InlineCode>{'base_url="http://localhost:8080"'}</InlineCode>.
        </Callout>
      </Step>

      {/* ── Troubleshooting ──────────────────────────────────────────────── */}
      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Troubleshooting</h2>
        <div className="space-y-3 text-sm">
          {[
            {
              problem: "Agent stuck on Pending after the container starts",
              fix: 'Wait 10 seconds after "proxy ready" appears in the terminal — the heartbeat fires within 5 seconds of that message. If it is still Pending after that, double-check that VECTORBEA_HUB_URL and VECTORBEA_KEY are set correctly. A single typo prevents authentication.',
            },
            {
              problem: "NotFoundError: prompt not found",
              fix: 'The prompt name is case-sensitive and must match exactly. Confirm you clicked Publish — a prompt that is only saved as a draft is invisible to the proxy.',
            },
            {
              problem: "ConnectionError: could not connect to proxy",
              fix: 'Check the first terminal and confirm "proxy ready" appeared. Then verify nothing else is using port 8080: run lsof -i :8080 on Mac/Linux or netstat -ano | findstr 8080 on Windows. Restart Docker Desktop if the port appears blocked.',
            },
            {
              problem: "Apple Silicon — container crashes or behaves strangely",
              fix: 'Make sure you added --platform linux/arm64 to both docker pull and docker run. Without the flag Docker tries x86-64 emulation which is slower and unstable on M-series chips.',
            },
            {
              problem: "Dashboard shows 0 API calls after running the script",
              fix: 'You need SDK 0.1.8 or later. Run pip show vectorbea to check. If the version is older, run pip install --upgrade vectorbea. Versions before 0.1.8 did not auto-report audit events on prompts.get().',
            },
            {
              problem: 'Container exits immediately with "DB_URL must be set"',
              fix: 'You pulled the wrong image. Run docker pull vectorbea/vectorbea-proxy:dev (not the backend image) to get the correct proxy runtime.',
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

      {/* ── Next steps ───────────────────────────────────────────────────── */}
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
