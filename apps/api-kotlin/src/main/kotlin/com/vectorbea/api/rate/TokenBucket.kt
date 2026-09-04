package com.vectorbea.api.rate

import com.vectorbea.api.redis.RedisProvider
import io.lettuce.core.ScriptOutputType
import org.slf4j.LoggerFactory

/**
 * A token bucket in Redis, refilled continuously, consumed atomically.
 *
 * WHY NOT THE FIXED WINDOW WE ALREADY HAVE
 * ----------------------------------------
 * [RedisRateLimiter] counts requests per fixed window. Two problems, both of
 * which users hit:
 *
 *   **The boundary burst.** 60/minute admits 60 at 11:00:59 and 60 more at
 *   11:01:00 — 120 requests in one second, twice the limit, without ever
 *   exceeding it. Under a stress test that is exactly the moment things break.
 *
 *   **No burst allowance.** A workspace idle for an hour is allowed no more at
 *   11:00 than one that has been hammering since 10:00. That is not what a
 *   customer expects from "60 per minute", and it punishes exactly the polite
 *   usage pattern you want to encourage.
 *
 * A bucket fixes both: tokens accrue at a steady rate up to [burst], so idle
 * capacity is bankable and the rate is enforced continuously rather than in
 * steps.
 *
 * ATOMICITY
 * ---------
 * Refill-then-consume is read-modify-write. Two API replicas doing it with
 * separate GET/SET calls both read the same token count and both spend it, so the
 * limit silently doubles per replica — the same multiply-by-replicas bug the
 * tenant limiter had, in a new place. The Lua script makes it one round trip that
 * Redis executes without interleaving.
 *
 * FAILS OPEN
 * ----------
 * Redis unavailable admits the request. A rate limiter that cannot reach its
 * store must not become an outage: the per-tenant concurrency cap and admission
 * control are both still in front of the queue, so the worst case is a burst that
 * queues rather than one that is rejected.
 */
class TokenBucket(
    private val redis: RedisProvider,
    private val prefix: String = "vb",
) {
    private val log = LoggerFactory.getLogger(TokenBucket::class.java)

    data class Verdict(
        val allowed: Boolean,
        val tokensRemaining: Int,
        val refillPerMinute: Int,
        val burst: Int,
        /** Seconds until at least one token is available. 0 when allowed. */
        val retryAfterSeconds: Int,
    )

    /**
     * Take one token, or report how long until there is one.
     *
     * @param key      the bucket's identity — `run-create:<workspace>`,
     *                 `conn:<connection>`, `apikey:<hash>`.
     * @param refillPerMinute sustained rate.
     * @param burst    bucket capacity. Must be ≥ [refillPerMinute] to be
     *                 meaningful; a smaller burst just caps the sustained rate.
     */
    fun tryConsume(key: String, refillPerMinute: Int, burst: Int, cost: Int = 1): Verdict {
        if (refillPerMinute <= 0) {
            // A rate of zero means "unlimited", not "nothing allowed". Reading it
            // the other way would let an unset plan column silently freeze a
            // workspace out of the product.
            return Verdict(true, burst, refillPerMinute, burst, 0)
        }
        val capacity = maxOf(burst, 1)
        val ratePerSecond = refillPerMinute / 60.0

        return try {
            @Suppress("UNCHECKED_CAST")
            val res = redis.commands.eval<List<Any>>(
                LUA, ScriptOutputType.MULTI,
                arrayOf("$prefix:bucket:$key"),
                capacity.toString(),
                ratePerSecond.toString(),
                cost.toString(),
                System.currentTimeMillis().toString(),
                // TTL: long enough that a full refill is never lost to expiry,
                // short enough that idle buckets do not accumulate in Redis
                // forever. A bucket that expires simply starts full, which is the
                // correct state for something that has been idle that long.
                ttlSeconds(capacity, ratePerSecond).toString(),
            )
            val allowed = (res[0] as Long) == 1L
            val remaining = (res[1] as Long).toInt()
            val retryAfter = (res[2] as Long).toInt()
            Verdict(allowed, remaining, refillPerMinute, capacity, retryAfter)
        } catch (e: Exception) {
            log.warn("[bucket] Redis error for key={}, failing open: {}", key, e.message)
            Verdict(true, capacity, refillPerMinute, capacity, 0)
        }
    }

    /** Inspect without consuming — for a status endpoint or a pre-flight hint. */
    fun peek(key: String, refillPerMinute: Int, burst: Int): Verdict =
        tryConsume(key, refillPerMinute, burst, cost = 0)

    private fun ttlSeconds(capacity: Int, ratePerSecond: Double): Long =
        ((capacity / ratePerSecond).toLong() * 2).coerceIn(60L, 3_600L)

    companion object {
        /**
         * KEYS[1] bucket key
         * ARGV[1] capacity · ARGV[2] tokens/sec · ARGV[3] cost
         * ARGV[4] now (ms)  · ARGV[5] ttl seconds
         *
         * Returns {allowed, tokensRemaining, retryAfterSeconds}.
         *
         * Time comes from the caller rather than Redis's own `TIME`, so the script
         * stays deterministic and replica-safe. Every API instance shares one
         * clock source in practice (they are on the same host clock discipline),
         * and a few milliseconds of skew costs a few milliseconds of rate — far
         * less than the non-determinism `TIME` would introduce.
         */
        private val LUA = """
            local capacity = tonumber(ARGV[1])
            local rate     = tonumber(ARGV[2])
            local cost     = tonumber(ARGV[3])
            local now      = tonumber(ARGV[4])
            local ttl      = tonumber(ARGV[5])

            local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
            local tokens = tonumber(state[1])
            local ts     = tonumber(state[2])

            -- An absent bucket starts full. A new workspace, or one idle past the
            -- TTL, gets its whole burst — which is what "you have not used any of
            -- your allowance" should mean.
            if tokens == nil then
              tokens = capacity
              ts = now
            end

            -- Continuous refill. Clamped to capacity so an idle month does not
            -- bank a month of requests.
            local elapsed = math.max(0, (now - ts) / 1000.0)
            tokens = math.min(capacity, tokens + elapsed * rate)

            local allowed = 0
            if tokens >= cost then
              allowed = 1
              tokens = tokens - cost
            end

            redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', now)
            redis.call('EXPIRE', KEYS[1], ttl)

            -- Seconds until one token exists. Rounded up, and never zero when
            -- refused: telling a client to retry in 0s produces a hot loop.
            local retry = 0
            if allowed == 0 then
              retry = math.max(1, math.ceil((cost - tokens) / rate))
            end

            return { allowed, math.floor(tokens), retry }
        """.trimIndent()
    }
}
