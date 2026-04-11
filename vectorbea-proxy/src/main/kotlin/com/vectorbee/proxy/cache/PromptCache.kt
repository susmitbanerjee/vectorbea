package com.vectorbea.proxy.cache

import com.vectorbea.proxy.model.PromptPayload
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class PromptCache {
    private val values = ConcurrentHashMap<String, PromptPayload>()
    private val locks = ConcurrentHashMap<String, Mutex>()

    fun get(name: String): PromptPayload? = values[name]

    fun put(name: String, prompt: PromptPayload) {
        values[name] = prompt
    }

    suspend fun getOrLoad(name: String, loader: suspend () -> PromptPayload): PromptPayload {
        values[name]?.let { return it }
        val mutex = locks.computeIfAbsent(name) { Mutex() }

        return mutex.withLock {
            values[name] ?: loader().also { loaded ->
                values[name] = loaded
            }
        }.also {
            locks.remove(name, mutex)
        }
    }
}
