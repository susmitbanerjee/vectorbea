package com.vectorbea.observability.analytics

import com.vectorbea.observability.db.withConnection
import com.vectorbea.observability.env.EnvironmentFilter
import com.vectorbea.observability.json.mapper
import org.slf4j.LoggerFactory
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class AnalyticsEventRecord(
    val id: UUID,
    val environment: String,
    val eventName: String,
    val eventCategory: String,
    val eventVersion: Int,
    val occurredAt: Instant,
    val receivedAt: Instant,
    val workspaceId: UUID?,
    val environmentId: UUID?,
    val appUserId: UUID?,
    val supabaseUserId: UUID?,
    val sessionId: String?,
    val anonymousId: String?,
    val sourceService: String,
    val sourcePage: String?,
    val sourceComponent: String?,
    val userAgent: String?,
    val ipHash: String?,
    val workflowId: UUID?,
    val workflowVersionId: UUID?,
    val runId: UUID?,
    val agentId: UUID?,
    val toolId: UUID?,
    val connectionId: UUID?,
    val architectSessionId: UUID?,
    val propertiesJson: Map<String, Any?>,
    val contextJson: Map<String, Any?>,
)

class AnalyticsRepository(private val ds: DataSource) {
    private val log = LoggerFactory.getLogger(AnalyticsRepository::class.java)

