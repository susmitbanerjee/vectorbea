# Marketing claim audit

**Date:** 7 September 2026
**Scope:** `apps/web/app/(marketing)/**`, `apps/web/components/marketing/**`,
`apps/web/src/components/marketing/**` (which is where the live homepage actually is —
see §2b), the docs registry, and the pricing/plan surfaces.

---

## The rule that decided most of it

**A feature behind a default-off flag is not shipped.**

It can be built, tested, documented and merged. If the executor reads an environment
variable that defaults to `false`, a customer on a default deployment cannot use it — and
a sentence on the site saying they can is false. The same applies one level up for plans:
a capability only some plans include is not "in the product" for the reader of an
unqualified sentence.

Both are still worth *describing*. A hidden feature is indistinguishable from a feature
we do not have, and nobody buys what they cannot see. What is not acceptable is describing
them **without** the qualification.

Reliability claims are treated as a category of their own and refused outright rather than
qualified, because uptime, SLA and certification are the first things a serious buyer
verifies — and the first one they find to be untrue is the last claim of ours they believe.

---

## 1. Flags that decide the verdicts

| Env var | Default | What it gates | Read by |
|---|---|---|---|
| `AGENT_TEAMS_ENABLED` | **false** | The `agent_team` node. Off, the node fails with "teams are switched off here". | `AgentTeamNodeExecutor` |
| `AGENT_ACTIVATIONS_ENABLED` | **false** | Child activations — i.e. delegation having anything to delegate *to*. | `AgentNodeExecutor` |
| `AGENT_LOOP_RECONSTRUCTION_ENABLED` | **false** | Rebuilding a resumed agent's loop instead of replaying it. | `AgentBrainRunner` |
| `OTEL_TRACE_EXPORT_ENABLED` | **false** | Span export to a customer's own collector. | `RunTraceExporter` |
| `AGENT_CONTEXT_ASSEMBLY_ENABLED` | **false** | Budgeted context assembly with named drops. | `AgentPromptBuilder` |
| `AGENT_WORKFLOW_MEMORY_ENABLED` | **false** | Memory that crosses runs. | `AgentMemoryStore` |
| `TRACE_SPANS_ENABLED` | **true** | Internal span recording. | `SpanWriter` |
| `RESUME_RECONCILER_ENABLED` | **true** | Resuming an interrupted run. | worker `Main` |

The last two matter as much as the first six: **durable resume and internal tracing are on
by default**, which is what makes the site's central durability claim true.

---

## 2. Claim inventory

Verdicts: **TRUE** · **FLAG** (true behind a default-off flag) · **PLAN** (true on some
plans) · **PARTIAL** · **FALSE**.

### Reliability and durability

| Claim | Verdict | Evidence |
|---|---|---|
| Every node checkpoints as it runs | TRUE | `WorkflowRuntime.writeCheckpoint` after each completed node when `node.checkpointPolicy.enabled`; `CheckpointPolicy(enabled = true)` is the default. Written unconditionally on a yield and before an approval park. |
| Resume from the last checkpoint, not from the beginning | TRUE | `RunProcessor` loads `checkpointStore.loadLatest` on `RESUME_RUN`; reconciler on by default. |
| Approvals suspend without pinning a worker | TRUE | Checkpoint then return; re-enqueued on the decision. `TeamLimits.maxDurationMs` explicitly excludes parked time. |
| Per-node retries with backoff | TRUE | Retry policy is per node in the graph model and honoured by the executors. |
| Immutable event history | TRUE | `RunEventStore` appends with an assigned sequence; nothing rewrites a row. |
| **"14 events · 0 lost"** | **FALSE** | `RunEventStore` applies back-pressure rather than dropping — but the block is bounded by `AGENT_EVENT_BACKPRESSURE_TIMEOUT_MS`, past which it drops loudly and counts. Invariant 7 states this explicitly: *"spans may drop, events may not"* is a design intent with a bounded exception, not a guarantee. |
| Uptime / SLA | *not claimed* | Nothing on the site claimed either. Nothing now may: the guard test refuses the words un-denied. |

