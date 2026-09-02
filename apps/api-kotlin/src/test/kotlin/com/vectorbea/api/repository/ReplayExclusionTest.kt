package com.vectorbea.api.repository

import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A replay is not a run the workspace's numbers are about.
 *
 * ── WHY THIS NEEDS A TEST AND NOT JUST A PREDICATE ──────────────────────────
 * `NOT_A_REPLAY` is a string constant pasted into five of seven CTEs. Nothing
 * stops a sixth aggregate being added without it, and the failure is invisible:
 * the dashboard simply reads slightly wrong, in a direction nobody questions,
 * because a replay of a failed run usually succeeds and quietly improves the
 * success rate.
 *
 * The specific harm is that debugging changes the numbers. Somebody investigates
 * an incident by replaying the failed run four times, and the workspace's success
 * rate goes UP — so the more carefully a failure is investigated, the healthier
 * the system appears.
 */
@Tag("integration")
class ReplayExclusionTest {

    private val ds = com.vectorbea.api.testsupport.Infra.postgres
    private val repo = DashboardRepository(ds)

    private class World {
        val ws: UUID = UUID.randomUUID()
        val env: UUID = UUID.randomUUID()
        val wf: UUID = UUID.randomUUID()
        val ver: UUID = UUID.randomUUID()
    }

    private fun seed(w: World) {
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.ws); it.setString(2, "replay"); it.setString(3, "replay-${w.ws}")
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.env); it.setObject(2, w.ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.wf); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setString(4, "wf-${w.wf}"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.ver); it.setObject(2, w.wf); it.executeUpdate() }
        }
    }

    /**
     * @param sourceRunId non-null makes this a replay OF that run.
     * @param triggerType "replay" is the other way a run is marked one.
     */
    private fun addRun(
        w: World,
        status: String,
        sourceRunId: UUID? = null,
        triggerType: String = "manual",
    ): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_runs
                     (id, workspace_id, environment_id, workflow_id, workflow_version_id,
                      status, trigger_type, source_run_id, updated_at, completed_at)
                   VALUES (?,?,?,?,?,?,?,?, now(), now())"""
            ).use { st ->
                st.setObject(1, id); st.setObject(2, w.ws); st.setObject(3, w.env)
                st.setObject(4, w.wf); st.setObject(5, w.ver)
                st.setString(6, status); st.setString(7, triggerType)
                if (sourceRunId == null) st.setNull(8, java.sql.Types.OTHER)
                else st.setObject(8, sourceRunId)
                st.executeUpdate()
            }
        }
        return id
    }

    private fun cleanup(w: World) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM agent_runs WHERE workspace_id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
        }
    }

    /**
     * ACCEPTANCE: a replayed run does not appear in the workspace success rate.
     *
     * One real failure and one successful replay OF it. The rate must read 0%,
     * not 50% — otherwise investigating a failure improves the number that says
     * how healthy the workspace is.
     */
    @Test
    fun `a successful replay does not improve the success rate`() {
        val w = World()
        try {
            seed(w)
            val failed = addRun(w, "failed")
            addRun(w, "succeeded", sourceRunId = failed)   // the replay that worked

            val s = repo.getSummary(w.ws, w.env)

            assertEquals(1, s.failedLast24h, "the real failure counts")
            assertEquals(0, s.succeededLast24h,
                "the replay must not count as a success — otherwise debugging a " +
                "failure raises the workspace's success rate")

            val completed = s.succeededLast24h + s.failedLast24h
            assertEquals(0, (s.succeededLast24h * 100) / completed,
                "the rate reads 0%, not 50%")
        } finally { cleanup(w) }
    }

    /** `trigger_type = 'replay'` marks one too, even with no source run. */
    @Test
    fun `a run triggered as a replay is excluded`() {
        val w = World()
        try {
            seed(w)
            addRun(w, "succeeded", triggerType = "replay")
            assertEquals(0, repo.getSummary(w.ws, w.env).succeededLast24h)
        } finally { cleanup(w) }
    }

    /** Ordinary runs are still counted — the predicate must not exclude everything. */
    @Test
    fun `real runs are still counted`() {
        val w = World()
        try {
            seed(w)
            addRun(w, "succeeded")
            addRun(w, "succeeded")
            addRun(w, "failed")

            val s = repo.getSummary(w.ws, w.env)
            assertEquals(2, s.succeededLast24h)
            assertEquals(1, s.failedLast24h)
        } finally { cleanup(w) }
    }

    /**
     * A replay in flight does not inflate "running now" either.
     *
     * The tile answers "is the fleet busy with real work", and four replays of one
     * incident are not four customers waiting.
     */
    @Test
    fun `a running replay is not counted as work in flight`() {
        val w = World()
        try {
            seed(w)
            val failed = addRun(w, "failed")
            addRun(w, "running", sourceRunId = failed)
            addRun(w, "running")

            assertEquals(1, repo.getSummary(w.ws, w.env).runningNow,
                "only the real run is in flight")
        } finally { cleanup(w) }
    }

    /**
     * And a replay's spend is not billed to the workspace's usage.
     *
     * Replays are for debugging; charging them to the same number that answers
     * "what did we spend this month" makes an incident look like growth.
     */
    @Test
    fun `a replay's cost is not in the workspace usage`() {
        val w = World()
        try {
            seed(w)
            val failed = addRun(w, "failed")
            val replay = addRun(w, "succeeded", sourceRunId = failed)
            ds.connection.use { c ->
                c.prepareStatement(
                    "UPDATE agent_runs SET token_count = 5000, estimated_cost = 1.25 WHERE id = ?"
                ).use { it.setObject(1, replay); it.executeUpdate() }
            }

            val s = repo.getSummary(w.ws, w.env)
            assertEquals(0L, s.tokensLast24h)
            assertTrue(s.estimatedCostLast24h == 0.0,
                "a replay is not billed: got ${s.estimatedCostLast24h}")
        } finally { cleanup(w) }
    }
}
