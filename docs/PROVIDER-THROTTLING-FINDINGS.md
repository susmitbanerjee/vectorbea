# Why the capacity bucket is not preventing 429s

> **Status: acted on.** Every finding below was fixed in P15. See
> [architecture §12.4.2](./AGENT-HARNESS-ARCHITECTURE.md) for what was built and
> the acceptance tests that hold it. This document is kept as the investigation
> record — the reasoning that led to each change, and the evidence for it.

Read-only investigation. Nothing in this document has been changed in code.

Every claim below cites a file and line. Where a question can only be answered
from production data, that is said plainly and the query is given rather than a
number invented for it.

---

## Summary

**The bucket does not prevent 429s because it has never run.**
`PROVIDER_CAPACITY_ENABLED` is not set in any environment file, compose file,
Railway config or Dockerfile in this repository, and it defaults to off
(`ProviderCapacityBucket.kt:78`). Every call to `reserve` returns
`NotApplicable` before it touches Redis.

That alone is sufficient, so the four hypotheses are graded on what would happen
**if it were switched on tomorrow**. Three of them would still bite:

- Two of the three agent paths never pass the bucket to the executor at all, and
  one of those is the multi-agent fan-out — the exact shape that produces the
  burst.
- The bucket models tokens only; providers limit requests per minute separately.
- The estimator under-reserves agent prompts by 15–36%, and the error grows with
  tool count and iteration depth.

And underneath all of it there is a **worse, separate defect**: the throttle
recovery path is broken. A run parked by a 429 is resumed by nothing except
crash recovery, which ignores `Retry-After` entirely and returns runs in
synchronised batches of ten. That is what turns a rate limit into a cluster.

---

## The trivial explanations, first

### Is the bucket enabled?

**No — and it never has been.**

| Where | Result |
|---|---|
| `.env`, `.env.example` | not present |
| `apps/worker-kotlin/.env.example` | not present |
| `apps/worker-kotlin/railway.json` | not present |
| `apps/worker-kotlin/Dockerfile` | not present |
| `docker-compose.yml` | not present |
| Default in code | `System.getenv("PROVIDER_CAPACITY_ENABLED")?.lowercase() == "true"` → **false** |

`Main.kt:222-228` constructs it unconditionally and documents it as "INERT
unless PROVIDER_CAPACITY_ENABLED is set". It is inert.

**It was not disabled to work around the M3 reservation leak.** That leak was
real — `LlmNodeExecutor` settled on three named paths and not on
`CancellationException`, which the worker throws routinely — and it was **fixed**:
`settleOnce` under `withContext(NonCancellable)` (`LlmNodeExecutor.kt:341-356`),
with `CapacityLeaseLifecycleTest` covering both halves. The flag was never on
before the leak and was never turned on after the fix. There is no evidence of a
deliberate disable; there is evidence of a feature that was built, tested, merged
and never enabled.

### Is the reserve call reached on every provider call?

**No. There are three code paths to a provider and only one of them reserves.**

`reserve` is called from exactly one place: `LlmNodeExecutor.kt:293`. Everything
therefore depends on whether a given path reaches `LlmNodeExecutor` *carrying a
non-null `capacity`*.

| Path | Reaches the bucket? | Evidence |
|---|---|---|
| `NodeType.LLM` — a plain LLM node | **Yes** | `NodeExecutorRegistry.kt:55-57` passes `capacity` |
| `NodeType.AGENT` — single agent loop | **Yes** | `NodeExecutorRegistry.kt:66-67` passes `capacity`; `AgentNodeExecutor.kt:507` forwards it to the brain |
| `NodeType.AGENT_TEAM` — multi-agent team | **NO** | `NodeExecutorRegistry.kt:71-72` constructs `AgentTeamNodeExecutor(dataSource, connectionResolver, eventStore, dbPoolManager)` — and that class **has no `capacity` parameter at all** |
| Delegated **child** activation | **NO** | `AgentBrainRunner.kt:546-559` builds the child runner and omits `capacity` from the argument list |
| API-side AI Architect | **NO** | `WorkflowArchitectService` runs in `apps/api-kotlin`, which has no bucket in the process |
| Connection test (`LlmTester`) | **NO** | api-kotlin; one small call per user action |

Two of these are not edge cases:

