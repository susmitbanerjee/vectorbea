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
import { DocsTabs } from "@/components/docs/docs-tabs";

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
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-4 scroll-mt-24">
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
          Pull the VectorBea sidecar, publish your first prompt, and watch your
          Python or Node.js script fetch it in real time — all before your
          coffee goes cold.
        </p>
      </section>

      {/* ── Prerequisites ────────────────────────────────────────────────── */}
      <section id="before-you-start" className="space-y-3 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Before you start</h2>
        <p className="text-sm text-muted-foreground">
          You only need two things installed. Everything else is handled by
          VectorBea.
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "Docker Desktop — download from docker.com/get-started",
            "Python 3.8+ or Node.js 18+ — depending on which SDK you prefer",
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
          below has an AMD64 variant — use those instead of the default ones.
        </Callout>
      </section>

      {/* ── Step 1 ───────────────────────────────────────────────────────── */}
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

      {/* ── Step 2 ───────────────────────────────────────────────────────── */}
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

      {/* ── Step 3 ───────────────────────────────────────────────────────── */}
      <Step id="step-3" n={3} title="Pull the sidecar image">
        <p className="text-sm leading-7 text-muted-foreground">
          Open a terminal and pull the sidecar image. Choose the tab that
          matches your machine.
        </p>

        <DocsTabs tabs={["Intel / AMD (x86-64)", "Apple Silicon / ARM64"]}>
          <Code lang="bash">{`docker pull vectorbea/vectorbea-proxy:latest`}</Code>
          <Code lang="bash">{`docker pull --platform linux/amd64 vectorbea/vectorbea-proxy:latest`}</Code>
        </DocsTabs>

        <Callout kind="info">
          The pull is roughly 150 MB. You only need to do this once — Docker
          reuses the cached image on every subsequent run.
        </Callout>
      </Step>

      {/* ── Step 4 ───────────────────────────────────────────────────────── */}
      <Step id="step-4" n={4} title="Register a sidecar and copy the token">
        <p className="text-sm leading-7 text-muted-foreground">
          Every sidecar instance authenticates with a <em>sidecar token</em>.
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
          new one. Store it somewhere safe — never commit it to source control.
        </Callout>
        <Callout kind="warn">
          <strong>The sidecar token is scoped to the workspace you register it in.</strong>{" "}
          It can only fetch prompts that belong to that same workspace. If your
          prompt is in workspace A but the sidecar is registered in workspace B,
          every fetch returns a 404. Confirm you are on the correct workspace
          before clicking Register sidecar.
        </Callout>
        <p className="text-sm leading-7 text-muted-foreground">
          The sidecar shows <strong>Pending</strong> in the dashboard until the
          container starts. It flips to <strong>Online</strong> automatically
          within ~5 seconds of the container sending its first heartbeat.
        </p>
      </Step>

      {/* ── Step 5 ───────────────────────────────────────────────────────── */}
      <Step id="step-5" n={5} title="Run the sidecar container">
        <p className="text-sm leading-7 text-muted-foreground">
          Replace <InlineCode>vbagent_your_token_here</InlineCode> with the
          token you just copied, then run the command for your machine.
        </p>

        <DocsTabs tabs={["Intel / AMD (x86-64)", "Apple Silicon / ARM64"]}>
          <Code lang="bash">{`docker run --rm -p 8080:8080 \\
  -e VECTORBEA_HUB_URL="https://vectorbea.com" \\
  -e VECTORBEA_KEY="vbagent_your_token_here" \\
  -e VECTORBEA_HTTP_PORT="8080" \\
  vectorbea/vectorbea-proxy:latest`}</Code>
          <Code lang="bash">{`docker run --rm -p 8080:8080 \\
  --platform linux/amd64 \\
  -e VECTORBEA_HUB_URL="https://vectorbea.com" \\
  -e VECTORBEA_KEY="vbagent_your_token_here" \\
  -e VECTORBEA_HTTP_PORT="8080" \\
  vectorbea/vectorbea-proxy:latest`}</Code>
        </DocsTabs>

        <p className="text-sm leading-7 text-muted-foreground">
          Watch the terminal. Within a few seconds you will see:
        </p>
        <Code>{`vectorbea sidecar ready — REST unix:/tmp/vectorbea-rest.sock, HTTP :8080, gRPC unix:/tmp/vectorbea.sock`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          That line means the sidecar is up, authenticated with the control
          plane, and listening on <InlineCode>localhost:8080</InlineCode>. The
          sidecar status in the dashboard changes from{" "}
          <strong>Pending → Online</strong> within ~5 seconds.
        </p>
        <Callout kind="info">
          Keep this terminal open. The sidecar runs in the foreground — closing
          it stops the container. To run it in the background, add{" "}
          <InlineCode>-d</InlineCode> after <InlineCode>docker run</InlineCode>{" "}
          and use <InlineCode>docker logs &lt;container-id&gt;</InlineCode> to
          view output.
        </Callout>
      </Step>

      {/* ── Step 6 ───────────────────────────────────────────────────────── */}
      <Step id="step-6" n={6} title="Install the SDK">
        <p className="text-sm leading-7 text-muted-foreground">
          Open a <strong>new</strong> terminal (leave the sidecar running in
          the first one) and install the SDK for your preferred language.
        </p>

        <DocsTabs tabs={["Python (3.8+)", "Node.js (18+)"]}>
          <div className="space-y-3 p-0">
            <Code lang="bash">{`pip install vectorbea`}</Code>
            <p className="px-4 pt-1 text-sm leading-7 text-muted-foreground">
              You need <strong>0.1.8 or later</strong> for automatic audit
              reporting. Verify and upgrade if needed:
            </p>
            <Code lang="bash">{`pip show vectorbea
pip install --upgrade vectorbea`}</Code>
          </div>
          <Code lang="bash">{`npm install vectorbea`}</Code>
        </DocsTabs>
      </Step>

      {/* ── Step 7 ───────────────────────────────────────────────────────── */}
      <Step id="step-7" n={7} title="Fetch your prompt">
        <p className="text-sm leading-7 text-muted-foreground">
          Create a file, paste the script for your language, and run it.
        </p>

        <DocsTabs tabs={["Python — test_prompt.py", "Node.js — testPrompt.mjs"]}>
          <div className="space-y-0">
            <Code lang="python">{`import vectorbea

client = vectorbea.VectorBea(
    api_key="any-value",            # not validated by the local sidecar
    base_url="http://localhost:8080",
)

# Fetch the latest published version by name.
# SDK 0.1.8+ automatically records an audit event on every get().
prompt = client.prompts.get("greet-user")

print("Name:    ", prompt.name)            # greet-user
print("Version: ", prompt.version_tag)     # v1.0.0
print("Template:", prompt.template_text)   # Hello {{name}}, welcome to {{product}}!

# Render the template with your own variables
message = prompt.format(name="Alice", product="Acme AI")
print("Rendered:", message)                # Hello Alice, welcome to Acme AI!`}</Code>
            <Code lang="bash">{`python test_prompt.py`}</Code>
          </div>
          <div className="space-y-0">
            <Code lang="javascript">{`import VectorBea from "vectorbea";

const client = new VectorBea({
  apiKey: "any-value",              // not validated by the local sidecar
  baseUrl: "http://localhost:8080",
});

const prompt = await client.prompts.get("greet-user");

console.log("Name:    ", prompt.name);           // greet-user
console.log("Version: ", prompt.versionTag);     // v1.0.0
console.log("Template:", prompt.templateText);   // Hello {{name}}, welcome to {{product}}!

const message = prompt.format({ name: "Alice", product: "Acme AI" });
console.log("Rendered:", message);               // Hello Alice, welcome to Acme AI!`}</Code>
            <Code lang="bash">{`node testPrompt.mjs`}</Code>
          </div>
        </DocsTabs>

        <p className="text-sm font-medium">Expected output</p>
        <Code>{`Name:     greet-user
Version:  v1.0.0
Template: Hello {{name}}, welcome to {{product}}!
Rendered: Hello Alice, welcome to Acme AI!`}</Code>

        <p className="text-sm leading-7 text-muted-foreground">
          Now open the VectorBea dashboard and confirm:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-7 text-muted-foreground">
          <li>
            <strong>Infrastructure →</strong> sidecar status is{" "}
            <strong>Online</strong> with a recent last-seen timestamp
          </li>
          <li>
            <strong>Dashboard →</strong> Requests (24h) incremented, Avg
            latency populated, Active sidecars shows 1
          </li>
          <li>
            <strong>Audit logs →</strong> your fetch appears with prompt name,
            version, and latency
          </li>
        </ul>
        <Callout kind="info">
          Every <InlineCode>client.prompts.get()</InlineCode> call
          automatically records an audit event — no extra instrumentation
          needed. The sidecar sends a heartbeat every 30 seconds and the live
          telemetry chart updates on the same cadence.
        </Callout>
      </Step>

      {/* ── Step 8 (optional) ────────────────────────────────────────────── */}
      <Step id="step-8" n={8} title="Report LLM latency and token usage (optional)">
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

# Log the full audit event — appears in Audit logs
client.prompts.log_audit(
    prompt,
    llm_latency_ms=llm_ms,
    token_count=response.usage.total_tokens,
    metadata={"model": "gpt-4o"},
)`}</Code>
      </Step>

      {/* ── Step 9 ───────────────────────────────────────────────────────── */}
      <Step id="step-9" n={9} title="Moving to production">
        <p className="text-sm leading-7 text-muted-foreground">
          For production, omit <InlineCode>base_url</InlineCode> and supply a
          real workspace API key. Generate one from{" "}
          <strong>API keys</strong> in the sidebar.
        </p>
        <Code lang="bash">{`export VECTORBEA_API_KEY="vb_live_..."`}</Code>
        <Code lang="python">{`import vectorbea

# Reads VECTORBEA_API_KEY from the environment automatically.
# base_url defaults to https://vectorbea.com
client = vectorbea.VectorBea()

prompt  = client.prompts.get("greet-user")
message = prompt.format(name="Bob", product="Acme AI")`}</Code>
        <Callout kind="info">
          In production, run the sidecar as a container alongside your service
          for lower latency and local caching. Deploy the same docker image
          with the same environment variables and point your SDK at{" "}
          <InlineCode>{'base_url="http://localhost:8080"'}</InlineCode>.
          Your data stays inside your network — the control plane only receives
          heartbeats and audit metadata.
        </Callout>
      </Step>

      {/* ── Troubleshooting ──────────────────────────────────────────────── */}
      <section id="troubleshooting" className="space-y-4 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Troubleshooting</h2>
        <div className="space-y-3 text-sm">
          {[
            {
              problem: "Sidecar stuck on Pending after the container starts",
              fix: 'Wait 10 seconds after "sidecar ready" appears in the terminal — the heartbeat fires within 5 seconds of that message. If it is still Pending, double-check that VECTORBEA_HUB_URL and VECTORBEA_KEY are set correctly. A single typo prevents authentication.',
            },
            {
              problem: "NotFoundError: prompt not found",
              fix: 'Two root causes. (1) Workspace mismatch — the sidecar token is scoped to a specific workspace. Open Infrastructure, click the sidecar, and confirm its workspace matches the one containing your prompt. (2) Not published — a saved draft is invisible to the sidecar. Open the prompt and click Publish.',
            },
            {
              problem: "ConnectionError: could not connect to sidecar",
              fix: 'Check the first terminal and confirm "sidecar ready" appeared. Verify nothing else is using port 8080: run lsof -i :8080 on Mac/Linux or netstat -ano | findstr 8080 on Windows. Restart Docker Desktop if the port appears blocked.',
            },
            {
              problem: "Mac (Intel or Apple Silicon) — container crashes or image not found",
              fix: 'Use the --platform linux/amd64 flag in both docker pull and docker run. This targets the x86-64 image explicitly so Docker does not try to resolve the wrong architecture.',
            },
            {
              problem: "Dashboard shows 0 requests after running the script",
              fix: 'You need SDK 0.1.8 or later. Run pip show vectorbea to check. If the version is older, run pip install --upgrade vectorbea. Versions before 0.1.8 did not auto-report audit events on prompts.get().',
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

      {/* ── Next steps ───────────────────────────────────────────────────── */}
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
