# Cost attribution — findings

Read-only audit of every path that produces a cost figure, worker to pixel.
Date: 2026-09-04. Branch: `dev` @ `f0e7378`.

**Verdict up front: the displayed number is not billable.** It is not doubled —
that specific fear is unfounded, and §1 shows why — but it is wrong by between
1.8× and 29× depending on which model string the run used, and the *sign* of the
error changes with the model. §8 lists what must change before S4.

---

## 1. Is it doubled? No. `$0.21` is `$0.21`.

Three independent reasons, each sufficient on its own.

**The duplicated rows were only ever `kind='run'`.** The Q2 bug is documented at
`TraceRoutes.kt:105-146`: `WorkflowRuntime` opened the run span with
`Instant.ofEpochMilli(dagStartedAtMs)` and closed it with
`Instant.ofEpochMilli(startedAtMs)` — two `System.currentTimeMillis()` calls
milliseconds apart. The primary key is `(span_id, created_at)` (the partition key
has to be in the key), so `ON CONFLICT` missed and two rows landed. Both had
`parent_span_id IS NULL`, both became roots, and `childrenOf[spanId]` returned
the same children under each — which is why the *tree* rendered twice. That was a
rendering artefact of one duplicated root, not duplicated child rows. Ordinary
spans cannot duplicate: `RunTracer.open` mints `UUID.randomUUID()`, the span is
emitted exactly once on close, and `SpanRecord.createdAt` defaults to the same
`startedAt` held in the `Open` record ([SpanWriter.kt:145](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/events/SpanWriter.kt:145)).

**The dedupe gap is real but harmless here.** `dedupeBySpanId` is applied in
`TraceRoutes.tree` and `TraceRoutes.graph` only. Two other queries read
`run_spans` raw — the burn-down
([ConstellationRoutes.kt:431](apps/api-kotlin/src/main/kotlin/com/vectorbea/api/routes/ConstellationRoutes.kt:431))
and the compare view ([:957](apps/api-kotlin/src/main/kotlin/com/vectorbea/api/routes/ConstellationRoutes.kt:957)).
The burn-down filters `kind IN ('llm_call','tool_call','iteration')`, which
excludes the only kind that ever duplicated. `cmpSpans` has no kind filter and
*would* pick up both run rows — but the run span carries no cost, so the compare
view's cost delta is unaffected.

**And decisively: `run_spans.cost_cents` is NULL on every row in production.**
No code path anywhere passes a non-null `costCents` into `RunTracer.close()`. The
one span close that has a cost figure in scope —
[LlmNodeExecutor.kt:600](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/executor/LlmNodeExecutor.kt:600)
— passes `tokensIn` and `tokensOut` and omits `costCents`. Verified by exhaustive
grep of every `costCents =` assignment under `apps/`. The column, its three
readers, the reconciliation banner and the entire Cost tab rest on data that is
always null.

**The `$0.21` does not come from `run_spans` at all.** It comes from
`agent_runs` / `run_events`:

```
LlmNodeExecutor.emitEvent(LLM_CALL_COMPLETED, estimatedCost = estimateCostUsd(...))
  -> run_events.estimated_cost                                      (USD, per call)
  -> RunProcessor.updateRunCompleted: SUM(...) -> agent_runs.estimated_cost
  -> RunRepository.list LATERAL re-SUM -> AgentRun.estimatedCost
  -> run.costUsd -> formatCost() -> "$0.21"
```

One row per real provider call; no dedupe needed because each row *is* a real
call, and the terminal write is a whole-run `SUM` guarded by a status CAS, so it
is idempotent under redelivery.

> `$0.21` is `$0.21`, not `$0.105`. It is wrong for the reasons below, but not by
> a factor of two, and not because of the trace query.

---

## 2. Sources of truth: six, in three units, from two price tables

