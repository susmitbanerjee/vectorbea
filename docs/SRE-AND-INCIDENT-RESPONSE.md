# SRE and incident response

What an incident-response workload needs that a request-response workflow engine
does not.

Companion to `docs/WAITS-AND-SIGNALS.md` (how a run parks and takes input),
`docs/INGRESS.md` (how a run starts) and `docs/RESULT-DELIVERY.md` (how its
answer leaves).

---

## 1. The shape of the work

An automation that pages, diagnoses, restarts and writes up is not a request. It
is a run that:

- lasts hours or days, across hundreds of ticks;
- takes new information after it started — a second alert, a metric, a person;
- must not be started twice for one incident;
- must be cancellable, all the way down, including its delegated children;
- must outrank the nightly batch job in the same workspace;
- has steps whose failure means different things — one should be skipped, one
  should stop the run, one should wake a human.

Everything below is one of those, assessed against what already existed.

---

## 2. What was already there

| Need | State before | Action |
|---|---|---|
| Parking a run for hours | `RunWait` (T2) — one primitive, deadline always set | reused |
| Input into a live run | `run_signals` (T2), ordered, deduplicated, rate-limited | reused |
| Resuming after a tick | `run_checkpoints` + `CheckpointStore` | **broken — see §7** |
| Cancelling a run | status CAS, waits closed, budget settled | did not reach children |
| Priority | a two-valued workspace flag | no per-run, no per-workflow |
| Deduplicating a start | `idempotency_key` (T3) — a different question | new: `dedup_key` |
| Failure policy per node | `continue`, `fail_run`, `follow_failure_edge` | new: `escalate` |
| Failure policy per branch | hard-coded, undeclared | new: declared |

---

## 3. Run singletons

### The question `idempotency_key` does not answer

They look similar and are not:

| | asks | lives for |
|---|---|---|
| `idempotency_key` | "is this the same REQUEST?" | 24 hours, on a clock |
| `dedup_key` | "is something already working on this THING?" | exactly as long as its run |

The difference is the point. An idempotency key expires whether or not the run
finished; a dedup key is released the moment the incident closes, because a new
alert for that service then *should* start a new incident.

### The index is the enforcement

```sql
CREATE UNIQUE INDEX agent_runs_dedup_live_unique
    ON agent_runs (workspace_id, workflow_id, dedup_key)
    WHERE dedup_key IS NOT NULL AND status IN (<the live statuses>);
```

Not a `SELECT` then an `INSERT` in the ingress. Two alerts for one service
arriving in the same second is the **normal** case — it is what a flapping check
produces — and a read-then-write loses that race exactly when it matters most.
`RunIngress` does look first, but only so it can act on the policy and name the
holding run; the index is what makes the invariant true, and its refusal is
translated into the same answer the lookup would have given.

`cancellation_requested` is deliberately **not** a live status here. A run on its
way out has no claim on the key, and including it would make `supersede`
self-defeating — it cancels the holder and immediately inserts, and would lose
the race to the very run it had just cancelled, every time.

### Three policies, chosen per workflow

`workflows.dedup_policy`:

- **`reject`** (default) — the caller is told which run owns the key. The only
  policy that cannot silently do the wrong thing, because the caller always
  learns what happened.
- **`join`** — the input is delivered to the live run as a signal named by
  `workflows.dedup_join_signal`. A second alert becomes more information about
  the incident already open. This is the case the feature exists for.
- **`supersede`** — the live run is cancelled and a new one starts. For a
  trigger where only the latest input matters, such as a re-deploy.

A `join` goes through the same `SignalDelivery` the signals endpoint uses —
same rate limit, same wait resolution, same resume enqueue. It deliberately
decides **before** the idempotency claim, because a join starts nothing and
burning a key on it would make the caller's own retry look like a duplicate.

### Where the key comes from

| Ingress | Field |
|---|---|
| API | `dedupKey` on the trigger body |
| Webhook | `workflow_webhooks.run_dedup_path` — a path into the delivery |
| Event trigger | `event_triggers.run_dedup_path` — a path into the message |

Both trigger types already had a `dedupe_path`, and it answers the *other*
question: it stops a broker's redelivery of **one message** running twice. Two
*different* alerts about one service carry two different event ids, pass that
check, and would start two runs. Hence a second path, naming the thing being
worked rather than the message that reported it — `alert.labels.service`, not
`alert.id`.

---

## 4. Priority

### Two halves, and the second is the one that matters

`agent_runs.priority` already ordered the claim (`ORDER BY priority DESC,
fair_vtime`) but could only be set for a whole workspace — and an SRE team's Sev1
and their nightly batch job live in the *same* workspace.

So a run now carries its own priority (0–100), a workflow declares a default
(`workflows.default_priority`), and a trigger may raise a single run above it.

