import * as React from "react";
import Link from "next/link";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { RecoveryLoop } from "./recovery-loop";
import { Reveal } from "./reveal";
import { Wordmark } from "~/components/app/shell/wordmark";
import { APPROVALS, RIBBON_SHAPES } from "~/mocks/fixtures";
import {
  CheckpointIcon, ResumeFromCheckpointIcon, ApprovalGateIcon, BlastRadiusIcon,
  ByokKeyIcon, TokenMeterIcon, AgentBrainIcon, IncidentIcon, LeaseIcon,
  CommitBoundaryIcon, FanOutIcon, RootCauseIcon,
} from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   THE LANDING PAGE.

   The reader is a platform or ops lead who has seen fifty AI-workflow landing
   pages this quarter and believes none of them. So the page is an ARGUMENT in
   nine moves, not a feature list:

     1  here is the thing working, including the part where it breaks
     2  here is what it costs you when you do not have this
     3  here is the mechanism, in detail
     4  here is the surface you would actually operate
     5  here is where a person stays in the loop
     6  here is how it fits what you already run
     7  here is honestly where it does and does not beat the alternatives
     8  here is what happens to your keys and your data
     9  here is the door

   Light throughout with two dark bands — hero and anatomy. The bands are
   structural: they mark the two moments where the page stops selling and shows
   you the machine.
══════════════════════════════════════════════════════════════════════════════ */

function Section({
  children, className, dark = false, id,
}: {
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(dark ? "dark bg-surface-app" : "bg-surface-base", className)}
    >
      <div className="mx-auto w-full max-w-(--container-marketing) px-5 py-16 sm:px-8 sm:py-24">
        {children}
      </div>
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Text variant="eyebrow" tone="accent" className="mb-3 block">{children}</Text>;
}

/* ── 1 · Hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="dark bg-surface-app relative overflow-hidden">
      <nav className="mx-auto flex w-full max-w-(--container-marketing) items-center gap-6 px-5 py-5 sm:px-8">
        <Link href="/" className="rounded-sm outline-none focus-visible:focus-ring">
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link
            href={"/docs" as never}
            className="font-ui text-body-sm text-fg-secondary hover:text-fg-primary rounded-sm px-2 py-1 transition-colors duration-fast outline-none focus-visible:focus-ring"
          >
            Docs
          </Link>
          <Link
            href={"/compare" as never}
            className="font-ui text-body-sm text-fg-secondary hover:text-fg-primary hidden rounded-sm px-2 py-1 transition-colors duration-fast outline-none focus-visible:focus-ring sm:block"
          >
            Compare
          </Link>
          <Button asChild size="sm" variant="secondary">
            <Link href={"/signin" as never}>Sign in</Link>
          </Button>
          <Button asChild size="sm" variant="primary">
            <Link href={"/signup" as never}>Start free</Link>
          </Button>
        </div>
      </nav>

      <div className="mx-auto w-full max-w-(--container-marketing) px-5 pb-16 pt-8 sm:px-8 sm:pb-20 sm:pt-12">
        {/* Centred on lg so the demo sits against the middle of the headline
            block rather than leaving a void beneath it — the two columns are
            naturally different heights and top-aligning them wastes a screen. */}
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-14">
          <div>
            <Eyebrow>Durable execution for agentic workflows</Eyebrow>

            <h1 className="font-display text-display-lg sm:text-display-xl lg:text-display-2xl text-fg-max text-balance">
              Agents that resume,
              <br />
              not restart.
            </h1>

            <Text variant="body-lg" tone="secondary" className="mt-6 block max-w-[52ch]">
              Every completed step commits a checkpoint that survives a crash. When a tool call
              fails at step 7 of 12, the run resumes at step 7 — it does not replay the six steps
              that already worked, or the side effects they caused.
            </Text>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" variant="primary">
                <Link href={"/signup" as never}>Start free</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href={"/docs" as never}>Read the docs</Link>
              </Button>
            </div>

            <Text variant="caption" tone="muted" className="mt-6 block max-w-[46ch]">
              Bring your own model keys. Runs execute on our workers or inside your VPC. No training
              on your data, ever.
            </Text>
          </div>

          <Reveal>
            <RecoveryLoop />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── 2 · What breaks without durability ───────────────────────────────────── */

