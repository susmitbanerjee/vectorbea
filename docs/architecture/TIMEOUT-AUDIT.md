# Timeout Audit — worker-kotlin outbound I/O

**Scope:** every blocking outbound call the worker makes.
**Status:** every gap listed below is fixed in this change.
**Companion:** `/docs/architecture/09-EXECUTION-ARCHITECTURE-REVISED.md` §1.5, which
predicted the tenant-database gap. It was correct.

---

## 0. The rule this audit enforces

> A Kotlin `withTimeout` around a **blocking** call does not cancel it. It
> abandons the coroutine while the underlying thread stays parked on the socket —
> potentially forever.

The same is true of every application-level equivalent, and the worker used two
of them:

| Mechanism | What it actually bounds | What it does **not** bound |
|---|---|---|
| `withTimeout { }` | the coroutine | the thread inside a blocking call |
| `Future.get(timeout)` + `cancel(true)` | the *caller* | the worker thread — a `java.net.Socket` read does not respond to interrupt |
| `Statement.setQueryTimeout(n)` | a query on a **reachable** server | pgjdbc implements it by opening a *second* connection to send a cancel; against an unreachable host that connection hangs too |
| `HttpRequest.timeout(d)` | connect + time to **response headers** | body streaming — a server that sends `200 OK` then stalls has already satisfied it |

Only a bound below the application can unpark a thread blocked in a native
socket read: `socketTimeout` at the JDBC driver, or aborting the exchange at the
HTTP client. Everything in §2 follows from that.

**Why it matters here specifically.** The agent pool is
`max(1, WORKER_CONCURRENCY / 2)` = **2 slots, platform-wide**. Two permanently
blocked threads are the entire platform's agent capacity, and — as §1.5 of the
architecture doc warns — `failure_incidents.category` would report a timeout
that never actually fired.

---

## 1. Findings at a glance

| # | Component | Gap | Severity | Fixed in |
|---|---|---|---|---|
| 1 | Tenant JDBC pools | no `socketTimeout` / `loginTimeout` — **unbounded** | **Critical** | `JdbcTimeouts`, `ClientDbPoolManager` |
| 2 | Tenant JDBC pools | `connectionTestQuery` routes validation through the hanging cancel path | High | `ClientDbPoolManager` |
| 3 | Platform Postgres pool | same as #1, wider blast radius | High | `Database.kt` |
| 4 | LLM HTTP client | no total-call ceiling; body streaming unbounded | **Critical** | `OutboundHttp`, `LlmNodeExecutor` |
| 5 | LLM HTTP client | size cap applied *after* buffering the whole body | Medium | `OutboundHttp` |
| 6 | Tool HTTP client | `tools.timeout_ms` enforced only to response headers | **Critical** | `OutboundHttp`, `HttpNodeExecutor` |
| 7 | Built-in email | `HttpClient.newHttpClient()` — no connect timeout, new client per send | High | `ToolNodeExecutor` |
| 8 | Agent brain LLM call | new `HttpClient` **per agent iteration** — no connect timeout, leaks a selector thread | High | `AgentBrainRunner` |
| 9 | Telemetry | no connect timeout, **no request timeout at all**, unbounded thread pool | High | `TelemetryClient` |
| 10 | Node execution | `Future.cancel(true)` frees the slot but **leaks the blocked thread** onto an unbounded pool | **Critical** | `WorkflowRuntime` |
| 11 | Redis poll loop | default command timeout (3s) **below** default block window (5s) | Medium | `WorkerConfig` |

Findings 10 and 11 were discovered by running the load harness, not by reading
the code. They are noted as such.

---

## 2. Part A.1 — Tenant databases (`ClientDbPoolManager` / `ConnectionResolver`)

This is the dangerous one. `db_read` / `db_write` nodes open JDBC connections to
**the tenant's own database** — a host on the public internet that Vectorbea does
not control and cannot fix.

### 2.1 Before

Both construction paths were identical in the respects that matter
(`ClientDbPoolManager.kt`, host/port mode):

