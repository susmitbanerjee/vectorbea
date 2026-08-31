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
    ) = ProviderCapacityBucket(
        backend = backend,
        limits = ProviderCapacityBucket.CapacityLimits(capacity, emptyMap()),
        enabled = enabled,
        interactiveFloor = floor,
        burstFraction = burst,
    )

    /**
     * A provider with a per-minute token limit.
     *
     * Sliding window over real timestamps rather than a fixed bucket, because a
     * fixed window lets a caller spend the whole limit at 59.9s and again at
     * 60.1s — and a test that permits that would let a real burst through.
     */
    private class FakeProvider(private val limitPerMinute: Long) {
        private val charges = java.util.Collections.synchronizedList(mutableListOf<Pair<Long, Long>>())
        val rejections = AtomicLong()

        /** Returns false for a 429. */
        fun call(tokens: Long, nowMs: Long): Boolean = synchronized(charges) {
            charges.removeAll { it.first < nowMs - 60_000 }
            val used = charges.sumOf { it.second }
            if (used + tokens > limitPerMinute) {
                rejections.incrementAndGet()
                false
            } else {
                charges.add(nowMs to tokens)
                true
            }
        }
    }

    // ── The rules ─────────────────────────────────────────────────────────────

    @Test
    fun `a disabled bucket never interferes`() {
        val b = bucket(capacity = 1, enabled = false)
        repeat(100) {
            assertTrue(b.reserve("anthropic", "m", ws, 1_000_000, interactive = false)
                is ProviderCapacityBucket.Outcome.NotApplicable)
        }
    }

    @Test
    fun `a reservation is granted while there is room and refused when there is not`() {
        val b = bucket(capacity = 1_000, floor = 0.0)
        assertTrue(b.reserve("p", "m", ws, 600, false) is ProviderCapacityBucket.Outcome.Granted)
        assertTrue(b.reserve("p", "m", ws, 300, false) is ProviderCapacityBucket.Outcome.Granted)
        val third = b.reserve("p", "m", ws, 300, false)
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
        val lease = (b.reserve("p", "m", ws, 900, false)
            as ProviderCapacityBucket.Outcome.Granted).lease
        assertTrue(b.reserve("p", "m", ws, 500, false) is ProviderCapacityBucket.Outcome.Exhausted)

        b.settle(lease, actualTokens = 100)   // it only cost 100; 800 come back
        assertTrue(b.reserve("p", "m", ws, 500, false) is ProviderCapacityBucket.Outcome.Granted)
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
        val lease = (b.reserve("p", "m", ws, 100, false)
            as ProviderCapacityBucket.Outcome.Granted).lease
        b.settle(lease, actualTokens = 900)   // it really cost 900

        val next = b.reserve("p", "m", ws, 500, false)
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
        assertTrue(b.reserve("p", "m", ws, 800, interactive = false)
            is ProviderCapacityBucket.Outcome.Granted)
        assertTrue(b.reserve("p", "m", ws, 100, interactive = false)
            is ProviderCapacityBucket.Outcome.Exhausted,
            "batch must not draw into the interactive reserve")

        // The interactive run that arrives next still gets served.
        assertTrue(b.reserve("p", "m", ws, 150, interactive = true)
            is ProviderCapacityBucket.Outcome.Granted,
            "the reserve exists precisely so this call succeeds")
    }

    /** A fan-out cannot starve an interactive run that arrives after it. */
    @Test
    fun `a saturating fan-out leaves the interactive reserve intact`() {
        val b = bucket(capacity = 100_000, floor = 0.2)
        var granted = 0
        repeat(200) {                         // 200 children, 1k tokens each
            if (b.reserve("p", "m", ws, 1_000, interactive = false)
                is ProviderCapacityBucket.Outcome.Granted) granted++
        }
        assertEquals(80, granted, "batch should have been cut off at the 80% mark")
        repeat(20) {
            assertTrue(b.reserve("p", "m", ws, 1_000, interactive = true)
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
            override fun reserve(
                key: String, depth: Long, refillPerMinute: Long,
                want: Long, floor: Long, nowMs: Long,
            ): Pair<Boolean, Long> = throw RuntimeException("redis down")
            override fun settle(key: String, delta: Long, depth: Long) =
                throw RuntimeException("redis down")
        }
        val b = bucket(capacity = 1_000, backend = broken)
        assertTrue(b.reserve("p", "m", ws, 100, false) is ProviderCapacityBucket.Outcome.NotApplicable)
        // And settling a lease against it must not propagate either.
        b.settle(ProviderCapacityBucket.Lease("k", 100, 1_000), 50)
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
                            "anthropic", "claude-opus-5", ws, tokensPerCall, interactive = false)) {
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

    // ── Redis parity ──────────────────────────────────────────────────────────

    /**
     * The Lua and [BucketMath] are the same arithmetic written twice, and this is
     * the only thing that keeps them in step.
     *
     * Skips without a Redis. That is a real gap, not a resolved one: on a machine
     * with no Redis the Lua in `RESERVE_LUA` is never executed by anything, so a
     * typo in it would ship. Run the suite with a Redis before trusting the
     * distributed path.
     */
    @Test
    fun `the redis backend agrees with the in-process one`() {
        val redis = redisOrNull()
        org.junit.jupiter.api.Assumptions.assumeTrue(redis != null,
            "no Redis on 127.0.0.1:6379 — the Lua path is NOT covered by this run")
        val key = "captest:${UUID.randomUUID()}"
        val inProc = InProcessCapacityBackend()
        val onRedis = RedisCapacityBackend(redis!!)
        try {
            var now = 1_000_000L
            repeat(50) { i ->
                now += 500
                val want = 50L + i * 7
                val a = inProc.reserve(key, 1_000, 800, want, 200, now)
                val b = onRedis.reserve(key, 1_000, 800, want, 200, now)
                assertEquals(a.first, b.first, "granted disagreed at step $i")
                if (!a.first) assertEquals(a.second, b.second, "retryAfterMs disagreed at step $i")
                if (a.first) {
                    inProc.settle(key, want / 2, 1_000)
                    onRedis.settle(key, want / 2, 1_000)
                }
            }
        } finally {
            runCatching { redis.del(key) }
        }
    }

    private fun redisOrNull(): io.lettuce.core.api.sync.RedisCommands<String, String>? = try {
        val url = System.getenv("TEST_REDIS_URL") ?: "redis://127.0.0.1:6379"
        val client = io.lettuce.core.RedisClient.create(url)
        client.connect().sync().also { it.ping() }
    } catch (_: Exception) {
        null
    }
}
