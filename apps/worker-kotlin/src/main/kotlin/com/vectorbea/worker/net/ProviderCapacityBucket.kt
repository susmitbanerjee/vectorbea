package com.vectorbea.worker.net

import com.vectorbea.worker.logging.logger
import io.lettuce.core.ScriptOutputType
import io.lettuce.core.api.sync.RedisCommands
import java.util.UUID

/**
 * A distributed token bucket in front of every provider call. §12.4.
 *
 * ── THE PROBLEM THE CIRCUIT BREAKER DOES NOT SOLVE ──────────────────────────
 * `ConnectionCircuit` opens after a provider has already started refusing, and
 * `ProviderThrottle` decides what to do once a 429 has arrived. Both are
 * reactive, and both are correct at what they do. Neither prevents two hundred
 * workers, each individually well-behaved, from collectively exceeding a
 * per-minute token limit — nobody is over their own budget, because nobody has
 * one.
 *
 * So: a shared budget, in Redis, keyed `(provider, model, workspace_id)`. The
 * workspace is part of the key deliberately. A provider limit is usually per API
 * key and a key is usually per workspace, so a bucket without it would let one
 * tenant's fan-out throttle another tenant's interactive run against a limit
 * they do not share.
 *
 * ── LEASE AND RETURN ────────────────────────────────────────────────────────
 * A caller cannot know its token spend until the response comes back, and a
 * bucket that only counts after the fact does not limit anything — a hundred
 * concurrent calls all pass the check and then all report their spend. So the
 * caller RESERVES an estimate before the call and RETURNS the difference after.
 * Over-estimate and the surplus goes back; under-estimate and the shortfall is
 * debited, which can push the bucket negative and make the next caller wait
 * longer. Negative is a legitimate state, and refusing to go negative would be a
 * bucket that silently under-counts exactly when estimates are worst.
 *
 * ── INTERACTIVE LANES DRAW FIRST ────────────────────────────────────────────
 * Not a priority queue: this is a bucket, and callers arrive independently, so
 * there is no queue to order. Instead batch lanes may only draw the bucket down
 * to a RESERVED FLOOR, and interactive lanes may draw it to zero and below. A
 * twenty-child fan-out therefore stops at 20% remaining and the interactive run
 * that arrives a second later still has capacity. Same effect, no coordination.
 *
 * ── DEPTH AND RATE ARE NOT THE SAME NUMBER ──────────────────────────────────
 * The obvious bucket — depth == the per-minute limit, refilling at the
 * per-minute limit — admits TWICE the limit in the first minute: the full bucket
 * is spent immediately and then a whole minute of refill is spent on top of it.
 * The provider measures a sliding window and 429s, which is the exact outcome
 * this class exists to prevent. The load test in `ProviderCapacityBucketTest`
 * found this, at 19 rejections.
 *
 * So the configured limit is SPLIT. A fraction ([burstFraction]) becomes the
 * bucket's depth and the remainder becomes the refill rate:
 *
 *     depth   = limit × burst
 *     refill  = limit × (1 − burst)  per minute
 *
 * Over any 60-second window the most that can be admitted is therefore
 * `depth + refill` — exactly the limit, whatever the arrival pattern. The price
 * is that sustained throughput is `(1 − burst)` of the limit, which is the same
 * headroom every rate-limiting guide recommends reserving, arrived at honestly
 * rather than by picking 80% and hoping.
 *
 * ── EXHAUSTION IS A YIELD, NOT AN ERROR ─────────────────────────────────────
 * A refusal returns the milliseconds until the bucket has refilled enough, which
 * the caller turns into [com.vectorbea.worker.runtime.executor.NodeResult.Throttled].
 * That already releases the worker permit and re-enqueues on a timer — nothing
 * failed, nothing was lost, and the run costs a yield rather than an incident.
 *
 * ── EVERY FAILURE MODE FAILS OPEN ───────────────────────────────────────────
 * Redis being unreachable must not stop provider calls. The bucket is a cost
 * optimisation over the 429 handling that already exists; if it cannot be
 * consulted, the pre-existing reactive path is exactly what happens, which is the
 * behaviour of every deployment before this class existed.
 */
