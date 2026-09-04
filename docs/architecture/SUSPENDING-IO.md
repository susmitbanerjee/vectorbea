# Suspending I/O — status

Implements §2.3 of `09-EXECUTION-ARCHITECTURE-REVISED.md`: convert execution
slots from threads to permits so that waiting stops costing capacity.

**This is a partial delivery.** The structural conversion is complete and
verified; the payoff is not yet realised, because the LLM and tool executors
still call the blocking client. What that means precisely is in §4, and the
measured evidence for it is in §3.

---

## 1. What landed

| Item | Status |
|---|---|
| 4 · Slots become semaphore permits | ✅ done |
| — Suspend propagation through the whole execution path | ✅ done |
| 3 · Tenant DB contained + per-tenant sub-limits | ✅ done |
| 1/2 · Ktor suspending clients | ⚠️ **built and verified, not wired into the executors** |
| 5 · Blocking-call audit + BlockHound | ❌ not started |
| 6 · Provider rate limiting + 429 → timers | ❌ not started |
| 7 · Payload cap + heap measurement | ❌ not started |
| Verify · full S01 matrix + capacity table | ❌ not done |

`gradle test`: **187 tests, 0 failures.** Worker starts, executes, and completes
runs against the load harness.

### Slots are permits

`ExecutionPoolRouter` (fixed thread pools) is replaced by `ExecutionSlots`
(`kotlinx.coroutines.sync.Semaphore` per class). The consumer-facing API is
unchanged — `availableCapacity`, `capacityOf`, `submit`, `utilization` — so the
typed-stream consumers were a one-line type change.

Confirmed at startup:

```
[slots] permit-based execution — short=8 long=2 agent=6 system=2 (total 18 permits)
        on 16 dispatcher threads. A slot is a permit, not a thread.
```

Permits are still at the S02 values, deliberately. Raising them to the §2.3
targets (short 400 / long 100 / agent 200 / system 20) before the I/O actually
suspends would just queue coroutines behind blocking calls and produce a
confident-looking number that means nothing.

### The execution path suspends end to end

`NodeExecutor.execute` is now `suspend`, and that propagates through:

```
TypedStreamConsumer.processAndAck
  → RunProcessor.process / processStartRun / processResumeRun / …
    → WorkflowRuntime.execute / resume
      → runDag → executeSingleNode → executeGuardedWithRetry
        → executeWithTimeout
          → NodeExecutor.execute
```

Two rewrites inside that chain matter more than the signature changes:

**`executeWithTimeout`** previously submitted a `Callable` to a thread pool and
called `future.get(timeout)` on the caller — two threads per node, one running it
and one parked waiting, and the parked one was the execution slot. It is now
`withTimeoutOrNull { … }`: no second thread, and the timeout is cooperative
cancellation rather than an abandoned future. `WorkflowRuntime` no longer creates
any thread pool of its own.

**Parallel branches** were `CompletableFuture.supplyAsync(…, branchExecutor)`.
They are now `coroutineScope { … async { … } }`, so an eight-way fan-out is eight
continuations rather than eight threads, and sibling cancellation is structural.

### Tenant DB: contained, and now per tenant

`TenantDbDispatcher.withTenantDbContext(workspaceId) { … }` runs blocking JDBC in
`withContext` on the bounded dispatcher — the coroutine suspends, one dispatcher
thread blocks. Added on top: a per-workspace `Semaphore` inside the dispatcher
(`TENANT_DB_MAX_PER_TENANT`, default `maxThreads / 4`), so one tenant with a
black-hole database can no longer consume all 16 threads and starve every other
tenant's database node. That closes **TECH-DEBT.md#D2**.

### Ktor clients exist and self-verify

`SuspendingHttp` builds two CIO clients — LLM at 100 total / 50 per host, tools at
100 total / 20 per host — and `verifyConnectionLimits()` reads the values back off
the engine config at startup and logs an error if they did not take effect.

That check is there because of the specific trap in the brief: engines default to
roughly 5 connections per host, and that cap silently serialises everything.
Raising the agent semaphore to 200 while the client will only open 5 connections
to `api.openai.com` buys nothing — 195 coroutines queue *inside the engine*,
invisible to every metric the worker exposes. A limit you have not read back is a
limit you do not have.

---

## 2. What this does not yet do

**The executors still call the blocking client.** `LlmNodeExecutor` and
`HttpNodeExecutor` continue to use `OutboundHttp` (JDK `HttpClient`, blocking
`future.get`). `SuspendingHttp` is constructed, configured and verified — and
currently unused.

So today a node suspends *around* its I/O but the I/O itself still parks a
dispatcher thread. The concurrency ceiling has moved from the class pools to the
16-thread execution dispatcher, which is not the intended outcome and is not an
improvement worth claiming.

---

## 3. The measurement that proves it

One 8-turn agent run, 800 ms mocked latency per turn, on the converted worker:

```
runs completed : 1
wall clock     : 10.3s
peak slots     : agent=1
jvm            : 66 threads, 62 MB heap
thread-seconds blocked on outbound I/O: exec=6.6s
```

**`exec=6.6s` is the finding.** Eight turns × 800 ms = 6.4 s, and all of it was
spent with a `vectorbea-worker-exec-*` dispatcher thread blocked. If the LLM call
were suspending, that counter would be near zero and the time would show as
suspended rather than blocked.

That single number is the honest status of this work: the scaffolding is correct,
and the thing it was built to enable has not been switched on.

---

## 4. What remains, in order

1. **Wire `SuspendingHttp` into `LlmNodeExecutor` and `HttpNodeExecutor`**
   (replacing `OutboundHttp.send`), and rework the two test doubles that inject a
   `java.net.http.HttpClient`. This is the step that turns the conversion into
   capacity. Success criterion: `thread_blocked_seconds{pool="exec"}` drops to
   near zero for the same agent run.
2. **Raise the permits** to the §2.3 targets, only after (1).
3. **BlockHound in test** — with suspending I/O in place, one stray blocking call
   silently serialises everything behind it, and it is invisible without a tool
   that fails the build on it. Also grep for `Thread.sleep`, blocking JDBC and
   synchronous file I/O inside `suspend` functions and report each.
4. **Provider rate limiting** — Redis token bucket per connection; on 429 respect
   `Retry-After` and suspend the run via `workflow_timers` rather than holding a
   permit while waiting. At 200 in-flight agent steps this becomes the binding
   constraint, not threads.
5. **Memory** — cap inline payloads at 256 KB with offload above, measure heap per
   in-flight step at target concurrency, and set the permit counts from that
   measurement.
6. **Re-run the full S01 matrix** and publish the capacity table: max sustained
   concurrent steps per replica, heap at that level, thread count (which should
   stay flat — that is the proof), and p95 wait-before-start.

Until step 6 there is **no measured capacity claim to make**. The "~10×" in §2.3
is the design's estimate, not an observation, and nothing here has tested it.

---

## 5. Risk note

This change rewrites the execution core of a shipping product. It is green — 187
tests pass and the worker executes runs correctly against the harness — but it
has only been exercised at single-run concurrency. Before it goes anywhere near
production it needs step 1, then the full matrix at realistic concurrency, and
particularly a check on cancellation and shutdown behaviour under load: the
switch from `Future.cancel` to structured cancellation changes what happens to
in-flight work when a run is cancelled or a worker drains.
