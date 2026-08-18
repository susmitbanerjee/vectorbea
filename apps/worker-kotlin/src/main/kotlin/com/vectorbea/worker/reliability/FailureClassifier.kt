package com.vectorbea.worker.reliability

/**
 * Classify a failure before deciding how to retry it.
 *
 * THE PREMISE
 * -----------
 * §5 of the reliability doc is blunt: the existing retry policy — max attempts plus
 * backoff — is
 *
 *   "correct for infrastructure failures and **actively harmful** for reliability
 *    failures."
 *
 * Blindly retrying a hallucination with the identical prompt at temperature 0
 * produces the identical hallucination. You burn tokens and time to arrive at the
 * same wrong answer, and then commit it. The retry did not merely fail to help — it
 * spent money to add latency to a wrong result.
 *
 * So retry is a function of *what went wrong*, and this is where that is decided.
 *
 * THE THREE SHAPES
 * ----------------
 * Every category resolves to one of three strategies, and the distinction is the
 * whole point:
 *
 *   **BACKOFF**   the world was temporarily broken. The same request will work
 *                 later. Wait and repeat it unchanged.
 *   **REPAIR**    the model was wrong in a way it can be told about. Re-call with
 *                 the failure attached. Recovery rates are high.
 *   **ESCALATE**  repeating the request cannot help, whatever the delay. Change
 *                 something — the model, the temperature, the operator — or stop.
 *
 * Getting a category into the wrong shape is expensive in a specific direction:
 * treating an ESCALATE as a BACKOFF burns budget to reproduce a fabrication.
 */
object FailureClassifier {

    /** The nine categories from §5. */
    enum class Kind {
        PROVIDER_429,
        PROVIDER_5XX,
        TIMEOUT,
        SCHEMA_VIOLATION,
        ASSERTION_FAILURE,
        GROUNDEDNESS_FAILURE,
        CONTENT_FILTER,
        TOOL_HALLUCINATION,
        PARSE_ERROR,
        /** Nothing matched. Treated as unretryable — see [strategyFor]. */
        UNKNOWN,
    }

    enum class Strategy {
        /** Wait, then repeat the identical request. */
        BACKOFF,
        /** Re-call with the failure fed back so the model can correct it. */
        REPAIR,
        /** Repeating cannot help. Change the conditions or stop. */
        ESCALATE,
        /** Stop now. */
        FAIL,
    }

    /**
     * What to do about a category.
     *
     * @param maxAttempts additional attempts beyond the first. 0 means no retry.
     * @param suspend     release the worker permit while waiting rather than holding
     *                    it. Only meaningful for BACKOFF.
     */
    data class Policy(
        val strategy: Strategy,
        val maxAttempts: Int,
        val baseBackoffMs: Long = 0,
        val suspend: Boolean = false,
        val rationale: String,
    )

    /**
     * The table from §5, with the reasoning kept attached to each row.
     *
     * The rationale is not documentation for us — it is surfaced in the run detail
     * so a user who sees "not retried" understands why, rather than assuming the
     * platform gave up on them.
     */
    fun policyFor(kind: Kind): Policy = when (kind) {

        Kind.PROVIDER_429 -> Policy(
            Strategy.BACKOFF, maxAttempts = 5, baseBackoffMs = 1_000, suspend = true,
            rationale = "The provider asked us to slow down. The run is suspended rather than " +
                "held, so it does not occupy a worker while waiting.",
        )

        Kind.PROVIDER_5XX -> Policy(
            Strategy.BACKOFF, maxAttempts = 3, baseBackoffMs = 2_000, suspend = false,
            rationale = "The provider is failing. Retried with backoff, then failed over to the " +
                "secondary provider if one is configured.",
        )

        // One retry, not three. A timeout has already cost the full timeout budget;
        // three of them is three times the ceiling spent discovering the same thing.
        Kind.TIMEOUT -> Policy(
            Strategy.BACKOFF, maxAttempts = 1, baseBackoffMs = 1_000,
            rationale = "The call exceeded its time budget. Retried once - a second timeout " +
                "means the request is too large or the provider is degraded, and a third " +
                "attempt only spends the budget again.",
        )

        // The high-yield case. The model produced something structurally wrong and
        // can be told exactly what was wrong; recovery on attempt 2 is common.
        Kind.SCHEMA_VIOLATION -> Policy(
            Strategy.REPAIR, maxAttempts = 2,
            rationale = "The output did not match the declared schema. Re-asked with the " +
                "specific validation error attached.",
        )

        Kind.ASSERTION_FAILURE -> Policy(
            Strategy.REPAIR, maxAttempts = 2,
            rationale = "The output broke a business rule. Re-asked with the specific rule and " +
                "the offending value attached.",
        )

        // The important one. The same prompt at temperature 0 reproduces the same
        // fabrication exactly, so a retry is a guaranteed waste. Escalate: change the
        // conditions or hand it to a human.
        Kind.GROUNDEDNESS_FAILURE -> Policy(
            Strategy.ESCALATE, maxAttempts = 1,
            rationale = "The model cited evidence that is not in the input. Re-asking the same " +
                "question the same way reproduces the same fabrication, so the conditions are " +
                "changed instead - temperature forced to 0, or a stronger model, or a human gate.",
        )

        // Retrying is futile AND makes the product look broken: the user watches
        // three attempts fail identically over ten seconds.
        Kind.CONTENT_FILTER -> Policy(
            Strategy.FAIL, maxAttempts = 0,
            rationale = "The provider's content filter refused this request. Retrying is futile - " +
                "the filter is deterministic - so it fails immediately with an explanation.",
        )

        Kind.TOOL_HALLUCINATION -> Policy(
            Strategy.REPAIR, maxAttempts = 2,
            rationale = "The model called a tool it does not have. Re-asked with the list of " +
                "available tools re-injected.",
        )

        Kind.PARSE_ERROR -> Policy(
            Strategy.REPAIR, maxAttempts = 2,
            rationale = "The response was not valid JSON. Re-asked with the parse error attached.",
        )

        // Fail rather than guess. An unclassified failure retried blindly is exactly
        // the behaviour this class exists to remove; a new failure mode should show
        // up as an unretried failure and get classified, not be silently absorbed.
        Kind.UNKNOWN -> Policy(
            Strategy.FAIL, maxAttempts = 0,
            rationale = "The failure could not be classified, so it was not retried. Retrying " +
                "an unrecognised failure is how a fabrication gets repeated at cost.",
        )
    }

