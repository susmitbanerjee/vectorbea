package com.vectorbea.api.routes

import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The inspector's data.
 *
 * ── THE THREE FACTS THAT DID NOT EXIST BEFORE THIS ──────────────────────────
 * Each one distinguishes "the agent did this" from "the runtime did this on the
 * agent's behalf", and each is wrong in a specific, expensive way when missing:
 *
 *   repaired  An unparseable response becomes a THINK so the loop continues.
 *             Unmarked, the trace shows deliberation and the reader debugs the
 *             prompt when the problem is the response format.
 *   cached    The guard replays an earlier identical call. Unmarked, the reader
 *             believes the tool ran now and blames the external system for
 *             stale data.
 *   recalled  Resume restores iterations from the transcript. Unmarked, seeing
 *             iteration 3 twice is inexplicable.
 *
 * All three are nullable, and null is NOT false: an older worker's rows must not
 * claim the model chose to think.
 */
@Tag("integration")
class IterationReaderTest {

    private val ds = com.vectorbea.api.testsupport.Infra.postgres
    private val reader = IterationReader(ds)

    private class World {
        val ws: UUID = UUID.randomUUID()
        val env: UUID = UUID.randomUUID()
        val run: UUID = UUID.randomUUID()
        val wf: UUID = UUID.randomUUID()
        val ver: UUID = UUID.randomUUID()
        val agent: UUID = UUID.randomUUID()
        val step = "n-agent-1"
    }