**Action:** "0 lost" → "append-only" on the homepage bento card.

### Observability and debugging

| Claim | Verdict | Evidence |
|---|---|---|
| Full run timeline with per-node inputs and outputs | TRUE | `DebugRoutes` serves them; the Debug tab renders them. |
| Root-cause attribution on a failure | TRUE | `run_failure_class` (V053) plus the Debug tab's root-cause banner. |
| Live tokens per run | TRUE | Counted, not estimated. |
| Live **cost** per run | **PARTIAL** | `docs/COST-ATTRIBUTION-FINDINGS.md` records the displayed cost as wrong by 1.8×–29× depending on the model string, with the sign of the error changing. This is why V062 caps a member's usage in **tokens**, not cents. |
| Replay a run | **PLAN** | `RunRoutes.replayRun` calls `requireFeature(REPLAY)`; `replay` is `false` on `free` in V060. It additionally refuses a run with no recorded model calls, rather than executing it live. |
| Loop reconstruction on resume | **FLAG** | `AGENT_LOOP_RECONSTRUCTION_ENABLED` default false. **Never claimed on the site**, and must not be. |

**Actions:** "Replay any run" → "Replay a run — Pro and above" on the homepage; an
availability strip naming the plan on every page that mentions replay; no cost-accuracy
claim is made anywhere, and the per-member cap is published in tokens as enforced.

### Multi-agent

| Claim | Verdict | Evidence |
|---|---|---|
| Multi-step, multi-agent workflows | TRUE | Several `agent` nodes in one graph, sequential or parallel, each with its own model, grants and budget. This ships and runs. |
| Agent **teams** — a roster delegating internally | **FLAG** | `AGENT_TEAMS_ENABLED` default false; `teams` entitlement false on Free *and* Pro. |
| Delegation guards (roster grant, depth, repeated-handoff stop, wall clock, budget tree) | **FLAG** | All implemented and enforced in runtime code — `AgentSafetyGuard`, `TeamLimits`, `BudgetVector` — behind the same flags. |

**Action:** an explicit callout on the orchestration page distinguishing "several agents as
steps" (works today) from "a team that delegates" (built, switched off), and the same
distinction in the availability strips and on the pricing matrix.

### Integrations, models and security

| Claim | Verdict | Evidence |
|---|---|---|
| BYOK: OpenAI, Anthropic, Gemini | TRUE | `LlmNodeExecutor` targets all three, with a per-connection base-URL override. Mistral is reachable through the connection tester. |
| Integration logos | *not claimed* | The site shows none, and claims no pre-built connectors that do not exist. Tools are HTTP, database and MCP, described as such. |
| Orchestrates HTTP-callable agents (LangGraph, CrewAI) | TRUE | An HTTP tool or external agent step calls any endpoint. |
| Keys encrypted at rest | TRUE | `EncryptedSecretService`, AES-256-GCM, workspace id as AAD — a ciphertext moved between tenants fails to decrypt. |
| SOC 2 / ISO 27001 / HIPAA / PCI | *not claimed* | None held, none claimed. Now stated as an absence in the Terms, the Privacy Policy, the DPA and on the pricing page. |

### Performance

| Claim | Verdict | Evidence |
|---|---|---|
| **`fetch-renewals ok 284ms`** (homepage console mock) | **FALSE** | No benchmark has been run. A number in a console-shaped element reads as a measurement. |
| **`SLA 24h`** (approval-gate mock) | **FALSE** *(as worded)* | The approval node's field genuinely is `slaMinutes`, but beside a durability pitch "SLA" reads as a service level agreement, and none is offered. |

**Actions:** the latency figure was removed; the mock label is now "escalates in 24h",
which is the same fact in unambiguous words.

---

## 2b. The homepage the site actually renders

**The most important finding, and it nearly went the other way.**

`apps/web/components/marketing/home-content.tsx` looks like the homepage and
reads like one. It is dead: `app/(marketing)/page.tsx` renders
`~/components/marketing/landing` instead, and nothing imports `home-content` at
all. The first pass of this audit corrected the dead file while the live page
carried worse claims than the ones being fixed.