class ProviderCapacityBucket(
    private val backend: CapacityBackend?,
    private val limits: CapacityLimits = CapacityLimits.fromEnv(),
    private val enabled: Boolean =
        System.getenv("PROVIDER_CAPACITY_ENABLED")?.lowercase() == "true",
    /**
     * Fraction of a bucket that only interactive lanes may draw.
     *
     * 0.2 by default: enough that an interactive run arriving into a saturated
     * batch workload still gets served, small enough that it does not idle a
     * fifth of a paid-for rate limit when nothing interactive is running — the
     * floor is not a reservation that expires, it is simply a lower bound batch
     * respects.
     */
    private val interactiveFloor: Double =
        System.getenv("PROVIDER_CAPACITY_INTERACTIVE_FLOOR")?.toDoubleOrNull()?.coerceIn(0.0, 0.9)
            ?: 0.2,
    /**
     * How much of the configured limit is bucket DEPTH rather than refill rate.
     *
     * 0.2 lets a burst of a fifth of the minute's allowance land at once and
     * sustains the other four fifths. Raising it buys burst tolerance and lowers
     * steady throughput; 1.0 restores the naive bucket and, with it, the 2×
     * overshoot described above. Bounded at 0.9 so the refill can never be zero,
     * which would make a drained bucket permanent.
     */
    private val burstFraction: Double =
        System.getenv("PROVIDER_CAPACITY_BURST")?.toDoubleOrNull()?.coerceIn(0.05, 1.0) ?: 0.2,
    /**
     * How long a reservation may stay outstanding before it returns itself.
     *
     * ── WHY EXPIRY EXISTS WHEN RELEASE IS EXPLICIT ─────────────────────────
     * `LlmNodeExecutor` settles every lease in a `finally`, under
     * `NonCancellable`, so a cancelled call gives its tokens back. That covers
     * every path the process survives — and none of the ones it does not. SIGKILL
     * during a rolling deploy, an OOM, a lost lease: the tokens are drawn, the
     * JVM that owed them is gone, and nothing will ever return them.
     *
     * Without a TTL the bucket ratchets down until it refills past the loss,
     * which for a workspace that crashes regularly is a permanent tax that looks
     * like a provider being slow.
     *
     * So release is the FAST path and expiry is the BACKSTOP. Two minutes: longer
     * than any provider call this worker will make (the ceiling is
     * `OutboundHttp.clampTotalCallMs`), short enough that a crash costs one
     * window rather than an afternoon.
     */
    private val leaseTtlMs: Long =
        System.getenv("PROVIDER_CAPACITY_LEASE_TTL_MS")?.toLongOrNull()?.coerceIn(1_000, 3_600_000)
            ?: 120_000L,
) {
    private val log = logger()

    /** Redis when there is one, in-process when there is not. */
    constructor(
        redis: RedisCommands<String, String>?,
        limits: CapacityLimits = CapacityLimits.fromEnv(),
        enabled: Boolean = System.getenv("PROVIDER_CAPACITY_ENABLED")?.lowercase() == "true",
    ) : this(
        backend = if (redis != null) RedisCapacityBackend(redis) else InProcessCapacityBackend(),
        limits = limits,
        enabled = enabled,
    )

    /** Tokens per minute per (provider, model, workspace). */
    class CapacityLimits(
        private val default: Long,
        /** `provider:model` → tokens per minute. Longest match wins over [default]. */
        private val overrides: Map<String, Long>,
    ) {
        fun forModel(provider: String, model: String): Long =
            overrides["$provider:$model"] ?: overrides[provider] ?: default

        companion object {
            /**
             * `PROVIDER_TPM_DEFAULT` plus `PROVIDER_TPM_OVERRIDES`, the latter a
             * comma-separated list of `provider[:model]=tokensPerMinute`.
             *
             * One env var rather than one per model: providers add models
             * constantly, and a scheme that needs a deploy to rate-limit a new
             * model is a scheme that will not be used.
             */
            fun fromEnv(): CapacityLimits {
                val default = System.getenv("PROVIDER_TPM_DEFAULT")?.toLongOrNull() ?: 1_000_000L
                val overrides = System.getenv("PROVIDER_TPM_OVERRIDES")
                    ?.split(',')
                    ?.mapNotNull { entry ->
                        val (k, v) = entry.split('=', limit = 2).let {
                            if (it.size == 2) it[0].trim() to it[1].trim() else return@mapNotNull null
                        }
                        v.toLongOrNull()?.let { k to it }
                    }
                    ?.toMap()
                    ?: emptyMap()
                return CapacityLimits(default, overrides)
            }
        }
    }

    /**
     * A granted reservation. Must be settled, or its tokens stay drawn until the
     * bucket refills past them.
     */
    data class Lease(
        val key: String,
        val reserved: Long,
        val capacity: Long,
        /**
         * Identifies this reservation among the outstanding ones.
         *
         * Needed because expiry has to reclaim a SPECIFIC amount: the backstop
         * sweeps leases whose deadline has passed and returns exactly what each
         * drew. A bucket that only tracked a total could not tell which part of
         * it was abandoned.
         */
        val id: String = java.util.UUID.randomUUID().toString(),
    )

    sealed class Outcome {
        data class Granted(val lease: Lease) : Outcome()

        /** Not enough capacity. [retryAfterMs] is when there will be. */
        data class Exhausted(val retryAfterMs: Long, val capacity: Long) : Outcome()

        /** Bucket off, or unreachable. Proceed exactly as before this class existed. */
        object NotApplicable : Outcome()
    }

    /**
     * Reserve [estimatedTokens] before a provider call.
     *
     * [interactive] callers may draw the bucket below the reserved floor. It is
     * the lane, not the caller's opinion of its own importance.
     */
    fun reserve(
        provider: String,
        model: String,
        workspaceId: UUID,
        estimatedTokens: Long,
        interactive: Boolean,
    ): Outcome {
        val b = backend
        if (!enabled || b == null) return Outcome.NotApplicable

        val capacity = limits.forModel(provider, model)
        if (capacity <= 0) return Outcome.NotApplicable

        val key = key(provider, model, workspaceId)
        val want = estimatedTokens.coerceAtLeast(1L)
        val depth = depthOf(capacity)
        /* Floor in absolute tokens, computed here so the backends stay arithmetic
           and the policy stays in Kotlin where it can be read. A fraction of the
           DEPTH, not of the per-minute limit — the depth is what a caller can
           actually draw at any instant. */
        val floor = if (interactive) 0L else (depth * interactiveFloor).toLong()

        return try {
            val lease = Lease(key, want, depth)
            val (granted, retryMs) = b.reserve(
                key, depth, refillPerMinuteOf(capacity), want, floor,
                System.currentTimeMillis(), lease.id, leaseTtlMs)
            if (granted) Outcome.Granted(lease)
            else Outcome.Exhausted(retryMs.coerceAtLeast(1L), capacity)
        } catch (e: Exception) {
            /* FAIL OPEN. A bucket that cannot be reached must not stop the fleet
               calling providers — the 429 path that predates this class is still
               there and still correct. */
            log.warn("[capacity] bucket unavailable for {}:{} — proceeding unmetered: {}",
                provider, model, e.message)
            Outcome.NotApplicable
        }
    }

    /**
     * Settle a lease against what the call actually cost.
     *
     * Returns the surplus (positive) or the shortfall (negative), for the metric.
     * Never throws: a settle that fails leaves the reservation drawn, which
     * over-limits rather than under-limits, and over-limiting is the safe error.
     */
    fun settle(lease: Lease, actualTokens: Long): Long {
        val b = backend ?: return 0
        val delta = lease.reserved - actualTokens.coerceAtLeast(0L)
        return try {
            /* Called even when delta is zero, because settling also RETIRES the
               lease. Skipping the call would leave it outstanding for the reaper
               to return a second time — the bucket would grow past its depth on
               every perfectly-estimated call. */
            b.settle(lease.key, lease.id, delta, lease.capacity)
            delta
        } catch (e: Exception) {
            log.warn("[capacity] settle failed for {} — {} token(s) stay drawn: {}",
                lease.key, lease.reserved, e.message)
            0
        }
    }

    /** Release a reservation whole, for a call that never happened. */
    fun release(lease: Lease) {
        settle(lease, 0L)
    }

    /** Tokens drawable at one instant. */
    internal fun depthOf(limitPerMinute: Long): Long =
        (limitPerMinute * burstFraction).toLong().coerceAtLeast(1L)

    /** Tokens added per minute. Depth plus this is the most any 60s window admits. */
    internal fun refillPerMinuteOf(limitPerMinute: Long): Long =
        (limitPerMinute * (1.0 - burstFraction)).toLong().coerceAtLeast(1L)

    private fun key(provider: String, model: String, workspaceId: UUID) =
        "capacity:{$workspaceId}:$provider:$model"

    internal companion object {
        /**
         * TTL on a Redis bucket key.
         *
         * Long enough that an idle minute does not reset a bucket mid-window,
         * short enough that a workspace that stops using a model stops costing a
         * key. Refill is computed from a stored timestamp, so an expired key is
         * indistinguishable from a full one — which is correct, because a bucket
         * untouched for an hour IS full.
         */
        const val TTL_SECONDS = 3_600L

        /**
         * Refill, then reserve if the draw leaves the bucket at or above the floor.
         *
         * KEYS: bucket hash, lease ZSET
         * ARGV: depth, refillPerMinute, want, floor, nowMs, keyTtlSeconds,
         *       leaseId, leaseTtlMs
         * Returns: {granted 0|1, retryAfterMs}
         *
         * Atomic by virtue of being one script: the read-modify-write of `tokens`
         * cannot interleave with another worker's. That is the whole reason this
         * is Lua and not three commands.
         *
         * ── KEEP IN STEP WITH [BucketMath] ─────────────────────────────────
         * This is the same arithmetic as [BucketMath.reserve], expressed twice
         * because one copy has to run inside Redis and the other has to run
         * without it. `ProviderCapacityBucketTest` asserts they agree, and that
         * test is the only thing keeping them honest — change one, change both.
         */
        val RESERVE_LUA = """
            local depth    = tonumber(ARGV[1])
            local refill   = tonumber(ARGV[2])
            local want     = tonumber(ARGV[3])
            local floor    = tonumber(ARGV[4])
            local now      = tonumber(ARGV[5])
            local ttl      = tonumber(ARGV[6])
            local leaseId  = ARGV[7]
            local leaseTtl = tonumber(ARGV[8])

            local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
            local ts     = tonumber(redis.call('HGET', KEYS[1], 'ts'))
            if tokens == nil or ts == nil then
              tokens = depth
              ts = now
            end

            -- ── THE CRASH BACKSTOP ────────────────────────────────────────
            -- Return every lease whose deadline has passed. A worker killed
            -- mid-call never settles, and without this its tokens stay drawn for
            -- the life of the key. Swept lazily, on the next caller's reserve,
            -- because the next caller is exactly who benefits from them.
            --
            -- The member encodes the amount (`id:amount`) so one ZSET is enough:
            -- a parallel hash would need its own expiry and could disagree.
            local dead = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)
            for i = 1, #dead do
              local amount = tonumber(string.match(dead[i], ':(%d+)$'))
              if amount then tokens = tokens + amount end
            end
            if #dead > 0 then redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now) end

            -- Continuous refill, capped at the bucket's DEPTH. Never above it: a
            -- bucket that accumulated while idle would let a burst exceed the
            -- provider's window, which is the exact thing being prevented.
            local elapsed = now - ts
            if elapsed > 0 then
              tokens = math.min(depth, tokens + (refill * elapsed / 60000.0))
              ts = now
            end

            local granted = 0
            local retry = 0
            if tokens - want >= floor then
              tokens = tokens - want
              granted = 1
              redis.call('ZADD', KEYS[2], now + leaseTtl, leaseId .. ':' .. want)
            else
              -- How long until (tokens + refill) - want >= floor.
              local deficit = (floor + want) - tokens
              retry = math.ceil(deficit * 60000.0 / refill)
              if retry < 1 then retry = 1 end
            end

            redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', ts)
            redis.call('EXPIRE', KEYS[1], ttl)
            redis.call('EXPIRE', KEYS[2], ttl)
            return { granted, retry }
        """.trimIndent()

        /**
         * Give back `delta` tokens (or take more, when negative).
         *
         * Clamped at the capacity ceiling for the same reason the refill is: a
         * settle that returned more than was reserved must not create capacity
         * that the provider will not honour. No floor — a bucket driven negative
         * by a bad estimate is real information, and the next caller should wait
         * for it.
         */
        val SETTLE_LUA = """
            local delta   = tonumber(ARGV[1])
            local depth   = tonumber(ARGV[2])
            local leaseId = ARGV[3]

            -- Retire the lease FIRST, and only apply the settlement if it was
            -- still outstanding. Without that check a settle racing its own
            -- expiry returns the tokens twice and the bucket drifts above depth.
            local removed = 0
            local members = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', '+inf')
            for i = 1, #members do
              if string.sub(members[i], 1, #leaseId + 1) == leaseId .. ':' then
                redis.call('ZREM', KEYS[2], members[i])
                removed = 1
                break
              end
            end
            if removed == 0 then return 0 end

            local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
            if tokens == nil then return 0 end
            tokens = math.min(depth, tokens + delta)
            redis.call('HSET', KEYS[1], 'tokens', tokens)
            return 1
        """.trimIndent()
    }
}

