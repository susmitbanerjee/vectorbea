# Vectorbea — Agent Reliability Architecture
### Making agent output trustworthy enough that operators stop watching

---

## 1. The distinction that governs everything below

Your architecture solves **durability**. This document solves **correctness**. They are orthogonal, and conflating them is the most expensive mistake available to you right now.

| | Guarantees | Mechanism | Status |
|---|---|---|---|
| **Durability** | Work is never lost | Leases, checkpoints, event sourcing | Built |
| **Idempotency** | Side effects never double-fire | Fencing, idempotency keys | Backend plan B04 |
| **Correctness** | Output is right, or known to be wrong | *This document* | Not built |

Here is the uncomfortable implication: **your durability layer amplifies incorrectness.**

When an agent hallucinates an account ID, that output is validated by nothing, checkpointed as committed, and inherited by every downstream node. The checkpoint makes it permanent. Retry does not help — the wrong value is already committed upstream. The run *succeeds*. Your dashboard shows green. An email goes to the wrong customer.

A failed run is a good outcome. It's loud, diagnosable and recoverable — everything your architecture is built for. **A silently wrong run is the failure mode that actually destroys trust**, and it is currently invisible to your entire stack.

So the goal is not to stop agents hallucinating. That is not achievable with current models and anyone claiming otherwise is selling something. The goal is:

> **Make wrong output impossible to commit silently.**

Everything below serves that single sentence.

---

## 2. The bug in your replay guarantee

Before the reliability work, fix this. Your builder inspector shows "Replay: Replay available." Your landing page promises "Replay any run." Your docs promise an immutable, replayable event history.

**An LLM call is non-deterministic. If replay re-executes it, you do not have replay.**

You have a re-run that produces different output, costs tokens again, and — critically — fails to reproduce the bug you opened the replay to investigate. The engineer debugging a bad decision sees a *different* decision and concludes the system is haunted.

This is the same problem Temporal solves with the workflow/activity split, and the answer is the same:

| Operation | LLM behaviour | Purpose |
|---|---|---|
| **Replay** | Return the **recorded** response from event history. Never call the provider. | Debugging, audit, "what exactly happened" |
| **Retry** | Actually call the provider. New response, recorded as a new attempt. | Recovery from a genuine failure |
| **Re-run** | Fresh execution from the trigger. Everything called again. | "Do it again with today's data" |

These are three different operations with three different costs and three different guarantees. Your UI currently offers roughly one button for them. Split them.

**Requirement:** every model call records `{provider, model_version, params, seed, prompt_hash, full_request, full_response, logprobs, latency, tokens, cost}` into the event history. Replay is a pure read from that history. A replayed run must produce byte-identical output to the original — that is the test.

This also makes your event history genuinely authoritative for audit, which is what enterprise buyers are actually asking about when they ask about audit trails.

---

## 3. The failure taxonomy

You cannot defend against "hallucination" as a single thing. Eight distinct failure modes, each with a different defence.

| # | Failure | What it looks like | Defence | Layer |
|---|---|---|---|---|
| 1 | **Schema violation** | Prose instead of JSON; missing field; wrong type | Constrained decoding — **eliminated, not reduced** | 0 |
| 2 | **Fabricated extraction** | Field invented because it wasn't in the source | Mandatory citation + span verification | 2 |
| 3 | **Semantic invalidity** | Well-formed, violates business rules (`risk_score: 340`) | Assertion rules on output | 1 |
| 4 | **Tool call hallucination** | Calls a nonexistent tool; invents parameters | Tool grants + strict schema on arguments | 0 |
| 5 | **Instruction drift** | Agent forgets constraints after N loop turns | Constraint re-injection; loop budget | 3 |
| 6 | **Context poisoning** | Bad upstream output compounds downstream | Validation *at the boundary*, before checkpoint | 1 |
| 7 | **Non-termination** | Iterative loop never converges | Hard step and cost ceiling | 3 |
| 8 | **Silent drift** | Provider updates the model; behaviour changes | Version pinning + regression evals | 5 |

Note #6 specifically: because your architecture checkpoints between nodes, **the checkpoint boundary is exactly where validation must happen.** Validate before commit, and a bad output never becomes durable. Validate after, and you've made it permanent. This is a one-line architectural decision with enormous consequences.

---

## 4. The layered defence

Six layers. Each is independently valuable; each is configurable per node, because reliability costs money and not every node deserves the same spend.

### Layer 0 — Constrained decoding (mandatory, free, eliminates a whole class)

If a node declares an output schema, the provider call **must** enforce it structurally. Not "please return JSON" in the prompt — actual constrained generation.

