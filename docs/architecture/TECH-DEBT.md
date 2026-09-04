# Tech debt — worker execution

Deliberate compromises with a known removal point. Each entry names the stage
that deletes it. An item here is not a bug and not a TODO: it is something we
chose, knowing the cost, because the correct fix was sequenced later.

Stages refer to §5 of `09-EXECUTION-ARCHITECTURE-REVISED.md`.

---

## D1 — `REPLICA_COUNT` divides per-tenant caps

**Added:** Stage 1 · **Deleted in:** Stage 3
**Code:** ~~`TenantConcurrencyLimiter`, `WorkerConfig.replicaCount`~~ — both removed
**Status:** ✅ **CLOSED.** Admission now reads `run_leases` (shared, cluster-wide)
with per-workspace policy limits, enforced hard at lease-claim time. Verified:
peak per-tenant concurrency is **2 at N=1, N=2 and N=3** — see
`SHARED-FAIRNESS.md` §4. The parameter is deleted rather than defaulted, as
planned: a dead knob that silently divides limits is worse than no knob.

### What it is

`TenantConcurrencyLimiter` is in-process JVM state, so every per-tenant limit is
enforced once *per replica*. At N=3, `maxActiveAgentRunsPerTenant=1` admits three
concurrent agent runs for one workspace, not one (§1.3). `REPLICA_COUNT` divides
each configured cap by the replica count so the *platform-wide* total lands
approximately where it was intended.

### Why it is debt and not a fix

- **Nothing coordinates the replicas.** Each simply receives a smaller private
  allowance. There is no shared view of what a tenant is currently running.
- **It cannot express a cap of 1.** Division floors at 1, so
  `maxActiveAgentRunsPerTenant=1` across 3 replicas is still an effective 3. The
  tightest limit the platform most wants is the one this cannot represent.
- **It is static and silently wrong when drifted.** Scaling 3 → 5 without
  updating `REPLICA_COUNT` restores exactly the over-admission it exists to
  prevent, with no signal that it happened.
- **It divides capacity, not demand.** A replica with three idle slots cannot
  lend them to a replica that is full.

### Guardrails while it exists

- A multi-line `WARN` block at startup whenever `REPLICA_COUNT > 1`, naming this
  entry.
- The effective post-division caps are logged, not just the configured ones.
- `TenantConcurrencyLimiterTest` pins both the division and the
  cannot-divide-below-1 limitation, so the constraint is documented in
  executable form.

### Removal

Move admission onto a `run_leases` count query with the partial index (§3). Then
**delete the parameter** rather than defaulting it to 1 — a dead knob that
silently divides limits is worse than no knob.

---

## D2 — Tenant-DB isolation is dispatcher-level, not tenant-level

**Added:** Stage 1 · **Delete in:** Stage 3/4
**Code:** `TenantDbDispatcher`
**Status:** active by default (16 threads).

One workspace with a black-hole database can occupy all 16 dispatcher threads and
cause *other workspaces'* database nodes to be rejected. What Stage 1 fixes is
the larger blast radius: agent, short, long and system work no longer pay for it
at all.

Per-tenant reservation inside the dispatcher needs the same shared-fairness
substrate as D1. Until then the mitigation is the socket timeout — each hung
query holds a thread for at most `DB_SOCKET_TIMEOUT_SECONDS` (30 s), so the
dispatcher drains on its own.

---

## D3 — Read bounding cannot guarantee placement

**Added:** Stage 1 · **Closed in:** Stage 2 (typed queue)
**Code:** `AdaptiveReadBatch`, `WorkflowQueueConsumer.totalAcceptCapacity`
**Status:** ✅ **CLOSED.** Each `TypedStreamConsumer` reads `COUNT = its pool's
free slots` from its own stream, so every claimed message has a slot by
construction. `AdaptiveReadBatch` remains only on the legacy consumer and is
deleted with it at migration step 7. Verified: peak PEL per stream never exceeded
the pool's slot count — see TYPED-QUEUE-MIGRATION.md §3.

The read is bounded by free slots plus free buffer room, but the stream is
untyped: a message's execution class is only known *after* it is read and
classified. A batch sized against free SHORT capacity can turn out to be entirely
AGENT work, which is then parked in the PEL.

