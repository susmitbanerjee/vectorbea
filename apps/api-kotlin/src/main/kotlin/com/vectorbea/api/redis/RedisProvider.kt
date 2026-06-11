package com.vectorbea.api.redis

import com.vectorbea.api.config.RedisConfig
import io.lettuce.core.RedisClient
import io.lettuce.core.RedisURI
import io.lettuce.core.api.StatefulRedisConnection
import io.lettuce.core.api.sync.RedisCommands
import io.lettuce.core.pubsub.StatefulRedisPubSubConnection
import org.slf4j.LoggerFactory
import java.time.Duration

/**
 * Manages the Lettuce Redis client lifecycle.
 *
 * Single client, two connections:
 *   - [commands]    — synchronous commands (cache, queue, locks, heartbeat)
 *   - [pubSubConnection] — pub/sub publish (lazy, shared for publish-only use)
 *
 * The REDIS_URL value is NEVER logged — only its presence is noted.
 *
 * Thread-safety: Lettuce connections are thread-safe; [commands] may be called
 * from any thread without additional synchronization.
 */
class RedisProvider private constructor(
    private val client: RedisClient,
    private val connection: StatefulRedisConnection<String, String>,
    private val _pubSubConnection: StatefulRedisPubSubConnection<String, String>,
) {
    private val log = LoggerFactory.getLogger(RedisProvider::class.java)

    /** Synchronous command interface — thread-safe. */
    val commands: RedisCommands<String, String> = connection.sync()

    /** Pub/Sub connection for PUBLISH (subscribe not wired here). */
    val pubSubConnection: StatefulRedisPubSubConnection<String, String> = _pubSubConnection

    /**
     * Opens a fresh Pub/Sub connection for SUBSCRIBE use.
     * Each SSE stream gets its own connection so subscriptions are independent.
     * Callers MUST close the returned connection when done (client disconnect / run terminal).
     */
    fun newPubSubConnection(): StatefulRedisPubSubConnection<String, String> = client.connectPubSub()

    /**
     * Sends PING and returns round-trip latency, or throws on failure.
     */
    fun ping(): Long {
        val start = System.currentTimeMillis()
        val response = commands.ping()
        val latencyMs = System.currentTimeMillis() - start
        check(response.equals("PONG", ignoreCase = true)) {
            "Redis PING returned unexpected response: $response"
        }
        return latencyMs
    }

    /**
     * Attempt a ping; return a [PingResult] rather than throwing.
     * Used by [com.vectorbea.api.routes.HealthRoutes] for /ready.
     */
    fun pingResult(): PingResult = try {
        val latencyMs = ping()
        PingResult(ok = true, latencyMs = latencyMs)
    } catch (e: Exception) {
        log.warn("[redis] ping failed: ${e.message}")
        PingResult(ok = false, error = e.message ?: "unknown error")
    }

    fun close() {
        try { _pubSubConnection.close() } catch (_: Exception) {}
        try { connection.close() } catch (_: Exception) {}
        try { client.shutdown() } catch (_: Exception) {}
        log.info("[redis] client shut down")
    }

    data class PingResult(
        val ok: Boolean,
        val latencyMs: Long? = null,
        val error: String? = null,
    )

    companion object {
        private val log = LoggerFactory.getLogger(RedisProvider::class.java)

        /**
         * Creates a [RedisProvider] from [RedisConfig].
         * The URL is treated as a secret — never logged.
         */
        fun create(config: RedisConfig): RedisProvider {
            log.info("[redis] connecting (tls=${config.tlsEnabled}, timeout=${config.commandTimeoutMs}ms)")

            val uri = RedisURI.create(config.url).also { u ->
                if (config.tlsEnabled) {
                    u.isSsl = true
                    u.isVerifyPeer = false  // many managed Redis providers use self-signed certs
                }
                u.timeout = Duration.ofMillis(config.commandTimeoutMs)
            }

            val client = RedisClient.create(uri)
            val connection = client.connect()
            val pubSub = client.connectPubSub()

            log.info("[redis] connected")
            return RedisProvider(client, connection, pubSub)
        }
    }
}