| Provider | Mechanism |
|---|---|
| OpenAI | `response_format: {type: "json_schema", json_schema: {…, strict: true}}` |
| Anthropic | Tool use with `input_schema` — forces structured output |
| Gemini | `responseSchema` with `responseMimeType: application/json` |
| Open models | Grammar-constrained decoding via Outlines/vLLM |

This makes failure mode #1 impossible rather than unlikely. It costs nothing. It should be the default for every agent node with a declared schema, and a validation error at publish time if a schema is declared but the provider path doesn't enforce it.

> Practical note: OpenAI strict mode requires every property to be in `required` and disallows some JSON Schema constructs at the root. Model optional fields as nullable types rather than optional keys, and validate the semantic optionality in Layer 1.

### Layer 1 — Contract validation (cheap, catches semantic nonsense)

Every agent node declares an **output contract**: the schema plus assertions.

```yaml
contract:
  schema:
    risk_score:  { type: integer, minimum: 0, maximum: 100 }
    account_id:  { type: string, pattern: "^acc_[a-z0-9]{12}$" }
    recommendation: { type: string, enum: [renew, escalate, churn_risk, no_action] }
    reasoning:   { type: string, minLength: 40 }

  assertions:
    - name: account_exists_in_input
      expr: output.account_id in input.accounts[*].id
      severity: fail          # never commit

    - name: score_matches_recommendation
      expr: output.risk_score > 70 implies output.recommendation != "no_action"
      severity: fail

    - name: score_within_historical_range
      expr: abs(output.risk_score - stats.p50_risk_score) < 3 * stats.stddev
      severity: warn          # commit, but flag and route to review
```

Assertion severities:
- `fail` — do not commit. The node fails with a specific, actionable error.
- `warn` — commit, but mark the run as low-confidence and surface it.
- `gate` — commit, but force a human approval gate before any downstream side effect.

That last one is the interesting one, and §6 explains why.

### Layer 2 — Groundedness (the highest-leverage anti-hallucination technique)

For any extraction or classification task, **require a verifiable citation**. Instead of:

```json
{ "account_name": "Northwind Traders" }
```

require:

```json
{
  "account_name": {
    "value": "Northwind Traders",
    "found": true,
    "source_span": "renewal for Northwind Traders is due on"
  }
}
```

Then **mechanically verify that `source_span` is a literal substring of the input.** If it isn't, the model invented the citation, which means it invented the value. Fail the node.

This is powerful for one specific reason: it converts hallucination from an unverifiable property into a **checkable** one. You are no longer asking a model to self-report confidence — you are asking it to point at evidence and then checking whether the evidence exists.

Paired requirement: **`found: false` must be a first-class, rewarded outcome.** The dominant failure in business extraction is a model inventing a field rather than admitting absence. The contract must permit null, the prompt must explicitly authorise it, and your evals must include cases where the correct answer is "not present."

### Layer 3 — Loop discipline (for iterative agents)

Your Agent Brain has an "iterative brain loop" toggle. Loops are where reliability degrades fastest — instructions drift, context bloats, and cost runs away.

- **Hard budgets**: max iterations, max tokens, max wall-clock, max cost. Exceeding any produces a specific terminal state, never a silent truncation.
- **Constraint re-injection**: re-state the output contract and hard constraints every N turns. Models forget system instructions as context grows.
- **Progress check**: if two consecutive iterations produce semantically equivalent state, the loop is stuck. Terminate rather than burn budget.
- **Tool grants enforced at call time**: the agent may only call tools it was granted, checked server-side, not by prompt instruction. A hallucinated tool call is rejected before execution, not after.

### Layer 4 — Verification (expensive, for high-stakes nodes only)

Two patterns, both opt-in per node:

**Self-consistency** — sample N times at temperature 0.7, take the majority answer for discrete outputs or the median for numeric. Disagreement across samples is itself a strong confidence signal. Cost: N×. Reserve for irreversible decisions.

**Critic pass** — a cheap model checks the expensive model's output against the source input and the contract. Cost: roughly +15–25%. Good general-purpose insurance on extraction nodes.

Neither is a default. Both are configured per node with the cost shown in the UI at configuration time, so the user makes an informed trade.

### Layer 5 — Determinism and version control

Silent drift is the failure mode that erodes trust slowly and is hardest to diagnose.

- **Pin model versions.** `gpt-4o-mini` is a floating alias; the provider can change what it points to and your workflows silently change behaviour. Pin to dated versions (`gpt-4o-mini-2024-07-18`). Surface a warning in the UI when an agent uses a floating alias.
- **Temperature 0** for extraction, classification, routing and decisions. Non-zero only for genuine generation.
- **Seed** where the provider supports it.
- **Content-hash the rendered prompt.** Version prompts. When the hash changes, the agent's reliability baseline branches — you have prompt version history in the UI (P17); this is what populates it.
- **Record everything** per §2.

