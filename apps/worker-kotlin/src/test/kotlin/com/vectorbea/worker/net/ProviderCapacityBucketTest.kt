package com.vectorbea.worker.net

import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §12.4 — the provider capacity bucket.
 *
 * ── THE LOAD TEST, AND WHAT IT SIMULATES ────────────────────────────────────
 * The acceptance criterion is that the bucket prevents provider 429s under a
 * load that reliably produces them without it. There is no provider to call in a
 * unit test, so the provider is modelled as what it actually is: a counter over
 * a sliding minute that returns 429 the moment the tokens charged to it in that
 * window exceed its limit. [FakeProvider] below is exactly that and nothing more.
 *
 * The control arm is the same workload with the bucket disabled, and it is
 * asserted to FAIL — a load test that does not produce 429s without the fix
 * proves nothing about the fix.
 */
class ProviderCapacityBucketTest {

    /* One account throughout: these tests are about the bucket's arithmetic, and
       the credential layer has its own suite. */
    private val ACCT = "acct-test"


    private val ws: UUID = UUID.randomUUID()

    /**
     * `burst = 1.0` by default here so that DEPTH == the number the test passes,
     * which keeps the grant/refuse/settle assertions readable arithmetic.
     *
     * Production defaults to 0.2, which splits the limit into depth and refill so
     * that no 60-second window can admit more than the limit — see the class doc.
     * The load test below uses the production default, because that split is
     * exactly what it exists to verify.
     */
    private fun bucket(
        capacity: Long,
        enabled: Boolean = true,
        floor: Double = 0.2,
        burst: Double = 1.0,
        backend: CapacityBackend = InProcessCapacityBackend(),
        /* Effectively unlimited by default, so a test about tokens is never
           silently bound by the request dimension and passing for the wrong
           reason. The RPM tests set it deliberately. */
        rpm: Long = 1_000_000,
        /* Off by default: most tests here have one workspace, where the fairness
           layer has nothing to do and would only obscure the arithmetic. */
        borrow: Double = 0.0,
    ) = ProviderCapacityBucket(
        backend = backend,
        limits = ProviderCapacityBucket.CapacityLimits(
            ProviderCapacityBucket.Limit(requestsPerMinute = rpm, tokensPerMinute = capacity),
            emptyMap()),
        enabled = enabled,
        interactiveFloor = floor,
        borrowFloor = borrow,
        burstFraction = burst,
    )

    /**
     * A provider with a per-minute token limit.
     *
     * Sliding window over real timestamps rather than a fixed bucket, because a
     * fixed window lets a caller spend the whole limit at 59.9s and again at
     * 60.1s — and a test that permits that would let a real burst through.
     */
    /**
     * A provider that enforces REQUESTS and TOKENS per minute, separately.
     *
     * It used to enforce tokens alone, which made the load test unable to see the
     * failure that was actually happening in production: an agent loop is many
     * small requests, so RPM is exhausted while the token window is nearly empty.
     * A fake that models one dimension cannot fail a bucket that models one
     * dimension, and both were wrong in the same direction.
     *
     * `rejections` counts 429s by cause, so a test can assert not just that the
     * provider refused but which limit refused it.
     */
    private class FakeProvider(
        private val tokensPerMinute: Long,
        private val requestsPerMinute: Long = Long.MAX_VALUE,
    ) {
        private val charges = java.util.Collections.synchronizedList(mutableListOf<Pair<Long, Long>>())
        val rejections = AtomicLong()
        val rejectedOnRequests = AtomicLong()
        val rejectedOnTokens = AtomicLong()

        /** Returns false for a 429. */
        fun call(tokens: Long, nowMs: Long): Boolean = synchronized(charges) {
            charges.removeAll { it.first < nowMs - 60_000 }
            val usedTokens = charges.sumOf { it.second }
            val usedRequests = charges.size.toLong()
            if (usedRequests + 1 > requestsPerMinute) {
                rejections.incrementAndGet(); rejectedOnRequests.incrementAndGet()
                return@synchronized false
            }
            if (usedTokens + tokens > tokensPerMinute) {
                rejections.incrementAndGet(); rejectedOnTokens.incrementAndGet()
                return@synchronized false
            }
            charges.add(nowMs to tokens)
            true
        }
    }

