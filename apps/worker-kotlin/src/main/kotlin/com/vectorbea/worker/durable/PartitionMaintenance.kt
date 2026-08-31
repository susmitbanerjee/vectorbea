package com.vectorbea.worker.durable

import com.vectorbea.worker.logging.logger
import io.lettuce.core.api.sync.RedisCommands
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * Creates next month's partitions before anything needs to write into them.
 *
 * ── WHY THIS EXISTS, AND WHY IT COVERS run_events TOO ───────────────────────
 * V028 shipped `run_events_ensure_partition()` and
 * `run_events_drop_expired_partitions()` and **nothing has ever called them** —
 * there is no scheduler, no pg_cron, no pg_partman in this stack. V028 created
 * the current month plus two at migration time and stopped.
 *
 * `run_events` has no DEFAULT partition, so when the last pre-created month
 * elapses an INSERT does not degrade, it errors: "no partition of relation
 * run_events found for row". Every event write in the system stops. V028 deployed
 * 2026-08-17 and pre-created through 2026-10-31, which dates the cliff.
 *
 * So this job maintains BOTH tables. Building it for `run_spans` alone while the
 * other table's functions sit uncalled would guarantee a second pass, and the
 * second pass would be written under an incident.
 *
 * ── DROPPING IS OFF BY DEFAULT AND MUST BE TURNED ON DELIBERATELY ───────────
 * An untested detach-and-drop path running hourly against a table nobody has ever
 * maintained is the one way this work can lose data that mattered. With
 * `PARTITION_DROP_ENABLED` unset, expired partitions are only NAMED in the log, so
 * a cycle of logs can be read before anything is destroyed.
 *
 * ── AND, SINCE §12.1, IT IS GATED ON THE EXPORT ─────────────────────────────
 * The tiering story is hot 7 days in Postgres, warm 90 days in object storage,
 * cold export-only. That only holds if the export happens BEFORE the drop, and a
 * drop decided purely on age does not know whether it did. So when a
 * [TraceArchiver] is wired in, this refuses to drop anything for a table that
 * still has an un-exported partition past the hot window: an exporter that has
 * been failing for a week stops the drop instead of racing it.
 *
 * The check is deliberately on the ARCHIVER's queue and not on "every partition
 * has a ledger row" — the current month never does and never should, so the
 * latter would refuse every drop forever, which reads as a bug and gets disabled.
 */
