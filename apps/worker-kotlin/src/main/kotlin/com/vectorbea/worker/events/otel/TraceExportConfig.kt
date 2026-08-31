package com.vectorbea.worker.events.otel

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.connector.SecretService
import com.vectorbea.worker.logging.logger
import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.export.SpanExporter
import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource

/**
 * A workspace's OTLP destination, resolved and cached.
 *
 * ── ONE EXPORTER PER WORKSPACE, HELD OPEN ───────────────────────────────────
 * `OtlpHttpSpanExporter` owns an HTTP client with a connection pool. Building one
 * per export would open and discard a pool per finished run, which is both slow
 * and, against a vendor endpoint doing TLS, expensive enough to notice. So they
 * are cached — and keyed on the row's `updated_at`, so changing an endpoint or
 * rotating a token takes effect on the next export rather than on the next
 * deploy.
 *
 * The superseded exporter is SHUT DOWN when it is replaced. An unclosed exporter
 * keeps its pool and its daemon threads for the life of the JVM, and a workspace
 * that edits its endpoint a few times a day would leak both.
 */
open class TraceExportConfig(
    private val dataSource: DataSource,
    private val secrets: SecretService?,
) {
    private val log = logger()
    private val mapper = ObjectMapper()

    /** What the database says, before any of it is turned into an exporter. */
    data class Row(
        val workspaceId: UUID,
        val endpoint: String,
        val protocol: String,
        val headersSecretRef: String?,
        val serviceName: String,
        val resourceAttributesJson: String,
        val timeoutMs: Int,
        val updatedAtMs: Long,
    )

    /** A live destination. */
    class Destination(
        val exporter: SpanExporter,
        val resource: Resource,
        /** The `updated_at` this was built from — the cache key's other half. */
        val version: Long,
    )

    private val cache = ConcurrentHashMap<UUID, Destination>()

    /** The enabled config for [workspaceId], or null if it exports nothing. */
    open fun rowFor(workspaceId: UUID): Row? = runCatching {
        dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT endpoint, protocol, headers_secret_ref, service_name,
                          resource_attributes_json::text, timeout_ms, updated_at
                     FROM workspace_otel_exports
                    WHERE workspace_id = ? AND enabled"""
            ).use { st ->
                st.setObject(1, workspaceId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null else Row(
                        workspaceId = workspaceId,
                        endpoint = rs.getString(1),
                        protocol = rs.getString(2),
                        headersSecretRef = rs.getString(3),
                        serviceName = rs.getString(4),
                        resourceAttributesJson = rs.getString(5) ?: "{}",
                        timeoutMs = rs.getInt(6),
                        updatedAtMs = rs.getTimestamp(7).time,
                    )
                }
            }
        }
    }.getOrElse {
        /* A missing table means the migration has not reached this database yet —
           the API and the worker deploy independently and must tolerate skew in
           both directions. Exporting nothing is the correct behaviour, and it is
           the same behaviour as the flag being off. */
        log.debug("[otel-export] config unreadable for {}: {}", workspaceId, it.message)
        null
    }

    /**
     * Build or reuse the destination for [row]. Null when it cannot be built.
     *
     * `open` so a test can substitute a recording exporter here. This is the ONLY
     * seam the export path needs: everything above it — the config read, the
     * sampling decision, the tree walk, the reparenting and the whole mapping —
     * then runs for real, which is the difference between testing the exporter
     * and testing a mock of it.
     */
    open fun destinationFor(row: Row): Destination? {
        cache[row.workspaceId]?.let { if (it.version == row.updatedAtMs) return it }
        return synchronized(this) {
            cache[row.workspaceId]?.let { if (it.version == row.updatedAtMs) return@synchronized it }
            val built = runCatching { build(row) }.getOrElse {
                log.warn("[otel-export] could not build exporter for {}: {}",
                    row.workspaceId, it.message)
                return@synchronized null
            }
            /* Replace, then shut the old one down — in that order, so a concurrent
               export never sees the cache empty and rebuilds a third exporter. */
            cache.put(row.workspaceId, built)?.let { old ->
                runCatching { old.exporter.shutdown() }
            }
            built
        }
    }

    private fun build(row: Row): Destination {
        require(row.protocol == "http/protobuf") {
            /* Refused, not silently downgraded. A fallback to a different wire
               format produces a receiver that returns 400 with no clue why. */
            "unsupported OTLP protocol '${row.protocol}'"
        }

        val builder = OtlpHttpSpanExporter.builder()
            .setEndpoint(row.endpoint.trimEnd('/') + "/v1/traces")
            .setTimeout(Duration.ofMillis(row.timeoutMs.toLong()))

        /* Headers come out of SecretService and are used ONCE, here, going
           straight into the exporter. They are never logged, never put on a span
           and never held in a field — the exporter keeps its own copy and this
           method's locals go out of scope. */
        headers(row).forEach { (k, v) -> builder.addHeader(k, v) }

        return Destination(builder.build(), resource(row), row.updatedAtMs)
    }

    private fun headers(row: Row): Map<String, String> {
        val ref = row.headersSecretRef?.takeIf { it.isNotBlank() } ?: return emptyMap()
        val svc = secrets ?: run {
            log.warn("[otel-export] {} has auth headers but no SecretService — sending none",
                row.workspaceId)
            return emptyMap()
        }
        return runCatching {
            svc.resolve(ref, row.workspaceId)?.use { sv ->
                var json = ""
                sv.useOnce { json = it }
                @Suppress("UNCHECKED_CAST")
                (mapper.readValue(json, Map::class.java) as Map<String, Any?>)
                    .mapNotNull { (k, v) -> if (v is String) k to v else null }
                    .toMap()
            } ?: emptyMap()
        }.getOrElse {
            /* The message, not the exception — a stack trace here would carry the
               ref and possibly a fragment of the ciphertext into the log. */
            log.warn("[otel-export] auth headers unresolvable for {}: {}",
                row.workspaceId, it.message)
            emptyMap()
        }
    }

    /**
     * The OTel Resource: what the customer's service map calls us.
     *
     * `service.name` is set LAST so a resource attribute in the config cannot
     * overwrite it. A workspace that could rename the service to match one of its
     * own would silently merge our spans into their application's, which is a
     * confusing thing to allow by accident.
     */
    private fun resource(row: Row): Resource {
        val b = Attributes.builder()
        runCatching {
            mapper.readTree(row.resourceAttributesJson).fields().forEach { (k, v) ->
                if (v.isTextual) b.put(AttributeKey.stringKey(k), v.asText())
            }
        }
        b.put(AttributeKey.stringKey("service.name"), row.serviceName)
        b.put(AttributeKey.stringKey("telemetry.sdk.language"), "java")
        return Resource.create(b.build())
    }

    /** Record the outcome, so a settings screen can say more than "enabled". */
    fun recordOutcome(workspaceId: UUID, error: String?) {
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    if (error == null)
                        "UPDATE workspace_otel_exports SET last_export_at = now(), " +
                        "last_error = NULL, last_error_at = NULL WHERE workspace_id = ?"
                    else
                        "UPDATE workspace_otel_exports SET last_error = ?, " +
                        "last_error_at = now() WHERE workspace_id = ?"
                ).use { st ->
                    if (error == null) st.setObject(1, workspaceId)
                    else { st.setString(1, error.take(500)); st.setObject(2, workspaceId) }
                    st.executeUpdate()
                }
            }
        }
    }

    /** Close every cached exporter. Called on shutdown. */
    fun close() {
        cache.values.forEach { runCatching { it.exporter.shutdown() } }
        cache.clear()
    }
}
