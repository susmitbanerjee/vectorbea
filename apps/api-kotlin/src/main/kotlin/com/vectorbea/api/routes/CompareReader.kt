package com.vectorbea.api.routes

/**
 * "It worked yesterday" — answered with the first thing that changed.
 *
 * ── WHY THE DIVERGENCE POINT IS THE WHOLE ANSWER ────────────────────────────
 * A list of differences is not a reply. Two runs of one workflow diverge once
 * and then differ in everything downstream of that, so a view that shows twelve
 * deltas equally has buried its answer among its own symptoms. The useful output
 * is the FIRST node that differs; everything after it is a consequence.
 *
 * ── HOW TWO RUNS ARE MATCHED ────────────────────────────────────────────────
 * On `(step_id, kind, name, occurrence)`, never on span id — a span id is random
 * per run, so an id diff is two lists that share nothing. The occurrence index
 * distinguishes a node that ran three times from one that ran once, which is the
 * difference between "the retry loop got longer" and "nothing changed".
 */
object CompareReader {

    /** One span, narrowed to what a comparison can use. */
    data class Span(
        val stepId: String?,
        val kind: String,
        val name: String,
        val status: String,
        val durationMs: Int?,
        val tokens: Long,
        val costCents: Double,
        val model: String?,
        val iterationIndex: Int?,
        /**
         * SHA-256 of the payload content.
         *
         * Which makes a ref comparison a CONTENT comparison, with no payload
         * moved: two runs whose tool returned different data have different
         * output refs, and that is the cheapest exact answer to "did the tool
         * come back with something else".
         */
        val inputRef: String?,
        val outputRef: String?,
        val contextChars: Int?,
    ) {
        /** Stable across runs. See the header. */
        fun matchKey(occurrence: Int): String =
            "${stepId ?: ""}|$kind|$name|$occurrence"
    }

    data class Delta(val field: String, val a: Any?, val b: Any?, val note: String?)

    data class NodeDiff(
        val key: String,
        val name: String,
        val kind: String,
        val stepId: String?,
        /** "both" · "onlyA" · "onlyB". */
        val presence: String,
        val statusA: String?,
        val statusB: String?,
        val deltas: List<Delta>,
        /** True when this node meets the bar for a divergence. See [isDivergent]. */
        val divergent: Boolean,
    )

    /** Why a comparison could not be made. Null when it could. */
    data class Refusal(val reason: String, val explanation: String, val offer: String)

    data class Comparison(
        val sameVersion: Boolean,
        val refusal: Refusal?,
        val divergenceKey: String?,
        val nodes: List<NodeDiff>,
        val onlyInA: Int,
        val onlyInB: Int,
    )

    /**
     * A duration change worth calling a divergence.
     *
     * BOTH an absolute and a relative floor. Absolute alone flags every 300ms
     * wobble on a four-minute span; relative alone flags a 2ms span that took
     * 6ms. A change has to be both big enough to notice and big enough to
     * matter.
     */
    const val DURATION_ABS_MS = 250
    const val DURATION_REL = 0.25

    /**
     * Compare two runs.
     *
     * Refuses across workflow versions rather than producing a diff that reads
     * like a behaviour change when it is a code change — see [Refusal].
     */
    fun compare(
        a: List<Span>,
        b: List<Span>,
        versionA: String?,
        versionB: String?,
        sameRun: Boolean,
    ): Comparison {
        val sameVersion = versionA != null && versionA == versionB

        if (!sameVersion && !sameRun) {
            /*
             * ── WHY THIS REFUSES INSTEAD OF DIFFING ─────────────────────────
             * Across versions every difference has two possible causes — the
             * workflow changed, or the run behaved differently — and the diff
             * cannot tell them apart. Shown anyway it reads as a behaviour
             * change, which sends somebody hunting a flaky tool when a colleague
             * edited a prompt. "It worked yesterday" has a different answer when
             * yesterday's workflow was a different workflow.
             */
            return Comparison(
                sameVersion = false,
                refusal = Refusal(
                    reason = "different workflow versions",
                    explanation =
                        "These runs executed different versions of the workflow, so a " +
                        "node-by-node diff cannot tell a behaviour change from an edit. " +
                        "Every difference below would have two possible causes and no way " +
                        "to choose between them.",
                    offer = "Compare the two workflow versions instead, then compare two runs " +
                        "of the same version.",
                ),
                divergenceKey = null, nodes = emptyList(), onlyInA = 0, onlyInB = 0,
            )
        }

        val keyed = { list: List<Span> ->
            val seen = HashMap<String, Int>()
            list.map { s ->
                val base = "${s.stepId ?: ""}|${s.kind}|${s.name}"
                val n = seen.merge(base, 1, Int::plus)!! - 1
                s.matchKey(n) to s
            }
        }
        val ka = keyed(a)
        val kb = keyed(b).toMap()
        val kaMap = ka.toMap()

        val nodes = mutableListOf<NodeDiff>()

        /* A's nodes in execution order, which is the order the answer is read. */
        for ((key, sa) in ka) {
            val sb = kb[key]
            if (sb == null) {
                nodes += NodeDiff(
                    key = key, name = sa.name, kind = sa.kind, stepId = sa.stepId,
                    presence = "onlyA", statusA = sa.status, statusB = null,
                    deltas = emptyList(), divergent = true,
                )
                continue
            }
            val deltas = deltasBetween(sa, sb)
            nodes += NodeDiff(
                key = key, name = sa.name, kind = sa.kind, stepId = sa.stepId,
                presence = "both", statusA = sa.status, statusB = sb.status,
                deltas = deltas, divergent = isDivergent(deltas),
            )
        }

        /* Then B's extras, so "present in one and not the other" is symmetric. */
        for ((key, sb) in kb) {
            if (key in kaMap) continue
            nodes += NodeDiff(
                key = key, name = sb.name, kind = sb.kind, stepId = sb.stepId,
                presence = "onlyB", statusA = null, statusB = sb.status,
                deltas = emptyList(), divergent = true,
            )
        }

        return Comparison(
            sameVersion = sameVersion,
            refusal = null,
            divergenceKey = nodes.firstOrNull { it.divergent }?.key,
            nodes = nodes,
            onlyInA = nodes.count { it.presence == "onlyA" },
            onlyInB = nodes.count { it.presence == "onlyB" },
        )
    }