Caught by rendering `/` in a browser and finding copy that did not match the file
that had just been edited. The claim guard now scans `src/components/marketing`
as well, and asserts that whatever `page.tsx` imports is in the scanned set — so
the next time the homepage moves, the guard fails rather than quietly auditing a
file nobody serves.

Four findings on the live page:

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| **"SOC 2 is in progress; we will say so here when it is done and not before."** | **FALSE** | No audit commissioned, no auditor engaged, no readiness work. Nothing in the repo or docs refers to one. "In progress" was aspiration in the present tense. | Replaced with a statement that no certification is held and no third-party audit has been performed. |
| **"Private runners — run workers inside your VPC so payloads never leave your network."** | **FALSE** | No runner artifact, no deployment path, no documentation. Only `SsrfGuard.privateRunnerMode`, a switch the API would need if one existed. | Card replaced with cross-workspace isolation, which *is* implemented — and is the question every multi-tenant buyer asks. The same sentence was removed from the hero and from the signed-in auth shell. |
| **"TLS 1.3 on every hop. Run payloads, node inputs and outputs are encrypted at rest."** | **FALSE** | Neither half is ours to assert: the TLS version is negotiated per hop with providers we do not control, and nothing in our code encrypts a run payload — it sits in managed Postgres, whose disk encryption is the provider's. | "TLS on every hop", plus what actually happens to a payload: managed Postgres with the provider's disk encryption, deleted at the retention window. |
| **"Failure clustering by signature — yes"** (comparison table) | **PARTIAL** | GAP-04: no server-side `GROUP BY` endpoint, and the band is behind `failureClustering`, default off. Client-side grouping over a capped page silently under-counts. | Cell changed to "partial" with a note naming the missing half. |

Also on the live page: **"Per-node token and cost accounting — yes"** now carries
a note. Tokens are counted and the claim is sound; cost is *derived* from a
model-price table that `docs/COST-ATTRIBUTION-FINDINGS.md` measures as wrong by
1.8×–29×, which is why V062 caps members in tokens rather than cents.

The `SLA` label on the approval mock became "escalates in 26m" for the same
reason it did on the dead page: the node's field really is `slaMinutes`, but on a
marketing page the abbreviation reads as a service level agreement.

---

## 3. Internal consistency

### Pricing page ↔ plan records

Previously **there was no pricing page**, so there was nothing to disagree. There is one
now, and its numbers are a copy of `plans` / `plan_entitlements` — necessarily, because the
page is served to people with no session and cannot resolve entitlements.

`apps/web/__tests__/pricing-consistency.test.ts` parses `V060`, `V061` and `V062` and fails
the build on any drift in plan names, descriptions, prices, entitlement values or kinds. It
caught three transcription errors while being written.