| # | Location | Unit | Written by | Priced by | Read by |
|---|---|---|---|---|---|
| 1 | `run_events.estimated_cost` | USD | `LlmNodeExecutor` | `estimateCostUsd` | **the only one that reaches a dollar figure a user sees** |
| 2 | `agent_runs.estimated_cost` | USD | `RunProcessor` = `SUM(#1)` | (derived) | burn-down `recordedTotalUsd`; `RunRepository` fallback |
| 3 | `agent_runs.cost_cents` | **int cents** | `RunCeilingTracker` = `ceil(SUM(#1)×100)` | (derived) | checkpoint ribbon (`ContinuationRoutes:247`) |
| 4 | `agent_iterations.cost_delta_cents` / `.estimated_cost_cents` | cents | `AgentBrainRunner` | `estimateCostCents` | `derivedNodes` (sums deltas); `AgentIterationRoutes` |
| 5 | `agent_activations.budget_consumed_json.costCents` / `.estimated_cost_cents` | cents | `AgentHarness`, `AgentCallExecutor` | `estimateCostCents` | constellation agent cards |
| 6 | `run_spans.cost_cents` | cents | **nobody** | — | burn-down, compare, graph nodes |

Plus `model_calls.cost_usd` (V026) — written by `ModelCallRecorder` using
`estimateCostUsd`, for replay/audit; read by no cost surface.

**Do they agree?**

- #1 → #2 → #3 agree by construction (each derives from the one above), except
  for the retention drift in §7.4 and the `ceil()` in §6.
- #4 and #5 agree with each other — both read the same in-memory `AgentBudget`.
- **#4/#5 disagree with #1 for the same model call**, because `AgentBrainRunner`
  and `LlmNodeExecutor` price it from two different tables. The agent card and
  the run header describe the same tokens and print different money:

