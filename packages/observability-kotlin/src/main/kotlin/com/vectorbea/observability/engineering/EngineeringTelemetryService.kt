package com.vectorbea.observability.engineering

import com.vectorbea.observability.db.withConnection
import com.vectorbea.observability.env.EnvironmentFilter
import org.slf4j.LoggerFactory
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class ServiceSnapshot(
    val serviceName: String,
    val status: String,
    val version: String?,
    val cpuPercent: Double?,
    val memoryMb: Double?,
    val activeRequests: Int?,
    val activeTasks: Int?,
    val queueDepth: Int?,
    val dbLatencyMs: Double?,
    val redisLatencyMs: Double?,
    val errorRate5m: Double?,
    val p95LatencyMs: Double?,
    val p99LatencyMs: Double?,
    val capturedAt: Instant,
    val environment: String,
)

data class IncidentRecord(
    val id: UUID?,
    val environment: String,
    val serviceName: String?,
    val severity: String,
    val status: String,
    val title: String,
    val summary: String?,
    val firstSeenAt: Instant,
    val lastSeenAt: Instant,
)

class EngineeringTelemetryService(private val ds: DataSource) {
    private val log = LoggerFactory.getLogger(EngineeringTelemetryService::class.java)

    fun insertSnapshot(snapshot: ServiceSnapshot) {
        val sql = """
            INSERT INTO engineering_service_snapshots (
                id, environment, service_name, status, version,
                cpu_percent, memory_mb, active_requests, active_tasks,
                queue_depth, db_latency_ms, redis_latency_ms,
                error_rate_5m, p95_latency_ms, p99_latency_ms, captured_at
            ) VALUES (gen_random_uuid(), ?,?,?,?,  ?,?,?,?,  ?,?,?,  ?,?,?,?)
        """.trimIndent()
        ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                stmt.setString(1, snapshot.environment)
                stmt.setString(2, snapshot.serviceName)
                stmt.setString(3, snapshot.status)
                stmt.setString(4, snapshot.version)
                stmt.setObject(5, snapshot.cpuPercent)
                stmt.setObject(6, snapshot.memoryMb)
                stmt.setObject(7, snapshot.activeRequests)
                stmt.setObject(8, snapshot.activeTasks)
                stmt.setObject(9, snapshot.queueDepth)
                stmt.setObject(10, snapshot.dbLatencyMs)
                stmt.setObject(11, snapshot.redisLatencyMs)
                stmt.setObject(12, snapshot.errorRate5m)
                stmt.setObject(13, snapshot.p95LatencyMs)
                stmt.setObject(14, snapshot.p99LatencyMs)
                stmt.setTimestamp(15, Timestamp.from(snapshot.capturedAt))
                stmt.executeUpdate()
            }
        }
    }

    fun latestSnapshots(env: String?): List<Map<String, Any?>> {
        val (envSql, envParams) = EnvironmentFilter.sqlFragment(env)
        val sql = """
            SELECT DISTINCT ON (environment, service_name)
                environment, service_name, status, version,
                cpu_percent, memory_mb, active_requests, active_tasks,
                queue_depth, db_latency_ms, redis_latency_ms,
                error_rate_5m, p95_latency_ms, p99_latency_ms, captured_at
            FROM engineering_service_snapshots
            WHERE $envSql
            ORDER BY environment, service_name, captured_at DESC
        """.trimIndent()
        return ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var p = 1
                for (param in envParams) stmt.setString(p++, param)
                val rs = stmt.executeQuery()
                val results = mutableListOf<Map<String, Any?>>()
                while (rs.next()) {
                    results += mapOf(
                        "environment" to rs.getString("environment"),
                        "serviceName" to rs.getString("service_name"),
                        "status" to rs.getString("status"),
                        "version" to rs.getString("version"),
                        "cpuPercent" to rs.getObject("cpu_percent"),
                        "memoryMb" to rs.getObject("memory_mb"),
                        "activeRequests" to rs.getObject("active_requests"),
                        "activeTasks" to rs.getObject("active_tasks"),
                        "queueDepth" to rs.getObject("queue_depth"),
                        "dbLatencyMs" to rs.getObject("db_latency_ms"),
                        "redisLatencyMs" to rs.getObject("redis_latency_ms"),
                        "errorRate5m" to rs.getObject("error_rate_5m"),
                        "p95LatencyMs" to rs.getObject("p95_latency_ms"),
                        "p99LatencyMs" to rs.getObject("p99_latency_ms"),
                        "capturedAt" to rs.getTimestamp("captured_at")?.toInstant()?.toString(),
                    )
                }
                results
            }
        }
    }

    fun openIncidents(env: String?): List<Map<String, Any?>> {
        val (envSql, envParams) = EnvironmentFilter.sqlFragment(env)
        val sql = """
            SELECT id, environment, service_name, severity, status, title, summary,
                   first_seen_at, last_seen_at
            FROM engineering_incidents
            WHERE $envSql AND status != 'resolved'
            ORDER BY last_seen_at DESC
            LIMIT 50
        """.trimIndent()
        return ds.withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var p = 1
                for (param in envParams) stmt.setString(p++, param)
                val rs = stmt.executeQuery()
                val results = mutableListOf<Map<String, Any?>>()
                while (rs.next()) {
                    results += mapOf(
                        "id" to rs.getObject("id").toString(),
                        "environment" to rs.getString("environment"),
                        "serviceName" to rs.getString("service_name"),
                        "severity" to rs.getString("severity"),
                        "status" to rs.getString("status"),
                        "title" to rs.getString("title"),
                        "summary" to rs.getString("summary"),
                        "firstSeenAt" to rs.getTimestamp("first_seen_at")?.toInstant()?.toString(),
                        "lastSeenAt" to rs.getTimestamp("last_seen_at")?.toInstant()?.toString(),
                    )
                }
                results
            }
        }
    }
}