    // ── The rules ─────────────────────────────────────────────────────────────

    @Test
    fun `a disabled bucket never interferes`() {
        val b = bucket(capacity = 1, enabled = false)
        repeat(100) {
            assertTrue(b.reserve("anthropic", "m", ACCT, ws, 1_000_000, interactive = false)
                is ProviderCapacityBucket.Outcome.NotApplicable)
        }
    }

    @Test
    fun `a reservation is granted while there is room and refused when there is not`() {
        val b = bucket(capacity = 1_000, floor = 0.0)
        assertTrue(b.reserve("p", "m", ACCT, ws, 600, false) is ProviderCapacityBucket.Outcome.Granted)
        assertTrue(b.reserve("p", "m", ACCT, ws, 300, false) is ProviderCapacityBucket.Outcome.Granted)
        val third = b.reserve("p", "m", ACCT, ws, 300, false)
        assertTrue(third is ProviderCapacityBucket.Outcome.Exhausted,
            "the bucket had 100 tokens left and 300 were asked for")
        assertTrue((third as ProviderCapacityBucket.Outcome.Exhausted).retryAfterMs > 0,
            "a refusal must say when to come back, or the caller has nothing to schedule")
    }

    /**
     * The lease-and-return half. An over-estimate must not permanently consume
     * capacity the call never used, or a fleet that estimates high throttles
     * itself into idleness.
     */
    @Test
    fun `settling an over-estimate returns the surplus`() {
        val b = bucket(capacity = 1_000, floor = 0.0)
        val lease = (b.reserve("p", "m", ACCT, ws, 900, false)
            as ProviderCapacityBucket.Outcome.Granted).lease
        assertTrue(b.reserve("p", "m", ACCT, ws, 500, false) is ProviderCapacityBucket.Outcome.Exhausted)

        b.settle(lease, actualTokens = 100)   // it only cost 100; 800 come back
        assertTrue(b.reserve("p", "m", ACCT, ws, 500, false) is ProviderCapacityBucket.Outcome.Granted)
    }

    /**
     * An under-estimate is debited, not forgiven.
     *
     * Forgiving it would make the bucket a suggestion: a fleet that consistently
     * estimates low would sail past the provider's limit while every individual
     * reservation looked fine.
     */
    @Test
    fun `settling an under-estimate debits the shortfall`() {
        val b = bucket(capacity = 1_000, floor = 0.0)
        val lease = (b.reserve("p", "m", ACCT, ws, 100, false)
            as ProviderCapacityBucket.Outcome.Granted).lease
        b.settle(lease, actualTokens = 900)   // it really cost 900

        val next = b.reserve("p", "m", ACCT, ws, 500, false)
        assertTrue(next is ProviderCapacityBucket.Outcome.Exhausted,
            "the 800-token shortfall must reduce what the next caller can draw")
    }

    // ── Interactive lanes draw first ──────────────────────────────────────────

    /**
     * The priority rule, stated as the only thing it actually promises: batch
     * work cannot take the last 20%, and interactive work can.
     */
    @Test
    fun `batch stops at the floor and interactive does not`() {
        val b = bucket(capacity = 1_000, floor = 0.2)

        // Batch draws down to the 200-token floor and stops.
        assertTrue(b.reserve("p", "m", ACCT, ws, 800, interactive = false)
            is ProviderCapacityBucket.Outcome.Granted)
        assertTrue(b.reserve("p", "m", ACCT, ws, 100, interactive = false)
            is ProviderCapacityBucket.Outcome.Exhausted,
            "batch must not draw into the interactive reserve")

        // The interactive run that arrives next still gets served.
        assertTrue(b.reserve("p", "m", ACCT, ws, 150, interactive = true)
            is ProviderCapacityBucket.Outcome.Granted,
            "the reserve exists precisely so this call succeeds")
    }

