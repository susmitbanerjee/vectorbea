package com.vectorbea.api.cache

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class NoOpCacheServiceTest {

    private val cache = NoOpCacheService()

    @Test
    fun `get always returns null`() {
        cache.set("key", "value", 60L)
        assertNull(cache.get("key", String::class.java))
    }

    @Test
    fun `set does not throw`() {
        cache.set("key", mapOf("a" to 1), 30L)
    }

    @Test
    fun `del does not throw`() {
        cache.del("nonexistent")
    }

    @Test
    fun `getOrSet always calls loader`() {
        var callCount = 0
        val result = cache.getOrSet("key", 60L, String::class.java) {
            callCount++
            "loaded-value"
        }
        assertEquals("loaded-value", result)
        assertEquals(1, callCount)
    }

    @Test
    fun `getOrSet calls loader on every invocation (no caching)`() {
        var callCount = 0
        repeat(3) {
            cache.getOrSet("key", 60L, String::class.java) {
                callCount++
                "value"
            }
        }
        assertEquals(3, callCount)
    }
}
