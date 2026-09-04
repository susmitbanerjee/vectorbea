package com.vectorbea.worker.agents.tools

import com.fasterxml.jackson.databind.ObjectMapper

/**
 * A tool failure, in a shape an agent can act on.
 *
 * ── WHY `HTTP 403` COSTS ITERATIONS ─────────────────────────────────────────
 * A status code tells a model that something went wrong and nothing about what to
 * do next, so it does the only thing its instructions offer: try again, usually
 * rephrasing the input, until the iteration ceiling stops it. Every one of those
 * is a model call, a provider request, a share of the rate limit, and a step
 * closer to a run that fails having achieved nothing.
 *
 * The fix is not a better message. It is a `retryable` flag the agent is told to
 * obey, next to a sentence saying what would actually fix it. "Auth failed;
 * retrying will not help; the credential needs reconnecting" ends the loop in one
 * iteration instead of eight.
 *
 * ── THE DEFAULTS ARE NOT A FALLBACK, THEY ARE THE CONTRACT FOR MOST TOOLS ───
 * HTTP status semantics are standard, so a tool that declares no error rules
 * still gets a correct classification from [ofStatus]. A tool declares rules to
 * override that — a vendor returning 200 with an error body, a 403 that really
 * does mean "rate limited" — not to obtain the obvious.
 *
 * That matters for adoption: the error half of a contract is useful before anyone
 * has written one.
 */
data class ToolErrorShape(
    /** `auth` | `not_found` | `invalid_input` | `rate_limit` | `server` | `unknown`. */
    val kind: String,
    /** Whether trying the same thing again could plausibly work. */
    val retryable: Boolean,
    /** What failed, in one line, for the model. */
    val what: String,
    /** What would fix it, in the operator's terms. Null when we genuinely do not know. */
    val fix: String? = null,
    /** The provider's own status, kept for the debugger. */
    val status: Int? = null,
) {
    /**
     * The observation the model reads.
     *
     * Written as prose rather than JSON on purpose. This is the one place where a
     * sentence outperforms a structure: the instruction "do not retry" has to be
     * unmissable, and a model skimming `{"retryable": false}` inside a wrapper
     * reliably retries anyway. The flag is in there too, for anything parsing it.
     */
    fun asObservation(): String = buildString {
        append(what)
        append(if (retryable) " Retrying may help." else " Retrying will NOT help.")
        fix?.let { append(" To fix: $it") }
        if (!retryable) {
            /* The explicit next action. Without it a model that has been told not
               to retry still has to invent what to do instead, and inventing
               usually means retrying with different words. */
            append(" Do not call this tool again with the same input — either use a " +
                   "different approach or FAIL with this reason.")
        }
    }

    companion object {
        private val mapper = ObjectMapper()

        /**
         * Classify a failure: the tool's own rules first, then HTTP semantics.
         *
         * The tool wins because it knows its vendor. A first match wins so a
         * contract can put a specific rule ahead of a general one, in declaration
         * order — the same rule an operator would expect from a firewall or a
         * router, and the one they will assume without reading.
         */
        fun of(
            contract: ToolResultContract?,
            status: Int?,
            body: String?,
            fallbackMessage: String?,
        ): ToolErrorShape {
            contract?.errors?.firstOrNull { it.matches(status, body) }?.let { rule ->
                return ToolErrorShape(
                    kind = rule.kind,
                    retryable = rule.retryable,
                    what = whatFor(rule.kind, status, fallbackMessage),
                    fix = rule.fix,
                    status = status,
                )
            }
            return ofStatus(status, fallbackMessage)
        }

        /**
         * HTTP status semantics, as the default contract.
         *
         * The `retryable` column is the whole point, so each value states its
         * reasoning:
         *
         *   401/403 — a credential does not become valid by being used again.
         *   404     — the thing is not there; asking a second time does not create it.
         *   400/422 — the INPUT is wrong. Retrying identically cannot work, though
         *             a different input might, which is why the message says to
         *             change it rather than to stop entirely.
         *   429     — genuinely transient, and the only status where retrying is
         *             the correct behaviour rather than a waste.
         *   5xx     — the provider is having a problem that may pass.
         */
        fun ofStatus(status: Int?, message: String?): ToolErrorShape = when (status) {
            401, 403 -> ToolErrorShape(
                kind = "auth", retryable = false, status = status,
                what = "The tool could not authenticate (HTTP $status).",
                fix = "Reconnect this tool's credential in Connections — it is missing, " +
                      "expired, or lacks the scope this call needs.")

            404 -> ToolErrorShape(
                kind = "not_found", retryable = false, status = status,
                what = "The tool found no such record (HTTP 404).",
                fix = "Check the identifier. If you are searching, use a search tool " +
                      "rather than a direct lookup.")

            400, 422 -> ToolErrorShape(
                kind = "invalid_input", retryable = false, status = status,
                what = "The tool rejected the input as invalid (HTTP $status)" +
                       (message?.take(200)?.let { ": $it" } ?: "."),
                fix = "Correct the input to match the tool's schema. The SAME input " +
                      "will be rejected again.")

            429 -> ToolErrorShape(
                kind = "rate_limit", retryable = true, status = status,
                what = "The tool was rate limited (HTTP 429).",
                fix = "Wait before calling it again. The runtime handles the backoff.")

            in 500..599 -> ToolErrorShape(
                kind = "server", retryable = true, status = status,
                what = "The tool's provider returned an error (HTTP $status).",
                fix = "The provider is having a problem. Retrying once is reasonable; " +
                      "repeated failures are not something this agent can fix.")

            else -> ToolErrorShape(
                kind = "unknown", retryable = false, status = status,
                /*
                 * Unknown defaults to NOT retryable, and that is the deliberate
                 * direction. The cost of not retrying something that would have
                 * worked is one lost opportunity; the cost of retrying something
                 * that never will is the loop this class exists to end.
                 */
                what = message?.take(300) ?: "The tool failed for an unknown reason.",
                fix = null)
        }

        private fun whatFor(kind: String, status: Int?, message: String?): String = when (kind) {
            "auth" -> "The tool could not authenticate" + (status?.let { " (HTTP $it)" } ?: "") + "."
            "not_found" -> "The tool found no such record" + (status?.let { " (HTTP $it)" } ?: "") + "."
            "invalid_input" -> "The tool rejected the input as invalid" +
                (message?.take(200)?.let { ": $it" } ?: ".")
            "rate_limit" -> "The tool was rate limited" + (status?.let { " (HTTP $it)" } ?: "") + "."
            "server" -> "The tool's provider returned an error" + (status?.let { " (HTTP $it)" } ?: "") + "."
            else -> message?.take(300) ?: "The tool failed."
        }

        /**
         * Pull `(status, body)` out of a failed tool result.
         *
         * A failure reaches the brain either as a `NodeResult.Failed` message or as
         * a `Completed` carrying a non-2xx `statusCode` — HTTP tools return the
         * latter, because a 404 is a legitimate answer to a lookup and failing the
         * node would end the run. Both are read here so the contract applies
         * however the tool chose to report.
         */
        fun statusOf(result: Map<String, Any?>?): Int? =
            (result?.get("statusCode") as? Number)?.toInt()

        fun bodyTextOf(result: Map<String, Any?>?): String? {
            val b = result?.get("body") ?: return null
            return runCatching { mapper.writeValueAsString(b) }.getOrNull()?.take(1_000)
        }
    }
}
