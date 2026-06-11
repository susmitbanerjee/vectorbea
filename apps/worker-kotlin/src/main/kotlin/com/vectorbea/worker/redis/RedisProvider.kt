package com.vectorbea.worker.redis

import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.logging.logger
import io.lettuce.core.RedisClient
import io.lettuce.core.RedisURI
import io.lettuce.core.api.StatefulRedisConnection
import io.lettuce.core.api.sync.RedisCommands
import io.lettuce.core.pubsub.StatefulRedisPubSubConnection
import java.time.Duration

/**
 * Manages the Lettuce Redis client lifecycle for the worker.
 *
 * Two connections:
 *  - [commands]         — synchronous commands (heartbeat, XREADGROUP, XACK, HSET)
 *  - [pubSubConnection] — dedicated pub/sub for PUBLISH (write-only in worker)
 *
 * SECURITY: REDIS_URL is NEVER logged.
 * Thread-safety: Lettuce connections are fully thread-safe.
 */
class RedisProvider private constructor(
    private val client: RedisClient,
    private val connection: StatefulRedisConnection<String, String>,
    private val _pubSubConnection: StatefulRedisPubSubConnection<String, String>,
) {
    private val log = logger()

    /** Synchronous command interface — use from any thread. */
    val commands: RedisCommands<String, String> = connection.sync()

    /** Pub/Sub connection for PUBLISH only. */
    val pubSubConnection: StatefulRedisPubSubConnection<String, String> = _pubSubConnection

    /** Round-trip PING. Returns latency ms or throws. */
    fun ping(): Long {
        val start = System.currentTimeMillis()
        val resp = commands.ping()
        check(resp.equals("PONG", ignoreCase = true)) { "Redis PING returned: $resp" }
        return System.currentTimeMillis() - start
    }

    fun close() {
        try { _pubSubConnection.close() } catch (_: Exception) {}
        try { connection.close() } catch (_: Exception) {}
        try { client.shutdown() } catch (_: Exception) {}
        log.info("[redis] client shut down")
    }

    companion object {
        private val log = logger("com.vectorbea.worker.redis.RedisProvider")

        fun create(config: WorkerConfig): RedisProvider {
            log.info("[redis] connecting (tls={}, timeout={}ms)",
                config.redisTlsEnabled, config.redisCommandTimeoutMs)

            // SECURITY: config.redisUrl never passed to log
            val uri = RedisURI.create(config.redisUrl).also { u ->
                if (config.redisTlsEnabled) {
                    u.isSsl = true
                    u.isVerifyPeer = false
                }
                u.timeout = Duration.ofMillis(config.redisCommandTimeoutMs)
            }

            val client = RedisClient.create(uri)
            val connection = client.connect()
            val pubSub = client.connectPubSub()

            log.info("[redis] connected")
            return RedisProvider(client, connection, pubSub)
        }
    }
}
