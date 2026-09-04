package com.vectorbea.api.routes

import java.time.Instant

/**
 * The burn-down's arithmetic: bands per activation, ceilings, and the honest
 * reconciliation between two independent records of the same money.
 *
 * ── THE UNIT HAZARD THIS EXISTS TO CONTAIN ──────────────────────────────────
 * A run's cost is written twice, by two paths, in two units:
 *
 *   run_spans.cost_cents        CENTS, written by the agent brain per span.
 *   agent_runs.estimated_cost   USD, summed from `run_events.estimated_cost`,
 *                               which only `LlmNodeExecutor` writes.
 *
 * They are not derived from each other and they do not agree. Summing one
 * against the other without conversion is a 100× error; converting and assuming
 * agreement is a silent rescale that hides a real instrumentation gap.
 *
 * So everything here is CENTS, the run's recorded total is converted once at the
 * boundary, and whatever is left over is reported as unattributed rather than
 * absorbed. "Sum of bands equals the run's total, exactly" then holds by
 * construction — and the size of the leftover is the interesting number.
 */
object BurndownReader {

    /** A metered span: when it happened, what it cost, and to whom. */
    data class Sample(
        val activationId: String?,
        val at: Instant,
        val tokens: Long,
        val costCents: Double,
        val iterations: Int,
    )

    /** An activation, for naming its band. */
    data class Member(
        val id: String,
        val agentName: String,
        val role: String?,
        val depth: Int,
    )

    /** One band: an activation's cumulative spend over the run. */
    data class Band(
        val activationId: String?,
        val agentName: String,
        val role: String?,
        val depth: Int,
        val tokens: Long,
        val costCents: Double,
        val iterations: Int,
        /** Fraction of the run's ATTRIBUTED total, 0..1. */
        val shareOfCost: Double,
        /** Cumulative (atMs, cost, tokens, iterations) from the run's start. */
        val points: List<Point>,
    )

    data class Point(
        val atMs: Long,
        val costCents: Double,
        val tokens: Long,
        val iterations: Int,
    )

    /**
     * A moment worth marking on the axis.
     *
     * ── WHY A CLAMP IS THE POINT OF THIS VIEW ───────────────────────────────
     * A clamp is the reason a worker underperformed, and it is currently
     * invisible: the child was granted less than it asked for, did less work
     * than it was told to, and the trace shows an agent that simply stopped
     * early. Nothing on any screen says it was told it could not continue.
     */
    data class Marker(
        val kind: String,
        val atMs: Long,
        val label: String,
        val detail: String?,
        val activationId: String?,
    )

    /** A limit and where the run crossed it, if it did. */
    data class Ceiling(
        val dimension: String,
        val limit: Double,
        val source: String,
        /** Milliseconds from the run start at which the limit was passed. */
        val crossedAtMs: Long?,
    )

    /**
     * The two totals, and the gap.
     *
     * `agrees` is not cosmetic: when the bands and the run row disagree, one of
     * the two write paths is missing spend, and the reader is entitled to know
     * which number the chart is drawing.
     */
    data class Reconciliation(
        val attributedCents: Double,
        val unattributedCents: Double,
        val recordedTotalCents: Double?,
        val agrees: Boolean,
        val note: String?,
    )

    data class Burndown(
        val startedAtMs: Long,
        val durationMs: Long,
        val bands: List<Band>,
        val ceilings: List<Ceiling>,
        val markers: List<Marker>,
        val reconciliation: Reconciliation,
    )

    /** Cent-level agreement. Below this the difference is float noise. */
    private const val EPSILON_CENTS = 0.005