1. **`AgentTeamNodeExecutor` cannot be metered even in principle.** It takes no
   capacity argument, and `brainFor()` (`AgentTeamNodeExecutor.kt:331-344`)
   constructs every team member's brain without one. A team node is precisely
   the fan-out the bucket exists for.
2. **Delegated children are unmetered.** `AgentBrainRunner.kt:546` passes eleven
   arguments to the child and `capacity` is not among it, so a parent metered by
   the bucket produces children that are not. Delegation depth is the multiplier.

The comment at `NodeExecutorRegistry.kt:63-65` says the agent path "matters MORE
than the plain LLM node here: an agent loop is where one run becomes twenty
provider calls, which is the multiplier §12.4 exists for." The team path — a
larger multiplier — is the one that was missed.

---

## H1 — WRONG KEY LEVEL — **PARTIAL**

**The bucket key matches the credential scope for the worker path, and does not
for the platform path.**

The key is `capacity:{workspaceId}:$provider:$model`
(`ProviderCapacityBucket.kt:285`).

**Worker path — key level is right by construction.** LLM credentials are
resolved from the `connections` table, which is workspace-scoped:
`workspace_id UUID NOT NULL` (`V001__initial_schema.sql:44-72`), with the key
held per-row and decrypted per call (`LlmNodeExecutor.kt:359-368`). There is **no
platform-key fallback in the worker** — a search for `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `platformKey`, `sharedCredential` and similar across
`apps/worker-kotlin/src/main` returns nothing. A workspace with no connection
cannot make a call at all.

**API path — a genuine shared credential with no bucket in front of it.**
`AppConfig.kt:174` resolves `AI_ARCHITECT_API_KEY ?: OPENAI_API_KEY` — one
platform key, used for every workspace's AI Architect session, in a process that
has no `ProviderCapacityBucket`. This is the mix the hypothesis describes, and it
is invisible to the worker's accounting.

**What is NOT determinable from the repository:** whether two workspaces have
stored the *same* API key in their own `connections` rows. Nothing prevents it —
there is no uniqueness constraint on the credential, and a customer with several
workspaces on one provider account is the normal case. If that is happening, a
per-workspace bucket cannot bound the aggregate, exactly as the hypothesis says:
N workspaces each at 90% of their own limit is 90N% of the account's.

That is answerable in production, but only if the ciphertext is deterministic or
a key fingerprint is stored. Neither is visible here, so the honest answer is:

```sql
-- How many workspaces per distinct LLM credential. Requires a stable
-- fingerprint of the secret; if encryption is randomised this returns
-- one row per connection and proves nothing.
SELECT provider, secret_ref, count(DISTINCT workspace_id) AS workspaces
  FROM connections
 WHERE type = 'llm' AND status = 'active'
 GROUP BY 1, 2
HAVING count(DISTINCT workspace_id) > 1
 ORDER BY workspaces DESC;
```

**Verdict: PARTIAL.** The worker's key level is correct for BYO credentials. One
real shared-credential path exists (AI Architect) and is entirely unmetered. The
"several workspaces, one customer account" case is plausible, unprevented, and
not answerable from the code.

---

## H2 — REQUESTS ARE NOT MODELLED — **CONFIRMED**

**The bucket models tokens per minute and nothing else.**

- The limit is named and parsed as tokens: `PROVIDER_TPM_DEFAULT`,
  `PROVIDER_TPM_OVERRIDES`, `"tokens per minute"`
  (`ProviderCapacityBucket.kt:138-170`).
- `reserve` takes `estimatedTokens` and the Lua arithmetic is entirely in tokens
  (`ProviderCapacityBucket.kt:317-375`).
- There is no request counter anywhere in the class.

The default is **1,000,000 tokens/minute**, with `burstFraction = 0.2` — so depth
is 200,000 tokens and refill is 800,000/minute. An agent iteration reserving
~4,000 tokens (measured below) can therefore issue **fifty concurrent calls**
before the bucket even notices, and sustain roughly 200 calls per minute. Every
mainstream provider's requests-per-minute ceiling on a standard tier is one to
two orders of magnitude below that.

This is the shape of an agent loop exactly: many small requests, few tokens each.
The token bucket reports healthy the entire time.

**Which limit are we actually hitting — not answerable from this repository, and
that is itself a finding.** The 429 handler reads exactly one header:

```kotlin
retryAfter = result.headers.entries
    .firstOrNull { it.key.lowercase() == "retry-after" }?.value?.firstOrNull()
