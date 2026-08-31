package com.vectorbea.worker.agents.orchestration

/**
 * Inline, or its own run? — §11.
 *
 * Same durable row, same lifecycle, different transport. The activation exists
 * either way; what this decides is where it executes.
 *
 * ── PURE, AND THAT IS THE POINT ─────────────────────────────────────────────
 * No I/O, no clock, no ids. A placement decision that reads the database is one
 * that can decide differently for the same activation on two ticks, and a
 * resumed run that changes its mind about placement has two half-executions of
 * one activation. Everything it needs is passed in.
 */
object ActivationPlacement {

    enum class Placement {
        /** In the parent's worker tick, sharing its permit and its budget. */
        INLINE,

        /**
         * As its own `agent_runs` row on `runs.agent.child`.
         *
         * One queue round-trip of latency, in exchange for its own lease, its own
         * CAS, its own timeout and its own dead-letter path — so a crash takes
         * one activation rather than the whole subtree.
         */
        DISPATCHED,
    }

    /** Everything the rule needs, and nothing it does not. */
    data class Pending(
        /** How wide the fan-out this activation belongs to is. 1 for a lone delegation. */
        val joinGroupSize: Int,
        val depth: Int,
        /** The caller's estimate, when it has one. Null means unknown. */
        val estimatedDurationMs: Long?,
        /** What is left of this tick, from `RuntimeContext.tickDeadlineAtMs`. */
        val remainingTickBudgetMs: Long?,
        /** Set when the contract carries a deadline. */
        val hasDeadline: Boolean,
        /** True when the caller believes this finishes inside a tick. */
        val isShortLived: Boolean,
    )

    /**
     * Thresholds, configurable per §11's "make them configurable".
     *
     * Defaults are the ones the doc gives. Read from the environment at class
     * load, and overridable per call so a team node can tighten them and so a
     * test can drive both sides of a boundary in one JVM.
     */
    data class Thresholds(
        /** Above this many siblings, fan out horizontally. Default 3. */
        val inlineFanoutThreshold: Int = DEFAULT_INLINE_FANOUT_THRESHOLD,
        /**
         * A tick with less than this left is treated as having none.
         *
         * Without a floor, an activation that "fits" in the 40 ms remaining is
         * placed inline, overruns, and the tick yields anyway — paying the
         * dispatch latency AND the yield. Below the floor, dispatch.
         */
        val minInlineTickBudgetMs: Long = DEFAULT_MIN_INLINE_TICK_BUDGET_MS,
    )

    const val DEFAULT_INLINE_FANOUT_THRESHOLD = 3
    const val DEFAULT_MIN_INLINE_TICK_BUDGET_MS = 2_000L

    val ENV_THRESHOLDS = Thresholds(
        inlineFanoutThreshold = System.getenv("AGENT_INLINE_FANOUT_THRESHOLD")
            ?.toIntOrNull()?.coerceAtLeast(1) ?: DEFAULT_INLINE_FANOUT_THRESHOLD,
        minInlineTickBudgetMs = System.getenv("AGENT_MIN_INLINE_TICK_BUDGET_MS")
            ?.toLongOrNull()?.coerceAtLeast(0) ?: DEFAULT_MIN_INLINE_TICK_BUDGET_MS,
    )

    /**
     * The §11 selection rule, in the doc's order.
     *
     * Order is the specification, not an implementation detail: a short-lived
     * activation with a deadline goes inline EVEN IF it is part of a wide
     * fan-out, because the queue round-trip is what would miss the deadline.
     * Reordering the first two clauses changes which of those two properties
     * wins, and the doc chose the deadline.
     */
    fun placementOf(a: Pending, t: Thresholds = ENV_THRESHOLDS): Placement = when {
        /* A caller is waiting and this finishes fast. A queue hop costs more than
           the work does. */
        a.hasDeadline && a.isShortLived -> Placement.INLINE

        /* Wide fan-out. This is what dispatch is FOR: N children under one permit
           are N coroutines on one worker, and the whole point of a fan-out is
           that they run on different ones. */
        a.joinGroupSize > t.inlineFanoutThreshold -> Placement.DISPATCHED

        /* It will not fit in what is left of this tick. Running it inline means
           yielding mid-activation and re-executing it, so the round-trip is
           cheaper than the retry. */
        !fitsInTick(a, t) -> Placement.DISPATCHED

        /*
         * Everything else is INLINE, including depth 0 — which the doc lists
         * separately and which resolves the same way. Inline is the default
         * because it is strictly simpler: no queue plumbing, no second lease, no
         * cross-run resume, and the existing yield machinery already handles a
         * tick running out mid-subtree.
         */
        else -> Placement.INLINE
    }

    /**
     * Does this fit in what is left of the tick?
     *
     * Unknown duration counts as fitting. The alternative — dispatching
     * everything nobody estimated — would make dispatch the default by accident,
     * and the doc is explicit that inline is the default.
     */
    private fun fitsInTick(a: Pending, t: Thresholds): Boolean {
        val remaining = a.remainingTickBudgetMs ?: return true
        if (remaining < t.minInlineTickBudgetMs) return false
        val estimate = a.estimatedDurationMs ?: return true
        return estimate <= remaining
    }
}
