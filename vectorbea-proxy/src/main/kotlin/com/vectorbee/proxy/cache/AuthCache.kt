package com.vectorbea.proxy.cache

import com.github.benmanes.caffeine.cache.AsyncCache
import com.github.benmanes.caffeine.cache.Caffeine
import java.time.Duration
import java.util.concurrent.CompletableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.future.asCompletableFuture
import kotlinx.coroutines.future.await

/**
 * Validation cache for agent / SDK tokens.
 *
 * Today the proxy trusts UDS peers (same-pod co-location), so there is no
 * inbound auth check. This cache exists so that when per-call token
 * validation is introduced (e.g. over TCP from an external SDK), the hot
 * path does not re-hit the hub on every request.
 *
 * Positive TTL is kept tight (60 s) so a revoked token is locked out
 * quickly; negative results are cached for a shorter window (10 s) so a
 * just-rotated token isn't blackholed for a full minute.
 *
 * Lookup cost on a hit: ~nanoseconds — one ConcurrentHashMap get, one
 * CompletableFuture.getNow.
 */
class AuthCache(
    positiveTtl: Duration = Duration.ofSeconds(60),
    private val negativeTtlMs: Long = 10_000,
    maxSize: Long = 50_000,
    private val validator: suspend (token: String) -> Boolean,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // value = (isValid, insertedAtMs). We bake the insertion time into the
    // value so we can enforce a short negative-TTL without maintaining a
    // second cache keyed the same way.
    private data class Result(val valid: Boolean, val insertedAtMs: Long)

    private val cache: AsyncCache<String, Result> =
        Caffeine.newBuilder()
            .maximumSize(maxSize)
            .expireAfterWrite(positiveTtl)
            .recordStats()
            .buildAsync()

    suspend fun isValid(token: String): Boolean {
        val future: CompletableFuture<Result> =
            cache.get(token) { key, _ ->
                scope.async { Result(validator(key), System.currentTimeMillis()) }
                    .asCompletableFuture()
            }

        val result = future.await()

        // Honour the shorter negative-TTL: if the last check said "invalid"
        // and it's been more than negativeTtlMs, invalidate so the next
        // lookup re-checks with the hub.
        if (!result.valid &&
            System.currentTimeMillis() - result.insertedAtMs > negativeTtlMs
        ) {
            cache.synchronous().invalidate(token)
            return isValid(token)
        }

        return result.valid
    }

    fun invalidate(token: String) = cache.synchronous().invalidate(token)
    fun invalidateAll() = cache.synchronous().invalidateAll()
    fun stats() = cache.synchronous().stats()
}
