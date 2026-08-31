package com.vectorbea.api.repository

import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import org.junit.jupiter.api.Tag

/**
 * A replay is a debugging tool, not production traffic.
 *
 * ── THE BUG THIS PINS ───────────────────────────────────────────────────────
 * Every aggregate on the dashboard counted `agent_runs` by status with no
 * regard for how the run was triggered. So replaying a failed run five times
 * while hunting the bug pushed the workspace's failure count up by five — the
 * success rate fell because an engineer investigated, which corrupts the exact
 * number the debugger exists to defend. The token and cost tiles moved too, and
 * those are what a customer is billed against.
 *
 * Skips when no database is reachable.
 */
@Tag("integration")
class ReplayNotCountedTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    /**
     * The database, or a thrown exception naming what is missing.
     *
     * This used to probe a hard-coded localhost port and return null, which
     * turned every test in this class into a silent pass on any machine
     * without it. See [Infra].
     */
    private fun dataSourceOrNull(): DataSource? = com.vectorbea.api.testsupport.Infra.postgres

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
    )

    private fun seed(ds: DataSource): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "replay-metrics")
                it.setString(3, "replay-metrics-" + w.workspaceId); it.executeUpdate()
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
        }
        return w
    }

    /** One run. [replayMarker] picks which of the three markers to set, or none. */
    private fun run(
        ds: DataSource, w: World, status: String,
        replayMarker: String? = null,
        tokens: Int = 100,
    ): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                " workflow_version_id,status,trigger_type,execution_mode_kind,source_run_id," +
                " token_count,estimated_cost,started_at,updated_at) " +
                "VALUES (?,?,?,?,?,?,?,?,?,?,0.5, now(), now())"
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId)
                it.setString(6, status)
                it.setString(7, if (replayMarker == "trigger_type") "replay" else "manual")
                it.setString(8, if (replayMarker == "execution_mode_kind") "replay" else "live")
                it.setObject(9, if (replayMarker == "source_run_id") UUID.randomUUID() else null)
                it.setInt(10, tokens)
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

    private fun stats(ds: DataSource, w: World) =
        DashboardRepository(ds).getSummary(w.workspaceId, null)

    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a replayed run does not move the workspace success rate`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            run(ds, w, "succeeded")
            run(ds, w, "failed")
            val before = stats(ds, w)
            assertEquals(1, before.succeededLast24h)
            assertEquals(1, before.failedLast24h)

            /*
             * Five replays of the failed run, which is what actually happens when
             * somebody is hunting a bug. Counted as production, this alone would
             * take the workspace from 50% to 1 success in 7.
             */
            repeat(5) { run(ds, w, "failed", replayMarker = "trigger_type") }

            val after = stats(ds, w)
            assertEquals(before.succeededLast24h, after.succeededLast24h)
            assertEquals(before.failedLast24h, after.failedLast24h,
                "replays were counted as production failures — the success rate now " +
                "falls because an engineer investigated")
            assertEquals(before.recentRunsTotal, after.recentRunsTotal)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `all three replay markers are honoured, not just one`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            run(ds, w, "succeeded")
            val before = stats(ds, w)

            /*
             * The three markers are written by DIFFERENT code paths, so checking
             * only one would let a replay that set the other two slip through and
             * be counted. Any one of them means "not production".
             */
            run(ds, w, "succeeded", replayMarker = "trigger_type")
            run(ds, w, "succeeded", replayMarker = "execution_mode_kind")
            run(ds, w, "succeeded", replayMarker = "source_run_id")

            assertEquals(before.succeededLast24h, stats(ds, w).succeededLast24h)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a replay is not billed as production usage`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            run(ds, w, "succeeded", tokens = 1_000)
            val before = stats(ds, w)
            assertEquals(1_000L, before.tokensLast24h)

            /* Replays burn real tokens at the provider, but the workspace's usage
               tile is what a customer is billed against — and they did not order
               five re-runs of a failed job. */
            repeat(5) { run(ds, w, "succeeded", replayMarker = "trigger_type", tokens = 1_000) }

            assertEquals(before.tokensLast24h, stats(ds, w).tokensLast24h)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `an ordinary run is still counted`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            /* The other half of the assertion: an exclusion that excluded
               everything would pass every test above and report zero for a busy
               workspace. */
            run(ds, w, "succeeded")
            run(ds, w, "succeeded")
            run(ds, w, "failed")
            val s = stats(ds, w)
            assertEquals(2, s.succeededLast24h)
            assertEquals(1, s.failedLast24h)
            assertEquals(3, s.recentRunsTotal)
        } finally { cleanup(ds!!, w) }
    }
}