    /** A fan-out cannot starve an interactive run that arrives after it. */
    @Test
    fun `a saturating fan-out leaves the interactive reserve intact`() {
        val b = bucket(capacity = 100_000, floor = 0.2)
        var granted = 0
        repeat(200) {                         // 200 children, 1k tokens each
            if (b.reserve("p", "m", ACCT, ws, 1_000, interactive = false)
                is ProviderCapacityBucket.Outcome.Granted) granted++
        }
        assertEquals(80, granted, "batch should have been cut off at the 80% mark")
        repeat(20) {
            assertTrue(b.reserve("p", "m", ACCT, ws, 1_000, interactive = true)
                is ProviderCapacityBucket.Outcome.Granted)
        }
    }

    // ── Fail open ─────────────────────────────────────────────────────────────

    /**
     * A backend that throws must not stop provider calls.
     *
     * The bucket is an optimisation over the 429 handling that already exists.
     * If it cannot be consulted, the correct behaviour is the behaviour of every
     * deployment before it existed — not a stalled fleet.
     */
    @Test
    fun `an unreachable backend fails open`() {
        val broken = object : CapacityBackend {
            override fun reserve(req: CapacityBackend.Request): CapacityBackend.Result =
                throw RuntimeException("redis down")
            override fun settle(
                key: String, workspaceId: String, leaseId: String, delta: Long, depth: Long,
            ) = throw RuntimeException("redis down")
            override fun peek(
                key: String, tokenDepth: Long, tokenRefill: Long,
                requestDepth: Long, requestRefill: Long, nowMs: Long,
            ): CapacityBackend.Available = throw RuntimeException("redis down")
        }
        val b = bucket(capacity = 1_000, backend = broken)
        assertTrue(b.reserve("p", "m", ACCT, ws, 100, false) is ProviderCapacityBucket.Outcome.NotApplicable)
        // And settling a lease against it must not propagate either.
        b.settle(ProviderCapacityBucket.Lease("k", ws, 100, 1_000), 50)
    }

    // ── The load test ─────────────────────────────────────────────────────────

    /**
     * 200 concurrent workers against a provider limited to 60k tokens/minute.
     *
     * WITHOUT the bucket this reliably produces 429s — that is asserted first,
     * because a control arm that passes makes the experimental arm meaningless.
     * WITH the bucket at the provider's own limit, the provider sees none.
     */
    @Test
    fun `the bucket prevents 429s under a load that reliably causes them`() {
        val limit = 60_000L
        val workers = 200
        val callsEach = 20
        val tokensPerCall = 500L

        // Control: no bucket. 200 × 20 × 500 = 2,000,000 tokens against a 60k limit.
        val without = drive(workers, callsEach, tokensPerCall, limit, bucket = null)
        assertTrue(without > 0,
            "the control arm produced no 429s, so this load does not test anything")

        /* Treatment: the same load, configured with the provider's own limit and
           the PRODUCTION burst split. Configuring the raw limit as bucket depth is
           what produced 19 rejections and is the defect this split fixes. */
        val with = drive(workers, callsEach, tokensPerCall, limit,
            bucket = bucket(capacity = limit, floor = 0.0, burst = 0.2))
        assertEquals(0L, with,
            "the bucket must keep the fleet inside the provider's limit; saw $with rejection(s)")
    }