```kotlin
val hk = HikariConfig().apply {
    this.jdbcUrl = jdbcUrl
    driverClassName = driverFor(record.provider)
    poolName = "client-${record.id}"
    maximumPoolSize = maxConnectionsPerPool
    minimumIdle = 1
    connectionTimeout = connectionTimeoutMs
    idleTimeout = idleTimeoutMs
    maxLifetime = 1_800_000L
    connectionTestQuery = "SELECT 1"
    isRegisterMbeans = false
    leakDetectionThreshold = 60_000L
    // …
}
```

The JDBC URL came from `buildJdbcUrl(record)`, which carries `sslmode` and
nothing else:

```kotlin
"postgresql", "postgres" -> {
    val base = "jdbc:postgresql://$host:$port/$database"
    if (!sslMode.isNullOrBlank()) "$base?sslmode=$sslMode" else base
}
```

### 2.2 Configured values, as requested

| Setting | Before | Effective before | After | Where enforced |
|---|---|---|---|---|
| `connectTimeout` | **unset** | pgjdbc default 10s | **5s** | JDBC URL |
| `socketTimeout` | **unset** | **0 — infinite** | **30s** | JDBC URL |
| `loginTimeout` | **unset** | **0 — infinite** | **5s** | JDBC URL |
| `cancelSignalTimeout` | unset | pgjdbc default 10s | 5s | JDBC URL |
| `tcpKeepAlive` | unset | `false` | `true` | JDBC URL |
| Hikari `connectionTimeout` | 10 000 ms | 10 000 ms | 10 000 ms | HikariConfig |
| Hikari `validationTimeout` | **unset** | 5 000 ms, via the cancel path | **3 000 ms**, via `isValid()` | HikariConfig |
| Hikari `maxLifetime` | 1 800 000 ms | 1 800 000 ms | 1 800 000 ms | HikariConfig |
| Hikari `idleTimeout` | 300 000 ms | 300 000 ms | 300 000 ms | HikariConfig |
| Hikari `leakDetectionThreshold` | 60 000 ms | 60 000 ms | 60 000 ms | HikariConfig |
| `maximumPoolSize` | 3 | 3 | 3 | HikariConfig |

For MySQL, MariaDB and SQL Server, `connectTimeout` and `socketTimeout` were
likewise unset; those drivers express both in **milliseconds**, which the fix
accounts for.

### 2.3 Why `socketTimeout` is the one that matters

`DbReadNodeExecutor` already sets a query timeout:

```kotlin
conn.prepareStatement(rawQuery).use { stmt ->
    stmt.queryTimeout = timeoutSecs
    stmt.maxRows = maxRows
```

That is not sufficient, and the reason is specific: pgjdbc implements
`queryTimeout` by opening a **second** connection to the same server and sending
a cancel request. If the server is firewalled or wedged, that second connection
hangs exactly like the first. The timeout never fires. The thread is parked
forever.

`socketTimeout` is a `SO_TIMEOUT` on the socket, enforced by the JVM. It does not
require the peer to be reachable, cooperative, or alive. It is the only bound in
this path that always works.

The comment now in `DbReadNodeExecutor` records this so `queryTimeout` is not
mistaken for the real guard later.

### 2.4 Why the values are *forced*, not defaulted

Tenants may supply a whole connection string
(`connectionMode == "connection_string"`), and it is used verbatim as the JDBC
URL. A string containing `socketTimeout=0` — which means *no timeout* — would
opt that tenant out of the only bound protecting every other tenant.

`JdbcTimeouts.applyTo` therefore **overrides** an existing value whenever it is
absent, zero, negative, or above the policy ceiling:

```kotlin
private fun mustOverride(existing: String?, key: String, provider: String, t: OutboundTimeouts): Boolean {
    if (existing == null) return true
    val ceiling = ceilingFor(key, provider, t) ?: return true
    val current = existing.trim().toLongOrNull() ?: return true
    // <= 0 means "wait forever" for every driver we support.
    return current <= 0L || current > ceiling
}
```

