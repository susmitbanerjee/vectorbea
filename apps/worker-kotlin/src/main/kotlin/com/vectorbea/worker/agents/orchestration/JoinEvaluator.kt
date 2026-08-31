package com.vectorbea.worker.agents.orchestration

/**
 * When a fan-out is finished, and what to do with the children that are not.
 *
 * ── PURE, AND DELIBERATELY SO ───────────────────────────────────────────────
 * No I/O, no clock, no activation ids. A join is arithmetic over outcomes —
 * "have two of these five succeeded yet" — and the moment it also owns creating
 * children, cancelling them and writing rows, the arithmetic becomes untestable
 * without a database and the interesting cases stop being covered.
 *
 * This is also what keeps [OrchestrationLoop] from becoming a scheduler: the
 * loop asks this after each child returns and either stops or continues. There
 * is no queue, no wait set, and nothing that needs waking.
 */
object JoinEvaluator {

    /** One child's outcome, as far as a join cares. */
    enum class Outcome { SUCCEEDED, FAILED, PAUSED }

    /** What the loop should do next. */
    sealed class Verdict {
        /** Keep going: more children are needed. */
        object Continue : Verdict()

        /** The join is met. Anything not yet run is cancelled. */
        data class Satisfied(val successes: Int) : Verdict()

        /**
         * The join can never be met, because too many children have already
         * failed for the remaining ones to make up the shortfall.
         *
         * Detecting this EARLY is the point. A `wait_all` of five whose second
         * child failed cannot succeed, and running the other three costs three
         * agent loops to reach a conclusion already known — which on a team is
         * not a rounding error, it is most of the budget.
         */
        data class Impossible(val successes: Int, val failures: Int) : Verdict()

        /** A child is waiting on a person; the whole tick ends here. */
        object Paused : Verdict()
    }

    /**
     * Judge a fan-out after [outcomes] children of [total] have run.
     *
     * [onChildFailure] decides whether a failure is fatal at all. Under the
     * default, [OnChildFailure.CONTINUE], a failed child is an ordinary failed
     * observation and only an arithmetic shortfall ends the join — which is the
     * P9 rule applied to a set rather than to one child.
     */
    fun judge(
        outcomes: List<Outcome>,
        total: Int,
        join: JoinPolicy,
        onChildFailure: OnChildFailure,
    ): Verdict {
        if (outcomes.any { it == Outcome.PAUSED }) return Verdict.Paused

        val successes = outcomes.count { it == Outcome.SUCCEEDED }
        val failures = outcomes.count { it == Outcome.FAILED }
        val required = join.required(total)

        if (successes >= required) return Verdict.Satisfied(successes)

        /* An explicit fail_parent ends it on the first failure, whatever the
           arithmetic says. That is the opt-in for a join that genuinely cannot
           proceed without every member — the one case CHILD_FAILED is for. */
        if (onChildFailure == OnChildFailure.FAIL_PARENT && failures > 0) {
            return Verdict.Impossible(successes, failures)
        }

        /* Otherwise the shortfall decides: can what is left still get there? */
        val remaining = total - outcomes.size
        if (successes + remaining < required) return Verdict.Impossible(successes, failures)

        return Verdict.Continue
    }
}
