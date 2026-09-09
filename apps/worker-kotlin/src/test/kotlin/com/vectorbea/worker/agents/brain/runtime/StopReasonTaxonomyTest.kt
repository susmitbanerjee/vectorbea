package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.observability.failures.Classification
import com.vectorbea.observability.failures.FailureClass
import com.vectorbea.worker.agents.brain.model.AgentLoopState.StopReason
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Every way the loop can stop is classified, and none of them fall in a default
 * bucket.
 *
 * THE PRIMARY GUARANTEE IS THE COMPILER, NOT THIS FILE.
 * `StopReasonTaxonomy.classify` uses a `when` over [StopReason] with no `else`, as
 * an expression, so omitting a stop reason does not compile. This test is the
 * backstop for the one thing the compiler cannot catch: somebody adding an `else`
 * branch, which would silently restore the default bucket and make the compile-time
 * check vanish without any other signal.
 */
class StopReasonTaxonomyTest {

    @Test
    fun `every stop reason is classified`() {
        // Iterating the enum, so a new value is covered the moment it is added.
        StopReason.entries.forEach { reason ->
            val result = StopReasonTaxonomy.classify(reason, failureReason = "something happened")
            assertNotNull(result, "$reason produced no classification")
        }
        assertEquals(15, StopReason.entries.size,
            "the enum changed — check the new stop reason has a deliberate class, " +
            "and add it to the case-by-case assertions below rather than relying on " +
            "the loop above, which only proves it is non-null")
    }

    @Test
    fun `success and waiting are not failures`() {
        // The default-bucket trap in its most tempting form: forcing these into a
        // failure class would paint a successful run red and a waiting run broken.
        assertTrue(StopReasonTaxonomy.classify(StopReason.FINAL_OUTPUT) is Classification.Success)
        val waiting = StopReasonTaxonomy.classify(StopReason.APPROVAL_REQUESTED)
        assertTrue(waiting is Classification.Waiting)
        assertEquals("a human approval", (waiting as Classification.Waiting).on)

        /*
         * WAITING is the same argument about a different thing waited on. A
         * six-minute render still running is not a failure, and a run parked on a
         * signal that has not arrived is not one either. `failureReason` is passed
         * deliberately: the loop records why it stopped even when stopping was
         * correct, and a classifier that reads that text and concludes "failed"
         * would put every healthy async tool call in the failure metrics.
         */
        val external = StopReasonTaxonomy.classify(
            StopReason.WAITING, failureReason = "waiting for render_video to finish")
        assertTrue(external is Classification.Waiting,
            "a run parked on an external event was classified as $external. Every " +
                "async tool call and every signal wait would then be counted as a " +
                "failure on somebody's dashboard.")
        assertEquals("an external event", (external as Classification.Waiting).on)
    }

    @Test
    fun `every parked stop reason is a Waiting, and every wait kind has one`() {
        /*
         * The taxonomy's half of the wait primitive. A wait kind that parks a run
         * with no `Waiting` classification behind it renders as an error in the
         * timeline — the run is fine, the label is not.
         *
         * APPROVAL_REQUESTED covers WaitKind.APPROVAL; WAITING covers the other
         * three. Adding a fifth kind means deciding which of the two it stops with,
         * and this asserts both are still classified as waiting rather than failed.
         */
        listOf(StopReason.APPROVAL_REQUESTED, StopReason.WAITING).forEach { reason ->
            val c = StopReasonTaxonomy.classify(reason, failureReason = "something happened")
            assertTrue(c is Classification.Waiting, "$reason is not classified as waiting")
            assertTrue((c as Classification.Waiting).on.isNotBlank(),
                "$reason does not name what it is waiting on, so the timeline can " +
                    "only say 'waiting', which tells the operator nothing")
        }
    }

