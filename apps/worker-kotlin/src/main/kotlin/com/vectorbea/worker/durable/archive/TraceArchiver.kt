package com.vectorbea.worker.durable.archive

import com.vectorbea.worker.logging.logger
import java.io.OutputStream
import java.security.DigestOutputStream
import java.security.MessageDigest
import java.time.LocalDate
import javax.sql.DataSource

/**
 * The warm tier. Exports a closed monthly trace partition, then records it.
 *
 * ── THE ORDER IS THE FEATURE ────────────────────────────────────────────────
 * Export, verify, record, and only then may the partition be dropped —
 * `PartitionMaintenance` reads the ledger this writes and refuses to drop a
 * partition that has no row in it. Doing it the other way round, or trusting a
 * store that reports success without one, is how "we tier our traces" becomes
 * "we deleted our traces".
 *
 * ── WHAT IS ELIGIBLE ────────────────────────────────────────────────────────
 * A partition whose whole month is past the hot window. Not "rows older than 7
 * days": the unit of eviction is a partition, so the entire partition has to be
 * outside the window before any of it leaves. With a 7-day hot window, July's
 * partition becomes eligible on 8 August. The current month is never eligible —
 * it is still being written, and a snapshot of a table being appended to is a
 * warm tier that quietly misses its last day.
 *
 * ── IDEMPOTENT, AND SAFE TO INTERRUPT ───────────────────────────────────────
 * The ledger has UNIQUE(source_table, partition_name), the store's write is
 * atomic, and the work queue is "partitions with no ledger row". A crash
 * anywhere leaves either no object and no row (retried next tick) or an object
 * and no row (overwritten next tick). There is no state where a row exists
 * without its object, and no state where a partition is dropped against an
 * export that did not finish. That is what idempotent has to mean here.
 *
 * ── THE RETRY IS NOT BYTE-IDENTICAL ONCE SAMPLING IS ON ─────────────────────
 * It used to be, and the claim was left standing after [TraceSampler] was wired,
 * which made it false. `sampledOut` re-runs against `agent_runs` and `run_spans`
 * at retry time, and both can have moved: a late cancel or an approval decision
 * changes a root's status, a parent pruned by retention re-roots a tree, and the
 * status rule alone flips a run from sampled-out to kept. The retry can therefore
 * write a DIFFERENT object under the same key.
 *
 * That is still correct, because nothing depends on the bytes being stable — the
 * checksum, row count and `sampled_out_runs` are written from the attempt that
 * won, in the same statement, so the ledger always describes the object that is
 * actually there. What it rules out is using the key as a content address or
 * comparing two attempts' checksums to detect corruption. Verify a warm object
 * against the ledger row, never against a re-export.
 */