    /**
     * Build the burn-down.
     *
     * `recordedTotalUsd` is the run row's own figure IN DOLLARS — converted here,
     * once, where the conversion is visible, rather than at four call sites.
     */
    fun build(
        samples: List<Sample>,
        members: List<Member>,
        ceilings: List<Ceiling>,
        markers: List<Marker>,
        recordedTotalUsd: Double?,
    ): Burndown {
        if (samples.isEmpty()) {
            return Burndown(
                startedAtMs = 0, durationMs = 0, bands = emptyList(),
                ceilings = ceilings, markers = markers,
                reconciliation = Reconciliation(
                    attributedCents = 0.0,
                    unattributedCents = (recordedTotalUsd ?: 0.0) * 100.0,
                    recordedTotalCents = recordedTotalUsd?.times(100.0),
                    agrees = (recordedTotalUsd ?: 0.0) * 100.0 <= EPSILON_CENTS,
                    note = if ((recordedTotalUsd ?: 0.0) > 0)
                        "The run recorded a cost but no metered spans, so none of it can be " +
                        "attributed to an agent."
                    else null,
                ),
            )
        }

        val t0 = samples.minOf { it.at }.toEpochMilli()
        val t1 = samples.maxOf { it.at }.toEpochMilli()
        val byId = members.associateBy { it.id }

        /*
         * Grouped by activation, and a null activation is its OWN group rather
         * than being dropped. A span with no activation is spend nobody can name,
         * which is exactly the thing this view exists to surface — dropping it
         * would make the bands sum to less than the run and look correct.
         */
        val grouped = samples.groupBy { it.activationId }
        val attributed = samples.sumOf { it.costCents }

        val bands = grouped.entries
            .map { (id, rows) ->
                val sorted = rows.sortedBy { it.at }
                var c = 0.0; var tk = 0L; var it0 = 0
                val points = sorted.map { s ->
                    c += s.costCents; tk += s.tokens; it0 += s.iterations
                    Point(s.at.toEpochMilli() - t0, round4(c), tk, it0)
                }
                val m = id?.let { byId[it] }
                Band(
                    activationId = id,
                    agentName = m?.agentName
                        /* Named, not blank: "unattributed" is a finding. */
                        ?: if (id == null) "Unattributed" else "agent ${id.take(8)}",
                    role = m?.role,
                    depth = m?.depth ?: 0,
                    tokens = tk,
                    costCents = round4(c),
                    iterations = it0,
                    shareOfCost = if (attributed > 0) c / attributed else 0.0,
                    points = points,
                )
            }
            /* Deepest last, so a supervisor's band sits under its children's —
               the reading order of the stack matches the delegation order. */
            .sortedWith(compareBy({ it.depth }, { -it.costCents }))

        val recordedCents = recordedTotalUsd?.times(100.0)
        val difference = recordedCents?.minus(attributed) ?: 0.0
        val agrees = recordedCents == null || kotlin.math.abs(difference) <= EPSILON_CENTS

        return Burndown(
            startedAtMs = t0,
            durationMs = t1 - t0,
            bands = bands,
            ceilings = ceilings.map { it.copy(crossedAtMs = crossedAt(it, bands)) },
            markers = markers,
            reconciliation = Reconciliation(
                attributedCents = round4(attributed),
                unattributedCents = round4(difference),
                recordedTotalCents = recordedCents?.let { round4(it) },
                agrees = agrees,
                note = when {
                    agrees -> null
                    difference > 0 ->
                        "The run's recorded total is ${round4(difference)}¢ more than the " +
                        "spans account for. Spend recorded as a run event but never on a " +
                        "span cannot be attributed to an agent."
                    else ->
                        "The spans account for ${round4(-difference)}¢ more than the run's " +
                        "recorded total. The run row is summed from run events, which only " +
                        "the model-call executor writes; agent spend reaches spans by a " +
                        "different path."
                },
            ),
        )
    }

    /**
     * When the stacked total first passed a limit.
     *
     * Null when it never did — which must render as "not reached", never as a
     * line at the end of the axis.
     */
    private fun crossedAt(c: Ceiling, bands: List<Band>): Long? {
        if (c.limit <= 0) return null
        val everyPoint = bands.flatMap { b -> b.points.map { it } }.sortedBy { it.atMs }
        if (everyPoint.isEmpty()) return null

        /* The stack's height at a moment is the sum of each band's LATEST point
           at or before it — not the sum of points sharing that timestamp. */
        var running = 0.0
        val latest = HashMap<Int, Double>()
        val ordered = bands.flatMapIndexed { i, b -> b.points.map { i to it } }
            .sortedBy { it.second.atMs }

        for ((bandIndex, p) in ordered) {
            val value = when (c.dimension) {
                "cost" -> p.costCents
                "tokens" -> p.tokens.toDouble()
                "iterations" -> p.iterations.toDouble()
                else -> return null
            }
            running += value - (latest[bandIndex] ?: 0.0)
            latest[bandIndex] = value
            if (running >= c.limit) return p.atMs
        }
        return null
    }

    private fun round4(v: Double): Double = Math.round(v * 10_000.0) / 10_000.0
}
