# Tool result contracts

What a tool gives back to a model, declared by the tool and applied server-side
before the observation cap.

---

## 1. The measurement, first

The brief asked for this before building, and it changed one thing about the
design — see §1.3.

### 1.1 What was measured, and what could not be

**No production sample was available.** The local database has zero rows in
`run_spans(kind='tool_call')`, `agent_iterations` and
`run_events(type='TOOL_CALL_COMPLETED')`, and its forty `tools` rows are test
fixtures named `gated`. Nothing in this repository records a real tool call.

So what was measured is the **cap's behaviour against representative response
shapes**, run through the real production path rather than a model of it:
`HttpNodeExecutor`'s output map (`statusCode` / `body` / `headers`), serialised by
Jackson exactly as `renderToolPayload` does, then through
`AgentSafetyGuard.sanitizeToolOutput` at the production `MAX_TOOL_PAYLOAD_CHARS`
of 2000. The responses are built to the documented shapes of the APIs these tools
call — a CRM contact, a paged search, a payment object, a SQL row set.

`ObservationSizeReport` is that measurement, and it asserts its own findings so
the numbers quoted below fail rather than rot.

### 1.2 The numbers

| tool result | raw chars | obs chars | tokens | truncated | parses |
|---|---:|---:|---:|:--:|:--:|
| small ack (3 fields) | 99 | 462 | 171 | no | yes |
| CRM contact (1 record, 56 fields) | 1 788 | 2 107 | 693 | **YES** | **NO** |
| CRM search (5 of 47) | 8 866 | 2 107 | 678 | **YES** | **NO** |
| CRM search (25 of 47) | 43 742 | 2 108 | 678 | **YES** | **NO** |
| payment object (nested) | 1 391 | 1 754 | 538 | no | yes |
| SQL rows (10) | 2 014 | 2 107 | 780 | **YES** | **NO** |
| SQL rows (50) | 9 854 | 2 108 | 779 | **YES** | **NO** |
| SQL rows (200) | 39 356 | 2 108 | 779 | **YES** | **NO** |

**Truncated: 6 of 8. Unparseable after the cap: 6 of 8. Median observation: 693
tokens.**

Where the budget goes, on one CRM record:

- the whole record is 1 749 chars;
- the ten fields an agent actually wants are **300 chars — 17% of it**;
- response headers are **365 chars, 18% of the entire observation budget**, and
  no model has ever read `strict-transport-security`;
- **~1 of 47 records fits**, and the last one is cut mid-field. Projected, ~6
  would fit.

### 1.3 What this changed about the design

Two things.

**Truncation is not rare, so the priority stands.** The brief said to report
before building and change course if truncation were uncommon. It is not: a
single 56-field record does not fit, and a SQL query returning ten rows does not
fit.

**But size was the wrong headline.** The damaging finding is that **every
truncated observation is invalid JSON**. A model handed a broken fragment does not
receive less information — it receives a syntax error it has to guess its way
around, and it cannot tell that the list it saw was cut. That reframed the work:
the fix is not a bigger cap, it is projecting *before* the cap so the thing being
cut is already small, flat, and rarely cut at all.

It also promoted the error contract. If the model is spending iterations
recovering from unreadable observations, it is spending them the same way on
`HTTP 403`.

### 1.4 The behavioural signal, from production

The fourth measurement the brief asked for — how often the model's next action
suggests it did not get what it needed — needs real runs. It is now recordable:
`agent_iterations` carries `iteration_number`, `action_type`, `selected_tool_id`,
`observation_success` and `action_json_sanitized`, and V056 adds
`observation_projected`, `observation_truncated` and `observation_chars`.