`AdaptiveReadBatch` reacts to that outcome (halve on park, grow on success)
rather than predicting it, which bounds the damage without stalling healthy
classes. It is a controller compensating for a missing type, and Stage 2 removes
the need entirely by giving each class its own stream and consumer group.

---

## D4 — XAUTOCLAIM recovery is a silent no-op

**Found:** Stage 1 (load harness) · **Fixed in:** Stage 2
**Code:** `WorkflowQueueConsumer.reclaimPendingMessages`, `TypedStreamConsumer`
**Status:** ✅ **FIXED** — `redis.xautoclaim(...).messages` in both consumers.

`redis.xautoclaim(...)` returns `ClaimedMessages` on Lettuce 6.3.2, not
`List<StreamMessage>`. The `as?` yields null and `?: return` exits with no
exception, log line, or metric. Parked messages are never reclaimed.

Was deferred out of Stage 1 because it changes when parked work resumes, which
is scheduling behaviour — Stage 2 owns that, so it is fixed here. Full evidence in
`TIMEOUT-AUDIT.md` §13; measured impact in `LOAD-BASELINE.md` §A.

Still worth the alert: `worker_pel_depth > 0` while every
`worker_pool_slots_active` is `0` means work is stranded rather than queued.

---

## D5 — Classifier counts `"type"` on edges

**Found:** Stage 1 (load harness) · **Fixed in:** Stage 2
**Code:** `JobClassifier.classifyGraph` (legacy), `GraphClassifier` (current)
**Status:** ✅ **FIXED** — `GraphClassifier` parses the graph and counts only the
`nodes` array. Pinned by `GraphClassifierTest`. The buggy `JobClassifier` survives
only on the legacy consumer and is deleted with it at migration step 7.

Node count is approximated by counting `"type":` across the whole graph JSON.
Edges carry a `type` field too, so a 7-node / 6-edge workflow counts as 13,
crosses the threshold of 12, and is routed to the 2-slot LONG pool instead of the
8-slot SHORT one. Any workflow above roughly six nodes is likely mis-binned today.

Stage 2 materialised `execution_class` at enqueue and deleted the probe from the
typed path entirely.

---

## D6 — `SSRF_ALLOWED_TEST_HOSTS`

**Added:** Stage 1 (load harness) · **Delete in:** whenever the harness can reach
a mock without it.
**Code:** `SsrfGuard`
**Status:** active only outside production.

Exempts named hosts from the private/loopback address checks so the load harness
can point tool nodes at a local mock. Ignored entirely when `APP_ENV=production`,
exact-match only, and applied after the name block and the per-connection
allow-list. Must never be set on a deployed worker.

---

## D7 — API test module does not compile

**Found:** Stage 2 · **Fix in:** next API change
**Code:** `CacheKeysTest`, `TenantIsolationTest`
**Status:** defect, unfixed — **pre-existing**, unrelated to the typed queue.

`gradle test` in `apps/api-kotlin` fails at `compileTestKotlin`: `CacheKeysTest`
calls `CacheKeys` helpers without required parameters, and `TenantIsolationTest`
has an unresolved `context` reference and two argument-type mismatches. Both
predate this work and neither file nor its subject was touched by it.

Consequence: the API module has **no runnable test suite** right now, so
`GraphClassifierTest` — which pins the classification rules and the edge-counting
regression — cannot execute in CI until this is repaired. The typed-queue
behaviour was verified end-to-end through the load harness instead.

Worth fixing before the next API change, because it means every API test is
currently dead weight.

---

## D8 — Claim-time admission checks after the lease insert

**Added:** Stage 3 · **Fix in:** S06 (Postgres-claim scheduler)
**Code:** `SharedTenantAdmission.admitAtClaim`, `RunProcessor`
**Status:** active, bounded.

The hard gate counts leases *after* acquiring one, then releases if the run is
the excess. The window between insert and check is sub-millisecond and its
outcome is deterministic — ordering by `(created_at, run_id)` means the first N
acquirers always win — but the run still briefly holds a lease it will not use.

Two visible consequences, both benign and both documented in
`SHARED-FAIRNESS.md` §4:

- `tenant_admission_overshoot_total` reads non-zero for refused-claim transients
  rather than real violations, so it needs cross-checking against executing
  concurrency before anyone acts on it.
- A refused run costs one lease acquire, one count query, one release and one
  re-enqueue.

