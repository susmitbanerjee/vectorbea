import type { Route } from "next";
import Link from "next/link";
import {
  Terminal,
  GitBranch,
  Key,
  Play,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
  Info,
} from "lucide-react";

export const metadata = {
  title: "Quickstart — VectorBea Docs",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
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

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-muted px-5 py-4 text-sm font-mono leading-relaxed text-foreground shadow-sm">
      <code>{children.trim()}</code>
    </pre>
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

      {/* Header */}
      <section className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Quickstart</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Connect the backend sidecar to the dashboard
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          This guide walks you through running the Kotlin backend locally, pointing it at your
          Supabase database, generating an API key in the dashboard, and verifying that prompts
          and audit logs flow end-to-end.
        </p>
      </section>

      {/* Architecture callout */}
      <Callout kind="info">
        <strong>How the two sides connect:</strong> The{" "}
        <strong>Next.js dashboard</strong> (frontend) talks directly to Supabase for all UI
        data. The <strong>Kotlin sidecar</strong> is the runtime proxy that your AI agents
        call — it resolves published prompts, records audit logs back to Supabase, and exposes
        a REST API that the dashboard can also query for live metrics.
      </Callout>

      {/* Prerequisites */}
      <section className="space-y-3 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Prerequisites</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "JDK 21+ installed (the sidecar is built with Gradle / JDK 21)",
            "A running Supabase project with the vectorbea schema applied (all migrations in supabase/migrations/)",
            "The VectorBea dashboard deployed locally or on Vercel",
            "curl or any HTTP client for smoke-testing",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Step 1 */}
      <Step n={1} title="Apply the database migrations">
        <p className="text-sm leading-7 text-muted-foreground">
          All schema lives in <InlineCode>vectorbea-backend/supabase/migrations/</InlineCode>.
          Open the Supabase SQL Editor, run each migration file in order (ascending by filename),
          then run the seed file to create the local dev org, workspace, and API key:
        </p>
        <Code>{`-- In Supabase SQL Editor, run in order:
-- 1. supabase/migrations/*.sql  (all migration files, oldest first)
-- 2. supabase/seed.sql          (inserts local dev data)`}</Code>
        <Callout kind="info">
          The seed script inserts a ready-to-use <InlineCode>dev_local_123</InlineCode> API key,
          a sample <InlineCode>hello-world</InlineCode> prompt, and deterministic UUIDs that
          match the sidecar&apos;s local auth bypass. You only need to run the seed once.
        </Callout>
      </Step>

      {/* Step 2 */}
      <Step n={2} title="Configure the sidecar environment">
        <p className="text-sm leading-7 text-muted-foreground">
          Create a <InlineCode>.env</InlineCode> file in the{" "}
          <InlineCode>vectorbea-backend/</InlineCode> directory. The sidecar reads these at
          startup via <InlineCode>AppConfig.fromEnv()</InlineCode>:
        </p>
        <Code>{`# vectorbea-backend/.env

# PostgreSQL connection — use your Supabase "Direct connection" string
# (Settings → Database → Connection string → URI)
DB_URL=jdbc:postgresql://db.<ref>.supabase.co:5432/postgres
DB_USER=postgres
DB_PASSWORD=your-supabase-db-password

# Port the sidecar will listen on
PORT=8080

# LOCAL enables the dev_local_123 bypass token and skips DB auth lookups.
# Change to DEV / STAGE / PROD for non-local environments.
ENVIRONMENT=LOCAL`}</Code>
        <Callout kind="warn">
          Use the <strong>Direct connection</strong> string from Supabase, not the pooler URL.
          The sidecar uses HikariCP with persistent connections; the pooler (PgBouncer) in
          transaction mode is incompatible.
        </Callout>
      </Step>

      {/* Step 3 */}
      <Step n={3} title="Build and run the sidecar">
        <p className="text-sm leading-7 text-muted-foreground">
          From the <InlineCode>vectorbea-backend/</InlineCode> directory, build a fat JAR and
          start it:
        </p>
        <Code>{`cd vectorbea-backend

# Build
./gradlew fatJar

# Run (reads .env automatically via the shell; or export vars first)
export $(cat .env | grep -v '^#' | xargs)
java -jar build/libs/*-all.jar`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          On success you will see:
        </p>
        <Code>{`vectorbea Central Hub API listening on port 8080 [env=LOCAL]
  ⚠  LOCAL mode: Bearer dev_local_123 accepted without DB lookup`}</Code>
        <Callout kind="info">
          The <InlineCode>⚠ LOCAL mode</InlineCode> line confirms the auth bypass is active.
          Any request that sends <InlineCode>Authorization: Bearer dev_local_123</InlineCode>{" "}
          is authenticated as a workspace admin without a database lookup — ideal for local
          development.
        </Callout>
      </Step>

      {/* Step 4 */}
      <Step n={4} title="Smoke-test the sidecar directly">
        <p className="text-sm leading-7 text-muted-foreground">
          Verify the sidecar is healthy and can read the seeded prompt:
        </p>
        <Code>{`# List prompts in the local workspace
curl -s http://localhost:8080/api/prompts \\
  -H "Authorization: Bearer dev_local_123" \\
  -H "X-Workspace-Id: 00000000-0000-0000-0001-000000000002" | jq .

# Expected: array containing the seeded "hello-world" prompt

# Fetch a specific prompt by name
curl -s "http://localhost:8080/api/prompts/hello-world" \\
  -H "Authorization: Bearer dev_local_123" \\
  -H "X-Workspace-Id: 00000000-0000-0000-0001-000000000002" | jq .`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          You should receive the published <InlineCode>hello-world</InlineCode> prompt with its
          template text and version tag. If you get a 401, confirm{" "}
          <InlineCode>ENVIRONMENT=LOCAL</InlineCode> is set.
        </p>
      </Step>

      {/* Step 5 */}
      <Step n={5} title="Generate a real API key from the dashboard">
        <p className="text-sm leading-7 text-muted-foreground">
          The <InlineCode>dev_local_123</InlineCode> bypass only works with{" "}
          <InlineCode>ENVIRONMENT=LOCAL</InlineCode>. For anything beyond your own machine you
          need a real hashed key stored in the database.
        </p>
        <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
          <li>Open the VectorBea dashboard and sign in.</li>
          <li>
            Navigate to <strong>Settings → API Keys</strong> (or the API Keys page in the
            sidebar).
          </li>
          <li>
            Click <strong>Create Key</strong>, give it a name, and choose{" "}
            <strong>admin</strong> role.
          </li>
          <li>
            Copy the key — it is shown <em>once</em>. It starts with{" "}
            <InlineCode>vb_</InlineCode>.
          </li>
        </ol>
        <p className="text-sm leading-7 text-muted-foreground">
          Replace <InlineCode>dev_local_123</InlineCode> with your new key in all subsequent
          curl commands. The sidecar will SHA-256 the raw token and match it against the{" "}
          <InlineCode>api_keys</InlineCode> table.
        </p>
      </Step>

      {/* Step 6 */}
      <Step n={6} title="Write an audit log and verify it appears in the dashboard">
        <p className="text-sm leading-7 text-muted-foreground">
          The sidecar exposes a batch audit ingest endpoint. Use it to push a test event, then
          confirm the dashboard picks it up:
        </p>
        <Code>{`# Push a test audit event to the sidecar
curl -s -X POST http://localhost:8080/api/audit/batch \\
  -H "Authorization: Bearer dev_local_123" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "00000000-0000-0000-0001-000000000002",
    "logs": [
      {
        "promptName":    "hello-world",
        "versionTag":    "v1.0.0",
        "proxyLatencyMs": 3,
        "llmLatencyMs":  420,
        "tokenCount":    128,
        "metadata": { "source": "quickstart-test" }
      }
    ]
  }' | jq .`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          Now open the dashboard, navigate to <strong>Audit Logs</strong> (with your workspace
          selected in the sidebar), and you should see the new entry appear. The{" "}
          <strong>Dashboard</strong> page metrics for the last 24 h will also update.
        </p>
        <Callout kind="info">
          The sidecar writes audit rows directly into{" "}
          <InlineCode>vectorbea.audit_logs</InlineCode> in Supabase. The dashboard queries the
          same table — there is no separate sync step.
        </Callout>
      </Step>

      {/* Step 7 */}
      <Step n={7} title="Create and publish a prompt from the dashboard">
        <p className="text-sm leading-7 text-muted-foreground">
          Confirm the full round-trip: create a prompt in the UI, publish it, then resolve it
          via the sidecar.
        </p>
        <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
          <li>
            In the dashboard, open <strong>Prompts</strong> and click{" "}
            <strong>New Prompt</strong>.
          </li>
          <li>
            Give it a name like <InlineCode>greet-user</InlineCode>, write a template such as{" "}
            <InlineCode>{"Hello {{name}}, welcome to {{product}}!"}</InlineCode>, and save.
          </li>
          <li>
            Click <strong>Publish</strong> to promote the version.
          </li>
          <li>Resolve it through the sidecar:</li>
        </ol>
        <Code>{`# Replace WORKSPACE_ID with your real workspace UUID (shown in the URL)
# Replace YOUR_API_KEY with the key from Step 5 (or dev_local_123 locally)

curl -s "http://localhost:8080/api/prompts/greet-user" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "X-Workspace-Id: WORKSPACE_ID" | jq .published_version`}</Code>
        <p className="text-sm leading-7 text-muted-foreground">
          The response will include the published template text. Any application or agent that
          calls this endpoint gets the latest published version without a code deploy.
        </p>
      </Step>

      {/* Step 8 */}
      <Step n={8} title="Point a real agent at the sidecar">
        <p className="text-sm leading-7 text-muted-foreground">
          Your AI agent or application service should resolve prompts from the sidecar at
          runtime rather than embedding prompt text in code. A minimal integration:
        </p>
        <Code>{`import requests

SIDECAR_URL   = "http://localhost:8080"
API_KEY       = "YOUR_API_KEY"
WORKSPACE_ID  = "YOUR_WORKSPACE_ID"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "X-Workspace-Id": WORKSPACE_ID,
}

def resolve_prompt(name: str) -> dict:
    r = requests.get(f"{SIDECAR_URL}/api/prompts/{name}", headers=headers)
    r.raise_for_status()
    return r.json()

prompt = resolve_prompt("greet-user")
template = prompt["published_version"]["template_text"]
print(template.replace("{{name}}", "Alice").replace("{{product}}", "VectorBea"))`}</Code>
      </Step>

      {/* Troubleshooting */}
      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Troubleshooting</h2>
        <div className="space-y-3 text-sm">
          {[
            {
              problem: "401 Unauthorized from the sidecar",
              fix: "Confirm ENVIRONMENT=LOCAL is exported before starting the JAR. Check that the Authorization header value is exactly Bearer dev_local_123 (no extra spaces).",
            },
            {
              problem: "DB_URL or JDBC_DATABASE_URL must be set on startup",
              fix: "The .env vars are not being sourced. Run export $(cat .env | grep -v '^#' | xargs) before java -jar, or set them in your shell directly.",
            },
            {
              problem: "Prompts page in the dashboard shows nothing",
              fix: "Make sure a workspace is selected in the sidebar (the org dropdown). The page scopes all queries to the active workspaceId in the URL query string.",
            },
            {
              problem: "Audit logs not appearing after a batch ingest",
              fix: "Check the workspaceId in your POST body matches the workspace UUID visible in the dashboard URL. The sidecar silently rejects rows for unknown workspaces.",
            },
            {
              problem: "HikariCP timeout / can't connect to Supabase",
              fix: "Use the Direct connection string (port 5432), not the Supabase pooler (port 6543). The pooler runs in transaction mode which is incompatible with HikariCP.",
            },
          ].map(({ problem, fix }) => (
            <div key={problem} className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-1">
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
            { href: "/docs/architecture", label: "Architecture", desc: "Control-plane vs data-plane, isolation model" },
            { href: "/docs/enterprise", label: "Enterprise deployment", desc: "Multi-region, RBAC, and audit retention" },
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
