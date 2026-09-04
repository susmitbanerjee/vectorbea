package com.vectorbea.observability.failures

/**
 * What kind of failure this was, in terms of WHO CAN FIX IT.
 *
 * A stop reason is a category and a category tells nobody what happened to their
 * run. `MAX_ITERATIONS` is true and useless; "the agent never converged, and the
 * person who designed it needs to look at the prompt" is actionable.
 *
 * WHY THIS IS NOT `com.vectorbea.recovery.model.FailureCategory`
 * -------------------------------------------------------------
 * That enum already exists and is not this. It classifies failures for the
 * RECOVERY ENGINE — twenty technical causes (`DB_WRITE_BLOCKED`, `RATE_LIMIT`,
 * `UNSAFE_REPLAY`) chosen so a policy engine can decide whether to retry, replay or
 * escalate. It is a diagnosis.
 *
 * This is a verdict about ownership: ten classes, each with an owner and a
 * retryability answer, chosen so a non-engineer reading a failed run knows whether
 * to fix their workflow, reconnect an integration, raise a limit, or wait. The two
 * overlap heavily and deliberately answer different questions. [fromRecoveryCategory]
 * maps between them so they cannot drift into disagreeing.
 *
 * Lives in observability-kotlin because both services need it: the worker writes
 * `failure_class` onto spans at terminalisation, and the API renders it. This is a
 * real composite build both depend on, so unlike the vendored recovery package
 * there is exactly one copy.
 */
enum class FailureClass(
    /** Who has to act. Rendered verbatim in the failure panel. */
    val owner: String,
    /** Whether retrying unchanged could plausibly end differently. */
    val retry: Retryability,
    /** One line, plain language, no jargon — this is shown to a business user. */
    val summary: String,
) {
    CONFIG("Workflow builder", Retryability.NO,
        "Something in the workflow's setup is wrong or missing."),

    INPUT("Workflow builder", Retryability.NO,
        "A value this step needed was missing or the wrong shape."),

    AUTH("Workspace admin", Retryability.NOT_UNTIL_FIXED,
        "A credential was rejected. Reconnect the integration."),

    TOOL_FAILURE("Integration owner", Retryability.SOMETIMES,
        "An integration returned an error or an unusable response."),

    MODEL_BEHAVIOR("Agent designer", Retryability.RARELY,
        "The agent did not reach a usable answer."),

    BUDGET("Operator", Retryability.ONLY_WITH_A_RAISED_LIMIT,
        "The run did what it was asked, but hit a configured limit."),

    POLICY("Approver or builder", Retryability.NO,
        "A rule stopped this: a grant, a roster, or an approval decision."),

    ORCHESTRATION("Workflow builder", Retryability.NO,
        "Agents handed work to each other in a way that could not finish."),

    TIMEOUT("Platform and design", Retryability.SOMETIMES,
        "Something took longer than its allotted time."),

    INFRA("Platform", Retryability.YES,
        "Infrastructure failed. This is ours, not yours.");

    /**
     * BUDGET is the one class that must never render as an error.
     *
     * A run that did exactly what it was asked, more expensively than allowed, is
     * not a crash. Showing it in red next to genuine breakages is how a ceiling —
     * a feature — gets reported as a bug.
     */
    val rendersAsError: Boolean get() = this != BUDGET
}

enum class Retryability(val humanAnswer: String) {
    YES("Yes — retrying is likely to work."),
    SOMETIMES("Sometimes — it depends whether the cause was transient."),
    RARELY("Rarely — the same inputs will usually produce the same result."),
    NO("No — retrying now will fail the same way."),
    NOT_UNTIL_FIXED("Not until the credential is fixed."),
    ONLY_WITH_A_RAISED_LIMIT("Only if the limit is raised."),
}

/**
 * A classified failure: the class, why it was chosen, and the limit it breached
 * where that applies.
 */
data class FailureVerdict(
    val failureClass: FailureClass,
    /** The specific signal that decided it — for the trace, not for the user. */
    val evidence: String,
    /**
     * For [FailureClass.BUDGET] only: which limit was hit.
     *
     * Non-null is a requirement of the class, not a nicety. "You exceeded a budget"
     * without naming which one leaves the operator guessing between iterations,
     * tokens, cost, wall clock and tool calls.
     */
    val breachedLimit: String? = null,
) {
    init {
        require(failureClass != FailureClass.BUDGET || breachedLimit != null) {
            "a BUDGET verdict must name the limit it breached"
        }
    }
}

/**
 * The outcome of classifying a run. Not every stop is a failure, and forcing the
 * successful and waiting ones into a failure class would be the "default bucket"
 * this taxonomy exists to avoid.
 */
sealed class Classification {
    /** The run succeeded. No class applies. */
    object Success : Classification()

    /** The run is parked, waiting on something outside itself. Not a failure. */
    data class Waiting(val on: String) : Classification()

    /** A real failure with an owner. */
    data class Failed(val verdict: FailureVerdict) : Classification()
}

object FailureTaxonomy {

