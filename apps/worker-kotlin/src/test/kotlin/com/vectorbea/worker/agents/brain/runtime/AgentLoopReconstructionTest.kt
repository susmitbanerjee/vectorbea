package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentLoopState.StopReason
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.testsupport.AgentBrainFixture
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.postgresql.ds.PGSimpleDataSource
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.Tag

/**
 * A resumed agent step CONTINUES instead of starting over.
 *
 * THE NUMBER THESE TESTS EXIST TO MOVE
 * ------------------------------------
 * `AgentBrainLoopTest.a resumed step replays every LLM call from iteration 1`
 * pinned the old cost: a step that did 3 iterations and parked spent 4 provider
 * calls on resume — 3 of them re-deriving decisions it had already made and paid
 * for. Every assertion here is on [ScriptedLlmProvider.callCount], because the
 * whole feature is "how many times did we ask the model the same question".
 *
 * These are DB-backed by necessity. Reconstruction is precisely the behaviour of
 * reading back what survived the process, and a stubbed store would test the stub.
 * Skips when no database is reachable, so `gradle test` stays green without
 * infrastructure — see AgentToolGuardIntegrationTest for the same convention.
 */
@Timeout(value = 20, unit = TimeUnit.SECONDS)
@Tag("integration")
class AgentLoopReconstructionTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    /**
     * The database, or a thrown exception naming what is missing.
     *
     * This used to probe a hard-coded localhost port and return null, which
     * turned every test in this class into a silent pass on any machine
     * without it. See [Infra].
     */
    private fun dsOrNull(): DataSource? = com.vectorbea.worker.testsupport.Infra.postgres

    private fun fixture(ds: DataSource, reconstruction: Boolean = true) =
        AgentBrainFixture(dataSource = ds, reconstructionEnabled = reconstruction).also { it.seed() }

    private val THINK = """{"type":"THINK","reasoningSummary":"step %d"}"""
    private val ASK   = """{"type":"ASK_APPROVAL","reasoningSummary":"need a human"}"""
    private val FINAL = """{"type":"FINAL","finalOutput":{"answer":"done"}}"""

    // ── The headline: four iterations, park, resume, zero repeats ─────────────

    @Test
    fun `an agent that parks at iteration 4 and resumes makes zero repeated LLM calls`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            // ── First execution: 3 THINKs, then ASK_APPROVAL at iteration 4.
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2))
                .thenAction(THINK.format(3)).thenAction(ASK)
            val first = f.runner().run(f.config(maxIterations = 10), f.runtimeContext())

            assertEquals(StopReason.APPROVAL_REQUESTED, first.stopReason)
            assertEquals(4, f.llm.callCount(), "four iterations, four provider calls")
            assertEquals(4, f.iterationCount())

            // ── A human approves.
            f.approvals.decide(f.runId, f.stepId, "APPROVED")

            // ── Resume. Only ONE response is scripted: if the loop replays, the
            //    provider runs out and fails the test loudly rather than silently
            //    re-answering.
            f.llm.reset()
            f.llm.thenAction(FINAL)
            val resumed = f.runner().run(f.config(maxIterations = 10), f.resumeContext())

            assertEquals(StopReason.FINAL_OUTPUT, resumed.stopReason)
            assertEquals(1, f.llm.callCount(),
                "the resumed step must make exactly ONE call — the new decision. " +
                "Baseline before this change was 4 (3 replayed + 1 new).")
            assertTrue(f.events.hasType(EventType.AGENT_LOOP_RECONSTRUCTED))
        } finally { f.cleanup() }
    }

    // ── §6 REPLAY FROM ITERATION: the debugger's own use of this machinery ────

    /**
     * ACCEPTANCE: replay from iteration 4 makes ZERO provider calls for 1–3 and
     * live calls from 4.
     *
     * ── WHY THIS IS THE DIFFERENCE BETWEEN A DEBUGGER AND A VIEWER ──────────
     * Resume restores everything settled and continues; a replay restores to a
     * point the READER chose and runs live from there. Without a bound the only
     * options are "carry on from where it stopped" and "start again from 1", and
     * a tool that can only do the second cannot answer "what would it have done
     * if the tool had returned something else".
     *
     * The provider is scripted with exactly the calls the replay should make. If
     * the loop replays iterations 1–3 it runs out of script and fails loudly,
     * which is the only way to prove a NEGATIVE — that three calls did not
     * happen — rather than asserting a count that a silent extra call could also
     * satisfy.
     */
    @Test
    fun `replay from iteration 4 makes no provider calls for the first three`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            /* A complete run of five iterations: four THINKs and a FINAL. */
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2))
                .thenAction(THINK.format(3)).thenAction(THINK.format(4)).thenAction(FINAL)
            val original = f.runner().run(f.config(maxIterations = 10), f.runtimeContext())

            assertEquals(StopReason.FINAL_OUTPUT, original.stopReason)
            assertEquals(5, f.llm.callCount(), "five iterations, five provider calls")
            assertEquals(5, f.iterationCount())

            /*
             * Replay from 4. Iterations 1–3 are restored from the transcript;
             * 4 onward runs live. TWO responses scripted — the new 4 and a FINAL —
             * so a replay from 1 exhausts the script on its fourth call.
             */
            f.llm.reset()
            f.llm.thenAction(THINK.format(4)).thenAction(FINAL)
            val replayed = f.runner().run(f.config(maxIterations = 10), f.replayContext(fromIteration = 4))

            assertEquals(StopReason.FINAL_OUTPUT, replayed.stopReason)
            assertEquals(2, f.llm.callCount(),
                "iterations 1-3 must be restored, not re-asked: expected the new " +
                "iteration 4 and its FINAL only")
            assertTrue(f.events.hasType(EventType.AGENT_LOOP_RECONSTRUCTED),
                "the replay must go through reconstruction, not through a fresh start")
        } finally { f.cleanup() }
    }

    /** Replay from 1 is a full replay: nothing to restore, everything live. */
    @Test
    fun `replay from iteration 1 runs the whole loop again`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2)).thenAction(FINAL)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            assertEquals(3, f.llm.callCount())

            f.llm.reset()
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2)).thenAction(FINAL)
            f.runner().run(f.config(maxIterations = 10), f.replayContext(fromIteration = 1))

            assertEquals(3, f.llm.callCount(),
                "from 1 there is nothing to restore, so every iteration runs live")
        } finally { f.cleanup() }
    }

    /**
     * Asking to replay from an iteration the run never reached REFUSES.
     *
     * Restoring less than was asked for and running from a different place than
     * the reader chose is the silent-wrong-answer this whole feature exists to
     * remove.
     */
    @Test
    fun `replay from an iteration the run never reached is refused`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(FINAL)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            assertEquals(2, f.iterationCount())

            val cfg = f.config(maxIterations = 10)
            val budget = com.vectorbea.worker.agents.brain.model.AgentBudget(
                maxIterations = 10, maxToolCalls = 10,
                maxTotalTokens = 100_000, maxCostCents = 1_000, timeoutMs = 60_000)
            val outcome = AgentLoopReconstructor(ds, null).reconstruct(
                config = cfg,
                state = com.vectorbea.worker.agents.brain.model.AgentLoopState(cfg, budget),
                budget = budget,
                allowed = true, enabled = true,
                upToIteration = 9,
            )
            val skipped = outcome as AgentLoopReconstructor.Outcome.Skipped
            assertEquals(AgentLoopReconstructor.SkipReason.ITERATION_OUT_OF_RANGE, skipped.reason)
            assertTrue(skipped.detail!!.contains("only settled 2"))
        } finally { f.cleanup() }
    }

    @Test
    fun `a crash-loss resume mid-step also makes zero repeated calls`() = runBlocking {
        // Substituted for the tick-budget yield, which cannot interrupt an agent
        // step: canContinue() is only checked between DAG nodes, so a started agent
        // step always runs to completion, times out, or parks. A lease loss produces
        // the identical replay-from-1 that this feature removes.
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2)).thenAction(ASK)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            assertEquals(3, f.llm.callCount())
            f.approvals.decide(f.runId, f.stepId, "APPROVED")

            // A crash-recovery RESUME_RUN builds the same context an approval resume does.
            f.llm.reset()
            f.llm.thenAction(FINAL)
            val resumed = f.runner().run(f.config(maxIterations = 10), f.resumeContext())

            assertEquals(StopReason.FINAL_OUTPUT, resumed.stopReason)
            assertEquals(1, f.llm.callCount())
        } finally { f.cleanup() }
    }

    // ── No doubling ───────────────────────────────────────────────────────────

    @Test
    fun `two resumes add no duplicate rows and leave the earlier ones untouched`() = runBlocking {
        // The acceptance criterion is "row count after two resumes equals the count
        // after zero resumes". Read literally that cannot hold — a resume that makes
        // progress writes its own new iteration, so the count must grow by exactly
        // the work done. What it is really asserting is NO DOUBLING, and there are
        // two ways this table could double or corrupt, so both are checked:
        //
        //   1. a recalled iteration written back again -> duplicate iteration_number
        //   2. the upsert in persistIterationStart re-firing on a recalled row ->
        //      the row survives but is BLANKED (action_type = NULL, ...)
        //
        // Blanking is the one that actually threatens this table, because it has a
        // unique key and DO UPDATE SET ... = NULL. Doubling is agent_memory_entries'
        // failure mode. Both are asserted.
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2)).thenAction(ASK)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            assertEquals(3, f.iterationCount())

            val before = readTranscript(ds, f)
            assertEquals(3, before.size)
            assertTrue(before.values.all { it != null }, "every row should carry its action")

            f.approvals.decide(f.runId, f.stepId, "APPROVED")

            /*
             * Two resumes, each adding exactly one iteration and then stopping.
             *
             * The ceiling is what bounds them, not another approval: there is one gate
             * per step, and once it is APPROVED a second ASK_APPROVAL is granted
             * immediately and the loop carries on. Setting maxIterations to the
             * iteration this resume should reach makes it run exactly one and stop on
             * MAX_ITERATIONS — which also proves the ceiling sees the RESTORED
             * iteration count rather than starting from zero, so a run that resumes
             * ten times cannot quietly get ten budgets.
             */
            listOf(4, 5).forEachIndexed { i, ceiling ->
                f.llm.reset()
                f.llm.thenAction(THINK.format(ceiling))
                val r = f.runner().run(f.config(maxIterations = ceiling), f.resumeContext())
                assertEquals(StopReason.MAX_ITERATIONS, r.stopReason)
                assertEquals(1, f.llm.callCount(),
                    "resume ${i + 1} must make one call, not replay the earlier ones")
            }

            val after = readTranscript(ds, f)

            // 1. No duplicates: one row per iteration number, still.
            assertEquals(after.size, after.keys.size, "iteration numbers must stay unique")
            assertEquals(f.iterationCount(), after.size)

            // 2. The reconstructed rows are byte-identical — never re-persisted, so
            //    never blanked by the upsert.
            before.forEach { (iteration, action) ->
                assertEquals(action, after[iteration],
                    "iteration $iteration was rewritten by a resume; recalled rows must not be")
            }

            // And the growth is exactly the new work: 3 original + 1 per resume.
            assertEquals(5, after.size)
        } finally { f.cleanup() }
    }

    /** iteration_number -> action_json, for asserting rows are not rewritten. */
    private fun readTranscript(ds: DataSource, f: AgentBrainFixture): Map<Int, String?> =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT iteration_number, action_json_sanitized::text
                     FROM agent_iterations WHERE run_id=? AND step_id=?
                    ORDER BY iteration_number"""
            ).use { st ->
                st.setObject(1, f.runId); st.setString(2, f.stepId)
                st.executeQuery().use { rs ->
                    buildMap { while (rs.next()) put(rs.getInt(1), rs.getString(2)) }
                }
            }
        }

    // ── Fallback paths ────────────────────────────────────────────────────────

    @Test
    fun `a run whose iteration rows are deleted still completes, via the fallback`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2)).thenAction(ASK)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            f.approvals.decide(f.runId, f.stepId, "APPROVED")

            assertTrue(f.deleteIterations() > 0, "rows should have existed to delete")

            // With no transcript the loop replays. Script a full replay plus the
            // finish, which is what a fallback costs.
            f.llm.reset()
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2))
                .thenAction(ASK).thenAction(FINAL)
            val resumed = f.runner().run(f.config(maxIterations = 10), f.resumeContext())

            assertEquals(StopReason.FINAL_OUTPUT, resumed.stopReason,
                "the run must still complete — degraded, not failed")
            // NO_ITERATIONS is the ordinary first-execution path and must not shout.
            // A wiped transcript is indistinguishable from a first execution, so no
            // event here is correct: there is nothing to warn about.
        } finally { f.cleanup() }
    }

    @Test
    fun `rows lacking the V040 columns fall back and say so`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2)).thenAction(ASK)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            f.approvals.decide(f.runId, f.stepId, "APPROVED")

            // An in-flight run written by the previous build.
            assertEquals(3, f.degradeIterationsToPreV040())

            f.llm.reset()
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2))
                .thenAction(ASK).thenAction(FINAL)
            val resumed = f.runner().run(f.config(maxIterations = 10), f.resumeContext())

            assertEquals(StopReason.FINAL_OUTPUT, resumed.stopReason)
            assertEquals(4, f.llm.callCount(), "old rows cannot be rebuilt, so it replays")

            val skip = f.events.firstOf(EventType.AGENT_LOOP_RECONSTRUCTION_SKIPPED)
            assertNotNull(skip, "a transcript that existed but could not be used must say so")
            assertTrue(skip.metadataJsonSanitized!!.contains("PRE_V040_ROWS"),
                "the reason belongs in metadata: ${skip.metadataJsonSanitized}")
            assertTrue(skip.metadataJsonSanitized!!.contains("transcriptSnapshotRef"),
                "the transcript must be snapshotted before the replay overwrites it")
        } finally { f.cleanup() }
    }

    @Test
    fun `the skip event is SKIPPED, never FAILED`() = runBlocking {
        // The timeline grades by event name. A fallback usually precedes a SUCCESSFUL
        // run, and painting it red sends someone hunting a break that is not there.
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(ASK)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            f.approvals.decide(f.runId, f.stepId, "APPROVED")
            f.degradeIterationsToPreV040()

            f.llm.reset()
            f.llm.thenAction(THINK.format(1)).thenAction(ASK).thenAction(FINAL)
            f.runner().run(f.config(maxIterations = 10), f.resumeContext())

            val skip = assertNotNull(f.events.firstOf(EventType.AGENT_LOOP_RECONSTRUCTION_SKIPPED))
            assertEquals("running", skip.status,
                "a fallback is a degradation on a live run, not a failure")
            assertTrue(f.events.none { it.type.value.contains("RECONSTRUCTION_FAILED") })
        } finally { f.cleanup() }
    }

    // ── Job types that must NOT reconstruct ───────────────────────────────────

    @Test
    fun `a deliberate re-run replays instead of continuing`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2)).thenAction(ASK)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            f.approvals.decide(f.runId, f.stepId, "APPROVED")

            // RETRY_NODE / REPLAY_RUN. Somebody asked for the work to happen AGAIN;
            // handing them the previous answer is the opposite of a retry.
            f.llm.reset()
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2))
                .thenAction(ASK).thenAction(FINAL)
            val rerun = f.runner().run(
                f.config(maxIterations = 10), f.resumeContext(allowReconstruction = false))

            assertEquals(StopReason.FINAL_OUTPUT, rerun.stopReason)
            assertEquals(4, f.llm.callCount(), "a re-run must genuinely re-run")
        } finally { f.cleanup() }
    }

    @Test
    fun `with the flag off the loop behaves exactly as before`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!, reconstruction = false)
        try {
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2)).thenAction(ASK)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            f.approvals.decide(f.runId, f.stepId, "APPROVED")

            f.llm.reset()
            f.llm.thenAction(THINK.format(1)).thenAction(THINK.format(2))
                .thenAction(ASK).thenAction(FINAL)
            val resumed = f.runner().run(f.config(maxIterations = 10), f.resumeContext())

            assertEquals(StopReason.FINAL_OUTPUT, resumed.stopReason)
            assertEquals(4, f.llm.callCount(), "flag off means the old replay behaviour")
            assertTrue(f.events.none { it.type == EventType.AGENT_LOOP_RECONSTRUCTED })
        } finally { f.cleanup() }
    }

    // ── What the model sees ───────────────────────────────────────────────────

    @Test
    fun `each restored observation appears exactly once in the resumed prompt`() = runBlocking {
        // Reconstruction and memory recall restore overlapping state. If both ran,
        // every observation would reach the model twice — which reads as the tool
        // having been called twice, and no call-count assertion would catch it.
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            f.llm.thenAction("""{"type":"THINK","reasoningSummary":"UNIQUEMARKERALPHA"}""")
                .thenAction("""{"type":"THINK","reasoningSummary":"UNIQUEMARKERBETA"}""")
                .thenAction(ASK)
            f.runner().run(f.config(maxIterations = 10), f.runtimeContext())
            f.approvals.decide(f.runId, f.stepId, "APPROVED")

            f.llm.reset()
            f.llm.thenAction(FINAL)
            f.runner().run(f.config(maxIterations = 10), f.resumeContext())

            val prompt = assertNotNull(f.llm.lastRequest()?.userPrompt)
            listOf("UNIQUEMARKERALPHA", "UNIQUEMARKERBETA").forEach { marker ->
                val hits = Regex(Regex.escape(marker)).findAll(prompt).count()
                assertEquals(1, hits,
                    "'$marker' should appear exactly once — reconstruction and memory " +
                    "recall must not both restore it")
            }
        } finally { f.cleanup() }
    }

    // ── Content addressing ────────────────────────────────────────────────────

    @Test
    fun `an identical payload across many iterations is stored once`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            val store = com.vectorbea.worker.events.PayloadStore(ds) { 7 }
            val identical = "SYSTEM PROMPT: you are a test agent. Tools: none."
            repeat(20) { store.capture(f.workspaceId, identical) }

            val ref = com.vectorbea.worker.events.PayloadStore.refFor(identical)
            ds.connection.use { c ->
                c.prepareStatement("SELECT count(*) FROM run_payloads WHERE ref=?").use { st ->
                    st.setString(1, ref)
                    st.executeQuery().use { rs ->
                        rs.next()
                        assertEquals(1, rs.getInt(1),
                            "20 captures of identical content must be 1 row")
                    }
                }
            }
        } finally { f.cleanup() }
    }

    @Test
    fun `a secret is redacted before it is stored and the redaction is recorded`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val f = fixture(ds!!)
        try {
            val store = com.vectorbea.worker.events.PayloadStore(ds) { 7 }
            val stored = assertNotNull(store.capture(
                f.workspaceId, """{"dsn":"postgresql://user:hunter2@db.example.com/x"}"""))

            assertTrue(stored.redactions.isNotEmpty(), "the redaction must be recorded")
            val back = assertNotNull(store.load(stored.ref))
            assertTrue(!back.contains("hunter2"), "the secret must not be in the store: $back")
            assertTrue(back.contains("REDACTED"), "the reader must see a marker, not a gap")
        } finally { f.cleanup() }
    }
}
