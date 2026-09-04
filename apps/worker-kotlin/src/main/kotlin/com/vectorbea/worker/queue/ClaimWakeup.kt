package com.vectorbea.worker.queue

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import org.postgresql.PGConnection
import java.sql.DriverManager
import java.util.Properties
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Wakes claim loops when work arrives, without tight polling.
 *
 * Hybrid on purpose:
 *
 *   NOTIFY   near-zero latency when work arrives, and near-zero cost when it does
 *            not — which is the point. A 100 ms poll across four classes and
 *            three replicas is ~2.6 M queries a day against an idle queue, and on
 *            Neon that is compute-hours spent discovering nothing.
 *
 *   2s poll  the safety net. Notifications are fire-and-forget: a listener that
 *            was reconnecting when one fired never sees it. The poll also covers
 *            what no INSERT announces — due timers, expired leases, and runs
 *            stuck in `claimed` by a worker that died.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE POOLER TRAP — read before changing the connection handling
 * ────────────────────────────────────────────────────────────────────────────
 * **LISTEN does not survive transaction pooling.** PgBouncer in transaction mode
 * (and Neon's pooled endpoint, `...-pooler.<region>.aws.neon.tech`) hands your
 * session to another client after each transaction, so the LISTEN registration
 * is silently dropped. Nothing errors. Notifications simply never arrive, and the
 * system keeps working — on the 2 s safety poll — while appearing to be
 * event-driven.
 *
 * That failure is invisible in every metric except latency, which is why this
 * class checks for it explicitly: [warnIfPooledEndpoint] refuses to be quiet
 * about a pooled host, and [notificationsReceived] is exported so a deployment
 * where NOTIFY is dead can be spotted from a dashboard rather than from a bug
 * report six weeks later.
 *
 * The listener therefore uses its own **direct, non-pooled** connection, opened
 * from `DATABASE_DIRECT_URL` when set. That connection is used for nothing else:
 * it is idle except when a notification arrives.
 */
class ClaimWakeup(
    private val directUrl: String,
    /** Called with the execution class that has new work, or null for "check everything". */
    private val onWakeup: (String?) -> Unit,
    private val safetyPollMs: Long =
        System.getenv("CLAIM_SAFETY_POLL_MS")?.toLongOrNull() ?: 2_000L,
) : AutoCloseable {

    private val log = logger()
    private val running = AtomicBoolean(false)
    private var listenThread: Thread? = null
    private var pollThread: Thread? = null

    /** Notifications actually received. Zero on a busy system means LISTEN is dead. */
    private val notificationsReceived = AtomicLong(0)
    private val safetyPollWakeups = AtomicLong(0)

    companion object {
        const val CHANNEL = "run_queued"

        /**
         * Resolve the listener's connection string.
         *
         * `DATABASE_DIRECT_URL` first, because the pooled URL that works fine for
         * everything else is exactly the one that breaks LISTEN.
         */
        fun resolveDirectUrl(): String? =
            System.getenv("DATABASE_DIRECT_URL")?.takeIf { it.isNotBlank() }
                ?: System.getenv("DATABASE_URL")?.takeIf { it.isNotBlank() }

        /** Hosts that indicate a transaction pooler sits in front of Postgres. */
        private val POOLED_HINTS = listOf("-pooler.", "pgbouncer", ":6432")
    }

    /**
     * Refuse to be quiet about a pooled endpoint.
     *
     * Logged at ERROR rather than WARN because the consequence is silent: the
     * system still works, just on the fallback poll, and nobody finds out until
     * someone asks why claim latency is 2 s.
     */
    private fun warnIfPooledEndpoint(url: String) {
        val looksPooled = POOLED_HINTS.any { url.contains(it, ignoreCase = true) }
        if (looksPooled) {
            log.error(
                "[wakeup] LISTEN connection appears to point at a TRANSACTION POOLER. " +
                    "LISTEN does not survive transaction pooling — registrations are dropped " +
                    "silently and notifications will NEVER arrive. The claim loop will fall back " +
                    "to the {}ms safety poll and appear to work. Set DATABASE_DIRECT_URL to the " +
                    "direct (non-pooled) endpoint.", safetyPollMs,
            )
        } else {
            log.info("[wakeup] LISTEN using a direct connection (not pooled) — correct")
        }
    }

    fun start() {
        running.set(true)
        warnIfPooledEndpoint(directUrl)

        listenThread = Thread(::listenLoop, "claim-listen").apply { isDaemon = true; start() }
        pollThread = Thread(::safetyPollLoop, "claim-safety-poll").apply { isDaemon = true; start() }

        log.info("[wakeup] started — NOTIFY on '{}' + {}ms safety poll", CHANNEL, safetyPollMs)
    }

    /**
     * Hold one dedicated connection open and block on notifications.
     *
     * `getNotifications(timeout)` blocks the thread, which is fine and deliberate:
     * this is one thread per worker, not per run, and it is doing the one job
     * that genuinely wants a dedicated connection.
     */
    private fun listenLoop() {
        while (running.get()) {
            var conn: java.sql.Connection? = null
            try {
                val props = Properties().apply {
                    setProperty("ApplicationName", "vectorbea-claim-listener")
                    // Long socket timeout: this connection is idle by design and
                    // must not be reaped for being quiet.
                    setProperty("socketTimeout", "0")
                    setProperty("tcpKeepAlive", "true")
                }
                conn = DriverManager.getConnection(directUrl, props)
                conn.createStatement().use { it.execute("LISTEN $CHANNEL") }
                log.info("[wakeup] LISTEN {} registered", CHANNEL)

                val pg = conn.unwrap(PGConnection::class.java)
                while (running.get() && !conn.isClosed) {
                    // Blocks up to 10s, then returns null so the loop can notice
                    // shutdown and re-check the connection is alive.
                    val notifications = pg.getNotifications(10_000)
                    if (notifications.isNullOrEmpty()) continue
                    for (n in notifications) {
                        notificationsReceived.incrementAndGet()
                        WorkerMetrics.claimWakeupTotal.inc("notify")
                        onWakeup(n.parameter?.takeIf { it.isNotBlank() })
                    }
                }
            } catch (e: Exception) {
                if (!running.get()) break
                log.warn("[wakeup] LISTEN connection lost ({}) — reconnecting in 2s. " +
                    "The safety poll covers the gap.", e.message)
                runCatching { Thread.sleep(2_000) }
            } finally {
                runCatching { conn?.close() }
            }
        }
        log.info("[wakeup] LISTEN loop exited")
    }

    /**
     * The safety net, and the only thing that catches work no INSERT announces:
     * due timers, expired leases, and runs stranded in `claimed`.
     */
    private fun safetyPollLoop() {
        while (running.get()) {
            try {
                Thread.sleep(safetyPollMs)
                if (!running.get()) break
                safetyPollWakeups.incrementAndGet()
                WorkerMetrics.claimWakeupTotal.inc("safety_poll")
                onWakeup(null)   // null = check every class
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt(); break
            } catch (e: Exception) {
                log.debug("[wakeup] safety poll error: {}", e.message)
            }
        }
    }

    /**
     * Health of the notification path.
     *
     * Ratio near zero on a busy system means LISTEN is not delivering — almost
     * always the pooler trap above.
     */
    fun stats(): Map<String, Long> = mapOf(
        "notifications" to notificationsReceived.get(),
        "safetyPolls" to safetyPollWakeups.get(),
    )

    override fun close() {
        running.set(false)
        listenThread?.interrupt()
        pollThread?.interrupt()
        log.info("[wakeup] stopped — {} notification(s), {} safety poll(s)",
            notificationsReceived.get(), safetyPollWakeups.get())
    }
}
