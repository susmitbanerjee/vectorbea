# Ingress

How work gets into Vectorbea: five doors, one admission path.

Companion to `docs/AGENT-HARNESS-ARCHITECTURE.md` (what happens after a run
exists), `docs/PLANS-AND-ENTITLEMENTS.md` (the limits every door enforces) and
`docs/WAITS-AND-SIGNALS.md` (how a run takes input after it has started).

---

## 1. The problem this solves

There were two ways to start a run and they had already diverged.

`RunRoutes.triggerRun` did: rate limit → plan quota → workspace quota → member
spend → admission → create → attribute → meter → events → enqueue.

`WorkflowScheduler.fire` did: create → events → enqueue.

Everything missing from the second list is a plan check. An account with a spent
quota kept running its crons, for free, and nothing metered them. That was not a
decision anybody made — it is what happens when the admission sequence lives
inside a route handler, because the second caller cannot reuse it and
reimplements the parts it remembers.

Adding webhook, event and MCP ingress to that shape would have produced five
copies and five different subsets of the checks.

---

## 2. `RunIngress` is the only way a run starts

```
                 API ─┐
             webhook ─┤
            schedule ─┼──▶ RunIngress.start() ──▶ agent_runs + queue
               event ─┤
                 MCP ─┘
```

Every route is now an adapter that says WHO is asking and WHAT for. Invariant 9
applied to ingress: a new way to start a run is a caller of this, never a second
copy of it.

### 2.1 The order is load-bearing

| # | Step | Why here |
|---|---|---|
| 1 | Idempotency claim | So the whole rest of the sequence is inside the guarded window |
| 2 | Rate limit | "You are asking too fast" is fixable in the next second; "you are out of runs" is not |
| 3 | Plan quota | An account fact, more specific than a queue fact |
| 4 | Fair placement | Exactly once per run, before the row exists |
| 5 | Admission | The only check whose answer changes millisecond to millisecond |
| 6 | Create, attribute, meter | |
| 7 | Enqueue | |

**Every refusal releases the claim.** A run that was refused did not happen, so
its idempotency key must be usable again — otherwise a client refused for quota
upgrades their plan, retries with the same key, and is told it is a duplicate of
a run that never existed.

### 2.2 The trigger attribute is the only difference

A run started by webhook and the same run started by API differ in
`agent_runs.trigger_type` and nothing else. `IngressAcceptanceTest` asserts it by
reading the rows back and requiring the set of shapes to have exactly one
element. Anything that made one ingress structurally different would give the
trace two shapes and every downstream reader two cases.

`trigger_ref` carries the webhook, schedule or event trigger that produced the
run — a breadcrumb for "why did this start", not a foreign key, because a
foreign key would make deleting a webhook delete history.

---

## 3. Idempotent run creation

The old implementation was a Redis `GET` and, ~200 lines later, a `SETEX`. Three
ways that started a second run:

1. **GET-then-SET is not atomic.** Two concurrent POSTs with the same key both
   miss and both create a run — which is the normal shape of a client retrying a
   timeout, where the first request is still in flight.
2. **The record happened after the enqueue**, so the entire admission sequence
   was unguarded. The retry lands inside that window by construction.
3. **Redis is optional here.** With it down the check silently did nothing, so
   the guarantee disappeared during exactly the incident producing the retries.

Now: `run_idempotency_keys`, claimed with `INSERT … ON CONFLICT DO NOTHING`
before anything else. The winner creates the run; the loser reads back the run
id. A key reused with a **different request** is a 409 — returning the first run
silently would tell a caller their second request happened when it did not.

---

## 4. Three response modes

| Mode | Returns | For |
|---|---|---|
| `async` | 202 and a run id. The default. | Anything that takes minutes |
| `sync` | The result, or 202 with the id past the deadline | Somebody awaiting a function call |
| `stream` | SSE of events and the final result | Somebody watching |

**Sync degrades, it does not hang.** Past its deadline it returns the run id
exactly as async would, and the caller has lost nothing — they hold the same id
and every other endpoint works on it. Hanging instead would burn one of their
connection-pool slots and one of ours until a proxy killed it, which is how a
slow workflow becomes an outage in a caller's unrelated service. The ceiling is
55 seconds because proxies idle out around 60 and a limit above that produces a
dropped connection rather than a clean 202.

**Stream is chosen by `Accept: text/event-stream` or `?mode=stream`,** not by the
body. The router picks the SSE handler before the body is read, so the body
cannot select it; a `mode` in the body says so rather than silently sending JSON.

---

## 5. Webhook triggers

`POST /api/hooks/:token` — public, because a webhook sender has no session and
never will. The 32-byte token addresses one endpoint and the signature over the
raw body authenticates the sender.

### 5.1 Signatures are per sender, and the differences matter

| Sender | Signs | Encoding |
|---|---|---|
| GitHub | the raw body | hex, `sha256=` prefixed |
| Stripe | `"$timestamp.$body"` | hex, several `v1=` during a rotation |
| Slack | `"v0:$timestamp:$body"` | hex, `v0=` prefixed |
| Shopify | the raw body | **base64** |
| Svix | `"$id.$timestamp.$body"` | base64, space-separated, decoded secret |

A single generic HMAC would reject four of these five while looking correct, and
each failure reads to whoever is wiring it up as "wrong secret". Where the
sender includes a timestamp in the signed material, freshness is enforced in
both directions — a timestamp far in the future is what a replayer produces
after guessing at clock skew.

