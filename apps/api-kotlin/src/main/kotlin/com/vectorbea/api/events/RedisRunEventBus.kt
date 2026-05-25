package com.vectorbea.api.events

import com.vectorbea.api.redis.RedisProvider
import org.slf4j.LoggerFactory

/**
 * Redis Pub/Sub implementation of [EventBus].
 *
 * Uses PUBLISH on the pub/sub connection to broadcast run events to any
 * connected SSE subscribers or monitoring listeners.
 *
 * Channel pattern:
 *   {channelPrefix}:{runId}
 *   e.g. "run-events:550e8400-e29b-41d4-a716-446655440000"
 *
 * Pub/Sub delivery guarantees:
 *   - Fire and forget — if no subscribers are listening, the message is dropped.
 *   - The durable record is in run_events table; pub/sub is for live push only.
 *   - Failures are caught and logged — never propagated to callers.
 */
class RedisRunEventBus(
    private val redis: RedisProvider,
    private val channelPrefix: String,
) : EventBus {

    private val log = LoggerFactory.getLogger(RedisRunEventBus::class.java)

    override fun channelFor(runId: String) = "$channelPrefix:$runId"

    override fun publishRunEvent(runId: String, eventJson: String) {
        val channel = channelFor(runId)
        try {
            // PUBLISH returns the number of clients that received the message
            val receivers = redis.pubSubConnection.sync().publish(channel, eventJson)
            log.debug("[events] published to channel={} receivers={}", channel, receivers)
        } catch (e: Exception) {
            // Best-effort — the DB record is the source of truth
            log.warn("[events] PUBLISH failed channel={}: {}", channel, e.message)
        }
    }
}