/**
 * Where a bucket's counter actually lives.
 *
 * Two implementations, and the second is NOT a test double. A worker deployed
 * without Redis — a single-node install, a developer machine — should still
 * limit its own provider spend, because "no Redis" is not a reason to be
 * unmetered. It is a weaker guarantee (this process only) and it is honestly
 * weaker; it is not nothing.
 */
interface CapacityBackend {
    /**
     * Reserve [want], recording the lease so it can expire if never settled.
     *
     * Reclaims any lease already past its deadline first — a lazy reaper, so
     * there is no background job and the cost lands on the next caller, who is
     * the one who benefits from the reclaimed tokens.
     */
    fun reserve(
        key: String, depth: Long, refillPerMinute: Long, want: Long, floor: Long, nowMs: Long,
        leaseId: String, ttlMs: Long,
    ): Pair<Boolean, Long>

    /** Retire [leaseId] and return (positive) or take (negative) tokens. */
    fun settle(key: String, leaseId: String, delta: Long, depth: Long)
}

/**
 * The arithmetic, in one place.
 *
 * The Lua in [ProviderCapacityBucket.RESERVE_LUA] is a transcription of this,
 * and the two are pinned together by a parity test. Written here rather than
 * only in Lua so that the behaviour is expressible, testable and readable
 * without a Redis to run it in.
 */
