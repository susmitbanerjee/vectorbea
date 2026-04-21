package com.vectorbea.proxy.cache

import com.vectorbea.proxy.model.PromptPayload
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CompletableDeferred

data class CacheStats(
    val hits: Long,
    val misses: Long,
    val loadSuccesses: Long,
    val loadFailures: Long,
)

/**
 * Native-safe prompt cache.
 *
 * This keeps the same external API as the old Caffeine-backed cache, but
 * avoids runtime-generated implementation classes that GraalVM native-image
 * cannot see by default.
 */
class PromptCache(
    private val maxSize: Long = 10_000,
    private val ttl: Duration = Duration.ofMinutes(5),
) {
    private data class CacheEntry<T>(
        val value: T,
        val expiresAtMs: Long,
    )

    private val entries = ConcurrentHashMap<String, CacheEntry<PromptPayload>>()
    private val inFlight = ConcurrentHashMap<String, CompletableDeferred<PromptPayload>>()

    private val hits = AtomicLong(0)
    private val misses = AtomicLong(0)
    private val loadSuccesses = AtomicLong(0)
    private val loadFailures = AtomicLong(0)

    fun get(name: String): PromptPayload? {
        val now = System.currentTimeMillis()
        val entry = entries[name] ?: return null
        if (entry.expiresAtMs <= now) {
            entries.remove(name, entry)
            return null
        }
        hits.incrementAndGet()
        return entry.value
    }

    fun put(name: String, prompt: PromptPayload) {
        val now = System.currentTimeMillis()
        entries[name] = CacheEntry(
            value = prompt,
            expiresAtMs = now + ttl.toMillis(),
        )
        evictIfOversized()
    }

    suspend fun getOrLoad(name: String, loader: suspend () -> PromptPayload): PromptPayload {
        val now = System.currentTimeMillis()
        entries[name]?.takeIf { it.expiresAtMs > now }?.let {
            hits.incrementAndGet()
            return it.value
        }

        misses.incrementAndGet()

        val deferred = CompletableDeferred<PromptPayload>()
        val existing = inFlight.putIfAbsent(name, deferred)
        if (existing != null) {
            return existing.await()
        }

        try {
            val loaded = loader()
            entries[name] = CacheEntry(
                value = loaded,
                expiresAtMs = now + ttl.toMillis(),
            )
            evictIfOversized()
            loadSuccesses.incrementAndGet()
            deferred.complete(loaded)
            return loaded
        } catch (error: Throwable) {
            loadFailures.incrementAndGet()
            deferred.completeExceptionally(error)
            throw error
        } finally {
            inFlight.remove(name, deferred)
        }
    }

    fun invalidate(name: String) {
        entries.remove(name)
        inFlight.remove(name)
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

    fun estimatedSize(): Long = entries.size.toLong()

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