const FAILURE_MODES: { icon: IconComponent; title: string; body: string }[] = [
  {
    icon: IncidentIcon,
    title: "A crash loses everything",
    body: "The process dies at step 9 and the work from steps 1–8 dies with it. There is no record of what completed, so the only safe move is to start again.",
  },
  {
    icon: ResumeFromCheckpointIcon,
    title: "Retries are unsafe",
    body: "Re-running the whole workflow re-sends the emails, re-charges the cards and re-writes the rows. Without idempotency keys and commit boundaries, a retry is a second incident.",
  },
  {
    icon: ApprovalGateIcon,
    title: "A person cannot intervene",
    body: "Anything that needs a human decision has to be split into two workflows with a queue between them, or it runs unsupervised. Neither is what you wanted.",
  },
  {
    icon: RootCauseIcon,
    title: "Nothing explains itself",
    body: "You get a stack trace and a bill. Not which node failed, not what it had already committed, not which of the 83 failures share one root cause.",
  },
];

function CostRow({ label, naive, durable, naiveTone = "failed" }: {
  label: string;
  naive: string;
  durable: string;
  naiveTone?: "failed" | "neutral";
}) {
  return (
    <tr className="border-subtle border-b last:border-b-0">
      <th scope="row" className="font-ui text-body-sm text-fg-secondary py-2.5 pr-4 text-left font-normal">
        {label}
      </th>
      <td className={cn(
        "font-code text-mono-sm tabular py-2.5 pr-4 text-right",
        naiveTone === "failed" ? "text-status-failed" : "text-fg-secondary",
      )}>
        {naive}
      </td>
      <td className="font-code text-mono-sm tabular text-status-success py-2.5 text-right">
        {durable}
      </td>
    </tr>
  );
}

function WhatBreaks() {
  return (
    <Section id="durability">
      <Reveal>
        <Eyebrow>The problem</Eyebrow>
        <Text variant="display-md" tone="max" as="h2" className="max-w-[22ch] text-balance">
          What breaks when a workflow has no memory
        </Text>
        <Text variant="body-lg" tone="secondary" className="mt-4 block max-w-[62ch]">
          These are not edge cases. They are what happens on an ordinary Tuesday when a provider
          rate-limits you.
        </Text>
      </Reveal>

      <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2">
        {FAILURE_MODES.map((mode, i) => (
          <Reveal key={mode.title} delay={i * 40}>
            <mode.icon size={24} aria-hidden="true" className="text-accent mb-3" />
            <Text variant="heading-sm" tone="max" as="h3" className="mb-1.5 block">{mode.title}</Text>
            <Text variant="body-sm" tone="secondary" className="block max-w-[46ch]">{mode.body}</Text>
          </Reveal>
        ))}
      </div>

      {/* The comparison, with real numbers from the run in the hero. */}
      <Reveal className="mt-14 block">
        <div className="border-subtle bg-surface-sunken rounded-lg border p-5 sm:p-7">
          <Text variant="heading-md" tone="max" as="h3" className="block">
            The same failure, recovered two ways
          </Text>
          <Text variant="body-sm" tone="secondary" className="mt-2 block max-w-[64ch]">
            A 12-node renewals workflow. Six nodes committed, then <span className="font-code text-mono-sm">stripe.getInvoice</span>{" "}
            fails on a refused connection. Here is what the recovery costs.
          </Text>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr className="border-subtle border-b">
                  <th className="py-2 pr-4" />
                  <th className="font-ui text-eyebrow text-fg-muted py-2 pr-4 text-right uppercase">
                    Naive re-run
                  </th>
                  <th className="font-ui text-eyebrow text-fg-muted py-2 text-right uppercase">
                    Checkpoint resume
                  </th>
                </tr>
              </thead>
              <tbody>
                <CostRow label="Nodes executed" naive="12" durable="1" />
                <CostRow label="Tool calls issued" naive="9" durable="1" />
                <CostRow label="Tokens spent" naive="14,820" durable="1,204" />
                <CostRow label="Cost of the retry" naive="$0.0474" durable="$0.0031" />
                <CostRow label="Duplicate Slack messages" naive="2" durable="0" />
                <CostRow label="Duplicate Stripe writes" naive="1" durable="0" />
                <CostRow label="Time to recover" naive="1m 48s" durable="9.4s" naiveTone="neutral" />
              </tbody>
            </table>
          </div>

          <Text variant="caption" tone="muted" className="mt-4 block max-w-[64ch]">
            The token and time figures are the ones that show up on a bill. The duplicate writes are
            the ones that show up in a support queue.
          </Text>
        </div>
      </Reveal>
    </Section>
  );
}

