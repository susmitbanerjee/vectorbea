package com.vectorbea.worker.queue

import kotlin.random.Random

/**
 * Adaptive exponential backoff for the queue poll loop.
 *
 * - [next] grows the delay geometrically (× [multiplier], capped at [maxMs]) and
 *   returns the delay to sleep, including up to [jitterMs] of random jitter so
 *   multiple workers don't wake in lockstep.
 * - [reset] returns the delay to the [baseMs] floor — call it whenever the worker
 *   made progress (successfully submitted a message to a pool).
 *
 * Not thread-safe: owned by the single poll thread. [currentMs] (without jitter)
 * is exposed for the backoff gauge metric.
 */
class PollBackoff(
    private val baseMs: Long,
    private val maxMs: Long,
    private val multiplier: Double,
    private val jitterMs: Long,
    private val rng: Random = Random.Default,
) {
    @Volatile
    var currentMs: Long = baseMs.coerceAtLeast(0)
        private set

    /** Reset to the floor — progress was made. */
    fun reset() { currentMs = baseMs.coerceAtLeast(0) }

    /** Grow the backoff and return the delay to sleep (current + jitter). */
    fun next(): Long {
        val delay = currentMs + if (jitterMs > 0) rng.nextLong(0, jitterMs + 1) else 0L
        currentMs = (currentMs.coerceAtLeast(1).toDouble() * multiplier)
            .toLong()
            .coerceIn(baseMs.coerceAtLeast(1), maxMs.coerceAtLeast(baseMs))
        return delay
    }
}
