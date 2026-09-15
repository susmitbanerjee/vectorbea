package com.vectorbea.worker.events

import javax.sql.DataSource

/**
 * Recording what went into and came out of each step and each model call, for the
 * Debug tab.
 *
 * One flag for both, TRACE_STEP_IO_ENABLED, off by default. Without it the Debug
 * tab can say a step ran and failed but not what it was handed, what the model was
 * asked or what it answered — the three things anyone opens a failed agent run to
 * read. Everything goes through [PayloadStore], which redacts before hashing.
 */
object StepIoCapture {
    val ENABLED: Boolean = System.getenv("TRACE_STEP_IO_ENABLED")?.lowercase() == "true"

    /** A payload store when capture is on, else null — callers treat null as "do not record". */
    fun storeFor(dataSource: DataSource?): PayloadStore? =
        if (!ENABLED || dataSource == null) null
        else PayloadStore(dataSource, retentionDays = RetentionLookup(dataSource)::daysFor)
}