    fun insert(events: List<AnalyticsEventRecord>) {
        if (events.isEmpty()) return
        val sql = """
            INSERT INTO analytics_events (
                id, environment, event_name, event_category, event_version,
                occurred_at, workspace_id, environment_id, app_user_id, supabase_user_id,
                session_id, anonymous_id, source_service, source_page, source_component,
                user_agent, ip_hash, workflow_id, workflow_version_id, run_id,
                agent_id, tool_id, connection_id, architect_session_id,
                properties_json, context_json
            ) VALUES (
                ?,?,?,?,?,  ?,?,?,?,?,  ?,?,?,?,?,  ?,?,?,?,?,  ?,?,?,?,  ?::jsonb,?::jsonb
            )
        """.trimIndent()

        ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                for (e in events) {
                    stmt.setObject(1, e.id)
                    stmt.setString(2, e.environment)
                    stmt.setString(3, e.eventName)
                    stmt.setString(4, e.eventCategory)
                    stmt.setInt(5, e.eventVersion)
                    stmt.setTimestamp(6, Timestamp.from(e.occurredAt))
                    stmt.setObject(7, e.workspaceId)
                    stmt.setObject(8, e.environmentId)
                    stmt.setObject(9, e.appUserId)
                    stmt.setObject(10, e.supabaseUserId)
                    stmt.setString(11, e.sessionId)
                    stmt.setString(12, e.anonymousId)
                    stmt.setString(13, e.sourceService)
                    stmt.setString(14, e.sourcePage)
                    stmt.setString(15, e.sourceComponent)
                    stmt.setString(16, e.userAgent)
                    stmt.setString(17, e.ipHash)
                    stmt.setObject(18, e.workflowId)
                    stmt.setObject(19, e.workflowVersionId)
                    stmt.setObject(20, e.runId)
                    stmt.setObject(21, e.agentId)
                    stmt.setObject(22, e.toolId)
                    stmt.setObject(23, e.connectionId)
                    stmt.setObject(24, e.architectSessionId)
                    stmt.setString(25, mapper.writeValueAsString(e.propertiesJson))
                    stmt.setString(26, mapper.writeValueAsString(e.contextJson))
                    stmt.addBatch()
                }
                stmt.executeBatch()
            }
        }
        log.debug("[analytics] inserted {} events", events.size)
    }

    fun countByEventName(env: String?, dateFrom: Instant, dateTo: Instant): List<Map<String, Any?>> {
        val (envSql, envParams) = EnvironmentFilter.sqlFragment(env)
        val sql = """
            SELECT event_name, event_category, COUNT(*) as count
            FROM analytics_events
            WHERE $envSql AND occurred_at >= ? AND occurred_at <= ?
            GROUP BY event_name, event_category
            ORDER BY count DESC
            LIMIT 100
        """.trimIndent()
        return ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var p = 1
                for (param in envParams) stmt.setString(p++, param)
                stmt.setTimestamp(p++, Timestamp.from(dateFrom))
                stmt.setTimestamp(p, Timestamp.from(dateTo))
                val rs = stmt.executeQuery()
                val results = mutableListOf<Map<String, Any?>>()
                while (rs.next()) {
                    results += mapOf(
                        "eventName" to rs.getString("event_name"),
                        "eventCategory" to rs.getString("event_category"),
                        "count" to rs.getLong("count"),
                    )
                }
                results
            }
        }
    }

    /** Events per day per category — feeds the dashboard activity chart. */
    fun dailyCounts(env: String?, dateFrom: Instant, dateTo: Instant): List<Map<String, Any?>> {
        val (envSql, envParams) = EnvironmentFilter.sqlFragment(env)
        val sql = """
            SELECT date_trunc('day', occurred_at) AS day, event_category, COUNT(*) AS count
            FROM analytics_events
            WHERE $envSql AND occurred_at >= ? AND occurred_at <= ?
            GROUP BY day, event_category
            ORDER BY day ASC
        """.trimIndent()
        return ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var p = 1
                for (param in envParams) stmt.setString(p++, param)
                stmt.setTimestamp(p++, Timestamp.from(dateFrom))
                stmt.setTimestamp(p, Timestamp.from(dateTo))
                val rs = stmt.executeQuery()
                val results = mutableListOf<Map<String, Any?>>()
                while (rs.next()) {
                    results += mapOf(
                        "day" to rs.getTimestamp("day").toInstant().toString(),
                        "category" to rs.getString("event_category"),
                        "count" to rs.getLong("count"),
                    )
                }
                results
            }
        }
    }

    fun countDistinctByCategory(env: String?, category: String, dateFrom: Instant, dateTo: Instant): Long {
        val (envSql, envParams) = EnvironmentFilter.sqlFragment(env)
        val sql = """
            SELECT COUNT(*) FROM analytics_events
            WHERE $envSql AND event_category = ? AND occurred_at >= ? AND occurred_at <= ?
        """.trimIndent()
        return ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var p = 1
                for (param in envParams) stmt.setString(p++, param)
                stmt.setString(p++, category)
                stmt.setTimestamp(p++, Timestamp.from(dateFrom))
                stmt.setTimestamp(p, Timestamp.from(dateTo))
                val rs = stmt.executeQuery()
                if (rs.next()) rs.getLong(1) else 0L
            }
        }
    }

    fun countByEventNameSingle(env: String?, eventName: String, dateFrom: Instant, dateTo: Instant): Long {
        val (envSql, envParams) = EnvironmentFilter.sqlFragment(env)
        val sql = """
            SELECT COUNT(*) FROM analytics_events
            WHERE $envSql AND event_name = ? AND occurred_at >= ? AND occurred_at <= ?
        """.trimIndent()
        return ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var p = 1
                for (param in envParams) stmt.setString(p++, param)
                stmt.setString(p++, eventName)
                stmt.setTimestamp(p++, Timestamp.from(dateFrom))
                stmt.setTimestamp(p, Timestamp.from(dateTo))
                val rs = stmt.executeQuery()
                if (rs.next()) rs.getLong(1) else 0L
            }
        }
    }

    fun countDistinctUsers(env: String?, dateFrom: Instant, dateTo: Instant): Long {
        val (envSql, envParams) = EnvironmentFilter.sqlFragment(env)
        val sql = """
            SELECT COUNT(DISTINCT app_user_id) FROM analytics_events
            WHERE $envSql AND app_user_id IS NOT NULL AND occurred_at >= ? AND occurred_at <= ?
        """.trimIndent()
        return ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var p = 1
                for (param in envParams) stmt.setString(p++, param)
                stmt.setTimestamp(p++, Timestamp.from(dateFrom))
                stmt.setTimestamp(p, Timestamp.from(dateTo))
                val rs = stmt.executeQuery()
                if (rs.next()) rs.getLong(1) else 0L
            }
        }
    }

    fun countDistinctWorkspaces(env: String?, dateFrom: Instant, dateTo: Instant): Long {
        val (envSql, envParams) = EnvironmentFilter.sqlFragment(env)
        val sql = """
            SELECT COUNT(DISTINCT workspace_id) FROM analytics_events
            WHERE $envSql AND workspace_id IS NOT NULL AND occurred_at >= ? AND occurred_at <= ?
        """.trimIndent()
        return ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var p = 1
                for (param in envParams) stmt.setString(p++, param)
                stmt.setTimestamp(p++, Timestamp.from(dateFrom))
                stmt.setTimestamp(p, Timestamp.from(dateTo))
                val rs = stmt.executeQuery()
                if (rs.next()) rs.getLong(1) else 0L
            }
        }
    }
}
