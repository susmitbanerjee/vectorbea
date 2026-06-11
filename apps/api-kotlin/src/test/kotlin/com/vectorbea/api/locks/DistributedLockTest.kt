package com.vectorbea.api.locks

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class DistributedLockTest {

    /**
     * In-memory stub for testing lock semantics without Redis.
     */
    private class InMemoryDistributedLock : DistributedLock {
        private val held = mutableSetOf<String>()

        override fun <T> withLock(key: String, ttlSeconds: Long, block: () -> T): T {
            val handle = tryAcquire(key, ttlSeconds) ?: throw LockNotAcquiredException(key)
            return try {
                block()
            } finally {
                handle.release()
            }
        }

        override fun tryAcquire(key: String, ttlSeconds: Long): LockHandle? {
            require(ttlSeconds >= 1) { "Lock TTL must be at least 1 second" }
            if (key in held) return null
            held.add(key)
            return object : LockHandle {
                override val key = key
                override fun release() { held.remove(key) }
            }
        }
    }

    @Test
    fun `withLock executes block`() {
        val lock = InMemoryDistributedLock()
        var executed = false
        lock.withLock("key-1", 30L) { executed = true }
        assertEquals(true, executed)
    }

    @Test
    fun `withLock returns block result`() {
        val lock = InMemoryDistributedLock()
        val result = lock.withLock("key-2", 30L) { 42 }
        assertEquals(42, result)
    }

    @Test
    fun `withLock releases lock after block`() {
        val lock = InMemoryDistributedLock()
        lock.withLock("key-3", 30L) { /* nothing */ }
        // Should be re-acquirable after release
        val result = lock.withLock("key-3", 30L) { "ok" }
        assertEquals("ok", result)
    }

    @Test
    fun `withLock releases lock after exception`() {
        val lock = InMemoryDistributedLock()
        try {
            lock.withLock("key-4", 30L) { throw RuntimeException("boom") }
        } catch (_: RuntimeException) {}
        // Lock should be released despite exception
        val result = lock.withLock("key-4", 30L) { "recovered" }
        assertEquals("recovered", result)
    }

    @Test
    fun `withLock throws LockNotAcquiredException when held`() {
        val lock = InMemoryDistributedLock()
        val handle = lock.tryAcquire("key-5", 30L)
        assertNotNull(handle)
        assertFailsWith<LockNotAcquiredException> {
            lock.withLock("key-5", 30L) { "should not run" }
        }
        handle.release()
    }

    @Test
    fun `tryAcquire returns null when lock is held`() {
        val lock = InMemoryDistributedLock()
        val first = lock.tryAcquire("key-6", 30L)
        assertNotNull(first)
        val second = lock.tryAcquire("key-6", 30L)
        assertNull(second)
        first.release()
    }

    @Test
    fun `tryAcquire returns handle after release`() {
        val lock = InMemoryDistributedLock()
        val handle = lock.tryAcquire("key-7", 30L)!!
        handle.release()
        assertNotNull(lock.tryAcquire("key-7", 30L))
    }

    @Test
    fun `ttlSeconds below 1 throws IllegalArgumentException`() {
        val lock = InMemoryDistributedLock()
        assertFailsWith<IllegalArgumentException> {
            lock.tryAcquire("key-8", 0L)
        }
    }

    @Test
    fun `LockNotAcquiredException message contains key`() {
        val ex = LockNotAcquiredException("my-special-lock")
        assertEquals(true, ex.message?.contains("my-special-lock"))
    }
}