    @Test
    fun `the unambiguous stop reasons map as the taxonomy table says`() {
        fun classOf(r: StopReason, text: String? = null, breach: String? = null) =
            (StopReasonTaxonomy.classify(r, failureReason = text, budgetBreach = breach)
                as Classification.Failed).verdict.failureClass

        assertEquals(FailureClass.MODEL_BEHAVIOR, classOf(StopReason.MAX_ITERATIONS))
        assertEquals(FailureClass.MODEL_BEHAVIOR, classOf(StopReason.SCHEMA_INVALID))
        assertEquals(FailureClass.POLICY,         classOf(StopReason.TOOL_NOT_ALLOWED))
        assertEquals(FailureClass.BUDGET,
            classOf(StopReason.BUDGET_EXCEEDED, breach = "max iterations"))
    }

    @Test
    fun `the orchestration stop reasons are ORCHESTRATION, except the one that is a ceiling`() {
        fun verdictOf(r: StopReason, breach: String? = null) =
            (StopReasonTaxonomy.classify(r, failureReason = "something happened", budgetBreach = breach)
                as Classification.Failed).verdict

        assertEquals(FailureClass.ORCHESTRATION, verdictOf(StopReason.AGENT_NOT_IN_ROSTER).failureClass)
        assertEquals(FailureClass.ORCHESTRATION, verdictOf(StopReason.MAX_DEPTH_EXCEEDED).failureClass)
        assertEquals(FailureClass.ORCHESTRATION, verdictOf(StopReason.HANDOFF_LOOP).failureClass)
        assertEquals(FailureClass.ORCHESTRATION, verdictOf(StopReason.CHILD_FAILED).failureClass)
        assertEquals(FailureClass.ORCHESTRATION, verdictOf(StopReason.JOIN_DEADLOCK).failureClass)

        /*
         * TEAM_BUDGET_EXCEEDED is BUDGET, and the exception proves the rule: a
         * subtree ceiling is a ceiling. The operator raises a limit; the builder
         * restructures nothing. Filing it under ORCHESTRATION because it happens
         * to involve a team would send the wrong person to fix it.
         */
        val team = verdictOf(StopReason.TEAM_BUDGET_EXCEEDED)
        assertEquals(FailureClass.BUDGET, team.failureClass)
        assertNotNull(team.breachedLimit,
            "a BUDGET verdict must name the limit — the class itself requires it")
    }

    @Test
    fun `every orchestration stop reason is owned by somebody who can act`() {
        /* A class with no owner is a category, and a category tells nobody what to
           do. ORCHESTRATION is the workflow builder's: a roster, a depth limit and
           a fan-out width are all configuration. */
        listOf(StopReason.AGENT_NOT_IN_ROSTER, StopReason.MAX_DEPTH_EXCEEDED,
               StopReason.HANDOFF_LOOP, StopReason.CHILD_FAILED, StopReason.JOIN_DEADLOCK)
            .forEach { r ->
                val v = (StopReasonTaxonomy.classify(r) as Classification.Failed).verdict
                assertTrue(v.failureClass.owner.isNotBlank(), "$r has no owner")
                assertTrue(v.evidence.isNotBlank(), "$r has no evidence sentence")
            }
    }

    // ── The two overloaded reasons ────────────────────────────────────────────

    @Test
    fun `AGENT_FAILED splits on whether a human rejected it`() {
        fun classOf(text: String) =
            (StopReasonTaxonomy.classify(StopReason.AGENT_FAILED, failureReason = text)
                as Classification.Failed).verdict.failureClass

        // A person said no → POLICY. Nothing about the agent needs changing.
        assertEquals(FailureClass.POLICY, classOf("Approval was not approved (decided by alice)"))
        assertEquals(FailureClass.POLICY, classOf("rejected by approver bob"))
        // The model weighed the task and declined → MODEL_BEHAVIOR.
        assertEquals(FailureClass.MODEL_BEHAVIOR, classOf("Agent reported failure: cannot do this"))
    }

