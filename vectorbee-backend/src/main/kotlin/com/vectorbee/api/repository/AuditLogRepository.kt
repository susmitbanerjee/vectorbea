package com.vectorbee.api.repository

import com.vectorbee.api.db.Database
import com.vectorbee.api.model.DailyRequestPoint
import com.vectorbee.api.model.DashboardSummary
import com.vectorbee.api.model.AuditLogListItem
import com.vectorbee.api.model.AuditLogInput
import java.time.OffsetDateTime
import java.util.UUID

class AuditLogRepository(private val database: Database) {
    fun insertBatch(organizationId: UUID, logs: List<AuditLogInput>): Int =
        database.transaction { connection ->
            connection.prepareStatement(
                """
                insert into public.audit_logs (
                    organization_id,
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
                    statement.setObject(1, organizationId)
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

    fun listRecent(limit: Int = 20, organizationId: UUID? = null): List<AuditLogListItem> =
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
                    al.organization_id,
                    al.metadata
                from public.audit_logs al
                join public.prompt_versions pv on pv.id = al.prompt_version_id
                join public.prompts p on p.id = pv.prompt_id
                where (?::uuid is null or al.organization_id = ?)
                order by al.created_at desc
                limit ?
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.setObject(2, organizationId)
                statement.setInt(3, limit)
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
                                    organizationId = rs.getObject("organization_id", UUID::class.java),
                                    metadata = com.vectorbee.api.http.Json.decodeJsonNode(rs.getString("metadata"))
                                )
                            )
                        }
                    }
                }
            }
        }

    fun getDashboardSummary(organizationId: UUID? = null): DashboardSummary =
        database.query { connection ->
            connection.prepareStatement(
                """
                select
                    count(*) filter (where created_at >= now() - interval '24 hours') as total_calls_last_24h,
                    coalesce(round(avg(proxy_latency_ms))::int, 0) as average_latency_ms,
                    count(distinct coalesce(metadata->>'agent_name', metadata->>'source', prompt_version_id::text)) filter
                        (where created_at >= now() - interval '24 hours') as active_agents
                from public.audit_logs
                where (?::uuid is null or organization_id = ?)
                  and (metadata->>'source' is null or metadata->>'source' != 'prompt-editor')
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.setObject(2, organizationId)
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

    fun getConnectionStatus(organizationId: UUID): com.vectorbee.api.model.ConnectionStatus =
        database.query { connection ->
            connection.prepareStatement(
                """
                select
                    max(created_at) as last_seen,
                    count(*) filter (where created_at >= now() - interval '5 minutes') as recent_count
                from public.audit_logs
                where organization_id = ?
                  and (metadata->>'source' is null or metadata->>'source' != 'prompt-editor')
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.executeQuery().use { rs ->
                    rs.next()
                    val lastSeenTs = rs.getTimestamp("last_seen")
                    val recent = rs.getLong("recent_count")
                    com.vectorbee.api.model.ConnectionStatus(
                        connected = recent > 0,
                        lastSeenAt = lastSeenTs?.toInstant()?.atOffset(java.time.ZoneOffset.UTC),
                        recentCallCount = recent
                    )
                }
            }
        }

    fun getRequestsLast7Days(organizationId: UUID? = null): List<DailyRequestPoint> =
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
                    and (?::uuid is null or al.organization_id = ?)
                    and (al.metadata->>'source' is null or al.metadata->>'source' != 'prompt-editor')
                group by days.day
                order by days.day
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.setObject(2, organizationId)
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
