# Result delivery

Getting the answer to where it needs to go.

An agent that cannot deliver its result has done nothing. Companion to
`docs/INGRESS.md` (how work gets in) and `docs/HTTP-TOOLS.md` (the tools a
destination is built from).

---

## 1. Three shapes, and conflating them is the mistake

| | What it is | Where it lives |
|---|---|---|
| **Awaiting caller** | Someone blocked on a function call | Already solved — `docs/INGRESS.md` §4 |
| **Callback** | The run finishes and we call their endpoint | `delivery_targets.kind = 'callback'` |
| **Destination** | We push the result somewhere: storage, Slack, a queue | `delivery_targets.kind = 'destination'` |

**A blocked caller is not a delivery target, and giving it a row would be a
bug.** Sync and stream modes hand the result back on the call. Modelling that as
a destination would attach a retry policy, a dead-letter queue and a redelivery
button to a connection that closed the moment it got its answer — producing a
permanently-failing delivery for every synchronous call in the product.

---

## 2. Destinations are tools

A destination row points at a `tools` row. That is the entire design.

A Slack destination *is* the Slack HTTP tool — it arrives with a connection, an
encrypted credential, an approval policy, an audit trail and a result contract.
A parallel "destinations" subsystem would need its own version of every one of
those, and would get the credential handling wrong first.

What is genuinely new, and the only reason these tables exist, is **when**
delivery happens: after the run is terminal. It cannot use the run's retry,
because the run is over. It cannot fail the run, because the run succeeded. And
it must not be invisible.

---

## 3. Delivery is not part of the run's lifecycle

```
run terminal ──▶ INSERT run_deliveries ──▶ (dispatcher) attempt ──▶ ack/backoff/DLQ
   (CAS)            cheap, exactly once        its own loop
```

`onTerminalTransition` does one cheap thing: insert a row. It does not deliver.
That function is on the worker's completion path and has a documented deadlock
history around holding connections; putting somebody else's HTTP on it — with an
hours-long retry schedule attached — would hold a worker on a stranger's
availability.

**Why a loop rather than queue jobs.** A delivery's retry schedule is hours long
and survives restarts. As a queue message that means either holding a message
invisible for an hour (which every broker treats as a stuck consumer) or
re-enqueueing with a delay (which loses the attempt history that makes a DLQ
useful). The row *is* the schedule; `next_attempt_at` is durable.

**Enqueue is guarded twice.** The status CAS makes `onTerminalTransition` run
once; `ON CONFLICT (run_id, target_id, sequence)` makes a duplicate impossible
anyway. The CAS is a runtime property a refactor could weaken; a unique
constraint is not.

---

## 4. The idempotency key is derived

```kotlin
RunDelivery.keyFor(runId, targetId, sequence)   // SHA-256 → "dlv_" + 40 hex
```

Same material every time. So the fifteenth retry and an operator's redelivery
six hours later carry the key the first attempt carried, and a receiver storing
keys it has seen refuses every copy after the first.

A key generated per attempt would make every retry look like a new event — which
is exactly what the header exists to prevent, and it would be invisible from our
side because our logs would say "delivered". Same derivation discipline as
`SideEffectGuard.keyFor` and `RunWait.keyFor` (invariant 2): no timestamps, no
attempt counters, no random ids.

`Vectorbea-Attempt` carries the attempt number instead, so a receiver can tell a
retry from news without the key having to change.

---

## 5. Signing

```
Vectorbea-Signature: t=<unix>,v1=<hex hmac-sha256>
signed material:     "<t>.<body>"
```

The scheme is Stripe's, not a sixth invention — it is the one that was easiest
to verify correctly when we were on the receiving side (`SignatureVerifier`,
V066). The timestamp is **inside** the signed material, which is what makes a
freshness check meaningful: a forged `t` invalidates the signature, so rejecting
old timestamps rejects replays rather than trusting a header the attacker
controls.

`v1=` may appear several times. During a secret rotation both secrets sign, so a
receiver that has deployed either keeps working — a rotation that dropped
deliveries for the length of a rollout is a rotation nobody performs twice.

**Verifying it, in Node:**

```ts
import express from "express";
import { verifyDelivery } from "@vectorbea-ai/node";

app.post(
  "/vectorbea",
  express.raw({ type: "application/json" }),   // raw, not json
  async (req, res) => {
    let delivery;
    try {
      delivery = verifyDelivery(req.body, req.headers, process.env.VECTORBEA_SIGNING_SECRET!);
    } catch {
      return res.status(401).json({ error: "bad signature" });
    }

    if (await alreadySeen(delivery.idempotencyKey)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    await remember(delivery.idempotencyKey);

    const output = delivery.payloadMode === "url"
      ? await fetch(delivery.outputUrl!).then((r) => r.json())
      : delivery.output;

    await handleResult(delivery.runId, output);
    res.status(200).json({ ok: true });
  },
);
```

**`express.raw`, not `express.json`.** The signature is over the exact bytes;
`JSON.parse` then `JSON.stringify` reorders keys and drops whitespace, the digest
changes, and every delivery fails — which reads as "wrong secret" and sends
somebody rotating credentials that were fine.

**The example is executed, not described.**
`apps/web/__tests__/delivery-signature.test.ts` and `DeliverySignerTest.kt` pin
the same secret, the same body and the same signed material. Two implementations
of one scheme drift silently — the sender keeps working, the receiver keeps
rejecting — so a change to either fails a test rather than a customer.

---

## 6. Retry, and what a status code means