internal object BucketMath {
    /** `leases` maps lease id to (amount, deadline). See [expire]. */
    data class State(
        var tokens: Double,
        var ts: Long,
        val leases: MutableMap<String, Pair<Long, Long>> = LinkedHashMap(),
    )

    /**
     * Return every lease whose deadline has passed. The crash backstop.
     *
     * Runs before the refill on every reserve, so an abandoned reservation costs
     * at most its TTL rather than forever.
     */
    fun expire(st: State, nowMs: Long): Long {
        var reclaimed = 0L
        val it = st.leases.entries.iterator()
        while (it.hasNext()) {
            val (amount, deadline) = it.next().value
            if (deadline <= nowMs) { reclaimed += amount; it.remove() }
        }
        st.tokens += reclaimed
        return reclaimed
    }

    /** Refill in place, capped at the bucket's depth. */
    fun refill(st: State, depth: Long, refillPerMinute: Long, nowMs: Long) {
        val elapsed = nowMs - st.ts
        if (elapsed > 0) {
            st.tokens = minOf(depth.toDouble(), st.tokens + refillPerMinute * elapsed / 60_000.0)
            st.ts = nowMs
        }
    }

    /**
     * Retire a lease and apply its settlement — but only if it was still
     * outstanding.
     *
     * The guard is not defensive tidiness: a settle racing its own expiry would
     * otherwise return the tokens twice and drift the bucket above its depth.
     * The Lua does the same check, and the parity test is what keeps them equal.
     */
    fun settle(st: State, leaseId: String, delta: Long, depth: Long) {
        if (st.leases.remove(leaseId) == null) return
        st.tokens = minOf(depth.toDouble(), st.tokens + delta)
    }

