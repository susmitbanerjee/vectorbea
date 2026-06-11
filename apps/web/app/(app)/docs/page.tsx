"use client";

/**
 * In-app documentation — /docs
 *
 * Self-contained reference for the platform: what Vectorbea is, how durable
 * long-running workflows are executed, every core concept (connections,
 * agents, tools, approvals, workflows, schedules) with manage instructions,
 * a step-by-step first-workflow guide, and the AI Workflow Architect.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CalendarClock,
  GitBranch,
  Layers,
  Plug,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { Diamond } from "@/components/ui/page-kit";
import { cn } from "@/lib/utils";

// ─── Building blocks ──────────────────────────────────────────────────────────

function MonoLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{children}</p>;
}

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <MonoLabel>{label}</MonoLabel>
      <h2 className="mt-1 text-[20px] font-bold tracking-[-0.015em] text-[#0B0D0F]">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13.5px] leading-[1.75] text-[#4B5563]">{children}</p>;
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-[#0B0D0F]">{children}</span>;
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[12px] border border-[#E0E3E6] bg-white p-5", className)}>{children}</div>;
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[13.5px] leading-[1.65] text-[#4B5563]">
          <span className="mt-[7px] shrink-0"><Diamond size={7} /></span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Steps({ steps }: { steps: { title: string; body: React.ReactNode }[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3.5 rounded-[12px] border border-[#E0E3E6] bg-white p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0B0D0F] font-mono text-[12px] font-semibold text-white">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-[#0B0D0F]">{s.title}</p>
            <div className="mt-1 text-[13px] leading-[1.65] text-[#4B5563]">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ConceptCard({
  icon: Icon, tint, title, what, manage, href, hrefLabel,
}: {
  icon: React.ElementType; tint: string; title: string;
  what: React.ReactNode; manage: React.ReactNode[]; href: Route; hrefLabel: string;
}) {
  return (
    <Panel>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]" style={{ background: tint }}>
          <Icon className="h-[18px] w-[18px] text-white" strokeWidth={1.9} />
        </span>
        <h3 className="text-[15.5px] font-bold tracking-[-0.01em] text-[#0B0D0F]">{title}</h3>
        <Link href={href} className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#007F4E] hover:underline">
          {hrefLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-3 text-[13.5px] leading-[1.7] text-[#4B5563]">{what}</div>
      <div className="mt-3.5 rounded-[10px] border border-[#ECEEEF] bg-[#FAFBFB] p-3.5">
        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Create · edit · delete</p>
        <Bullets items={manage} />
      </div>
    </Panel>
  );
}

// ─── Table of contents ────────────────────────────────────────────────────────

const TOC = [
  { id: "what-is",        label: "What is Vectorbea" },
  { id: "problem",        label: "The problem" },
  { id: "durability",     label: "How durability works" },
  { id: "use-cases",      label: "Use cases" },
  { id: "concepts",       label: "Core concepts" },
  { id: "first-workflow", label: "Your first workflow" },
  { id: "architect",      label: "AI Workflow Architect" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeId, setActiveId] = useState<string>("what-is");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) { setActiveId(entry.target.id); break; }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    TOC.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-[#FAFBFB]">
      {/* Header */}
      <div className="border-b border-[#E0E3E6] bg-white px-6 py-6 lg:px-10">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-[#0B0D0F]">
            <BookOpen className="h-5 w-5 text-white" strokeWidth={1.8} />
          </span>
          <div>
            <MonoLabel>Documentation</MonoLabel>
            <h1 className="mt-0.5 text-[24px] font-bold leading-tight tracking-[-0.02em] text-[#0B0D0F]">Vectorbea Docs</h1>
            <p className="mt-1 text-[13.5px] text-[#6B7280]">Everything you need to build, run, and govern durable AI workflows.</p>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-5xl gap-10 px-6 py-8 lg:px-10">
        {/* ── Sticky TOC ── */}
        <nav className="sticky top-8 hidden h-fit w-48 shrink-0 lg:block">
          <MonoLabel>On this page</MonoLabel>
          <ul className="mt-2.5 space-y-px border-l border-[#E0E3E6]">
            {TOC.map(({ id, label }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className={cn(
                    "-ml-px block border-l-2 py-1.5 pl-3 text-[12.5px] transition-colors",
                    activeId === id
                      ? "border-[#007F4E] font-semibold text-[#006B45]"
                      : "border-transparent font-medium text-[#6B7280] hover:text-[#0B0D0F]",
                  )}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ── Content ── */}
        <div className="min-w-0 flex-1 space-y-12 pb-16">

          {/* 1. What is Vectorbea */}
          <Section id="what-is" label="01 · Introduction" title="What is Vectorbea?">
            <P>
              Vectorbea is a <B>control plane for durable AI workflows</B>. You compose agents, tools, and
              connections into workflows on a visual canvas, run them with full observability, and govern
              them with human approval gates. Every run is checkpointed — when something fails or waits,
              the workflow <B>resumes from the last checkpoint instead of restarting</B>.
            </P>
            <Panel className="bg-[#0B0D0F] text-white">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6B7280]">The one-liner</p>
              <p className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.01em]">
                Agents that resume, <span className="text-[#34D399]">not restart.</span>
              </p>
            </Panel>
            <Bullets items={[
              <><B>Visual canvas</B> — drag-and-drop builder for triggers, agents, LLM calls, tools, branches, parallel fan-outs, approval gates, and checkpoints.</>,
              <><B>Durable runtime</B> — Kotlin workers execute runs from a queue with leases, retries, timeouts, and crash recovery.</>,
              <><B>Observability</B> — every run produces an event timeline, structured logs, token/cost accounting, and failure diagnosis.</>,
              <><B>Governance</B> — approval gates, risk-leveled tools, read-only connections, and a full audit trail.</>,
              <><B>BYOK</B> — bring your own LLM provider keys (OpenAI, Anthropic, Azure, Gemini, Bedrock); secrets are AES-256-GCM encrypted.</>,
            ]} />
          </Section>

          {/* 2. The problem */}
          <Section id="problem" label="02 · Why" title="The problem Vectorbea solves">
            <P>
              Real AI automation is <B>long-running</B>. A renewal pipeline waits days for a manager&apos;s
              decision. A research agent makes fifty LLM and API calls. A data workflow processes thousands
              of records. Stitching this together with scripts or basic agent frameworks breaks down fast:
            </P>
            <Bullets items={[
              <><B>Crashes lose everything.</B> A timeout at step 9 of 10 means re-running steps 1–8 — repaying every token and re-firing every side effect.</>,
              <><B>Side effects are unsafe to retry.</B> Naively re-running a workflow can send the same email twice or double-write to your CRM.</>,
              <><B>Humans can&apos;t intervene.</B> There is no first-class way to pause a pipeline for sign-off and continue exactly where it stopped.</>,
              <><B>No visibility.</B> When an agent misbehaves you need the exact prompt, tool calls, outputs, latency and cost — not a print statement.</>,
              <><B>No governance.</B> Teams need risk controls before agents touch production databases and customer inboxes.</>,
            ]} />
            <P>
              Vectorbea treats the workflow run as a <B>durable, event-sourced entity</B> rather than a
              process in memory — so waiting, failing, retrying, and resuming are normal, cheap operations.
            </P>
          </Section>

          {/* 3. Durability */}
          <Section id="durability" label="03 · Architecture" title="How long-running workflows are handled">
            <P>
              When you start a run, the API enqueues it and a <B>worker</B> picks it up under a lease.
              The worker walks the workflow graph node by node. After every node, outputs are persisted —
              that is the <B>checkpoint</B>. The run&apos;s entire history is an append-only event stream.
            </P>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Diamond, title: "Checkpoints", body: "Every node's validated output is stored (step outputs + run checkpoints). A resume replays state from storage instead of re-executing finished nodes." },
                { icon: RotateCcw, title: "Resume, not restart", body: "Failures, approval waits, timeouts, and worker crashes all converge on the same path: load the last checkpoint, continue from the next node." },
                { icon: ShieldCheck, title: "Leases + idempotency", body: "Workers hold a lease per run, so a crashed worker's runs are safely re-claimed. Tool calls carry idempotency semantics so retries don't duplicate side effects." },
                { icon: Zap, title: "Retries, timeouts, DLQ", body: "Per-node retry policies (fixed/exponential backoff), step and run timeouts, and a dead-letter path for runs that exhaust recovery options." },
              ].map(({ icon: Icon, title, body }) => (
                <Panel key={title} className="p-4">
                  <div className="flex items-center gap-2">
                    {Icon === Diamond ? <Diamond size={9} /> : <Icon className="h-4 w-4 text-[#007F4E]" strokeWidth={2} />}
                    <p className="text-[13.5px] font-bold text-[#0B0D0F]">{title}</p>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-[1.65] text-[#6B7280]">{body}</p>
                </Panel>
              ))}
            </div>
            <P>
              <B>Approval gates</B> take this further: a run that reaches a gate is parked — it consumes no
              compute while waiting hours or days. The moment a human approves, the worker resumes from the
              checkpoint before the gate. Rejections end the run cleanly with a full audit trail. If a run
              does fail, the <B>recovery engine</B> classifies the failure (auth, network, rate limit, data…)
              and offers one-click <B>Retry / Resume from checkpoint</B> on the run page.
            </P>
          </Section>

          {/* 4. Use cases */}
          <Section id="use-cases" label="04 · Inspiration" title="Long-running use cases that fit Vectorbea">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { title: "Contract renewal pipeline", body: "Nightly trigger pulls upcoming renewals from your DB → an agent scores churn risk → high-risk accounts pause at an approval gate for the account manager → on approval, personalized outreach is drafted and sent. The run can wait days at the gate at zero cost." },
                { title: "Claims / ticket triage with human review", body: "Webhook receives a claim → agent extracts entities and checks policy via tools → low-risk cases are auto-resolved; uncertain ones checkpoint and escalate to a human gate → resume with the reviewer's decision injected into context." },
                { title: "Monthly analytics & reporting", body: "Schedule queries warehouses, calls analytics APIs, has an agent compose a dashboard narrative, and emails the result — each stage checkpointed, so a flaky API at step 4 never repeats the expensive steps 1–3." },
                { title: "Bulk data migration / enrichment", body: "Process thousands of records in batches with checkpoints between batches. A crash at record 8,000 resumes at 8,001 — not at zero. DB writes use read-only or approval-gated connections for safety." },
                { title: "Deep research agent", body: "Iterative agent loops across search, scraping, and synthesis tools over hours. Every iteration is an event; you watch progress live in the run timeline and can stop, inspect, or resume at any point." },
                { title: "Incident response copilot", body: "Alert webhook starts a run → agent gathers logs and metrics via tools → proposes remediation → a gate requires on-call approval before any mutating action executes." },
              ].map(({ title, body }) => (
                <Panel key={title} className="p-4">
                  <p className="text-[13.5px] font-bold text-[#0B0D0F]">{title}</p>
                  <p className="mt-1.5 text-[12.5px] leading-[1.65] text-[#6B7280]">{body}</p>
                </Panel>
              ))}
            </div>
          </Section>

          {/* 5. Core concepts */}
          <Section id="concepts" label="05 · Reference" title="Core concepts">
            <div className="space-y-4">
              <ConceptCard
                icon={Plug} tint="#2563EB" title="Connections" href={"/connections" as Route} hrefLabel="Open Connections"
                what={<>A connection is a <B>credentialed link to an external system</B>: an LLM provider (OpenAI, Anthropic, Azure OpenAI, Gemini, Bedrock), a database (PostgreSQL, MySQL, and more), an HTTP API, a SaaS platform, an MCP server, a vector store, or object storage. Secrets are encrypted with AES-256-GCM the moment you save them and are never displayed again — only masked values. Connections carry network policy too: private hosts are flagged for IP whitelisting or a private runner.</>}
                manage={[
                  <><B>Create:</B> Connections → New Connection → pick a type → fill credentials → review network access → <B>Test &amp; save</B>. Testing verifies reachability and auth before anything depends on it.</>,
                  <><B>Edit:</B> open a connection → <B>Settings</B> tab for name, environment, and config; <B>Credentials</B> tab to rotate the secret (references from agents/tools are unaffected).</>,
                  <><B>Test:</B> the Test Connection button on the detail page re-checks liveness and records latency + history.</>,
                  <><B>Delete:</B> from the Connections list card actions. Check the <B>Used By</B> panel first — agents and tools referencing it will fail.</>,
                ]}
              />
              <ConceptCard
                icon={Bot} tint="#7C3AED" title="Agents" href={"/agents" as Route} hrefLabel="Open Agents"
                what={<>An agent is a <B>reusable AI worker definition</B>: which LLM connection and model it uses, its system prompt, temperature, max iterations, and which tools it may call. Types include Native LLM agents (Vectorbea owns execution and checkpointing), tool agents, router agents that delegate to sub-agents, approval agents, and imported/external instrumented agents. Policies are attached per agent: memory (none / run / workflow / vector), retry with backoff, step &amp; run timeouts, and an approval requirement.</>}
                manage={[
                  <><B>Create:</B> Agents → New Agent → pick a type → choose the LLM connection + model → write instructions → select allowed tools → set policies → Create.</>,
                  <><B>Edit:</B> open an agent → <B>Edit</B> — name, prompt, model config, and allowed tools are editable inline across the tabs.</>,
                  <><B>Delete:</B> the Delete button on the agent detail page (confirmation required, cannot be undone).</>,
                ]}
              />
              <ConceptCard
                icon={Wrench} tint="#0F766E" title="Tools" href={"/tools" as Route} hrefLabel="Open Tools"
                what={<>A tool is a <B>typed capability an agent can invoke</B>: an HTTP endpoint, a database read or write, an email send, a CRM action, an MCP tool, or a custom function. Every tool declares an input/output schema (so mapping and validation are automatic), a timeout, a retry policy, idempotency, and a <B>risk level</B> — low (read-only) through critical (irreversible: payments, sends, deletions). Database tools use SQL templates with <code className="rounded border border-[#E0E3E6] bg-[#F7F8F9] px-1 font-mono text-[11px]">{"{{param}}"}</code> placeholders that agents fill at runtime; high-risk writes can demand a human approval before executing.</>}
                manage={[
                  <><B>Create:</B> Tools → New Tool → choose a type and risk level → bind a compatible connection → for DB tools, browse the schema to auto-generate the SQL template and schemas → Register.</>,
                  <><B>Edit:</B> open a tool → <B>Edit</B> — endpoint, headers, SQL, timeout, risk level, and connection binding are editable inline.</>,
                  <><B>Delete:</B> from the Tools list card actions; agents referencing the tool lose that capability.</>,
                ]}
              />
              <ConceptCard
                icon={ShieldCheck} tint="#CA8A04" title="Approvals" href={"/approvals" as Route} hrefLabel="Open Approvals"
                what={<>An approval gate is a <B>node that pauses a run for a human decision</B>. The run checkpoints, parks (no compute is consumed), and appears in the Approvals queue with its decision context — template fields in the gate message are filled from upstream step outputs when the run arrives. <B>Approve &amp; resume</B> continues the run from the checkpoint; <B>Reject</B> ends it. Both decisions are recorded with who and when, for the audit trail.</>}
                manage={[
                  <><B>Add a gate:</B> in the builder, add an <B>Approval Gate</B> node from the Governance group and place it before any risky step.</>,
                  <><B>Decide:</B> Approvals page → pending gate → review the context → Approve &amp; resume, or Reject.</>,
                  <><B>Per-agent / per-tool:</B> agents have an approval policy, and database write tools have a &quot;require approval&quot; flag — both inject gates without canvas changes.</>,
                ]}
              />
              <ConceptCard
                icon={GitBranch} tint="#007F4E" title="Workflows & Runs" href={"/workflows" as Route} hrefLabel="Open Workflows"
                what={<>A workflow is the <B>versioned graph</B> connecting a trigger to agents, tools, control flow (branch, parallel, join, timer), governance nodes, and an end node. Starting it creates a <B>run</B> — the durable, event-sourced execution you can watch live: timeline, structured logs, token/cost usage, checkpoints, and recovery actions. Runs can be executed in <B>simulation</B> (no real side effects) before going live.</>}
                manage={[
                  <><B>Create:</B> Workflows → New — start from the AI Architect, a template, or a blank canvas.</>,
                  <><B>Edit:</B> open the workflow → <B>Builder</B>; saving creates a new version, so in-flight runs are unaffected.</>,
                  <><B>Run:</B> Run Now on the workflow page or the builder, via a schedule, or via webhook trigger.</>,
                ]}
              />
              <ConceptCard
                icon={CalendarClock} tint="#B45309" title="Schedules" href={"/schedules" as Route} hrefLabel="Open Schedules"
                what={<>A schedule fires a workflow on a <B>cron expression</B> — hourly syncs, nightly pipelines, monthly reports. Each firing creates a normal durable run, so an overrunning job never overlaps unsafely and failures recover like any other run.</>}
                manage={[
                  <><B>Create:</B> Schedules → New schedule → pick the workflow and cron expression.</>,
                  <><B>Pause / edit / delete:</B> from the schedule card — the next-fire time is always shown.</>,
                ]}
              />
            </div>
          </Section>

          {/* 6. First workflow */}
          <Section id="first-workflow" label="06 · Tutorial" title="Build your first workflow, step by step">
            <Steps steps={[
              { title: "Add a connection", body: <>Go to <B>Connections → New Connection</B>. Pick <B>LLM Provider</B>, paste your API key (encrypted on save), and run <B>Test &amp; save</B>. Repeat for your database or API if the workflow needs data.</> },
              { title: "Register a tool", body: <>Go to <B>Tools → New Tool</B>. For a database read: choose <B>Database (Read)</B>, bind the DB connection, browse the schema, and let Vectorbea generate the SQL template and input/output schemas. Set an honest risk level.</> },
              { title: "Create an agent", body: <>Go to <B>Agents → New Agent</B> → Native LLM Agent. Choose the LLM connection and model, write the system prompt, and tick the tools it may call. Set retry/timeout policies (the defaults are sane).</> },
              { title: "Compose the workflow", body: <>Go to <B>Workflows → New → blank canvas</B>. Add a <B>Trigger</B> (manual, schedule, or webhook), then your tool and agent nodes from the palette (or press <code className="rounded border border-[#E0E3E6] bg-[#F7F8F9] px-1 font-mono text-[11px]">⌘K</code>). Connect nodes by dragging between handles.</> },
              { title: "Map inputs — no JSON required", body: <>Select a node → <B>Inputs</B> tab. Vectorbea suggests mappings from upstream outputs (&quot;<B>Map all</B>&quot; applies every confident match); each field can also be picked manually from a typed field list.</> },
              { title: "Add governance", body: <>Place an <B>Approval Gate</B> before anything irreversible (sending email, writing data). Add a <B>Checkpoint</B> node after expensive stages to make resume points explicit.</> },
              { title: "Simulate, then run", body: <>Hit <B>Test</B> for a simulation run — no real side effects. Inspect the run timeline and logs. When it looks right, <B>Run</B> for real execution (subject to your workspace execution mode).</> },
              { title: "Observe and operate", body: <>Open <B>Runs</B> to watch executions live. If something fails, the Recovery tab explains why and offers <B>Resume from checkpoint</B>. Add a <B>Schedule</B> to run it automatically.</> },
            ]} />
          </Section>

          {/* 7. Architect */}
          <Section id="architect" label="07 · Accelerator" title="AI Workflow Architect">
            <P>
              The Architect turns a <B>plain-English goal into a runnable workflow</B>. Describe the outcome —
              &quot;every Monday, pull contracts renewing in 30 days, score churn risk, and email the account
              owner a summary; ask me before anything is sent&quot; — and it does the rest.
            </P>
            <Steps steps={[
              { title: "Describe the goal", body: "One or two sentences. The Architect asks up to a handful of clarifying questions only when the goal is genuinely ambiguous." },
              { title: "Review the plan", body: "It proposes the node graph, agents (with drafted system prompts), tools, and a confidence meter. You approve the plan before anything is created." },
              { title: "Wire connections", body: "It detects which connections the plan needs, shows readiness, and lets you pick existing connections or create missing ones in place." },
              { title: "Build & refine", body: "Agents, tools, and the workflow are created and laid out on the canvas. From there it's a normal workflow — edit any node, remap inputs, add gates, simulate, run." },
            ]} />
            <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[#9CCFBB] bg-[#E6F4EF]/50 p-5">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 shrink-0 text-[#007F4E]" />
                <p className="text-[13.5px] font-medium text-[#0B0D0F]">Fastest way to a working workflow — describe it, then refine on the canvas.</p>
              </div>
              <Link
                href={"/workflows/new/architect" as Route}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[8px] bg-[#007F4E] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#006B45]"
              >
                Try the Architect <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Section>

          {/* Footer */}
          <div className="flex items-start gap-3 rounded-[12px] border border-[#ECEEEF] bg-white p-5">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-[#9CA3AF]" />
            <div className="text-[13px] leading-[1.7] text-[#6B7280]">
              <p><B>Need more?</B> Check <Link href={"/settings/usage" as Route} className="font-medium text-[#007F4E] hover:underline">Usage &amp; limits</Link> for your workspace quotas, or reach us at{" "}
                <a href="mailto:support@vectorbea.com" className="font-medium text-[#007F4E] hover:underline">support@vectorbea.com</a>.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
