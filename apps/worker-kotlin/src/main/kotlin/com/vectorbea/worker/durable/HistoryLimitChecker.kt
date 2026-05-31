package com.vectorbea.worker.durable

import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Checks workflow run history size limits and updates warning/required flags.
 *
 * Limits are configurable via environment variables. Thresholds inspired by
 * durable execution systems (Temporal uses similar concepts).
 *
 * Called after each event append to keep tracking current.
 */
class HistoryLimitChecker(
    private val dataSource: DataSource,
    private val eventWarningCount: Int  = (System.getenv("VECTORBEA_HISTORY_EVENT_WARNING_COUNT") ?: "10240").toInt(),
    private val eventMaxCount: Int      = (System.getenv("VECTORBEA_HISTORY_EVENT_MAX_COUNT") ?: "51200").toInt(),
    private val sizeWarningBytes: Long  = (System.getenv("VECTORBEA_HISTORY_SIZE_WARNING_BYTES") ?: "10485760").toLong(),
    private val sizeMaxBytes: Long      = (System.getenv("VECTORBEA_HISTORY_SIZE_MAX_BYTES") ?: "52428800").toLong(),
) {
    private val log = logger()

    data class HistoryStats(
        val runId: UUID,
        val eventCount: Int,
        val sizeBytes: Long,
        val warningIssued: Boolean,
        val continueAsNewRecommended: Boolean,
        val continueAsNewRequired: Boolean,
    )

    enum class LimitStatus { OK, WARNING, REQUIRED }

    data class CheckResult(
        val status: LimitStatus,
        val eventCount: Int,
        val sizeBytes: Long,
        val warningTriggered: Boolean,   // newly triggered this check
        val requiredTriggered: Boolean,
    )

    /**
     * Check history limits for [runId]. Updates DB flags and returns current status.
     * Called from event store after each append.
     */
    fun check(runId: UUID): CheckResult {
        val stats = loadStats(runId) ?: return CheckResult(LimitStatus.OK, 0, 0L, false, false)

        val hitWarning = !stats.warningIssued &&
            (stats.eventCount >= eventWarningCount || stats.sizeBytes >= sizeWarningBytes)
        val hitRequired = !stats.continueAsNewRequired &&
            (stats.eventCount >= eventMaxCount || stats.sizeBytes >= sizeMaxBytes)

        if (hitWarning || hitRequired) {
            updateFlags(runId, hitWarning || stats.warningIssued, hitRequired || stats.continueAsNewRecommended, hitRequired)
        }

        val status = when {
            stats.continueAsNewRequired || hitRequired -> LimitStatus.REQUIRED
            stats.continueAsNewRecommended || hitWarning -> LimitStatus.WARNING
            else -> LimitStatus.OK
        }

        if (hitWarning) log.warn("[history] run {} approaching limit — events={} sizeKB={}", runId, stats.eventCount, stats.sizeBytes / 1024)
        if (hitRequired) log.warn("[history] run {} HIT MAXIMUM — events={} sizeKB={} — continue-as-new required", runId, stats.eventCount, stats.sizeBytes / 1024)

        return CheckResult(status, stats.eventCount, stats.sizeBytes, hitWarning, hitRequired)
    }

    fun loadStats(runId: UUID): HistoryStats? {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT history_event_count, history_size_bytes, history_warning_issued,
                   continue_as_new_recommended, continue_as_new_required
                   FROM agent_runs WHERE id = ?"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                val rs = stmt.executeQuery()
                if (!rs.next()) return null
                return HistoryStats(
                    runId = runId,
                    eventCount = rs.getInt("history_event_count"),
                    sizeBytes = rs.getLong("history_size_bytes"),
                    warningIssued = rs.getBoolean("history_warning_issued"),
                    continueAsNewRecommended = rs.getBoolean("continue_as_new_recommended"),
                    continueAsNewRequired = rs.getBoolean("continue_as_new_required"),
                )
            }
        }
    }

    private fun updateFlags(runId: UUID, warning: Boolean, recommended: Boolean, required: Boolean) {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """UPDATE agent_runs SET
                   history_warning_issued        = ?,
                   continue_as_new_recommended   = ?,
                   continue_as_new_required      = ?,
                   updated_at                    = now()
                   WHERE id = ?"""
            ).use { stmt ->
                stmt.setBoolean(1, warning)
                stmt.setBoolean(2, recommended)
                stmt.setBoolean(3, required)
                stmt.setObject(4, runId)
                stmt.executeUpdate()
            }
        }
    }
}