    /**
     * ACCEPTANCE: the same, against a REQUESTS-per-minute limit.
     *
     * ── WHY THIS IS THE TEST THAT MATTERS ───────────────────────────────────
     * This is the shape production actually had. Many small calls: the token
     * window stays nearly empty while the request window is exhausted, so a
     * token-only bucket admits every one of them and reports itself healthy
     * throughout. The control arm proves the load still generates 429s; the
     * treatment arm proves the request dimension is what stops them.
     *
     * The token limit is set generously on purpose. If it bound anything, this
     * test would pass for the wrong reason and would keep passing if the request
     * dimension were deleted.
     */
    @Test
    fun `the bucket prevents 429s caused by request rate, not token volume`() {
        val rpm = 600L
        val generousTpm = 100_000_000L
        val workers = 200
        val callsEach = 20
        val tokensPerCall = 10L        // tiny: an agent iteration, not a document

        val without = driveBoth(workers, callsEach, tokensPerCall, generousTpm, rpm, bucket = null)
        assertTrue(without.first > 0,
            "the control arm produced no 429s, so this load does not test anything")
        assertTrue(without.second > 0,
            "the control arm's 429s were not caused by the request limit, so this " +
            "test is not exercising the dimension it exists for")

        val with = driveBoth(workers, callsEach, tokensPerCall, generousTpm, rpm,
            bucket = bucket(capacity = generousTpm, floor = 0.0, burst = 0.2, rpm = rpm))
        assertEquals(0L, with.first,
            "the request dimension must keep the fleet inside the provider's RPM; " +
            "saw ${with.first} rejection(s)")
    }

    /**
     * ACCEPTANCE: two workspaces sharing one credential cannot together exceed
     * the account's limit.
     *
     * ── THE BUG THIS IS THE TEST FOR ────────────────────────────────────────
     * The bucket was keyed `(provider, model, workspace_id)` on the assumption
     * that a credential belongs to one workspace. Nothing enforces that, and when
     * it is false a per-workspace bucket bounds nothing: two workspaces each
     * politely staying inside their own limit send twice the account's.
     *
     * Both workspaces here pass the SAME fingerprint, which is what a shared API
     * key produces. The provider sees one account and one limit.
     */
    @Test
    fun `two workspaces sharing a credential cannot exceed the account limit`() {
        val limit = 30_000L
        val provider = FakeProvider(tokensPerMinute = limit)
        val b = bucket(capacity = limit, floor = 0.0, burst = 0.2)
        val wsA = UUID.randomUUID()
        val wsB = UUID.randomUUID()
        val sharedKey = "shared-account-fingerprint"

        val pool = Executors.newFixedThreadPool(64)
        val go = java.util.concurrent.CountDownLatch(1)
        val done = java.util.concurrent.CountDownLatch(120)
        val deadline = System.currentTimeMillis() + 8_000
        try {
            repeat(120) { i ->
                val ws = if (i % 2 == 0) wsA else wsB
                pool.submit {
                    try {
                        go.await()
                        var made = 0
                        while (made < 10 && System.currentTimeMillis() < deadline) {
                            when (val o = b.reserve("anthropic", "m", sharedKey, ws, 500L, false)) {
                                is ProviderCapacityBucket.Outcome.Granted -> {
                                    provider.call(500L, System.currentTimeMillis())
                                    made++
                                    b.settle(o.lease, 500L)
                                }
                                is ProviderCapacityBucket.Outcome.Exhausted ->
                                    Thread.sleep(minOf(o.retryAfterMs, 200L))
                                else -> made++
                            }
                        }
                    } finally { done.countDown() }
                }
            }
            go.countDown()
            done.await(20, TimeUnit.SECONDS)
        } finally { pool.shutdownNow() }

        assertEquals(0L, provider.rejections.get(),
            "two workspaces on ONE credential drove the account past its limit — " +
            "the ceiling is not keyed on what the provider counts")
    }

