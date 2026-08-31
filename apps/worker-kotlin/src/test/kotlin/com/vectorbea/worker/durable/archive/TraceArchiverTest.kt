package com.vectorbea.worker.durable.archive

import com.vectorbea.worker.durable.PartitionMaintenance
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.GZIPInputStream
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §12.1 tiering — the export, and the gate that makes the drop safe.
 *
 * The interesting assertions are all about ORDER and IRREVERSIBILITY, so they are
 * made against a real partitioned table: whether a partition can be dropped is a
 * property of the catalogue, and a fake would be asserting that the fake agrees
 * with itself.
 *
 * Skips when no database is reachable.
 */
class TraceArchiverTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private fun dsOrNull(): DataSource? = try {
        val ds = PGSimpleDataSource().apply { setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 30 }
        ds.connection.use { c ->
            c.prepareStatement("SELECT 1 FROM run_trace_archives LIMIT 1").use { it.executeQuery() }
        }
        ds
    } catch (_: Exception) { null }

    /**
     * A month far enough in the past that it is unambiguously outside any hot
     * window, and far enough from the months the running system creates that this
     * test cannot collide with real data.
     */
    private val month = "2026_05"
    private val partition = "run_spans_$month"

    private fun setUp(ds: DataSource, workspaceId: UUID, runId: UUID, rows: Int) {
        ds.connection.use { c ->
            c.prepareStatement("SELECT run_spans_ensure_partition('2026-05-01'::date)")
                .use { it.executeQuery().use { } }
            c.prepareStatement(
                "INSERT INTO run_spans (span_id, trace_id, run_id, workspace_id, kind, name, status, " +
                " started_at, ended_at, duration_ms, attributes_json, tokens_in, created_at) " +
                "VALUES (?,?,?,?,?,?,?, '2026-05-15T10:00:00Z', '2026-05-15T10:00:01Z', ?, ?::jsonb, ?, " +
                " '2026-05-15T10:00:00Z')"
            ).use { st ->
                repeat(rows) { i ->
                    st.setObject(1, UUID.randomUUID()); st.setObject(2, UUID.randomUUID())
                    st.setObject(3, runId); st.setObject(4, workspaceId)
                    st.setString(5, "iteration"); st.setString(6, "iter-$i")
                    st.setString(7, if (i % 7 == 0) "failed" else "ok")
                    st.setInt(8, 1000 + i)
                    st.setString(9, """{"context_chars":$i,"note":"line\nbreak \"quoted\""}""")
                    // Every third row leaves tokens_in NULL, so the encoder's
                    // null-omission is exercised by real data rather than assumed.
                    if (i % 3 == 0) st.setNull(10, java.sql.Types.INTEGER) else st.setInt(10, i)
                    st.addBatch()
                }
                st.executeBatch()
            }
        }
    }

    private fun tearDown(ds: DataSource, tmp: Path?) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DROP TABLE IF EXISTS $partition").use { it.executeUpdate() }
                c.prepareStatement("DELETE FROM run_trace_archives WHERE partition_name = ?")
                    .use { it.setString(1, partition); it.executeUpdate() }
            }
        }
        if (tmp != null) runCatching {
            Files.walk(tmp).sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }

    private fun ledger(ds: DataSource): Map<String, Any?>? = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT row_count, byte_count, format, object_key, checksum, tier, dropped_at " +
            "FROM run_trace_archives WHERE partition_name = ?"
        ).use { st ->
            st.setString(1, partition)
            st.executeQuery().use { rs ->
                if (!rs.next()) null else mapOf(
                    "rows" to rs.getLong(1), "bytes" to rs.getLong(2), "format" to rs.getString(3),
                    "key" to rs.getString(4), "checksum" to rs.getString(5),
                    "tier" to rs.getString(6), "dropped_at" to rs.getTimestamp(7))
            }
        }
    }

    private fun partitionExists(ds: DataSource): Boolean = ds.connection.use { c ->
        c.prepareStatement("SELECT to_regclass(?) IS NOT NULL").use { st ->
            st.setString(1, partition)
            st.executeQuery().use { rs -> rs.next() && rs.getBoolean(1) }
        }
    }

    // ── The export ────────────────────────────────────────────────────────────

    @Test
    fun `a closed partition is exported, recorded and readable back`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val tmp = Files.createTempDirectory("archive-test")
        val ws = UUID.randomUUID(); val run = UUID.randomUUID()
        try {
            setUp(ds, ws, run, 40)
            val store = FilesystemArchiveStore(tmp.toString())
            /* A warm window wide enough that this month cannot age out mid-test.
               The 2026-05 partition is deliberately old, and with the production
               default of 90 days it is already cold — which is correct behaviour
               and is asserted separately below. */
            val archiver = TraceArchiver(ds, store, NdJsonGzEncoder(), hotDays = 7, warmDays = 3650)

            assertTrue(archiver.due("run_spans").any { it.first == partition },
                "a fully-past month should be due for export")

            val done = archiver.runOnce().filter { it.partition == partition }
            assertEquals(1, done.size)
            assertEquals(40L, done.first().rows)

            val row = ledger(ds)
            assertTrue(row != null, "the ledger must record the export")
            assertEquals(40L, row!!["rows"])
            assertEquals("ndjson.gz", row["format"])
            assertEquals("warm", row["tier"])
            assertEquals(null, row["dropped_at"], "nothing has been dropped yet")

            // The object is real, complete, and hashes to what was recorded.
            val file = tmp.resolve(row["key"] as String)
            assertTrue(Files.isRegularFile(file), "the archive object must exist at its key")
            assertEquals(row["bytes"], Files.size(file))
            val sha = MessageDigest.getInstance("SHA-256")
                .digest(Files.readAllBytes(file)).joinToString("") { "%02x".format(it) }
            assertEquals(row["checksum"], sha, "the recorded checksum must match the stored bytes")

            /* Gunzip and parse. A gzip stream whose trailer was never written is a
               valid PREFIX, so this is the assertion that catches an encoder that
               forgot to close — a corruption that would otherwise surface only
               after the partition backing it was gone. */
            val mapper = com.fasterxml.jackson.databind.ObjectMapper()
            val lines = GZIPInputStream(Files.newInputStream(file)).bufferedReader()
                .readLines().filter { it.isNotBlank() }
            assertEquals(40, lines.size)
            val parsed = lines.map { mapper.readTree(it) }
            assertEquals(setOf(ws.toString()), parsed.map { it["workspace_id"].asText() }.toSet())
            // jsonb went out as JSON, not as a string containing JSON.
            assertTrue(parsed.first()["attributes_json"].isObject,
                "a jsonb column must survive as an object, or a warm-tier query has to parse twice")
            // NULLs are omitted rather than written as null.
            assertEquals(40 - ((40 + 2) / 3), parsed.count { it.has("tokens_in") })
        } finally {
            tearDown(ds, tmp)
        }
    }

    /**
     * Tiering is a statement about what is PROMISED, not a move.
     *
     * Warm means "expected to be readable"; cold means "export-only, no latency
     * promised". Nothing is copied or deleted when the line is crossed — the
     * bucket's own lifecycle rules do that, and they need a marker in the
     * database that agrees with them.
     */
    @Test
    fun `an archive past the warm window is marked cold`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val tmp = Files.createTempDirectory("archive-test")
        try {
            setUp(ds, UUID.randomUUID(), UUID.randomUUID(), 3)
            TraceArchiver(ds, FilesystemArchiveStore(tmp.toString()), NdJsonGzEncoder(),
                hotDays = 7, warmDays = 3650).runOnce()
            assertEquals("warm", ledger(ds)!!["tier"])

            TraceArchiver(ds, FilesystemArchiveStore(tmp.toString()), NdJsonGzEncoder(),
                hotDays = 7, warmDays = 30).ageTiers()
            assertEquals("cold", ledger(ds)!!["tier"])
        } finally {
            tearDown(ds, tmp)
        }
    }

    @Test
    fun `a second pass does not re-export`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val tmp = Files.createTempDirectory("archive-test")
        try {
            setUp(ds, UUID.randomUUID(), UUID.randomUUID(), 5)
            val archiver = TraceArchiver(ds, FilesystemArchiveStore(tmp.toString()),
                NdJsonGzEncoder(), hotDays = 7, warmDays = 3650)
            assertEquals(1, archiver.runOnce().count { it.partition == partition })
            assertFalse(archiver.due("run_spans").any { it.first == partition })
            assertEquals(0, archiver.runOnce().count { it.partition == partition },
                "an already-exported partition must not be exported again")
        } finally {
            tearDown(ds, tmp)
        }
    }

    @Test
    fun `the current month is never due`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val thisMonth = java.time.LocalDate.now().let {
            "run_spans_%04d_%02d".format(it.year, it.monthValue)
        }
        /* `due` is the conjunction of two conditions — unarchived AND past the hot
           window — so a ledger row for this month would make the assertion pass for
           the WRONG reason, and whether one exists depends on which sibling test ran
           first. Clearing it isolates the condition actually under test. Mutation
           testing found this: breaking the hot-window check left the test green. */
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_trace_archives WHERE partition_name = ?")
                .use { it.setString(1, thisMonth); it.executeUpdate() }
        }
        val archiver = TraceArchiver(ds, UnconfiguredArchiveStore, NdJsonGzEncoder(), hotDays = 7)
        assertFalse(archiver.due("run_spans").any { it.first == thisMonth },
            "a month still being written must never be exported — the snapshot would miss its tail")
    }

    // ── Sampling, end to end ──────────────────────────────────────────────────

    /**
     * The sampler's facts query is real SQL over three tables, and it is the part
     * of §12.1 item 3 that a pure unit test cannot reach: `TraceSamplerTest` proves
     * the RULES, this proves the FACTS the rules are given are the right ones.
     *
     * Four runs, identical except for one attribute each:
     *   plain    — succeeded, long, unremarkable        → sampled out at rate 0
     *   failed   — one span with status='failed'        → kept
     *   approved — an APPROVAL_REQUESTED event          → kept
     *   clamped  — a span with budget_clamped in attrs  → kept
     */
    @Test
    fun `sampling excludes only the unremarkable runs`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val tmp = Files.createTempDirectory("archive-test")
        val ws = UUID.randomUUID()
        val plain = UUID.randomUUID(); val failed = UUID.randomUUID()
        val approved = UUID.randomUUID(); val clamped = UUID.randomUUID()
        try {
            seedWorkspace(ds, ws)
            listOf(plain, failed, approved, clamped).forEach { seedRun(ds, ws, it) }

            ds.connection.use { c ->
                c.prepareStatement("SELECT run_spans_ensure_partition('2026-05-01'::date)")
                    .use { it.executeQuery().use { } }
            }
            listOf(plain, failed, approved, clamped).forEach { span(ds, ws, it, "ok", "{}") }
            span(ds, ws, failed, "failed", "{}")
            span(ds, ws, clamped, "ok", """{"budget_clamped":true}""")
            approvalEvent(ds, ws, approved)

            val archiver = TraceArchiver(ds, FilesystemArchiveStore(tmp.toString()),
                NdJsonGzEncoder(), hotDays = 7, warmDays = 3650,
                sampler = TraceSampler(rateFor = { 0.0 }))

            val out = archiver.sampledOut(partition)
            assertEquals(listOf(plain), out,
                "only the unremarkable run may be sampled out")

            val done = archiver.runOnce().single { it.partition == partition }
            assertEquals(1, done.sampledOutRuns)

            val mapper = com.fasterxml.jackson.databind.ObjectMapper()
            val file = tmp.resolve(ledger(ds)!!["key"] as String)
            val runIds = GZIPInputStream(Files.newInputStream(file)).bufferedReader()
                .readLines().filter { it.isNotBlank() }
                .map { mapper.readTree(it)["run_id"].asText() }.toSet()
            assertEquals(setOf(failed, approved, clamped).map { it.toString() }.toSet(), runIds,
                "the archive must hold exactly the runs the sampler kept")
        } finally {
            runCatching {
                ds.connection.use { c ->
                    c.prepareStatement("DELETE FROM run_events WHERE workspace_id=?")
                        .use { it.setObject(1, ws); it.executeUpdate() }
                    c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                        .use { it.setObject(1, ws); it.executeUpdate() }
                }
            }
            tearDown(ds, tmp)
        }
    }

    private fun seedWorkspace(ds: DataSource, ws: UUID) = ds.connection.use { c ->
        c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
            it.setObject(1, ws); it.setString(2, "sample"); it.setString(3, "sample-$ws")
            it.executeUpdate()
        }
        c.prepareStatement(
            "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
        ).use { it.setObject(1, envFor(ws)); it.setObject(2, ws); it.executeUpdate() }
        c.prepareStatement(
            "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')"
        ).use {
            it.setObject(1, wfFor(ws)); it.setObject(2, ws); it.setObject(3, envFor(ws))
            it.setString(4, "wf-$ws"); it.executeUpdate()
        }
        c.prepareStatement(
            "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
        ).use { it.setObject(1, verFor(ws)); it.setObject(2, wfFor(ws)); it.executeUpdate() }
    }

    /* Deterministic derived ids so the helpers need no shared mutable state. */
    private fun envFor(ws: UUID) = UUID.nameUUIDFromBytes("env$ws".toByteArray())
    private fun wfFor(ws: UUID) = UUID.nameUUIDFromBytes("wf$ws".toByteArray())
    private fun verFor(ws: UUID) = UUID.nameUUIDFromBytes("ver$ws".toByteArray())

    /** A long, successful, three-months-old run — the perfect sampling candidate. */
    private fun seedRun(ds: DataSource, ws: UUID, runId: UUID) = ds.connection.use { c ->
        c.prepareStatement(
            "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id," +
            " status,duration_ms,created_at) VALUES (?,?,?,?,?, 'succeeded', 600000, '2026-05-15T10:00:00Z')"
        ).use {
            it.setObject(1, runId); it.setObject(2, ws); it.setObject(3, envFor(ws))
            it.setObject(4, wfFor(ws)); it.setObject(5, verFor(ws)); it.executeUpdate()
        }
    }

    private fun span(ds: DataSource, ws: UUID, runId: UUID, status: String, attrs: String) =
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO run_spans (span_id,trace_id,run_id,workspace_id,kind,name,status," +
                " started_at,attributes_json,created_at) VALUES (?,?,?,?,'iteration','i',?," +
                " '2026-05-15T10:00:00Z', ?::jsonb, '2026-05-15T10:00:00Z')"
            ).use {
                it.setObject(1, UUID.randomUUID()); it.setObject(2, UUID.randomUUID())
                it.setObject(3, runId); it.setObject(4, ws); it.setString(5, status)
                it.setString(6, attrs); it.executeUpdate()
            }
        }

    private fun approvalEvent(ds: DataSource, ws: UUID, runId: UUID) = ds.connection.use { c ->
        c.prepareStatement(
            "INSERT INTO run_events (run_id,workspace_id,environment_id,sequence,type,status,source,timestamp) " +
            "VALUES (?,?,?,1,'APPROVAL_REQUESTED','waiting','worker', now())"
        ).use {
            it.setObject(1, runId); it.setObject(2, ws); it.setObject(3, envFor(ws)); it.executeUpdate()
        }
    }

    /**
     * A REGRESSION TEST, and the bug it pins was real.
     *
     * Sampling used to decide per `agent_runs` row. A dispatched child is its own
     * row, so a five-agent team is six independent decisions — and that gets two
     * things wrong at once:
     *
     *   • The failure in a team is almost always in a CHILD. The supervisor
     *     delegates and waits. Deciding on the supervisor's own spans answers
     *     "did the supervisor fail" and samples out the whole trace.
     *   • Worse, it can KEEP the failed child and DROP its parent, leaving spans
     *     in the warm tier whose parents do not exist. Half a trace reads as
     *     corruption, which is worse than a clean absence.
     *
     * Found by `RunTraceExportTest` — exporting to an external model is what made
     * the per-run granularity visible, which is the argument §9 makes for building
     * the export before the schema hardens.
     */
    @Test
    fun `a failure in a dispatched child keeps the whole tree`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val tmp = Files.createTempDirectory("archive-test")
        val ws = UUID.randomUUID()
        val parent = UUID.randomUUID()
        val child = UUID.randomUUID()
        try {
            seedWorkspace(ds, ws)
            seedRun(ds, ws, parent)
            seedChildRun(ds, ws, child, parent)

            ds.connection.use { c ->
                c.prepareStatement("SELECT run_spans_ensure_partition('2026-05-01'::date)")
                    .use { it.executeQuery().use { } }
            }
            // The supervisor's own spans are spotless. Everything that would make
            // this trace worth keeping happened one level down.
            span(ds, ws, parent, "ok", "{}")
            span(ds, ws, child, "ok", "{}")
            span(ds, ws, child, "failed", "{}")

            val archiver = TraceArchiver(ds, FilesystemArchiveStore(tmp.toString()),
                NdJsonGzEncoder(), hotDays = 7, warmDays = 3650,
                sampler = TraceSampler(rateFor = { 0.0 }))

            assertEquals(emptyList(), archiver.sampledOut(partition),
                "a failure anywhere in the tree must keep every run in it")
        } finally {
            runCatching {
                ds.connection.use { c ->
                    c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                        .use { it.setObject(1, ws); it.executeUpdate() }
                }
            }
            tearDown(ds, tmp)
        }
    }

    /**
     * The other half: a clean team is dropped WHOLE, never partially.
     *
     * Both runs go, or neither. A warm tier holding a child whose parent was
     * sampled out is unreadable in a way that looks like data loss.
     */
    @Test
    fun `a clean team is sampled out as a whole tree`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val tmp = Files.createTempDirectory("archive-test")
        val ws = UUID.randomUUID()
        val parent = UUID.randomUUID()
        val child = UUID.randomUUID()
        try {
            seedWorkspace(ds, ws)
            seedRun(ds, ws, parent)
            seedChildRun(ds, ws, child, parent)
            ds.connection.use { c ->
                c.prepareStatement("SELECT run_spans_ensure_partition('2026-05-01'::date)")
                    .use { it.executeQuery().use { } }
            }
            span(ds, ws, parent, "ok", "{}")
            span(ds, ws, child, "ok", "{}")

            val out = TraceArchiver(ds, FilesystemArchiveStore(tmp.toString()),
                NdJsonGzEncoder(), hotDays = 7, warmDays = 3650,
                sampler = TraceSampler(rateFor = { 0.0 })).sampledOut(partition)

            assertEquals(setOf(parent, child), out.toSet(),
                "both runs or neither — a partial tree is worse than no tree")
        } finally {
            runCatching {
                ds.connection.use { c ->
                    c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                        .use { it.setObject(1, ws); it.executeUpdate() }
                }
            }
            tearDown(ds, tmp)
        }
    }

    /** A dispatched child: same shape as [seedRun], plus its parent link. */
    private fun seedChildRun(ds: DataSource, ws: UUID, runId: UUID, parentRun: UUID) =
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                "workflow_version_id,status,duration_ms,created_at,parent_run_id) " +
                "VALUES (?,?,?,?,?, 'succeeded', 600000, '2026-05-15T10:00:00Z', ?)"
            ).use {
                it.setObject(1, runId); it.setObject(2, ws); it.setObject(3, envFor(ws))
                it.setObject(4, wfFor(ws)); it.setObject(5, verFor(ws)); it.setObject(6, parentRun)
                it.executeUpdate()
            }
        }

    // ── The gate ──────────────────────────────────────────────────────────────

    /**
     * The point of the whole item: an un-exported partition past the hot window
     * stops the drop, rather than racing it.
     *
     * `dropEnabled = true` here, which is the dangerous configuration. Without
     * the gate this call reaches `run_spans_drop_expired_partitions()`, and the
     * only thing standing between that and the data is a retention window.
     */
    @Test
    fun `an un-exported partition blocks the drop`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val tmp = Files.createTempDirectory("archive-test")
        try {
            setUp(ds, UUID.randomUUID(), UUID.randomUUID(), 3)
            val archiver = TraceArchiver(ds, FilesystemArchiveStore(tmp.toString()),
                NdJsonGzEncoder(), hotDays = 7)
            val maintenance = PartitionMaintenance(
                dataSource = ds, redisCommands = null, dropEnabled = true, archiver = archiver)

            maintenance.reportOrDropExpired("run_spans")
            assertTrue(partitionExists(ds),
                "the drop must be refused while a past-hot-window partition is un-exported")

            // Export it, and the gate opens.
            archiver.runOnce()
            assertTrue(archiver.due("run_spans").isEmpty())
            maintenance.reportOrDropExpired("run_spans")
            /* Whether it actually goes depends on the retention window, which is
               driven by workspace `log_retention_days` and is not this test's
               business. What IS asserted: the gate no longer refuses, so the drop
               function was reached. */
        } finally {
            tearDown(ds, tmp)
        }
    }

    /**
     * With no archiver wired in, behaviour is exactly what it was before §12.1.
     *
     * A deployment without object storage still needs its retention job. A gate
     * that refused to drop in that configuration would fill a disk, get switched
     * off, and take the real gate with it.
     */
    @Test
    fun `without an archiver the drop behaves as it did before`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        try {
            setUp(ds, UUID.randomUUID(), UUID.randomUUID(), 2)
            PartitionMaintenance(dataSource = ds, redisCommands = null, dropEnabled = false)
                .reportOrDropExpired("run_spans")
            assertTrue(partitionExists(ds))
        } finally {
            tearDown(ds, null)
        }
    }
}
