package com.vectorbea.api.events

/**
 * Event bus abstraction for real-time run event broadcasting.
 *
 * Backed by Redis Pub/Sub (PUBLISH/SUBSCRIBE).
 *
 * Channel naming:
 *   run-events:{runId}
 *
 * Consumers (SSE endpoint, monitoring) subscribe to the channel.
 * Publishers (workflow executor, API handlers) call [publishRunEvent].
 *
 * Security:
 *   - NEVER publish secrets, connection strings, or API keys in event payloads.
 *   - Payloads are visible to anyone subscribed to the channel.
 *   - Use sanitized error messages only.
 */
interface EventBus {

    /**
     * Publish a run event JSON payload to the channel for [runId].
     *
     * The channel name is derived automatically:
     *   run-events:{runId}
     *
     * Failures are logged but NOT propagated — event delivery is best-effort.
     * The authoritative event record is in the [com.vectorbea.api.repository.RunEventRepository].
     *
     * @param runId     The run this event belongs to.
     * @param eventJson Serialized JSON string — must not contain secrets.
     */
    fun publishRunEvent(runId: String, eventJson: String)

    /**
     * Returns the pub/sub channel name for a given [runId].
     * Exposed so SSE subscribers can construct the correct channel string.
     */
    fun channelFor(runId: String): String
}
