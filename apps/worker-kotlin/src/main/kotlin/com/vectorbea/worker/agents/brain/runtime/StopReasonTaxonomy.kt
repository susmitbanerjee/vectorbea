package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.observability.failures.Classification
import com.vectorbea.observability.failures.FailureClass
import com.vectorbea.observability.failures.FailureTaxonomy
import com.vectorbea.observability.failures.FailureVerdict
import com.vectorbea.worker.agents.brain.model.AgentLoopState.StopReason

/**
 * Every way the agent loop can stop, mapped to who owns the outcome.
 *
 * ── HOW EXHAUSTIVENESS IS ENFORCED ──────────────────────────────────────────
 * The `when` in [classify] has NO `else` branch and is used as an expression, so
 * Kotlin requires it to cover every [StopReason]. Adding a new stop reason without
 * deciding its class is a COMPILE ERROR, not a test failure and not a silent
 * default — which is the strongest form of the guarantee, and the reason this
 * mapping lives here in the worker rather than in the shared taxonomy module. The
 * shared module cannot see this enum; only the module that owns it can be forced
 * to keep up with it.
 *
 * `StopReasonTaxonomyTest` asserts the same thing at runtime as a backstop, because
 * a future refactor that introduces an `else` would silently remove the compile-time
 * check and nothing else would notice.
 *
 * ── TWO STOP REASONS ARE OVERLOADED, AND ARE LISTED RATHER THAN GUESSED ─────
 * `AGENT_FAILED` and `ERROR` each cover several genuinely different failures, so
 * neither maps to one class on its own. Both are resolved by the signals the caller
 * already has — the failure text, the span kind, the attributes — and where those
 * signals say nothing, the case is NAMED as ambiguous rather than filed under a
 * bucket. See [Ambiguity].
 */
object StopReasonTaxonomy {

    /**
     * The stop reasons that carry more than one meaning, recorded rather than
     * papered over.
     *
     * This list is the honest answer to "every stop reason maps to exactly one
     * class": these two do not, by construction, and the fix is to split the enum
     * rather than to invent a class that covers both halves.
     */
    enum class Ambiguity(val stopReason: StopReason, val why: String) {
        AGENT_FAILED_IS_TWO_THINGS(
            StopReason.AGENT_FAILED,
            "Set both when the MODEL returns a FAIL action (MODEL_BEHAVIOR — the agent " +
            "weighed the task and declined) and when a HUMAN rejects an approval " +
            "(POLICY — a person said no). Resolved from the failure text; a split into " +
            "AGENT_DECLINED and APPROVAL_REJECTED would remove the ambiguity at source."),

        ERROR_IS_THE_CATCH_ALL(
            StopReason.ERROR,
            "Set for an unparseable action, a repeated identical tool failure, and any " +
            "unexpected exception. The first is MODEL_BEHAVIOR, the second TOOL_FAILURE, " +
            "the third INFRA. Resolved from the failure text and span kind; with no " +
            "signal at all it stays INFRA, which is the safe direction because INFRA is " +
            "the only retryable class and a spurious retry is cheaper than a wrongly " +
            "final failure."),
    }

    /**
     * Classify a completed agent loop.
     *
     * @param failureReason the loop's own explanation, already sanitized
     * @param spanKind      where the failure surfaced, when known
     * @param attributes    span attributes, for `http_status` and friends
     * @param budgetBreach  which limit was hit, required when the reason is BUDGET_EXCEEDED
     */
    fun classify(
        stopReason: StopReason,
        failureReason: String? = null,
        spanKind: String? = null,
        attributes: Map<String, Any?> = emptyMap(),
        budgetBreach: String? = null,
    ): Classification {
        val text = failureReason?.lowercase() ?: ""

        return when (stopReason) {
            // ── Not failures ──────────────────────────────────────────────────
            StopReason.FINAL_OUTPUT ->
                Classification.Success

            StopReason.APPROVAL_REQUESTED ->
                /* A run waiting on a person is not a failed run, and rendering it as
                   one is how "approve this" becomes "why did it break". */
                Classification.Waiting("a human approval")

            // ── Unambiguous ───────────────────────────────────────────────────
            StopReason.MAX_ITERATIONS ->
                Classification.Failed(FailureVerdict(FailureClass.MODEL_BEHAVIOR,
                    "the loop used its whole iteration budget without producing a final output"))

            StopReason.SCHEMA_INVALID ->
                Classification.Failed(FailureVerdict(FailureClass.MODEL_BEHAVIOR,
                    "the final output did not match the declared output schema"))

            StopReason.TOOL_NOT_ALLOWED ->
                Classification.Failed(FailureVerdict(FailureClass.POLICY,
                    "the agent called a tool outside its granted list"))

            StopReason.BUDGET_EXCEEDED ->
                Classification.Failed(FailureVerdict(FailureClass.BUDGET,
                    "a budget ceiling was reached",
                    /* Never null for BUDGET — the class requires the limit be named,
                       and "you exceeded a budget" without saying which leaves the
                       operator guessing between iterations, tokens, cost and time. */
                    breachedLimit = budgetBreach ?: limitFromText(text)))

            // ── Overloaded: resolved from signals, listed in [Ambiguity] ──────
            StopReason.AGENT_FAILED ->
                Classification.Failed(
                    if (listOf("not approved", "rejected", "approver", "denied")
                            .any { it in text })
                        FailureVerdict(FailureClass.POLICY,
                            "an approver rejected the request")
                    else
                        FailureVerdict(FailureClass.MODEL_BEHAVIOR,
                            "the agent reported it could not complete the task"))

            StopReason.ERROR ->
                Classification.Failed(
                    FailureTaxonomy.fromSignals(failureReason, spanKind, attributes)
                        ?: when {
                            "failed twice with the same error" in text ->
                                FailureVerdict(FailureClass.TOOL_FAILURE,
                                    "the same tool failed identically twice")
                            "could not execute" in text || "produced an action" in text ->
                                FailureVerdict(FailureClass.MODEL_BEHAVIOR,
                                    "the model produced an action the runtime could not execute")
                            else ->
                                /* No signal. INFRA is the safe direction: it is the one
                                   retryable class, and a spurious retry costs less than
                                   telling someone a transient fault is permanent. */
                                FailureVerdict(FailureClass.INFRA,
                                    "the loop failed with no classifiable signal")
                        })
        }
    }

    /** Which ceiling the loop hit, read back out of its own message. */
    private fun limitFromText(text: String): String = when {
        "iteration" in text -> "max iterations"
        "token"     in text -> "max total tokens"
        "cost"      in text -> "max cost"
        "tool call" in text -> "max tool calls"
        "timeout"   in text || "time" in text -> "max duration"
        else                -> "an agent budget limit"
    }

    /**
     * A run stopped by a RUN-level ceiling rather than by the agent loop.
     *
     * Separate entry point because `CeilingExceeded` is not a stop reason and must
     * never be rendered as an error: the run did what it was asked, more expensively
     * than allowed.
     */
    fun classifyCeiling(breachedLimit: String): Classification =
        Classification.Failed(FailureVerdict(
            FailureClass.BUDGET,
            "a run ceiling was reached",
            breachedLimit = breachedLimit))
}