    /**
     * A workspace inside its share is not starved by one that is borrowing.
     *
     * The second half of the fairness layer. The first — that the account ceiling
     * holds — is asserted above; this asserts the ceiling is not enforced by
     * simply letting whoever arrives first take everything.
     */
    @Test
    fun `a busy workspace cannot starve a quiet one on the same credential`() {
        val b = bucket(capacity = 10_000, floor = 0.0, burst = 1.0, borrow = 0.25)
        val hog = UUID.randomUUID()
        val quiet = UUID.randomUUID()
        val acct = "one-account"

        /*
         * ── BOTH WORKSPACES MUST BE ACTIVE FIRST, AND THAT IS NOT A SETUP
         *    DETAIL ────────────────────────────────────────────────────────
         *
         * The share is `depth / activeWorkspaces`, and a workspace that has never
         * called is not active. With only the hog running, its share IS the whole
         * bucket — which is correct and is the point of borrowing: capacity nobody
         * is asking for should not sit idle.
         *
         * The first version of this test omitted these two calls and failed. It
         * was right to: with `quiet` unknown to the bucket, the hog drew the
         * account to zero entirely within its own share, and no fairness rule can
         * hand out tokens that do not exist. The guarantee is against STARVATION
         * between workspaces that are both asking, which is the situation that
         * actually occurs, and it is what is asserted here.
         */
        b.reserve("p", "m", acct, hog, 200L, false)
        b.reserve("p", "m", acct, quiet, 200L, false)

        /* Now the hog pushes. It draws freely inside its share, then borrows down
           to the floor, and must stop there. */
        var granted = 0
        repeat(200) {
            if (b.reserve("p", "m", acct, hog, 200L, false) is ProviderCapacityBucket.Outcome.Granted) {
                granted++
            }
        }
        assertTrue(granted > 0, "the hog got nothing, so this test proves nothing")

        assertTrue(b.reserve("p", "m", acct, quiet, 200L, false)
            is ProviderCapacityBucket.Outcome.Granted,
            "a workspace still inside its share was refused while another workspace " +
            "on the same credential was borrowing — the borrow floor is not held, and " +
            "one tenant can starve another on a shared account")
    }

    /**
     * Run the workload and return how many 429s the provider issued.
     *
     * A refused reservation is NOT a failure and is not retried in a hot loop:
     * production turns it into `NodeResult.Throttled`, which parks the run on a
     * timer and gives the permit back. The sleep here stands in for that park,
     * and keeping it faithful matters — a version that spun would measure the
     * spin rather than the bucket.
     */
    private fun drive(
        workers: Int, callsEach: Int, tokensPerCall: Long, limit: Long,
        bucket: ProviderCapacityBucket?,
    ): Long {
        val provider = FakeProvider(limit)
        val pool = Executors.newFixedThreadPool(minOf(workers, 32))
        val go = CountDownLatch(1)
        val done = CountDownLatch(workers)
        val deadline = System.currentTimeMillis() + 10_000

        repeat(workers) {
            pool.submit {
                try {
                    go.await()
                    var made = 0
                    while (made < callsEach && System.currentTimeMillis() < deadline) {
                        val lease = when (val o = bucket?.reserve(
                            "anthropic", "claude-opus-5", ACCT, ws, tokensPerCall,
                            interactive = false)) {
                            null -> null                                   // unmetered control arm
                            is ProviderCapacityBucket.Outcome.Granted -> o.lease
                            is ProviderCapacityBucket.Outcome.Exhausted -> {
                                // The yield: stand down and come back.
                                Thread.sleep(minOf(o.retryAfterMs, 200L))
                                continue
                            }
                            else -> null
                        }
                        provider.call(tokensPerCall, System.currentTimeMillis())
                        made++
                        lease?.let { bucket?.settle(it, tokensPerCall) }
                    }
                } catch (_: InterruptedException) {
                } finally {
                    done.countDown()
                }
            }
        }
        go.countDown()
        done.await(30, TimeUnit.SECONDS)
        pool.shutdownNow()
        return provider.rejections.get()
    }