| model | brain (#4/#5) | executor (#1) | agent card reads |
|---|---|---|---|
| `gpt-4o-mini` | 500¢/M — `contains("gpt-4o")` matches first; there is no mini branch | $0.60/M | **8.3× the run header** |
| `claude-3-5-haiku` | 300¢/M — no haiku branch | $0.80/M | **3.75×** |
| `claude-3-opus` | 300¢/M — no opus branch | $15.00/M | **0.2×** |
| `gpt-4o`, `claude-3-5-sonnet` | 500¢/M, 300¢/M | $5.00/M, $3.00/M | agrees |

- #6 is 0 while every other source is non-zero. The burn-down already reports
  this honestly — `BurndownReader.Reconciliation` names the gap as *unattributed*
  rather than rescaling the bands. That decision is the best thing in this whole
  area, and it is why the Cost tab is misleadingly empty rather than confidently
  wrong.

---

## 3. The price table: five of them, all hardcoded, none per-direction on the runtime path

| Where | Shape | Reaches a bill? |
|---|---|---|
| [LlmNodeExecutor.kt:1179](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/executor/LlmNodeExecutor.kt:1179) `estimateCostUsd` | 14 branches, USD/M, **one blended rate for input+output** | **yes — authoritative** |
| `AgentBrainRunner.kt:2298` `estimateCostCents` | 4 branches, cents/M, blended | yes (agent surfaces) |
| [roi-analytics.ts:121](apps/web/lib/server/roi-analytics.ts:121) `DEFAULT_PROVIDER_PRICING` | **per-direction**, with a DB override | no |
| [app/api/eval/run/route.ts:14](apps/web/app/api/eval/run/route.ts:14) `COST_PER_1K` | per-direction | eval harness only |
| `V011` / `V012` migrations | flat `$2/M` | applied to historical rows |

The only table with a proper input/output split *and* a database backing is
`roi-analytics.ts`. Its override table `provider_pricing_configs` exists only in
the Supabase `vectorbea` schema — it is not in Flyway, and that schema is dead in
every environment. So the one design that was right is on the dead data path, and
its hardcoded fallback feeds nothing that runs.

**Last updated: never.** `git log -S` puts both runtime tables at 2026-05-28 /
2026-06-01 and shows no revision since. They were stale on the day they were
written:

- Every model named is 2024-generation (`gpt-4o`, `claude-3-5-*`, `claude-3-opus`,
  `gemini-1.5-*`). There is no entry for any current Claude model.
- `gpt-4o` is charged $5.00/M, the pre-cut input rate; published input has since
  been halved. *(OpenAI and Google rates quoted in this document are from
  published pricing as of writing and should be re-verified against the
  providers' own pages before anyone acts on the figures — the structural point
  does not depend on them.)*
- The default Anthropic model in the code is `claude-3-5-haiku-20241022`
  ([LlmNodeExecutor.kt:1148](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/executor/LlmNodeExecutor.kt:1148)).
- Anything unrecognised falls to `else -> 2.00` USD/M. Current Claude pricing runs
  $1/$5 per MTok (Haiku 4.5) to $5/$25 (Opus 5), so an Opus-class run priced at
  $2/M blended is roughly **6× under**.

No `effective_from`, no currency field, no provenance comment, and no test that
fails when a model in `ALLOWED_MODELS` has no rate.

---

## 4. Prompt caching: not enabled, not recorded, not priced

Zero occurrences repo-wide of `cache_control`, `cache_read_input_tokens`,
`cache_creation_input_tokens`, `cached_tokens`, or `cachedContent`.

- **Anthropic.** `callAnthropic` sends `put("system", it)` as a plain string with
  no `cache_control`
  ([LlmNodeExecutor.kt:814](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/executor/LlmNodeExecutor.kt:814)),
  so caching never engages and the provider bills full price on every resend.
  That is money left on the table, not a mis-report.
- **Latent under-report.** `parseAnthropicResponse` reads only
  `usage.input_tokens` / `output_tokens`. Anthropic reports cached tokens in
  separate fields and *excludes* them from `input_tokens` — so the day someone
  enables `cache_control`, every token count and every cost figure drops by the
  cached fraction, and it will look like a saving rather than an accounting hole.
- **Live over-report.** OpenAI and Gemini cache automatically with no opt-in, and
  their `prompt_tokens` / `promptTokenCount` *includes* the cached tokens. We
  price the lot at full rate.

**Measured on a 10-iteration agent run**, modelled from the code's own constants
(`AGENT_CONTEXT_CHAR_BUDGET = 48_000` chars ≈ 12k tokens; system prompt with tool
schemas constant across iterations; `OBSERVATIONS` append-only inside the
`takeLast(10)` window, so the prefix is genuinely stable):

```
input 63,400 tok   output 3,000 tok   ->  input is 95.5% of all tokens
87% of input tokens are a byte-identical prefix of the previous request
```

| | recorded | provider actually bills | error |
|---|---|---|---|
| `gpt-4o`, auto-cached | $0.3320 | ~$0.1199 | **2.8× over-report** |
| `claude-3-5-sonnet`, if caching were enabled | $0.2352 (what we pay now) | $0.0934 | **2.5× overspend** |

This is precisely the workload the question predicted. The error grows with
iteration count: the resent prefix grows quadratically in total while the fresh
tokens per iteration stay flat.

---

## 5. What is counted

| | Counted? | Correct? |
|---|---|---|
| **Failed calls** | **No** | ✗ `LlmCallException` → `recordCall("error")` writes `model_calls` with `costUsd = null`; no `LLM_CALL_COMPLETED`, so nothing reaches `run_events`. A call that failed after the provider consumed input tokens is billed by the provider and recorded here as zero. |
| **429 / throttled** | No | ✓ `NodeResult.Throttled` returns before any event is emitted. The provider does not bill a 429. |
| **Retries** | Once per attempt | ✓ Each attempt gets its own random span id and its own event; `context.attemptGroup` distinguishes them on `model_calls`. The provider bills each attempt. |
| **Replayed runs** | Excluded | ✓ and in the right place — the replay branch emits `LLM_CALL_COMPLETED` with `tokenCount = 0, estimatedCost = 0.0` ([LlmNodeExecutor.kt:264](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/executor/LlmNodeExecutor.kt:264)). Because the exclusion is at the **write** boundary, every downstream surface excludes them for free and none can forget to. No dashboard filter exists, and none is needed. |
| **Child activations** | Once | ✓ — see below |

**Replay caveat.** A replay that crosses its live boundary (`replay.isLive(nodeId)`)
does call the provider, does cost real money, and that spend is attributed to the
replay run. Correct billing — but it means "replays are free" is not universally
true, and any rule written that way will be wrong for boundary replays.

**Child activations are not double-counted**, and the reason is load-bearing and
easy to break by accident:

- `budget.addTokens(...)` at `AgentBrainRunner.kt:1090` is the *only* mutation of
  an agent's own `AgentBudget`. A child's cost is never added to the parent's, so
  `budget_consumed_json.costCents` is strictly self-cost per activation, and the
  constellation's per-activation figures sum correctly.
- `BudgetLedger` keeps `consumedSubtree` separately, in memory, for ceiling checks
  only, and never persists it. Grandchildren propagate correctly: each level calls
  `consume` for its own child, and the walk-to-root accumulates.

**But** the child's LLM calls also go through `LlmNodeExecutor` → `run_events`, so
the run total (#1) *already* includes every descendant. #1 and #5 are two views of
the same money, in different units, from different tables, computed by different
price functions. Adding the constellation's per-activation costs to the run header
figure would double the entire tree. Nothing does this today.

---

## 6. Rounding

**The one that matters: `agent_runs.cost_cents = Math.ceil(cost_usd × 100)`**
([RunCeilings.kt:213](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/budget/RunCeilings.kt:213)).
The `ceil` is deliberate and correct *for the ceiling check* — the comment says
so: a run that has spent $0.996 has spent 100 cents for the purpose of a $1.00
limit, and rounding down would let it keep going. It is wrong as a **reported**
figure, and `ContinuationRoutes` reads this column for the checkpoint ribbon. A
run that cost $0.0021 reports **1 cent — a 4.8× over-report**. Every sub-cent run
reports as ≥ 1 cent.

**Sum-of-rounded vs rounded-of-sum: yes, reachable.** `derivedNodes` sums
`agent_iterations.cost_delta_cents`, each already rounded to 4dp by its
`NUMERIC(10,4)` column, while `agent_activations.estimated_cost_cents` is an
unconstrained `NUMERIC` carrying the unrounded cumulative. Two screens, up to
`N × 0.00005` cents apart. Immaterial in magnitude — but it is a genuine
two-numbers-disagree case with no reconciliation between them, which is the class
of problem this audit exists to find.

**Where rounding is fine:**

- `NUMERIC(10,4)` on `run_spans` / `agent_iterations` bottoms out at $0.000001;
  not reachable at current call sizes.
- `BurndownReader.round4` rounds each cumulative point, then `EPSILON_CENTS = 0.005`
  decides agreement — a tolerance 50× the rounding grain, so it cannot
  false-positive.
- `formatCost`: `<$0.01 → toFixed(4)`, else `toFixed(2)`. `"$0.21"` is anything in
  `[$0.205, $0.215)` — ±2.4%, comfortably the smallest error on the page.
- `BudgetVector` is the one place that does it properly: integer micro-cents via
  `Math.round(cents × 1_000_000)`. Everything else carries cost as a `Double`.

---

## 7. Latent — not firing today, will fire on the obvious next change

1. **`TraceGraphBuilder.kt:292`** sums `(attempts + descendants).costCents`. The
   moment `costCents` is populated at more than one span level — say `iteration`
   *and* its child `llm_call` — every graph node's cost is multiplied by its
   nesting depth. Fix in the same commit that wires the column.
2. **The burn-down** sums `cost_cents` over `('llm_call','tool_call','iteration')`.
   The comment correctly warns that `iteration` spans contribute no *tokens* — but
   the cost column is summed for all three kinds. Same nesting hazard, same commit.
3. **`AgentBrainTrace.tsx:145-146`** sums `estimatedCostCents` and `tokensUsed`
   across iterations. V040's own migration comment states that both columns are
   *cumulative totals for the whole loop as of that iteration*. Summing them gives
   `n(n+1)/2` instead of `n` — **5.5× on a 10-iteration run**. The per-iteration
   label at `:116` shows a running total under the words "Est. cost" for that one
   iteration. The component is exported but imported nowhere (legacy
   `components/agent-runs/**`, one of the three coexisting run-UI generations), so
   nothing renders it today. Delete it, or fix it before anyone remounts it.
4. **`RunRepository.list`** recomputes `SUM(run_events.estimated_cost)` per row
   rather than reading the frozen `agent_runs.estimated_cost`. `run_events` is
   monthly-partitioned with detach-and-drop retention (V028). Once a run's
   partition is dropped, the `SUM` is NULL and `COALESCE` falls back correctly —
   but a run that **spans a month boundary** loses only its older partition, the
   `SUM` stays non-NULL, and the runs list silently shows a *smaller* cost than
   the run row. The list and the detail page then disagree about the same run, and
   the disagreement appears weeks after the run finished.

---

## 8. Verdict, and what must change before S4

**No. The displayed number is not trustworthy enough to bill on.** Three
independent disqualifiers, in order of size:

1. **Direction blindness.** One blended $/M applied to `input + output`, on a
   workload that is 95% input. Wrong by 1.8× on `gpt-4o`, 29× on `gpt-4o-mini`,
   0.17× on `claude-3-opus`. The *sign* of the error changes with the model string.
2. **A table that names only 2024 models**, with an `else -> $2.00/M` branch
   catching everything current — roughly 6× under for an Opus-class model.
3. **Caching neither enabled nor recorded**, so we overpay ~2.5× and, on the
   auto-caching providers, over-report ~2.8× on top of that.

Any one alone disqualifies it. Together the figure can be off by more than an
order of magnitude in either direction, and which direction depends on a
`String.contains` match.

**Ordered by value per unit of work:**

1. **Price `tokensIn` and `tokensOut` separately.** Both are already parsed for
   all three providers and already written to the span; only the pricing function
   throws the split away. Highest-value change in this document, and it touches
   one function.
2. **One price table, one place.** Per model *and* per direction, with
   `effective_from`, a currency, and a provenance note. Delete
   `AgentBrainRunner.estimateCostCents` and have it call the shared function —
   that alone removes the 8.3× agent-card divergence. Add a test that fails when a
   model in `ALLOWED_MODELS` has no entry, so the next model added cannot silently
   land on the `else` branch.
3. **Record the cache fields before enabling caching.** Parse
   `cache_read_input_tokens` / `cache_creation_input_tokens` (Anthropic),
   `prompt_tokens_details.cached_tokens` (OpenAI), `cachedContentTokenCount`
   (Gemini); add nullable columns; price reads at 0.1× input and writes at 1.25×
   (5-minute TTL) or 2× (1-hour). Do this **first** and enable `cache_control`
   second — otherwise the first cached run reports a cost drop that is really an
   accounting hole.
4. **Decide what `run_spans.cost_cents` is for.** Either wire it at exactly one
   level (`llm_call`, nowhere else) and fix §7.1 and §7.2 in the same commit, or
   drop the column and delete the Cost tab's span path. Today it is a column,
   three readers, a reconciliation banner and a whole UI view resting on data that
   is always NULL.
5. **Count failed calls.** A call that reached the provider and failed consumed
   input tokens. Emit its cost with a `failed` outcome — "what will we be billed"
   and "what did this run accomplish" are different questions and need to be
   answerable separately.
6. **Stop `ceil()`-ing the reported figure.** Keep the `ceil` for the ceiling
   check; report from `estimated_cost` at real precision.
7. **Have the runs list read the frozen `agent_runs.estimated_cost`** instead of
   re-summing a partitioned table under retention.
8. **Delete or fix `AgentBrainTrace.tsx`.**

**None of these touch the stop-and-ask zone.** No approval-key shape, no run
status machine or CAS, no lease acquisition, no event sequence assignment, no
idempotency derivation, nothing that alters resume behaviour. Item 3 adds nullable
columns (the Flyway forward-only convention holds) and item 5 adds a field to an
existing event. Every one of them sits safely inside the half of the runtime that
can be changed without a design conversation — worth saying explicitly, because
the size of the numbers above makes this look scarier than the change actually is.

---

### Appendix — the good news

Three things in this area are done right and should not be disturbed:

- **`BurndownReader`'s reconciliation.** It knows there are two records of the
  same money in two units, converts once at a visible boundary, and reports the
  leftover as *unattributed* rather than rescaling the bands to make the chart add
  up. A chart that adds up perfectly and lies about where the money went is the
  failure mode it was built to refuse.
- **Replay exclusion at the write boundary.** Zero cost is recorded, not filtered
  later, so no dashboard can forget to exclude it.
- **`BudgetVector`'s integer micro-cents**, and the ledger's self-vs-subtree
  separation. The one part of the cost stack whose arithmetic is provably right.

---

# Addendum — Commit 1 (prompt caching) and the Commit 2 question

Added 2026-09-04, after the audit above. The audit stands unchanged; this records
what was built, what was answered, and what still has to be measured.

## Commit 2's question, answered: token counts are real, prices are guessed

**Do we read the provider's usage object, or compute from character counts?**
We read real usage, on all three providers:

| Provider | Fields read | Site |
|---|---|---|
| OpenAI | `usage.total_tokens`, `.prompt_tokens`, `.completion_tokens` | `LlmNodeExecutor.parseOpenAiResponse` |
| Anthropic | `usage.input_tokens`, `.output_tokens` (both text and `tool_use` branches) | `parseAnthropicResponse` |
| Gemini | `usageMetadata.totalTokenCount`, `.promptTokenCount`, `.candidatesTokenCount` | `parseGeminiResponse` |

"Estimate" in `estimateCostUsd` and `estimateCostCents` refers to the **price**,
not the tokens: both take a measured count and multiply it by a guessed rate.
**This is not a second instance of H3.** §3 above is the whole defect.

**H3 itself is already closed**, which `PROVIDER-THROTTLING-FINDINGS.md` predates.
The capacity bucket no longer uses `chars/4`: `tokenEstimator.estimate(...)` is a
real jtokkit tokenizer plus a learned per-`(model, prompt-shape)` EWMA correction,
graded against the provider's own count on every successful call —

```kotlin
result.tokensIn?.let { actual -> tokenEstimator.record(estimate, actual.toLong()) }
```

`TokenEstimator`'s class doc carries the same measurements H3 reported, so it was
written in answer to it. The `chars/4` function H3 quoted still exists as
`LlmNodeExecutor.estimateTokens` with **zero callers, including tests** — a dead
remnant that should be deleted in Commit 3 so nobody revives the pattern.

## Commit 1, as built

**Flag: `LLM_PROMPT_CACHE_ENABLED`, default off.** Off is a true no-op — the
`system` field goes on the wire as the same bare string it always has. Tested in
both states.

**Placement.** The breakpoint marks the end of the `system` block and nothing
else. `AgentPromptBuilder` puts instructions, the serialised tool catalogue and
the roster in the system prompt, and the objective, inputs and **accumulated
observations** in the user message. Observations grow by one entry per iteration,
so a breakpoint after them would be invalidated every turn: we would pay the
~1.25x write premium on every iteration and never read an entry back, which is
strictly worse than not caching. Anthropic renders `tools` -> `system` ->
`messages`, so the end of `system` is the last byte-stable position.

**Opt-in, and why size alone is not enough.** A cache write only repays on the
*second* request sharing the prefix. An agent loop resends its system prompt
every iteration and repays immediately; a one-shot workflow LLM node never sends
that prefix again, so caching it is a pure 1.25x loss. Only the caller knows
which it is, so `AgentBrainRunner` sets `cachePrefix` and nothing else does. A
length floor (`LLM_PROMPT_CACHE_MIN_CHARS`, default 4000) additionally skips
prompts below the model's minimum, where the breakpoint is silently ignored.

**Cached tokens are now read and priced on all three providers, flag or no flag** —
because OpenAI and Gemini cache automatically and cannot be told not to:

| Provider | Field | Relationship to the headline count |
|---|---|---|
| Anthropic | `cache_read_input_tokens`, `cache_creation_input_tokens` | **excluded** from `input_tokens` — must be ADDED to get the true total |
| OpenAI | `usage.prompt_tokens_details.cached_tokens` | included in `prompt_tokens` — discount only |
| Gemini | `usageMetadata.cachedContentTokenCount` | included in `promptTokenCount` — discount only |

The Anthropic row was a live latent bug: summing only `input + output` was
correct while nothing cached, and would have under-counted every call by the
cached fraction the moment caching was enabled — the bill unchanged, every screen
down ~80%, reading as a saving. `anthropicTotal()` now adds all four.

`effectiveBillableTokens` replaces cached tokens at their own multiplier
(read 0.1x on Anthropic, 0.5x on OpenAI/Gemini; write 1.25x, Anthropic only)
rather than adding or zeroing them. **It does not touch the rate table** — §3's
1.8x-29x error is Commit 3's, deliberately left alone so this commit's measured
before/after stays readable.

## How to measure it — do not skip this, the flag stays off until you have

The numbers below could not be produced here: this environment has no provider
credential (provider secrets live encrypted in `connections`, resolved at
runtime) and no reachable database, so no real call can be made. Everything
needed to measure is instrumented; run it in staging on an agent workflow of
**10+ iterations**, which is where the effect is largest.

**1. Baseline, flag off.** Run the workflow, note the run id, then:

```sql
SELECT count(*)                                             AS calls,
       sum(coalesce(tokens_in,0) + coalesce(tokens_out,0))  AS tokens,
       sum((attributes_json->>'cache_read_tokens')::int)    AS cache_read,
       sum((attributes_json->>'cache_write_tokens')::int)   AS cache_write
  FROM run_spans
 WHERE run_id = :runId AND kind = 'llm_call';
```

`cache_read` should be null or 0 on Anthropic with the flag off. On OpenAI it may
already be non-zero — that is automatic caching we were previously mispricing,
and it is the 2.8x over-report in §4 showing itself for the first time.

**2. Set `LLM_PROMPT_CACHE_ENABLED=true`, restart the worker, run the same
workflow, and compare.** The hit rate is:

```
cache_read / tokens            -- per run, from the query above
```

Expect ~0 on iteration 1 (the write) and a high fraction from iteration 2 on. As
a rate over a window:

```
sum(rate(llm_tokens{direction="cache_read"}[5m]))
  / sum(rate(llm_tokens{direction="total"}[5m]))
```

**3. The bill delta is the real acceptance criterion.** `llm_cost_usd_micros`
already reflects the cache discount, so compare the two runs directly:

```sql
SELECT sum(estimated_cost) FROM run_events
 WHERE run_id = :runId AND type = 'LLM_CALL_COMPLETED';
```

**Keep the flag on only if the second run is cheaper.** The audit's model predicts
~2.5x on a ten-iteration loop, but that is a model, not a measurement, and short
or few-iteration agents can genuinely come out worse. If the hit rate is near zero
with the flag on, something is invalidating the prefix — the tool catalogue or the
roster changing between iterations is the first thing to check, since both are
serialised into the system prompt.

## For R1 — cache reads and rate limits

**Yes, they count differently.** On the Claude API, cache reads do not count
toward input-token rate limits on most models (Haiku 3.5 is the documented
exception). So a cached prefix relieves 429 pressure as well as spend, and the
relief scales with the same hit rate measured above.

**This has a consequence in code that I have deliberately not changed**, because
`ProviderCapacityBucket` is R1's:

```kotlin
settleOnce((result.tokenCount ?: 0).toLong())   // LlmNodeExecutor
```

The bucket is settled against the **full** token count, which now includes cache
reads. If those reads do not count against the provider's limit, the bucket is
over-debiting by exactly the cached fraction — on an agent loop, most of the
prompt — and throttling calls the provider would have accepted. The fix is to
settle against `tokenCount - cacheReadTokens`, and it should land with R1's
judgement about the reservation side, not bolted onto this commit.

Also for R1: **H3 is already fixed** (see above). That doc should be updated, and
the dead `estimateTokens` deleted.

## What Commit 1 deliberately did not do

- **`run_spans.cost_cents` is still NULL.** Populating it before
  `TraceGraphBuilder:292` and the burn-down's kind filter are fixed would ship a
  cost view wrong in proportion to team depth. That ordering is Commit 3's.
- **The rate table is untouched.** §3 stands in full.
- **Failed calls still record no cost.** §5 stands.
- **One breakpoint, not two.** The objective and inputs at the head of the user
  message are also stable and could carry a second breakpoint, worth roughly a
  third of the stable prefix. It needs `AgentPromptBuilder` to expose its section
  boundaries, which is a cross-layer change that does not belong in a commit that
  ships alone. Revisit once the hit rate above is known.
