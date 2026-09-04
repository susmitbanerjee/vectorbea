package com.vectorbea.worker.net

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * A circuit breaker per connection.
 *
 * WHAT IT IS ACTUALLY FOR
 * -----------------------
 * A provider that is down does not fail fast — it fails *slowly*. Every call
 * burns its full timeout before failing, so a dead endpoint converts a 30-second
 * socket timeout into 30 seconds of held permit, per call, per run. Twenty runs
 * pointed at that connection consume twenty permits doing nothing. The pool is
 * exhausted by a provider outage that has nothing to do with anyone else's work.
 *
 * Opening the circuit turns those 30 seconds into microseconds, which is the
 * whole point: the failure is contained to the connection that caused it.
 *
 * IT IS ALSO A USER-VISIBLE FEATURE
 * ---------------------------------
 * State is written to `connections`, not held only in memory, because "this
 * connection is unhealthy" is something the Connections page shows and the
 * blast-radius view depends on. A breaker whose state lives only in a worker's
 * heap protects the fleet and tells the customer nothing — they see a workflow
 * failing and no reason why.
 *
 * THE THREE STATES
 * ----------------
 *   **closed**    calls flow. Consecutive failures counted; any success resets.
 *   **open**      calls rejected immediately for [cooldownMs]. No I/O attempted.
 *   **half_open** exactly one probe is allowed through. Success closes the
 *                 circuit; failure re-opens it for another cooldown.
 *
 * The half-open state is what makes this recover automatically. Without it, a
 * breaker either stays open forever or reopens the floodgates all at once onto a
 * provider that may still be struggling — and a thundering herd of retries is how
 * a recovering service is knocked back down.
 *
 * IN-MEMORY FIRST, POSTGRES SECOND
 * --------------------------------
 * The decision is read from a local map so the hot path costs a hash lookup
 * rather than a query. The database write happens on transitions only — open,
 * close, half-open — which are rare by construction. Each worker therefore keeps
 * its own count, so a fleet of N workers tolerates up to N×threshold failures
 * before every one of them has opened. That is deliberate: sharing the counter
 * would put a write on every failure, and the containment goal is met once each
 * worker independently stops calling.
 */