    @Test
    fun `ERROR splits on the signal, and falls to INFRA only with none`() {
        fun classOf(text: String?, kind: String? = null, attrs: Map<String, Any?> = emptyMap()) =
            (StopReasonTaxonomy.classify(StopReason.ERROR, failureReason = text,
                spanKind = kind, attributes = attrs) as Classification.Failed).verdict.failureClass

        assertEquals(FailureClass.AUTH, classOf("HTTP 403: token expired"))
        assertEquals(FailureClass.AUTH, classOf("boom", attrs = mapOf("http_status" to 401)))
        assertEquals(FailureClass.TIMEOUT, classOf("call timed out after 60000ms"))
        assertEquals(FailureClass.TOOL_FAILURE,
            classOf("Tool abc failed twice with the same error: column does not exist"))
        assertEquals(FailureClass.MODEL_BEHAVIOR,
            classOf("The agent produced an action the runtime could not execute: bad type"))
        assertEquals(FailureClass.INFRA, classOf("connection refused"))
        assertEquals(FailureClass.INFRA, classOf("boom", attrs = mapOf("http_status" to 503)))

        // No signal at all. INFRA is the deliberate direction: it is the only
        // retryable class, and a spurious retry costs less than telling somebody a
        // transient fault is permanent.
        assertEquals(FailureClass.INFRA, classOf(null))
    }

    @Test
    fun `the overloaded reasons are recorded as ambiguous rather than papered over`() {
        // "Every stop reason maps to exactly one class" is not true of these two, and
        // the honest response is to name them rather than invent a class that spans
        // both halves.
        val listed = StopReasonTaxonomy.Ambiguity.entries.map { it.stopReason }.toSet()
        assertEquals(setOf(StopReason.AGENT_FAILED, StopReason.ERROR), listed)
        StopReasonTaxonomy.Ambiguity.entries.forEach {
            assertTrue(it.why.length > 80, "${it.name} needs a real explanation, not a label")
        }
    }

    // ── BUDGET's two hard requirements ────────────────────────────────────────

    @Test
    fun `BUDGET always names the limit it breached`() {
        StopReason.entries.forEach { reason ->
            val c = StopReasonTaxonomy.classify(reason, failureReason = "budget exceeded: tokens")
            if (c is Classification.Failed && c.verdict.failureClass == FailureClass.BUDGET) {
                assertNotNull(c.verdict.breachedLimit,
                    "$reason produced BUDGET without naming the limit — " +
                    "'you exceeded a budget' leaves the operator guessing")
            }
        }
        // Derived from the loop's own message when not passed explicitly.
        val derived = StopReasonTaxonomy.classify(
            StopReason.BUDGET_EXCEEDED,
            failureReason = "Budget exceeded: max total tokens reached") as Classification.Failed
        assertEquals("max total tokens", derived.verdict.breachedLimit)
    }

    @Test
    fun `BUDGET never renders as an error`() {
        // A run that did what it was asked, more expensively than allowed, is not a
        // crash and must not be shown as one.
        assertFalse(FailureClass.BUDGET.rendersAsError)
        FailureClass.entries.filter { it != FailureClass.BUDGET }.forEach {
            assertTrue(it.rendersAsError, "$it should render as an error")
        }

        val ceiling = StopReasonTaxonomy.classifyCeiling("max steps per run")
        val verdict = (ceiling as Classification.Failed).verdict
        assertEquals(FailureClass.BUDGET, verdict.failureClass)
        assertEquals("max steps per run", verdict.breachedLimit)
        assertFalse(verdict.failureClass.rendersAsError)
    }

    @Test
    fun `constructing a BUDGET verdict without a limit is rejected`() {
        // Enforced in the type, not by convention, so no future caller can produce
        // an unnamed budget breach.
        val ex = runCatching {
            com.vectorbea.observability.failures.FailureVerdict(
                FailureClass.BUDGET, "no limit named")
        }.exceptionOrNull()
        assertNotNull(ex, "a BUDGET verdict with no breachedLimit must not be constructible")
    }

    @Test
    fun `every class carries an owner and a retryability answer`() {
        FailureClass.entries.forEach {
            assertTrue(it.owner.isNotBlank(), "${it.name} has no owner")
            assertTrue(it.summary.length > 20, "${it.name} needs a plain-language summary")
            assertTrue(it.retry.humanAnswer.isNotBlank(), "${it.name} has no retry answer")
        }
        // The doc's table: only INFRA is unambiguously retryable.
        assertEquals(
            listOf(FailureClass.INFRA),
            FailureClass.entries.filter {
                it.retry == com.vectorbea.observability.failures.Retryability.YES
            })
    }
}