---

## 5. Retry that doesn't make things worse

Your retry policy currently offers max attempts and backoff. That is correct for infrastructure failures and **actively harmful for reliability failures.**

Blindly retrying a hallucination with the identical prompt at temperature 0 produces the identical hallucination — you burn tokens and time to arrive at the same wrong answer, then commit it.

Retry must be classified by failure type:

| Failure | Strategy | Max | Notes |
|---|---|---|---|
| Provider 429 | Backoff + jitter, **suspend the run** | 5 | Never hold a slot while backing off |
| Provider 5xx | Backoff, then failover to secondary provider | 3 | Log the failover; it changes behaviour |
| Timeout | Retry once, then fail | 1 | |
| Schema violation | **Repair prompt** — feed the validation error back | 2 | Usually succeeds on attempt 2 |
| Assertion failure | Repair prompt with the specific rule violated | 2 | |
| Groundedness failure | **Do not blind-retry.** Escalate: temp→0, or stronger model, or human | 1 | Same prompt gives the same fabrication |
| Content filter | **No retry.** Fail with a clear message | 0 | Retrying is futile and looks broken |
| Tool call hallucination | Repair with the valid tool list re-injected | 2 | |

The repair prompt is the pattern worth building well: on validation failure, re-call with the original prompt *plus* the invalid output *plus* the specific violation. Recovery rates on schema and assertion failures are high, and it converts a run failure into a two-second delay the user never sees.

---

## 6. Confidence routing — where reliability meets your product

This is the part that turns defensive engineering into a feature you can sell, and it uses a capability you already have.

Every agent node emits a **confidence score** composed from signals you're already collecting:

```
confidence = weighted(
  schema_valid,                     # 0 or 1, hard gate
  assertions_passed / total,
  citations_verified / claims_made,
  1 - normalised_logprob_entropy,   # on key fields, where available
  self_consistency_agreement,       # if enabled
  critic_verdict,                   # if enabled
  1 - distance_from_historical_distribution
)
```

Then route on it:

```
confidence ≥ 0.90   → commit and continue
0.70 – 0.90         → commit, flag the run as low-confidence, surface on Control
0.50 – 0.70         → SUSPEND and open a human approval gate
< 0.50              → fail the node with a specific diagnosis
```

The gate threshold is the important one. **Your Human Approval gate stops being a compliance checkbox and becomes an automated quality control mechanism.** The system routes exactly the decisions it isn't sure about to exactly the person who should see them — with the evidence, the citations and the specific assertion that fell short.

And it costs a person nothing when the model is confident. That is the actual answer to "customers can rely on it": not that the agent is always right, but that **the agent knows when it might be wrong, and asks.**

This connects directly to the Approvals surface in UI prompt P13, which already shows decision context with evidence. Add the confidence score and the triggering signal, and that screen becomes the single most compelling thing in a demo.

---

## 7. Measurement — you cannot claim reliability you haven't measured

### 7.1 Evals

Every agent has a **golden set**: input/expected-output pairs from real production data, including hard negatives (cases where the correct answer is null, ambiguous, or "insufficient information").

Run evals:
- On every prompt change, before it can be published
- On every model or version change
- On every contract change
- Nightly against the current production configuration

Report per agent: schema validity, assertion pass rate, groundedness rate, exact match, semantic match, null-handling accuracy, p95 latency, cost per call.

**Gate publishing on eval results.** A prompt change that drops the assertion pass rate below the agent's threshold cannot be published without an explicit override that is recorded in the audit log. This is what makes "correctly set up" a checkable property rather than a hope — which is precisely the promise in your question.

### 7.2 Production monitoring

Sample production outputs continuously and track:

```
agent_schema_violation_rate{agent, model_version}
agent_assertion_failure_rate{agent, assertion}
agent_groundedness_rate{agent}
agent_confidence_distribution{agent}      ← watch the shape, not the mean
agent_gate_routing_rate{agent}
agent_repair_success_rate{agent, failure_type}
agent_output_drift{agent}                 ← distributional distance vs. baseline
agent_cost_per_successful_output{agent}
```

**Drift detection is the one that catches silent provider changes.** If an agent's output distribution shifts significantly with no prompt or config change on your side, the provider changed the model. Alert, don't wait for a customer to notice.

**Quality circuit breaker:** if an agent's schema violation rate exceeds a threshold over a rolling window, trip a breaker — pause the agent, route affected workflows to gates or halt them, and alert. Continuing to produce garbage confidently is worse than stopping.

---

## 8. The promise you should actually make

You wrote: *"the promise we made that the workflow never fails."*

