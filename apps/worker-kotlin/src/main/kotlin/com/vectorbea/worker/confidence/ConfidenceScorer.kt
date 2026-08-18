package com.vectorbea.worker.confidence

import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.min

/**
 * How sure the system is that a node's output is right.
 *
 * WHY THIS IS THE PRODUCT AND NOT JUST PLUMBING
 * ---------------------------------------------
 * §6 puts it well:
 *
 *   "the actual answer to 'customers can rely on it': not that the agent is always
 *    right, but that **the agent knows when it might be wrong, and asks.**"
 *
 * Every signal here was already being collected for its own reasons — schema
 * validity from Layer 0, assertion results from Layer 1, citation verification from
 * Layer 2. Composing them costs nothing extra and turns a pile of defensive checks
 * into a single number a human can act on.
 *
 * A BARE NUMBER IS USELESS
 * ------------------------
 * The prompt is explicit and it is the most important constraint on this file:
 * store the score AND every component, because someone will ask *"why 0.62?"* and
 * "the model said so" is not an answer. So [Score] carries every component, its
 * weight, its contribution, and — for the weakest one — a sentence explaining what
 * it means.
 *
 * That breakdown is what the approval gate renders, and it is the difference
 * between a reviewer who trusts the routing and one who overrides it every time.
 *
 * SIGNALS THAT ARE ABSENT ARE NOT SIGNALS THAT ARE ZERO
 * -----------------------------------------------------
 * The subtlest trap here. Most nodes have no logprobs, no self-consistency and no
 * critic — those layers are opt-in or provider-dependent. Scoring an absent signal
 * as 0 would drag every ordinary node's confidence down and route perfectly good
 * output to a human.
 *
 * So an absent signal is **excluded from the weighted mean entirely** and its
 * weight is redistributed across the signals that are present. A node with only
 * schema, assertions and citations is scored on those three, at full scale.
 */
object ConfidenceScorer {

    /** One input to the score. */
    data class Signal(
        val name: String,
        /** 0..1, higher is better. Null means "not measured" — see the class doc. */
        val value: Double?,
        val weight: Double,
        /** What this signal is, for the breakdown a reviewer reads. */
        val description: String,
        /** Shown when this signal is the weak one. */
        val weakExplanation: String,
    )

    /** A component as it appears in the stored breakdown. */
    data class Component(
        val name: String,
        val value: Double?,
        val weight: Double,
        /** value × normalised weight. Zero for absent signals. */
        val contribution: Double,
        val present: Boolean,
        val description: String,
    )

    data class Score(
        /** 0..1. */
        val value: Double,
        val components: List<Component>,
        /** The present signal that dragged the score down most. Null when all strong. */
        val weakest: Component?,
        /** A sentence naming what to look at. This is what the gate shows first. */
        val explanation: String,
        /** True when schema validity failed — the hard gate. */
        val hardGated: Boolean,
    )

    /**
     * Default weights.
     *
     * Citations are weighted highest among the soft signals because they are the
     * only one backed by a mechanical check against the source — assertion results
     * depend on rules a human wrote and may be wrong, but a verified span either
     * exists in the input or does not.
     *
     * Distributional distance is weighted lowest: "unlike previous outputs" is a
     * genuine signal but a legitimately unusual input produces a legitimately
     * unusual output, and weighting it heavily punishes novelty.
     */
    val DEFAULT_WEIGHTS: Map<String, Double> = mapOf(
        ASSERTIONS to 0.25,
        CITATIONS to 0.30,
        LOGPROB to 0.15,
        SELF_CONSISTENCY to 0.15,
        CRITIC to 0.10,
        DISTRIBUTION to 0.05,
    )

    const val ASSERTIONS = "assertions_passed"
    const val CITATIONS = "citations_verified"
    const val LOGPROB = "logprob_certainty"
    const val SELF_CONSISTENCY = "self_consistency"
    const val CRITIC = "critic_verdict"
    const val DISTRIBUTION = "distribution_match"

    /** Everything measured about one node execution. */
    data class Evidence(
        /** The hard gate. False forces confidence to 0. */
        val schemaValid: Boolean,
        val assertionsPassed: Int = 0,
        val assertionsTotal: Int = 0,
        val citationsVerified: Int = 0,
        val claimsMade: Int = 0,
        /** Fuzzy verifications count partially — see [citationRatio]. */
        val citationsFuzzy: Int = 0,
        /**
         * Citations that were checked and found NOT to exist in the source.
         *
         * Distinct from "claims made minus verified": a field the model declined to
         * cite is missing data, whereas a span that was checked and is absent is a
         * proven invention. They deserve different weight — see [citationRatio].
         */
        val citationsFabricated: Int = 0,
        /** Mean per-token probability on key fields, where the provider returns it. */
        val logprobs: List<Double>? = null,
        /** Agreement across self-consistency samples, 0..1. Null when not enabled. */
        val selfConsistencyAgreement: Double? = null,
        /** Critic's verdict, 0..1. Null when not enabled. */
        val criticVerdict: Double? = null,
        /** Standard deviations from this agent's historical mean. Null when no history. */
        val distributionalZScore: Double? = null,
        /** For the explanation: which assertion failed, which citation did not verify. */
        val failedAssertion: String? = null,
        val unverifiedCitation: String? = null,
    )