A tenant may *tighten* a timeout. They may not remove it. `JdbcTimeoutsTest`
pins this behaviour, including the `socketTimeout=0` and `socketTimeout=86400`
cases.

### 2.5 `connectionTestQuery` — finding #2

`connectionTestQuery = "SELECT 1"` makes HikariCP validate with
`Statement.execute()`, bounded only by `setQueryTimeout` — the same cancel path
that hangs. Removing it makes HikariCP use JDBC4 `Connection.isValid(timeout)`,
which pgjdbc implements by lowering the socket timeout for the check. Validation
is then bounded by the socket rather than by the peer's willingness to answer a
cancel.

`connectionTestQuery` is now unset on both the tenant and platform pools, with
the rationale recorded at `JdbcTimeouts.applyPoolBounds`.

### 2.6 `ConnectionResolver`

`ConnectionResolver` and `SecretService` perform **no outbound I/O of their own**.
Both read through the worker's platform `DataSource` (`connections`,
`encrypted_secrets`), so they are covered by §3 and need no separate treatment.
`SecretService` decryption is pure CPU.

---

## 3. Part A.4 (first) — the platform Postgres pool

Not in the original brief, but it is the same defect with a wider blast radius:
every worker thread touches this pool for status transitions, `run_events`, and
lease renewal. `Database.create` set Hikari-level bounds and no driver-level
ones, so the URL carried no `socketTimeout`.

`Database.create` now routes its URL through the same `JdbcTimeouts.applyTo`, and
logs the effective values:

```
[db] HikariCP pool ready — driver: connectTimeout=5 socketTimeout=30 loginTimeout=5
     cancelSignalTimeout=5 tcpKeepAlive=true | hikari: connectionTimeout=30000ms
     validationTimeout=5000ms keepalive=300000ms maxLifetime=1800000ms leakDetection=60000ms
```

---

## 4. Part A.2 — LLM provider HTTP client

### 4.1 Before

```kotlin
private val httpClient: HttpClient = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(10))
    .build(),
```

```kotlin
val reqBuilder = HttpRequest.newBuilder()
    .uri(URI.create(url))
    .timeout(Duration.ofMillis(timeoutMs))
    .POST(HttpRequest.BodyPublishers.ofString(bodyJson))

val httpResponse = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString())

val responseBody = httpResponse.body() ?: ""

if (responseBody.length > maxResponseBytes) {
    throw LlmCallException("Response exceeded size limit …")
}
```

Two defects:

1. **`.timeout()` is not a total-call timeout.** The JDK stops counting once
   response *headers* arrive. A provider that returns `200 OK` and then trickles
   or stalls the body holds an agent-pool thread indefinitely. With two agent
   slots platform-wide, two such responses are the whole platform.