| Response | Verdict | Why |
|---|---|---|
| 2xx | delivered | |
| 408, 429 | retry | They explicitly said "later" |
| other 4xx | **dead immediately** | It will be a 400 on the eighth attempt too |
| 5xx | retry | Their outage, not their contract |
| timeout, connection error | retry | Transient from here |

Backoff is exponential from 15s, capped at an hour, with **full jitter**. Two
hundred runs finishing together create two hundred deliveries in the same second;
without jitter every retry fires simultaneously at every step, which is how a
receiver that was recovering goes back down. Equal jitter halves the spread and
still leaves a synchronised floor — and the floor is what a recovering receiver
feels.

**Redirects are never followed.** A 302 on a callback is a request to send a
customer's result, signed with their secret, to a host they did not configure —
and the signature would make it look authentic to whoever receives it.

---

## 7. The dead-letter queue is this table

`status = 'dead'` is the DLQ. `GET /api/deliveries?status=dead` is the operator's
view, and redelivery is an UPDATE on the row that is already there.

A separate dead-letter table would copy the target, the payload shape, the
attempt count and the error chain on the way in, and join them back on the way
out. That join is the bug — the symptom is a redelivery that sends the wrong
payload to the right endpoint, and it only appears once a workspace has more than
one target.

`dead_letters` (V022) stays what it is: poison **queue** messages that crashed a
worker. "Their endpoint returned 500" is not that, and the operator workflow is
different.

**Redelivery resets the attempt count and keeps the key.** The count resets
because an operator pressing the button is making a new decision, usually after
fixing the receiver, and inheriting eight spent attempts would give them one try.
The key does not, because the receiver's dedupe has to see this as the same event.

---

## 8. Delivery status is part of the run

`agent_runs.delivery_status`: `none` | `pending` | `delivered` | `partial` |
`failed`.

**A column, not a join**, because "which of my runs did not deliver" is asked by
a *list*, and a list that needs a per-row aggregate to colour a badge will not do
it.

**Not folded into `status`.** A run that produced the right answer and could not
deliver it did not fail: its output is correct, its cost was real, and retrying
the RUN would re-execute every side effect. It is a successful run with an
undelivered result, and two facts need two columns.

`partial` covers "some landed, some did not" — *including* while others are still
retrying. A run with one dead delivery is already not fully delivered, and calling
it `pending` until the last retry gives up would hide the failure for the length
of the backoff.

In the UI: an `Undelivered` mark beside the status badge in the runs list, and a
panel on the run under the header. Nothing is shown when everything delivered —
a green tick on every row is noise that makes the failing ones harder to find.

On the timeline: `DELIVERY_SUCCEEDED`, `DELIVERY_FAILED`, `DELIVERY_DEAD`.
`DELIVERY_DEAD` is in `RunEventStore`'s never-dropped set, because the run
already said SUCCEEDED and this is the only record that the customer never got
their result.

---

## 9. Large results

`payload_mode` is `full` | `url` | `auto`, and `auto` is the only generally
correct one. Forcing `full` at a receiver with a body limit turns a large result
into a permanent delivery failure; forcing `url` makes every small result an
extra round trip for somebody who only wanted the answer.

Over the target's limit, the output goes to `delivery_payload_links` and the
envelope carries `outputUrl` instead of `output`. **The envelope always says
which** — `payloadMode` is present on every delivery, including the ordinary
case, because a field that only appears when something unusual happened is a
field nobody handles.

The link token is **random, not derived** — unlike the idempotency key. A key
must be reproducible so a retry carries the same one; a link is a bearer
credential, and a derived one would be recomputable by anyone who learned the
derivation and the run id. It expires in 7 days, counts its reads, and is deleted
rather than filtered (invariant 10).

Not the payload store's content-addressed ref, either: two runs producing
identical output share a ref, so a link to one would be a link to every run that
produced the same answer.

---

## 10. Streaming partials

A six-hour pipeline that emits nothing until it finishes is indistinguishable
from one that is stuck, and the customer cannot start on the first half of a
result they will not see for hours.

`stream_partials` on a target emits each named node's output as it commits.
Sequence 0 is the final delivery; partials are 1..n in the node's graph position
— **stable across re-execution**, because the idempotency key is derived from it
and a shifting sequence would show a receiver the same partial twice under two
keys.

A partial carries its own content: `agent_runs.output_json` is still null while
the run is going, so reading the run would deliver an empty body that looks like
a node producing nothing rather than like a bug.

---

## 11. Rules for changing this

- **The idempotency key derivation is stop-and-ask.** It is what a receiver
  deduplicates on, and getting it wrong produces duplicate side effects in
  somebody else's system where we cannot see them.
- **Delivery never changes the run's `status`.** Two facts, two columns.
- **Enqueue in `onTerminalTransition`; deliver nowhere near it.**
- **Never follow a redirect on a callback.**
- **A 4xx that is not 408 or 429 is dead on the first attempt.** Retrying a
  permanent rejection spreads eight identical refusals over an hour and delays
  the moment somebody learns their payload does not match the contract.
- **A change to the signature scheme changes two test files**, in two languages,
  by design. If only one fails, the drift already happened.

---

## 12. Configuration

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_API_BASE_URL` | unset | Origin for payload links. Unset yields a relative path rather than a confidently wrong absolute one |

Per-target: `max_attempts` (1–20), `timeout_ms` (1–120s), `payload_mode`,
`max_payload_bytes`, `on_statuses`, `stream_partials`.