class ConnectionCircuit(
    private val dataSource: DataSource?,
    private val failureThreshold: Int =
        System.getenv("CIRCUIT_FAILURE_THRESHOLD")?.toIntOrNull() ?: 5,
    private val cooldownMs: Long =
        System.getenv("CIRCUIT_COOLDOWN_MS")?.toLongOrNull() ?: 30_000L,
) {
    private val log = logger()

    enum class State { CLOSED, OPEN, HALF_OPEN }

    private class Entry {
        @Volatile var state: State = State.CLOSED
        @Volatile var consecutiveFailures: Int = 0
        @Volatile var openedAtMs: Long = 0
        @Volatile var lastError: String? = null
        /** Guards the single half-open probe so N threads do not all probe at once. */
        val probeInFlight = AtomicBoolean(false)
    }

    private val entries = ConcurrentHashMap<UUID, Entry>()

    /** Thrown instead of attempting a call the breaker has rejected. */
    class CircuitOpenException(
        val connectionId: UUID,
        val retryAfterSeconds: Long,
        val lastError: String?,
    ) : RuntimeException(
        "This connection is temporarily unavailable: it has failed repeatedly and " +
            "further calls are paused for ${retryAfterSeconds}s to let it recover." +
            (lastError?.let { " Last error: $it" } ?: "")
    )

    /**
     * Ask permission to call.
     *
     * @throws CircuitOpenException when the circuit is open and the cooldown has
     *         not elapsed — a fast, specific failure rather than a slow, generic
     *         one.
     */
    fun beforeCall(connectionId: UUID) {
        val e = entries[connectionId] ?: return
        when (e.state) {
            State.CLOSED -> return
            State.HALF_OPEN -> {
                // One probe at a time. Everyone else is rejected as if still open,
                // so a recovering provider gets one request rather than a stampede.
                if (!e.probeInFlight.compareAndSet(false, true)) {
                    throw CircuitOpenException(connectionId, remainingCooldown(e), e.lastError)
                }
            }
            State.OPEN -> {
                val elapsed = System.currentTimeMillis() - e.openedAtMs
                if (elapsed < cooldownMs) {
                    WorkerMetrics.circuitRejectedTotal.inc()
                    throw CircuitOpenException(connectionId, remainingCooldown(e), e.lastError)
                }
                // Cooldown elapsed — try one probe.
                e.state = State.HALF_OPEN
                e.probeInFlight.set(true)
                persist(connectionId, State.HALF_OPEN, e.consecutiveFailures, e.lastError)
                log.info("[circuit] {} → half_open, probing", connectionId)
            }
        }
    }

    /** A call succeeded. Closes the circuit and clears the failure count. */
    fun onSuccess(connectionId: UUID) {
        val e = entries[connectionId] ?: return
        e.probeInFlight.set(false)
        if (e.state == State.CLOSED && e.consecutiveFailures == 0) return
        val wasOpen = e.state != State.CLOSED
        e.state = State.CLOSED
        e.consecutiveFailures = 0
        e.lastError = null
        persist(connectionId, State.CLOSED, 0, null)
        if (wasOpen) {
            WorkerMetrics.circuitClosedTotal.inc()
            log.info("[circuit] {} recovered → closed", connectionId)
        }
    }

    /**
     * A call failed.
     *
     * @param sanitizedError safe to store and show — no stack trace, no
     *        connection string, no credential. The caller sanitises because only
     *        the caller knows which parts of its error are safe.
     */
    fun onFailure(connectionId: UUID, sanitizedError: String) {
        val e = entries.computeIfAbsent(connectionId) { Entry() }
        e.probeInFlight.set(false)
        e.lastError = sanitizedError.take(500)

        // A failed probe re-opens immediately rather than counting toward the
        // threshold again. The probe *was* the test, and it said no.
        if (e.state == State.HALF_OPEN) {
            e.state = State.OPEN
            e.openedAtMs = System.currentTimeMillis()
            persist(connectionId, State.OPEN, e.consecutiveFailures, e.lastError)
            log.warn("[circuit] {} probe failed → open for {}ms", connectionId, cooldownMs)
            return
        }

        e.consecutiveFailures++
        if (e.state == State.CLOSED && e.consecutiveFailures >= failureThreshold) {
            e.state = State.OPEN
            e.openedAtMs = System.currentTimeMillis()
            WorkerMetrics.circuitOpenedTotal.inc()
            persist(connectionId, State.OPEN, e.consecutiveFailures, e.lastError)
            log.warn("[circuit] {} opened after {} consecutive failures — pausing calls for {}ms. Last: {}",
                connectionId, e.consecutiveFailures, cooldownMs, e.lastError)
        }
    }

    /** Current state, for a status endpoint or a test. */
    fun stateOf(connectionId: UUID): State = entries[connectionId]?.state ?: State.CLOSED

    private fun remainingCooldown(e: Entry): Long =
        ((cooldownMs - (System.currentTimeMillis() - e.openedAtMs)) / 1000).coerceAtLeast(1)

    /**
     * Publish state so the Connections UI can show it.
     *
     * Best-effort and never throws: the breaker's job is containment, and failing
     * a call because we could not *report* the breaker's state would be the guard
     * causing the outage it exists to prevent.
     */
    private fun persist(connectionId: UUID, state: State, failures: Int, error: String?) {
        val ds = dataSource ?: return
        runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE connections
                          SET circuit_state = ?, consecutive_failures = ?,
                              circuit_opened_at = CASE WHEN ? = 'open' THEN now() ELSE NULL END,
                              circuit_last_error = ?,
                              network_status = CASE WHEN ? = 'closed' THEN 'healthy' ELSE 'unhealthy' END,
                              updated_at = now()
                        WHERE id = ?"""
                ).use { stmt ->
                    val wire = state.name.lowercase()
                    stmt.setString(1, wire)
                    stmt.setInt(2, failures)
                    stmt.setString(3, wire)
                    stmt.setString(4, error)
                    stmt.setString(5, wire)
                    stmt.setObject(6, connectionId)
                    stmt.executeUpdate()
                }
            }
        }.onFailure {
            log.warn("[circuit] could not publish state for {}: {}", connectionId, it.message)
        }
    }
}