2. **The size cap is applied after the body is fully buffered** (finding #5).
   `responseBody.length` can only be evaluated once the string exists, so the cap
   documented the allocation rather than preventing it.

### 4.2 Reported values

| Setting | Before | After |
|---|---|---|
| connect | 10 s | **5 s** |
| headers | node `timeoutMs`, default 60 s | `min(30 s, totalCall)` |
| write | — (JDK has no separate write timeout) | covered by the total ceiling |
| **total call, incl. body** | **none** | node `timeoutMs`, clamped to **120 s** |
| max connections total | not configurable via the JDK API; unset | idle cache pinned to **64**; concurrency bounded by a **32-thread** executor |
| max connections per host | **not exposed by `java.net.http.HttpClient`** | — see §4.4 |

### 4.3 After

All outbound HTTP now goes through `OutboundHttp.send`, which applies four
independent bounds:

```kotlin
val future: CompletableFuture<HttpResponse<String>> =
    httpClient.sendAsync(request) { _ -> BoundedBodySubscriber(maxResponseBytes) }

val response = try {
    future.get(totalCallMs, TimeUnit.MILLISECONDS)
} catch (e: TimeoutException) {
    // Cancelling the future aborts the underlying exchange and closes the
    // connection, so the socket is released rather than merely abandoned.
    future.cancel(true)
    throw TotalCallTimeoutException(totalCallMs)
}
```

This works where `Future.cancel` on a blocking socket does not, because the
exchange runs on the HttpClient's own selector/executor threads and the JDK
honours cancellation by tearing the exchange down. The calling thread is bounded
by `get(totalCallMs)` and released either way.

`BoundedBodySubscriber` cancels the subscription mid-stream the moment the byte
budget is exceeded, so a 10 GB response is aborted rather than allocated.

### 4.4 An honest note on connection limits

`java.net.http.HttpClient` exposes **no** max-connections-total or
max-connections-per-host setting. Claiming otherwise would be false. What exists:

- `jdk.httpclient.connectionPoolSize` — the size of the **idle** connection
  cache, now pinned to 64.
- The client's `Executor` — now a fixed **32-thread** pool. This is the real
  ceiling on concurrent exchanges, and it is deliberately larger than the sum of
  the execution pools (8 + 2 + 2 + 2 = 14) so HTTP is never the bottleneck.

Per-host limiting would require a different HTTP client. That is a deliberate
non-goal here; the execution pools already bound per-tenant concurrency.

---

## 5. Part A.3 — Tool HTTP client, and whether `tools.timeout_ms` was real

**Direct answer to the question asked: no. `tools.timeout_ms` was not enforced
at the socket layer. It was passed to `HttpRequest.timeout()`, which bounds
connect plus time-to-headers only — and the body was then read with no read
timeout whatsoever.**

The value's journey: `tools.timeout_ms` → `ToolRow.timeoutMs` →
`syntheticConfig["timeoutMs"]` → `HttpNodeExecutor`:

```kotlin
val timeoutMs = (cfg["timeoutMs"] as? Number)?.toLong() ?: DEFAULT_TIMEOUT_MS

val reqBuilder = HttpRequest.newBuilder()
    .uri(URI.create(url))
    .timeout(Duration.ofMillis(timeoutMs))
```

and then the body:

```kotlin
val response = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofInputStream())
val body = response.body().use { ins -> readBounded(ins, maxResponseBytes) }
```

`readBounded` loops on `ins.read(buf)` with **no read timeout**. Once headers
arrive, `timeoutMs` is spent and the loop can block forever. The mock's
`/tool/stall` route reproduces this exactly: `200 OK`, a partial body, and then
silence.

The streaming size cap here was already correct — credit where due; it is the
one place the pattern was right, and `BoundedBodySubscriber` preserves it.

| Setting | Before | After |
|---|---|---|
| connect | 10 s | **5 s** |
| headers | `tools.timeout_ms`, default 30 s | `min(30 s, totalCall)` |
| **total call, incl. body** | **none** | `tools.timeout_ms`, clamped to **120 s** |
| response size | 2 MB, enforced while streaming ✓ | unchanged |

`timeoutMs` is now clamped by `OutboundTimeouts.clampTotalCallMs`, so a tool row
with `timeout_ms = 0` or `timeout_ms = 999999999` both land inside the ceiling —
a tool definition cannot configure an unbounded call.

---

## 6. Part A.4 — every other outbound path

The worker's complete outbound-I/O inventory, verified by searching for every
socket-opening construct (`HttpClient`, `Socket`, `URLConnection`, `DriverManager`,
Lettuce):

| Path | Before | After |
|---|---|---|
| **Built-in email** → `/api/email/send` | `HttpClient.newHttpClient()` — **no connect timeout**; a new client per send, each leaking a selector thread (`HttpClient` is not `AutoCloseable` on JDK 17); `.timeout(30s)` headers-only | shared client, 5 s connect, 30 s total |
| **Agent brain LLM** (`AgentBrainRunner`) | `HttpClient.newHttpClient()` **per agent iteration** — no connect timeout, one leaked selector thread per turn; `.timeout(config.timeoutMs)` headers-only | shared client, clamped total-call budget, latency recorded |
| **Telemetry** (`TelemetryClient`) | `HttpClient.newHttpClient()` — no connect timeout and **no request timeout at all**, on `Executors.newCachedThreadPool()`: a stalled endpoint grew one thread per tracked event, without limit | shared client, 5 s total; dispatch pool bounded to 4 threads / 256 queue, `DiscardPolicy` |
| **Webhooks** | none — the worker has no webhook sender. `webhook_wait` resolves to `NodeType.UNKNOWN` and is unsupported | n/a |
| **Provider health checks** | none in the worker — connection testing lives in `api-kotlin` | n/a |
| **Secret fetch** | no separate network path; reads the platform pool | covered by §3 |
| **Redis** (Lettuce) | command timeout configured, but see finding #11 | derived from the block window |

---

## 7. Finding #10 — the node-execution thread leak

Found by running the harness, not by reading the code, and it is the most subtle
item here.

`WorkflowRuntime.executeWithTimeout` does not execute nodes on the pool thread.
It dispatches to a separate executor and blocks the pool thread on the future:

```kotlin
val future = nodeTimeoutExecutor.submit<NodeResult> { executor.execute(node, resolvedInputs, ctx) }
return try {
    future.get(timeoutMs, TimeUnit.MILLISECONDS)
} catch (e: TimeoutException) {
    future.cancel(true)
    …
```

That executor was unbounded, under a comment asserting it could not grow:

```kotlin
// Pool used to enforce per-node execution timeouts. Thread count is naturally
// bounded by (worker concurrency × branch threads) since each caller blocks
// on its own future.
private val nodeTimeoutExecutor: ExecutorService = Executors.newCachedThreadPool { … }
```

The assertion holds only while every task eventually finishes. On timeout it
does not: `cancel(true)` *interrupts* the node thread, and a thread blocked in a
classic `java.net.Socket` read — which is what pgjdbc uses — does not respond to
interrupts.

So the observable behaviour was **better than expected in one way and worse in
another**. The execution slot *is* correctly released, so a hung tenant DB does
not hold a pool slot indefinitely. But the node thread never returns. On an
unbounded pool that is one permanently leaked thread per hung query, ending in
`OutOfMemoryError: unable to create native thread`.

Both halves are now fixed, and both are needed:

1. **Driver-level `socketTimeout`** (§2) so the read actually returns and the
   thread comes back. This is the real fix.
2. **A ceiling on the executor** so a burst cannot outrun (1) — bounded exactly
   like the `branchExecutor` beside it, with `CallerRunsPolicy` degrading to
   inline execution rather than unbounded growth. Inline execution is safe *now*
   precisely because (1) bounds it; before the socket timeouts existed, it would
   not have been.

This also explains the `thread_blocked_seconds{pool="node"}` series: outbound I/O
is served by `wf-node-*` threads while the class-pool thread waits on them. Two
threads are occupied; only one is on the socket. The metric attributes the
seconds to the thread actually blocked, which is what makes the distinction
visible.

---

## 8. Finding #11 — a timeout that fired during healthy operation

Also found by running the harness. On startup the worker logged, every iteration:

```
[queue] poll loop error: Command timed out after 3 second(s) — retrying in 2s
```

`REDIS_COMMAND_TIMEOUT_MS` defaulted to **3 000 ms** while
`WORKER_POLL_BLOCK_MS` defaulted to **5 000 ms**. The Lettuce command timeout was
below the `XREADGROUP BLOCK` window, so every *idle* poll — the normal case —
aborted as a timeout. The root `docker-compose.yml` sets `10000` and hides this;
a worker started from defaults spins on errors and never blocks cheaply.

The default is now derived rather than fixed:

```kotlin
redisCommandTimeoutMs = env("REDIS_COMMAND_TIMEOUT_MS")?.toLongOrNull()
    ?: (pollBlockMs + 5_000L),
```

---

## 9. Effective values, logged at startup

`OutboundTimeouts.logEffectiveValues()` runs before any pool or HTTP client is
built. Verbatim from a harness worker boot:

```
=== outbound I/O timeouts (effective) ===
  jdbc.connectTimeout        : 5s
  jdbc.socketTimeout         : 30s   <- bounds a hung tenant DB read
  jdbc.loginTimeout          : 5s
  jdbc.cancelSignalTimeout   : 5s
  tenantPool.connectionTimeout: 10000ms
  tenantPool.validationTimeout: 3000ms
  tenantPool.maxLifetime      : 1800000ms
  tenantPool.idleTimeout      : 300000ms
  tenantPool.leakDetection    : 60000ms
  tenantPool.maxSize          : 3 per connection record
  platformPool.validationTimeout: 5000ms
  platformPool.keepalive        : 300000ms
  http.connectTimeout        : 5000ms
  http.headersTimeout        : 30000ms
  http.totalCallCeiling      : 120000ms  <- clamps node timeoutMs
  http.defaultTotalCall      : 30000ms
  http.connectionPoolSize    : 64
  http.executorThreads       : 32  <- max concurrent exchanges
  telemetry.totalCall        : 5000ms
```

Each tenant pool additionally logs its own effective bounds on creation — never
the URL or credentials:

```
[clientdb] pool bounds [connId=…, provider=postgresql, mode=host-port]
  driver: connectTimeout=5 socketTimeout=30 loginTimeout=5 cancelSignalTimeout=5 tcpKeepAlive=true
  | hikari: connectionTimeout=10000ms validationTimeout=3000ms maxLifetime=1800000ms
    idleTimeout=300000ms leakDetection=60000ms maxPoolSize=3
```

### Environment overrides

| Variable | Default |
|---|---|
| `DB_CONNECT_TIMEOUT_SECONDS` | 5 |
| `DB_SOCKET_TIMEOUT_SECONDS` | 30 |
| `DB_LOGIN_TIMEOUT_SECONDS` | 5 |
| `DB_CANCEL_SIGNAL_TIMEOUT_SECONDS` | 5 |
| `TENANT_DB_POOL_CONNECTION_TIMEOUT_MS` | 10 000 |
| `TENANT_DB_POOL_VALIDATION_TIMEOUT_MS` | 3 000 |
| `TENANT_DB_POOL_MAX_SIZE` | 3 |
| `HTTP_CONNECT_TIMEOUT_MS` | 5 000 |
| `HTTP_HEADERS_TIMEOUT_MS` | 30 000 |
| `HTTP_TOTAL_CALL_CEILING_MS` | 120 000 |
| `HTTP_DEFAULT_TOTAL_CALL_MS` | 30 000 |
| `HTTP_EXECUTOR_THREADS` | 32 |
| `HTTP_CONNECTION_POOL_SIZE` | 64 |
| `TELEMETRY_TOTAL_CALL_MS` | 5 000 |
| `WORKER_MAX_NODE_THREADS` | 64 |

---

## 10. One deliberate security-surface change

The load harness cannot exercise HTTP tool nodes without one, because a mock
upstream necessarily lives on a loopback or private address, and `SsrfGuard`
blocks both. `SSRF_ALLOWED_TEST_HOSTS` was added, scoped as tightly as possible:

- **Ignored entirely when `APP_ENV=production`** — a stray variable on a
  production worker cannot open an egress path to the metadata service.
- **Exact host matches only** — no suffix or wildcard matching, unlike the
  per-connection `allowedHosts` list.
- Applied **after** the `localhost` / `metadata.google.internal` name block and
  **after** the per-connection allow-list, so it can only exempt a host from the
  address-range checks — nothing else.

It must never be set on a deployed worker.

---

## 11. What was already correct

Worth recording, so it is not "fixed" later by someone who assumes otherwise:

- `agent_runs` + `run_events` are committed **before** `XADD`, and flipped to
  `enqueue_failed` if the enqueue throws.
- `HttpNodeExecutor` enforced its response-size cap **while streaming** — the one
  place the pattern was already right.
- `stmt.maxRows` and the SELECT-only validation in `DbReadNodeExecutor`.
- Redis command timeouts were configured at all (finding #11 is the *value*, not
  the absence).
- The `ExecutionPoolRouter` slot accounting: a timed-out node correctly releases
  its execution slot. Finding #10 is about the thread behind it, not the slot.

---

## 13. Out of scope, but found — XAUTOCLAIM recovery is a silent no-op

Not a timeout defect, and **not fixed here** because fixing it changes when
parked work resumes, which is a scheduling behaviour change and this brief
excludes those. It is recorded because it is severe and because it distorts the
Part D baseline.

`WorkflowQueueConsumer.reclaimPendingMessages` does:

```kotlin
val messages = redis.xautoclaim(
    config.queueStream,
    XAutoClaimArgs.Builder.xautoclaim(consumer, pendingIdleMs, "0-0")
        .count(config.readBatchSize.toLong()),
) as? List<StreamMessage<String, String>> ?: return
```

On the pinned Lettuce version the sync signature is not a `List`:

```
$ javap -cp lettuce-core-6.3.2.RELEASE.jar io.lettuce.core.api.sync.RedisStreamCommands
  public abstract io.lettuce.core.models.stream.ClaimedMessages<K, V> xautoclaim(K, io.lettuce.core.XAutoClaimArgs<K>);
```

`as?` yields **null**, `?: return` exits, and the safe-cast raises nothing. There
is no exception, no log line, and no metric — the sweep has been doing nothing.

**Consequence.** §1.2 of the execution architecture describes parked messages as
recoverable "after idle-timeout + XAUTOCLAIM". In practice the XAUTOCLAIM half
never runs. A message this worker read but could not place stays in its PEL
until the process restarts. Measured directly in scenario 3: six runs `queued`,
all four pools idle, `worker_pel_depth` pinned at 6, and
`xautoclaim_reclaim_total` still `0` long past the 60 s idle threshold.

`worker_pel_depth` is what made this visible, and it is the metric to alert on:
**depth > 0 while `worker_pool_slots_active` is 0 for every pool** is precisely
this bug.

The fix is one property access — `redis.xautoclaim(...).messages` — plus a
regression test that would have caught the silent cast. It belongs with the
work that owns §2 of `09-EXECUTION-ARCHITECTURE-REVISED.md`.

---

## 12. Verification

- `gradle clean test` from `apps/worker-kotlin` — **178 tests, 0 failures**.
- `JdbcTimeoutsTest` pins the force-override semantics, per-driver units, the
  SQL Server semicolon form, idempotency, and the clamp.
- `node scripts/load/verify-timeouts.mjs` — the two shapes that previously had no
  end state, both now bounded:

  ```
  ✓ tool-stall:     failed after 16.3s (node budget 15s)
  ✓ tenant-db-hang: failed after  7.4s (loginTimeout 5s)
  PASS — both calls are bounded.
  ```

- Scenario 5 of the load harness — a hanging tenant database alongside five
  normal tenants — now completes all nine runs, with `socket/timeout=4`
  classifying every hung query. Full results and the before/after comparison are
  in `/docs/architecture/LOAD-BASELINE.md`.

Scheduling behaviour is unchanged by this work, as instructed. Pool sizes, the
classifier, the tenant limiter, the ack semantics, and the (defective) reclaim
path are all untouched.

---

## 14. Recommended next steps, in order

1. **Fix XAUTOCLAIM** (§13) — one property access. Until it lands, any run parked
   behind a saturated pool is stranded until the process restarts. It is the
   single highest-value change on this list and it is not in this one.
2. **Fix the classifier's node count.** `JobClassifier.classifyGraph` counts
   `"type":` across the whole graph JSON, and edges carry a `type` field, so a
   7-node / 6-edge workflow counts as 13 and is routed to the 2-slot LONG pool
   instead of the 8-slot SHORT one. Measured in `LOAD-BASELINE.md`; §2.1 of the
   execution architecture removes the probe entirely.
3. **Add buckets to `job_wait_before_start_seconds`** between 10 s and 120 s
   before making wait-before-start an SLO — see the histogram note in the
   baseline.
4. **Reserve slots per tenant.** The timeout work bounds *how long* one tenant's
   broken dependency holds shared slots; it does not stop it holding them. Only
   reservation removes that.
