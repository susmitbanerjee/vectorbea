package com.vectorbea.api.repository

import com.vectorbea.api.db.Database
import com.vectorbea.api.model.DailyRequestPoint
import com.vectorbea.api.model.DashboardSummary
import com.vectorbea.api.model.AuditLogListItem
import com.vectorbea.api.model.AuditLogInput
import java.time.OffsetDateTime
import java.util.UUID

class AuditLogRepository(private val database: Database) {
    fun insertBatch(workspaceId: UUID, logs: List<AuditLogInput>): Int =
        database.transaction { connection ->
            connection.prepareStatement(
                """
                insert into public.audit_logs (
                    workspace_id,
                    prompt_version_id,
                    proxy_latency_ms,
                    llm_latency_ms,
                    token_count,
                    metadata
                )
                values (?, ?, ?, ?, ?, ?::jsonb)
                """.trimIndent()
            ).use { statement ->
                for (log in logs) {
                    statement.setObject(1, workspaceId)
                    statement.setObject(2, log.promptVersionId)
                    statement.setDouble(3, log.proxyLatencyMs)
                    statement.setInt(4, log.llmLatencyMs)
                    statement.setInt(5, log.tokenCount)
                    statement.setString(6, log.metadata?.toString() ?: "{}")
                    statement.addBatch()
                }

                statement.executeBatch().size
            }
        }

    fun listRecent(limit: Int = 20, workspaceId: UUID): List<AuditLogListItem> =
        database.query { connection ->
            connection.prepareStatement(
                """
                select
                    al.created_at as timestamp,
                    p.name as prompt_name,
                    pv.version_tag,
                    al.proxy_latency_ms,
                    al.llm_latency_ms,
                    al.token_count,
                    al.workspace_id,
                    al.metadata
                from public.audit_logs al
                join public.prompt_versions pv on pv.id = al.prompt_version_id
                join public.prompts p on p.id = pv.prompt_id
                where al.workspace_id = ?
                order by al.created_at desc
                limit ?
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.setInt(2, limit)
                statement.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            add(
                                AuditLogListItem(
                                    timestamp = rs.getObject("timestamp", OffsetDateTime::class.java),
                                    promptName = rs.getString("prompt_name"),
                                    versionTag = rs.getString("version_tag"),
                                    proxyLatencyMs = rs.getDouble("proxy_latency_ms"),
                                    llmLatencyMs = rs.getInt("llm_latency_ms"),
                                    tokenCount = rs.getInt("token_count"),
                                    workspaceId = rs.getObject("workspace_id", UUID::class.java),
                                    metadata = com.vectorbea.api.http.Json.decodeJsonNode(rs.getString("metadata"))
                                )
                            )
                        }
                    }
                }
            }
        }

    fun getDashboardSummary(workspaceId: UUID): DashboardSummary =
        database.query { connection ->
            connection.prepareStatement(
                """
                select
                    count(*) filter (where created_at >= now() - interval '24 hours') as total_calls_last_24h,
                    coalesce(round(avg(proxy_latency_ms))::int, 0) as average_latency_ms,
                    count(distinct coalesce(metadata->>'agent_name', metadata->>'source', prompt_version_id::text)) filter
                        (where created_at >= now() - interval '24 hours') as active_agents
                from public.audit_logs
                where workspace_id = ?
                  and (metadata->>'source' is null or metadata->>'source' != 'prompt-editor')
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.executeQuery().use { rs ->
                    rs.next()
                    DashboardSummary(
                        totalApiCallsLast24h = rs.getLong("total_calls_last_24h"),
                        averageLatencyMs = rs.getInt("average_latency_ms"),
                        activeAgents = rs.getInt("active_agents")
                    )
                }
            }
        }

    fun getConnectionStatus(workspaceId: UUID): com.vectorbea.api.model.ConnectionStatus =
        database.query { connection ->
            connection.prepareStatement(
                """
                select
                    max(created_at) as last_seen,
                    count(*) filter (where created_at >= now() - interval '5 minutes') as recent_count
                from public.audit_logs
                where workspace_id = ?
                  and (metadata->>'source' is null or metadata->>'source' != 'prompt-editor')
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.executeQuery().use { rs ->
                    rs.next()
                    val lastSeenTs = rs.getTimestamp("last_seen")
                    val recent = rs.getLong("recent_count")
                    com.vectorbea.api.model.ConnectionStatus(
                        connected = recent > 0,
                        lastSeenAt = lastSeenTs?.toInstant()?.atOffset(java.time.ZoneOffset.UTC),
                        recentCallCount = recent
                    )
                }
            }
        }

    fun getRequestsLast7Days(workspaceId: UUID): List<DailyRequestPoint> =
        database.query { connection ->
            connection.prepareStatement(
                """
                with days as (
                    select generate_series(current_date - interval '6 days', current_date, interval '1 day')::date as day
                )
                select
                    to_char(days.day, 'Dy') as day_label,
                    coalesce(count(al.id), 0) as requests
                from days
                left join public.audit_logs al on date(al.created_at) = days.day
                    and al.workspace_id = ?
                    and (al.metadata->>'source' is null or al.metadata->>'source' != 'prompt-editor')
                group by days.day
                order by days.day
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            add(
                                DailyRequestPoint(
                                    day = rs.getString("day_label").trim(),
                                    requests = rs.getLong("requests")
                                )
                            )
                        }
                    }
                }
            }
        }
}
