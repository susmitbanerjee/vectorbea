package com.vectorbea.worker.retention

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.durable.archive.ArchiveStore
import com.vectorbea.worker.durable.archive.archiveStoreFromEnv
import com.vectorbea.worker.logging.logger
import java.io.BufferedOutputStream
import java.io.OutputStream
import java.security.DigestOutputStream
import java.security.MessageDigest
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID
import java.util.zip.GZIPOutputStream
import javax.sql.DataSource

/**
 * Export a workspace's runs and traces, as NDJSON.gz, into the archive store.
 *
 * ── WHY THIS EXISTS AT ALL (§5) ─────────────────────────────────────────────
 * "Export before delete." A retention limit that takes data away with no way to
 * keep a copy is punitive; the same limit with an export beside it is a storage
 * policy the customer can work with. So a workspace can export at any time, and
 * the sweeper exports the slice it is about to delete when nothing recent
 * covers it.
 *
 * ── ONE WRITER, TWO CALLERS, ONE LEDGER ─────────────────────────────────────
 * A user pressing Export and the sweeper protecting a downgrade produce the
 * same artefact and the same `workspace_exports` row, differing only in `kind`.
 * That is deliberate: "was this data exported before it went" has to be
 * answerable from one place, and two code paths writing two shapes is how the
 * answer becomes "it depends which one ran".
 *
 * ── STREAMED, NEVER MATERIALISED ────────────────────────────────────────────
 * `ArchiveStore.put` hands out an `OutputStream` for exactly this reason. A
 * workspace's month of events can be gigabytes; building a `ByteArray` of it
 * would OOM the worker on the first export big enough to be worth having. The
 * JDBC side is streamed too — `fetchSize` with autoCommit off, or the driver
 * buffers the whole result set in the client and undoes the point.
 *
 * ── THE KEY CONTAINS THE WORKSPACE ID; THE STORE IS STILL SHARED ────────────
 * `ArchiveStore`'s header warns that its ROOT must never be tenant-scoped —
 * every tenant's warm tier lives in one bucket we operate. That is unchanged
 * here: only the KEY carries a workspace id, as a name, and nothing serves these
 * objects except a workspace-scoped API route. A key is not a permission.
 */
