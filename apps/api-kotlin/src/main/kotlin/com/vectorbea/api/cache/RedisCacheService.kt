package com.vectorbea.api.cache

import com.vectorbea.api.http.mapper
import com.vectorbea.api.redis.RedisProvider
import io.lettuce.core.SetArgs
import org.slf4j.LoggerFactory

/**
 * Redis-backed [CacheService] using Lettuce sync commands.
 *
 * Key namespacing:
 *   All keys are prefixed with [prefix] (default: "vectorbea") to prevent
 *   collisions with other apps sharing the same Redis instance.
 *   Final key form: "{prefix}:{key}"
 *
 * Serialization:
 *   Values are serialized to JSON using the shared Jackson [mapper].
 *   Deserialization failures return null (cache miss semantics).
 *
 * Error handling:
 *   Redis errors on GET / DEL are caught and logged — cache misses degrade
 *   gracefully.  Errors on SET are also caught but logged at WARN level.
 *   Queue and lock operations propagate errors; this class is cache-only.
 */
class RedisCacheService(
    private val redis: RedisProvider,
    private val prefix: String,
) : CacheService {

    private val log = LoggerFactory.getLogger(RedisCacheService::class.java)

    // ── Key helpers ───────────────────────────────────────────────────────────

    private fun namespaced(key: String) = "$prefix:$key"

    // ── CacheService impl ─────────────────────────────────────────────────────

    override fun <T> get(key: String, clazz: Class<T>): T? {
        val nsKey = namespaced(key)
        return try {
            val json = redis.commands.get(nsKey) ?: return null
            mapper.readValue(json, clazz)
        } catch (e: Exception) {
            log.debug("[cache] GET miss/error for key={}: {}", nsKey, e.message)
            null
        }
    }

    override fun set(key: String, value: Any, ttlSeconds: Long) {
        require(ttlSeconds >= 1) { "Cache TTL must be at least 1 second, got $ttlSeconds" }
        val nsKey = namespaced(key)
        try {
            val json = mapper.writeValueAsString(value)
            redis.commands.set(nsKey, json, SetArgs().ex(ttlSeconds))
        } catch (e: Exception) {
            log.warn("[cache] SET failed for key={}: {}", nsKey, e.message)
        }
    }

    override fun del(key: String) {
        val nsKey = namespaced(key)
        try {
            redis.commands.del(nsKey)
        } catch (e: Exception) {
            log.warn("[cache] DEL failed for key={}: {}", nsKey, e.message)
        }
    }

    override fun delByPrefix(prefix: String) {
        val nsPrefix = namespaced(prefix)
        try {
            // Use SCAN to avoid blocking Redis with KEYS on large keyspaces
            var cursor = io.lettuce.core.ScanCursor.INITIAL
            val scanArgs = io.lettuce.core.ScanArgs.Builder.matches("$nsPrefix*").limit(200)
            do {
                val result = redis.commands.scan(cursor, scanArgs)
                if (result.keys.isNotEmpty()) {
                    redis.commands.del(*result.keys.toTypedArray())
                }
                cursor = result
            } while (!cursor.isFinished)
        } catch (e: Exception) {
            log.warn("[cache] DEL-BY-PREFIX failed for prefix={}: {}", nsPrefix, e.message)
        }
    }

    override fun <T : Any> getOrSet(key: String, ttlSeconds: Long, clazz: Class<T>, loader: () -> T): T {
        get(key, clazz)?.let { return it }
        val value = loader()
        set(key, value, ttlSeconds)
        return value
    }
}

/**
 * No-op [CacheService] used when Redis is unavailable in local/dev environments.
 * Every operation is a no-op (cache miss or silent discard).
 * Logs a one-time warning on first use.
 */
class NoOpCacheService : CacheService {
    private val log = LoggerFactory.getLogger(NoOpCacheService::class.java)
    @Volatile private var warnedOnce = false

    private fun warnOnce() {
        if (!warnedOnce) {
            log.warn("[cache] Redis unavailable — running with NO-OP cache. All cache operations are disabled.")
            warnedOnce = true
        }
    }

    override fun <T> get(key: String, clazz: Class<T>): T? { warnOnce(); return null }
    override fun set(key: String, value: Any, ttlSeconds: Long) { warnOnce() }
    override fun del(key: String) { warnOnce() }
    override fun delByPrefix(prefix: String) { warnOnce() }
    override fun <T : Any> getOrSet(key: String, ttlSeconds: Long, clazz: Class<T>, loader: () -> T): T {
        warnOnce(); return loader()
    }
}