**Two inconsistencies found in the plan data itself** (recorded, not changed — they are the
plan owner's call):

1. **`pro` grants `max_team_size = 3` while `teams = false`.** The size limit is dead
   configuration: `GraphPlanCheck` calls `requireFeature(TEAMS)` before it ever compares the
   roster size, so a Pro workspace is refused at the feature and never reaches the number.
   Harmless today; misleading on a feature matrix, which is why the matrix shows both and
   the caveat explains it.
2. **`pro` grants `delegation = true` while `teams = false`.** This is *coherent* —
   delegation also applies to a plain `agent` node whose registered agent has a roster, with
   no team node involved — but it reads as a contradiction. Worth a note in
   `docs/PLANS-AND-ENTITLEMENTS.md`.

### Feature matrix ↔ entitlements

Every matrix row's `key` is an `EntitlementKeys` constant, and the test refuses a row whose
key no plan is seeded with. A promise with no mechanism behind it cannot be added.

### Docs ↔ both

The docs registry describes concepts, not limits, so there is no third set of numbers to
disagree. That is deliberate and should stay: the moment a doc page states a limit, it
becomes a third surface and needs to be added to the consistency test.

---

## 4. What was missing, and is now marketed

The audit's most useful finding is not a false claim — it is that **the four strongest
things this product has were the least marketed**. The site led on durability, which is what
every durable-execution vendor leads on, and buried the capabilities a buyer cannot get from
a framework they host themselves:

1. **Root cause, not a log.** Most agent platforms cannot show a customer why a run failed.
   This one names the node, its resolved inputs, the payload sent, the provider's answer and
   the failure classification — with a retry drawn as one node with two attempts rather than
   as a mystery. On every plan.
2. **Resume across a person, not just across a crash.** An approval parks durably, holds no
   worker, is not charged as agent time, and resumes from the checkpoint before the gate.
3. **A budget that is a ceiling, not an invoice.** Bounded per step and per team, with a
   child never allocated more than its parent's remainder, and a breach ending in a distinct
   terminal state that *names the limit it hit*.
4. **Multi-agent with enforced guards.** A roster grant checked in runtime code at the same
   boundary as the workspace scope, a depth limit, a repeated-handoff stop and a wall clock —
   because a roster stated in a prompt is documentation, not enforcement.

A "Where this is actually different" section now leads with all four on the homepage, each
card stating which plans it is true on.

---

## 5. Legal

**Before:** no terms, no privacy policy, no DPA, no subprocessor list. A paid product with
none of those has no agreed limitation of liability, no stated basis for suspension, and —
in the EU — no lawful basis for a customer to process personal data through it at all.

**Now:** `/legal/terms`, `/legal/privacy`, `/legal/dpa`, `/legal/subprocessors`, linked from
the footer of every marketing page and listed in the sitemap.

The subprocessor list is generated from `apps/web/lib/marketing/subprocessors.ts`, where
**every row carries the file that makes the call**. It names:

- **Infrastructure** — Vercel, Railway, Neon, Upstash, Supabase.
- **Model providers** — OpenAI, Anthropic, Google (Gemini), Mistral, and *any host a custom
  base URL points at*.
- **Communications** — Resend.
- **Observability** — the customer's own OTel collector, marked as off by default.

Naming the model providers is the row that usually gets left off. A platform that runs an
agent sends the customer's prompt — containing whatever they put in it — to a provider, from
our infrastructure, under our TLS session. That the customer supplied the API key changes
which agreement governs retention and training; it does not change who made the request.
Both facts are stated, next to each other.

Each document states its own limits plainly rather than implying more than is true: no SLA,
no certification, no audit report, no BAA, and not designed for special-category data.

---

## 6. Enforcement

Two tests, both in `apps/web/__tests__`:

- **`pricing-consistency.test.ts`** — parses the plan migrations and compares them to the
  published grid. Refuses a matrix row for a key no plan grants, and refuses a
  flagged-off feature that is sold without a caveat naming its environment variable.
- **`marketing-claims.test.ts`** — reads the marketing sources with comments stripped, and
  (a) refuses uptime figures, SLA, SOC 2, ISO 27001, HIPAA, PCI-DSS, "independently audited"
  and guarantee language anywhere they are not denied *in the same sentence*; (b) requires
  every page that mentions replay, agent teams or OpenTelemetry export to carry the
  matching qualifier.

Both were verified against a negative control: injecting "SOC 2 compliant, with 99.9%
uptime. Replay any run." into the pricing page fails three assertions.

The reasoning behind each verdict lives in `apps/web/lib/marketing/claims.ts`, which the
test reads. An audit is a snapshot; the claim added next month by somebody working from a
feature list in good faith is what undoes it.

---

## 7. Open items

| Item | Why it is still open |
|---|---|
| A role contact address | The legal pages point at the address that actually receives mail today. `legal@` and `privacy@` would bounce, and a data subject writing to a bouncing mailbox does not extinguish the obligation to answer them. |
| Counsel review | All four documents are drafted against what the product does and say on their face that they have not been reviewed. |
| Cost accuracy | Until `COST-ATTRIBUTION-FINDINGS.md` is resolved, no cost-accuracy claim may be made, and per-member caps stay in tokens. |
| Uptime | There is no status page and no measurement, so there is nothing honest to publish. |
| `pro`'s dead `max_team_size` | Recorded in §3. A data change, not a code change. |