But `priority DESC` **alone is a strict lane**: a service producing one Sev1 a
minute would stop batch work entirely, and nobody would notice until a nightly
job had not run for a week. So priority is also a *discount* on the fair-queue
clock:

```
vclock += cost / (plan_weight × run_priority_weight(priority))
```

`run_priority_weight` is 1× at priority 0 and 8× at 100. A Sev1 advances its
workspace's clock by an eighth of what a batch run does, so it jumps the queue
repeatedly and cheaply — while a batch run that has been waiting still
eventually holds the lowest vtime and is served. Preemption without starvation.

Both mechanisms are kept: `priority DESC` gives an unambiguous answer for a
genuine emergency, and the weight is what makes the ordinary spread behave.

### It cannot be self-granted

Requested priority is clamped to the workspace's ceiling — 100 with the
`priority_lane` entitlement, `DEFAULT_PRIORITY_CEILING` (99) without. Below 100
on purpose: an ordinary workspace's Sev1 must outrank *its own* batch work, which
99 does, without outranking a workspace that pays for the lane. A field any
caller can set to the maximum orders nothing.

---

## 5. Cancellation

### It has to go down, and `parent_run_id` points up

A run with three delegated children, cancelled, used to leave three runs
executing — each still calling models, each holding a provider capacity
reservation and an unsettled budget reservation against a parent that had
stopped caring. The children had no way to notice.

`RunSubtree.cancelDescendants` walks it breadth-first, and each descendant goes
through the **same** `updateRunCompleted` every other terminal transition uses.
One `UPDATE` over the subtree would be one statement and would leak everything
`onTerminalTransition` does: the child's waits would stay open, its budget would
never settle, its own children would survive it, and its deliveries would never
be queued. The per-child CAS is also what makes a redelivered cancellation
cancel each descendant exactly once.

Depth-bounded at 32: a cycle in `parent_run_id` is something the schema cannot
express and a bug could still write, and without the bound it is an infinite
loop holding a connection.

### And into the agent loop

`RuntimeContext.cancellationCheck` is consulted at the top of **every** agent
iteration, before the budget check. One indexed read against a possible LLM call
is not a close ratio. A cancelled loop stops with `StopReason.CANCELLED`, which
`FailureTaxonomy` classifies as `Cancelled` — neither a success nor a failure,
because it is neither.

---

## 6. Failure containment

Declared on the graph, per node:

| `errorPolicy` | Meaning |
|---|---|
| `fail_run` | Stop. The default — the only one that cannot silently produce a wrong result. |
| `continue` | The summary did not post; the incident is still handled. |
| `follow_failure_edge` | Route to the error path the author drew. |
| `escalate` | Park and ask a person. |

Retries are a **different axis** and compose with all four: `RetryPolicy` is
exhausted before the failure policy is consulted at all.

### `escalate` is a signal wait, not a new pause

Invariants 9 and 15. An escalation is a question with a deadline, which is
exactly a signal wait — so it parks through the same primitive and is answered
through the endpoint that already exists:

```
POST /api/runs/:id/signals
{"name": "escalation:<nodeId>", "payload": {"decision": "retry"}}
```

`retry`, `skip` or `abort`. A timed-out escalation reads as `abort`: nobody
answered, and continuing would report a failed step as done.

The answer is read **before the node runs again**, not after. Two of the three
decisions mean the node's side effect must not happen, and reading afterwards
would restart the service a person had just said to leave alone. So the node is
parked `PENDING` rather than `FAILED`, and the decision is a gate in front of it.

Each escalation of a node gets its own attempt number, so a resolved wait is
consumed exactly once — otherwise the second failure would find the first
"retry" and loop at machine speed. Bounded by `WORKER_MAX_ESCALATIONS` (10): a
person answering "retry" ten times is not a workflow that will ever succeed.

Behind `WORKER_FAILURE_ESCALATION`, off by default. With it off a node that
declares `escalate` fails the run and says so — the previous behaviour, loudly,
rather than a run parked on a question nobody has been told to answer.

### And per branch

`branchFailure` on the PARALLEL node:

- **`require_one`** (default) — today's behaviour: tolerate partial failures,
  fail only if every branch failed.
- **`all_must_succeed`** — any failed branch fails the fan-out.
- **`tolerate_all`** — the join proceeds even if every branch failed.

This was always a policy; it just was not declared. `require_one` is right for
"check five services" and wrong for "drain the node, update DNS, verify", where
a branch failing quietly means the run reports success having done two thirds of
the work.

---

### Incidents say what broke

`failure_incidents` rows come from the recovery classifier chain
(`com.vectorbea.recovery.classifier`, vendored into api and worker from
`packages/recovery-kotlin`). Agent failures had no classifier, so budgets,
iteration and tool-call limits, and an agent that gave up all landed in
`UNKNOWN`, and a token-BUDGET breach matched the LLM classifier's "max token"
rule as a context-window error. `AgentFailureClassifier` runs before the LLM
classifier and names them (`AGENT_TOKEN_BUDGET_EXCEEDED`, `AGENT_TOOL_CALL_LIMIT`,
`AGENT_ITERATION_LIMIT`, `AGENT_COST_LIMIT`, `AGENT_COULD_NOT_FINISH`), plus
`TOOL_INPUT_MISSING` and `STEP_TYPE_UNSUPPORTED`.

