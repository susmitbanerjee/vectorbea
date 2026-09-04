package com.vectorbea.worker.queue

import java.util.concurrent.atomic.AtomicInteger

/**
 * Chooses how many messages to pull per `XREADGROUP`.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The read is already bounded by *free* capacity — free pool slots plus free
 * local buffer room, summed across the four pools. That bound is necessary but
 * it is **not sufficient**, and the reason is structural:
 *
 *   the stream is untyped, so a message's execution class is only known
 *   *after* it has been read and the classifier has probed Postgres.
 *
 * So "8 placements available" can mean "8 free SHORT slots" while the next eight
 * messages are all AGENT. Those eight cannot be placed, cannot be buffered once
 * the AGENT buffer fills, and are left unacked in this worker's PEL — where no
 * other worker can take them until the idle threshold expires. Over-reading is
 * how a worker hoards work it cannot start.
 *
 * A capacity sum cannot fix that. Only `min` across every pool could guarantee
 * placement, and that would be zero whenever any single pool is busy — stalling
 * healthy classes to protect a saturated one. §2.1 of
 * 09-EXECUTION-ARCHITECTURE-REVISED.md fixes it properly by typing the queue at
 * enqueue time, so each pool reads only its own class.
 *
 * THE INTERIM CONTROL
 * -------------------
 * Until then, this controller does not try to predict the class mix. It measures
 * the outcome and reacts, AIMD-style — the same shape as [PollBackoff]:
 *
 *   parked anything last poll  → halve the batch (multiplicative decrease)
 *   parked nothing last poll   → grow by one, up to the configured max (additive increase)
 *
 * A skewed mix therefore costs a handful of parked messages once, then the batch
 * shrinks toward 1 and the worker stops hoarding. When the mix evens out or
 * capacity frees up, throughput climbs back. Nothing is predicted and nothing is
 * tuned by hand.
 *
 * Not thread-safe by design beyond the atomic: only the single poll thread
 * drives it.
 */
class AdaptiveReadBatch(
    /** Ceiling — the configured `WORKER_READ_BATCH_SIZE`. */
    private val maxBatch: Int,
) {
    private val current = AtomicInteger(maxBatch.coerceAtLeast(1))

    /** Messages to request next, never more than [available] placements. */
    fun next(available: Int): Int {
        if (available <= 0) return 0
        return minOf(current.get(), available).coerceAtLeast(1)
    }

    /** At least one message could not be placed and was left in the PEL. */
    fun onParked() {
        current.updateAndGet { (it / 2).coerceAtLeast(1) }
    }

    /** Every message read found a slot or a buffer. */
    fun onAllPlaced() {
        current.updateAndGet { (it + 1).coerceAtMost(maxBatch.coerceAtLeast(1)) }
    }

    /** Current batch size, for the gauge. */
    val currentBatch: Int get() = current.get()
}
