package com.vectorbea.worker.retention

import com.vectorbea.worker.logging.logger
import io.lettuce.core.SetArgs
import io.lettuce.core.api.sync.RedisCommands
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * Deletes what a workspace is no longer entitled to keep.
 *
 * ── IT DELETES. IT DOES NOT HIDE. ───────────────────────────────────────────
 * There is no `hidden` column anywhere in this feature and no read-time filter.
 * Data past retention is gone from Postgres, which is the only version of this
 * that survives an export endpoint, a support query, a direct API call and the
 * next feature somebody writes. A filter is a promise every future code path has
 * to keep; a delete is a fact.
 *
 * ── FOUR PHASES, AND THE ORDER IS THE SAFETY ────────────────────────────────
 *
 *   1. OBSERVE   record what each workspace's window is now, and open a grace
 *                period if it shrank.
 *   2. WARN      mark the ones newly in grace so the product can tell them, with
 *                dates, before anything is deleted.
 *   3. EXPORT    for a graced workspace whose grace has run out, write a bundle
 *                of the slice about to go, unless one already covers it.
 *   4. DELETE    bounded batches, per workspace, per entity.
 *
 * Observe strictly precedes delete IN THE SAME PASS, which is what guarantees
 * there is no sweep in which a workspace both learns of a downgrade and loses
 * data to it. A downgrade is always seen at least one full grace period before
 * it bites.
 *
 * ── IDEMPOTENT AND RESUMABLE, WITH NO CURSOR ────────────────────────────────
 * Killing this mid-run loses nothing, and it manages that WITHOUT a resume
 * cursor — which is the design decision worth defending, because a cursor is the
 * obvious answer and it is the fragile one.
 *
 * Every batch is `DELETE ... WHERE created_at < cutoff LIMIT n`, and each batch
 * commits on its own. "What is expired" is recomputed from the data every time,
 * so:
 *
 *   - interrupted anywhere, the next pass finds exactly the rows the last one
 *     did not get to, because they still match the predicate;
 *   - run twice, the second pass finds nothing, because the first deleted it;
 *   - a stored cursor can be stale, can point at a row that has since been
 *     deleted by something else, and has to be invalidated when the policy
 *     changes. There is no cursor here to get any of that wrong.
 *
 * The cost is re-planning each batch. Measured at ~30 ms of a ~1.5 s batch,
 * which is a good trade for losing an entire class of resume bug.
 *
 * ── BOUNDED, BECAUSE THE MEASUREMENT SAID SO ────────────────────────────────
 * A per-workspace delete touches roughly one heap block per row (V061's header
 * has the numbers), so an unbounded `DELETE FROM run_events WHERE ...` for a
 * busy workspace is a multi-minute statement holding locks and generating WAL
 * the whole time. Batches keep each statement short and each transaction small,
 * and the sweep gives up gracefully when it runs past [maxRuntime] rather than
 * running into the next one.
 *
 * ── AND IT SAYS SO WHEN IT STOPS (§6) ───────────────────────────────────────
 * Every pass writes a `retention_sweeps` row: running, then succeeded, failed or
 * interrupted. The last succeeded row is the heartbeat `/api/health/retention`
 * reads and alerts on. This codebase has shipped two scheduled SQL functions
 * with no caller at all, so "did it run" is not a question the log should be the
 * only answer to.
 */
