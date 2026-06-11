package com.vectorbea.api.rate

import com.vectorbea.api.redis.RedisProvider
import org.slf4j.LoggerFactory

/**
 * Redis-backed sliding-window rate limiter (token bucket via INCR + EXPIRE).
 *
 * Algorithm (fixed-window counter):
 *   1. INCR {prefix}:rate:{key}:{windowSlot}
 *   2. If count == 1, set EXPIRE to [windowSeconds] (first request in window)
 *   3. If count > [maxRequests] → rate limit exceeded
 *
 * The window slot is derived from the current time:
 *   slot = epochSeconds / windowSeconds
 *
 * This is a fixed-window counter, not a sliding window.  It's simple and
 * sufficient for basic rate limiting.  A true sliding window would require
 * a Lua script or sorted set approach — add that if needed.
 *
 * Key pattern:
 *   {prefix}:rate:{key}:{windowSlot}
 *   e.g. "vectorbea:rate:workspace:abc123:1718100"
 *
 * Failure mode:
 *   If Redis is unavailable, [check] returns [RateLimitResult.Allowed] with
 *   a warning log — fail open to avoid blocking all traffic during Redis outage.
 */
interface RateLimiter {

    /**
     * Check whether [key] is within the rate limit.
     *
     * @param key          Identifies the rate-limited entity (e.g. "workspace:{id}").
     * @param maxRequests  Maximum number of requests allowed per window.
     * @param windowSeconds Length of the window in seconds.
     * @return [RateLimitResult.Allowed] or [RateLimitResult.Exceeded].
     */
    fun check(key: String, maxRequests: Long, windowSeconds: Long): RateLimitResult
}

sealed class RateLimitResult {
    /** Request is within the rate limit. */
    data class Allowed(
        val currentCount: Long,
        val maxRequests: Long,
        val windowSeconds: Long,
        val resetsInSeconds: Long,
    ) : RateLimitResult()

    /** Rate limit exceeded. */
    data class Exceeded(
        val currentCount: Long,
        val maxRequests: Long,
        val windowSeconds: Long,
        val resetsInSeconds: Long,
    ) : RateLimitResult()
}

// ── Redis implementation ──────────────────────────────────────────────────────

class RedisRateLimiter(
    private val redis: RedisProvider,
    private val prefix: String,
) : RateLimiter {

    private val log = LoggerFactory.getLogger(RedisRateLimiter::class.java)

    override fun check(key: String, maxRequests: Long, windowSeconds: Long): RateLimitResult {
        val nowSeconds = System.currentTimeMillis() / 1_000L
        val windowSlot = nowSeconds / windowSeconds
        val resetsInSeconds = windowSeconds - (nowSeconds % windowSeconds)
        val redisKey = "$prefix:rate:$key:$windowSlot"

        return try {
            val count = redis.commands.incr(redisKey)
            // Set expiry on the first request in this window
            if (count == 1L) {
                redis.commands.expire(redisKey, windowSeconds + 1)  // +1 for safety margin
            }
            if (count <= maxRequests) {
                RateLimitResult.Allowed(
                    currentCount = count,
                    maxRequests = maxRequests,
                    windowSeconds = windowSeconds,
                    resetsInSeconds = resetsInSeconds,
                )
            } else {
                log.debug("[rate] limit exceeded key={} count={} max={}", redisKey, count, maxRequests)
                RateLimitResult.Exceeded(
                    currentCount = count,
                    maxRequests = maxRequests,
                    windowSeconds = windowSeconds,
                    resetsInSeconds = resetsInSeconds,
                )
            }
        } catch (e: Exception) {
            // Fail open — do not block requests if Redis is unavailable
            log.warn("[rate] Redis error for key={}, failing open: {}", redisKey, e.message)
            RateLimitResult.Allowed(
                currentCount = 0,
                maxRequests = maxRequests,
                windowSeconds = windowSeconds,
                resetsInSeconds = resetsInSeconds,
            )
        }
    }
}