/* ── 3 · Anatomy of a run (dark band) ─────────────────────────────────────── */

const ANATOMY: { icon: IconComponent; term: string; body: string; detail: string }[] = [
  {
    icon: CommitBoundaryIcon,
    term: "Commit boundary",
    body: "Every node ends at a boundary. The output, the inputs that produced it and the side effects it caused are written together, or not at all.",
    detail: "append-only · one row per boundary",
  },
  {
    icon: CheckpointIcon,
    term: "Checkpoint",
    body: "The boundary that survives a crash. A checkpoint is the durable claim that this node will never need to run again.",
    detail: "durable · idempotency key attached",
  },
  {
    icon: LeaseIcon,
    term: "Lease",
    body: "A worker does not own a job, it leases it. If the worker dies mid-node, the lease expires and another worker picks the run up from the last checkpoint.",
    detail: "30s renewable · expiry hands the job back",
  },
  {
    icon: ApprovalGateIcon,
    term: "Gate",
    body: "The run suspends and its state is persisted. Nothing is held in memory waiting for a person; the run can wait four hours or four days at no cost.",
    detail: "suspended · SLA timer running",
  },
  {
    icon: ResumeFromCheckpointIcon,
    term: "Resume",
    body: "Execution restarts at the first node after the last checkpoint. Committed nodes are not replayed, so their side effects are not repeated.",
    detail: "replays 0 committed nodes",
  },
];

function Anatomy() {
  return (
    <Section id="anatomy" dark>
      <Reveal>
        <Eyebrow>The mechanism</Eyebrow>
        <Text variant="display-md" tone="max" as="h2" className="max-w-[20ch] text-balance">
          Anatomy of a durable run
        </Text>
        <Text variant="body-lg" tone="secondary" className="mt-4 block max-w-[62ch]">
          Runs are event-sourced. The log is the source of truth and the current state is derived
          from it, which is what makes resume exact rather than best-effort.
        </Text>
      </Reveal>

      <ol className="mt-12 grid gap-px">
        {ANATOMY.map((item, i) => (
          <Reveal key={item.term} delay={i * 40} as="li">
            <div className="border-subtle grid gap-3 border-t py-6 sm:grid-cols-[auto_14rem_1fr] sm:items-start sm:gap-6">
              <span className="bg-accent-subtle text-accent grid size-9 shrink-0 place-items-center rounded-md">
                <item.icon size={20} aria-hidden="true" />
              </span>
              <div>
                <Text variant="heading-sm" tone="max" as="h3" className="block">{item.term}</Text>
                <Text variant="mono-sm" tone="muted" className="mt-0.5 block">{item.detail}</Text>
              </div>
              <Text variant="body-sm" tone="secondary" className="block max-w-[54ch]">{item.body}</Text>
            </div>
          </Reveal>
        ))}
      </ol>

      <Reveal className="mt-12 block">
        <div className="bg-surface-raised border-subtle rounded-lg border p-5">
          <Text variant="eyebrow" tone="muted" className="mb-3 block">
            The same run, after recovery
          </Text>
          <CheckpointRibbon
            nodes={RIBBON_SHAPES[5].run.nodes}
            size="md"
            runId="anatomy-ribbon"
          />
          <Text variant="caption" tone="muted" className="mt-3 block max-w-[62ch]">
            Two nodes failed once and committed on retry — the ember notch. One branch was not
            taken. Everything else committed first time. The shape of the run is the record.
          </Text>
        </div>
      </Reveal>
    </Section>
  );
}

