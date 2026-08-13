"use client";

import * as React from "react";
import { Text } from "~/components/ui/text";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { CodeBlock } from "~/components/docs/code-block";
import {
  Callout, Steps, Step, ParamTable, ResponseSchema, ComparisonTable,
  H2, H3, P, Lead, UL, LI, Code, B,
} from "~/components/docs/primitives";
import {
  RunLifecycleDiagram, CheckpointResumeDiagram, QueueLeaseDiagram,
  ApprovalGateDiagram, IoMappingDiagram,
} from "~/components/docs/diagrams";
import type { RunNode } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   DOCS BODIES

   The prose. Split from ~/content/docs/registry (which holds the nav data) for
   one specific reason: the route files are Server Components that need titles,
   descriptions and slugs at build time for generateMetadata and
   generateStaticParams. A "use client" module cannot hand plain data to a server
   file — every export becomes a client reference. So the data lives in a
   server-safe module and the components live here, joined by slug.
══════════════════════════════════════════════════════════════════════════════ */

/* ── A ribbon for inline use in prose ─────────────────────────────────────── */
function ribbon(states: RunNode["state"][]): RunNode[] {
  return states.map((state, i) => ({
    id: `n${i}`, name: `Node ${i + 1}`, kind: "tool", state,
    durationMs: state === "pending" ? null : 900,
    tokens: null, costUsd: null,
    at: state === "pending" ? null : new Date().toISOString(),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════════
   1 · INTRODUCTION
══════════════════════════════════════════════════════════════════════════════ */

function Introduction() {
  return (
    <>
      <Lead>
        Vectorbea is a control plane for durable AI workflows. You compose agents, tools and
        connections on a canvas, run them with full observability, and govern them with human
        approval gates. Every completed step commits a checkpoint that survives a crash.
      </Lead>

      <Callout kind="note" title="The one-liner">
        <p>Agents that resume, not restart.</p>
      </Callout>

      <H2 id="what-is">What Vectorbea is</H2>
      <P>
        Vectorbea treats a workflow run as a <B>durable, event-sourced entity</B> rather than a
        process in memory. Waiting, failing, retrying and resuming are normal, cheap operations
        instead of exceptional ones.
      </P>
      <UL>
        <LI><B>Visual canvas</B> — triggers, agents, LLM calls, tools, branches, parallel fan-outs, approval gates and checkpoints.</LI>
        <LI><B>Durable runtime</B> — Kotlin workers execute runs from a queue with leases, retries, timeouts and crash recovery.</LI>
        <LI><B>Observability</B> — every run produces an event timeline, structured logs, per-node token and cost accounting, and failure diagnosis.</LI>
        <LI><B>Governance</B> — approval gates, risk-tiered tools, read-only connections and a full audit trail.</LI>
        <LI><B>BYOK</B> — your own provider keys, encrypted with AES-256-GCM and decrypted only in the runner.</LI>
      </UL>

      <H2 id="problem">The problem it solves</H2>
      <P>
        Real AI automation is long-running. A renewal pipeline waits days for a manager&rsquo;s decision.
        A research agent makes fifty LLM and API calls. A migration processes thousands of records.
        Scripts and basic agent frameworks break down in four specific ways:
      </P>
      <UL>
        <LI><B>Crashes lose everything.</B> A timeout at step 9 of 10 means re-running steps 1–8 — repaying every token and re-firing every side effect.</LI>
        <LI><B>Side effects are unsafe to retry.</B> Re-running naively sends the same email twice and double-writes to your CRM.</LI>
        <LI><B>Humans cannot intervene.</B> There is no first-class way to pause for sign-off and continue exactly where it stopped.</LI>
        <LI><B>Nothing explains itself.</B> When an agent misbehaves you need the exact prompt, tool calls, outputs, latency and cost — not a print statement.</LI>
      </UL>

      <H2 id="lifecycle">The shape of a run</H2>
      <RunLifecycleDiagram />

      <H2 id="use-cases">Where it fits</H2>
      <P>
        Vectorbea earns its keep when a workflow is long, expensive, or touches something that cannot
        be done twice.
      </P>
      <UL>
        <LI><B>Contract renewal pipeline</B> — a nightly trigger pulls upcoming renewals, an agent scores churn risk, high-risk accounts pause at a gate for the account manager, and approved ones get drafted outreach. The run waits days at the gate at zero cost.</LI>
        <LI><B>Claims and ticket triage</B> — a webhook starts a run, an agent extracts entities and checks policy, low-risk cases auto-resolve and uncertain ones escalate to a gate, resuming with the reviewer&rsquo;s decision in context.</LI>
        <LI><B>Monthly analytics</B> — queries, API calls and a composed narrative, each stage checkpointed, so a flaky API at step 4 never repeats the expensive steps 1–3.</LI>
        <LI><B>Bulk migration</B> — thousands of records in batches with checkpoints between them. A crash at record 8,000 resumes at 8,001.</LI>
        <LI><B>Deep research agent</B> — iterative loops across search, scraping and synthesis over hours, every iteration an event you can inspect or resume from.</LI>
        <LI><B>Incident response copilot</B> — an alert starts a run, an agent gathers logs and proposes remediation, and a gate requires on-call approval before anything mutating executes.</LI>
      </UL>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   2 · DURABILITY — full page
══════════════════════════════════════════════════════════════════════════════ */

function Durability() {
  return (
    <>
      <Lead>
        Durability is the product. This page explains the mechanism precisely: the queue, leases,
        checkpoints, event sourcing and replay — and what each one costs you when it is missing.
      </Lead>

      <H2 id="cost">The cost argument, concretely</H2>
      <P>
        Take a ten-node workflow that enriches accounts and emails a summary. Node 9 calls a provider
        that times out. What happens next is the entire difference between a durable engine and a
        script.
      </P>
      <CheckpointResumeDiagram />
      <ComparisonTable
        columns={["Without checkpoints", "With checkpoints"]}
        rows={[
          { label: "Nodes re-executed", cells: ["8", "0"] },
          { label: "Side effects re-fired", cells: ["8 — including 2 emails and 1 CRM write", "0"] },
          { label: "Tokens repaid", cells: ["~14,800", "0"] },
          { label: "Time to recover", cells: ["1m 48s", "9.4s"] },
          { label: "Blast radius of a retry", cells: ["Every downstream system touched so far", "The failed node only"] },
        ]}
      />
      <Callout kind="warning" title="The duplicate writes are the real cost">
        <p>
          The token bill is annoying; the duplicated side effects are what reach a customer. A retry
          that re-sends two emails is not a slow retry, it is an incident.
        </p>
      </Callout>

      <H2 id="queue">The queue and the worker</H2>
      <P>
        Starting a run does not execute it. The API validates the request, writes a{" "}
        <Code>run</Code> row in <Code>queued</Code>, and returns. A worker picks it up later. That
        indirection is what makes the system survivable: nothing is holding your run in memory, so
        nothing can drop it.
      </P>
      <QueueLeaseDiagram />

      <H3 id="leases">Leases</H3>
      <P>
        A worker <B>leases</B> a run rather than owning it. The lease is a row with an expiry, renewed
        every few seconds while the worker is alive. If the worker is killed, deployed over, or loses
        its network, the lease simply expires and another worker claims the run from its last
        checkpoint.
      </P>
      <P>
        This is why a deploy in the middle of a run is uneventful. There is no drain step and no
        graceful-shutdown handler to get right — the failure mode is the same as a crash, and the
        crash path is the one that is tested constantly.
      </P>

      <H2 id="checkpoints">Checkpoints and commit boundaries</H2>
      <P>
        Every node ends at a <B>commit boundary</B>. The node&rsquo;s validated output, the inputs that
        produced it, and the idempotency key of any side effect it caused are written in one
        transaction. Either all of it lands or none of it does.
      </P>
      <P>
        A <B>checkpoint</B> is a commit boundary that the engine will never cross again. Once node 6
        is checkpointed, node 6 will not run a second time in this run — not on retry, not on resume,
        not after a worker crash.
      </P>
      <div className="my-5">
        <CheckpointRibbon
          nodes={ribbon(["committed", "committed", "committed", "committed", "committed", "committed", "failed", "pending", "pending", "pending"])}
          size="md"
          runId="docs-durability-ribbon"
        />
        <Text variant="caption" tone="muted" className="mt-2 block">
          Six committed, one failed, three never reached. A retry costs four nodes, not ten.
        </Text>
      </div>

      <H3 id="idempotency">Idempotency keys</H3>
      <P>
        Checkpoints protect you inside Vectorbea. Idempotency keys protect the systems outside it. A
        tool call that creates a charge carries a key derived from the run id and node id, so if the
        engine is ever uncertain whether a call landed, the provider deduplicates it rather than
        charging twice.
      </P>
      <CodeBlock
        samples={[
          {
            language: "typescript",
            label: "TypeScript",
            filename: "tool-definition.ts",
            highlight: [7, 8, 9],
            code: `export const chargeCustomer = defineTool({
  name: "stripe.charge",
  risk: "critical",
  timeoutMs: 30_000,

  // The key is deterministic: the same node in the same run always
  // produces the same key, so a replay can never double-charge.
  idempotencyKey: ({ runId, nodeId }) => \`\${runId}:\${nodeId}\`,

  async run({ input, connection }) {
    return connection.post("/v1/charges", input);
  },
});`,
          },
          {
            language: "python",
            label: "Python",
            filename: "tool_definition.py",
            highlight: [6, 7],
            code: `@tool(name="stripe.charge", risk="critical", timeout_ms=30_000)
def charge_customer(input, connection, ctx):
    # The same node in the same run always produces the same key,
    # so a replay can never double-charge.
    return connection.post(
        "/v1/charges",
        json=input,
        idempotency_key=f"{ctx.run_id}:{ctx.node_id}",
    )`,
          },
        ]}
      />

      <H2 id="event-sourcing">Event sourcing and replay</H2>
      <P>
        A run&rsquo;s history is an append-only event stream: <Code>run.accepted</Code>,{" "}
        <Code>node.started</Code>, <Code>node.committed</Code>, <Code>tool.called</Code>,{" "}
        <Code>gate.opened</Code>, <Code>run.resumed</Code>. Current state is derived from the stream,
        never stored as the truth.
      </P>
      <P>
        That is what makes resume <B>exact</B> rather than best-effort. Resuming is not &ldquo;work out
        roughly where we were&rdquo;; it is folding the event log to a state and continuing. The same
        fold drives the replay scrubber in run detail, so what you watch afterwards is what actually
        happened, not a reconstruction.
      </P>
      <Callout kind="tip" title="Why you can trust the timeline">
        <p>
          The timeline is not logging. It is the same event stream the engine executes from — if the
          UI shows a node committed, the engine will not re-run it.
        </p>
      </Callout>

      <H2 id="retries">Retries, timeouts and the dead-letter path</H2>
      <ParamTable
        rows={[
          { name: "retry.maxAttempts", type: "number", default: "3", description: "Attempts per node before the run fails. Attempts are recorded individually, so a node that succeeds on attempt 2 shows as recovered rather than clean." },
          { name: "retry.backoff", type: '"fixed" | "exponential"', default: '"exponential"', description: "Exponential adds jitter, which matters when a provider rate-limits a fan-out and every branch would otherwise retry in lockstep." },
          { name: "timeout.stepMs", type: "number", default: "60000", description: "Per-node ceiling. Exceeding it fails the node, not the run — retry and resume still apply." },
          { name: "timeout.runMs", type: "number", default: "86400000", description: "Wall-clock ceiling for the whole run, excluding time suspended at a gate. Waiting on a human does not count against it." },
          { name: "deadLetter", type: "boolean", default: "true", description: "When attempts are exhausted the run moves to the dead-letter path with its full event stream intact, so it can be inspected and resumed after a fix." },
        ]}
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   3 · UNIFIED I/O & MAPPING — full page
══════════════════════════════════════════════════════════════════════════════ */

function IoMapping() {
  return (
    <>
      <Lead>
        Every node declares what it produces and what it needs. Mapping is how a node&rsquo;s input is
        bound to an upstream node&rsquo;s output — by path, with types checked before you publish.
      </Lead>

      <H2 id="output-schema">The output schema of a node</H2>
      <P>
        A node&rsquo;s output is not an opaque blob. Tools declare a schema, agents produce a structured
        result, and the engine records both the value and its shape at the commit boundary. That
        schema is what the next node can bind to.
      </P>
      <CodeBlock
        samples={[
          {
            language: "json",
            label: "Output schema",
            filename: "n1004 · postgres.query",
            code: `{
  "type": "object",
  "properties": {
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "account_id":   { "type": "string" },
          "renewal_date": { "type": "string", "format": "date" },
          "mrr_gbp":      { "type": "number" }
        }
      }
    },
    "rowCount": { "type": "integer" }
  }
}`,
          },
        ]}
      />

      <H2 id="binding">Binding an input to an upstream field</H2>
      <P>
        In the inspector, each input shows the fields available from every upstream node. Picking one
        writes a binding: a path from a node id into that node&rsquo;s output.
      </P>
      <IoMappingDiagram />
      <P>
        Bindings are <B>by path, not by position</B>. Reordering nodes on the canvas, renaming a node
        label, or inserting a step between two others never silently rewires a field — the path either
        still resolves or it does not, and a path that no longer resolves is a validation error rather
        than a null.
      </P>
      <CodeBlock
        samples={[
          {
            language: "json",
            label: "Bindings",
            filename: "n1005 · inputs",
            highlight: [3, 7],
            code: `{
  "accountId": {
    "from": "n1004", "path": "rows[0].account_id"
  },
  "mrr": {
    "from": "n1004", "path": "rows[0].mrr_gbp",
    "coerce": "number"
  },
  "tone": { "literal": "formal" }
}`,
          },
        ]}
      />

      <H2 id="coercion">Type coercion</H2>
      <P>
        Bindings coerce only where coercion is lossless and unambiguous. Anything else is a
        validation error at publish time, because a silent coercion is a bug that surfaces three nodes
        later with no trace of where the value changed.
      </P>
      <ComparisonTable
        columns={["Allowed", "Rejected"]}
        rows={[
          { label: "number → string", cells: ["Yes — formatted with the locale-independent representation", "—"] },
          { label: "string → number", cells: ["Only if the whole string parses", "\"12 accounts\" fails at publish"] },
          { label: "string → date", cells: ["ISO-8601 only", "Ambiguous formats such as 03/04/2026"] },
          { label: "any → boolean", cells: ["Only true/false and \"true\"/\"false\"", "Truthiness. 0 and \"\" are not false here"] },
          { label: "object → string", cells: ["—", "Rejected. Bind a field, or add an explicit serialise step"] },
        ]}
      />

      <H2 id="broken">What happens when a mapping breaks at runtime</H2>
      <P>
        Publish-time validation catches missing and mistyped paths. Runtime can still surprise you:
        an upstream query returns zero rows, so <Code>rows[0].account_id</Code> has nothing to resolve
        against.
      </P>
      <Steps>
        <Step title="The node fails, it does not receive null">
          The binding cannot resolve, so the node never starts. Passing null downstream is how one
          empty result becomes four confusing failures.
        </Step>
        <Step title="The error names the path">
          <Code>n1005.accountId: no value at n1004.rows[0].account_id (rows had length 0)</Code> —
          the path it looked for and what it found instead.
        </Step>
        <Step title="Everything upstream stays committed">
          The query itself committed. A resume re-executes only the node whose binding failed.
        </Step>
        <Step title="You fix it with a default or a guard">
          Give the input a default, or put a branch in front that handles the empty case explicitly.
        </Step>
      </Steps>
      <Callout kind="danger" title="Do not paper over this with a default everywhere">
        <p>
          A default on <Code>accountId</Code> turns &ldquo;no account found&rdquo; into a run that
          confidently emails the wrong person. Defaults are right for optional configuration and wrong
          for identity.
        </p>
      </Callout>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   4 · YOUR FIRST WORKFLOW — full tutorial
══════════════════════════════════════════════════════════════════════════════ */

function FirstWorkflow() {
  return (
    <>
      <Lead>
        A complete build: from an empty canvas to a published, scheduled workflow with a human
        approval gate. About twenty minutes, and you will break it on purpose at the end.
      </Lead>

      <Callout kind="note" title="What you need first">
        <p>
          A connection to a model provider and one to a database. If you have not added them, the
          onboarding flow does both in a couple of minutes.
        </p>
      </Callout>

      <H2 id="build">Build the graph</H2>
      <Steps>
        <Step title="Create the workflow">
          <P>
            Workflows → New workflow → Start blank. Name it <Code>renewals-daily</Code>. You get a
            canvas with a single trigger node.
          </P>
        </Step>
        <Step title="Configure the trigger">
          <P>
            Select the trigger and set its type to <B>Schedule</B>. Leave the cron empty for now —
            you will set it after the graph works. Declare one input field,{" "}
            <Code>lookaheadDays</Code>, a number with a default of 30.
          </P>
        </Step>
        <Step title="Add the query">
          <P>
            Add a <B>Tool</B> node and bind it to <Code>postgres.query</Code>. Its SQL template takes
            the lookahead from the trigger:
          </P>
          <CodeBlock
            samples={[{
              language: "bash", label: "SQL", filename: "n1002 · postgres.query",
              code: `SELECT account_id, renewal_date, mrr_gbp
FROM contracts
WHERE renewal_date < NOW() + ({{lookaheadDays}} || ' days')::interval
ORDER BY mrr_gbp DESC`,
            }]}
            showLineNumbers={false}
          />
          <P>
            In the Inputs tab, bind <Code>lookaheadDays</Code> to the trigger&rsquo;s field of the same
            name.
          </P>
        </Step>
        <Step title="Add the agent">
          <P>
            Add an <B>Agent</B> node and pick your model connection. Give it the instruction:
            &ldquo;Score each account&rsquo;s renewal risk from 0 to 1 and explain the score in one
            sentence.&rdquo; Bind its <Code>accounts</Code> input to <Code>n1002.rows</Code>.
          </P>
        </Step>
        <Step title="Branch on risk">
          <P>
            Add a <B>Branch</B> node. Condition: <Code>n1003.maxRisk &gt; 0.7</Code>. The true path
            goes to an approval gate; the false path goes straight to the send.
          </P>
        </Step>
        <Step title="Add the gate">
          <P>
            On the true path, add a <B>Human approval</B> node. In its message, reference the resolved
            values so the reviewer sees facts rather than placeholders:
          </P>
          <CodeBlock
            samples={[{
              language: "bash", label: "Gate message", filename: "n1005 · approval",
              code: `{{n1003.topAccount.name}} scores {{n1003.maxRisk}} renewal risk.
MRR {{n1002.rows[0].mrr_gbp}} GBP, renews {{n1002.rows[0].renewal_date}}.
Approve to send tailored outreach.`,
            }]}
            showLineNumbers={false}
          />
        </Step>
        <Step title="Send">
          <P>
            Both paths converge on a <B>Merge</B>, then a tool node bound to{" "}
            <Code>slack.postMessage</Code>. End with an <B>Output</B> node.
          </P>
        </Step>
      </Steps>

      <H2 id="simulate">Simulate before you publish</H2>
      <P>
        Open the Simulate panel. It dry-runs the graph with mocked tool responses, so no email is
        sent and no row is written, and gives you a cost estimate per node. Fix anything the
        validator flags — unbound required inputs appear here rather than at 3am.
      </P>
      <ApprovalGateDiagram />

      <H2 id="publish">Publish and schedule</H2>
      <Steps>
        <Step title="Publish version 1">
          <P>
            Publish shows a change summary before it commits. Publishing does not start anything; it
            makes the version available to triggers.
          </P>
        </Step>
        <Step title="Set the schedule">
          <P>
            Triggers → your workflow → set the cron to <Code>0 7 * * 1-5</Code>. The input shows you
            the prose translation and the next five fire times in your timezone. Confirm they are what
            you meant before saving — this is the field most likely to be wrong by a factor of sixty.
          </P>
        </Step>
        <Step title="Run it once by hand">
          <P>Run now. Watch the ribbon fill in the run header as each node commits.</P>
        </Step>
      </Steps>

      <H2 id="break-it">Break it on purpose</H2>
      <P>
        This is the part worth doing. While the run is executing, revoke the database connection&rsquo;s
        password, or stop the database.
      </P>
      <div className="my-5">
        <CheckpointRibbon
          nodes={ribbon(["committed", "committed", "failed", "pending", "pending", "pending", "pending"])}
          size="md"
          runId="docs-first-workflow-ribbon"
        />
      </div>
      <P>
        The run fails at the query and stops. The trigger and any nodes before it stay committed. Fix
        the credential, then press <B>Resume from checkpoint</B> on the run page — execution re-enters
        at the failed node. Nothing before it runs again, and no message is sent twice.
      </P>
      <Callout kind="tip" title="This is the whole product">
        <p>
          If you only do one thing in the tutorial, do this one. Every other feature is downstream of
          a run that can survive its own failure.
        </p>
      </Callout>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Remaining sections — existing content, preserved and expanded
══════════════════════════════════════════════════════════════════════════════ */

function CoreConcepts() {
  return (
    <>
      <Lead>
        Five nouns carry the whole product. Everything else is a property of one of them.
      </Lead>

      <H2 id="connections">Connections</H2>
      <P>
        A credentialed link to an external system: a model provider, a database, an HTTP API, a SaaS
        platform, an MCP server, a vector store or object storage. Secrets are encrypted with
        AES-256-GCM the moment you save them and are never displayed again. Connections carry network
        policy too — private hosts are flagged for IP allow-listing or a private runner.
      </P>
      <P>
        Every connection knows its <B>blast radius</B>: how many workflows and tools stop working if
        it goes down. That number is on the connection, not buried in a dependency graph, because it
        is what you need during an incident.
      </P>

      <H2 id="agents">Agents</H2>
      <P>
        A reusable AI worker definition: which model connection it uses, its system prompt,
        temperature, iteration ceiling, and which tools it may call. Policies attach per agent —
        memory scope, retry with backoff, step and run timeouts, and whether it requires approval.
      </P>

      <H2 id="tools">Tools</H2>
      <P>
        A typed capability an agent can invoke. Every tool declares an input and output schema, a
        timeout, a retry policy, idempotency semantics and a <B>risk level</B> from low (read-only) to
        critical (irreversible — payments, sends, deletions). Risk is not decoration: policy can
        require an approval gate for anything above a threshold, per environment.
      </P>

      <H2 id="approvals">Approvals</H2>
      <P>
        A node that pauses a run for a human decision. The run checkpoints and parks — no compute is
        consumed while it waits. Both approve and reject are recorded with actor, timestamp and the
        context the decision was made on.
      </P>

      <H2 id="workflows">Workflows and runs</H2>
      <P>
        A workflow is the versioned graph. Starting it creates a <B>run</B> — the durable,
        event-sourced execution you can watch live, scrub through afterwards, and resume from any
        checkpoint.
      </P>
    </>
  );
}

function AgentsTools() {
  return (
    <>
      <Lead>Defining what an agent may do, and what happens when it does it.</Lead>
      <H2 id="grants">Tool grants</H2>
      <P>
        An agent can only call tools it has been granted. Grants are explicit and per-agent, so
        widening one agent&rsquo;s reach never widens another&rsquo;s.
      </P>
      <H2 id="risk">Risk tiers</H2>
      <ComparisonTable
        columns={["Meaning", "Default policy"]}
        rows={[
          { label: "low", cells: ["Read-only. No state changes anywhere.", "Runs unattended"] },
          { label: "medium", cells: ["Creates or updates internal records.", "Runs unattended, audited"] },
          { label: "high", cells: ["Writes to a system of record, or sends to a person.", "Approval in production"] },
          { label: "critical", cells: ["Irreversible: payments, deletions, external sends at scale.", "Approval in every environment"] },
        ]}
      />
      <H2 id="used-by">The used-by index</H2>
      <P>
        Every tool lists the agents and workflows that reference it. Deleting a tool tells you what
        breaks before you confirm, rather than after.
      </P>
    </>
  );
}

function ConnectionsByok() {
  return (
    <>
      <Lead>Your provider accounts, your rate limits, your data agreements.</Lead>
      <H2 id="why-byok">Why bring your own keys</H2>
      <P>
        Running on your provider account means your negotiated pricing and rate limits apply, your
        usage appears on your provider bill for reconciliation, and your data-processing agreement
        with that provider is the one in force. There is no Vectorbea markup on tokens because the
        tokens are never ours.
      </P>
      <H2 id="storage">How keys are stored</H2>
      <UL>
        <LI>Encrypted with <B>AES-256-GCM</B> under a per-workspace data key before they touch disk.</LI>
        <LI>Decrypted only inside the runner process that makes the call — never in the browser, never in the control plane.</LI>
        <LI>Never displayed again. You can replace a key; you cannot read it back.</LI>
        <LI>Excluded from logs, traces and run payloads by construction rather than by redaction.</LI>
      </UL>
      <Callout kind="warning" title="Rotation does not break references">
        <p>
          Rotating a credential updates the secret in place. Agents and tools reference the connection,
          not the key, so nothing needs re-wiring.
        </p>
      </Callout>
    </>
  );
}

function RunningObservability() {
  return (
    <>
      <Lead>What a run tells you while it is happening, and after.</Lead>
      <H2 id="timeline">The event timeline</H2>
      <P>
        Every run produces an ordered event stream you can scrub. Dragging the ribbon drives the
        canvas, the log position and the metrics header together, so you can watch the run reach the
        moment it failed.
      </P>
      <H2 id="cost">Token and cost accounting</H2>
      <P>
        Cost is recorded per node, not per run, so an expensive workflow tells you which step is
        expensive. Sub-cent values are never rounded to <Code>$0.00</Code>.
      </P>
      <H2 id="clustering">Failure clustering</H2>
      <P>
        Failures are grouped by signature. Eighty-three failed runs are rarely eighty-three problems —
        they are usually three, and the Incidents page is where that collapse happens.
      </P>
    </>
  );
}

function Approvals() {
  return (
    <>
      <Lead>Pausing a run for a person, without holding a worker.</Lead>
      <ApprovalGateDiagram />
      <H2 id="context">Decision context</H2>
      <P>
        A gate renders <B>resolved values</B> — the figures the agent actually computed — beside the
        source that produced each one. A reviewer approving a refund sees £842.00 and that it came
        from <Code>stripe.getInvoice → amount_due</Code>, not a template placeholder.
      </P>
      <H2 id="sla">SLA and escalation</H2>
      <P>
        Gates carry a countdown. A breached SLA is an incident signature of its own, so approvals that
        routinely expire show up as a pattern rather than as individual stuck runs.
      </P>
    </>
  );
}

function Triggers() {
  return (
    <>
      <Lead>Schedules, webhooks and manual or API starts, in one place.</Lead>
      <H2 id="schedules">Schedules</H2>
      <P>
        Standard five-field cron with a timezone. The editor shows the prose translation and the next
        five fire times before you save, because a wrong digit here is the difference between every
        five minutes and every five hours.
      </P>
      <H2 id="overlap">Overlap policy</H2>
      <ParamTable
        rows={[
          { name: "overlap", type: '"skip" | "queue" | "parallel"', default: '"skip"', description: "What happens when a run is still going at the next fire time. Skip is the safe default — queue is right for backfills, parallel only when the workflow is genuinely independent per run." },
          { name: "jitter", type: "number (seconds)", default: "0", description: "Spreads fires across a window so a hundred workspaces on 0 * * * * do not hit a provider in the same second." },
          { name: "catchUp", type: "boolean", default: "false", description: "Whether missed fires during an outage run afterwards. Off by default: catching up a day of hourly runs at once is usually not what anyone wants." },
        ]}
      />
    </>
  );
}

function Architect() {
  return (
    <>
      <Lead>Describe a workflow; edit the blueprint before anything is created.</Lead>
      <H2 id="blueprint">The blueprint is editable</H2>
      <P>
        AI Architect proposes a graph, the agents and tools it needs, and where gates belong. Nothing
        is created until you approve the blueprint, and the confirmation screen states exactly what
        will be built — how many agents, tools, connections and gates — with a cost estimate.
      </P>
      <Callout kind="note" title="Build limit">
        <p>
          One build per rolling 30 days on the current plan. Only workflows you actually build count;
          discarded blueprints do not.
        </p>
      </Callout>
    </>
  );
}

function ApiReference() {
  return (
    <>
      <Lead>The HTTP API. Every endpoint is versioned and returns problem details on error.</Lead>
      <H2 id="start-run">Start a run</H2>
      <CodeBlock
        runnable
        samples={[
          {
            language: "bash", label: "cURL",
            code: `curl -X POST https://api.vectorbea.com/v1/runs \\
  -H "Authorization: Bearer $VECTORBEA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workflowId": "wf_7c2f18ab",
    "environment": "production",
    "input": { "lookaheadDays": 30 }
  }'`,
          },
          {
            language: "typescript", label: "TypeScript",
            code: `import { Vectorbea } from "@vectorbea/sdk";

const vb = new Vectorbea({ apiKey: process.env.VECTORBEA_API_KEY });

const run = await vb.runs.start({
  workflowId: "wf_7c2f18ab",
  environment: "production",
  input: { lookaheadDays: 30 },
});

console.log(run.id, run.status);`,
          },
          {
            language: "python", label: "Python",
            code: `from vectorbea import Vectorbea

vb = Vectorbea(api_key=os.environ["VECTORBEA_API_KEY"])

run = vb.runs.start(
    workflow_id="wf_7c2f18ab",
    environment="production",
    input={"lookaheadDays": 30},
)

print(run.id, run.status)`,
          },
        ]}
      />
      <ParamTable
        rows={[
          { name: "workflowId", type: "string", required: true, description: "The workflow to run. Uses the currently published version unless versionId is given." },
          { name: "environment", type: '"production" | "staging" | "development"', required: true, description: "Which environment's connections and budgets apply." },
          { name: "input", type: "object", description: "Must satisfy the trigger's declared input schema. Unknown fields are rejected rather than ignored." },
          { name: "idempotencyKey", type: "string", description: "Starting twice with the same key returns the original run instead of creating a second one." },
        ]}
      />
      <ResponseSchema
        status={202}
        description="Accepted. The run is queued; it has not started."
        rows={[
          { name: "id", type: "string", description: "Run id, prefixed run_." },
          { name: "status", type: '"queued"', description: "Always queued on creation — a 202 never means running." },
          { name: "workflowId", type: "string", description: "Echoed back." },
          { name: "createdAt", type: "string (ISO-8601)", description: "When the run was accepted." },
        ]}
      />
      <ResponseSchema
        status={409}
        description="A run with this idempotency key already exists."
        rows={[
          { name: "type", type: "string", description: "https://vectorbea.com/problems/duplicate-run" },
          { name: "existingRunId", type: "string", description: "The run created by the first request. Treat this as success." },
        ]}
      />
    </>
  );
}

function Security() {
  return (
    <>
      <Lead>What happens to your credentials, your payloads and your audit trail.</Lead>
      <H2 id="encryption">Encryption</H2>
      <UL>
        <LI>TLS 1.3 on every hop.</LI>
        <LI>Provider credentials sealed with AES-256-GCM under a per-workspace data key.</LI>
        <LI>Run payloads, node inputs and outputs encrypted at rest, stored separately from secrets.</LI>
      </UL>
      <H2 id="private-runners">Private runners</H2>
      <P>
        Workers can run inside your VPC. The control plane then sees run metadata — which node ran,
        how long it took, what it cost — and never the payload.
      </P>
      <H2 id="audit">Audit trail</H2>
      <P>
        Actor, action, target and a diff for every change: workflow edits, approvals, key rotations,
        member changes. Retained independently of run history, so a retention policy on runs does not
        erase the governance record.
      </P>
      <Callout kind="note" title="Certifications">
        <p>
          SOC 2 Type II is in progress. We will state the date here when it is issued, and not before.
        </p>
      </Callout>
    </>
  );
}

function BuildingWorkflows() {
  return (
    <>
      <Lead>The canvas, validation, versions and publishing.</Lead>
      <H2 id="nodes">Node types</H2>
      <P>
        Trigger, agent, LLM, tool, branch, parallel, merge, wait, approval, checkpoint, output and
        end. Each has a bespoke mark on the canvas so the graph is readable at a glance rather than a
        field of identical boxes.
      </P>
      <H2 id="validation">Validation before publish</H2>
      <P>
        Unbound required inputs, unreachable nodes, cycles without a loop node, and gates with no
        approver group are publish-time errors. The validator highlights the offending node on the
        canvas rather than listing an error at the top.
      </P>
      <H2 id="versions">Versions</H2>
      <P>
        Publishing creates a version. Running triggers use the published version, so editing a draft
        never changes what is executing tonight. Version diff shows both the graph change and the JSON
        change.
      </P>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Slug → body. Joined to ~/content/docs/registry by slug; the registry test
   asserts the two sets are identical, so a page can never ship without prose.
══════════════════════════════════════════════════════════════════════════════ */

export const DOCS_BODIES: Record<string, React.ComponentType> = {
  "introduction": Introduction,
  "core-concepts": CoreConcepts,
  "first-workflow": FirstWorkflow,
  "building-workflows": BuildingWorkflows,
  "io-mapping": IoMapping,
  "agents-tools": AgentsTools,
  "connections-byok": ConnectionsByok,
  "running-observability": RunningObservability,
  "durability": Durability,
  "approvals": Approvals,
  "triggers": Triggers,
  "ai-architect": Architect,
  "api-reference": ApiReference,
  "security": Security,
};
