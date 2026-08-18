package com.vectorbea.worker.reliability

import kotlin.math.pow
import kotlin.random.Random

/**
 * Decides what happens after a classified failure, and builds the repair prompt.
 *
 * THE REPAIR PROMPT IS THE HIGH-YIELD PART
 * ----------------------------------------
 * §5: on a validation failure, re-call with the original prompt *plus* the invalid
 * output *plus* the specific violation.
 *
 *   "Recovery rates on schema and assertion failures are high, and it converts a
 *    run failure into a two-second delay the user never sees."
 *
 * That is the difference between a product that fails 3% of runs and one that
 * fails 0.3% and is a fraction slower on 3%.
 *
 * THE PART THAT IS EASY TO GET WRONG
 * ----------------------------------
 * Not every failure may be repaired, and two of them must be refused loudly:
 *
 *   **groundedness** — the same prompt at temperature 0 reproduces the same
 *   fabrication, deterministically. A repair attempt is not merely unlikely to
 *   help, it is *guaranteed* not to. So the conditions change instead: force
 *   temperature to 0, or move to a stronger model, or hand it to a human.
 *
 *   **content filter** — the filter is deterministic. Three identical refusals over
 *   ten seconds is worse than one immediate, clear failure, because it looks like
 *   the platform is broken rather than like the request was declined.
 *
 * And one that must stop after two: an assertion failing twice on the same rule
 * means the prompt or the contract is wrong, not that the sample was unlucky.
 * Continuing spends money to keep proving the same point.
 */
object RepairStrategy {

    /** What the caller should do next. */
    sealed class Decision {
        /** Wait, then repeat the identical request. */
        data class Backoff(
            val delayMs: Long,
            val suspend: Boolean,
            val attempt: Int,
            val reason: String,
        ) : Decision()

        /** Re-call with the failure fed back. */
        data class Repair(
            val prompt: String,
            val attempt: Int,
            val reason: String,
        ) : Decision()

        /**
         * Repeating cannot help. Change the conditions.
         *
         * [forceTemperatureZero] and [preferStrongerModel] are the two cheap
         * escalations; [requireHumanGate] is the expensive one and is chosen when
         * the cheap ones have already been tried.
         */
        data class Escalate(
            val forceTemperatureZero: Boolean,
            val preferStrongerModel: Boolean,
            val requireHumanGate: Boolean,
            val reason: String,
        ) : Decision()

        /** Stop. [userMessage] is shown in the run detail. */
        data class Fail(val userMessage: String) : Decision()
    }

    /**
     * What to do about this failure, given how many attempts have already happened.
     *
     * @param attemptsSoFar attempts already made, 0 on the first failure.
     * @param sameRuleTwice true when this exact assertion has already failed once.
     *        Passed in rather than inferred, because only the caller knows whether
     *        the previous failure was the *same* rule — and "assertion failed twice"
     *        means something different from "two assertions failed".
     */
    fun decide(
        kind: FailureClassifier.Kind,
        attemptsSoFar: Int,
        detail: FailureDetail,
        sameRuleTwice: Boolean = false,
        hasSecondaryProvider: Boolean = false,
    ): Decision {
        val policy = FailureClassifier.policyFor(kind)

        // Strategy FAIL is checked BEFORE the attempt count, not after.
        //
        // A FAIL policy has maxAttempts = 0, so an exhaustion check placed first
        // matches on the very first failure and returns the generic "retries
        // exhausted" wording - burying the specific explanation that is the entire
        // reason these categories fail fast. A user told "retried 0 times without
        // success" learns nothing; one told "the content filter refused this and
        // retrying is futile" knows what to change.
        if (policy.strategy == FailureClassifier.Strategy.FAIL) {
            return Decision.Fail(
                when (kind) {
                    FailureClassifier.Kind.CONTENT_FILTER ->
                        "The AI provider declined this request under its content policy. " +
                            "This is not retried, because the filter is deterministic and " +
                            "repeating the request produces the same refusal. " +
                            "Adjust the prompt or the input data."
                    else -> detail.message.ifBlank { policy.rationale }
                }
            )
        }

        if (attemptsSoFar >= policy.maxAttempts) {
            return Decision.Fail(exhaustedMessage(kind, attemptsSoFar, detail))
        }

        return when (policy.strategy) {
            // Handled above; unreachable, and named rather than swallowed by `else`
            // so adding a FAIL-shaped category cannot silently skip its message.
            FailureClassifier.Strategy.FAIL -> Decision.Fail(policy.rationale)

            FailureClassifier.Strategy.BACKOFF -> Decision.Backoff(
                delayMs = backoff(policy.baseBackoffMs, attemptsSoFar),
                suspend = policy.suspend,
                attempt = attemptsSoFar + 1,
                reason = policy.rationale,
            )

            FailureClassifier.Strategy.REPAIR -> {
                // Two failures on the same rule is a contract or prompt problem, not
                // an unlucky sample. Stop rather than pay to prove it a third time.
                if (sameRuleTwice) {
                    return Decision.Fail(
                        "The same rule failed twice: " + detail.message + " Two failures on one " +
                            "rule mean the prompt or the contract is wrong rather than the " +
                            "response being unlucky, so this was not retried again. Review the " +
                            "assertion and the node's instructions."
                    )
                }
                Decision.Repair(
                    prompt = repairPrompt(kind, detail),
                    attempt = attemptsSoFar + 1,
                    reason = policy.rationale,
                )
            }

            FailureClassifier.Strategy.ESCALATE -> Decision.Escalate(
                // First escalation is the cheap one; if it already ran at
                // temperature 0 there is nothing left but a stronger model or a human.
                forceTemperatureZero = !detail.wasTemperatureZero,
                preferStrongerModel = detail.wasTemperatureZero && hasSecondaryProvider,
                requireHumanGate = detail.wasTemperatureZero && !hasSecondaryProvider,
                reason = policy.rationale,
            )
        }
    }