    /** Convenience for callers that only need the shape. */
    fun strategyFor(kind: Kind): Strategy = policyFor(kind).strategy

    /**
     * Classify from what is observable at the call site.
     *
     * Ordered most-specific first. HTTP status is the strongest signal and is
     * checked before message text, because a 429 whose body happens to contain the
     * word "invalid" is still a 429.
     */
    fun classify(
        httpStatus: Int? = null,
        exception: Throwable? = null,
        message: String? = null,
        /** Set when contract validation produced the failure. */
        contractOutcome: ContractSignal? = null,
    ): Kind {
        // Contract signals are unambiguous — they come from our own validator, not
        // from parsing a provider's prose.
        when (contractOutcome) {
            ContractSignal.SCHEMA -> return Kind.SCHEMA_VIOLATION
            ContractSignal.ASSERTION -> return Kind.ASSERTION_FAILURE
            ContractSignal.GROUNDEDNESS -> return Kind.GROUNDEDNESS_FAILURE
            null -> Unit
        }

        httpStatus?.let { status ->
            if (status == 429) return Kind.PROVIDER_429
            if (status in 500..599) return Kind.PROVIDER_5XX
            // 400 with a filter marker is a refusal, not a malformed request.
            if (status == 400 && looksLikeContentFilter(message)) return Kind.CONTENT_FILTER
        }

        val text = buildString {
            message?.let { append(it.lowercase()) }
            exception?.message?.let { append(' ').append(it.lowercase()) }
            exception?.javaClass?.simpleName?.let { append(' ').append(it.lowercase()) }
        }

        return when {
            text.isBlank() -> Kind.UNKNOWN
            looksLikeContentFilter(text) -> Kind.CONTENT_FILTER
            TIMEOUT_MARKERS.any { it in text } -> Kind.TIMEOUT
            PARSE_MARKERS.any { it in text } -> Kind.PARSE_ERROR
            TOOL_MARKERS.any { it in text } -> Kind.TOOL_HALLUCINATION
            RATE_MARKERS.any { it in text } -> Kind.PROVIDER_429
            else -> Kind.UNKNOWN
        }
    }

    /** Which part of the contract produced a failure, when one did. */
    enum class ContractSignal { SCHEMA, ASSERTION, GROUNDEDNESS }

    /**
     * Content-filter markers.
     *
     * Providers word refusals differently and none of them use a distinct status
     * code, so this is substring matching by necessity. A false positive costs a
     * retry that would probably have failed anyway; a false negative costs three
     * futile retries and a confusing user experience — so the list errs towards
     * matching.
     */
    private fun looksLikeContentFilter(text: String?): Boolean {
        val t = text?.lowercase() ?: return false
        return FILTER_MARKERS.any { it in t }
    }

    private val FILTER_MARKERS = listOf(
        "content_filter", "content policy", "content_policy", "safety system",
        "responsible ai", "was filtered", "flagged by", "usage policies",
        "cannot assist", "refused",
    )

    private val TIMEOUT_MARKERS = listOf(
        "timeout", "timed out", "deadline", "read timed out", "sockettimeout",
    )

    private val PARSE_MARKERS = listOf(
        "jsonparse", "json parse", "unexpected character", "unexpected token",
        "malformed json", "could not parse", "failed to parse", "jsonprocessing",
    )

    private val TOOL_MARKERS = listOf(
        "unknown tool", "no such tool", "tool not found", "not granted", "unavailable tool",
    )

    private val RATE_MARKERS = listOf(
        "rate limit", "rate_limit", "too many requests", "quota exceeded",
    )
}
