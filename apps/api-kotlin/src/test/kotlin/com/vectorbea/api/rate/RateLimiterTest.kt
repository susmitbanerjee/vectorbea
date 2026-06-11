package com.vectorbea.api.rate

import org.junit.jupiter.api.Test
import kotlin.test.assertIs
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RateLimiterTest {

    /**
     * Trivial stub implementation for unit testing RateLimitResult shapes
     * without a real Redis connection.
     */
    private class CountingRateLimiter(private val maxRequests: Long) : RateLimiter {
        private val counts = mutableMapOf<String, Long>()

        override fun check(key: String, maxRequests: Long, windowSeconds: Long): RateLimitResult {
            val count = counts.merge(key, 1L, Long::plus)!!
            val resetsIn = windowSeconds
            return if (count <= maxRequests) {
                RateLimitResult.Allowed(count, maxRequests, windowSeconds, resetsIn)
            } else {
                RateLimitResult.Exceeded(count, maxRequests, windowSeconds, resetsIn)
            }
        }
    }

    @Test
    fun `first request is allowed`() {
        val limiter = CountingRateLimiter(5)
        val result = limiter.check("user:1", 5, 60)
        assertIs<RateLimitResult.Allowed>(result)
        assertEquals(1L, result.currentCount)
    }

    @Test
    fun `requests within limit are allowed`() {
        val limiter = CountingRateLimiter(5)
        repeat(5) {
            val result = limiter.check("user:1", 5, 60)
            assertIs<RateLimitResult.Allowed>(result)
        }
    }

    @Test
    fun `request exceeding limit is denied`() {
        val limiter = CountingRateLimiter(3)
        repeat(3) { limiter.check("user:1", 3, 60) }
        val result = limiter.check("user:1", 3, 60)
        assertIs<RateLimitResult.Exceeded>(result)
        assertEquals(4L, result.currentCount)
        assertEquals(3L, result.maxRequests)
    }

    @Test
    fun `different keys have independent counters`() {
        val limiter = CountingRateLimiter(2)
        repeat(2) { limiter.check("user:1", 2, 60) }
        // user:1 is at limit
        assertIs<RateLimitResult.Exceeded>(limiter.check("user:1", 2, 60))
        // user:2 is fresh
        assertIs<RateLimitResult.Allowed>(limiter.check("user:2", 2, 60))
    }

    @Test
    fun `allowed result carries resetsInSeconds`() {
        val limiter = CountingRateLimiter(10)
        val result = limiter.check("user:1", 10, 30) as RateLimitResult.Allowed
        assertEquals(30L, result.windowSeconds)
        assertTrue(result.resetsInSeconds > 0)
    }

    @Test
    fun `exceeded result carries resetsInSeconds`() {
        val limiter = CountingRateLimiter(1)
        limiter.check("user:1", 1, 30)
        val result = limiter.check("user:1", 1, 30) as RateLimitResult.Exceeded
        assertEquals(30L, result.windowSeconds)
        assertTrue(result.resetsInSeconds > 0)
    }
}