    /** Everything the repair prompt needs to be specific. */
    data class FailureDetail(
        /** The user-facing description of what went wrong. */
        val message: String,
        /** The original rendered prompt, so the repair carries the full task. */
        val originalPrompt: String = "",
        /** The output that failed, verbatim. */
        val invalidOutput: String = "",
        /** The declared schema, when the failure was structural. */
        val schemaJson: String? = null,
        /** Tools the model may actually call, for a hallucinated tool call. */
        val availableTools: List<String> = emptyList(),
        val wasTemperatureZero: Boolean = false,
    )

    /**
     * The repair prompt.
     *
     * Three parts, and all three are load-bearing:
     *
     *   1. the original task, so the model still knows what it is doing;
     *   2. **its own invalid output**, so it can see what it produced rather than
     *      guessing from a description;
     *   3. the specific violation, in the same words the user would see.
     *
     * A repair prompt that only says "that was invalid, try again" recovers barely
     * better than a blind retry. The specificity is where the recovery rate comes
     * from.
     */
    fun repairPrompt(kind: FailureClassifier.Kind, d: FailureDetail): String = buildString {
        appendLine("Your previous response was rejected. Correct it and return only the corrected output.")
        appendLine()

        if (d.originalPrompt.isNotBlank()) {
            appendLine("--- The original request ---")
            appendLine(d.originalPrompt)
            appendLine()
        }

        appendLine("--- What you returned ---")
        appendLine(d.invalidOutput.ifBlank { "(empty response)" })
        appendLine()

        appendLine("--- Why it was rejected ---")
        appendLine(d.message)
        appendLine()

        when (kind) {
            FailureClassifier.Kind.SCHEMA_VIOLATION -> {
                d.schemaJson?.let {
                    appendLine("--- The required structure ---")
                    appendLine(it)
                    appendLine()
                }
                appendLine("Return the same information in the required structure. " +
                    "Do not add commentary, and do not wrap the JSON in code fences.")
            }

            FailureClassifier.Kind.ASSERTION_FAILURE ->
                appendLine("Return a corrected response that satisfies the rule above. " +
                    "If the input genuinely does not support a value that satisfies it, say so " +
                    "rather than inventing one that does.")

            FailureClassifier.Kind.TOOL_HALLUCINATION -> {
                appendLine("--- The tools you may call ---")
                if (d.availableTools.isEmpty()) appendLine("(none - answer directly)")
                else d.availableTools.forEach { appendLine("- $it") }
                appendLine()
                appendLine("Call only a tool from that list, or answer directly. " +
                    "Do not invent a tool name.")
            }

            FailureClassifier.Kind.PARSE_ERROR ->
                appendLine("Return valid JSON only. No prose before or after it, and no code fences.")

            else ->
                appendLine("Return a corrected response.")
        }
    }.trim()

    /**
     * Exponential backoff with full jitter.
     *
     * Full jitter — a uniform draw across the window rather than a fixed delay plus
     * a small random — because N runs failing against the same provider at the same
     * instant will otherwise retry at the same instant and reproduce the overload
     * they are backing off from.
     */
    private fun backoff(baseMs: Long, attempt: Int): Long {
        if (baseMs <= 0) return 0
        val cap = (baseMs * 2.0.pow(attempt.coerceIn(0, 8))).toLong().coerceAtMost(MAX_BACKOFF_MS)
        return Random.nextLong(baseMs, cap.coerceAtLeast(baseMs + 1))
    }

    private const val MAX_BACKOFF_MS = 60_000L

    private fun exhaustedMessage(
        kind: FailureClassifier.Kind, attempts: Int, d: FailureDetail,
    ): String {
        val policy = FailureClassifier.policyFor(kind)
        if (policy.maxAttempts == 0) {
            return d.message.ifBlank { policy.rationale }
        }
        return d.message.ifBlank { policy.rationale } +
            " Retried " + attempts + " time" + (if (attempts == 1) "" else "s") +
            " without success, which is the limit for this kind of failure."
    }
}