    /**
     * Classify from the signals available on a span.
     *
     * Deliberately ordered most-specific first: an HTTP 401 inside a tool call is
     * AUTH, not TOOL_FAILURE, because "reconnect the integration" is the useful
     * instruction and "an integration returned an error" is not.
     *
     * Returns null when no signal matches, so the CALLER decides — this function
     * never guesses a class. That is what "no default bucket" means in practice: an
     * unmatched error is the caller's problem to name, not something quietly filed
     * under INFRA.
     */
    fun fromSignals(
        errorText: String?,
        spanKind: String?,
        attributes: Map<String, Any?> = emptyMap(),
    ): FailureVerdict? {
        val err = errorText?.lowercase() ?: ""
        val status = (attributes["http_status"] as? Number)?.toInt()

        // ── AUTH ─────────────────────────────────────────────────────────────
        if (status == 401 || status == 403) return FailureVerdict(
            FailureClass.AUTH, "http_status=$status")
        if (listOf("unauthorized", "forbidden", "invalid api key", "token expired",
                   "authentication failed", "credential").any { it in err })
            return FailureVerdict(FailureClass.AUTH, "auth signal in error text")

        // ── TIMEOUT ──────────────────────────────────────────────────────────
        if (listOf("timeout", "timed out", "deadline exceeded").any { it in err })
            return FailureVerdict(FailureClass.TIMEOUT, "timeout signal in error text")

        // ── INPUT ────────────────────────────────────────────────────────────
        if (spanKind == "input_mapping" ||
            listOf("input mapping", "missing required config", "could not resolve")
                .any { it in err })
            return FailureVerdict(FailureClass.INPUT, "input resolution failed")

        // ── CONFIG ───────────────────────────────────────────────────────────
        if (listOf("not found or not accessible", "no llm connection",
                   "missing required", "not yet supported", "invalid .* format")
                .any { Regex(it).containsMatchIn(err) })
            return FailureVerdict(FailureClass.CONFIG, "setup signal in error text")

        // ── INFRA ────────────────────────────────────────────────────────────
        if (status != null && status >= 500)
            return FailureVerdict(FailureClass.INFRA, "http_status=$status")
        if (listOf("connection refused", "unknownhost", "lease", "worker crashed",
                   "could not connect").any { it in err })
            return FailureVerdict(FailureClass.INFRA, "infrastructure signal in error text")

        // ── TOOL_FAILURE ─────────────────────────────────────────────────────
        if (spanKind == "tool_call")
            return FailureVerdict(FailureClass.TOOL_FAILURE, "error inside a tool call")
        if (status != null && status >= 400)
            return FailureVerdict(FailureClass.TOOL_FAILURE, "http_status=$status")

        return null
    }

    /**
     * Bridge from the recovery engine's diagnosis to this ownership verdict.
     *
     * Exhaustive over that enum on purpose: adding a `FailureCategory` without
     * deciding who owns it is exactly the drift this bridge exists to prevent, and
     * a `when` with no `else` makes it a compile error rather than a silent
     * fall-through.
     */
    fun fromRecoveryCategory(category: String): FailureVerdict? = when (category) {
        "AUTH_FAILURE"              -> FailureVerdict(FailureClass.AUTH, "recovery: $category")
        "CONNECTION_FAILURE",
        "NETWORK_FAILURE",
        "WORKER_CRASHED",
        "IDEMPOTENCY_CONFLICT"      -> FailureVerdict(FailureClass.INFRA, "recovery: $category")
        "RATE_LIMIT"                -> FailureVerdict(FailureClass.TOOL_FAILURE, "recovery: $category")
        "TIMEOUT",
        "APPROVAL_TIMEOUT"          -> FailureVerdict(FailureClass.TIMEOUT, "recovery: $category")
        "SCHEMA_VALIDATION_FAILURE",
        "LLM_OUTPUT_INVALID"        -> FailureVerdict(FailureClass.MODEL_BEHAVIOR, "recovery: $category")
        "MAPPING_FAILURE"           -> FailureVerdict(FailureClass.INPUT, "recovery: $category")
        "TOOL_RESPONSE_INVALID",
        "DB_QUERY_FAILURE"          -> FailureVerdict(FailureClass.TOOL_FAILURE, "recovery: $category")
        "DB_WRITE_BLOCKED",
        "APPROVAL_REJECTED",
        "UNSAFE_REPLAY"             -> FailureVerdict(FailureClass.POLICY, "recovery: $category")
        "WORKFLOW_GRAPH_INVALID"    -> FailureVerdict(FailureClass.CONFIG, "recovery: $category")
        "RESOURCE_LIMIT_EXCEEDED"   -> FailureVerdict(FailureClass.BUDGET, "recovery: $category",
                                          breachedLimit = "a workspace resource limit")
        "RETRY_EXHAUSTED"           -> FailureVerdict(FailureClass.INFRA, "recovery: $category")
        /* UNKNOWN is the recovery engine's own admission that it could not tell.
           Promoting it to a class here would be inventing one. */
        "UNKNOWN"                   -> null
        else                        -> null
    }
}
