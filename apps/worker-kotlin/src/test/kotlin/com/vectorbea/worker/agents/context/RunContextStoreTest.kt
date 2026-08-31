package com.vectorbea.worker.agents.context

import com.vectorbea.worker.agents.context.RunContextStore.Scope
import com.vectorbea.worker.agents.context.RunContextStore.Visibility
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The blackboard against a real Postgres, because everything worth asserting
 * about it is a property of the SQL: the version race, the `DISTINCT ON` read,
 * and — most of all — the visibility filter, which is access control and must be
 * tested where it actually runs rather than against a stub that agrees with it.
 *
 * Skips when no database is reachable.
 */
class RunContextStoreTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private fun dataSourceOrNull(): DataSource? = try {
        val ds = PGSimpleDataSource().apply {
            setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 10
        }
        ds.connection.use { c ->
            c.prepareStatement("SELECT 1 FROM run_context_entries LIMIT 1").use { it.executeQuery() }
        }
        ds
    } catch (_: Exception) {
        null
    }

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runId: UUID = UUID.randomUUID(),
    )

    private fun seed(ds: DataSource): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "ctx-test")
                it.setString(3, "ctx-test-" + w.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.environmentId); it.setObject(2, w.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.workflowId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setString(4, "wf-" + w.workflowId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.versionId); it.setObject(2, w.workflowId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'running')"
            ).use {
                it.setObject(1, w.runId); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId); it.executeUpdate()
            }
        }
        return w
    }

    /**
     * A real `agent_activations` row.
     *
     * `written_by` has a foreign key to it, and `private` visibility is checked
     * against `written_by` — so a test that fakes the id is testing nothing. The
     * FK is part of what makes the visibility rule trustworthy.
     */
    private fun activation(ds: DataSource, w: World, parent: UUID?, seq: Int): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_activations " +
                "(id, run_id, workspace_id, environment_id, step_id, parent_activation_id, " +
                " root_activation_id, depth, sequence, agent_id, status, idempotency_key) " +
                "VALUES (?,?,?,?,?,?,?,?,?,?, 'running', ?)"
            ).use {
                it.setObject(1, id); it.setObject(2, w.runId); it.setObject(3, w.workspaceId)
                it.setObject(4, w.environmentId); it.setString(5, "n-agent-1")
                it.setObject(6, parent); it.setObject(7, parent ?: id)
                it.setInt(8, if (parent == null) 0 else 1); it.setInt(9, seq)
                it.setObject(10, UUID.randomUUID()); it.setString(11, "idem-" + id)
                it.executeUpdate()
            }
        }
        return id
    }

    private fun cleanup(ds: DataSource, w: World) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
            }
        }
    }

    private fun RunContextStore.put(
        w: World, key: String, value: Any?,
        scope: Scope = Scope.RUN, scopeRef: String? = null,
        visibility: Visibility = Visibility.TEAM, writtenBy: UUID? = null,
    ) = write(w.runId, w.workspaceId, w.environmentId, key, value, scope, scopeRef, visibility, writtenBy)

    private fun reader(w: World, teamRef: String? = null, lineage: List<UUID> = emptyList()) =
        RunContextStore.Reader(w.runId, teamRef, lineage.firstOrNull(), lineage)

    // ── Versioning ───────────────────────────────────────────────────────────

    @Test
    fun `writes append versions and the read returns the newest`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            assertEquals(1L, store.put(w, "findings.pricing", "first"))
            assertEquals(2L, store.put(w, "findings.pricing", "second"))
            assertEquals(3L, store.put(w, "findings.pricing", "third"))

            val entries = store.latest(reader(w))
            assertEquals(1, entries.size, "DISTINCT ON must collapse the key to one row")
            assertEquals("third", entries.single().value)
            assertEquals(3L, entries.single().version)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `nothing is ever updated in place, so the history survives`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            store.put(w, "k", "v1"); store.put(w, "k", "v2"); store.put(w, "k", "v3")

            val history = store.history(w.runId, "k")
            assertEquals(listOf("v1", "v2", "v3"), history.map { it.value })
            assertEquals(listOf(1L, 2L, 3L), history.map { it.version })
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `an as-of read answers what an agent saw at a version`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            store.put(w, "a", "a1")
            store.put(w, "b", "b1")
            val decidedAt = store.currentWatermark(w.runId)
            store.put(w, "a", "a2")
            store.put(w, "c", "c1")

            val then = store.asOf(reader(w), decidedAt).associate { it.key to it.value }

            /*
             * THE QUESTION APPEND-ONLY EXISTS TO ANSWER. With in-place updates
             * this is unanswerable: the value that caused the decision is gone,
             * overwritten by whatever came next, and the trace shows a decision
             * with no visible cause.
             */
            /*
             * THE BUG THIS CAUGHT. Reading as-of a per-key VERSION includes key `c`
             * at its version 1, because `1 <= 2` — even though `c` was written
             * after the decision. An as-of read that shows an agent something it
             * could not have seen is worse than having no as-of read at all, so
             * the snapshot point is the run-wide row watermark instead. See
             * RunContextStore.Entry.watermark.
             */
            assertEquals(mapOf("a" to "a1", "b" to "b1"), then)

            val now = store.latest(reader(w)).associate { it.key to it.value }
            assertEquals(mapOf("a" to "a2", "b" to "b1", "c" to "c1"), now)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `concurrent writers to one key get distinct versions and none is lost`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        val pool = Executors.newFixedThreadPool(8)
        try {
            /* Two peers in a fan-out writing the same key is the NORMAL case for a
               blackboard, not the exceptional one. MAX(version)+1 computed by two
               workers at once yields the same number; the unique index rejects the
               loser and the store retries onto the next version. */
            val futures = (1..8).map { n ->
                pool.submit<Long?> { store.put(w, "contended", "writer-$n") }
            }
            val versions = futures.mapNotNull { it.get(20, TimeUnit.SECONDS) }

            assertEquals(8, versions.size, "a write was dropped under contention")
            assertEquals(versions.size, versions.toSet().size,
                "two rows claiming the same version make 'read at version N' ambiguous")
            assertEquals((1L..8L).toList(), versions.sorted())
            assertEquals(8, store.history(w.runId, "contended").size)
        } finally {
            pool.shutdownNow(); cleanup(ds!!, w)
        }
    }

    // ── Visibility ───────────────────────────────────────────────────────────

    @Test
    fun `a team-scoped entry is invisible to another team`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            store.put(w, "team-a-only", "secret", scope = Scope.TEAM, scopeRef = "team-a")

            assertEquals(1, store.latest(reader(w, teamRef = "team-a")).size)
            assertTrue(store.latest(reader(w, teamRef = "team-b")).isEmpty(),
                "the scope IS the access boundary — a team node id that does not " +
                "match must return nothing, not a filtered-later result")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a private entry is readable by the writer and its descendants, not its peers`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            val supervisor = activation(ds, w, null, 1)
            val worker = activation(ds, w, supervisor, 2)
            val stranger = activation(ds, w, supervisor, 3)

            /* The WORKER writes a private note, at run scope, so the only thing
               narrowing it is the visibility rule itself. */
            store.put(w, "scratch", "worker's notes",
                visibility = Visibility.PRIVATE, writtenBy = worker)

            /* The writer itself. */
            assertEquals(1, store.latest(reader(w, lineage = listOf(worker))).size)

            /* A descendant of the writer: its lineage runs UPWARD and contains it. */
            val subWorker = activation(ds, w, worker, 4)
            assertEquals(1, store.latest(reader(w, lineage = listOf(subWorker, worker, supervisor))).size)

            /* A peer. */
            assertTrue(store.latest(reader(w, lineage = listOf(stranger, supervisor))).isEmpty())

            /* And the SUPERVISOR, reading downward — which is precisely what
               `private` exists to prevent. Its lineage runs up from itself and
               does not contain the worker. */
            assertTrue(store.latest(reader(w, lineage = listOf(supervisor))).isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a private write with no writer is refused rather than stored unreadable`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            /* `private` is enforced as `written_by = ANY(lineage)`, and a null
               written_by makes that comparison null for everyone — including the
               writer. Stored, it would cost storage and never be read again, and
               nothing would say so. Refused at the write, the caller is told. */
            assertNull(store.put(w, "orphan", "v", visibility = Visibility.PRIVATE))
            assertTrue(store.history(w.runId, "orphan").isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a public entry is readable past its scope`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            store.put(w, "published", "for everyone",
                scope = Scope.TEAM, scopeRef = "team-a", visibility = Visibility.PUBLIC)

            /* PUBLIC is a deliberate publish — the writer chose to widen past the
               team it lives in. */
            assertEquals(1, store.latest(reader(w, teamRef = "team-b")).size)
            assertEquals(1, store.latest(reader(w, teamRef = null)).size)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `the default write is readable by the default reader`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            /* The footgun this asserts against: reading `team` visibility as
               "readers who are in a team" makes the DEFAULT write unreadable by
               the DEFAULT reader — a single agent could not read back a value it
               had just written itself. */
            store.put(w, "k", "v")
            assertEquals(1, store.latest(reader(w)).size)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `the as-of read applies exactly the same visibility as the latest read`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            store.put(w, "team-a-only", "secret", scope = Scope.TEAM, scopeRef = "team-a")
            val at = store.currentWatermark(w.runId)

            /* The historical read is the one that drifts permissive, because it is
               the one nobody exercises. A debugger that shows an operator a value
               the agent could not see is a leak with an excuse attached. */
            assertTrue(store.asOf(reader(w, teamRef = "team-b"), at).isEmpty())
            assertEquals(1, store.asOf(reader(w, teamRef = "team-a"), at).size)
        } finally { cleanup(ds!!, w) }
    }

    // ── Filtering and shape ──────────────────────────────────────────────────

    @Test
    fun `a keyed read returns only the keys asked for`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            store.put(w, "a", "1"); store.put(w, "b", "2"); store.put(w, "c", "3")

            val got = store.latest(reader(w), keys = listOf("a", "c"))
            assertEquals(listOf("a", "c"), got.map { it.key })
            assertTrue(store.latest(reader(w), keys = emptyList()).isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a structured value round-trips as JSON and a sentence round-trips as itself`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            store.put(w, "obj", mapOf("risk" to "high", "score" to 3))
            store.put(w, "text", "Tool returned 2 fields")

            val got = store.latest(reader(w)).associate { it.key to it.value }
            assertTrue(got.getValue("obj").contains("\"risk\""))
            /* A sentence handed to a model complete with JSON escapes is needlessly
               harder for it to read than the sentence. */
            assertEquals("Tool returned 2 fields", got.getValue("text"))
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `an oversized value is offloaded and the row keeps a stated summary`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = RunContextStore(ds, com.vectorbea.worker.events.PayloadStore(ds))
        try {
            val big = "x".repeat(RunContextStore.INLINE_MAX_CHARS * 3)
            store.put(w, "huge", big)

            val entry = store.latest(reader(w)).single()
            assertTrue(entry.offloaded, "an entry this size is read into a PROMPT — it " +
                "cannot be allowed to sit inline")
            assertTrue(entry.value.length < big.length)
            /* Stated, not silent. A reader can tell "this is the value" from
               "this is the front of the value". */
            assertTrue(entry.value.contains("more characters in"))
            assertNotNull(entry.payloadRef)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a value carrying a secret is redacted before it can reach a peer's prompt`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            /*
             * `postgres://`, not `postgresql://`. THE SANITIZER ONLY KNEW THE LONG
             * FORM — and libpq, JDBC and every ORM accept the short one, which is
             * what most connection strings in the wild actually look like. So the
             * commonest shape of the commonest leak went straight through, in
             * RecoverySanitizer, which is the redaction every payload, event and
             * span in the system relies on. Found here because a blackboard value
             * is read into a PEER'S prompt and sent to a provider: an unsanitized
             * blackboard is an exfiltration path, not an untidy log.
             */
            store.put(w, "err", "connect failed: postgres://admin:hunter2@db.internal:5432/app")
            store.put(w, "err2", "connect failed: postgresql://admin:hunter2@db.internal:5432/app")

            val values = store.latest(reader(w)).map { it.value }
            assertEquals(2, values.size)
            values.forEach {
                assertTrue(!it.contains("hunter2"), "credential survived into the blackboard: $it")
            }
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a scoped write with no scope ref is refused rather than violating the constraint`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!); val store = RunContextStore(ds)
        try {
            assertNull(store.put(w, "k", "v", scope = Scope.TEAM, scopeRef = null))
            assertNull(store.put(w, "", "v"))
            assertTrue(store.latest(reader(w)).isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `no data source means no blackboard, not a crash`() {
        val store = RunContextStore(null)
        val runId = UUID.randomUUID()
        assertNull(store.write(runId, UUID.randomUUID(), UUID.randomUUID(), "k", "v"))
        assertTrue(store.latest(RunContextStore.Reader(runId, null, null)).isEmpty())
        assertEquals(0L, store.currentWatermark(runId))
    }
}
