package com.vectorbea.worker.retention

import com.vectorbea.worker.durable.archive.ArchiveStore
import com.vectorbea.worker.testsupport.Infra
import org.junit.jupiter.api.Tag
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.time.Duration
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * S-retention's acceptance criteria, as tests.
 *
 *   - Data past retention is ABSENT from every read path, because it does not
 *     exist. Asserted by reading the tables directly, which is the strongest
 *     form of "every read path": if the row is not in `run_events`, no query
 *     over `run_events` can return it, however it is written.
 *   - A downgrade preserves data through the grace period and warns with dates.
 *   - The job is idempotent and resumable; killing it mid-run loses nothing.
 *   - Measured storage per workspace falls after the first full cycle.
 *
 * Integration, against a real Postgres, because every rule under test lives in a
 * SQL function or in the interaction between one and a batch loop.
 */
@Tag("integration")
class RetentionAcceptanceTest {

    private val ds: DataSource get() = Infra.postgres

    /** Collects bundles in memory so a test can assert what was exported. */
    private class MemoryStore : ArchiveStore {
        val objects = mutableMapOf<String, ByteArray>()
        override val description = "memory"
        override fun put(key: String, write: (OutputStream) -> Unit): Long {
            val buf = ByteArrayOutputStream()
            write(buf)
            objects[key] = buf.toByteArray()
            return buf.size().toLong()
        }
        override fun exists(key: String) = objects.containsKey(key)
    }

