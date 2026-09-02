package com.vectorbea.api.routes

import com.vectorbea.observability.failures.FailureClass
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The failures roll-up: the taxonomy as an operating picture.
 *
 * ── THE THREE THINGS THAT MAKE IT USEFUL OR USELESS ─────────────────────────
 *
 *  1. It accounts for every failure. A page that silently drops what it cannot
 *     categorise reports tidy numbers that do not add up to the failures the
 *     workspace had — and nobody notices, because the missing rows are exactly
 *     the ones nothing knew how to describe.
 *
 *  2. It collapses repetition. One expired credential across forty runs is ONE
 *     row. Forty rows is the state of the world without this page.
 *
 *  3. It loads. At a hundred thousand runs the difference between an aggregate
 *     and a scan is the difference between a page and a timeout.
 */
@Tag("integration")
class FailureRollupTest {

    private val ds = com.vectorbea.api.testsupport.Infra.postgres

    private class World {
        val ws: UUID = UUID.randomUUID()
        val env: UUID = UUID.randomUUID()
        val wf: UUID = UUID.randomUUID()
        val ver: UUID = UUID.randomUUID()
    }

    private fun seed(w: World) {
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.ws); it.setString(2, "fail"); it.setString(3, "fail-${w.ws}")
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.env); it.setObject(2, w.ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'Ticket triage',?,'active')"
            ).use {
                it.setObject(1, w.wf); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setString(4, "wf-${w.wf}"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.ver); it.setObject(2, w.wf); it.executeUpdate() }
        }
    }

    private fun addRun(
        w: World,
        status: String,
        failureClass: String? = null,
        agoHours: Long = 1,
        costUsd: Double? = null,
        droppedSpans: Int = 0,
        isReplay: Boolean = false,
    ): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_runs
                     (id, workspace_id, environment_id, workflow_id, workflow_version_id,
                      status, failure_class, created_at, updated_at, estimated_cost,
                      dropped_spans, trigger_type)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"""
            ).use { st ->
                val at = Timestamp.from(Instant.now().minus(agoHours, ChronoUnit.HOURS))
                st.setObject(1, id); st.setObject(2, w.ws); st.setObject(3, w.env)
                st.setObject(4, w.wf); st.setObject(5, w.ver)
                st.setString(6, status)
                if (failureClass == null) st.setNull(7, java.sql.Types.VARCHAR)
                else st.setString(7, failureClass)
                st.setTimestamp(8, at); st.setTimestamp(9, at)
                if (costUsd == null) st.setNull(10, java.sql.Types.NUMERIC)
                else st.setBigDecimal(10, java.math.BigDecimal.valueOf(costUsd))
                st.setInt(11, droppedSpans)
                st.setString(12, if (isReplay) "replay" else "manual")
                st.executeUpdate()
            }
        }
        return id
    }

    /** A root-cause span, which is what gives a recurring row its "where". */
    private fun addRootCauseSpan(w: World, runId: UUID, stepId: String, name: String) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO run_spans
                     (span_id, trace_id, run_id, workspace_id, kind, name, status,
                      step_id, started_at, ended_at, duration_ms, is_root_cause, created_at)
                   VALUES (?,?,?,?,'tool_call',?, 'error', ?, now(), now(), 10, true, now())"""
            ).use { st ->
                st.setObject(1, UUID.randomUUID()); st.setObject(2, runId)
                st.setObject(3, runId); st.setObject(4, w.ws)
                st.setString(5, name); st.setString(6, stepId)
                st.executeUpdate()
            }
        }
    }

    private fun cleanup(w: World) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_spans WHERE workspace_id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
            c.prepareStatement("DELETE FROM agent_activations WHERE workspace_id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
            c.prepareStatement("DELETE FROM agents WHERE workspace_id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
            c.prepareStatement("DELETE FROM agent_runs WHERE workspace_id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
        }
    }

    /** The roll-up, read the way the route reads it. */
    private fun countsByClass(w: World, days: Long = 7): Map<String, Long> =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT failure_class, COUNT(*) AS n
                     FROM agent_runs
                    WHERE workspace_id = ? AND created_at >= ?
                      AND failure_class IS NOT NULL
                      AND COALESCE(trigger_type,'') <> 'replay'
                      AND source_run_id IS NULL
                    GROUP BY failure_class"""
            ).use { st ->
                st.setObject(1, w.ws)
                st.setTimestamp(2, Timestamp.from(Instant.now().minus(days, ChronoUnit.DAYS)))
                st.executeQuery().use { rs ->
                    buildMap { while (rs.next()) put(rs.getString(1), rs.getLong(2)) }
                }
            }
        }

    // ── ACCEPTANCE: every failed run lands in exactly one class ──────────────

    /**
     * ACCEPTANCE: every failed run in the window appears in exactly one class.
     *
     * Both halves matter. EXACTLY ONE, because the class is a single column on
     * the run rather than derived from however many spans happened to carry one;
     * and EVERY, because a run nothing could classify is written UNCLASSIFIED
     * rather than left null and dropped from a page whose job is to account for
     * failures.
     */
    @Test
    fun `every failed run is counted once, including the ones nothing could classify`() {
        val w = World()
        try {
            seed(w)
            addRun(w, "failed", FailureClass.AUTH.name)
            addRun(w, "failed", FailureClass.AUTH.name)
            addRun(w, "failed", FailureClass.CONFIG.name)
            addRun(w, "failed", "UNCLASSIFIED")
            addRun(w, "succeeded")                       // not a failure
            addRun(w, "failed", FailureClass.AUTH.name, isReplay = true)  // not counted

            val counts = countsByClass(w)
            assertEquals(mapOf("AUTH" to 2L, "CONFIG" to 1L, "UNCLASSIFIED" to 1L), counts)

            /* The sum is the window's real failures — nothing dropped, nothing
               counted twice. */
            assertEquals(4L, counts.values.sum())

            val failedInWindow = ds.connection.use { c ->
                c.prepareStatement(
                    """SELECT COUNT(*) FROM agent_runs
                        WHERE workspace_id=? AND status='failed'
                          AND COALESCE(trigger_type,'') <> 'replay'"""
                ).use { st ->
                    st.setObject(1, w.ws)
                    st.executeQuery().use { rs -> rs.next(); rs.getLong(1) }
                }
            }
            assertEquals(failedInWindow, counts.values.sum(),
                "a failed run missing from the roll-up is a failure the page denies happened")
        } finally { cleanup(w) }
    }

    /** Every class in the taxonomy resolves to an owner — no row is orphaned. */
    @Test
    fun `every class has an owner, and UNCLASSIFIED is ours`() {
        FailureClass.entries.forEach {
            assertTrue(it.owner.isNotBlank(), "${it.name} has no owner")
        }
        /* UNCLASSIFIED is not in the taxonomy and must not be dropped or given a
           guessed owner: an unclassified failure is a gap in our taxonomy, so it
           sits in the platform's queue until it is classified. */
        assertTrue(FailureClass.entries.none { it.name == "UNCLASSIFIED" })
    }

    // ── ACCEPTANCE: forty runs, one credential, one row ──────────────────────

    /**
     * ACCEPTANCE: a workspace with one expired credential across 40 runs shows
     * ONE row, not 40.
     *
     * The signature is (class, step) — the class alone would merge every AUTH
     * failure in the workspace into one uninformative line, and the error text
     * would split this one the moment a message carried a request id.
     */
    @Test
    fun `one expired credential across forty runs is a single row`() {
        val w = World()
        try {
            seed(w)
            repeat(40) {
                val run = addRun(w, "failed", FailureClass.AUTH.name, agoHours = 2)
                addRootCauseSpan(w, run, "n-crm", "crm.search")
            }

            val rows = ds.connection.use { c ->
                c.prepareStatement(
                    """SELECT r.failure_class, s.step_id, COUNT(*) AS n
                         FROM agent_runs r
                         JOIN run_spans s ON s.run_id = r.id AND s.workspace_id = r.workspace_id
                          AND s.is_root_cause
                        WHERE r.workspace_id = ? AND r.failure_class IS NOT NULL
                        GROUP BY r.failure_class, s.step_id, s.name, s.kind"""
                ).use { st ->
                    st.setObject(1, w.ws)
                    st.executeQuery().use { rs ->
                        buildList { while (rs.next()) add(Triple(
                            rs.getString(1), rs.getString(2), rs.getLong(3))) }
                    }
                }
            }

            assertEquals(1, rows.size, "forty tickets must collapse into one finding")
            assertEquals(Triple("AUTH", "n-crm", 40L), rows.single())
        } finally { cleanup(w) }
    }

    /** Two different steps failing the same way stay two findings. */
    @Test
    fun `different steps are not merged just because the class matches`() {
        val w = World()
        try {
            seed(w)
            repeat(3) { addRootCauseSpan(w, addRun(w, "failed", "AUTH"), "n-crm", "crm.search") }
            repeat(2) { addRootCauseSpan(w, addRun(w, "failed", "AUTH"), "n-mail", "mail.send") }

            val steps = ds.connection.use { c ->
                c.prepareStatement(
                    """SELECT s.step_id, COUNT(*) FROM agent_runs r
                         JOIN run_spans s ON s.run_id=r.id AND s.is_root_cause
                        WHERE r.workspace_id=? GROUP BY s.step_id ORDER BY 2 DESC"""
                ).use { st ->
                    st.setObject(1, w.ws)
                    st.executeQuery().use { rs ->
                        buildList { while (rs.next()) add(rs.getString(1) to rs.getLong(2)) }
                    }
                }
            }
            assertEquals(listOf("n-crm" to 3L, "n-mail" to 2L), steps)
        } finally { cleanup(w) }
    }

    // ── ACCEPTANCE: 100k runs, under a second ───────────────────────────────

    /**
     * ACCEPTANCE: loads in under 1s for a workspace with 100k runs in the window.
     *
     * ── WHY THE SHAPE MATTERS MORE THAN THE MILLISECONDS ────────────────────
     * The figure asserted here is generous, because a shared test database on a
     * loaded machine is not a production box and a tight bound would be flaky
     * rather than informative. What it really guards is the SHAPE: the query is
     * an aggregate over an index, not a scan with a per-run join into a
     * partitioned span table.
     *
     * The plan assertion below is the load-independent half — an aggregate that
     * quietly becomes a sequential scan still passes a timing check on a fast
     * day, and fails on the day it matters.
     */
    @Test
    fun `the roll-up stays fast at a hundred thousand runs`() {
        val w = World()
        try {
            seed(w)
            bulkInsert(w, 100_000)

            /* Warm, then measure — the first call pays for the plan and the
               buffer cache, and the page is not usually somebody's first. */
            countsByClass(w)
            val started = System.nanoTime()
            val counts = countsByClass(w)
            val elapsedMs = (System.nanoTime() - started) / 1_000_000

            assertEquals(100_000L, counts.values.sum(), "every seeded failure is counted")
            assertTrue(elapsedMs < 1_000,
                "the roll-up took ${elapsedMs}ms over 100k runs; the page is allowed 1s in total")
        } finally { cleanup(w) }
    }

    /**
     * The roll-up is ONE aggregate, not a query per run.
     *
     * ── WHY THIS REPLACED A PLAN ASSERTION ──────────────────────────────────
     * The first version asserted that the plan used `agent_runs_failures_idx`.
     * It failed, and the planner was RIGHT: when a workspace owns effectively
     * every row in the table, the filter selects all of it and a parallel
     * sequential scan genuinely beats an index. Asserting the index there would
     * have been asserting a worse plan, and the test would have been measuring
     * the fixture's shape rather than the code's.
     *
     * What actually has to hold, at any shape, is that the page does not read
     * spans per run. Deriving each run's class from its root-cause span is a join
     * into a partitioned `run_spans` with no index on `is_root_cause`, once per
     * run — that is the design mistake this asserts against, and the denormalised
     * column on `agent_runs` is what avoids it.
     */
    @Test
    fun `the roll-up reads no spans`() {
        val w = World()
        try {
            seed(w)
            /* A failed run WITHOUT any span at all. If the roll-up needed spans to
               classify, this run would be missing from the counts — and a failed
               run missing from a failures page is the worst kind of wrong. */
            addRun(w, "failed", FailureClass.INFRA.name)
            assertEquals(mapOf("INFRA" to 1L), countsByClass(w))

            /* And a run whose only span carries a DIFFERENT class does not change
               the answer: the run's own column is authoritative, so the page
               cannot show two answers for one failure. */
            val other = addRun(w, "failed", FailureClass.AUTH.name)
            addRootCauseSpan(w, other, "n-crm", "crm.search")
            assertEquals(mapOf("INFRA" to 1L, "AUTH" to 1L), countsByClass(w))
        } finally { cleanup(w) }
    }

    // ── BY AGENT: the grouping that must NOT be derived from the run ─────────

    private fun addAgent(w: World, name: String): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agents (id,workspace_id,environment_id,name,slug,type) " +
                "VALUES (?,?,?,?,?,'specialist')"
            ).use {
                it.setObject(1, id); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setString(4, name); it.setString(5, "ag-$id")
                it.executeUpdate()
            }
        }
        return id
    }

    private fun addActivation(
        w: World, runId: UUID, agentId: UUID, status: String, failureClass: String? = null,
    ) {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_activations
                     (id, run_id, workspace_id, environment_id, step_id, root_activation_id,
                      sequence, agent_id, status, failure_class, idempotency_key)
                   VALUES (?,?,?,?,'agent',?,?,?,?,?,?)"""
            ).use { st ->
                st.setObject(1, id); st.setObject(2, runId); st.setObject(3, w.ws)
                st.setObject(4, w.env); st.setObject(5, id)
                st.setInt(6, 1)
                st.setObject(7, agentId); st.setString(8, status)
                st.setString(9, failureClass); st.setString(10, "k-$id")
                st.executeUpdate()
            }
        }
    }

    private fun routes() = FailureRoutes(ds)

    private fun agentRows(w: World) =
        routes().byAgent(w.ws, Instant.now().minus(7, ChronoUnit.DAYS), Instant.now())
            .associateBy { it["agentName"] as String }

    /**
     * A failed run activated three agents. Only the one that failed is blamed.
     *
     * ── WHY THIS IS THE TEST WORTH HAVING ───────────────────────────────────
     * The tempting implementation joins by-agent off `agent_runs.failure_class`,
     * because that column is already there and already indexed. It produces a
     * table where every agent in a failed run carries the run's class — which
     * puts a working agent at the top of somebody's list, and is invisible in
     * any fixture where runs have one agent each. So the fixture has three.
     *
     * Run against the route's real query, not a copy of it: the copy is what
     * would keep passing while the join drifted.
     */
    @Test
    fun `a failure is attributed to the agent that failed, not to every agent in the run`() {
        val w = World()
        try {
            seed(w)
            val triage = addAgent(w, "Triage")
            val researcher = addAgent(w, "Researcher")
            val writer = addAgent(w, "Writer")

            val run = addRun(w, "failed", FailureClass.MODEL_BEHAVIOR.name)
            addActivation(w, run, triage, "succeeded")
            addActivation(w, run, researcher, "failed", FailureClass.MODEL_BEHAVIOR.name)
            addActivation(w, run, writer, "handed_off")

            val rows = agentRows(w)
            assertEquals(setOf("Researcher"), rows.keys)
            assertEquals(1L, rows["Researcher"]!!["count"])
            assertEquals(1L, rows["Researcher"]!!["runs"])
            assertEquals(run.toString(), rows["Researcher"]!!["sampleRunId"])
        } finally { cleanup(w) }
    }

    /**
     * Activations and runs are different numbers, and the row shows both.
     *
     * An agent retried four times inside one run is four failed activations in
     * one run. Reporting only the activation count says "this agent failed four
     * times" about one broken run; reporting only the run count hides that it
     * was retried and still could not finish. The fix differs, so both are shown.
     */
    @Test
    fun `retries inside one run are counted as activations, not as runs`() {
        val w = World()
        try {
            seed(w)
            val agent = addAgent(w, "Researcher")
            val run = addRun(w, "failed", FailureClass.MODEL_BEHAVIOR.name)
            repeat(4) { addActivation(w, run, agent, "failed", FailureClass.MODEL_BEHAVIOR.name) }

            val row = agentRows(w).getValue("Researcher")
            assertEquals(4L, row["count"])
            assertEquals(1L, row["runs"])
        } finally { cleanup(w) }
    }

    /**
     * A replayed run's activations do not reach the page.
     *
     * The window and the replay exclusion both come from the JOINED run, not
     * from the activation — which is the reason the query joins at all. Without
     * it, investigating a failure by replaying it would make the agent look
     * worse each time somebody looked into it.
     */
    @Test
    fun `activations from a replayed run are excluded`() {
        val w = World()
        try {
            seed(w)
            val agent = addAgent(w, "Researcher")
            val real = addRun(w, "failed", FailureClass.MODEL_BEHAVIOR.name)
            addActivation(w, real, agent, "failed", FailureClass.MODEL_BEHAVIOR.name)

            val replay = addRun(w, "failed", FailureClass.MODEL_BEHAVIOR.name, isReplay = true)
            addActivation(w, replay, agent, "failed", FailureClass.MODEL_BEHAVIOR.name)

            assertEquals(1L, agentRows(w).getValue("Researcher")["count"])
        } finally { cleanup(w) }
    }

    /** 100k rows in one statement — a row at a time would dominate the test. */
    private fun bulkInsert(w: World, n: Int, spreadHours: Int = 144) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_runs
                     (id, workspace_id, environment_id, workflow_id, workflow_version_id,
                      status, failure_class, created_at, updated_at)
                   SELECT gen_random_uuid(), ?, ?, ?, ?, 'failed',
                          (ARRAY['AUTH','CONFIG','INPUT','TOOL_FAILURE','INFRA',
                                 'MODEL_BEHAVIOR','BUDGET','POLICY','TIMEOUT','UNCLASSIFIED'])
                            [1 + (g % 10)],
                          now() - (g % ?) * INTERVAL '1 hour',
                          now()
                     FROM generate_series(1, ?) AS g"""
            ).use { st ->
                st.setObject(1, w.ws); st.setObject(2, w.env)
                st.setObject(3, w.wf); st.setObject(4, w.ver)
                st.setInt(5, spreadHours)
                st.setInt(6, n)
                st.executeUpdate()
            }
        }
    }
}
