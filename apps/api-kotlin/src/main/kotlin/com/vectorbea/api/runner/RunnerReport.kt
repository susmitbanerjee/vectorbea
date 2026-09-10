package com.vectorbea.api.runner

/**
 * What a self-hosted runner is allowed to tell us.
 *
 * ── THIS IS THE PRODUCT, NOT A VALIDATION LAYER ─────────────────────────────
 * A customer buys a self-hosted runner to be able to say, to their own security
 * review, that prompts and tool results never leave their network. Everything
 * else about the feature — the pool, the token, the lease — is plumbing. This
 * file is the sentence they are buying, and it has to be true by construction
 * rather than by care.
 *
 * ── SO IT IS AN ALLOW-LIST, AND IT IS ENFORCED AT THE RECEIVING END ─────────
 * Two decisions, both load-bearing.
 *
 * An ALLOW-LIST because a deny-list is a list of the leaks somebody thought of.
 * A runner reporting a field we have not named is a runner reporting a field
 * that gets dropped, which is the failure mode that degrades a feature rather
 * than breaching a promise. The reverse — an unnamed field passed through — is
 * a customer's data in our database and a broken commitment, discovered by
 * them.
 *
 * Enforced HERE rather than in the runner because a runner is software the
 * customer deploys. It may be an old build, a patched build, or a build that
 * was configured wrong; none of those are things we can see. A guarantee that
 * depends on the remote side having redacted correctly is not a guarantee, it
 * is a hope with a version number.
 */
object RunnerReport {

    /** What a pool permits across the perimeter. */
    enum class PayloadPolicy(val wire: String) {
        /**
         * Metadata only. Nothing a person typed, nothing a tool returned,
         * nothing a model produced.
         */
        STRICT("strict"),

        /**
         * Metadata, plus sanitized error text.
         *
         * A real widening, and named as one: an error message can carry a
         * fragment of the data that caused it — a row that failed to parse, a
         * URL with an id in it. It exists because a failed run with no message
         * is close to unsupportable, and most customers decide that trade
         * deliberately. The default is the other one.
         */
        METADATA_PLUS_ERRORS("metadata_plus_errors");

        companion object {
            fun of(wire: String?): PayloadPolicy =
                entries.firstOrNull { it.wire == wire?.lowercase()?.trim() } ?: STRICT
        }
    }

    /**
     * The fields a runner may report on an event.
     *
     * Every one of these is a NUMBER, an IDENTIFIER or an ENUM. None of them can
     * carry a fragment of a prompt, a tool argument or a model output, and that
     * is the test any addition has to pass.
     *
     * `stepId` is a node id from the graph the customer wrote — it is their own
     * label for their own step, already in our database as part of the workflow
     * version, so reporting it back crosses no boundary.
     */
    val ALLOWED_EVENT_FIELDS: Set<String> = setOf(
        "type", "status", "stepId", "agentId", "modelName",
        "tokenCount", "estimatedCost", "durationMs", "retryAttempt",
        "sequence", "occurredAt",
    )

    /**
     * Fields that carry content, and are dropped under every policy except
     * where [PayloadPolicy.METADATA_PLUS_ERRORS] names them.
     *
     * Not used for filtering — [ALLOWED_EVENT_FIELDS] does that. This exists so
     * a dropped field can be COUNTED and named in the log, because "the runner
     * tried to send us payloads" is something an operator wants to know: it
     * means a misconfigured or outdated runner, and it means the customer's
     * guarantee was being relied on rather than enforced.
     */
    val CONTENT_FIELDS: Set<String> = setOf(
        "title", "summary", "meta", "error", "errorSanitized",
        "input", "output", "payload", "prompt", "response", "content",
        "toolArguments", "toolResult", "messages",
    )

    /** Error text is the one content field a widened policy accepts. */
    val ERROR_FIELDS: Set<String> = setOf("error", "errorSanitized")

    /** What a report contained, and what was refused. */
    data class Filtered(
        val kept: Map<String, Any?>,
        /** Field names that were dropped. Names only — never their values. */
        val dropped: List<String>,
    ) {
        val droppedPayload: Boolean get() = dropped.isNotEmpty()
    }