    private fun seed(w: World) {
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.ws); it.setString(2, "iter"); it.setString(3, "iter-${w.ws}")
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.env); it.setObject(2, w.ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.wf); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setString(4, "wf-${w.wf}"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.ver); it.setObject(2, w.wf); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'succeeded')"
            ).use {
                it.setObject(1, w.run); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setObject(4, w.wf); it.setObject(5, w.ver); it.executeUpdate()
            }
        }
    }

    private fun addIteration(
        w: World, n: Int,
        actionType: String = "CALL_TOOL",
        status: String = "completed",
        repaired: Boolean? = null,
        cached: Boolean? = null,
        observation: String? = "ok",
        actionJson: String? = """{"type":"CALL_TOOL","toolId":"crm.search","toolInput":{"id":"A-8891"}}""",
        atMs: Long = 0,
    ) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_iterations
                     (id, workspace_id, environment_id, run_id, step_id, agent_id,
                      iteration_number, status, action_type, observation_summary_sanitized,
                      started_at, completed_at, action_json_sanitized,
                      action_repaired, tool_result_cached, tokens_delta, cost_delta_cents)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?)"""
            ).use { st ->
                val start = Instant.parse("2026-08-31T10:00:00Z").plusMillis(atMs)
                st.setObject(1, UUID.randomUUID())
                st.setObject(2, w.ws); st.setObject(3, w.env); st.setObject(4, w.run)
                st.setString(5, w.step); st.setObject(6, w.agent)
                st.setInt(7, n); st.setString(8, status); st.setString(9, actionType)
                st.setString(10, observation)
                st.setTimestamp(11, java.sql.Timestamp.from(start))
                st.setTimestamp(12, java.sql.Timestamp.from(start.plusMillis(1_200)))
                st.setString(13, actionJson)
                if (repaired == null) st.setNull(14, java.sql.Types.BOOLEAN) else st.setBoolean(14, repaired)
                if (cached == null) st.setNull(15, java.sql.Types.BOOLEAN) else st.setBoolean(15, cached)
                st.setInt(16, 480)
                st.setBigDecimal(17, java.math.BigDecimal("1.25"))
                st.executeUpdate()
            }
        }
    }

    /** An iteration span plus the model call beneath it, the way the tracer writes them. */
    private fun addSpans(w: World, n: Int, contextAttrs: String?) {
        val iterSpan = UUID.randomUUID()
        val llmSpan = UUID.randomUUID()
        ds.connection.use { c ->
            val sql = """INSERT INTO run_spans
                (span_id, trace_id, run_id, parent_span_id, workspace_id, kind, name, status,
                 step_id, iteration_index, started_at, ended_at, duration_ms, self_ms,
                 attributes_json, input_ref, output_ref, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?)"""
            val t0 = Instant.parse("2026-08-31T10:00:00Z")
            c.prepareStatement(sql).use { st ->
                st.setObject(1, iterSpan); st.setObject(2, w.run); st.setObject(3, w.run)
                st.setObject(4, null as UUID?); st.setObject(5, w.ws)
                st.setString(6, "iteration"); st.setString(7, "iteration $n"); st.setString(8, "ok")
                st.setString(9, w.step); st.setInt(10, n)
                st.setTimestamp(11, java.sql.Timestamp.from(t0))
                st.setTimestamp(12, java.sql.Timestamp.from(t0.plusMillis(1_200)))
                st.setInt(13, 1_200); st.setInt(14, 200)
                st.setString(15, contextAttrs ?: "{}")
                st.setString(16, null); st.setString(17, null)
                st.setTimestamp(18, java.sql.Timestamp.from(t0))
                st.executeUpdate()
            }
            c.prepareStatement(sql).use { st ->
                st.setObject(1, llmSpan); st.setObject(2, w.run); st.setObject(3, w.run)
                st.setObject(4, iterSpan); st.setObject(5, w.ws)
                st.setString(6, "llm_call"); st.setString(7, "gpt-4o-mini"); st.setString(8, "ok")
                st.setString(9, w.step); st.setObject(10, null as Int?)
                st.setTimestamp(11, java.sql.Timestamp.from(t0))
                st.setTimestamp(12, java.sql.Timestamp.from(t0.plusMillis(900)))
                st.setInt(13, 900); st.setInt(14, 900)
                st.setString(15, "{}")
                st.setString(16, "ref-in-$n"); st.setString(17, "ref-out-$n")
                st.setTimestamp(18, java.sql.Timestamp.from(t0))
                st.executeUpdate()
            }
        }
    }

    private fun cleanup(w: World) = runCatching {
        ds.connection.use { c ->
            listOf("agent_iterations", "run_spans", "run_events", "agent_activations").forEach { t ->
                c.prepareStatement("DELETE FROM $t WHERE run_id=?").use {
                    it.setObject(1, w.run); it.executeUpdate()
                }
            }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
        }
    }

    // ── ACCEPTANCE: 40 iterations, no payload content ───────────────────────

    /**
     * ACCEPTANCE: a 40-iteration activation renders without loading any payload.
     *
     * The reader returns payload REFS and sizes, never values. Asserted on the
     * shape rather than on a byte count, because the guarantee is structural:
     * there is no field on this response that content could arrive in.
     */
    @Test
    fun `a forty-iteration activation carries no payload content`() {
        val w = World()
        try {
            seed(w)
            repeat(40) { i -> addIteration(w, i + 1, atMs = i * 1_500L); addSpans(w, i + 1, null) }

            val a = reader.activations(w.run, w.ws).single()
            assertEquals(40, a.iterations.size)

            /* Every iteration knows its model call exists and how big it was —
               and holds none of it. */
            a.iterations.forEach {
                val llm = assertNotNull(it.llmCall, "iteration ${it.number} lost its model call")
                assertTrue(llm.hasInput && llm.hasOutput)
            }
            assertEquals(40, a.iterations.count { it.llmCall != null })
        } finally { cleanup(w) }
    }

    // ── ACCEPTANCE: truncation names its sections ───────────────────────────

    /**
     * ACCEPTANCE: a truncated-context iteration shows the warning AND the
     * sections that were dropped.
     *
     * The section names are the whole diagnostic value. "Context was truncated"
     * says something is missing; "dropped: memory, older observations" says
     * WHICH, and an agent that "ignored" an instruction it was never shown is
     * the hardest agent failure to diagnose.
     */
    @Test
    fun `a truncated iteration names the sections that were dropped`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 1)
            addSpans(w, 1, """{"context_truncated":true,""" +
                """"context_dropped_sections":["memory","older observations","tool catalogue"],""" +
                """"context_chars":12400,"context_char_budget":12000}""")

            val it = reader.activations(w.run, w.ws).single().iterations.single()
            val ctx = assertNotNull(it.context, "the truncation must reach the inspector")
            assertTrue(ctx.truncated)
            assertEquals(listOf("memory", "older observations", "tool catalogue"), ctx.droppedSections)
            assertEquals(12_400, ctx.charsUsed)
            assertEquals(12_000, ctx.charBudget)
        } finally { cleanup(w) }
    }

    /** An untruncated iteration carries no context note at all, not an empty one. */
    @Test
    fun `an untruncated iteration has nothing to say about context`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 1)
            addSpans(w, 1, """{"context_truncated":false,"context_chars":900,"context_char_budget":12000}""")
            assertNull(reader.activations(w.run, w.ws).single().iterations.single().context)
        } finally { cleanup(w) }
    }

    // ── ACCEPTANCE: cached is distinguishable from executed ─────────────────

    /**
     * ACCEPTANCE: a cached tool result is visibly distinguished from an executed
     * one — and BOTH are distinguishable from "we do not know".
     *
     * Three states, not two. A row written before the column existed is null,
     * and rendering that as "executed" would tell the reader the tool ran when
     * nothing recorded whether it did.
     */
    @Test
    fun `cached, executed and unknown tool results are three different answers`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 1, cached = false, atMs = 0)
            addIteration(w, 2, cached = true, atMs = 2_000)
            addIteration(w, 3, cached = null, atMs = 4_000)

            val its = reader.activations(w.run, w.ws).single().iterations
            assertEquals(false, its[0].toolResultCached, "executed")
            assertEquals(true, its[1].toolResultCached, "replayed from the guard")
            assertNull(its[2].toolResultCached, "predates the column — not the same as executed")
        } finally { cleanup(w) }
    }

    /** The same three-way distinction for a repaired action. */
    @Test
    fun `a repaired action is distinguishable from a chosen THINK`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 1, actionType = "THINK", repaired = false, atMs = 0,
                actionJson = """{"type":"THINK","reasoningSummary":"I should look this up"}""")
            addIteration(w, 2, actionType = "THINK", repaired = true, atMs = 2_000,
                actionJson = """{"type":"THINK","reasoningSummary":"Failed to parse action response"}""")

            val its = reader.activations(w.run, w.ws).single().iterations
            assertEquals(false, its[0].actionRepaired, "the model chose to think")
            assertEquals(true, its[1].actionRepaired, "the runtime substituted a THINK")
            /* Both are THINK. Without the flag they are the same row. */
            assertEquals(its[0].actionType, its[1].actionType)
        } finally { cleanup(w) }
    }

    // ── Recall ──────────────────────────────────────────────────────────────

    /**
     * Iterations restored on resume are marked recalled; later ones are not.
     *
     * A reader seeing the same iteration twice deserves to know which is which.
     */
    @Test
    fun `iterations before the resume point are marked recalled`() {
        val w = World()
        try {
            seed(w)
            repeat(5) { addIteration(w, it + 1, atMs = it * 1_000L) }
            addEvent(w, "AGENT_LOOP_RECONSTRUCTED",
                """{"resumeFromIteration":4,"observationsRestored":3,"tokensRestored":1800}""")

            val its = reader.activations(w.run, w.ws).single().iterations
            assertEquals(listOf(true, true, true, false, false), its.map { it.recalled })
        } finally { cleanup(w) }
    }

    /** A replay says why the transcript could not be reused. */
    @Test
    fun `a replay carries its reason`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 1)
            addEvent(w, "AGENT_LOOP_RECONSTRUCTION_SKIPPED",
                """{"reason":"SCHEMA_CHANGED","detail":"loop_schema_version 1 < 2"}""")

            val a = reader.activations(w.run, w.ws).single()
            val note = assertNotNull(a.replayedFrom)
            assertEquals("SCHEMA_CHANGED", note.reason)
            assertEquals("loop_schema_version 1 < 2", note.detail)
            assertFalse(a.iterations.single().recalled,
                "a replayed iteration ran again — it was not recalled")
        } finally { cleanup(w) }
    }

    /** No reconstruction event at all means nothing was recalled and nothing replayed. */
    @Test
    fun `a first execution claims neither recall nor replay`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 1)
            val a = reader.activations(w.run, w.ws).single()
            assertNull(a.replayedFrom)
            assertFalse(a.iterations.single().recalled)
        } finally { cleanup(w) }
    }

    // ── Budget ──────────────────────────────────────────────────────────────

    /**
     * Used against granted, so "it ran out of iterations" is read.
     *
     * A dimension granted but unspent still appears — a ceiling nobody
     * approached is information too. A dimension spent with no ceiling appears
     * with a null limit rather than an invented one.
     */
    @Test
    fun `budgets pair what was granted with what was used`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 1)
            addActivation(w,
                allocated = """{"iterations":5,"tokens":24000,"costCents":40}""",
                consumed = """{"iterations":5,"tokens":18450,"toolCalls":3}""")

            val a = reader.activations(w.run, w.ws).single()
            val byDim = a.budgets.associateBy { it.dimension }

            assertEquals(5.0, byDim["iterations"]?.used)
            assertEquals(5.0, byDim["iterations"]?.limit, "full — this is what 'ran out' looks like")
            assertEquals(18450.0, byDim["tokens"]?.used)
            assertEquals(24000.0, byDim["tokens"]?.limit)
            assertEquals(0.0, byDim["costCents"]?.used, "granted but unspent still shows")
            assertNull(byDim["toolCalls"]?.limit, "spent with no ceiling gets no invented one")
        } finally { cleanup(w) }
    }

    /** No activation row means no gauges, rather than gauges against zero. */
    @Test
    fun `an activation with no budget row reports no budgets`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 1)
            assertTrue(reader.activations(w.run, w.ws).single().budgets.isEmpty())
        } finally { cleanup(w) }
    }

    // ── Shape ───────────────────────────────────────────────────────────────

    /** Iterations come back in order, with the action and observation intact. */
    @Test
    fun `iterations arrive in order with their action and observation`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, 2, actionType = "FINAL", observation = "done", atMs = 2_000)
            addIteration(w, 1, actionType = "THINK", observation = "thinking", atMs = 0)

            val its = reader.activations(w.run, w.ws).single().iterations
            assertEquals(listOf(1, 2), its.map { it.number })
            assertEquals(listOf("THINK", "FINAL"), its.map { it.actionType })
            assertEquals(listOf("thinking", "done"), its.map { it.observation })
            assertEquals(1_200L, its[0].durationMs)
        } finally { cleanup(w) }
    }

    /** A run with no agent step returns nothing rather than an empty activation. */
    @Test
    fun `a run with no iterations returns no activations`() {
        val w = World()
        try {
            seed(w)
            assertTrue(reader.activations(w.run, w.ws).isEmpty())
        } finally { cleanup(w) }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun addEvent(w: World, type: String, metadata: String) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO run_events
                     (id, workspace_id, environment_id, run_id, sequence, type, status,
                      source, timestamp, step_id, metadata_json_sanitized, created_at)
                   VALUES (?,?,?,?,?,?,'running','worker',now(),?,?::jsonb, now())"""
            ).use { st ->
                st.setObject(1, UUID.randomUUID())
                st.setObject(2, w.ws); st.setObject(3, w.env); st.setObject(4, w.run)
                st.setLong(5, 1)
                st.setString(6, type); st.setString(7, w.step); st.setString(8, metadata)
                st.executeUpdate()
            }
        }
    }

    private fun addActivation(w: World, allocated: String, consumed: String) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_activations
                     (id, run_id, workspace_id, environment_id, step_id, agent_id,
                      root_activation_id, role, contract_json, idempotency_key, attempt,
                      depth, sequence, status, budget_allocated_json, budget_consumed_json,
                      agent_snapshot_json, stop_reason)
                   VALUES (?,?,?,?,?,?,?,'worker','{}'::jsonb,?,1,
                           0,1,'succeeded',?::jsonb,?::jsonb,?::jsonb,'MAX_ITERATIONS')"""
            ).use { st ->
                val id = UUID.randomUUID()
                st.setObject(1, id)
                st.setObject(2, w.run); st.setObject(3, w.ws); st.setObject(4, w.env)
                st.setString(5, w.step); st.setObject(6, w.agent)
                st.setObject(7, id)                       // its own root
                st.setString(8, "idem-${w.run}")
                st.setString(9, allocated); st.setString(10, consumed)
                st.setString(11, """{"name":"researcher"}""")
                st.executeUpdate()
            }
        }
    }
}