    // ── World ─────────────────────────────────────────────────────────────────

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val ownerId: UUID = UUID.randomUUID(),
    ) {
        lateinit var accountId: UUID
    }

    private fun seed(plan: String = "team"): World {
        val w = World()
        exec("INSERT INTO app_users (id, supabase_user_id, email) VALUES (?,?,?)",
            w.ownerId, "sub-${w.ownerId}", "r-${w.ownerId}@example.test")
        exec("INSERT INTO workspaces (id,name,slug,owner_user_id) VALUES (?,?,?,?)",
            w.workspaceId, "Retention", "ret-${w.workspaceId}", w.ownerId)
        w.accountId = scalarUuid("SELECT billing_account_id FROM workspaces WHERE id=?", w.workspaceId)!!
        exec("UPDATE billing_accounts SET plan_code=? WHERE id=?", plan, w.accountId)
        exec("INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')",
            w.environmentId, w.workspaceId)
        exec("INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')",
            w.workflowId, w.workspaceId, w.environmentId, "wf-${w.workflowId}")
        exec("INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')",
            w.versionId, w.workflowId)
        return w
    }

    private fun cleanup(w: World) {
        runCatching { exec("DELETE FROM workspaces WHERE id=?", w.workspaceId) }
        runCatching { exec("DELETE FROM billing_accounts WHERE id=?", w.accountId) }
        runCatching { exec("DELETE FROM app_users WHERE id=?", w.ownerId) }
    }

    /** One finished run, [ageDays] old, with [events] events and a payload. */
    private fun run(w: World, ageDays: Long, events: Int = 3): UUID {
        val id = UUID.randomUUID()
        val at = Instant.now().minus(Duration.ofDays(ageDays))
        exec(
            "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id," +
                "status,trigger_type,execution_mode_kind,execution_class,created_at,completed_at,duration_ms) " +
                "VALUES (?,?,?,?,?,'succeeded','manual','live','agent',?,?,1000)",
            id, w.workspaceId, w.environmentId, w.workflowId, w.versionId,
            java.sql.Timestamp.from(at), java.sql.Timestamp.from(at),
        )
        repeat(events) { i ->
            exec(
                "INSERT INTO run_events (id,run_id,workspace_id,environment_id,sequence,type,status," +
                    "source,\"timestamp\",created_at) VALUES (?,?,?,?,?,?,'succeeded','test',?,?)",
                UUID.randomUUID(), id, w.workspaceId, w.environmentId, i.toLong(), "STEP_COMPLETED",
                java.sql.Timestamp.from(at), java.sql.Timestamp.from(at),
            )
        }
        exec(
            "INSERT INTO run_payloads (ref,workspace_id,size_bytes,content_type,storage,inline_value," +
                "expires_at,created_at) VALUES (?,?,?,?,'inline',?::jsonb,?,?)",
            "sha-${UUID.randomUUID()}", w.workspaceId, 4096, "application/json",
            "{\"prompt\":\"x\"}", java.sql.Timestamp.from(at.plus(Duration.ofDays(7))),
            java.sql.Timestamp.from(at),
        )
        return id
    }

    private fun sweeper(store: ArchiveStore = MemoryStore(), deleteEnabled: Boolean = true) =
        RetentionSweeper(
            dataSource = ds,
            redisCommands = null,
            exporter = WorkspaceExporter(ds, store),
            deleteEnabled = deleteEnabled,
            batchSize = 500,
        )

    // ═════════════════════════════════════════════════════════════════════════
    // 1. Data past retention is absent because it does not exist.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `data past retention is deleted, not hidden`() {
        val w = seed(plan = "free")   // runs 7d, events 7d, payloads 7d
        try {
            val old = run(w, ageDays = 40)
            val fresh = run(w, ageDays = 1)

            // The state has to exist first, or the very first observation opens
            // no grace and the plan window applies — which is what we want here,
            // but the test should be explicit about it rather than lucky.
            sweeper(deleteEnabled = false).sweep()

            sweeper().sweep()

            assertEquals(0, countRuns(w, old), "the 40-day-old run is still present")
            assertEquals(1, countRuns(w, fresh), "the 1-day-old run was deleted")

            // The strongest form of "absent from every read path": the rows are
            // not in the table, so no query over it — API, export, support, or a
            // feature written next year — can return them.
            assertEquals(0, countEvents(w, old))
            assertTrue(countEvents(w, fresh) > 0)

            // And nothing anywhere carries a "hidden" flag that a reader could
            // forget. If this column ever appears, retention has become a filter.
            assertEquals(0, columnsNamed("retention_hidden_at") + columnsNamed("soft_deleted_at"),
                "a soft-delete column appeared — retention is a deletion, not a filter")
        } finally { cleanup(w) }
    }

    @Test
    fun `a dry run deletes nothing`() {
        val w = seed(plan = "free")
        try {
            val old = run(w, ageDays = 40)
            sweeper(deleteEnabled = false).sweep()
            sweeper(deleteEnabled = false).sweep()
            assertEquals(1, countRuns(w, old),
                "RETENTION_DELETE_ENABLED is off and rows were still deleted")
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2. A downgrade preserves data through grace, and warns with dates.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a downgrade preserves data through the grace period`() {
        val w = seed(plan = "team")   // runs: 90 days
        try {
            val old = run(w, ageDays = 40)

            // Observed on Team. Nothing expires: 40 days is inside 90.
            sweeper().sweep()
            assertEquals(1, countRuns(w, old))

            // The downgrade. Free keeps runs for 7 days, so without grace this
            // 40-day-old run would go on the very next pass.
            exec("UPDATE billing_accounts SET plan_code='free' WHERE id=?", w.accountId)

            sweeper().sweep()
            assertEquals(1, countRuns(w, old),
                "a downgrade deleted 33 days of data on the first sweep after the plan change")

            val state = retentionState(w, "runs")
            assertNotNull(state)
            assertEquals(7, state["effective_days"])
            assertEquals(90, state["previous_days"], "the old window was not carried forward")
            assertNotNull(state["grace_until"], "no grace period was opened")
            assertNotNull(state["notified_at"], "the workspace was never warned")

            // Grace runs out. NOW it goes.
            exec("""UPDATE workspace_retention_state SET grace_until = now() - interval '1 day'
                     WHERE workspace_id=? AND entity='runs'""", w.workspaceId)
            sweeper().sweep()
            assertEquals(0, countRuns(w, old), "grace expired and the data survived anyway")
        } finally { cleanup(w) }
    }

    @Test
    fun `an upgrade takes effect immediately and closes any grace`() {
        val w = seed(plan = "free")
        try {
            sweeper(deleteEnabled = false).sweep()
            exec("UPDATE billing_accounts SET plan_code='team' WHERE id=?", w.accountId)
            sweeper(deleteEnabled = false).sweep()

            val state = retentionState(w, "runs")!!
            assertEquals(90, state["effective_days"])
            assertNull(state["previous_days"], "an upgrade left a stale previous window behind")
            assertNull(state["grace_until"], "an upgrade opened a grace period it does not need")
        } finally { cleanup(w) }
    }

    @Test
    fun `two downgrades do not shorten the protection the first one bought`() {
        val w = seed(plan = "team")
        try {
            sweeper(deleteEnabled = false).sweep()

            exec("UPDATE billing_accounts SET plan_code='pro' WHERE id=?", w.accountId)
            sweeper(deleteEnabled = false).sweep()
            val firstGrace = retentionState(w, "runs")!!["grace_until"] as java.sql.Timestamp

            exec("UPDATE billing_accounts SET plan_code='free' WHERE id=?", w.accountId)
            sweeper(deleteEnabled = false).sweep()
            val state = retentionState(w, "runs")!!

            assertTrue((state["grace_until"] as java.sql.Timestamp) >= firstGrace,
                "the second downgrade shortened the grace the first one bought")
            // Team's 90 days, not Pro's 30: a customer sliding down the tiers is
            // in more trouble, not less.
            assertEquals(90, state["previous_days"])
        } finally { cleanup(w) }
    }

    @Test
    fun `the policy carries the dates the job will actually use`() {
        val w = seed(plan = "team")
        try {
            sweeper(deleteEnabled = false).sweep()
            exec("UPDATE billing_accounts SET plan_code='free' WHERE id=?", w.accountId)
            sweeper(deleteEnabled = false).sweep()

            // What /api/retention renders. Read here through the same function
            // the route calls, so the test pins the contract and not the JSON.
            val (days, source) = ds.connection.use { c ->
                c.prepareStatement("SELECT days, source FROM retention_effective_days(?, 'runs')").use { st ->
                    st.setObject(1, w.workspaceId)
                    st.executeQuery().use { rs -> rs.next(); rs.getInt(1) to rs.getString(2) }
                }
            }
            assertEquals(90, days, "the graced window is not the one being reported")
            assertEquals("grace", source, "the reason shown to the customer is wrong")
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3. Idempotent and resumable.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `the sweep is idempotent - running it twice changes nothing the second time`() {
        val w = seed(plan = "free")
        try {
            repeat(5) { run(w, ageDays = 40) }
            sweeper(deleteEnabled = false).sweep()

            val first = sweeper().sweep()
            val second = sweeper().sweep()

            assertTrue(first.rowsDeleted > 0, "the first sweep deleted nothing to be idempotent about")
            assertEquals(0L, second.rowsDeleted,
                "the second sweep deleted more — the work is not idempotent")
        } finally { cleanup(w) }
    }

    @Test
    fun `killing the sweep mid-run loses nothing`() {
        val w = seed(plan = "free")
        try {
            repeat(12) { run(w, ageDays = 40, events = 2) }
            sweeper(deleteEnabled = false).sweep()

            /* A sweep with a zero budget stops after its first workspace check —
               the closest thing to `kill -9` a test can arrange deterministically.
               It commits whatever batches it completed and marks itself
               `interrupted`. */
            val killed = RetentionSweeper(
                dataSource = ds, redisCommands = null,
                exporter = WorkspaceExporter(ds, MemoryStore()),
                deleteEnabled = true, batchSize = 2,
                maxRuntime = Duration.ZERO,
            ).sweep()
            assertTrue(killed.interrupted, "the budget was not respected")

            // Nothing is lost and nothing is stuck: a later pass finishes the job
            // from the data, with no cursor to have been corrupted.
            var guard = 0
            while (countAllRuns(w) > 0 && guard++ < 20) sweeper().sweep()

            assertEquals(0, countAllRuns(w),
                "the interrupted sweep left rows no later pass could reach")

            val statuses = sweepStatuses()
            assertTrue(statuses.contains("interrupted"),
                "an interrupted sweep did not record itself as interrupted")
            assertTrue(statuses.contains("succeeded"))
        } finally { cleanup(w) }
    }

    @Test
    fun `every sweep writes a heartbeat row`() {
        val before = ds.connection.use { c ->
            c.prepareStatement("SELECT count(*) FROM retention_sweeps").use {
                it.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
            }
        }
        sweeper(deleteEnabled = false).sweep()
        val after = ds.connection.use { c ->
            c.prepareStatement(
                "SELECT count(*) FROM retention_sweeps WHERE status='succeeded' AND finished_at IS NOT NULL"
            ).use { it.executeQuery().use { rs -> rs.next(); rs.getInt(1) } }
        }
        assertTrue(after > 0, "no successful sweep was recorded — the heartbeat is silent")
        assertTrue(after <= before + 1)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 4. Export before delete, and the audit.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a deletion exports first and records what it did`() {
        val w = seed(plan = "free")
        try {
            repeat(3) { run(w, ageDays = 40) }
            sweeper(deleteEnabled = false).sweep()

            val store = MemoryStore()
            RetentionSweeper(
                dataSource = ds, redisCommands = null,
                exporter = WorkspaceExporter(ds, store),
                deleteEnabled = true, batchSize = 500,
            ).sweep()

            assertTrue(store.objects.keys.any { it.startsWith("exports/${w.workspaceId}/") },
                "data was deleted with no export written first")

            val audit = deletionAudit(w)
            assertTrue(audit.isNotEmpty(), "nothing was audited")
            val runsRow = audit.first { it["entity"] == "runs" }
            assertEquals(7, runsRow["policy_days"], "the audit does not name the window that authorised it")
            assertEquals("free", runsRow["plan_code"])
            assertNotNull(runsRow["cutoff"])
            assertTrue((runsRow["rows_deleted"] as Long) > 0)
        } finally { cleanup(w) }
    }

    @Test
    fun `an export bundle contains the rows that are about to be deleted`() {
        val w = seed(plan = "free")
        try {
            val doomed = run(w, ageDays = 40, events = 4)
            val store = MemoryStore()
            val result = WorkspaceExporter(ds, store)
                .export(w.workspaceId, from = null, to = Instant.now())

            assertNotNull(result, "nothing was exported for a workspace that has data")
            val body = java.util.zip.GZIPInputStream(
                store.objects.getValue(result.objectKey).inputStream()
            ).bufferedReader().readText()

            assertTrue(body.contains(doomed.toString()), "the run is missing from its own export")
            assertTrue(body.contains("\"_entity\":\"events\""), "events are missing from the export")
            assertTrue(body.contains("\"_meta\""), "the bundle has no identifying header")
        } finally { cleanup(w) }
    }

    @Test
    fun `an empty range produces no bundle rather than an empty one`() {
        val w = seed(plan = "free")
        try {
            val store = MemoryStore()
            val result = WorkspaceExporter(ds, store)
                .export(w.workspaceId, from = null, to = Instant.now().minus(Duration.ofDays(3650)))
            assertNull(result,
                "an empty export would satisfy a pre-deletion check that nothing backs")
            assertTrue(store.objects.isEmpty())
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 5. Measured storage per workspace falls after the first full cycle.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `measured storage falls after the first full cycle`() {
        val w = seed(plan = "free")
        try {
            repeat(20) { run(w, ageDays = 40, events = 5) }
            repeat(3) { run(w, ageDays = 1, events = 5) }

            val before = storage(w)
            sweeper(deleteEnabled = false).sweep()
            sweeper().sweep()
            val after = storage(w)

            val report = buildString {
                appendLine("workspace storage, before -> after one full cycle (free plan, 7-day windows)")
                for (entity in before.keys.sorted()) {
                    val b = before.getValue(entity)
                    val a = after.getValue(entity)
                    appendLine("  %-14s rows %6d -> %-6d   bytes %9d -> %d"
                        .format(entity, b.first, a.first, b.second, a.second))
                }
            }
            println(report)

            assertTrue(after.getValue("runs").first < before.getValue("runs").first, report)
            assertTrue(after.getValue("events").first < before.getValue("events").first, report)
            assertTrue(after.getValue("payloads").first < before.getValue("payloads").first, report)

            // The fresh runs survive: a sweep that took everything would also
            // pass a "storage fell" assertion, and would be a catastrophe.
            assertEquals(3, countAllRuns(w), "the sweep deleted data inside the window")
        } finally { cleanup(w) }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun exec(sql: String, vararg args: Any?) {
        ds.connection.use { c ->
            c.prepareStatement(sql).use { st ->
                args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
                st.executeUpdate()
            }
        }
    }

    private fun scalarUuid(sql: String, vararg args: Any?): UUID? =
        ds.connection.use { c ->
            c.prepareStatement(sql).use { st ->
                args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
                st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1, UUID::class.java) else null }
            }
        }

    private fun countRuns(w: World, runId: UUID): Int =
        ds.connection.use { c ->
            c.prepareStatement("SELECT count(*) FROM agent_runs WHERE workspace_id=? AND id=?").use { st ->
                st.setObject(1, w.workspaceId); st.setObject(2, runId)
                st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
            }
        }

    private fun countAllRuns(w: World): Int =
        ds.connection.use { c ->
            c.prepareStatement("SELECT count(*) FROM agent_runs WHERE workspace_id=?").use { st ->
                st.setObject(1, w.workspaceId)
                st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
            }
        }

    private fun countEvents(w: World, runId: UUID): Int =
        ds.connection.use { c ->
            c.prepareStatement("SELECT count(*) FROM run_events WHERE workspace_id=? AND run_id=?").use { st ->
                st.setObject(1, w.workspaceId); st.setObject(2, runId)
                st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
            }
        }

    private fun columnsNamed(name: String): Int =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name=?"
            ).use { st -> st.setString(1, name); st.executeQuery().use { rs -> rs.next(); rs.getInt(1) } }
        }

    private fun retentionState(w: World, entity: String): Map<String, Any?>? =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT effective_days, previous_days, grace_until, notified_at
                     FROM workspace_retention_state WHERE workspace_id=? AND entity=?"""
            ).use { st ->
                st.setObject(1, w.workspaceId); st.setString(2, entity)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null else mapOf(
                        "effective_days" to rs.getInt("effective_days"),
                        "previous_days" to (rs.getObject("previous_days") as? Int),
                        "grace_until" to rs.getTimestamp("grace_until"),
                        "notified_at" to rs.getTimestamp("notified_at"),
                    )
                }
            }
        }

    private fun deletionAudit(w: World): List<Map<String, Any?>> =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT entity, policy_days, policy_source, plan_code, cutoff, rows_deleted, export_key
                     FROM retention_deletions WHERE workspace_id=? ORDER BY deleted_at"""
            ).use { st ->
                st.setObject(1, w.workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(mapOf(
                            "entity" to rs.getString("entity"),
                            "policy_days" to rs.getInt("policy_days"),
                            "policy_source" to rs.getString("policy_source"),
                            "plan_code" to rs.getString("plan_code"),
                            "cutoff" to rs.getTimestamp("cutoff"),
                            "rows_deleted" to rs.getLong("rows_deleted"),
                            "export_key" to rs.getString("export_key"),
                        ))
                    }
                }
            }
        }

    private fun sweepStatuses(): Set<String> =
        ds.connection.use { c ->
            c.prepareStatement("SELECT DISTINCT status FROM retention_sweeps").use { st ->
                st.executeQuery().use { rs -> buildSet { while (rs.next()) add(rs.getString(1)) } }
            }
        }

    private fun storage(w: World): Map<String, Pair<Long, Long>> =
        ds.connection.use { c ->
            c.prepareStatement("SELECT entity, rows, bytes FROM workspace_storage_bytes(?)").use { st ->
                st.setObject(1, w.workspaceId)
                st.executeQuery().use { rs ->
                    buildMap {
                        while (rs.next()) {
                            put(rs.getString("entity"), rs.getLong("rows") to rs.getLong("bytes"))
                        }
                    }
                }
            }
        }
}
