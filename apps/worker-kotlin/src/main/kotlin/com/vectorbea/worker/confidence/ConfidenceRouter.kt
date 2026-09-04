package com.vectorbea.worker.confidence

/**
 * Route a node on its confidence score.
 *
 * §6's thresholds, and the reasoning behind each band:
 *
 * | Score       | Action                                              |
 * |-------------|-----------------------------------------------------|
 * | ≥ 0.90      | commit and continue                                 |
 * | 0.70 – 0.90 | commit, flag the run low-confidence, surface on Control |
 * | 0.50 – 0.70 | **suspend and open a human approval gate**          |
 * | < 0.50      | fail the node with a specific diagnosis              |
 *
 * THE GATE BAND IS THE PRODUCT
 * ----------------------------
 * §6 again:
 *
 *   "Your Human Approval gate stops being a compliance checkbox and becomes an
 *    automated quality control mechanism. The system routes exactly the decisions
 *    it isn't sure about to exactly the person who should see them."
 *
 * The band matters in both directions. Too wide and reviewers drown in decisions
 * the model got right — attention is the scarcest resource in the loop, and a queue
 * of obvious approvals trains people to rubber-stamp. Too narrow and the wrong
 * answers commit silently. That is why calibration (§5 of the prompt) exists: the
 * thresholds are a starting guess to be corrected by evidence, not a constant.
 *
 * WHY FAIL RATHER THAN GATE BELOW 0.50
 * ------------------------------------
 * Below half, the system is not uncertain — it has specific evidence that something
 * is wrong: an assertion failed, a citation was fabricated. Sending that to a human
 * asks them to review output the system already knows is bad, which wastes the
 * attention the gate band exists to spend well.
 */
object ConfidenceRouter {

    enum class Action {
        /** Commit and continue. Nothing to see. */
        COMMIT,
        /** Commit, but flag the run and surface it on Control. */
        COMMIT_FLAGGED,
        /** Suspend the run and open a human approval gate. Holds no worker slot. */
        GATE,
        /** Fail the node with a specific diagnosis. */
        FAIL,
    }

    /**
     * Thresholds, configurable per node with plan defaults.
     *
     * Held as data rather than constants precisely because calibration is expected
     * to move them: an agent whose 0.6-confidence outputs are approved 95% of the
     * time has a gate threshold that is too low, and the fix is to lower it for that
     * agent rather than to argue about the global default.
     */
    data class Thresholds(
        val commitAbove: Double = 0.90,
        val flagAbove: Double = 0.70,
        val gateAbove: Double = 0.50,
    ) {
        init {
            require(commitAbove >= flagAbove && flagAbove >= gateAbove) {
                "Confidence thresholds must descend: commit >= flag >= gate"
            }
        }

        companion object {
            val DEFAULT = Thresholds()

            /**
             * Parse from stored config, falling back per field.
             *
             * Per field rather than all-or-nothing so a node that only wants a
             * stricter gate does not have to restate the other two and accidentally
             * pin them against a future default change.
             */
            fun from(config: Map<String, Any?>?): Thresholds {
                if (config == null) return DEFAULT
                fun d(k: String, fallback: Double) =
                    (config[k] as? Number)?.toDouble() ?: fallback
                return Thresholds(
                    commitAbove = d("commit", DEFAULT.commitAbove),
                    flagAbove = d("flag", DEFAULT.flagAbove),
                    gateAbove = d("gate", DEFAULT.gateAbove),
                )
            }
        }
    }

    data class Decision(
        val action: Action,
        val score: Double,
        /** What the user is told. Names the weak signal, never just the number. */
        val message: String,
        /** True when the run must be suspended rather than held. */
        val suspends: Boolean,
    )

    /**
     * Decide what to do with a scored output.
     *
     * The message is composed here rather than at the call site so every band says
     * the same kind of thing in the same voice — and so the score is never presented
     * without the reason it is what it is.
     */
    fun route(score: ConfidenceScorer.Score, thresholds: Thresholds = Thresholds.DEFAULT): Decision {
        val pct = Math.round(score.value * 100)

        // A hard gate is a structural failure, not a confidence judgement, and it
        // reports as one. Presenting "0% confidence" for invalid JSON would send the
        // user looking for a prompt problem when the problem is the schema.
        if (score.hardGated) {
            return Decision(
                Action.FAIL, score.value,
                "This step failed: " + score.explanation,
                suspends = false,
            )
        }

        return when {
            score.value >= thresholds.commitAbove -> Decision(
                Action.COMMIT, score.value,
                "High confidence ($pct%). " + score.explanation,
                suspends = false,
            )

            score.value >= thresholds.flagAbove -> Decision(
                Action.COMMIT_FLAGGED, score.value,
                "Moderate confidence ($pct%) - the step continued, but the run is flagged for " +
                    "review. " + score.explanation,
                suspends = false,
            )

            score.value >= thresholds.gateAbove -> Decision(
                Action.GATE, score.value,
                "Low confidence ($pct%) - this step is waiting for a person to check it. " +
                    score.explanation,
                // The zero-cost suspension path: a run waiting at a gate must not
                // occupy a worker permit. A gate that holds a slot turns "ask a human
                // when unsure" into a capacity problem, and the feature gets disabled.
                suspends = true,
            )

            else -> Decision(
                Action.FAIL, score.value,
                "This step failed its quality checks ($pct% confidence). " + score.explanation,
                suspends = false,
            )
        }
    }
}