S06 folds the check into the claim (`INSERT … WHERE (SELECT count(*) …) < limit`),
which removes the window, the release path, and the metric ambiguity together.

---

## D9 — Graceful-drain lease release is unverified on Linux

**Added:** Stage 3 · **Verify on:** first staging deploy
**Code:** `RunLeaseManager.releaseAllForWorker`, worker shutdown hook
**Status:** logic verified, SIGTERM path unexercised.

The SQL scoping is confirmed against a real database (releasing worker A's leases
leaves worker B's intact), but the SIGTERM-triggered path could not be exercised
on the Windows development machine: `taskkill` without `/F` does not deliver a
close event a windowless JVM handles, and `/F` skips shutdown hooks entirely.

Linux — what Railway runs — runs JVM shutdown hooks on SIGTERM normally. Confirm
on the first staging deploy by looking for:

```
[shutdown] released N run lease(s) — capacity freed immediately, not on expiry
```

If that line is absent during a rolling restart, leases are falling back to
expiry and tenants stay at their cap for the full 60 s TTL after their work stops.

---

## D10 — A lease can outlive its terminal run

**Found:** Stage 5 (chaos suite) · **Fix in:** next durability change
**Code:** `RunProcessor.process` finally-block, `RunLeaseManager.release`
**Status:** defect, unfixed. Transient, self-healing after the 60 s TTL.

The chaos suite's `lease-expiry` scenario observed one lease still held on a run
that had already reached `succeeded` (`993b6711@load-worker-2`). All three runs
completed correctly, so this is not a correctness problem — but for up to the
lease TTL that workspace is counted against its concurrency limit for work that
has finished, which is capacity quietly withheld.

Most likely cause: the `finally` that calls `leaseManager.release` did not
complete on a cancelled coroutine. That would be a direct consequence of the S04
switch from `Future.cancel` to structured cancellation, and is the
shutdown-under-load behaviour already flagged in `SUSPENDING-IO.md` §5.

Detect with the `zero stuck leases` assertion in `scripts/chaos/assertions.mjs`,
or in production: leases whose run is terminal.

---

## D11 — Fencing is built but not yet enforced on the four write paths

**Added:** Stage 5 · **Complete in:** next durability change
**Code:** `Fence`, `RunEventStore`, `StepOutputStore`, `CheckpointStore`, `AgentBrainRunner`
**Status:** mechanism present, predicate not applied.

`Fence`, `FencedOutException` and `fenced_write_total` exist, and
`RuntimeContext` now carries `leaseToken`, but `AND lease_token = ?` has not been
added to the four writes 09 §6.3 names — `run_events`, `step_outputs`,
`run_checkpoints`, `agent_iterations`.

Until it is, a worker fenced mid-flight can still append to those tables, and
`fenced_write_total` reads zero because nothing calls `assertWrote`. The metric
being flat is currently evidence of nothing.

Partly covered by the step-execution guard and by the 10 s heartbeat cancelling a
run whose lease was reassigned — but neither is fencing, and the chaos scenario
that would expose the gap (`lease-expiry`) could not run on Windows.

---

## D14 — `replicas.sh stop` does not stop workers it did not start

**Added:** Stage 6b · **Complete in:** next harness change
**Code:** `scripts/load/replicas.sh`
**Status:** worked around per-invocation, not fixed.

`stop` iterates the pids it recorded at `start`. A worker launched directly via
`start-worker.sh` — which is how every single-replica measurement is taken — is
invisible to it, so a sequence of restarts silently accumulates live workers.

This is not cosmetic. It produced three consecutive wrong measurements during
Stage 6b: per-tenant concurrency read 8, then 9, then 14 against a cap of 2, and
each looked like a scheduler defect. Five workers were running. Any conclusion
drawn from a harness run without first asserting the worker count is unsafe.

The fix is to match on the process command line rather than a recorded pid, the
way the Stage 6b measurements did:

```
Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
  Where-Object { $_.CommandLine -like '*worker-kotlin*' }
```

Until then, every harness script that reports a limit should print the live
worker count alongside it, so a wrong number is self-evidently wrong.

---

## D15 — `worker_pool_slots_active` carries no class label under `ExecutionSlots`

**Added:** Stage 6b · **Complete in:** next metrics change
**Code:** `ExecutionSlots`, `scripts/load/run.mjs`
**Status:** cosmetic, but it hides a real signal.

Every harness report since slots became semaphore permits shows
`peak slots active: unknown=0`. The sampler reads `worker_pool_slots_active` by
pool label; `ExecutionSlots` does not emit one, so the harness bucket is
`unknown` and the value never moves.

Nothing depends on it — the limits are measured from `run_leases` and `agent_runs`
directly, on purpose — but per-pool saturation is exactly the number you want when
deciding whether to raise a pool or add a replica, and right now it is invisible.

---

## D16 - Oversized node payloads are rejected, not offloaded

**Added:** Stage 7 - **Complete in:** object-storage work
**Code:** `RunCeilingTracker.checkPayload`
**Status:** ceiling enforced, offload not built.

The spec is "256KB inline; larger offloads to R2". The ceiling half exists and
ends the run with `payload_limit_exceeded` and an actionable message. The offload
half does not: there is no object-storage client in the worker, so a node that
legitimately produces 300KB fails instead of spilling.

`checkPayload` returns the breach rather than setting it, precisely so the caller
can later choose to offload instead of ending the run. The seam is there; the
implementation is not.

---

## D17 - Cost and token ceilings are accurate to within one probe interval

**Added:** Stage 7 - **Complete in:** next executor-signature change
**Code:** `RunCeilingTracker.refreshUsage`
**Status:** enforced, but not exactly.

Cost and tokens are recorded by node executors into `run_events`, one row per
model call. The ceiling reads that total back on a 2s throttle rather than being
told inline, so a run can overshoot its limit by whatever it spends in two
seconds - cents, for a $1.00 ceiling and sub-cent calls.

Threading a tracker through every executor would touch a dozen files and create a
second source of truth that could disagree with the event stream. The right fix is
for executors to report usage inline when their signature next moves.

---

## D18 - The 429 suspension path is unproven under load

**Added:** Stage 7 - **Complete in:** next load-harness change
**Code:** `ProviderThrottle`, `NodeResult.Throttled`, `RunProcessor`
**Status:** wired and compile-checked, never exercised.

`scripts/load/mock-upstreams.mjs` has no 429 mode, so nothing in the harness has
ever driven a provider rate limit. The whole path - `Retry-After` parsing, the
suspend/back-off threshold, the `workflow_timers` write, the permit release, the
resume - is unverified end to end.

This is the weakest guard in the degradation set, and it is the one whose failure
mode is worst: if suspension silently does not happen, twenty throttled runs hold
twenty permits and the pool stalls on a condition that is not even an error.

The fix is small: a `?status=429&retryAfter=N` mode on the mock, and a scenario
that points a tenant at it and asserts `provider_throttle_suspend_total > 0` while
the in-flight count drops.

---

## D19 - Model-call bodies live in Postgres, not object storage

**Added:** Stage 8 - **Complete in:** object-storage work
**Code:** `BlobStore`, `PostgresBlobStore`, `payload_blobs`
**Status:** working, in the wrong place.

Bodies over 256KB offload to a `payload_blobs` table rather than to R2. That
inflates backups and vacuum, and object storage is an order of magnitude cheaper
per byte.

The interface is written for R2 and the implementation is a swap, not a redesign.
It was done this way because shipping the recording *without* somewhere to put
large bodies would mean silently dropping exactly the calls most worth auditing -
being correct first and cheap second is the right order.

---

## D20 - The determinism journal is not yet written to

**Added:** Stage 8 - **Complete in:** next replay change
**Code:** `recorded_values`, `ReplayContext.nextValue`
**Status:** schema and read path exist; nothing writes.

The replay audit found 22 direct calls to `Instant.now()` / `UUID.randomUUID()` in
`worker/runtime/` alone. Each is a value that differs between two executions.
`recorded_values` and the reader that consumes it are built, but no executor
journals to them.

The acceptance test passes byte-identically because the agent fixture does not
embed a timestamp in its output. A workflow that did would replay with a different
timestamp and diverge - so the guarantee is currently "byte-identical for
workflows that do not observe the clock", which is narrower than the promise on
the landing page.

Closing it means routing those call sites through the journal: mechanical, but it
touches many files.

---

## D21 - Only model calls replay from a recording

**Added:** Stage 8 - **Complete in:** next replay change
**Code:** `ReplayContext`, `HttpNodeExecutor`, `ToolNodeExecutor`
**Status:** model calls done; tool and HTTP nodes not.

`ReplayContext` serves recorded responses for LLM nodes. Tool and HTTP nodes have
no equivalent, so replaying a workflow containing one reaches the `doHttpPost`
backstop and fails with `NotReplayableException`.

Failing loudly is the safe direction - it is what the design intends when a
recording is incomplete - but it means such workflows are not replayable at all
rather than replayable. `side_effects.response` already holds tool responses for
the exactly-once path; serving replay from it is the likely shape of the fix.

---

## D22 - run_events partitioning declines on a large table

**Added:** Stage 9 - **Complete in:** a maintenance window
**Code:** `V028__run_events_partitioning.sql`
**Status:** converts automatically below ~5M rows; declines above it.

Converting a populated table to partitioned needs ACCESS EXCLUSIVE for the
duration. On run_events - the write path for every step - that is a write outage
of unbounded length, so the migration refuses above the threshold and logs the
procedure instead.

That is the right default for an automated deploy, and it means a large existing
deployment gets the functions, the covering index and the retention machinery but
NOT the partitions. The conversion is: rename to `run_events_historical`, create
the partitioned parent, ATTACH the old table with an upper bound at the next month
boundary, call `run_events_ensure_partition()` twice. Rehearse on a restore first.

---

## D23 - the run_event_logs foreign key was dropped to allow partitioning

**Added:** Stage 9 - **Complete in:** if referential integrity is needed in the DB
**Code:** `V028__run_events_partitioning.sql`
**Status:** deliberate, and it weakens a guarantee.

`run_event_logs.run_event_id -> run_events.id` cannot survive partitioning:
Postgres only accepts a foreign key referencing a partitioned table when the
referenced columns carry a unique constraint on the parent, and such a constraint
must include the partition key. `id` alone cannot.

The constraint was dropped and the index kept, so lookups are unaffected and
integrity moves to the application - where it effectively already lived, since
both rows are written by the same code path. The alternative is adding
`created_at` to run_event_logs and making the key composite, which means
backfilling every existing log row.

Recorded because "we dropped a foreign key" should never be a silent line in a
migration.

---

## D24 - `_sanitized` columns are not sanitised

**Added:** Stage 9 - **Complete in:** its own rename change
**Code:** `step_outputs.*_sanitized`, `run_events.*_sanitized`
**Status:** documented in the schema; not renamed.

`StepOutputStore.save` writes `toJson(output)` straight into
`raw_output_json_sanitized`. `RunEventStore` stores whatever the caller passed and
says so in its own KDoc. No sanitiser runs on either.

This is load-bearing good news for replay - the substrate is lossless, which is
why replay is byte-identical - and a security misreading waiting to happen. A
developer who sees `output_json_sanitized` reasonably concludes the content is
safe to put in a support tool or an export. It holds whatever the workflow touched.

V029 adds `COMMENT ON COLUMN` saying so, so anyone who checks the schema gets the
truth. The honest fix is the rename, which touches the worker, the API and three
repositories, and deserves its own review rather than riding along with six
unrelated schema changes.

See docs/architecture/REPLAY-FIDELITY.md.

---

## D25 - audit emitters cover four of the eight required action groups

**Added:** Stage 9 - **Complete in:** next governance change
**Code:** `AuditLog`, `ConnectionRoutes`, `ApprovalRoutes`
**Status:** table, writer and vocabulary complete; emitters partial.

`audit_log` is append-only and enforced by trigger, the writer exists, and the
full action vocabulary is defined. Emitters are wired at connection
create/update/delete and approval decisions - the two highest-value targets.

Not yet emitting: auth (login/logout/failure), workflow publish, member changes,
settings changes, and limit overrides. Each is a two-line call at a site that
already has the request and the before/after state; they are omitted because
wiring eight route files was more change than one stage should carry, not because
anything blocks them.

Until then P20's screen will render a partial trail, which is worse than none if
anyone assumes it is complete. The screen should say which action groups it covers
until this closes.

---

## D26 - a contract that cannot be read fails OPEN

**Added:** Stage 10 - **Complete in:** next reliability change
**Code:** `ContractValidator.contractFor`, `WorkflowRuntime.validateContract`
**Status:** deliberate, and it is the wrong direction.

If the contract lookup throws - a database blip, a connection exhaustion - the
node is treated as having no contract and the output commits unvalidated. The
failure is logged at ERROR but the run proceeds.

The alternative is failing the node, which turns a transient database problem into
a failed run for every contracted node in the fleet at once. Neither is good. The
right answer is probably a short-lived cache of active contracts so a blip is
invisible, plus fail-closed once the cache is cold - which is a change to how
contracts are loaded rather than a tweak here.

Recorded because "the guard silently did not run" is exactly the class of thing
that should never be discovered from an incident.

---

## D27 - stats are top-level numeric fields only

**Added:** Stage 10 - **Complete in:** when someone needs it
**Code:** `ContractValidator.statsFor`
**Status:** works for the documented cases; silently absent otherwise.

`stats.p50_risk_score` resolves for a numeric field at the top level of the output.
A nested field (`stats.p50_scores.overall`) does not - the SQL only explodes one
level of `jsonb_each` and only keeps `jsonb_typeof = 'number'`.

An assertion referencing an unavailable stat compares against null, which is false,
which fails the assertion. That is the safe direction, but it fails for a reason
the author cannot see from the expression. The inspector's live test surfaces it -
the observed value shows as null - which is why this is D-level rather than a bug.

---

## D28 - constrained decoding is wired for LLM nodes, not agent nodes

**Added:** Stage 10 - **Complete in:** next agent change
**Code:** `LlmNodeExecutor`, `AgentBrainRunner`
**Status:** Layer 0 on LLM nodes; agent loops unprotected.

`LlmNodeExecutor` passes the contract's schema to all three providers. The agent
brain runner - the iterative loop - makes its own provider calls and does not.

So an agent node with a declared contract gets Layer 1 (assertions run at the
checkpoint boundary, and a violation still cannot commit) but not Layer 0: its
intermediate turns are unconstrained. The final output is still validated, which is
the guarantee that matters most, but the class of failure Layer 0 eliminates
outright is merely caught rather than prevented for those nodes.

Threading the schema through the agent loop is the fix, and it belongs with the
Layer 3 work on loop budgets rather than bolted on here.

---

## D29 - repair retry is decided but not yet driven from the executor

**Added:** Stage 11 - **Complete in:** next reliability change
**Code:** `FailureClassifier`, `RepairStrategy`, `LlmNodeExecutor`
**Status:** classification and strategy complete and unit-tested; the executor does
not yet consult them.

`FailureClassifier` and `RepairStrategy` implement the full section 5 taxonomy and
are proven by 16 tests, including the three paths that must not blind-retry. What
is NOT wired: `LlmNodeExecutor` still returns `NodeResult.Failed` on a schema or
assertion failure and lets the node's ordinary retry policy handle it, rather than
asking `RepairStrategy.decide` and issuing a repair call.

So today a schema violation is retried with the identical prompt - the exact
behaviour section 5 calls actively harmful - rather than repaired. The decision
logic is correct and tested; the call site that would use it is the gap.

Wiring it needs the executor to loop internally over attempts while carrying the
previous output and the violation, which changes the shape of `execute` and belongs
with the confidence-routing work rather than bolted onto the end of this stage.

---

## D30 - provider failover is built but not invoked

**Added:** Stage 11 - **Complete in:** with D29
**Code:** `ProviderFailover`
**Status:** lookup, threshold and messaging complete; nothing calls it.

`considerFailover` decides correctly - 5xx only, after the primary exhausts its
retries, requiring an explicitly opted-in secondary of a different provider - and
logs at ERROR because a failover changes model behaviour. But the executor never
calls it, so no run has ever failed over.

It shares the same blocker as D29: both need the executor to own an attempt loop.
They should land together, and the failover event must reach the run detail at the
same time, or a customer gets a result from a model they did not choose with no
indication of it.

---

## D31 - groundedness applies to LLM nodes only

**Added:** Stage 11 - **Complete in:** with the agent-loop work
**Code:** `LlmNodeExecutor`, `AgentBrainRunner`
**Status:** same boundary as D28.

Layer 2 is wired into `LlmNodeExecutor`. The agent brain runner makes its own
provider calls and does not wrap schemas, extend the system prompt, or verify
spans, so an agent node with `groundedness: required` gets no citation checking on
its intermediate turns.

The final output still passes through contract validation at the checkpoint
boundary, so a fabricated value cannot commit if an assertion catches it - but the
mechanical span check, which is the point of Layer 2, does not run for those nodes.

---

## D32 - the migration chain could not provision a fresh database

**Added:** Stage 12 - **Complete in:** DONE for the two tables found; audit for more
**Code:** `V027__ui_schema_gaps.sql`, `V029__sanitized_column_truth.sql`
**Status:** two tables fixed; the class of bug is not proven absent.

Running the migration chain against a genuinely fresh Postgres volume failed twice:

  V027 - "relation run_approvals does not exist"
  V029 - "relation step_outputs does not exist"

Neither table is created by ANY migration in this repository. Both are written by
the worker on the hot path - `run_approvals` by the approval gate, `step_outputs` by
every node execution - and both were introduced out-of-band into the databases that
already existed. Every environment therefore worked, and the chain was silently
incapable of building a new one.

Both are now created idempotently by the migration that first needs them, with the
definitions matching exactly what the code writes. `step_outputs` also gained the
UNIQUE (run_id, node_id) constraint its own upsert requires - without an arbiter the
ON CONFLICT could not have worked, which suggests the out-of-band table had it and
nobody noticed the dependency.

WHAT IS NOT PROVEN: that these were the only two. The chain now runs clean end to
end on a fresh volume, which is real evidence, but the load harness does not
exercise every table - `agent_memory_entries`, `recovery_attempts` and the architect
tables are never touched by it. A full provision-from-empty test in CI is the actual
fix, and it should have existed before this was discovered by accident.

---

## D33 — the shared JSON mapper silently dropped explicit nulls from stored data

**Found by:** the confidence demo, on its own assertion.
**Fixed:** `apps/api-kotlin/src/main/kotlin/com/vectorbea/api/http/Json.kt` (`dataMapper` / `toDataJson`).
**Status:** fixed at the confidence call sites; the wider audit is not done.

The shared `mapper` is configured `NON_NULL`, which is right for API responses and
wrong for anything persisted as data. Layer 2 made `null` a first-class answer — a
model saying "this value is not in the source" is a finding, not an absence — and the
approve-with-correction flow depends on it: a reviewer correcting an invented contact
to `null` is making a statement.

Serialised through `NON_NULL`, that statement vanished. The stored correction was
`{}` for that field, so:

  - downstream nodes saw a missing key rather than a deliberate null;
  - the eval case captured from the correction recorded no expectation for the very
    field it was capturing.

The demo asserted "the agent value and the human value are both kept" and failed,
which is the only reason this was found.

WHAT IS NOT PROVEN: that the confidence routes were the only place a stored payload
goes through `toJson`. Every `toJson` call whose result lands in a JSONB column should
be reviewed and moved to `toDataJson`; only the confidence ones were.

---

## D34 — `GraphScheduler.graph` is now public

**Introduced:** deliberately, wiring the confidence gate.
**Status:** accepted, narrow.

The gate payload names the first downstream side-effecting node so the warning can say
"approving this will send an email" rather than "the run will continue". That needs a
one-hop read of the graph, so `GraphScheduler`'s `graph` went from `private val` to
`val`.

Read-only and small, but it widens a surface that was closed. The better shape is a
`fun successors(nodeId): List<WorkflowNode>` on the scheduler, keeping the graph
private and the traversal in the class that owns it. Worth doing the next time
anything else needs to look ahead.

---

## D35 — the API renders two metric registries

**Introduced:** Stage 13, folding `apps/telemetry` into a library.
**Status:** accepted, with a clear end state.

`api-kotlin` has its own `Counter`/`Gauge`/`Histogram` and its own `MetricsRegistry`,
written before `packages/observability-kotlin` existed. New metrics register in the
shared one; `/metrics` renders both, and Prometheus is none the wiser because it scrapes
one endpoint per target and does not care that a process keeps two internal collections.

Why it was not done in one pass: the local histogram is in **milliseconds** and the
shared one is in **seconds**. Migrating means renaming every API histogram series and
rewriting whatever queries them — a change with its own blast radius and no relationship
to the consolidation that surfaced it. Doing both at once would make a bisect impossible.

The end state is one registry. Until then the rule is: **new metrics go to the shared
registry**, so the local one shrinks rather than grows.

WHAT IS NOT PROVEN: that the two registries cannot collide on a metric name. They are
separate maps, so registering the same name in both would emit two `# TYPE` headers for
one family and Prometheus would reject the whole scrape. Nothing checks for this today;
a duplicate-name assertion across both registries belongs in `verify-metrics.mjs`.

---

## D36 — `provider_429_total` labels verified by inspection, not observation

**Found by:** `scripts/load/verify-metrics.mjs`.
**Status:** open, low risk.

Ten of the eleven §5.4 metrics were confirmed present *and* carrying their documented
labels by scraping a live process under load. `provider_429_total` was confirmed present
but its `provider` label was not: that label set only materialises when a provider
actually returns a 429, which did not happen under test.

The call site is `LlmNodeExecutor` and the label is passed there, so this is very likely
fine. "Very likely fine" is precisely the standard the harness exists to replace, which
is why it is written down rather than waved through.

Shares a root cause with D18 — the 429 path has never been exercised end to end. Both
close with the same fix: a `?status=429&retryAfter=N` mode on
`scripts/load/mock-upstreams.mjs`, a scenario pointing a tenant at it, and a re-run of
the verifier.

---

## D37 — the counter exposition declared a metric family with no samples

**Found by:** `scripts/load/verify-metrics.mjs`, on its first run.
**Fixed:** `WorkerMetrics.WCounter.exposition`, `observability.metrics.Counter.exposition`.
**Status:** fixed in both implementations.

Every counter emitted `# HELP lease_expiry …` / `# TYPE lease_expiry counter` and then
samples named `lease_expiry_total`. The declared family had no samples; the samples
belonged to no declared family.

Prometheus ingests this either way, which is why it survived from the original metrics
work through several stages of dashboards: the series existed, graphed fine, and
answered queries. What it was NOT was typed — nothing validated that `rate()` was being
applied to a counter, and a type-aware consumer (a recording rule, a exporter-side
check) would have seen nothing at all.

Five of the eleven §5.4 metrics were affected: `lease_expiry_total`, `dead_letter_total`,
`side_effect_dedupe_total`, `provider_429_total`, `run_suspended_total` — including two
of the three the alerts fire on.

Recorded rather than quietly fixed because of what it says about verification: the code
was read several times and looked correct, and the metric names were checked against the
spec by eye. Only scraping the endpoint and matching on the documented name found it.

---

## D38 — `agent_runs` has no foreign key to `workspaces`

**Found by:** B08 capacity matrix. Three runs survived every harness reset and showed a
NULL workspace slug on inspection.
**Status:** open. Not urgent, quietly bad.

```sql
SELECT conname, confrelid::regclass FROM pg_constraint
 WHERE conrelid = 'agent_runs'::regclass AND contype = 'f';
--  agent_runs_workflow_id_fkey            | workflows
--  agent_runs_workflow_version_id_fkey    | workflow_versions
--  agent_runs_continued_from_run_id_fkey  | agent_runs
--  agent_runs_continued_to_run_id_fkey    | agent_runs
```

`workspace_id` and `environment_id` are on the table, carry no constraint, and are the
columns every tenant-scoped query filters on. Deleting a workspace therefore leaves its
runs behind pointing at an id that resolves to nothing.

Why that is worse than it sounds: **an orphaned run is invisible to every query that
scopes by workspace**, which is all of them. It does not appear on the Runs page, is not
counted by the Control page's in-flight number, is not covered by per-tenant limits, and
cannot be cleaned up by any workspace-scoped operation. It is simply a row that exists
and that nothing will ever look at again. If it is in a non-terminal state, the crash
recovery loop will keep picking it up forever — which is exactly what these three did.

It also means tenant isolation rests entirely on application code remembering to filter.
That is true today, but the database is not enforcing it, so a missed `WHERE workspace_id
= ?` is a cross-tenant read rather than a constraint violation.

Found in the harness rather than in production because the harness deletes workspaces
routinely and production does not. That is the only reason this has not bitten yet.

The fix is a migration adding the two constraints, which first needs a decision on
`ON DELETE`: `CASCADE` (deleting a workspace deletes its run history) or `RESTRICT`
(a workspace cannot be deleted while runs exist). `RESTRICT` plus an explicit purge is
almost certainly right for something that doubles as an audit trail, but it is a product
decision about data retention rather than a schema tidy-up, which is why it is recorded
here rather than done in passing.

Any existing orphans must be cleaned before either constraint can be added.