    /**
     * Score one node execution.
     *
     * @param weights per-agent overrides. Missing keys fall back to the defaults, so
     *        an agent that only wants to retune citations does not have to restate
     *        every weight.
     */
    fun score(evidence: Evidence, weights: Map<String, Double> = emptyMap()): Score {
        val w = DEFAULT_WEIGHTS + weights

        // ── The hard gate ────────────────────────────────────────────────────
        // Structurally invalid output is not "low confidence", it is wrong. Averaging
        // it with strong citations would produce a middling score and route it to a
        // human, when the correct action is to fail with a specific diagnosis.
        if (!evidence.schemaValid) {
            return Score(
                value = 0.0,
                components = listOf(Component(
                    "schema_valid", 0.0, 1.0, 0.0, present = true,
                    description = "The output did not match the declared schema.",
                )),
                weakest = null,
                explanation = "The output did not match the declared schema, so it was not scored " +
                    "further. This is a structural failure rather than a confidence judgement.",
                hardGated = true,
            )
        }

        val signals = listOf(
            Signal(
                ASSERTIONS,
                value = if (evidence.assertionsTotal == 0) null
                        else evidence.assertionsPassed.toDouble() / evidence.assertionsTotal,
                weight = w.getValue(ASSERTIONS),
                description = "Business rules satisfied: " +
                    "${evidence.assertionsPassed} of ${evidence.assertionsTotal}",
                weakExplanation = evidence.failedAssertion
                    ?.let { "The business rule '$it' did not hold." }
                    ?: "One or more business rules did not hold.",
            ),
            Signal(
                CITATIONS,
                value = citationRatio(evidence),
                weight = w.getValue(CITATIONS),
                description = "Citations verified against the source: " +
                    "${evidence.citationsVerified} of ${evidence.claimsMade}" +
                    if (evidence.citationsFuzzy > 0) " (${evidence.citationsFuzzy} approximate)" else "",
                weakExplanation = evidence.unverifiedCitation
                    ?.let { "The citation for '$it' could not be found in the input." }
                    ?: "Some values could not be traced back to the input.",
            ),
            Signal(
                LOGPROB,
                value = evidence.logprobs?.let { certaintyFromLogprobs(it) },
                weight = w.getValue(LOGPROB),
                description = "Model certainty on key fields",
                weakExplanation = "The model was hesitant — it assigned similar probability to " +
                    "several alternative answers.",
            ),
            Signal(
                SELF_CONSISTENCY,
                value = evidence.selfConsistencyAgreement,
                weight = w.getValue(SELF_CONSISTENCY),
                description = "Agreement across repeated samples",
                weakExplanation = "Repeated attempts produced different answers, which means the " +
                    "model is not settled on one.",
            ),
            Signal(
                CRITIC,
                value = evidence.criticVerdict,
                weight = w.getValue(CRITIC),
                description = "Reviewing model's verdict",
                weakExplanation = "A second model checked this output against the source and was " +
                    "not satisfied.",
            ),
            Signal(
                DISTRIBUTION,
                value = evidence.distributionalZScore?.let { distributionMatch(it) },
                weight = w.getValue(DISTRIBUTION),
                description = "Similarity to this agent's usual output",
                weakExplanation = "This output is unusual for this agent compared with its " +
                    "history. That is not necessarily wrong, but it is worth a look.",
            ),
        )

        // ── Weighted mean over PRESENT signals only ──────────────────────────
        // Redistributing the absent weight rather than scoring absence as zero is
        // what stops an ordinary node — no logprobs, no critic — from being routed
        // to a human for lacking optional instrumentation.
        val present = signals.filter { it.value != null }
        val totalWeight = present.sumOf { it.weight }

        if (present.isEmpty() || totalWeight <= 0.0) {
            // Nothing measurable. Not "zero confidence" — unknown confidence, which
            // is reported honestly rather than being dressed up as a number.
            return Score(
                value = UNMEASURED,
                components = signals.map { it.toComponent(0.0) },
                weakest = null,
                explanation = "No confidence signals were available for this node, so the score " +
                    "is a neutral default. Add a contract with assertions or enable groundedness " +
                    "to make this meaningful.",
                hardGated = false,
            )
        }

        val components = signals.map { s ->
            val contribution = s.value?.let { it * (s.weight / totalWeight) } ?: 0.0
            s.toComponent(contribution)
        }
        val value = components.sumOf { it.contribution }.coerceIn(0.0, 1.0)

        // The weakest PRESENT signal, by how much CONFIDENCE IT COST.
        //
        // Cost is `(1 - value) * weight`, not `value * weight`. The latter is the
        // signal's contribution, and minimising it picks whichever signal has the
        // smallest weight — so a lightly weighted signal at 0.4 would be reported as
        // the problem ahead of a heavily weighted one at 0.5 that actually caused
        // four times as much of the shortfall. Measured: a 0.5 citation score at
        // weight 0.30 (cost 0.15) lost to a 0.4 distribution score at weight 0.05
        // (cost 0.03), and the reviewer would have been sent to look at the wrong
        // thing entirely.
        val weakest = present
            .filter { it.value!! < 0.999 }
            .maxByOrNull { (1.0 - it.value!!) * it.weight }
            ?.let { s -> components.first { it.name == s.name } }

        val weakSignal = weakest?.let { c -> signals.first { it.name == c.name } }

        return Score(
            value = value,
            components = components,
            weakest = weakest,
            explanation = weakSignal?.weakExplanation
                ?: "Every available check passed cleanly.",
            hardGated = false,
        )
    }