class RetentionSweeper(
    private val dataSource: DataSource,
    private val redisCommands: RedisCommands<String, String>? = null,
    private val exporter: WorkspaceExporter? = null,
    /**
     * Actually delete, rather than reporting what would be deleted.
     *
     * OFF by default, and for once this is not merely the standing flag rule:
     * the first run of a deleter against real customer data is irreversible, and
     * a cycle of `WOULD DELETE` lines is the only cheap way to find a
     * mis-seeded window before it costs somebody their traces.
     */
    private val deleteEnabled: Boolean =
        System.getenv("RETENTION_DELETE_ENABLED")?.lowercase() == "true",
    private val pollIntervalMs: Long =
        System.getenv("RETENTION_INTERVAL_MS")?.toLongOrNull() ?: 3_600_000L,
    /** Rows per statement. See the bounded-batches note above. */
    private val batchSize: Int =
        System.getenv("RETENTION_BATCH_SIZE")?.toIntOrNull()?.coerceIn(100, 50_000) ?: 5_000,
    /** How long one pass may run before it stops and leaves the rest for the next. */
    private val maxRuntime: Duration = Duration.ofSeconds(
        System.getenv("RETENTION_MAX_RUNTIME_SECONDS")?.toLongOrNull() ?: 600L),
    private val lockTtlSeconds: Long = 900L,
    private val workerId: String = System.getenv("WORKER_ID") ?: "unknown",
) {
    private val log = logger()
    private val running = AtomicBoolean(false)
    private var future: ScheduledFuture<*>? = null
    private var exportFuture: ScheduledFuture<*>? = null

    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "retention-sweeper").also { it.isDaemon = true }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun start() {
        if (!running.compareAndSet(false, true)) return
        /* Not immediately at boot: a deploy that restarts every worker at once
           would otherwise have them all contend for the lock in the same second,
           and the one that wins does its heaviest work while the fleet is still
           warming up. */
        future = executor.scheduleWithFixedDelay(
            ::tick, 120_000L, pollIntervalMs, TimeUnit.MILLISECONDS)

        /* A SECOND, MUCH SHORTER LOOP, for user-requested exports.
           The API has no exporter — it is a streaming multi-gigabyte job that has
           no business inside an HTTP request — so it writes a `queued` row and
           this drains it. Thirty seconds rather than the sweep's hour, because a
           person pressed a button and is watching; and separate from the sweep
           because an export must not wait behind an hour of deletion, nor a
           deletion behind somebody's download. */
        exportFuture = executor.scheduleWithFixedDelay(
            ::drainQueuedExports, 20_000L, 30_000L, TimeUnit.MILLISECONDS)

        log.info("[retention] sweeper started (interval={}ms, deleteEnabled={}, batch={})",
            pollIntervalMs, deleteEnabled, batchSize)
    }

    fun stop() {
        running.set(false)
        future?.cancel(false)
        exportFuture?.cancel(false)
        executor.shutdown()
    }

    /**
     * Run any export a user asked for.
     *
     * CLAIMED WITH A CAS, so two workers polling the same table cannot both
     * export the same request: `UPDATE ... WHERE status='queued' RETURNING` moves
     * the row to `running` and only one transaction wins. No Redis lock here —
     * the row itself is the lock, which is the right granularity when several
     * exports should be able to run on several workers at once.
     */
    internal fun drainQueuedExports() {
        val ex = exporter ?: return
        while (true) {
            val claimed = runCatching { claimQueuedExport() }.getOrElse {
                log.warn("[export] could not claim a queued export: {}", it.message); null
            } ?: return

            runCatching {
                ex.runQueued(claimed)
            }.onFailure { log.error("[export] queued export {} failed: {}", claimed, it.message) }
        }
    }

    private fun claimQueuedExport(): UUID? =
        dataSource.connection.use { c ->
            c.prepareStatement(
                """UPDATE workspace_exports
                      SET status = 'running'
                    WHERE id = (SELECT id FROM workspace_exports
                                 WHERE status = 'queued'
                                 ORDER BY created_at
                                 FOR UPDATE SKIP LOCKED
                                 LIMIT 1)
                RETURNING id"""
            ).use { st ->
                st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1, UUID::class.java) else null }
            }
        }

    // ── One pass ──────────────────────────────────────────────────────────────

    data class Outcome(
        val sweepId: UUID?,
        val workspaces: Int,
        val rowsDeleted: Long,
        val bytesFreed: Long,
        val archivesPurged: Int,
        val gracesOpened: Int,
        val interrupted: Boolean,
    )

    internal fun tick(): Outcome {
        if (!running.get() && future != null) return Outcome(null, 0, 0, 0, 0, 0, false)
        if (!acquireLock()) {
            log.debug("[retention] another worker holds the sweep lock")
            return Outcome(null, 0, 0, 0, 0, 0, false)
        }
        return runCatching { sweep() }.getOrElse { e ->
            log.error("[retention] sweep failed: {}", e.message)
            Outcome(null, 0, 0, 0, 0, 0, false)
        }
    }

    /** Public so a test — and an operator through an admin route — can force one. */
    fun sweep(): Outcome {
        val deadline = Instant.now().plus(maxRuntime)
        val sweepId = openSweep()

        var workspaces = 0
        var rows = 0L
        var bytes = 0L
        var archives = 0
        var graces = 0
        var interrupted = false

        try {
            for (ws in workspaceIds()) {
                if (Instant.now().isAfter(deadline)) {
                    /* Out of budget. This is a normal outcome, not a failure:
                       the next pass picks up the workspaces this one did not
                       reach, because nothing about the work is stateful. It is
                       logged at INFO so a sweep that NEVER finishes is visible
                       as a repeated line rather than as silence. */
                    log.info("[retention] pass hit its {}s budget — {} workspaces done, resuming next pass",
                        maxRuntime.seconds, workspaces)
                    interrupted = true
                    break
                }

                workspaces++
                val graceDays = graceDaysFor(ws)

                for (entity in RetentionEntity.SWEEP_ORDER) {
                    // ── 1. OBSERVE, always, before anything is deleted ───────
                    if (observePolicy(ws, entity, graceDays)) {
                        graces++
                        log.info("[retention] workspace {} downgraded on {} — grace for {} days",
                            ws, entity.wire, graceDays)
                    }

                    val window = effectiveWindow(ws, entity) ?: continue
                    val cutoff = Instant.now().minus(Duration.ofDays(window.days.toLong()))

                    // ── 2/3. WARN + EXPORT while a cut is graced ─────────────
                    if (window.graced) {
                        markNotified(ws, entity)
                        // Nothing is deleted for a graced entity: the whole point
                        // of grace is that the OLD window is honoured, and
                        // `effectiveWindow` has already returned the old one. The
                        // cutoff above is therefore the generous one, and any
                        // deletion below is of data expired under BOTH windows.
                    }

                    /* ARCHIVES are deliberately not swept per workspace — see
                       `purgePlatformArchives`. Observing the policy above still
                       matters, because the window feeds the platform floor. */
                    if (entity == RetentionEntity.ARCHIVES) continue

                    val result = purgeRows(sweepId, ws, entity, window, cutoff, deadline)
                    rows += result.rows
                    bytes += result.bytes
                }
            }

            archives += purgePlatformArchives(sweepId)

            closeSweep(sweepId, if (interrupted) "interrupted" else "succeeded",
                workspaces, rows, bytes, archives, null)
        } catch (e: Exception) {
            closeSweep(sweepId, "failed", workspaces, rows, bytes, archives,
                e.message?.take(500) ?: e::class.simpleName)
            throw e
        }

        if (rows > 0 || archives > 0) {
            log.info("[retention] sweep {} — {} workspaces, {} rows, {} bytes, {} archives{}",
                sweepId, workspaces, rows, bytes, archives,
                if (deleteEnabled) "" else " (DRY RUN — RETENTION_DELETE_ENABLED is not set)")
        }
        return Outcome(sweepId, workspaces, rows, bytes, archives, graces, interrupted)
    }

    private data class Purged(val rows: Long = 0, val bytes: Long = 0, val archives: Int = 0)

    // ── Deletion ──────────────────────────────────────────────────────────────

    /**
     * Delete one entity's expired rows for one workspace, in bounded batches.
     *
     * The export happens once, before the first batch, and only when something
     * would actually be deleted — asking for a bundle of an empty range writes a
     * ledger row promising content that is not there.
     */
    private fun purgeRows(
        sweepId: UUID,
        workspaceId: UUID,
        entity: RetentionEntity,
        window: RetentionWindow,
        cutoff: Instant,
        deadline: Instant,
    ): Purged {
        var rows = 0L
        var bytes = 0L
        var exportKey: String? = null
        var exported = false

        while (true) {
            if (Instant.now().isAfter(deadline)) break

            if (!deleteEnabled) {
                val pending = countExpired(workspaceId, entity, cutoff)
                if (pending > 0) {
                    log.info("[retention] WOULD DELETE {} {} rows for workspace {} " +
                        "older than {} ({}-day window, source={})",
                        pending, entity.wire, workspaceId, cutoff, window.days, window.source)
                }
                return Purged()
            }

            /* Export before the FIRST destructive batch, not before the pass:
               most workspaces have nothing expired on most passes, and exporting
               an empty range every hour would fill the bucket with nothing. */
            if (!exported) {
                exported = true
                if (countExpired(workspaceId, entity, cutoff) == 0L) return Purged()
                exportKey = ensureExport(workspaceId, cutoff)
            }

            val batch = when (entity) {
                RetentionEntity.RUNS -> deleteRuns(workspaceId, cutoff)
                RetentionEntity.PAYLOADS -> deletePayloads(workspaceId, cutoff)
                RetentionEntity.EVENTS -> deleteTraceRows(workspaceId, "run_events", cutoff)
                RetentionEntity.TRACES -> deleteTraceRows(workspaceId, "run_spans", cutoff)
                RetentionEntity.ARCHIVES -> Purged()
            }
            if (batch.rows == 0L) break
            rows += batch.rows
            bytes += batch.bytes
        }

        if (rows > 0) {
            audit(sweepId, workspaceId, entity, window, cutoff, "rows", rows, bytes, exportKey)
        }
        return Purged(rows, bytes)
    }

    private fun deleteRuns(workspaceId: UUID, cutoff: Instant): Purged =
        dataSource.connection.use { c ->
            c.prepareStatement("SELECT retention_purge_runs(?, ?, ?)").use { st ->
                st.setObject(1, workspaceId)
                st.setTimestamp(2, Timestamp.from(cutoff))
                st.setInt(3, minOf(batchSize, 1_000))   // each row cascades ~20 tables
                st.executeQuery().use { rs -> Purged(rows = if (rs.next()) rs.getLong(1) else 0L) }
            }
        }

    private fun deletePayloads(workspaceId: UUID, cutoff: Instant): Purged =
        dataSource.connection.use { c ->
            c.prepareStatement("SELECT rows_deleted, bytes_freed FROM retention_purge_payloads(?, ?, ?)")
                .use { st ->
                    st.setObject(1, workspaceId)
                    st.setTimestamp(2, Timestamp.from(cutoff))
                    st.setInt(3, batchSize)
                    st.executeQuery().use { rs ->
                        if (rs.next()) Purged(rs.getLong(1), rs.getLong(2)) else Purged()
                    }
                }
        }

    private fun deleteTraceRows(workspaceId: UUID, table: String, cutoff: Instant): Purged =
        dataSource.connection.use { c ->
            c.prepareStatement("SELECT retention_purge_trace_rows(?, ?, ?, ?)").use { st ->
                st.setObject(1, workspaceId)
                st.setString(2, table)
                st.setTimestamp(3, Timestamp.from(cutoff))
                st.setInt(4, batchSize)
                st.executeQuery().use { rs -> Purged(rows = if (rs.next()) rs.getLong(1) else 0L) }
            }
        }

    /**
     * Retire warm-tier archives past the platform's archive window.
     *
     * ── ONCE PER SWEEP, NOT ONCE PER WORKSPACE ──────────────────────────────
     * An archive is a PARTITION — a month of one table across every tenant.
     * `ArchiveStore`'s header explains why it cannot be per-workspace: the drop
     * gate is per-partition, so a per-tenant export would have to complete for
     * every tenant before any partition could be dropped, and one tenant with an
     * unreachable bucket would stop retention for everyone. So the window that
     * applies is the most generous any workspace is entitled to, exactly as it
     * is for a partition drop.
     *
     * ── THE ROW IS RETIRED; THE BYTES ARE THE BUCKET'S JOB ──────────────────
     * `ArchiveStore` has no `delete`, on purpose — it is the one store whose
     * contract is that it never garbage-collects, because an archive is the ONLY
     * copy once its partition is dropped. Adding a destructive method to it so
     * retention could call it would break that contract for every other caller.
     *
     * So this moves the ledger row to `cold`, which is the documented meaning of
     * "export-only, no latency promised", and records the retirement in the
     * audit. The bytes go when the bucket's lifecycle policy removes them, which
     * is where an object store's retention belongs and where it can be verified
     * independently of this process.
     */
    private fun purgePlatformArchives(sweepId: UUID): Int {
        val floor = runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement("SELECT retention_platform_floor_days('archives')").use { st ->
                    st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 90 }
                }
            }
        }.getOrDefault(90)

        val cutoff = Instant.now().minus(Duration.ofDays(floor.toLong()))

        if (!deleteEnabled) {
            val pending = runCatching {
                dataSource.connection.use { c ->
                    c.prepareStatement(
                        "SELECT count(*) FROM run_trace_archives WHERE tier='warm' AND period_end < ?"
                    ).use { st ->
                        st.setTimestamp(1, Timestamp.from(cutoff))
                        st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
                    }
                }
            }.getOrDefault(0)
            if (pending > 0) {
                log.info("[retention] WOULD RETIRE {} warm archive(s) older than {} ({}-day floor)",
                    pending, cutoff, floor)
            }
            return 0
        }

        val retired = runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    "UPDATE run_trace_archives SET tier='cold' WHERE tier='warm' AND period_end < ?"
                ).use { st ->
                    st.setTimestamp(1, Timestamp.from(cutoff))
                    st.executeUpdate()
                }
            }
        }.getOrDefault(0)

        if (retired > 0) {
            log.info("[retention] retired {} warm archive(s) to cold (floor {} days)", retired, floor)
            audit(sweepId, null, RetentionEntity.ARCHIVES,
                RetentionWindow(RetentionEntity.ARCHIVES, floor, "platform_floor"),
                cutoff, "warm->cold", retired.toLong(), 0L, null)
        }
        return retired
    }

    // ── Policy ────────────────────────────────────────────────────────────────

    private fun observePolicy(workspaceId: UUID, entity: RetentionEntity, graceDays: Int): Boolean =
        dataSource.connection.use { c ->
            c.prepareStatement("SELECT retention_observe_policy(?, ?, ?)").use { st ->
                st.setObject(1, workspaceId)
                st.setString(2, entity.wire)
                st.setInt(3, graceDays)
                st.executeQuery().use { rs -> rs.next() && rs.getBoolean(1) }
            }
        }

    private fun effectiveWindow(workspaceId: UUID, entity: RetentionEntity): RetentionWindow? =
        dataSource.connection.use { c ->
            c.prepareStatement("SELECT days, source FROM retention_effective_days(?, ?)").use { st ->
                st.setObject(1, workspaceId)
                st.setString(2, entity.wire)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null
                    else RetentionWindow(entity, rs.getInt("days"), rs.getString("source"))
                }
            }
        }

    private fun graceDaysFor(workspaceId: UUID): Int =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """SELECT COALESCE((SELECT num_value FROM resolve_entitlements(?)
                                         WHERE key = 'retention_grace_days'), 30)"""
                ).use { st ->
                    st.setObject(1, workspaceId)
                    st.executeQuery().use { rs -> if (rs.next()) rs.getDouble(1).toInt() else 30 }
                }
            }
        }.getOrDefault(30).coerceIn(0, 365)

    private fun markNotified(workspaceId: UUID, entity: RetentionEntity) {
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """UPDATE workspace_retention_state
                          SET notified_at = COALESCE(notified_at, now()),
                              export_offered_at = COALESCE(export_offered_at, now()),
                              updated_at = now()
                        WHERE workspace_id = ? AND entity = ?"""
                ).use { st ->
                    st.setObject(1, workspaceId); st.setString(2, entity.wire); st.executeUpdate()
                }
            }
        }
    }

    private fun ensureExport(workspaceId: UUID, cutoff: Instant): String? {
        val ex = exporter ?: return null
        if (ex.hasCoveringExport(workspaceId, cutoff)) return null
        return ex.export(workspaceId, from = null, to = cutoff, kind = "pre_deletion")?.objectKey
    }

    // ── Bookkeeping ───────────────────────────────────────────────────────────

    private fun countExpired(workspaceId: UUID, entity: RetentionEntity, cutoff: Instant): Long {
        val sql = when (entity) {
            RetentionEntity.RUNS ->
                """SELECT count(*) FROM agent_runs WHERE workspace_id=? AND created_at<?
                    AND status IN ('succeeded','failed','cancelled','expired')"""
            RetentionEntity.EVENTS -> "SELECT count(*) FROM run_events WHERE workspace_id=? AND created_at<?"
            RetentionEntity.TRACES -> "SELECT count(*) FROM run_spans WHERE workspace_id=? AND created_at<?"
            RetentionEntity.PAYLOADS -> "SELECT count(*) FROM run_payloads WHERE workspace_id=? AND created_at<?"
            RetentionEntity.ARCHIVES -> return 0L
        }
        return runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(sql).use { st ->
                    st.setObject(1, workspaceId)
                    st.setTimestamp(2, Timestamp.from(cutoff))
                    st.queryTimeout = 30
                    st.executeQuery().use { rs -> if (rs.next()) rs.getLong(1) else 0L }
                }
            }
        }.getOrDefault(0L)
    }

    private fun audit(
        sweepId: UUID, workspaceId: UUID?, entity: RetentionEntity, window: RetentionWindow,
        cutoff: Instant, scope: String, rows: Long, bytes: Long, exportKey: String?,
    ) {
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """INSERT INTO retention_deletions
                         (sweep_id, workspace_id, entity, policy_days, policy_source,
                          plan_code, cutoff, scope, rows_deleted, bytes_freed, export_key)
                       VALUES (?, ?, ?, ?, ?,
                               (SELECT b.plan_code FROM workspaces w
                                  JOIN billing_accounts b ON b.id = w.billing_account_id
                                 WHERE w.id = ?),
                               ?, ?, ?, ?, ?)"""
                ).use { st ->
                    st.setObject(1, sweepId)
                    st.setObject(2, workspaceId)
                    st.setString(3, entity.wire)
                    st.setInt(4, window.days)
                    st.setString(5, window.source)
                    st.setObject(6, workspaceId)
                    st.setTimestamp(7, Timestamp.from(cutoff))
                    st.setString(8, scope)
                    st.setLong(9, rows)
                    st.setLong(10, bytes)
                    st.setString(11, exportKey)
                    st.executeUpdate()
                }
            }
        }.onFailure { log.warn("[retention] audit write failed: {}", it.message) }
    }

    private fun workspaceIds(): List<UUID> =
        dataSource.connection.use { c ->
            c.prepareStatement("SELECT id FROM workspaces ORDER BY created_at").use { st ->
                st.executeQuery().use { rs ->
                    buildList { while (rs.next()) add(rs.getObject(1, UUID::class.java)) }
                }
            }
        }

    private fun openSweep(): UUID =
        dataSource.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO retention_sweeps (worker_id) VALUES (?) RETURNING id"
            ).use { st ->
                st.setString(1, workerId)
                st.executeQuery().use { rs -> rs.next(); rs.getObject(1, UUID::class.java) }
            }
        }

    private fun closeSweep(
        id: UUID, status: String, workspaces: Int, rows: Long, bytes: Long,
        archives: Int, error: String?,
    ) {
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """UPDATE retention_sweeps
                          SET finished_at=now(), status=?, workspaces_seen=?,
                              rows_deleted=?, bytes_freed=?, archives_purged=?, error=?
                        WHERE id=?"""
                ).use { st ->
                    st.setString(1, status); st.setInt(2, workspaces)
                    st.setLong(3, rows); st.setLong(4, bytes); st.setInt(5, archives)
                    st.setString(6, error); st.setObject(7, id)
                    st.executeUpdate()
                }
            }
        }.onFailure { log.error("[retention] could not close sweep {}: {}", id, it.message) }
    }

    private fun acquireLock(): Boolean {
        val redis = redisCommands ?: return true   // single-worker / no Redis
        return runCatching {
            redis.set(LOCK_KEY, workerId, SetArgs().nx().ex(lockTtlSeconds)) == "OK"
        }.getOrDefault(false)
    }

    private companion object {
        const val LOCK_KEY = "vectorbea:retention:sweep"
    }
}