    /** Draw [want], if that leaves the bucket at or above [floor]. */
    fun reserve(
        st: State, depth: Long, refillPerMinute: Long, want: Long, floor: Long, nowMs: Long,
        leaseId: String = "", ttlMs: Long = 0,
    ): Pair<Boolean, Long> {
        /* Reclaim before refilling, so tokens returned by an expired lease are
           subject to the same depth cap as everything else. */
        expire(st, nowMs)
        refill(st, depth, refillPerMinute, nowMs)
        return if (st.tokens - want >= floor) {
            st.tokens -= want
            if (leaseId.isNotEmpty()) st.leases[leaseId] = want to (nowMs + ttlMs)
            true to 0L
        } else {
            val deficit = (floor + want) - st.tokens
            val retry = Math.ceil(deficit * 60_000.0 / refillPerMinute).toLong().coerceAtLeast(1L)
            false to retry
        }
    }
}

/** The distributed backend. One script per operation, atomic in Redis. */
class RedisCapacityBackend(private val redis: RedisCommands<String, String>) : CapacityBackend {
    override fun reserve(
        key: String, depth: Long, refillPerMinute: Long, want: Long, floor: Long, nowMs: Long,
        leaseId: String, ttlMs: Long,
    ): Pair<Boolean, Long> {
        @Suppress("UNCHECKED_CAST")
        val res = redis.eval<List<Any>>(
            ProviderCapacityBucket.RESERVE_LUA, ScriptOutputType.MULTI,
            /* TWO keys, so the bucket and its lease set hash to the same slot in a
               cluster — `{workspace}` in the key already guarantees that, and
               declaring both is what makes it checkable. */
            arrayOf(key, "$key:leases"),
            depth.toString(), refillPerMinute.toString(), want.toString(), floor.toString(),
            nowMs.toString(), ProviderCapacityBucket.TTL_SECONDS.toString(),
            leaseId, ttlMs.toString(),
        )
        return ((res[0] as Long) == 1L) to (res[1] as Long)
    }