class PartitionMaintenance(
    private val dataSource: DataSource,
    private val redisCommands: RedisCommands<String, String>?,
    private val pollIntervalMs: Long =
        System.getenv("PARTITION_MAINTENANCE_INTERVAL_MS")?.toLongOrNull() ?: 3_600_000L,
    private val lockTtlSeconds: Long = 120L,
    /**
     * Actually drop expired partitions, rather than logging what would be dropped.
     * Defaults OFF. Turn it on only after reading a cycle of the log-only output.
     */
    private val dropEnabled: Boolean =
        System.getenv("PARTITION_DROP_ENABLED")?.lowercase() == "true",
    /**
     * How long a finished run's event-sequence counter is kept.
     *
     * Days rather than minutes: a late cancel, an approval decision or a replay
     * can append to a run well after the worker considers it done, and a counter
     * deleted too early re-seeds from `MAX(sequence)` — which is only correct
     * while that run's partition still exists.
     */
    private val seqCounterKeepDays: Int =
        System.getenv("RUN_EVENT_SEQ_KEEP_DAYS")?.toIntOrNull()?.coerceIn(1, 365) ?: 7,
    /**
     * Exports closed partitions to the warm tier before they are dropped.
     *
     * Null means no tiering: the drop then behaves exactly as it did before
     * §12.1, which is the correct behaviour for a deployment that has not
     * configured object storage — the alternative is refusing to ever drop, and
     * a retention job that never runs fills a disk.
     */
    private val archiver: com.vectorbea.worker.durable.archive.TraceArchiver? = null,
) {
    private val log = logger()
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "partition-maintenance").also { it.isDaemon = true }
    }
    private var future: ScheduledFuture<*>? = null

    private companion object {
        const val LOCK_KEY = "vectorbea:partition-maintenance:lock"
        /** Tables this job maintains. Adding one is a line here plus its functions. */
        val TABLES = listOf("run_events", "run_spans")
    }

    fun start() {
        if (running.compareAndSet(false, true)) {
            /* Runs once shortly after boot, not only on the hour: if a worker starts
               on the 1st with the month's partition missing, waiting an hour to find
               out is an hour of failed writes. */
            future = executor.scheduleWithFixedDelay(
                ::tick, 20_000L, pollIntervalMs, TimeUnit.MILLISECONDS)
            log.info("[partitions] maintenance started (interval={}ms, dropEnabled={})",
                pollIntervalMs, dropEnabled)
        }
    }

    fun stop() {
        running.set(false)
        future?.cancel(false)
        executor.shutdown()
    }

    internal fun tick() {
        if (!running.get()) return
        if (!acquireLock()) return
        try {
            /* Export first, drop second. Both inside the same Redis lock, so two
               workers cannot export the same partition concurrently — the write is
               atomic and the ledger upsert is idempotent, so a race would be
               survivable, but it would also double the egress for nothing. */
            val exported = archiver?.let { a -> runCatching { a.runOnce() }.getOrElse {
                log.error("[archive] export pass failed: {}", it.message); emptyList() } }
            if (!exported.isNullOrEmpty()) {
                log.info("[archive] exported {} partition(s): {}", exported.size,
                    exported.joinToString { "${it.partition}(${it.rows} rows)" })
            }

            TABLES.forEach { table ->
                if (!isPartitioned(table)) {
                    /* Not partitioned is a legitimate state, not a fault: V028
                       declines its own conversion above ~5M rows and says so. Calling
                       ensure() on a plain table would raise; skipping is correct. */
                    log.debug("[partitions] {} is not partitioned — skipping", table)
                    return@forEach
                }
                ensureAhead(table)
                reportOrDropExpired(table)
            }
            reportDefaultPartition()
            pruneEventSequenceCounters()
        } catch (e: Exception) {
            log.error("[partitions] maintenance tick failed: {}", e.message)
        }
    }

    /** Current month plus two, so a lapse of one cycle cannot reach the edge. */
    private fun ensureAhead(table: String) {
        listOf("now()", "now() + interval '1 month'", "now() + interval '2 months'")
            .forEach { expr ->
                runCatching {
                    dataSource.connection.use { conn ->
                        conn.prepareStatement("SELECT ${table}_ensure_partition(($expr)::date)")
                            .use { st ->
                                st.executeQuery().use { rs ->
                                    if (rs.next()) {
                                        val r = rs.getString(1)
                                        if (r != null && r.endsWith("(created)"))
                                            log.info("[partitions] {}", r)
                                    }
                                }
                            }
                    }
                }.onFailure { log.warn("[partitions] ensure failed for {}: {}", table, it.message) }
            }
    }

    internal fun reportOrDropExpired(table: String) {
        /* The export gate. Anything past the hot window that has not reached the
           warm tier is, by definition, older than the drop cutoff would eventually
           make it — so dropping now would destroy the only copy. */
        val unexported = archiver?.let { runCatching { it.due(table) }.getOrElse {
            /* A gate that fails OPEN is not a gate. If we cannot tell whether the
               data is safe, it is not safe. */
            log.error("[archive] cannot determine export state for {} — refusing to drop: {}",
                table, it.message)
            listOf(Triple("unknown", java.time.LocalDate.EPOCH, java.time.LocalDate.EPOCH))
        } }
        if (!unexported.isNullOrEmpty()) {
            log.warn("[partitions] {} has {} un-exported partition(s) past the hot window " +
                "({}) — NOT dropping anything for this table until they reach the warm tier",
                table, unexported.size, unexported.joinToString { it.first })
            return
        }
        if (!dropEnabled) {
            /* Name what WOULD go, without touching it. Reads the same catalog the
               drop function does, so the log is the drop's dry run rather than an
               approximation of it. */
            runCatching {
                dataSource.connection.use { conn ->
                    conn.prepareStatement(
                        """SELECT c.relname
                             FROM pg_class c
                             JOIN pg_inherits i ON i.inhrelid = c.oid
                             JOIN pg_class p ON p.oid = i.inhparent
                            WHERE p.relname = ?
                              AND c.relname ~ ('^' || ? || '_[0-9]{4}_[0-9]{2}$')"""
                    ).use { st ->
                        st.setString(1, table); st.setString(2, table)
                        st.executeQuery().use { rs ->
                            val all = buildList { while (rs.next()) add(rs.getString(1)) }
                            log.info("[partitions] {} has {} monthly partition(s); dropping is " +
                                "DISABLED (set PARTITION_DROP_ENABLED=true to enable): {}",
                                table, all.size, all.takeLast(6))
                        }
                    }
                }
            }
            return
        }
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT * FROM ${table}_drop_expired_partitions()").use { st ->
                    st.executeQuery().use { rs ->
                        val dropped = buildList { while (rs.next()) add(rs.getString(1)) }
                        dropped.forEach { log.warn("[partitions] dropped {}", it) }
                        /* Stamp the ledger. "Exported" and "no longer in Postgres" are
                           different questions during an incident, and after the drop
                           the ledger row is the only place either can be answered. */
                        if (dropped.isNotEmpty()) conn.prepareStatement(
                            "UPDATE run_trace_archives SET dropped_at = now() " +
                            "WHERE source_table = ? AND partition_name = ANY(?)"
                        ).use { up ->
                            up.setString(1, table)
                            up.setArray(2, conn.createArrayOf("text", dropped.toTypedArray()))
                            up.executeUpdate()
                        }
                    }
                }
            }
        }.onFailure { log.error("[partitions] drop failed for {}: {}", table, it.message) }
    }

    /**
     * The default partition should be empty.
     *
     * Anything in it means a month went uncreated and spans are landing on the slow
     * path. A default partition nobody watches is how a dead maintenance job stays
     * undiscovered for weeks.
     */
    private fun reportDefaultPartition() {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT run_spans_default_partition_rows()").use { st ->
                    st.executeQuery().use { rs ->
                        if (rs.next()) {
                            val n = rs.getLong(1)
                            if (n > 0) log.warn(
                                "[partitions] run_spans_default holds {} row(s) — a monthly " +
                                "partition was missing when they were written", n)
                        }
                    }
                }
            }
        }
    }

    /**
     * Drop `run_event_seq` rows for runs that finished days ago.
     *
     * ── WHY THIS CALL SITE EXISTS AT ALL ────────────────────────────────────
     * `run_event_seq_prune()` shipped in V046 with no caller, and V046's own
     * table comment claimed it was pruned. That is the third time: V028 shipped
     * `run_events_ensure_partition()` and `run_events_drop_expired_partitions()`
     * the same way, and this class was written to fix exactly that. Writing the
     * function and never calling it is evidently the easy mistake to make here,
     * which is why `MigrationFunctionCallersTest` now fails the build for it.
     *
     * One row per run, and only while the counter mode is on — but "only while
     * the flag is on" is a reason to make sure the cleanup works before the flag
     * flips, not a reason to skip it.
     */
    private fun pruneEventSequenceCounters() {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT run_event_seq_prune(?)").use { st ->
                    st.setInt(1, seqCounterKeepDays)
                    st.executeQuery().use { rs ->
                        if (rs.next()) {
                            val n = rs.getInt(1)
                            if (n > 0) log.info("[partitions] pruned {} run_event_seq row(s)", n)
                        }
                    }
                }
            }
        }.onFailure {
            /* A database that predates V046 has no such function. Debug, not
               warn: on a mixed fleet this is expected until the migration lands,
               and an hourly warning for an expected state is how real warnings
               get filtered out. */
            log.debug("[partitions] run_event_seq prune skipped: {}", it.message)
        }
    }

    private fun isPartitioned(table: String): Boolean =
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT relkind = 'p' FROM pg_class WHERE relname = ? AND relnamespace = 'public'::regnamespace"
                ).use { st ->
                    st.setString(1, table)
                    st.executeQuery().use { rs -> rs.next() && rs.getBoolean(1) }
                }
            }
        }.getOrDefault(false)

    /** One worker acts per interval. Same pattern as TimerScheduler. */
    private fun acquireLock(): Boolean {
        val redis = redisCommands ?: return true   // single-worker / no Redis
        return runCatching {
            redis.set(LOCK_KEY, "1",
                io.lettuce.core.SetArgs().nx().ex(lockTtlSeconds)) == "OK"
        }.getOrDefault(false)
    }
}
