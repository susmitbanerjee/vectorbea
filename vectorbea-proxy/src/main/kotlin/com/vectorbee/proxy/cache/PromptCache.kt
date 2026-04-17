package com.vectorbea.proxy.cache

import com.vectorbea.proxy.model.PromptPayload
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class PromptCache {
    private data class CacheEntry(
        val prompt: PromptPayload,
        val cachedAtMs: Long
    )

    private val values = ConcurrentHashMap<String, CacheEntry>()
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val ttlMs = 15_000L

    fun get(name: String): PromptPayload? =
        values[name]
            ?.takeIf { entry -> System.currentTimeMillis() - entry.cachedAtMs < ttlMs }
            ?.prompt

    fun put(name: String, prompt: PromptPayload) {
        values[name] = CacheEntry(prompt, System.currentTimeMillis())
    }

    suspend fun getOrLoad(name: String, loader: suspend () -> PromptPayload): PromptPayload {
        get(name)?.let { return it }
        val mutex = locks.computeIfAbsent(name) { Mutex() }

        return mutex.withLock {
            get(name) ?: loader().also { loaded ->
                put(name, loaded)
            }
        }.also {
            locks.remove(name, mutex)
        }
    }
}
