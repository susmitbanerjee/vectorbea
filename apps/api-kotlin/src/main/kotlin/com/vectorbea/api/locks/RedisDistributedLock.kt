package com.vectorbea.api.locks

import com.vectorbea.api.redis.RedisProvider
import io.lettuce.core.SetArgs
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Redis-backed [DistributedLock] using SET NX PX + token-guarded DEL.
 *
 * Acquire algorithm:
 *   SET {prefix}:{key} {token} NX PX {ttlMs}
 *   → OK   → lock acquired; token stored for safe release
 *   → null → lock held by another process; [LockNotAcquiredException] thrown
 *
 * Release algorithm:
 *   GET {prefix}:{key} → compare to [token]
 *   If match → DEL {prefix}:{key}
 *   If mismatch → lock expired and re-acquired by someone else; no-op (log warn)
 *
 * Note: the check-then-delete is NOT atomic; for strict safety under extreme
 * clock skew a Lua script would be used.  For this workload (TTL >> network
 * latency) the two-step approach is sufficient.
 */
class RedisDistributedLock(
    private val redis: RedisProvider,
    private val prefix: String,
) : DistributedLock {

    private val log = LoggerFactory.getLogger(RedisDistributedLock::class.java)

    override fun <T> withLock(key: String, ttlSeconds: Long, block: () -> T): T {
        val handle = tryAcquire(key, ttlSeconds)
            ?: throw LockNotAcquiredException(key)
        return try {
            block()
        } finally {
            handle.release()
        }
    }

    override fun tryAcquire(key: String, ttlSeconds: Long): LockHandle? {
        require(ttlSeconds >= 1) { "Lock TTL must be at least 1 second, got $ttlSeconds" }
        val nsKey = namespaced(key)
        val token = UUID.randomUUID().toString()
        val ttlMs = ttlSeconds * 1_000L

        val result = redis.commands.set(nsKey, token, SetArgs().nx().px(ttlMs))
        return if (result == "OK") {
            log.debug("[lock] acquired key={} ttl={}s", nsKey, ttlSeconds)
            RedisLockHandle(nsKey, token)
        } else {
            log.debug("[lock] not acquired (held) key={}", nsKey)
            null
        }
    }

    private fun namespaced(key: String) = "$prefix:$key"

    // ── Inner handle ──────────────────────────────────────────────────────────

    inner class RedisLockHandle(
        override val key: String,
        private val token: String,
    ) : LockHandle {

        override fun release() {
            try {
                val current = redis.commands.get(key)
                if (current == token) {
                    redis.commands.del(key)
                    log.debug("[lock] released key={}", key)
                } else {
                    // Lock expired and was re-acquired or doesn't exist — nothing to do
                    log.warn(
                        "[lock] release skipped for key={} — token mismatch " +
                            "(lock expired or re-acquired by another holder)", key,
                    )
                }
            } catch (e: Exception) {
                log.error("[lock] release failed for key={}: {}", key, e.message)
                // Do not rethrow — best-effort release; lock will expire on TTL
            }
        }
    }
}