```sql
-- Consecutive calls to the SAME tool: the model asking again because the last
-- answer was not usable. Split by whether the tool declares a contract.
WITH steps AS (
  SELECT i.*, lag(i.selected_tool_id) OVER w AS prev_tool,
         lag(i.action_json_sanitized) OVER w AS prev_input
    FROM agent_iterations i
   WHERE i.action_type = 'CALL_TOOL'
  WINDOW w AS (PARTITION BY i.run_id, i.step_id ORDER BY i.iteration_number)
)
SELECT t.result_contract_json IS NOT NULL AS contracted,
       count(*)                                                   AS tool_calls,
       count(*) FILTER (WHERE selected_tool_id = prev_tool)        AS repeat_calls,
       count(*) FILTER (WHERE selected_tool_id = prev_tool
                          AND action_json_sanitized IS DISTINCT FROM prev_input)
                                                                   AS reformulations,
       round(100.0 * count(*) FILTER (WHERE selected_tool_id = prev_tool)
             / NULLIF(count(*), 0), 1)                             AS repeat_pct
  FROM steps s LEFT JOIN tools t ON t.id = s.selected_tool_id
 WHERE s.created_at > now() - interval '7 days'
 GROUP BY 1;
```

Observation size and truncation are in the `agent_observation_sizes` view (V056),
already split by whether the tool has a contract. That view **is** the
before/after, on real traffic, from the day contracts start being adopted.

---

## 2. What was built

### 2.1 The contract

Declared per tool in `tools.result_contract_json` (V056), so it versions with the
tool: a tool whose endpoint moves to a new API version gets a new projection in
the same edit. A separate table would be a second thing to keep in step, and its
failure mode — a projection describing a shape the tool no longer returns — is
silent and produces empty observations.

```json
{
  "version": 1,
  "usage": "Use to find contacts by company or title. For one known contact, use crm.get by id.",
  "collection": {
    "path": "body.records",
    "totalPath": "body.totalSize",
    "sample": 5,
    "moreHint": "Add a narrower `where` clause; this tool does not page."
  },
  "fields": [
    {"path": "body.Id",    "as": "id",    "desc": "Contact record id"},
    {"path": "body.Name",  "as": "name",  "desc": "Full display name"},
    {"path": "body.Email", "as": "email", "desc": "Primary email"}
  ],
  "errors": [
    {"status": 403, "kind": "auth", "retryable": false,
     "fix": "Reconnect the Salesforce credential in Connections."}
  ]
}
```

### 2.2 Projection happens before the cap

`ResultProjection.project` runs between the tool result and the prompt. The
**full** result still goes to the payload store first — the debugger keeps
everything. Two consumers, two limits; conflating them is what made the cap
destructive.

The collection summary is written **first** in the object, deliberately: Jackson
preserves insertion order, so if a projected observation is ever capped anyway,
the count and the "showing N of M" survive. Those are the two facts whose absence
makes a model answer confidently about a list it only half saw.

**A search and a lookup share one contract.** When the collection path is absent
the response is a single record, and the declared fields describe an element, so
they are applied to the root. This was missing in the first implementation and
`ResultContractTest` caught it: a single-record response went 696 tokens before
and 696 after, completely unimproved, silently.

**A contract that matches nothing falls back to the whole result.** An API renames
a field, the projection produces `{}`, and the model reads that as "the tool found
nothing" — silent, confident, and wrong in the direction of doing nothing.
Returning everything is worse for tokens and much better for correctness.

### 2.3 Error contracts

`ToolErrorShape` maps a failure to `kind`, `retryable`, what failed, and what
would fix it. The observation is prose, not JSON: the instruction "do not retry"
has to be unmissable, and a model skimming `{"retryable": false}` inside a wrapper
reliably retries anyway.

**The HTTP defaults are the contract for most tools.** A tool declaring no error
rules still gets a correct classification from status semantics — 401/403 auth and
not retryable, 404 not found, 400/422 invalid input, 429 rate limit and
retryable, 5xx server and retryable. A tool declares rules to *override* that (a
vendor returning 403 when throttled), not to obtain the obvious. The error half is
useful on day one, which is what makes it adopted.

**Unknown defaults to not retryable.** Not retrying something that would have
worked costs one opportunity; retrying something that never will costs the whole
iteration budget.

A **non-2xx that arrives as `Completed`** is handled too. HTTP tools return 404
and 403 as completed results rather than failing the node — a 404 is a legitimate
answer to a lookup — so the model was being handed `{"statusCode":403, ...}` and
left to work out it had been refused.

### 2.4 Tool descriptions carry usage guidance

`whenToUse` and `returns` go into the system prompt beside the input schema, from
the contract. A name, a sentence and a schema tell a model *how* to call a tool
and nothing about *when*, or about what it will get back — so it picks by name,
calls to find out, and spends another iteration deciding which of forty opaque
fields it wanted. Sent once with the description rather than repeated in every
observation.