    /**
     * Which differences make a node the divergence point.
     *
     * ── WHY NOT EVERY DELTA ─────────────────────────────────────────────────
     * Token counts wobble between two identical runs and durations always
     * differ; treating either as a divergence puts the answer on the first span
     * of every comparison and makes the feature useless. What actually marks the
     * point where two runs parted company:
     *
     *   status       one succeeded and one did not.
     *   output ref   a SHA-256 of the content, so a different ref is a different
     *                RESULT — the tool came back with something else. This is the
     *                one the original implementation had no way to see, and it is
     *                the commonest cause of "it worked yesterday".
     *   input ref    the node was CALLED with something different, which usually
     *                means the divergence is upstream and this is the symptom.
     *   model        a different model is a different run, whatever else matches.
     *   duration     only past both an absolute and a relative floor.
     *
     * Tokens and iteration index are reported but never divergent on their own.
     */
    fun isDivergent(deltas: List<Delta>): Boolean =
        deltas.any { it.field in DIVERGENT_FIELDS }

    private val DIVERGENT_FIELDS = setOf(
        "status", "outputRef", "inputRef", "model", "durationMs",
    )

    private fun deltasBetween(a: Span, b: Span): List<Delta> = buildList {
        if (a.status != b.status) {
            add(Delta("status", a.status, b.status,
                "One run's ${a.kind} ${a.status}; the other's ${b.status}."))
        }
        if (a.outputRef != b.outputRef && (a.outputRef != null || b.outputRef != null)) {
            add(Delta("outputRef", short(a.outputRef), short(b.outputRef),
                "This ${labelFor(a.kind)} returned different content. The reference is a " +
                "hash of the result, so a different one means the result itself differed."))
        }
        if (a.inputRef != b.inputRef && (a.inputRef != null || b.inputRef != null)) {
            add(Delta("inputRef", short(a.inputRef), short(b.inputRef),
                "It was called with different input, so the cause is probably upstream " +
                "of this node."))
        }
        if (a.model != b.model && (a.model != null || b.model != null)) {
            add(Delta("model", a.model, b.model, "A different model answered."))
        }
        if (a.contextChars != null && b.contextChars != null && a.contextChars != b.contextChars) {
            add(Delta("contextChars", a.contextChars, b.contextChars,
                if (a.contextChars > b.contextChars)
                    "The prompt was longer in this run."
                else "The prompt was shorter in this run."))
        }
        if (a.durationMs != null && b.durationMs != null && movedEnough(a.durationMs, b.durationMs)) {
            add(Delta("durationMs", a.durationMs, b.durationMs, null))
        }
        if (a.tokens != b.tokens) add(Delta("tokens", a.tokens, b.tokens, null))
        if (a.costCents != b.costCents) {
            add(Delta("costCents", round4(a.costCents), round4(b.costCents), null))
        }
        if (a.iterationIndex != b.iterationIndex) {
            add(Delta("iterationIndex", a.iterationIndex, b.iterationIndex, null))
        }
    }

    /** Both floors, so neither a long span's wobble nor a short span's jitter counts. */
    fun movedEnough(a: Int, b: Int): Boolean {
        val diff = Math.abs(a - b)
        if (diff < DURATION_ABS_MS) return false
        val base = maxOf(1, minOf(a, b))
        return diff.toDouble() / base >= DURATION_REL
    }

    private fun labelFor(kind: String): String = when (kind) {
        "tool_call" -> "tool call"
        "llm_call" -> "model call"
        else -> kind.replace('_', ' ')
    }

    /** A content hash, shortened. The whole 64 characters says nothing extra. */
    private fun short(ref: String?): String? = ref?.take(12)

    private fun round4(v: Double): Double = Math.round(v * 10_000.0) / 10_000.0
}
