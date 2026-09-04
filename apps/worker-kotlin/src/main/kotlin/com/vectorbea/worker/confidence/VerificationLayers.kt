package com.vectorbea.worker.confidence

import kotlin.math.abs

/**
 * Layer 4: the expensive verification, opt-in per node.
 *
 * WHY COST IS PART OF THE API AND NOT JUST THE DOCS
 * -------------------------------------------------
 * §10 of the reliability doc is blunt that reliability is a spend decision per node,
 * and §4 that both of these are opt-in "with the cost shown in the UI at
 * configuration time, so the user makes an informed trade".
 *
 * So [costDelta] is a first-class function here, not a note in a README. A toggle
 * that triples a node's bill without saying so is a support ticket and a refund;
 * one labelled "+200% cost at N=3" is a decision the user made.
 *
 * NEITHER IS A DEFAULT
 * --------------------
 * Self-consistency at N=3 costs three times as much for a signal that Layers 0-2
 * already approximate for free. It earns its place only on irreversible decisions —
 * and those are exactly where a human gate is also appropriate, so in practice a
 * user picks one or the other rather than both.
 */
object VerificationLayers {

    /** What enabling a layer costs, as a multiplier and as prose. */
    data class Cost(val multiplier: Double, val label: String, val explanation: String)

    /**
     * Self-consistency: sample N times and compare.
     *
     * N samples means N calls, so the delta is (N-1)x on top of the one call the node
     * would have made anyway.
     */
    fun selfConsistencyCost(samples: Int): Cost {
        if (samples <= 1) return Cost(0.0, "No extra cost", "Self-consistency is off.")
        val extra = (samples - 1) * 100
        return Cost(
            multiplier = (samples - 1).toDouble(),
            label = "+$extra% cost",
            explanation = "This node will call the model $samples times instead of once and " +
                "compare the answers. Disagreement between samples is itself a strong signal " +
                "that the model is unsure.",
        )
    }

    /**
     * Critic pass: a cheap model checks the expensive model's work.
     *
     * ~20%, because the critic sees the same input and output but produces a short
     * verdict rather than a full answer — and is expected to be a cheaper model.
     */
    fun criticCost(): Cost = Cost(
        multiplier = 0.20,
        label = "+~20% cost",
        explanation = "A second, cheaper model checks this output against the source and the " +
            "contract. Good general-purpose insurance on extraction nodes.",
    )

    /** Combined delta for the inspector, so a user enabling both sees the real number. */
    fun totalCost(samples: Int, critic: Boolean): Cost {
        val sc = selfConsistencyCost(samples)
        val cr = if (critic) criticCost() else Cost(0.0, "", "")
        val total = sc.multiplier + cr.multiplier
        if (total <= 0.0) return Cost(0.0, "No extra cost", "No verification layers are enabled.")
        return Cost(
            multiplier = total,
            label = "+" + Math.round(total * 100) + "% cost",
            explanation = listOfNotNull(
                sc.explanation.takeIf { sc.multiplier > 0 },
                cr.explanation.takeIf { cr.multiplier > 0 },
            ).joinToString(" "),
        )
    }

    // ── Self-consistency aggregation ────────────────────────────────────────

    data class Agreement(
        /** 0..1 — the share of samples that agreed with the chosen answer. */
        val score: Double,
        /** The answer to use: the majority for discrete, the median for numeric. */
        val chosen: Any?,
        val explanation: String,
    )

    /**
     * Reduce N samples to one answer plus an agreement score.
     *
     * Discrete values take the **majority**; numeric values take the **median**.
     *
     * Median rather than mean for numbers, deliberately: a single wild sample —
     * exactly the hallucination this layer exists to catch — drags a mean and does
     * not move a median. Taking the mean would let the outlier contaminate the very
     * answer the layer was meant to protect.
     */
    fun aggregate(samples: List<Any?>): Agreement {
        val present = samples.filterNotNull()
        if (present.isEmpty()) {
            return Agreement(0.0, null, "Every sample was empty.")
        }
        if (present.size == 1) {
            return Agreement(1.0, present.first(), "Only one sample was produced.")
        }

        val numbers = present.mapNotNull { asNumber(it) }
        if (numbers.size == present.size) {
            val sorted = numbers.sorted()
            val median = if (sorted.size % 2 == 1) sorted[sorted.size / 2]
                         else (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]) / 2.0

            // Agreement for numbers is closeness to the median, not equality: two
            // samples of 41 and 42 agree in every sense that matters, and scoring
            // them as total disagreement would gate every numeric extraction.
            val spread = sorted.last() - sorted.first()
            val scale = maxOf(abs(median), 1.0)
            val score = (1.0 - (spread / scale).coerceAtMost(1.0)).coerceIn(0.0, 1.0)

            return Agreement(
                score, median,
                if (score > 0.9) "The samples agreed closely (median $median)."
                else "The samples varied between ${sorted.first()} and ${sorted.last()}, " +
                    "which suggests the model is not settled on a value.",
            )
        }

        // Discrete: majority wins, agreement is its share.
        val counts = present.groupingBy { normalise(it) }.eachCount()
        val (winner, count) = counts.maxByOrNull { it.value }!!
        val score = count.toDouble() / present.size
        val chosen = present.first { normalise(it) == winner }

        return Agreement(
            score, chosen,
            if (score >= 0.999) "All ${present.size} samples produced the same answer."
            else "$count of ${present.size} samples agreed. The others differed, which is a " +
                "sign the model is uncertain.",
        )
    }

    /**
     * The critic's prompt.
     *
     * Asks for a verdict with a reason, not a score. Models are poor at producing
     * calibrated numbers on demand and good at saying what is wrong; the number is
     * derived from the verdict here rather than requested from the model.
     */
    fun criticPrompt(source: String, output: String, contractSummary: String): String = """
        You are checking another model's work. Do not redo the task.

        --- The source material ---
        $source

        --- What the other model produced ---
        $output

        --- What it was required to produce ---
        $contractSummary

        Answer with JSON only:
        {"verdict": "correct" | "questionable" | "wrong",
         "reason": "<one sentence naming the specific problem, or why it is correct>"}

        Judge only whether the output is supported by the source and satisfies the
        requirements. A value that is plausible but not present in the source is
        "wrong", not "questionable".
    """.trimIndent()

    /**
     * Map a critic verdict onto 0..1.
     *
     * "questionable" is 0.5 rather than something more precise because that is
     * genuinely what it means — the critic is unsure — and inventing 0.55 would
     * imply a resolution the signal does not have.
     */
    fun criticScore(verdict: String?): Double? = when (verdict?.lowercase()?.trim()) {
        "correct" -> 1.0
        "questionable" -> 0.5
        "wrong" -> 0.0
        else -> null
    }

    private fun asNumber(v: Any?): Double? = when (v) {
        is Number -> v.toDouble()
        is String -> v.trim().toDoubleOrNull()
        else -> null
    }

    /** Compare discrete answers case- and whitespace-insensitively. */
    private fun normalise(v: Any?): String =
        v?.toString()?.trim()?.lowercase()?.replace(Regex("\\s+"), " ") ?: ""
}