**A configured scheme with a missing secret refuses.** An endpoint that silently
stops checking while the UI says it is protected is worse than one that never
claimed to be.

### 5.2 The delivery log is the feature

Seven outcomes, six of which are not a run: `rejected_disabled`,
`rejected_signature`, `rejected_stale`, `filtered`, `duplicate`,
`rejected_mapping`, `accepted`. From outside they are indistinguishable — no run
appeared — so **the rejected rows are the valuable ones**.

Replay re-runs a stored delivery. Without it, fixing a mapping requires asking a
third party to redeliver, which GitHub allows, Stripe allows for some events, and
most senders do not allow at all. The signature is not re-verified on a replay:
it was verified on arrival, the body is the one we stored, and re-verifying would
fail every timestamped scheme because the delivery is now old on purpose.

The signature header is stripped before storage (invariant 4) — it is a
replayable proof of possession for that exact body.

---

## 6. Scheduled triggers

Cron and interval, in the schedule's own timezone, with an overlap policy
(`skip` · `queue` · `allow_concurrent`).

**`misfire_policy` has existed since V001 and nothing ever read it.** A
deployment could set it, see it in the database, and watch it change nothing.
V066 gives it a vocabulary and the scheduler obeys:

- `skip` — forget the missed window. Right for a health check: a run for 03:15
  executed at 09:00 answers a stale question.
- `fire_once` — one run now, then resume. **The default**, because it is what the
  scheduler already did, so no existing schedule changes meaning on deploy.
- `backfill` — every missed occurrence, oldest first. Right for a per-period
  export where a skipped hour is a hole in somebody's data.

Backfill is bounded twice: by `catchup_max_runs` and by a 24-hour age floor.
Without both, a once-a-minute schedule that missed a two-day outage enqueues
2,880 runs at the exact moment the platform is coming back up.

Each backfilled occurrence carries `schedule:<id>:<epoch>` as its idempotency
key, so an interrupted and retried backfill cannot double-fire an occurrence.

---

## 7. Event triggers

Kafka, SQS and Pub/Sub. The delivery guarantee, in order:

```
poll  ──▶  claim  ──▶  run  ──▶  ack
           │                     │
           └─ dedup ledger       └─ only now
```

**At-least-once delivery plus a dedup ledger is effectively-once run creation,
and neither half works alone.** Every broker here may hand over the same message
twice — a Kafka rebalance mid-batch, an SQS visibility timeout expiring while a
run is being created, a lapsed Pub/Sub lease. That is documented behaviour, not
an edge case.

Every adapter turns auto-ack **off**. All three default to acknowledging before
the run exists; that is the first thing to check if events start disappearing.

A refusal that will pass (429, 5xx) nacks the message **and releases the claim** —
without the release, the redelivery finds the key taken and is discarded as a
duplicate, losing the event exactly when it was meant to be saved. A refusal that
will not pass (an archived workflow) acks, because redelivering it forever is a
hot loop against the broker.

One thread per trigger: `KafkaConsumer` may only be used from the thread that
created it, and a shared pool also lets one broken broker stall the others.

---

## 8. MCP server mode

`POST /api/mcp` — JSON-RPC, authenticated with an API key like any other caller.
`tools/list` is a workflow list; `tools/call` is a synchronous run. The whole
feature is an adapter over machinery that already exists, which is why an MCP run
is indistinguishable from an API run by construction rather than by care.

A workflow that declares `input_schema_json` gets it; one that does not gets an
open object that **says** it is open. Deriving a schema from the graph would
produce a confident, wrong contract that a model would obey — worse than an open
one, because the model would omit fields and never learn why.

`isError: true` inside a result means the workflow failed and the MODEL should
see it. A JSON-RPC error means the call could not be made and the CLIENT should
handle it. A quota refusal is the second kind.

---

## 9. API keys

- **Per-key rate limits.** The limit was per workspace, so one runaway
  integration consumed the budget of every other key — including the one an
  operator was using to investigate it. Clamped to the plan's limit on the way
  in, so a per-key value can only ever narrow.
- **Rotation is two live keys, briefly.** Anything else is an outage: the old key
  has to keep working while the new one reaches a fleet. And the overlap has to
  END, or it is not rotation. `rotation_grace_until` makes it finite;
  `authenticate` enforces it; the default is 24 hours.
- The rotated key inherits `acts_as_user_id` and the per-key limit, so it is held
  to exactly the same caps. A rotation that quietly widened a key's reach would
  be the most inviting way to escalate one.
- Every change is an `audit_log` row.

---

## 10. Configuration

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_API_BASE_URL` | unset | The origin webhook URLs are built from. Unset returns a relative path rather than a confidently wrong absolute one |
| `API_REQUESTS_PER_MINUTE` | 600 | Per-caller request ceiling, when a key sets none of its own |
| `ENTITLEMENTS_ENFORCED` | `false` | Whether a plan refusal throws or only logs `WOULD REFUSE` |

Broker credentials live on a connection, like every other credential — same
encryption, same rotation, same audit.

---

## 11. Rules for changing this

- **A new ingress is a caller of `RunIngress`, never a second copy of it.** The
  divergence this replaced took months to notice because both paths worked.
- **Every refusal must release the idempotency claim.** A refused run did not
  happen.
- **The claim happens first.** Moving it after any check reopens the window a
  client retries into.
- **Ack after the run, never after the poll.** For every broker, in every
  adapter.
- **A new trigger type needs a `TriggerSource` entry**, and
  `IngressAcceptanceTest` walks the enum — so a source that produces a
  differently-shaped run fails that test rather than shipping.
