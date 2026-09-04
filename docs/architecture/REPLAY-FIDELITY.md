# Replay fidelity: what `_sanitized` actually removes

Answering §4.2 of `09-EXECUTION-ARCHITECTURE-REVISED.md`. The question is whether
sanitisation is lossy, because if it is, "Replay any run" is a claim the system
cannot honour.

---

## The finding

**The `_sanitized` suffix on payload columns is a naming convention. No
sanitisation happens on those columns at all.**

That is not what I expected to find, and it changes the answer.

### Step outputs are written raw

`StepOutputStore.save` — the only writer of `step_outputs`:

```kotlin
val rawJson       = rawOutput?.let       { toJson(it) }
val extractedJson = extractedOutput?.let { toJson(it) }
val validatedJson = validatedOutput?.let { toJson(it) }
…
setJsonb(stmt, 7, rawJson)   // -> raw_output_json_sanitized
setJsonb(stmt, 8, extractedJson)
setJsonb(stmt, 9, validatedJson)
```

`toJson` and nothing else. No redaction, no truncation, no transformation. The
column is called `raw_output_json_sanitized` and contains the raw output.

### Event payloads are the caller's problem

`RunEventStore`'s own contract:

```kotlin
 * must already be sanitized by the caller — this class stores them as-is.
…
        /** Must be sanitized — no secrets, no raw error details */
        val metadataJsonSanitized: String? = null,
```

The store applies nothing. Callers pass literal strings they construct
themselves. Whether any given event payload is sanitised depends entirely on
which call site wrote it.

### There IS a real sanitiser, and it is lossy — but not here

`RecoverySanitizer` is genuinely lossy and irreversible:

```kotlin
private const val MAX_MESSAGE_LEN = 2000
private const val MAX_LOG_LINES = 20
private const val MAX_LOG_LINE_LEN = 500
private const val MAX_METADATA_ENTRIES = 50
…
Regex("""sk-[A-Za-z0-9]{20,}""") to "[REDACTED-API-KEY]",
```

Truncation and `[REDACTED]` replacement — no way back. But it is applied to
`WorkerRecoveryService` and `DiagnosticBundleBuilder`: **error messages, logs and
diagnostic metadata**. It never touches `step_outputs`, `run_events` payloads, or
`model_calls`.

So the lossy sanitiser runs over diagnostics, and the replay substrate is
untouched.

---

## The decision: option (a), lossless — and the promise is kept

§4.2 offers three. I chose the first: **sanitisation is not lossy on the replay
path, because on the replay path it does not happen.**

This is not a paper argument. The byte-identical acceptance test
(`scripts/load/replay-acceptance.mjs`) executes a run, replays it, and compares
every node's stored output:

```
original: 10 nodes, 8 provider calls, 1c, 960 tokens
replay:   10 nodes, 0 provider calls, 0c, 0 tokens

PASS  byte-identical output at every node — 10 nodes, 0 diverged
PASS  zero provider calls during replay
PASS  zero side effects during replay
PASS  zero cost
```

Option (b) — an unsanitised store with 7-day retention and workspace-scoped
encryption — would have been the right answer if sanitisation were destroying
data. It is not, and building a parallel encrypted store to recover data that was
never lost would add a key-management surface, a retention cliff, and a second
source of truth, in exchange for nothing.

Option (c) — rename to "Inspect" — was the right answer *before* the replay work
in the previous stage, when replay re-executed everything. It is the wrong answer
now: the system genuinely reproduces runs, and renaming would understate a
capability that measurably works.

### The caveat, stated rather than buried

Replay is byte-identical **for workflows that do not observe the clock**. The
determinism journal (`recorded_values`) is built and read but nothing writes to
it yet — a workflow stamping `Instant.now()` into its output would still diverge.
That is [D20](TECH-DEBT.md), and it is the gap between "replay works" and "replay
always works". The UI copy below is written to be true of what ships today.

---

## The real defect this investigation found

The columns are named `_sanitized` and are **not sanitised**. That is worse than a
replay problem — it is a security misreading waiting to happen.

A developer who sees `output_json_sanitized` reasonably concludes the content is
safe to expose in a support tool, an export, or a log line. It is not: it holds
whatever the workflow produced, which may include anything the workflow touched.

Two things follow, and only the first is done here:

1. **Documented.** `COMMENT ON COLUMN` on the affected columns states plainly that
   the suffix is historical and the content is unredacted. A developer who checks
   now gets the truth from the schema.
2. **Not renamed.** `raw_output_json_sanitized` → `raw_output_json` is the honest
   fix and it touches the worker, the API, three repositories and the ERD. That is
   its own change with its own review, not a rider on a six-gap migration.
   Recorded as [D24](TECH-DEBT.md).

---

## UI copy changed as a result

The mismatch §4.2 objects to is the promise, not the limitation. The promise is
now true, so the copy states what is true rather than being softened.

| Surface | Before | After |
|---|---|---|
| Run recovery panel | one button, "Resume from checkpoint", beside a "Replay available" claim the backend did not honour | three controls: **Replay** ("No provider calls. No side effects. No cost."), **Retry from checkpoint**, **Re-run** ("Calls every provider again. Full cost. Every side effect fires again — including emails.") |
| Replay control, run with a recording | — | badge: "N recorded calls" — the count is why "no cost" is credible |
| Replay control, run without one | offered regardless | disabled: "This run has no recorded model calls, so it cannot be replayed. Runs from before call recording was enabled are not replayable." |
| Re-run confirmation | none | "This sends any emails, webhooks and database writes in the workflow a second time. To inspect what happened without side effects, use Replay." |
| Step inspector | "Replay safe: Yes/No" | unchanged in meaning, now backed by `model_calls` |

The landing page's "Replay any run" is now accurate for runs recorded after
`model_calls` shipped, and the API refuses with a `422` explaining why for runs
recorded before it — which is the honest version of "any".

Implementation: `apps/web/components/runs/RunOperations.tsx`.