class WorkspaceExporter(
    private val dataSource: DataSource,
    private val store: ArchiveStore = archiveStoreFromEnv(),
    /**
     * How long an export bundle is served before it is itself purged.
     *
     * An export is a rescue, not a second permanent copy. Left forever it would
     * quietly become the retention policy — the bytes we just deleted from
     * Postgres, kept in a bucket at the same cost and with none of the
     * lifecycle — which is the outcome the whole feature exists to avoid.
     */
    private val bundleDays: Int =
        System.getenv("WORKSPACE_EXPORT_DAYS")?.toIntOrNull()?.coerceIn(1, 365) ?: 30,
) {
    private val log = logger()
    private val mapper: ObjectMapper = jacksonObjectMapper()

    data class Result(
        val exportId: UUID,
        val objectKey: String,
        val rowCount: Long,
        val byteCount: Long,
        val checksum: String,
    )

    /**
     * Export everything for [workspaceId] in `[from, to)`, or null when there is
     * nothing to export.
     *
     * Null and not an empty bundle: a zero-row object in the ledger reads as "we
     * exported it" and would satisfy a pre-deletion check that nothing actually
     * backed. The absence of data is not a successful export of it.
     */
    fun export(
        workspaceId: UUID,
        from: Instant?,
        to: Instant,
        kind: String = "on_demand",
        entities: List<RetentionEntity> = listOf(RetentionEntity.RUNS, RetentionEntity.EVENTS, RetentionEntity.TRACES),
        requestedByUserId: UUID? = null,
    ): Result? {
        val exportId = UUID.randomUUID()
        val key = objectKeyFor(workspaceId, exportId)
        openLedgerRow(exportId, workspaceId, kind, entities, from, to, key, requestedByUserId, "running")
        return writeBundle(exportId, workspaceId, from, to, entities, key)
    }

    /**
     * Run an export the API queued and this worker has already claimed.
     *
     * The API cannot do this itself: the bundle is streamed and can be
     * gigabytes, which is not something to hold an HTTP request open for. So the
     * route writes a `queued` row, `RetentionSweeper` CASes it to `running`, and
     * this fills it in. The row already exists — every parameter comes off it —
     * which is what stops a queued export and a direct one producing two
     * different shapes of ledger entry.
     */
    fun runQueued(exportId: UUID): Result? {
        val req = loadRequest(exportId) ?: run {
            log.warn("[export] queued export {} vanished before it ran", exportId)
            return null
        }
        return writeBundle(req.exportId, req.workspaceId, req.from, req.to, req.entities, req.objectKey)
    }

    private data class Request(
        val exportId: UUID,
        val workspaceId: UUID,
        val from: Instant?,
        val to: Instant,
        val entities: List<RetentionEntity>,
        val objectKey: String,
    )

    private fun loadRequest(exportId: UUID): Request? =
        dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT workspace_id, period_start, period_end, entities, object_key
                     FROM workspace_exports WHERE id = ?"""
            ).use { st ->
                st.setObject(1, exportId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) return null
                    val wires = (rs.getArray("entities")?.array as? Array<*>)
                        ?.mapNotNull { RetentionEntity.from(it.toString()) }
                        .orEmpty()
                    Request(
                        exportId = exportId,
                        workspaceId = rs.getObject("workspace_id", UUID::class.java),
                        from = rs.getTimestamp("period_start")?.toInstant(),
                        to = rs.getTimestamp("period_end")?.toInstant() ?: Instant.now(),
                        entities = wires.ifEmpty {
                            listOf(RetentionEntity.RUNS, RetentionEntity.EVENTS, RetentionEntity.TRACES)
                        },
                        objectKey = rs.getString("object_key")
                            ?: objectKeyFor(rs.getObject("workspace_id", UUID::class.java), exportId),
                    )
                }
            }
        }

    /**
     * The whole streaming write, shared by both callers.
     *
     * One implementation, deliberately: an on-demand export and a pre-deletion
     * one have to produce byte-identical bundles, or "was this exported before it
     * went" gets a different answer depending on which path ran.
     */
    private fun writeBundle(
        exportId: UUID,
        workspaceId: UUID,
        from: Instant?,
        to: Instant,
        entities: List<RetentionEntity>,
        key: String,
    ): Result? {
        /* PROBE BEFORE OPENING THE OBJECT.
         *
         * `ArchiveStore` has no delete — deliberately, it is the one store whose
         * contract is that it never garbage-collects — so an object written for a
         * range that turned out to be empty is orphaned in the bucket forever.
         * Streaming first and checking the count afterwards produced exactly
         * that: a valid gzip holding one `_meta` line, unreferenced by any ledger
         * row, accumulating one per empty sweep per workspace per hour.
         *
         * The probe is `EXISTS ... LIMIT 1` per entity against the same indexes
         * the stream uses, so the cost of asking is a fraction of the cost of
         * having been wrong. `RetentionAcceptanceTest` is what found it.
         */
        if (!hasAnyRows(workspaceId, from, to, entities)) {
            failLedgerRow(exportId, "no rows in range")
            log.info("[export] workspace {} had no rows in range — no bundle written", workspaceId)
            return null
        }

        return try {
            var rows = 0L
            val digest = MessageDigest.getInstance("SHA-256")

            val bytes = store.put(key) { raw ->
                DigestOutputStream(BufferedOutputStream(raw), digest).use { digested ->
                    GZIPOutputStream(digested).use { gz ->
                        /* A header line, so a bundle found on a disk in a year can be
                           identified without the ledger that described it. The ledger
                           is the index; this is the label. */
                        writeLine(gz, mapOf(
                            "_meta" to mapOf(
                                "exportId" to exportId.toString(),
                                "workspaceId" to workspaceId.toString(),
                                "from" to from?.toString(),
                                "to" to to.toString(),
                                "entities" to entities.map { it.wire },
                                "generatedAt" to Instant.now().toString(),
                                "format" to "ndjson.gz",
                            )
                        ))
                        for (entity in entities) {
                            rows += streamEntity(gz, entity, workspaceId, from, to)
                        }
                    }
                }
            }

            if (rows == 0L) {
                /* Reachable only if every row vanished between the probe and the
                   stream — another sweep, or a workspace deletion. Rare, and still
                   not allowed to leave a 'ready' export promising content it does not
                   have: a pre-deletion check that trusted it would authorise a delete
                   nothing backed. */
                failLedgerRow(exportId, "no rows in range")
                log.info("[export] workspace {} emptied between probe and stream", workspaceId)
                null
            } else {
                val checksum = digest.digest().joinToString("") { "%02x".format(it) }
                completeLedgerRow(exportId, rows, bytes, checksum)
                log.info("[export] workspace={} rows={} bytes={} key={}", workspaceId, rows, bytes, key)
                Result(exportId, key, rows, bytes, checksum)
            }
        } catch (e: Exception) {
            failLedgerRow(exportId, e.message?.take(500) ?: e::class.simpleName ?: "unknown")
            log.error("[export] workspace {} failed: {}", workspaceId, e.message)
            null
        }
    }

    /**
     * Is there anything at all to export? One indexed `LIMIT 1` per entity.
     *
     * Stops at the first entity that has a row: for the common case — a
     * workspace with data — this is a single index probe, and for the case it
     * exists to catch it is at most three.
     */
    private fun hasAnyRows(
        workspaceId: UUID, from: Instant?, to: Instant, entities: List<RetentionEntity>,
    ): Boolean {
        val tables = entities.mapNotNull {
            when (it) {
                RetentionEntity.RUNS -> "agent_runs"
                RetentionEntity.EVENTS -> "run_events"
                RetentionEntity.TRACES -> "run_spans"
                else -> null
            }
        }
        if (tables.isEmpty()) return false

        dataSource.connection.use { c ->
            for (table in tables) {
                val found = c.prepareStatement(
                    """SELECT 1 FROM $table
                        WHERE workspace_id = ? AND created_at < ?
                          AND (?::timestamptz IS NULL OR created_at >= ?)
                        LIMIT 1"""
                ).use { st ->
                    st.setObject(1, workspaceId)
                    st.setObject(2, java.sql.Timestamp.from(to))
                    st.setObject(3, from?.let { f -> java.sql.Timestamp.from(f) })
                    st.setObject(4, from?.let { f -> java.sql.Timestamp.from(f) })
                    st.queryTimeout = 15
                    st.executeQuery().use { rs -> rs.next() }
                }
                if (found) return true
            }
        }
        return false
    }

    private fun objectKeyFor(workspaceId: UUID, exportId: UUID) =
        "exports/$workspaceId/$exportId.ndjson.gz"

    /**
     * Whether a usable export already covers everything older than [cutoff].
     *
     * The sweeper asks this before exporting, so a downgrade that spans several
     * sweeps produces one bundle rather than one per pass. `period_end >= cutoff`
     * is the test: a bundle that reaches at least as far forward as the deletion
     * boundary covers every row the deletion will touch.
     */
    fun hasCoveringExport(workspaceId: UUID, cutoff: Instant): Boolean =
        dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT 1 FROM workspace_exports
                    WHERE workspace_id = ? AND status = 'ready'
                      AND period_end >= ?
                      AND (expires_at IS NULL OR expires_at > now())
                    LIMIT 1"""
            ).use { st ->
                st.setObject(1, workspaceId)
                st.setObject(2, java.sql.Timestamp.from(cutoff))
                st.executeQuery().use { rs -> rs.next() }
            }
        }

    // ── Streaming ─────────────────────────────────────────────────────────────

    /**
     * Stream one entity's rows as NDJSON.
     *
     * `autoCommit = false` plus `fetchSize` is what makes this a cursor rather
     * than a full client-side buffer. The Postgres JDBC driver ignores
     * `fetchSize` entirely while autoCommit is on — it reads the whole result set
     * into the client first — so omitting the first half silently reintroduces
     * the OOM this method is shaped to avoid.
     */
    private fun streamEntity(
        out: OutputStream,
        entity: RetentionEntity,
        workspaceId: UUID,
        from: Instant?,
        to: Instant,
    ): Long {
        val sql = when (entity) {
            RetentionEntity.RUNS -> """
                SELECT id, workflow_id, workflow_version_id, status, trigger_type,
                       execution_class, execution_mode_kind, started_at, completed_at,
                       duration_ms, token_count, estimated_cost, error_json, created_at
                  FROM agent_runs
                 WHERE workspace_id = ? AND created_at < ? AND (?::timestamptz IS NULL OR created_at >= ?)
                 ORDER BY created_at"""
            RetentionEntity.EVENTS -> """
                SELECT id, run_id, sequence, type, status, "timestamp", title, summary,
                       duration_ms, step_id, token_count, estimated_cost, created_at
                  FROM run_events
                 WHERE workspace_id = ? AND created_at < ? AND (?::timestamptz IS NULL OR created_at >= ?)
                 ORDER BY created_at"""
            RetentionEntity.TRACES -> """
                SELECT span_id, trace_id, parent_span_id, run_id, kind, name, status,
                       started_at, ended_at, duration_ms, attributes_json, failure_class,
                       tokens_in, tokens_out, created_at
                  FROM run_spans
                 WHERE workspace_id = ? AND created_at < ? AND (?::timestamptz IS NULL OR created_at >= ?)
                 ORDER BY created_at"""
            /* Payloads and archives are not exported as rows. A payload is
               referenced BY an event and its bytes are already redacted; an
               archive is itself an export. Including either would double the
               bundle for no new information. */
            else -> return 0L
        }

        var n = 0L
        dataSource.connection.use { c ->
            c.autoCommit = false
            try {
                c.prepareStatement(sql).use { st ->
                    st.fetchSize = 2_000
                    st.setObject(1, workspaceId)
                    st.setObject(2, java.sql.Timestamp.from(to))
                    st.setObject(3, from?.let { java.sql.Timestamp.from(it) })
                    st.setObject(4, from?.let { java.sql.Timestamp.from(it) })
                    st.executeQuery().use { rs ->
                        val meta = rs.metaData
                        while (rs.next()) {
                            writeLine(out, rowToMap(rs, meta.columnCount, entity))
                            n++
                        }
                    }
                }
            } finally {
                runCatching { c.rollback() }   // read-only; release the snapshot
                c.autoCommit = true
            }
        }
        return n
    }

    private fun rowToMap(rs: ResultSet, columns: Int, entity: RetentionEntity): Map<String, Any?> {
        val row = LinkedHashMap<String, Any?>(columns + 1)
        row["_entity"] = entity.wire
        for (i in 1..columns) {
            val name = rs.metaData.getColumnLabel(i)
            row[name] = when (val v = rs.getObject(i)) {
                is java.sql.Timestamp -> v.toInstant().toString()
                is org.postgresql.util.PGobject -> v.value   // jsonb arrives as PGobject
                is UUID -> v.toString()
                else -> v
            }
        }
        return row
    }

    private fun writeLine(out: OutputStream, value: Any) {
        out.write(mapper.writeValueAsBytes(value))
        out.write('\n'.code)
    }

    // ── Ledger ────────────────────────────────────────────────────────────────

    private fun openLedgerRow(
        id: UUID, workspaceId: UUID, kind: String, entities: List<RetentionEntity>,
        from: Instant?, to: Instant, key: String, requestedBy: UUID?, status: String,
    ) {
        dataSource.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO workspace_exports
                     (id, workspace_id, kind, entities, period_start, period_end,
                      status, object_key, requested_by_user_id, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now() + make_interval(days => ?))"""
            ).use { st ->
                st.setObject(1, id)
                st.setObject(2, workspaceId)
                st.setString(3, kind)
                st.setArray(4, c.createArrayOf("text", entities.map { it.wire }.toTypedArray()))
                st.setObject(5, from?.let { java.sql.Timestamp.from(it) })
                st.setObject(6, java.sql.Timestamp.from(to))
                st.setString(7, status)
                st.setString(8, key)
                st.setObject(9, requestedBy)
                st.setInt(10, bundleDays)
                st.executeUpdate()
            }
        }
    }

    private fun completeLedgerRow(id: UUID, rows: Long, bytes: Long, checksum: String) {
        dataSource.connection.use { c ->
            c.prepareStatement(
                """UPDATE workspace_exports
                      SET status='ready', row_count=?, byte_count=?, checksum=?
                    WHERE id=?"""
            ).use { st ->
                st.setLong(1, rows); st.setLong(2, bytes)
                st.setString(3, checksum); st.setObject(4, id)
                st.executeUpdate()
            }
        }
    }

    private fun failLedgerRow(id: UUID, error: String) {
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement("UPDATE workspace_exports SET status='failed', error=? WHERE id=?")
                    .use { st -> st.setString(1, error); st.setObject(2, id); st.executeUpdate() }
            }
        }
    }
}