```
— `LlmNodeExecutor.kt:847-857`

The response **body is discarded**, and so are every `x-ratelimit-*` header.
Providers state which limit was breached in both:

- OpenAI: `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, and a
  body message naming RPM or TPM.
- Anthropic: `anthropic-ratelimit-requests-remaining`,
  `anthropic-ratelimit-tokens-remaining`, `anthropic-ratelimit-*-reset`.

None of it is captured, logged or stored. The single most useful diagnostic for
this incident is being thrown away at the moment it arrives.

**Verdict: CONFIRMED.** Requests are not modelled. Whether RPM is the limit
being hit cannot be confirmed from our own telemetry — which is the first thing
to fix, because it is one line and it decides the priority of everything else.

---

## H3 — ESTIMATION ERROR — **CONFIRMED**

```kotlin
internal fun estimateTokens(messages: List<Map<String, Any>>, maxTokens: Int?): Long {
    val chars = messages.sumOf { (it["content"] as? String)?.length ?: 0 }
    return (chars / 4L) + (maxTokens ?: 1024).toLong()
}
```
— `LlmNodeExecutor.kt:1011-1014`

The method's own doc comment already concedes the point: "Four characters per
token … is wrong for code, for CJK and for anything heavily punctuated." It then
argues the estimate "only has to be the right ORDER for the few hundred
milliseconds a call is in flight". That argument holds for a *random* error. It
does not hold for a **systematic under-estimate**, which is what agent prompts
produce, because every concurrent caller is short by the same fraction in the
same direction and the shortfall compounds across the fan-out.

**Why agent prompts tokenize badly.** `AgentPromptBuilder.buildSystemPrompt`
serialises the entire tool catalogue into the prompt with
`mapper.writerWithDefaultPrettyPrinter()` (`AgentPromptBuilder.kt:63-66`) —
2-space-indented JSON, one field per line, every key quoted. Indentation runs,
braces, quotes and colons tokenize at close to one token per character. The
prompt is then dominated by this: the fixed prose scaffold is ~1.6k characters
and the tool block grows without bound.

**Measured composition, and the resulting error.** The exact character
composition of a realistically-shaped prompt, with published chars-per-token
figures applied per content class (prose 4.0; pretty-printed JSON 2.4–3.0):

| Prompt shape | chars | share JSON | estimate | actual | under-reserve |
|---|---:|---:|---:|---:|---:|
| prose only, no tools | 2 632 | 0% | 1 682 | 1 682 | 0% |
| 3 small tools, iteration 1 | 4 561 | 42% | 2 164 | 2 325 – 2 486 | 7 – 13% |
| 8 tools, iteration 1 | 9 696 | 73% | 3 448 | 4 036 – 4 625 | 15 – 25% |
| 8 tools, iteration 5 | 15 696 | 83% | 4 948 | 6 036 – 7 125 | 18 – 31% |
| 8 tools, iteration 12 | 27 696 | 91% | 7 948 | 10 036 – 12 125 | 21 – 34% |
| 20 tools, iteration 12 | 40 772 | 94% | 11 217 | 14 395 – 17 574 | **22 – 36%** |

This is a bound derived from measured composition, **not a tokenizer run** — no
tokenizer is available in this repository or on this machine.

Three things matter more than the exact percentage:

1. **The sign is always the same.** Every row under-reserves. Never over.
2. **The error grows with load.** It is smallest on a first iteration with few
   tools and largest at iteration 12 with a wide catalogue — the state a run is
   in when a fan-out is at full width.
3. **The settle does not rescue it.** The correction lands only when the response
   returns (`LlmNodeExecutor.kt:432+`). During the in-flight window every
   concurrent caller is short by the same 20–35%, and that window is exactly when
   the burst happens.

**The exact figure is computable in production**, and should be before anyone
tunes a constant. `run_spans.tokens_in` holds the provider's own count and the
prompt is in the payload store:

```sql
-- Estimated vs actual input tokens, as a distribution. Run over a day of
-- real agent calls. The estimate is reconstructible from the stored prompt;
-- tokens_in is what the provider charged.
SELECT width_bucket(s.tokens_in::numeric / NULLIF(est.estimated, 0), 0.5, 2.0, 15) AS bucket,
       count(*),
       min(s.tokens_in::numeric / NULLIF(est.estimated, 0)) AS ratio_lo,
       max(s.tokens_in::numeric / NULLIF(est.estimated, 0)) AS ratio_hi
  FROM run_spans s
  JOIN LATERAL (SELECT /* chars/4 + maxTokens, from the stored prompt */ 0 AS estimated) est ON true
 WHERE s.kind = 'llm_call' AND s.tokens_in IS NOT NULL
   AND s.created_at > now() - interval '1 day'
 GROUP BY 1 ORDER BY 1;
```

**Verdict: CONFIRMED**, in the dangerous direction, with the error concentrated
exactly where load is heaviest.

---

## H4 — BURST AND RESYNCHRONISATION — **CONFIRMED, and worse than stated**

### What converges at the start of an activation

| Source | Mechanism |
|---|---|
| Fan-out first calls | Every child of a team or delegation issues its first model call as soon as it is picked up. There is no stagger anywhere in the dispatch path. |
| Timer sweep | `TimerScheduler` polls every 15s and fires **up to 50 due timers in one loop** with no spacing (`TimerScheduler.kt:34, 120-123`). The 15s poll quantises every parked run onto a common grid. |
| Crash-recovery re-enqueue | Every 60s, up to 10 stale runs, `ORDER BY updated_at ASC` (`CrashRecoveryLoop.kt:33, 58`; `RunLeaseManager.kt:141-160`). |
| Resume after approval | `ResumeReconciler` sweeps parked runs in batches. |

### The throttle path is broken, and this is the core finding

Trace what happens after a 429:

1. `LlmNodeExecutor` catches it, returns `NodeResult.Throttled(provider, delayMs, …)`
   (`LlmNodeExecutor.kt:385-401`).
2. `RunProcessor` sets the run's status to **`"yielded"`** and schedules a timer
   at `now + retryAfterMs` (`RunProcessor.kt:985, 992-1005`).
3. `TimerScheduler.findDueTimers` selects only rows where
   **`ar.status = 'waiting_for_timer'`** (`TimerScheduler.kt:159`).

**Nothing in the codebase ever writes `status = 'waiting_for_timer'`.** Two
places read it — the timer's due query and `ResumeReconciler`'s fourth arm
(`ResumeReconciler.kt:320`) — and no code path sets it. So:

- **The throttle timer can never fire.** It is written, and it is dead.
- **`ResumeReconciler` does not cover it either.** Its sweep is
  `status IN ('waiting_for_approval','waiting_for_child','recovering','waiting_for_timer')`
  (`ResumeReconciler.kt:275`) — `yielded` is absent.
- **`PostgresClaim` would claim it** (`status IN ('queued','yielded')`,
  `PostgresClaim.kt:137`) — but `WORKER_CLAIM_MODE` defaults to `"redis"`
  (`WorkerConfig.kt:199`) and is set nowhere, so that path is off.

What actually resumes a throttled run is **`CrashRecoveryLoop`**, whose
`findStaleRuns` scans `status IN ('running','yielded')` for runs whose lease
expired more than 30 seconds ago. The consequences:

- **`Retry-After` is computed, logged, written to a timer row — and then
  ignored.** A `Retry-After: 60` and the 1000ms fallback produce identical
  behaviour: wait for lease expiry + 30s, then the next 60s recovery tick.
- **Runs come back in synchronised batches of ten**, ordered by `updated_at ASC`
  — which is the order they were throttled in. The batch reconstructs the burst.
- **A throttle storm is reported as crash recovery.** It logs
  `WARN "[recovery-loop] found N stale runs"` and increments
  `leaseExpiryTotal{cause="crash_recovery"}`. The metric that fires during a rate
  limit is the one that means "workers are dying".

### Is the retry delay jittered?

`ProviderThrottle` is well built in isolation: it parses both `Retry-After`
forms, and `exponentialWithJitter` uses full jitter with a correct explanation of
why partial jitter fails (`ProviderThrottle.kt:143-154`). Two defects stop it
mattering:

1. **`attempt` is hardcoded to 0** — `ProviderThrottle.decide(e.retryAfter, attempt = 0)`
   (`LlmNodeExecutor.kt:393`). The caller never tracks retry count. So
   `cap = BASE shl 0 = 1000`, and `Random.nextLong(1000, 1001)` returns
   **exactly 1000, always**. The jitter is arithmetically eliminated and the
   curve never escalates however many times a run is throttled.