class TraceArchiver(
    private val dataSource: DataSource,
    private val store: ArchiveStore = archiveStoreFromEnv(),
    private val encoder: ArchiveEncoder = NdJsonGzEncoder(),
    /**
     * Days a partition's month must be past before it is exported. §12.1's
     * "hot 7 days in Postgres".
     */
    private val hotDays: Int =
        System.getenv("TRACE_HOT_DAYS")?.toIntOrNull()?.coerceIn(1, 365) ?: 7,
    /** How long an archive is promised to be readable. §12.1's warm 90 days. */
    private val warmDays: Int =
        System.getenv("TRACE_WARM_DAYS")?.toIntOrNull()?.coerceIn(1, 3650) ?: 90,
    /**
     * Which runs' spans reach the warm tier. See [TraceSampler].
     *
     * Null disables sampling entirely — every row is exported. That is the
     * default: `trace_sample_rate` is 1.0 everywhere until an operator lowers
     * it, so the sampler would keep everything anyway, and not constructing it
     * saves a per-partition facts query that would find nothing to do.
     */
    private val sampler: TraceSampler? = null,
) {
    private val log = logger()

    /** Tables this exports. Same list `PartitionMaintenance` maintains. */
    private val tables = listOf("run_events", "run_spans")

    data class Archived(
        val table: String,
        val partition: String,
        val rows: Long,
        val bytes: Long,
        val key: String,
        val checksum: String,
        /** Runs whose spans were left out by [TraceSampler]. Recorded, never silent. */
        val sampledOutRuns: Int = 0,
    )

    /**
     * Export every eligible partition of every table. Returns what was exported.
     *
     * One partition's failure does not stop the others: a corrupt or locked
     * partition should not hold up a month that would export cleanly, and the
     * failed one simply reappears in next tick's queue.
     */
    fun runOnce(): List<Archived> {
        if (store is UnconfiguredArchiveStore) {
            log.debug("[archive] no archive store configured — skipping")
            return emptyList()
        }
        val out = mutableListOf<Archived>()
        for (table in tables) {
            for ((partition, start, end) in due(table)) {
                runCatching { export(table, partition, start, end) }
                    .onSuccess { out += it }
                    .onFailure { log.error("[archive] export failed [{}]: {}", partition, it.message) }
            }
        }
        runCatching { ageTiers() }
        return out
    }

    /** Partitions with no ledger row whose whole month is past the hot window. */
    internal fun due(table: String): List<Triple<String, LocalDate, LocalDate>> {
        val cutoff = LocalDate.now().minusDays(hotDays.toLong())
        return dataSource.connection.use { c ->
            c.prepareStatement("SELECT * FROM run_trace_unarchived_partitions(?)").use { st ->
                st.setString(1, table)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            val name = rs.getString(1)
                            val start = rs.getDate(2)?.toLocalDate() ?: continue
                            val end = rs.getDate(3)?.toLocalDate() ?: continue
                            /* `end` is exclusive — the first day of the NEXT month.
                               The partition is eligible once that day is itself past
                               the hot window, which is the same as saying every row
                               it can hold is. */
                            if (end.isBefore(cutoff) || end.isEqual(cutoff)) {
                                add(Triple(name, start, end))
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Stream one partition out and record it.
     *
     * The checksum is computed over the ENCODED bytes as they are written, not
     * by reading the object back: reading it back would check the store, and
     * what needs checking is that what left this process is what landed. It is
     * also the only integrity signal that survives the partition being dropped.
     */
    internal fun export(table: String, partition: String, start: LocalDate, end: LocalDate): Archived {
        requireSafePartition(table, partition)
        val key = "$table/${start.year}/$partition.${encoder.format}"

        /* Sampling applies to SPANS ONLY.
           `run_events` is the run timeline the product renders, it is one to two
           orders of magnitude smaller per run than the span tree, and a hole in it
           is directly visible to a user as a missing step. Spans are the 50-200x
           multiplier and the thing a warm tier is sized by. */
        val excluded: List<java.util.UUID> =
            if (sampler == null || table != "run_spans") emptyList()
            else sampledOut(partition)

        var rows = 0L
        val digest = MessageDigest.getInstance("SHA-256")

        val bytes = store.put(key) { raw: OutputStream ->
            /* Digest OUTSIDE the encoder so it covers the compressed bytes — the
               thing actually stored, and the thing a reader can re-hash. */
            val counted = DigestOutputStream(raw, digest)
            dataSource.connection.use { c ->
                c.autoCommit = false            // required for a server-side cursor
                try {
                    /* No filter at all when nothing was sampled out, so the
                       unsampled path is byte-for-byte what it was. */
                    val sql = if (excluded.isEmpty()) "SELECT * FROM $partition"
                              else "SELECT * FROM $partition WHERE run_id <> ALL(?)"
                    c.prepareStatement(sql).use { st ->
                        if (excluded.isNotEmpty()) {
                            st.setArray(1, c.createArrayOf("uuid", excluded.toTypedArray()))
                        }
                        st.fetchSize = 2_000    // stream; never materialise the month
                        st.executeQuery().use { rs -> rows = encoder.encode(rs, counted) }
                    }
                } finally {
                    c.autoCommit = true
                }
            }
        }

        val checksum = digest.digest().joinToString("") { "%02x".format(it) }
        record(table, partition, start, end, rows, bytes, key, checksum, excluded.size)
        log.info("[archive] {} → {} ({} rows, {} bytes, {}{})",
            partition, store.description, rows, bytes, encoder.format,
            if (excluded.isEmpty()) "" else ", ${excluded.size} run(s) sampled out")
        return Archived(table, partition, rows, bytes, key, checksum, excluded.size)
    }

    /**
     * The runs in [partition] the sampler declines to archive.
     *
     * ── THE DECISION IS PER LOGICAL TRACE, NOT PER RUN ──────────────────────
     * A dispatched child is its own `agent_runs` row, so a five-agent team is six
     * runs. Deciding on each of them independently gets two things wrong, and
     * both were live bugs until an OTel export test surfaced them:
     *
     *   1. A team's interesting event almost never happens in the TOP run. The
     *      supervisor delegates and waits; the researcher is the one whose tool
     *      call fails, whose approval opens, whose budget is clamped. Asking only
     *      about the top run answers "did the supervisor fail" and samples out
     *      exactly the traces somebody is about to go looking for.
     *   2. Deciding separately can KEEP a child and DROP its parent — half a
     *      trace, with spans whose parents do not exist. That is worse than
     *      dropping the whole thing, because it looks like corruption.
     *
     * So every run is resolved to the root of its tree, the notable-event facts
     * are aggregated across the whole tree, one decision is made per root, and it
     * applies to every run under it.
     *
     * The status and duration still come from the ROOT, because those are
     * properties of the whole: a team whose child failed and which recovered is a
     * succeeded run, and its duration is the supervisor's.
     */
    internal fun sampledOut(partition: String): List<java.util.UUID> {
        val s = sampler ?: return emptyList()
        /* runId here is the ROOT of each tree; `members` are the partition's runs
           that belong to it. One decision, applied to all of them. */
        val trees = dataSource.connection.use { c ->
            c.prepareStatement(FACTS_SQL.replace("{P}", partition)).use { st ->
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(TraceSampler.RunFacts(
                            runId = rs.getObject(1) as java.util.UUID,
                            workspaceId = rs.getObject(2) as java.util.UUID,
                            status = rs.getString(3) ?: "unknown",
                            createdAt = rs.getTimestamp(4).toInstant(),
                            durationMs = rs.getObject(5)?.let { (it as Number).toLong() },
                            hadFailedStep = rs.getBoolean(6),
                            hadApproval = rs.getBoolean(7),
                            hadBudgetClamp = rs.getBoolean(8),
                        ) to (rs.getArray(9)?.array as? Array<*>)
                            .orEmpty().filterIsInstance<java.util.UUID>())
                    }
                }
            }
        }
        return trees.filterNot { (facts, _) -> s.decide(facts).kept }.flatMap { it.second }
    }

    private companion object {
        /**
         * `{P}` is the partition name, already validated by [requireSafePartition]
         * — a relation name cannot be a bind parameter.
         *
         * `budget_clamped` is read out of `attributes_json` rather than a column
         * because that is where `BudgetLedger.Allocation.spanAttributes()` puts it,
         * and duplicating it into a column would create two places that have to
         * agree about whether a clamp happened.
         */
        val FACTS_SQL = """
            WITH RECURSIVE part AS (SELECT DISTINCT run_id AS id FROM {P}),
            -- Walk UP from every run in the partition to the top of its tree.
            -- Depth-capped: `parent_run_id` has no foreign key and nothing forbids
            -- a cycle, so an uncapped walk is one bad row away from never ending.
            up(id, anc, depth) AS (
                SELECT id, id, 0 FROM part
                UNION ALL
                SELECT u.id, r.parent_run_id, u.depth + 1
                  FROM up u JOIN agent_runs r ON r.id = u.anc
                 WHERE r.parent_run_id IS NOT NULL AND u.depth < 32
            ),
            -- The FURTHEST ancestor reached, rather than "the one with a null
            -- parent". A dangling parent_run_id — the parent pruned by retention,
            -- which the column's own comment says to expect — has no null-parent
            -- row to find, and a strict test would drop those runs from the result
            -- entirely and archive them by accident.
            root_of AS (
                SELECT DISTINCT ON (id) id, anc AS root_id FROM up ORDER BY id, depth DESC
            ),
            -- Back DOWN from each root, so the facts cover every run in the tree
            -- and not just the ones that happen to have spans in this partition.
            family(root_id, id, depth) AS (
                SELECT DISTINCT root_id, root_id, 0 FROM root_of
                UNION
                SELECT f.root_id, r.id, f.depth + 1
                  FROM family f JOIN agent_runs r ON r.parent_run_id = f.id
                 WHERE f.depth < 32
            ),
            tree AS (
                SELECT root_id, array_agg(DISTINCT id) AS members FROM family GROUP BY root_id
            )
            SELECT t.root_id,
                   r.workspace_id,
                   r.status,
                   r.created_at,
                   r.duration_ms,
                   EXISTS (SELECT 1 FROM run_spans s
                            WHERE s.run_id = ANY(t.members) AND s.status = 'failed'),
                   EXISTS (SELECT 1 FROM run_events e
                            WHERE e.run_id = ANY(t.members)
                              AND e.type IN ('APPROVAL_REQUESTED','AGENT_APPROVAL_REQUESTED')),
                   EXISTS (SELECT 1 FROM run_spans s
                            WHERE s.run_id = ANY(t.members)
                              AND (s.attributes_json ->> 'budget_clamped')::boolean IS TRUE),
                   -- Only the members that actually have rows HERE need excluding.
                   ARRAY(SELECT m FROM unnest(t.members) m
                          WHERE m IN (SELECT id FROM part)) AS partition_members
              FROM tree t
              JOIN agent_runs r ON r.id = t.root_id
        """.trimIndent()
    }

    /**
     * Write the ledger row: what was exported, and what was left out of it.
     *
     * ── WHY [sampledOutRuns] BELONGS IN THE SAME STATEMENT ──────────────────
     * `row_count` describes the OBJECT, not the partition. Once the sampler is on
     * those are different numbers, and after the drop the difference is
     * unrecoverable — the rows are in neither place. Recording the count of runs
     * the sampler excluded, in the same INSERT, is what keeps this table able to
     * answer "was this trace sampled out, or did it never exist".
     *
     * It is written from the attempt that WON. A retry re-runs `sampledOut`
     * against data that may have moved, so the object and this row must be
     * produced by the same pass — see the byte-identical note in the class header.
     */
    private fun record(
        table: String, partition: String, start: LocalDate, end: LocalDate,
        rows: Long, bytes: Long, key: String, checksum: String, sampledOutRuns: Int,
    ) {
        val withSampled = ledgerHasSampledOutColumn()
        dataSource.connection.use { c ->
            c.prepareStatement(
                """
                INSERT INTO run_trace_archives
                    (source_table, partition_name, period_start, period_end,
                     row_count, byte_count, format, object_key, checksum, tier
                     ${if (withSampled) ", sampled_out_runs" else ""})
                VALUES (?,?,?,?,?,?,?,?,?, 'warm'${if (withSampled) ", ?" else ""})
                ON CONFLICT (source_table, partition_name) DO UPDATE
                    SET row_count = EXCLUDED.row_count,
                        byte_count = EXCLUDED.byte_count,
                        format     = EXCLUDED.format,
                        object_key = EXCLUDED.object_key,
                        checksum   = EXCLUDED.checksum,
                        ${if (withSampled) "sampled_out_runs = EXCLUDED.sampled_out_runs," else ""}
                        exported_at = now()
                """.trimIndent()
            ).use { st ->
                st.setString(1, table); st.setString(2, partition)
                st.setDate(3, java.sql.Date.valueOf(start)); st.setDate(4, java.sql.Date.valueOf(end))
                st.setLong(5, rows); st.setLong(6, bytes)
                st.setString(7, encoder.format); st.setString(8, key); st.setString(9, checksum)
                if (withSampled) st.setLong(10, sampledOutRuns.toLong())
                st.executeUpdate()
            }
        }
        if (!withSampled && sampledOutRuns > 0) {
            /* Loud, because this is the one combination where the count is
               computed and then genuinely lost: the sampler is on, V055 has not
               reached this database, and the partition is about to become
               droppable. Warn rather than refuse — refusing would stop the export
               entirely, which is strictly worse for the same partition. */
            log.warn("[archive] {} excluded {} run(s) but run_trace_archives has no " +
                "sampled_out_runs column (V055 not applied) — that count is not recorded",
                partition, sampledOutRuns)
        }
    }

    /**
     * Does the ledger have V055's column yet?
     *
     * The worker and the API deploy independently, in either order. A new worker
     * against a pre-V055 database must still export: the whole point of the ledger
     * is that it gates the drop, and an INSERT that fails on an unknown column
     * would stop archiving and therefore stop retention.
     *
     * Cached after the first successful probe. Not cached on failure — a `false`
     * here is either "the migration has not landed" or "the probe itself failed",
     * and the first resolves itself when the migration lands. Re-probing costs one
     * catalogue lookup per partition, which is nothing next to the export.
     */
    @Volatile private var sampledOutColumnPresent: Boolean = false

    private fun ledgerHasSampledOutColumn(): Boolean {
        if (sampledOutColumnPresent) return true
        val present = runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'run_trace_archives'
                          AND column_name = 'sampled_out_runs'"""
                ).use { st -> st.executeQuery().use { it.next() } }
            }
        }.getOrDefault(false)
        if (present) sampledOutColumnPresent = true
        return present
    }

    /** Move archives past the warm window to `cold`. */
    internal fun ageTiers(): Int = dataSource.connection.use { c ->
        c.prepareStatement("SELECT run_trace_archives_age_tiers(?)").use { st ->
            st.setInt(1, warmDays)
            st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
        }
    }

    /**
     * A partition name cannot be a bind parameter, so it is interpolated — and
     * therefore has to be proven safe rather than assumed safe.
     *
     * Two checks, both required. The shape check rejects anything that is not
     * `<table>_YYYY_MM`; the catalogue check confirms it is genuinely a partition
     * of that table. Shape alone would accept a real table named to look like
     * one; the catalogue alone would accept whatever the catalogue query was
     * given if that query ever became parameterised from elsewhere.
     */
    private fun requireSafePartition(table: String, partition: String) {
        require(partition.matches(Regex("^[a-z_]+_\\d{4}_\\d{2}$"))) {
            "refusing to export a partition with an unexpected name: $partition"
        }
        val real = dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT 1 FROM pg_class ch
                     JOIN pg_inherits i ON i.inhrelid = ch.oid
                     JOIN pg_class p ON p.oid = i.inhparent
                    WHERE p.relname = ? AND ch.relname = ?"""
            ).use { st ->
                st.setString(1, table); st.setString(2, partition)
                st.executeQuery().use { it.next() }
            }
        }
        require(real) { "$partition is not a partition of $table" }
    }
}
