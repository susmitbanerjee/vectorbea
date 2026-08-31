package com.vectorbea.worker.agents.budget

/**
 * A budget in every dimension that can be divided between agents.
 *
 * ── WHY COST IS AN INTEGER OF MICRO-CENTS ───────────────────────────────────
 * The rest of the system carries cost as a `Double` of cents, which is fine for
 * displaying a number and wrong for this. A budget tree adds and subtracts the
 * same quantity along every path from a leaf to the root, and floating-point
 * addition is not associative: the invariant "total consumption never exceeds
 * the root allocation" would fail by 1e-13 on a deep tree and be true on a
 * shallow one, which is the worst possible way for a limit to behave.
 *
 * Integers make the invariant exact and testable. Micro-cents rather than cents
 * because a single model call can cost a small fraction of a cent, and a
 * per-call cost that rounds to zero is a budget that never depletes.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 * Wall clock. It does not divide: eight children running in parallel each take
 * the same ten seconds, so a parent that hands out 10s × 8 has either
 * over-allocated by 8× or under-allocated by 8× depending on how they run, and
 * it cannot know which at allocation time. Time stays a per-activation timeout
 * and a run ceiling, both of which are already enforced elsewhere.
 */
data class BudgetVector(
    val iterations: Int = 0,
    val toolCalls: Int = 0,
    val tokens: Long = 0,
    val costMicroCents: Long = 0,
) {
    companion object {
        val ZERO = BudgetVector()

        const val MICROS_PER_CENT = 1_000_000L

        fun ofCents(cents: Double): Long = Math.round(cents * MICROS_PER_CENT)

        /** The dimension names used in clamp records and span attributes. */
        val DIMENSIONS = listOf("iterations", "toolCalls", "tokens", "costCents")
    }

    val costCents: Double get() = costMicroCents.toDouble() / MICROS_PER_CENT

    operator fun plus(o: BudgetVector) = BudgetVector(
        iterations + o.iterations, toolCalls + o.toolCalls,
        tokens + o.tokens, costMicroCents + o.costMicroCents,
    )

    /** Subtraction FLOORED AT ZERO — a budget cannot go negative, only run out. */
    operator fun minus(o: BudgetVector) = BudgetVector(
        (iterations - o.iterations).coerceAtLeast(0),
        (toolCalls - o.toolCalls).coerceAtLeast(0),
        (tokens - o.tokens).coerceAtLeast(0),
        (costMicroCents - o.costMicroCents).coerceAtLeast(0),
    )

    /** Per-dimension minimum. This is the clamp. */
    fun coerceAtMost(cap: BudgetVector) = BudgetVector(
        minOf(iterations, cap.iterations),
        minOf(toolCalls, cap.toolCalls),
        minOf(tokens, cap.tokens),
        minOf(costMicroCents, cap.costMicroCents),
    )

    /**
     * `this × n`, saturating rather than overflowing.
     *
     * Preflight multiplies a per-child allocation by a fan-out width that comes
     * from a MODEL. An overflow there wraps to a negative and the check passes,
     * which is the one way a preflight can be worse than no preflight at all.
     */
    fun times(n: Int): BudgetVector {
        if (n <= 0) return ZERO
        fun mulI(v: Int) = if (v == 0) 0 else
            if (v > Int.MAX_VALUE / n) Int.MAX_VALUE else v * n
        fun mulL(v: Long) = if (v == 0L) 0L else
            if (v > Long.MAX_VALUE / n) Long.MAX_VALUE else v * n
        return BudgetVector(mulI(iterations), mulI(toolCalls), mulL(tokens), mulL(costMicroCents))
    }

    /** A fraction of this budget, rounded UP — see the completion margin. */
    fun fraction(f: Double): BudgetVector {
        if (f <= 0.0) return ZERO
        fun cI(v: Int) = Math.ceil(v * f).toInt().coerceIn(0, v)
        fun cL(v: Long) = Math.ceil(v * f).toLong().coerceIn(0, v)
        return BudgetVector(cI(iterations), cI(toolCalls), cL(tokens), cL(costMicroCents))
    }

    /** Dimensions where `this` is strictly greater than [cap], named. */
    fun dimensionsExceeding(cap: BudgetVector): List<String> = buildList {
        if (iterations > cap.iterations) add("iterations")
        if (toolCalls > cap.toolCalls) add("toolCalls")
        if (tokens > cap.tokens) add("tokens")
        if (costMicroCents > cap.costMicroCents) add("costCents")
    }

    /** True when every dimension is zero — nothing left to give. */
    val isExhausted: Boolean
        get() = iterations <= 0 && toolCalls <= 0 && tokens <= 0L && costMicroCents <= 0L

    /**
     * How many whole copies of [unit] fit inside this, across every dimension.
     *
     * The MINIMUM over the dimensions, because a child needs all of them: three
     * children's worth of tokens and one child's worth of cost affords one child.
     * A zero dimension in [unit] does not constrain — it is a dimension the child
     * was not asking for.
     */
    fun countOf(unit: BudgetVector): Int {
        val limits = buildList {
            if (unit.iterations > 0) add(iterations / unit.iterations)
            if (unit.toolCalls > 0) add(toolCalls / unit.toolCalls)
            if (unit.tokens > 0) add((tokens / unit.tokens).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
            if (unit.costMicroCents > 0)
                add((costMicroCents / unit.costMicroCents).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        }
        return limits.minOrNull() ?: Int.MAX_VALUE
    }

    fun toMap(): Map<String, Any> = mapOf(
        "iterations" to iterations,
        "toolCalls" to toolCalls,
        "tokens" to tokens,
        "costCents" to costCents,
    )
}