2. **`Retry-After` is honoured exactly, with no jitter added.** All N callers
   receive the same header value and park to the same instant. Honouring the
   header precisely is what *creates* the rendezvous: the header is a floor, not
   a meeting time.

Both are moot today because the delay is discarded (above), but both would bite
the moment the resume path is fixed.

The bucket's own refusal has the same property: `retryAfterMs` is
`ceil(deficit * 60000 / refill)` (`ProviderCapacityBucket.kt:365-368`), fully
deterministic, so N callers refused at one instant with equal deficits all get
the same answer.

**Verdict: CONFIRMED.** Not merely "unjittered" — the delay is not applied at
all, and the mechanism that does resume these runs batches them.

---

## Also determined

### Does a 429 count toward the circuit breaker?

**No.** `ProviderThrottledException` is caught in its own branch
(`LlmNodeExecutor.kt:385`) which does not call `circuit.onFailure`. Only
`LlmCallException` does (`LlmNodeExecutor.kt:417`).

This is the correct half of the trade, and it is deliberate — the comment at
`LlmNodeExecutor.kt:844-846` says so. The cost the hypothesis predicts is real
but bounded: because the run parks rather than retrying in a loop, we do not burn
budget in a hot spin. What is missing is any **ceiling on re-throttling**. A run
can be throttled, recovered, throttled again without limit; nothing counts the
attempts (`attempt = 0` is hardcoded) and nothing escalates or gives up.

### Is there a preflight capacity check before a fan-out?

**No.** The budget preflight exists and is well-designed —
`BudgetLedger.preflightFanOut(parent, childCount, perChild)` is all-or-nothing
and is called before any child is created (`BudgetLedger.kt:396`;
`AgentBrainRunner.kt:1873`). There is **no capacity equivalent**.

The distinction matters: budget is a **total**, capacity is a **rate**. A fan-out
of twenty children can be entirely affordable in total tokens and still be twenty
simultaneous requests in one second. `preflightFanOut` would pass it. N children
then each discover the limit independently, which is precisely the pattern the
budget preflight was written to avoid — "discovering the ceiling at child four
has already spent it on three results nobody can use."

### What is the actual 429 rate, by workspace, by model, by hour?

**Not fully answerable, and the gaps are themselves findings.**

| Dimension | Available? |
|---|---|
| By provider | Yes — `provider_429_total{provider}` (`WorkerMetrics.kt:522-525`) |
| By workspace | Yes, from `run_events` — the throttle emits `NODE_FAILED` / status `throttled` (`LlmNodeExecutor.kt:395`), and `run_events` carries `workspace_id` and `created_at` |
| By hour | Yes, same source |
| **By model** | **No** — the throttle's `emitEvent` does not pass `modelName` (`LlmNodeExecutor.kt:395-397`; the parameter exists at `:1050` and is left default), so `run_events.model_name` is NULL on exactly these rows |
| **Which limit (RPM/TPM)** | **No** — headers and body discarded (H2) |

What can be run today:

```sql
-- 429s by workspace and hour. Model is NULL on these rows by construction.
SELECT date_trunc('hour', created_at) AS hour,
       workspace_id,
       count(*) AS throttles,
       count(DISTINCT run_id) AS runs
  FROM run_events
 WHERE type = 'NODE_FAILED' AND status = 'throttled'
   AND title LIKE 'Rate limited by %'          -- excludes our own bucket's refusals
   AND created_at > now() - interval '7 days'
 GROUP BY 1, 2
 ORDER BY throttles DESC;
```

`title LIKE 'Rate limited by %'` is what separates a provider 429 from the
bucket's own refusal ("Reached the … capacity limit") — they share an event type
and status, which is worth knowing before anyone reads the numbers.

**Is it one workspace or all of them?** That query answers it and has not been
run — this investigation had no production access. It should be the first thing
executed, because it decides whether H1's shared-credential path or H4's
batching is the dominant term.

---

## What actually causes this

In order of contribution, on the evidence available:

**1. There is no rate limiting in production at all.** The bucket is off
everywhere. Every provider call from every worker goes out unmetered. This is the
whole of the direct answer to "the capacity bucket is supposed to prevent exactly
this" — it is not running.