    /** Neutral score when nothing could be measured. Deliberately not 0 and not 1. */
    const val UNMEASURED = 0.75

    /**
     * Citation ratio, with fuzzy matches counted at half weight.
     *
     * A fuzzy verification is real evidence but weaker than a verbatim one, and
     * collapsing the two would throw away the distinction `SpanVerifier` went to
     * trouble to preserve.
     *
     * Null when no claims were made: a node that legitimately found nothing has not
     * failed at citation, and scoring it 0 would punish the honest "not present"
     * answer that Layer 2 exists to encourage.
     */
    private fun citationRatio(e: Evidence): Double? {
        if (e.claimsMade == 0) return null
        val strong = (e.citationsVerified - e.citationsFuzzy).coerceAtLeast(0)
        val ratio = ((strong + e.citationsFuzzy * 0.5) / e.claimsMade).coerceIn(0.0, 1.0)

        // A PROVEN FABRICATION is worse than the ratio suggests.
        //
        // Found by running the demo: a model that cited two fields correctly and
        // invented the third scored 82% - comfortably in the commit-and-flag band -
        // because two-thirds of its citations checked out. That is the wrong reading.
        //
        // A missing citation is missing data. A citation that was checked and does
        // not exist is evidence about the MODEL: it invents rather than declines, and
        // that tells you something about every other field in the same response,
        // including the ones that happened to verify. Averaging it away treats a
        // demonstrated behaviour as a single bad data point.
        //
        // So a fabrication halves the signal on top of the ratio. 2-of-3 with one
        // invention becomes 0.33 rather than 0.67, which moves the output out of the
        // commit bands and in front of a person - which is exactly where an output
        // containing a known invention belongs.
        //
        // Halved rather than zeroed: the fields that DID verify are still evidence,
        // and zeroing would make one fabrication indistinguishable from a model that
        // cited nothing at all.
        return if (e.citationsFabricated > 0) ratio * FABRICATION_PENALTY else ratio
    }

    /**
     * How much a proven fabrication discounts the citation signal.
     *
     * Not tunable per agent, deliberately: "how much do we discount an output we can
     * prove contains an invention" is not a per-workflow preference, and exposing it
     * would invite tuning it away on the node where it matters most.
     */
    private const val FABRICATION_PENALTY = 0.5

    /**
     * Certainty from logprobs, as 1 − normalised entropy.
     *
     * A token the model assigned 0.99 to carries almost no entropy; one split evenly
     * across five candidates carries a lot. Normalised by ln(2) so a coin-flip token
     * lands near 0.5 rather than at some scale nobody can interpret.
     *
     * Averaged across the supplied tokens, which the caller has already narrowed to
     * the key fields — entropy over an entire response is dominated by ordinary
     * filler tokens the model is rightly certain about, which washes out the
     * uncertainty on the one value that matters.
     */
    fun certaintyFromLogprobs(logprobs: List<Double>): Double? {
        if (logprobs.isEmpty()) return null
        val entropies = logprobs.mapNotNull { lp ->
            // Guard against a probability of exactly 0 or 1, where the log blows up.
            val p = Math.exp(lp).coerceIn(1e-9, 1.0 - 1e-9)
            val h = -(p * ln(p) + (1 - p) * ln(1 - p)) / ln(2.0)
            if (h.isNaN()) null else h
        }
        if (entropies.isEmpty()) return null
        return (1.0 - entropies.average()).coerceIn(0.0, 1.0)
    }

    /**
     * Distributional match from a z-score.
     *
     * Two standard deviations maps to roughly 0.5 and four to roughly 0 — a curve
     * rather than a cliff, because there is no natural threshold at which "unusual"
     * becomes "wrong". Absolute value: unusually high and unusually low are equally
     * worth noticing.
     */
    fun distributionMatch(z: Double): Double =
        (1.0 - min(abs(z) / 4.0, 1.0)).coerceIn(0.0, 1.0)

    private fun Signal.toComponent(contribution: Double) = Component(
        name = name,
        value = value,
        weight = weight,
        contribution = contribution,
        present = value != null,
        description = description,
    )
}
