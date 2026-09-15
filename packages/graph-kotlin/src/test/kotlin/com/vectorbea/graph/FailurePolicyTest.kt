package com.vectorbea.graph

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * What the canvas says a failure should do, and what the runtime is told.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * This converter has already shipped one bug of exactly this shape. The
 * Advanced tab offered four `errorPolicy` values; the reader listed two, and the
 * other two fell to `else` and became `fail_run` — so choosing "route to the
 * error path" produced a node that ignored its error edge and stopped the run,
 * which is the opposite of what the control says.
 *
 * A silent downgrade is the failure mode of every one of these readers, and it
 * is invisible: the workflow runs, it just does the wrong thing on the day a
 * step fails. So every accepted spelling is asserted, not sampled.
 */
class FailurePolicyTest {

    private val mapper = com.fasterxml.jackson.databind.ObjectMapper()

    /** One node, in the shape the builder saves, carrying [config] in `data.config`. */
    private fun policyFor(config: Map<String, Any>): FailurePolicy = graphWith(
        mapOf("id" to "n1", "type" to "http", "data" to mapOf("config" to config))
    )

    private fun graphWith(node: Map<String, Any>): FailurePolicy {
        val json = mapper.writeValueAsString(
            mapOf("nodes" to listOf(node), "edges" to emptyList<Any>()))
        return WorkflowGraph.parse(json).nodes.single().failurePolicy
    }

    @Test
    fun `a node that says nothing aborts the run, as it always did`() {
        val p = policyFor(emptyMap())
        assertEquals(FailurePolicy.ABORT, p.onFailure)
        assertEquals(FailurePolicy.BRANCH_REQUIRE_ONE, p.branchFailure,
            "the pre-existing hard-coded fan-out rule, now merely declared")
    }

    @Test
    fun `every spelling of escalate is read as escalate`() {
        listOf("escalate", "ask_human", "escalate_to_human", "ESCALATE", "escalate-to-human")
            .forEach { spelling ->
                assertEquals(FailurePolicy.ESCALATE, policyFor(mapOf("errorPolicy" to spelling)).onFailure,
                    "`$spelling` fell through to `fail_run`. A node configured to ask a person " +
                        "would instead stop the run, and nothing would say so")
            }
    }

    @Test
    fun `the pre-existing values still mean what they meant`() {
        assertEquals(FailurePolicy.CONTINUE, policyFor(mapOf("errorPolicy" to "continue")).onFailure)
        assertEquals(FailurePolicy.CONTINUE, policyFor(mapOf("errorPolicy" to "ignore")).onFailure)
        assertEquals(FailurePolicy.CONTINUE, policyFor(mapOf("errorPolicy" to "skip")).onFailure)
        assertEquals(FailurePolicy.FAILURE_EDGE, policyFor(mapOf("errorPolicy" to "error-path")).onFailure)
        assertEquals(FailurePolicy.FAILURE_EDGE, policyFor(mapOf("errorPolicy" to "fallback")).onFailure)
        assertEquals(FailurePolicy.ABORT, policyFor(mapOf("errorPolicy" to "fail_run")).onFailure)
    }

    @Test
    fun `an unrecognised policy aborts rather than guessing`() {
        assertEquals(FailurePolicy.ABORT, policyFor(mapOf("errorPolicy" to "carry-on-regardless")).onFailure,
            "`fail_run` is the only default that cannot silently produce a wrong result")
    }

    @Test
    fun `the escalation signal and deadline are carried through`() {
        val p = policyFor(mapOf(
            "errorPolicy" to "escalate",
            "escalationSignal" to "page-the-oncall",
            "escalationTimeoutMs" to 900_000,
        ))
        assertEquals("page-the-oncall", p.escalationSignal)
        assertEquals(900_000L, p.escalationTimeoutMs)
    }

    @Test
    fun `a zero or negative escalation deadline falls back to the platform default`() {
        listOf(0, -1).forEach { bad ->
            val p = policyFor(mapOf("errorPolicy" to "escalate", "escalationTimeoutMs" to bad))
            assertEquals(null, p.escalationTimeoutMs,
                "a deadline of $bad would be clamped by the wait store anyway, but reading it " +
                    "as a real value hides the misconfiguration from anyone looking at the node")
        }
    }

    @Test
    fun `every spelling of the branch policy is read`() {
        mapOf(
            "all_must_succeed" to FailurePolicy.BRANCH_ALL_MUST_SUCCEED,
            "all" to FailurePolicy.BRANCH_ALL_MUST_SUCCEED,
            "strict" to FailurePolicy.BRANCH_ALL_MUST_SUCCEED,
            "tolerate_all" to FailurePolicy.BRANCH_TOLERATE_ALL,
            "any" to FailurePolicy.BRANCH_TOLERATE_ALL,
            "best-effort" to FailurePolicy.BRANCH_TOLERATE_ALL,
            "require_one" to FailurePolicy.BRANCH_REQUIRE_ONE,
        ).forEach { (spelling, expected) ->
            assertEquals(expected, policyFor(mapOf("branchFailure" to spelling)).branchFailure,
                "`$spelling` was not read; the fan-out would keep the old hard-coded rule")
        }
    }

    @Test
    fun `a fan-out that declares only its branch policy is still read`() {
        /*
         * The regression this guards: `readFailurePolicy` used to return the
         * default the moment `errorPolicy` was absent, and a PARALLEL node
         * commonly sets `branchFailure` and nothing else. That early return would
         * have read "any failed branch fails the fan-out" as "say nothing".
         */
        val p = policyFor(mapOf("branchFailure" to "all_must_succeed"))
        assertEquals(FailurePolicy.BRANCH_ALL_MUST_SUCCEED, p.branchFailure)
        assertEquals(FailurePolicy.ABORT, p.onFailure)
    }

    @Test
    fun `the policy can be declared on data as well as on config`() {
        /* Both spellings are in the wild — the inspector writes one, the
           Architect writes the other. */
        val fromData = graphWith(mapOf(
            "id" to "n1", "type" to "http",
            "data" to mapOf("errorPolicy" to "escalate"),
        ))
        assertEquals(FailurePolicy.ESCALATE, fromData.onFailure)
    }
}
