package com.vectorbea.worker.retention

/**
 * The five things retention applies to, and why they are five and not one.
 *
 * ── THEY DIFFER IN COST AND IN VALUE, SO THEY DIFFER IN WINDOW ──────────────
 * The usual right shape is "the record persists, the forensics do not": a plan
 * keeps run summaries for 90 days and full traces for 7. A single number would
 * force the cheapest and most valuable data (a run's status) to share a window
 * with the most expensive and most perishable (its payloads), and whichever way
 * you set it, one of them is wrong.
 *
 * ── AND THEY DIFFER IN MECHANISM, WHICH IS THE LESS OBVIOUS HALF ────────────
 * Measured at V061 (see docs/RETENTION.md §3):
 *
 *   RUNS       one delete cascades to ~20 child tables through their foreign
 *              keys. Cheap per row, and the row nobody wants to lose.
 *   EVENTS     partitioned monthly. A partition DROP returns 2.9 GB in 1.8 s;
 *              a per-workspace row delete over the same data returns NOTHING
 *              until that partition is dropped. Both exist, for different jobs.
 *   TRACES     the same, and the largest table by §12.1.
 *   PAYLOADS   NOT partitioned, and the largest content per row. Deletion is
 *              the only reclaim there is, which makes this the one entity where
 *              row-level deletion is also the storage lever.
 *   ARCHIVES   objects in a bucket. Purging one returns real bytes immediately
 *              and is the only entity whose deletion is felt outside Postgres.
 */
enum class RetentionEntity(
    /** The `retention_days_*` entitlement key, and the `entity` column value. */
    val wire: String,
) {
    RUNS("runs"),
    EVENTS("events"),
    TRACES("traces"),
    PAYLOADS("payloads"),
    ARCHIVES("archives"),
    ;

    /** The V060 entitlement key this entity's window comes from. */
    val entitlementKey: String get() = "retention_days_$wire"

    companion object {
        /**
         * Sweep order, and it is not arbitrary.
         *
         * PAYLOADS first: the largest bytes per row and the only entity whose
         * row deletion actually reclaims space, so a sweep that runs out of its
         * time budget has already done the part that matters most.
         *
         * RUNS last: deleting a run cascades into tables the earlier phases have
         * just walked, and doing it first would make every later phase re-plan
         * against a table that shifted under it. It is also the entity with the
         * longest window, so it has the least to do on any given pass.
         */
        val SWEEP_ORDER = listOf(PAYLOADS, EVENTS, TRACES, ARCHIVES, RUNS)

        fun from(wire: String): RetentionEntity? =
            entries.firstOrNull { it.wire == wire }
    }
}

/**
 * The window in force for one workspace and entity, and what authorised it.
 *
 * [source] is carried into the audit row rather than recomputed there. "30 days,
 * because they downgraded on the 4th and grace runs to the 4th of next month" is
 * a different fact from "30 days, because that is the plan", and an auditor
 * asking why a deletion happened is asking for the first one.
 */
data class RetentionWindow(
    val entity: RetentionEntity,
    val days: Int,
    /** plan | grace | override | platform_floor */
    val source: String,
) {
    /** True while a downgrade is being honoured at the previous, longer window. */
    val graced: Boolean get() = source == "grace"
}