/* ── 4 · Control plane ────────────────────────────────────────────────────── */

const PLANE: { icon: IconComponent; title: string; body: string }[] = [
  {
    icon: FanOutIcon,
    title: "Visual canvas",
    body: "Build the graph, or import one. Branches, fan-out, loops, waits and gates are first-class nodes rather than code you maintain.",
  },
  {
    icon: BlastRadiusIcon,
    title: "Observability that resolves",
    body: "Every number links to its cause. A 41% success rate opens the three incidents behind it; a failing connection tells you the seven tools it blocks.",
  },
  {
    icon: TokenMeterIcon,
    title: "Governance and budgets",
    body: "Per-workflow spend caps, token ceilings, risk tiers that require approval, and forecasting that says when you hit the cap at the current rate.",
  },
  {
    icon: ByokKeyIcon,
    title: "Bring your own keys",
    body: "Your Anthropic, OpenAI, Gemini or Mistral keys, encrypted with AES-256-GCM and decrypted only inside the runner that needs them.",
  },
];

function ControlPlane() {
  const run = RIBBON_SHAPES[2].run;

  return (
    <Section id="control-plane">
      <Reveal>
        <Eyebrow>The surface</Eyebrow>
        <Text variant="display-md" tone="max" as="h2" className="max-w-[22ch] text-balance">
          A control plane, not a dashboard
        </Text>
        <Text variant="body-lg" tone="secondary" className="mt-4 block max-w-[62ch]">
          The screens are built for the person who gets paged, not for the screenshot. Everything
          below is the real interface.
        </Text>
      </Reveal>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-1">
          {PLANE.map((item, i) => (
            <Reveal key={item.title} delay={i * 40}>
              <item.icon size={22} aria-hidden="true" className="text-accent mb-2.5" />
              <Text variant="heading-sm" tone="max" as="h3" className="mb-1 block">{item.title}</Text>
              <Text variant="body-sm" tone="secondary" className="block max-w-[44ch]">{item.body}</Text>
            </Reveal>
          ))}
        </div>

        {/* Real components, assembled the way the product assembles them. */}
        <Reveal delay={80}>
          <div className="bg-surface-raised border-subtle overflow-hidden rounded-lg border">
            <div className="border-subtle flex items-center gap-3 border-b px-4 py-2.5">
              <Text variant="eyebrow" tone="muted">Runs</Text>
              <Text variant="caption" tone="muted" className="tabular ml-auto">163 runs · 83 failed</Text>
            </div>

            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-subtle border-b">
                  {["Run", "Workflow", "Shape", "Cost"].map((h) => (
                    <th key={h} className="font-ui text-eyebrow text-fg-muted px-3 py-1.5 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RIBBON_SHAPES.slice(0, 5).map((shape) => (
                  <tr key={shape.label} className="border-subtle border-b last:border-b-0">
                    <td className="px-3 py-1.5">
                      <MonoId value={shape.run.id} head={9} tail={4} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Text variant="caption" tone="secondary">{shape.run.workflowName}</Text>
                    </td>
                    <td className="px-3 py-1.5">
                      <CheckpointRibbon nodes={shape.run.nodes} size="xs" runId={`lp-${shape.label}`} />
                    </td>
                    <td className="font-code text-mono-sm tabular text-fg-muted px-3 py-1.5">
                      ${shape.run.costUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-subtle bg-surface-sunken border-t px-4 py-3">
              <Text variant="caption" tone="muted" className="block">
                Every row carries its ribbon, so you see where a run died without opening it.
              </Text>
            </div>
          </div>

          <div className="bg-surface-raised border-subtle mt-4 rounded-lg border p-4">
            <Text variant="eyebrow" tone="muted" className="mb-2 block">Recovery engine</Text>
            <Text variant="body-sm" tone="primary" className="block">
              Connection <span className="font-code">Postgres Answers</span> is refusing connections.
            </Text>
            <Text variant="caption" tone="muted" className="mt-1 block">
              41 runs share this signature · 3 workflows and 7 tools blocked
            </Text>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary">Fix connection</Button>
              <Button size="sm" variant="secondary">Retry 41 runs from checkpoint</Button>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── 5 · Approval gates ───────────────────────────────────────────────────── */

function Approvals() {
  const approval = APPROVALS[0];

  return (
    <Section id="approvals">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
        <Reveal>
          <Eyebrow>Humans in the loop</Eyebrow>
          <Text variant="display-md" tone="max" as="h2" className="max-w-[20ch] text-balance">
            Pause mid-run for a person
          </Text>
          <Text variant="body-lg" tone="secondary" className="mt-4 block max-w-[52ch]">
            A gate suspends the run and persists its state. The reviewer sees the resolved values the
            agent actually computed — not the template that produced them — alongside where each one
            came from.
          </Text>
          <Text variant="body-sm" tone="secondary" className="mt-4 block max-w-[52ch]">
            Approve, reject with a required reason, or request changes. The decision is written to the
            audit trail with the context it was made on, so it can be defended six months later.
          </Text>
        </Reveal>

        <Reveal delay={80}>
          <div className="bg-surface-raised border-subtle overflow-hidden rounded-lg border">
            <div className="border-status-waiting-border bg-status-waiting-subtle flex items-center gap-2 border-b px-4 py-2.5">
              <ApprovalGateIcon size={16} aria-hidden="true" className="text-status-waiting" />
              <Text variant="body-sm" className="text-status-waiting">Awaiting approval</Text>
              <Text variant="caption" tone="muted" className="tabular ml-auto">SLA 26m remaining</Text>
            </div>

            <dl className="divide-subtle divide-y">
              {approval.context.map((row) => (
                <div key={row.label} className="grid gap-0.5 px-4 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
                  <dt className="font-ui text-caption text-fg-muted">{row.label}</dt>
                  <dd>
                    <span className="font-ui text-body-sm text-fg-primary block">{row.value}</span>
                    <span className="font-code text-mono-sm text-fg-disabled block">{row.source}</span>
                  </dd>
                </div>
              ))}
            </dl>

            <div className="border-subtle flex flex-wrap gap-2 border-t px-4 py-3">
              <Button size="sm" variant="primary">Approve</Button>
              <Button size="sm" variant="secondary">Request changes</Button>
              <Button size="sm" variant="ghost">Reject</Button>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── 6 · Interoperability ─────────────────────────────────────────────────── */

function Interop() {
  const frameworks = [
    { name: "LangChain", note: "Call a chain as a node. Inputs and outputs map through the standard schema." },
    { name: "CrewAI", note: "Run a crew as a single durable step, with its own checkpoint boundary." },
    { name: "AutoGen", note: "Wrap a conversation; the transcript is captured in the run's event log." },
    { name: "Any HTTP agent", note: "If it answers a POST, it is a tool. Auth, retries and timeouts are ours." },
  ];

  return (
    <Section id="interop">
      <Reveal>
        <Eyebrow>Interoperability</Eyebrow>
        <Text variant="display-md" tone="max" as="h2" className="max-w-[24ch] text-balance">
          Keep the agents you have
        </Text>
        <Text variant="body-lg" tone="secondary" className="mt-4 block max-w-[62ch]">
          Vectorbea is the execution layer, not another agent framework. Whatever wrote your agent
          keeps writing it; we make the run survive.
        </Text>
      </Reveal>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {frameworks.map((f, i) => (
          <Reveal key={f.name} delay={i * 40}>
            <div className="border-subtle h-full rounded-md border p-4">
              <Text variant="heading-sm" tone="max" as="h3" className="mb-1.5 block">{f.name}</Text>
              <Text variant="body-sm" tone="secondary" className="block">{f.note}</Text>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── 7 · Comparison ───────────────────────────────────────────────────────── */

type Verdict = "yes" | "no" | "partial";

const COMPARISON: { capability: string; cells: [Verdict, Verdict, Verdict, Verdict]; note?: string }[] = [
  { capability: "Resumes from the last committed step", cells: ["no", "no", "partial", "yes"], note: "Workflow tools resume the task graph, not the agent's own mid-step state." },
  { capability: "Per-step idempotency keys", cells: ["no", "no", "partial", "yes"] },
  { capability: "Suspends for human approval, at no cost while waiting", cells: ["no", "partial", "partial", "yes"] },
  { capability: "Per-node token and cost accounting", cells: ["no", "no", "no", "yes"] },
  { capability: "Failure clustering by signature", cells: ["no", "no", "partial", "yes"] },
  { capability: "Runs agents you already wrote", cells: ["yes", "yes", "no", "yes"] },
  { capability: "Mature scheduling and backfill", cells: ["partial", "no", "yes", "partial"], note: "Airflow has a decade of scheduling behaviour we do not match yet." },
  { capability: "Huge connector library", cells: ["no", "no", "yes", "partial"], note: "Zapier's directory is far larger. We cover the integrations agentic workflows actually reach for." },
  { capability: "Runs entirely on your own machine, free", cells: ["yes", "yes", "partial", "partial"] },
];

const COLUMNS = ["Script + cron", "Agent frameworks", "Workflow tools", "Vectorbea"];

function VerdictCell({ verdict, emphasis }: { verdict: Verdict; emphasis: boolean }) {
  const label = verdict === "yes" ? "Yes" : verdict === "no" ? "No" : "Partial";
  return (
    <td className="px-3 py-3 text-center">
      <span
        className={cn(
          "font-ui text-caption inline-flex items-center gap-1.5",
          verdict === "yes" && emphasis && "text-status-success",
          verdict === "yes" && !emphasis && "text-fg-secondary",
          verdict === "partial" && "text-status-waiting",
          verdict === "no" && "text-fg-disabled",
        )}
      >
        <span aria-hidden="true" className="font-code">
          {verdict === "yes" ? "●" : verdict === "partial" ? "◐" : "○"}
        </span>
        {label}
      </span>
    </td>
  );
}

function Comparison() {
  return (
    <Section id="compare" className="bg-surface-sunken">
      <Reveal>
        <Eyebrow>Honestly</Eyebrow>
        <Text variant="display-md" tone="max" as="h2" className="max-w-[24ch] text-balance">
          Where we win, and where we do not
        </Text>
        <Text variant="body-lg" tone="secondary" className="mt-4 block max-w-[62ch]">
          Two rows at the bottom go against us. If mature scheduling or connector breadth is the
          thing you are buying, Airflow and Zapier are still the better answer.
        </Text>
      </Reveal>

      <Reveal className="mt-10 block">
        <div className="border-subtle bg-surface-base overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr className="border-subtle border-b">
                <th className="font-ui text-eyebrow text-fg-muted px-4 py-3 uppercase">Capability</th>
                {COLUMNS.map((c, i) => (
                  <th
                    key={c}
                    className={cn(
                      "font-ui text-eyebrow px-3 py-3 text-center uppercase",
                      i === 3 ? "text-accent" : "text-fg-muted",
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.capability} className="border-subtle border-b last:border-b-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Text variant="body-sm" tone="primary" className="block">{row.capability}</Text>
                    {row.note ? (
                      <Text variant="caption" tone="muted" className="mt-0.5 block max-w-[46ch]">{row.note}</Text>
                    ) : null}
                  </th>
                  {row.cells.map((verdict, i) => (
                    <VerdictCell key={i} verdict={verdict} emphasis={i === 3} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </Section>
  );
}

/* ── 8 · Security ─────────────────────────────────────────────────────────── */

const SECURITY: { icon: IconComponent; title: string; body: string }[] = [
  {
    icon: ByokKeyIcon,
    title: "Your keys, encrypted",
    body: "Provider credentials are sealed with AES-256-GCM under a per-workspace data key. They are decrypted in the runner process that needs them and never written to logs.",
  },
  {
    icon: LeaseIcon,
    title: "Encrypted at rest and in transit",
    body: "TLS 1.3 on every hop. Run payloads, node inputs and outputs are encrypted at rest; secrets are stored separately from run data.",
  },
  {
    icon: CommitBoundaryIcon,
    title: "A real audit trail",
    body: "Actor, action, target and a diff for every change — workflow edits, approvals, key rotations, member changes. Retained independently of run history.",
  },
  {
    icon: AgentBrainIcon,
    title: "Private runners",
    body: "Run workers inside your VPC so payloads never leave your network. The control plane sees run metadata; it does not need to see the data.",
  },
];

function Security() {
  return (
    <Section id="security">
      <Reveal>
        <Eyebrow>Security and trust</Eyebrow>
        <Text variant="display-md" tone="max" as="h2" className="max-w-[22ch] text-balance">
          What happens to your keys and your data
        </Text>
      </Reveal>

      <div className="mt-10 grid gap-8 sm:grid-cols-2">
        {SECURITY.map((item, i) => (
          <Reveal key={item.title} delay={i * 40}>
            <item.icon size={22} aria-hidden="true" className="text-accent mb-2.5" />
            <Text variant="heading-sm" tone="max" as="h3" className="mb-1 block">{item.title}</Text>
            <Text variant="body-sm" tone="secondary" className="block max-w-[46ch]">{item.body}</Text>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-8 block">
        <Text variant="caption" tone="muted" className="block max-w-[62ch]">
          We do not train on your data and we do not share it with model providers beyond the call
          you asked for. SOC 2 is in progress; we will say so here when it is done and not before.
        </Text>
      </Reveal>
    </Section>
  );
}

/* ── 9 · Close ────────────────────────────────────────────────────────────── */

function Close() {
  return (
    <Section id="start">
      <Reveal className="block text-center">
        <Text variant="display-md" tone="max" as="h2" className="mx-auto max-w-[20ch] text-balance">
          Run one workflow and break it on purpose
        </Text>
        <Text variant="body-lg" tone="secondary" className="mx-auto mt-4 block max-w-[52ch]">
          Kill the process halfway through. Watch it come back at the step it left, with nothing
          duplicated. That is the whole pitch, and it takes about four minutes.
        </Text>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" variant="primary">
            <Link href={"/signup" as never}>Start free</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href={"/book-demo" as never}>Book a walkthrough</Link>
          </Button>
        </div>
        <Text variant="caption" tone="muted" className="mt-5 block">
          No card required. Bring your own model keys.
        </Text>
      </Reveal>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="border-subtle bg-surface-base border-t">
      <div className="mx-auto flex w-full max-w-(--container-marketing) flex-wrap items-center gap-4 px-5 py-8 sm:px-8">
        <Wordmark />
        <Text variant="caption" tone="muted" className="ml-auto">
          © {new Date().getFullYear()} Vectorbea
        </Text>
        <nav className="flex flex-wrap gap-4">
          {[
            { href: "/docs", label: "Docs" },
            { href: "/compare", label: "Compare" },
            { href: "/use-cases", label: "Use cases" },
            { href: "/support", label: "Support" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href as never}
              className="font-ui text-caption text-fg-muted hover:text-fg-primary rounded-sm transition-colors duration-fast outline-none focus-visible:focus-ring"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export function Landing() {
  // `light` pins the marketing page to the light theme regardless of the
  // visitor's product preference, while the hero and anatomy bands opt back into
  // dark on themselves.
  return (
    <div className="light bg-surface-base text-fg-primary font-ui min-h-dvh">
      <Hero />
      <WhatBreaks />
      <Anatomy />
      <ControlPlane />
      <Approvals />
      <Interop />
      <Comparison />
      <Security />
      <Close />
      <Footer />
    </div>
  );
}