The Incidents page and the inbox never print the enum. `lib/incidents/
describe-incident` maps each code to a title, a kind and a fix, reads records
still stored as `UNKNOWN` from their `technical_summary` with the same
patterns, and takes the step or agent name from the failure message. Worker
failure messages now start `Step '<name>' failed:` instead of the node id.

## 7. Long runs — what testing found

`LongRunAcceptanceTest` drives 200 ticks, 40 signals and 5 approvals against a
real database. It was written to measure checkpoint growth. It found something
else.

**Checkpoints had never been written.** `run_checkpoints` had two definitions:
V001's (`workflow_id`, `step_id`, `state_json_sanitized`) and
`Database.ensureCheckpointsTable`'s in the worker (`workspace_id`,
`environment_id`, `node_id`, `snapshot_json`). The worker's was
`CREATE TABLE IF NOT EXISTS`, so in every environment where Flyway had run —
all of them — it was a no-op, while `CheckpointStore` wrote the shape it
described. Every `INSERT` threw:

```
ERROR: column "workspace_id" of relation "run_checkpoints" does not exist
```

and `WorkflowRuntime.writeCheckpoint` swallowed it into a `log.warn`.

The consequence was not a missing feature but a silent one: every run that
yielded, parked on an approval or waited for a signal resumed with `loadLatest`
finding nothing, and **replayed from its first node**. Only `StepExecutionGuard`
and `SideEffectGuard` stood between that and duplicate side effects in
production — doing far more work than anyone intended.

V069 reconciles the schema, the shadow DDL is deleted so there is one definition
again, the swallow became an `error` that names the consequence, and
`worker_checkpoint_write_failures` is a counter that is supposed to be zero. A
warning that always fires is a warning nobody reads.

### Growth

With checkpoints actually landing, the test asserts the shape of the growth
rather than its absence. A snapshot *should* grow — at tick N it holds N nodes —
so the assertion is that growth stays **linear** and that a day-long run's
snapshot stays well under 512 KB. Quadratic growth is what an accidental
embed-the-previous-snapshot bug produces, and it is invisible at small N and
fatal at large N.

---

## 8. Conversational guidance

Free text into a running agent, at its next iteration boundary:

```
POST /api/runs/:id/guidance
{"text": "the database is the primary, do not fail over", "agent": "diagnoser"}
```

A signal plus a context write, and nothing else. `run_signals` already stores it
in order, deduplicated and workspace-scoped, and the per-run rate limit that
stops an unbounded signal stream from starving one run covers this too. What is
new is one read at the top of each agent iteration and one write into
`AgentLoopState.guidance`.

Three details that are not incidental:

- **Read before the prompt is built**, so guidance sent while the previous LLM
  call was in flight is in front of the model on the *next* iteration. An agent
  that acts on a correction one step late is, from the outside, an agent that
  ignored it.
- **Its own protected context section**, not an observation. Observations render
  `takeLast(10)`, which is right for tool results and wrong for an instruction: a
  correction has to still be true at iteration forty.
- **Rendered as data, with a boundary.** It is the only part of the prompt
  written by a person while the run is in flight. It is flattened to one
  paragraph and prefixed with a line saying it is instruction about the task, not
  a change to tools or permissions. Invariant 1 means the runtime validates every
  action against the grant list whatever the model believes — but an agent
  spending its remaining iterations trying is still a wasted run.

Capped at 2,000 characters and 10 entries. Guidance is caller-supplied text that
goes straight into a prompt; the rate limit bounds the rate, and these bound the
total.

---

## 9. Under load

`ConcurrentRunSoakTest`: 50 concurrent runs, 30 ticks each, signalling,
approving, parking, delegating and checkpointing through one connection pool.
Half finish, half are cancelled with their delegated children.

It is not a throughput test and does not claim to be — the wall clock is
compressed and there is no model provider. What it establishes is that under
real concurrency the durable substrate stays consistent: no lost signal, no
duplicated wait, no run left parked, no key collision across runs, and nothing
holding one pooled connection while taking another.

The counts are printed, not just asserted, so a regression names itself.

---

## 10. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_FAILURE_ESCALATION` | off | Whether `onFailure: escalate` actually parks |
| `WORKER_MAX_ESCALATIONS` | 10 | Escalations of one node before the run fails |
| `SIGNAL_RATE_PER_RUN_PER_MIN` | 60 | Also bounds guidance and dedup joins |
| `SIGNAL_RATE_PER_WORKSPACE_PER_MIN` | 600 | " |