    override fun settle(key: String, leaseId: String, delta: Long, depth: Long) {
        redis.eval<Long>(
            ProviderCapacityBucket.SETTLE_LUA, ScriptOutputType.INTEGER,
            arrayOf(key, "$key:leases"), delta.toString(), depth.toString(), leaseId,
        )
    }
}

/**
 * The single-process backend.
 *
 * Synchronised on the state object rather than the map: two different models'
 * buckets have no reason to contend, and a global lock in front of every
 * provider call is a bottleneck introduced by the thing meant to prevent one.
 */
class InProcessCapacityBackend : CapacityBackend {
    private val states = java.util.concurrent.ConcurrentHashMap<String, BucketMath.State>()

    private fun stateFor(key: String, depth: Long, nowMs: Long) =
        states.computeIfAbsent(key) { BucketMath.State(depth.toDouble(), nowMs) }

    override fun reserve(
        key: String, depth: Long, refillPerMinute: Long, want: Long, floor: Long, nowMs: Long,
        leaseId: String, ttlMs: Long,
    ): Pair<Boolean, Long> {
        val st = stateFor(key, depth, nowMs)
        return synchronized(st) {
            BucketMath.reserve(st, depth, refillPerMinute, want, floor, nowMs, leaseId, ttlMs)
        }
    }

    override fun settle(key: String, leaseId: String, delta: Long, depth: Long) {
        val st = states[key] ?: return
        synchronized(st) { BucketMath.settle(st, leaseId, delta, depth) }
    }
}