**2. The throttle recovery path amplifies rather than damps.** Independent of the
bucket, and active right now. A 429 parks a run at `yielded`; the timer that
would resume it can never fire because it selects a status no code writes; crash
recovery picks the run up 60–90 seconds later in a batch of ten, ordered by when
they were throttled. The provider's `Retry-After` never takes effect. Runs
throttled together come back together, and hit the same limit together. This
converts a transient limit into a standing oscillation, and it explains the
clustering directly.

**3. Activation start is a synchronised burst with nothing in front of it.** No
capacity preflight before a fan-out, no stagger in dispatch, and a 15-second
timer poll that quantises everything onto a shared grid. Every child discovers
the limit independently, at the same moment.

**4. Even switched on, the bucket would miss the paths that matter.**
`AGENT_TEAM` cannot be metered — the class takes no capacity argument — and
delegated children are constructed without one. The multi-agent fan-out, the
largest multiplier and the shape that produces the burst, is exactly what the
bucket cannot see.

**5. And it would be measuring the wrong quantity.** Tokens only, at a default of
1M/minute, which permits roughly 200 agent-sized requests per minute before it
engages. If the 429s are RPM-driven — plausible for an agent loop, unconfirmed
because we discard the evidence — the bucket would sit green through the entire
incident.

**6. With a systematic 20–35% under-reservation** on the prompts that matter,
concentrated at high tool counts and deep iterations.

Items 2 and 3 are live today. Items 4–6 are what would be found on the day
someone sets `PROVIDER_CAPACITY_ENABLED=true` and reports that it did not help.

---

## Recommended fix order

Ordered by evidence-per-unit-of-risk, not by severity. The first two are cheap
and unblock the diagnosis of everything else.

**1. Capture what the 429 actually says.** Log and store the response body and
the `x-ratelimit-*` / `anthropic-ratelimit-*` headers alongside `Retry-After`
(`LlmNodeExecutor.kt:847`). One structured field. Until this exists, every
statement about *which* limit we are hitting — including this document's — is
inference. Pass `modelName` to the throttle's `emitEvent` in the same change so
the per-model breakdown becomes queryable.

**2. Run the by-workspace/by-hour query above.** It costs nothing and it decides
whether this is one tenant on a shared credential (H1) or the whole fleet
oscillating (H4). Those have different fixes and the wrong one is wasted work.

**3. Fix the throttle resume path.** This is the highest-value change and it is
independent of the bucket. Either park throttled runs at `waiting_for_timer` so
the existing timer fires them, or add `yielded` to `ResumeReconciler`'s sweep
with a `fire_at` predicate. Then add jitter to the resume instant — including
when `Retry-After` supplied the delay, because honouring a common header exactly
is what synchronises the callers. **This touches the run status machine and the
resume path, which CLAUDE.md puts on the stop-and-ask list — it needs a decision,
not a patch.**

**4. Track the retry attempt.** `ProviderThrottle.decide(header, attempt = 0)` is
hardcoded; carry the real count so the exponential curve and its jitter engage at
all. Today the fallback is a constant 1000ms with zero jitter. Cheap, and
pointless before (3).

**5. Wire the bucket into the paths it misses.** Add a `capacity` parameter to
`AgentTeamNodeExecutor` and pass it in `brainFor`; pass `capacity` to the
delegated child at `AgentBrainRunner.kt:546`. Small diffs. Worth doing before
enabling the flag, or the first production test will be measured against a
half-connected bucket.

**6. Model requests as well as tokens.** A second dimension in the same bucket —
the Lua already refills and reserves; it needs one more counter pair and an
`RPM` limit. Do this only after (1) has confirmed RPM is what we are hitting.

**7. Add a capacity preflight to the fan-out**, beside the existing budget
preflight, so N children do not each discover the limit independently. Same
all-or-nothing shape, same call site (`AgentBrainRunner.kt:1873`).

**8. Improve the estimator last.** A per-provider tokenizer, or simply a lower
chars-per-token divisor for JSON-heavy content. It is the smallest term and the
easiest to over-tune; do it once real estimated-vs-actual data exists from (1).

A note on ordering: enabling `PROVIDER_CAPACITY_ENABLED` is **not** step one.
With the resume path broken (3), a bucket refusal parks the run the same way a
429 does, into the same batching recovery — so switching it on today would move
the oscillation earlier without removing it, and would do so on only two of the
four agent paths.
