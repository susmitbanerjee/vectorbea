package com.vectorbea.proxy.cache

import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CompletableDeferred

/**
 * Native-safe validation cache for agent / SDK tokens.
 */
class AuthCache(
    positiveTtl: Duration = Duration.ofSeconds(60),
    private val negativeTtlMs: Long = 10_000,
    private val maxSize: Long = 50_000,
    private val validator: suspend (token: String) -> Boolean,
) {
    private data class Result(
        val valid: Boolean,
        val insertedAtMs: Long,
        val expiresAtMs: Long,
    )

    private val entries = ConcurrentHashMap<String, Result>()
    private val inFlight = ConcurrentHashMap<String, CompletableDeferred<Result>>()

    private val hits = AtomicLong(0)
    private val misses = AtomicLong(0)
    private val loadSuccesses = AtomicLong(0)
    private val loadFailures = AtomicLong(0)
    private val positiveTtlMs = positiveTtl.toMillis()

    suspend fun isValid(token: String): Boolean {
        val now = System.currentTimeMillis()
        entries[token]?.takeIf { it.expiresAtMs > now }?.let { cached ->
            if (!cached.valid && now - cached.insertedAtMs > negativeTtlMs) {
                invalidate(token)
            } else {
                hits.incrementAndGet()
                return cached.valid
            }
        }

        misses.incrementAndGet()

        val deferred = CompletableDeferred<Result>()
        val existing = inFlight.putIfAbsent(token, deferred)
        if (existing != null) {
            return existing.await().valid
        }

        try {
            val valid = validator(token)
            val result = Result(
                valid = valid,
                insertedAtMs = now,
                expiresAtMs = now + if (valid) positiveTtlMs else negativeTtlMs,
            )
            entries[token] = result
            evictIfOversized()
            loadSuccesses.incrementAndGet()
            deferred.complete(result)
            return result.valid
        } catch (error: Throwable) {
            loadFailures.incrementAndGet()
            deferred.completeExceptionally(error)
            throw error
        } finally {
            inFlight.remove(token, deferred)
        }
    }

    fun invalidate(token: String) {
        entries.remove(token)
        inFlight.remove(token)
    }

    fun invalidateAll() {
        entries.clear()
        inFlight.clear()
    }

    fun stats() = CacheStats(
        hits = hits.get(),
        misses = misses.get(),
        loadSuccesses = loadSuccesses.get(),
        loadFailures = loadFailures.get(),
    )

    private fun evictIfOversized() {
        if (entries.size <= maxSize) return

        val overflow = entries.size - maxSize.toInt()
        if (overflow <= 0) return

        entries.entries
            .sortedBy { it.value.expiresAtMs }
            .take(overflow)
            .forEach { (key, _) -> entries.remove(key) }
    }
}