### 2.5 The contract's summary can also be the observation SUMMARY

Behind `AGENT_RESULT_SUMMARY_ENABLED`, default **off**.

The projection already writes `count`, `showing` and `more` before anything else,
so that they survive the cap (§2.2). The observation *summary* — the one-line
description stored on the iteration and shown in the timeline — did not use them:
it read `Tool returned 3 field(s): items, count, nextPage`, which describes the
envelope rather than the answer.

With the flag on, `buildToolObservationSummary` reads the projection's own
counts instead:

| Projection | Summary |
|---|---|
| `count: 47, showing: 5` | `Returned 47 results, showing 5.` |
| `count: 5, showing: 5` | `Returned 5 results.` |
| `count: 0` | `Returned no results.` |
| `count: 5` with `countIs` (no total reported) | `Returned at least 5 results, showing 5.` |
| no collection in the contract | unchanged — a single record has no count, and "returned 1 result" is a worse sentence than naming its fields |

This is what the Debug tab's Activity view puts in front of somebody who has
never heard of an iteration
([AGENT-TRACE-AND-DEBUGGER.md §5.5](./AGENT-TRACE-AND-DEBUGGER.md)).

**Default off because this string is not only a display.** It goes into the
observation history the next prompt is built from, and into the transcript a
resumed run reads back. Better prose ought to be an improvement to how the model
reasons, but "ought to" is not how a prompt change ships here. Off, the summary
is byte-for-byte what it was.

The cached-result path deliberately does not re-project: it replays a stored raw
result, and loading the contract on the one path whose purpose is not to do work
again would be the wrong trade. The first execution's row already recorded the
summary.

The Activity view reads the summary either way — it drops the
`Tool returned N field(s)` shape sentence rather than rendering it, so with the
flag off a row simply has one honest line instead of two.

### 2.6 A tool without a contract is unchanged

`null` is not a degraded contract. The tool behaves exactly as before, whole
result and all, and `ResultContractTest` asserts the serialisation is
byte-identical. Nothing breaks on the deploy that ships this.

---

## 3. Acceptance

| Criterion | Result |
|---|---|
| Median observation tokens fall materially | **681 → 361, a 47% reduction** |
| Truncation on contracted tools below 5% | **0 of 6** (from 5 of 6 uncontracted) |
| Iterations-to-completion falls | **8 (never answered) → 2** |
| An auth error stops rather than retries | asserted on the observation text and on behaviour |

The token bound in `ResultContractTest` is set at 40%, below the measured 47%, on
purpose: it is a regression guard, not a target. The remaining 361 tokens are five
projected records at ~70 tokens each — what the contract asked for. Getting under
half would mean sampling three records instead of five, which is the tool author's
judgement about their API, not a number to bend so an assertion reads better.

**On the iterations measurement.** A fixed script cannot measure this: it produces
the same count whether the observation held the answer or a broken fragment. The
simulated agent reads the observation and answers when the value it wants is
present and parseable. It is deliberately generous to the uncontracted arm — a
real model also misreads noise it *can* parse, and sometimes answers wrongly from
a fragment rather than retrying — so the measured improvement is a **lower
bound**. What it does not measure is whether a real model's answer is *correct*;
that needs an eval harness and real models. This measures the mechanism: is the
answer present, in a form that can be read.

---

## 4. Adopting a contract

1. Call the tool once and look at the full result in the Debug tab — the payload
   store has it whole, contract or not.
2. Pick the fields an agent would actually use. Ten is a lot; three is common.
3. Write `usage` as the answer to "when would I use this rather than the other
   one". This is the cheapest quality lever in the loop.
4. Declare `collection` if the tool returns a list, with `totalPath` if the API
   reports a real total. Without it the summary says the count is this page only,
   rather than claiming a total it inferred.
5. Add `errors` only where the vendor departs from HTTP semantics.
6. Watch `agent_observation_sizes` for that tool.

A malformed contract logs once and falls back. It never fails a tool call: a
contract is an improvement to an observation, and an improvement that can break
the thing it improves is not one.