    /**
     * Strip an event reported by a runner down to what its pool permits.
     *
     * ── THE DROPPED LIST HOLDS NAMES, NEVER VALUES ──────────────────────────
     * It is logged and counted, and a log line is a place data ends up in a
     * search index, a support ticket and a screenshot. Recording that a runner
     * sent `toolResult` is useful; recording what was in it would reproduce the
     * leak inside the diagnostic for the leak.
     */
    fun filterEvent(raw: Map<String, Any?>, policy: PayloadPolicy): Filtered {
        val kept = LinkedHashMap<String, Any?>()
        val dropped = mutableListOf<String>()

        for ((key, value) in raw) {
            when {
                key in ALLOWED_EVENT_FIELDS -> kept[key] = value

                policy == PayloadPolicy.METADATA_PLUS_ERRORS && key in ERROR_FIELDS -> {
                    /*
                     * Capped as well as permitted. A stack trace or a dumped
                     * request body arrives as "an error message", and the cap is
                     * what stops a widened policy becoming an unbounded one.
                     */
                    kept[key] = (value as? String)?.take(MAX_ERROR_CHARS)
                    if ((value as? String)?.length ?: 0 > MAX_ERROR_CHARS) dropped += "$key:truncated"
                }

                /* Silently ignored rather than dropped-and-counted: a runner
                   sending a field we do not know about is a version skew, not
                   an attempted leak, and counting it would make the metric that
                   matters unreadable. */
                value == null -> Unit

                else -> dropped += key
            }
        }
        return Filtered(kept, dropped)
    }

    /**
     * The run's own terminal report.
     *
     * `outputJson` is absent by design and there is no policy that adds it. A
     * run's output is the most concentrated form of exactly what the customer
     * deployed a runner to keep inside — and unlike an error message, there is
     * no support argument for it: the output is delivered to wherever they told
     * it to go, by a delivery target inside their network, without passing
     * through us.
     */
    fun filterCompletion(raw: Map<String, Any?>, policy: PayloadPolicy): Filtered {
        val allowed = setOf(
            "status", "durationMs", "tokenCount", "estimatedCost",
            "nodeTotal", "nodeCommitted", "droppedSpans", "finishedAt",
        )
        val kept = LinkedHashMap<String, Any?>()
        val dropped = mutableListOf<String>()
        for ((key, value) in raw) {
            when {
                key in allowed -> kept[key] = value
                policy == PayloadPolicy.METADATA_PLUS_ERRORS && key in ERROR_FIELDS ->
                    kept[key] = (value as? String)?.take(MAX_ERROR_CHARS)
                value == null -> Unit
                else -> dropped += key
            }
        }
        return Filtered(kept, dropped)
    }

    /**
     * How a failed run is described when its text stays behind.
     *
     * ── A RUN THAT FAILED FOR NO STATED REASON IS THE BAD SCREEN ────────────
     * Under `strict` we have a classification and nothing else, and the
     * temptation is to store nothing. That produces a failed run whose detail
     * panel is empty, which reads as a broken product rather than as a
     * deliberate policy — the exact failure the acceptance criterion calls out.
     *
     * So the classification becomes a sentence, written here, that says what
     * happened, says why there is no more, and says what to do about it.
     */
    fun explainWithheldFailure(classification: String?, poolName: String?): String {
        val what = when (classification?.lowercase()) {
            "timeout" -> "A step exceeded its timeout"
            "provider_error" -> "A model provider returned an error"
            "tool_error" -> "A tool call failed"
            "validation" -> "Output did not match the declared schema"
            "cancelled" -> "The run was cancelled"
            "ceiling" -> "The run hit one of its ceilings"
            null, "" -> "The run failed"
            else -> "The run failed (${classification.take(60)})"
        }
        val where = poolName?.let { " on your self-hosted runner pool '$it'" } ?: " on a self-hosted runner"
        return "$what$where. The message stayed inside your network, which is what a " +
            "self-hosted runner is for — it is in that runner's own logs. To see failure " +
            "messages here instead, set the pool's payload policy to `metadata_plus_errors`."
    }

    /**
     * 2 KB.
     *
     * Long enough for a real error message and its first frame; far short of a
     * request body somebody logged as an error, which is the shape a widened
     * policy would otherwise let through unbounded.
     */
    const val MAX_ERROR_CHARS = 2_000
}