Your marketing does not, in fact, say that — it says "Agents that resume, not restart" and "Failure is a checkpoint, not a restart." Those are good and defensible. **Do not upgrade them to "never fails."**

"Never fails" is falsified by the first counterexample, and when a prospect finds it — they will — every other claim you make loses credibility with it. It also invites the wrong kind of scrutiny: a buyer who hears "never fails" starts hunting for failures instead of evaluating the product.

The honest promise is stronger, and it's the one this architecture actually delivers:

> **Your work is never lost.** Every committed step survives any failure.
> **Nothing harmful happens twice.** Side effects fire exactly once, even through crashes and retries.
> **Nothing wrong is committed silently.** Output is validated against its contract before it becomes durable.
> **When the agent isn't sure, a person decides.** With full evidence, before any consequence.
> **Everything is reproducible.** Any run replays byte-identically from its event history.
>
> Failures happen. You'll know immediately, you'll know exactly why, nothing was lost, and nothing harmful was done.

That is a promise about **bounded blast radius**, not zero failure — and bounded blast radius is what an operations lead is actually buying. It is also the promise that lets them stop watching, which is what you were reaching for.

### The demo line

> "Every competitor shows you a workflow that works. Let me show you one that goes wrong."

Then trigger a failure live: the agent produces a low-confidence output, the contract catches it before commit, the run suspends at a gate, the reviewer sees the evidence and the specific assertion that fell short, approves a correction, and the run resumes from checkpoint — with no lost work and no duplicate side effects.

No competitor in your set can run that demo. It is the single most persuasive eight minutes you have.

---

## 9. Product surfaces this creates

Reliability machinery is worthless if it's invisible. These map onto the UI prompts.

| Surface | Addition | Prompt |
|---|---|---|
| **Node inspector** | New **Contract** tab: output schema, assertions with severity, groundedness requirement, confidence policy, verification settings with live cost impact | P16 |
| **Agent registry** | Reliability column and detail panel: schema validity, groundedness rate, confidence distribution, drift indicator, eval history | P17 |
| **Run detail** | **Validation trace** per node: what was checked, what passed, citations verified, confidence score and its components | P12 |
| **Approvals** | Confidence score, the specific assertion that triggered the gate, verified citations as evidence | P13 |
| **Publish flow** | **Readiness score**: every agent node has a contract, every high-risk tool has a gate, every model version is pinned, evals pass. Blocks publish below threshold. | P14 |
| **Incidents** | Reliability incidents as a class: drift detected, quality breaker tripped, assertion failure spike | P13 |
| **New: Evals** | Golden sets, run history, regression comparison, publish gating | new |

The **readiness score at publish** is the one that directly answers your question. "Correctly set up" becomes a number the product computes and enforces, not a hope the user carries.

---

## 10. Cost of reliability

Be honest about this internally and in the UI — reliability is a spend decision per node, not a global switch.

| Layer | Cost | Default |
|---|---|---|
| Constrained decoding | **Free** | **Always on** |
| Contract validation | Negligible | **Always on** |
| Groundedness citations | +10–20% output tokens | On for extraction |
| Repair retry | Only on failure, ~+1 call | **Always on** |
| Critic pass | +15–25% | Opt-in |
| Self-consistency N=3 | **+200%** | Opt-in, high-stakes only |
| Logprob confidence | Free where supported | On |
| Evals | Fixed cost per change | **Always on** |

Layers 0, 1 and 5 are free or near-free and eliminate the majority of real-world failures. **Start there.** Layer 4 is genuinely expensive and belongs only on irreversible decisions — which is exactly where a human gate is also appropriate, so in practice you often choose one or the other rather than both.

Show the per-run cost delta in the inspector when a user enables verification. Let them make the trade with the number in front of them.

---

## 11. Sequencing

| Stage | Work | Effort | Buys you |
|---|---|---|---|
| **1** | Fix replay (§2). Record all model calls. Split replay/retry/re-run. | 6h | Your event history becomes truthful |
| **2** | Constrained decoding + contract schema + assertions (Layers 0–1) | 12h | Eliminates the largest failure class |
| **3** | Repair retry + failure classification (§5) | 6h | Converts failures into invisible delays |
| **4** | Groundedness + citation verification (Layer 2) | 10h | Makes fabrication mechanically detectable |
| **5** | Confidence scoring + gate routing (§6) | 10h | **The demo. The differentiator.** |
| **6** | Eval harness + publish gating (§7.1) | 12h | "Correctly set up" becomes checkable |
| **7** | Drift detection + quality breaker (§7.2) | 8h | Survives provider changes |

Roughly 64 hours. Stages 1–3 are the floor before onboarding anyone who matters. Stage 5 is what you build before the investor meeting.