    /**
     * Like [drive], but the provider enforces both limits and the result says
     * which one refused.
     *
     * Returns (total 429s, 429s attributed to the REQUEST limit). The second half
     * is what makes the control arm meaningful: a control that produced only
     * token-limit 429s would not be testing the request dimension at all.
     */
    private fun driveBoth(
        workers: Int, callsEach: Int, tokensPerCall: Long,
        tpm: Long, rpm: Long, bucket: ProviderCapacityBucket?,
    ): Pair<Long, Long> {
        val provider = FakeProvider(tokensPerMinute = tpm, requestsPerMinute = rpm)
        val pool = Executors.newFixedThreadPool(64)
        val go = java.util.concurrent.CountDownLatch(1)
        val done = java.util.concurrent.CountDownLatch(workers)
        val deadline = System.currentTimeMillis() + 10_000
        try {
            repeat(workers) {
                pool.submit {
                    try {
                        go.await()
                        var made = 0
                        while (made < callsEach && System.currentTimeMillis() < deadline) {
                            val lease = when (val o = bucket?.reserve(
                                "anthropic", "claude-opus-5", ACCT, ws, tokensPerCall,
                                interactive = false)) {
                                null -> null
                                is ProviderCapacityBucket.Outcome.Granted -> o.lease
                                is ProviderCapacityBucket.Outcome.Exhausted -> {
                                    Thread.sleep(minOf(o.retryAfterMs, 200L)); continue
                                }
                                else -> null
                            }
                            provider.call(tokensPerCall, System.currentTimeMillis())
                            made++
                            lease?.let { bucket?.settle(it, tokensPerCall) }
                        }
                    } finally { done.countDown() }
                }
            }
            go.countDown()
            done.await(30, TimeUnit.SECONDS)
        } finally { pool.shutdownNow() }
        return provider.rejections.get() to provider.rejectedOnRequests.get()
    }

    // ── Redis parity ──────────────────────────────────────────────────────────

    /**
     * The Lua and [BucketMath] are the same arithmetic written twice, and this is
     * the only thing that keeps them in step.
     *
     * ── THIS TEST USED TO SKIP, AND THAT WAS THE WHOLE PROBLEM ─────────────
     * It opened `assumeTrue(redis != null, "the Lua path is NOT covered")`, which
     * is a PASS on every machine without a Redis — including CI, which has never
     * had one. The Lua in `RESERVE_LUA` was therefore executed by nothing,
     * anywhere, ever: a typo in it would have shipped and only shown up as a
     * fleet that stopped rate-limiting itself.
     *
     * It is now tagged `integration` and takes its Redis from [Infra], which
     * throws rather than skips.
     */
    @org.junit.jupiter.api.Tag("integration")
    @Test
    fun `the redis backend agrees with the in-process one`() {
        val redis = com.vectorbea.worker.testsupport.Infra.redis()
        val key = "captest:${UUID.randomUUID()}"
        val inProc = InProcessCapacityBackend()
        val onRedis = RedisCapacityBackend(redis!!)
        try {
            var now = 1_000_000L
            repeat(50) { i ->
                now += 500
                val want = 50L + i * 7
                val leaseId = "lease-$i"
                /* Both dimensions, and both floors, so the parity check covers
                   the fairness arithmetic and not only the token maths. */
                fun req(k: String) = CapacityBackend.Request(
                    key = k, workspaceId = ws.toString(),
                    tokenDepth = 1_000, tokenRefillPerMinute = 800,
                    requestDepth = 20, requestRefillPerMinute = 16,
                    wantTokens = want, laneFloorFraction = 0.2, borrowFloorFraction = 0.25,
                    nowMs = now, leaseId = leaseId, leaseTtlMs = 60_000)
                val a = inProc.reserve(req(key))
                val b = onRedis.reserve(req(key))
                assertEquals(a.granted, b.granted, "granted disagreed at step $i")
                if (!a.granted) {
                    assertEquals(a.retryAfterMs, b.retryAfterMs, "retryAfterMs disagreed at step $i")
                    assertEquals(a.boundBy, b.boundBy, "bounding dimension disagreed at step $i")
                }
                if (a.granted) {
                    inProc.settle(key, ws.toString(), leaseId, want / 2, 1_000)
                    onRedis.settle(key, ws.toString(), leaseId, want / 2, 1_000)
                }
            }
        } finally {
            runCatching { redis.del(key) }
        }
    }
}
